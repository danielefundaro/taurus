package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.IntegrationTest;
import com.fundaro.zodiac.taurus.domain.CommonFieldsOpenSearch;
import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.Media;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.criteria.InstrumentsCriteria;
import com.fundaro.zodiac.taurus.domain.enumeration.MediaAssetStatus;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.scoreplayback.RecognitionEngine;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreErrorReportClosure;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreErrorReportStatus;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaNameResolver;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.InstrumentsService;
import com.fundaro.zodiac.taurus.service.dto.InstrumentsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.Availability;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.CorrectionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ErrorReportDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ErrorReportRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PartPlaybackDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreEditorDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.TrackPlaybackDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.TrackPlaybackSettingsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.PendingReviewsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.RecognitionReportDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.RecognitionReviewRequestDTO;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.TestPropertySource;
import tech.jhipster.service.filter.BooleanFilter;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

@IntegrationTest
@TestPropertySource(
    properties = {
        "application.base-path=target/score-playback-it-storage",
        "spring.liquibase.contexts=test",
        "spring.datasource.hikari.maximum-pool-size=4",
        "spring.datasource.hikari.minimum-idle=1",
        "spring.security.oauth2.client.registration.oidc.client-id=test",
        "spring.security.oauth2.client.registration.oidc.client-secret=test",
    }
)
class ScorePlaybackIT {

    private static final Logger LOG = LoggerFactory.getLogger(ScorePlaybackIT.class);
    private static final String EDIT_SESSION = "score-playback-it-editor";

    @MockitoBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    private final String tenantCode = "score-playback-it-" + UUID.randomUUID();
    private final String memberKey = "score-member-" + UUID.randomUUID();
    private final String otherMemberKey = "score-other-" + UUID.randomUUID();
    private final List<Long> identityIds = new ArrayList<>();

    @Autowired
    private TenantSchemaProvisioningService provisioningService;

    @Autowired
    private TenantSchemaNameResolver schemaNameResolver;

    @Autowired
    private TenantTransactionExecutor transactionExecutor;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ScoreVersionService versionService;

    @Autowired
    private ScorePlaybackService playbackService;

    @Autowired
    private ScoreErrorReportService reportService;

    @Autowired
    private InstrumentsService instrumentsService;

    @Autowired
    private ScoreRecognitionReviewService reviewService;

    @Autowired
    private MeterRegistry meterRegistry;

    private Catalog catalog;

    @BeforeEach
    void provisionTenant() {
        provisioningService.provision(tenantCode);
        catalog = createCatalog();
    }

    @AfterEach
    void dropTenant() {
        try {
            provisioningService.dropSchema(tenantCode);
        } finally {
            transactionExecutor.execute(
                TenantSchemaNameResolver.DEFAULT_SCHEMA,
                () -> identityIds.forEach(id -> jdbcTemplate.update("DELETE FROM public.user_identity WHERE id = ?", id))
            );
        }
    }

