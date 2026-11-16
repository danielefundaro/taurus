import { fakeAsync, tick } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { DerivePartDialogComponent } from '../../../../dialogs/derive-part-dialog/derive-part-dialog.component';
import { EngraveDialogComponent } from '../../../../dialogs/engrave-dialog/engrave-dialog.component';
import { NewPartDialogComponent } from '../../../../dialogs/new-part-dialog/new-part-dialog.component';
import { ScoreCompareDialogComponent } from '../../../../dialogs/score-compare-dialog/score-compare-dialog.component';
import { ScoreEditorDialogComponent } from '../../../../dialogs/score-editor-dialog/score-editor-dialog.component';
import { Arrangement, ArrangementRowState, PartPlayback, PlaybackSound, RecognitionJob, TrackPlayback } from '../../../../module';
import { RECOGNITION_POLL_MILLIS, ScorePlaybackPanelComponent } from './score-playback-panel.component';

function part(sound: Partial<PlaybackSound>, overrides: Partial<PartPlayback> = {}): PartPlayback {
    return {
        scoreId: 1,
        order: 1,
        instruments: [
            { id: 3, name: 'Flicorno tenore', configured: false },
            { id: 4, name: 'Euphonium', configured: false }
        ],
        ownPart: true,
        sound: { percussionKeys: [], configured: true, conflicting: false, ...sound },
        availability: 'AVAILABLE',
        hasPages: true,
        openReports: 0,
        ...overrides
    };
}

function job(scoreId: number, status: RecognitionJob['status'], overrides: Partial<RecognitionJob> = {}): RecognitionJob {
    return { id: scoreId * 10, scoreId, status, attempts: 1, requestedAt: '2026-10-17T10:00:00Z', engines: [], ...overrides };
}

function playback(parts: PartPlayback[], recognitionAvailable = true): TrackPlayback {
    return { trackId: 5, trackName: 'Marcia', version: 2, parts, recognitionAvailable };
}

describe('ScorePlaybackPanelComponent', () => {
    const component: any = new ScorePlaybackPanelComponent({ canManage: true, playback: () => of() } as never, null!, null!, null!, null!, { scoreWritingEnabled: () => true } as never, null!);

    it('names the instruments to configure when the part has no sound', () => {
        expect(component.soundLabel(part({ configured: false }))).toBe('Suono e trasposizione non configurati per Flicorno tenore, Euphonium');
        expect(component.soundLabel(part({ configured: false }, { instruments: [] }))).toBe('Suono e trasposizione non configurati');
    });

    it('describes the sound, the transposition and the drum sounds', () => {
        expect(component.soundLabel(part({ soundProgram: 57, transpositionSemitones: -14 }))).toBe('Trombone · -14 semitoni');
        expect(component.soundLabel(part({ soundProgram: 73, transpositionSemitones: 0 }))).toBe('Flute · in suoni reali');
        expect(component.soundLabel(part({ percussionKeys: [38, 36] }))).toBe(`Batteria: ${['Acoustic Snare', 'Bass Drum 1'].join(', ')}`);
    });

    it('says who is correcting or writing a part', () => {
        const since = new Date(2026, 10, 14, 10, 32).toISOString();
        expect(component.editingLabel({ ownerName: 'Mario Rossi', since, expiresAt: since, mine: false })).toBe('In modifica da Mario Rossi dalle 10:32');
        expect(component.editingLabel({ ownerName: null, since, expiresAt: since, mine: false })).toBe('In modifica da un altro utente dalle 10:32');
    });

    it('says whose draft a part has and when it was saved', () => {
        const savedAt = new Date(2026, 10, 14, 10, 32).toISOString();
        expect(component.draftLabel({ savedBy: 'Mario Rossi', savedAt, outdated: false })).toBe('Bozza non salvata di Mario Rossi, 14/11/2026 10:32');
        expect(component.draftLabel({ savedBy: null, savedAt, outdated: true })).toBe('Bozza non salvata, 14/11/2026 10:32');
    });
});

