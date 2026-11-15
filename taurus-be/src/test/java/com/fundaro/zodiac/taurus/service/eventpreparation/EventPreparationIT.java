package com.fundaro.zodiac.taurus.service.eventpreparation;

import static com.fundaro.zodiac.taurus.service.dto.eventpreparation.EventPreparationDtos.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.fundaro.zodiac.taurus.IntegrationTest;
import com.fundaro.zodiac.taurus.domain.Tenants;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.domain.eventpreparation.PreparationProfile;
import com.fundaro.zodiac.taurus.domain.finance.FinancialAccountType;
import com.fundaro.zodiac.taurus.domain.finance.FinancialDirection;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryAssignment;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryAssignmentStatus;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryCondition;
import com.fundaro.zodiac.taurus.multitenancy.TenantContext;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.TenantsRepository;
import com.fundaro.zodiac.taurus.repository.inventory.InventoryAssignmentRepository;
import com.fundaro.zodiac.taurus.repository.inventory.InventoryItemRepository;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.OperationalDashboardService;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import com.fundaro.zodiac.taurus.service.dto.finance.FinanceDtos.AccountRequest;
import com.fundaro.zodiac.taurus.service.dto.finance.FinanceDtos.MovementRequest;
import com.fundaro.zodiac.taurus.service.dto.inventory.InventoryItemDTO;
import com.fundaro.zodiac.taurus.service.dto.inventory.InventoryItemRequest;
import com.fundaro.zodiac.taurus.service.impl.FinanceService;
import com.fundaro.zodiac.taurus.service.impl.InventoryService;
import com.fundaro.zodiac.taurus.test.DockerRequirement;
import com.fundaro.zodiac.taurus.test.RecordingStatementInspector;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.stream.IntStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.TestPropertySource;

/**
 * La preparazione evento su PostgreSQL vero: le colonne della migrazione, le versioni di programma e materiali che
 * respingono un salvataggio concorrente, l'isolamento fra due tenant, il numero fisso di query della valutazione per
 * la dashboard qualunque sia il numero di eventi e gli obiettivi di prestazione con 100 brani, 1.000 utenti e 100
 * materiali. Le proprietà e i mock sono quelli di {@code OperationalDashboardIT}, così i due test condividono il
 * contesto Spring e il registratore delle query.
 */
@IntegrationTest
@TestPropertySource(
    properties = {
        "application.base-path=D:/data",
        "spring.liquibase.contexts=test",
        "spring.datasource.hikari.maximum-pool-size=8",
        "spring.datasource.hikari.minimum-idle=2",
        "spring.security.oauth2.client.registration.oidc.client-id=test",
        "spring.security.oauth2.client.registration.oidc.client-secret=test",
        "application.dashboard.enabled=true",
        "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.fundaro.zodiac.taurus.test.RecordingStatementInspector",
    }
)
// Ogni test prepara uno o due schemi tenant con Liquibase: il limite di progetto di 15 secondi non basta.
@Timeout(value = 2, unit = TimeUnit.MINUTES)
class EventPreparationIT {

    private static final Logger LOG = LoggerFactory.getLogger(EventPreparationIT.class);
    private static final Set<TenantFeature> ALL_FEATURES = Set.of(
        TenantFeature.EVENT_PREPARATION, TenantFeature.FINANCE, TenantFeature.INVENTORY, TenantFeature.INVENTORY_QR
    );

    @MockitoBean
    ClientRegistrationRepository clientRegistrationRepository;
    @MockitoBean
    JwtDecoder jwtDecoder;
    @MockitoBean
    TenantFeatureService tenantFeatureService;

    @Autowired
    TenantSchemaProvisioningService provisioningService;
    @Autowired
    TenantTransactionExecutor transactionExecutor;
    @Autowired
    TenantsRepository tenantsRegistry;
    @Autowired
    EventPreparationService preparationService;
    @Autowired
    OperationalDashboardService dashboardService;
    @Autowired
    FinanceService financeService;
    @Autowired
    InventoryService inventoryService;
    @Autowired
    InventoryItemRepository itemRepository;
    @Autowired
    InventoryAssignmentRepository assignmentRepository;
    @Autowired
    JdbcTemplate jdbcTemplate;
    @PersistenceContext
    EntityManager entityManager;

