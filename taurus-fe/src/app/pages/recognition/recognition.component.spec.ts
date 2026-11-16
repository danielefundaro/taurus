import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { PendingReview, PendingReviews, RecognitionCounts, RecognitionReport, ReviewedPart } from '../../module';
import { ScoreRecognitionService, ToastService } from '../../service';
import { errorRows, firstDayOfYearAgo, monthLabel, monthRows, RecognitionComponent } from './recognition.component';

const counts = (values: Partial<RecognitionCounts>): RecognitionCounts => ({
    parts: 0,
    referenceMeasures: 0,
    engineMeasures: 0,
    correctMeasures: 0,
    pitchMeasures: 0,
    rhythmMeasures: 0,
    tieMeasures: 0,
    missingMeasures: 0,
    extraMeasures: 0,
    referenceMarks: 0,
    foundMarks: 0,
    ...values
});

const PART: ReviewedPart = {
    trackId: 3,
    trackName: 'Marcia trionfale',
    scoreId: 21,
    partName: 'Clarinetto 1',
    engine: 'AUDIVERIS',
    engineVersionId: 50,
    engineVersionNumber: 1,
    approvedVersionId: 52,
    approvedVersionNumber: 3,
    approvedAt: '2026-11-10T10:00:00Z',
    referenceMeasures: 20,
    correctMeasures: 14,
    correctedMeasures: 7
};

/** Audiveris: 40 battute approvate, 41 lette, 30 giuste; homr: 10 battute, 9 giuste e nessun segno atteso. */
const REPORT: RecognitionReport = {
    from: '2025-12-01',
    engines: [
        {
            engine: 'AUDIVERIS',
            counts: counts({ parts: 2, referenceMeasures: 40, engineMeasures: 41, correctMeasures: 30, pitchMeasures: 6, rhythmMeasures: 2, missingMeasures: 2, extraMeasures: 3, referenceMarks: 4, foundMarks: 3 })
        },
        { engine: 'HOMR', counts: counts({ parts: 1, referenceMeasures: 10, engineMeasures: 10, correctMeasures: 9, rhythmMeasures: 1 }) }
    ],
    months: [
        { month: '2026-11', engine: 'AUDIVERIS', counts: counts({ parts: 1, referenceMeasures: 20, correctMeasures: 16 }) },
        { month: '2026-10', engine: 'AUDIVERIS', counts: counts({ parts: 1, referenceMeasures: 20, correctMeasures: 14 }) },
        { month: '2026-11', engine: 'HOMR', counts: counts({ parts: 1, referenceMeasures: 10, correctMeasures: 9 }) }
    ],
    parts: [PART, { ...PART, trackId: 4, trackName: 'Inno', scoreId: 22, partName: null, engine: 'HOMR', engineVersionId: 60, approvedVersionId: 61, referenceMeasures: 10, correctMeasures: 9, correctedMeasures: 1 }]
};

const EMPTY: RecognitionReport = { from: null, engines: [], months: [], parts: [] };

const pendingItem = (approvedVersionId: number): PendingReview => ({
    trackId: 3,
    trackName: 'Marcia trionfale',
    scoreId: 21,
    engine: 'AUDIVERIS',
    engineVersionId: approvedVersionId - 1,
    engineVersionNumber: 1,
    approvedVersionId,
    approvedVersionNumber: 2,
    approvedAt: '2026-01-10T10:00:00Z'
});

interface Page {
    period: 'year' | 'all';
    collection: { done: number; total: number; failed: number; stopping: boolean } | null;
    progress: number;
    errors: { label: string; cells: { count: number; share: number | null }[] }[];
    changePeriod(period: 'year' | 'all'): void;
    collect(): Promise<void>;
    stop(): void;
    load(): Promise<void>;
}

