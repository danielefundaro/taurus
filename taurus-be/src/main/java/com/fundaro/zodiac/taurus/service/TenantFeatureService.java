package com.fundaro.zodiac.taurus.service;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.Tenants;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.multitenancy.TenantContext;
import com.fundaro.zodiac.taurus.repository.TenantsRepository;
import com.fundaro.zodiac.taurus.service.dto.TenantFeatureCapabilityDTO;
import com.fundaro.zodiac.taurus.service.dto.TenantFeaturesDTO;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

@Service
@Transactional(readOnly = true)
public class TenantFeatureService {

    private final TenantsRepository tenantsRepository;
    private final ApplicationProperties properties;

    public TenantFeatureService(TenantsRepository tenantsRepository, ApplicationProperties properties) {
        this.tenantsRepository = tenantsRepository;
        this.properties = properties;
    }

    public TenantFeaturesDTO current() {
        Tenants tenant = currentTenant();
        return new TenantFeaturesDTO(
            tenant.getCode(),
            tenant.getName(),
            tenant.getEntityVersion(),
            enabled(tenant, TenantFeature.FINANCE),
            enabled(tenant, TenantFeature.INVENTORY),
            enabled(tenant, TenantFeature.ONBOARDING_IMPORT),
            enabled(tenant, TenantFeature.EXTERNAL_CALENDAR_FEED),
            enabled(tenant, TenantFeature.INVENTORY_QR),
            enabled(tenant, TenantFeature.NOTIFICATION_PREFERENCES),
            enabled(tenant, TenantFeature.WEB_PUSH_REMINDERS),
            enabled(tenant, TenantFeature.EVENT_PREPARATION),
            enabled(tenant, TenantFeature.SCORE_PLAYBACK),
            enabled(tenant, TenantFeature.INVENTORY_LOAN_SHEET),
            enabled(tenant, TenantFeature.INVENTORY_SIGNATURE),
            enabled(tenant, TenantFeature.CALENDAR),
            enabled(tenant, TenantFeature.EVENT_PAYOUTS),
            enabled(tenant, TenantFeature.SCORE_WRITING)
        );
    }

    public boolean isEnabled(TenantFeature feature) {
        return enabled(currentTenant(), feature);
    }

    public boolean isEnabledForTenant(Long tenantId, TenantFeature feature) {
        return tenantsRepository.findByIdAndDeletedFalse(tenantId)
            .filter(tenant -> Boolean.TRUE.equals(tenant.getActive()))
            .map(tenant -> enabled(tenant, feature))
            .orElse(false);
    }

    public boolean isEnabledForTenant(String tenantCode, TenantFeature feature) {
        return tenantsRepository.findByCodeAndDeletedFalse(tenantCode)
            .filter(tenant -> Boolean.TRUE.equals(tenant.getActive()))
            .map(tenant -> enabled(tenant, feature))
            .orElse(false);
    }

    public Map<TenantFeature, TenantFeatureCapabilityDTO> capabilities() {
        Map<TenantFeature, TenantFeatureCapabilityDTO> result = new EnumMap<>(TenantFeature.class);
        for (TenantFeature feature : TenantFeature.values()) {
            boolean available = applicationAvailable(feature);
            result.put(feature, new TenantFeatureCapabilityDTO(
                available,
                available ? null : "tenantFeature.capability." + feature.errorKey() + ".unavailable",
                dependencies(feature)
            ));
        }
        return result;
    }

    public void requireEnabled(TenantFeature feature) {
        if (!isEnabled(feature)) {
            throw new RequestAlertException(
                HttpStatus.FORBIDDEN,
                "Tenant feature is disabled",
                "TenantFeature",
                "tenantFeature." + feature.errorKey() + ".disabled"
            );
        }
    }

