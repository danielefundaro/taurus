import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SelectItem } from 'primeng/api';
import { delay, finalize, first } from 'rxjs';
import { ImportsModule } from '../../../imports';
import { DetailPageBase } from '../../_shared/detail-page.base';
import { ChildrenEntities, TenantFeature, Tenants } from '../../../module';
import { DateConverterPipe } from '../../../pipe';
import { ConfirmService, KeycloakService, TenantFeatureService, TenantsService, ToastService } from '../../../service';

@Component({
    selector: 'app-tenant-detail',
    imports: [ImportsModule],
    templateUrl: './detail.component.html',
    styleUrl: './detail.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
    providers: [TenantsService]
})
export class DetailComponent extends DetailPageBase implements OnInit {
    public sortOptions!: SelectItem[];
    public totalRecords: number = 0;
    public tenant: Tenants = new Tenants();
    public cols: string[];
    public selectedTracks: ChildrenEntities[];
    protected readonly tenantFeatures: TenantFeatureItem[] = [
        { key: 'calendarEnabled', feature: TenantFeature.CALENDAR, label: 'Calendario', description: 'Eventi, serie ricorrenti, disponibilità, presenze e informazioni economiche degli eventi.' },
        { key: 'financeEnabled', feature: TenantFeature.FINANCE, label: 'Economia', description: 'Conti, movimenti, rendiconti e informazioni economiche degli eventi.' },
        { key: 'inventoryEnabled', feature: TenantFeature.INVENTORY, label: 'Inventario', description: 'Oggetti, assegnazioni, fotografie, riconsegne e report.' },
        { key: 'onboardingImportEnabled', feature: TenantFeature.ONBOARDING_IMPORT, label: 'Onboarding e importazione iniziale', description: 'Wizard, template e importazioni iniziali del tenant.' },
        { key: 'scorePlaybackEnabled', feature: TenantFeature.SCORE_PLAYBACK, label: 'Ascolto delle parti', description: 'Ascolto di parti e partiture, caricamento MusicXML e versioni delle parti.' },
        { key: 'notificationPreferencesEnabled', feature: TenantFeature.NOTIFICATION_PREFERENCES, label: 'Preferenze notifiche', description: 'Categorie, canali, digest, pausa e ore silenziose.' },
        {
            key: 'externalCalendarFeedEnabled',
            feature: TenantFeature.EXTERNAL_CALENDAR_FEED,
            label: 'Feed calendario esterno',
            description: 'Feed personali e condivisi in formato iCalendar.',
            dependencies: ['calendarEnabled']
        },
        {
            key: 'eventPreparationEnabled',
            feature: TenantFeature.EVENT_PREPARATION,
            label: 'Preparazione evento',
            description: 'Workspace operativo, indicatori, materiali e follow-up.',
            dependencies: ['calendarEnabled']
        },
        { key: 'inventoryQrEnabled', feature: TenantFeature.INVENTORY_QR, label: 'QR code inventario', description: 'Etichette, scansione, azioni rapide e segnalazioni.', dependencies: ['inventoryEnabled'] },
        {
            key: 'inventoryLoanSheetEnabled',
            feature: TenantFeature.INVENTORY_LOAN_SHEET,
            label: 'Fogli di affidamento',
            description: 'Emissione, registro delle variazioni, chiusura e modello dei fogli di consegna e affidamento in comodato.',
            dependencies: ['inventoryEnabled']
        },
        {
            key: 'inventorySignatureEnabled',
            feature: TenantFeature.INVENTORY_SIGNATURE,
            label: 'Firma elettronica',
            description: 'Firma con un codice o con CieSign dei fogli di affidamento e delle prese visione, con sigillo, attestazioni e fascicolo.',
            dependencies: ['inventoryLoanSheetEnabled']
        },
        {
            key: 'eventPayoutsEnabled',
            feature: TenantFeature.EVENT_PAYOUTS,
            label: 'Compensi ai presenti',
            description: 'Ripartizione del compenso degli eventi fra i presenti, pagamenti fissi e liquidazioni.',
            dependencies: ['financeEnabled', 'calendarEnabled']
        },
        {
            key: 'scoreWritingEnabled',
            feature: TenantFeature.SCORE_WRITING,
            label: 'Scrittura delle parti',
            description: 'Scrittura di nuove parti con mouse, tastiera e tastiera MIDI, bozze e versioni scritte.',
            dependencies: ['scorePlaybackEnabled']
        },
        {
            key: 'webPushRemindersEnabled',
            feature: TenantFeature.WEB_PUSH_REMINDERS,
            label: 'Promemoria eventi Web Push',
            description: 'Pianificazione e invio dei promemoria prima degli eventi.',
            dependencies: ['notificationPreferencesEnabled', 'calendarEnabled']
        }
    ];
    private originalFeatureValues: Partial<Record<TenantFeatureField, boolean>> = {};

