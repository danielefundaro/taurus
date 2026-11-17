import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RoleEnums } from '../../constants/role.enums';
import { TenantFeatureService, TenantStatusService } from '../../service';
import { MenuComponent } from './menu.component';

describe('MenuComponent', () => {
    it('updates feature entries when flags change', () => {
        const loaded = signal(false);
        const financeEnabled = signal(false);
        const inventoryEnabled = signal(false);
        const onboardingImportEnabled = signal(false);
        const externalCalendarFeedEnabled = signal(false);
        const calendarEnabled = signal(false);
        const scorePlaybackEnabled = signal(false);
        const service = {
            loaded,
            financeEnabled,
            inventoryEnabled,
            onboardingImportEnabled,
            externalCalendarFeedEnabled,
            calendarEnabled,
            scorePlaybackEnabled,
            refresh: jasmine.createSpy().and.returnValue(of({}))
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: TenantFeatureService, useValue: service },
                { provide: TenantStatusService, useValue: { bootstrap: signal(false) } }
            ]
        });
        const component = TestBed.runInInjectionContext(() => new MenuComponent(service as never));
        TestBed.tick();

        expect(menuItem(component, 'Economia')?.visible).toBeFalse();
        expect(menuItem(component, 'Inventario')?.visible).toBeFalse();
        expect(menuItem(component, 'Configurazione iniziale')?.visible).toBeFalse();
        expect(menuItem(component, 'Calendario')?.visible).toBeFalse();

        loaded.set(true);
        financeEnabled.set(true);
        onboardingImportEnabled.set(true);
        TestBed.tick();

        expect(menuItem(component, 'Economia')?.visible).toBeTrue();
        expect(menuItem(component, 'Inventario')?.visible).toBeFalse();
        expect(menuItem(component, 'Configurazione iniziale')?.visible).toBeTrue();

        inventoryEnabled.set(true);
        TestBed.tick();

        expect(menuItem(component, 'Economia')?.visible).toBeTrue();
        expect(menuItem(component, 'Inventario')?.visible).toBeTrue();

        financeEnabled.set(false);
        TestBed.tick();

        expect(menuItem(component, 'Economia')?.visible).toBeFalse();
        expect(menuItem(component, 'Inventario')?.visible).toBeTrue();
        expect(menuItem(component, 'Calendario')?.visible).toBeFalse();

        calendarEnabled.set(true);
        TestBed.tick();

        expect(menuItem(component, 'Calendario')?.visible).toBeTrue();
        expect(menuItem(component, 'Riconoscimento')?.visible).toBeFalse();

        scorePlaybackEnabled.set(true);
        TestBed.tick();

        expect(menuItem(component, 'Riconoscimento')?.visible).toBeTrue();
    });
});

describe('MenuComponent for the board', () => {
    it('shows the association management and keeps the administration tools to the administrators', () => {
        const service = {
            loaded: signal(true),
            financeEnabled: signal(true),
            inventoryEnabled: signal(true),
            onboardingImportEnabled: signal(true),
            externalCalendarFeedEnabled: signal(true),
            calendarEnabled: signal(true),
            scorePlaybackEnabled: signal(true),
            refresh: jasmine.createSpy().and.returnValue(of({}))
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: TenantFeatureService, useValue: service },
                { provide: TenantStatusService, useValue: { bootstrap: signal(false) } }
            ]
        });
        const component = TestBed.runInInjectionContext(() => new MenuComponent(service as never));
        TestBed.tick();

        for (const label of ['Utenti', 'Economia', 'Inventario', 'Album', 'Tracce', 'Strumenti', 'Calendario']) {
            expect(menuItem(component, label)?.['hasRoles']).withContext(label).toContain(RoleEnums.BOARD);
        }
        for (const label of ['Configurazione iniziale', 'Consegne notifiche', 'Feed calendario']) {
            expect(menuItem(component, label)?.['hasRoles']).withContext(label).toEqual([RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN]);
        }
    });

    it('keeps the recognition quality to the super administrator, right after the tenants', () => {
        const service = {
            loaded: signal(true),
            financeEnabled: signal(true),
            inventoryEnabled: signal(true),
            onboardingImportEnabled: signal(true),
            externalCalendarFeedEnabled: signal(true),
            calendarEnabled: signal(true),
            scorePlaybackEnabled: signal(true),
            refresh: jasmine.createSpy().and.returnValue(of({}))
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: TenantFeatureService, useValue: service },
                { provide: TenantStatusService, useValue: { bootstrap: signal(false) } }
            ]
        });
        const component = TestBed.runInInjectionContext(() => new MenuComponent(service as never));
        TestBed.tick();

        const items = component.model.flatMap((section) => section.items ?? []);
        const tenants = items.findIndex((item) => item.label === 'Tenant');
        expect(items[tenants + 1]?.label).toBe('Riconoscimento');
        expect(menuItem(component, 'Riconoscimento')?.['hasRoles']).toEqual([RoleEnums.SUPER_ADMIN]);
    });
});

describe('MenuComponent in bootstrap mode', () => {
    it('offers only tenant management while the tenant has no schema', () => {
        const bootstrap = signal(true);
        const service = {
            loaded: signal(false),
            financeEnabled: signal(false),
            inventoryEnabled: signal(false),
            onboardingImportEnabled: signal(false),
            externalCalendarFeedEnabled: signal(false),
            calendarEnabled: signal(false),
            scorePlaybackEnabled: signal(false),
            refresh: jasmine.createSpy().and.returnValue(of({}))
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: TenantFeatureService, useValue: service },
                { provide: TenantStatusService, useValue: { bootstrap } }
            ]
        });
        const component = TestBed.runInInjectionContext(() => new MenuComponent(service as never));
        TestBed.tick();

        expect(component.model.flatMap((section) => section.items ?? []).map((item) => item.label)).toEqual(['Tenant']);

        bootstrap.set(false);
        TestBed.tick();

        expect(menuItem(component, 'Dashboard')).toBeDefined();
        expect(menuItem(component, 'Tenant')).toBeDefined();
    });
});

function menuItem(component: MenuComponent, label: string) {
    return component.model.flatMap((section) => section.items ?? []).find((item) => item.label === label);
}
