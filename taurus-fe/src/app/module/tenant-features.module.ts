export enum TenantFeature {
    FINANCE = 'FINANCE',
    INVENTORY = 'INVENTORY',
    ONBOARDING_IMPORT = 'ONBOARDING_IMPORT',
    EXTERNAL_CALENDAR_FEED = 'EXTERNAL_CALENDAR_FEED',
    INVENTORY_QR = 'INVENTORY_QR',
    NOTIFICATION_PREFERENCES = 'NOTIFICATION_PREFERENCES',
    WEB_PUSH_REMINDERS = 'WEB_PUSH_REMINDERS',
    EVENT_PREPARATION = 'EVENT_PREPARATION',
    SCORE_PLAYBACK = 'SCORE_PLAYBACK',
    INVENTORY_LOAN_SHEET = 'INVENTORY_LOAN_SHEET',
    INVENTORY_SIGNATURE = 'INVENTORY_SIGNATURE',
    CALENDAR = 'CALENDAR',
    EVENT_PAYOUTS = 'EVENT_PAYOUTS',
    SCORE_WRITING = 'SCORE_WRITING'
}

export interface TenantFeatures {
    tenantCode: string;
    tenantName: string;
    version: number;
    financeEnabled: boolean;
    inventoryEnabled: boolean;
    onboardingImportEnabled: boolean;
    externalCalendarFeedEnabled: boolean;
    inventoryQrEnabled: boolean;
    notificationPreferencesEnabled: boolean;
    webPushRemindersEnabled: boolean;
    eventPreparationEnabled: boolean;
    scorePlaybackEnabled: boolean;
    inventoryLoanSheetEnabled: boolean;
    inventorySignatureEnabled: boolean;
    calendarEnabled: boolean;
    eventPayoutsEnabled: boolean;
    scoreWritingEnabled: boolean;
}

export interface TenantFeatureCapability {
    available: boolean;
    reasonCode?: string;
    dependencies: TenantFeature[];
}

export type TenantFeatureCapabilities = Record<TenantFeature, TenantFeatureCapability>;

/** Stato del tenant della sessione: `provisioned` è falso finché il tenant non ha uno schema attivo. */
export interface TenantStatus {
    tenantCode: string | null;
    provisioned: boolean;
}