describe('RecognitionComponent', () => {
    let fixture: ComponentFixture<RecognitionComponent>;
    let service: jasmine.SpyObj<ScoreRecognitionService>;
    let toast: jasmine.SpyObj<ToastService>;
    let pendingTotal: number;
    let pages: PendingReviews[];

    beforeEach(async () => {
        service = jasmine.createSpyObj<ScoreRecognitionService>('ScoreRecognitionService', ['report', 'pending', 'content', 'send']);
        service.report.and.returnValue(of(REPORT));
        pendingTotal = 0;
        pages = [];
        service.pending.and.callFake((limit) => of(limit === 1 ? { total: pendingTotal, items: [] } : (pages.shift() ?? { total: 0, items: [] })));
        service.content.and.callFake(async (_trackId, _scoreId, versionId) => `<score-partwise id="${versionId}"/>`);
        service.send.and.resolveTo();
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'info', 'warn']);

        await TestBed.configureTestingModule({
            imports: [RecognitionComponent],
            providers: [provideRouter([]), { provide: ScoreRecognitionService, useValue: service }, { provide: ToastService, useValue: toast }]
        }).compileComponents();
        fixture = TestBed.createComponent(RecognitionComponent);
    });

    const page = (): Page => fixture.componentInstance as unknown as Page;
    const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
    const render = async (): Promise<void> => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    };
    const button = (label: string): HTMLButtonElement | undefined =>
        Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('p-button button')).find((element) => element.textContent?.includes(label));

    it('shows for each engine the right measures, the monthly trend, the most frequent errors and the most corrected parts', async () => {
        await render();

        expect(service.report).toHaveBeenCalledOnceWith(firstDayOfYearAgo(new Date()));
        const shown = text();
        expect(shown).toContain('Audiveris');
        expect(shown).toContain('2 parti approvate');
        expect(shown).toContain('75%');
        expect(shown).toContain('30 su 40');
        expect(shown).toContain('3 su 4');
        expect(shown).toContain('1 parte approvata');
        expect(shown).toContain('90%');
        expect(shown).toContain('nessun segno atteso');
        expect(shown).toContain('ottobre 2026');
        expect(shown).toContain('Altezze diverse');
        expect(shown).toContain('Marcia trionfale');
        expect(shown).toContain('Parte 22');
        expect(shown).not.toContain('Raccogli dalle approvazioni precedenti');
        expect(page().errors.map((row) => row.label)).toEqual(['Altezze diverse', 'Ritmo diverso', 'Battute in più', 'Battute perse', 'Segni di struttura non letti']);
    });

    it('opens the comparison of the engine version with the approved one', async () => {
        await render();
        const dialogs = fixture.debugElement.injector.get(DialogService);
        const open = spyOn(dialogs, 'open').and.returnValue({ onClose: of(undefined) } as never);

        button('Confronta')!.click();

        expect(open.calls.mostRecent().args[1]?.data).toEqual({ trackId: 3, scoreId: 21, subject: 'Clarinetto 1', versionId: 52, withId: 50 });
    });

    it('reads the whole period, ignores the answer of a period left meanwhile and says when the summary cannot be read', async () => {
        const year = new Subject<RecognitionReport>();
        service.report.and.returnValue(year);
        await render();
        expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label="Caricamento del riepilogo"]')).not.toBeNull();

        service.report.and.returnValue(of(EMPTY));
        page().changePeriod('all');
        page().changePeriod('all');
        await render();
        expect(service.report.calls.allArgs()).toEqual([[firstDayOfYearAgo(new Date())], [null]]);
        year.next(REPORT);
        year.complete();
        await render();
        expect(text()).toContain('Nessuna parte riconosciuta e approvata');
        expect(text()).not.toContain('Negli ultimi 12 mesi');

        service.report.and.returnValue(throwError(() => new Error('offline')));
        page().changePeriod('year');
        await render();
        expect(text()).toContain('Riepilogo non disponibile');

        service.report.and.returnValue(of(EMPTY));
        button('Riprova')!.click();
        await render();
        expect(text()).toContain('Negli ultimi 12 mesi nessuna parte');
    });

    it('collects the earlier approvals one at a time, keeps the failed ones and summarizes', async () => {
        pendingTotal = 3;
        await render();
        expect(text()).toContain('3 parti approvate non sono ancora contate');
        pages = [
            { total: 3, items: [pendingItem(11), pendingItem(21), pendingItem(31)] },
            { total: 1, items: [pendingItem(21)] }
        ];
        service.content.and.callFake(async (_trackId, _scoreId, versionId) => {
            if (versionId === 21) throw new Error('gone');
            return `<score-partwise id="${versionId}"/>`;
        });

        pendingTotal = 1;
        await page().collect();
        await render();

        expect(service.pending.calls.allArgs()).toEqual([[1], [50], [51], [1]]);
        expect(service.send.calls.allArgs()).toEqual([
            [3, 21, 11, 10, '<score-partwise id="10"/>', '<score-partwise id="11"/>'],
            [3, 21, 31, 30, '<score-partwise id="30"/>', '<score-partwise id="31"/>']
        ]);
        expect(toast.warn).toHaveBeenCalledOnceWith('Raccolta incompleta', 'Contate 2 parti; 1 parte non si è potuta confrontare. Le parti non contate restano da raccogliere.');
        expect(service.report).toHaveBeenCalledTimes(2);
        expect(text()).toContain('1 parte approvata non è ancora contata');
    });

    it('shows the progress of the collection and stops it on request', async () => {
        pendingTotal = 2;
        await render();
        pages = [{ total: 2, items: [pendingItem(11), pendingItem(21)] }];
        let release!: () => void;
        service.send.and.callFake(() => new Promise<void>((resolve) => (release = resolve)));

        const collecting = page().collect();
        await render();
        expect(text()).toContain('Confrontate 0 di 2');
        expect(page().progress).toBe(0);
        void page().collect();

        button('Interrompi')!.click();
        fixture.detectChanges();
        expect(button('Interrompi')!.disabled).toBeTrue();
        release();
        await collecting;

        expect(service.send).toHaveBeenCalledTimes(1);
        expect(toast.info).toHaveBeenCalledOnceWith('Raccolta interrotta', 'Contata 1 parte: le altre restano da raccogliere.');
        expect(page().collection).toBeNull();
    });

    it('completes the collection, and says when the approvals to collect cannot be read', async () => {
        await render();
        pages = [{ total: 1, items: [pendingItem(11)] }];
        await page().collect();
        expect(toast.success).toHaveBeenCalledOnceWith('Raccolta completata', 'Contata 1 parte tra le approvazioni precedenti.');

        service.pending.and.returnValue(throwError(() => new Error('offline')));
        await page().collect();
        expect(toast.warn).toHaveBeenCalledOnceWith('Raccolta incompleta', 'Nessuna parte contata; le approvazioni da raccogliere non si sono potute leggere. Le parti non contate restano da raccogliere.');
        expect(page().collection).toBeNull();
    });

    it('stops the collection without notices when the page closes', async () => {
        await render();
        pages = [{ total: 2, items: [pendingItem(11), pendingItem(21)] }];
        let release!: () => void;
        service.send.and.callFake(() => new Promise<void>((resolve) => (release = resolve)));

        const collecting = page().collect();
        await fixture.whenStable();
        fixture.destroy();
        release();
        await collecting;

        expect(service.send).toHaveBeenCalledTimes(1);
        expect(toast.info).not.toHaveBeenCalled();
        expect(service.report).toHaveBeenCalledTimes(1);
    });
});

