import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ScoreDraft, ScoreEditorData } from '../../module';
import {
    ConfirmService,
    DraftKeeperOptions,
    DraftState,
    EditLockState,
    LocalDraftCopy,
    MediaService,
    ScoreAudioService,
    ScoreClipboardService,
    ScoreDraftService,
    ScoreEditLockService,
    ScorePlaybackService,
    ScoreRendererService
} from '../../service';
import { ScoreEditorDialogComponent, ScoreEditorDialogData } from './score-editor-dialog.component';

const XML = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tuba</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
<note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note></measure>
<measure number="2"><note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure>
</part></score-partwise>`;

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
        drafts = jasmine.createSpyObj<ScoreDraftService>('ScoreDraftService', ['draft', 'discard', 'localCopy', 'forgetLocalCopy', 'keeper']);
        drafts.draft.and.resolveTo(null);
        drafts.discard.and.resolveTo();
        drafts.localCopy.and.resolveTo(null);
        drafts.forgetLocalCopy.and.resolveTo();
        drafts.keeper.and.callFake((_trackId: number, _scoreId: number, options: DraftKeeperOptions) => {
            keeperOptions = options;
            return keeper as never;
        });
        renderer = jasmine.createSpyObj('ScoreRendererService', ['render']);
        renderer.render.and.callFake(async (xml: string) => [`<svg><g class="measure" id="${/<measure[^>]* id="([^"]+)"/.exec(xml)![1]}"></g></svg>`]);
        playbackService = jasmine.createSpyObj('ScorePlaybackService', ['editor', 'errorReports', 'correct']);
        playbackService.editor.and.returnValue(of(editor));
        playbackService.errorReports.and.returnValue(of([]));
        playbackService.correct.and.returnValue(of({ ...editor.version, id: 8, versionNumber: 3, origin: 'CORRECTION' }));
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);

        await TestBed.configureTestingModule({
            imports: [ScoreEditorDialogComponent],
            providers: [
                ConfirmationService,
                { provide: DynamicDialogConfig, useValue: config },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playbackService },
                { provide: ScoreRendererService, useValue: renderer },
                { provide: MediaService, useValue: jasmine.createSpyObj('MediaService', ['streamImage']) },
                { provide: ScoreAudioService, useValue: jasmine.createSpyObj('ScoreAudioService', ['ready', 'load', 'play', 'pause', 'setChannel']) },
                { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['confirmDiscard', 'confirmReversible', 'confirmDestructive']) },
                { provide: ScoreEditLockService, useValue: { forPart: () => lock } },
                { provide: ScoreDraftService, useValue: drafts }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ScoreEditorDialogComponent);
    });

    it('opens the version and draws the notation inside the editor', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const component = fixture.componentInstance as unknown as { status: string; selectionLabel: string };
        expect(component.status).toBe('ready');
        expect(renderer.render).toHaveBeenCalledTimes(1);
        expect(fixture.nativeElement.querySelector('.score-editor__notation svg')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.score-editor__notation g.measure.is-current-measure')).not.toBeNull();
        expect(component.selectionLabel).toBe('Battuta 1 · Do3 · semiminima');
    });

    it('draws quick edits once, at the next frame', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const component = fixture.componentInstance as unknown as { move(steps: number): void };

        component.move(1);
        component.move(1);
        component.move(1);
        expect(renderer.render).toHaveBeenCalledTimes(1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await fixture.whenStable();

        expect(renderer.render).toHaveBeenCalledTimes(2);
        expect(renderer.render.calls.mostRecent().args[0].split('<step>F</step>').length - 1).toBe(1);
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

        fixture.destroy();
        expect(lock.release).toHaveBeenCalled();
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
            expect(renderer.render.calls.mostRecent().args[3]).toEqual({ encodedBreaks: true });

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
    move(steps: number): void;
    insert(where: 'before' | 'after'): void;
    save(approve: boolean): Promise<void>;
    close(): Promise<void>;
    resumeChoice(): Promise<void>;
    discardChoice(): Promise<void>;
    discardCopy(): void;
    keepCopy(): void;
    keepMine(): Promise<void>;
    loadOther(): Promise<void>;
}