describe('ScorePlaybackPanelComponent writing', () => {
    const version = { id: 7, versionNumber: 2, status: 'UNVERIFIED' as const, origin: 'OMR_AUDIVERIS' as const, measureCount: 8, checks: null as never, pagesChanged: false };

    function setup(parts: PartPlayback[], { canManage = true, writing = true, recognitionAvailable = true } = {}) {
        const closes: Subject<unknown>[] = [];
        const service = { canManage, playback: jasmine.createSpy().and.returnValue(of(playback(parts, recognitionAvailable))) };
        const dialogs = {
            open: jasmine.createSpy('open').and.callFake(() => {
                const onClose = new Subject<unknown>();
                closes.push(onClose);
                return { onClose };
            })
        };
        const toast = jasmine.createSpyObj('ToastService', ['success']);
        const drafts = jasmine.createSpyObj('ScoreDraftService', ['discard']);
        drafts.discard.and.resolveTo();
        const confirm = jasmine.createSpyObj('ConfirmService', ['confirmDestructive']);
        confirm.confirmDestructive.and.callFake((request: { accept: () => void }) => request.accept());
        const arrangements = { arrangement: jasmine.createSpy('arrangement').and.resolveTo(null) };
        const component: any = new ScorePlaybackPanelComponent(service as never, dialogs as never, toast, drafts, confirm, { scoreWritingEnabled: () => writing } as never, arrangements as never);
        component.trackId = 5;
        component.reload();
        /** Chiude l'ultimo dialogo aperto con il risultato indicato. */
        const close = (result?: unknown): void => {
            const onClose = closes[closes.length - 1];
            onClose.next(result);
            onClose.complete();
        };
        const opened = (index = dialogs.open.calls.count() - 1) => ({ component: dialogs.open.calls.argsFor(index)[0], data: dialogs.open.calls.argsFor(index)[1].data });
        return { component, service, dialogs, toast, drafts, confirm, close, opened };
    }

    it('offers the writing to managers only, with the feature on', () => {
        expect(setup([]).component.canWrite).toBeTrue();
        expect(setup([], { writing: false }).component.canWrite).toBeFalse();
        expect(setup([], { canManage: false }).component.canWrite).toBeFalse();
    });

    it('opens the writing editor on the current version and reloads the parts when it closes', () => {
        const written = part({}, { version });
        const { component, service, toast, close, opened } = setup([written]);

        component.write(written);
        expect(opened().component).toBe(ScoreEditorDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ trackId: 5, scoreId: 1, versionId: 7, mode: 'writing', resume: false, range: null, instruments: written.instruments }));
        close();
        expect(service.playback).toHaveBeenCalledTimes(2);
        expect(toast.success).not.toHaveBeenCalled();

        component.write(written, true);
        expect(opened().data).toEqual(jasmine.objectContaining({ resume: true }));
        close({ ...version, id: 9, versionNumber: 3, status: 'APPROVED' });
        expect(toast.success).toHaveBeenCalledWith('Versione approvata', jasmine.stringContaining('versione 3'));
    });

    it('sets up a part without notes before writing it, without creating a part', () => {
        const empty = part({}, { version: null, draft: null, availability: 'NOT_AVAILABLE' });
        const { component, close, opened } = setup([empty]);

        component.write(empty);
        expect(opened().component).toBe(NewPartDialogComponent);
        expect(opened().data.part).toBe(empty);
        close({ kind: 'prepared', content: '<score-partwise/>' });
        expect(opened().component).toBe(ScoreEditorDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ versionId: null, initialContent: '<score-partwise/>', mode: 'writing' }));
    });

    it('adds a part written from scratch and opens it in the editor', () => {
        const { component, service, close, opened } = setup([part({}, { version })]);
        const versions: number[] = [];
        let partsChanged = 0;
        component.trackVersionChange.subscribe((value: number) => versions.push(value));
        component.partsChange.subscribe(() => partsChanged++);

        component.newPart();
        expect(opened().component).toBe(NewPartDialogComponent);
        expect(opened().data.part).toBeUndefined();
        const created = part({}, { scoreId: 2, order: 2, version: null, draft: { savedBy: 'Mario Rossi', savedAt: '2026-11-14T09:00:00Z', outdated: false } });
        service.playback.and.returnValue(of(playback([part({}, { version }), created])));
        close({ kind: 'created', scoreId: 2, trackVersion: 3 });

        expect(versions).toEqual([3]);
        expect(partsChanged).toBe(1);
        expect(opened().component).toBe(ScoreEditorDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ scoreId: 2, versionId: null, mode: 'writing' }));
    });

    it('derives a part only from a pitched part of one instrument with a transposition', () => {
        const { component } = setup([]);
        const clarinet = { id: 3, name: 'Clarinetto', transpositionSemitones: -2, configured: true };
        expect(component.deriveBlocker(part({ transpositionSemitones: -2 }, { version, instruments: [clarinet] }))).toBeNull();
        expect(component.deriveBlocker(part({ transpositionSemitones: -2 }, { version }))).toContain('un solo strumento');
        expect(component.deriveBlocker(part({ transpositionSemitones: -2 }, { version, instruments: [] }))).toContain('un solo strumento');
        expect(component.deriveBlocker(part({ percussionKeys: [38] }, { version, instruments: [{ id: 5, name: 'Rullante', percussionKey: 38, configured: true }] }))).toBe('Le parti di percussioni non si ricavano');
        expect(component.deriveBlocker(part({ transpositionSemitones: null }, { version, instruments: [clarinet] }))).toBe('Configura la trasposizione di Clarinetto per ricavarne una parte');
    });

    it('says which part a derived part comes from and when the source has changed', () => {
        const source = part({}, { scoreId: 1, description: 'Clarinetto 1°', version: { ...version, id: 9, versionNumber: 3 } });
        const derived = part({}, { scoreId: 2, order: 2, description: 'Sax contralto', version, derivedFrom: { scoreId: 1, versionId: 8, versionNumber: 2 } });
        const { component } = setup([source, derived]);

        expect(component.derivedLabel(derived)).toBe('Ricavata da Clarinetto 1° (versione 2)');
        expect(component.sourceChanged(derived)).toBe('Ora si ascolta la versione 3 di Clarinetto 1°: la parte ricavata non si aggiorna da sola');
        expect(component.derivedLabel(source)).toBeNull();
        expect(component.sourceChanged(source)).toBeNull();
        expect(component.sourceChanged({ ...derived, derivedFrom: { scoreId: 1, versionId: 9, versionNumber: 3 } })).toBeNull();
        expect(component.derivedLabel({ ...derived, derivedFrom: { scoreId: 7, versionId: 4, versionNumber: 1 } })).toBe('Ricavata da una parte eliminata');
        expect(component.sourceChanged({ ...derived, derivedFrom: { scoreId: 7, versionId: 4, versionNumber: 1 } })).toBeNull();
    });

    it('compares the version a derived part comes from with the one the source plays now', () => {
        const source = part({}, { scoreId: 1, description: 'Clarinetto 1°', version: { ...version, id: 9, versionNumber: 3 } });
        const derived = part({}, { scoreId: 2, order: 2, description: 'Sax contralto', version, derivedFrom: { scoreId: 1, versionId: 8, versionNumber: 2 } });
        const { component, opened, dialogs } = setup([source, derived]);

        component.compareSource(derived);
        expect(opened().component).toBe(ScoreCompareDialogComponent);
        expect(opened().data).toEqual({ trackId: 5, scoreId: 1, subject: 'Clarinetto 1°', versionId: 9, withId: 8, sound: source.sound });

        component.compareSource({ ...derived, derivedFrom: { scoreId: 7, versionId: 4, versionNumber: 1 } });
        expect(dialogs.open).toHaveBeenCalledTimes(1);
    });

    it('corrects at the chosen measure from the comparison with the extraction or of the versions', () => {
        const corrected = part({}, { version });
        const { component, close, opened } = setup([corrected]);

        component.compareExtraction(corrected);
        expect(opened().component).toBe(ScoreCompareDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ scoreId: 1, versionId: 7, withOrigin: 'ARRANGEMENT', correctable: true }));
        close({ correctVersionId: 7, measureIndex: 12 });
        expect(opened().component).toBe(ScoreEditorDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ versionId: 7, measureIndex: 12 }));
        close();

        component.versions(corrected);
        close({ changed: false, correctVersionId: 6, measureIndex: 3 });
        expect(opened().data).toEqual(jasmine.objectContaining({ versionId: 6, measureIndex: 3 }));
    });

    it('derives a part for another instrument and opens it in the editor', () => {
        const clarinet = part({ transpositionSemitones: -2 }, { version, instruments: [{ id: 3, name: 'Clarinetto', transpositionSemitones: -2, configured: true }] });
        const { component, service, close, opened, dialogs } = setup([clarinet]);
        const versions: number[] = [];
        component.trackVersionChange.subscribe((value: number) => versions.push(value));

        component.derive(part({}, { version }));
        expect(dialogs.open).not.toHaveBeenCalled();

        component.derive(clarinet);
        expect(opened().component).toBe(DerivePartDialogComponent);
        expect(opened().data).toEqual({ trackId: 5, playback: component.playback, part: clarinet });
        const created = part({}, { scoreId: 2, order: 2, version: null, draft: { savedBy: 'Mario Rossi', savedAt: '2026-11-15T09:00:00Z', outdated: false } });
        service.playback.and.returnValue(of(playback([clarinet, created])));
        close({ scoreId: 2, trackVersion: 3 });

        expect(versions).toEqual([3]);
        expect(opened().component).toBe(ScoreEditorDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ scoreId: 2, versionId: null, mode: 'writing' }));

        // Gli editor controllano l'estensione delle parti di un solo strumento scritte nella sua trasposizione.
        component.correct(clarinet);
        expect(opened().data.range).toEqual({ instrumentName: 'Clarinetto', instrument: clarinet.instruments[0] });
        component.correct({ ...clarinet, settings: { transpositionOverride: 0, soundBankOverride: null, soundProgramOverride: null } });
        expect(opened().data.range).toBeNull();
        close();

        const count = dialogs.open.calls.count();
        component.derive(clarinet);
        close();
        expect(dialogs.open.calls.count()).toBe(count + 1);
    });

    it('discards the draft of a part after a confirmation', async () => {
        const drafted = part({}, { version, draft: { savedBy: 'Mario Rossi', savedAt: '2026-11-14T09:00:00Z', outdated: false } });
        const { component, service, drafts, confirm, toast } = setup([drafted]);

        component.discardDraft(drafted);
        expect(confirm.confirmDestructive).toHaveBeenCalledWith(jasmine.objectContaining({ actionLabel: 'Scarta la bozza' }));
        await Promise.resolve();
        await Promise.resolve();
        expect(drafts.discard).toHaveBeenCalledWith(5, 1);
        expect(toast.success).toHaveBeenCalledWith('Bozza scartata', jasmine.any(String));
        expect(service.playback).toHaveBeenCalledTimes(2);
    });
});

