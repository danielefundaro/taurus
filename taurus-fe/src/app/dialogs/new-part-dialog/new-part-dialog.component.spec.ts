import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { PartPlayback, TrackPlayback } from '../../module';
import { newPartXml } from '../../score-editor/new-part';
import { InstrumentsService, ScoreDraftService, ScorePlaybackService } from '../../service';
import { NewPartDialogComponent, NewPartDialogData } from './new-part-dialog.component';

/** Parte di riferimento in 3/4, scritta in Do per il clarinetto in Si bemolle: suona in Si bemolle. */
const REFERENCE = newPartXml({ partName: 'Clarinetto', clef: 'G2', fifths: 0, beats: 3, beatType: 4, tempo: null, measures: 24, pickupBeats: 1 });

const INSTRUMENTS = [
    { id: 11, name: 'Tuba', transpositionSemitones: 0 },
    { id: 12, name: 'Tromba in Sib', transpositionSemitones: -2 },
    { id: 13, name: 'Rullante', percussionKey: 38 }
];

function referencePart(overrides: Partial<PartPlayback> = {}): PartPlayback {
    return {
        scoreId: 1,
        order: 1,
        instruments: [{ id: 14, name: 'Clarinetto in Sib', transpositionSemitones: -2, configured: true }],
        ownPart: true,
        sound: { transpositionSemitones: -2, percussionKeys: [], configured: true, conflicting: false },
        availability: 'AVAILABLE',
        version: { id: 7, versionNumber: 2, status: 'APPROVED', origin: 'OMR_AUDIVERIS', measureCount: 25, checks: null as never, pagesChanged: false },
        hasPages: true,
        openReports: 0,
        ...overrides
    };
}

