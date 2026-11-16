import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { finalize, first, Observable, of } from 'rxjs';
import { ImportsModule } from '../../imports';
import { PlaybackSound, ScoreFragment, ScoreFragmentCategory } from '../../module';
import { DerivationOctave, fifthsLabel, rangeLabel } from '../../score-editor/score-derivation';
import { EditError } from '../../score-editor/score-document';
import { FRAGMENT_CATEGORIES, fragmentBlocker, FragmentNotation, prepareFragment, PreparedFragment } from '../../score-editor/score-fragments';
import { parseMusicXml } from '../../score-player/musicxml-score';
import { buildPlayback } from '../../score-player/playback-builder';
import { partSound, secondsAt } from '../../score-player/timeline';
import { ConfirmService, ScoreAudioService, ScoreFragmentService, ScoreRendererService, withErrorSummary } from '../../service';
import { openFragmentDialog } from '../score-fragment-dialog/score-fragment-dialog.component';

export interface ScoreFragmentsDialogData {
    /** Come la parte, o il rigo attivo, riceve i frammenti. */
    notation: FragmentNotation;
    /** Chiave della parte prima della battuta selezionata. */
    clef: string;
    /** Chiave della parte in fondo. */
    endClef: string;
    /** Numero della battuta selezionata; `null` senza battuta selezionata: il frammento va in fondo. */
    measureNumber: string | null;
    /** Suono della parte o del rigo, per ascoltare il frammento come sarà scritto. */
    sound: PlaybackSound;
    /** Nella partitura le battute vanno in tutti i righi e le note nel rigo attivo. */
    arrangement: boolean;
}

/** Il frammento scelto, preparato per la parte, e dove inserirlo. */
export interface ScoreFragmentsDialogResult {
    fragment: ScoreFragment;
    prepared: PreparedFragment;
    atEnd: boolean;
}

const OCTAVE_NAMES: Readonly<Record<number, string>> = { [-2]: 'Due ottave sotto', [-1]: "Un'ottava sotto", 0: 'Stesso suono del frammento', 1: "Un'ottava sopra", 2: 'Due ottave sopra' };

export function openFragmentsDialog(dialogService: DialogService, data: ScoreFragmentsDialogData): Observable<ScoreFragmentsDialogResult | undefined> {
    const ref = dialogService.open(ScoreFragmentsDialogComponent, { showHeader: false, width: 'min(64rem, 96vw)', modal: true, focusOnShow: false, data });
    return ref?.onClose ?? of(undefined);
}

/**
 * Biblioteca dei frammenti dell'associazione: ricerca per nome e nota, categorie, anteprima del frammento come sarà
 * scritto nella parte, con l'ottava da scegliere per gli strumenti intonati, ascolto e inserimento prima della battuta
 * selezionata o in fondo. Da qui si cambiano nome, categoria e nota dei frammenti e si eliminano.
 */
