import { TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
import { Preferences, TenantStatus } from '../module';
import { LayoutService } from './layout.service';
import { LocalStorageService } from './local-storage.service';
import { PreferencesService } from './preferences.service';
import { TenantStatusService } from './tenant-status.service';

describe('LayoutService', () => {
    let preferencesService: jasmine.SpyObj<PreferencesService>;
    let storage: Map<string, Preferences>;
    let tenantStatus: TenantStatus;
    let service: LayoutService;

    const start = location.pathname + location.search;

    beforeEach(() => {
        // Headless Chrome does not render view transitions: run the update callback directly
        spyOn(document as any, 'startViewTransition').and.callFake((update: () => void) => {
            update();
            return { finished: Promise.resolve() };
        });
        storage = new Map();
        tenantStatus = { tenantCode: 'tenant-a', provisioned: true };
        preferencesService = jasmine.createSpyObj<PreferencesService>('PreferencesService', ['count', 'getAll', 'create', 'update']);
        preferencesService.count.and.returnValue(NEVER);
        const localStorageService = jasmine.createSpyObj<LocalStorageService>('LocalStorageService', ['getItem', 'setItem']);
        localStorageService.getItem.and.callFake((key: string) => storage.get(key) ?? null);
        localStorageService.setItem.and.callFake((key: string, value: Preferences) => {
            storage.set(key, value);
        });

        // The real service, so that whenProvisioned decides on the page and on the status as in the application
        const tenantStatusService = new TenantStatusService(null as any);
        spyOn(tenantStatusService, 'load').and.callFake(() => of(tenantStatus));

        TestBed.configureTestingModule({
            providers: [
                { provide: PreferencesService, useValue: preferencesService },
                { provide: LocalStorageService, useValue: localStorageService },
                { provide: TenantStatusService, useValue: tenantStatusService }
            ]
        });
        service = TestBed.inject(LayoutService);
        TestBed.tick();
    });

    it('keeps a preference without id local instead of updating it on the server', () => {
        storage.set('primary', { key: 'primary', value: 'emerald' } as Preferences);

        service.layoutConfig.update((config) => ({ ...config, primary: 'blue' }));
        TestBed.tick();

        expect(preferencesService.update).not.toHaveBeenCalled();
        expect(storage.get('primary')?.value).toBe('blue');
    });

    it('updates a persisted preference on the server', () => {
        storage.set('primary', { id: 3, key: 'primary', value: 'emerald' } as Preferences);
        preferencesService.update.and.returnValue(of({ id: 3, key: 'primary', value: 'blue' } as Preferences));

        service.layoutConfig.update((config) => ({ ...config, primary: 'blue' }));
        TestBed.tick();

        expect(preferencesService.update).toHaveBeenCalledOnceWith(3, jasmine.objectContaining({ key: 'primary', value: 'blue' }));
        expect(storage.get('primary')).toEqual(jasmine.objectContaining({ id: 3, value: 'blue' }));
    });

    it('does not touch the server while the tenant has no schema', () => {
        tenantStatus = { tenantCode: 'temp', provisioned: false };
        storage.set('primary', { id: 3, key: 'primary', value: 'emerald' } as Preferences);
        storage.delete('preset');
        preferencesService.count.calls.reset();

        service.layoutConfig.update((config) => ({ ...config, preset: 'Lara', primary: 'blue' }));
        TestBed.tick();

        expect(preferencesService.update).not.toHaveBeenCalled();
        expect(preferencesService.count).not.toHaveBeenCalled();
        expect(storage.get('primary')?.value).toBe('blue');
        expect(storage.get('preset')?.value).toBe('Lara');
    });

    // At start-up the server preferences and the configurator write back the values the layout already has.
    it('neither animates nor notifies when the configuration gets the values it already has', () => {
        const startTransition = document.startViewTransition as jasmine.Spy;
        const updates = jasmine.createSpy('configUpdate');
        service.configUpdate$.subscribe(updates);
        const current = service.layoutConfig();

        service.layoutConfig.update((config) => ({ ...config, preset: 'Aura', primary: 'emerald', surface: '', darkTheme: false }));
        TestBed.tick();

        expect(service.layoutConfig()).toBe(current);
        expect(startTransition).not.toHaveBeenCalled();
        expect(updates).not.toHaveBeenCalled();
    });

    it('still animates a change of theme', () => {
        const startTransition = document.startViewTransition as jasmine.Spy;

        service.layoutConfig.update((config) => ({ ...config, darkTheme: true }));
        TestBed.tick();

        expect(startTransition).toHaveBeenCalledTimes(1);
        expect(document.documentElement.classList).toContain('app-dark');

        service.layoutConfig.update((config) => ({ ...config, darkTheme: false }));
        TestBed.tick();
    });

    describe('on a public page', () => {
        afterEach(() => history.replaceState(null, '', start));

        it('keeps the layout local instead of asking the server for the preferences', () => {
            history.replaceState(null, '', '/legal/terms');
            storage.set('primary', { id: 3, key: 'primary', value: 'emerald' } as Preferences);
            storage.delete('preset');
            preferencesService.count.calls.reset();

            service.layoutConfig.update((config) => ({ ...config, preset: 'Lara', primary: 'blue' }));
            service.layoutState.update((state) => ({ ...state, staticMenuDesktopInactive: true }));
            TestBed.tick();

            expect(preferencesService.count).not.toHaveBeenCalled();
            expect(preferencesService.update).not.toHaveBeenCalled();
            expect(storage.get('primary')?.value).toBe('blue');
            expect(storage.get('preset')?.value).toBe('Lara');
        });
    });
});
