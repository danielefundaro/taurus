import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { discardPeriodicTasks, fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { HANDLED_ERRORS } from './api-error-context';
import { KeycloakService } from './keycloak.service';
import { DRAFT_DELAY_MS, DRAFT_MAX_WAIT_MS, DRAFT_OFFLINE_RETRY_MS, DRAFT_RETRY_MS, IndexedDbDraftStore, LOCAL_COPY_DELAY_MS, LocalDraftCopy, LocalDraftStore, PartDraftKeeper, ScoreDraftService } from './score-draft.service';
import { PartEditLock, ScoreEditLockService } from './score-edit-lock.service';

/** Archivio in memoria al posto di IndexedDB. */
class MemoryDraftStore extends LocalDraftStore {
    readonly copies = new Map<string, LocalDraftCopy>();
    async get(key: string): Promise<LocalDraftCopy | null> {
        return this.copies.get(key) ?? null;
    }
    async put(copy: LocalDraftCopy): Promise<void> {
        this.copies.set(copy.key, { ...copy });
    }
    async delete(key: string): Promise<void> {
        this.copies.delete(key);
    }
}

describe('ScoreDraftService', () => {
    const url = `${environment.baseUrl}/tracks/4/scores/9/score-draft`;
    const key = 'banda:mario:4:9';
    const lockedBy = (owner: string, sameUser = false) => ({ message: 'error.scoreWriting.locked', args: { ownerName: owner, since: '2026-11-14T09:32:00Z', sameUser } });
    let service: ScoreDraftService;
    let http: HttpTestingController;
    let store: MemoryDraftStore;
    let lock: PartEditLock;
    let content: string;
    let keeper: PartDraftKeeper;

    const put = (): TestRequest => http.expectOne((request) => request.url === url && request.method === 'PUT');
    const saved = (request: TestRequest, entityVersion: number, savedAt = '2026-11-14T09:40:00Z') => request.flush({ entityVersion, savedAt });
    const edit = (value: string) => {
        content = value;
        keeper.changed();
    };

    beforeEach(() => {
        store = new MemoryDraftStore();
        TestBed.configureTestingModule({
            providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), { provide: LocalDraftStore, useValue: store }, { provide: KeycloakService, useValue: { currentUserTenantCode: 'banda', currentUserId: 'mario' } }]
        });
        service = TestBed.inject(ScoreDraftService);
        http = TestBed.inject(HttpTestingController);
        lock = TestBed.inject(ScoreEditLockService).forPart(4, 9);
        content = '<score-partwise/>';
        keeper = service.keeper(4, 9, { lock, content: () => content, baseVersionId: 12, entityVersion: 3, savedAt: '2026-11-14T09:00:00Z' });
    });
    afterEach(() => {
        keeper.stop();
        http.verify();
    });

    it('saves the draft a few seconds after the last change and keeps a copy in the browser until the server has it', fakeAsync(() => {
        expect(keeper.key).toBe(key);
        expect(keeper.state()).toEqual({ status: 'clean', savedAt: '2026-11-14T09:00:00Z', message: null });

        edit('<a/>');
        expect(keeper.state().status).toBe('pending');
        tick(LOCAL_COPY_DELAY_MS);
        flushMicrotasks();
        expect(store.copies.get(key)).toEqual(jasmine.objectContaining({ key, content: '<a/>', baseVersionId: 12, entityVersion: 3 }));
        tick(DRAFT_DELAY_MS - LOCAL_COPY_DELAY_MS - 1);
        edit('<b/>');
        tick(DRAFT_DELAY_MS - 1);
        http.expectNone((request) => request.method === 'PUT');
        tick(1);

        const request = put();
        expect(request.request.body).toEqual({ editSession: lock.session, content: '<b/>', baseVersionId: 12, entityVersion: 3 });
        expect(request.request.context.get(HANDLED_ERRORS)).toEqual(['*']);
        expect(keeper.state().status).toBe('saving');
        saved(request, 4);
        flushMicrotasks();
        expect(keeper.state()).toEqual({ status: 'saved', savedAt: '2026-11-14T09:40:00Z', message: null });
        expect(keeper.entityVersion).toBe(4);
        expect(keeper.dirty).toBeFalse();
        expect(store.copies.has(key)).toBeFalse();

        edit('<c/>');
        tick(DRAFT_DELAY_MS);
        expect(put().request.body.entityVersion).toBe(4);
    }));

    it('saves at least every 30 seconds while the author keeps writing', fakeAsync(() => {
        for (let elapsed = 0; elapsed < DRAFT_MAX_WAIT_MS; elapsed += 2_000) {
            edit(`<m n="${elapsed}"/>`);
            tick(2_000);
        }
        saved(put(), 4);
        flushMicrotasks();
    }));

    it('keeps the changes written while a save is on its way', fakeAsync(() => {
        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        const first = put();
        edit('<b/>');
        saved(first, 4);
        flushMicrotasks();
        expect(keeper.dirty).toBeTrue();
        expect(keeper.state().status).toBe('pending');
        tick(LOCAL_COPY_DELAY_MS);
        flushMicrotasks();
        expect(store.copies.get(key)?.content).toBe('<b/>');
        tick(DRAFT_DELAY_MS);
        const second = put();
        expect(second.request.body).toEqual(jasmine.objectContaining({ content: '<b/>', entityVersion: 4 }));
        saved(second, 5);
        flushMicrotasks();
        expect(store.copies.has(key)).toBeFalse();
    }));

    it('retries a save refused as too frequent', fakeAsync(() => {
        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        put().flush({ message: 'error.scoreWriting.draftTooFrequent' }, { status: 429, statusText: 'Too Many Requests' });
        flushMicrotasks();
        expect(keeper.state().status).toBe('pending');
        tick(DRAFT_RETRY_MS);
        saved(put(), 4);
        flushMicrotasks();
        expect(keeper.state().status).toBe('saved');
    }));

    it('stops when someone else holds the lock and keeps the copy in the browser', fakeAsync(() => {
        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        put().flush(lockedBy('Lucia Bianchi'), { status: 409, statusText: 'Conflict' });
        flushMicrotasks();

        expect(keeper.state().status).toBe('rejected');
        expect(keeper.state().message).toMatch(/^Le modifiche delle \d\d:\d\d non sono state salvate: ora sta scrivendo Lucia Bianchi$/);
        expect(lock.state().status).toBe('lost');
        expect(store.copies.get(key)?.content).toBe('<a/>');
        edit('<b/>');
        tick(DRAFT_MAX_WAIT_MS);
        flushMicrotasks();
        http.expectNone((request) => request.method === 'PUT');
        expect(store.copies.get(key)?.content).toBe('<b/>');

        void keeper.forget();
        flushMicrotasks();
        expect(store.copies.has(key)).toBeFalse();
        expect(keeper.state().status).toBe('stopped');
    }));

    it('sends the refused changes again with the known draft version once the lock is back', fakeAsync(() => {
        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        put().flush(lockedBy('Lucia Bianchi'), { status: 409, statusText: 'Conflict' });
        flushMicrotasks();
        expect(keeper.state().status).toBe('rejected');

        let result: boolean | undefined;
        void keeper.retry().then((value) => (result = value));
        flushMicrotasks();
        const request = put();
        // Nessuna rilettura della bozza: se Lucia ha salvato la sua, il server risponde con un conflitto.
        expect(request.request.body).toEqual(jasmine.objectContaining({ content: '<a/>', entityVersion: 3 }));
        request.flush({ message: 'error.scoreWriting.draftConflict' }, { status: 409, statusText: 'Conflict' });
        flushMicrotasks();
        expect(result).toBeFalse();
        expect(keeper.state().status).toBe('conflict');
    }));

    it('names another window of the same author and the span of the changes', fakeAsync(() => {
        edit('<a/>');
        tick(60_000);
        edit('<b/>');
        tick(DRAFT_DELAY_MS);
        http.match((request) => request.method === 'PUT').forEach((request) => request.flush(lockedBy('Mario Rossi', true), { status: 409, statusText: 'Conflict' }));
        flushMicrotasks();
        expect(keeper.state().message).toMatch(/^Le modifiche (delle|dalle) \d\d:\d\d.* non sono state salvate: la parte è aperta in un'altra finestra$/);
    }));

    it('lets the author keep their changes over a draft changed elsewhere, or start again from it', fakeAsync(() => {
        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        put().flush({ message: 'error.scoreWriting.draftConflict' }, { status: 409, statusText: 'Conflict' });
        flushMicrotasks();
        expect(keeper.state()).toEqual(jasmine.objectContaining({ status: 'conflict', message: "La bozza è stata modificata altrove: riaprire l'editor" }));
        edit('<b/>');
        tick(DRAFT_MAX_WAIT_MS);
        http.expectNone((request) => request.method === 'PUT');

        let kept: boolean | undefined;
        void keeper.overwrite().then((result) => (kept = result));
        http.expectOne((request) => request.url === url && request.method === 'GET').flush({ entityVersion: 8, content: '<x/>', baseVersionId: 12, savedAt: '2026-11-14T09:39:00Z', measureCount: 1, outdated: false });
        flushMicrotasks();
        const request = put();
        expect(request.request.body).toEqual(jasmine.objectContaining({ content: '<b/>', entityVersion: 8 }));
        saved(request, 9);
        flushMicrotasks();
        expect(kept).toBeTrue();

        edit('<c/>');
        tick(DRAFT_DELAY_MS);
        put().flush({ message: 'error.scoreWriting.draftConflict' }, { status: 409, statusText: 'Conflict' });
        flushMicrotasks();
        void keeper.reset({ entityVersion: 11, content: '<y/>', baseVersionId: 13, savedAt: '2026-11-14T09:45:00Z', measureCount: 1, outdated: false });
        flushMicrotasks();
        expect(keeper.state()).toEqual({ status: 'clean', savedAt: '2026-11-14T09:45:00Z', message: null });
        expect(store.copies.has(key)).toBeFalse();
        edit('<d/>');
        tick(DRAFT_DELAY_MS);
        expect(put().request.body).toEqual(jasmine.objectContaining({ content: '<d/>', entityVersion: 11, baseVersionId: 13 }));
    }));

    it('waits for the connection when the server does not answer', fakeAsync(() => {
        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        put().error(new ProgressEvent('error'), { status: 0 });
        flushMicrotasks();
        expect(keeper.state().status).toBe('offline');
        expect(keeper.state().message).toContain('restano in questo browser');
        edit('<b/>');
        tick(DRAFT_DELAY_MS);
        http.expectNone((request) => request.method === 'PUT');
        tick(LOCAL_COPY_DELAY_MS);
        flushMicrotasks();
        expect(store.copies.get(key)?.content).toBe('<b/>');

        window.dispatchEvent(new Event('online'));
        const retried = put();
        expect(retried.request.body.content).toBe('<b/>');
        retried.flush({ message: 'Bad gateway' }, { status: 502, statusText: 'Bad Gateway' });
        flushMicrotasks();
        expect(keeper.state().status).toBe('offline');
        tick(DRAFT_OFFLINE_RETRY_MS);
        saved(put(), 4);
        flushMicrotasks();
        expect(keeper.state().status).toBe('saved');
        expect(store.copies.has(key)).toBeFalse();
    }));

    it('shows the reason of a content refused by the server and stops saving it', fakeAsync(() => {
        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        put().flush({ message: 'error.scoreWriting.contentInvalid', args: { reason: 'severalParts' } }, { status: 422, statusText: 'Unprocessable' });
        flushMicrotasks();
        expect(keeper.state()).toEqual(jasmine.objectContaining({ status: 'failed', message: 'La parte scritta deve contenere una sola parte' }));
        edit('<b/>');
        tick(DRAFT_MAX_WAIT_MS);
        http.expectNone((request) => request.method === 'PUT');
    }));

    it('flushes at once on close, after the save on its way', fakeAsync(() => {
        let result: boolean | undefined;
        void keeper.flush().then((value) => (result = value));
        flushMicrotasks();
        expect(result).toBeTrue();

        edit('<a/>');
        tick(DRAFT_DELAY_MS);
        const first = put();
        edit('<b/>');
        result = undefined;
        void keeper.flush().then((value) => (result = value));
        flushMicrotasks();
        saved(first, 4);
        flushMicrotasks();
        const second = put();
        expect(second.request.body.content).toBe('<b/>');
        saved(second, 5);
        flushMicrotasks();
        expect(result).toBeTrue();
        expect(store.copies.has(key)).toBeFalse();
    }));

    it('holds the autosave while a version is saved, then removes the copy', fakeAsync(() => {
        edit('<a/>');
        tick(LOCAL_COPY_DELAY_MS);
        void keeper.hold();
        flushMicrotasks();
        tick(DRAFT_MAX_WAIT_MS);
        http.expectNone((request) => request.method === 'PUT');

        // La versione non si salva: i salvataggi automatici riprendono.
        keeper.resume();
        tick(DRAFT_DELAY_MS);
        saved(put(), 4);
        flushMicrotasks();

        edit('<b/>');
        void keeper.hold();
        flushMicrotasks();
        void keeper.completed();
        flushMicrotasks();
        expect(keeper.state().status).toBe('stopped');
        expect(keeper.dirty).toBeFalse();
        tick(DRAFT_MAX_WAIT_MS);
        flushMicrotasks();
        expect(store.copies.has(key)).toBeFalse();
        http.expectNone((request) => request.method === 'PUT');
    }));

    it('discards the draft on the server with the session of the editor and the copy in the browser', fakeAsync(() => {
        edit('<a/>');
        tick(LOCAL_COPY_DELAY_MS);
        flushMicrotasks();
        let done = false;
        void keeper.discard().then(() => (done = true));
        flushMicrotasks();
        const request = http.expectOne((candidate) => candidate.url === url && candidate.method === 'DELETE');
        expect(request.request.params.get('session')).toBe(lock.session);
        request.flush(null);
        flushMicrotasks();
        expect(done).toBeTrue();
        expect(store.copies.has(key)).toBeFalse();
        tick(DRAFT_MAX_WAIT_MS);
        http.expectNone((candidate) => candidate.method === 'PUT');
        discardPeriodicTasks();
    }));

    it('reads drafts, copies and creates written parts', fakeAsync(() => {
        let draft: unknown = 'unread';
        void service.draft(4, 9).then((value) => (draft = value));
        http.expectOne(url).flush(null, { status: 204, statusText: 'No Content' });
        flushMicrotasks();
        expect(draft).toBeNull();

        void service.draft(4, 9).then((value) => (draft = value));
        http.expectOne(url).flush({ entityVersion: 2 });
        flushMicrotasks();
        expect(draft).toEqual({ entityVersion: 2 });

        void service.discard(4, 9);
        const discard = http.expectOne((request) => request.url === url && request.method === 'DELETE');
        expect(discard.request.params.has('session')).toBeFalse();
        discard.flush(null);

        let created: unknown;
        void service.createWrittenPart(4, { description: 'Tromba 2ª', instrumentIds: [3], content: '<a/>', trackVersion: 6 }).then((value) => (created = value));
        const post = http.expectOne(`${environment.baseUrl}/tracks/4/written-parts`);
        expect(post.request.method).toBe('POST');
        expect(post.request.body).toEqual({ description: 'Tromba 2ª', instrumentIds: [3], content: '<a/>', trackVersion: 6 });
        post.flush({ scoreId: 15, trackVersion: 7 });
        flushMicrotasks();
        expect(created).toEqual({ scoreId: 15, trackVersion: 7 });

        void store.put({ key, content: '<a/>', baseVersionId: null, entityVersion: null, changedFrom: '2026-11-14T09:00:00Z', changedAt: '2026-11-14T09:01:00Z' });
        let copy: LocalDraftCopy | null = null;
        void service.localCopy(4, 9).then((value) => (copy = value));
        flushMicrotasks();
        expect(copy).toEqual(jasmine.objectContaining({ content: '<a/>' }));
        void service.forgetLocalCopy(4, 9);
        flushMicrotasks();
        expect(store.copies.size).toBe(0);
    }));
});

describe('IndexedDbDraftStore', () => {
    const name = `taurus-score-drafts-test-${Math.random().toString(36).slice(2)}`;
    const copy: LocalDraftCopy = { key: 'banda:mario:4:9', content: '<a/>', baseVersionId: 12, entityVersion: 3, changedFrom: '2026-11-14T09:00:00Z', changedAt: '2026-11-14T09:01:00Z' };

    afterAll(async () => {
        await new Promise<void>((resolve) => {
            const deletion = indexedDB.deleteDatabase(name);
            deletion.onsuccess = deletion.onerror = deletion.onblocked = () => resolve();
        });
    });

    it('keeps, replaces and removes the copies in the browser', async () => {
        const store = new IndexedDbDraftStore(name);
        expect(await store.get(copy.key)).toBeNull();
        await store.put(copy);
        await store.put({ ...copy, content: '<b/>' });
        expect(await store.get(copy.key)).toEqual({ ...copy, content: '<b/>' });
        await store.close();

        const reopened = new IndexedDbDraftStore(name);
        expect((await reopened.get(copy.key))?.content).toBe('<b/>');
        await reopened.delete(copy.key);
        expect(await reopened.get(copy.key)).toBeNull();
        await reopened.close();
    });
});
