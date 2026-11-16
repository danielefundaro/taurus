import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { ArrangementDraft, ArrangementVersion, PlaybackInstrument, ScoreDraft, ScoreEditorData } from '../../module';
import {
    ArrangementService,
    ConfirmService,
    DraftKeeperOptions,
    DraftState,
    EditLockState,
    InstrumentsService,
    LocalDraftCopy,
    MediaService,
    MidiInputService,
    MidiStatus,
    PlayedNote,
    ScoreAudioService,
    ScoreClipboardService,
    ScoreDraftService,
    ScoreEditLockService,
    ScorePlaybackService,
    ScoreRecognitionService,
    ScoreRendererService
} from '../../service';
import { LayoutPage } from '../../score-editor/score-layout';
import { ScoreLayoutClient } from '../../score-editor/score-layout-client';
import { isEngraveRequest, ScoreEditorDialogComponent, ScoreEditorDialogData } from './score-editor-dialog.component';

const XML = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tuba</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
<note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note></measure>
<measure number="2"><note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure>
</part></score-partwise>`;

/** Parte di percussioni nuova: chiave di percussione, 2/4, due battute di pausa. */
const DRUMS = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Percussioni</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><rest measure="yes"/><duration>2</duration><voice>1</voice></note></measure>
<measure number="2"><note><rest measure="yes"/><duration>2</duration><voice>1</voice></note></measure>
</part></score-partwise>`;

/** Strumenti della partitura: clarinetto in Si♭, tuba in Do e, nel catalogo, un sax contralto in Mi♭. */
const CLARINET: PlaybackInstrument = { id: 10, name: 'Clarinetto', transpositionSemitones: -2, soundProgram: 71, configured: true };
const TUBA: PlaybackInstrument = { id: 11, name: 'Tuba', transpositionSemitones: 0, soundProgram: 58, configured: true };
const ALTO_SAX: PlaybackInstrument = { id: 12, name: 'Sax contralto', transpositionSemitones: -9, soundProgram: 65, configured: true };

/** Partitura trasposta in 2/4: clarinetto in Re maggiore scritto, tuba in Do, due battute. */
const ARRANGEMENT = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinetto</part-name></score-part><score-part id="P2"><part-name>Tuba</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure>
<measure number="2"><note><rest measure="yes"/><duration>2</duration><voice>1</voice></note></measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure>
<measure number="2"><note><rest measure="yes"/><duration>2</duration><voice>1</voice></note></measure></part></score-partwise>`;

/** Disegno finto, come Verovio: una battuta disegnata per ogni battuta del primo rigo, con il suo `id`. */
function fakeDrawing(xml: string): string {
    const part = /<part [\s\S]*?<\/part>/.exec(xml)?.[0] ?? xml;
    return `<svg>${Array.from(part.matchAll(/<measure[^>]* id="([^"]+)"/g), (match) => `<g class="measure" id="${match[1]}"></g>`).join('')}</svg>`;
}

