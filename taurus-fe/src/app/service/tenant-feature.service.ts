import { HttpClient } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { finalize, interval, Observable, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { publicPage } from '../constants/public-pages';
import { TenantFeature, TenantFeatureCapabilities, TenantFeatures } from '../module';
import { TenantStatusService } from './tenant-status.service';

@Injectable({ providedIn: 'root' })
export class TenantFeatureService {
    private static readonly maxAgeMs = 60_000;
    private readonly features = signal<TenantFeatures | null>(null);
    private readonly capabilityState = signal<TenantFeatureCapabilities | null>(null);
    private lastLoadedAt = 0;
    private inFlight?: Observable<TenantFeatures>;

    readonly loaded = computed(() => this.features() !== null);
    /** Calendario degli eventi: Feed esterno, Preparazione evento e Promemoria Web Push lo richiedono. */
    readonly calendarEnabled = computed(() => this.features()?.calendarEnabled === true);
    readonly financeEnabled = computed(() => this.features()?.financeEnabled === true);
    readonly inventoryEnabled = computed(() => this.features()?.inventoryEnabled === true);
    readonly onboardingImportEnabled = computed(() => this.features()?.onboardingImportEnabled === true);
    readonly externalCalendarFeedEnabled = computed(() => this.features()?.externalCalendarFeedEnabled === true);
    readonly inventoryQrEnabled = computed(() => this.features()?.inventoryQrEnabled === true);
    readonly notificationPreferencesEnabled = computed(() => this.features()?.notificationPreferencesEnabled === true);
    readonly webPushRemindersEnabled = computed(() => this.features()?.webPushRemindersEnabled === true);
    readonly eventPreparationEnabled = computed(() => this.features()?.eventPreparationEnabled === true);
    readonly scorePlaybackEnabled = computed(() => this.features()?.scorePlaybackEnabled === true);
    /** Fogli di affidamento dell'inventario: richiede l'Inventario. */
    readonly inventoryLoanSheetEnabled = computed(() => this.features()?.inventoryLoanSheetEnabled === true);
    /** Firma elettronica dei fogli e delle prese visione: richiede i fogli di affidamento. */
    readonly inventorySignatureEnabled = computed(() => this.features()?.inventorySignatureEnabled === true);
    /** Compensi ai presenti: effettiva soltanto con Economia e Calendario, come calcola il backend. */
    readonly eventPayoutsEnabled = computed(() => this.features()?.eventPayoutsEnabled === true);
    /** Editor di scrittura delle parti: effettivo soltanto con l'Ascolto delle parti, come calcola il backend. */
    readonly scoreWritingEnabled = computed(() => this.features()?.scoreWritingEnabled === true);
    readonly current = this.features.asReadonly();
    readonly capabilities = this.capabilityState.asReadonly();

    constructor(
        private readonly http: HttpClient,
        private readonly tenantStatus: TenantStatusService
    ) {
        // A public page has no session nor tenant: there are no flags to keep up to date.
        if (publicPage()) return;
        interval(TenantFeatureService.maxAgeMs).subscribe(() => {
            if (document.visibilityState === 'visible') this.refresh().subscribe({ error: () => undefined });
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.refresh().subscribe({ error: () => undefined });
        });
    }

    refresh(force = false): Observable<TenantFeatures> {
        // Un tenant senza schema non ha flag da leggere: tutte le funzioni restano spente.
        if (this.tenantStatus.bootstrap()) return of(TenantFeatureService.bootstrapFeatures(this.tenantStatus.tenantCode()));
        const cached = this.features();
        if (!force && cached && Date.now() - this.lastLoadedAt < TenantFeatureService.maxAgeMs) return of(cached);
        if (this.inFlight) return this.inFlight;

        this.inFlight = this.http.get<TenantFeatures>(`${environment.baseUrl}/tenant-features/current`).pipe(
            tap((features) => {
                this.features.set(features);
                this.lastLoadedAt = Date.now();
            }),
            finalize(() => (this.inFlight = undefined)),
            shareReplay({ bufferSize: 1, refCount: false })
        );
        return this.inFlight;
    }

    isEnabled(feature: TenantFeature): boolean {
        switch (feature) {
            case TenantFeature.FINANCE:
                return this.financeEnabled();
            case TenantFeature.INVENTORY:
                return this.inventoryEnabled();
            case TenantFeature.ONBOARDING_IMPORT:
                return this.onboardingImportEnabled();
            case TenantFeature.EXTERNAL_CALENDAR_FEED:
                return this.externalCalendarFeedEnabled();
            case TenantFeature.INVENTORY_QR:
                return this.inventoryQrEnabled();
            case TenantFeature.NOTIFICATION_PREFERENCES:
                return this.notificationPreferencesEnabled();
            case TenantFeature.WEB_PUSH_REMINDERS:
                return this.webPushRemindersEnabled();
            case TenantFeature.EVENT_PREPARATION:
                return this.eventPreparationEnabled();
            case TenantFeature.SCORE_PLAYBACK:
                return this.scorePlaybackEnabled();
            case TenantFeature.INVENTORY_LOAN_SHEET:
                return this.inventoryLoanSheetEnabled();
            case TenantFeature.INVENTORY_SIGNATURE:
                return this.inventorySignatureEnabled();
            case TenantFeature.CALENDAR:
                return this.calendarEnabled();
            case TenantFeature.EVENT_PAYOUTS:
                return this.eventPayoutsEnabled();
            case TenantFeature.SCORE_WRITING:
                return this.scoreWritingEnabled();
        }
    }

    private static bootstrapFeatures(tenantCode: string | null): TenantFeatures {
        return {
            tenantCode: tenantCode ?? '',
            tenantName: '',
            version: 0,
            financeEnabled: false,
            inventoryEnabled: false,
            onboardingImportEnabled: false,
            externalCalendarFeedEnabled: false,
            inventoryQrEnabled: false,
            notificationPreferencesEnabled: false,
            webPushRemindersEnabled: false,
            eventPreparationEnabled: false,
            scorePlaybackEnabled: false,
            inventoryLoanSheetEnabled: false,
            inventorySignatureEnabled: false,
            calendarEnabled: false,
            eventPayoutsEnabled: false,
            scoreWritingEnabled: false
        };
    }

    loadCapabilities(): Observable<TenantFeatureCapabilities> {
        return this.http.get<TenantFeatureCapabilities>(`${environment.baseUrl}/tenant-features/capabilities`).pipe(tap((capabilities) => this.capabilityState.set(capabilities)));
    }
}