    private final String run = UUID.randomUUID().toString().substring(0, 8);
    private final List<String> tenants = new ArrayList<>();
    private final Set<String> identityPrefixes = new LinkedHashSet<>();

    @BeforeAll
    static void requireDocker() {
        DockerRequirement.required();
    }

    @AfterEach
    @Timeout(value = 2, unit = TimeUnit.MINUTES)
    void dropTenantsAndIdentities() {
        try {
            for (String tenant : tenants) provisioningService.dropSchema(tenant);
        } finally {
            for (String tenant : tenants) tenantsRegistry.findByCodeAndDeletedFalse(tenant).ifPresent(tenantsRegistry::delete);
            // Le identità vivono nello schema public, condiviso: si tolgono dopo gli schemi che le referenziano.
            for (String prefix : identityPrefixes) jdbcTemplate.update("DELETE FROM public.user_identity WHERE keycloak_id LIKE ?", prefix + "%");
        }
    }

    @Test
    void migrationAddsVersionsEncoreSavedNamesAndTheReasonWithTheirDefaults() {
        String tenant = tenant("prep-schema");

        List<?> columns = transactionExecutor.execute(tenant, () -> entityManager.createNativeQuery(
            "SELECT table_name || '.' || column_name || ':' || coalesce(column_default, '') || ':' || is_nullable FROM information_schema.columns"
                + " WHERE table_schema = current_schema() AND column_name IN"
                + " ('program_version', 'materials_version', 'no_movements_confirmation_reason', 'encore', 'track_name_snapshot')"
                + " ORDER BY table_name, column_name"
        ).getResultList());

        assertThat(columns).map(String::valueOf).containsExactly(
            "calendar_event_preparation.materials_version:0:NO",
            "calendar_event_preparation.no_movements_confirmation_reason::YES",
            "calendar_event_preparation.program_version:0:NO",
            "calendar_event_program_entry.encore:false:NO",
            "calendar_event_program_entry.track_name_snapshot::YES"
        );
    }

