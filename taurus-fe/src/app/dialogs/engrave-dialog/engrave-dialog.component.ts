import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { firstValueFrom, Observable, of } from 'rxjs';
import { ImportsModule } from '../../imports';
import { EngravingFormat, EngravingHeader, EngravingJob, EngravingTarget, MeasureNumbers } from '../../module';
import {
    MAX_ENGRAVED_PAGES,
    MAX_HEADER_LENGTH,
    MAX_MARGIN,
    MAX_STAFF_SIZE,
    MEASURE_NUMBER_LABELS,
    MIN_MARGIN,
    MIN_STAFF_SIZE,
    optionsProblem,
    PAGE_FORMATS,
    requestOptions,
    resolveOptions,
    ResolvedOptions,
    responsivePage
} from '../../score-editor/score-engraving';
import { engravingErrorLabel } from '../../score-player/playback-labels';
import { MediaService, ScorePlaybackService, ScoreRendererService, ToastService, withErrorSummary, withHandledErrors } from '../../service';

export interface EngraveDialogData {
    trackId: number;
    scoreId: number;
    /** Versione da impaginare, di norma quella ascoltata per la parte. */
    versionId: number;
    versionNumber?: number | null;
    partLabel: string;
    /** Testi proposti per l'intestazione: titolo, compositore e arrangiatore della traccia, nome della parte. */
    header: EngravingHeader;
    /** La parte ha già pagine: al termine si sceglie se sostituirle o aggiungere quelle impaginate in una parte nuova. */
    hasPages: boolean;
    /** Versione della traccia letta da chi impagina, per non assegnare le pagine a una traccia cambiata nel frattempo. */
    trackVersion?: number | null;
    /**
     * Più parti da impaginare con le stesse opzioni, come le parti estratte dalla partitura: l'anteprima è della parte di
     * `scoreId` e `versionId`, la prima, e ogni parte ha il suo nome nell'intestazione. Le pagine di una parte senza
     * pagine le sono assegnate al termine del job; le altre restano da assegnare.
     */
    parts?: EngraveBatchPart[];
}

/** Una parte dell'impaginazione di più parti. */
export interface EngraveBatchPart {
    scoreId: number;
    versionId: number;
    partLabel: string;
    hasPages: boolean;
}

/** Lo stato dell'impaginazione di una parte tra più parti: il job, o `null` se non è partito. */
interface BatchEntry {
    part: EngraveBatchPart;
    job: EngravingJob | null;
}

/** Pagine assegnate: la parte che le ha ricevute e la nuova versione della traccia. */
export interface EngraveDialogResult {
    scoreId: number;
    trackVersion: number;
    target: EngravingTarget;
}

type Step = 'loading' | 'options' | 'running' | 'done' | 'batch';

/** Attesa tra due letture dello stato dell'impaginazione. */
export const ENGRAVING_POLL_MS = 3000;
/** Attesa dopo l'ultima modifica delle opzioni prima di ridisegnare l'anteprima. */
export const PREVIEW_DELAY_MS = 400;

/** Apre il dialogo dell'impaginazione; emette le pagine assegnate o `undefined` se si chiude senza assegnarle. */
export function openEngraveDialog(dialogService: DialogService, data: EngraveDialogData): Observable<EngraveDialogResult | undefined> {
    const ref = dialogService.open(EngraveDialogComponent, { showHeader: false, width: 'min(72rem, 96vw)', modal: true, focusOnShow: false, data });
    return ref?.onClose ?? of(undefined);
}

/**
 * Impaginazione di una versione in pagine e PDF: opzioni con l'anteprima di Verovio disegnata nel browser come la
 * disegnerà il servizio musicale, avanzamento del job e scelta di dove mettere le pagine.
 */
