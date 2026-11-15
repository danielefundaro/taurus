package com.fundaro.zodiac.taurus.service.eventpreparation;

import static com.fundaro.zodiac.taurus.service.dto.eventpreparation.EventPreparationDtos.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.fundaro.zodiac.taurus.domain.CalendarEventAvailability;
import com.fundaro.zodiac.taurus.domain.CalendarEvents;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.Users;
import com.fundaro.zodiac.taurus.domain.enumeration.RoleEnum;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventMaterial;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventPreparation;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventProgramEntry;
import com.fundaro.zodiac.taurus.domain.eventpreparation.PreparationProfile;
import com.fundaro.zodiac.taurus.domain.finance.FinancialDirection;
import com.fundaro.zodiac.taurus.domain.finance.FinancialMovement;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryAssignment;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryAssignmentStatus;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryCondition;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryItem;
import com.fundaro.zodiac.taurus.repository.*;
import com.fundaro.zodiac.taurus.repository.eventpreparation.*;
import com.fundaro.zodiac.taurus.repository.finance.FinancialMovementRepository;
import com.fundaro.zodiac.taurus.repository.inventory.*;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import com.fundaro.zodiac.taurus.service.eventpreparation.EventPreparationService.DashboardEntry;
import com.fundaro.zodiac.taurus.service.impl.NotificationOutboxPublisher;
import com.fundaro.zodiac.taurus.service.notification.NotificationCommand;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.*;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class EventPreparationServiceTest {
    private EventPreparationRepository preparations;
    private EventProgramEntryRepository programs;
    private EventMaterialRepository materials;
    private UsersRepository users;
    private TracksRepository tracks;
    private InventoryItemRepository items;
    private InventoryAssignmentRepository assignments;
    private FinancialMovementRepository movements;
    private TenantFeatureService features;
    private SimpleMeterRegistry registry;
    private EventPreparationService service;
    private CalendarEvents event;

    @BeforeEach
    void setUp() {
        CalendarEventsRepository events = mock(CalendarEventsRepository.class);
        preparations = mock(EventPreparationRepository.class);
        programs = mock(EventProgramEntryRepository.class);
        materials = mock(EventMaterialRepository.class);
        users = mock(UsersRepository.class);
        tracks = mock(TracksRepository.class);
        items = mock(InventoryItemRepository.class);
        assignments = mock(InventoryAssignmentRepository.class);
        movements = mock(FinancialMovementRepository.class);
        service = new EventPreparationService(events, preparations, programs, materials, tracks, items, assignments, users, movements);
        features = mock(TenantFeatureService.class);
        when(features.isEnabled(any())).thenReturn(true);
        service.setTenantFeatures(features);
        registry = new SimpleMeterRegistry();
        service.setMetrics(new EventPreparationMetrics(registry));
        event = new CalendarEvents();
        event.setId(42L);
        event.setDeleted(false);
        event.setName("Riunione");
        event.setState(StateEnum.COMPLETE);
        event.setStartDate(Date.from(Instant.now().plusSeconds(3600)));
        event.setEndDate(Date.from(Instant.now().plusSeconds(7200)));
        when(events.findByIdAndDeletedFalse(42L)).thenReturn(Optional.of(event));
        when(preparations.advanceProgramVersion(any(), anyLong())).thenReturn(1);
        when(preparations.advanceMaterialsVersion(any(), anyLong())).thenReturn(1);
    }

    @Test
    void eventWithoutPlanIsNotConfiguredAndDoesNotBecomeAnError() {
        when(preparations.findByEvent_IdAndDeletedFalse(42L)).thenReturn(Optional.empty());
        View result = service.get(42L);
        assertThat(result.configuration()).isNull();
        assertThat(result.evaluation().preparationStatus()).isEqualTo(PreparationStatus.NOT_CONFIGURED);
        assertThat(result.evaluation().blockerCount()).isZero();
        assertThat(result.programVersion()).isNull();
    }

    @Test
    void otherProfileWithNoOptionalChecksCanBeReady() {
        givenPlan(plan());
        View result = service.get(42L);
        assertThat(result.evaluation().preparationStatus()).isEqualTo(PreparationStatus.READY);
        assertThat(result.evaluation().applicableChecks()).isEqualTo(1);
        assertThat(result.evaluation().completionPercent()).isEqualTo(100);
        assertThat(result.evaluation().excludedAreas()).isEmpty();
        assertThat(result.programVersion()).isZero();
        assertThat(result.materialsVersion()).isZero();
    }

    @Test
    void scoresCannotBeRequiredWithoutProgram() {
        Configuration invalid = new Configuration(PreparationProfile.OTHER, false, false, true, false, null, 1440, false, 180, false, false, false, 0);
        assertThatThrownBy(() -> service.configure(42L, invalid, null)).hasMessageContaining("Gli spartiti richiedono il programma");
        verifyNoInteractions(preparations);
    }

    @Test
    void everyRequirementNeedsAnExplicitChoice() {
        Configuration undecided = new Configuration(PreparationProfile.REHEARSAL, null, true, false, false, null, 1440, false, 180, false, false, false, 0);
        assertThatThrownBy(() -> service.configure(42L, undecided, null))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.requirement.required"));
        verifyNoInteractions(preparations);
        assertThat(registry.counter("taurus.event_preparation.command", "area", "configuration", "outcome", "invalid").count()).isEqualTo(1);
    }

    @Test
    void preparationNeverChangesCalendarVisibilityState() {
        givenPlan(plan());
        service.get(42L);
        assertThat(event.getState()).isEqualTo(StateEnum.COMPLETE);
        verify(preparations, never()).save(any());
    }

    @Test
    void missingAvailabilityBeforeDeadlineRequiresAttentionNotBlocking() {
        CalendarEventPreparation plan = plan();
        plan.setAvailabilityRequired(true);
        plan.setMinimumAvailableParticipants(1);
        plan.setAvailabilityDeadlineMinutes(0);
        givenPlan(plan);
        participants(participant("participant", RoleEnum.ROLE_USER, null, null));
        View result = service.get(42L);
        assertThat(result.evaluation().preparationStatus()).isEqualTo(PreparationStatus.ATTENTION);
        assertThat(result.evaluation().warningCount()).isEqualTo(1);
        assertThat(result.evaluation().blockerCount()).isZero();
        assertThat(result.evaluation().issues().get(0).details()).extracting(IssueDetail::reason).containsExactly("BELOW_MINIMUM", "RESPONSES_MISSING");
    }

    @Test
    void completionPercentageCountsEveryApplicableCheck() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        plan.setAvailabilityRequired(true);
        plan.setMinimumAvailableParticipants(1);
        givenPlan(plan);
        participants(participant("participant", RoleEnum.ROLE_USER, null, null));

        View result = service.get(42L);

        assertThat(result.evaluation().passedChecks()).isEqualTo(1);
        assertThat(result.evaluation().applicableChecks()).isEqualTo(3);
        assertThat(result.evaluation().completionPercent()).isEqualTo(33);
    }

    @Test
    void distantDraftIsWarningAndNeverReady() {
        event.setState(StateEnum.DRAFT);
        event.setStartDate(Date.from(Instant.now().plusSeconds(9 * 86400)));
        event.setEndDate(Date.from(Instant.now().plusSeconds(9 * 86400 + 3600)));
        givenPlan(plan());
        View result = service.get(42L);
        assertThat(result.evaluation().preparationStatus()).isEqualTo(PreparationStatus.ATTENTION);
        assertThat(result.evaluation().issues()).extracting(Issue::code).containsExactly("EVENT_DATA");
        assertThat(result.evaluation().issues().get(0).action()).isEqualTo("#event-data");
        assertThat(result.evaluation().issues().get(0).details()).extracting(IssueDetail::reason).containsExactly("DRAFT");
    }

    @Test
    void personalViewContainsOnlyTheCurrentUsersAvailabilityAndNoOperationalData() {
        CalendarEventPreparation plan = plan();
        plan.setAvailabilityRequired(true);
        plan.setMinimumAvailableParticipants(2);
        plan.setMaterialsRequired(true);
        plan.setBudgetRequired(true);
        when(users.findByKeycloakIdAndDeletedFalse("participant")).thenReturn(Optional.of(user("participant")));
        participants(participant("participant", RoleEnum.ROLE_USER, null, null), participant("another", RoleEnum.ROLE_USER, null, null));
        responses(response("participant", CalendarEventAvailability.Availability.AVAILABLE), response("another", CalendarEventAvailability.Availability.UNAVAILABLE));
        givenPlan(plan);

        View result = service.getPersonal(42L, authentication("participant"), false);

        assertThat(result.configuration().materialsRequired()).isFalse();
        assertThat(result.configuration().budgetRequired()).isFalse();
        assertThat(result.evaluation()).isNull();
        assertThat(result.materials()).isEmpty();
        assertThat(result.programVersion()).isNull();
        assertThat(result.confirmations()).isNull();
        assertThat(result.availability()).isEqualTo(new Availability(1, 1, 0, 0, null, result.availability().deadline()));
        verify(materials, never()).findCurrentByEventIds(any(), any(), any());
    }

    @Test
    void personalViewShowsOnlyTheReadyPartsOfTheUsersInstrumentsAndHidesDraftTracks() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        givenPlan(plan);
        when(users.findByKeycloakIdAndDeletedFalse("participant")).thenReturn(Optional.of(user("participant")));
        participants(participant("participant", RoleEnum.ROLE_USER, 3L, "Tromba"));
        program(entry(track(7L, "Marcia", StateEnum.COMPLETE), 0), entry(track(8L, "Bozza", StateEnum.DRAFT), 1));
        scores(
            score(7L, 1L, "Tromba I", false, 3L, "Tromba", 11L, "tromba.pdf"),
            score(7L, 2L, "Clarinetto", false, 4L, "Clarinetto", 12L, "clarinetto.pdf"),
            score(7L, 3L, "Tromba II", true, 3L, "Tromba", 13L, "tromba-2.pdf")
        );

        View result = service.getPersonal(42L, authentication("participant"), false);

        assertThat(result.program()).extracting(ProgramEntry::trackId).containsExactly(7L);
        assertThat(result.program().get(0).scores()).extracting(ProgramScore::id).containsExactly(1L);
        assertThat(result.program().get(0).scores().get(0).files()).containsExactly(new ScoreFile(11L, "tromba.pdf"));
    }

    @Test
    void personalViewUsesTheKeycloakSubjectInsteadOfThePrincipalName() {
        when(users.findByKeycloakIdAndDeletedFalse("keycloak-id")).thenReturn(Optional.of(user("keycloak-id")));
        givenPlan(plan());

        service.getPersonal(42L, named("keycloak-id", "participant"), false);

        verify(users).findByKeycloakIdAndDeletedFalse("keycloak-id");
        verify(users, never()).findByKeycloakIdAndDeletedFalse("participant");
    }

    @Test
    void externalViewRejectsAnEventThatIsNotPublic() {
        when(users.findByKeycloakIdAndDeletedFalse("participant")).thenReturn(Optional.of(user("participant")));

        assertThatThrownBy(() -> service.getPersonal(42L, authentication("participant"), true))
            .isInstanceOf(RequestAlertException.class)
            .hasMessageContaining("Evento non trovato");
    }

    @Test
    void catalogueAndFinanceViewsDoNotExposeOtherRoleAreas() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        plan.setMaterialsRequired(true);
        plan.setBudgetRequired(true);
        givenPlan(plan);

        View catalogue = service.getCatalogue(42L);
        View finance = service.getFinance(42L);

        assertThat(catalogue.configuration().programRequired()).isTrue();
        assertThat(catalogue.configuration().materialsRequired()).isFalse();
        assertThat(catalogue.configuration().budgetRequired()).isFalse();
        assertThat(catalogue.confirmations()).isNull();
        assertThat(catalogue.evaluation().issues()).extracting(Issue::area).doesNotContain("MATERIALS", "BUDGET");
        assertThat(finance.configuration().programRequired()).isFalse();
        assertThat(finance.configuration().budgetRequired()).isTrue();
        assertThat(finance.program()).isEmpty();
        assertThat(finance.materials()).isEmpty();
        assertThat(finance.evaluation().issues()).extracting(Issue::code).containsExactly("BUDGET_NOT_CONFIRMED");
        assertThat(finance.evaluation().issues().get(0).action()).isEqualTo("#preparation-confirmations");
        assertThat(finance.confirmations().presenceAt()).isNull();
    }

    @Test
    void programSaveKeepsEncoreAndTrackNameAndNotifiesAvailableUsers() {
        CalendarEventPreparation plan = plan();
        givenPlan(plan);
        event.getAvailabilities().add(availability(user("participant"), CalendarEventAvailability.Availability.AVAILABLE));
        NotificationOutboxPublisher publisher = mock(NotificationOutboxPublisher.class);
        service.setNotificationPublisher(publisher);
        when(tracks.findAllById(any())).thenReturn(List.of(track(7L, "Marcia", StateEnum.COMPLETE)));

        service.replaceProgram(42L, new ProgramRequest(List.of(new ProgramEntryRequest(7L, true, 120, null)), 3L), authentication("admin", AuthoritiesConstants.ADMIN));

        verify(preparations).advanceProgramVersion(any(), eq(3L));
        CalendarEventProgramEntry saved = lastSaved(programs);
        assertThat(saved.isEncore()).isTrue();
        assertThat(saved.getTrackNameSnapshot()).isEqualTo("Marcia");
        ArgumentCaptor<NotificationCommand> command = ArgumentCaptor.forClass(NotificationCommand.class);
        verify(publisher).enqueue(command.capture());
        assertThat(command.getValue().operation()).isEqualTo("PROGRAM_UPDATED");
        assertThat(command.getValue().targetPath()).isEqualTo("/calendar/42#preparation");
        assertThat(command.getValue().audiences()).extracting(value -> value.value()).containsExactly("participant");
        assertThat(registry.counter("taurus.event_preparation.command", "area", "program", "outcome", "success").count()).isEqualTo(1);
    }

    @Test
    void archivistSavingTheProgramReadsTheCatalogueView() {
        CalendarEventPreparation plan = plan();
        plan.setMaterialsRequired(true);
        plan.setBudgetRequired(true);
        givenPlan(plan);
        when(tracks.findAllById(any())).thenReturn(List.of(track(7L, "Marcia", StateEnum.COMPLETE)));

        View result = service.replaceProgram(42L, new ProgramRequest(List.of(new ProgramEntryRequest(7L, false, null, null)), 0L),
            authentication("archivist", AuthoritiesConstants.ARCHIVIST));

        assertThat(result.configuration().materialsRequired()).isFalse();
        assertThat(result.configuration().budgetRequired()).isFalse();
        assertThat(result.materials()).isEmpty();
        assertThat(result.confirmations()).isNull();
        assertThat(result.evaluation().issues()).extracting(Issue::area).doesNotContain("MATERIALS", "BUDGET");
    }

    @Test
    void treasurerConfirmingTheBudgetReadsTheFinanceView() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        plan.setBudgetRequired(true);
        givenPlan(plan);

        View result = service.confirmBudget(42L, authentication("treasurer", AuthoritiesConstants.TREASURER));

        assertThat(result.program()).isEmpty();
        assertThat(result.configuration().programRequired()).isFalse();
        assertThat(result.confirmations().budgetCurrent()).isTrue();
        assertThat(result.confirmations().presenceAt()).isNull();
        assertThat(result.evaluation().issues()).isEmpty();
    }

    @Test
    void staleProgramVersionIsAConflictAndSavesNothing() {
        givenPlan(plan());
        when(preparations.advanceProgramVersion(any(), anyLong())).thenReturn(0);

        assertThatThrownBy(() -> service.replaceProgram(42L, new ProgramRequest(List.of(), 1L), authentication("admin", AuthoritiesConstants.ADMIN)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getStatusCode().value()).isEqualTo(409);
                assertThat(error.getErrorKey()).isEqualTo("eventPreparation.versionConflict");
            });
        verify(programs, never()).saveAll(any());
        assertThat(registry.counter("taurus.event_preparation.command", "area", "program", "outcome", "conflict").count()).isEqualTo(1);
    }

    @Test
    void programAndMaterialsLongerThanTheLimitAreRejected() {
        givenPlan(plan());
        List<ProgramEntryRequest> entries = IntStream.range(0, MAX_ROWS + 1).mapToObj(i -> new ProgramEntryRequest((long) i, false, null, null)).toList();
        List<MaterialRequest> rows = IntStream.range(0, MAX_ROWS + 1).mapToObj(i -> new MaterialRequest((long) i, null, 1, null)).toList();

        assertThatThrownBy(() -> service.replaceProgram(42L, new ProgramRequest(entries, 0L), authentication("admin", AuthoritiesConstants.ADMIN)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.program.tooLarge"));
        assertThatThrownBy(() -> service.replaceMaterials(42L, new MaterialsRequest(rows, 0L), authentication("admin", AuthoritiesConstants.ADMIN)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.materials.tooLarge"));
        verify(preparations, never()).advanceProgramVersion(any(), anyLong());
        verify(preparations, never()).advanceMaterialsVersion(any(), anyLong());
    }

    @Test
    void programRejectsATrackOutsideTheCatalogue() {
        givenPlan(plan());
        Tracks deleted = track(7L, "Marcia", StateEnum.COMPLETE);
        deleted.setDeleted(true);
        when(tracks.findAllById(any())).thenReturn(List.of(deleted));

        assertThatThrownBy(() -> service.replaceProgram(42L, new ProgramRequest(List.of(new ProgramEntryRequest(7L, null, null, null)), 0L), authentication("admin", AuthoritiesConstants.ADMIN)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.track.notFound"));
        verify(programs, never()).saveAll(any());
    }

    @Test
    void programRequiresAConfiguredPreparation() {
        when(preparations.findByEvent_IdAndDeletedFalse(42L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.replaceProgram(42L, new ProgramRequest(List.of(), 0L), authentication("admin", AuthoritiesConstants.ADMIN)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.notConfigured"));
    }

    @Test
    void materialsNotificationsNameItemsAndQuantitiesOnlyToTheirReaders() {
        givenPlan(plan());
        NotificationOutboxPublisher publisher = mock(NotificationOutboxPublisher.class);
        service.setNotificationPublisher(publisher);
        InventoryItem stand = item(5L, "INV-5", "Leggio", InventoryCondition.GOOD);
        InventoryItem drum = item(6L, "INV-6", "Tamburo", InventoryCondition.GOOD);
        InventoryAssignment loan = assignment(9L, stand, "member", 2, 0, InventoryAssignmentStatus.ACTIVE);
        when(items.findAllById(any())).thenReturn(List.of(stand, drum));
        when(assignments.findAllById(any())).thenReturn(List.of(loan));

        service.replaceMaterials(42L, new MaterialsRequest(List.of(new MaterialRequest(5L, 9L, 2, null), new MaterialRequest(6L, null, 1, null)), 0L), authentication("admin", AuthoritiesConstants.ADMIN));

        ArgumentCaptor<NotificationCommand> commands = ArgumentCaptor.forClass(NotificationCommand.class);
        verify(publisher, times(2)).enqueue(commands.capture());
        NotificationCommand admins = commands.getAllValues().get(0);
        NotificationCommand member = commands.getAllValues().get(1);
        assertThat(admins.message()).contains("Leggio × 2").contains("Tamburo × 1");
        assertThat(admins.audiences()).extracting(value -> value.value()).containsExactlyInAnyOrder("ROLE_ADMIN", "ROLE_BOARD", "ROLE_SUPER_ADMIN");
        assertThat(member.message()).contains("Leggio × 2").doesNotContain("Tamburo");
        assertThat(member.audiences()).extracting(value -> value.value()).containsExactly("member");
        assertThat(member.eventKey()).endsWith(":user:member").hasSizeLessThanOrEqualTo(160);
        assertThat(admins.eventKey()).isNotEqualTo(member.eventKey());
    }

    @Test
    void materialsRejectAnAssignmentOfAnotherItem() {
        givenPlan(plan());
        InventoryItem stand = item(5L, "INV-5", "Leggio", InventoryCondition.GOOD);
        InventoryItem drum = item(6L, "INV-6", "Tamburo", InventoryCondition.GOOD);
        when(items.findAllById(any())).thenReturn(List.of(stand));
        when(assignments.findAllById(any())).thenReturn(List.of(assignment(9L, drum, "member", 1, 0, InventoryAssignmentStatus.ACTIVE)));

        assertThatThrownBy(() -> service.replaceMaterials(42L, new MaterialsRequest(List.of(new MaterialRequest(5L, 9L, 1, null)), 0L), authentication("admin", AuthoritiesConstants.ADMIN)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.assignment.itemMismatch"));
        verify(materials, never()).saveAll(any());
    }

    @Test
    void staleMaterialsVersionIsAConflict() {
        givenPlan(plan());
        when(preparations.advanceMaterialsVersion(any(), anyLong())).thenReturn(0);

        assertThatThrownBy(() -> service.replaceMaterials(42L, new MaterialsRequest(List.of(), 4L), authentication("admin", AuthoritiesConstants.ADMIN)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        verify(materials, never()).saveAll(any());
    }

    @Test
    void materialWithoutAssignmentBlocksBeforeItsDeadline() {
        CalendarEventPreparation plan = plan();
        plan.setMaterialsRequired(true);
        plan.setMaterialsDeadlineMinutes(0);
        givenPlan(plan);
        materialRows(material(1L, item(5L, "INV-5", "Leggio", InventoryCondition.GOOD), null, 1), 0L);

        View result = service.get(42L);

        Issue issue = issue(result, "MATERIAL_NOT_READY");
        assertThat(issue.severity()).isEqualTo(Severity.BLOCKER);
        assertThat(issue.relatedId()).isEqualTo(1L);
        assertThat(issue.details().get(0).reason()).isEqualTo("ASSIGNMENT_MISSING");
        assertThat(issue.details().get(0).label()).isEqualTo("INV-5 · Leggio");
        assertThat(issue.details().get(0).action()).isEqualTo("/inventory/items/5");
        Material material = result.materials().get(0);
        assertThat(material.inventoryNumber()).isEqualTo("INV-5");
        assertThat(material.outstandingQuantity()).isNull();
        assertThat(material.problems()).containsExactly("ASSIGNMENT_MISSING", "CONFIRMATION_MISSING");
    }

    @Test
    void materialOnlyAwaitingConfirmationWarnsUntilItsDeadline() {
        CalendarEventPreparation plan = plan();
        plan.setMaterialsRequired(true);
        plan.setMaterialsDeadlineMinutes(0);
        givenPlan(plan);
        InventoryItem stand = item(5L, "INV-5", "Leggio", InventoryCondition.GOOD);
        materialRows(material(1L, stand, assignment(9L, stand, "member", 3, 1, InventoryAssignmentStatus.PARTIALLY_RETURNED), 2), 0L);

        View result = service.get(42L);

        assertThat(issue(result, "MATERIAL_NOT_READY").severity()).isEqualTo(Severity.WARNING);
        assertThat(result.materials().get(0).outstandingQuantity()).isEqualTo(2);
        assertThat(result.materials().get(0).assignee()).isEqualTo("member Rossi");
    }

    @Test
    void unusableItemAndOpenUnsafeIssueBlockAtOnce() {
        CalendarEventPreparation plan = plan();
        plan.setMaterialsRequired(true);
        givenPlan(plan);
        InventoryItem broken = item(5L, "INV-5", "Leggio", InventoryCondition.TO_REPAIR);
        materialRows(material(1L, broken, assignment(9L, broken, "member", 1, 0, InventoryAssignmentStatus.ACTIVE), 1), 1L);

        View result = service.get(42L);

        assertThat(issue(result, "MATERIAL_NOT_READY").severity()).isEqualTo(Severity.BLOCKER);
        assertThat(result.materials().get(0).problems()).contains("ITEM_NOT_USABLE", "UNSAFE_ISSUE");
        assertThat(result.materials().get(0).unsafeIssueOpen()).isTrue();
    }

    @Test
    void unsafeIssueCountsOnlyWithTheQrModule() {
        when(features.isEnabled(TenantFeature.INVENTORY_QR)).thenReturn(false);
        CalendarEventPreparation plan = plan();
        plan.setMaterialsRequired(true);
        givenPlan(plan);
        InventoryItem stand = item(5L, "INV-5", "Leggio", InventoryCondition.GOOD);
        materialRows(material(1L, stand, assignment(9L, stand, "member", 1, 0, InventoryAssignmentStatus.ACTIVE), 1), 1L);

        View result = service.get(42L);

        assertThat(result.materials().get(0).problems()).doesNotContain("UNSAFE_ISSUE");
    }

    @Test
    void changedMaterialMakesItsConfirmationObsoleteForTheViewAndTheDashboard() {
        CalendarEventPreparation plan = plan();
        plan.setMaterialsRequired(true);
        givenPlan(plan);
        when(preparations.findDashboardCandidates(any(), any())).thenReturn(List.of(plan));
        InventoryItem stand = item(5L, "INV-5", "Leggio", InventoryCondition.GOOD);
        InventoryAssignment loan = assignment(9L, stand, "member", 2, 0, InventoryAssignmentStatus.ACTIVE);
        CalendarEventMaterial row = material(1L, stand, loan, 1);
        row.setConfirmationHash(PreparationHashes.material(row));
        materialRows(row, 0L);
        assertThat(service.get(42L).materials().get(0).ready()).isTrue();

        loan.setReturnedQuantity(1);
        View result = service.get(42L);
        List<DashboardEntry> entries = service.dashboardEntries(ZonedDateTime.now().minusDays(1), ZonedDateTime.now().plusDays(1));

        assertThat(result.materials().get(0).confirmationObsolete()).isTrue();
        assertThat(result.materials().get(0).problems()).containsExactly("CONFIRMATION_OBSOLETE");
        assertThat(entries.get(0).obsoleteMaterialConfirmations()).extracting(EventPreparationService.ObsoleteConfirmation::materialId).containsExactly(1L);
        assertThat(entries.get(0).issueCodes()).contains("MATERIAL_NOT_READY");
    }

    @Test
    void moduleTurnedOffLeavesTheRequirementsAndIsListedAsExcluded() {
        when(features.isEnabled(TenantFeature.INVENTORY)).thenReturn(false);
        CalendarEventPreparation plan = plan();
        plan.setMaterialsRequired(true);
        givenPlan(plan);

        View result = service.get(42L);

        assertThat(result.evaluation().excludedAreas()).containsExactly("MATERIALS");
        assertThat(result.evaluation().preparationStatus()).isEqualTo(PreparationStatus.READY);
        assertThat(result.configuration().materialsRequired()).isFalse();
        assertThat(result.materials()).isEmpty();
        assertThat(result.materialsVersion()).isNull();
        verify(materials, never()).findCurrentByEventIds(any(), any(), any());
    }

    @Test
    void financeClosesWhenTheFinanceModuleSettlesTheEvent() {
        endEvent();
        event.setFee(new BigDecimal("100.00"));
        CalendarEventPreparation plan = plan();
        plan.setFinancialClosureRequired(true);
        givenPlan(plan);
        when(movements.findAllByEvent_IdInAndDeletedFalseOrderByBookingDateAscIdAsc(any())).thenReturn(List.of(movement(FinancialDirection.INCOME, "100", false)));

        View result = service.get(42L);

        assertThat(result.evaluation().closureStatus()).isEqualTo(ClosureStatus.CLOSED_WITH_WARNINGS);
        Issue warning = issue(result, "MOVEMENTS_UNRECONCILED");
        assertThat(warning.action()).isEqualTo("/finance?section=movements&reconciled=false&eventId=42");
    }

    @Test
    void partiallySettledFinanceStaysToClose() {
        endEvent();
        event.setFee(new BigDecimal("100"));
        CalendarEventPreparation plan = plan();
        plan.setFinancialClosureRequired(true);
        givenPlan(plan);
        when(movements.findAllByEvent_IdInAndDeletedFalseOrderByBookingDateAscIdAsc(any())).thenReturn(List.of(movement(FinancialDirection.INCOME, "40", true)));

        View result = service.get(42L);

        assertThat(result.evaluation().closureStatus()).isEqualTo(ClosureStatus.TO_CLOSE);
        assertThat(issue(result, "FINANCE_NOT_CLOSED").details().get(0).reason()).isEqualTo("PARTIALLY_SETTLED");
    }

    @Test
    void noMovementsConfirmationKeepsItsReasonAndClosesTheFinance() {
        endEvent();
        CalendarEventPreparation plan = plan();
        plan.setFinancialClosureRequired(true);
        givenPlan(plan);

        View result = service.confirmNoMovements(42L, "  Evento gratuito ", authentication("treasurer", AuthoritiesConstants.TREASURER));

        assertThat(plan.getNoMovementsConfirmationReason()).isEqualTo("Evento gratuito");
        assertThat(result.confirmations().noMovementsCurrent()).isTrue();
        assertThat(result.confirmations().noMovementsReason()).isEqualTo("Evento gratuito");
        assertThat(result.evaluation().closureStatus()).isEqualTo(ClosureStatus.CLOSED);
    }

    @Test
    void noMovementsConfirmationRejectsAReasonOverTheLimit() {
        givenPlan(plan());

        assertThatThrownBy(() -> service.confirmNoMovements(42L, "x".repeat(501), authentication("treasurer", AuthoritiesConstants.TREASURER)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.reason.tooLong"));
        verify(preparations, never()).save(any());
    }

    @Test
    void budgetConfirmationBecomesObsoleteWhenTheBudgetChanges() {
        CalendarEventPreparation plan = plan();
        plan.setBudgetRequired(true);
        givenPlan(plan);
        event.setFee(new BigDecimal("50"));
        service.confirmBudget(42L, authentication("treasurer", AuthoritiesConstants.TREASURER));
        event.setFee(new BigDecimal("50.00"));
        assertThat(service.getFinance(42L).confirmations().budgetCurrent()).isTrue();

        event.setFee(new BigDecimal("60"));
        View result = service.getFinance(42L);

        assertThat(result.confirmations().budgetCurrent()).isFalse();
        assertThat(issue(result, "BUDGET_NOT_CONFIRMED").details()).extracting(IssueDetail::reason).containsExactly("CONFIRMATION_OBSOLETE");
    }

    @Test
    void alternativePartInReviewWarnsWithoutBlocking() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        plan.setScoresRequired(true);
        givenPlan(plan);
        program(entry(track(7L, "Marcia", StateEnum.COMPLETE), 0));
        scores(score(7L, 1L, "Tromba I", false, 3L, "Tromba", 11L, "tromba.pdf"), score(7L, 2L, "Tromba II", true, 3L, "Tromba", 12L, "tromba-2.pdf"));

        View result = service.get(42L);

        Issue issue = issue(result, "SCORE_ALTERNATIVE_IN_REVIEW");
        assertThat(issue.severity()).isEqualTo(Severity.WARNING);
        assertThat(issue.details().get(0).label()).isEqualTo("1. Marcia · Tromba II");
        assertThat(issue.details().get(0).action()).isEqualTo("/tracks/7");
        assertThat(result.evaluation().blockerCount()).isZero();
        assertThat(result.program().get(0).scores()).extracting(ProgramScore::needsReview).containsExactly(false, true);
    }

    @Test
    void writtenPartWithoutPagesIsToEngrave() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        plan.setScoresRequired(true);
        givenPlan(plan);
        program(entry(track(7L, "Marcia", StateEnum.COMPLETE), 0));
        // A written part without pages and one whose only page is still processing: only the first is to engrave.
        scores(versionedScore(7L, 1L, "Tromba", 3L, "Tromba", 0), versionedScore(7L, 2L, "Clarinetto", 4L, "Clarinetto", 1));

        View result = service.get(42L);

        Issue issue = issue(result, "SCORE_NOT_READY");
        assertThat(issue.details().get(0).message()).isEqualTo("Nessuno spartito pronto: 1 da impaginare, 1 senza file pronti");
        assertThat(issue.details().get(0).action()).isEqualTo("/tracks/7");
        assertThat(result.program().get(0).scores()).extracting(ProgramScore::unengraved, ProgramScore::ready, ProgramScore::instrumentIds)
            .containsExactly(tuple(true, false, List.of(3L)), tuple(false, false, List.of(4L)));
    }

    @Test
    void uncoveredInstrumentIsOnlyInformation() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        plan.setScoresRequired(true);
        givenPlan(plan);
        program(entry(track(7L, "Marcia", StateEnum.COMPLETE), 0));
        scores(score(7L, 1L, "Tromba", false, 3L, "Tromba", 11L, "tromba.pdf"));
        participants(participant("member-a", RoleEnum.ROLE_USER, 3L, "Tromba"), participant("member-b", RoleEnum.ROLE_USER, 4L, "Clarinetto"));
        responses(response("member-a", CalendarEventAvailability.Availability.AVAILABLE), response("member-b", CalendarEventAvailability.Availability.AVAILABLE));

        View result = service.get(42L);

        assertThat(result.evaluation().preparationStatus()).isEqualTo(PreparationStatus.READY);
        assertThat(result.evaluation().infoCount()).isEqualTo(1);
        Issue issue = issue(result, "INSTRUMENT_NOT_COVERED");
        assertThat(issue.severity()).isEqualTo(Severity.INFO);
        assertThat(issue.relatedId()).isEqualTo(4L);
        assertThat(issue.details().get(0).message()).isEqualTo("1 brani su 1 senza una parte pronta · 1 disponibili").doesNotContain("member-b");
    }

    @Test
    void issueDetailsAreCappedButCounted() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        givenPlan(plan);
        program(IntStream.range(0, 25).mapToObj(i -> entry(track(100L + i, "Brano " + i, StateEnum.DRAFT), i)).toArray(CalendarEventProgramEntry[]::new));

        View result = service.get(42L);

        Issue issue = issue(result, "PROGRAM_MISSING");
        assertThat(issue.details()).hasSize(MAX_ISSUE_DETAILS);
        assertThat(issue.detailCount()).isEqualTo(25);
        assertThat(issue.relatedId()).isNull();
    }

    @Test
    void deletedTrackKeepsItsSavedNameAndOffersNoRoute() {
        CalendarEventPreparation plan = plan();
        plan.setProgramRequired(true);
        givenPlan(plan);
        Tracks track = track(7L, "Nuovo nome", StateEnum.COMPLETE);
        track.setDeleted(true);
        CalendarEventProgramEntry entry = entry(track, 0);
        entry.setTrackNameSnapshot("Marcia");
        program(entry);

        View result = service.get(42L);

        ProgramEntry row = result.program().get(0);
        assertThat(row.trackName()).isEqualTo("Marcia");
        assertThat(row.trackAvailable()).isFalse();
        assertThat(row.savedTrackName()).isNull();
        Issue issue = issue(result, "PROGRAM_MISSING");
        assertThat(issue.relatedId()).isEqualTo(7L);
        assertThat(issue.details().get(0).reason()).isEqualTo("TRACK_DELETED");
        assertThat(issue.details().get(0).action()).isNull();
    }

    @Test
    void renamedTrackShowsTheNameItWasSavedWith() {
        CalendarEventPreparation plan = plan();
        givenPlan(plan);
        CalendarEventProgramEntry entry = entry(track(7L, "Marcia nuova", StateEnum.COMPLETE), 0);
        entry.setTrackNameSnapshot("Marcia");
        program(entry);

        ProgramEntry row = service.get(42L).program().get(0);

        assertThat(row.trackName()).isEqualTo("Marcia nuova");
        assertThat(row.savedTrackName()).isEqualTo("Marcia");
    }

    @Test
    void evaluationsAreMeasuredWithClosedTags() {
        givenPlan(plan());

        service.get(42L);

        assertThat(registry.counter("taurus.event_preparation.evaluation", "status", "ready", "closure", "not_required", "phase", "preparation").count()).isEqualTo(1);
        assertThat(registry.timer("taurus.event_preparation.evaluation.duration", "view", "admin").count()).isEqualTo(1);
    }

    @Test
    void scheduledEvaluationsAreTimedButNotCountedAsShown() {
        CalendarEventPreparation plan = plan();
        givenPlan(plan);
        when(preparations.findDashboardCandidates(any(), any())).thenReturn(List.of(plan));

        service.scheduledEntries(ZonedDateTime.now().minusDays(1), ZonedDateTime.now().plusDays(1));

        assertThat(registry.find("taurus.event_preparation.evaluation").counters()).isEmpty();
        assertThat(registry.timer("taurus.event_preparation.evaluation.duration", "view", "scheduler").count()).isEqualTo(1);
    }

    private void givenPlan(CalendarEventPreparation plan) {
        when(preparations.findByEvent_IdAndDeletedFalse(42L)).thenReturn(Optional.of(plan));
    }

    private void endEvent() {
        event.setStartDate(Date.from(Instant.now().minusSeconds(7200)));
        event.setEndDate(Date.from(Instant.now().minusSeconds(3600)));
    }

    private CalendarEventPreparation plan() {
        CalendarEventPreparation plan = new CalendarEventPreparation();
        plan.setEvent(event);
        plan.setProfile(PreparationProfile.OTHER);
        plan.setAvailabilityDeadlineMinutes(1440);
        plan.setMaterialsDeadlineMinutes(180);
        return plan;
    }

    private void participants(Object[]... rows) {
        when(preparations.findParticipants(any())).thenReturn(Arrays.asList(rows));
    }

    private void responses(Object[]... rows) {
        when(preparations.findResponses(any())).thenReturn(Arrays.asList(rows));
    }

    private void scores(Object[]... rows) {
        when(preparations.findScores(any(), any())).thenReturn(Arrays.asList(rows));
    }

    private void program(CalendarEventProgramEntry... entries) {
        when(programs.findCurrentByEventIds(any())).thenReturn(List.of(entries));
    }

    private void materialRows(CalendarEventMaterial row, long unsafeIssues) {
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[]{row, unsafeIssues});
        when(materials.findCurrentByEventIds(any(), any(), any())).thenReturn(rows);
    }

    private static Object[] participant(String keycloakId, RoleEnum role, Long instrumentId, String instrumentName) {
        return new Object[]{keycloakId, role, instrumentId, instrumentName};
    }

    private static Object[] response(String keycloakId, CalendarEventAvailability.Availability answer) {
        return new Object[]{42L, keycloakId, answer};
    }

    private static Object[] score(Long trackId, Long scoreId, String description, boolean needsReview, Long instrumentId, String instrumentName, Long mediaId,
                                  String fileName) {
        return new Object[]{trackId, scoreId, description, needsReview, instrumentId, instrumentName, mediaId, fileName, null, mediaId == null ? 0 : 1};
    }

    /** A part with a current version: written or derived, it has pages only once it is engraved. */
    private static Object[] versionedScore(Long trackId, Long scoreId, String description, Long instrumentId, String instrumentName, int pages) {
        return new Object[]{trackId, scoreId, description, false, instrumentId, instrumentName, null, null, 90L + scoreId, pages};
    }

    private CalendarEventProgramEntry entry(Tracks track, int order) {
        CalendarEventProgramEntry entry = new CalendarEventProgramEntry();
        entry.setId(1000L + order);
        entry.setEvent(event);
        entry.setTrack(track);
        entry.setTrackNameSnapshot(track.getName());
        entry.setDisplayOrder(order);
        return entry;
    }

    private static Tracks track(Long id, String name, StateEnum state) {
        Tracks track = new Tracks();
        track.setId(id);
        track.setName(name);
        track.setState(state);
        track.setDeleted(false);
        return track;
    }

    private CalendarEventMaterial material(Long id, InventoryItem item, InventoryAssignment assignment, int quantity) {
        CalendarEventMaterial material = new CalendarEventMaterial();
        material.setId(id);
        material.setEvent(event);
        material.setItem(item);
        material.setAssignment(assignment);
        material.setRequiredQuantity(quantity);
        return material;
    }

    private static InventoryItem item(Long id, String number, String name, InventoryCondition condition) {
        InventoryItem item = new InventoryItem();
        item.setId(id);
        item.setInventoryNumber(number);
        item.setName(name);
        item.setConditionStatus(condition);
        return item;
    }

    private static InventoryAssignment assignment(Long id, InventoryItem item, String keycloakId, int assigned, int returned, InventoryAssignmentStatus status) {
        InventoryAssignment assignment = new InventoryAssignment();
        assignment.setId(id);
        assignment.setItem(item);
        assignment.setUserKeycloakId(keycloakId);
        assignment.setUserName(keycloakId);
        assignment.setUserLastName("Rossi");
        assignment.setAssignedQuantity(assigned);
        assignment.setReturnedQuantity(returned);
        assignment.setStatus(status);
        return assignment;
    }

    private FinancialMovement movement(FinancialDirection direction, String amount, boolean reconciled) {
        FinancialMovement movement = new FinancialMovement();
        movement.setId(77L);
        movement.setEvent(event);
        movement.setDirection(direction);
        movement.setAmount(new BigDecimal(amount));
        movement.setBookingDate(LocalDate.now(ZoneId.systemDefault()));
        movement.setReconciled(reconciled);
        return movement;
    }

    private static Issue issue(View view, String code) {
        return view.evaluation().issues().stream().filter(value -> value.code().equals(code)).findFirst().orElseThrow();
    }

    @SuppressWarnings("unchecked")
    private static CalendarEventProgramEntry lastSaved(EventProgramEntryRepository programs) {
        ArgumentCaptor<List<CalendarEventProgramEntry>> saved = ArgumentCaptor.forClass(List.class);
        verify(programs, atLeastOnce()).saveAll(saved.capture());
        List<CalendarEventProgramEntry> last = saved.getAllValues().get(saved.getAllValues().size() - 1);
        return last.get(0);
    }

    private static Users user(String keycloakId) {
        Users user = new Users();
        user.setKeycloakId(keycloakId);
        user.setActive(true);
        return user;
    }

    private static CalendarEventAvailability availability(Users user, CalendarEventAvailability.Availability value) {
        CalendarEventAvailability availability = new CalendarEventAvailability();
        availability.setUser(user);
        availability.setAvailability(value);
        availability.setResponseDate(new Date());
        return availability;
    }

    private static JwtAuthenticationToken authentication(String subject, String... authorities) {
        return named(subject, subject, authorities);
    }

    private static JwtAuthenticationToken named(String subject, String principalName, String... authorities) {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject(subject).issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, Arrays.stream(authorities).map(SimpleGrantedAuthority::new).toList(), principalName);
    }
}