    private boolean enabled(Tenants tenant, TenantFeature feature) {
        if (!applicationAvailable(feature)) return false;
        return switch (feature) {
            case FINANCE -> Boolean.TRUE.equals(tenant.getFinanceEnabled());
            case INVENTORY -> Boolean.TRUE.equals(tenant.getInventoryEnabled());
            case ONBOARDING_IMPORT -> Boolean.TRUE.equals(tenant.getOnboardingImportEnabled());
            case EXTERNAL_CALENDAR_FEED -> Boolean.TRUE.equals(tenant.getExternalCalendarFeedEnabled())
                && enabled(tenant, TenantFeature.CALENDAR);
            case INVENTORY_QR ->
                Boolean.TRUE.equals(tenant.getInventoryQrEnabled()) && enabled(tenant, TenantFeature.INVENTORY);
            case NOTIFICATION_PREFERENCES -> Boolean.TRUE.equals(tenant.getNotificationPreferencesEnabled());
            case WEB_PUSH_REMINDERS -> Boolean.TRUE.equals(tenant.getWebPushRemindersEnabled())
                && enabled(tenant, TenantFeature.NOTIFICATION_PREFERENCES)
                && enabled(tenant, TenantFeature.CALENDAR);
            case EVENT_PREPARATION -> Boolean.TRUE.equals(tenant.getEventPreparationEnabled())
                && enabled(tenant, TenantFeature.CALENDAR);
            case SCORE_PLAYBACK -> Boolean.TRUE.equals(tenant.getScorePlaybackEnabled());
            case INVENTORY_LOAN_SHEET ->
                Boolean.TRUE.equals(tenant.getInventoryLoanSheetEnabled()) && enabled(tenant, TenantFeature.INVENTORY);
            case INVENTORY_SIGNATURE ->
                Boolean.TRUE.equals(tenant.getInventorySignatureEnabled()) && enabled(tenant, TenantFeature.INVENTORY_LOAN_SHEET);
            case CALENDAR -> Boolean.TRUE.equals(tenant.getCalendarEnabled());
            case EVENT_PAYOUTS -> Boolean.TRUE.equals(tenant.getEventPayoutsEnabled())
                && enabled(tenant, TenantFeature.FINANCE)
                && enabled(tenant, TenantFeature.CALENDAR);
            case SCORE_WRITING -> Boolean.TRUE.equals(tenant.getScoreWritingEnabled())
                && enabled(tenant, TenantFeature.SCORE_PLAYBACK);
        };
    }

    private boolean applicationAvailable(TenantFeature feature) {
        return switch (feature) {
            case FINANCE, INVENTORY, INVENTORY_LOAN_SHEET, CALENDAR, EVENT_PAYOUTS -> true;
            // The tenant administrator turns the signature on only when mail, codes and seal are configured.
            case INVENTORY_SIGNATURE -> true;
            case ONBOARDING_IMPORT -> properties.getOnboarding().isEnabled();
            case EXTERNAL_CALENDAR_FEED -> properties.getCalendarFeed().isEnabled();
            case INVENTORY_QR -> properties.getInventory().getQr().isEnabled()
                && properties.getInventory().getQr().isPublicBaseUrlValid();
            case NOTIFICATION_PREFERENCES -> properties.getNotificationPreferences().isEnabled();
            case WEB_PUSH_REMINDERS -> vapidConfigured();
            case EVENT_PREPARATION -> properties.getEventPreparation().isEnabled();
            case SCORE_PLAYBACK -> properties.getScorePlayback().isEnabled();
            // Off until the engraving of the written parts (phase 2) is installed too.
            case SCORE_WRITING -> properties.getScoreWriting().isEnabled() && properties.getScorePlayback().isEnabled();
        };
    }

    private List<TenantFeature> dependencies(TenantFeature feature) {
        return feature.dependencies();
    }

    private boolean vapidConfigured() {
        var vapid = properties.getVapid();
        return configuredSecret(vapid.getPublicKey()) && configuredSecret(vapid.getPrivateKey());
    }

    private static boolean configuredSecret(String value) {
        return value != null && !value.isBlank() && !"CHANGE_ME".equals(value);
    }

    private Tenants currentTenant() {
        String tenantCode = TenantContext.getTenantCode().orElseThrow(() -> invalidTenant("Tenant context is required"));
        return tenantsRepository.findByCodeAndDeletedFalse(tenantCode)
            .filter(tenant -> Boolean.TRUE.equals(tenant.getActive()))
            .orElseThrow(() -> invalidTenant("Tenant is missing or inactive"));
    }

    private RequestAlertException invalidTenant(String message) {
        return new RequestAlertException(HttpStatus.FORBIDDEN, message, "TenantFeature", "auth.tenant.missing");
    }
}
