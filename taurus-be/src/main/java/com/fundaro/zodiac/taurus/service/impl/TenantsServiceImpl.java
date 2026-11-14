package com.fundaro.zodiac.taurus.service.impl;

import com.fundaro.zodiac.taurus.domain.Tenants;
import com.fundaro.zodiac.taurus.domain.criteria.TenantsCriteria;
import com.fundaro.zodiac.taurus.domain.enumeration.RoleEnum;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningException;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.repository.TenantsRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.TenantsService;
import com.fundaro.zodiac.taurus.service.calendarfeed.CalendarFeedTenantRevocationService;
import com.fundaro.zodiac.taurus.service.dto.TenantsDTO;
import com.fundaro.zodiac.taurus.service.mapper.TenantsMapper;
import com.fundaro.zodiac.taurus.utils.keycloak.domain.Group;
import com.fundaro.zodiac.taurus.utils.keycloak.domain.Role;
import com.fundaro.zodiac.taurus.utils.keycloak.domain.User;
import com.fundaro.zodiac.taurus.utils.keycloak.service.KeycloakService;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.ArrayList;
import java.util.Objects;
import java.time.DateTimeException;
import java.time.ZoneId;

import jakarta.persistence.criteria.Predicate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class TenantsServiceImpl extends CommonOpenSearchServiceImpl<Tenants, TenantsDTO, TenantsCriteria, TenantsMapper, TenantsRepository>
    implements TenantsService {

    private final KeycloakService keycloakService;
    private final DataErasureService dataErasureService;
    private final TenantSchemaProvisioningService provisioningService;
    private CalendarFeedTenantRevocationService calendarFeedRevocationService;

    public TenantsServiceImpl(
        TenantsRepository repository,
        TenantsMapper mapper,
        KeycloakService keycloakService,
        DataErasureService dataErasureService,
        TenantSchemaProvisioningService provisioningService
    ) {
        super(repository, mapper, TenantsService.class, Tenants.class);
        this.keycloakService = keycloakService;
        this.dataErasureService = dataErasureService;
        this.provisioningService = provisioningService;
    }

    @Autowired
    void setCalendarFeedRevocationService(CalendarFeedTenantRevocationService value) {
        calendarFeedRevocationService = value;
    }

    @Override
    public TenantsDTO save(TenantsDTO dto, AbstractAuthenticationToken token) {
        normalizeTimeZone(dto);
        normalizeFeatureFlagsForCreate(dto);
        if (getRepository().findByCodeAndDeletedFalse(dto.getCode()).isPresent()) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Tenant code already exists", getEntityName(), "tenant.code.exists");
        }
        TenantsDTO saved = super.save(dto, token);
        try {
            provisioningService.provision(saved.getCode());
            provisioningService.linkTenant(saved.getId(), saved.getCode());
            provisionKeycloakGroup(saved);
            return saved;
        } catch (RuntimeException exception) {
            getRepository().deleteById(saved.getId());
            if (exception instanceof TenantSchemaProvisioningException) {
                throw new RequestAlertException(HttpStatus.INTERNAL_SERVER_ERROR, "Tenant schema provisioning failed", getEntityName(), "tenant.schema.provisioningFailed");
            }
            throw exception;
        }
    }

    @Override
    public TenantsDTO update(Long id, TenantsDTO dto, AbstractAuthenticationToken token) {
        normalizeTimeZone(dto);
        Tenants previous = getRepository().findByIdAndDeletedFalse(id)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Tenant not found", getEntityName(), "id.notFound"));
        preserveOmittedFeatureFlags(dto, previous);
        if (dto.getEntityVersion() != null && !Objects.equals(dto.getEntityVersion(), previous.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Tenant was modified by another request", getEntityName(), "version.conflict");
        }
        Map<String, Boolean> previousFeatures = featureFlags(previous);
        boolean wasActive = Boolean.TRUE.equals(previous.getActive());
        String tenantCode = previous.getCode();
        TenantsDTO saved = super.update(id, dto, token);
        // A deactivated tenant is no longer served: its calendar links are closed here, so they do
        // not resume by themselves if the tenant comes back.
        if (wasActive && !Boolean.TRUE.equals(saved.getActive()) && calendarFeedRevocationService != null) {
            calendarFeedRevocationService.revokeAll(id, tenantCode, SecurityUtils.getUserIdFromAuthentication(token), "tenant_deactivated");
        }
        Map<String, Boolean> savedFeatures = featureFlags(saved);
        if (!previousFeatures.equals(savedFeatures)) {
            getLogger().info(
                "tenant_features_updated tenantId={} tenantCode={} before={} after={} dependentChanges={} actor={} version={} occurredAt={}",
                saved.getId(), saved.getCode(), previousFeatures, savedFeatures,
                dependentChanges(previousFeatures, savedFeatures),
                SecurityUtils.getUserIdFromAuthentication(token), saved.getEntityVersion(), java.time.Instant.now()
            );
        }
        return saved;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<TenantsDTO> findByCode(String code, AbstractAuthenticationToken token) {
        return getRepository().findByCodeAndDeletedFalse(code).map(getMapper()::toDto);
    }

    @Override
    public TenantsDTO delete(Long id, AbstractAuthenticationToken token) {
        Tenants tenant = getRepository().findByIdAndDeletedFalse(id)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Tenant not found", getEntityName(), "id.notFound"));
        String groupId = keycloakService.getGroupIdByName(tenant.getCode());
        if (calendarFeedRevocationService != null) {
            calendarFeedRevocationService.revokeAll(id, tenant.getCode(), SecurityUtils.getUserIdFromAuthentication(token), "tenant_deleted");
        }
        TenantsDTO deleted = super.delete(id, token);
        provisioningService.deactivate(tenant.getCode(), SecurityUtils.getUserIdFromAuthentication(token));
        keycloakService.deleteGroup(groupId);
        return deleted;
    }

    @Override
    protected Specification<Tenants> buildSpecification(TenantsCriteria criteria) {
        return super.buildSpecification(criteria).and((root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (criteria == null) return cb.conjunction();
            addStringFilter(predicates, cb, root.get("code"), criteria.getCode());
            addStringFilter(predicates, cb, root.get("email"), criteria.getEmail());
            addStringFilter(predicates, cb, root.get("domain"), criteria.getDomain());
            addRangeFilter(predicates, cb, root.get("maxUsers"), criteria.getMaxUsers());
            addRangeFilter(predicates, cb, root.get("expireDate"), criteria.getExpireDate());
            addFilter(predicates, cb, root.get("active"), criteria.getActive());
            return cb.and(predicates.toArray(Predicate[]::new));
        });
    }

    @Override
    public void deleteForGdpr(Long id, AbstractAuthenticationToken token) {
        Tenants tenant = getRepository().findById(id)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Tenant not found", getEntityName(), "id.notFound"));
        String groupId = keycloakService.getGroupIdByName(tenant.getCode());
        dataErasureService.eraseTenantData(tenant.getCode());
        keycloakService.deleteGroup(groupId);
        getRepository().delete(tenant);
    }

    private void provisionKeycloakGroup(TenantsDTO tenant) {
        keycloakService.saveGroup(new Group(tenant.getCode(), tenant.getName()));
        String groupId = keycloakService.getGroupIdByName(tenant.getCode());
        for (User user : keycloakService.getUsersByClientRoles(RoleEnum.ROLE_SUPER_ADMIN)) {
            keycloakService.updateUserGroup(user.getId(), groupId);
            List<Role> roles = keycloakService.getUserRoles(user.getId());
            Map<String, List<String>> attributes = user.getAttributes();
            if (attributes != null) {
                attributes.put(tenant.getCode() + "_roles", roles.stream().map(Role::getName).toList());
                user.setAttributes(attributes);
                keycloakService.updateUser(user);
            }
        }
    }

    private void normalizeTimeZone(TenantsDTO dto) {
        String timeZone = dto.getTimeZone();
        if (timeZone == null || timeZone.isBlank()) {
            timeZone = "Europe/Rome";
        }
        try {
            dto.setTimeZone(ZoneId.of(timeZone.trim()).getId());
        } catch (DateTimeException exception) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Invalid tenant time zone", getEntityName(), "tenant.timeZone.invalid");
        }
    }

    private void normalizeFeatureFlagsForCreate(TenantsDTO dto) {
        if (dto.getFinanceEnabled() == null) dto.setFinanceEnabled(false);
        if (dto.getInventoryEnabled() == null) dto.setInventoryEnabled(false);
        if (dto.getOnboardingImportEnabled() == null) dto.setOnboardingImportEnabled(false);
        if (dto.getExternalCalendarFeedEnabled() == null) dto.setExternalCalendarFeedEnabled(false);
        if (dto.getInventoryQrEnabled() == null) dto.setInventoryQrEnabled(false);
        if (dto.getNotificationPreferencesEnabled() == null) dto.setNotificationPreferencesEnabled(false);
        if (dto.getWebPushRemindersEnabled() == null) dto.setWebPushRemindersEnabled(false);
        if (dto.getEventPreparationEnabled() == null) dto.setEventPreparationEnabled(false);
        if (dto.getScorePlaybackEnabled() == null) dto.setScorePlaybackEnabled(false);
        if (dto.getInventoryLoanSheetEnabled() == null) dto.setInventoryLoanSheetEnabled(false);
        if (dto.getInventorySignatureEnabled() == null) dto.setInventorySignatureEnabled(false);
        if (dto.getCalendarEnabled() == null) dto.setCalendarEnabled(false);
        if (dto.getEventPayoutsEnabled() == null) dto.setEventPayoutsEnabled(false);
        if (dto.getScoreWritingEnabled() == null) dto.setScoreWritingEnabled(false);
    }

    private void preserveOmittedFeatureFlags(TenantsDTO dto, Tenants previous) {
        if (dto.getFinanceEnabled() == null) dto.setFinanceEnabled(previous.getFinanceEnabled());
        if (dto.getInventoryEnabled() == null) dto.setInventoryEnabled(previous.getInventoryEnabled());
        if (dto.getOnboardingImportEnabled() == null)
            dto.setOnboardingImportEnabled(previous.getOnboardingImportEnabled());
        if (dto.getExternalCalendarFeedEnabled() == null)
            dto.setExternalCalendarFeedEnabled(previous.getExternalCalendarFeedEnabled());
        if (dto.getInventoryQrEnabled() == null) dto.setInventoryQrEnabled(previous.getInventoryQrEnabled());
        if (dto.getNotificationPreferencesEnabled() == null)
            dto.setNotificationPreferencesEnabled(previous.getNotificationPreferencesEnabled());
        if (dto.getWebPushRemindersEnabled() == null)
            dto.setWebPushRemindersEnabled(previous.getWebPushRemindersEnabled());
        if (dto.getEventPreparationEnabled() == null)
            dto.setEventPreparationEnabled(previous.getEventPreparationEnabled());
        if (dto.getScorePlaybackEnabled() == null) dto.setScorePlaybackEnabled(previous.getScorePlaybackEnabled());
        if (dto.getInventoryLoanSheetEnabled() == null)
            dto.setInventoryLoanSheetEnabled(previous.getInventoryLoanSheetEnabled());
        if (dto.getInventorySignatureEnabled() == null)
            dto.setInventorySignatureEnabled(previous.getInventorySignatureEnabled());
        if (dto.getCalendarEnabled() == null) dto.setCalendarEnabled(previous.getCalendarEnabled());
        if (dto.getEventPayoutsEnabled() == null) dto.setEventPayoutsEnabled(previous.getEventPayoutsEnabled());
        if (dto.getScoreWritingEnabled() == null) dto.setScoreWritingEnabled(previous.getScoreWritingEnabled());
    }

    /**
     * Funzionalità figlie il cui flag non cambia ma il cui stato effettivo cambia perché cambia
     * una funzionalità da cui dipendono: senza questa riga il log mostrerebbe una modifica sola.
     * Visibile al package per il test che ne verifica la catena.
     */
    Map<String, Boolean> dependentChanges(Map<String, Boolean> before, Map<String, Boolean> after) {
        Map<String, Boolean> changed = new LinkedHashMap<>();
        for (TenantFeature feature : TenantFeature.values()) {
            String key = feature.errorKey();
            if (!Objects.equals(before.get(key), after.get(key))) continue;
            boolean effectiveAfter = effective(feature, after);
            if (effective(feature, before) != effectiveAfter) changed.put(key, effectiveAfter);
        }

        return changed;
    }

    /** Una funzionalità è effettiva quando è attiva insieme a tutte quelle da cui dipende. */
    private boolean effective(TenantFeature feature, Map<String, Boolean> flags) {
        if (!Boolean.TRUE.equals(flags.get(feature.errorKey()))) return false;

        return feature.dependencies().stream().allMatch(dependency -> effective(dependency, flags));
    }

    private Map<String, Boolean> featureFlags(Tenants tenant) {
        return Map.ofEntries(
            Map.entry("finance", Boolean.TRUE.equals(tenant.getFinanceEnabled())),
            Map.entry("inventory", Boolean.TRUE.equals(tenant.getInventoryEnabled())),
            Map.entry("onboardingImport", Boolean.TRUE.equals(tenant.getOnboardingImportEnabled())),
            Map.entry("externalCalendarFeed", Boolean.TRUE.equals(tenant.getExternalCalendarFeedEnabled())),
            Map.entry("inventoryQr", Boolean.TRUE.equals(tenant.getInventoryQrEnabled())),
            Map.entry("notificationPreferences", Boolean.TRUE.equals(tenant.getNotificationPreferencesEnabled())),
            Map.entry("webPushReminders", Boolean.TRUE.equals(tenant.getWebPushRemindersEnabled())),
            Map.entry("eventPreparation", Boolean.TRUE.equals(tenant.getEventPreparationEnabled())),
            Map.entry("scorePlayback", Boolean.TRUE.equals(tenant.getScorePlaybackEnabled())),
            Map.entry("inventoryLoanSheet", Boolean.TRUE.equals(tenant.getInventoryLoanSheetEnabled())),
            Map.entry("inventorySignature", Boolean.TRUE.equals(tenant.getInventorySignatureEnabled())),
            Map.entry("calendar", Boolean.TRUE.equals(tenant.getCalendarEnabled())),
            Map.entry("eventPayouts", Boolean.TRUE.equals(tenant.getEventPayoutsEnabled())),
            Map.entry("scoreWriting", Boolean.TRUE.equals(tenant.getScoreWritingEnabled()))
        );
    }

    private Map<String, Boolean> featureFlags(TenantsDTO tenant) {
        return Map.ofEntries(
            Map.entry("finance", Boolean.TRUE.equals(tenant.getFinanceEnabled())),
            Map.entry("inventory", Boolean.TRUE.equals(tenant.getInventoryEnabled())),
            Map.entry("onboardingImport", Boolean.TRUE.equals(tenant.getOnboardingImportEnabled())),
            Map.entry("externalCalendarFeed", Boolean.TRUE.equals(tenant.getExternalCalendarFeedEnabled())),
            Map.entry("inventoryQr", Boolean.TRUE.equals(tenant.getInventoryQrEnabled())),
            Map.entry("notificationPreferences", Boolean.TRUE.equals(tenant.getNotificationPreferencesEnabled())),
            Map.entry("webPushReminders", Boolean.TRUE.equals(tenant.getWebPushRemindersEnabled())),
            Map.entry("eventPreparation", Boolean.TRUE.equals(tenant.getEventPreparationEnabled())),
            Map.entry("scorePlayback", Boolean.TRUE.equals(tenant.getScorePlaybackEnabled())),
            Map.entry("inventoryLoanSheet", Boolean.TRUE.equals(tenant.getInventoryLoanSheetEnabled())),
            Map.entry("inventorySignature", Boolean.TRUE.equals(tenant.getInventorySignatureEnabled())),
            Map.entry("calendar", Boolean.TRUE.equals(tenant.getCalendarEnabled())),
            Map.entry("eventPayouts", Boolean.TRUE.equals(tenant.getEventPayoutsEnabled())),
            Map.entry("scoreWriting", Boolean.TRUE.equals(tenant.getScoreWritingEnabled()))
        );
    }
}