    @Test
    void theMigrationProposesPlaybackSettingsForThePredefinedInstruments() {
        String schema = schema();

        Map<String, Object> clarinet = jdbcTemplate.queryForMap(
            "SELECT transposition_semitones, sound_bank, sound_program, percussion_key FROM " + schema + ".instrument WHERE name = 'Clarinetto soprano 1°'"
        );
        Map<String, Object> drum = jdbcTemplate.queryForMap("SELECT sound_program, percussion_key FROM " + schema + ".instrument WHERE name = 'Tamburo'");
        Map<String, Object> bass = jdbcTemplate.queryForMap(
            "SELECT transposition_semitones, bass_clef_transposition_semitones, sound_program FROM " + schema + ".instrument WHERE name = 'Basso 1°'"
        );

        assertThat(((Number) clarinet.get("transposition_semitones")).intValue()).isEqualTo(-2);
        assertThat(((Number) clarinet.get("sound_bank")).intValue()).isZero();
        assertThat(((Number) clarinet.get("sound_program")).intValue()).isEqualTo(71);
        assertThat(clarinet.get("percussion_key")).isNull();
        assertThat(drum.get("sound_program")).isNull();
        assertThat(((Number) drum.get("percussion_key")).intValue()).isEqualTo(38);
        assertThat(((Number) bass.get("bass_clef_transposition_semitones")).intValue()).isZero();
        assertThat(jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM " + schema + ".instrument WHERE transposition_semitones IS NULL AND percussion_key IS NULL AND name <> 'Voce'",
            Long.class
        )).isZero();
    }

    @Test
    void anUploadBecomesTheCurrentVersionAndFollowsTheListeningRules() {
        ScoreVersionDTO version = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("tuba.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P1", false, archivist()
        ));

        assertThat(version.versionNumber()).isEqualTo(1);
        assertThat(version.status()).isEqualTo(ScoreVersionStatus.UNVERIFIED);
        assertThat(version.current()).isTrue();
        assertThat(version.sourcePartName()).isEqualTo("Tuba");
        assertThat(version.checks().measureCount()).isEqualTo(3);

        TrackPlaybackDTO forMember = transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), member(memberKey)));
        assertThat(part(forMember, catalog.ownPart())).satisfies(part -> {
            assertThat(part.availability()).isEqualTo(Availability.AVAILABLE);
            assertThat(part.ownPart()).isTrue();
            assertThat(part.sound().configured()).isTrue();
            assertThat(part.settings()).isNull();
        });
        assertThat(part(forMember, catalog.otherPart()).availability()).isEqualTo(Availability.NOT_AVAILABLE);

        TrackPlaybackDTO forOtherMember = transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), member(otherMemberKey)));
        assertThat(part(forOtherMember, catalog.ownPart())).satisfies(part -> {
            assertThat(part.availability()).isEqualTo(Availability.AVAILABLE);
            assertThat(part.ownPart()).isFalse();
        });

        byte[] xml = transactionExecutor.execute(tenantCode, () -> playbackService.playbackFile(catalog.completeTrack(), catalog.ownPart(), member(otherMemberKey)));
        assertThat(new String(xml, StandardCharsets.UTF_8)).contains("score-partwise").contains("Tuba").doesNotContain("Clarinetto");

        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), external(memberKey))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.track.notFound"));
        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.draftTrack(), member(memberKey))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.track.notFound"));
    }

    @Test
    void changedPagesHideUnverifiedVersionsUntilApproval() {
        ScoreVersionDTO version = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("tuba.mxl", MusicXmlDocumentsTest.TWO_PARTS), "P1", false, archivist()
        ));
        transactionExecutor.execute(tenantCode, () -> {
            SheetsMusic part = entityManager.find(SheetsMusic.class, catalog.ownPart());
            part.getMedia().add(persistMedia("added-page"));
            entityManager.flush();
        });

        assertThat(part(transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), member(memberKey))), catalog.ownPart()).availability())
            .isEqualTo(Availability.NOT_AVAILABLE);
        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> playbackService.playbackFile(catalog.completeTrack(), catalog.ownPart(), member(memberKey))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.playback.notAvailable"));
        PartPlaybackDTO forManager = part(transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), archivist())), catalog.ownPart());
        assertThat(forManager.availability()).isEqualTo(Availability.AVAILABLE);
        assertThat(forManager.version().pagesChanged()).isTrue();

        transactionExecutor.execute(tenantCode, () -> versionService.approve(catalog.completeTrack(), catalog.ownPart(), version.id(), archivist()));

        PartPlaybackDTO approved = part(transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), member(memberKey))), catalog.ownPart());
        assertThat(approved.availability()).isEqualTo(Availability.AVAILABLE);
        assertThat(approved.version().status()).isEqualTo(ScoreVersionStatus.APPROVED);
        assertThat(approved.version().pagesChanged()).isTrue();
    }

    @Test
    void aFileWithSeveralPartsNeedsTheChoiceOfThePart() {
        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("score.musicxml", MusicXmlDocumentsTest.TWO_PARTS), null, false, archivist()
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.upload.partRequired"));

        assertThat(transactionExecutor.execute(tenantCode, () -> versionService.inspect(
            catalog.completeTrack(), catalog.ownPart(), musicXml("score.musicxml", MusicXmlDocumentsTest.TWO_PARTS)
        ))).extracting(part -> part.id()).containsExactly("P1", "P2");

        ScoreVersionDTO second = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("score.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P2", true, archivist()
        ));
        assertThat(second.sourcePartName()).isEqualTo("Clarinetto");
        assertThat(second.status()).isEqualTo(ScoreVersionStatus.APPROVED);

        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), new MockMultipartFile("file", "score.pdf", "application/pdf", new byte[]{1}), null, false, archivist()
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.upload.unsupportedFormat"));
    }

    @Test
    void trackSettingsRequireTheCurrentTrackVersion() {
        TrackPlaybackDTO before = transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), archivist()));

        TrackPlaybackSettingsDTO saved = transactionExecutor.execute(tenantCode, () -> versionService.updateTrackSettings(
            catalog.completeTrack(), new TrackPlaybackSettingsDTO(50, catalog.ownPart(), before.version()), archivist()
        ));
        assertThat(saved.tempoBpm()).isEqualTo(50);
        assertThat(saved.referenceScoreId()).isEqualTo(catalog.ownPart());
        assertThat(saved.version()).isGreaterThan(before.version());

        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> versionService.updateTrackSettings(
            catalog.completeTrack(), new TrackPlaybackSettingsDTO(60, null, before.version()), archivist()
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.settings.versionConflict"));
        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> versionService.updateTrackSettings(
            catalog.completeTrack(), new TrackPlaybackSettingsDTO(10, null, saved.version()), archivist()
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.settings.invalid"));
    }

    @Test
    void aCorrectionBecomesTheCurrentVersionAndKeepsThePagesOfItsParent() {
        ScoreVersionDTO uploaded = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("tuba.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P1", false, archivist()
        ));
        ScoreEditorDTO editor = transactionExecutor.execute(tenantCode, () -> versionService.editor(catalog.completeTrack(), catalog.ownPart(), uploaded.id(), archivist()));
        assertThat(editor.musicXml()).contains("score-partwise").contains("Tuba");
        assertThat(editor.pages()).hasSize(1);
        assertThat(editor.layout()).isNull();

        transactionExecutor.execute(tenantCode, () -> {
            SheetsMusic part = entityManager.find(SheetsMusic.class, catalog.ownPart());
            part.getMedia().add(persistMedia("added-page"));
            entityManager.flush();
        });
        String corrected = editor.musicXml().replace("<step>D</step><octave>3</octave>", "<step>E</step><octave>3</octave>");
        ScoreVersionDTO correction = transactionExecutor.execute(tenantCode, () -> versionService.correct(
            catalog.completeTrack(), catalog.ownPart(), new CorrectionDTO(uploaded.id(), corrected, false, null, null, EDIT_SESSION, false), archivist()
        ));

        assertThat(correction.versionNumber()).isEqualTo(2);
        assertThat(correction.origin()).isEqualTo(ScoreVersionOrigin.CORRECTION);
        assertThat(correction.parentVersionId()).isEqualTo(uploaded.id());
        assertThat(correction.current()).isTrue();
        assertThat(correction.pagesChanged()).isTrue();
        byte[] played = transactionExecutor.execute(tenantCode, () -> playbackService.playbackFile(catalog.completeTrack(), catalog.ownPart(), archivist()));
        assertThat(new String(played, StandardCharsets.UTF_8)).contains("<step>E</step>");
        assertThat(part(transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), member(memberKey))), catalog.ownPart()).availability())
            .isEqualTo(Availability.NOT_AVAILABLE);
    }

    @Test
    void listenersReportErrorsThatTheApprovalOfAnotherVersionCloses() {
        ScoreVersionDTO uploaded = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("tuba.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P1", false, archivist()
        ));

        transactionExecutor.execute(tenantCode, () -> {
            reportService.report(catalog.completeTrack(), catalog.ownPart(), new ErrorReportRequestDTO(" 2 ", " Il Re dovrebbe essere un Mi "), member(memberKey));
            return null;
        });

        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> {
            reportService.report(catalog.completeTrack(), catalog.otherPart(), new ErrorReportRequestDTO(null, "Manca"), member(memberKey));
            return null;
        })).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.playback.notAvailable"));
        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> {
            reportService.report(catalog.completeTrack(), catalog.ownPart(), new ErrorReportRequestDTO(null, "   "), member(memberKey));
            return null;
        })).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.report.invalid"));
        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> {
            reportService.report(catalog.completeTrack(), catalog.ownPart(), new ErrorReportRequestDTO(null, "Errore"), external(memberKey));
            return null;
        })).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.track.notFound"));

        assertThat(part(transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), archivist())), catalog.ownPart()).openReports())
            .isEqualTo(1);
        assertThat(part(transactionExecutor.execute(tenantCode, () -> playbackService.overview(catalog.completeTrack(), member(memberKey))), catalog.ownPart()).openReports())
            .isZero();
        List<ErrorReportDTO> reports = transactionExecutor.execute(tenantCode, () -> reportService.list(catalog.completeTrack()));
        assertThat(reports).singleElement().satisfies(report -> {
            assertThat(report.scoreId()).isEqualTo(catalog.ownPart());
            assertThat(report.versionId()).isEqualTo(uploaded.id());
            assertThat(report.versionNumber()).isEqualTo(1);
            assertThat(report.measureNumber()).isEqualTo("2");
            assertThat(report.message()).isEqualTo("Il Re dovrebbe essere un Mi");
            assertThat(report.reportedBy()).isEqualTo("Socio");
            assertThat(report.status()).isEqualTo(ScoreErrorReportStatus.OPEN);
        });
        assertThat(jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM " + schema() + ".notification_outbox WHERE aggregate_type = 'SCORE_ERROR_REPORT'", Long.class
        )).isEqualTo(1);

        transactionExecutor.execute(tenantCode, () -> versionService.approve(catalog.completeTrack(), catalog.ownPart(), uploaded.id(), archivist()));
        assertThat(transactionExecutor.execute(tenantCode, () -> reportService.list(catalog.completeTrack())).get(0).status()).isEqualTo(ScoreErrorReportStatus.OPEN);

        String content = transactionExecutor.execute(tenantCode, () -> versionService.editor(catalog.completeTrack(), catalog.ownPart(), uploaded.id(), archivist())).musicXml();
        transactionExecutor.execute(tenantCode, () -> versionService.correct(
            catalog.completeTrack(), catalog.ownPart(), new CorrectionDTO(uploaded.id(), content, true, List.of(0, 1, 2), null, EDIT_SESSION, false), archivist()
        ));

        assertThat(transactionExecutor.execute(tenantCode, () -> reportService.list(catalog.completeTrack()))).singleElement().satisfies(report -> {
            assertThat(report.status()).isEqualTo(ScoreErrorReportStatus.CLOSED);
            assertThat(report.closure()).isEqualTo(ScoreErrorReportClosure.APPROVAL);
            assertThat(report.closedAt()).isNotNull();
        });
    }

    @Test
    void archivistsCloseReportsAndListenersHaveALimitOfOpenReports() {
        transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("tuba.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P1", true, archivist()
        ));
        for (int index = 0; index < ScoreErrorReportService.MAX_OPEN_PER_USER; index++) {
            int measure = index + 1;
            transactionExecutor.execute(tenantCode, () -> {
                reportService.report(catalog.completeTrack(), catalog.ownPart(), new ErrorReportRequestDTO(String.valueOf(measure), "Errore"), member(otherMemberKey));
                return null;
            });
        }
        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> {
            reportService.report(catalog.completeTrack(), catalog.ownPart(), new ErrorReportRequestDTO(null, "Ancora"), member(otherMemberKey));
            return null;
        })).isInstanceOfSatisfying(RequestAlertException.class, error -> {
            assertThat(error.getErrorKey()).isEqualTo("scorePlayback.report.limitReached");
            assertThat(error.getArgs().values()).containsEntry("maxOpen", ScoreErrorReportService.MAX_OPEN_PER_USER);
        });

        transactionExecutor.execute(tenantCode, () -> {
            reportService.report(catalog.completeTrack(), catalog.ownPart(), new ErrorReportRequestDTO(null, "Dal super amministratore"), namedArchivist());
            return null;
        });
        assertThat(transactionExecutor.execute(tenantCode, () -> reportService.list(catalog.completeTrack())).get(0).reportedBy()).isEqualTo("Anna Archivi");

        Long first = transactionExecutor.execute(tenantCode, () -> reportService.list(catalog.completeTrack())).stream()
            .filter(report -> "Socio".equals(report.reportedBy()))
            .findFirst()
            .orElseThrow()
            .id();
        ErrorReportDTO closed = transactionExecutor.execute(tenantCode, () -> reportService.close(catalog.completeTrack(), first, archivist()));
        assertThat(closed.status()).isEqualTo(ScoreErrorReportStatus.CLOSED);
        assertThat(closed.closure()).isEqualTo(ScoreErrorReportClosure.MANUAL);
        assertThat(transactionExecutor.execute(tenantCode, () -> reportService.close(catalog.completeTrack(), first, archivist())).closedAt()).isCloseTo(closed.closedAt(), within(1, ChronoUnit.MILLIS));
        transactionExecutor.execute(tenantCode, () -> {
            reportService.report(catalog.completeTrack(), catalog.ownPart(), new ErrorReportRequestDTO(null, "Ora si può"), member(otherMemberKey));
            return null;
        });

        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> reportService.close(catalog.draftTrack(), first, archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.report.notFound"));
    }

    @Test
    void theApprovalOfARecognizedPartKeepsOnlyTheCountsOfTheLatestApproval() {
        ScoreVersionDTO recognized = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("tuba.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P1", false, archivist()
        ));
        jdbcTemplate.update("UPDATE " + schema() + ".score_version SET origin = 'OMR_AUDIVERIS' WHERE id = ?", recognized.id());
        assertThat(pending().total()).isZero();
        assertThatThrownBy(() -> record(recognized.id(), recognized.id(), counts(3, 3, 3, 0, 0, 0, 0, 0, 0, 0)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("reason", "notApproved"));

        String content = transactionExecutor.execute(tenantCode, () -> versionService.editor(catalog.completeTrack(), catalog.ownPart(), recognized.id(), archivist())).musicXml();
        ScoreVersionDTO first = transactionExecutor.execute(tenantCode, () -> versionService.correct(
            catalog.completeTrack(), catalog.ownPart(), new CorrectionDTO(recognized.id(), content, true, null, null, EDIT_SESSION, false), archivist()
        ));
        PendingReviewsDTO pending = pending();
        assertThat(pending.total()).isEqualTo(1);
        assertThat(pending.items()).singleElement().satisfies(item -> {
            assertThat(item.trackId()).isEqualTo(catalog.completeTrack());
            assertThat(item.scoreId()).isEqualTo(catalog.ownPart());
            assertThat(item.engine()).isEqualTo(RecognitionEngine.AUDIVERIS);
            assertThat(item.engineVersionId()).isEqualTo(recognized.id());
            assertThat(item.approvedVersionId()).isEqualTo(first.id());
            assertThat(item.approvedVersionNumber()).isEqualTo(2);
        });

        assertThatThrownBy(() -> record(first.id(), first.id(), counts(3, 3, 3, 0, 0, 0, 0, 0, 0, 0)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scorePlayback.recognitionReviewInvalid");
                assertThat(error.getArgs().values()).containsEntry("reason", "notFromEngine");
            });
        assertThatThrownBy(() -> record(first.id(), recognized.id(), counts(3, 3, 2, 0, 0, 0, 0, 0, 0, 0)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("reason", "inconsistentCounts"));
        assertThatThrownBy(() -> record(first.id(), recognized.id(), counts(3, 4, 2, 1, 0, 0, 0, 0, 0, 0)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("reason", "inconsistentCounts"));
        assertThatThrownBy(() -> record(first.id(), recognized.id(), counts(3, 3, 3, 0, 0, 0, 0, 0, 1, 2)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("reason", "inconsistentCounts"));

        double correctBefore = measures("correct");
        double pitchBefore = measures("pitch");
        record(first.id(), recognized.id(), counts(3, 4, 1, 1, 0, 0, 1, 2, 2, 1));
        assertThat(pending().total()).isZero();
        assertThat(measures("correct") - correctBefore).isEqualTo(1);
        assertThat(measures("pitch") - pitchBefore).isEqualTo(1);

        RecognitionReportDTO report = transactionExecutor.execute(tenantCode, () -> reviewService.report(null));
        assertThat(report.engines()).singleElement().satisfies(engine -> {
            assertThat(engine.engine()).isEqualTo(RecognitionEngine.AUDIVERIS);
            assertThat(engine.counts().parts()).isEqualTo(1);
            assertThat(engine.counts().referenceMeasures()).isEqualTo(3);
            assertThat(engine.counts().engineMeasures()).isEqualTo(4);
            assertThat(engine.counts().correctMeasures()).isEqualTo(1);
            assertThat(engine.counts().missingMeasures()).isEqualTo(1);
            assertThat(engine.counts().extraMeasures()).isEqualTo(2);
            assertThat(engine.counts().foundMarks()).isEqualTo(1);
        });
        assertThat(report.months()).singleElement().satisfies(month -> {
            assertThat(month.month()).isEqualTo(YearMonth.now(ZoneId.of("Europe/Rome")).toString());
            assertThat(month.counts().correctMeasures()).isEqualTo(1);
        });
        assertThat(report.parts()).singleElement().satisfies(part -> {
            assertThat(part.trackName()).startsWith("Gesù mio con dure funi");
            assertThat(part.engineVersionNumber()).isEqualTo(1);
            assertThat(part.approvedVersionNumber()).isEqualTo(2);
            assertThat(part.referenceMeasures()).isEqualTo(3);
            assertThat(part.correctedMeasures()).isEqualTo(4);
        });
        assertThat(transactionExecutor.execute(tenantCode, () -> reviewService.report(LocalDate.now().plusDays(2))).engines()).isEmpty();

        // A later approval of a version descending from the same recognition replaces the counts; an older one does not.
        ScoreVersionDTO second = transactionExecutor.execute(tenantCode, () -> versionService.correct(
            catalog.completeTrack(), catalog.ownPart(), new CorrectionDTO(first.id(), content, true, null, null, EDIT_SESSION, false), archivist()
        ));
        assertThat(pending().items()).singleElement().satisfies(item -> assertThat(item.approvedVersionId()).isEqualTo(second.id()));
        record(second.id(), recognized.id(), counts(3, 3, 3, 0, 0, 0, 0, 0, 2, 2));
        record(first.id(), recognized.id(), counts(3, 4, 1, 1, 0, 0, 1, 2, 2, 1));
        assertThat(measures("correct") - correctBefore).isEqualTo(1);
        RecognitionReportDTO replaced = transactionExecutor.execute(tenantCode, () -> reviewService.report(null));
        assertThat(replaced.engines()).singleElement().satisfies(engine -> {
            assertThat(engine.counts().parts()).isEqualTo(1);
            assertThat(engine.counts().correctMeasures()).isEqualTo(3);
            assertThat(engine.counts().foundMarks()).isEqualTo(2);
        });
        assertThat(replaced.parts()).isEmpty();
        assertThat(pending().total()).isZero();

        // A version of an engine approved as it is counts with all its measures correct; a part removed leaves the counts.
        ScoreVersionDTO otherRecognized = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.otherPart(), musicXml("voce.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P2", false, archivist()
        ));
        jdbcTemplate.update("UPDATE " + schema() + ".score_version SET origin = 'OMR_HOMR' WHERE id = ?", otherRecognized.id());
        transactionExecutor.execute(tenantCode, () -> versionService.approve(catalog.completeTrack(), catalog.otherPart(), otherRecognized.id(), archivist()));
        assertThat(pending().items()).singleElement().satisfies(item -> {
            assertThat(item.engine()).isEqualTo(RecognitionEngine.HOMR);
            assertThat(item.engineVersionId()).isEqualTo(otherRecognized.id()).isEqualTo(item.approvedVersionId());
        });
        record(catalog.otherPart(), otherRecognized.id(), otherRecognized.id(), counts(2, 3, 2, 0, 0, 0, 0, 1, 0, 0));
        jdbcTemplate.update("UPDATE " + schema() + ".sheet_music SET deleted = TRUE WHERE id = ?", catalog.otherPart());
        RecognitionReportDTO withRemoved = transactionExecutor.execute(tenantCode, () -> reviewService.report(null));
        assertThat(withRemoved.engines()).extracting(engine -> engine.engine()).containsExactly(RecognitionEngine.AUDIVERIS, RecognitionEngine.HOMR);
        assertThat(withRemoved.parts()).isEmpty();
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + schema() + ".score_recognition_review", Long.class)).isEqualTo(2);
    }

    /**
     * The target of the Riconoscimento page: the summary with 5,000 approved parts in 500 tracks, each with the version of
     * an engine and the approved version descending from it, recognized over two years; 4,000 collected and 1,000 still to
     * collect.
     */
    @Test
    @Timeout(value = 10, unit = TimeUnit.MINUTES)
    void summarizesFiveThousandApprovedPartsWithinTheTarget() {
        ScoreVersionDTO template = transactionExecutor.execute(tenantCode, () -> versionService.upload(
            catalog.completeTrack(), catalog.ownPart(), musicXml("tuba.musicxml", MusicXmlDocumentsTest.TWO_PARTS), "P1", false, archivist()
        ));
        transactionExecutor.execute(tenantCode, () -> {
            cloneRows("track", catalog.completeTrack(), "CROSS JOIN generate_series(1, 500) g", Map.of("name", "'Carico ' || g"));
            cloneRows(
                "sheet_music",
                catalog.ownPart(),
                "CROSS JOIN generate_series(1, 10) g CROSS JOIN (SELECT id FROM track WHERE name LIKE 'Carico %') load",
                Map.of("track_id", "load.id", "display_order", "g", "description", "'Parte ' || g")
            );
            String parts = "CROSS JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM sheet_music " +
                "WHERE track_id IN (SELECT id FROM track WHERE name LIKE 'Carico %')) part";
            cloneRows("score_version", template.id(), parts, Map.of(
                "sheet_music_id", "part.id",
                "version_number", "1",
                "origin", "CASE WHEN part.n % 2 = 0 THEN 'OMR_AUDIVERIS' ELSE 'OMR_HOMR' END",
                "insert_date", "now() - (part.n % 730) * interval '1 day'"
            ));
            cloneRows("score_version", template.id(), parts + " JOIN score_version engine ON engine.sheet_music_id = part.id", Map.of(
                "sheet_music_id", "part.id",
                "version_number", "2",
                "origin", "'CORRECTION'",
                "status", "'APPROVED'",
                "parent_version_id", "engine.id",
                "approved_by", "'archivist'",
                "approved_at", "engine.insert_date + interval '1 day'"
            ));
            entityManager.createNativeQuery("""
                INSERT INTO score_recognition_review (sheet_music_id, engine_version_id, approved_version_id, engine, recognized_at,
                    approved_at, reference_measures, engine_measures, correct_measures, pitch_measures, rhythm_measures, tie_measures,
                    missing_measures, extra_measures, reference_marks, found_marks, insert_date, insert_by, edit_date, edit_by)
                SELECT engine.sheet_music_id, engine.id, approved.id, CASE engine.origin WHEN 'OMR_AUDIVERIS' THEN 'AUDIVERIS' ELSE 'HOMR' END,
                       engine.insert_date, approved.approved_at, 60, 61, 50 - engine.id % 8, engine.id % 8, 3, 1, 6, 7, 4, 3,
                       now(), 'load', now(), 'load'
                  FROM score_version engine
                  JOIN score_version approved ON approved.parent_version_id = engine.id
                 WHERE engine.origin IN ('OMR_AUDIVERIS', 'OMR_HOMR') AND engine.id % 5 <> 0
                """).executeUpdate();
            for (String table : List.of("track", "sheet_music", "score_version", "score_recognition_review")) {
                entityManager.createNativeQuery("ANALYZE " + table).executeUpdate();
            }
            return null;
        });
        long reviews = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + schema() + ".score_recognition_review", Long.class);
        LocalDate yearAgo = LocalDate.now().minusYears(1);

        for (int warmUp = 0; warmUp < 5; warmUp++) {
            transactionExecutor.execute(tenantCode, () -> reviewService.report(null));
            transactionExecutor.execute(tenantCode, () -> reviewService.pending(1));
        }
        List<Long> everything = new ArrayList<>();
        List<Long> lastYear = new ArrayList<>();
        List<Long> toCollect = new ArrayList<>();
        for (int request = 0; request < 20; request++) {
            everything.add(millis(() -> transactionExecutor.execute(tenantCode, () -> reviewService.report(null))));
            lastYear.add(millis(() -> transactionExecutor.execute(tenantCode, () -> reviewService.report(yearAgo))));
            toCollect.add(millis(() -> transactionExecutor.execute(tenantCode, () -> reviewService.pending(1))));
        }
        LOG.info(
            "recognition_report_load reviews={} reportP95Ms={} lastYearP95Ms={} pendingP95Ms={}",
            reviews,
            percentile(everything, 95),
            percentile(lastYear, 95),
            percentile(toCollect, 95)
        );

        RecognitionReportDTO report = transactionExecutor.execute(tenantCode, () -> reviewService.report(null));
        assertThat(report.engines()).extracting(engine -> engine.engine()).containsExactly(RecognitionEngine.AUDIVERIS, RecognitionEngine.HOMR);
        assertThat(report.engines().stream().mapToLong(engine -> engine.counts().parts()).sum()).isEqualTo(reviews).isBetween(3_900L, 4_100L);
        assertThat(report.months()).hasSizeGreaterThanOrEqualTo(2 * 24);
        assertThat(report.parts()).hasSize(20);
        assertThat(transactionExecutor.execute(tenantCode, () -> reviewService.pending(1)).total()).isEqualTo(5_000 - reviews);
        assertThat(percentile(everything, 95)).as("p95 del riepilogo di tutto il periodo in millisecondi").isLessThan(500);
        assertThat(percentile(lastYear, 95)).as("p95 del riepilogo dell'ultimo anno in millisecondi").isLessThan(500);
        assertThat(percentile(toCollect, 95)).as("p95 del conteggio delle approvazioni da raccogliere in millisecondi").isLessThan(500);
    }

    @Test
    void instrumentsCanBeFilteredByPlaybackConfiguration() {
        InstrumentsCriteria criteria = new InstrumentsCriteria();
        BooleanFilter notConfigured = new BooleanFilter();
        notConfigured.setEquals(false);
        criteria.setPlaybackConfigured(notConfigured);

        List<String> names = transactionExecutor.execute(tenantCode, () ->
            instrumentsService.findEntitiesByCriteria(criteria, PageRequest.of(0, 50), archivist()).map(InstrumentsDTO::getName).getContent()
        );

        assertThat(names).containsExactly("Voce");
    }

    private Catalog createCatalog() {
        Catalog created = transactionExecutor.execute(tenantCode, () -> {
            Instruments own = entityManager.createQuery("select i from Instruments i where i.name = 'Basso 1°'", Instruments.class).getSingleResult();
            Instruments voice = audited(new Instruments(), "Voce");
            entityManager.persist(voice);
            Tracks complete = track(StateEnum.COMPLETE);
            SheetsMusic ownPart = part(own, persistMedia("tuba-page"));
            SheetsMusic otherPart = part(voice, persistMedia("voice-page"));
            complete.getScores().addAll(List.of(ownPart, otherPart));
            entityManager.persist(complete);
            Tracks draft = track(StateEnum.DRAFT);
            draft.getScores().add(part(own, persistMedia("draft-page")));
            entityManager.persist(draft);
            entityManager.flush();
            return new Catalog(complete.getId(), draft.getId(), ownPart.getId(), otherPart.getId(), own.getId());
        });
        createMember(memberKey, created.ownInstrument());
        createMember(otherMemberKey, null);
        return created;
    }

    private void createMember(String keycloakId, Long instrumentId) {
        Long identityId = transactionExecutor.execute(
            TenantSchemaNameResolver.DEFAULT_SCHEMA,
            () -> jdbcTemplate.queryForObject(
                "INSERT INTO public.user_identity (keycloak_id, created_at) VALUES (?, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                keycloakId
            )
        );
        identityIds.add(identityId);
        Long userId = jdbcTemplate.queryForObject(
            "INSERT INTO " + schema() + ".app_user (user_identity_id, keycloak_id, name) VALUES (?, ?, ?) RETURNING id",
            Long.class,
            identityId,
            keycloakId,
            "Socio"
        );
        if (instrumentId != null) {
            jdbcTemplate.update("INSERT INTO " + schema() + ".user_instrument (user_id, instrument_id) VALUES (?, ?)", userId, instrumentId);
        }
    }

    private Tracks track(StateEnum state) {
        Tracks track = audited(new Tracks(), "Gesù mio con dure funi " + state);
        track.setState(state);
        return track;
    }

    private static SheetsMusic part(Instruments instrument, Media page) {
        SheetsMusic part = new SheetsMusic();
        part.getInstruments().add(instrument);
        part.getMedia().add(page);
        return part;
    }

    private Media persistMedia(String name) {
        String sha256 = UUID.randomUUID().toString().replace("-", "").repeat(2);
        Media media = audited(new Media(), name);
        media.setStorageKey("scores/" + UUID.randomUUID() + "/" + sha256 + ".png");
        media.setOriginalFilename(name + ".png");
        media.setMimeType("image/png");
        media.setFileExtension("png");
        media.setFileSize(1);
        media.setSha256(sha256);
        media.setStatus(MediaAssetStatus.READY);
        entityManager.persist(media);
        return media;
    }

    private <T extends CommonFieldsOpenSearch> T audited(T entity, String name) {
        Date now = new Date();
        entity.setName(name);
        entity.setDeleted(false);
        entity.setInsertBy("test");
        entity.setInsertDate(now);
        entity.setEditBy("test");
        entity.setEditDate(now);
        return entity;
    }

    private static PartPlaybackDTO part(TrackPlaybackDTO playback, Long scoreId) {
        return playback.parts().stream().filter(part -> part.scoreId().equals(scoreId)).findFirst().orElseThrow();
    }

    private static MockMultipartFile musicXml(String name, String content) {
        return new MockMultipartFile("file", name, "application/xml", content.getBytes(StandardCharsets.UTF_8));
    }

    private JwtAuthenticationToken archivist() {
        return authentication("score-archivist", AuthoritiesConstants.ARCHIVIST);
    }

    /** An archivist who is not a user of the tenant, with the name in the token. */
    private JwtAuthenticationToken namedArchivist() {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("score-named-archivist").claim("tenant", tenantCode)
            .claim("given_name", "Anna").claim("family_name", "Archivi").issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(AuthoritiesConstants.ARCHIVIST)));
    }

    private JwtAuthenticationToken member(String keycloakId) {
        return authentication(keycloakId, AuthoritiesConstants.USER);
    }

    private JwtAuthenticationToken external(String keycloakId) {
        return authentication(keycloakId, AuthoritiesConstants.USER_EXTERNAL);
    }

    private JwtAuthenticationToken authentication(String keycloakId, String authority) {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject(keycloakId).claim("tenant", tenantCode)
            .issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(authority)));
    }

    private PendingReviewsDTO pending() {
        return transactionExecutor.execute(tenantCode, () -> reviewService.pending(null));
    }

    private void record(Long approvedId, Long engineVersionId, RecognitionReviewRequestDTO counts) {
        record(catalog.ownPart(), approvedId, engineVersionId, counts);
    }

    private void record(Long scoreId, Long approvedId, Long engineVersionId, RecognitionReviewRequestDTO counts) {
        RecognitionReviewRequestDTO request = new RecognitionReviewRequestDTO(
            engineVersionId,
            counts.referenceMeasures(),
            counts.engineMeasures(),
            counts.correctMeasures(),
            counts.pitchMeasures(),
            counts.rhythmMeasures(),
            counts.tieMeasures(),
            counts.missingMeasures(),
            counts.extraMeasures(),
            counts.referenceMarks(),
            counts.foundMarks()
        );
        transactionExecutor.execute(tenantCode, () -> {
            reviewService.record(catalog.completeTrack(), scoreId, approvedId, request, archivist());
            return null;
        });
    }

    /** Measures of the approved version and of the engine, correct, pitch, rhythm, tie, missing, extra, marks expected and found. */
    private static RecognitionReviewRequestDTO counts(int reference, int engine, int correct, int pitch, int rhythm, int tie, int missing, int extra, int marks, int found) {
        return new RecognitionReviewRequestDTO(null, reference, engine, correct, pitch, rhythm, tie, missing, extra, marks, found);
    }

    private double measures(String outcome) {
        Counter counter = meterRegistry.find("taurus.score.recognition.measures").tags("engine", "audiveris", "outcome", outcome).counter();
        return counter == null ? 0 : counter.count();
    }

    private String schema() {
        return '"' + schemaNameResolver.resolve(tenantCode).replace("\"", "\"\"") + '"';
    }

    /**
     * Copies the template row {@code t} of a table for every row of {@code from}, replacing the given columns: the other
     * columns, read from the catalog, stay as the service wrote them.
     */
    @SuppressWarnings("unchecked")
    private void cloneRows(String table, Long templateId, String from, Map<String, String> overrides) {
        entityManager.flush();
        List<String> columns = entityManager.createNativeQuery(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name <> 'id' ORDER BY ordinal_position"
        ).setParameter("table", table).getResultList();
        String select = columns.stream().map(column -> overrides.getOrDefault(column, "t." + column)).collect(Collectors.joining(", "));
        entityManager.createNativeQuery(
            "INSERT INTO " + table + " (" + String.join(", ", columns) + ") SELECT " + select + " FROM " + table + " t " + from + " WHERE t.id = " + templateId
        ).executeUpdate();
    }

    private static long millis(Runnable action) {
        long startedAt = System.nanoTime();
        action.run();
        return (System.nanoTime() - startedAt) / 1_000_000;
    }

    private static long percentile(List<Long> values, int percentile) {
        List<Long> sorted = values.stream().sorted().toList();
        int index = (int) Math.ceil(percentile / 100.0 * sorted.size()) - 1;
        return sorted.get(Math.max(0, index));
    }

    private record Catalog(Long completeTrack, Long draftTrack, Long ownPart, Long otherPart, Long ownInstrument) {}
}