    @Test
    void versionsRejectAStaleSaveWithoutTouchingTheConfiguration() {
        enableFeatures(ALL_FEATURES);
        String tenant = tenant("prep-version");
        JwtAuthenticationToken admin = token(tenant, users(tenant, "admin", 1, "ROLE_ADMIN", null).get(0), AuthoritiesConstants.ADMIN);
        Long eventId = createEvent(tenant, "Concerto", "COMPLETE", 48);
        Long trackId = tracks(tenant, "Brano", 1, instrument(tenant, "Tromba")).get(0);
        Long itemId = items(tenant, admin, 1).get(0);

        View configured = call(tenant, () -> preparationService.configure(eventId, configuration(0), admin));
        View program = call(tenant, () -> preparationService.replaceProgram(eventId, new ProgramRequest(List.of(new ProgramEntryRequest(trackId, true, 300, null)), configured.programVersion()), admin));
        View materials = call(tenant, () -> preparationService.replaceMaterials(eventId, new MaterialsRequest(List.of(new MaterialRequest(itemId, null, 1, null)), configured.materialsVersion()), admin));

        assertThat(program.programVersion()).isEqualTo(configured.programVersion() + 1);
        assertThat(program.program()).singleElement().satisfies(entry -> {
            assertThat(entry.encore()).isTrue();
            assertThat(entry.trackName()).isEqualTo("Brano 1");
            assertThat(entry.scores()).singleElement().satisfies(score -> assertThat(score.files()).hasSize(1));
        });
        assertThat(materials.materialsVersion()).isEqualTo(configured.materialsVersion() + 1);
        assertThat(materials.materials()).singleElement().satisfies(row -> assertThat(row.inventoryNumber()).isEqualTo("PREP-1"));
        assertThatThrownBy(() -> call(tenant, () -> preparationService.replaceProgram(eventId, new ProgramRequest(List.of(), configured.programVersion()), admin)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        assertThatThrownBy(() -> call(tenant, () -> preparationService.replaceMaterials(eventId, new MaterialsRequest(List.of(), configured.materialsVersion()), admin)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(409));

        // The rejected saves changed nothing, and the two saved ones did not move the version of the configuration.
        View current = call(tenant, () -> preparationService.get(eventId));
        assertThat(current.program()).hasSize(1);
        assertThat(current.materials()).hasSize(1);
        assertThat(current.configuration().version()).isEqualTo(configured.configuration().version());
        View reconfigured = call(tenant, () -> preparationService.configure(eventId, configuration(current.configuration().version()), admin));
        assertThat(reconfigured.programVersion()).isEqualTo(current.programVersion());
    }

    @Test
    void aWrittenPartWithoutPagesIsToEngrave() {
        enableFeatures(ALL_FEATURES);
        String tenant = tenant("prep-engrave");
        JwtAuthenticationToken admin = token(tenant, users(tenant, "admin", 1, "ROLE_ADMIN", null).get(0), AuthoritiesConstants.ADMIN);
        Long instrument = instrument(tenant, "Tromba");
        Long trackId = tracks(tenant, "Marcia", 1, instrument).get(0);
        // A part written in the editor: a version saved as MusicXML, no pages until it is engraved.
        sql(tenant, "INSERT INTO sheet_music (track_id, description, display_order) VALUES (" + trackId + ", 'Parte scritta', 1)");
        Long written = id(tenant, "SELECT MAX(id) FROM sheet_music");
        sql(tenant, "INSERT INTO sheet_music_instrument (sheet_music_id, instrument_id, display_order) VALUES (" + written + ", " + instrument + ", 0)");
        sql(tenant, "INSERT INTO media_asset (name, storage_key, original_filename, mime_type, file_extension, file_size, sha256, status, insert_by, edit_by)"
            + " VALUES ('Versione', 'scores/prep/written.musicxml', 'parte.musicxml', 'application/vnd.recordare.musicxml+xml', 'musicxml', 1, lpad('ab', 64, '0'), 'READY', 'test', 'test')");
        sql(tenant, "INSERT INTO score_version (sheet_music_id, version_number, origin, status, media_asset_id, measure_count, checks_json, insert_date, insert_by, edit_date, edit_by)"
            + " SELECT " + written + ", 1, 'WRITING', 'UNVERIFIED', MAX(id), 8, '[]', now(), 'test', now(), 'test' FROM media_asset");
        sql(tenant, "UPDATE sheet_music SET current_score_version_id = (SELECT MAX(id) FROM score_version) WHERE id = " + written);
        Long eventId = createEvent(tenant, "Sfilata", "COMPLETE", 48);
        View configured = call(tenant, () -> preparationService.configure(eventId, configuration(0), admin));
        call(tenant, () -> preparationService.replaceProgram(eventId, new ProgramRequest(List.of(new ProgramEntryRequest(trackId, false, null, null)), configured.programVersion()), admin));

        View view = call(tenant, () -> preparationService.get(eventId));

        assertThat(view.program()).singleElement().satisfies(entry -> assertThat(entry.scores())
            .extracting(ProgramScore::description, ProgramScore::unengraved, ProgramScore::ready, ProgramScore::instrumentIds)
            .containsExactly(tuple("Parte", false, true, List.of(instrument)), tuple("Parte scritta", true, false, List.of(instrument))));
    }

    @Test
    void anotherTenantNeitherReadsNorUsesTheDataOfTheFirst() {
        enableFeatures(ALL_FEATURES);
        String first = tenant("prep-first");
        String second = tenant("prep-second");
        JwtAuthenticationToken firstAdmin = token(first, users(first, "admin-a", 1, "ROLE_ADMIN", null).get(0), AuthoritiesConstants.ADMIN);
        JwtAuthenticationToken secondAdmin = token(second, users(second, "admin-b", 1, "ROLE_ADMIN", null).get(0), AuthoritiesConstants.ADMIN);
        Long firstEvent = createEvent(first, "Concerto", "COMPLETE", 48);
        Long secondEvent = createEvent(second, "Concerto", "COMPLETE", 48);
        Long trackId = tracks(first, "Brano", 1, instrument(first, "Tromba")).get(0);
        View configured = call(first, () -> preparationService.configure(firstEvent, configuration(0), firstAdmin));
        call(first, () -> preparationService.replaceProgram(firstEvent, new ProgramRequest(List.of(new ProgramEntryRequest(trackId, false, null, null)), configured.programVersion()), firstAdmin));
        View secondConfigured = call(second, () -> preparationService.configure(secondEvent, configuration(0), secondAdmin));

        assertThat(secondConfigured.program()).isEmpty();
        assertThatThrownBy(() -> call(second, () -> preparationService.replaceProgram(secondEvent, new ProgramRequest(List.of(new ProgramEntryRequest(trackId, false, null, null)), secondConfigured.programVersion()), secondAdmin)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("eventPreparation.track.notFound"));
        assertThat(call(first, () -> preparationService.get(firstEvent)).program()).hasSize(1);
        assertThat(call(second, () -> preparationService.dashboardEntries(ZonedDateTime.now().minusDays(1), ZonedDateTime.now().plusDays(5))))
            .extracting(EventPreparationService.DashboardEntry::eventId).containsExactly(secondEvent);
    }

    @Test
    void dashboardEvaluatesAnyNumberOfEventsWithTheSameQueries() {
        enableFeatures(ALL_FEATURES);
        String tenant = tenant("prep-queries");
        String admin = users(tenant, "admin", 1, "ROLE_ADMIN", null).get(0);
        JwtAuthenticationToken adminToken = token(tenant, admin, AuthoritiesConstants.ADMIN);
        Long instrument = instrument(tenant, "Tromba");
        users(tenant, "member", 5, "ROLE_USER", instrument);
        List<Long> trackIds = tracks(tenant, "Brano", 3, instrument);
        List<Long> itemIds = items(tenant, adminToken, 3);
        Long account = transactionExecutor.execute(tenant, () -> financeService.createAccount(new AccountRequest("Cassa", null, FinancialAccountType.CASH, "EUR", null, null, 0, null, null, null), adminToken)).id();
        plannedEvents(tenant, adminToken, 2, trackIds, itemIds, account);
        ZonedDateTime from = ZonedDateTime.now().minusDays(30);
        ZonedDateTime to = ZonedDateTime.now().plusDays(31);

        List<String> few = statements(tenant, () -> preparationService.dashboardEntries(from, to));
        plannedEvents(tenant, adminToken, 13, trackIds, itemIds, account);
        List<String> many = statements(tenant, () -> preparationService.dashboardEntries(from, to));
        List<EventPreparationService.DashboardEntry> entries = call(tenant, () -> preparationService.dashboardEntries(from, to));
        LOG.info("event_preparation_dashboard statements={} events={}", many.size(), entries.size());

        assertThat(entries).hasSize(15);
        assertThat(entries).allSatisfy(entry -> assertThat(entry.issueCodes()).doesNotContain("PROGRAM_MISSING", "SCORE_NOT_READY"));
        assertThat(many).as("query della valutazione di 15 eventi").hasSize(few.size()).hasSizeLessThanOrEqualTo(8);

        // The whole operational dashboard: the preparation adds its fixed queries to the twelve of the other rows.
        enableFeatures(Set.of(TenantFeature.FINANCE, TenantFeature.INVENTORY, TenantFeature.INVENTORY_QR));
        List<String> withoutPreparation = statements(tenant, () -> dashboardService.getOperations(adminToken));
        enableFeatures(ALL_FEATURES);
        List<String> withPreparation = statements(tenant, () -> dashboardService.getOperations(adminToken));
        LOG.info("event_preparation_operational_dashboard without={} with={}", withoutPreparation.size(), withPreparation.size());
        assertThat(withoutPreparation).hasSizeLessThanOrEqualTo(12);
        assertThat(withPreparation.size() - withoutPreparation.size()).as("query aggiunte dalla preparazione").isLessThanOrEqualTo(8);
    }

    /**
     * Gli obiettivi della specifica: un evento con 100 brani in programma, 1.000 utenti con uno strumento e la loro
     * risposta, 100 materiali assegnati e il registro presenze. La vista amministrativa resta sotto 700 ms al 95°
     * percentile e quella personale sotto 400 ms.
     */
    @Test
    @Timeout(value = 10, unit = TimeUnit.MINUTES)
    void meetsThePerformanceTargetsOnALargeEvent() {
        enableFeatures(ALL_FEATURES);
        String tenant = tenant("prep-load");
        JwtAuthenticationToken admin = token(tenant, users(tenant, "admin", 1, "ROLE_ADMIN", null).get(0), AuthoritiesConstants.ADMIN);
        Long instrument = instrument(tenant, "Tromba");
        List<String> members = users(tenant, "member", 1000, "ROLE_USER", instrument);
        List<Long> trackIds = tracks(tenant, "Brano", MAX_ROWS, instrument);
        List<Long> itemIds = items(tenant, admin, MAX_ROWS);
        Long eventId = createEvent(tenant, "Festival", "COMPLETE", 72);
        sql(tenant, "INSERT INTO calendar_event_availability (event_id, user_id, availability, response_date)"
            + " SELECT " + eventId + ", id, 'AVAILABLE', now() FROM app_user WHERE keycloak_id LIKE '" + prefix("member") + "%'");
        View configured = call(tenant, () -> preparationService.configure(eventId, configuration(0), admin));
        call(tenant, () -> preparationService.replaceProgram(eventId,
            new ProgramRequest(trackIds.stream().map(id -> new ProgramEntryRequest(id, false, 180, null)).toList(), configured.programVersion()), admin));
        call(tenant, () -> preparationService.replaceMaterials(eventId,
            new MaterialsRequest(itemIds.stream().map(id -> new MaterialRequest(id, assignment(tenant, id, members.get(0)), 1, null)).toList(), configured.materialsVersion()), admin));
        JwtAuthenticationToken member = token(tenant, members.get(0), AuthoritiesConstants.USER);

        long adminP95 = p95(() -> call(tenant, () -> preparationService.get(eventId)));
        long personalP95 = p95(() -> call(tenant, () -> preparationService.getPersonal(eventId, member, false)));
        View view = call(tenant, () -> preparationService.get(eventId));
        LOG.info("event_preparation_load adminP95Ms={} personalP95Ms={} issues={}", adminP95, personalP95, view.evaluation().issueCount());

        assertThat(view.program()).hasSize(MAX_ROWS);
        assertThat(view.materials()).hasSize(MAX_ROWS);
        assertThat(view.availability().available()).isEqualTo(1000);
        assertThat(view.evaluation().issues()).hasSizeLessThanOrEqualTo(MAX_ISSUES);
        assertThat(view.evaluation().issues()).allSatisfy(issue -> assertThat(issue.details()).hasSizeLessThanOrEqualTo(MAX_ISSUE_DETAILS));
        assertThat(adminP95).as("p95 della vista amministrativa in millisecondi").isLessThan(700);
        assertThat(personalP95).as("p95 della vista personale in millisecondi").isLessThan(400);
    }

    // ---------------------------------------------------------------------------------------------------------------

    private void plannedEvents(String tenant, JwtAuthenticationToken admin, int count, List<Long> trackIds, List<Long> itemIds, Long account) {
        String member = prefix("member") + "1";
        for (int index = 0; index < count; index++) {
            Long eventId = createEvent(tenant, "Evento " + index, "COMPLETE", 24 + index);
            sql(tenant, "INSERT INTO calendar_event_availability (event_id, user_id, availability, response_date)"
                + " SELECT " + eventId + ", id, 'AVAILABLE', now() FROM app_user WHERE keycloak_id LIKE '" + prefix("member") + "%'");
            sql(tenant, "INSERT INTO calendar_event_presence (event_id, user_id, display_order)"
                + " SELECT " + eventId + ", id, row_number() OVER (ORDER BY id) - 1 FROM app_user WHERE keycloak_id LIKE '" + prefix("member") + "%'");
            View configured = call(tenant, () -> preparationService.configure(eventId, configuration(0), admin));
            call(tenant, () -> preparationService.replaceProgram(eventId,
                new ProgramRequest(trackIds.stream().map(id -> new ProgramEntryRequest(id, false, 60, null)).toList(), configured.programVersion()), admin));
            Long itemId = itemIds.get(index % itemIds.size());
            call(tenant, () -> preparationService.replaceMaterials(eventId,
                new MaterialsRequest(List.of(new MaterialRequest(itemId, assignment(tenant, itemId, member), 1, null)), configured.materialsVersion()), admin));
            transactionExecutor.execute(tenant, () -> financeService.createMovement(new MovementRequest(account, null, eventId, FinancialDirection.INCOME, LocalDate.now(),
                null, new BigDecimal("10.00"), "Compenso", null, null, null, null, null), admin));
        }
        sql(tenant, "INSERT INTO inventory_issue_report (item_id, reported_quantity, severity, description, status, insert_date, insert_by, edit_date, edit_by)"
            + " VALUES (" + itemIds.get(0) + ", 1, 'UNSAFE', 'Leggio rotto', 'OPEN', now(), 'test', now(), 'test')");
    }

    private static Configuration configuration(long version) {
        return new Configuration(PreparationProfile.PERFORMANCE, true, true, true, true, 1, 1440, true, 180, true, true, true, version);
    }

    private Long assignment(String tenant, Long itemId, String keycloakId) {
        return transactionExecutor.execute(tenant, () -> {
            InventoryAssignment assignment = new InventoryAssignment();
            assignment.initializeAudit("test");
            assignment.setItem(itemRepository.findById(itemId).orElseThrow());
            assignment.setUserIndex(((Number) entityManager.createNativeQuery("SELECT id FROM app_user WHERE keycloak_id = :subject")
                .setParameter("subject", keycloakId).getSingleResult()).longValue());
            assignment.setUserKeycloakId(keycloakId);
            assignment.setUserName("Nome");
            assignment.setUserLastName("Cognome");
            assignment.setAssignedQuantity(1);
            assignment.setReturnedQuantity(0);
            assignment.setAssignedAt(ZonedDateTime.now().minusDays(1));
            assignment.setStatus(InventoryAssignmentStatus.ACTIVE);
            assignment.setCurrentRevision(0);
            return assignmentRepository.save(assignment).getId();
        });
    }

    private List<Long> items(String tenant, JwtAuthenticationToken admin, int count) {
        return transactionExecutor.execute(tenant, () -> IntStream.rangeClosed(1, count).mapToObj(index -> {
            InventoryItemDTO item = inventoryService.createItem(
                new InventoryItemRequest("PREP-" + index, "Leggio " + index, null, 5, null, null, InventoryCondition.GOOD, null, null, null, null), admin);
            return item.id();
        }).toList());
    }

    private Long instrument(String tenant, String name) {
        sql(tenant, "INSERT INTO instrument (name, insert_by, edit_by) VALUES ('" + name + "', 'test', 'test')");
        return id(tenant, "SELECT MAX(id) FROM instrument");
    }

    /** Tracks with one part for the instrument and one ready file each, in bulk. */
    private List<Long> tracks(String tenant, String name, int count, Long instrument) {
        sql(tenant, "INSERT INTO track (name, state, insert_by, edit_by) SELECT '" + name + " ' || g, 'COMPLETE', 'test', 'test' FROM generate_series(1, " + count + ") g");
        sql(tenant, "INSERT INTO sheet_music (track_id, description, display_order) SELECT id, 'Parte', 0 FROM track t"
            + " WHERE NOT EXISTS (SELECT 1 FROM sheet_music s WHERE s.track_id = t.id)");
        sql(tenant, "INSERT INTO sheet_music_instrument (sheet_music_id, instrument_id, display_order) SELECT id, " + instrument + ", 0 FROM sheet_music s"
            + " WHERE NOT EXISTS (SELECT 1 FROM sheet_music_instrument i WHERE i.sheet_music_id = s.id)");
        sql(tenant, "INSERT INTO media_asset (name, storage_key, original_filename, mime_type, file_extension, file_size, sha256, status, insert_by, edit_by)"
            + " SELECT 'Parte ' || s.id, 'scores/prep/' || s.id || '.pdf', 'parte-' || s.id || '.pdf', 'application/pdf', 'pdf', 1, lpad(to_hex(s.id), 64, '0'), 'READY', 'test', 'test'"
            + " FROM sheet_music s WHERE NOT EXISTS (SELECT 1 FROM sheet_music_media m WHERE m.sheet_music_id = s.id)");
        sql(tenant, "INSERT INTO sheet_music_media (sheet_music_id, media_asset_id, display_order) SELECT s.id, m.id, 0 FROM sheet_music s"
            + " JOIN media_asset m ON m.storage_key = 'scores/prep/' || s.id || '.pdf' WHERE NOT EXISTS (SELECT 1 FROM sheet_music_media x WHERE x.sheet_music_id = s.id)");
        return transactionExecutor.execute(tenant, () -> entityManager.createNativeQuery("SELECT id FROM track WHERE name LIKE :name ORDER BY id")
            .setParameter("name", name + " %").getResultList().stream().map(value -> ((Number) value).longValue()).toList());
    }

    /** Active users with one role and, when given, one instrument, in bulk; the identities are removed after the test. */
    private List<String> users(String tenant, String kind, int count, String role, Long instrument) {
        String prefix = prefix(kind);
        identityPrefixes.add(prefix);
        sql(tenant, "INSERT INTO public.user_identity (keycloak_id, created_at) SELECT '" + prefix + "' || g, CURRENT_TIMESTAMP FROM generate_series(1, " + count + ") g"
            + " ON CONFLICT DO NOTHING");
        sql(tenant, "INSERT INTO app_user (user_identity_id, keycloak_id, name, last_name, active) SELECT id, keycloak_id, 'Socio', keycloak_id, TRUE"
            + " FROM public.user_identity WHERE keycloak_id LIKE '" + prefix + "%'");
        sql(tenant, "INSERT INTO app_user_role (user_id, role) SELECT id, '" + role + "' FROM app_user WHERE keycloak_id LIKE '" + prefix + "%'");
        if (instrument != null)
            sql(tenant, "INSERT INTO user_instrument (user_id, instrument_id, display_order) SELECT id, " + instrument + ", 0 FROM app_user WHERE keycloak_id LIKE '" + prefix + "%'");
        return IntStream.rangeClosed(1, count).mapToObj(index -> prefix + index).toList();
    }

    private String prefix(String kind) {
        return "prep-" + run + "-" + kind + "-";
    }

    private Long createEvent(String tenant, String name, String state, int hoursFromNow) {
        sql(tenant, "INSERT INTO calendar_event (name, state, location, start_date, end_date, deleted, insert_by, insert_date, edit_by, edit_date)"
            + " VALUES ('" + name + "', '" + state + "', 'Piazza', now() + make_interval(hours => " + hoursFromNow + "), now() + make_interval(hours => " + (hoursFromNow + 2) + "),"
            + " FALSE, 'test', now(), 'test', now())");
        return id(tenant, "SELECT MAX(id) FROM calendar_event");
    }

    private String tenant(String prefix) {
        String code = prefix + "-" + run;
        Date now = new Date();
        Tenants tenant = new Tenants();
        tenant.setName(code);
        tenant.setCode(code);
        tenant.setActive(true);
        tenant.setFinanceEnabled(true);
        tenant.setCalendarEnabled(true);
        tenant.setInventoryEnabled(true);
        tenant.setTimeZone("Europe/Rome");
        tenant.setDeleted(false);
        tenant.setInsertBy("test");
        tenant.setInsertDate(now);
        tenant.setEditBy("test");
        tenant.setEditDate(now);
        tenant.setEntityVersion(0L);
        tenantsRegistry.save(tenant);
        tenants.add(code);
        provisioningService.provision(code);
        return code;
    }

    private void enableFeatures(Set<TenantFeature> enabled) {
        when(tenantFeatureService.isEnabled(any(TenantFeature.class))).thenAnswer(invocation -> {
            // The calendar is the base of these scenarios: it stays on unless a test says otherwise.
            TenantFeature feature = invocation.getArgument(0, TenantFeature.class);
            return feature == TenantFeature.CALENDAR || enabled.contains(feature);
        });
    }

    private void sql(String tenant, String statement) {
        transactionExecutor.execute(tenant, () -> entityManager.createNativeQuery(statement).executeUpdate());
    }

    private Long id(String tenant, String query) {
        return transactionExecutor.execute(tenant, () -> ((Number) entityManager.createNativeQuery(query).getSingleResult()).longValue());
    }

    private static <T> T call(String tenant, Supplier<T> action) {
        return TenantContext.call(tenant, action);
    }

    private static List<String> statements(String tenant, Supplier<?> action) {
        RecordingStatementInspector.start();
        try {
            TenantContext.call(tenant, action);
        } catch (RuntimeException exception) {
            RecordingStatementInspector.stop();
            throw exception;
        }
        return RecordingStatementInspector.stop();
    }

    private static long p95(Runnable request) {
        for (int warmUp = 0; warmUp < 5; warmUp++) request.run();
        List<Long> durations = new ArrayList<>();
        for (int index = 0; index < 20; index++) {
            long startedAt = System.nanoTime();
            request.run();
            durations.add((System.nanoTime() - startedAt) / 1_000_000);
        }
        List<Long> sorted = durations.stream().sorted().toList();
        return sorted.get((int) Math.ceil(0.95 * sorted.size()) - 1);
    }

    private static JwtAuthenticationToken token(String tenant, String subject, String... authorities) {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject(subject).claim("tenant", tenant)
            .claim("given_name", "Anna").claim("family_name", "Neri")
            .issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, Arrays.stream(authorities).map(SimpleGrantedAuthority::new).toList(), subject);
    }
}
