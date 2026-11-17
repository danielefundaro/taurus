import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { DialogService } from 'primeng/dynamicdialog';
import { FileUpload } from 'primeng/fileupload';
import { delay, finalize, first, firstValueFrom } from 'rxjs';
import { TypeHandlerComponent } from '../../../components/type-handler/type-handler.component';
import { InstrumentSuggestionsPanelComponent } from './instrument-suggestions-panel/instrument-suggestions-panel.component';
import { ScoreWorkspaceComponent } from './score-workspace/score-workspace.component';
import { compareScores, DraftComparison, mergeServerScores } from './score-workspace/score-workspace.operations';
import { ScoreArrangementPanelComponent } from './score-arrangement-panel/score-arrangement-panel.component';
import { ScorePlaybackPanelComponent } from './score-playback-panel/score-playback-panel.component';
import { isPhoneViewport, RoleEnums, StateEnums, StateLabel, StateLabelsMap } from '../../../constants';
import { PdfManipulatorDialogComponent } from '../../../dialogs/pdf-manipulator-dialog/pdf-manipulator-dialog.component';
import { ImageEditorDialogComponent } from '../../../dialogs/image-editor-dialog/image-editor-dialog.component';
import { openEngraveDialog } from '../../../dialogs/engrave-dialog/engrave-dialog.component';
import { ImportsModule } from '../../../imports';
import { DetailPageBase } from '../../_shared/detail-page.base';
import { ChildrenEntities, Instruments, InstrumentsCriteria, SheetsMusic, TrackPageEditResult, TrackUploadJob, TrackUploadJobStatus, Tracks } from '../../../module';
import { PdfAnnotations } from '../../../module/pdf-annotations.module';
import { ConfirmService, InstrumentsService, KeycloakService, PrinterService, TenantFeatureService, ToastService, TracksService, UxTelemetryEvent, UxTelemetryService, withErrorSummary, withHandledErrors } from '../../../service';

@Component({
    selector: 'app-track-detail',
    imports: [ImportsModule, TypeHandlerComponent, ScoreWorkspaceComponent, ScorePlaybackPanelComponent, ScoreArrangementPanelComponent, InstrumentSuggestionsPanelComponent],
    templateUrl: './detail.component.html',
    styleUrl: './detail.component.scss',
    providers: [TracksService, InstrumentsService, KeycloakService, DialogService],
    changeDetection: ChangeDetectionStrategy.Eager
})
export class DetailComponent extends DetailPageBase implements OnInit, OnDestroy {
    @ViewChild('fu') private fileUpload?: FileUpload;

    protected track: Tracks = new Tracks();
    protected autoFilteredStatesLabels: StateLabel[];
    protected RolesEnum: typeof RoleEnums = RoleEnums;
    protected readonly StateEnum: typeof StateEnums = StateEnums;
    protected readonly previewTooltip = "Aggiungi almeno una parte per abilitare l'anteprima";
    /** Telefono: le parti scritte si consultano, senza impaginarle dal Workspace Parti. */
    protected readonly phone = isPhoneViewport();
    protected selectedFile: File | null = null;
    protected annotations: PdfAnnotations | null = null;
    protected uploading = false;
    protected uploadJobs: TrackUploadJob[] = [];
    protected activeTab = 'details';
    protected saveError = false;
    /** Modifiche appena salvate: alimenta il tag «Tutte le modifiche salvate». */
    protected savedIndicator = false;
    /** Un job PDF ha prodotto parti che la bozza non ha ancora: alimenta il banner. */
    protected newPartsAvailable = false;
    /** Scostamento fra bozza e server, letto dopo un 409. */
    protected conflict?: DraftComparison;
    /** Parti come stanno sul server: riferimento del confronto e della bozza del workspace. */
    protected baselineScores: SheetsMusic[] = [];
    /** Parti con strumenti da aggiungere ancora aperti: alimenta l'etichetta nel workspace. */
    protected suggestionPartIds: number[] = [];
    private detailsDirty = false;
    private scoresDirty = false;

