import { Component, effect, inject, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { RoleEnums } from '../../constants';
import { HasRolesDirective, TourAnchorDirective } from '../../directive';
import { MenuItemComponent } from '../menu-item/menu-item.component';
import { TenantFeatureService, TenantStatusService } from '../../service';

@Component({
    selector: 'app-menu',
    imports: [MenuItemComponent, RouterModule, HasRolesDirective, TourAnchorDirective],
    templateUrl: './menu.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './menu.component.scss'
})
export class MenuComponent implements OnInit {
    model: MenuItem[] = [];

    private readonly tenantStatusService = inject(TenantStatusService);

    constructor(private readonly tenantFeatureService: TenantFeatureService) {
        effect(() => {
            this.tenantStatusService.bootstrap();
            this.tenantFeatureService.loaded();
            this.tenantFeatureService.financeEnabled();
            this.tenantFeatureService.inventoryEnabled();
            this.tenantFeatureService.onboardingImportEnabled();
            this.tenantFeatureService.externalCalendarFeedEnabled();
            this.tenantFeatureService.calendarEnabled();
            this.tenantFeatureService.scorePlaybackEnabled();
            this.buildMenu();
        });
    }

    ngOnInit() {
        this.tenantFeatureService.refresh().subscribe({ error: () => undefined });
    }

    private buildMenu(): void {
        if (this.tenantStatusService.bootstrap()) {
            this.model = this.bootstrapMenu();
            return;
        }

        this.model = [
            {
                label: 'Home',
                hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL],
                items: [
                    {
                        label: 'Dashboard',
                        icon: 'pi pi-fw pi-home',
                        routerLink: ['/']
                    }
                ]
            },
            {
                label: 'Menu',
                icon: 'pi pi-fw pi-briefcase',
                routerLink: ['/pages'],
                hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL],
                items: [
                    {
                        label: 'Documenti legali',
                        icon: 'pi pi-fw pi-file-check',
                        routerLink: ['/legal-documents'],
                        hasRoles: [RoleEnums.SUPER_ADMIN]
                    },
                    {
                        label: 'Tenant',
                        icon: 'pi pi-fw pi-building',
                        routerLink: ['/tenants'],
                        hasRoles: [RoleEnums.SUPER_ADMIN]
                    },
                    {
                        separator: true,
                        hasRoles: [RoleEnums.SUPER_ADMIN]
                    },
                    {
                        label: 'Configurazione iniziale',
                        icon: 'pi pi-fw pi-file-import',
                        routerLink: ['/onboarding'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN],
                        visible: this.tenantFeatureService.loaded() && this.tenantFeatureService.onboardingImportEnabled(),
                        tourAnchor: 'layout.menu.admin'
                    },
                    {
                        label: 'Consegne notifiche',
                        icon: 'pi pi-fw pi-send',
                        routerLink: ['/admin/notification-delivery'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN],
                        tourAnchor: 'layout.menu.admin'
                    },
                    {
                        label: 'Feed calendario',
                        icon: 'pi pi-fw pi-calendar-plus',
                        routerLink: ['/admin/calendar-feeds'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN],
                        visible: this.tenantFeatureService.loaded() && this.tenantFeatureService.externalCalendarFeedEnabled(),
                        tourAnchor: 'layout.menu.admin'
                    },
                    {
                        label: 'Utenti',
                        icon: 'pi pi-fw pi-users',
                        routerLink: ['/users'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD]
                    },
                    {
                        label: 'Economia',
                        icon: 'pi pi-fw pi-wallet',
                        routerLink: ['/finance'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER],
                        visible: this.tenantFeatureService.loaded() && this.tenantFeatureService.financeEnabled()
                    },
                    {
                        label: 'Inventario',
                        icon: 'pi pi-fw pi-box',
                        routerLink: ['/inventory'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL],
                        visible: this.tenantFeatureService.loaded() && this.tenantFeatureService.inventoryEnabled()
                    },
                    {
                        separator: true,
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL]
                    },
                    {
                        label: 'Album',
                        icon: 'pi pi-fw pi-book',
                        routerLink: ['/albums'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL]
                    },
                    {
                        label: 'Tracce',
                        icon: 'pi pi-fw pi-file',
                        routerLink: ['/tracks'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL]
                    },
                    {
                        label: 'Strumenti',
                        icon: 'pi pi-fw pi-sliders-h',
                        routerLink: ['/instruments'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST]
                    },
                    {
                        label: 'Riconoscimento',
                        icon: 'pi pi-fw pi-chart-bar',
                        routerLink: ['/recognition'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST],
                        visible: this.tenantFeatureService.loaded() && this.tenantFeatureService.scorePlaybackEnabled()
                    },
                    {
                        separator: true,
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL],
                        visible: this.calendarVisible()
                    },
                    {
                        label: 'Calendario',
                        icon: 'pi pi-fw pi-calendar',
                        routerLink: ['/calendar'],
                        hasRoles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL],
                        visible: this.calendarVisible()
                    }
                ]
            }
        ];
    }

    private calendarVisible(): boolean {
        return this.tenantFeatureService.loaded() && this.tenantFeatureService.calendarEnabled();
    }

    /** Un tenant senza schema non ha dati: al super amministratore resta solo la creazione del primo tenant. */
    private bootstrapMenu(): MenuItem[] {
        return [
            {
                label: 'Primo accesso',
                hasRoles: [RoleEnums.SUPER_ADMIN],
                items: [
                    {
                        label: 'Tenant',
                        icon: 'pi pi-fw pi-building',
                        routerLink: ['/tenants'],
                        hasRoles: [RoleEnums.SUPER_ADMIN]
                    }
                ]
            }
        ];
    }
}
