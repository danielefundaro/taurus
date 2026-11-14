import { CommonFieldsOpenSearch } from './common-fields-open-search.module';

export class Tenants extends CommonFieldsOpenSearch {
    code?: string;
    email?: string;
    domain?: string;
    maxUsers?: number;
    expireDate?: Date;
    active?: boolean;
    address?: string;
    postalCode?: string;
    city?: string;
    province?: string;
    country?: string;
    taxCode?: string;
    vatNumber?: string;
    logoUrl?: string;
    phone?: string;
    pec?: string;
    timeZone?: string = 'Europe/Rome';
    financeEnabled: boolean = false;
    inventoryEnabled: boolean = false;
    onboardingImportEnabled: boolean = false;
    externalCalendarFeedEnabled: boolean = false;
    inventoryQrEnabled: boolean = false;
    notificationPreferencesEnabled: boolean = false;
    webPushRemindersEnabled: boolean = false;
    eventPreparationEnabled: boolean = false;
    scorePlaybackEnabled: boolean = false;
    inventoryLoanSheetEnabled: boolean = false;
    inventorySignatureEnabled: boolean = false;
    calendarEnabled: boolean = false;
    eventPayoutsEnabled: boolean = false;
    scoreWritingEnabled: boolean = false;
    entityVersion?: number;
}
