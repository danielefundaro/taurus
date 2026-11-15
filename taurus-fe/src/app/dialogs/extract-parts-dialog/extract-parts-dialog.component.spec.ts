import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Arrangement, ArrangementRowState, ExtractionResult, PartPlayback, PlaybackInstrument, TrackPlayback } from '../../module';
import { ArrangementService } from '../../service';
import { ExtractPartsDialogComponent, ExtractPartsDialogData, NEW_PART } from './extract-parts-dialog.component';

/** Parte protetta del dialogo usata dalle prove. */
interface Dialog {
    step: 'choose' | 'done';
    choices: { row: ArrangementRowState; name: string; targets: { value: number; label: string }[]; target: number; selected: boolean; rowBlocker: string | null }[];
    errors: string[];
    problem: string | null;
    extracted: { row: string; partLabel: string; created: boolean }[];
    heading: string;
    subtitle: string;
    selectedCount: number;
    blocker(choice: Dialog['choices'][number]): string | null;
    changedTarget(choice: Dialog['choices'][number]): void;
    extract(): Promise<void>;
    engrave(): void;
    cancel(): void;
}

const CLARINET: PlaybackInstrument = { id: 2, name: 'Clarinetto', transpositionSemitones: -2, configured: true };
const SNARE: PlaybackInstrument = { id: 5, name: 'Rullante', percussionKey: 38, configured: true };
const BASS_DRUM: PlaybackInstrument = { id: 6, name: 'Grancassa', percussionKey: 36, configured: true };
const HORN: PlaybackInstrument = { id: 13, name: 'Corno', configured: false };
const FLUTE: PlaybackInstrument = { id: 1, name: 'Flauto', transpositionSemitones: 0, configured: true };

const SINCE = new Date(2026, 10, 15, 10, 32).toISOString();

function part(scoreId: number, description: string, instruments: PlaybackInstrument[], overrides: Partial<PartPlayback> = {}): PartPlayback {
    return { scoreId, order: scoreId, description, instruments, ownPart: true, sound: { percussionKeys: [], configured: true, conflicting: false }, availability: 'AVAILABLE', hasPages: false, openReports: 0, ...overrides };
}

const PLAYBACK: TrackPlayback = {
    trackId: 5,
    trackName: 'Marcia reale',
    version: 2,
    recognitionAvailable: true,
    parts: [
        part(9, 'Clarinetto 1°', [CLARINET], { hasPages: true }),
        part(10, 'Clarinetto 2°', [CLARINET]),
        part(11, 'Percussioni', [SNARE, BASS_DRUM], { editing: { ownerName: 'Anna Bianchi', since: SINCE, expiresAt: SINCE, mine: false } }),
        part(12, 'Corno', [HORN])
    ]
};

function arrangement(concertPitch = false, overrides: Partial<Arrangement> = {}): Arrangement {
    return {
        id: 3,
        trackId: 5,
        currentVersion: { id: 21, versionNumber: 4, status: 'APPROVED', concertPitch, measureCount: 1, checks: [], createdAt: '2026-11-15T09:00:00Z', current: true },
        rows: [
            { id: 'P1', name: 'Clarinetto', instruments: [CLARINET], scoreId: 9, status: 'UP_TO_DATE', extractedFrom: 4 },
            { id: 'P2', name: 'Percussioni', instruments: [SNARE, BASS_DRUM], scoreId: 11, status: 'TO_EXTRACT', extractedFrom: 3 },
            { id: 'P3', name: 'Clarinetto 2', instruments: [CLARINET], scoreId: null, status: 'NEW' },
            { id: 'P4', name: 'Corno', instruments: [HORN], scoreId: null, status: 'NEW' },
            { id: 'P5', name: 'Flauto', instruments: [FLUTE], scoreId: null, status: 'PART_DELETED' }
        ],
        draft: null,
        editing: null,
        ...overrides
    };
}

