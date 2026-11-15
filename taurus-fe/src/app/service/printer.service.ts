import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { forkJoin, Subscription } from "rxjs";
import { TracksService } from "./tracks.service";
import { withErrorSummary } from "./api-error-context";
import { Albums, ChildrenEntities, SheetsMusic, Tracks } from "../module";
import { unengravedPart } from "../score-editor/score-engraving";

/** La sorgente dell'anteprima, mostrata sopra il titolo. */
export type PreviewSource = 'Album' | 'Traccia' | 'Scaletta';

/** L'ultimo comando di anteprima ricevuto: serve a ripeterlo con la stessa sorgente e la stessa selezione. */
interface PreviewRequest {
    element: Albums | Tracks;
    selectedTracks?: ChildrenEntities[];
}

@Injectable({
    providedIn: 'root'
})
export class PrinterService {
    private _scores: SheetsMusic[] = [];
    private _previewTitle: string = 'Spartiti selezionati';
    private _previewSource: PreviewSource = 'Traccia';
    private _previewError: boolean = false;
    private _byInstrument = false;
    private _unengraved = new Set<number>();
    private _lastRequest?: PreviewRequest;
    private readonly tracksService = inject(TracksService);
    private readonly router = inject(Router);
    private $subscription?: Subscription;

    constructor() {
        this._scores = [];
    }

    public get scores(): SheetsMusic[] {
        return this._scores;
    }

    public get previewTitle(): string {
        return this._previewTitle;
    }

    public get previewSource(): PreviewSource {
        return this._previewSource;
    }

    /**
     * Le pagine della scaletta di un evento seguono gli strumenti e, per ognuno, l'ordine dei brani; la stampa propone
     * il formato marcia.
     */
    public get byInstrument(): boolean {
        return this._byInstrument;
    }

    /** Parte scritta o ricavata senza pagine: resta fuori da anteprima e stampa, e il titolo la conta. */
    public isUnengraved(score: SheetsMusic): boolean {
        return unengravedPart(score) || (score.id !== undefined && this._unengraved.has(score.id));
    }

    /** Il caricamento delle tracce dell'album non è riuscito: la pagina sorgente offre «Riprova». */
    public get previewError(): boolean {
        return this._previewError;
    }

    public preview(element: Albums | Tracks, selectedTracks?: ChildrenEntities[]): void {
        this._scores = [];
        this._previewError = false;
        this._byInstrument = false;
        this._unengraved.clear();
        this._lastRequest = { element, selectedTracks };
        this._previewTitle = element.name?.trim() || 'Spartiti selezionati';

        if (typeof element === "object" && "scores" in element) {
            this._previewSource = 'Traccia';
            this._scores.push(...element.scores!);
            this.router.navigate(["preview"]);
        } else if (typeof element === "object" && "tracks" in element) {
            this._previewSource = 'Album';
            let childrenEntities: ChildrenEntities[] = [];

            if (selectedTracks && selectedTracks.length > 0) {
                childrenEntities = selectedTracks;
            } else if (element.tracks && element.tracks.length > 0) {
                childrenEntities = element.tracks;
            }

            const context = withErrorSummary('Anteprima non disponibile');
            this.$subscription = forkJoin(childrenEntities.map(track => this.tracksService.getById(track.index, context))).subscribe({
                next: tracks => {
                    this._scores.push(...tracks.flatMap(track => track.scores!))
                    this.router.navigate(["preview"]);
                },
                // Un errore su una traccia non deve aprire un'anteprima parziale: la pagina sorgente conserva la selezione e offre «Riprova».
                error: () => {
                    this._scores = [];
                    this._previewError = true;
                }
            });
        }
    }

    /**
     * La scaletta di un evento, con le parti che la preparazione mostra a chi la stampa: `unengraved` sono le parti da
     * impaginare, che l'evento conosce senza la loro versione.
     */
    public previewProgram(title: string, scores: SheetsMusic[], unengraved: number[] = []): void {
        this.clear();
        this._lastRequest = undefined;
        this._previewTitle = title.trim() || 'Scaletta';
        this._previewSource = 'Scaletta';
        this._scores = [...scores];
        this._byInstrument = true;
        this._unengraved = new Set(unengraved);
        this.router.navigate(["preview"]);
    }

    /** Nasconde l'avviso: una pagina sorgente che si apre non deve mostrare l'errore di un'altra. */
    public dismissError(): void {
        this._previewError = false;
    }

    /** Ripete l'ultimo comando di anteprima: la sorgente e la selezione sono quelle dell'errore. */
    public retry(): void {
        if (!this._lastRequest) return;

        this.preview(this._lastRequest.element, this._lastRequest.selectedTracks);
    }

    public clear(): void {
        this._scores = [];
        this._previewTitle = 'Spartiti selezionati';
        this._previewSource = 'Traccia';
        this._previewError = false;
        this._byInstrument = false;
        this._unengraved.clear();

        if (this.$subscription) {
            this.$subscription.unsubscribe();
        }
    }
}
