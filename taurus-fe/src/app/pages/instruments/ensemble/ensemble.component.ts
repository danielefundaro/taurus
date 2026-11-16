import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, HostListener, OnInit } from '@angular/core';
import { finalize, first } from 'rxjs';
import { ImportsModule } from '../../../imports';
import { EnsembleInstrument, INSTRUMENT_FAMILY_LABELS } from '../../../module';
import { ApiErrorService, InstrumentsService, ToastService, withErrorSummary, withHandledErrors } from '../../../service';

/** Errori che la scheda mostra al suo interno, con il comando per rileggere l'organico. */
export const ENSEMBLE_HANDLED_ERRORS = ['version.conflict', 'instrument.ensemble.invalid'] as const;

/**
 * La scheda Organico della pagina degli strumenti: l'elenco ordinato degli strumenti che suonano abitualmente nella banda.
 *
 * Le modifiche restano nella scheda finché non si salva: gli strumenti si spostano trascinandoli o, da tastiera, con i
 * pulsanti accanto a ogni riga; **Aggiungi** mette lo strumento al posto della sua famiglia e **Proponi l'ordine di
 * riferimento** riordina gli strumenti, o li propone tutti con l'organico vuoto.
 */
@Component({
    selector: 'app-instrument-ensemble',
    imports: [ImportsModule, CdkDropList, CdkDrag, CdkDragHandle],
    templateUrl: './ensemble.component.html',
    styleUrl: './ensemble.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager
})
export class EnsembleComponent implements OnInit {
    protected rows: EnsembleInstrument[] = [];
    protected selectedToAdd?: EnsembleInstrument;
    protected loading = false;
    protected loadFailed = false;
    protected saving = false;
    /** Il salvataggio è stato rifiutato: l'organico salvato è cambiato o uno strumento non c'è più. */
    protected errorDetail = '';
    protected announcement = '';

    /** Tutti gli strumenti nell'ordine di riferimento: la posizione nell'elenco è il loro rango. */
    private reference: EnsembleInstrument[] = [];
    private saved: number[] = [];

    constructor(
        private readonly instrumentsService: InstrumentsService,
        private readonly toastService: ToastService,
        private readonly apiErrors: ApiErrorService
    ) {}

    ngOnInit(): void {
        this.load();
    }

    get isDirty(): boolean {
        return !sameIds(
            this.rows.map((row) => row.id),
            this.saved
        );
    }

    /** Gli strumenti fuori dall'organico, nell'ordine di riferimento. */
    protected get available(): EnsembleInstrument[] {
        const inEnsemble = new Set(this.rows.map((row) => row.id));
        return this.reference.filter((instrument) => !inEnsemble.has(instrument.id));
    }

    protected get hasInstruments(): boolean {
        return this.reference.length > 0;
    }

    protected familyLabel(instrument: EnsembleInstrument): string | undefined {
        return instrument.family ? INSTRUMENT_FAMILY_LABELS[instrument.family] : undefined;
    }

    @HostListener('window:beforeunload', ['$event'])
    protected onBrowserExit(event: BeforeUnloadEvent): void {
        if (this.isDirty) event.preventDefault();
    }

    protected drop(event: CdkDragDrop<EnsembleInstrument[]>): void {
        if (event.previousIndex === event.currentIndex) return;
        this.move(event.previousIndex, event.currentIndex);
    }

    /** Alternativa al trascinamento, da tastiera. */
    protected moveBy(index: number, offset: number): void {
        const target = index + offset;
        if (target < 0 || target >= this.rows.length) return;
        this.move(index, target);
    }

    protected remove(index: number): void {
        const removed = this.rows[index];
        this.rows = this.rows.filter((_, position) => position !== index);
        this.announcement = `${removed.name} tolto dall'organico.`;
    }

    /**
     * Mette lo strumento dopo l'ultimo che lo precede nell'ordine di riferimento o, se non ce n'è, prima del primo
     * collocato dal catalogo; uno strumento che il catalogo non colloca va in fondo.
     */
    protected add(): void {
        const instrument = this.selectedToAdd;
        if (!instrument) return;
        const target = this.insertionIndex(this.rank(instrument));
        this.rows = [...this.rows.slice(0, target), instrument, ...this.rows.slice(target)];
        this.selectedToAdd = undefined;
        this.announcement = `${instrument.name} aggiunto all'organico in posizione ${target + 1} di ${this.rows.length}.`;
    }