/** Partitura con un rigo per ogni `id`, una battuta di 2/4 con un Do. */
function scoreXml(ids = ['P1', 'P2', 'P3', 'P4', 'P5']): string {
    const measure =
        '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure>';
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>${ids.map((id) => `<score-part id="${id}"><part-name>${id}</part-name></score-part>`).join('')}</part-list>${ids.map((id) => `<part id="${id}">${measure}</part>`).join('')}</score-partwise>`;
}

describe('ExtractPartsDialogComponent', () => {
    let fixture: ComponentFixture<ExtractPartsDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let arrangements: jasmine.SpyObj<ArrangementService>;
    let config: { data: ExtractPartsDialogData };

    beforeEach(async () => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        arrangements = jasmine.createSpyObj('ArrangementService', ['content', 'extract']);
        arrangements.content.and.resolveTo(scoreXml());
        config = { data: { trackId: 5, arrangement: arrangement(), playback: PLAYBACK, header: { title: 'Marcia reale', composer: 'G. Gabetti', arranger: '' }, canEngrave: true } };
        await TestBed.configureTestingModule({
            imports: [ExtractPartsDialogComponent],
            providers: [ConfirmationService, { provide: DynamicDialogConfig, useValue: config }, { provide: DynamicDialogRef, useValue: dialogRef }, { provide: ArrangementService, useValue: arrangements }]
        }).compileComponents();
    });

    function open(): Dialog {
        fixture = TestBed.createComponent(ExtractPartsDialogComponent);
        fixture.detectChanges();
        return fixture.componentInstance as unknown as Dialog;
    }

    it('proposes for every row a part with its instruments and chooses the rows to extract', () => {
        const dialog = open();

        expect(dialog.heading).toBe('Estrai le parti');
        expect(dialog.subtitle).toBe('Versione 4 della partitura, trasposta');
        expect(dialog.choices.map((choice) => [choice.row.id, choice.target, choice.selected])).toEqual([
            ['P1', 9, false],
            ['P2', 11, false],
            ['P3', 10, true],
            ['P4', 12, true],
            ['P5', NEW_PART, true]
        ]);
        expect(dialog.choices[0].targets.map((target) => target.label)).toEqual(['Clarinetto 1°', 'Clarinetto 2° · senza pagine', 'Parte nuova']);
        expect(dialog.choices[4].targets.map((target) => target.label)).toEqual(['Parte nuova']);
        expect(dialog.blocker(dialog.choices[1])).toBe('Percussioni: In modifica da Anna Bianchi dalle 10:32');
        expect(dialog.selectedCount).toBe(3);

        const host = fixture.nativeElement as HTMLElement;
        expect(Array.from(host.querySelectorAll('li p-tag')).map((tag) => tag.textContent?.trim())).toEqual(['Aggiornata', 'Da estrarre', 'Nuova', 'Nuova', 'Parte eliminata']);
        expect(host.querySelector<HTMLInputElement>('#extract-P2 input, input#extract-P2')?.disabled).toBeTrue();
        expect(host.textContent).toContain('In modifica da Anna Bianchi');
        expect(host.textContent).toContain('3 righi scelti');
        expect(host.textContent).not.toContain('La bozza non si estrae');
    });

    it('asks for a row and for a different part for every row', () => {
        const dialog = open();
        dialog.choices.forEach((choice) => (choice.selected = false));
        expect(dialog.errors).toEqual(['Scegli almeno un rigo da estrarre.']);

        dialog.choices[0].selected = true;
        dialog.choices[2].selected = true;
        dialog.choices[2].target = 9;
        dialog.changedTarget(dialog.choices[2]);
        expect(dialog.errors).toEqual(['La stessa parte è scelta per più righi: scegli una parte diversa o «Parte nuova».']);

        // Una parte in modifica toglie il rigo dalla scelta.
        dialog.choices[0].target = 11;
        dialog.changedTarget(dialog.choices[0]);
        expect(dialog.choices[0].selected).toBeFalse();
        expect(dialog.errors).toEqual([]);
    });

    it('blocks a row without transposition in a concert-pitch score and reminds that the draft is not extracted', () => {
        config.data = { ...config.data, arrangement: arrangement(true, { draft: { savedBy: 'Mario Rossi', savedAt: SINCE, outdated: false } }) };
        const dialog = open();

        expect(dialog.subtitle).toContain('in suoni reali');
        expect(dialog.choices[3].rowBlocker).toBe('Configura la trasposizione di Corno per estrarre il rigo da una partitura in suoni reali');
        expect(dialog.choices[3].selected).toBeFalse();
        expect(dialog.choices[1].rowBlocker).toBeNull();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('La bozza non si estrae');
    });

    it('builds the parts in the browser, extracts them and offers to engrave them', async () => {
        const result: ExtractionResult = {
            parts: [
                { row: 'P3', scoreId: 10, versionId: 100, created: false },
                { row: 'P4', scoreId: 12, versionId: 101, created: false },
                { row: 'P5', scoreId: 13, versionId: 102, created: true }
            ],
            trackVersion: 3
        };
        arrangements.extract.and.resolveTo(result);
        const dialog = open();

        await dialog.extract();
        fixture.detectChanges();

        expect(arrangements.content).toHaveBeenCalledWith(5, 21);
        const [trackId, versionId, request] = arrangements.extract.calls.mostRecent().args;
        expect([trackId, versionId, request.trackVersion]).toEqual([5, 21, 2]);
        expect(request.rows.map((row) => [row.row, row.sheetMusicId, row.description])).toEqual([
            ['P3', 10, null],
            ['P4', 12, null],
            ['P5', null, null]
        ]);
        expect(request.rows[0].content).toContain('<part-name>Clarinetto 2°</part-name>');
        expect(request.rows[0].content).toContain('<work-title>Marcia reale</work-title>');
        expect(request.rows[0].content).toContain('<creator type="composer">G. Gabetti</creator>');
        expect(request.rows[2].content).toContain('<part-name>Flauto</part-name>');
        expect(request.rows[2].content).toContain('<part id="P5">');

        expect(dialog.step).toBe('done');
        expect(dialog.heading).toBe('Parti estratte');
        expect(dialog.extracted).toEqual([
            jasmine.objectContaining({ row: 'Clarinetto 2', partLabel: 'Clarinetto 2°', created: false }),
            jasmine.objectContaining({ row: 'Corno', partLabel: 'Corno', created: false }),
            jasmine.objectContaining({ row: 'Flauto', partLabel: 'Flauto', created: true })
        ]);
        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Parte nuova, senza pagine');
        expect(host.textContent).toContain('Dal rigo Clarinetto 2');

        dialog.engrave();
        expect(dialogRef.close).toHaveBeenCalledWith({
            result,
            engrave: [
                { scoreId: 10, versionId: 100, partLabel: 'Clarinetto 2°', hasPages: false },
                { scoreId: 12, versionId: 101, partLabel: 'Corno', hasPages: false },
                { scoreId: 13, versionId: 102, partLabel: 'Flauto', hasPages: false }
            ]
        });
    });

    it('closes with the extracted parts and nothing to engrave, or without a result before the extraction', async () => {
        config.data = { ...config.data, canEngrave: false };
        arrangements.extract.and.resolveTo({ parts: [{ row: 'P5', scoreId: 13, versionId: 102, created: true }], trackVersion: 3 });
        const dialog = open();
        dialog.cancel();
        expect(dialogRef.close).toHaveBeenCalledWith(undefined);

        dialog.choices.forEach((choice) => (choice.selected = choice.row.id === 'P5'));
        await dialog.extract();
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Impagina le parti');
        dialog.cancel();
        expect(dialogRef.close).toHaveBeenCalledWith({ result: { parts: [{ row: 'P5', scoreId: 13, versionId: 102, created: true }], trackVersion: 3 }, engrave: null });
    });

    it('explains a score that cannot be read or a row that cannot be built, and keeps the choice after a refused extraction', async () => {
        const dialog = open();
        arrangements.content.and.rejectWith(new Error('offline'));
        await dialog.extract();
        expect(dialog.problem).toBe('La partitura non si legge: riprova più tardi.');
        expect(arrangements.extract).not.toHaveBeenCalled();

        arrangements.content.and.resolveTo(scoreXml(['P1', 'P2', 'P3', 'P4']));
        await dialog.extract();
        expect(dialog.problem).toBe('Il rigo Flauto non è nella partitura: le parti non si estraggono.');

        arrangements.content.and.resolveTo(scoreXml());
        arrangements.extract.and.rejectWith(new Error('conflict'));
        await dialog.extract();
        expect(dialog.problem).toBeNull();
        expect(dialog.step).toBe('choose');
        expect(dialog.selectedCount).toBe(3);
    });
});
