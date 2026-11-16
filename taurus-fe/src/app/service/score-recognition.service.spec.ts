import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ScoreEditorData, ScoreVersion, ScoreVersionOrigin } from '../module';
import cases from '../score-player/compare-cases.json';
import { HANDLED_ERRORS } from './api-error-context';
import { ScorePlaybackService } from './score-playback.service';
import { ScoreRecognitionService } from './score-recognition.service';

function version(id: number, origin: ScoreVersionOrigin, parentVersionId?: number): ScoreVersion {
    return { id, scoreId: 9, versionNumber: id, origin, status: 'UNVERIFIED', measureCount: 1, checks: {} as never, parentVersionId, createdAt: '2026-11-16T10:00:00Z', current: false, pagesChanged: false };
}

const ENGINE_XML = cases.cases.find((item) => item.name === 'notes')!.candidate;

describe('ScoreRecognitionService', () => {
    let service: ScoreRecognitionService;
    let http: HttpTestingController;
    let playback: jasmine.SpyObj<ScorePlaybackService>;

    beforeEach(() => {
        playback = jasmine.createSpyObj<ScorePlaybackService>('ScorePlaybackService', ['versions', 'editor']);
        playback.editor.and.callFake((_track, _score, versionId) => of({ musicXml: versionId === 1 ? ENGINE_XML : cases.reference } as ScoreEditorData));
        TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), { provide: ScorePlaybackService, useValue: playback }] });
        service = TestBed.inject(ScoreRecognitionService);
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => http.verify());

    it('reads the summary of a period and the approvals to collect', () => {
        service.report('2025-12-01').subscribe();
        http.expectOne(`${environment.baseUrl}/score-recognition/report?from=2025-12-01`).flush({ engines: [], months: [], parts: [] });
        service.report(null).subscribe();
        http.expectOne(`${environment.baseUrl}/score-recognition/report`).flush({ engines: [], months: [], parts: [] });
        service.pending(50).subscribe();
        http.expectOne(`${environment.baseUrl}/score-recognition/pending?limit=50`).flush({ total: 0, items: [] });
    });

    it('sends the counts of an approval without showing its errors', () => {
        const counts = { engineVersionId: 1, referenceMeasures: 1, engineMeasures: 1, correctMeasures: 1, pitchMeasures: 0, rhythmMeasures: 0, tieMeasures: 0, missingMeasures: 0, extraMeasures: 0, referenceMarks: 0, foundMarks: 0 };
        service.saveReview(5, 9, 3, counts).subscribe();
        const request = http.expectOne(`${environment.baseUrl}/tracks/5/scores/9/score-versions/3/recognition-review`);
        expect(request.request.method).toBe('PUT');
        expect(request.request.body).toEqual(counts);
        expect(request.request.context.get(HANDLED_ERRORS)).toEqual(['*']);
        request.flush(null);
    });

    it('compares the approved version with the version of the engine it descends from', async () => {
        const save = spyOn(service, 'saveReview').and.returnValue(of(undefined));
        const approved = version(3, 'CORRECTION', 2);

        expect(await service.collect(5, 9, approved, { versions: [version(1, 'OMR_AUDIVERIS'), version(2, 'CORRECTION', 1)], complete: true })).toBeTrue();

        expect(playback.versions).not.toHaveBeenCalled();
        expect(save).toHaveBeenCalledOnceWith(5, 9, 3, jasmine.objectContaining({ engineVersionId: 1, referenceMeasures: 14, engineMeasures: 14, correctMeasures: 10, pitchMeasures: 1, rhythmMeasures: 2, tieMeasures: 1 }));
    });

    it('reads the versions of the part when the known ones stop before the engine, and the known contents', async () => {
        const save = spyOn(service, 'saveReview').and.returnValue(of(undefined));
        playback.versions.and.returnValue(of([version(1, 'OMR_HOMR'), version(2, 'CORRECTION', 1)]));
        const approved = version(3, 'CORRECTION', 2);

        const collected = await service.collect(5, 9, approved, { versions: [version(2, 'CORRECTION', 1)], contents: new Map([[3, cases.reference]]) });

        expect(collected).toBeTrue();
        expect(playback.versions).toHaveBeenCalledOnceWith(5, 9);
        expect(playback.editor).toHaveBeenCalledOnceWith(5, 9, 1);
        expect(save).toHaveBeenCalledOnceWith(5, 9, 3, jasmine.objectContaining({ engineVersionId: 1, correctMeasures: 10 }));
    });

    it('collects nothing for a version that does not come from an engine, and swallows the errors', async () => {
        const save = spyOn(service, 'saveReview').and.returnValue(of(undefined));
        expect(await service.collect(5, 9, version(3, 'UPLOAD_MUSICXML'))).toBeFalse();
        expect(save).not.toHaveBeenCalled();

        save.and.returnValue(throwError(() => new Error('offline')));
        expect(await service.collect(5, 9, version(1, 'OMR_AUDIVERIS'))).toBeFalse();
        playback.versions.and.returnValue(throwError(() => new Error('offline')));
        expect(await service.collect(5, 9, version(3, 'CORRECTION', 2))).toBeFalse();
    });
});