    protected get visibleUploadJobs(): TrackUploadJob[] {
        return this.uploadJobs.slice(0, 5);
    }

    protected instruments: Instruments[];

    constructor(
        private readonly tracksService: TracksService,
        private readonly instrumentsService: InstrumentsService,
        private readonly printerService: PrinterService,
        private readonly keycloakService: KeycloakService,
        private readonly toastService: ToastService,
        private readonly routeService: ActivatedRoute,
        private readonly router: Router,
        private readonly confirmService: ConfirmService,
        private readonly dialogService: DialogService,
        private readonly tenantFeatureService: TenantFeatureService,
        private readonly telemetry: UxTelemetryService
    ) {
        super();
        this.instruments = [];
        this.autoFilteredStatesLabels = StateLabelsMap;
    }

    ngOnInit() {
        this.watchBrowserExit();
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        const requestedTab = this.routeService.snapshot?.queryParamMap?.get('tab');
        this.openRequestedTab(requestedTab);
        // Aperta da un collegamento, per esempio di una notifica, la pagina può precedere le funzioni del tenant.
        if (requestedTab && this.activeTab !== requestedTab && !this.tenantFeatureService.loaded()) {
            this.tenantFeatureService
                .refresh()
                .pipe(first())
                .subscribe({ next: () => this.openRequestedTab(requestedTab), error: () => undefined });
        }
        this.routeService.params.pipe(first()).subscribe((params) => {
            const trackId = params['id'];
            this.loadElement(trackId);
            if (this.canManagePdf) this.loadUploadJobs(trackId);
        });

        this.loadInstruments();
    }

    ngOnDestroy(): void {
        this.releaseBrowserExit();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.telemetry?.flush();
    }

    /**
     * Rilettura dei job quando la scheda del browser torna visibile.
     *
     * Non è polling: una sola richiesta per ritorno, e solo se un job era ancora in lavorazione.
     * È il modo scelto per accorgersi delle parti nuove senza interrogare il server a intervalli,
     * che la specifica dell'elaborazione asincrona esclude.
     */
    private readonly onVisibilityChange = (): void => {
        if (document.visibilityState !== 'visible' || !this.canManagePdf || this.track.id === undefined) return;
        const pending = new Set(this.uploadJobs.filter((job) => this.isPendingUpload(job)).map((job) => job.id));
        if (!pending.size) return;
        this.tracksService
            .getUploadJobs(this.track.id)
            .pipe(first())
            .subscribe((jobs) => {
                this.uploadJobs = jobs;
                if (jobs.some((job) => pending.has(job.id) && job.status === 'DONE')) this.newPartsAvailable = true;
            });
    };

    protected get isUser(): boolean {
        return this.keycloakService.isUser || this.keycloakService.isUserExternal;
    }

    protected get scorePlaybackEnabled(): boolean {
        return this.tenantFeatureService.scorePlaybackEnabled();
    }

    private openRequestedTab(tab: string | null | undefined): void {
        const availableTabs = ['details', 'parts', ...(this.scorePlaybackEnabled ? ['playback'] : []), ...(this.canEngrave ? ['arrangement'] : []), ...(this.canManagePdf ? ['pdf'] : [])];
        if (tab && availableTabs.includes(tab)) this.activeTab = tab;
    }

    /** Le impostazioni di ascolto aggiornano la versione della traccia: il salvataggio successivo deve usarla. */
    protected onTrackVersionChange(version: number): void {
        this.track = { ...this.track, version };
    }

    /** Scheda Partitura e impaginazione delle parti scritte: per chi gestisce la traccia, con ascolto e scrittura attivi. */
    protected get canEngrave(): boolean {
        return this.canManagePdf && this.scorePlaybackEnabled && this.tenantFeatureService.scoreWritingEnabled();
    }

    /** Impaginazione dal Workspace Parti: non sul telefono, come le altre azioni di scrittura. */
    protected get canEngraveParts(): boolean {
        return this.canEngrave && !this.phone;
    }

