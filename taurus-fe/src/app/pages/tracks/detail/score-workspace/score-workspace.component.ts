import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, QueryList, SimpleChanges, ViewChild, ViewChildren } from '@angular/core';
import { AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { ImportsModule } from '../../../../imports';
import { ChildrenEntities, Instruments, SheetsMusic } from '../../../../module';
import { unengravedPart } from '../../../../score-editor/score-engraving';
import { ConfirmService, UxTelemetryEvent } from '../../../../service';
import { MediaThumbnailComponent } from '../media-thumbnail/media-thumbnail.component';
import { cloneAndNormalizeScores, mergeScores, moveMedia, reorderMedia, reorderScore, splitScoreAfter, splitScoreByPage } from './score-workspace.operations';

interface ScoreListItem {
    score: SheetsMusic;
    index: number;
}

@Component({
    selector: 'app-score-workspace',
    standalone: true,
    imports: [ImportsModule, MediaThumbnailComponent],
    templateUrl: './score-workspace.component.html',
    styleUrl: './score-workspace.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScoreWorkspaceComponent implements OnChanges {
    @Input() scores: SheetsMusic[] = [];
    /**
     * Parti come stanno sul server. Coincidono con `scores` tranne dopo una fusione con le parti
     * arrivate da un PDF: lì la bozza vale già più del server e deve restare da salvare.
     */
    @Input() baseline?: SheetsMusic[];
    @Input() instruments: Instruments[] = [];
    @Input() readOnly = false;
    @Input() saving = false;
    @Input() trackDirty = false;
    /** Parti con strumenti da aggiungere ancora aperti, dal pannello Strumenti da aggiungere. */
    @Input() suggestionPartIds: readonly number[] = [];
    @Output() scoresChange = new EventEmitter<SheetsMusic[]>();
    @Output() dirtyChange = new EventEmitter<boolean>();
    @Output() imageEdit = new EventEmitter<{ scoreId: number; media: ChildrenEntities; pageNumber: number; scoreTitle: string }>();
    /** Eventi d'uso, senza contenuti: li aggrega la pagina che ospita il workspace. */
    @Output() uxEvent = new EventEmitter<UxTelemetryEvent>();
    /** La zona Aggiungi chiede le pagine dove nascono: il caricamento di un PDF. */
    @Output() pdfRequested = new EventEmitter<void>();
    /** Impaginazione delle parti scritte, per chi gestisce la traccia con la scrittura attiva. */
    @Input() canEngrave = false;
    /** Impagina la versione ascoltata di una parte senza pagine. */
    @Output() engraveRequested = new EventEmitter<{ score: SheetsMusic; label: string }>();
    @ViewChildren('pageCard') private pageCards?: QueryList<ElementRef<HTMLElement>>;
    @ViewChildren('partRow') private partRows?: QueryList<ElementRef<HTMLElement>>;
    @ViewChild('workspaceGrid') private workspaceGrid?: ElementRef<HTMLElement>;

    /** Oltre questa soglia l'elenco delle parti passa allo scroller virtuale. */
    protected static readonly virtualizationThreshold = 60;
    protected static readonly partRowSize = 88;

    protected draftScores: SheetsMusic[] = [];
    protected selectedScoreIndex = 0;
    protected selectedMediaIds = new Set<number>();
    protected selectedPartKeys = new Set<string>();
    protected filterQuery = '';
    protected filteredInstrumentOptions: ChildrenEntities[] = [];
    protected moveTargetIndex: number | null = null;
    protected selectingParts = false;
    protected mobileDetail = false;
    protected liveMessage = '';
    protected activePageIndex = 0;
    /** Posizione in cui le pagine trascinate verrebbero inserite; alimenta l'indicatore. */
    protected pageDropIndex?: number;
    /** Parte dell'elenco sopra cui si sta trascinando: riceve le pagine al rilascio. */
    protected partDropIndex?: number;
    /** Larghezza del pannello sinistro in percento; resta nella sessione, non viene persistita. */
    protected partsRatio = 34;
    protected ratioChanged = false;

    private undoStack: SheetsMusic[][] = [];
    private baselineScores: SheetsMusic[] = [];
    private lastEmitted?: SheetsMusic[];
    private inlineEditActive = false;
    private draggedScoreIndex?: number;
    private draggedPage?: { scoreIndex: number; pageIndex: number; mediaId: number };
    private partAnchorIndex?: number;
    private pageAnchorIndex?: number;
    private resizing = false;
    private searching = false;

    constructor(private readonly confirmService: ConfirmService) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['scores'] && this.scores !== this.lastEmitted) {
            this.draftScores = cloneAndNormalizeScores(this.scores);
            this.baselineScores = cloneAndNormalizeScores(this.baseline ?? this.scores);
            this.undoStack = [];
            this.selectedScoreIndex = Math.min(this.selectedScoreIndex, Math.max(0, this.draftScores.length - 1));
            this.activePageIndex = 0;
            this.clearSelections();
            this.dirtyChange.emit(JSON.stringify(this.draftScores) !== JSON.stringify(this.baselineScores));
        }
    }

    protected get selectedScore(): SheetsMusic | undefined {
        return this.draftScores[this.selectedScoreIndex];
    }

    protected get filteredScores(): ScoreListItem[] {
        const query = this.filterQuery.trim().toLocaleLowerCase('it');
        return this.draftScores
            .map((score, index) => ({ score, index }))
            .filter(({ score }) => {
                if (!query) return true;
                return [score.description, ...(score.instruments ?? []).map((instrument) => instrument.name)].some((value) => value?.toLocaleLowerCase('it').includes(query));
            });
    }

    /**
     * L'elenco passa allo scroller virtuale solo oltre la soglia: sotto, il DOM completo tiene
     * trascinamento, riordino e scorrimento del pannello senza altezze fissate.
     */
    protected get virtualizedParts(): boolean {
        return this.filteredScores.length > ScoreWorkspaceComponent.virtualizationThreshold;
    }

    protected get partRowSize(): number {
        return ScoreWorkspaceComponent.partRowSize;
    }

    /** Colonne della griglia: imposte solo dopo che l'utente ha spostato il divisore. */
    protected get gridColumns(): string | null {
        return this.ratioChanged ? `minmax(0, ${this.partsRatio}%) auto minmax(0, 1fr)` : null;
    }

    protected get canUndo(): boolean {
        return this.undoStack.length > 0 && !this.saving;
    }

    protected get selectedPageIndex(): number {
        if (this.selectedMediaIds.size !== 1 || !this.selectedScore) return -1;
        return this.selectedScore.media?.findIndex((media) => this.selectedMediaIds.has(media.index)) ?? -1;
    }

    protected get selectedMedia(): ChildrenEntities | undefined {
        const index = this.selectedPageIndex;
        return index < 0 ? undefined : this.selectedScore?.media?.[index];
    }

    protected get moveTargets(): { label: string; value: number }[] {
        return this.draftScores.map((score, index) => ({ label: `${index + 1}. ${this.scoreTitle(score)}`, value: index })).filter((option) => option.value !== this.selectedScoreIndex);
    }

    protected get allFilteredPartsSelected(): boolean {
        return this.filteredScores.length > 0 && this.filteredScores.every(({ score }) => this.selectedPartKeys.has(this.scoreKey(score)));
    }

    protected get selectedReviewCount(): number {
        return this.draftScores.filter((score) => this.selectedPartKeys.has(this.scoreKey(score)) && score.needsReview).length;
    }

    protected get allPagesSelected(): boolean {
        const media = this.selectedScore?.media ?? [];
        return media.length > 0 && media.every((item) => this.selectedMediaIds.has(item.index));
    }

    protected scoreKey = (score: SheetsMusic): string => {
        if (score.id !== undefined) return `id:${score.id}`;
        return `draft:${score.order ?? this.draftScores.indexOf(score)}`;
    };

    protected scoreTitle(score: SheetsMusic): string {
        return score.description?.trim() || score.instruments?.[0]?.name || 'Parte senza nome';
    }

    /** Parte salvata con una versione MusicXML e senza pagine: non compare in anteprima né in stampa finché non si impagina. */
    protected toEngrave(score: SheetsMusic): boolean {
        return unengravedPart(score);
    }

    protected requestEngraving(score: SheetsMusic): void {
        if (!this.canEngrave || this.trackDirty || !this.toEngrave(score)) return;
        this.engraveRequested.emit({ score, label: this.scoreTitle(score) });
    }

    protected pageLabel(score: SheetsMusic, pageIndex: number, media: ChildrenEntities): string {
        return `${this.scoreTitle(score)}, pagina ${pageIndex + 1}${media.name ? `, ${media.name}` : ''}`;
    }

    protected selectScore(index: number, openDetail = true): void {
        this.selectedScoreIndex = index;
        this.activePageIndex = 0;
        this.selectedMediaIds = new Set<number>();
        this.moveTargetIndex = null;
        this.pageAnchorIndex = undefined;
        // Navigando con le frecce il dettaglio non si apre: su mobile si resta nell'elenco.
        if (openDetail) this.mobileDetail = true;
    }

    protected onFilterChange(query: string): void {
        this.filterQuery = query;
        const active = !!query.trim();
        // Un solo evento per ricerca: conta che la ricerca sia stata usata, non quante lettere.
        if (active && !this.searching) this.uxEvent.emit('search');
        this.searching = active;
    }

    protected clearSearch(): void {
        this.onFilterChange('');
    }

    protected addScore(): void {
        const next = cloneAndNormalizeScores([...this.draftScores, { description: '', media: [], instruments: [], needsReview: false }]);
        this.commit(next, 'Nuova parte creata', next.length - 1);
        this.mobileDetail = true;
    }

    protected beginInlineEdit(): void {
        if (this.inlineEditActive) return;
        this.undoStack.push(cloneAndNormalizeScores(this.draftScores));
        this.inlineEditActive = true;
    }

    protected endInlineEdit(): void {
        this.inlineEditActive = false;
    }

    protected updateInline(message: string): void {
        this.draftScores = cloneAndNormalizeScores(this.draftScores);
        this.emitDraft(message);
    }

    protected onDescriptionChange(description: string): void {
        if (!this.selectedScore) return;
        this.selectedScore.description = description;
        this.updateInline('Descrizione della parte modificata');
    }

    protected onInstrumentsChange(instruments: ChildrenEntities[]): void {
        if (!this.selectedScore) return;
        this.selectedScore.instruments = instruments ?? [];
        this.updateInline('Strumenti della parte modificati');
    }

    protected markReviewed(): void {
        if (this.readOnly || !this.selectedScore?.needsReview) return;
        const next = cloneAndNormalizeScores(this.draftScores);
        next[this.selectedScoreIndex].needsReview = false;
        this.commit(next, 'Parte segnata come verificata');
    }

    protected filterInstruments(event: AutoCompleteCompleteEvent): void {
        const query = event.query.toLocaleLowerCase('it');
        const selected = new Set((this.selectedScore?.instruments ?? []).map((instrument) => instrument.index));
        this.filteredInstrumentOptions = this.instruments
            .filter((instrument) => !selected.has(instrument.id) && (!query || instrument.name?.toLocaleLowerCase('it').includes(query)))
            .map((instrument) => ({ index: instrument.id, name: instrument.name }));
    }

    protected toggleMedia(mediaId: number): void {
        const selected = new Set(this.selectedMediaIds);
        selected.has(mediaId) ? selected.delete(mediaId) : selected.add(mediaId);
        this.selectedMediaIds = selected;
    }

    protected togglePart(score: SheetsMusic): void {
        const selected = new Set(this.selectedPartKeys);
        const key = this.scoreKey(score);
        selected.has(key) ? selected.delete(key) : selected.add(key);
        this.selectedPartKeys = selected;
    }

    protected toggleAllParts(selected: boolean): void {
        if (!selected) {
            this.selectedPartKeys = new Set<string>();
            return;
        }
        const next = new Set(this.selectedPartKeys);
        this.filteredScores.forEach(({ score }) => next.add(this.scoreKey(score)));
        this.selectedPartKeys = next;
    }

    protected toggleAllPages(selected: boolean): void {
        this.selectedMediaIds = selected ? new Set((this.selectedScore?.media ?? []).map((media) => media.index)) : new Set<number>();
        if (!selected) this.moveTargetIndex = null;
    }

    protected togglePartSelectionMode(): void {
        this.selectingParts = !this.selectingParts;
        this.selectedPartKeys = new Set<string>();
    }

    /** La parte ha nomi di strumenti da aggiungere ancora da decidere. */
    protected hasOpenSuggestions(score: SheetsMusic): boolean {
        return score.id !== undefined && this.suggestionPartIds.includes(score.id);
    }

    protected confirmMerge(): void {
        if (this.selectedPartKeys.size < 2) return;
        // La parte unita è nuova: i nomi da aggiungere delle parti di partenza spariscono al salvataggio.
        const withSuggestions = this.draftScores.some((score) => this.selectedPartKeys.has(this.scoreKey(score)) && this.hasOpenSuggestions(score));
        this.confirmService.confirmReversible({
            title: 'Unisci parti',
            consequence:
                'Le pagine saranno concatenate nell’ordine delle parti selezionate. Gli strumenti duplicati verranno rimossi.' +
                (withSuggestions ? ' Alcune parti hanno strumenti da aggiungere: dopo il salvataggio quei nomi non saranno più proposti per la parte unita.' : ''),
            actionLabel: 'Unisci',
            accept: () => {
                this.uxEvent.emit('merge');
                const first = this.draftScores.findIndex((score) => this.selectedPartKeys.has(this.scoreKey(score)));
                this.commit(mergeScores(this.draftScores, this.selectedPartKeys, this.scoreKey), `${this.selectedPartKeys.size} parti unite`, Math.max(0, first));
                this.selectingParts = false;
                this.selectedPartKeys = new Set<string>();
            }
        });
    }

    protected confirmMarkSelectedReviewed(): void {
        const count = this.selectedReviewCount;
        if (this.readOnly || !count) return;
        this.confirmService.confirmReversible({
            title: count === 1 ? 'Segna come verificata' : 'Segna come verificate',
            consequence: `${count} ${count === 1 ? 'parte non sarà più segnalata' : 'parti non saranno più segnalate'} come da verificare. Potrai annullare l’operazione prima del salvataggio.`,
            actionLabel: 'Segna',
            accept: () => {
                const next = cloneAndNormalizeScores(this.draftScores);
                next.forEach((score) => {
                    if (this.selectedPartKeys.has(this.scoreKey(score))) score.needsReview = false;
                });
                this.commit(next, `${count} ${count === 1 ? 'parte segnata come verificata' : 'parti segnate come verificate'}`);
            }
        });
    }

    protected confirmDeleteScore(): void {
        const score = this.selectedScore;
        if (!score) return;
        this.confirmService.confirmReversible({
            title: 'Rimuovi parte',
            consequence: `La parte “${this.scoreTitle(score)}” e le sue ${score.media?.length ?? 0} pagine verranno rimosse dalla traccia. Potrai annullare l’operazione prima del salvataggio.`,
            actionLabel: 'Rimuovi',
            accept: () => {
                const next = this.draftScores.filter((_, index) => index !== this.selectedScoreIndex);
                this.commit(next, 'Parte eliminata', Math.min(this.selectedScoreIndex, Math.max(0, next.length - 1)));
            }
        });
    }

    protected duplicateScore(): void {
        if (!this.selectedScore) return;
        const copy = structuredClone(this.selectedScore);
        copy.id = undefined;
        copy.description = copy.description?.trim() ? `${copy.description} (copia)` : '';
        const next = [...this.draftScores];
        next.splice(this.selectedScoreIndex + 1, 0, copy);
        this.commit(next, 'Parte duplicata', this.selectedScoreIndex + 1);
    }

    protected confirmDeletePages(): void {
        if (!this.selectedMediaIds.size || !this.selectedScore) return;
        const count = this.selectedMediaIds.size;
        this.confirmService.confirmReversible({
            title: count === 1 ? 'Rimuovi pagina' : 'Rimuovi pagine',
            consequence: `${count} ${count === 1 ? 'pagina verrà rimossa' : 'pagine verranno rimosse'} dalla parte. Potrai annullare l’operazione prima del salvataggio.`,
            actionLabel: 'Rimuovi',
            accept: () => {
                const next = cloneAndNormalizeScores(this.draftScores);
                next[this.selectedScoreIndex].media = next[this.selectedScoreIndex].media?.filter((media) => !this.selectedMediaIds.has(media.index));
                this.commit(next, `${count} ${count === 1 ? 'pagina eliminata' : 'pagine eliminate'}`);
                this.selectedMediaIds = new Set<number>();
            }
        });
    }

    protected moveSelectedPages(): void {
        if (this.moveTargetIndex === null || !this.selectedMediaIds.size || this.moveTargetIndex === this.selectedScoreIndex) return;
        const count = this.selectedMediaIds.size;
        this.uxEvent.emit('move');
        this.commit(moveMedia(this.draftScores, this.selectedMediaIds, this.moveTargetIndex), `${count} ${count === 1 ? 'pagina spostata' : 'pagine spostate'}`, this.moveTargetIndex);
        this.moveTargetIndex = null;
    }

    protected createScoreFromPages(): void {
        if (!this.selectedMediaIds.size || !this.selectedScore) return;
        this.uxEvent.emit('move');
        const next = cloneAndNormalizeScores(this.draftScores);
        const source = next[this.selectedScoreIndex];
        const media = (source.media ?? []).filter((item) => this.selectedMediaIds.has(item.index));
        source.media = (source.media ?? []).filter((item) => !this.selectedMediaIds.has(item.index));
        next.splice(this.selectedScoreIndex + 1, 0, { description: '', instruments: [], media });
        this.commit(next, 'Nuova parte creata dalle pagine selezionate', this.selectedScoreIndex + 1);
    }

    protected confirmSplitAfter(): void {
        const pageIndex = this.selectedPageIndex;
        if (pageIndex < 0 || !this.selectedScore || pageIndex === (this.selectedScore.media?.length ?? 0) - 1) {
            this.announce('Seleziona una sola pagina che non sia l’ultima della parte.');
            return;
        }
        const createdPages = (this.selectedScore.media?.length ?? 0) - pageIndex - 1;
        this.confirmService.confirmReversible({
            title: 'Dividi parte',
            consequence: `Verrà creata una nuova parte con le ${createdPages} pagine successive. Gli strumenti saranno mantenuti in entrambe.`,
            actionLabel: 'Dividi',
            accept: () => {
                this.uxEvent.emit('split');
                this.commit(splitScoreAfter(this.draftScores, this.selectedScoreIndex, pageIndex), 'Parte divisa');
            }
        });
    }

    protected confirmSplitByPage(): void {
        const count = this.selectedScore?.media?.length ?? 0;
        if (count < 2) return;
        this.confirmService.confirmReversible({
            title: 'Una parte per pagina',
            consequence: `La parte verrà sostituita da ${count} parti, una per pagina. Gli strumenti saranno mantenuti in tutte.`,
            actionLabel: 'Dividi',
            accept: () => {
                this.uxEvent.emit('split');
                this.commit(splitScoreByPage(this.draftScores, this.selectedScoreIndex), `${count} parti create`);
            }
        });
    }

    protected undo(): void {
        const previous = this.undoStack.pop();
        if (!previous) return;
        this.uxEvent.emit('undo');
        this.draftScores = cloneAndNormalizeScores(previous);
        this.selectedScoreIndex = Math.min(this.selectedScoreIndex, Math.max(0, this.draftScores.length - 1));
        this.clearSelections();
        this.emitDraft('Ultima operazione annullata');
    }

    protected moveScore(index: number, direction: -1 | 1): void {
        const target = index + direction;
        if (!this.draftScores[target] || this.filterQuery.trim()) return;
        this.uxEvent.emit('reorder');
        this.commit(reorderScore(this.draftScores, index, target), 'Parti riordinate', target);
    }

    protected movePage(pageIndex: number, direction: -1 | 1): void {
        const target = pageIndex + direction;
        if (!this.selectedScore?.media?.[target]) return;
        this.uxEvent.emit('reorder');
        this.commit(reorderMedia(this.draftScores, this.selectedScoreIndex, pageIndex, target), 'Pagine riordinate');
    }

    protected onScoreDragStart(index: number): void {
        if (!this.filterQuery.trim()) this.draggedScoreIndex = index;
    }

    protected onScoreDrop(targetIndex: number, event: DragEvent): void {
        event.preventDefault();
        if (this.draggedScoreIndex === undefined || this.filterQuery.trim()) return;
        this.commit(reorderScore(this.draftScores, this.draggedScoreIndex, targetIndex), 'Parti riordinate', targetIndex);
        this.draggedScoreIndex = undefined;
    }

    protected onScoreDragEnd(): void {
        this.draggedScoreIndex = undefined;
        this.partDropIndex = undefined;
    }

    /** Una riga dell'elenco riceve sia una parte trascinata, sia le pagine di un'altra parte. */
    protected onPartRowDragOver(index: number, event: DragEvent): void {
        event.preventDefault();
        if (this.draggedPage) this.partDropIndex = index;
    }

    protected onPartRowDragLeave(index: number): void {
        if (this.partDropIndex === index) this.partDropIndex = undefined;
    }

    protected onPartRowDrop(index: number, event: DragEvent): void {
        this.partDropIndex = undefined;
        if (this.draggedPage) {
            this.onPageDrop(index, undefined, event);
            return;
        }
        this.onScoreDrop(index, event);
    }

    protected onPageDragStart(scoreIndex: number, pageIndex: number, mediaId: number): void {
        this.draggedPage = { scoreIndex, pageIndex, mediaId };
        if (!this.selectedMediaIds.has(mediaId)) this.selectedMediaIds = new Set([mediaId]);
    }

    protected onPageDragEnd(): void {
        this.draggedPage = undefined;
        this.pageDropIndex = undefined;
    }

    /**
     * Da che lato della card finirebbero le pagine trascinate: è la posizione che l’indicatore
     * mostra come spazio di inserimento ed è quella che il rilascio usa davvero.
     */
    protected onPageDragOver(pageIndex: number, event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (!this.draggedPage) return;
        const bounds = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
        this.pageDropIndex = bounds && event.clientX > bounds.left + bounds.width / 2 ? pageIndex + 1 : pageIndex;
    }

    /** Il rilascio sul pannello, fuori dalle card, accoda: l'indicatore si sposta in fondo. */
    protected onPagesDragOver(event: DragEvent): void {
        event.preventDefault();
        if (this.draggedPage) this.pageDropIndex = this.selectedScore?.media?.length ?? 0;
    }

    protected onPageDrop(targetScoreIndex: number, targetPageIndex: number | undefined, event: DragEvent): void {
        event.preventDefault();
        const dragged = this.draggedPage;
        this.draggedPage = undefined;
        this.pageDropIndex = undefined;
        if (!dragged) return;
        const selected = this.selectedMediaIds.has(dragged.mediaId) ? this.selectedMediaIds : new Set([dragged.mediaId]);
        const sameScore = targetScoreIndex === dragged.scoreIndex;
        this.uxEvent.emit(sameScore ? 'reorder' : 'move');
        const moved = selected.size === 1 ? 'pagina spostata' : 'pagine spostate';
        const message = sameScore ? 'Pagine riordinate' : `${selected.size} ${moved} nella parte ${targetScoreIndex + 1}`;
        this.commit(moveMedia(this.draftScores, selected, targetScoreIndex, targetPageIndex), message, targetScoreIndex);
    }

    /** La zona Aggiungi: le pagine nascono da un PDF, quindi porta alla scheda che lo carica. */
    protected requestPdf(): void {
        this.pdfRequested.emit();
    }

    /**
     * I movimenti del puntatore si ascoltano solo durante il trascinamento: un listener sempre
     * attivo sul documento farebbe girare il rilevamento delle modifiche a ogni spostamento del
     * mouse, in tutta la pagina.
     */
    protected onDividerPointerDown(event: PointerEvent): void {
        if (this.resizing) return;
        this.resizing = true;
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        event.preventDefault();
        document.addEventListener('pointermove', this.onDividerPointerMove);
        document.addEventListener('pointerup', this.onDividerPointerUp);
    }

    private readonly onDividerPointerMove = (event: PointerEvent): void => {
        const bounds = this.workspaceGrid?.nativeElement.getBoundingClientRect();
        if (!bounds?.width) return;
        this.applyRatio(((event.clientX - bounds.left) / bounds.width) * 100);
    };

    private readonly onDividerPointerUp = (): void => {
        this.resizing = false;
        document.removeEventListener('pointermove', this.onDividerPointerMove);
        document.removeEventListener('pointerup', this.onDividerPointerUp);
        this.announce(`Elenco delle parti al ${this.partsRatio} per cento`);
    };

    /** Il divisore si muove anche da tastiera: frecce di due punti per volta, Home ripristina. */
    protected onDividerKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            this.applyRatio(this.partsRatio + (event.key === 'ArrowLeft' ? -2 : 2));
            this.announce(`Elenco delle parti al ${this.partsRatio} per cento`);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            this.partsRatio = 34;
            this.ratioChanged = false;
            this.announce('Larghezza dei pannelli ripristinata');
        }
    }

    private applyRatio(ratio: number): void {
        this.partsRatio = Math.round(Math.min(56, Math.max(24, ratio)));
        this.ratioChanged = true;
    }

    protected onPartKeydown(index: number, event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            this.selectScore(index);
            return;
        }
        if (event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            this.moveScore(index, event.key === 'ArrowUp' ? -1 : 1);
            return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const order = this.filteredScores;
        const next = order[order.findIndex((item) => item.index === index) + (event.key === 'ArrowUp' ? -1 : 1)];
        if (!next) return;
        if (event.shiftKey) {
            this.extendPartSelection(index, next.index);
        } else {
            this.selectScore(next.index, false);
            this.partAnchorIndex = next.index;
        }
        this.focusPart(next.index);
    }

    /**
     * Escape appartiene al workspace: chiude nell'ordine la selezione delle pagine, la modalità di
     * selezione delle parti e il dettaglio della parte su viewport ridotte. Durante una modifica
     * inline resta al campo, dove chiude l'elenco dei suggerimenti.
     */
    @HostListener('keydown.escape', ['$event'])
    protected onEscape(event: Event): void {
        if (this.inlineEditActive) return;
        if (this.selectedMediaIds.size) {
            this.selectedMediaIds = new Set<number>();
            this.moveTargetIndex = null;
            this.announce('Selezione delle pagine annullata');
        } else if (this.selectingParts) {
            this.selectingParts = false;
            this.selectedPartKeys = new Set<string>();
            this.announce('Selezione delle parti annullata');
        } else if (this.mobileDetail) {
            this.mobileDetail = false;
            this.announce('Elenco delle parti');
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }

    /** Maiusc più frecce: selezione contigua dall'ancora, nell'ordine in cui l'elenco mostra le parti. */
    private extendPartSelection(fromIndex: number, toIndex: number): void {
        if (!this.selectingParts) {
            this.selectingParts = true;
            this.selectedPartKeys = new Set<string>();
        }
        if (this.partAnchorIndex === undefined || !this.selectedPartKeys.size) this.partAnchorIndex = fromIndex;
        const order = this.filteredScores;
        const anchor = order.findIndex((item) => item.index === this.partAnchorIndex);
        const target = order.findIndex((item) => item.index === toIndex);
        if (anchor < 0 || target < 0) return;
        const [first, last] = anchor <= target ? [anchor, target] : [target, anchor];
        this.selectedPartKeys = new Set(order.slice(first, last + 1).map(({ score }) => this.scoreKey(score)));
        this.selectedScoreIndex = toIndex;
        this.announce(`${this.selectedPartKeys.size} parti selezionate`);
    }

    /** Con l'elenco virtualizzato nel DOM vivono solo le righe visibili: la riga si cerca per indice. */
    private focusPart(index: number): void {
        queueMicrotask(() => this.partRows?.find((row) => row.nativeElement.dataset['partIndex'] === String(index))?.nativeElement.focus());
    }

    /** Maiusc più frecce nella griglia: estende la selezione alle pagine contigue. */
    private extendPageSelection(fromIndex: number, toIndex: number): void {
        const media = this.selectedScore?.media ?? [];
        if (!media[toIndex]) return;
        if (this.pageAnchorIndex === undefined || !this.selectedMediaIds.size) this.pageAnchorIndex = fromIndex;
        const [first, last] = this.pageAnchorIndex <= toIndex ? [this.pageAnchorIndex, toIndex] : [toIndex, this.pageAnchorIndex];
        this.selectedMediaIds = new Set(media.slice(first, last + 1).map((item) => item.index));
        this.navigateToPage(toIndex);
        this.announce(`${this.selectedMediaIds.size} ${this.selectedMediaIds.size === 1 ? 'pagina selezionata' : 'pagine selezionate'}`);
    }

    protected setActivePage(pageIndex: number): void {
        this.activePageIndex = pageIndex;
    }

    protected editImage(score: SheetsMusic, media: ChildrenEntities, pageIndex: number): void {
        if (this.readOnly || this.trackDirty || this.saving || score.id === undefined) return;
        this.imageEdit.emit({ scoreId: score.id, media, pageNumber: pageIndex + 1, scoreTitle: this.scoreTitle(score) });
    }

    protected navigateToPage(pageIndex: number): void {
        const pageCount = this.selectedScore?.media?.length ?? 0;
        if (!pageCount) return;

        this.activePageIndex = Math.max(0, Math.min(pageIndex, pageCount - 1));
        queueMicrotask(() => {
            const pageCard = this.pageCards?.get(this.activePageIndex)?.nativeElement;
            pageCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            pageCard?.focus({ preventScroll: true });
        });
        this.announce(`Pagina ${this.activePageIndex + 1} di ${pageCount}`);
    }

    protected onPageKeydown(pageIndex: number, mediaId: number, thumbnail: MediaThumbnailComponent, event: KeyboardEvent): void {
        if (event.target !== event.currentTarget) return;
        this.setActivePage(pageIndex);
        if (event.key === 'Enter') {
            event.preventDefault();
            thumbnail.openPreview();
            return;
        }
        if (event.key === ' ') {
            event.preventDefault();
            this.pageAnchorIndex = pageIndex;
            this.toggleMedia(mediaId);
        }
        if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            this.movePage(pageIndex, event.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (!event.ctrlKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
            if (event.shiftKey) this.extendPageSelection(pageIndex, pageIndex + step);
            else this.navigateToPage(pageIndex + step);
        }
    }

    private commit(next: SheetsMusic[], message: string, selectedIndex = this.selectedScoreIndex): void {
        this.undoStack.push(cloneAndNormalizeScores(this.draftScores));
        this.draftScores = cloneAndNormalizeScores(next);
        this.selectedScoreIndex = Math.min(selectedIndex, Math.max(0, this.draftScores.length - 1));
        this.activePageIndex = Math.min(this.activePageIndex, Math.max(0, (this.selectedScore?.media?.length ?? 0) - 1));
        this.emitDraft(message);
    }

    private emitDraft(message: string): void {
        this.lastEmitted = this.draftScores;
        this.scoresChange.emit(this.draftScores);
        this.dirtyChange.emit(JSON.stringify(this.draftScores) !== JSON.stringify(this.baselineScores));
        this.announce(message);
    }

    private clearSelections(): void {
        this.selectedMediaIds = new Set<number>();
        this.selectedPartKeys = new Set<string>();
        this.moveTargetIndex = null;
    }

    private announce(message: string): void {
        this.liveMessage = '';
        queueMicrotask(() => (this.liveMessage = message));
    }
}