describe('ScoreEditorDialogComponent', () => {
    let fixture: ComponentFixture<ScoreEditorDialogComponent>;
    let renderer: jasmine.SpyObj<ScoreRendererService>;
    let playbackService: jasmine.SpyObj<ScorePlaybackService>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let lockState: WritableSignal<EditLockState>;
    let lock: { session: string; state: () => EditLockState; readonly held: boolean; acquire: jasmine.Spy; refused: jasmine.Spy; release: jasmine.Spy };
    let config: { data: ScoreEditorDialogData };
    let drafts: jasmine.SpyObj<ScoreDraftService>;
    let keeperState: WritableSignal<DraftState>;
    let keeper: FakeKeeper;
    let keeperOptions: DraftKeeperOptions | undefined;
    let audio: jasmine.SpyObj<ScoreAudioService>;
    let midi: FakeMidi;
    let arrangements: jasmine.SpyObj<ArrangementService>;
    let lockService: { forPart: jasmine.Spy; forArrangement: jasmine.Spy };
    let confirm: jasmine.SpyObj<ConfirmService>;
    let recognition: jasmine.SpyObj<ScoreRecognitionService>;

    beforeEach(async () => {
        lockState = signal<EditLockState>({ status: 'acquiring', message: null });
        lock = {
            session: 'editor-window-1',
            state: lockState.asReadonly(),
            get held() {
                return lockState().status === 'held';
            },
            acquire: jasmine.createSpy('acquire').and.callFake(async () => {
                lockState.set({ status: 'held', message: null });
                return true;
            }),
            refused: jasmine.createSpy('refused').and.returnValue(false),
            release: jasmine.createSpy('release')
        };
        const editor: ScoreEditorData = {
            version: { id: 7, scoreId: 9, versionNumber: 2, origin: 'OMR_AUDIVERIS', status: 'UNVERIFIED', measureCount: 2, checks: null as never, createdAt: '2026-10-18T10:00:00Z', current: true, pagesChanged: false },
            musicXml: XML,
            pages: [],
            layout: null
        };
        const data: ScoreEditorDialogData = { trackId: 4, scoreId: 9, versionId: 7, partLabel: 'Tuba', sound: { percussionKeys: [], configured: true, conflicting: false } };
        config = { data };
        keeperState = signal<DraftState>({ status: 'clean', savedAt: null, message: null });
        keeper = {
            state: keeperState.asReadonly(),
            dirty: false,
            changed: jasmine.createSpy('changed'),
            flush: jasmine.createSpy('flush').and.resolveTo(true),
            hold: jasmine.createSpy('hold').and.resolveTo(),
            resume: jasmine.createSpy('resume'),
            completed: jasmine.createSpy('completed').and.resolveTo(),
            forget: jasmine.createSpy('forget').and.resolveTo(),
            overwrite: jasmine.createSpy('overwrite').and.resolveTo(true),
            reset: jasmine.createSpy('reset').and.resolveTo(),
            stop: jasmine.createSpy('stop'),
            content: () => keeperOptions!.content()
        };
        keeperOptions = undefined;
        drafts = jasmine.createSpyObj<ScoreDraftService>('ScoreDraftService', ['draft', 'discard', 'localCopy', 'forgetLocalCopy', 'keeper', 'arrangementLocalCopy', 'forgetArrangementLocalCopy', 'arrangementKeeper']);
        drafts.arrangementLocalCopy.and.resolveTo(null);
        drafts.forgetArrangementLocalCopy.and.resolveTo();
        drafts.arrangementKeeper.and.callFake((_trackId: number, options: DraftKeeperOptions) => {
            keeperOptions = options;
            return keeper as never;
        });
        arrangements = jasmine.createSpyObj<ArrangementService>('ArrangementService', ['content', 'draft', 'discardDraft', 'save']);
        arrangements.content.and.resolveTo(ARRANGEMENT);
        arrangements.draft.and.resolveTo(null);
        arrangements.discardDraft.and.resolveTo();
        lockService = { forPart: jasmine.createSpy('forPart').and.callFake(() => lock), forArrangement: jasmine.createSpy('forArrangement').and.callFake(() => lock) };
        confirm = jasmine.createSpyObj('ConfirmService', ['confirmDiscard', 'confirmReversible', 'confirmDestructive']);
        drafts.draft.and.resolveTo(null);
        drafts.discard.and.resolveTo();
        drafts.localCopy.and.resolveTo(null);
        drafts.forgetLocalCopy.and.resolveTo();
        drafts.keeper.and.callFake((_trackId: number, _scoreId: number, options: DraftKeeperOptions) => {
            keeperOptions = options;
            return keeper as never;
        });
        renderer = jasmine.createSpyObj('ScoreRendererService', ['renderPrepared', 'layoutWorker']);
        renderer.renderPrepared.and.callFake(async (xml: string) => [fakeDrawing(xml)]);
        playbackService = jasmine.createSpyObj('ScorePlaybackService', ['editor', 'errorReports', 'correct']);
        playbackService.editor.and.returnValue(of(editor));
        playbackService.errorReports.and.returnValue(of([]));
        playbackService.correct.and.returnValue(of({ ...editor.version, id: 8, versionNumber: 3, origin: 'CORRECTION' }));
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        recognition = jasmine.createSpyObj('ScoreRecognitionService', ['collect']);
        recognition.collect.and.resolveTo(true);
        audio = jasmine.createSpyObj('ScoreAudioService', ['ready', 'load', 'play', 'pause', 'setChannel', 'preview']);
        audio.ready.and.resolveTo(null as never);
        audio.preview.and.resolveTo();
        const midiStatus = signal<MidiStatus>('idle');
        midi = {
            supported: true,
            status: midiStatus,
            devices: signal([]),
            deviceId: signal<string | null>(null),
            threshold: signal(80),
            played: new Subject<PlayedNote>(),
            connect: jasmine.createSpy('connect').and.callFake(async () => midiStatus.set('ready')),
            select: jasmine.createSpy('select'),
            setThreshold: jasmine.createSpy('setThreshold')
        };

        await TestBed.configureTestingModule({
            imports: [ScoreEditorDialogComponent],
            providers: [
                ConfirmationService,
                provideRouter([]),
                { provide: DynamicDialogConfig, useValue: config },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playbackService },
                { provide: ScoreRendererService, useValue: renderer },
                { provide: MediaService, useValue: jasmine.createSpyObj('MediaService', ['streamImage']) },
                { provide: ScoreAudioService, useValue: audio },
                { provide: MidiInputService, useValue: midi },
                { provide: ConfirmService, useValue: confirm },
                { provide: ScoreEditLockService, useValue: lockService },
                { provide: ScoreDraftService, useValue: drafts },
                { provide: ArrangementService, useValue: arrangements },
                { provide: ScoreRecognitionService, useValue: recognition },
                { provide: InstrumentsService, useValue: { getAll: () => of({ content: [CLARINET, TUBA, ALTO_SAX], totalElements: 3 }) } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ScoreEditorDialogComponent);
    });

    it('plays the selected measure of the part and stops', async () => {
        audio.load.and.resolveTo();
        audio.play.and.resolveTo();
        fixture.detectChanges();
        await fixture.whenStable();
        const component = fixture.componentInstance as unknown as { togglePlay(): Promise<void>; playing: boolean };

        await component.togglePlay();
        expect(audio.load).toHaveBeenCalledTimes(1);
        expect(audio.setChannel.calls.allArgs().map(([channel]) => channel.key)).toEqual(['__metronome__']);
        expect(component.playing).toBeTrue();

        await component.togglePlay();
        expect(audio.pause).toHaveBeenCalled();
        expect(component.playing).toBeFalse();
    });

    it('opens the version and draws the notation inside the editor', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const component = fixture.componentInstance as unknown as { status: string; selectionLabel: string };
        expect(component.status).toBe('ready');
        expect(renderer.renderPrepared).toHaveBeenCalledTimes(1);
        expect(fixture.nativeElement.querySelector('.score-editor__notation svg')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.score-editor__notation g.measure.is-current-measure')).not.toBeNull();
        expect(component.selectionLabel).toBe('Battuta 1 · Do3 · semiminima');
    });

    it('opens the correction at the measure of a difference of the comparison', async () => {
        fixture.destroy();
        config.data = { ...config.data, measureIndex: 1 };
        fixture = TestBed.createComponent(ScoreEditorDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect((fixture.componentInstance as unknown as { selectionLabel: string }).selectionLabel).toBe('Battuta 2 · Mi3 · minima');
    });

    it('opens the correction at the first note for a measure that is not in the version', async () => {
        fixture.destroy();
        config.data = { ...config.data, measureIndex: 5 };
        fixture = TestBed.createComponent(ScoreEditorDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect((fixture.componentInstance as unknown as { selectionLabel: string }).selectionLabel).toBe('Battuta 1 · Do3 · semiminima');
    });

    it('draws quick edits once, at the next frame', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const component = fixture.componentInstance as unknown as { move(steps: number): void };

        component.move(1);
        component.move(1);
        component.move(1);
        expect(renderer.renderPrepared).toHaveBeenCalledTimes(1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await fixture.whenStable();

        expect(renderer.renderPrepared).toHaveBeenCalledTimes(2);
        expect(renderer.renderPrepared.calls.mostRecent().args[0].split('<step>F</step>').length - 1).toBe(1);
    });

    it('goes back to the track from the top left button, asking first when there are unsaved corrections', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const confirmService = TestBed.inject(ConfirmService) as jasmine.SpyObj<ConfirmService>;
        const back = (): void => fixture.nativeElement.querySelector('.score-editor__header > p-button:first-child button').click();

        back();
        expect(dialogRef.close).toHaveBeenCalledTimes(1);
        expect(confirmService.confirmDiscard).not.toHaveBeenCalled();

        (fixture.componentInstance as unknown as { move(steps: number): void }).move(1);
        back();
        expect(confirmService.confirmDiscard).toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledTimes(1);
    });

    it('selects a measure without notes and fills it with a rest, also from the checks', async () => {
        const empty = XML.replace(/<measure number="2">[\s\S]*?<\/measure>/, '<measure number="2"></measure>');
        const editor = await firstValueFrom(playbackService.editor(4, 9, 7));
        playbackService.editor.and.returnValue(of({ ...editor, musicXml: empty }));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const component = fixture.componentInstance as unknown as {
            emptyMeasures: { index: number }[];
            selectionLabel: string;
            selectMeasure(index: number): void;
            fillMeasure(): void;
            insert(where: 'before' | 'after'): void;
            message: string | null;
            note: { rest: boolean } | null;
        };

        expect(component.emptyMeasures.map((item) => item.index)).toEqual([1]);
        component.selectMeasure(1);
        expect(component.selectionLabel).toBe('Battuta 2 · vuota');
        component.insert('after');
        expect(component.message).toContain('La battuta è vuota');

        component.fillMeasure();
        expect(component.note?.rest).toBeTrue();
        expect(component.emptyMeasures).toEqual([]);
    });

    it('warns about the notes out of the range of the instrument and selects them from the checks', async () => {
        fixture.destroy();
        config.data = { ...config.data, range: { instrumentName: 'Tuba', instrument: { transpositionSemitones: 0, bassClefTranspositionSemitones: 0, lowestWrittenPitch: 50, highestWrittenPitch: 65 } } };
        fixture = TestBed.createComponent(ScoreEditorDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const component = fixture.componentInstance as unknown as {
            rangeText: string | null;
            rangeWarnings: { measureNumber: string; noteId: string }[];
            selectionLabel: string;
            selectMeasure(index: number): void;
            selectOutOfRange(warning: { measureNumber: string; noteId: string }): void;
            move(steps: number): void;
        };

        expect(component.rangeText).toBe('Re3–Fa4');
        expect(component.rangeWarnings.map((warning) => warning.measureNumber)).toEqual(['1']);
        expect(fixture.nativeElement.textContent).toContain('Note fuori estensione di Tuba (Re3–Fa4)');
        component.selectMeasure(1);
        expect(component.selectionLabel).toBe('Battuta 2 · Mi3 · minima');
        component.selectOutOfRange(component.rangeWarnings[0]);
        expect(component.selectionLabel).toBe('Battuta 1 · Do3 · semiminima');
        component.selectOutOfRange({ measureNumber: '9', noteId: 'missing' });
        expect(component.selectionLabel).toBe('Battuta 1 · Do3 · semiminima');

        component.move(1);
        expect(component.rangeWarnings).toEqual([]);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain("Tutte le note nell'estensione di Tuba (Re3–Fa4)");
    });

    it('turns a measure into a multi-measure rest, asking first only when it contains notes', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const confirmService = TestBed.inject(ConfirmService) as jasmine.SpyObj<ConfirmService>;
        const component = fixture.componentInstance as unknown as {
            measureCount: number;
            selectMeasure(index: number): void;
            addMeasures(): void;
            applyMultiRest(): void;
            measure: { index: number; multiRest: number } | null;
        };

        component.measureCount = 3;
        component.selectMeasure(0);
        component.applyMultiRest();
        expect(confirmService.confirmReversible).toHaveBeenCalledTimes(1);
        expect(component.measure?.multiRest).toBe(1);

        component.measureCount = 1;
        component.addMeasures();
        expect(component.measure?.index).toBe(1);
        component.measureCount = 4;
        component.applyMultiRest();
        expect(confirmService.confirmReversible).toHaveBeenCalledTimes(1);
        expect(component.measure?.multiRest).toBe(4);

        // Selezionando una pausa di più battute il numero mostra la sua durata, pronto da correggere.
        component.measureCount = 2;
        component.selectMeasure(0);
        expect(component.measureCount).toBe(2);
        component.selectMeasure(1);
        expect(component.measureCount).toBe(4);
    });

    it('saves a correction with the origin of the measures', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const component = fixture.componentInstance as unknown as { move(steps: number): void; save(approve: boolean): Promise<void>; dirty: boolean };

        component.move(1);
        expect(component.dirty).toBeTrue();
        await component.save(true);

        const correction = playbackService.correct.calls.mostRecent().args[2];
        expect(correction).toEqual(jasmine.objectContaining({ parentVersionId: 7, approve: true, measureSources: [0, 1], origin: 'CORRECTION', editSession: 'editor-window-1' }));
        expect(correction.content.split('<step>D</step>').length - 1).toBe(2);
        expect(correction.content).not.toContain('taurus-');
        expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ versionNumber: 3 }));
        const [trackId, scoreId, approved, known] = recognition.collect.calls.mostRecent().args;
        expect([trackId, scoreId, approved.id]).toEqual([4, 9, 8]);
        expect(known?.versions?.map((version) => version.id)).toEqual([7]);
        expect(known?.contents?.get(8)).toBe(correction.content);
        expect(known?.contents?.get(7)).toBe(XML);

        fixture.destroy();
        expect(lock.release).toHaveBeenCalled();
    });

    it('collects nothing when the correction is saved without approving it', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const component = fixture.componentInstance as unknown as { move(steps: number): void; save(approve: boolean): Promise<void> };

        component.move(1);
        await component.save(false);

        expect(playbackService.correct).toHaveBeenCalled();
        expect(recognition.collect).not.toHaveBeenCalled();
    });

    it('opens in read only while someone else corrects or writes the part, until the user takes over', async () => {
        lock.acquire.and.callFake(async (takeOver = false) => {
            lockState.set(takeOver ? { status: 'held', message: null } : { status: 'locked', message: 'In modifica da Mario Rossi dalle 10:32' });
            return takeOver;
        });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const confirmService = TestBed.inject(ConfirmService) as jasmine.SpyObj<ConfirmService>;
        const component = fixture.componentInstance as unknown as { move(steps: number): void; save(approve: boolean): void; resolveLock(): void; dirty: boolean; message: string | null };

        const notice: HTMLElement = fixture.nativeElement.querySelector('.score-editor__lock');
        expect(notice.textContent).toContain('In modifica da Mario Rossi dalle 10:32');
        component.move(1);
        expect(component.dirty).toBeFalse();
        expect(component.message).toContain('sola lettura');

        component.resolveLock();
        expect(confirmService.confirmReversible).toHaveBeenCalled();
        confirmService.confirmReversible.calls.mostRecent().args[0].accept();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(lock.acquire).toHaveBeenCalledWith(true);
        expect(fixture.nativeElement.querySelector('.score-editor__lock')).toBeNull();
        component.move(1);
        expect(component.dirty).toBeTrue();
    });

    it('passes to read only when a save finds that someone else took over', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const refusal = new HttpErrorResponse({ status: 409, error: { message: 'error.scoreWriting.locked' } });
        playbackService.correct.and.returnValue(throwError(() => refusal));
        lock.refused.and.callFake(() => {
            lockState.set({ status: 'lost', message: 'In modifica da Lucia Bianchi dalle 10:40' });
            return true;
        });
        const component = fixture.componentInstance as unknown as { move(steps: number): void; save(approve: boolean): Promise<void>; readOnly: boolean; dirty: boolean };

        component.move(1);
        await component.save(false);

        expect(lock.refused).toHaveBeenCalledWith(refusal);
        expect(component.readOnly).toBeTrue();
        expect(component.dirty).toBeTrue();
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    describe('writing', () => {
        const draft = (overrides: Partial<ScoreDraft> = {}): ScoreDraft => ({
            content: XML.replace('<step>C</step>', '<step>G</step>'),
            baseVersionId: 7,
            measureCount: 2,
            savedBy: 'Mario Rossi',
            savedAt: '2026-11-14T09:32:00Z',
            entityVersion: 3,
            outdated: false,
            ...overrides
        });

        /** Editor di scrittura sulla stessa parte, aperto e disegnato. */
        async function openWriting(overrides: Partial<ScoreEditorDialogData> = {}): Promise<WritingEditor> {
            fixture.destroy();
            config.data = { ...config.data, mode: 'writing', ...overrides };
            fixture = TestBed.createComponent(ScoreEditorDialogComponent);
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
            return fixture.componentInstance as unknown as WritingEditor;
        }

        const key = (component: WritingEditor, init: KeyboardEventInit): void => component.onKey(new KeyboardEvent('keydown', init));
        const text = (selector: string): string => (fixture.nativeElement.querySelector(selector) as HTMLElement | null)?.textContent ?? '';

        it('writes at the cursor in insertion mode, keeping the measures complete, and hands every change to the draft', async () => {
            const component = await openWriting();
            expect(text('h2')).toContain('Scrittura · Tuba');
            expect(keeperOptions).toEqual(jasmine.objectContaining({ baseVersionId: 7, entityVersion: null, savedAt: null }));
            expect(component.canSave).toBeFalse();

            key(component, { key: 'n' });
            expect(component.inserting).toBeTrue();
            expect(component.insertionLabel).toBe('Inserimento · Battuta 1 · tempo 1 · voce 1 · semiminima');
            key(component, { key: 'g' });
            expect(component.insertionLabel).toContain('Battuta 1 · tempo 2');
            // Una minima al secondo tempo di un 2/4 continua, legata, nella battuta seguente.
            key(component, { key: '6' });
            key(component, { key: 'a' });
            expect(component.wrongMeasures).toEqual([]);
            const xml = keeperOptions!.content();
            expect(xml).toContain('<step>G</step>');
            expect(xml).toContain('<tie type="start"/>');
            expect(component.insertionLabel).toContain('Battuta 2 · tempo 2');
            expect(keeper.changed).toHaveBeenCalledTimes(2);
            expect(component.dirty).toBeTrue();

            // Le voci passano per Ctrl+Alt, perché Ctrl+1–9 cambiano scheda nel browser.
            key(component, { key: '2', code: 'Digit2', ctrlKey: true, altKey: true });
            expect(component.cursor.voice).toBe(2);
            key(component, { key: 'Escape' });
            expect(component.inserting).toBeFalse();
        });

        it('selects a passage with Shift and the arrows, then copies, moves, pastes, repeats and clears it', async () => {
            const component = await openWriting();
            const clipboard = TestBed.inject(ScoreClipboardService);
            const steps = (): number[] => ['C', 'D', 'E'].map((step) => keeperOptions!.content().split(`<step>${step}</step>`).length - 1);

            key(component, { key: 'ArrowRight', shiftKey: true });
            expect(component.selectionLabel).toBe('Selezione · battuta 1 · tutte le voci');
            key(component, { key: 'c', ctrlKey: true });
            fixture.detectChanges();
            expect(clipboard.clip()?.label).toBe('1 battuta');
            expect(text('.score-editor__info')).toContain('Copiato: 1 battuta');
            expect(keeper.changed).not.toHaveBeenCalled();

            // Le frecce spostano tutto il passaggio, che resta selezionato; Esc lo toglie.
            key(component, { key: 'ArrowUp' });
            expect(steps()).toEqual([0, 1, 2]);
            expect(component.selectionLabel).toBe('Selezione · battuta 1 · tutte le voci');
            key(component, { key: 'Escape' });
            expect(component.selectionLabel).toBe('Battuta 1 · Re3 · semiminima');

            // Incollato al posto della minima della seconda battuta, il passaggio resta selezionato.
            component.selectMeasure(1);
            key(component, { key: 'v', ctrlKey: true });
            expect(steps()).toEqual([1, 2, 1]);
            expect(component.selectionLabel).toBe('Selezione · battuta 2 · tutte le voci');

            // R lo ripete dopo di lui, aggiungendo una battuta alla fine; Canc lo riporta a una pausa di battuta.
            key(component, { key: 'r' });
            expect(keeperOptions!.content().split('<measure ').length - 1).toBe(3);
            expect(component.selectionLabel).toBe('Selezione · battuta 3 · tutte le voci');
            key(component, { key: 'Delete' });
            expect(keeperOptions!.content()).toContain('<rest measure="yes"/>');
            expect(component.wrongMeasures).toEqual([]);
            expect(component.selectionLabel).toContain('Battuta 3');
        });

        it('cuts the selected note and transposes the selection or the whole part', async () => {
            const component = await openWriting();
            const clipboard = TestBed.inject(ScoreClipboardService);

            component.transposeInterval = 'P4';
            component.transpose();
            expect(keeperOptions!.content()).not.toContain('<step>C</step>');
            expect(component.selectionLabel).toBe('Battuta 1 · Fa3 · semiminima');

            component.transposeScope = 'part';
            component.transposeInterval = 'M2';
            component.transposeDirection = -1;
            component.transpose();
            expect(component.selectionLabel).toBe('Battuta 1 · Mi♭3 · semiminima');
            expect(keeperOptions!.content()).toContain('<accidental>flat</accidental>');

            key(component, { key: 'x', ctrlKey: true });
            expect(clipboard.clip()?.label).toBe('un passaggio di 1 nota');
            expect(component.info).toBe('Tagliato: un passaggio di 1 nota');
            expect(component.note?.rest).toBeTrue();
            expect(component.wrongMeasures).toEqual([]);
        });

        it('writes slurs, hairpins, grace notes, text and line breaks, keeping slurs whole', async () => {
            const component = await openWriting();
            const content = (): string => keeperOptions!.content();
            expect(renderer.renderPrepared.calls.mostRecent().args[3]).toEqual({ encodedBreaks: true, condense: false, partNames: false });

            key(component, { key: 's' });
            expect(content()).toContain('<slur type="start" number="1"/>');
            expect(content()).toContain('<slur type="stop" number="1"/>');
            expect(component.note?.slur).toBeTrue();

            key(component, { key: 'ArrowRight', shiftKey: true });
            key(component, { key: '<' });
            expect(content()).toContain('<wedge type="crescendo" number="1"/>');
            expect(component.selectionLabel).toBe('Selezione · battuta 1 · tutte le voci');
            key(component, { key: 'Escape' });

            component.grace('acciaccatura');
            expect(component.selectionLabel).toBe('Battuta 1 · Do3 · acciaccatura di croma');
            expect(content()).toContain('<grace slash="yes"/>');
            key(component, { key: 'Delete' });
            expect(content()).not.toContain('<grace');
            expect(component.selectionLabel).toBe('Battuta 1 · Do3 · semiminima');

            component.applyExpression('dolce');
            expect(content()).toContain('<words font-style="italic">dolce</words>');
            component.selectMeasure(1);
            component.applyBreak('system');
            expect(content()).toContain('<print new-system="yes"/>');

            // La nota dove finisce la legatura diventa una pausa: la legatura rimasta senza fine si toglie.
            component.selectMeasure(0);
            key(component, { key: 'ArrowRight' });
            key(component, { key: 'Delete' });
            expect(content()).not.toContain('<slur');
            expect(content()).toContain('<wedge type="stop" number="1"/>');
            expect(component.wrongMeasures).toEqual([]);
        });

        it('writes the notes played on a MIDI keyboard, with each chord in one undo step, and corrects their spelling', async () => {
            const component = await openWriting();
            const content = (): string => keeperOptions!.content();
            expect(fixture.nativeElement.querySelector('button[aria-label="Tastiera MIDI"], p-button[label="Tastiera MIDI"]')).not.toBeNull();

            // Fuori dall'inserimento la nota suonata sostituisce l'altezza della nota selezionata, e si sente subito.
            midi.played.next({ key: 51, chord: false });
            expect(component.selectionLabel).toBe('Battuta 1 · Mi♭3 · semiminima');
            expect(audio.preview).toHaveBeenCalledWith([{ key: 51, at: 0, duration: 0.6 }], 0, 0, false);
            key(component, { key: '+' });
            expect(component.selectionLabel).toBe('Battuta 1 · Re♯3 · semiminima');

            key(component, { key: 'n' });
            midi.played.next({ key: 48, chord: false });
            midi.played.next({ key: 52, chord: true });
            midi.played.next({ key: 55, chord: true });
            expect(content().match(/<chord\/>/g)?.length).toBe(2);
            expect(component.insertionLabel).toContain('Battuta 1 · tempo 2');
            expect(component.wrongMeasures).toEqual([]);

            // Le note dell'accordo si annullano insieme alla prima.
            key(component, { key: 'z', ctrlKey: true });
            expect(content()).not.toContain('<chord/>');
            expect(content()).toContain('<accidental>sharp</accidental>');
            // Con le note scritte da tastiera, + torna a essere il diesis.
            midi.played.next({ key: 53, chord: false });
            key(component, { key: 'g' });
            key(component, { key: '+' });
            expect(component.selectionLabel).toBe('Battuta 2 · Sol♯3 · semiminima');
        });

        it('shows the on-screen piano and writes the touched key', async () => {
            const component = await openWriting();
            expect(fixture.nativeElement.querySelector('app-piano-keyboard')).toBeNull();

            component.togglePiano();
            fixture.detectChanges();
            expect(audio.ready).toHaveBeenCalled();
            key(component, { key: 'n' });
            fixture.detectChanges();
            // In chiave di basso il pianoforte parte dal Do2.
            (fixture.nativeElement.querySelector('app-piano-keyboard button[aria-label="Sol2"]') as HTMLButtonElement).click();
            expect(component.selectionLabel).toBe('Battuta 1 · Sol2 · semiminima');
            expect(component.insertionLabel).toContain('Battuta 1 · tempo 2');
        });

        it('writes the drum sounds of the instruments in their own voices and positions, ignoring the other keys', async () => {
            const component = await openWriting({ versionId: null, initialContent: DRUMS, sound: { percussionKeys: [36, 38, 49], configured: true, conflicting: false } });
            const content = (): string => keeperOptions!.content();
            midi.status.set('ready');
            midi.deviceId.set('pads');

            key(component, { key: 'n' });
            expect(component.insertionLabel).toBe('Inserimento · Battuta 1 · tempo 1 · voce 1 · gran cassa · semiminima');
            expect(component.midiDrumHint).toBe('Tasti MIDI: Do2 gran cassa, Re2 tamburo, Do♯3 piatti');

            // Gran cassa e piatti insieme, poi il tamburo: ogni strumento nella sua voce.
            midi.played.next({ key: 36, chord: false });
            midi.played.next({ key: 49, chord: true });
            midi.played.next({ key: 38, chord: false });
            expect(audio.preview).toHaveBeenCalledWith([{ key: 49, at: 0, duration: 0.6 }], null, 0, true);
            midi.played.next({ key: 40, chord: false });
            expect(component.message).toBe('Tasto senza strumento nella parte. Tasti MIDI: Do2 gran cassa, Re2 tamburo, Do♯3 piatti');

            const xml = content();
            expect(xml).toContain('<display-step>F</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><voice>1</voice>');
            expect(xml).toContain('<display-step>A</display-step><display-octave>5</display-octave></unpitched><duration>1</duration><voice>3</voice>');
            expect(xml).toContain('<notehead>x</notehead>');
            expect(xml).toContain('<display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>1</duration><voice>2</voice>');
            expect(component.wrongMeasures).toEqual([]);

            // I tasti del computer scrivono lo strumento della voce del cursore.
            expect(component.cursor.voice).toBe(2);
            key(component, { key: 'e' });
            expect(component.selectionLabel).toBe('Battuta 2 · Do5 · semiminima');
        });

        it('connects the MIDI keyboard from its panel and keeps the threshold', async () => {
            const component = await openWriting();
            const button = fixture.nativeElement.querySelector('.score-editor__header p-button[label="Tastiera MIDI"] button') as HTMLButtonElement;
            button.click();
            await fixture.whenStable();
            fixture.detectChanges();
            expect(midi.connect).toHaveBeenCalled();
            expect(midi.status()).toBe('ready');

            component.setMidiThreshold(120);
            component.setMidiThreshold(null);
            expect(midi.setThreshold).toHaveBeenCalledOnceWith(120);
        });

        it('turns the selected note into a rest instead of deleting it, so the measure stays complete', async () => {
            const component = await openWriting();
            key(component, { key: 'Delete' });
            expect(component.note?.rest).toBeTrue();
            expect(component.wrongMeasures).toEqual([]);
            component.insert('after');
            expect(keeper.changed).toHaveBeenCalledTimes(1);
        });

        it('saves the written part as a writing version and closes the draft', async () => {
            const component = await openWriting();
            component.move(1);
            await component.save(true);

            const correction = playbackService.correct.calls.mostRecent().args[2];
            expect(correction).toEqual(jasmine.objectContaining({ parentVersionId: 7, approve: true, origin: 'WRITING', editSession: 'editor-window-1' }));
            expect(correction.measureSources).toBeUndefined();
            expect(recognition.collect).toHaveBeenCalledOnceWith(4, 9, jasmine.objectContaining({ id: 8 }), { versions: [], contents: new Map([[8, correction.content]]) });
            expect(keeper.hold).toHaveBeenCalledBefore(playbackService.correct);
            expect(keeper.completed).toHaveBeenCalled();
            expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ versionNumber: 3 }));
        });

        it('asks before replacing a version saved meanwhile, and keeps writing when the user declines', async () => {
            const component = await openWriting();
            const confirmService = TestBed.inject(ConfirmService) as jasmine.SpyObj<ConfirmService>;
            const outdated = new HttpErrorResponse({ status: 409, error: { message: 'error.scoreWriting.draftOutdated' } });
            const saved = await firstValueFrom(playbackService.correct(4, 9, {} as never));
            playbackService.correct.calls.reset();
            playbackService.correct.and.returnValues(
                throwError(() => outdated),
                of(saved),
                throwError(() => outdated)
            );
            confirmService.confirmReversible.and.callFake((request) => request.accept());
            component.move(1);

            await component.save(false);
            expect(playbackService.correct.calls.count()).toBe(2);
            expect(playbackService.correct.calls.mostRecent().args[2]).toEqual(jasmine.objectContaining({ confirmOutdated: true }));
            expect(dialogRef.close).toHaveBeenCalledTimes(1);

            confirmService.confirmReversible.and.callFake((request) => request.reject!());
            component.move(1);
            await component.save(false);
            expect(keeper.resume).toHaveBeenCalled();
            expect(lock.refused).not.toHaveBeenCalled();
            expect(dialogRef.close).toHaveBeenCalledTimes(1);
        });

        it('proposes the draft in the editor, and opens the version once the draft is discarded', async () => {
            drafts.draft.and.resolveTo(draft());
            const component = await openWriting();
            const confirmService = TestBed.inject(ConfirmService) as jasmine.SpyObj<ConfirmService>;

            expect(component.status).toBe('choosing');
            expect(text('.score-editor__choice')).toContain('Bozza non salvata');
            expect(text('.score-editor__choice')).toContain('Mario Rossi');
            expect(text('.score-editor__choice')).toContain('Scarta e apri la versione 2');
            expect(drafts.keeper).not.toHaveBeenCalled();

            confirmService.confirmDestructive.and.callFake((request) => request.accept());
            await component.discardChoice();
            expect(drafts.discard).toHaveBeenCalledWith(4, 9, 'editor-window-1');
            expect(component.status).toBe('ready');
            expect(keeperOptions).toEqual(jasmine.objectContaining({ entityVersion: null }));
            expect(component.canSave).toBeFalse();
        });

        it('resumes the draft without asking when the archivist chose it, ready to be saved as it is', async () => {
            drafts.draft.and.resolveTo(draft());
            const component = await openWriting({ resume: true });

            expect(component.status).toBe('ready');
            expect(keeperOptions).toEqual(jasmine.objectContaining({ baseVersionId: 7, entityVersion: 3, savedAt: '2026-11-14T09:32:00Z' }));
            expect(keeperOptions!.content()).toContain('<step>G</step>');
            expect(component.canSave).toBeTrue();
            expect(keeper.changed).not.toHaveBeenCalled();
        });

        it('proposes first the changes left in this browser, warning that a newer draft is on the server', async () => {
            const local: LocalDraftCopy = { key: 'banda:mario:4:9', content: XML.replace('<step>D</step>', '<step>B</step>'), baseVersionId: 7, entityVersion: 2, changedFrom: '2026-11-14T09:40:00Z', changedAt: '2026-11-14T09:45:00Z' };
            drafts.draft.and.resolveTo(draft());
            drafts.localCopy.and.resolveTo(local);
            const component = await openWriting();

            expect(component.choice).toEqual(jasmine.objectContaining({ kind: 'local', resumeLabel: 'Riprendi e sostituisci' }));
            expect(component.choice!.warning).toContain('bozza più recente di Mario Rossi');
            await component.resumeChoice();

            expect(component.status).toBe('ready');
            expect(keeperOptions).toEqual(jasmine.objectContaining({ entityVersion: 3 }));
            expect(keeperOptions!.content()).toContain('<step>B</step>');
            // La copia non è ancora sul server: parte subito verso la bozza.
            expect(keeper.changed).toHaveBeenCalled();
        });

        it('forgets the copy in the browser when the server already has it', async () => {
            drafts.draft.and.resolveTo(draft());
            drafts.localCopy.and.resolveTo({ key: 'k', content: draft().content, baseVersionId: 7, entityVersion: 3, changedFrom: '2026-11-14T09:30:00Z', changedAt: '2026-11-14T09:31:00Z' });
            const component = await openWriting();

            expect(drafts.forgetLocalCopy).toHaveBeenCalledWith(4, 9);
            expect(component.choice?.kind).toBe('draft');
        });

        it('closes to engrave the version it opened, only without changes', async () => {
            let component = await openWriting();
            fixture.detectChanges();
            expect(text('.score-editor__header')).not.toContain('Impagina');

            component = await openWriting({ engravable: true });
            fixture.detectChanges();
            expect(text('.score-editor__header')).toContain('Impagina');
            expect(component.canEngrave).toBeTrue();
            expect(component.engraveHint).toContain('Impagina la versione');

            component.move(1);
            expect(component.dirty).toBeTrue();
            expect(component.canEngrave).toBeFalse();
            expect(component.engraveHint).toBe('Salva la versione prima di impaginarla');
            await component.engrave();
            expect(dialogRef.close).not.toHaveBeenCalled();

            key(component, { key: 'z', ctrlKey: true });
            expect(component.dirty).toBeFalse();
            keeper.dirty = true;
            await component.engrave();
            expect(keeper.flush).toHaveBeenCalled();
            expect(dialogRef.close).toHaveBeenCalledWith({ engraveVersionId: 7 });
            expect(isEngraveRequest({ engraveVersionId: 7 })).toBeTrue();
            expect(isEngraveRequest(undefined)).toBeFalse();
        });

        it('does not engrave a new written part before its first version', async () => {
            const component = await openWriting({ versionId: null, initialContent: XML, engravable: true });
            expect(component.canEngrave).toBeFalse();
            expect(component.engraveHint).toBe('Salva la versione prima di impaginarla');
        });

        it('opens a new written part from its initial content, without asking for a version', async () => {
            const component = await openWriting({ versionId: null, initialContent: XML });

            expect(playbackService.editor).not.toHaveBeenCalled();
            expect(component.status).toBe('ready');
            expect(keeperOptions).toEqual(jasmine.objectContaining({ baseVersionId: null }));
            expect(keeper.changed).toHaveBeenCalled();
            expect(component.canSave).toBeTrue();
            expect(fixture.nativeElement.querySelector('.score-editor__page-tools')).toBeNull();
        });

        it('shows in read only what the author is writing', async () => {
            lock.acquire.and.callFake(async () => {
                lockState.set({ status: 'locked', message: 'In modifica da Mario Rossi dalle 10:32' });
                return false;
            });
            drafts.draft.and.resolveTo(draft());
            const component = await openWriting();

            expect(drafts.localCopy).not.toHaveBeenCalled();
            expect(drafts.keeper).not.toHaveBeenCalled();
            expect(component.status).toBe('ready');
            expect(component.canSave).toBeFalse();
            key(component, { key: 'n' });
            expect(component.inserting).toBeFalse();
        });

        it('saves the draft when closing, and says so when the server did not receive it', async () => {
            const component = await openWriting();
            const confirmService = TestBed.inject(ConfirmService) as jasmine.SpyObj<ConfirmService>;
            keeper.dirty = true;
            keeper.flush.and.resolveTo(false);
            keeperState.set({ status: 'offline', savedAt: null, message: 'Bozza non salvata: il server non risponde.' });

            await component.close();
            expect(keeper.flush).toHaveBeenCalled();
            expect(confirmService.confirmDiscard).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Bozza non salvata sul server' }));
            expect(dialogRef.close).not.toHaveBeenCalled();

            keeper.flush.and.resolveTo(true);
            await component.close();
            expect(dialogRef.close).toHaveBeenCalledTimes(1);
        });

        it('offers a copy, keeping it for later or discarding it when someone else took over the part', async () => {
            const component = await openWriting();
            const confirmService = TestBed.inject(ConfirmService) as jasmine.SpyObj<ConfirmService>;
            keeperState.set({ status: 'rejected', savedAt: null, message: 'Le modifiche dalle 10:32 alle 10:40 non sono state salvate: ora sta scrivendo Lucia Bianchi' });
            fixture.detectChanges();

            expect(text('.score-editor__draft-notice')).toContain('ora sta scrivendo Lucia Bianchi');
            const labels = Array.from(fixture.nativeElement.querySelectorAll('.score-editor__draft-notice button') as NodeListOf<HTMLElement>).map((button) => button.textContent?.trim());
            expect(labels).toEqual(['Scarica MusicXML', 'Tienila per dopo', 'Scarta']);

            confirmService.confirmDestructive.and.callFake((request) => request.accept());
            component.discardCopy();
            await fixture.whenStable();
            expect(keeper.forget).toHaveBeenCalled();
            expect(dialogRef.close).toHaveBeenCalledTimes(1);

            component.keepCopy();
            expect(keeper.stop).toHaveBeenCalled();
            expect(dialogRef.close).toHaveBeenCalledTimes(2);
        });

        it('starts again from the draft saved in another window, or keeps its own changes', async () => {
            const component = await openWriting();
            keeperState.set({ status: 'conflict', savedAt: null, message: 'La bozza è stata modificata altrove' });
            fixture.detectChanges();
            expect(text('.score-editor__draft-notice')).toContain("Bozza cambiata in un'altra finestra");

            await component.keepMine();
            expect(keeper.overwrite).toHaveBeenCalledTimes(1);

            drafts.draft.and.resolveTo(draft({ entityVersion: 5 }));
            await component.loadOther();
            expect(keeper.reset).toHaveBeenCalledWith(jasmine.objectContaining({ entityVersion: 5 }));
            expect(keeperOptions!.content()).toContain('<step>G</step>');
        });
    });

    describe('score', () => {
        const version: ArrangementVersion = { id: 21, versionNumber: 1, status: 'UNVERIFIED', concertPitch: false, measureCount: 2, checks: [], createdAt: '2026-11-15T09:00:00Z', current: true };
        const rows = [
            { id: 'P1', name: 'Clarinetto', instruments: [CLARINET] },
            { id: 'P2', name: 'Tuba', instruments: [TUBA] }
        ];
        const parts = (xml: string): string[] => Array.from(new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('score-part > part-name')).map((name) => name.textContent ?? '');
        const measures = (xml: string): number[] => Array.from(new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('part')).map((part) => part.querySelectorAll('measure').length);
        const fifths = (xml: string): string[] =>
            Array.from(new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('part')).map((part) =>
                Array.from(part.querySelectorAll('fifths'))
                    .map((item) => item.textContent)
                    .join(',')
            );

        /** Editor della partitura, aperto e disegnato. */
        async function openScore(overrides: Partial<ScoreEditorDialogData> = {}): Promise<ScoreEditor> {
            fixture.destroy();
            lockService.forPart.calls.reset();
            config.data = { trackId: 4, scoreId: 0, versionId: 21, partLabel: 'Partitura', sound: { percussionKeys: [], configured: false, conflicting: false }, mode: 'writing', arrangement: { version, rows }, ...overrides };
            fixture = TestBed.createComponent(ScoreEditorDialogComponent);
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
            return fixture.componentInstance as unknown as ScoreEditor;
        }

        const nextFrame = async (): Promise<void> => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await fixture.whenStable();
        };

        it('opens the current version with a row per part, takes the score lock and moves between the rows', async () => {
            const component = await openScore();

            expect(lockService.forArrangement).toHaveBeenCalledWith(4);
            expect(lockService.forPart).not.toHaveBeenCalled();
            expect(arrangements.content).toHaveBeenCalledWith(4, 21);
            expect(component.status).toBe('ready');
            expect(component.rowViews.map((row) => [row.name, row.active])).toEqual([
                ['Clarinetto', true],
                ['Tuba', false]
            ]);
            expect(renderer.renderPrepared).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Number), jasmine.any(Number), { encodedBreaks: true, condense: false, partNames: true });
            expect(component.selectionLabel).toBe('Clarinetto · Battuta 1 · Re5 · minima');
            expect(component.concertKey).toBe(0);
            expect(component.range?.instrumentName).toBe('Clarinetto');
            expect(component.canEngrave).toBeFalse();

            component.onKey(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }));
            expect(component.rowViews[1].active).toBeTrue();
            expect(component.selectionLabel).toBe('Tuba · Battuta 1 · Do3 · minima');
            expect(component.range?.instrumentName).toBe('Tuba');
            component.onKey(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }));
            expect(component.rowViews[1].active).toBeTrue();
            component.onKey(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }));
            expect(component.rowViews[0].active).toBeTrue();
        });

        it('changes the structure of every row and undoes it in one step', async () => {
            const component = await openScore();
            component.selectRow(1);
            component.selectMeasure(0);

            component.insertMeasure('after');
            expect(measures(keeperOptions!.content())).toEqual([3, 3]);
            expect(keeper.changed).toHaveBeenCalled();
            expect(component.rowViews[1].active).toBeTrue();

            component.undo();
            expect(measures(keeperOptions!.content())).toEqual([2, 2]);
            component.redo();
            expect(measures(keeperOptions!.content())).toEqual([3, 3]);

            // La tonalità in suoni reali scrive l'armatura di ogni rigo per il suo strumento.
            component.selectMeasure(0);
            component.applyConcertKey(-1);
            expect(fifths(keeperOptions!.content())).toEqual(['1', '-1']);
        });

        it('adds a row below the active one with the key of its instrument and removes it after a confirmation', async () => {
            const component = await openScore();
            confirm.confirmReversible.and.callFake((request) => request.accept?.());

            component.newRowInstrumentId = ALTO_SAX.id;
            component.addRowBelow();
            const xml = keeperOptions!.content();
            expect(parts(xml)).toEqual(['Clarinetto', 'Sax contralto', 'Tuba']);
            expect(fifths(xml)).toEqual(['2', '3', '0']);
            expect(measures(xml)).toEqual([2, 2, 2]);
            expect(component.rowViews.map((row) => row.name)).toEqual(['Clarinetto', 'Sax contralto', 'Tuba']);
            expect(component.rowViews[1].active).toBeTrue();
            expect((keeperOptions as unknown as { rows: () => { id: string; instrumentIds: number[] }[] }).rows().map((row) => row.instrumentIds)).toEqual([[10], [12], [11]]);
            expect(component.newRowInstrumentId).toBeNull();

            expect(component.canRemoveRow).toBeTrue();
            component.removeActiveRow();
            expect(parts(keeperOptions!.content())).toEqual(['Clarinetto', 'Tuba']);

            component.undo();
            expect(parts(keeperOptions!.content())).toEqual(['Clarinetto', 'Sax contralto', 'Tuba']);
            expect(component.rowViews.map((row) => row.instruments)).toEqual(['Clarinetto', 'Sax contralto', 'Tuba']);
        });

        it('copies, pastes and clears measures of every row', async () => {
            const component = await openScore();
            component.selectMeasure(0);

            component.copyAllRows();
            expect(component.rowsClip?.label).toBe('1 battuta di tutti i righi');
            component.selectMeasure(1);
            component.pasteAllRows();
            let xml = keeperOptions!.content();
            expect(xml.split('<step>D</step>').length - 1).toBe(2);
            expect(xml.split('<step>C</step>').length - 1).toBe(2);

            component.selectMeasure(0);
            component.clearAllRows();
            xml = keeperOptions!.content();
            expect(xml.split('<step>D</step>').length - 1).toBe(1);
            expect(xml.split('<step>C</step>').length - 1).toBe(1);
        });

        describe('drawing by pages', () => {
            let layout: jasmine.Spy<(options: Record<string, unknown>, xml: string) => Promise<LayoutPage[] | null>>;
            let terminate: jasmine.Spy<() => void>;

            /** Partitura lunga: le battute di pausa si ripetono fino a `count` per rigo. */
            const long = (count: number): string => ARRANGEMENT.replace(/<measure number="2">[\s\S]*?<\/measure>/g, (measure) => Array.from({ length: count - 1 }, (_, index) => measure.replace('number="2"', `number="${index + 2}"`)).join(''));
            const firstRowIds = (xml: string): string[] => Array.from(new DOMParser().parseFromString(xml, 'application/xml').querySelector('part')!.querySelectorAll('measure'), (measure) => measure.getAttribute('id') ?? '');
            /** Impaginazione finta: pagine di dieci battute. */
            const layoutPages = (xml: string): LayoutPage[] => {
                const ids = firstRowIds(xml);
                const pages: LayoutPage[] = [];
                for (let from = 0; from < ids.length; from += 10) {
                    const measureIds = ids.slice(from, from + 10);
                    pages.push({ svg: `<svg>${measureIds.map((id) => `<g class="measure" id="${id}"></g>`).join('')}</svg>`, width: 1000, height: 500, measureIds });
                }
                return pages;
            };
            const settle = async (milliseconds = 0): Promise<void> => {
                await new Promise((resolve) => setTimeout(resolve, milliseconds));
                await nextFrame();
            };
            const pages = (): number => fixture.nativeElement.querySelectorAll('.score-editor__page').length;

            beforeEach(() => {
                layout = jasmine.createSpy('layout').and.callFake(async (_options: Record<string, unknown>, xml: string) => layoutPages(xml));
                terminate = jasmine.createSpy('terminate');
                renderer.layoutWorker.and.returnValue({ layout, terminate } as unknown as ScoreLayoutClient);
                arrangements.content.and.resolveTo(long(60));
            });

            it('draws the page of the selection at once and lays out the whole score in a worker', async () => {
                const component = await openScore();

                // Prima dell'impaginazione le pagine sono gruppi di battute: si disegna subito quella della selezione.
                expect(measures(renderer.renderPrepared.calls.first().args[0])).toEqual([20, 20]);
                expect(fixture.nativeElement.querySelector('.score-editor__notation g.measure.is-current-measure')).not.toBeNull();

                await settle();
                expect(layout).toHaveBeenCalledTimes(1);
                const [options, xml] = layout.calls.mostRecent().args;
                expect(measures(xml)).toEqual([60, 60]);
                expect(options['pageHeight']).toBeGreaterThanOrEqual(800);
                expect(pages()).toBe(6);

                // La battuta selezionata in una pagina lontana compare con la sua pagina.
                component.selectMeasure(55);
                expect(fixture.nativeElement.querySelector('g.measure.is-current-measure')?.getAttribute('id')).toBe(firstRowIds(xml)[55]);

                // Dopo una modifica si ridisegna subito la pagina della battuta, e poco dopo si impagina di nuovo tutto.
                renderer.renderPrepared.calls.reset();
                component.selectMeasure(3);
                component.insertMeasure('after');
                await nextFrame();
                expect(renderer.renderPrepared.calls.allArgs().map((args) => measures(args[0]))).toContain([11, 11]);
                expect(layout).toHaveBeenCalledTimes(1);
                await settle(450);
                expect(layout).toHaveBeenCalledTimes(2);
                expect(measures(layout.calls.mostRecent().args[1])).toEqual([61, 61]);
                expect(pages()).toBe(7);

                fixture.destroy();
                expect(terminate).toHaveBeenCalled();
            });

            it('keeps the excerpts when the worker cannot lay out, and draws the whole score again when it gets short', async () => {
                layout.and.rejectWith(new Error('Impaginazione non disponibile'));
                const component = await openScore();
                await settle();

                expect(layout).toHaveBeenCalledTimes(1);
                expect(pages()).toBe(3);
                expect(component.message).toBeNull();

                // Con un rigo solo le battute sono poche: lo spartito torna intero.
                component.toggleRow(component.rowViews[1]);
                await nextFrame();
                expect(pages()).toBe(0);
                expect(measures(renderer.renderPrepared.calls.mostRecent().args[0])).toEqual([60]);
                expect(fixture.nativeElement.querySelectorAll('.score-editor__notation g.measure').length).toBe(60);
            });
        });

        it('hides a row from the drawing, keeping at least one visible', async () => {
            const component = await openScore();
            renderer.renderPrepared.calls.reset();

            component.toggleRow(component.rowViews[0]);
            await nextFrame();
            expect(component.rowViews[0].hidden).toBeTrue();
            expect(component.rowViews[1].active).toBeTrue();
            expect(parts(renderer.renderPrepared.calls.mostRecent().args[0])).toEqual(['Tuba']);

            component.toggleRow(component.rowViews[1]);
            expect(component.message).toBe('Almeno un rigo resta visibile');

            component.toggleCondense();
            component.showAllRows();
            await nextFrame();
            expect(parts(renderer.renderPrepared.calls.mostRecent().args[0])).toEqual(['Clarinetto', 'Tuba']);
            expect(renderer.renderPrepared.calls.mostRecent().args[3]).toEqual({ encodedBreaks: true, condense: true, partNames: true });
        });

        it('converts the whole score between transposed and concert pitch in one undo step', async () => {
            const component = await openScore();
            const notation = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('[aria-label="Notazione della partitura"] button'));
            expect(notation().map((button) => [button.textContent?.trim(), button.getAttribute('aria-pressed')])).toEqual([
                ['Trasposta', 'true'],
                ['Suoni reali', 'false']
            ]);

            notation()[1].click();
            let xml = keeperOptions!.content();
            expect(xml).toContain('<concert-score/>');
            expect(fifths(xml)).toEqual(['0', '0']);
            expect(component.concertPitch).toBeTrue();
            expect(component.info).toBe('Partitura in suoni reali');
            expect(component.selectionLabel).toBe('Clarinetto · Battuta 1 · Do5 · minima');
            expect(component.concertKey).toBe(0);
            fixture.detectChanges();
            expect(notation().map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);

            component.undo();
            xml = keeperOptions!.content();
            expect(xml).not.toContain('concert-score');
            expect(fifths(xml)).toEqual(['2', '0']);

            component.redo();
            component.convertNotation(false);
            expect(fifths(keeperOptions!.content())).toEqual(['2', '0']);
            expect(component.info).toBe('Partitura trasposta');
        });

        it('blocks the conversion for an instrument without transposition, with a link to configure it', async () => {
            const horn: PlaybackInstrument = { id: 13, name: 'Corno', configured: false };
            const component = await openScore({ arrangement: { version, rows: [{ id: 'P1', name: 'Corno', instruments: [horn] }, rows[1]] } });

            component.convertNotation(true);
            expect(component.message).toBe('Configura la trasposizione di Corno per convertire la partitura');
            expect(component.concertPitch).toBeFalse();
            fixture.detectChanges();
            const link = fixture.nativeElement.querySelector('a[target="_blank"]') as HTMLAnchorElement;
            expect(link.getAttribute('href')).toBe('/instruments/13');
            expect(link.textContent).toContain('Configura Corno');

            // La modifica successiva toglie il collegamento.
            component.selectMeasure(1);
            component.insertMeasure('after');
            expect(component.conversionBlock).toBeNull();
        });

        it('plays every row of the selection, the highlighted one louder', async () => {
            audio.load.and.resolveTo();
            audio.play.and.resolveTo();
            const component = await openScore();
            component.selectMeasure(0);

            await component.togglePlay();
            const gains = (): (string | number | boolean)[][] =>
                audio.setChannel.calls
                    .allArgs()
                    .filter(([channel]) => channel.key !== '__metronome__')
                    .map(([channel, gain, muted]) => [channel.key, gain, muted]);
            expect(audio.load).toHaveBeenCalledTimes(1);
            expect(gains()).toEqual([
                ['P1', 1, false],
                ['P2', 1, false]
            ]);

            audio.setChannel.calls.reset();
            component.toggleHighlight(component.rowViews[1]);
            expect(component.rowViews.map((row) => row.highlighted)).toEqual([false, true]);
            expect(gains()).toEqual([
                ['P1', 0.35, false],
                ['P2', 1, false]
            ]);

            await component.togglePlay();
            expect(audio.pause).toHaveBeenCalled();
            audio.setChannel.calls.reset();
            component.toggleHighlight(component.rowViews[1]);
            expect(component.rowViews.map((row) => row.highlighted)).toEqual([false, false]);
            expect(audio.setChannel).not.toHaveBeenCalled();
        });

        it('lists the checks of every row and goes to the measure of a row', async () => {
            arrangements.content.and.resolveTo(ARRANGEMENT.replace('<octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>half</type>', '<octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>'));
            const clarinet = { ...CLARINET, lowestWrittenPitch: 52, highestWrittenPitch: 72 };
            const component = await openScore({ arrangement: { version, rows: [{ id: 'P1', name: 'Clarinetto', instruments: [clarinet] }, rows[1]] } });

            expect(component.rowIssues.map((check) => [check.name, check.wrongDuration.map((item) => item.number), check.outOfRange.map((item) => item.measureNumber), check.range])).toEqual([
                ['Clarinetto', [], ['1'], 'Mi3–Do5'],
                ['Tuba', ['1'], [], null]
            ]);
            expect(fixture.nativeElement.textContent).toContain('Controlli dei righi');

            component.showRowMeasure(1, 0);
            expect(component.rowViews[1].active).toBeTrue();
            expect(component.selectionLabel).toBe('Tuba · Battuta 1 · Do3 · semiminima');

            component.showRowNote(0, component.rowIssues[0].outOfRange[0]);
            expect(component.rowViews[0].active).toBeTrue();
            expect(component.selectionLabel).toBe('Clarinetto · Battuta 1 · Re5 · minima');
        });

        it('saves a version of the score with its rows', async () => {
            const saved: ArrangementVersion = { ...version, id: 22, versionNumber: 2 };
            arrangements.save.and.resolveTo(saved);
            const component = await openScore();
            component.selectMeasure(1);
            component.insertMeasure('after');

            await component.save(true);

            expect(keeper.hold).toHaveBeenCalled();
            expect(arrangements.save).toHaveBeenCalledWith(
                4,
                jasmine.objectContaining({
                    editSession: 'editor-window-1',
                    rows: [
                        { id: 'P1', instrumentIds: [10] },
                        { id: 'P2', instrumentIds: [11] }
                    ],
                    parentVersionId: 21,
                    approve: true,
                    confirmOutdated: false
                }),
                jasmine.anything()
            );
            expect(measures(arrangements.save.calls.mostRecent().args[1].content)).toEqual([3, 3]);
            expect(keeper.completed).toHaveBeenCalled();
            expect(dialogRef.close).toHaveBeenCalledWith(saved);
        });

        it('resumes the draft of the score with the rows it records', async () => {
            const draft: ArrangementDraft = {
                content: ARRANGEMENT.replace('<step>D</step><octave>5</octave>', '<step>E</step><octave>5</octave>'),
                rows,
                baseVersionId: 21,
                measureCount: 2,
                savedBy: 'Mario Rossi',
                savedAt: '2026-11-15T10:00:00Z',
                entityVersion: 2,
                outdated: false
            };
            arrangements.draft.and.resolveTo(draft);

            const component = await openScore({ resume: true });

            expect(component.status).toBe('ready');
            expect(component.selectionLabel).toBe('Clarinetto · Battuta 1 · Mi5 · minima');
            expect(keeperOptions).toEqual(jasmine.objectContaining({ baseVersionId: 21, entityVersion: 2 }));
        });

        it('offers the draft of the score before opening the version', async () => {
            arrangements.draft.and.resolveTo({ content: ARRANGEMENT, rows, baseVersionId: 21, measureCount: 2, savedBy: 'Mario Rossi', savedAt: '2026-11-15T10:00:00Z', entityVersion: 2, outdated: false });

            const component = await openScore();

            expect(component.status).toBe('choosing');
            expect(fixture.nativeElement.textContent).toContain('Scarta e apri la versione 1');
            confirm.confirmDestructive.and.callFake((request) => request.accept?.());
            await component.discardChoice();
            expect(arrangements.discardDraft).toHaveBeenCalledWith(4, 'editor-window-1');
            expect(component.status).toBe('ready');
            expect(component.selectionLabel).toBe('Clarinetto · Battuta 1 · Re5 · minima');
        });
    });
});

