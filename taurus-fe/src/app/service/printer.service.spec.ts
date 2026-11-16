import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Albums, ChildrenEntities } from '../module';
import { InstrumentsService } from './instruments.service';
import { PrinterService } from './printer.service';
import { TracksService } from './tracks.service';

const album = (): Albums => {
    const value = new Albums();
    value.name = 'Concerto di Natale';
    value.tracks = [{ index: 3 } as ChildrenEntities];

    return value;
};

describe('PrinterService album preview', () => {
    let getById: jasmine.Spy;
    let navigate: jasmine.Spy;
    let service: PrinterService;

    beforeEach(() => {
        getById = jasmine.createSpy('getById');
        navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));

        TestBed.configureTestingModule({
            providers: [
                { provide: TracksService, useValue: { getById } },
                { provide: InstrumentsService, useValue: { ensemble: () => of([]) } },
                { provide: Router, useValue: { navigate } }
            ]
        });

        service = TestBed.inject(PrinterService);
    });

    it('does not open a partial preview and offers a retry when a track fails', () => {
        getById.and.returnValue(throwError(() => new Error('non disponibile')));

        service.preview(album());

        expect(service.scores).toEqual([]);
        expect(service.previewError).toBeTrue();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('repeats the failed command with the same source and selection', () => {
        getById.and.returnValue(throwError(() => new Error('non disponibile')));
        const selected = [{ index: 9 } as ChildrenEntities];
        service.preview(album(), selected);
        getById.calls.reset();
        getById.and.returnValue(of({ scores: [{ instruments: [], media: [{ index: 21 }] }] }));

        service.retry();

        expect(getById.calls.argsFor(0)[0]).toBe(9);
        expect(service.previewError).toBeFalse();
        expect(service.scores.length).toBe(1);
        expect(navigate).toHaveBeenCalledWith(['preview']);
    });

    it('hides the alert when a source page opens again', () => {
        getById.and.returnValue(throwError(() => new Error('non disponibile')));
        service.preview(album());

        service.dismissError();

        expect(service.previewError).toBeFalse();
    });

    it('clears the error when the state is released', () => {
        getById.and.returnValue(throwError(() => new Error('non disponibile')));
        service.preview(album());

        service.clear();

        expect(service.previewError).toBeFalse();
    });
});

describe('PrinterService event program preview', () => {
    let navigate: jasmine.Spy;
    let service: PrinterService;

    beforeEach(() => {
        navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
        TestBed.configureTestingModule({
            providers: [
                { provide: TracksService, useValue: { getById: jasmine.createSpy('getById') } },
                { provide: InstrumentsService, useValue: { ensemble: () => of([{ id: 8, name: 'Flicorno' }]) } },
                { provide: Router, useValue: { navigate } }
            ]
        });
        service = TestBed.inject(PrinterService);
    });

    it('opens the parts of the program by instrument, with the parts to engrave known by the event', () => {
        const parts = [
            { id: 4, instruments: [{ index: 3, name: 'Tromba' }], media: [{ index: 99 }] },
            { id: 6, instruments: [{ index: 8, name: 'Flicorno' }], media: [] }
        ];

        service.previewProgram('  Sfilata  ', parts, [6]);

        expect([service.previewTitle, service.previewSource, service.byInstrument]).toEqual(['Sfilata', 'Scaletta', true]);
        expect(service.scores).toEqual(parts);
        expect(service.scores).not.toBe(parts);
        expect(parts.map((part) => service.isUnengraved(part))).toEqual([false, true]);
        expect(navigate).toHaveBeenCalledWith(['preview']);
        expect(service.ensemble).toEqual([8]);

        service.retry();
        expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('forgets the program when another source opens or the state is released', () => {
        service.previewProgram('', [{ id: 6, media: [] }], [6]);
        expect(service.previewTitle).toBe('Scaletta');

        service.preview({ name: 'Marcia', scores: [{ id: 6, media: [] }] } as never);
        expect([service.byInstrument, service.isUnengraved({ id: 6, media: [] })]).toEqual([false, false]);
        // A written part of a track carries its version: it stays to engrave without the program.
        expect(service.isUnengraved({ id: 6, media: [], currentScoreVersionId: 2 })).toBeTrue();

        service.previewProgram('Sfilata', [{ id: 6, media: [] }], [6]);
        service.clear();
        expect([service.byInstrument, service.previewSource, service.isUnengraved({ id: 6, media: [] })]).toEqual([false, 'Traccia', false]);
    });
});

describe('PrinterService ensemble order', () => {
    let navigate: jasmine.Spy;
    let ensemble: jasmine.Spy;
    let getById: jasmine.Spy;
    let service: PrinterService;

    const part = (id: number, ...instruments: number[]) => ({ id, instruments: instruments.map((index) => ({ index })), media: [] });

    beforeEach(() => {
        navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
        ensemble = jasmine.createSpy('ensemble').and.returnValue(
            of([
                { id: 20, name: 'Flauto' },
                { id: 30, name: 'Tromba' }
            ])
        );
        getById = jasmine.createSpy('getById');
        TestBed.configureTestingModule({
            providers: [
                { provide: TracksService, useValue: { getById } },
                { provide: InstrumentsService, useValue: { ensemble } },
                { provide: Router, useValue: { navigate } }
            ]
        });
        service = TestBed.inject(PrinterService);
    });

    it('orders the parts of a track by the first of their instruments in the ensemble', () => {
        service.preview({ name: 'Marcia', scores: [part(1, 30), part(2), part(3, 99, 20), part(4, 30)] } as never);

        expect(service.scores.map((score) => score.id)).toEqual([3, 1, 4, 2]);
        expect(service.ensemble).toEqual([20, 30]);
        expect(navigate).toHaveBeenCalledWith(['preview']);
    });

    it('orders the parts within each track of an album and keeps the order of the tracks', () => {
        const value = album();
        value.tracks = [{ index: 1 } as ChildrenEntities, { index: 2 } as ChildrenEntities];
        getById.and.callFake((id: number) => of({ scores: id === 1 ? [part(1, 30), part(2, 20)] : [part(3, 30), part(4, 20)] }));

        service.preview(value);

        expect(service.scores.map((score) => score.id)).toEqual([2, 1, 4, 3]);
    });

    it('opens the preview in the order of the parts when the ensemble cannot be read', () => {
        ensemble.and.returnValue(throwError(() => new Error('non disponibile')));

        service.preview({ name: 'Marcia', scores: [part(1, 30), part(2, 20)] } as never);

        expect(service.scores.map((score) => score.id)).toEqual([1, 2]);
        expect(service.ensemble).toEqual([]);
        expect(navigate).toHaveBeenCalledWith(['preview']);
        service.clear();
        expect(service.ensemble).toEqual([]);
    });
});
