package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.IntegrationTest;
import com.fundaro.zodiac.taurus.domain.CommonFieldsOpenSearch;
import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaNameResolver;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.CorrectionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PartPlaybackDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSavedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.NewWrittenPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ScoreDraftDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.WrittenPartDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionService;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import jakarta.persistence.EntityManager;
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

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Edit lock, drafts and written versions on a real tenant schema: the migration, the advisory lock, the unique target
 * of locks and drafts, and the nightly cleanup.
 */
@IntegrationTest
@TestPropertySource(
    properties = {
        "application.base-path=target/score-writing-it-storage",
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
class ScoreWritingIT {

    private static final String MARIO_EDITOR = "mario-editor-window";
    private static final String LUCIA_EDITOR = "lucia-editor-window";
    private static final String TUBA = """
        <?xml version="1.0" encoding="UTF-8"?>
        <score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Basso</part-name></score-part></part-list>
          <part id="P1">
            <measure number="1">
              <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
              <note><pitch><step>D</step><octave>2</octave></pitch><duration>2</duration><type>half</type></note>
            </measure>
          </part>
        </score-partwise>
        """;

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
    private ScoreEditLockService lockService;

    @Autowired
    private ScoreDraftService draftService;

    @Autowired
    private ScoreVersionService versionService;

    @Autowired
    private ScorePlaybackService playbackService;

    @Autowired
    private ScoreWritingCleanup cleanup;

    @Autowired
    private WrittenPartService writtenPartService;

    private final String tenantCode = "score-writing-it-" + UUID.randomUUID();
    private Long tenantId;
    private Long trackId;
    private Long partId;

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
            Instruments bass = entityManager.createQuery("select i from Instruments i where i.name = 'Basso 1°'", Instruments.class).getSingleResult();
            Tracks track = audited(new Tracks(), "Marcia funebre");
            track.setState(StateEnum.COMPLETE);
            SheetsMusic part = new SheetsMusic();
            part.getInstruments().add(bass);
            track.getScores().add(part);
            entityManager.persist(track);
            entityManager.flush();
            trackId = track.getId();
            partId = part.getId();
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
    void oneAuthorAtATimeUntilSomeoneTakesOver() {
        EditLockDTO mario = inTenant(() -> lockService.acquire(trackId, partId, MARIO_EDITOR, false, archivist("mario", "Mario", "Rossi")));
        assertThat(mario.mine()).isTrue();

        assertThatThrownBy(() -> inTenant(() -> lockService.acquire(trackId, partId, LUCIA_EDITOR, false, archivist("lucia", "Lucia", "Bianchi"))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scoreWriting.locked");
                assertThat(error.getArgs().values()).containsEntry("ownerName", "Mario Rossi").containsEntry("sameUser", false);
            });
        PartPlaybackDTO watched = part(inTenant(() -> playbackService.overview(trackId, archivist("lucia", "Lucia", "Bianchi"))).parts());
        assertThat(watched.editing()).isNotNull();
        assertThat(watched.editing().ownerName()).isEqualTo("Mario Rossi");

        EditLockDTO lucia = inTenant(() -> lockService.acquire(trackId, partId, LUCIA_EDITOR, true, archivist("lucia", "Lucia", "Bianchi")));
        assertThat(lucia.ownerName()).isEqualTo("Lucia Bianchi");
        assertThatThrownBy(() -> inTenant(() -> lockService.renew(trackId, partId, MARIO_EDITOR, archivist("mario", "Mario", "Rossi"))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("ownerName", "Lucia Bianchi"));
        assertThat(count("score_edit_lock")).isEqualTo(1);

        assertThatThrownBy(() -> jdbcTemplate.update(
            "INSERT INTO " + schema() + ".score_edit_lock (target_type, target_id, owner, owner_session, acquired_at, heartbeat_at, expires_at, "
                + "insert_date, insert_by, edit_date, edit_by) VALUES ('PART', ?, 'x', 'session-x', now(), now(), now() + interval '2 minutes', now(), 'x', now(), 'x')",
            partId
        )).isInstanceOf(DataIntegrityViolationException.class);

        transactionExecutor.execute(tenantCode, () -> lockService.release(trackId, partId, LUCIA_EDITOR));
        assertThat(count("score_edit_lock")).isZero();
    }

    @Test
    void aDraftBecomesAWrittenVersionThatReplacesIt() {
        inTenant(() -> lockService.acquire(trackId, partId, MARIO_EDITOR, false, archivist("mario", "Mario", "Rossi")));
        DraftSavedDTO first = inTenant(() -> draftService.save(trackId, partId, new DraftRequestDTO(MARIO_EDITOR, TUBA, null, null), archivist("mario", "Mario", "Rossi")));
        DraftSavedDTO second = inTenant(() -> draftService.save(
            trackId, partId, new DraftRequestDTO(MARIO_EDITOR, TUBA.replace("<octave>2</octave>", "<octave>3</octave>"), null, first.entityVersion()), archivist("mario", "Mario", "Rossi")
        ));
        assertThat(second.entityVersion()).isGreaterThan(first.entityVersion());
        assertThatThrownBy(() -> inTenant(() -> draftService.save(trackId, partId, new DraftRequestDTO(MARIO_EDITOR, TUBA, null, first.entityVersion()), archivist("mario", "Mario", "Rossi"))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.draftConflict"));

        ScoreDraftDTO draft = inTenant(() -> draftService.get(trackId, partId)).orElseThrow();
        assertThat(draft.content()).contains("<octave>3</octave>").contains("Basso");
        assertThat(draft.outdated()).isFalse();
        assertThat(part(inTenant(() -> playbackService.overview(trackId, archivist("lucia", "Lucia", "Bianchi"))).parts()).draft()).isNotNull();
        assertThatThrownBy(() -> inTenant(() -> {
            draftService.discard(trackId, partId, null, archivist("lucia", "Lucia", "Bianchi"));
            return null;
        })).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.locked"));

        ScoreVersionDTO written = inTenant(() -> versionService.correct(
            trackId, partId, new CorrectionDTO(null, draft.content(), true, null, ScoreVersionOrigin.WRITING, MARIO_EDITOR, false), archivist("mario", "Mario", "Rossi")
        ));

        assertThat(written.origin()).isEqualTo(ScoreVersionOrigin.WRITING);
        assertThat(written.current()).isTrue();
        assertThat(written.pagesChanged()).isFalse();
        assertThat(inTenant(() -> draftService.get(trackId, partId))).isEmpty();
        PartPlaybackDTO played = part(inTenant(() -> playbackService.overview(trackId, archivist("lucia", "Lucia", "Bianchi"))).parts());
        assertThat(played.version().origin()).isEqualTo(ScoreVersionOrigin.WRITING);
        assertThat(played.draft()).isNull();

        assertThatThrownBy(() -> inTenant(() -> versionService.correct(
            trackId, partId, new CorrectionDTO(null, TUBA, false, null, ScoreVersionOrigin.WRITING, MARIO_EDITOR, false), archivist("mario", "Mario", "Rossi")
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.draftOutdated"));
    }

    @Test
    void theCleanupRemovesExpiredLocksAndTheDraftsOfRemovedParts() {
        inTenant(() -> lockService.acquire(trackId, partId, MARIO_EDITOR, false, archivist("mario", "Mario", "Rossi")));
        inTenant(() -> draftService.save(trackId, partId, new DraftRequestDTO(MARIO_EDITOR, TUBA, null, null), archivist("mario", "Mario", "Rossi")));

        assertThat(cleanup.cleanup(tenantCode)).isEqualTo(new ScoreWritingCleanup.Removed(0, 0));

        jdbcTemplate.update(
            "UPDATE " + schema() + ".score_edit_lock SET heartbeat_at = now() - interval '10 minutes', expires_at = now() - interval '8 minutes'"
        );
        jdbcTemplate.update("UPDATE " + schema() + ".sheet_music SET deleted = true WHERE id = ?", partId);

        assertThat(cleanup.cleanup(tenantCode)).isEqualTo(new ScoreWritingCleanup.Removed(1, 1));
        assertThat(count("score_edit_lock")).isZero();
        assertThat(count("score_draft")).isZero();
    }

    @Test
    void forgetsTheDraftsAndLocksOfPartsRemovedFromTheirTrack() {
        inTenant(() -> lockService.acquire(trackId, partId, MARIO_EDITOR, false, archivist("mario", "Mario", "Rossi")));
        inTenant(() -> draftService.save(trackId, partId, new DraftRequestDTO(MARIO_EDITOR, TUBA, null, null), archivist("mario", "Mario", "Rossi")));

        transactionExecutor.execute(tenantCode, () -> cleanup.forgetParts(List.of(partId)));

        assertThat(count("score_edit_lock")).isZero();
        assertThat(count("score_draft")).isZero();
    }

    @Test
    void aPartWrittenFromScratchStartsAsADraftAtTheEndOfTheTrack() {
        Long version = inTenant(() -> entityManager.find(Tracks.class, trackId).getEntityVersion());
        Long bass = inTenant(() -> entityManager.createQuery("select i.id from Instruments i where i.name = 'Basso 1°'", Long.class).getSingleResult());

        assertThatThrownBy(() -> inTenant(() -> writtenPartService.create(
            trackId, new NewWrittenPartDTO("Basso 2°", List.of(bass), TUBA, version + 1), archivist("mario", "Mario", "Rossi")
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("version.conflict"));
        assertThatThrownBy(() -> inTenant(() -> writtenPartService.create(
            trackId, new NewWrittenPartDTO("Basso 2°", List.of(bass, -1L), TUBA, version), archivist("mario", "Mario", "Rossi")
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.instrumentNotFound"));
        assertThatThrownBy(() -> inTenant(() -> writtenPartService.create(
            trackId, new NewWrittenPartDTO("Basso 2°", List.of(bass), "<score-partwise/>", version), archivist("mario", "Mario", "Rossi")
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.contentInvalid"));
        assertThat(count("sheet_music")).isEqualTo(1);

        WrittenPartDTO created = inTenant(() -> writtenPartService.create(
            trackId, new NewWrittenPartDTO("  Basso 2°  ", List.of(bass, bass), TUBA, version), archivist("mario", "Mario", "Rossi")
        ));

        assertThat(created.trackVersion()).isEqualTo(inTenant(() -> entityManager.find(Tracks.class, trackId).getEntityVersion())).isNotEqualTo(version);
        Tracks track = inTenant(() -> {
            Tracks found = entityManager.find(Tracks.class, trackId);
            found.getScores().forEach(score -> {
                score.getInstruments().size();
                score.getMedia().size();
            });
            return found;
        });
        assertThat(track.getScores()).extracting(SheetsMusic::getId).containsExactly(partId, created.scoreId());
        SheetsMusic written = track.getScores().get(1);
        assertThat(written.getDescription()).isEqualTo("Basso 2°");
        assertThat(written.getMedia()).isEmpty();
        assertThat(written.getInstruments()).extracting(Instruments::getId).containsExactly(bass);
        ScoreDraftDTO draft = inTenant(() -> draftService.get(trackId, created.scoreId())).orElseThrow();
        assertThat(draft.baseVersionId()).isNull();
        // The author's name comes from the users of the tenant: here only the column says who saved it.
        assertThat(jdbcTemplate.queryForObject("SELECT saved_by FROM " + schema() + ".score_draft WHERE target_id = ?", String.class, created.scoreId()))
            .isEqualTo("mario");
        assertThat(draft.measureCount()).isEqualTo(1);
        assertThat(draft.outdated()).isFalse();
        PartPlaybackDTO listed = inTenant(() -> playbackService.overview(trackId, archivist("lucia", "Lucia", "Bianchi"))).parts().stream()
            .filter(part -> part.scoreId().equals(created.scoreId())).findFirst().orElseThrow();
        assertThat(listed.draft()).isNotNull();
        assertThat(listed.version()).isNull();
        assertThat(listed.hasPages()).isFalse();

        // The editor opens with the lock and replaces the first draft.
        inTenant(() -> lockService.acquire(trackId, created.scoreId(), MARIO_EDITOR, false, archivist("mario", "Mario", "Rossi")));
        DraftSavedDTO saved = inTenant(() -> draftService.save(
            trackId, created.scoreId(), new DraftRequestDTO(MARIO_EDITOR, TUBA, null, draft.entityVersion()), archivist("mario", "Mario", "Rossi")
        ));
        assertThat(saved.entityVersion()).isGreaterThan(draft.entityVersion());
    }

    private <T> T inTenant(java.util.function.Supplier<T> action) {
        return transactionExecutor.execute(tenantCode, action);
    }

    private PartPlaybackDTO part(List<PartPlaybackDTO> parts) {
        return parts.stream().filter(part -> part.scoreId().equals(partId)).findFirst().orElseThrow();
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

    private JwtAuthenticationToken archivist(String subject, String firstName, String lastName) {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject(subject).claim("tenant", tenantCode)
            .claim("given_name", firstName).claim("family_name", lastName).issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(AuthoritiesConstants.ARCHIVIST)));
    }
}
