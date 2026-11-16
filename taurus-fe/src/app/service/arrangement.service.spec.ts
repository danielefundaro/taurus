import { HttpContext, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { ArrangementService } from './arrangement.service';

describe('ArrangementService', () => {
    const url = `${environment.baseUrl}/tracks/4/arrangement`;
    let service: ArrangementService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
        service = TestBed.inject(ArrangementService);
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => http.verify());

    it('reads the score of the track, or nothing when the track has none', fakeAsync(() => {
        let arrangement: unknown = 'unread';
        void service.arrangement(4).then((value) => (arrangement = value));
        http.expectOne(url).flush(null, { status: 204, statusText: 'No Content' });
        flushMicrotasks();
        expect(arrangement).toBeNull();

        void service.arrangement(4).then((value) => (arrangement = value));
        http.expectOne(url).flush({ id: 3, trackId: 4, rows: [] });
        flushMicrotasks();
        expect(arrangement).toEqual({ id: 3, trackId: 4, rows: [] });
    }));

    it('creates and deletes the score with the given context and session', fakeAsync(() => {
        const context = new HttpContext();
        const body = { content: '<score-partwise/>', rows: [{ id: 'P1', instrumentIds: [2], scoreId: 9 }] };
        let created: unknown;
        void service.create(4, body, context).then((value) => (created = value));
        const post = http.expectOne(url);
        expect(post.request.method).toBe('POST');
        expect(post.request.body).toEqual(body);
        expect(post.request.context).toBe(context);
        post.flush({ id: 3 });
        flushMicrotasks();
        expect(created).toEqual({ id: 3 });

        void service.delete(4);
        const removal = http.expectOne((request) => request.url === url && request.method === 'DELETE');
        expect(removal.request.params.has('session')).toBeFalse();
        removal.flush(null);

        void service.delete(4, 'editor-window-1', context);
        const owned = http.expectOne((request) => request.url === url && request.method === 'DELETE');
        expect(owned.request.params.get('session')).toBe('editor-window-1');
        owned.flush(null);
    }));

    it('lists, saves, reads, downloads and approves the versions', fakeAsync(() => {
        let versions: unknown;
        void service.versions(4).then((value) => (versions = value));
        http.expectOne(`${url}/versions`).flush([{ id: 21 }]);
        flushMicrotasks();
        expect(versions).toEqual([{ id: 21 }]);

        const request = { editSession: 'editor-window-1', content: '<a/>', rows: [{ id: 'P1', instrumentIds: [2] }], parentVersionId: 21, approve: false, confirmOutdated: false };
        let saved: unknown;
        void service.save(4, request).then((value) => (saved = value));
        const save = http.expectOne((candidate) => candidate.url === `${url}/versions` && candidate.method === 'POST');
        expect(save.request.body).toEqual(request);
        save.flush({ id: 22 });
        flushMicrotasks();
        expect(saved).toEqual({ id: 22 });

        let content: unknown;
        void service.content(4, 22).then((value) => (content = value));
        const read = http.expectOne(`${url}/versions/22/content`);
        expect(read.request.responseType).toBe('text');
        read.flush('<score-partwise/>');
        flushMicrotasks();
        expect(content).toBe('<score-partwise/>');

        let file: unknown;
        void service.file(4, 22).then((value) => (file = value));
        const download = http.expectOne(`${url}/versions/22/file`);
        expect(download.request.responseType).toBe('blob');
        download.flush(new Blob(['mxl']));
        flushMicrotasks();
        expect(file).toEqual(jasmine.any(Blob));

        let approved: unknown;
        void service.approve(4, 22).then((value) => (approved = value));
        const approve = http.expectOne(`${url}/versions/22/approve`);
        expect(approve.request.method).toBe('POST');
        approve.flush({ id: 22, status: 'APPROVED' });
        flushMicrotasks();
        expect(approved).toEqual({ id: 22, status: 'APPROVED' });
    }));

    it('reads and discards the draft of the score', fakeAsync(() => {
        expect(service.draftUrl(4)).toBe(`${url}/draft`);
        let draft: unknown = 'unread';
        void service.draft(4).then((value) => (draft = value));
        http.expectOne(`${url}/draft`).flush(null, { status: 204, statusText: 'No Content' });
        flushMicrotasks();
        expect(draft).toBeNull();

        void service.draft(4).then((value) => (draft = value));
        http.expectOne(`${url}/draft`).flush({ content: '<a/>', rows: [] });
        flushMicrotasks();
        expect(draft).toEqual({ content: '<a/>', rows: [] });

        void service.discardDraft(4);
        const discard = http.expectOne((request) => request.url === `${url}/draft` && request.method === 'DELETE');
        expect(discard.request.params.has('session')).toBeFalse();
        discard.flush(null);

        void service.discardDraft(4, 'editor-window-1');
        const owned = http.expectOne((request) => request.url === `${url}/draft` && request.method === 'DELETE');
        expect(owned.request.params.get('session')).toBe('editor-window-1');
        owned.flush(null);
    }));
});
