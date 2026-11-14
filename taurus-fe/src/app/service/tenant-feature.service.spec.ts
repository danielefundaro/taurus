import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { TenantFeature } from '../module';
import { TenantFeatureService } from './tenant-feature.service';
import { TenantStatusService } from './tenant-status.service';

describe('TenantFeatureService', () => {
    let service: TenantFeatureService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
        service = TestBed.inject(TenantFeatureService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('keeps features hidden until the first response and exposes the result', async () => {
        expect(service.loaded()).toBeFalse();
        expect(service.financeEnabled()).toBeFalse();
        expect(service.inventoryEnabled()).toBeFalse();
        expect(service.eventPreparationEnabled()).toBeFalse();
        expect(service.eventPayoutsEnabled()).toBeFalse();
        expect(service.scoreWritingEnabled()).toBeFalse();

        const result = firstValueFrom(service.refresh());
        http.expectOne(`${environment.baseUrl}/tenant-features/current`).flush({
            tenantCode: 'A',
            tenantName: 'Orchestra Aurora',
            version: 4,
            financeEnabled: true,
            inventoryEnabled: false,
            onboardingImportEnabled: true,
            externalCalendarFeedEnabled: false,
            inventoryQrEnabled: false,
            notificationPreferencesEnabled: true,
            webPushRemindersEnabled: false,
            eventPreparationEnabled: true,
            eventPayoutsEnabled: true,
            scoreWritingEnabled: true
        });

        await result;
        expect(service.loaded()).toBeTrue();
        expect(service.current()?.tenantName).toBe('Orchestra Aurora');
        expect(service.financeEnabled()).toBeTrue();
        expect(service.inventoryEnabled()).toBeFalse();
        expect(service.onboardingImportEnabled()).toBeTrue();
        expect(service.notificationPreferencesEnabled()).toBeTrue();
        expect(service.eventPreparationEnabled()).toBeTrue();
        expect(service.eventPayoutsEnabled()).toBeTrue();
        expect(service.isEnabled(TenantFeature.EVENT_PAYOUTS)).toBeTrue();
        expect(service.isEnabled(TenantFeature.SCORE_WRITING)).toBeTrue();
    });

    it('shares concurrent refreshes and supports a forced refresh', async () => {
        const first = firstValueFrom(service.refresh());
        const concurrent = firstValueFrom(service.refresh());
        http.expectOne(`${environment.baseUrl}/tenant-features/current`).flush({
            tenantCode: 'A',
            version: 1,
            financeEnabled: true,
            inventoryEnabled: true
        });
        await Promise.all([first, concurrent]);

        await firstValueFrom(service.refresh());
        http.expectNone(`${environment.baseUrl}/tenant-features/current`);

        const forced = firstValueFrom(service.refresh(true));
        http.expectOne(`${environment.baseUrl}/tenant-features/current`).flush({
            tenantCode: 'A',
            version: 2,
            financeEnabled: false,
            inventoryEnabled: true
        });
        await forced;
        expect(service.financeEnabled()).toBeFalse();
    });

    it('exposes the loan sheets and the electronic signature as computed by the backend', async () => {
        const result = firstValueFrom(service.refresh());
        http.expectOne(`${environment.baseUrl}/tenant-features/current`).flush({
            tenantCode: 'A',
            version: 3,
            inventoryEnabled: true,
            inventoryLoanSheetEnabled: true,
            inventorySignatureEnabled: false
        });
        await result;

        expect(service.inventoryLoanSheetEnabled()).toBeTrue();
        expect(service.inventorySignatureEnabled()).toBeFalse();
        expect(service.isEnabled(TenantFeature.INVENTORY_LOAN_SHEET)).toBeTrue();
        expect(service.isEnabled(TenantFeature.INVENTORY_SIGNATURE)).toBeFalse();
    });

    it('exposes the calendar as computed by the backend', async () => {
        const result = firstValueFrom(service.refresh());
        http.expectOne(`${environment.baseUrl}/tenant-features/current`).flush({
            tenantCode: 'A',
            version: 4,
            calendarEnabled: true
        });
        await result;

        expect(service.calendarEnabled()).toBeTrue();
        expect(service.isEnabled(TenantFeature.CALENDAR)).toBeTrue();

        const disabled = firstValueFrom(service.refresh(true));
        http.expectOne(`${environment.baseUrl}/tenant-features/current`).flush({ tenantCode: 'A', version: 5, calendarEnabled: false });
        await disabled;
        expect(service.isEnabled(TenantFeature.CALENDAR)).toBeFalse();
    });

    it('turns every feature off without calling the backend while the tenant has no schema', async () => {
        const status = firstValueFrom(TestBed.inject(TenantStatusService).load());
        http.expectOne(`${environment.baseUrl}/tenant-status`).flush({ tenantCode: 'temp', provisioned: false });
        await status;

        const features = await firstValueFrom(service.refresh(true));

        http.expectNone(`${environment.baseUrl}/tenant-features/current`);
        expect(features.tenantCode).toBe('temp');
        expect(features.financeEnabled).toBeFalse();
        expect(features.inventoryEnabled).toBeFalse();
        expect(features.inventoryLoanSheetEnabled).toBeFalse();
        expect(features.inventorySignatureEnabled).toBeFalse();
        expect(features.calendarEnabled).toBeFalse();
        expect(service.loaded()).toBeFalse();
    });
});

describe('TenantFeatureService on a public page', () => {
    const start = location.pathname + location.search;

    afterEach(() => history.replaceState(null, '', start));

    it('reads no flags, because a public page has no session nor tenant', fakeAsync(() => {
        history.replaceState(null, '', '/legal/terms');
        TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
        TestBed.inject(TenantFeatureService);
        const http = TestBed.inject(HttpTestingController);

        tick(60_000);
        document.dispatchEvent(new Event('visibilitychange'));

        http.expectNone(`${environment.baseUrl}/tenant-features/current`);
        http.verify();
    }));
});
