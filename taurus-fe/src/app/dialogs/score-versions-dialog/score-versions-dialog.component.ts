import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { Menu, MenuModule } from 'primeng/menu';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { finalize, first, firstValueFrom } from 'rxjs';
import { ImportsModule } from '../../imports';
import { PartPlaybackSettings, PlaybackInstrument, PlaybackSound, ScoreVersion } from '../../module';
import { GENERAL_MIDI_FAMILIES, programName } from '../../score-player/general-midi';
import { fileName, saveFile, versionMidi } from '../../score-player/midi-download';
import { checkIssues, originLabel } from '../../score-player/playback-labels';
import { ConfirmService, ScorePlaybackService, ToastService } from '../../service';
import { openCompareDialog } from '../score-compare-dialog/score-compare-dialog.component';

export interface ScoreVersionsDialogData {
    trackId: number;
    scoreId: number;
    partLabel: string;
    settings: PartPlaybackSettings;
    /** Primo strumento della parte: con i campi vuoti la parte usa il suo suono e la sua trasposizione. */
    instrument?: PlaybackInstrument | null;
    /** Suono salvato della parte, per scaricare le versioni in MIDI come si ascoltano. */
    sound?: PlaybackSound;
    /** Tempo della partitura scelto per la traccia, in semiminime al minuto. */
    tempoBpm?: number | null;
    /** Con la scrittura attiva, la versione da cui sono impaginate le pagine: se ne scarica il PDF. */
    engravedFromVersionId?: number | null;
}

/** Esito del dialogo: versioni o suono cambiati e, se richiesta, la versione da aprire nell'editor di correzione. */
export interface ScoreVersionsDialogResult {
    changed: boolean;
    correctVersionId?: number;
    /** La battuta da selezionare nell'editor, da 0, come quella di una differenza del confronto. */
    measureIndex?: number;
}

/** Versioni MusicXML di una parte e sovrascritture di suono e trasposizione. */
@Component({
    selector: 'app-score-versions-dialog',
    standalone: true,
    imports: [ImportsModule, MenuModule],
    changeDetection: ChangeDetectionStrategy.Eager,
    templateUrl: './score-versions-dialog.component.html',
    providers: [DialogService]
})
export class ScoreVersionsDialogComponent implements OnInit {
    protected readonly data: ScoreVersionsDialogData;
    protected readonly soundGroups = GENERAL_MIDI_FAMILIES.map((family) => ({ label: family.label, items: family.sounds.map((sound) => ({ label: `${sound.program} · ${sound.name}`, value: sound.program })) }));
    protected versions: ScoreVersion[] = [];
    /** Formati della versione per cui si è aperto il menu «Scarica». */
    protected downloads: MenuItem[] = [];
    protected loading = true;
    protected busy = false;
    protected transpositionOverride: number | null;
    protected soundProgramOverride: number | null;
    protected soundBankOverride: number | null;
    private changed = false;
    /** Suono salvato sulla parte, per riconoscere i campi modificati e non ancora salvati. */
    private savedSound: PartPlaybackSettings;

    constructor(
        private readonly dialogRef: DynamicDialogRef<ScoreVersionsDialogComponent>,
        private readonly playbackService: ScorePlaybackService,
        private readonly toastService: ToastService,
        private readonly confirmService: ConfirmService,
        private readonly dialogService: DialogService,
        config: DynamicDialogConfig<ScoreVersionsDialogData>
    ) {
        this.data = config.data!;
        this.transpositionOverride = this.data.settings.transpositionOverride ?? null;
        this.soundProgramOverride = this.data.settings.soundProgramOverride ?? null;
        this.soundBankOverride = this.data.settings.soundBankOverride ?? null;
        this.savedSound = this.soundSettings();
    }

    /** I campi del suono differiscono da quelli salvati: chiudere il dialogo li perderebbe. */
    protected get soundDirty(): boolean {
        const current = this.soundSettings();
        return current.transpositionOverride !== this.savedSound.transpositionOverride || current.soundProgramOverride !== this.savedSound.soundProgramOverride || current.soundBankOverride !== this.savedSound.soundBankOverride;
    }

    /** Nome dello strumento da cui la parte eredita suono e trasposizione. */
    protected get instrumentName(): string {
        return this.data.instrument?.name ?? 'suo primo strumento';
    }

    /** Valori ereditati dallo strumento, mostrati nei campi vuoti. */
    protected get inheritedTransposition(): string {
        const instrument = this.data.instrument;
        if (instrument?.percussionKey != null) return 'Batteria, nessuna trasposizione';
        const value = instrument?.transpositionSemitones;
        if (value == null) return 'Non configurata nello strumento';
        return `${value > 0 ? '+' : ''}${value} dallo strumento`;
    }

    protected get inheritedSound(): string {
        const instrument = this.data.instrument;
        if (instrument?.percussionKey != null) return 'Come lo strumento: batteria';
        const name = programName(instrument?.soundProgram);
        return name ? `Come lo strumento: ${name}` : 'Come lo strumento: non configurato';
    }

    protected get inheritedBank(): string {
        if (this.soundProgramOverride != null) return '';
        const bank = this.data.instrument?.soundBank;
        return bank == null ? '' : `${bank} dallo strumento`;
    }

    ngOnInit(): void {
        this.load();
    }

    protected originLabel = originLabel;

    protected issues(version: ScoreVersion): string[] {
        return checkIssues(version.checks);
    }

    protected use(version: ScoreVersion): void {
        this.run(this.playbackService.makeCurrent(this.data.trackId, this.data.scoreId, version.id), 'Versione in ascolto', `La versione ${version.versionNumber} è quella ascoltata per la parte.`);
    }

