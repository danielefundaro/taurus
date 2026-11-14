package com.fundaro.zodiac.taurus.service.dto;

public record TenantFeaturesDTO(
    String tenantCode,
    String tenantName,
    Long version,
    boolean financeEnabled,
    boolean inventoryEnabled,
    boolean onboardingImportEnabled,
    boolean externalCalendarFeedEnabled,
    boolean inventoryQrEnabled,
    boolean notificationPreferencesEnabled,
    boolean webPushRemindersEnabled,
    boolean eventPreparationEnabled,
    boolean scorePlaybackEnabled,
    boolean inventoryLoanSheetEnabled,
    boolean inventorySignatureEnabled,
    boolean calendarEnabled,
    boolean eventPayoutsEnabled,
    boolean scoreWritingEnabled
) {
}
