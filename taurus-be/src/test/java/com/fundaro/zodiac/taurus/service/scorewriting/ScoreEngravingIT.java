package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.IntegrationTest;
import com.fundaro.zodiac.taurus.domain.CommonFieldsOpenSearch;
import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.Media;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.enumeration.MediaAssetStatus;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJob;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaNameResolver;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEngravingJobRepository;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PartPlaybackDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ApplyEngravingDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingAppliedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingFormat;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingHeaderDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingJobDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingOptionsDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingTarget;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.MeasureNumbers;
import com.fundaro.zodiac.taurus.service.impl.TenantStorageService;
import com.fundaro.zodiac.taurus.service.scoreplayback.FakeOmrServer;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionService;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verify;

@IntegrationTest
@TestPropertySource(
    properties = {
        "application.base-path=target/score-engraving-it-storage",
        "spring.liquibase.contexts=test",
        "spring.datasource.hikari.maximum-pool-size=4",
        "spring.datasource.hikari.minimum-idle=1",
        "spring.security.oauth2.client.registration.oidc.client-id=test",
        "spring.security.oauth2.client.registration.oidc.client-secret=test",
        "application.omr.api-key=it-service-key-0123456789",
    }
)
class ScoreEngravingIT {

    private static final FakeOmrServer OMR = start();
    private static final String TUBA = """
        <score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tuba</part-name></score-part></part-list>
        <part id="P1">
          <measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
            <note><pitch><step>D</step><octave>2</octave></pitch><duration>2</duration></note></measure>
        </part></score-partwise>
        """;
    private static final byte[] PNG = { (byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 1, 2, 3 };

    @MockitoBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ScoreEngravingQueue queue;

    private final String tenantCode = "score-engraving-it-" + UUID.randomUUID();

    @Autowired
    private TenantSchemaProvisioningService provisioningService;

    @Autowired
    private TenantSchemaNameResolver schemaNameResolver;

    @Autowired
    private TenantTransactionExecutor transactionExecutor;

    @Autowired
    private TenantStorageService storageService;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ScoreEngravingService engravingService;

    @Autowired
    private ScoreEngravingWorker worker;

    @Autowired
    private ScoreEngravingRecovery recovery;

    @Autowired
    private ScoreWritingCleanup cleanup;

    @Autowired
    private ScoreVersionService versionService;

    @Autowired
    private ScorePlaybackService playbackService;

    @Autowired
    private ScoreEngravingJobRepository jobRepository;

    @Autowired
    private TracksRepository tracksRepository;

    private Long trackId;
    private Long partId;
    private Long scanId;
    private Long versionId;

    @DynamicPropertySource
    static void musicService(DynamicPropertyRegistry registry) {
        registry.add("application.omr.url", OMR::url);
    }

    @AfterAll
    static void stopMusicService() {
        OMR.close();
    }

    @BeforeEach
    void provisionTenant() {
        OMR.reset();
        clearInvocations(queue);
        provisioningService.provision(tenantCode);
        inTenant(() -> {
            Instruments tuba = entityManager.createQuery("select i from Instruments i where i.name = 'Basso 1°'", Instruments.class).getSingleResult();
            Tracks track = audited(new Tracks(), "Marcia dell'impaginazione");
            track.setState(StateEnum.COMPLETE);
            SheetsMusic part = new SheetsMusic();
            part.setDescription("Basso in Do");
            part.getInstruments().add(tuba);
            Media scan = page("scansione");
            part.getMedia().add(scan);
            track.getScores().add(part);
            entityManager.persist(track);
            entityManager.flush();
            trackId = track.getId();
            partId = part.getId();
            scanId = scan.getId();
            return null;
        });
        versionId = inTenant(() -> versionService.upload(trackId, partId, musicXml(), null, true, archivist()).id());
    }

    @AfterEach
    void dropTenant() throws IOException {
        provisioningService.dropSchema(tenantCode);
        storageService.deleteTenantDirectory(tenantCode);
    }

    @Test
    void engravesAVersionAndReplacesThePagesOfThePart() {
        OMR.answer("/v1/engravings", 200, "application/json", engraving(2));
        EngravingOptionsDTO options = new EngravingOptionsDTO(
            EngravingFormat.MARCH,
            5.6,
            null,
            new EngravingHeaderDTO("  Marcia dell'impaginazione ", "   ", null, "Basso in Do"),
            true,
            MeasureNumbers.EVERY
        );

        EngravingJobDTO queued = inTenant(() -> engravingService.start(trackId, partId, versionId, options, archivist()));

        assertThat(queued.status()).isEqualTo(ScoreEngravingJobStatus.QUEUED);
        assertThat(queued.options().header().title()).isEqualTo("Marcia dell'impaginazione");
        assertThat(queued.options().header().composer()).isNull();
        verify(queue).publishAfterCommit(tenantCode, queued.id());
        assertThatThrownBy(() -> inTenant(() -> engravingService.start(trackId, partId, versionId, null, archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.engravingRunning"));

        worker.run(tenantCode, queued.id());
        worker.run(tenantCode, queued.id());

        assertThat(OMR.received()).singleElement().satisfies(request -> {
            assertThat(request.key()).isEqualTo("it-service-key-0123456789");
            String body = new String(request.body(), StandardCharsets.ISO_8859_1);
            assertThat(body).contains("name=\"score\"").contains("\"format\":\"MARCH\"").contains("\"staffSize\":5.6").contains("\"measureNumbers\":\"EVERY\"");
            assertThat(body).doesNotContain("composer").doesNotContain("\"margin\"");
        });
        EngravingJobDTO done = inTenant(() -> engravingService.latest(trackId, partId, versionId)).orElseThrow();
        assertThat(done.status()).isEqualTo(ScoreEngravingJobStatus.DONE);
        assertThat(done.pageCount()).isEqualTo(2);
        assertThat(done.pages()).hasSize(2);
        assertThat(done.pdf()).isTrue();
        assertThat(job(done.id()).getEngineVersion()).isEqualTo("6.4.1");
        assertThat(mediaName(done.pages().get(1))).isEqualTo("basso-in-do-pagina-2.png");

        Long staleVersion = trackVersion() - 1;
        assertThatThrownBy(() -> inTenant(() -> engravingService.apply(trackId, partId, versionId, done.id(), new ApplyEngravingDTO(EngravingTarget.REPLACE, staleVersion), archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("version.conflict"));

        EngravingAppliedDTO applied = inTenant(() -> engravingService.apply(trackId, partId, versionId, done.id(), new ApplyEngravingDTO(EngravingTarget.REPLACE, trackVersion()), archivist()));

        assertThat(applied.scoreId()).isEqualTo(partId);
        assertThat(applied.trackVersion()).isEqualTo(trackVersion());
        assertThat(pages(partId)).containsExactlyElementsOf(done.pages());
        assertThat(deleted(scanId)).isTrue();
        PartPlaybackDTO part = inTenant(() -> playbackService.overview(trackId, archivist())).parts().get(0);
        assertThat(part.engravedFromVersionId()).isEqualTo(versionId);
        assertThat(inTenant(() -> engravingService.latest(trackId, partId, versionId)).orElseThrow()).satisfies(job -> {
            assertThat(job.pages()).isEmpty();
            assertThat(job.appliedScoreId()).isEqualTo(partId);
            assertThat(job.appliedAt()).isNotNull();
        });
        assertThatThrownBy(() -> inTenant(() -> engravingService.apply(trackId, partId, versionId, done.id(), new ApplyEngravingDTO(EngravingTarget.REPLACE, null), archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.engravingNotReady"));

        MediaService.MediaContent pdf = inTenant(() -> engravingService.pdf(trackId, partId, versionId, archivist()));
        assertThat(new String(pdf.bytes(), StandardCharsets.US_ASCII)).startsWith("%PDF-");
        assertThat(pdf.fileName()).isEqualTo("basso-in-do.pdf");

        // Pages engraved again and assigned again: the earlier pages and PDF are no longer used.
        Long again = inTenant(() -> engravingService.start(trackId, partId, versionId, null, archivist())).id();
        worker.run(tenantCode, again);
        inTenant(() -> engravingService.apply(trackId, partId, versionId, again, new ApplyEngravingDTO(EngravingTarget.REPLACE, null), archivist()));
        assertThat(done.pages()).allSatisfy(page -> assertThat(deleted(page)).isTrue());
        assertThat(job(done.id()).getPdfMediaAssetId()).isNull();
    }

    @Test
    void addsTheEngravedPagesToANewPartAndReleasesTheSupersededOnes() {
        OMR.answer("/v1/engravings", 200, "application/json", engraving(1));
        Long first = engrave();
        EngravingJobDTO older = inTenant(() -> engravingService.latest(trackId, partId, versionId)).orElseThrow();
        Long second = engrave();

        assertThat(job(first).getPageMediaIds()).isEmpty();
        assertThat(job(first).getPdfMediaAssetId()).isNull();
        assertThat(older.pages()).allSatisfy(page -> assertThat(deleted(page)).isTrue());
        assertThatThrownBy(() -> inTenant(() -> engravingService.apply(trackId, partId, versionId, first, new ApplyEngravingDTO(EngravingTarget.NEW_PART, null), archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.engravingNotReady"));
        List<Long> engraved = job(second).getPageMediaIds();

        EngravingAppliedDTO applied = inTenant(() -> engravingService.apply(trackId, partId, versionId, second, new ApplyEngravingDTO(EngravingTarget.NEW_PART, trackVersion()), archivist()));

        assertThat(applied.scoreId()).isNotEqualTo(partId);
        assertThat(pages(partId)).containsExactly(scanId);
        assertThat(pages(applied.scoreId())).containsExactlyElementsOf(engraved);
        inTenant(() -> {
            SheetsMusic created = tracksRepository.findByIdAndDeletedFalse(trackId).orElseThrow().getScores().stream()
                .filter(score -> score.getId().equals(applied.scoreId()))
                .findFirst()
                .orElseThrow();
            assertThat(created.getDescription()).isEqualTo("Basso in Do");
            assertThat(created.getInstruments()).extracting(Instruments::getName).containsExactly("Basso 1°");
            assertThat(created.getEngravedFromVersionId()).isEqualTo(versionId);
            return null;
        });
        assertThat(inTenant(() -> playbackService.overview(trackId, archivist())).parts()).extracting(PartPlaybackDTO::engravedFromVersionId)
            .containsExactly(null, versionId);
    }

    @Test
    void endsTheJobWithTheReasonOfTheService() {
        OMR.answer("/v1/engravings", 422, "application/json", "{\"code\":\"unreadableScore\"}");
        Long unreadable = engrave();
        assertThat(job(unreadable)).satisfies(job -> {
            assertThat(job.getStatus()).isEqualTo(ScoreEngravingJobStatus.FAILED);
            assertThat(job.getErrorCode()).isEqualTo("unreadableScore");
        });

        OMR.answer("/v1/engravings", 200, "application/json", engraving(2).replace("\"pageCount\":2", "\"pageCount\":3"));
        assertThat(job(engrave()).getErrorCode()).isEqualTo("engineFailed");

        OMR.answer("/v1/engravings", 500, "application/json", "{\"code\":\"engineTimeout\"}");
        assertThat(job(engrave()).getErrorCode()).isEqualTo("engineTimeout");

        jdbcTemplate.update("UPDATE " + schema() + ".score_version SET deleted = TRUE WHERE id = ?", versionId);
        Long orphan = inTenant(() -> {
            ScoreEngravingJob job = new ScoreEngravingJob();
            job.initializeAudit("test");
            job.setSheetMusicId(partId);
            job.setTrackId(trackId);
            job.setScoreVersionId(versionId);
            job.setOptionsJson("{}");
            job.setStatus(ScoreEngravingJobStatus.QUEUED);
            job.setRequestedBy("test");
            return jobRepository.saveAndFlush(job).getId();
        });
        worker.run(tenantCode, orphan);
        assertThat(job(orphan).getErrorCode()).isEqualTo("versionNotFound");
    }

    @Test
    void refusesOptionsOutOfRangeAndVersionsOfOtherParts() {
        assertThatThrownBy(() -> inTenant(() -> engravingService.start(trackId, partId, versionId, new EngravingOptionsDTO(null, 12.0, null, null, null, null), archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scoreWriting.engravingOptionsInvalid");
                assertThat(error.getArgs().values()).containsEntry("field", "staffSize");
            });
        EngravingHeaderDTO longTitle = new EngravingHeaderDTO("x".repeat(201), null, null, null);
        assertThatThrownBy(() -> inTenant(() -> engravingService.start(trackId, partId, versionId, new EngravingOptionsDTO(null, null, 2.0, longTitle, null, null), archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("field", "margin"));
        assertThatThrownBy(() -> inTenant(() -> engravingService.start(trackId, partId, versionId, new EngravingOptionsDTO(null, null, null, longTitle, null, null), archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("field", "header.title"));
        assertThatThrownBy(() -> inTenant(() -> engravingService.start(trackId, partId, versionId + 1000, null, archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.version.notFound"));
        assertThatThrownBy(() -> inTenant(() -> engravingService.pdf(trackId, partId, versionId, archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.engravingNotFound"));
        assertThat(inTenant(() -> engravingService.latest(trackId, partId, versionId))).isEmpty();
        assertThatThrownBy(() -> inTenant(() -> engravingService.apply(trackId, partId, versionId, 1L, new ApplyEngravingDTO(null, null), archivist())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getArgs().values()).containsEntry("field", "target"));
        assertThat(OMR.received()).isEmpty();
    }

    @Test
    void queuesInterruptedJobsAgainAndReleasesThePagesNobodyAssigned() {
        Long interrupted = inTenant(() -> engravingService.start(trackId, partId, versionId, null, archivist())).id();
        jdbcTemplate.update(
            "UPDATE " + schema() + ".score_engraving_job SET status = 'RUNNING', attempts = 1, started_at = now() - interval '1 hour' WHERE id = ?",
            interrupted
        );
        clearInvocations(queue);

        recovery.recover(tenantCode, ZonedDateTime.now());

        assertThat(job(interrupted).getStatus()).isEqualTo(ScoreEngravingJobStatus.QUEUED);
        verify(queue).publishAfterCommit(tenantCode, interrupted);

        jdbcTemplate.update(
            "UPDATE " + schema() + ".score_engraving_job SET status = 'RUNNING', attempts = 3, started_at = now() - interval '1 hour' WHERE id = ?",
            interrupted
        );
        recovery.recover(tenantCode, ZonedDateTime.now());
        assertThat(job(interrupted)).satisfies(job -> {
            assertThat(job.getStatus()).isEqualTo(ScoreEngravingJobStatus.FAILED);
            assertThat(job.getErrorCode()).isEqualTo("interrupted");
        });

        OMR.answer("/v1/engravings", 200, "application/json", engraving(1));
        Long forgotten = engrave();
        List<Long> files = List.of(job(forgotten).getPageMediaIds().get(0), job(forgotten).getPdfMediaAssetId());
        assertThat(cleanup.cleanup(tenantCode).engravedFiles()).isZero();
        jdbcTemplate.update("UPDATE " + schema() + ".score_engraving_job SET finished_at = now() - interval '8 days' WHERE id = ?", forgotten);

        assertThat(cleanup.cleanup(tenantCode).engravedFiles()).isEqualTo(2);

        assertThat(files).allSatisfy(file -> assertThat(deleted(file)).isTrue());
        assertThat(job(forgotten).getPageMediaIds()).isEmpty();
        assertThat(job(forgotten).getStatus()).isEqualTo(ScoreEngravingJobStatus.DONE);
    }

    private Long engrave() {
        Long id = inTenant(() -> engravingService.start(trackId, partId, versionId, null, archivist())).id();
        worker.run(tenantCode, id);
        return id;
    }

    private static String engraving(int pages) {
        String page = '"' + Base64.getEncoder().encodeToString(PNG) + '"';
        String pdf = Base64.getEncoder().encodeToString("%PDF-1.4 impaginata".getBytes(StandardCharsets.US_ASCII));
        return """
            {"engine":"VEROVIO","version":"6.4.1","durationMillis":640,"pageCount":%d,"pdf":"%s","pages":[%s]}
            """.formatted(pages, pdf, String.join(",", java.util.Collections.nCopies(pages, page)));
    }

    private ScoreEngravingJob job(Long id) {
        return inTenant(() -> {
            ScoreEngravingJob job = jobRepository.findById(id).orElseThrow();
            job.getPageMediaIds().size();
            return job;
        });
    }

    private List<Long> pages(Long scoreId) {
        return jdbcTemplate.queryForList(
            "SELECT media_asset_id FROM " + schema() + ".sheet_music_media WHERE sheet_music_id = ? AND deleted = FALSE ORDER BY display_order",
            Long.class,
            scoreId
        );
    }

    private boolean deleted(Long mediaId) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject("SELECT deleted FROM " + schema() + ".media_asset WHERE id = ?", Boolean.class, mediaId));
    }

    private String mediaName(Long mediaId) {
        return jdbcTemplate.queryForObject("SELECT original_filename FROM " + schema() + ".media_asset WHERE id = ?", String.class, mediaId);
    }

    private Long trackVersion() {
        return jdbcTemplate.queryForObject("SELECT entity_version FROM " + schema() + ".track WHERE id = ?", Long.class, trackId);
    }

    private Media page(String name) {
        byte[] content = (name + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);
        Media media = audited(new Media(), name);
        media.setStorageKey("scores/" + UUID.randomUUID() + "/" + name + ".png");
        media.setOriginalFilename(name + ".png");
        media.setMimeType("image/png");
        media.setFileExtension("png");
        media.setFileSize(content.length);
        media.setSha256("0".repeat(64));
        media.setStatus(MediaAssetStatus.READY);
        try {
            storageService.writeAtomically(tenantCode, media.getStorageKey(), content);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
        entityManager.persist(media);
        return media;
    }

    private <T> T inTenant(Supplier<T> action) {
        return transactionExecutor.execute(tenantCode, action);
    }

    private String schema() {
        return '"' + schemaNameResolver.resolve(tenantCode).replace("\"", "\"\"") + '"';
    }

    private static MockMultipartFile musicXml() {
        return new MockMultipartFile("file", "basso.musicxml", "application/xml", TUBA.getBytes(StandardCharsets.UTF_8));
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

    private JwtAuthenticationToken archivist() {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("engraving-archivist").claim("tenant", tenantCode)
            .issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(AuthoritiesConstants.ARCHIVIST)));
    }

    private static FakeOmrServer start() {
        try {
            return new FakeOmrServer();
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }
}
