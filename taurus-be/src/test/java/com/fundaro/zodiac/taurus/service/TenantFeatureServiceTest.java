package com.fundaro.zodiac.taurus.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fundaro.zodiac.taurus.domain.Tenants;
import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.multitenancy.TenantContext;
import com.fundaro.zodiac.taurus.repository.TenantsRepository;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;

import java.util.Optional;

import org.junit.jupiter.api.Test;

class TenantFeatureServiceTest {

    private final TenantsRepository repository = mock(TenantsRepository.class);
    private final ApplicationProperties properties = new ApplicationProperties();
    private final TenantFeatureService service = new TenantFeatureService(repository, properties);

    @Test
    void readsOnlyTheTenantSelectedByTheContext() {
        Tenants tenantA = tenant("A", true, false);
        Tenants tenantB = tenant("B", true, true);
        when(repository.findByCodeAndDeletedFalse("A")).thenReturn(Optional.of(tenantA));
        when(repository.findByCodeAndDeletedFalse("B")).thenReturn(Optional.of(tenantB));

        TenantContext.run("A", () -> assertThat(service.isEnabled(TenantFeature.INVENTORY)).isFalse());
        TenantContext.run("B", () -> assertThat(service.isEnabled(TenantFeature.INVENTORY)).isTrue());
    }

    @Test
    void returnsTheMinimalCurrentTenantPayload() {
        Tenants tenant = tenant("ORCHESTRA_A", true, false);
        tenant.setName("Orchestra Aurora");
        tenant.setEntityVersion(12L);
        when(repository.findByCodeAndDeletedFalse("ORCHESTRA_A")).thenReturn(Optional.of(tenant));

        TenantContext.run("ORCHESTRA_A", () -> {
            var result = service.current();
            assertThat(result.tenantCode()).isEqualTo("ORCHESTRA_A");
            assertThat(result.tenantName()).isEqualTo("Orchestra Aurora");
            assertThat(result.version()).isEqualTo(12L);
            assertThat(result.financeEnabled()).isTrue();
            assertThat(result.inventoryEnabled()).isFalse();
            assertThat(result.eventPreparationEnabled()).isFalse();
            assertThat(result.inventoryQrEnabled()).isFalse();
        });
    }

    @Test
    void deniesMissingContextsAndDisabledFeatures() {
        assertThatThrownBy(() -> service.requireEnabled(TenantFeature.FINANCE))
            .isInstanceOf(RequestAlertException.class)
            .extracting(error -> ((RequestAlertException) error).getErrorKey())
            .isEqualTo("auth.tenant.missing");

        Tenants tenant = tenant("A", false, true);
        when(repository.findByCodeAndDeletedFalse("A")).thenReturn(Optional.of(tenant));
        TenantContext.run("A", () ->
            assertThatThrownBy(() -> service.requireEnabled(TenantFeature.FINANCE))
                .isInstanceOf(RequestAlertException.class)
                .extracting(error -> ((RequestAlertException) error).getErrorKey())
                .isEqualTo("tenantFeature.finance.disabled")
        );
    }

    @Test
    void appliesApplicationCapabilitiesAndFeatureDependencies() {
        Tenants tenant = tenant("A", true, true);
        tenant.setOnboardingImportEnabled(true);
        tenant.setExternalCalendarFeedEnabled(true);
        tenant.setInventoryQrEnabled(true);
        tenant.setNotificationPreferencesEnabled(true);
        tenant.setWebPushRemindersEnabled(true);
        tenant.setEventPreparationEnabled(true);
        when(repository.findByCodeAndDeletedFalse("A")).thenReturn(Optional.of(tenant));

        properties.getInventory().getQr().setEnabled(true);
        properties.getInventory().getQr().setPublicBaseUrl("https://taurus.example");
        properties.getVapid().setPublicKey("public-key");
        properties.getVapid().setPrivateKey("private-key");
        properties.getEventPreparation().setEnabled(true);

        TenantContext.run("A", () -> {
            assertThat(service.current())
                .returns(true, result -> result.onboardingImportEnabled())
                .returns(true, result -> result.externalCalendarFeedEnabled())
                .returns(true, result -> result.inventoryQrEnabled())
                .returns(true, result -> result.notificationPreferencesEnabled())
                .returns(true, result -> result.webPushRemindersEnabled())
                .returns(true, result -> result.eventPreparationEnabled());

            tenant.setInventoryEnabled(false);
            assertThat(service.isEnabled(TenantFeature.INVENTORY_QR)).isFalse();
            tenant.setNotificationPreferencesEnabled(false);
            assertThat(service.isEnabled(TenantFeature.WEB_PUSH_REMINDERS)).isFalse();
        });

        assertThat(service.capabilities().get(TenantFeature.INVENTORY_QR).dependencies())
            .containsExactly(TenantFeature.INVENTORY);
        assertThat(service.capabilities().get(TenantFeature.WEB_PUSH_REMINDERS).dependencies())
            .containsExactly(TenantFeature.NOTIFICATION_PREFERENCES, TenantFeature.CALENDAR);
    }