    /** I moduli autonomi e le funzionalità che ne estendono uno, nei due gruppi mostrati dalla pagina. */
    protected get featureGroups(): TenantFeatureGroup[] {
        return [
            { heading: 'Moduli principali', items: this.tenantFeatures.filter((item) => !item.dependencies) },
            {
                heading: 'Estensioni',
                description: 'Richiedono un modulo principale: restano inefficaci finché il modulo da cui dipendono è spento.',
                items: this.tenantFeatures.filter((item) => !!item.dependencies)
            }
        ];
    }

    constructor(
        private readonly tenantsService: TenantsService,
        private readonly toastService: ToastService,
        private readonly dateConverterPipe: DateConverterPipe,
        private readonly routeService: ActivatedRoute,
        private readonly router: Router,
        private readonly confirmService: ConfirmService,
        private readonly keycloakService: KeycloakService,
        private readonly tenantFeatureService: TenantFeatureService
    ) {
        super();
        this.cols = ['Codice', 'Ordine', 'Nome'];
        this.selectedTracks = [];
    }

    ngOnInit() {
        this.tenantFeatureService.loadCapabilities().subscribe({ error: () => undefined });
        this.routeService.params.pipe(first()).subscribe((params) => {
            this.loadElement(params['id']);
        });
    }

    public confirmDelete(): void {
        this.confirmService.confirmReversible({
            title: 'Archivia tenant',
            consequence: 'Il tenant verrà archiviato, non eliminato, e potrà essere recuperato.',
            actionLabel: 'Archivia',
            accept: () => {
                this.tenantsService
                    .delete(this.tenant.id)
                    .pipe(first())
                    .subscribe({
                        next: () => {
                            this.isDirty = false;
                            this.toastService.success('Tenant eliminato', 'L’istanza non è più visibile.');
                            this.router.navigate(['/tenants']);
                        }
                    });
            }
        });
    }

    public confirmGdprDeletion(): void {
        this.confirmService.confirmDestructive({
            title: 'Cancellazione definitiva GDPR',
            consequence: 'Tutti i dati, gli indici, i file e le autorizzazioni del tenant verranno eliminati fisicamente e non potranno essere recuperati.',
            actionLabel: 'Elimina definitivamente',
            accept: () => {
                this.tenantsService
                    .deleteForGdpr(this.tenant.id)
                    .pipe(first())
                    .subscribe({
                        next: () => {
                            this.isDirty = false;
                            this.toastService.success('Dati del tenant eliminati', 'La cancellazione prevista dal GDPR è stata completata.');
                            this.router.navigate(['/tenants']);
                        }
                    });
            }
        });
    }

    public save(): void {
        // Funzionalità che erano effettive e non lo saranno più: spente direttamente o per una dipendenza, anche indiretta.
        const disabled = this.tenantFeatures
            .filter((item) => this.effective(item.key, this.originalFeatureValues) && !this.effective(item.key, this.tenant))
            .map((item) => (this.tenant[item.key] === true ? `${item.label} (per dipendenza)` : item.label));
        if (disabled.length) {
            this.confirmService.confirmReversible({
                title: 'Disattiva funzionalità',
                consequence: `${disabled.join(' e ')} non sarà più accessibile agli utenti di questo tenant. Menu, pagine, operazioni e notifiche collegate verranno nascosti o bloccati; tutti i dati saranno conservati.`,
                actionLabel: 'Disattiva e salva',
                accept: () => this.persist()
            });
            return;
        }
        this.persist();
    }

    private persist(): void {
        this.saving = true;
        this.tenantsService
            .update(this.tenant.id, this.tenant)
            .pipe(
                delay(1000),
                first(),
                finalize(() => (this.saving = false))
            )
            .subscribe({
                next: (tenant: Tenants) => {
                    this.isDirty = false;
                    this.toastService.success('Tenant aggiornato', 'Le modifiche sono state salvate.');
                    if (tenant.code === this.keycloakService.currentUserTenantCode) {
                        this.tenantFeatureService.refresh(true).subscribe({ error: () => undefined });
                    }
                    this.loadElement(tenant.id);
                }
            });
    }

    public onCountryChange(country: string | undefined): void {
        this.tenant.country = country ? country.toUpperCase() : undefined;
        this.isDirty = true;
    }

    public get countryInvalid(): boolean {
        return !!this.tenant.country && !/^[A-Z]{2}$/.test(this.tenant.country);
    }

