import { HttpErrorResponse } from '@angular/common/http';
import { fakeAsync, tick } from '@angular/core/testing';
import { SheetsMusic, TrackUploadJob, Tracks } from '../../../module';
import { of, Subject, throwError } from 'rxjs';
import { RoleEnums } from '../../../constants';
import { UxTelemetryService } from '../../../service';
import { DetailComponent } from './detail.component';

describe('Track DetailComponent', () => {
    const tenantFeatures = { scorePlaybackEnabled: () => false, loaded: () => true } as any;
    const telemetry = (): jasmine.SpyObj<UxTelemetryService> => jasmine.createSpyObj<UxTelemetryService>('UxTelemetryService', ['start', 'record', 'flush']);

    it('loads upload jobs only once during initialization', () => {
        const tracksService = jasmine.createSpyObj('TracksService', ['getById', 'getUploadJobs']);
        const instrumentsService = jasmine.createSpyObj('InstrumentsService', ['getAll']);
        tracksService.getById.and.returnValue(of(new Tracks()));
        tracksService.getUploadJobs.and.returnValue(of([]));
        instrumentsService.getAll.and.returnValue(of({ content: [], totalElements: 0 }));
        const route = { params: of({ id: 8 }), snapshot: { queryParamMap: { get: () => null } } };
        const keycloakService = { currentUserRole: RoleEnums.ARCHIVIST };
        const component = new DetailComponent(tracksService, instrumentsService, null!, keycloakService as any, null!, route as any, null!, null!, null!, tenantFeatures, telemetry());

        component.ngOnInit();

        expect(tracksService.getUploadJobs).toHaveBeenCalledOnceWith(8);
    });

    [RoleEnums.USER, RoleEnums.USER_EXTERNAL].forEach((role) => {
        it(`hides PDF management and ignores its deep link for ${role}`, () => {
            const tracksService = jasmine.createSpyObj('TracksService', ['getById', 'getUploadJobs']);
            const instrumentsService = jasmine.createSpyObj('InstrumentsService', ['getAll']);
            tracksService.getById.and.returnValue(of(new Tracks()));
            tracksService.getUploadJobs.and.returnValue(of([]));
            instrumentsService.getAll.and.returnValue(of({ content: [], totalElements: 0 }));
            const route = { params: of({ id: 8 }), snapshot: { queryParamMap: { get: () => 'pdf' } } };
            const keycloakService = { currentUserRole: role, isUser: role === RoleEnums.USER, isUserExternal: role === RoleEnums.USER_EXTERNAL };
            const component = new DetailComponent(tracksService, instrumentsService, null!, keycloakService as any, null!, route as any, null!, null!, null!, tenantFeatures, telemetry());

            component.ngOnInit();

            expect(component['canManagePdf']).toBeFalse();
            expect(component['activeTab']).toBe('details');
            expect(tracksService.getUploadJobs).not.toHaveBeenCalled();
        });
    });

    it('opens the playback tab from a deep link only when score playback is enabled', () => {
        const route = { params: of({ id: 8 }), snapshot: { queryParamMap: { get: () => 'playback' } } };
        const keycloakService = { currentUserRole: RoleEnums.USER, isUser: true, isUserExternal: false };
        const open = (enabled: boolean) => {
            const tracksService = jasmine.createSpyObj('TracksService', ['getById']);
            const instrumentsService = jasmine.createSpyObj('InstrumentsService', ['getAll']);
            tracksService.getById.and.returnValue(of(new Tracks()));
            instrumentsService.getAll.and.returnValue(of({ content: [], totalElements: 0 }));
            const component = new DetailComponent(tracksService, instrumentsService, null!, keycloakService as any, null!, route as any, null!, null!, null!, {
                scorePlaybackEnabled: () => enabled,
                loaded: () => true
            } as any, telemetry());
            component.ngOnInit();
            return component['activeTab'];
        };

        expect(open(true)).toBe('playback');
        expect(open(false)).toBe('details');
    });

    it('opens the playback tab of a deep link once the tenant features arrive', () => {
        const route = { params: of({ id: 8 }), snapshot: { queryParamMap: { get: () => 'playback' } } };
        const keycloakService = { currentUserRole: RoleEnums.USER, isUser: true, isUserExternal: false };
        const tracksService = jasmine.createSpyObj('TracksService', ['getById']);
        const instrumentsService = jasmine.createSpyObj('InstrumentsService', ['getAll']);
        tracksService.getById.and.returnValue(of(new Tracks()));
        instrumentsService.getAll.and.returnValue(of({ content: [], totalElements: 0 }));
        let enabled = false;
        const tenantFeatures = {
            scorePlaybackEnabled: () => enabled,
            loaded: () => false,
            refresh: jasmine.createSpy().and.callFake(() => {
                enabled = true;
                return of({});
            })
        };
        const component = new DetailComponent(tracksService, instrumentsService, null!, keycloakService as any, null!, route as any, null!, null!, null!, tenantFeatures as any, telemetry());

        component.ngOnInit();

        expect(tenantFeatures.refresh).toHaveBeenCalled();
        expect(component['activeTab']).toBe('playback');
    });

    it('treats details and parts as one track save unit', () => {
        const component = new DetailComponent(null!, null!, null!, null!, null!, null!, null!, null!, null!, tenantFeatures, telemetry());

        component['onScoresDirtyChange'](true);
        expect(component.isDirtyForm).toBeTrue();

        component['markDetailsDirty']();
        component['onScoresDirtyChange'](false);
        expect(component.isDirtyForm).toBeTrue();
    });

    it('replaces one source page with every generated crop image', () => {
        const toastService = jasmine.createSpyObj('ToastService', ['success']);
        const component = new DetailComponent(null!, null!, null!, null!, toastService, null!, null!, null!, null!, tenantFeatures, telemetry());
        component['track'] = {
            id: 4,
            version: 2,
            scores: [{ id: 5, media: [{ index: 6 }, { index: 7 }], instruments: [] }]
        } as Tracks;

        component['applyImageEditResult']({
            trackId: 4,
            trackVersion: 3,
            scoreId: 5,
            replacedMediaId: 6,
            media: [
                { index: 8, name: 'page-edited-1.png', order: 1 },
                { index: 9, name: 'page-edited-2.png', order: 2 }
            ]
        });

        expect(component['track'].scores![0].media!.map((media) => media.index)).toEqual([8, 9, 7]);
        expect(component['track'].version).toBe(3);
        expect(toastService.success).toHaveBeenCalledWith('Immagini create', 'La pagina è stata sostituita con 2 nuove immagini.');
    });

    it('names every upload state in Italian and tells the pending ones apart', () => {
        const component = new DetailComponent(null!, null!, null!, null!, null!, null!, null!, null!, null!, tenantFeatures, telemetry());

        expect(component['uploadStatusLabel']('TO_PROCESS')).toBe('In coda');
        expect(component['uploadStatusLabel']('IN_PROGRESS')).toBe('Elaborazione in corso');
        expect(component['uploadStatusLabel']('DONE')).toBe('Completato');
        expect(component['uploadStatusLabel']('ERROR')).toBe('Elaborazione non riuscita');
        expect(component['uploadStatusLabel']('NOT_FOUND')).toBe('File sorgente non disponibile');
        expect(component['isPendingUpload']({ id: 1, name: 'a.pdf', trackId: 8, status: 'TO_PROCESS' })).toBeTrue();
        expect(component['isPendingUpload']({ id: 1, name: 'a.pdf', trackId: 8, status: 'IN_PROGRESS' })).toBeTrue();
        expect(component['isPendingUpload']({ id: 1, name: 'a.pdf', trackId: 8, status: 'DONE' })).toBeFalse();
    });

    it('summarizes how the parts of a finished job were matched with the instruments', () => {
        const component = new DetailComponent(null!, null!, null!, null!, null!, null!, null!, null!, null!, tenantFeatures, telemetry());
        const job = { id: 1, name: 'a.pdf', trackId: 8, status: 'DONE' as const, partsWithInstruments: 1, partsWithSuggestions: 2, partsWithoutInstruments: 0 };

        expect(component['uploadSummary'](job)).toBe('1 parte con strumenti assegnati · 2 con strumenti da aggiungere · 0 senza strumenti');
        expect(component['uploadSummary']({ ...job, partsWithInstruments: 3 })).toContain('3 parti con strumenti assegnati');
        expect(component['uploadSummary']({ ...job, status: 'IN_PROGRESS' })).toBeUndefined();
        expect(component['uploadSummary']({ id: 1, name: 'a.pdf', trackId: 8, status: 'DONE' })).toBeUndefined();
    });

    it('engraves the current version of a part of the workspace and reads the track again', () => {
        const onClose = new Subject<unknown>();
        const dialogService = jasmine.createSpyObj('DialogService', ['open']);
        dialogService.open.and.returnValue({ onClose });
        const features = { scorePlaybackEnabled: () => true, scoreWritingEnabled: () => true, loaded: () => true } as any;
        const component = new DetailComponent(null!, null!, null!, { currentUserRole: RoleEnums.ARCHIVIST } as any, null!, null!, null!, null!, dialogService, features, telemetry());
        component['track'] = { id: 8, version: 5, name: 'Marcia reale', composer: 'G. Gabetti', scores: [] } as Tracks;
        const reload = spyOn<any>(component, 'reloadTrack');
        const score: SheetsMusic = { id: 3, media: [], currentScoreVersionId: 70 };

        expect(component['canEngrave']).toBeTrue();
        component['engravePart']({ score, label: 'Tuba' });

        expect(dialogService.open.calls.mostRecent().args[1].data).toEqual({
            trackId: 8,
            scoreId: 3,
            versionId: 70,
            partLabel: 'Tuba',
            header: { title: 'Marcia reale', composer: 'G. Gabetti', arranger: '', partName: 'Tuba' },
            hasPages: false,
            trackVersion: 5
        });
        onClose.next({ scoreId: 3, trackVersion: 6, target: 'REPLACE' });
        expect(component['track'].version).toBe(6);
        expect(reload).toHaveBeenCalledTimes(1);

        component['isDirty'] = true;
        component['engravePart']({ score, label: 'Tuba' });
        expect(dialogService.open).toHaveBeenCalledTimes(1);
        expect(new DetailComponent(null!, null!, null!, { currentUserRole: RoleEnums.USER } as any, null!, null!, null!, null!, null!, features, telemetry())['canEngrave']).toBeFalse();
    });

    it('takes the track of the applied instruments as saved and reads the instruments again', () => {
        const instrumentsService = jasmine.createSpyObj('InstrumentsService', ['getAll']);
        instrumentsService.getAll.and.returnValue(of({ content: [{ id: 4, name: 'Arpa' }], totalElements: 1 }));
        const component = new DetailComponent(null!, instrumentsService, null!, null!, null!, null!, null!, null!, null!, tenantFeatures, telemetry());
        component['isDirty'] = true;

        component['onInstrumentSuggestionsApplied']({ id: 8, version: 6, scores: [{ id: 1, instruments: [{ index: 4, name: 'Arpa' }] }] });

        expect(component['track'].version).toBe(6);
        expect(component['baselineScores'][0].instruments![0].name).toBe('Arpa');
        expect(instrumentsService.getAll).toHaveBeenCalled();
    });

    it('shows the job of the accepted upload at once, without asking the server again', () => {
        const tracksService = jasmine.createSpyObj('TracksService', ['uploadPdf']);
        const toastService = jasmine.createSpyObj('ToastService', ['success']);
        tracksService.uploadPdf.and.returnValue(of({ id: 12, name: 'partitura.pdf', trackId: 8, status: 'TO_PROCESS' }));
        const component = new DetailComponent(tracksService, null!, null!, null!, toastService, null!, null!, null!, null!, tenantFeatures, telemetry());
        component['track'] = { id: 8 } as Tracks;
        component['uploadJobs'] = [{ id: 11, name: 'vecchio.pdf', trackId: 8, status: 'DONE' }];

        component['handleUpload']({ files: [new File([new Uint8Array([1])], 'partitura.pdf', { type: 'application/pdf' })] });

        expect(component['uploadJobs'][0]).toEqual({ id: 12, name: 'partitura.pdf', trackId: 8, status: 'TO_PROCESS' });
        expect(component['uploadStatusLabel'](component['uploadJobs'][0].status)).toBe('In coda');
        expect(component['uploading']).toBeFalse();
        expect(toastService.success).toHaveBeenCalled();
    });

    it('puts a failed job back in the queue when the user retries it', () => {
        const tracksService = jasmine.createSpyObj('TracksService', ['retryUploadJob']);
        const toastService = jasmine.createSpyObj('ToastService', ['success']);
        tracksService.retryUploadJob.and.returnValue(of({ id: 12, name: 'partitura.pdf', trackId: 8, status: 'TO_PROCESS' }));
        const component = new DetailComponent(tracksService, null!, null!, null!, toastService, null!, null!, null!, null!, tenantFeatures, telemetry());
        component['track'] = { id: 8 } as Tracks;
        const failed: TrackUploadJob = { id: 12, name: 'partitura.pdf', trackId: 8, status: 'ERROR' };
        component['uploadJobs'] = [failed];

        component['retryUpload'](failed);

        expect(tracksService.retryUploadJob).toHaveBeenCalledOnceWith(8, 12);
        expect(component['uploadJobs'][0].status).toBe('TO_PROCESS');
        expect(toastService.success).toHaveBeenCalled();
    });

    it('shows at most the five most recent jobs', () => {
        const component = new DetailComponent(null!, null!, null!, null!, null!, null!, null!, null!, null!, tenantFeatures, telemetry());
        component['uploadJobs'] = Array.from({ length: 7 }, (ignored, index) => ({
            id: index,
            name: `file-${index}.pdf`,
            trackId: 8,
            status: 'DONE' as const
        }));

        expect(component['visibleUploadJobs'].map((job) => job.id)).toEqual([0, 1, 2, 3, 4]);
    });
    it('asks the browser to confirm a refresh only while the draft has changes', () => {
        const listened: string[] = [];
        spyOn(window, 'addEventListener').and.callFake((type: string) => listened.push(type));
        const component = new DetailComponent(null!, null!, null!, null!, null!, null!, null!, null!, null!, tenantFeatures, telemetry());

        component['watchBrowserExit']();
        const guard = component['browserExitGuard'];
        const clean = beforeUnload();
        guard(clean);
        component['markDetailsDirty']();
        const dirty = beforeUnload();
        guard(dirty);

        expect(listened).toContain('beforeunload');
        expect(clean.preventDefault).not.toHaveBeenCalled();
        expect(dirty.preventDefault).toHaveBeenCalled();
    });

    it('shows that everything is saved until the next change', fakeAsync(() => {
        const tracksService = jasmine.createSpyObj('TracksService', ['update']);
        const toastService = jasmine.createSpyObj('ToastService', ['success']);
        const saved: Tracks = { id: 8, version: 4, scores: [] } as Tracks;
        tracksService.update.and.returnValue(of(saved));
        const measures = telemetry();
        const component = new DetailComponent(tracksService, null!, null!, null!, toastService, null!, null!, null!, null!, tenantFeatures, measures);
        component['track'] = { id: 8, version: 3, scores: [] } as Tracks;

        component['save']();
        tick(1_000);

        expect(component['savedIndicator']).toBeTrue();
        expect(measures.flush).toHaveBeenCalled();

        component['onScoresDirtyChange'](true);
        expect(component['savedIndicator']).toBeFalse();
    }));

    it('compares the draft with the server after a version conflict', () => {
        const tracksService = jasmine.createSpyObj('TracksService', ['update', 'getById']);
        tracksService.update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'error.version.conflict' } })));
        const server: Tracks = { id: 8, version: 9, scores: [{ id: 1, order: 1, description: 'Clarinetto', media: [], instruments: [] }, { id: 2, order: 2, description: 'Flauto', media: [], instruments: [] }] } as Tracks;
        tracksService.getById.and.returnValue(of(server));
        const component = new DetailComponent(tracksService, null!, null!, null!, null!, null!, null!, null!, null!, tenantFeatures, telemetry());
        const draft: SheetsMusic[] = [{ id: 1, order: 1, description: 'Clarinetto solo', media: [], instruments: [] }];
        component['track'] = { id: 8, version: 3, scores: draft } as Tracks;
        component['baselineScores'] = [{ id: 1, order: 1, description: 'Clarinetto', media: [], instruments: [] }];

        component['save']();

        expect(component['saveError']).toBeTrue();
        expect(component['conflict']?.serverAdded.map((score) => score.id)).toEqual([2]);
        expect(component['conflict']?.draftChanged).toBe(1);
        expect(component['newPartsAvailable']).toBeTrue();
        expect(component['conflictDetail']).toContain('1 parte nuova sul server');
        expect(component['conflictDetail']).toContain('1 parte modificata nella bozza');
    });

    it('adds the new server parts to the draft and opens the parts tab', () => {
        const tracksService = jasmine.createSpyObj('TracksService', ['getById']);
        const toastService = jasmine.createSpyObj('ToastService', ['success']);
        const router = jasmine.createSpyObj('Router', ['navigate']);
        const server: Tracks = { id: 8, version: 9, scores: [{ id: 1, order: 1, media: [], instruments: [] }, { id: 2, order: 2, media: [], instruments: [] }] } as Tracks;
        tracksService.getById.and.returnValue(of(server));
        const component = new DetailComponent(tracksService, null!, null!, null!, toastService, { snapshot: {} } as any, router, null!, null!, tenantFeatures, telemetry());
        component['track'] = { id: 8, version: 3, scores: [{ id: 1, order: 1, description: 'Rinominata', media: [], instruments: [] }] } as Tracks;
        component['newPartsAvailable'] = true;

        component['reloadAndContinue']();

        expect(component['track'].scores?.map((score) => score.id)).toEqual([1, 2]);
        expect(component['track'].scores?.[0].description).toBe('Rinominata');
        expect(component['track'].version).toBe(9);
        expect(component['baselineScores']).toHaveSize(2);
        expect(component['newPartsAvailable']).toBeFalse();
        expect(component['activeTab']).toBe('parts');
    });

    it('notices the parts of a completed job when the browser tab comes back', () => {
        const tracksService = jasmine.createSpyObj('TracksService', ['getUploadJobs']);
        tracksService.getUploadJobs.and.returnValue(of([{ id: 12, name: 'partitura.pdf', trackId: 8, status: 'DONE' }]));
        const keycloakService = { currentUserRole: RoleEnums.ARCHIVIST };
        const component = new DetailComponent(tracksService, null!, null!, keycloakService as any, null!, null!, null!, null!, null!, tenantFeatures, telemetry());
        component['track'] = { id: 8 } as Tracks;
        component['uploadJobs'] = [{ id: 12, name: 'partitura.pdf', trackId: 8, status: 'IN_PROGRESS' }];

        component['onVisibilityChange']();

        expect(tracksService.getUploadJobs).toHaveBeenCalledOnceWith(8);
        expect(component['newPartsAvailable']).toBeTrue();
    });

    it('reads the jobs again only when one was still being processed', () => {
        const tracksService = jasmine.createSpyObj('TracksService', ['getUploadJobs']);
        const keycloakService = { currentUserRole: RoleEnums.ARCHIVIST };
        const component = new DetailComponent(tracksService, null!, null!, keycloakService as any, null!, null!, null!, null!, null!, tenantFeatures, telemetry());
        component['track'] = { id: 8 } as Tracks;
        component['uploadJobs'] = [{ id: 12, name: 'partitura.pdf', trackId: 8, status: 'DONE' }];

        component['onVisibilityChange']();

        expect(tracksService.getUploadJobs).not.toHaveBeenCalled();
        expect(component['newPartsAvailable']).toBeFalse();
    });

    it('opens the parts session of the telemetry when the tab is opened', () => {
        const router = jasmine.createSpyObj('Router', ['navigate']);
        const measures = telemetry();
        const component = new DetailComponent(null!, null!, null!, null!, null!, { snapshot: {} } as any, router, null!, null!, tenantFeatures, measures);

        component['onTabChange']('parts');
        component['onUxEvent']('merge');

        expect(measures.start).toHaveBeenCalledOnceWith('track-parts-workspace');
        expect(measures.record).toHaveBeenCalledOnceWith('merge');
    });
});

function beforeUnload(): BeforeUnloadEvent {
    return { preventDefault: jasmine.createSpy('preventDefault'), returnValue: undefined } as unknown as BeforeUnloadEvent;
}
