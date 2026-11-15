import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DialogService } from 'primeng/dynamicdialog';
import { first, firstValueFrom } from 'rxjs';
import { NewArrangementDialogComponent, NewArrangementDialogData, NewArrangementDialogResult } from '../../../../dialogs/new-arrangement-dialog/new-arrangement-dialog.component';
import { ScoreEditorDialogComponent, ScoreEditorDialogData } from '../../../../dialogs/score-editor-dialog/score-editor-dialog.component';
import { editLockMessage } from '../../../../constants';
import { ImportsModule } from '../../../../imports';
import { Arrangement, ArrangementRowStatus, ArrangementVersion, DraftSummary, EditLock } from '../../../../module';
import { ArrangementService, ConfirmService, ScorePlaybackService, ToastService, withErrorSummary } from '../../../../service';

/** Telefono: la scheda mostra solo lo stato della partitura, che si scrive da un computer o da un tablet. */
const PHONE_QUERY = '(max-width: 768px)';

const ROW_STATUS: Record<ArrangementRowStatus, { label: string; severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary' }> = {
    NEW: { label: 'Nuova', severity: 'secondary' },
    TO_EXTRACT: { label: 'Da estrarre', severity: 'info' },
    UP_TO_DATE: { label: 'Aggiornata', severity: 'success' },
    MODIFIED: { label: "Modificata dopo l'estrazione", severity: 'warn' },
    PART_DELETED: { label: 'Parte eliminata', severity: 'danger' }
};

