import { HttpErrorResponse, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { HANDLED_ERRORS } from './api-error-context';
import { EDIT_LOCK_RENEWAL_MS, ScoreEditLockService } from './score-edit-lock.service';

describe('ScoreEditLockService', () => {
    const url = `${environment.baseUrl}/tracks/4/scores/9/edit-lock`;
    const lockedBy = (owner: string, sameUser = false) => ({ message: 'error.scoreWriting.locked', args: { ownerName: owner, since: '2026-11-14T09:32:00Z', sameUser } });
    let service: ScoreEditLockService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
        service = TestBed.inject(ScoreEditLockService);
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => http.verify());

    it('takes the lock with the session of the window, renews it every 30 seconds and releases it', fakeAsync(() => {
        const lock = service.forPart(4, 9);
        expect(lock.session).toMatch(/^[A-Za-z0-9-]{8,64}$/);
        expect(service.forPart(4, 9).session).not.toBe(lock.session);

        let held: boolean | undefined;
        void lock.acquire().then((result) => (held = result));
        const acquire = http.expectOne((request) => request.url === url && request.method === 'POST');
        expect(acquire.request.params.get('takeOver')).toBe('false');
        expect(acquire.request.body).toEqual({ session: lock.session });
        expect(acquire.request.context.get(HANDLED_ERRORS)).toEqual(['scoreWriting.locked']);
        acquire.flush({ ownerName: 'Mario Rossi', since: '2026-11-14T09:32:00Z', expiresAt: '2026-11-14T09:34:00Z', mine: true });
        flushMicrotasks();
        expect(held).toBeTrue();
        expect(lock.state()).toEqual({ status: 'held', message: null });

        tick(EDIT_LOCK_RENEWAL_MS);
        const renewal = http.expectOne((request) => request.url === url && request.method === 'PUT');
        expect(renewal.request.body).toEqual({ session: lock.session });
        renewal.flush({});

        // Un problema di rete passeggero non toglie il blocco: il rinnovo successivo riprova.
        tick(EDIT_LOCK_RENEWAL_MS);
        http.expectOne((request) => request.method === 'PUT').error(new ProgressEvent('error'), { status: 0 });
        expect(lock.held).toBeTrue();
        tick(EDIT_LOCK_RENEWAL_MS);
        http.expectOne((request) => request.method === 'PUT').flush({});

        lock.release();
        const release = http.expectOne((request) => request.url === url && request.method === 'DELETE');
        expect(release.request.params.get('session')).toBe(lock.session);
        release.flush(null);
        expect(lock.state().status).toBe('released');
        tick(EDIT_LOCK_RENEWAL_MS);
        http.expectNone((request) => request.method === 'PUT');
    }));

    it('opens in read only when someone else writes, and takes over on request', fakeAsync(() => {
        const lock = service.forPart(4, 9);

        void lock.acquire();
        http.expectOne((request) => request.method === 'POST').flush(lockedBy('Mario Rossi'), { status: 409, statusText: 'Conflict' });
        flushMicrotasks();
        expect(lock.state().status).toBe('locked');
        expect(lock.state().message).toMatch(/^In modifica da Mario Rossi dalle \d\d:\d\d$/);
        tick(EDIT_LOCK_RENEWAL_MS);
        http.expectNone((request) => request.method === 'PUT');

        void lock.acquire(true);
        const takeOver = http.expectOne((request) => request.method === 'POST');
        expect(takeOver.request.params.get('takeOver')).toBe('true');
        takeOver.flush({});
        flushMicrotasks();
        expect(lock.held).toBeTrue();
        lock.release();
        http.expectOne((request) => request.method === 'DELETE').flush(null);
    }));

    it('passes to read only when someone takes over, at the renewal or at a save', fakeAsync(() => {
        const lock = service.forPart(4, 9);
        void lock.acquire();
        http.expectOne((request) => request.method === 'POST').flush({});
        flushMicrotasks();

        tick(EDIT_LOCK_RENEWAL_MS);
        http.expectOne((request) => request.method === 'PUT').flush(lockedBy('Lucia Bianchi'), { status: 409, statusText: 'Conflict' });
        expect(lock.state().status).toBe('lost');
        expect(lock.state().message).toContain('Lucia Bianchi');
        tick(EDIT_LOCK_RENEWAL_MS);
        http.expectNone((request) => request.method === 'PUT');

        void lock.acquire(true);
        http.expectOne((request) => request.method === 'POST').flush({});
        flushMicrotasks();
        expect(lock.refused(new HttpErrorResponse({ status: 422, error: { message: 'error.scoreWriting.contentInvalid' } }))).toBeFalse();
        expect(lock.held).toBeTrue();
        expect(lock.refused(new HttpErrorResponse({ status: 409, error: lockedBy('Anna Verdi', true) }))).toBeTrue();
        expect(lock.state().status).toBe('lost');
        expect(lock.state().message).toContain("aperta in un'altra finestra");

        // Chi ha perso il blocco non lo rilascia: appartiene ormai a un altro.
        lock.release();
        http.expectNone((request) => request.method === 'DELETE');
    }));

    it('reports a lock that cannot be taken for other reasons, and gives back a lock taken after the close', fakeAsync(() => {
        const lock = service.forPart(4, 9);
        void lock.acquire();
        http.expectOne((request) => request.method === 'POST').flush({ message: 'error.tenantFeature.scorePlayback.disabled' }, { status: 403, statusText: 'Forbidden' });
        flushMicrotasks();
        expect(lock.state().status).toBe('unavailable');

        const closed = service.forPart(4, 9);
        let held: boolean | undefined;
        void closed.acquire().then((result) => (held = result));
        closed.release();
        http.expectOne((request) => request.method === 'POST').flush({});
        flushMicrotasks();
        expect(held).toBeFalse();
        http.expectOne((request) => request.method === 'DELETE').flush(null);
        expect(closed.state().status).toBe('released');
    }));
});
