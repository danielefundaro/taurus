import { Routes } from '@angular/router';
import { RoleEnums } from './app/constants';
import { canActivateAuthRole, canDeactivateUnsavedChanges, legalDocumentsGuard, tenantBootstrapGuard, tenantFeatureGuard } from './app/guard';
import { TenantFeature } from './app/module';
import { LayoutComponent } from './app/pages/layout/layout.component';

export const appRoutes: Routes = [
    { path: 'legal/accept', loadComponent: () => import('./app/pages/legal-acceptance/legal-acceptance.component').then((module) => module.LegalAcceptanceComponent) },
    // Published legal documents, read by anyone without login: the version in force and the permanent address of each one.
    ...[
        { path: 'legal/terms', documentType: 'TERMS' },
        { path: 'legal/terms/:version', documentType: 'TERMS' },
        { path: 'legal/privacy', documentType: 'PRIVACY' },
        { path: 'legal/privacy/:version', documentType: 'PRIVACY' }
    ].map(({ path, documentType }) => ({
        path,
        loadComponent: () => import('./app/pages/legal-document/legal-document.component').then((module) => module.LegalDocumentComponent),
        data: { documentType }
    })),
    // Public signature page of a parent or guardian without an account: no layout, guards or login.
    { path: 'firma/:token', loadComponent: () => import('./app/pages/signature-link/signature-link.component').then((module) => module.SignatureLinkComponent) },
    {
        path: '',
        component: LayoutComponent,
        canActivateChild: [tenantBootstrapGuard, legalDocumentsGuard],
        children: [
            {
                path: '',
                loadComponent: () => import('./app/pages/dashboard/dashboard.component').then((module) => module.DashboardComponent),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL] }
            },
            {
                path: 'tenants',
                loadChildren: () => import('./app/pages/tenants/tenants.routes'),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN] }
            },
            {
                path: 'users',
                loadChildren: () => import('./app/pages/users/users.routes'),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD] }
            },
            {
                path: 'onboarding',
                loadChildren: () => import('./app/pages/onboarding/onboarding.routes'),
                canActivate: [canActivateAuthRole, tenantFeatureGuard],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN], feature: TenantFeature.ONBOARDING_IMPORT }
            },
            {
                path: 'legal-documents',
                loadChildren: () => import('./app/pages/legal-documents/legal-documents.routes'),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN] }
            },
            {
                path: 'albums',
                loadChildren: () => import('./app/pages/albums/albums.routes'),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL] }
            },
            {
                path: 'tracks',
                loadChildren: () => import('./app/pages/tracks/tracks.routes'),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL] }
            },
            {
                path: 'instruments',
                loadChildren: () => import('./app/pages/instruments/instruments.routes'),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST] }
            },
            {
                path: 'recognition',
                loadComponent: () => import('./app/pages/recognition/recognition.component').then((module) => module.RecognitionComponent),
                canActivate: [canActivateAuthRole, tenantFeatureGuard],
                data: { role: [RoleEnums.SUPER_ADMIN], feature: TenantFeature.SCORE_PLAYBACK }
            },
            {
                path: 'inventory',
                loadChildren: () => import('./app/pages/inventory/inventory.routes'),
                canActivate: [canActivateAuthRole, tenantFeatureGuard],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL], feature: TenantFeature.INVENTORY }
            },
            {
                path: 'finance',
                loadChildren: () => import('./app/pages/finance/finance.routes'),
                canActivate: [canActivateAuthRole, tenantFeatureGuard],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER], feature: TenantFeature.FINANCE }
            },
            {
                path: 'calendar',
                loadChildren: () => import('./app/pages/calendar-events/calendar-events.routes'),
                canActivate: [canActivateAuthRole, tenantFeatureGuard],
                // The treasurer opens only the detail of an event, from the economic notifications: the child routes decide.
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL], feature: TenantFeature.CALENDAR }
            },
            {
                path: 'admin/notification-delivery',
                loadComponent: () => import('./app/pages/admin/notification-delivery/notification-delivery.component').then((module) => module.NotificationDeliveryComponent),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN] }
            },
            {
                path: 'admin/calendar-feeds',
                loadComponent: () => import('./app/pages/admin/calendar-feeds/calendar-feeds.component').then((module) => module.CalendarFeedsComponent),
                canActivate: [canActivateAuthRole, tenantFeatureGuard],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN], feature: TenantFeature.EXTERNAL_CALENDAR_FEED }
            },
            {
                path: 'preview',
                loadComponent: () => import('./app/pages/preview/preview.component').then((module) => module.PreviewComponent),
                canActivate: [canActivateAuthRole],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL] }
            },
            {
                path: 'profile',
                loadComponent: () => import('./app/pages/profile/profile.component').then((module) => module.ProfileComponent),
                canActivate: [canActivateAuthRole],
                canDeactivate: [canDeactivateUnsavedChanges],
                data: { role: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL] }
            }
        ]
    },
    { path: 'notfound', loadComponent: () => import('./app/pages/notfound/notfound.component').then((module) => module.Notfound) },
    { path: 'forbidden', loadComponent: () => import('./app/pages/forbidden/forbidden.component').then((module) => module.Forbidden) },
    { path: 'tenant-unavailable', loadComponent: () => import('./app/pages/tenant-unavailable/tenant-unavailable.component').then((module) => module.TenantUnavailableComponent) },
    { path: '**', redirectTo: '/notfound' }
];