interface FakeKeeper {
    state: () => DraftState;
    dirty: boolean;
    changed: jasmine.Spy;
    flush: jasmine.Spy;
    hold: jasmine.Spy;
    resume: jasmine.Spy;
    completed: jasmine.Spy;
    forget: jasmine.Spy;
    overwrite: jasmine.Spy;
    reset: jasmine.Spy;
    stop: jasmine.Spy;
    content: () => string;
}

interface FakeMidi {
    supported: boolean;
    status: WritableSignal<MidiStatus>;
    devices: WritableSignal<{ id: string; name: string }[]>;
    deviceId: WritableSignal<string | null>;
    threshold: WritableSignal<number>;
    played: Subject<PlayedNote>;
    connect: jasmine.Spy;
    select: jasmine.Spy;
    setThreshold: jasmine.Spy;
}

interface WritingEditor {
    status: string;
    inserting: boolean;
    insertionLabel: string;
    cursor: { voice: number };
    canSave: boolean;
    dirty: boolean;
    note: { rest: boolean; slur: boolean } | null;
    wrongMeasures: unknown[];
    choice: { kind: string; resumeLabel: string; warning: string | null } | null;
    selectionLabel: string;
    info: string | null;
    transposeInterval: string;
    transposeDirection: 1 | -1;
    transposeScope: 'passage' | 'part';
    onKey(event: KeyboardEvent): void;
    selectMeasure(index: number): void;
    transpose(): void;
    grace(kind: 'acciaccatura' | 'appoggiatura'): void;
    applyExpression(value: string | null): void;
    applyBreak(kind: 'system' | 'page' | null): void;
    togglePiano(): void;
    setMidiThreshold(value: number | null): void;
    message: string | null;
    midiDrumHint: string | null;
    move(steps: number): void;
    insert(where: 'before' | 'after'): void;
    save(approve: boolean): Promise<void>;
    close(): Promise<void>;
    canEngrave: boolean;
    engraveHint: string;
    engrave(): Promise<void>;
    resumeChoice(): Promise<void>;
    discardChoice(): Promise<void>;
    discardCopy(): void;
    keepCopy(): void;
    keepMine(): Promise<void>;
    loadOther(): Promise<void>;
}