@Component({
    selector: 'app-score-fragments-dialog',
    standalone: true,
    imports: [ImportsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './score-fragments-dialog.component.html',
    styleUrl: './score-fragments-dialog.component.scss',
    providers: [DialogService]
})
export class ScoreFragmentsDialogComponent implements OnInit, OnDestroy {
    @ViewChild('preview') private preview?: ElementRef<HTMLElement>;

    protected readonly data: ScoreFragmentsDialogData;
    protected readonly categories = [...FRAGMENT_CATEGORIES];

    protected fragments: ScoreFragment[] = [];
    protected loading = true;
    protected loadError = false;
    protected query = '';
    protected category: ScoreFragmentCategory | null = null;
    protected selected: ScoreFragment | null = null;
    protected prepared: PreparedFragment | null = null;
    protected preparing = false;
    protected prepareError: string | null = null;
    protected octave: number | null = null;
    protected atEnd: boolean;
    protected drawError = false;
    protected playing = false;
    protected preparingAudio = false;
    protected audioError = false;

    private readonly contents = new Map<number, string>();
    private request = 0;
    private stopTimer?: number;
    /** Un dialogo o una conferma sono aperti sopra la biblioteca: Esc chiude solo quelli. */
    private covered = false;

    constructor(
        private readonly dialogRef: DynamicDialogRef<ScoreFragmentsDialogComponent>,
        private readonly fragmentService: ScoreFragmentService,
        private readonly renderer: ScoreRendererService,
        private readonly audio: ScoreAudioService,
        private readonly confirmService: ConfirmService,
        private readonly dialogService: DialogService,
        private readonly changeDetector: ChangeDetectorRef,
        config: DynamicDialogConfig<ScoreFragmentsDialogData>
    ) {
        this.data = config.data!;
        this.atEnd = this.data.measureNumber === null;
    }

    async ngOnInit(): Promise<void> {
        try {
            this.fragments = await this.fragmentService.list();
        } catch {
            this.loadError = true;
        }
        this.loading = false;
        this.changeDetector.markForCheck();
    }

    ngOnDestroy(): void {
        this.stop();
    }

    protected get subtitle(): string {
        const target = this.data.arrangement ? 'nella partitura, in tutti i righi, con le note nel rigo attivo' : 'nella parte';
        const where = this.data.measureNumber === null ? 'in fondo' : `prima della battuta ${this.data.measureNumber} o in fondo`;
        return `Le battute del frammento si inseriscono ${target}, ${where}. Un frammento intonato si traspone per lo strumento.`;
    }

    /** Frammenti della ricerca e della categoria scelte, per nome. */
    protected get visible(): ScoreFragment[] {
        const query = this.query.trim().toLowerCase();
        return this.fragments.filter((fragment) => (!this.category || fragment.category === this.category) && (!query || fragment.name.toLowerCase().includes(query) || (fragment.note ?? '').toLowerCase().includes(query)));
    }

    protected get blocker(): string | null {
        return this.selected ? fragmentBlocker(this.selected, this.data.notation) : null;
    }

    protected get octaves(): { value: number; label: string }[] {
        return (this.prepared?.plan?.octaves ?? []).filter((candidate) => candidate.possible).map((candidate) => ({ value: candidate.octave, label: this.octaveLabel(candidate) }));
    }

    protected get chosen(): DerivationOctave | null {
        return this.prepared?.plan?.octaves.find((candidate) => candidate.octave === this.prepared?.octave) ?? null;
    }

    protected get rangeText(): string | null {
        const range = this.prepared?.plan?.range;
        return range ? rangeLabel(range) : null;
    }

    protected get keyText(): string | null {
        const fifths = this.prepared?.plan?.fifths;
        return fifths === null || fifths === undefined ? null : `Armatura iniziale per la parte: ${fifthsLabel(fifths)}`;
    }

    protected get instrumentName(): string {
        return this.data.notation.kind === 'PITCHED' ? this.data.notation.name : '';
    }

    protected get canInsert(): boolean {
        return !!this.prepared && !this.preparing && !this.blocker && !this.prepareError;
    }

    protected categoryLabel(category: ScoreFragmentCategory): string {
        return FRAGMENT_CATEGORIES.find((option) => option.value === category)?.label ?? category;
    }

    protected details(fragment: ScoreFragment): string {
        const measures = fragment.measureCount === 1 ? '1 battuta' : `${fragment.measureCount} battute`;
        return `${this.categoryLabel(fragment.category)} · ${measures} · ${fragment.kind === 'PERCUSSION' ? 'percussioni' : 'intonato'}`;
    }

    protected select(fragment: ScoreFragment): void {
        if (this.selected?.id === fragment.id) return;
        this.stop();
        this.selected = fragment;
        this.octave = null;
        void this.prepare();
    }

    protected changedOctave(octave: number): void {
        this.octave = octave;
        void this.prepare();
    }

    /** In fondo la chiave della parte può essere un'altra: il frammento si prepara di nuovo. */
    protected changedPosition(): void {
        if (this.data.clef !== this.data.endClef) void this.prepare();
    }

    protected async togglePlay(): Promise<void> {
        if (this.playing) {
            this.stop();
            return;
        }
        const prepared = this.prepared;
        if (!prepared || this.preparingAudio) return;
        this.preparingAudio = true;
        this.audioError = false;
        this.changeDetector.markForCheck();
        try {
            const part = parseMusicXml(prepared.score.cleanXml());
            const built = buildPlayback([{ key: 'fragment', name: this.selected?.name ?? '', part, sound: partSound(this.data.sound, part.clefSign) }], part, { withRepeats: false, tempoBpm: null, countIn: false });
            await this.audio.ready();
            await this.audio.load(built.midi);
            this.audio.setChannel(built.metronome, 0, true);
            await this.audio.play();
            this.playing = true;
            this.stopTimer = window.setTimeout(() => this.stop(), secondsAt(built.totalQuarters, built.tempo) * 1000 + 300);
        } catch {
            this.audioError = true;
        } finally {
            this.preparingAudio = false;
            this.changeDetector.markForCheck();
        }
    }

    protected edit(fragment: ScoreFragment): void {
        this.covered = true;
        openFragmentDialog(this.dialogService, { fragment })
            .pipe(
                first(),
                finalize(() => (this.covered = false))
            )
            .subscribe((saved) => {
                if (!saved) return;
                this.fragments = this.fragments.map((item) => (item.id === saved.id ? saved : item)).sort((left, right) => left.name.localeCompare(right.name, 'it', { sensitivity: 'base' }));
                if (this.selected?.id === saved.id) this.selected = saved;
                this.changeDetector.markForCheck();
            });
    }

    protected remove(fragment: ScoreFragment): void {
        this.covered = true;
        this.confirmService.confirmDestructive({
            title: 'Eliminare il frammento?',
            consequence: `«${fragment.name}» esce dalla biblioteca. Le parti dove è stato inserito non cambiano.`,
            actionLabel: 'Elimina',
            accept: () => {
                this.covered = false;
                void this.delete(fragment);
            },
            reject: () => (this.covered = false)
        });
    }

    protected insert(): void {
        const selected = this.selected;
        const prepared = this.prepared;
        if (!selected || !prepared || !this.canInsert) return;
        this.stop();
        this.dialogRef.close({ fragment: selected, prepared, atEnd: this.atEnd } satisfies ScoreFragmentsDialogResult);
    }

    protected close(): void {
        if (this.covered) return;
        this.stop();
        this.dialogRef.close();
    }

    private async delete(fragment: ScoreFragment): Promise<void> {
        try {
            await this.fragmentService.delete(fragment.id, withErrorSummary('Frammento non eliminato'));
        } catch {
            // L'avviso dell'errore è già mostrato.
            return;
        }
        this.fragments = this.fragments.filter((item) => item.id !== fragment.id);
        this.contents.delete(fragment.id);
        if (this.selected?.id === fragment.id) {
            this.stop();
            this.request++;
            this.selected = null;
            this.prepared = null;
            this.prepareError = null;
        }
        this.changeDetector.markForCheck();
    }

    /** Il frammento scelto come sarà scritto nella parte, con l'anteprima. */
    private async prepare(): Promise<void> {
        const fragment = this.selected;
        if (!fragment) return;
        const request = ++this.request;
        this.stop();
        this.prepared = null;
        this.prepareError = null;
        this.drawError = false;
        if (this.blocker) {
            this.preparing = false;
            this.changeDetector.markForCheck();
            return;
        }
        this.preparing = true;
        this.changeDetector.markForCheck();
        try {
            let xml = this.contents.get(fragment.id);
            if (xml === undefined) {
                xml = await this.fragmentService.content(fragment.id);
                this.contents.set(fragment.id, xml);
            }
            if (request !== this.request) return;
            this.prepared = prepareFragment(xml, fragment, this.data.notation, this.atEnd ? this.data.endClef : this.data.clef, this.octave);
            this.octave = this.prepared.octave;
        } catch (error) {
            if (request !== this.request) return;
            this.prepareError = error instanceof EditError ? error.message : 'Il frammento non si legge: riprova più tardi';
        }
        this.preparing = false;
        this.changeDetector.markForCheck();
        if (this.prepared) await this.draw(request);
    }

    private async draw(request: number): Promise<void> {
        // Il contenitore dell'anteprima compare con il frammento preparato.
        this.changeDetector.detectChanges();
        const host = this.preview?.nativeElement;
        const prepared = this.prepared;
        if (!host || !prepared) return;
        host.innerHTML = '';
        try {
            const pages = await this.renderer.render(prepared.score.cleanXml(), host.clientWidth || 560);
            if (request !== this.request) return;
            // L'SVG è generato da Verovio a partire dal MusicXML: i testi sono codificati e non contiene script.
            host.innerHTML = pages.join('');
        } catch {
            if (request === this.request) this.drawError = true;
        }
        this.changeDetector.markForCheck();
    }

    private octaveLabel(candidate: DerivationOctave): string {
        const count = candidate.outOfRange;
        const outside = count === null ? '' : count === 0 ? " · tutte le note nell'estensione" : ` · ${count === 1 ? '1 nota' : `${count} note`} fuori estensione`;
        return `${OCTAVE_NAMES[candidate.octave]} · ${candidate.label}${outside}`;
    }

    private stop(): void {
        if (this.stopTimer !== undefined) window.clearTimeout(this.stopTimer);
        this.stopTimer = undefined;
        if (this.playing) this.audio.pause();
        this.playing = false;
        this.changeDetector.markForCheck();
    }
}