    protected approve(version: ScoreVersion): void {
        this.run(this.playbackService.approve(this.data.trackId, this.data.scoreId, version.id), 'Versione approvata', `La versione ${version.versionNumber} è approvata e ascoltata per la parte.`);
    }

    /** Apre il menu dei formati della versione: MusicXML, MIDI e, se ne derivano le pagine, il PDF. */
    protected openDownloads(event: Event, menu: Menu, version: ScoreVersion): void {
        this.downloads = [
            { label: 'MusicXML per MuseScore (.mxl)', icon: 'pi pi-file', command: () => this.download(version) },
            { label: 'MIDI (.mid)', icon: 'pi pi-volume-up', disabled: !this.data.sound, command: () => void this.downloadMidi(version) }
        ];
        if (this.data.engravedFromVersionId === version.id) this.downloads.push({ label: 'PDF delle pagine', icon: 'pi pi-file-pdf', command: () => this.downloadPdf(version) });
        menu.toggle(event);
    }

    protected download(version: ScoreVersion): void {
        this.playbackService
            .versionFile(this.data.trackId, this.data.scoreId, version.id)
            .pipe(first())
            .subscribe((blob) => saveFile(blob, `${this.fileName(version)}.mxl`));
    }

    /** MIDI della versione dallo stesso generatore dell'ascolto, in suoni reali, con ritornelli e salti eseguiti. */
    protected async downloadMidi(version: ScoreVersion): Promise<void> {
        const sound = this.data.sound;
        if (!sound) return;
        try {
            const editor = await firstValueFrom(this.playbackService.editor(this.data.trackId, this.data.scoreId, version.id));
            saveFile(versionMidi(editor.musicXml, this.data.partLabel, sound, this.data.tempoBpm ?? null), `${this.fileName(version)}.mid`);
        } catch {
            this.toastService.warn('MIDI non scaricato', 'Impossibile leggere la versione: riprovare più tardi.');
        }
    }

    /** PDF dell'ultima impaginazione della versione, come «Scarica il PDF» nell'impaginazione. */
    protected downloadPdf(version: ScoreVersion): void {
        firstValueFrom(this.playbackService.engravingPdf(this.data.trackId, this.data.scoreId, version.id))
            .then((blob) => saveFile(blob, `${this.fileName(version)}.pdf`))
            .catch(() => this.toastService.warn('PDF non scaricato', 'Il PDF di questa impaginazione non è più disponibile: impagina di nuovo la versione.'));
    }

    protected saveSound(): void {
        this.busy = true;
        const settings = this.soundSettings();
        this.playbackService
            .updatePartSettings(this.data.trackId, this.data.scoreId, settings)
            .pipe(
                first(),
                finalize(() => (this.busy = false))
            )
            .subscribe(() => {
                this.changed = true;
                this.savedSound = settings;
                this.toastService.success('Suono della parte salvato', 'La parte suonerà con le nuove impostazioni.');
            });
    }

    protected resetSound(): void {
        this.transpositionOverride = null;
        this.soundProgramOverride = null;
        this.soundBankOverride = null;
        this.saveSound();
    }

    /**
     * Confronta la versione con quella da cui deriva, o con la precedente; «Correggi» del confronto apre l'editor sulla
     * versione più recente, alla battuta della differenza scelta.
     */
    protected compare(version: ScoreVersion): void {
        openCompareDialog(this.dialogService, {
            trackId: this.data.trackId,
            scoreId: this.data.scoreId,
            subject: this.data.partLabel,
            versionId: version.id,
            sound: this.data.sound ?? null,
            correctable: true
        })
            .pipe(first())
            .subscribe((result) => {
                if (result) this.correct(this.versions.find((item) => item.id === result.correctVersionId) ?? version, result.measureIndex);
            });
    }

    /** Chiude il dialogo e apre la versione nell'editor di correzione; con il suono non salvato chiede prima. */
    protected correct(version: ScoreVersion, measureIndex?: number): void {
        const open = (): void => this.dialogRef.close({ changed: this.changed, correctVersionId: version.id, ...(measureIndex === undefined ? {} : { measureIndex }) } satisfies ScoreVersionsDialogResult);
        if (!this.soundDirty) {
            open();
            return;
        }
        this.confirmService.confirmDiscard({
            title: 'Modifiche non salvate',
            consequence: 'Il suono della parte non è stato salvato: aprendo l’editor le modifiche andranno perse.',
            actionLabel: 'Apri senza salvare',
            accept: open
        });
    }

    protected close(): void {
        this.dialogRef.close({ changed: this.changed } satisfies ScoreVersionsDialogResult);
    }

    private fileName(version: ScoreVersion): string {
        return `${fileName(this.data.partLabel)} - versione ${version.versionNumber}`;
    }

    private soundSettings(): PartPlaybackSettings {
        return {
            transpositionOverride: this.transpositionOverride ?? null,
            soundProgramOverride: this.soundProgramOverride ?? null,
            soundBankOverride: this.soundProgramOverride == null ? null : (this.soundBankOverride ?? null)
        };
    }

    private run(request: ReturnType<ScorePlaybackService['approve']>, title: string, detail: string): void {
        this.busy = true;
        request
            .pipe(
                first(),
                finalize(() => (this.busy = false))
            )
            .subscribe(() => {
                this.changed = true;
                this.toastService.success(title, detail);
                this.load();
            });
    }

    private load(): void {
        this.loading = true;
        this.playbackService
            .versions(this.data.trackId, this.data.scoreId)
            .pipe(
                first(),
                finalize(() => (this.loading = false))
            )
            .subscribe((versions) => (this.versions = versions));
    }
}
