import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { DialogService } from 'primeng/dynamicdialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';
import { openCompareDialog } from '../../dialogs/score-compare-dialog/score-compare-dialog.component';
import { ImportsModule } from '../../imports';
import { EngineSummary, PendingReview, RecognitionCounts, RecognitionEngine, RecognitionReport, ReviewedPart } from '../../module';
import { share } from '../../score-player/recognition-review';
import { ScoreRecognitionService, ToastService } from '../../service';

type Period = 'year' | 'all';

/** Un motore nel riepilogo: parti approvate, battute giuste e segni di struttura letti. */
interface EngineCard {
    engine: RecognitionEngine;
    label: string;
    counts: RecognitionCounts;
    correctShare: number | null;
    marksShare: number | null;
}

/** Un tipo di errore, con il numero e la quota di ogni motore. */
interface ErrorRow {
    label: string;
    total: number;
    cells: { engine: RecognitionEngine; count: number; share: number | null }[];
}

/** Un mese dell'andamento, con la quota di battute giuste di ogni motore che vi ha versioni riconosciute. */
interface MonthRow {
    month: string;
    label: string;
    cells: { engine: RecognitionEngine; share: number | null; parts: number }[];
}

/** Avanzamento della raccolta dalle approvazioni precedenti. */
interface Collection {
    done: number;
    total: number;
    failed: number;
    stopping: boolean;
}

const ENGINE_LABELS: Record<RecognitionEngine, string> = { AUDIVERIS: 'Audiveris', HOMR: 'homr' };
/** Approvazioni lette a ogni passo della raccolta. */
const PENDING_PAGE = 50;
/** Limite della lista delle approvazioni da raccogliere, come nel backend. */
const MAX_PENDING_PAGE = 500;
const MONTHS = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Qualità del riconoscimento: per ogni motore le parti approvate, la quota di battute giuste e quella dei segni di
 * struttura letti, con l'andamento per mese, gli errori più frequenti e le parti più corrette dagli archivisti. Le
 * approvazioni fatte prima della raccolta si raccolgono qui, una alla volta nel browser.
 */
@Component({
    selector: 'app-recognition',
    standalone: true,
    imports: [ImportsModule, ProgressBarModule],
    templateUrl: './recognition.component.html',
    styleUrl: './recognition.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
    providers: [DialogService]
})
export class RecognitionComponent implements OnInit, OnDestroy {
    protected readonly periods: { label: string; value: Period }[] = [
        { label: 'Ultimi 12 mesi', value: 'year' },
        { label: 'Tutto', value: 'all' }
    ];
    protected period: Period = 'year';
    protected loading = true;
    protected loadError = false;
    protected report: RecognitionReport | null = null;
    protected engines: EngineCard[] = [];
    protected errors: ErrorRow[] = [];
    protected months: MonthRow[] = [];
    /** Motori presenti nel riepilogo, nell'ordine delle colonne. */
    protected columns: { engine: RecognitionEngine; label: string }[] = [];
    /** Approvazioni ancora da raccogliere; `null` finché non si sa. */
    protected pendingTotal: number | null = null;
    protected collection: Collection | null = null;
    private destroyed = false;

    constructor(
        private readonly recognitionService: ScoreRecognitionService,
        private readonly dialogService: DialogService,
        private readonly toastService: ToastService,
        private readonly changeDetector: ChangeDetectorRef
    ) {}

    ngOnInit(): void {
        void this.load();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        if (this.collection) this.collection.stopping = true;
    }

    protected get progress(): number {
        const collection = this.collection;
        return collection && collection.total > 0 ? Math.min(100, Math.round((collection.done / collection.total) * 100)) : 0;
    }

    protected changePeriod(period: Period): void {
        if (period === this.period) return;
        this.period = period;
        void this.loadReport();
    }

    protected async load(): Promise<void> {
        await Promise.all([this.loadReport(), this.loadPending()]);
    }