@Component({
    selector: 'app-engrave-dialog',
    standalone: true,
    imports: [ImportsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './engrave-dialog.component.html',
    styleUrl: './engrave-dialog.component.scss'
})
export class EngraveDialogComponent implements OnInit, OnDestroy {
    protected readonly data: EngraveDialogData;
    protected readonly formats = (Object.keys(PAGE_FORMATS) as EngravingFormat[]).map((value) => ({ value, label: PAGE_FORMATS[value].label }));
    protected readonly measureNumberOptions = (Object.keys(MEASURE_NUMBER_LABELS) as MeasureNumbers[]).map((value) => ({ value, label: MEASURE_NUMBER_LABELS[value] }));
    protected readonly limits = { minStaff: MIN_STAFF_SIZE, maxStaff: MAX_STAFF_SIZE, minMargin: MIN_MARGIN, maxMargin: MAX_MARGIN, header: MAX_HEADER_LENGTH, pages: MAX_ENGRAVED_PAGES };

    protected step: Step = 'loading';
    protected options: ResolvedOptions;
    protected job: EngravingJob | null = null;
    /** Motivo dell'ultima impaginazione non riuscita, mostrato sopra le opzioni. */
    protected failure: string | null = null;
    protected previewLoading = false;
    protected previewError: string | null = null;
    protected previewPages = 0;
    protected tooManyPages = false;
    protected thumbnails: string[] = [];
    protected busy = false;
    protected dirty = false;
    /** Le impaginazioni avviate per più parti. */
    protected batch: BatchEntry[] = [];

    private musicXml: string | null = null;
    private previewHtml = '';
    private previewTimer?: ReturnType<typeof setTimeout>;
    private pollTimer?: ReturnType<typeof setTimeout>;
    private previewSequence = 0;
    private destroyed = false;
    private host?: HTMLElement;

    @ViewChild('preview') private set previewHost(element: ElementRef<HTMLElement> | undefined) {
        this.host = element?.nativeElement;
        // L'SVG è generato da Verovio dal MusicXML e dalle opzioni: i testi sono codificati e non contiene script.
        if (this.host) this.host.innerHTML = this.previewHtml;
    }

    constructor(
        private readonly dialogRef: DynamicDialogRef<EngraveDialogComponent>,
        private readonly playbackService: ScorePlaybackService,
        private readonly renderer: ScoreRendererService,
        private readonly mediaService: MediaService,
        private readonly toastService: ToastService,
        private readonly changeDetector: ChangeDetectorRef,
        config: DynamicDialogConfig<EngraveDialogData>
    ) {
        this.data = config.data!;
        this.options = resolveOptions({ header: this.data.header });
    }

    async ngOnInit(): Promise<void> {
        const { trackId, scoreId, versionId } = this.data;
        // Le parti appena estratte non hanno impaginazioni da riprendere: si parte dalle opzioni.
        const [editor, job] = await Promise.all([
            firstValueFrom(this.playbackService.editor(trackId, scoreId, versionId)).catch(() => null),
            this.batchParts ? Promise.resolve(null) : firstValueFrom(this.playbackService.engraving(trackId, scoreId, versionId)).catch(() => null)
        ]);
        if (this.destroyed) return;
        this.musicXml = editor?.musicXml ?? null;
        if (!this.musicXml) this.previewError = 'Anteprima non disponibile: la versione non si legge. Le pagine si possono comunque generare.';
        // Le scelte dell'ultima impaginazione della versione tornano come valori proposti.
        if (job) this.options = resolveOptions(job.options);
        this.show(job);
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        clearTimeout(this.previewTimer);
        clearTimeout(this.pollTimer);
        this.revokeThumbnails();
    }

    /** Le parti dell'impaginazione di più parti; `null` per una parte sola. */
    protected get batchParts(): EngraveBatchPart[] | null {
        return this.data.parts?.length ? this.data.parts : null;
    }

    protected get heading(): string {
        const parts = this.batchParts;
        if (parts && parts.length > 1) return `Impagina ${parts.length} parti`;
        return `Impagina ${parts?.[0].partLabel ?? this.data.partLabel}`;
    }

    protected get subtitle(): string {
        if (this.batchParts) {
            return this.step === 'batch'
                ? 'Il servizio musicale genera le pagine una parte alla volta: puoi chiudere e tornare più tardi.'
                : `Le stesse opzioni per tutte le parti; l'anteprima è di ${this.data.partLabel}, e ogni parte ha il suo nome nell'intestazione.`;
        }
        const version = this.data.versionNumber ? `Versione ${this.data.versionNumber}` : 'Versione ascoltata';
        switch (this.step) {
            case 'running':
                return `${version} · Il servizio musicale sta generando le pagine: puoi chiudere e tornare più tardi.`;
            case 'done':
                return `${version} · Le pagine restano da assegnare per 7 giorni, finché non scegli dove metterle.`;
            default:
                return `${version} · Le pagine generate diventano pagine della parte, per l'anteprima, la presentazione e la stampa.`;
        }
    }

    protected get problem(): string | null {
        return optionsProblem(this.options);
    }

    protected get invalidCount(): number {
        return this.step !== 'options' || this.problem || this.tooManyPages ? 1 : 0;
    }

    protected get previewStatus(): string {
        if (this.previewLoading) return 'Disegno dell’anteprima…';
        if (this.tooManyPages) return `Più di ${MAX_ENGRAVED_PAGES} pagine`;
        return this.previewPages === 1 ? '1 pagina' : `${this.previewPages} pagine`;
    }

    protected get statusLabel(): string {
        return this.job?.status === 'RUNNING' ? 'Impaginazione in corso…' : 'Impaginazione in coda…';
    }

    /** Lo stato dell'impaginazione di una parte tra più parti, con il colore dell'etichetta. */
    protected batchStatus(entry: BatchEntry): { label: string; severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary'; active: boolean } {
        const job = entry.job;
        if (!job) return { label: 'Non avviata', severity: 'danger', active: false };
        switch (job.status) {
            case 'QUEUED':
                return { label: 'In coda', severity: 'secondary', active: true };
            case 'RUNNING':
                return { label: 'In corso', severity: 'info', active: true };
            case 'FAILED':
                return { label: engravingErrorLabel(job.errorCode), severity: 'danger', active: false };
            default:
                if (job.appliedAt) return { label: 'Pagine assegnate', severity: 'success', active: false };
                return job.pages.length ? { label: 'Pagine da assegnare nella scheda Ascolto', severity: 'warn', active: false } : { label: 'Pagine generate', severity: 'secondary', active: false };
        }
    }

    /** «Impaginazioni terminate: 2 su 3», mentre i job vanno avanti. */
    protected get batchSummary(): string {
        if (this.batch.every((entry) => !entry.job)) return 'Nessuna impaginazione avviata';
        const finished = this.batch.filter((entry) => !this.batchStatus(entry).active).length;
        return `Impaginazioni terminate: ${finished} su ${this.batch.length}`;
    }

    protected get pageCountLabel(): string {
        const count = this.job?.pages.length ?? 0;
        return count === 1 ? '1 pagina generata' : `${count} pagine generate`;
    }

    protected changedFormat(): void {
        const page = PAGE_FORMATS[this.options.format];
        this.options = { ...this.options, staffSize: page.staff, margin: page.margin };
        this.changed();
    }

    protected changed(): void {
        this.dirty = true;
        this.schedulePreview();
    }

    protected cancel(): void {
        this.dialogRef.close();
    }

    /** Avvia l'impaginazione; se un'altra è già in coda o in corso per la parte, ne segue lo stato. */
    protected async generate(): Promise<void> {
        if (this.problem || this.tooManyPages || this.busy) return;
        if (this.batchParts) {
            await this.generateAll(this.batchParts);
            return;
        }
        this.busy = true;
        this.changeDetector.markForCheck();
        const { trackId, scoreId, versionId } = this.data;
        try {
            const job = await firstValueFrom(this.playbackService.engrave(trackId, scoreId, versionId, requestOptions(this.options), withErrorSummary('Impaginazione non avviata')));
            this.dirty = false;
            this.show(job);
        } catch (error) {
            if (error instanceof HttpErrorResponse && error.status === 409) await this.refresh();
        } finally {
            this.busy = false;
            this.changeDetector.markForCheck();
        }
    }

    /** Assegna le pagine generate: al posto di quelle della parte, o a una parte nuova con la stessa descrizione e gli stessi strumenti. */
    protected async apply(target: EngravingTarget): Promise<void> {
        if (!this.job || this.busy) return;
        this.busy = true;
        this.changeDetector.markForCheck();
        const { trackId, scoreId, versionId } = this.data;
        try {
            const applied = await firstValueFrom(this.playbackService.applyEngraving(trackId, scoreId, versionId, this.job.id, target, this.data.trackVersion ?? null, withErrorSummary('Pagine non assegnate')));
            const pages = this.job.pages.length === 1 ? 'La pagina impaginata è' : `Le ${this.job.pages.length} pagine impaginate sono`;
            this.toastService.success('Pagine assegnate', target === 'NEW_PART' ? `${pages} in una parte nuova, in fondo alla traccia.` : `${pages} ora le pagine di ${this.data.partLabel}.`);
            this.dialogRef.close({ scoreId: applied.scoreId, trackVersion: applied.trackVersion, target } satisfies EngraveDialogResult);
        } catch {
            // L'avviso dell'errore è già mostrato; le pagine restano da assegnare.
        } finally {
            this.busy = false;
            this.changeDetector.markForCheck();
        }
    }

    /** Torna alle opzioni: una nuova impaginazione sostituisce le pagine non assegnate. */
    protected again(): void {
        this.failure = null;
        this.step = 'options';
        this.schedulePreview(0);
        this.changeDetector.markForCheck();
    }

    protected downloadPdf(): void {
        const { trackId, scoreId, versionId } = this.data;
        firstValueFrom(this.playbackService.engravingPdf(trackId, scoreId, versionId))
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${this.data.partLabel.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'parte'}${this.data.versionNumber ? ` - versione ${this.data.versionNumber}` : ''}.pdf`;
                link.click();
                URL.revokeObjectURL(url);
            })
            .catch(() => this.toastService.warn('PDF non scaricato', 'Il PDF di questa impaginazione non è più disponibile: impagina di nuovo la versione.'));
    }

    /**
     * Avvia un'impaginazione per ogni parte, con le pagine assegnate da sole alle parti senza pagine. Una parte già in
     * impaginazione si segue; al primo altro errore, già mostrato, le parti che restano non partono.
     */
    private async generateAll(parts: EngraveBatchPart[]): Promise<void> {
        this.busy = true;
        this.changeDetector.markForCheck();
        const { trackId } = this.data;
        const entries: BatchEntry[] = parts.map((part) => ({ part, job: null }));
        try {
            for (const entry of entries) {
                const { scoreId, versionId, partLabel } = entry.part;
                const options = requestOptions({ ...this.options, header: { ...this.options.header, partName: partLabel } });
                try {
                    entry.job = await firstValueFrom(this.playbackService.engrave(trackId, scoreId, versionId, options, withHandledErrors(['scoreWriting.engravingRunning'], withErrorSummary('Impaginazione non avviata')), true));
                } catch (error) {
                    if (!(error instanceof HttpErrorResponse && error.status === 409)) break;
                    entry.job = await firstValueFrom(this.playbackService.engraving(trackId, scoreId, versionId)).catch(() => null);
                }
            }
        } finally {
            this.busy = false;
        }
        this.dirty = false;
        this.batch = entries;
        this.step = 'batch';
        this.pollBatch();
        this.changeDetector.markForCheck();
    }

    /** Rilegge le impaginazioni in coda o in corso finché non terminano tutte. */
    private pollBatch(): void {
        clearTimeout(this.pollTimer);
        if (!this.batch.some((entry) => this.batchStatus(entry).active)) return;
        this.pollTimer = setTimeout(async () => {
            const { trackId } = this.data;
            this.batch = await Promise.all(
                this.batch.map(async (entry) =>
                    this.batchStatus(entry).active ? { ...entry, job: (await firstValueFrom(this.playbackService.engraving(trackId, entry.part.scoreId, entry.part.versionId)).catch(() => entry.job)) ?? entry.job } : entry
                )
            );
            if (this.destroyed) return;
            this.changeDetector.markForCheck();
            this.pollBatch();
        }, ENGRAVING_POLL_MS);
    }

    /** Mostra il passo che corrisponde allo stato dell'impaginazione. */
    private show(job: EngravingJob | null): void {
        this.job = job;
        clearTimeout(this.pollTimer);
        if (job && (job.status === 'QUEUED' || job.status === 'RUNNING')) {
            this.step = 'running';
            this.pollTimer = setTimeout(() => void this.refresh(), ENGRAVING_POLL_MS);
        } else if (job?.status === 'DONE' && job.pages.length) {
            this.step = 'done';
            this.loadThumbnails(job.pages);
        } else {
            this.failure = job?.status === 'FAILED' ? engravingErrorLabel(job.errorCode) : null;
            this.step = 'options';
            this.schedulePreview(0);
        }
        this.changeDetector.markForCheck();
    }

    /** Rilegge l'ultima impaginazione della versione; senza risposta riprova più tardi. */
    private async refresh(): Promise<void> {
        const { trackId, scoreId, versionId } = this.data;
        try {
            const job = await firstValueFrom(this.playbackService.engraving(trackId, scoreId, versionId));
            if (!this.destroyed) this.show(job);
        } catch {
            if (!this.destroyed && this.step === 'running') this.pollTimer = setTimeout(() => void this.refresh(), ENGRAVING_POLL_MS);
        }
    }

    private schedulePreview(delay = PREVIEW_DELAY_MS): void {
        clearTimeout(this.previewTimer);
        if (!this.musicXml) return;
        this.previewTimer = setTimeout(() => void this.renderPreview(), delay);
    }

    private async renderPreview(): Promise<void> {
        if (!this.musicXml || this.problem) return;
        const sequence = ++this.previewSequence;
        this.previewLoading = true;
        this.changeDetector.markForCheck();
        try {
            const preview = await this.renderer.engrave(this.musicXml, this.options);
            if (sequence !== this.previewSequence || this.destroyed) return;
            this.previewError = null;
            this.previewPages = preview.pages.length;
            this.tooManyPages = preview.tooManyPages;
            this.previewHtml = preview.pages.map((page, index) => `<div class="engrave-page" role="img" aria-label="Pagina ${index + 1}">${responsivePage(page)}</div>`).join('');
        } catch {
            if (sequence !== this.previewSequence || this.destroyed) return;
            this.previewError = 'Anteprima non disponibile: Verovio non riesce a disegnare la versione con queste opzioni.';
            this.previewPages = 0;
            this.tooManyPages = false;
            this.previewHtml = '';
        } finally {
            if (sequence === this.previewSequence && !this.destroyed) {
                this.previewLoading = false;
                if (this.host) this.host.innerHTML = this.previewHtml;
                this.changeDetector.markForCheck();
            }
        }
    }

    /** Miniature delle pagine generate, lette con l'autorizzazione dell'utente. */
    private loadThumbnails(pages: number[]): void {
        this.revokeThumbnails();
        this.thumbnails = pages.map(() => '');
        pages.forEach((id, index) => {
            firstValueFrom(this.mediaService.streamImage(id))
                .then((blob) => {
                    if (this.destroyed) return;
                    this.thumbnails = this.thumbnails.map((url, position) => (position === index ? URL.createObjectURL(blob) : url));
                    this.changeDetector.markForCheck();
                })
                .catch(() => undefined);
        });
    }

    private revokeThumbnails(): void {
        for (const url of this.thumbnails) if (url) URL.revokeObjectURL(url);
        this.thumbnails = [];
    }
}