function moment(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Partitura della traccia, per chi gestisce la traccia con la scrittura attiva: la crea dall'organico o dalle parti, la
 * apre nell'editor della partitura, ne mostra i righi con lo stato delle loro parti, le versioni da approvare o scaricare
 * e la elimina. Sul telefono mostra solo lo stato.
 */
@Component({
    selector: 'app-score-arrangement-panel',
    standalone: true,
    imports: [ImportsModule],
    templateUrl: './score-arrangement-panel.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [DialogService]
})
export class ScoreArrangementPanelComponent implements OnChanges {
    @Input({ required: true }) trackId!: number;
    /** La traccia ha modifiche non salvate: le parti nuove non sono ancora sul server. */
    @Input() trackDirty = false;

    protected arrangement: Arrangement | null = null;
    protected versions: ArrangementVersion[] | null = null;
    protected loading = false;
    protected failed = false;
    protected opening = false;
    protected readonly phone = typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;
    protected readonly rowStatus = ROW_STATUS;
    protected readonly moment = moment;

    constructor(
        private readonly arrangementService: ArrangementService,
        private readonly playbackService: ScorePlaybackService,
        private readonly dialogService: DialogService,
        private readonly confirmService: ConfirmService,
        private readonly toastService: ToastService,
        private readonly changeDetector: ChangeDetectorRef
    ) {}

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['trackId'] && this.trackId) void this.reload();
    }

    /** «Bozza non salvata di Mario Rossi, 14/11/2026 10:32». */
    protected draftLabel(draft: DraftSummary): string {
        const when = moment(draft.savedAt);
        return `Bozza non salvata${draft.savedBy ? ` di ${draft.savedBy}` : ''}${when ? `, ${when}` : ''}`;
    }

    /** «In modifica da Mario Rossi dalle 10:32». */
    protected editingLabel(editing: EditLock): string {
        return editLockMessage(editing.ownerName, editing.since, false);
    }

    /** Qualcun altro sta scrivendo la partitura. */
    protected get editedElsewhere(): boolean {
        return !!this.arrangement?.editing && !this.arrangement.editing.mine;
    }

    protected instrumentsLabel(row: Arrangement['rows'][number]): string {
        return row.instruments.map((instrument) => instrument.name).join(', ');
    }

    /** Partitura nuova dall'organico o dalle parti della traccia, aperta subito nell'editor. */
    protected async create(): Promise<void> {
        if (this.opening) return;
        this.opening = true;
        this.changeDetector.markForCheck();
        let playback;
        try {
            playback = await firstValueFrom(this.playbackService.playback(this.trackId));
        } catch {
            this.toastService.error('Partitura non disponibile', 'Le parti della traccia non si possono leggere: riprovare più tardi.');
            return;
        } finally {
            this.opening = false;
            this.changeDetector.markForCheck();
        }
        const data: NewArrangementDialogData = { trackId: this.trackId, playback };
        const ref = this.dialogService.open(NewArrangementDialogComponent, { showHeader: false, width: 'min(48rem, 95vw)', modal: true, focusOnShow: false, data });
        ref?.onClose.pipe(first()).subscribe((result: NewArrangementDialogResult | undefined) => {
            if (!result) return;
            this.arrangement = result.arrangement;
            this.versions = null;
            this.changeDetector.markForCheck();
            this.write(true);
        });
    }

    /** Apre la partitura nell'editor: dalla versione corrente o, con `resume`, dalla bozza senza chiedere. */
    protected write(resume = false): void {
        const arrangement = this.arrangement;
        if (!arrangement) return;
        const data: ScoreEditorDialogData = {
            trackId: this.trackId,
            scoreId: 0,
            versionId: arrangement.currentVersion?.id ?? null,
            partLabel: 'Partitura',
            sound: { percussionKeys: [], configured: false, conflicting: false },
            mode: 'writing',
            resume,
            arrangement: {
                version: arrangement.currentVersion ?? null,
                rows: arrangement.rows.map((row) => ({ id: row.id, name: row.name, instruments: row.instruments }))
            }
        };
        const ref = this.dialogService.open(ScoreEditorDialogComponent, {
            showHeader: false,
            width: '100vw',
            height: '100vh',
            modal: true,
            closeOnEscape: false,
            focusOnShow: false,
            focusTrap: false,
            data,
            style: { 'max-height': '100vh', 'border-radius': '0' },
            contentStyle: { padding: '0', overflow: 'hidden', height: '100vh' }
        });
        ref?.onClose.pipe(first()).subscribe((version: ArrangementVersion | undefined) => {
            if (version && 'versionNumber' in version) this.toastService.success('Partitura salvata', `La versione ${version.versionNumber} è ora quella corrente.`);
            this.versions = null;
            void this.reload();
        });
    }

    protected discardDraft(): void {
        const draft = this.arrangement?.draft;
        if (!draft) return;
        this.confirmService.confirmDestructive({
            title: 'Scartare la bozza?',
            consequence: `${this.draftLabel(draft)} della partitura andrà persa: non si potrà recuperare.`,
            actionLabel: 'Scarta la bozza',
            accept: () =>
                void this.arrangementService.discardDraft(this.trackId).then(
                    () => {
                        this.toastService.success('Bozza scartata', 'La partitura torna alla versione corrente.');
                        void this.reload();
                    },
                    // L'avviso dell'errore è già mostrato; la partitura si ricarica per mostrare chi sta scrivendo.
                    () => void this.reload()
                )
        });
    }

    /** Mostra o nasconde le versioni della partitura. */
    protected async toggleVersions(): Promise<void> {
        if (this.versions) {
            this.versions = null;
            this.changeDetector.markForCheck();
            return;
        }
        try {
            this.versions = await this.arrangementService.versions(this.trackId);
        } catch {
            this.versions = null;
        }
        this.changeDetector.markForCheck();
    }

    protected async approve(version: ArrangementVersion): Promise<void> {
        try {
            await this.arrangementService.approve(this.trackId, version.id, withErrorSummary('Versione non approvata'));
            this.toastService.success('Versione approvata', `La versione ${version.versionNumber} della partitura è approvata.`);
            this.versions = await this.arrangementService.versions(this.trackId);
            await this.reload();
        } catch {
            // L'avviso dell'errore è già mostrato.
        }
        this.changeDetector.markForCheck();
    }

    /** Scarica la versione come MusicXML compresso, da aprire in MuseScore. */
    protected async download(version: ArrangementVersion): Promise<void> {
        try {
            const blob = await this.arrangementService.file(this.trackId, version.id);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `partitura-versione-${version.versionNumber}.mxl`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url));
        } catch {
            this.toastService.error('File non scaricato', 'Riprovare più tardi.');
        }
    }

    /** Elimina la partitura con versioni e bozza, dopo una conferma; le parti della traccia restano. */
    protected remove(): void {
        if (!this.arrangement) return;
        this.confirmService.confirmDestructive({
            title: 'Eliminare la partitura?',
            consequence: 'La partitura, le sue versioni e la bozza andranno perse: non si potranno recuperare. Le parti della traccia restano, senza il collegamento ai righi.',
            actionLabel: 'Elimina la partitura',
            accept: () =>
                void this.arrangementService.delete(this.trackId, undefined, withErrorSummary('Partitura non eliminata')).then(
                    () => {
                        this.toastService.success('Partitura eliminata', 'Le parti della traccia restano.');
                        this.versions = null;
                        void this.reload();
                    },
                    () => void this.reload()
                )
        });
    }

    private async reload(): Promise<void> {
        this.loading = true;
        this.changeDetector.markForCheck();
        try {
            this.arrangement = await this.arrangementService.arrangement(this.trackId);
            this.failed = false;
        } catch {
            this.failed = true;
        } finally {
            this.loading = false;
            this.changeDetector.markForCheck();
        }
    }
}
