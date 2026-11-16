import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { NewArrangement, PartPlayback, PlaybackInstrument, TrackPlayback } from '../../module';
import { newPartXml } from '../../score-editor/new-part';
import { ArrangementService, InstrumentsService, ScorePlaybackService } from '../../service';
import { NewArrangementDialogComponent, NewArrangementDialogData } from './new-arrangement-dialog.component';

const FLUTE = { id: 1, name: 'Flauto', transpositionSemitones: 0, ensemblePosition: 0 };
const CLARINET = { id: 2, name: 'Clarinetto', transpositionSemitones: -2, ensemblePosition: 1 };
const SNARE = { id: 5, name: 'Rullante', percussionKey: 38, ensemblePosition: 2 };
const BASS_DRUM = { id: 6, name: 'Grancassa', percussionKey: 36, ensemblePosition: 3 };
const TUBA = { id: 7, name: 'Tuba', transpositionSemitones: 0 };
const EUPHONIUM = { id: 8, name: 'Euphonium', transpositionSemitones: -14, bassClefTranspositionSemitones: 0 };
const HORN = { id: 9, name: 'Corno' };
const CATALOG = [FLUTE, CLARINET, SNARE, BASS_DRUM, TUBA, EUPHONIUM, HORN];

const playbackInstrument = (instrument: { id: number; name: string }): PlaybackInstrument => ({ ...instrument, configured: true });

/** Parte di riferimento: clarinetto in Re maggiore scritto, 2/4, tre battute. */
const CLARINET_XML = newPartXml({ partName: 'Clarinetto', clef: 'G2', fifths: 2, beats: 2, beatType: 4, tempo: null, measures: 3, pickupBeats: 0 });
const LOW_BRASS_XML = newPartXml({ partName: 'Tube', clef: 'F4', fifths: 0, beats: 2, beatType: 4, tempo: null, measures: 2, pickupBeats: 0 });
const DRUMS_XML = newPartXml({ partName: 'Percussioni', clef: 'percussion', fifths: 0, beats: 2, beatType: 4, tempo: null, measures: 3, pickupBeats: 0 });

function part(scoreId: number, description: string, instruments: { id: number; name: string }[], withVersion = true): PartPlayback {
    return {
        scoreId,
        order: scoreId,
        description,
        instruments: instruments.map(playbackInstrument),
        ownPart: true,
        sound: { transpositionSemitones: instruments.length === 1 ? ((instruments[0] as { transpositionSemitones?: number }).transpositionSemitones ?? null) : null, percussionKeys: [], configured: true, conflicting: false },
        availability: 'AVAILABLE',
        version: withVersion ? { id: scoreId * 10, versionNumber: 1, status: 'APPROVED', origin: 'WRITING', measureCount: 3, checks: null as never, pagesChanged: false } : null,
        hasPages: false,
        openReports: 0
    };
}