describe('ScorePlaybackPanelComponent engraving', () => {
    const version = { id: 7, versionNumber: 2, status: 'APPROVED' as const, origin: 'WRITING' as const, measureCount: 8, checks: null as never, pagesChanged: false };

    function setup(parts: PartPlayback[], { writing = true, recognitionAvailable = true, arrangement = null as Arrangement | null } = {}) {
        const closes: Subject<unknown>[] = [];
        const service = { canManage: true, playback: jasmine.createSpy().and.returnValue(of(playback(parts, recognitionAvailable))) };
        const arrangements = { arrangement: jasmine.createSpy('arrangement').and.resolveTo(arrangement) };
        const dialogs = {
            open: jasmine.createSpy('open').and.callFake(() => {
                const onClose = new Subject<unknown>();
                closes.push(onClose);
                return { onClose };
            })
        };
        const component: any = new ScorePlaybackPanelComponent(service as never, dialogs as never, jasmine.createSpyObj('ToastService', ['success']), null!, null!, { scoreWritingEnabled: () => writing } as never, arrangements as never);
        component.trackId = 5;
        component.composer = 'G. Gabetti';
        component.arranger = null;
        component.reload();
        const close = (result?: unknown): void => {
            const onClose = closes[closes.length - 1];
            onClose.next(result);
            onClose.complete();
        };
        const opened = () => ({ component: dialogs.open.calls.mostRecent().args[0], data: dialogs.open.calls.mostRecent().args[1].data });
        return { component, service, dialogs, close, opened, arrangements };
    }

    it('engraves with the writing on and the music service configured', () => {
        expect(setup([]).component.canEngrave).toBeTrue();
        expect(setup([], { writing: false }).component.canEngrave).toBeFalse();
        expect(setup([], { recognitionAvailable: false }).component.canEngrave).toBeFalse();
    });

    it('labels the parts extracted from the score and reopens the engraving of the pages to assign', async () => {
        const extracted = part({}, { scoreId: 1, version });
        const corrected = part({}, { scoreId: 2, version, description: 'Basso' });
        const waiting = part({}, { scoreId: 3, version, description: 'Rullante', pendingPages: { jobId: 40, versionId: 6, versionNumber: 1, pageCount: 2 } });
        const written = part({}, { scoreId: 4, version, description: 'Clarinetto' });
        const row = (scoreId: number | null, status: ArrangementRowState['status'], extractedFrom: number | null): ArrangementRowState => ({ id: `P${scoreId}`, name: 'Rigo', instruments: [], scoreId, status, extractedFrom });
        const rows = [row(1, 'UP_TO_DATE', 4), row(2, 'MODIFIED', 3), row(3, 'TO_EXTRACT', 3), row(4, 'TO_EXTRACT', null), row(null, 'NEW', null)];
        const { component, opened, arrangements } = setup([extracted, corrected, waiting, written], { arrangement: { id: 1, trackId: 5, rows } });
        await new Promise((resolve) => setTimeout(resolve));

        expect(arrangements.arrangement).toHaveBeenCalledWith(5);
        expect([extracted, corrected, waiting, written].map((item) => component.extractedLabel(item))).toEqual(['Estratta dalla partitura (versione 4)', 'Estratta dalla partitura (versione 3)', 'Estratta dalla partitura (versione 3)', null]);
        expect([extracted, corrected, waiting, written].map((item) => component.extractionDivergence(item)?.label ?? null)).toEqual([null, "Modificata dopo l'estrazione", 'La partitura è cambiata', null]);
        expect(component.pendingHint(waiting)).toBe('Le 2 pagine impaginate dalla versione 1 aspettano: sostituiscono quelle della parte o vanno in una parte nuova');
        expect(component.pendingHint(written)).toBe('');

        component.engrave(waiting, 6, 1);
        expect(opened().component).toBe(EngraveDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ scoreId: 3, versionId: 6, versionNumber: 1, hasPages: true }));
    });

    it('reads the score only with the writing on, and shows no label when it cannot be read', async () => {
        const { arrangements } = setup([], { writing: false });
        expect(arrangements.arrangement).not.toHaveBeenCalled();

        const failing = setup([part({}, { version })]);
        failing.arrangements.arrangement.and.rejectWith(new Error('offline'));
        failing.component.reload();
        await new Promise((resolve) => setTimeout(resolve));
        expect(failing.component.extractedLabel(part({}, { version }))).toBeNull();
    });

    it('marks the parts to engrave and those with pages of an older version', () => {
        const { component } = setup([]);
        expect(component.toEngrave(part({}, { version, hasPages: false }))).toBeTrue();
        expect(component.toEngrave(part({}, { version: null, hasPages: false }))).toBeFalse();
        expect(component.toEngrave(part({}, { version }))).toBeFalse();
        expect(component.engravingOutdated(part({}, { version, engravedFromVersionId: 6 }))).toBeTrue();
        expect(component.engravingOutdated(part({}, { version, engravedFromVersionId: 7 }))).toBeFalse();
        expect(component.engravingOutdated(part({}, { version, engravedFromVersionId: null }))).toBeFalse();
    });

    it('engraves the current version with the header of the track and reloads the parts once the pages are assigned', () => {
        const written = part({}, { version, hasPages: false, description: 'Flicorno I' });
        const { component, service, close, opened } = setup([written]);
        const versions: number[] = [];
        let partsChanged = 0;
        component.trackVersionChange.subscribe((value: number) => versions.push(value));
        component.partsChange.subscribe(() => partsChanged++);

        component.engrave(written);
        expect(opened().component).toBe(EngraveDialogComponent);
        expect(opened().data).toEqual({
            trackId: 5,
            scoreId: 1,
            versionId: 7,
            versionNumber: 2,
            partLabel: 'Flicorno I',
            header: { title: 'Marcia', composer: 'G. Gabetti', arranger: '', partName: 'Flicorno I' },
            hasPages: false,
            trackVersion: 2
        });
        close();
        expect(service.playback).toHaveBeenCalledTimes(1);

        component.engrave(written);
        close({ scoreId: 1, trackVersion: 3, target: 'REPLACE' });
        expect(versions).toEqual([3]);
        expect(partsChanged).toBe(1);
        expect(service.playback).toHaveBeenCalledTimes(2);
    });

    it('engraves the version the writing editor asks for, after reading the parts again', () => {
        const written = part({}, { version, hasPages: false });
        const { component, service, close, opened } = setup([written]);

        component.write(written);
        expect(opened().data).toEqual(jasmine.objectContaining({ engravable: true }));
        close({ engraveVersionId: 7 });

        expect(service.playback).toHaveBeenCalledTimes(2);
        expect(opened().component).toBe(EngraveDialogComponent);
        expect(opened().data).toEqual(jasmine.objectContaining({ scoreId: 1, versionId: 7, versionNumber: 2 }));
    });

    it('does not engrave a part without a version', () => {
        const { component, dialogs } = setup([]);
        component.engrave(part({}, { version: null }));
        expect(dialogs.open).not.toHaveBeenCalled();
    });
});