describe('NewPartDialogComponent', () => {
    let fixture: ComponentFixture<NewPartDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let playbackService: jasmine.SpyObj<ScorePlaybackService>;
    let drafts: jasmine.SpyObj<ScoreDraftService>;
    let instruments: jasmine.SpyObj<InstrumentsService>;
    let config: { data: NewPartDialogData };

    const playback = (parts: PartPlayback[]): TrackPlayback => ({ trackId: 5, trackName: 'Marcia', version: 2, tempoBpm: 96, parts, recognitionAvailable: false });

    beforeEach(async () => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        playbackService = jasmine.createSpyObj('ScorePlaybackService', ['playbackFile']);
        playbackService.playbackFile.and.returnValue(of(REFERENCE));
        drafts = jasmine.createSpyObj('ScoreDraftService', ['createWrittenPart']);
        drafts.createWrittenPart.and.resolveTo({ scoreId: 12, trackVersion: 3 });
        instruments = jasmine.createSpyObj('InstrumentsService', ['getAll']);
        instruments.getAll.and.returnValue(of({ content: INSTRUMENTS, totalElements: INSTRUMENTS.length }) as never);
        config = { data: { trackId: 5, playback: playback([referencePart()]) } };
        await TestBed.configureTestingModule({
            imports: [NewPartDialogComponent],
            providers: [
                ConfirmationService,
                { provide: DynamicDialogConfig, useValue: config },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playbackService },
                { provide: ScoreDraftService, useValue: drafts },
                { provide: InstrumentsService, useValue: instruments }
            ]
        }).compileComponents();
    });

    async function open(): Promise<Dialog> {
        fixture = TestBed.createComponent(NewPartDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.componentInstance as unknown as Dialog;
    }

    it('proposes time, measures, pickup and tempo from the reference part of the track', async () => {
        const dialog = await open();

        expect(playbackService.playbackFile).toHaveBeenCalledWith(5, 1);
        expect(dialog.loading).toBeFalse();
        expect([dialog.beats, dialog.beatType, dialog.measures, dialog.pickupBeats, dialog.tempo]).toEqual([3, 4, 24, 1, 96]);
        // Il clarinetto scrive in Do e suona in Si bemolle: senza strumenti la parte si scrive in suoni reali.
        expect(dialog.fifths).toBe(-2);
        expect(dialog.clef).toBe('G2');
        expect(dialog.keyHint).toContain('Proposta da «Clarinetto in Sib»');
    });

    it('proposes clef and written key from the instruments, transposing only a part of one instrument', async () => {
        const dialog = await open();

        dialog.instrumentIds = [11];
        dialog.changedInstruments();
        expect([dialog.clef, dialog.fifths]).toEqual(['F4', -2]);

        dialog.instrumentIds = [12];
        dialog.changedInstruments();
        expect([dialog.clef, dialog.fifths]).toEqual(['G2', 0]);
        expect(dialog.keyHint).toContain('trasportata per lo strumento');

        dialog.instrumentIds = [11, 12];
        dialog.changedInstruments();
        expect([dialog.clef, dialog.fifths]).toEqual(['F4', -2]);

        dialog.instrumentIds = [13];
        dialog.changedInstruments();
        expect(dialog.clef).toBe('percussion');

        // Scelte a mano, chiave e armatura non seguono più gli strumenti.
        dialog.clef = 'C3';
        dialog.changedClef();
        dialog.fifths = 3;
        dialog.changedKey();
        dialog.instrumentIds = [11];
        dialog.changedInstruments();
        expect([dialog.clef, dialog.fifths]).toEqual(['C3', 3]);
    });

    it('creates the part at the end of the track with its first draft', async () => {
        const dialog = await open();
        dialog.description = '  Seconda tuba ';
        dialog.instrumentIds = [11];
        dialog.changedInstruments();

        await dialog.save();

        const [trackId, request] = drafts.createWrittenPart.calls.mostRecent().args;
        expect(trackId).toBe(5);
        expect(request).toEqual(jasmine.objectContaining({ description: 'Seconda tuba', instrumentIds: [11], trackVersion: 2 }));
        const document = new DOMParser().parseFromString(request.content, 'application/xml');
        expect(document.querySelector('part-name')?.textContent).toBe('Seconda tuba');
        expect(document.querySelector('fifths')?.textContent).toBe('-2');
        expect(document.querySelector('clef sign')?.textContent).toBe('F');
        expect(document.querySelectorAll('measure').length).toBe(25);
        expect(dialogRef.close).toHaveBeenCalledWith({ kind: 'created', scoreId: 12, trackVersion: 3 });
    });

    it('stays open when the part is not created', async () => {
        drafts.createWrittenPart.and.rejectWith(new Error('version.conflict'));
        const dialog = await open();

        await dialog.save();
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(dialog.saving).toBeFalse();
    });

    it('does not create a part with a pickup as long as a measure', async () => {
        const dialog = await open();
        dialog.pickupBeats = 3;

        expect(dialog.errors).toEqual(['La levare è più breve di una battuta.']);
        await dialog.save();
        expect(drafts.createWrittenPart).not.toHaveBeenCalled();
    });

    it('prepares the content of an existing part without notes, from its instruments', async () => {
        const empty = referencePart({ scoreId: 3, order: 2, description: 'Basso', instruments: [{ id: 11, name: 'Tuba', transpositionSemitones: 0, configured: true }], version: null, availability: 'NOT_AVAILABLE' });
        config.data = { trackId: 5, playback: playback([referencePart(), empty]), part: empty };
        const dialog = await open();

        expect(instruments.getAll).not.toHaveBeenCalled();
        expect(dialog.heading).toBe('Scrivi Basso');
        expect(dialog.clef).toBe('F4');
        await dialog.save();

        expect(drafts.createWrittenPart).not.toHaveBeenCalled();
        const result = dialogRef.close.calls.mostRecent().args[0];
        expect(result.kind).toBe('prepared');
        expect(result.content).toContain('<part-name>Basso</part-name>');
    });

    it('proposes no key when no other part can be read', async () => {
        playbackService.playbackFile.and.returnValue(throwError(() => new Error('offline')));
        const dialog = await open();

        expect(dialog.loading).toBeFalse();
        expect([dialog.beats, dialog.beatType, dialog.measures, dialog.fifths, dialog.tempo]).toEqual([4, 4, 16, 0, 96]);
        expect(dialog.keyHint).toContain('Nessuna altra parte');
    });
});

interface Dialog {
    loading: boolean;
    saving: boolean;
    description: string;
    instrumentIds: number[];
    clef: string;
    fifths: number;
    beats: number;
    beatType: number;
    tempo: number | null;
    measures: number;
    pickupBeats: number;
    heading: string;
    keyHint: string;
    errors: string[];
    changedInstruments(): void;
    changedClef(): void;
    changedKey(): void;
    save(): Promise<void>;
}