    /** Confronta e conta, una alla volta, le approvazioni fatte prima della raccolta, finché non finiscono o si interrompe. */
    protected async collect(): Promise<void> {
        if (this.collection) return;
        const collection: Collection = { done: 0, total: this.pendingTotal ?? 0, failed: 0, stopping: false };
        this.collection = collection;
        const attempted = new Set<number>();
        let unreadable = false;
        try {
            while (!collection.stopping) {
                // Quelle non riuscite restano nella lista: la pagina si allunga perché non la occupino tutta.
                const page = await firstValueFrom(this.recognitionService.pending(Math.min(MAX_PENDING_PAGE, PENDING_PAGE + collection.failed)));
                const items = page.items.filter((item) => !attempted.has(item.approvedVersionId));
                if (!items.length) break;
                // Quelle non riuscite restano da raccogliere: non contano tra le parti ancora da fare.
                collection.total = collection.done + Math.max(items.length, page.total - collection.failed);
                for (const item of items) {
                    if (collection.stopping) break;
                    attempted.add(item.approvedVersionId);
                    if (!(await this.collectOne(item))) collection.failed++;
                    collection.done++;
                    this.changeDetector.markForCheck();
                }
            }
        } catch {
            unreadable = true;
        } finally {
            this.collection = null;
        }
        if (this.destroyed) return;
        this.summarize(collection, unreadable);
        await this.load();
    }

    protected stop(): void {
        if (this.collection) this.collection.stopping = true;
    }

    /** Apre il confronto tra la versione del motore, a sinistra, e quella approvata. */
    protected compare(part: ReviewedPart): void {
        openCompareDialog(this.dialogService, {
            trackId: part.trackId,
            scoreId: part.scoreId,
            subject: this.partLabel(part),
            versionId: part.approvedVersionId,
            withId: part.engineVersionId
        });
    }

    protected engineLabel(engine: RecognitionEngine): string {
        return ENGINE_LABELS[engine];
    }

    protected partLabel(part: Pick<ReviewedPart, 'partName' | 'scoreId'>): string {
        return part.partName?.trim() || `Parte ${part.scoreId}`;
    }

    protected correctShare(part: ReviewedPart): number | null {
        return share(part.correctMeasures, part.referenceMeasures);
    }

    private async collectOne(item: PendingReview): Promise<boolean> {
        try {
            const [engineXml, approvedXml] = await Promise.all([
                this.recognitionService.content(item.trackId, item.scoreId, item.engineVersionId),
                this.recognitionService.content(item.trackId, item.scoreId, item.approvedVersionId)
            ]);
            await this.recognitionService.send(item.trackId, item.scoreId, item.approvedVersionId, item.engineVersionId, engineXml, approvedXml);
            return true;
        } catch {
            return false;
        }
    }

    /** Avvisa a fine raccolta: `unreadable` quando non si è potuta leggere la lista delle approvazioni da raccogliere. */
    private summarize(collection: Collection, unreadable: boolean): void {
        const counted = collection.done - collection.failed;
        const total = counted === 0 ? 'Nessuna parte contata' : counted === 1 ? 'Contata 1 parte' : `Contate ${counted} parti`;
        if (collection.failed > 0 || unreadable) {
            const reasons: string[] = [];
            if (collection.failed === 1) reasons.push('1 parte non si è potuta confrontare');
            if (collection.failed > 1) reasons.push(`${collection.failed} parti non si sono potute confrontare`);
            if (unreadable) reasons.push('le approvazioni da raccogliere non si sono potute leggere');
            this.toastService.warn('Raccolta incompleta', `${total}; ${reasons.join(' e ')}. Le parti non contate restano da raccogliere.`);
        } else if (collection.stopping) {
            this.toastService.info('Raccolta interrotta', `${total}: le altre restano da raccogliere.`);
        } else {
            this.toastService.success('Raccolta completata', `${total} tra le approvazioni precedenti.`);
        }
    }

