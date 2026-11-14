package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.Users;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreDraft;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.repository.UsersRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreDraftRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreDraftRepository.DraftSummary;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSavedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSummaryDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ScoreDraftDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScoreDraftServiceTest {

    private static final String SESSION = "session-of-mario";
    private static final String TUBA = """
        <?xml version="1.0" encoding="UTF-8"?>
        <score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Tuba</part-name></score-part></part-list>
          <part id="P1">
            <measure number="1"><note><pitch><step>D</step><octave>2</octave></pitch><duration>4</duration><type>half</type></note></measure>
            <measure number="2"><note><rest/><duration>4</duration><type>half</type></note></measure>
          </part>
        </score-partwise>
        """;
    private static final String TWO_PARTS = """
        <score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Tuba</part-name></score-part><score-part id="P2"><part-name>Flauto</part-name></score-part></part-list>
          <part id="P1"><measure number="1"/></part>
          <part id="P2"><measure number="1"/></part>
        </score-partwise>
        """;

    private final ScorePlaybackSupport support = mock(ScorePlaybackSupport.class);
    private final ScoreDraftRepository repository = mock(ScoreDraftRepository.class);
    private final ScoreVersionRepository versionRepository = mock(ScoreVersionRepository.class);
    private final UsersRepository usersRepository = mock(UsersRepository.class);
    private final ScoreEditLockService lockService = mock(ScoreEditLockService.class);
    private final ApplicationProperties properties = new ApplicationProperties();
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final ScoreDraftService service = new ScoreDraftService(
        support, repository, versionRepository, usersRepository, lockService, properties, new ScoreWritingMetrics(registry)
    );
    private final SheetsMusic part = new SheetsMusic();

    @BeforeEach
    void setUp() {
        Tracks track = new Tracks();
        part.setId(9L);
        when(support.requireTrack(4L, Viewer.MANAGER)).thenReturn(track);
        when(support.requirePart(track, 9L)).thenReturn(part);
        when(repository.saveAndFlush(any(ScoreDraft.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.empty());
    }

    @Test
    void savesANewDraftCompressedForTheSessionHoldingTheLock() {
        DraftSavedDTO saved = service.save(4L, 9L, new DraftRequestDTO(SESSION, TUBA, null, null), mario());

        ArgumentCaptor<ScoreDraft> draft = ArgumentCaptor.forClass(ScoreDraft.class);
        verify(repository).saveAndFlush(draft.capture());
        assertThat(draft.getValue()).satisfies(stored -> {
            assertThat(stored.getTargetType()).isEqualTo(ScoreEditTarget.PART);
            assertThat(stored.getTargetId()).isEqualTo(9L);
            assertThat(stored.getBaseVersionId()).isNull();
            assertThat(stored.getMeasureCount()).isEqualTo(2);
            assertThat(stored.getSavedBy()).isEqualTo("mario");
            assertThat(new String(stored.getContent(), 0, 2, StandardCharsets.US_ASCII)).isEqualTo("PK");
            assertThat(MusicXmlDocuments.parts(MusicXmlDocuments.read(stored.getContent()))).hasSize(1);
        });
        assertThat(saved.savedAt()).isEqualTo(draft.getValue().getSavedAt());
        verify(lockService).requireHeld(eq(9L), eq(SESSION), any());
        assertThat(registry.counter("taurus.score.writing.drafts", "outcome", "saved").count()).isEqualTo(1);
    }

    @Test
    void startsTheDraftOfANewWrittenPartWithoutTheLock() {
        ScoreDraftService.Content content = service.readContent(TUBA);

        service.start(12L, content, mario());

        ArgumentCaptor<ScoreDraft> draft = ArgumentCaptor.forClass(ScoreDraft.class);
        verify(repository).saveAndFlush(draft.capture());
        assertThat(draft.getValue()).satisfies(stored -> {
            assertThat(stored.getTargetType()).isEqualTo(ScoreEditTarget.PART);
            assertThat(stored.getTargetId()).isEqualTo(12L);
            assertThat(stored.getBaseVersionId()).isNull();
            assertThat(stored.getMeasureCount()).isEqualTo(2);
            assertThat(stored.getSavedBy()).isEqualTo("mario");
            assertThat(stored.getSavedAt()).isNotNull();
            assertThat(stored.getContent()).isEqualTo(content.compressed());
        });
        verify(lockService, never()).requireHeld(any(), any(), any());
        assertThat(registry.counter("taurus.score.writing.drafts", "outcome", "saved").count()).isEqualTo(1);
    }

    @Test
    void replacesTheDraftTheEditorReadAndRefusesOneThatChangedOrWasRemoved() {
        ScoreDraft existing = draft(ZonedDateTime.now().minusSeconds(10));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(existing));
        ScoreVersion base = new ScoreVersion();
        when(versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(7L, 9L)).thenReturn(Optional.of(base));

        service.save(4L, 9L, new DraftRequestDTO(SESSION, TUBA, 7L, 0L), mario());
        assertThat(existing.getBaseVersionId()).isEqualTo(7L);

        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, TUBA, 7L, null), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> {
                assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
                assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.draftConflict");
            });

        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, TUBA, 7L, 3L), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.draftConflict"));
        assertThat(registry.counter("taurus.score.writing.drafts", "outcome", "rejected").count()).isEqualTo(2);
    }

    @Test
    void refusesSavesCloserThanTheMinimumInterval() {
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(draft(ZonedDateTime.now())));

        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, TUBA, null, 0L), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> {
                assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
                assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.draftTooFrequent");
            });
        verify(repository, never()).saveAndFlush(any(ScoreDraft.class));
    }

    @Test
    void refusesDraftsWithoutTheLockOrWithAContentThatIsNotOnePart() {
        doThrow(new RequestAlertException(HttpStatus.CONFLICT, "Locked", "ScoreEditLock", "scoreWriting.locked"))
            .when(lockService).requireHeld(eq(9L), eq("session-of-lucia"), any());
        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO("session-of-lucia", TUBA, null, null), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.locked"));

        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, TWO_PARTS, null, null), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> {
                assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
                assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.contentInvalid");
                assertThat(exception.getArgs().values()).containsEntry("reason", "severalParts");
            });
        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, "<score-timewise/>", null, null), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getArgs().values()).containsEntry("reason", "timewise"));
        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, " ", null, null), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getArgs().values()).containsEntry("reason", "empty"));
        assertThatThrownBy(() -> service.save(4L, 9L, null, mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.contentInvalid"));
        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, TUBA, 8L, null), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scorePlayback.version.notFound"));

        properties.getScorePlayback().setMaxUploadBytes(100);
        assertThatThrownBy(() -> service.save(4L, 9L, new DraftRequestDTO(SESSION, TUBA, null, null), mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> {
                assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.CONTENT_TOO_LARGE);
                assertThat(exception.getErrorKey()).isEqualTo("scorePlayback.upload.tooLarge");
            });
        verify(repository, never()).saveAndFlush(any(ScoreDraft.class));
        assertThat(registry.counter("taurus.score.writing.drafts", "outcome", "rejected").count()).isEqualTo(6);
    }

    @Test
    void returnsTheDraftAsPlainMusicXmlWithItsAuthorAndWhetherAnotherVersionArrived() {
        ScoreDraft existing = draft(ZonedDateTime.now().minusMinutes(5));
        existing.setBaseVersionId(7L);
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(existing));
        when(usersRepository.findAllByKeycloakIdIn(List.of("mario"))).thenReturn(List.of(user("mario", "Mario", "Rossi")));
        part.setCurrentScoreVersionId(8L);

        ScoreDraftDTO draft = service.get(4L, 9L).orElseThrow();

        assertThat(draft.content()).contains("<score-partwise").contains("<part-name>Tuba</part-name>");
        assertThat(draft.savedBy()).isEqualTo("Mario Rossi");
        assertThat(draft.measureCount()).isEqualTo(2);
        assertThat(draft.outdated()).isTrue();

        part.setCurrentScoreVersionId(7L);
        assertThat(service.get(4L, 9L).orElseThrow().outdated()).isFalse();

        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.empty());
        assertThat(service.get(4L, 9L)).isEmpty();
    }

    @Test
    void discardsTheDraftOnlyWhenNobodyElseIsWritingThePart() {
        when(repository.deleteAllByTargets(ScoreEditTarget.PART, List.of(9L))).thenReturn(1);

        service.discard(4L, 9L, null, mario());

        verify(lockService).requireNotHeldByOthers(eq(9L), eq(null), any());
        assertThat(registry.counter("taurus.score.writing.drafts", "outcome", "discarded").count()).isEqualTo(1);

        doThrow(new RequestAlertException(HttpStatus.CONFLICT, "Locked", "ScoreEditLock", "scoreWriting.locked"))
            .when(lockService).requireNotHeldByOthers(anyLong(), eq(SESSION), any());
        assertThatThrownBy(() -> service.discard(4L, 9L, SESSION, mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.locked"));
        verify(repository, org.mockito.Mockito.times(1)).deleteAllByTargets(ScoreEditTarget.PART, List.of(9L));
    }

    @Test
    void summarizesTheDraftsOfThePartsWithoutTheirContent() {
        SheetsMusic other = new SheetsMusic();
        other.setId(10L);
        other.setCurrentScoreVersionId(3L);
        ZonedDateTime savedAt = ZonedDateTime.now().minusDays(1);
        when(repository.findSummaries(eq(ScoreEditTarget.PART), any())).thenReturn(List.of(
            new DraftSummary(9L, "mario", savedAt, null),
            new DraftSummary(10L, "super-admin", savedAt, 2L)
        ));
        when(usersRepository.findAllByKeycloakIdIn(any())).thenReturn(List.of(user("mario", "Mario", "Rossi")));

        Map<Long, DraftSummaryDTO> summaries = service.summaries(List.of(part, other));

        assertThat(summaries.get(9L)).isEqualTo(new DraftSummaryDTO("Mario Rossi", savedAt, false));
        assertThat(summaries.get(10L)).isEqualTo(new DraftSummaryDTO(null, savedAt, true));
        assertThat(service.summaries(List.of())).isEmpty();
    }

    private ScoreDraft draft(ZonedDateTime savedAt) {
        ScoreDraft draft = new ScoreDraft();
        draft.initializeAudit("mario");
        draft.setTargetType(ScoreEditTarget.PART);
        draft.setTargetId(9L);
        draft.setContent(MusicXmlDocuments.toCompressed(MusicXmlDocuments.read(TUBA.strip().getBytes(StandardCharsets.UTF_8))));
        draft.setMeasureCount(2);
        draft.setSavedBy("mario");
        draft.setSavedAt(savedAt);
        return draft;
    }

    private static Users user(String keycloakId, String name, String lastName) {
        Users user = new Users();
        user.setKeycloakId(keycloakId);
        user.setName(name);
        user.setLastName(lastName);
        return user;
    }

    private static JwtAuthenticationToken mario() {
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("mario").issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt);
    }
}