    @Test
    void chainsTheFeaturesOfTheEventsToTheCalendar() {
        Tenants tenant = tenant("A", true, true);
        tenant.setExternalCalendarFeedEnabled(true);
        tenant.setNotificationPreferencesEnabled(true);
        tenant.setWebPushRemindersEnabled(true);
        tenant.setEventPreparationEnabled(true);
        when(repository.findByCodeAndDeletedFalse("A")).thenReturn(Optional.of(tenant));
        properties.getVapid().setPublicKey("public-key");
        properties.getVapid().setPrivateKey("private-key");
        properties.getEventPreparation().setEnabled(true);

        TenantContext.run("A", () -> {
            tenant.setCalendarEnabled(false);
            assertThat(service.current())
                .returns(false, result -> result.calendarEnabled())
                .returns(false, result -> result.externalCalendarFeedEnabled())
                .returns(false, result -> result.webPushRemindersEnabled())
                .returns(false, result -> result.eventPreparationEnabled())
                .returns(true, result -> result.financeEnabled())
                .returns(true, result -> result.notificationPreferencesEnabled());
            assertThatThrownBy(() -> service.requireEnabled(TenantFeature.CALENDAR))
                .extracting(error -> ((RequestAlertException) error).getErrorKey())
                .isEqualTo("tenantFeature.calendar.disabled");

            tenant.setCalendarEnabled(true);
            assertThat(service.current())
                .returns(true, result -> result.calendarEnabled())
                .returns(true, result -> result.externalCalendarFeedEnabled())
                .returns(true, result -> result.webPushRemindersEnabled())
                .returns(true, result -> result.eventPreparationEnabled());
        });

        assertThat(service.capabilities().get(TenantFeature.CALENDAR).available()).isTrue();
        assertThat(service.capabilities().get(TenantFeature.CALENDAR).dependencies()).isEmpty();
        assertThat(service.capabilities().get(TenantFeature.EXTERNAL_CALENDAR_FEED).dependencies())
            .containsExactly(TenantFeature.CALENDAR);
        assertThat(service.capabilities().get(TenantFeature.EVENT_PREPARATION).dependencies())
            .containsExactly(TenantFeature.CALENDAR);
    }

    @Test
    void chainsTheSharesOfTheParticipantsToTheFinanceAndTheCalendar() {
        Tenants tenant = tenant("A", true, false);
        tenant.setEventPayoutsEnabled(true);
        when(repository.findByCodeAndDeletedFalse("A")).thenReturn(Optional.of(tenant));

        TenantContext.run("A", () -> {
            assertThat(service.current().eventPayoutsEnabled()).isTrue();

            tenant.setFinanceEnabled(false);
            assertThat(service.current().eventPayoutsEnabled()).isFalse();
            assertThatThrownBy(() -> service.requireEnabled(TenantFeature.EVENT_PAYOUTS))
                .extracting(error -> ((RequestAlertException) error).getErrorKey())
                .isEqualTo("tenantFeature.eventPayouts.disabled");

            tenant.setFinanceEnabled(true);
            tenant.setCalendarEnabled(false);
            assertThat(service.isEnabled(TenantFeature.EVENT_PAYOUTS)).isFalse();

            tenant.setCalendarEnabled(true);
            tenant.setEventPayoutsEnabled(false);
            assertThat(service.isEnabled(TenantFeature.EVENT_PAYOUTS)).isFalse();
            assertThat(service.isEnabled(TenantFeature.FINANCE)).isTrue();
        });

        assertThat(service.capabilities().get(TenantFeature.EVENT_PAYOUTS).available()).isTrue();
        assertThat(service.capabilities().get(TenantFeature.EVENT_PAYOUTS).dependencies())
            .containsExactly(TenantFeature.FINANCE, TenantFeature.CALENDAR);
    }

