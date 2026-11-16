import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EnsembleInstrument } from '../../../module';
import { ApiErrorService, InstrumentsService, ToastService } from '../../../service';
import { EnsembleComponent } from './ensemble.component';

/** Gli strumenti nell'ordine di riferimento: gli ultimi due non hanno una famiglia. */
const REFERENCE: EnsembleInstrument[] = [
    { id: 1, name: 'Flauto 1°', family: 'WOODWINDS', ensemblePosition: 2 },
    { id: 2, name: 'Clarinetto 1°', family: 'WOODWINDS', ensemblePosition: null },
    { id: 3, name: 'Tromba 1°', family: 'TRUMPETS', ensemblePosition: 1 },
    { id: 4, name: 'Basso 1°', family: 'BASSES', ensemblePosition: null },
    { id: 5, name: 'Arpa', family: null, ensemblePosition: 3 },
    { id: 6, name: 'Voce', family: null, ensemblePosition: null }
];

function apiError(status: number, key: string): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { message: `error.${key}` } });
}

describe('EnsembleComponent', () => {
    let fixture: ComponentFixture<EnsembleComponent>;
    let component: EnsembleComponent;
    let instruments: jasmine.SpyObj<InstrumentsService>;
    let toast: jasmine.SpyObj<ToastService>;

    beforeEach(async () => {
        instruments = jasmine.createSpyObj<InstrumentsService>('InstrumentsService', ['ensembleReference', 'saveEnsemble']);
        instruments.ensembleReference.and.returnValue(of(REFERENCE.map((instrument) => ({ ...instrument }))));
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'warn', 'info', 'error']);
        await TestBed.configureTestingModule({
            imports: [EnsembleComponent],
            providers: [
                { provide: InstrumentsService, useValue: instruments },
                { provide: ToastService, useValue: toast },
                { provide: ApiErrorService, useValue: new ApiErrorService() }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(EnsembleComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    const state = () => component as unknown as Record<string, any>;
    const names = () => (state()['rows'] as EnsembleInstrument[]).map((row) => row.name);
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

    it('shows the saved ensemble in its order, with the family of each instrument', () => {
        expect(names()).toEqual(['Tromba 1°', 'Flauto 1°', 'Arpa']);
        expect(component.isDirty).toBeFalse();
        expect(text()).toContain('Trombe e cornette');
        expect(state()['available'].map((instrument: EnsembleInstrument) => instrument.name)).toEqual(['Clarinetto 1°', 'Basso 1°', 'Voce']);
    });

    it('moves, removes and adds instruments, each instrument at the place of its family', () => {
        state()['moveBy'](0, 1);
        expect(names()).toEqual(['Flauto 1°', 'Tromba 1°', 'Arpa']);
        expect(state()['announcement']).toBe('Tromba 1° spostato in posizione 2 di 3.');
        state()['moveBy'](2, 1);
        expect(names()).toEqual(['Flauto 1°', 'Tromba 1°', 'Arpa']);

        state()['drop']({ previousIndex: 2, currentIndex: 0 } as CdkDragDrop<EnsembleInstrument[]>);
        expect(names()).toEqual(['Arpa', 'Flauto 1°', 'Tromba 1°']);
        state()['drop']({ previousIndex: 1, currentIndex: 1 } as CdkDragDrop<EnsembleInstrument[]>);

        state()['selectedToAdd'] = REFERENCE[1];
        state()['add']();
        expect(names()).toEqual(['Arpa', 'Flauto 1°', 'Clarinetto 1°', 'Tromba 1°']);
        state()['selectedToAdd'] = REFERENCE[5];
        state()['add']();
        expect(names()).toEqual(['Arpa', 'Flauto 1°', 'Clarinetto 1°', 'Tromba 1°', 'Voce']);
        state()['selectedToAdd'] = REFERENCE[3];
        state()['add']();
        expect(names()).toEqual(['Arpa', 'Flauto 1°', 'Clarinetto 1°', 'Tromba 1°', 'Basso 1°', 'Voce']);
        expect(state()['announcement']).toBe("Basso 1° aggiunto all'organico in posizione 5 di 6.");
        state()['add']();
        expect(names().length).toBe(6);

        state()['remove'](0);
        expect(names()).toEqual(['Flauto 1°', 'Clarinetto 1°', 'Tromba 1°', 'Basso 1°', 'Voce']);
        expect(state()['announcement']).toBe("Arpa tolto dall'organico.");
        expect(component.isDirty).toBeTrue();

        state()['discard']();
        expect(names()).toEqual(['Tromba 1°', 'Flauto 1°', 'Arpa']);
        expect(component.isDirty).toBeFalse();
    });

    it('proposes the reference order, or every instrument with an empty ensemble', () => {
        state()['moveBy'](0, 2);
        expect(names()).toEqual(['Flauto 1°', 'Arpa', 'Tromba 1°']);

        state()['proposeReference']();
        expect(names()).toEqual(['Flauto 1°', 'Tromba 1°', 'Arpa']);

        state()['rows'] = [];
        fixture.detectChanges();
        expect(text()).toContain("L'organico è vuoto");
        state()['proposeReference']();
        expect(names()).toEqual(REFERENCE.map((instrument) => instrument.name));
        expect(instruments.saveEnsemble).not.toHaveBeenCalled();
    });

    it('saves the new order against the ensemble it read', () => {
        instruments.saveEnsemble.and.returnValue(
            of([
                { id: 1, name: 'Flauto 1°', family: 'WOODWINDS', ensemblePosition: 1 },
                { id: 3, name: 'Tromba 1°', family: 'TRUMPETS', ensemblePosition: 2 }
            ])
        );
        state()['moveBy'](0, 1);
        state()['remove'](2);

        state()['save']();

        expect(instruments.saveEnsemble.calls.mostRecent().args.slice(0, 2)).toEqual([
            [1, 3],
            [3, 1, 5]
        ]);
        expect(names()).toEqual(['Flauto 1°', 'Tromba 1°']);
        expect(component.isDirty).toBeFalse();
        expect(toast.success).toHaveBeenCalledWith('Organico salvato', "2 strumenti nell'organico.");
        expect(state()['available'].find((instrument: EnsembleInstrument) => instrument.id === 5).ensemblePosition).toBeNull();

        state()['save']();
        expect(instruments.saveEnsemble).toHaveBeenCalledTimes(1);
    });

    it('reports a concurrent change and an unknown instrument inside the tab, and reloads on request', () => {
        state()['moveBy'](0, 1);
        instruments.saveEnsemble.and.returnValue(throwError(() => apiError(409, 'version.conflict')));
        state()['save']();
        fixture.detectChanges();
        expect(text()).toContain("Nel frattempo l'organico è stato cambiato da un'altra persona");
        expect(component.isDirty).toBeTrue();

        instruments.saveEnsemble.and.returnValue(throwError(() => apiError(400, 'instrument.ensemble.invalid')));
        state()['save']();
        expect(state()['errorDetail']).toBe("Uno degli strumenti dell'organico non esiste più o compare due volte");

        instruments.saveEnsemble.and.returnValue(throwError(() => apiError(500, 'internalServerError')));
        state()['errorDetail'] = '';
        state()['save']();
        expect(state()['errorDetail']).toBe('');

        state()['load']();
        expect(names()).toEqual(['Tromba 1°', 'Flauto 1°', 'Arpa']);
        expect(component.isDirty).toBeFalse();
    });

    it('offers a retry when the ensemble cannot be read, and warns before leaving the browser with changes', () => {
        instruments.ensembleReference.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
        state()['load']();
        fixture.detectChanges();
        expect(text()).toContain("L'organico non è stato caricato.");

        instruments.ensembleReference.and.returnValue(of(REFERENCE.map((instrument) => ({ ...instrument }))));
        state()['load']();
        const unchanged = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
        state()['onBrowserExit'](unchanged);
        expect(unchanged.defaultPrevented).toBeFalse();

        state()['remove'](0);
        const changed = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
        state()['onBrowserExit'](changed);
        expect(changed.defaultPrevented).toBeTrue();
    });
});