    /** Impagina la versione ascoltata di una parte senza pagine; senza servizio musicale l'errore lo spiega. */
    protected engravePart({ score, label }: { score: SheetsMusic; label: string }): void {
        if (this.track.id === undefined || score.id === undefined || !score.currentScoreVersionId || this.isDirty) return;
        openEngraveDialog(this.dialogService, {
            trackId: this.track.id,
            scoreId: score.id,
            versionId: score.currentScoreVersionId,
            partLabel: label,
            header: { title: this.track.name ?? '', composer: this.track.composer ?? '', arranger: this.track.arranger ?? '', partName: label },
            hasPages: !!score.media?.length,
            trackVersion: this.track.version ?? null
        })
            .pipe(first())
            .subscribe((result) => {
                if (!result) return;
                this.onTrackVersionChange(result.trackVersion);
                this.reloadTrack();
            });
    }

    protected get canManagePdf(): boolean {
        return [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST].includes(this.keycloakService.currentUserRole);
    }

    protected confirmDelete(): void {
        this.confirmService.confirmDestructive({
            title: 'Elimina traccia',
            consequence: `La traccia “${this.track.name || 'Senza nome'}” non sarà più visibile né disponibile negli elenchi.`,
            actionLabel: 'Elimina definitivamente',
            accept: () => {
                this.tracksService
                    .delete(this.track.id)
                    .pipe(first())
                    .subscribe({
                        next: () => {
                            this.clearDirtyUnits();
                            this.toastService.success('Traccia eliminata', 'La traccia non è più visibile.');
                            this.router.navigate(['/tracks']);
                        }
                    });
            }
        });
    }

    protected save(): void {
        this.normalizeTrackScores();
        this.saving = true;
        this.saveError = false;
        this.conflict = undefined;
        this.tracksService
            // Il 409 di concorrenza lo mostra questa pagina, con il confronto: nessun toast generico.
            .update(this.track.id, this.track, withHandledErrors(['version.conflict'], withErrorSummary('Salvataggio non riuscito')))
            .pipe(
                delay(1000),
                first(),
                finalize(() => (this.saving = false))
            )
            .subscribe({
                next: (track: Tracks) => {
                    this.detailsDirty = false;
                    this.scoresDirty = false;
                    this.clearDirtyUnits();
                    this.savedIndicator = true;
                    this.newPartsAvailable = false;
                    this.baselineScores = structuredClone(track.scores ?? []);
                    this.telemetry?.record('save');
                    this.telemetry?.flush();
                    this.toastService.success('Traccia aggiornata', 'Le modifiche sono state salvate.');
                    this.track = track;
                },
                error: (error: HttpErrorResponse) => {
                    this.saveError = true;
                    this.telemetry?.record('save-error');
                    if (DetailComponent.isVersionConflict(error)) this.loadConflict();
                }
            });
    }