    @Test
    void offersTheWritingEditorOnlyWithTheScorePlaybackAndItsInstallation() {
        Tenants tenant = tenant("A", false, false);
        tenant.setScorePlaybackEnabled(true);
        tenant.setScoreWritingEnabled(true);
        when(repository.findByCodeAndDeletedFalse("A")).thenReturn(Optional.of(tenant));

        TenantContext.run("A", () -> {
            assertThat(service.current().scoreWritingEnabled()).isFalse();
            assertThatThrownBy(() -> service.requireEnabled(TenantFeature.SCORE_WRITING))
                .extracting(error -> ((RequestAlertException) error).getErrorKey())
                .isEqualTo("tenantFeature.scoreWriting.disabled");
        });
        assertThat(service.capabilities().get(TenantFeature.SCORE_WRITING))
            .returns(false, capability -> capability.available())
            .returns("tenantFeature.capability.scoreWriting.unavailable", capability -> capability.reasonCode());

        properties.getScoreWriting().setEnabled(true);
        TenantContext.run("A", () -> assertThat(service.current().scoreWritingEnabled()).isFalse());

        properties.getScorePlayback().setEnabled(true);
        TenantContext.run("A", () -> {
            assertThat(service.current().scoreWritingEnabled()).isTrue();

            tenant.setScorePlaybackEnabled(false);
            assertThat(service.isEnabled(TenantFeature.SCORE_WRITING)).isFalse();

            tenant.setScorePlaybackEnabled(true);
            tenant.setScoreWritingEnabled(false);
            assertThat(service.isEnabled(TenantFeature.SCORE_WRITING)).isFalse();
            assertThat(service.isEnabled(TenantFeature.SCORE_PLAYBACK)).isTrue();
        });
        assertThat(service.capabilities().get(TenantFeature.SCORE_WRITING).available()).isTrue();
        assertThat(service.capabilities().get(TenantFeature.SCORE_WRITING).dependencies())
            .containsExactly(TenantFeature.SCORE_PLAYBACK);
    }

    @Test
    void chainsTheElectronicSignatureToTheLoanSheetAndTheLoanSheetToTheInventory() {
        Tenants tenant = tenant("A", false, true);
        tenant.setInventoryLoanSheetEnabled(true);
        tenant.setInventorySignatureEnabled(true);
        when(repository.findByCodeAndDeletedFalse("A")).thenReturn(Optional.of(tenant));

        TenantContext.run("A", () -> {
            assertThat(service.current())
                .returns(true, result -> result.inventoryLoanSheetEnabled())
                .returns(true, result -> result.inventorySignatureEnabled());

            tenant.setInventoryLoanSheetEnabled(false);
            assertThat(service.isEnabled(TenantFeature.INVENTORY_SIGNATURE)).isFalse();
            assertThatThrownBy(() -> service.requireEnabled(TenantFeature.INVENTORY_SIGNATURE))
                .extracting(error -> ((RequestAlertException) error).getErrorKey())
                .isEqualTo("tenantFeature.inventorySignature.disabled");

            tenant.setInventoryLoanSheetEnabled(true);
            tenant.setInventoryEnabled(false);
            assertThat(service.isEnabled(TenantFeature.INVENTORY_LOAN_SHEET)).isFalse();
            assertThat(service.isEnabled(TenantFeature.INVENTORY_SIGNATURE)).isFalse();
            assertThatThrownBy(() -> service.requireEnabled(TenantFeature.INVENTORY_LOAN_SHEET))
                .extracting(error -> ((RequestAlertException) error).getErrorKey())
                .isEqualTo("tenantFeature.inventoryLoanSheet.disabled");
        });

        assertThat(service.capabilities().get(TenantFeature.INVENTORY_LOAN_SHEET).dependencies())
            .containsExactly(TenantFeature.INVENTORY);
        assertThat(service.capabilities().get(TenantFeature.INVENTORY_SIGNATURE).dependencies())
            .containsExactly(TenantFeature.INVENTORY_LOAN_SHEET);
        assertThat(service.capabilities().get(TenantFeature.INVENTORY_SIGNATURE).available()).isTrue();
    }

    @Test
    void defaultsEveryTenantFeatureToDisabled() {
        Tenants tenant = new Tenants();
        assertThat(tenant.getFinanceEnabled()).isFalse();
        assertThat(tenant.getInventoryEnabled()).isFalse();
        assertThat(tenant.getOnboardingImportEnabled()).isFalse();
        assertThat(tenant.getExternalCalendarFeedEnabled()).isFalse();
        assertThat(tenant.getInventoryQrEnabled()).isFalse();
        assertThat(tenant.getNotificationPreferencesEnabled()).isFalse();
        assertThat(tenant.getWebPushRemindersEnabled()).isFalse();
        assertThat(tenant.getEventPreparationEnabled()).isFalse();
        assertThat(tenant.getInventoryLoanSheetEnabled()).isFalse();
        assertThat(tenant.getInventorySignatureEnabled()).isFalse();
        assertThat(tenant.getCalendarEnabled()).isFalse();
        assertThat(tenant.getEventPayoutsEnabled()).isFalse();
        assertThat(tenant.getScoreWritingEnabled()).isFalse();
    }

    private static Tenants tenant(String code, boolean finance, boolean inventory) {
        Tenants tenant = new Tenants();
        tenant.setCode(code);
        tenant.setActive(true);
        tenant.setDeleted(false);
        tenant.setFinanceEnabled(finance);
        tenant.setInventoryEnabled(inventory);
        tenant.setCalendarEnabled(true);
        return tenant;
    }
}