describe('ScorePlaybackPanelComponent recognition', () => {
    function setup(parts: PartPlayback[], canManage = true, recognitionAvailable = true) {
        const service = {
            canManage,
            playback: jasmine.createSpy().and.returnValue(of(playback(parts, recognitionAvailable))),
            recognitions: jasmine.createSpy(),
            recognize: jasmine.createSpy().and.callFake((_track: number, scoreId: number) => of([job(scoreId, 'QUEUED')])),
            recognizeAll: jasmine.createSpy().and.returnValue(of([job(1, 'QUEUED'), job(2, 'QUEUED')]))
        };
        const toast = jasmine.createSpyObj('ToastService', ['success']);
        const component: any = new ScorePlaybackPanelComponent(service as never, null!, toast, null!, null!, { scoreWritingEnabled: () => false } as never, null!);
        component.trackId = 5;
        component.reload();
        return { component, service, toast };
    }

    it('starts the recognition from «Ascolta» only for managers of parts with pages and no version', () => {
        const waiting = part({}, { availability: 'NOT_AVAILABLE', version: null });
        const { component, service } = setup([waiting]);

        expect(component.listenStartsRecognition(waiting)).toBeTrue();
        expect(component.listenHint(waiting)).toContain('Avvia il riconoscimento');
        component.listen(waiting);
        expect(service.recognize).toHaveBeenCalledWith(5, 1, jasmine.anything());
        component.ngOnDestroy();

        const listener = setup([waiting], false).component;
        expect(listener.listenStartsRecognition(waiting)).toBeFalse();
        expect(listener.listenHint(waiting)).toBe('Ascolto non ancora disponibile');
        expect(setup([waiting], true, false).component.listenStartsRecognition(waiting)).toBeFalse();
        const withoutPages = part({}, { availability: 'NOT_AVAILABLE', hasPages: false });
        expect(setup([withoutPages]).component.listenStartsRecognition(withoutPages)).toBeFalse();
    });

    it('follows the progress every few seconds and reloads the parts when a recognition ends', fakeAsync(() => {
        const { component, service } = setup([part({}, { scoreId: 1 }), part({}, { scoreId: 2, hasPages: false })]);
        component.recognizeAll();
        expect(component.recognizableParts.map((item: PartPlayback) => item.scoreId)).toEqual([]);
        expect(component.recognitionStatus(component.playback.parts[0].recognition)).toBe('Riconoscimento in coda');

        service.recognitions.and.returnValue(of([job(1, 'RUNNING', { attempts: 2 })]));
        tick(RECOGNITION_POLL_MILLIS);
        expect(service.recognitions).toHaveBeenCalledTimes(1);
        expect(component.recognitionStatus(component.playback.parts[0].recognition)).toBe('Riconoscimento in corso (tentativo 2)');
        expect(service.playback).toHaveBeenCalledTimes(1);

        service.recognitions.and.returnValue(of([job(1, 'FAILED', { errorCode: 'engineTimeout' })]));
        service.playback.and.returnValue(of(playback([part({}, { scoreId: 1, recognition: job(1, 'FAILED', { errorCode: 'engineTimeout' }) })])));
        tick(RECOGNITION_POLL_MILLIS);
        expect(service.playback).toHaveBeenCalledTimes(2);
        expect(component.recognitionStatus(component.playback.parts[0].recognition)).toBe('Riconoscimento non riuscito: i motori hanno superato il tempo massimo');

        tick(RECOGNITION_POLL_MILLIS * 3);
        expect(service.recognitions).toHaveBeenCalledTimes(2);
        component.ngOnDestroy();
    }));
});
