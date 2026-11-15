package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.IntegrationTest;
import com.fundaro.zodiac.taurus.domain.CommonFieldsOpenSearch;
import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaNameResolver;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.scorewriting.ArrangementVersionRepository;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.CorrectionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PlaybackInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDraftDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementVersionRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractedRowDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractionRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractionResultDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.NewArrangementDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.RowChecksDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionService;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import jakarta.persistence.EntityManager;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The score of a track on a real tenant schema: the migration and its constraints, the draft and the lock of the score,
 * its versions, the extraction of the parts with the state of each row, the removal and the cleanup.
 */
@IntegrationTest
@TestPropertySource(
    properties = {
        "application.base-path=target/arrangement-it-storage",
        "application.score-playback.enabled=true",
        "application.score-writing.enabled=true",
        "application.score-writing.draft-min-interval=PT0S",
        "spring.liquibase.contexts=test",
        "spring.datasource.hikari.maximum-pool-size=4",
        "spring.datasource.hikari.minimum-idle=1",
        "spring.security.oauth2.client.registration.oidc.client-id=test",
        "spring.security.oauth2.client.registration.oidc.client-secret=test",
    }
)
class ArrangementIT {

    private static final String MARIO_EDITOR = "mario-editor-window";
    private static final String LUCIA_EDITOR = "lucia-editor-window";

    @MockitoBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @MockitoBean
    private JwtDecoder jwtDecoder;

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
    private ArrangementService arrangementService;

    @Autowired
    private ArrangementVersionService arrangementVersionService;

    @Autowired
    private ArrangementExtractionService extractionService;

    @Autowired
    private ArrangementVersionRepository arrangementVersionRepository;

    @Autowired
    private ScoreEditLockService lockService;

    @Autowired
    private ScoreVersionService versionService;

    @Autowired
    private ScoreWritingCleanup cleanup;

    private final String tenantCode = "arrangement-it-" + UUID.randomUUID();
    private Long tenantId;
    private Long trackId;
    private Long bassPartId;
    private Long percussionPartId;
    private Long euphoniumPartId;
    private Long bass;
    private Long clarinet;
    private Long drum;
    private Long bassDrum;

    @BeforeEach
    void provisionTenant() {
        provisioningService.provision(tenantCode);
        tenantId = transactionExecutor.execute(
            TenantSchemaNameResolver.DEFAULT_SCHEMA,
            () -> jdbcTemplate.queryForObject(
                "INSERT INTO public.tenant (deleted, name, code, active, score_playback_enabled, score_writing_enabled) "
                    + "VALUES (false, 'Banda musicale di prova', ?, true, true, true) RETURNING id",
                Long.class,
                tenantCode
            )
        );
        provisioningService.linkTenant(tenantId, tenantCode);
        transactionExecutor.execute(tenantCode, () -> {
            Tracks track = audited(new Tracks(), "Marcia sinfonica");
            track.setState(StateEnum.COMPLETE);
            SheetsMusic bassPart = part(track, instrument("Basso 1°"));
            SheetsMusic percussionPart = part(track, instrument("Tamburo"), instrument("Gran cassa"));
            SheetsMusic euphoniumPart = part(track, instrument("Euphonium 1°"));
            entityManager.persist(track);
            entityManager.flush();
            trackId = track.getId();
            bassPartId = bassPart.getId();
            percussionPartId = percussionPart.getId();
            euphoniumPartId = euphoniumPart.getId();
            bass = instrument("Basso 1°").getId();
            clarinet = instrument("Clarinetto soprano 1°").getId();
            drum = instrument("Tamburo").getId();
            bassDrum = instrument("Gran cassa").getId();
        });
    }

    @AfterEach
    void dropTenant() {
        try {
            provisioningService.dropSchema(tenantCode);
        } finally {
            transactionExecutor.execute(TenantSchemaNameResolver.DEFAULT_SCHEMA, () -> {
                jdbcTemplate.update("UPDATE public.tenant_schema_registry SET tenant_id = NULL WHERE tenant_code = ?", tenantCode);
                jdbcTemplate.update("DELETE FROM public.tenant WHERE id = ?", tenantId);
            });
        }
    }