interface ScoreEditor {
    status: string;
    selectionLabel: string;
    message: string | null;
    info: string | null;
    rowViews: { index: number; id: string; name: string; instruments: string; hidden: boolean; active: boolean; highlighted: boolean }[];
    concertPitch: boolean;
    conversionBlock: { id: number; name: string } | null;
    rowIssues: { index: number; name: string; wrongDuration: { index: number; number: string }[]; outOfRange: { measureIndex: number; measureNumber: string; noteId: string }[]; range: string | null }[];
    rowsClip: { label: string } | null;
    newRowInstrumentId: number | null;
    concertKey: number | null;
    canRemoveRow: boolean;
    canEngrave: boolean;
    range: { instrumentName: string } | null;
    onKey(event: KeyboardEvent): void;
    selectRow(index: number): void;
    selectMeasure(index: number): void;
    insertMeasure(where: 'before' | 'after'): void;
    applyConcertKey(fifths: number | null): void;
    addRowBelow(): void;
    removeActiveRow(): void;
    copyAllRows(): void;
    pasteAllRows(): void;
    clearAllRows(): void;
    toggleRow(view: ScoreEditor['rowViews'][number]): void;
    toggleCondense(): void;
    showAllRows(): void;
    convertNotation(concertPitch: boolean): void;
    toggleHighlight(view: ScoreEditor['rowViews'][number]): void;
    togglePlay(): Promise<void>;
    showRowMeasure(row: number, measureIndex: number): void;
    showRowNote(row: number, warning: ScoreEditor['rowIssues'][number]['outOfRange'][number]): void;
    undo(): void;
    redo(): void;
    save(approve: boolean): Promise<void>;
    discardChoice(): Promise<void>;
}