describe('recognition helpers', () => {
    it('starts the last twelve months from the first day of eleven months ago', () => {
        expect(firstDayOfYearAgo(new Date(2026, 10, 16))).toBe('2025-12-01');
        expect(firstDayOfYearAgo(new Date(2026, 0, 31))).toBe('2025-02-01');
    });

    it('sorts the errors by frequency, with the share of their own base', () => {
        const rows = errorRows(REPORT.engines);
        expect(rows.map((row) => [row.label, row.total, row.cells.map((cell) => cell.share)])).toEqual([
            ['Altezze diverse', 6, [15, 0]],
            ['Ritmo diverso', 3, [5, 10]],
            ['Battute in più', 3, [7, 0]],
            ['Battute perse', 2, [5, 0]],
            ['Segni di struttura non letti', 1, [25, null]]
        ]);
        expect(errorRows([])).toEqual([]);
    });

    it('orders the months and leaves empty the engines without recognized versions', () => {
        expect(monthRows(REPORT)).toEqual([
            {
                month: '2026-10',
                label: 'ottobre 2026',
                cells: [
                    { engine: 'AUDIVERIS', share: 70, parts: 1 },
                    { engine: 'HOMR', share: null, parts: 0 }
                ]
            },
            {
                month: '2026-11',
                label: 'novembre 2026',
                cells: [
                    { engine: 'AUDIVERIS', share: 80, parts: 1 },
                    { engine: 'HOMR', share: 90, parts: 1 }
                ]
            }
        ]);
        expect(monthLabel('novembre')).toBe('novembre');
    });
});
