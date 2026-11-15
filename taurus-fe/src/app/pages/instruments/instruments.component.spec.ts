import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { ConfirmService, InstrumentsService, ListLayoutService, TenantFeatureService, ToastService } from '../../service';
import { InstrumentsComponent } from './instruments.component';

describe('InstrumentsComponent', () => {
    const create = (query: Record<string, string> = {}): InstrumentsComponent =>
        new InstrumentsComponent(
            {} as InstrumentsService,
            {} as ToastService,
            {} as DialogService,
            {} as ConfirmService,
            { observe: () => undefined } as unknown as ListLayoutService,
            { scorePlaybackEnabled: () => false } as unknown as TenantFeatureService,
            { snapshot: { queryParamMap: convertToParamMap(query) } } as unknown as ActivatedRoute
        );

    it('opens the list, and builds the ensemble tab the first time it is chosen', () => {
        const component = create();
        component.ngOnInit();
        const state = component as unknown as Record<string, any>;

        expect([state['activeTab'], state['ensembleOpened']]).toEqual(['list', false]);
        state['activeTab'] = 'ensemble';
        state['activeTab'] = 'list';
        expect([state['activeTab'], state['ensembleOpened']]).toEqual(['list', true]);
    });

    it('opens the ensemble from the link of another page', () => {
        const component = create({ tab: 'ensemble' });
        component.ngOnInit();

        expect((component as unknown as Record<string, any>)['ensembleOpened']).toBeTrue();
    });

    it('asks before leaving the page with unsaved changes to the ensemble', () => {
        const component = create();
        expect([component.isDirty, component.dirtyUnitLabels]).toEqual([false, []]);

        (component as unknown as Record<string, any>)['ensemble'] = { isDirty: true };
        expect([component.isDirty, component.dirtyUnitLabels]).toEqual([true, ['organico']]);
    });
});