    public get logoUrlInvalid(): boolean {
        if (!this.tenant.logoUrl) {
            return false;
        }

        try {
            const logoUrl = new URL(this.tenant.logoUrl);
            return logoUrl.protocol !== 'http:' && logoUrl.protocol !== 'https:';
        } catch {
            return true;
        }
    }

    public get timeZoneInvalid(): boolean {
        if (!this.tenant.timeZone) return true;
        try {
            new Intl.DateTimeFormat('it-IT', { timeZone: this.tenant.timeZone }).format();
            return false;
        } catch {
            return true;
        }
    }

    public get canConfigureData(): boolean {
        return !!this.tenant.id && this.tenant.active !== false && this.tenant.code === this.keycloakService.currentUserTenantCode && this.tenantFeatureService.onboardingImportEnabled();
    }

    /**
     * Il wizard di configurazione iniziale lavora solo sull'istanza della sessione: su un altro tenant la pagina
     * invita a cambiare istanza invece di offrire un pulsante che importerebbe i dati nel posto sbagliato.
     */
    public get activeTenantCode(): string {
        return this.keycloakService.currentUserTenantCode ?? '';
    }

    public get configureDataElsewhere(): boolean {
        return !!this.tenant.id && this.tenant.active !== false && this.tenant.code !== this.keycloakService.currentUserTenantCode && this.tenant.onboardingImportEnabled === true;
    }

    protected featureStatus(item: { feature: TenantFeature; dependencies?: TenantFeatureField[] }): string | undefined {
        const capability = this.tenantFeatureService.capabilities()?.[item.feature];
        if (capability && !capability.available) return 'Non disponibile nell’installazione';
        if (item.dependencies?.some((dependency) => !this.effective(dependency, this.tenant))) return 'Richiede un’altra funzionalità';
        return 'Disponibile';
    }

    /**
     * Con la funzionalità spenta nell'installazione il flag resta modificabile e viene salvato:
     * serve a preparare un rollout, quindi la pagina spiega che cosa significa il valore scelto.
     */
    protected featureHint(item: { key: TenantFeatureField; feature: TenantFeature; dependencies?: TenantFeatureField[] }): string | undefined {
        const capability = this.tenantFeatureService.capabilities()?.[item.feature];
        if (!capability || capability.available) return undefined;

        return this.tenant[item.key] === true
            ? 'Abilitazione pianificata: diventerà effettiva quando l’installazione renderà disponibile la funzionalità.'
            : 'Il valore viene salvato comunque e diventerà effettivo quando l’installazione renderà disponibile la funzionalità.';
    }

    /** Una funzionalità è effettiva quando è attiva insieme a tutte quelle da cui dipende. */
    private effective(key: TenantFeatureField, values: Partial<Record<TenantFeatureField, boolean>>): boolean {
        const dependencies = this.tenantFeatures.find((item) => item.key === key)?.dependencies ?? [];
        return values[key] === true && dependencies.every((dependency) => this.effective(dependency, values));
    }

    private loadElement(id: number | string) {
        this.loading = true;
        this.tenantsService
            .getById(Number(id))
            .pipe(
                first(),
                finalize(() => (this.loading = false))
            )
            .subscribe({
                next: (tenant: Tenants) => {
                    this.tenant = tenant;
                    for (const item of this.tenantFeatures) {
                        this.tenant[item.key] ??= false;
                        this.originalFeatureValues[item.key] = this.tenant[item.key];
                    }
                    this.tenant.country = this.tenant.country?.toUpperCase();
                    this.tenant.expireDate = this.dateConverterPipe.transform(this.tenant.expireDate);
                    this.isDirty = false;
                }
            });
    }
}

interface TenantFeatureGroup {
    heading: string;
    description?: string;
    items: TenantFeatureItem[];
}

interface TenantFeatureItem {
    key: TenantFeatureField;
    feature: TenantFeature;
    label: string;
    description: string;
    /** Le funzionalità da cui dipende, come `TenantFeature.dependencies()` del backend. */
    dependencies?: TenantFeatureField[];
}

type TenantFeatureField =
    | 'financeEnabled'
    | 'inventoryEnabled'
    | 'onboardingImportEnabled'
    | 'externalCalendarFeedEnabled'
    | 'inventoryQrEnabled'
    | 'notificationPreferencesEnabled'
    | 'webPushRemindersEnabled'
    | 'eventPreparationEnabled'
    | 'scorePlaybackEnabled'
    | 'inventoryLoanSheetEnabled'
    | 'inventorySignatureEnabled'
    | 'calendarEnabled'
    | 'eventPayoutsEnabled'
    | 'scoreWritingEnabled';