    /**
     * Riordina gli strumenti secondo il catalogo di riferimento, lasciando in fondo e nel loro ordine quelli che non
     * colloca; con l'organico vuoto propone tutti gli strumenti, da togliere poi uno per uno.
     */
    protected proposeReference(): void {
        if (this.rows.length === 0) {
            this.rows = [...this.reference];
            this.announcement = `Proposti tutti i ${this.rows.length} strumenti nell'ordine di riferimento.`;
            return;
        }
        const placed = this.rows.filter((row) => this.rank(row) !== undefined).sort((a, b) => this.rank(a)! - this.rank(b)!);
        const others = this.rows.filter((row) => this.rank(row) === undefined);
        this.rows = [...placed, ...others];
        this.announcement = "Strumenti riordinati secondo l'ordine di riferimento.";
    }

    /** Torna all'organico salvato. */
    protected discard(): void {
        this.rows = this.savedRows();
        this.errorDetail = '';
        this.announcement = 'Modifiche annullate.';
    }

    protected save(): void {
        if (this.saving || !this.isDirty) return;
        this.saving = true;
        this.errorDetail = '';
        const ids = this.rows.map((row) => row.id);
        this.instrumentsService
            .saveEnsemble(ids, this.saved, withHandledErrors(ENSEMBLE_HANDLED_ERRORS, withErrorSummary('Organico non salvato')))
            .pipe(
                first(),
                finalize(() => (this.saving = false))
            )
            .subscribe({
                next: (ensemble) => {
                    this.saved = ensemble.map((instrument) => instrument.id);
                    const positions = new Map(ensemble.map((instrument) => [instrument.id, instrument.ensemblePosition]));
                    this.reference = this.reference.map((instrument) => ({ ...instrument, ensemblePosition: positions.get(instrument.id) ?? null }));
                    this.rows = this.savedRows();
                    this.toastService.success('Organico salvato', ensemble.length ? `${ensemble.length} strumenti nell'organico.` : "L'organico è vuoto.");
                },
                error: (error: HttpErrorResponse) => {
                    const handled = this.apiErrors.handledMessage(error, ENSEMBLE_HANDLED_ERRORS);
                    if (handled === undefined) return;
                    this.errorDetail = this.apiErrors.key(error) === 'version.conflict' ? "Nel frattempo l'organico è stato cambiato da un'altra persona: ricaricalo per vedere quello salvato" : handled;
                }
            });
    }

    /** Rilegge l'organico salvato e gli strumenti, perdendo le modifiche. */
    protected load(): void {
        this.loading = true;
        this.loadFailed = false;
        this.errorDetail = '';
        this.instrumentsService
            .ensembleReference(withErrorSummary('Organico non disponibile'))
            .pipe(
                first(),
                finalize(() => (this.loading = false))
            )
            .subscribe({
                next: (reference) => {
                    this.reference = reference;
                    this.saved = reference
                        .filter((instrument) => instrument.ensemblePosition != null)
                        .sort((a, b) => a.ensemblePosition! - b.ensemblePosition!)
                        .map((instrument) => instrument.id);
                    this.rows = this.savedRows();
                    this.selectedToAdd = undefined;
                },
                error: () => (this.loadFailed = true)
            });
    }

    private move(from: number, to: number): void {
        const rows = [...this.rows];
        moveItemInArray(rows, from, to);
        this.rows = rows;
        this.announcement = `${rows[to].name} spostato in posizione ${to + 1} di ${rows.length}.`;
    }

    private insertionIndex(rank: number | undefined): number {
        if (rank === undefined) return this.rows.length;
        let after = -1;
        this.rows.forEach((row, index) => {
            const other = this.rank(row);
            if (other !== undefined && other <= rank) after = index;
        });
        if (after >= 0) return after + 1;
        const before = this.rows.findIndex((row) => this.rank(row) !== undefined);
        return before < 0 ? this.rows.length : before;
    }

    /** Il rango nell'ordine di riferimento degli strumenti che il catalogo colloca. */
    private rank(instrument: EnsembleInstrument): number | undefined {
        if (!instrument.family) return undefined;
        const index = this.reference.findIndex((candidate) => candidate.id === instrument.id);
        return index < 0 ? undefined : index;
    }

    private savedRows(): EnsembleInstrument[] {
        const byId = new Map(this.reference.map((instrument) => [instrument.id, instrument]));
        return this.saved.map((id) => byId.get(id)).filter((instrument): instrument is EnsembleInstrument => instrument !== undefined);
    }
}

function sameIds(first: number[], second: number[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index]);
}
