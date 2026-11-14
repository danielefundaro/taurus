import { fakeAsync, tick } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { NewPartDialogComponent } from '../../../../dialogs/new-part-dialog/new-part-dialog.component';
import { ScoreEditorDialogComponent } from '../../../../dialogs/score-editor-dialog/score-editor-dialog.component';
import { PartPlayback, PlaybackSound, RecognitionJob, TrackPlayback } from '../../../../module';
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
    const component: any = new ScorePlaybackPanelComponent({ canManage: true, playback: () => of() } as never, null!, null!, null!, null!, { scoreWritingEnabled: () => true } as never);

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

    function setup(parts: PartPlayback[], { canManage = true, writing = true } = {}) {
        const closes: Subject<unknown>[] = [];
        const service = { canManage, playback: jasmine.createSpy().and.returnValue(of(playback(parts))) };
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
        const component: any = new ScorePlaybackPanelComponent(service as never, dialogs as never, toast, drafts, confirm, { scoreWritingEnabled: () => writing } as never);
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
        expect(opened().data).toEqual(jasmine.objectContaining({ trackId: 5, scoreId: 1, versionId: 7, mode: 'writing', resume: false }));
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
        const component: any = new ScorePlaybackPanelComponent(service as never, null!, toast, null!, null!, { scoreWritingEnabled: () => false } as never);
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