    @Test
    void aScoreStartsWithItsDraftAndKeepsThePartsWithTheInstrumentsOfTheirRows() {
        assertError(
            () -> create(List.of(row("P1", bassPartId, bass), row("P2", bassPartId, clarinet), row("P3", null, drum, bassDrum))),
            "scoreWriting.extractionInvalid"
        );
        assertError(() -> create(List.of(row("P1", bassPartId, bass), row("P2", null, clarinet), row("P3", null, bass, clarinet))), "scoreWriting.contentInvalid");
        assertError(() -> create(List.of(row("P1", 999_999L, bass), row("P2", null, clarinet), row("P3", null, drum))), "scorePlayback.part.notFound");
        assertThat(count("track_arrangement")).isZero();

        // The clarinet row comes from the euphonium part, which has another instrument: it starts without a part.
        ArrangementDTO created = create(List.of(row("P1", bassPartId, bass), row("P2", euphoniumPartId, clarinet), row("P3", percussionPartId, drum, bassDrum)));

        assertThat(created.trackId()).isEqualTo(trackId);
        assertThat(created.currentVersion()).isNull();
        assertThat(created.draft()).isNotNull();
        assertThat(created.draft().outdated()).isFalse();
        assertThat(created.editing()).isNull();
        assertThat(created.rows()).extracting(row -> row.id() + " " + row.name() + " " + row.status() + " " + row.scoreId())
            .containsExactly("P1 Basso TO_EXTRACT " + bassPartId, "P2 Clarinetto NEW null", "P3 Percussioni TO_EXTRACT " + percussionPartId);
        assertThat(created.rows().get(2).instruments()).extracting(PlaybackInstrumentDTO::name).containsExactly("Tamburo", "Gran cassa");
        assertThat(inTenant(() -> arrangementService.get(trackId)).orElseThrow().rows()).isEqualTo(created.rows());
        assertThat(arrangementRow(bassPartId)).isEqualTo("P1");
        assertThat(arrangementRow(euphoniumPartId)).isNull();

        assertError(() -> create(List.of(row("P1", null, bass), row("P2", null, clarinet), row("P3", null, drum))), "scoreWriting.arrangementExists");
        assertThatThrownBy(() -> jdbcTemplate.update(
            "INSERT INTO " + schema() + ".track_arrangement (track_id, insert_date, insert_by, edit_date, edit_by) VALUES (?, now(), 'x', now(), 'x')",
            trackId
        )).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbcTemplate.update("UPDATE " + schema() + ".score_draft SET rows_json = NULL WHERE target_type = 'ARRANGEMENT'"))
            .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbcTemplate.update("UPDATE " + schema() + ".sheet_music SET arrangement_row = 'P1' WHERE id = ?", percussionPartId))
            .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void theDraftAndTheVersionsOfTheScoreNeedItsLockAndNotTheLocksOfItsParts() {
        create(List.of(row("P1", bassPartId, bass), row("P2", null, clarinet), row("P3", percussionPartId, drum, bassDrum)));
        assertThat(inTenant(() -> arrangementService.acquireLock(trackId, MARIO_EDITOR, false, mario())).mine()).isTrue();
        // Writing the score does not lock its parts.
        inTenant(() -> lockService.acquire(trackId, bassPartId, LUCIA_EDITOR, false, lucia()));
        assertError(() -> inTenant(() -> arrangementService.acquireLock(trackId, LUCIA_EDITOR, false, lucia())), "scoreWriting.locked");
        assertError(
            () -> inTenant(() -> arrangementService.saveDraft(trackId, new ArrangementDraftRequestDTO(LUCIA_EDITOR, score(false, 2), rows(), null, null), lucia())),
            "scoreWriting.locked"
        );
        assertThat(inTenant(() -> arrangementService.get(trackId)).orElseThrow().editing().ownerName()).isEqualTo("Mario Rossi");

        ArrangementDraftDTO first = inTenant(() -> arrangementService.draft(trackId)).orElseThrow();
        assertThat(first.rows()).extracting(ArrangementRowDTO::id).containsExactly("P1", "P2", "P3");
        assertThat(first.measureCount()).isEqualTo(1);
        assertError(
            () -> inTenant(() -> arrangementService.saveDraft(trackId, new ArrangementDraftRequestDTO(MARIO_EDITOR, score(false, 2), rows(), null, null), mario())),
            "scoreWriting.draftConflict"
        );
        inTenant(() -> arrangementService.saveDraft(trackId, new ArrangementDraftRequestDTO(MARIO_EDITOR, score(false, 2), rows(), null, first.entityVersion()), mario()));
        assertThat(inTenant(() -> arrangementService.draft(trackId)).orElseThrow().measureCount()).isEqualTo(2);

        ArrangementVersionDTO saved = saveVersion(score(false, 2), null, false, false);
        assertThat(saved.versionNumber()).isEqualTo(1);
        assertThat(saved.current()).isTrue();
        assertThat(saved.concertPitch()).isFalse();
        assertThat(saved.measureCount()).isEqualTo(2);
        assertThat(saved.status()).isEqualTo(ScoreVersionStatus.UNVERIFIED);
        assertThat(saved.checks()).extracting(RowChecksDTO::row).containsExactly("P1", "P2", "P3");
        assertThat(saved.checks().get(0).checks().measureCount()).isEqualTo(2);
        assertThat(inTenant(() -> arrangementService.draft(trackId))).isEmpty();

        // A version written from before the first one has to confirm that it replaces it.
        assertError(() -> saveVersion(score(true, 2), null, false, false), "scoreWriting.draftOutdated");
        ArrangementVersionDTO concert = saveVersion(score(true, 2), saved.id(), true, false);
        assertThat(concert.versionNumber()).isEqualTo(2);
        assertThat(concert.concertPitch()).isTrue();
        assertThat(concert.status()).isEqualTo(ScoreVersionStatus.APPROVED);
        assertThat(new String(inTenant(() -> arrangementVersionService.content(trackId, concert.id(), mario())), StandardCharsets.UTF_8)).contains("concert-score");
        assertThat(inTenant(() -> arrangementVersionService.file(trackId, saved.id(), mario())).fileName()).isEqualTo("partitura.mxl");

        ArrangementVersionDTO approved = inTenant(() -> arrangementVersionService.approve(trackId, saved.id(), mario()));
        assertThat(approved.current()).isTrue();
        assertThat(inTenant(() -> arrangementVersionService.versions(trackId)))
            .extracting(version -> version.versionNumber() + " " + version.status() + " " + version.current())
            .containsExactly("2 APPROVED false", "1 APPROVED true");
        assertThatThrownBy(() -> jdbcTemplate.update(
            "INSERT INTO " + schema() + ".arrangement_version (arrangement_id, version_number, status, media_asset_id, rows_json, concert_pitch, measure_count, "
                + "checks_json, insert_date, insert_by, edit_date, edit_by) SELECT arrangement_id, 1, 'UNVERIFIED', media_asset_id, rows_json, false, 2, "
                + "checks_json, now(), 'x', now(), 'x' FROM " + schema() + ".arrangement_version WHERE id = ?",
            saved.id()
        )).isInstanceOf(DataIntegrityViolationException.class);

        // The draft of someone else is not discarded while it is being written.
        inTenant(() -> arrangementService.saveDraft(trackId, new ArrangementDraftRequestDTO(MARIO_EDITOR, score(false, 3), rows(), saved.id(), null), mario()));
        assertError(() -> inTenant(() -> {
            arrangementService.discardDraft(trackId, null, lucia());
            return null;
        }), "scoreWriting.locked");
        inTenant(() -> {
            arrangementService.releaseLock(trackId, MARIO_EDITOR);
            arrangementService.discardDraft(trackId, null, lucia());
            return null;
        });
        assertThat(inTenant(() -> arrangementService.draft(trackId))).isEmpty();
    }

    @Test
    void theExtractionUpdatesThePartsOfTheRowsAndEachRowTellsHowItsPartStands() {
        create(List.of(row("P1", bassPartId, bass), row("P2", null, clarinet), row("P3", percussionPartId, drum, bassDrum)));
        inTenant(() -> arrangementService.acquireLock(trackId, MARIO_EDITOR, false, mario()));
        ArrangementVersionDTO first = saveVersion(score(false, 1), null, true, false);
        Long trackVersion = trackVersion();

        ExtractionResultDTO result = extract(first.id(), trackVersion, extracted("P1", bassPartId), new ExtractedRowDTO("P2", null, " Clarinetto 1° ", single("Clarinetto")), extracted("P3", percussionPartId));

        assertThat(result.parts()).extracting(part -> part.row() + " " + part.created()).containsExactly("P1 false", "P2 true", "P3 false");
        assertThat(result.trackVersion()).isEqualTo(trackVersion());
        assertThat(result.trackVersion()).isGreaterThan(trackVersion);
        Long clarinetPartId = result.parts().get(1).scoreId();
        assertThat(jdbcTemplate.queryForMap(
            "SELECT version.origin, version.status, version.arrangement_version_id, part.description, part.arrangement_row, "
                + "part.current_score_version_id = version.id AS current FROM " + schema() + ".score_version version JOIN " + schema()
                + ".sheet_music part ON part.id = version.sheet_music_id WHERE part.id = ?",
            clarinetPartId
        )).containsEntry("origin", "ARRANGEMENT").containsEntry("status", "APPROVED").containsEntry("arrangement_version_id", first.id())
            .containsEntry("description", "Clarinetto 1°").containsEntry("arrangement_row", "P2").containsEntry("current", true);
        assertThat(statuses()).containsExactly("P1 UP_TO_DATE", "P2 UP_TO_DATE", "P3 UP_TO_DATE");
        assertThatThrownBy(() -> jdbcTemplate.update("UPDATE " + schema() + ".score_version SET arrangement_version_id = NULL WHERE sheet_music_id = ?", clarinetPartId))
            .isInstanceOf(DataIntegrityViolationException.class);

        // A correction of the part after the extraction, then a new version of the score.
        inTenant(() -> lockService.acquire(trackId, bassPartId, MARIO_EDITOR, false, mario()));
        inTenant(() -> versionService.correct(trackId, bassPartId, new CorrectionDTO(null, single("Basso"), false, null, ScoreVersionOrigin.WRITING, MARIO_EDITOR, true), mario()));
        inTenant(() -> {
            lockService.release(trackId, bassPartId, MARIO_EDITOR);
            return null;
        });
        assertThat(statuses()).containsExactly("P1 MODIFIED", "P2 UP_TO_DATE", "P3 UP_TO_DATE");
        ArrangementVersionDTO second = saveVersion(score(false, 1), first.id(), false, false);
        assertThat(statuses()).containsExactly("P1 MODIFIED", "P2 TO_EXTRACT", "P3 TO_EXTRACT");

        Long current = trackVersion();
        assertError(() -> extract(first.id(), current, extracted("P3", percussionPartId)), "scoreWriting.arrangementOutdated");
        assertError(() -> extract(second.id(), current - 1, extracted("P3", percussionPartId)), "version.conflict");
        assertReason(() -> extract(second.id(), current, extracted("P3", percussionPartId), extracted("P3", null)), "duplicateRow");
        assertReason(() -> extract(second.id(), current, extracted("P9", null)), "unknownRow");
        assertReason(() -> extract(second.id(), current, extracted("P2", clarinetPartId), extracted("P1", clarinetPartId)), "duplicateTarget");
        assertReason(() -> extract(second.id(), current, extracted("P1", percussionPartId)), "instrumentsMismatch");
        assertReason(() -> extract(second.id(), current, new ExtractionRequestDTO(current, List.of())), "empty");
        assertError(() -> extract(second.id(), current, new ExtractedRowDTO("P3", percussionPartId, null, score(false, 1))), "scoreWriting.contentInvalid");
        inTenant(() -> lockService.acquire(trackId, percussionPartId, LUCIA_EDITOR, false, lucia()));
        assertError(() -> extract(second.id(), current, extracted("P3", percussionPartId)), "scoreWriting.locked");
        inTenant(() -> {
            lockService.release(trackId, percussionPartId, LUCIA_EDITOR);
            return null;
        });

        // The part of a row is removed: the next extraction creates another one for the row.
        jdbcTemplate.update("UPDATE " + schema() + ".sheet_music SET deleted = true WHERE id = ?", clarinetPartId);
        assertThat(statuses()).containsExactly("P1 MODIFIED", "P2 PART_DELETED", "P3 TO_EXTRACT");
        ExtractionResultDTO again = extract(second.id(), trackVersion(), extracted("P2", null), extracted("P3", percussionPartId));
        assertThat(again.parts()).extracting(part -> part.row() + " " + part.created()).containsExactly("P2 true", "P3 false");
        assertThat(again.parts().get(1).versionId()).isNotNull();
        assertThat(arrangementRow(clarinetPartId)).isNull();
        assertThat(arrangementRow(again.parts().get(0).scoreId())).isEqualTo("P2");
        assertThat(statuses()).containsExactly("P1 MODIFIED", "P2 UP_TO_DATE", "P3 UP_TO_DATE");
        // The version of the score was not approved: neither are the extracted ones.
        assertThat(jdbcTemplate.queryForObject("SELECT status FROM " + schema() + ".score_version WHERE id = ?", String.class, again.parts().get(1).versionId()))
            .isEqualTo("UNVERIFIED");
    }

    @Test
    void aRowToTransposeNeedsTheTranspositionOfItsInstrument() {
        create(List.of(row("P1", bassPartId, bass), row("P2", null, clarinet), row("P3", percussionPartId, drum, bassDrum)));
        inTenant(() -> arrangementService.acquireLock(trackId, MARIO_EDITOR, false, mario()));
        ArrangementVersionDTO concert = saveVersion(score(true, 1), null, false, false);
        jdbcTemplate.update("UPDATE " + schema() + ".instrument SET transposition_semitones = NULL WHERE id = ?", clarinet);

        assertThatThrownBy(() -> extract(concert.id(), trackVersion(), extracted("P2", null)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scoreWriting.instrumentNotConfigured");
                assertThat(error.getArgs().values()).containsEntry("instrument", "Clarinetto soprano 1°");
            });
        assertThat(count("sheet_music")).isEqualTo(3);
        // Percussion rows and instruments with a transposition are extracted.
        assertThat(extract(concert.id(), trackVersion(), extracted("P1", bassPartId), extracted("P3", percussionPartId)).parts()).hasSize(2);
    }

    @Test
    void removingTheScoreLeavesThePartsAndTheCleanupKeepsTheVersionsInUse() {
        create(List.of(row("P1", bassPartId, bass), row("P2", null, clarinet), row("P3", percussionPartId, drum, bassDrum)));
        inTenant(() -> arrangementService.acquireLock(trackId, MARIO_EDITOR, false, mario()));
        ArrangementVersionDTO first = saveVersion(score(false, 1), null, false, false);
        ExtractionResultDTO extraction = extract(first.id(), trackVersion(), extracted("P1", bassPartId));
        ArrangementVersionDTO second = saveVersion(score(false, 1), first.id(), false, false);
        ArrangementVersionDTO third = saveVersion(score(false, 1), second.id(), false, false);

        assertThat(inTenant(() -> arrangementVersionRepository.findRemovableIds(1))).containsExactly(second.id());

        inTenant(() -> arrangementService.saveDraft(trackId, new ArrangementDraftRequestDTO(MARIO_EDITOR, score(false, 2), rows(), third.id(), null), mario()));
        assertError(() -> inTenant(() -> {
            arrangementService.delete(trackId, null, lucia());
            return null;
        }), "scoreWriting.locked");
        List<Long> media = jdbcTemplate.queryForList("SELECT media_asset_id FROM " + schema() + ".arrangement_version", Long.class);
        inTenant(() -> {
            arrangementService.delete(trackId, MARIO_EDITOR, mario());
            return null;
        });

        assertThat(inTenant(() -> arrangementService.get(trackId))).isEmpty();
        assertError(() -> inTenant(() -> arrangementService.draft(trackId)), "scoreWriting.arrangementNotFound");
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + schema() + ".arrangement_version WHERE deleted = false", Long.class)).isZero();
        assertThat(count("score_draft")).isZero();
        assertThat(count("score_edit_lock")).isZero();
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + schema() + ".sheet_music WHERE arrangement_row IS NOT NULL", Long.class)).isZero();
        assertThat(jdbcTemplate.queryForObject("SELECT deleted FROM " + schema() + ".score_version WHERE id = ?", Boolean.class, extraction.parts().get(0).versionId()))
            .isFalse();
        assertThat(media).hasSize(3).allSatisfy(id -> assertThat(
            jdbcTemplate.queryForObject("SELECT deleted FROM " + schema() + ".media_asset WHERE id = ?", Boolean.class, id)
        ).isTrue());

        // A new score can be written, and its draft goes with its track.
        create(List.of(row("P1", bassPartId, bass), row("P2", null, clarinet), row("P3", null, drum, bassDrum)));
        assertThat(cleanup.cleanup(tenantCode).drafts()).isZero();
        jdbcTemplate.update("UPDATE " + schema() + ".track SET deleted = true WHERE id = ?", trackId);
        assertThat(cleanup.cleanup(tenantCode).drafts()).isEqualTo(1);
        assertThat(count("score_draft")).isZero();
    }

    private ArrangementDTO create(List<ArrangementRowRequestDTO> rows) {
        return inTenant(() -> arrangementService.create(trackId, new NewArrangementDTO(score(false, 1), rows), mario()));
    }

    private ArrangementVersionDTO saveVersion(String content, Long parentVersionId, boolean approve, boolean confirmOutdated) {
        return inTenant(() -> arrangementVersionService.save(
            trackId,
            new ArrangementVersionRequestDTO(MARIO_EDITOR, content, rows(), parentVersionId, approve, confirmOutdated),
            mario()
        ));
    }

    private ExtractionResultDTO extract(Long versionId, Long trackVersion, ExtractedRowDTO... rows) {
        return extract(versionId, trackVersion, new ExtractionRequestDTO(trackVersion, List.of(rows)));
    }

    private ExtractionResultDTO extract(Long versionId, Long trackVersion, ExtractionRequestDTO request) {
        return inTenant(() -> extractionService.extract(trackId, versionId, request, mario()));
    }

    private static ExtractedRowDTO extracted(String row, Long partId) {
        return new ExtractedRowDTO(row, partId, null, single(row));
    }

    private List<String> statuses() {
        return inTenant(() -> arrangementService.get(trackId)).orElseThrow().rows().stream().map(row -> row.id() + " " + row.status()).toList();
    }

    private List<ArrangementRowRequestDTO> rows() {
        return List.of(row("P1", null, bass), row("P2", null, clarinet), row("P3", null, drum, bassDrum));
    }

    private static ArrangementRowRequestDTO row(String id, Long scoreId, Long... instrumentIds) {
        return new ArrangementRowRequestDTO(id, List.of(instrumentIds), scoreId);
    }

    /** A score with a bass, a clarinet and a percussion row of the given measures. */
    private static String score(boolean concertPitch, int measures) {
        StringBuilder score = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?><score-partwise version=\"4.0\">");
        if (concertPitch) score.append("<defaults><concert-score/></defaults>");
        score.append("<part-list><score-part id=\"P1\"><part-name>Basso</part-name></score-part>")
            .append("<score-part id=\"P2\"><part-name>Clarinetto</part-name></score-part>")
            .append("<score-part id=\"P3\"><part-name>Percussioni</part-name></score-part></part-list>");
        for (String part : List.of("P1", "P2", "P3")) score.append("<part id=\"").append(part).append("\">").append(measures(measures)).append("</part>");
        return score.append("</score-partwise>").toString();
    }

    private static String single(String name) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><score-partwise version=\"4.0\"><part-list><score-part id=\"P1\"><part-name>" + name
            + "</part-name></score-part></part-list><part id=\"P1\">" + measures(1) + "</part></score-partwise>";
    }

    private static String measures(int count) {
        StringBuilder measures = new StringBuilder();
        for (int number = 1; number <= count; number++) {
            measures.append("<measure number=\"").append(number).append("\">");
            if (number == 1) measures.append("<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>");
            measures.append("<note><rest/><duration>2</duration><type>half</type></note></measure>");
        }
        return measures.toString();
    }

    private void assertError(ThrowingCallable action, String errorKey) {
        assertThatThrownBy(action).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo(errorKey));
    }

    private void assertReason(ThrowingCallable action, String reason) {
        assertThatThrownBy(action).isInstanceOfSatisfying(RequestAlertException.class, error -> {
            assertThat(error.getErrorKey()).isEqualTo("scoreWriting.extractionInvalid");
            assertThat(error.getArgs().values()).containsEntry("reason", reason);
        });
    }

    private Long trackVersion() {
        return inTenant(() -> entityManager.find(Tracks.class, trackId).getEntityVersion());
    }

    private String arrangementRow(Long partId) {
        return jdbcTemplate.queryForObject("SELECT arrangement_row FROM " + schema() + ".sheet_music WHERE id = ?", String.class, partId);
    }

    private Instruments instrument(String name) {
        return entityManager.createQuery("select i from Instruments i where i.name = :name", Instruments.class).setParameter("name", name).getSingleResult();
    }

    private static SheetsMusic part(Tracks track, Instruments... instruments) {
        SheetsMusic part = new SheetsMusic();
        part.getInstruments().addAll(List.of(instruments));
        track.getScores().add(part);
        return part;
    }

    private <T> T inTenant(Supplier<T> action) {
        return transactionExecutor.execute(tenantCode, action);
    }

    private long count(String table) {
        return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + schema() + "." + table, Long.class);
    }

    private String schema() {
        return '"' + schemaNameResolver.resolve(tenantCode).replace("\"", "\"\"") + '"';
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

    private JwtAuthenticationToken mario() {
        return archivist("mario", "Mario", "Rossi");
    }

    private JwtAuthenticationToken lucia() {
        return archivist("lucia", "Lucia", "Bianchi");
    }

    private JwtAuthenticationToken archivist(String subject, String firstName, String lastName) {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject(subject).claim("tenant", tenantCode)
            .claim("given_name", firstName).claim("family_name", lastName).issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(AuthoritiesConstants.ARCHIVIST)));
    }
}