describe('NewArrangementDialogComponent', () => {
    let fixture: ComponentFixture<NewArrangementDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let playbackService: jasmine.SpyObj<ScorePlaybackService>;
    let arrangements: jasmine.SpyObj<ArrangementService>;
    let instruments: jasmine.SpyObj<InstrumentsService>;
    let config: { data: NewArrangementDialogData };

    const playback = (parts: PartPlayback[], referenceScoreId: number | null = null): TrackPlayback => ({ trackId: 5, trackName: 'Marcia', version: 2, tempoBpm: 96, referenceScoreId, parts, recognitionAvailable: false });
    const files: Record<number, string> = { 1: CLARINET_XML, 2: LOW_BRASS_XML, 4: DRUMS_XML };

    beforeEach(async () => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        playbackService = jasmine.createSpyObj('ScorePlaybackService', ['playbackFile']);
        playbackService.playbackFile.and.callFake((_trackId: number, scoreId: number) => (files[scoreId] ? of(files[scoreId]) : throwError(() => new Error('missing'))));
        arrangements = jasmine.createSpyObj('ArrangementService', ['create']);
        arrangements.create.and.resolveTo({ id: 3, trackId: 5, rows: [] });
        instruments = jasmine.createSpyObj('InstrumentsService', ['getAll']);
        instruments.getAll.and.returnValue(of({ content: CATALOG, totalElements: CATALOG.length }) as never);
        config = { data: { trackId: 5, playback: playback([]) } };
        await TestBed.configureTestingModule({
            imports: [NewArrangementDialogComponent],
            providers: [
                ConfirmationService,
                provideRouter([]),
                { provide: DynamicDialogConfig, useValue: config },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playbackService },
                { provide: ArrangementService, useValue: arrangements },
                { provide: InstrumentsService, useValue: instruments }
            ]
        }).compileComponents();
    });

    async function open(): Promise<Dialog> {
        fixture = TestBed.createComponent(NewArrangementDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.componentInstance as unknown as Dialog;
    }

    const sent = (): NewArrangement => arrangements.create.calls.mostRecent().args[1];
    const xml = (content: string): Document => new DOMParser().parseFromString(content, 'application/xml');

    it('proposes a row for every instrument of the ensemble, with the percussion together, and creates the score', async () => {
        const dialog = await open();

        expect(dialog.loading).toBeFalse();
        expect(dialog.sources.map((source) => source.value)).toEqual(['ensemble']);
        expect(dialog.instrumentIds).toEqual([1, 2, 5, 6]);
        expect(dialog.plannedRows.map((row) => row.name)).toEqual(['Flauto', 'Clarinetto', 'Percussioni']);
        expect(dialog.tempo).toBe(96);
        expect(dialog.errors).toEqual([]);
        expect(dialog.unconfigured).toEqual([]);
        expect(fixture.nativeElement.textContent).not.toContain('Organico vuoto');

        // Uno strumento fuori dall'organico va dopo quelli dell'organico.
        dialog.instrumentIds = [7, 1, 2, 5, 6];
        dialog.changed();
        expect(dialog.plannedRows.map((row) => row.name)).toEqual(['Flauto', 'Clarinetto', 'Percussioni', 'Tuba']);
        dialog.concertKey = -1;
        await dialog.save();

        expect(arrangements.create).toHaveBeenCalledWith(5, jasmine.any(Object), jasmine.anything());
        expect(sent().rows).toEqual([
            { id: 'P1', instrumentIds: [1] },
            { id: 'P2', instrumentIds: [2] },
            { id: 'P3', instrumentIds: [5, 6] },
            { id: 'P4', instrumentIds: [7] }
        ]);
        const document = xml(sent().content);
        expect(Array.from(document.querySelectorAll('part-name')).map((name) => name.textContent)).toEqual(['Flauto', 'Clarinetto', 'Percussioni', 'Tuba']);
        // Trasposta: il clarinetto scrive un tono sopra, la tuba resta in Fa maggiore.
        expect(Array.from(document.querySelectorAll('part')).map((item) => item.querySelector('fifths')?.textContent ?? '')).toEqual(['-1', '1', '0', '-1']);
        expect(document.querySelector('concert-score')).toBeNull();
        expect(dialogRef.close).toHaveBeenCalledWith({ arrangement: { id: 3, trackId: 5, rows: [] } });
    });

    it('checks the choices and warns about instruments without a transposition', async () => {
        const dialog = await open();

        dialog.instrumentIds = [];
        expect(dialog.errors).toContain('Scegli almeno uno strumento.');
        dialog.instrumentIds = [9];
        dialog.measures = 0;
        expect(dialog.errors.length).toBe(1);
        expect(dialog.error('Le battute')).toBeDefined();
        expect(dialog.unconfigured).toEqual(['Corno']);
        dialog.concertPitch = true;
        expect(dialog.unconfigured).toEqual([]);
        dialog.beatType = 8;
        expect(dialog.pickupLabel).toBe('Levare (in crome)');

        await dialog.save();
        expect(arrangements.create).not.toHaveBeenCalled();
    });

    it('opens the ensemble of the band when it is empty', async () => {
        instruments.getAll.and.returnValue(of({ content: [TUBA, HORN], totalElements: 2 }) as never);
        const router = TestBed.inject(Router);
        spyOn(router, 'navigate').and.resolveTo(true);
        const dialog = await open();

        expect(dialog.instrumentIds).toEqual([]);
        expect(fixture.nativeElement.textContent).toContain('Organico vuoto');
        dialog.openEnsemble();
        expect(dialogRef.close).toHaveBeenCalledWith();
        expect(router.navigate).toHaveBeenCalledWith(['/instruments'], { queryParams: { tab: 'ensemble' } });
    });

    it('makes a row of every part with notes, aligned to the reference part, and writes it in concert pitch', async () => {
        config.data = {
            trackId: 5,
            playback: playback([part(1, 'Clarinetto', [CLARINET]), part(2, 'Tube', [TUBA, EUPHONIUM]), part(3, 'Flauto', [FLUTE], false), part(4, 'Percussioni', [SNARE, BASS_DRUM])], 1)
        };
        const dialog = await open();

        expect(dialog.sources.map((source) => source.value)).toEqual(['ensemble', 'parts']);
        expect(dialog.partsWithoutNotes).toBe(1);
        expect(dialog.parts.map((choice) => choice.label)).toEqual(['Clarinetto', 'Percussioni', 'Tube']);
        expect(dialog.referenceId).toBe(1);
        // Il clarinetto in Re maggiore scritto suona in Do; metro e battute vengono da lui.
        expect([dialog.concertKey, dialog.beats, dialog.beatType, dialog.measures]).toEqual([0, 2, 4, 3]);
        expect(dialog.parts[2].options.map((instrument) => instrument.id)).toEqual([7, 8]);
        expect(dialog.parts[2].instrumentId).toBe(7);
        expect(dialog.parts[1].options).toEqual([]);
        expect(dialog.parts[2].changes).toEqual(['1 battuta in meno, completata con pause']);

        dialog.source = 'parts';
        dialog.changed();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('1 parte senza note non diventa un rigo.');
        expect(fixture.nativeElement.textContent).toContain('1 battuta in meno, completata con pause');

        dialog.parts[2].instrumentId = null;
        expect(dialog.errors).toContain('Scegli lo strumento di ogni parte.');
        dialog.parts[2].instrumentId = 8;
        dialog.concertPitch = true;
        expect(dialog.errors).toEqual([]);
        await dialog.save();

        expect(sent().rows).toEqual([
            { id: 'P1', instrumentIds: [2], scoreId: 1 },
            { id: 'P2', instrumentIds: [5, 6], scoreId: 4 },
            { id: 'P3', instrumentIds: [8], scoreId: 2 }
        ]);
        const document = xml(sent().content);
        expect(document.querySelector('defaults > concert-score')).not.toBeNull();
        expect(Array.from(document.querySelectorAll('part')).map((item) => [item.querySelectorAll('measure').length, item.querySelector('fifths')?.textContent])).toEqual([
            [3, '0'],
            [3, '0'],
            [3, '0']
        ]);
    });

    it('moves the reference to another part when its own is left out', async () => {
        config.data = { trackId: 5, playback: playback([part(1, 'Clarinetto', [CLARINET]), part(2, 'Tube', [TUBA])], 1) };
        const dialog = await open();
        dialog.source = 'parts';

        dialog.parts[0].selected = false;
        dialog.changedParts();
        expect(dialog.referenceId).toBe(2);
        expect(dialog.parts[1].changes).toEqual([]);

        dialog.parts[1].selected = false;
        dialog.changedParts();
        expect(dialog.referenceId).toBeNull();
        expect(dialog.errors).toContain('Scegli almeno una parte.');

        dialog.parts[0].selected = true;
        dialog.parts[1].selected = true;
        dialog.changedParts();
        dialog.referenceId = 2;
        dialog.changedReference();
        expect(dialog.parts[0].changes).toEqual(['1 battuta in più, tolta']);
    });

    it('stays open when the score is not created', async () => {
        arrangements.create.and.rejectWith(new Error('conflict'));
        const dialog = await open();

        await dialog.save();

        expect(dialog.saving).toBeFalse();
        expect(dialogRef.close).not.toHaveBeenCalled();
        dialog.cancel();
        expect(dialogRef.close).toHaveBeenCalledWith();
    });
});

interface Dialog {
    loading: boolean;
    saving: boolean;
    sources: { label: string; value: string }[];
    source: 'ensemble' | 'parts';
    instrumentIds: number[];
    concertKey: number;
    beats: number;
    beatType: number;
    tempo: number | null;
    measures: number;
    concertPitch: boolean;
    referenceId: number | null;
    partsWithoutNotes: number;
    parts: { label: string; selected: boolean; options: { id: number }[]; instrumentId: number | null; changes: string[] }[];
    plannedRows: { name: string }[];
    errors: string[];
    unconfigured: string[];
    pickupLabel: string;
    error(text: string): string | undefined;
    changed(): void;
    changedParts(): void;
    changedReference(): void;
    openEnsemble(): void;
    cancel(): void;
    save(): Promise<void>;
}