    private async loadReport(): Promise<void> {
        this.loading = true;
        this.loadError = false;
        const period = this.period;
        try {
            const report = await firstValueFrom(this.recognitionService.report(period === 'year' ? firstDayOfYearAgo(new Date()) : null));
            if (period !== this.period) return;
            this.show(report);
        } catch {
            if (period === this.period) this.loadError = true;
        } finally {
            if (period === this.period) this.loading = false;
            this.changeDetector.markForCheck();
        }
    }

    private async loadPending(): Promise<void> {
        try {
            this.pendingTotal = (await firstValueFrom(this.recognitionService.pending(1))).total;
        } catch {
            this.pendingTotal = null;
        }
        this.changeDetector.markForCheck();
    }

    private show(report: RecognitionReport): void {
        this.report = report;
        this.columns = report.engines.map(({ engine }) => ({ engine, label: ENGINE_LABELS[engine] }));
        this.engines = report.engines.map(({ engine, counts }) => ({
            engine,
            label: ENGINE_LABELS[engine],
            counts,
            correctShare: share(counts.correctMeasures, counts.referenceMeasures),
            marksShare: share(counts.foundMarks, counts.referenceMarks)
        }));
        this.errors = errorRows(report.engines);
        this.months = monthRows(report);
    }
}

/** Il primo giorno del mese di undici mesi fa, `yyyy-MM-dd`: con il mese in corso fanno dodici mesi. */
export function firstDayOfYearAgo(today: Date): string {
    const first = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Gli errori dal più frequente, ognuno con il numero e la quota delle battute, o dei segni, di ogni motore. */
export function errorRows(engines: readonly EngineSummary[]): ErrorRow[] {
    const kinds: { label: string; count: (counts: RecognitionCounts) => number; base: (counts: RecognitionCounts) => number }[] = [
        { label: 'Altezze diverse', count: (counts) => counts.pitchMeasures, base: (counts) => counts.referenceMeasures },
        { label: 'Ritmo diverso', count: (counts) => counts.rhythmMeasures, base: (counts) => counts.referenceMeasures },
        { label: 'Legature di valore', count: (counts) => counts.tieMeasures, base: (counts) => counts.referenceMeasures },
        { label: 'Battute perse', count: (counts) => counts.missingMeasures, base: (counts) => counts.referenceMeasures },
        { label: 'Battute in più', count: (counts) => counts.extraMeasures, base: (counts) => counts.engineMeasures },
        { label: 'Segni di struttura non letti', count: (counts) => counts.referenceMarks - counts.foundMarks, base: (counts) => counts.referenceMarks }
    ];
    return kinds
        .map((kind) => {
            const cells = engines.map(({ engine, counts }) => ({ engine, count: kind.count(counts), share: share(kind.count(counts), kind.base(counts)) }));
            return { label: kind.label, total: cells.reduce((sum, cell) => sum + cell.count, 0), cells };
        })
        .filter((row) => row.total > 0)
        .sort((first, second) => second.total - first.total);
}

/** I mesi del riepilogo in ordine, con la quota di battute giuste di ogni motore. */
export function monthRows(report: RecognitionReport): MonthRow[] {
    const months = [...new Set(report.months.map((month) => month.month))].sort();
    return months.map((month) => ({
        month,
        label: monthLabel(month),
        cells: report.engines.map(({ engine }) => {
            const counts = report.months.find((item) => item.month === month && item.engine === engine)?.counts;
            return { engine, share: counts ? share(counts.correctMeasures, counts.referenceMeasures) : null, parts: counts?.parts ?? 0 };
        })
    }));
}

/** «novembre 2026» da `2026-11`. */
export function monthLabel(month: string): string {
    const [year, number] = month.split('-').map(Number);
    if (!year || !number) return month;
    return MONTHS.format(new Date(Date.UTC(year, number - 1, 1)));
}
