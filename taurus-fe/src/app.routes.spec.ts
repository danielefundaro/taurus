import { Route } from '@angular/router';
import { tenantFeatureGuard } from './app/guard/tenant-feature.guard';
import { RoleEnums } from './app/constants';
import { TenantFeature } from './app/module';
import calendarRoutes from './app/pages/calendar-events/calendar-events.routes';
import { appRoutes } from './app.routes';

const layoutRoutes = appRoutes.find((route) => route.path === '')?.children ?? [];

function layoutRoute(path: string): Route | undefined {
    return layoutRoutes.find((route) => route.path === path);
}

function roles(route: Route | undefined): RoleEnums[] {
    return (route?.data?.['role'] as RoleEnums[] | undefined) ?? [];
}

describe('appRoutes tenant features', () => {
    const children = appRoutes.find((route) => route.path === '')?.children ?? [];

    it('protects Inventory, Finance and the calendar with their feature flags', () => {
        const inventory = children.find((route) => route.path === 'inventory');
        const finance = children.find((route) => route.path === 'finance');
        const calendar = children.find((route) => route.path === 'calendar');

        expect(inventory?.canActivate).toContain(tenantFeatureGuard);
        expect(inventory?.data?.['feature']).toBe(TenantFeature.INVENTORY);
        expect(finance?.canActivate).toContain(tenantFeatureGuard);
        expect(finance?.data?.['feature']).toBe(TenantFeature.FINANCE);
        expect(calendar?.canActivate).toContain(tenantFeatureGuard);
        expect(calendar?.data?.['feature']).toBe(TenantFeature.CALENDAR);
    });

    it('opens the quality of the recognition only to the super administrator, with the score playback', () => {
        const recognition = children.find((route) => route.path === 'recognition');

        expect(recognition?.canActivate).toContain(tenantFeatureGuard);
        expect(recognition?.data?.['feature']).toBe(TenantFeature.SCORE_PLAYBACK);
        expect(roles(recognition)).toEqual([RoleEnums.SUPER_ADMIN]);
    });

    it('does not couple unrelated routes to tenant features', () => {
        const albums = children.find((route) => route.path === 'albums');

        expect(albums?.canActivate).not.toContain(tenantFeatureGuard);
        expect(albums?.data?.['feature']).toBeUndefined();
    });
});

// The guard of the layout route runs before the one of the child routes: a role missing here never reaches the area.
// The child route files are not imported, so their pages, still without tests, stay out of the coverage measure.
describe('appRoutes roles', () => {
    it('lets the board reach the dashboard, the profile and the areas it manages', () => {
        for (const path of ['', 'users', 'albums', 'tracks', 'instruments', 'inventory', 'finance', 'calendar', 'preview', 'profile']) {
            expect(roles(layoutRoute(path))).withContext(path).toContain(RoleEnums.BOARD);
        }
    });

    it('keeps the tenant configuration and the platform pages to the administrators', () => {
        for (const path of ['onboarding', 'admin/notification-delivery', 'admin/calendar-feeds', 'tenants', 'legal-documents']) {
            expect(roles(layoutRoute(path))).withContext(path).not.toContain(RoleEnums.BOARD);
        }
    });
});

describe('appRoutes calendar', () => {
    const calendar = appRoutes.find((route) => route.path === '')?.children?.find((route) => route.path === 'calendar');

    it('lets the treasurer reach the detail of an event but not the calendar', () => {
        const list = calendarRoutes.find((route) => route.path === '');
        const detail = calendarRoutes.find((route) => route.path === ':id');

        expect(calendar?.data?.['role']).toContain(RoleEnums.TREASURER);
        expect(detail?.data?.['role']).toContain(RoleEnums.TREASURER);
        expect(list?.data?.['role']).not.toContain(RoleEnums.TREASURER);
    });
});

describe('appRoutes legal documents', () => {
    it('opens the published versions outside the layout, without guards', () => {
        const expected: [string, string][] = [
            ['legal/terms', 'TERMS'],
            ['legal/terms/:version', 'TERMS'],
            ['legal/privacy', 'PRIVACY'],
            ['legal/privacy/:version', 'PRIVACY']
        ];
        for (const [path, documentType] of expected) {
            const route = appRoutes.find((candidate) => candidate.path === path);
            expect(route?.loadComponent).withContext(path).toBeDefined();
            expect(route?.canActivate).withContext(path).toBeUndefined();
            expect(route?.data?.['documentType']).withContext(path).toBe(documentType);
            expect(layoutRoute(path)).withContext(path).toBeUndefined();
        }
    });
});
