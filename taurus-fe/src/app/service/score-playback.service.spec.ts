import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { RoleEnums } from '../constants';
import { KeycloakService } from './keycloak.service';
import { ScorePlaybackService } from './score-playback.service';

describe('ScorePlaybackService', () => {
    let service: ScorePlaybackService;
    let http: HttpTestingController;
    const keycloak = { currentUserRole: RoleEnums.ARCHIVIST };

    beforeEach(() => {
        keycloak.currentUserRole = RoleEnums.ARCHIVIST;
        TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), { provide: KeycloakService, useValue: keycloak }] });
        service = TestBed.inject(ScorePlaybackService);
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => http.verify());

    it('reads the playback through the path of the current role', () => {
        const paths: [RoleEnums, string][] = [
            [RoleEnums.ADMIN, 'tracks'],
            [RoleEnums.USER, 'user/tracks'],
            [RoleEnums.USER_EXTERNAL, 'external/tracks']
        ];
        for (const [role, path] of paths) {
            keycloak.currentUserRole = role;
            service.playback(5).subscribe();
            http.expectOne(`${environment.baseUrl}/${path}/5/playback`).flush({});
            service.playbackFile(5, 9).subscribe();
            const file = http.expectOne(`${environment.baseUrl}/${path}/5/scores/9/playback-file`);
            expect(file.request.responseType).toBe('text');
            file.flush('<score-partwise/>');
        }
    });

    it('lets only archivists and administrators manage the parts', () => {
        expect(service.canManage).toBeTrue();
        keycloak.currentUserRole = RoleEnums.SUPER_ADMIN;
        expect(service.canManage).toBeTrue();
        keycloak.currentUserRole = RoleEnums.USER;
        expect(service.canManage).toBeFalse();
        keycloak.currentUserRole = RoleEnums.USER_EXTERNAL;
        expect(service.canManage).toBeFalse();
    });

    it('uploads the file as multipart with the chosen part and approval', () => {
        const file = new File(['<score-partwise/>'], 'parte.musicxml');
        const base = `${environment.baseUrl}/tracks/5/scores/9/score-versions`;

        service.inspect(5, 9, file).subscribe();
        const inspect = http.expectOne(`${base}/inspect`);
        expect(inspect.request.method).toBe('POST');
        expect((inspect.request.body as FormData).get('file')).toEqual(jasmine.any(File));
        inspect.flush([]);

        service.upload(5, 9, file, 'P2', true).subscribe();
        const upload = http.expectOne((request) => request.url === base);
        expect(upload.request.params.get('partId')).toBe('P2');
        expect(upload.request.params.get('approve')).toBe('true');
        upload.flush({});

        service.upload(5, 9, file, null, false).subscribe();
        const single = http.expectOne((request) => request.url === base);
        expect(single.request.params.has('partId')).toBeFalse();
        single.flush({});
    });

    it('manages versions and settings on the archive paths', () => {
        const base = `${environment.baseUrl}/tracks/5`;

        service.approve(5, 9, 3).subscribe();
        expect(http.expectOne(`${base}/scores/9/score-versions/3/approve`).request.method).toBe('POST');
        service.makeCurrent(5, 9, 3).subscribe();
        expect(http.expectOne(`${base}/scores/9/score-versions/3/current`).request.method).toBe('POST');
        service.versionFile(5, 9, 3).subscribe();
        expect(http.expectOne(`${base}/scores/9/score-versions/3/file`).request.responseType).toBe('blob');
        service.updatePartSettings(5, 9, { transpositionOverride: -2, soundBankOverride: null, soundProgramOverride: null }).subscribe();
        expect(http.expectOne(`${base}/scores/9/playback-settings`).request.method).toBe('PUT');
        service.updateTrackSettings(5, { tempoBpm: 96, referenceScoreId: 9, version: 4 }).subscribe();
        const settings = http.expectOne(`${base}/playback-settings`);
        expect(settings.request.body).toEqual({ tempoBpm: 96, referenceScoreId: 9, version: 4 });
        settings.flush({});
        service.recognize(5, 9).subscribe();
        expect(http.expectOne(`${base}/scores/9/recognitions`).request.method).toBe('POST');
        service.recognizeAll(5).subscribe();
        expect(http.expectOne(`${base}/recognitions`).request.method).toBe('POST');
        service.recognitions(5).subscribe();
        expect(http.expectOne((request) => request.method === 'GET' && request.url === `${base}/recognitions`).request.method).toBe('GET');
        service.instrumentSuggestion('Flicorno tenore in Sib').subscribe();
        const suggestion = http.expectOne((request) => request.url === `${environment.baseUrl}/instruments/playback-suggestion`);
        expect(suggestion.request.params.get('name')).toBe('Flicorno tenore in Sib');
        suggestion.flush(null);
        http.match(() => true).forEach((request) => request.flush({}));
    });

    it('engraves a version, reads its latest engraving, assigns the pages and downloads the PDF', () => {
        const base = `${environment.baseUrl}/tracks/5/scores/9/score-versions/70/engravings`;
        const options = { format: 'MARCH' as const, header: { title: 'Marcia' } };

        service.engrave(5, 9, 70, options).subscribe();
        const start = http.expectOne(base);
        expect([start.request.method, start.request.body]).toEqual(['POST', options]);
        start.flush({ id: 100 });

        let latest: unknown = 'unread';
        service.engraving(5, 9, 70).subscribe((job) => (latest = job));
        http.expectOne((request) => request.method === 'GET' && request.url === base).flush(null, { status: 204, statusText: 'No Content' });
        expect(latest).toBeNull();

        service.applyEngraving(5, 9, 70, 100, 'NEW_PART', 4).subscribe();
        const apply = http.expectOne(`${base}/100/apply`);
        expect([apply.request.method, apply.request.body]).toEqual(['POST', { target: 'NEW_PART', trackVersion: 4 }]);
        apply.flush({ scoreId: 12, trackVersion: 5 });

        service.engravingPdf(5, 9, 70).subscribe();
        const pdf = http.expectOne(`${base}/pdf`);
        expect(pdf.request.responseType).toBe('blob');
        pdf.flush(new Blob(['%PDF']));
    });
});