    protected onTabChange(tab: string | number | undefined): void {
        if (typeof tab !== 'string') return;
        this.activeTab = tab;
        if (tab === 'parts') this.telemetry?.start('track-parts-workspace');
        this.router.navigate([], { relativeTo: this.routeService, queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
    }

    protected onScoresChange(scores: SheetsMusic[]): void {
        this.track.scores = scores;
        this.saveError = false;
    }

    protected onScoresDirtyChange(dirty: boolean): void {
        this.scoresDirty = dirty;
        if (dirty) this.savedIndicator = false;
        this.syncFormDirty();
    }

    protected onUxEvent(event: UxTelemetryEvent): void {
        this.telemetry?.record(event);
    }

    /** La zona Aggiungi del workspace: le pagine nuove nascono da un PDF. */
    protected openPdfTab(): void {
        this.onTabChange('pdf');
    }

    /**
     * «Ricarica e continua»: le parti create dal worker si aggiungono alla bozza, che resta da
     * salvare. Con `saveAfter` è «Salva prima»: stesso riallineamento e salvataggio immediato,
     * perché salvare senza riallinearsi riceverebbe di nuovo un 409.
     */
    protected reloadAndContinue(saveAfter = false): void {
        if (this.track.id === undefined) return;
        this.tracksService
            .getById(this.track.id)
            .pipe(first())
            .subscribe((server) => {
                const merged = mergeServerScores(this.track.scores ?? [], server.scores ?? []);
                const added = merged.length - (this.track.scores?.length ?? 0);
                this.baselineScores = structuredClone(server.scores ?? []);
                this.track = { ...this.track, version: server.version, scores: merged };
                this.newPartsAvailable = false;
                this.conflict = undefined;
                this.saveError = false;
                this.telemetry?.record('reload');
                this.focusPartsTab();
                this.toastService.success(
                    'Bozza riallineata',
                    added ? `${added} ${added === 1 ? 'nuova parte aggiunta' : 'nuove parti aggiunte'} alla bozza: salva per confermare.` : 'La bozza usa la versione corrente della traccia.'
                );
                if (saveAfter) this.save();
            });
    }

    /** Il testo del banner di conflitto: dice che cosa è cambiato, non solo che è cambiato. */
    protected get conflictDetail(): string {
        const comparison = this.conflict;
        if (!comparison) return 'La bozza è rimasta in memoria. Puoi continuare a lavorare oppure riprovare il salvataggio.';
        const differences = [
            DetailComponent.count(comparison.serverAdded.length, 'parte nuova sul server', 'parti nuove sul server'),
            DetailComponent.count(comparison.draftChanged, 'parte modificata nella bozza', 'parti modificate nella bozza'),
            DetailComponent.count(comparison.draftAdded, 'parte creata nella bozza', 'parti create nella bozza'),
            DetailComponent.count(comparison.draftRemoved, 'parte rimossa dalla bozza', 'parti rimosse dalla bozza'),
            comparison.draftReordered ? 'ordine delle parti diverso' : undefined
        ].filter((difference) => difference !== undefined);
        if (!differences.length) return "La traccia è stata salvata da un'altra richiesta: le parti sono le stesse. Ricarica e riprova il salvataggio.";
        return `La traccia è cambiata sul server: ${differences.join(', ')}. «Ricarica e continua» tiene le modifiche della bozza e aggiunge le parti nuove.`;
    }

    private loadConflict(): void {
        if (this.track.id === undefined) return;
        this.tracksService
            .getById(this.track.id)
            .pipe(first())
            .subscribe((server) => {
                this.conflict = compareScores(this.track.scores ?? [], server.scores ?? [], this.baselineScores);
                this.newPartsAvailable = this.conflict.serverAdded.length > 0;
                this.telemetry?.record('conflict');
            });
    }

    /** Dopo un'azione di organizzazione la scheda Parti si seleziona da sé: l'esito si vede lì. */
    private focusPartsTab(): void {
        if (this.activeTab !== 'parts') this.onTabChange('parts');
    }

    private static count(value: number, singular: string, plural: string): string | undefined {
        return value ? `${value} ${value === 1 ? singular : plural}` : undefined;
    }

    /** Il 409 di concorrenza della traccia, l'unico che questa pagina gestisce da sé. */
    private static isVersionConflict(error: HttpErrorResponse): boolean {
        const message = (error?.error as { message?: string } | undefined)?.message;
        return error?.status === 409 && (message === undefined || message.endsWith('version.conflict'));
    }

    protected openImageEditor(event: { scoreId: number; media: ChildrenEntities; pageNumber: number; scoreTitle: string }): void {
        if (this.isDirty || this.track.id === undefined || this.track.version === undefined) return;
        const ref = this.dialogService.open(ImageEditorDialogComponent, {
            header: 'Modifica immagine',
            width: '95vw',
            height: '95vh',
            closable: false,
            focusOnShow: false,
            data: {
                trackId: this.track.id,
                trackVersion: this.track.version,
                scoreId: event.scoreId,
                media: event.media,
                pageNumber: event.pageNumber,
                scoreTitle: event.scoreTitle
            },
            contentStyle: { overflow: 'hidden', padding: '0', height: 'calc(95vh - 54px)' }
        });
        ref?.onClose.pipe(first()).subscribe((result: TrackPageEditResult | undefined) => {
            if (!result) return;
            this.applyImageEditResult(result);
        });
    }

    private applyImageEditResult(result: TrackPageEditResult): void {
        const scores = (this.track.scores ?? []).map((score) => {
            if (score.id !== result.scoreId) return score;
            const media = [...(score.media ?? [])];
            const replacedIndex = media.findIndex((item) => item.index === result.replacedMediaId);
            if (replacedIndex >= 0) media.splice(replacedIndex, 1, ...result.media);
            return { ...score, media };
        });
        this.track = { ...this.track, version: result.trackVersion, scores };
        this.baselineScores = structuredClone(scores);
        this.toastService.success(
            result.media.length > 1 ? 'Immagini create' : 'Immagine aggiornata',
            result.media.length > 1 ? `La pagina è stata sostituita con ${result.media.length} nuove immagini.` : 'La nuova versione della pagina è già stata salvata.'
        );
    }

    protected preview(): void {
        this.printerService.preview(this.track);
    }

    protected filterStates(event: AutoCompleteCompleteEvent) {
        this.autoFilteredStatesLabels = StateLabelsMap.filter((state) => (state.name.toLowerCase().includes(event.query.toLowerCase()) ? state : null)).filter((state) => state !== null) as StateLabel[];
    }

    protected trackStream(): string {
        return this.tracksService.stream(this.track.id);
    }

    protected httpHeaders(): HttpHeaders {
        return new HttpHeaders({ Authorization: `Bearer ${this.keycloakService.token}` });
    }

    protected onTypeChange(types: string[]): void {
        this.track!.type = types;
        this.markDetailsDirty();
    }

    protected markDetailsDirty(): void {
        this.detailsDirty = true;
        this.syncFormDirty();
    }

    protected onFileSelect(event: any): void {
        this.selectedFile = event.currentFiles?.[0] ?? event.files?.[0] ?? null;
        this.annotations = null;
    }

    protected onFileClear(): void {
        this.selectedFile = null;
        this.annotations = null;
    }

    protected openManipulator(): void {
        if (!this.selectedFile) return;
        const ref = this.dialogService.open(PdfManipulatorDialogComponent, {
            header: 'Manipolazione PDF',
            width: '90vw',
            height: '90vh',
            focusTrap: false,
            focusOnShow: false,
            data: { file: this.selectedFile, annotations: this.annotations },
            contentStyle: {
                overflow: 'hidden',
                padding: '0',
                display: 'flex',
                flexDirection: 'column',
                height: 'calc(90vh - 54px)'
            }
        });
        ref?.onClose.pipe(first()).subscribe((result: PdfAnnotations | null | undefined) => {
            if (result !== null && result !== undefined) {
                this.annotations = result;
            }
        });
    }

    protected handleUpload(event: any): void {
        const file: File = event.files?.[0] ?? this.selectedFile;
        if (!file) return;

        this.uploading = true;
        const formData = new FormData();
        formData.append('file', file);
        if (this.hasAnnotations) {
            formData.append('annotations', JSON.stringify(this.annotations));
        }

        this.tracksService.uploadPdf(formData, this.track.id, withErrorSummary('Caricamento non riuscito')).subscribe({
            next: (job) => {
                this.uploading = false;
                this.selectedFile = null;
                this.annotations = null;
                this.fileUpload?.clear();
                this.uploadJobs = [job, ...this.uploadJobs.filter((value) => value.id !== job.id)];
                this.toastService.success('PDF ricevuto', 'Il file è stato aggiunto alla coda di elaborazione.');
            },
            error: () => (this.uploading = false)
        });
    }

    protected uploadStatusLabel(status: TrackUploadJobStatus): string {
        return {
            TO_PROCESS: 'In coda',
            IN_PROGRESS: 'Elaborazione in corso',
            DONE: 'Completato',
            ERROR: 'Elaborazione non riuscita',
            NOT_FOUND: 'File sorgente non disponibile'
        }[status];
    }

    protected isPendingUpload(job: TrackUploadJob): boolean {
        return job.status === 'TO_PROCESS' || job.status === 'IN_PROGRESS';
    }

    protected retryUpload(job: TrackUploadJob): void {
        this.tracksService
            .retryUploadJob(this.track.id, job.id)
            .pipe(first())
            .subscribe((queued) => {
                this.uploadJobs = this.uploadJobs.map((value) => (value.id === queued.id ? queued : value));
                this.toastService.success('Elaborazione riavviata', 'Il PDF è stato rimesso in coda.');
            });
    }

    protected get hasAnnotations(): boolean {
        return !!(this.annotations && (this.annotations.excludedPages.length > 0 || this.annotations.cropRegions.length > 0 || this.annotations.pageTransforms.length > 0));
    }

    private loadElement(id: number | string) {
        this.loading = true;
        this.tracksService
            .getById(Number(id))
            .pipe(
                first(),
                finalize(() => (this.loading = false))
            )
            .subscribe((track) => {
                this.track = track;
                this.baselineScores = structuredClone(track.scores ?? []);
                this.detailsDirty = false;
                this.scoresDirty = false;
                this.clearDirtyUnits();
                this.saveError = false;
                this.savedIndicator = false;
                this.newPartsAvailable = false;
                this.conflict = undefined;
            });
    }

    private normalizeTrackScores(): void {
        (this.track.scores ?? []).forEach((score, scoreIndex) => {
            score.order = scoreIndex + 1;
            (score.media ?? []).forEach((media, mediaIndex) => (media.order = mediaIndex + 1));
            (score.instruments ?? []).forEach((instrument, instrumentIndex) => (instrument.order = instrumentIndex + 1));
        });
    }

    private syncFormDirty(): void {
        this.isDirty = this.detailsDirty || this.scoresDirty;
    }

    /** Tutti gli strumenti del tenant, pagina dopo pagina: servono alla scelta nel workspace e nel pannello. */
    private loadInstruments(): void {
        let page = 0;
        const instrumentsCriteria: InstrumentsCriteria = { page: page, sort: ['name,asc'] };

        this.instrumentsService
            .getAll(instrumentsCriteria)
            .pipe(first())
            .subscribe(async (result) => {
                let totalElements = result.totalElements;
                const instruments = result.content;

                while (totalElements > instruments.length) {
                    instrumentsCriteria.page = ++page;

                    const data = await firstValueFrom(this.instrumentsService.getAll(instrumentsCriteria));
                    instruments.push(...data.content);
                    totalElements = data.totalElements;
                }
                this.instruments = instruments;
            });
    }

    /** Le scelte del pannello sono già salvate: la traccia torna quella del server, con gli strumenti nuovi. */
    protected onInstrumentSuggestionsApplied(track: Tracks): void {
        this.track = track;
        this.baselineScores = structuredClone(track.scores ?? []);
        this.detailsDirty = false;
        this.scoresDirty = false;
        this.clearDirtyUnits();
        this.savedIndicator = false;
        this.loadInstruments();
    }

    /** Il pannello ha trovato la traccia cambiata: senza modifiche in sospeso si rilegge dal server. */
    protected reloadTrack(): void {
        if (this.track.id !== undefined && !this.isDirty) this.loadElement(this.track.id);
    }

    /** Il riepilogo dell'abbinamento delle parti con gli strumenti; vuoto per i job elaborati prima del riepilogo. */
    protected uploadSummary(job: TrackUploadJob): string | undefined {
        if (job.status !== 'DONE' || job.partsWithInstruments == null || job.partsWithSuggestions == null || job.partsWithoutInstruments == null) return undefined;
        return [
            `${job.partsWithInstruments} ${job.partsWithInstruments === 1 ? 'parte' : 'parti'} con strumenti assegnati`,
            `${job.partsWithSuggestions} con strumenti da aggiungere`,
            `${job.partsWithoutInstruments} senza strumenti`
        ].join(' · ');
    }

    private loadUploadJobs(trackId: number): void {
        this.tracksService
            .getUploadJobs(trackId)
            .pipe(first())
            .subscribe((jobs) => (this.uploadJobs = jobs));
    }
}
