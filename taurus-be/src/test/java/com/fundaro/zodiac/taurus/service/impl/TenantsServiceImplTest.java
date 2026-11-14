package com.fundaro.zodiac.taurus.service.impl;

import com.fundaro.zodiac.taurus.domain.Tenants;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.repository.TenantsRepository;
import com.fundaro.zodiac.taurus.service.dto.TenantsDTO;
import com.fundaro.zodiac.taurus.service.mapper.TenantsMapper;
import com.fundaro.zodiac.taurus.utils.keycloak.service.KeycloakService;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.entry;
import static org.mockito.Mockito.*;

class TenantsServiceImplTest {

    @Test
    void softDeleteDeactivatesTheSchemaAndRemovesTheIdentityProviderGroup() {
        TenantsRepository repository = mock(TenantsRepository.class);
        TenantsMapper mapper = mock(TenantsMapper.class);
        KeycloakService keycloakService = mock(KeycloakService.class);
        DataErasureService dataErasureService = mock(DataErasureService.class);
        TenantSchemaProvisioningService provisioningService = mock(TenantSchemaProvisioningService.class);
        Tenants tenant = new Tenants();
        tenant.setId(7L);
        tenant.setCode("TENANT-A");
        tenant.setDeleted(false);
        TenantsDTO result = new TenantsDTO();

        when(repository.findByIdAndDeletedFalse(7L)).thenReturn(Optional.of(tenant));
        when(repository.save(tenant)).thenReturn(tenant);
        when(mapper.toDto(tenant)).thenReturn(result);
        when(keycloakService.getGroupIdByName("TENANT-A")).thenReturn("group-7");

        TenantsServiceImpl service = new TenantsServiceImpl(
            repository,
            mapper,
            keycloakService,
            dataErasureService,
            provisioningService
        );

        assertThat(service.delete(7L, authentication())).isSameAs(result);
        assertThat(tenant.getDeleted()).isTrue();
        verify(provisioningService).deactivate("TENANT-A", "user-1");
        verify(keycloakService).deleteGroup("group-7");
    }

    @Test
    void listsTheChildrenThatLoseEffectWhenTheModuleTheyDependOnIsTurnedOff() {
        Map<String, Boolean> before = flags(true, true, true);
        Map<String, Boolean> after = flags(false, true, true);

        Map<String, Boolean> dependent = service().dependentChanges(before, after);

        // L'inventario è spento direttamente: nel log compaiono soltanto le figlie, anche quelle indirette.
        assertThat(dependent).containsOnly(
            entry("inventoryQr", false),
            entry("inventoryLoanSheet", false),
            entry("inventorySignature", false)
        );
    }

    @Test
    void ignoresTheChildrenThatWereAlreadyWithoutEffect() {
        Map<String, Boolean> before = flags(false, true, true);
        Map<String, Boolean> after = flags(false, true, false);

        assertThat(service().dependentChanges(before, after)).isEmpty();
    }

    @Test
    void listsTheChildThatBecomesEffectiveAgainWithItsModule() {
        Map<String, Boolean> dependent = service().dependentChanges(flags(false, true, false), flags(true, true, false));

        assertThat(dependent).containsOnly(
            entry("inventoryQr", true),
            entry("inventoryLoanSheet", true)
        );
    }

    @Test
    void listsTheFeaturesOfTheEventsThatLoseEffectWithTheCalendar() {
        Map<String, Boolean> before = new java.util.HashMap<>(flags(true, true, true));
        before.put("externalCalendarFeed", true);
        before.put("eventPreparation", true);
        before.put("notificationPreferences", true);
        before.put("webPushReminders", true);
        Map<String, Boolean> after = new java.util.HashMap<>(before);
        after.put("calendar", false);

        assertThat(service().dependentChanges(before, after)).containsOnly(
            entry("externalCalendarFeed", false),
            entry("eventPreparation", false),
            entry("webPushReminders", false)
        );
    }

    @Test
    void listsTheSharesOfTheParticipantsAmongTheFeaturesLostWithTheFinanceOrTheCalendar() {
        Map<String, Boolean> before = new java.util.HashMap<>(flags(true, true, true));
        before.put("finance", true);
        before.put("eventPayouts", true);
        Map<String, Boolean> withoutFinance = new java.util.HashMap<>(before);
        withoutFinance.put("finance", false);
        Map<String, Boolean> withoutCalendar = new java.util.HashMap<>(before);
        withoutCalendar.put("calendar", false);

        assertThat(service().dependentChanges(before, withoutFinance)).containsOnly(entry("eventPayouts", false));
        assertThat(service().dependentChanges(before, withoutCalendar)).containsEntry("eventPayouts", false);
    }

    @Test
    void listsTheWritingEditorAmongTheFeaturesLostWithTheScorePlayback() {
        Map<String, Boolean> before = new java.util.HashMap<>(flags(true, true, true));
        before.put("scorePlayback", true);
        before.put("scoreWriting", true);
        Map<String, Boolean> withoutPlayback = new java.util.HashMap<>(before);
        withoutPlayback.put("scorePlayback", false);

        assertThat(service().dependentChanges(before, withoutPlayback)).containsOnly(entry("scoreWriting", false));
    }

    private static Map<String, Boolean> flags(boolean inventory, boolean loanSheet, boolean signature) {
        return Map.ofEntries(
            Map.entry("finance", false),
            Map.entry("inventory", inventory),
            Map.entry("onboardingImport", false),
            Map.entry("externalCalendarFeed", false),
            Map.entry("inventoryQr", true),
            Map.entry("notificationPreferences", false),
            Map.entry("webPushReminders", false),
            Map.entry("eventPreparation", false),
            Map.entry("scorePlayback", false),
            Map.entry("inventoryLoanSheet", loanSheet),
            Map.entry("inventorySignature", signature),
            Map.entry("calendar", true),
            Map.entry("eventPayouts", false),
            Map.entry("scoreWriting", false)
        );
    }

    private static TenantsServiceImpl service() {
        return new TenantsServiceImpl(
            mock(TenantsRepository.class),
            mock(TenantsMapper.class),
            mock(KeycloakService.class),
            mock(DataErasureService.class),
            mock(TenantSchemaProvisioningService.class)
        );
    }

    private JwtAuthenticationToken authentication() {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token")
            .header("alg", "none")
            .subject("user-1")
            .claim("tenant", "TENANT-A")
            .issuedAt(now)
            .expiresAt(now.plusSeconds(300))
            .build();
        return new JwtAuthenticationToken(jwt);
    }
}
