package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditLock;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEditLockRepository;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScoreEditLockServiceTest {

    private static final String MINE = "session-of-mario";
    private static final String OTHER_WINDOW = "other-window-of-mario";
    private static final String LUCIA_SESSION = "session-of-lucia";

    private final ScorePlaybackSupport support = mock(ScorePlaybackSupport.class);
    private final ScoreEditLockRepository repository = mock(ScoreEditLockRepository.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final ApplicationProperties properties = new ApplicationProperties();
    private final ScoreEditLockService service = new ScoreEditLockService(support, repository, properties, new ScoreWritingMetrics(registry));
    private final SheetsMusic part = new SheetsMusic();

    @BeforeEach
    void setUp() {
        Tracks track = new Tracks();
        part.setId(9L);
        when(support.requireTrack(4L, Viewer.MANAGER)).thenReturn(track);
        when(support.requirePart(track, 9L)).thenReturn(part);
        when(repository.saveAndFlush(any(ScoreEditLock.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.empty());
    }

    @Test
    void takesAFreeLockWithTheNameOfTheAuthorUnderTheAdvisoryLockOfThePart() {
        EditLockDTO lock = service.acquire(4L, 9L, MINE, false, mario());

        assertThat(lock.mine()).isTrue();
        assertThat(lock.ownerName()).isEqualTo("Mario Rossi");
        assertThat(Duration.between(lock.since(), lock.expiresAt())).isEqualTo(Duration.ofMinutes(2));
        verify(repository).lockTarget("PART", 9L);
        verify(repository).saveAndFlush(any(ScoreEditLock.class));
        assertThat(registry.counter("taurus.score.writing.locks", "outcome", "acquired").count()).isEqualTo(1);
    }

    @Test
    void renewsTheLockOfTheSessionEvenAfterItExpiredWhenNobodyTookIt() {
        ScoreEditLock expired = lock("mario", MINE, "Mario Rossi", ZonedDateTime.now().minusMinutes(10), ZonedDateTime.now().minusMinutes(5));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(expired));

        EditLockDTO renewed = service.renew(4L, 9L, MINE, mario());

        assertThat(renewed.mine()).isTrue();
        assertThat(renewed.since()).isEqualTo(expired.getAcquiredAt());
        assertThat(renewed.expiresAt()).isCloseTo(ZonedDateTime.now().plusMinutes(2), within(5, java.time.temporal.ChronoUnit.SECONDS));
        assertThat(registry.find("taurus.score.writing.locks").counters()).isEmpty();
    }

    @Test
    void refusesALockHeldByAnotherAuthorWithTheirNameAndTime() {
        ScoreEditLock held = lock("lucia", LUCIA_SESSION, "Lucia Bianchi", ZonedDateTime.now().minusMinutes(3), ZonedDateTime.now().plusMinutes(1));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(held));

        assertThatThrownBy(() -> service.acquire(4L, 9L, MINE, false, mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> {
                assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
                assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.locked");
                assertThat(exception.getArgs().values())
                    .containsEntry("ownerName", "Lucia Bianchi")
                    .containsEntry("since", held.getAcquiredAt().toInstant().toString())
                    .containsEntry("sameUser", false);
            });
        assertThatThrownBy(() -> service.requireHeld(9L, MINE, mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.locked"));
        verify(repository, never()).saveAndFlush(any(ScoreEditLock.class));
        assertThat(registry.counter("taurus.score.writing.locks", "outcome", "refused").count()).isEqualTo(2);
    }

    @Test
    void anotherWindowOfTheSameUserIsAnotherAuthor() {
        ScoreEditLock held = lock("mario", OTHER_WINDOW, "Mario Rossi", ZonedDateTime.now().minusMinutes(1), ZonedDateTime.now().plusMinutes(1));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(held));

        assertThatThrownBy(() -> service.acquire(4L, 9L, MINE, false, mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getArgs().values()).containsEntry("sameUser", true));
    }

    @Test
    void aSessionOfAnotherUserDoesNotHoldTheLock() {
        ScoreEditLock held = lock("lucia", MINE, "Lucia Bianchi", ZonedDateTime.now().minusMinutes(1), ZonedDateTime.now().plusMinutes(1));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(held));

        assertThatThrownBy(() -> service.requireHeld(9L, MINE, mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.locked"));
    }

    @Test
    void takesOverARunningLockAndTakesAnExpiredOneWithoutAsking() {
        ScoreEditLock held = lock("lucia", LUCIA_SESSION, "Lucia Bianchi", ZonedDateTime.now().minusMinutes(1), ZonedDateTime.now().plusMinutes(1));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(held));

        EditLockDTO taken = service.acquire(4L, 9L, MINE, true, mario());

        assertThat(taken.mine()).isTrue();
        assertThat(taken.ownerName()).isEqualTo("Mario Rossi");
        assertThat(held.getOwner()).isEqualTo("mario");
        assertThat(held.getOwnerSession()).isEqualTo(MINE);
        assertThat(registry.counter("taurus.score.writing.locks", "outcome", "takenOver").count()).isEqualTo(1);

        held.setExpiresAt(ZonedDateTime.now().minusSeconds(1));
        service.requireHeld(9L, LUCIA_SESSION, lucia());

        assertThat(held.getOwnerSession()).isEqualTo(LUCIA_SESSION);
        assertThat(registry.counter("taurus.score.writing.locks", "outcome", "expired").count()).isEqualTo(1);
    }

    @Test
    void releasesOnlyTheLockOfTheSession() {
        ScoreEditLock held = lock("lucia", LUCIA_SESSION, "Lucia Bianchi", ZonedDateTime.now().minusMinutes(1), ZonedDateTime.now().plusMinutes(1));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(held));

        service.release(4L, 9L, MINE);
        verify(repository, never()).delete(any(ScoreEditLock.class));

        service.release(4L, 9L, LUCIA_SESSION);
        verify(repository).delete(held);
    }

    @Test
    void refusesSessionsThatAreMissingOrNotIdentifiers() {
        for (String session : java.util.Arrays.asList(null, "", "short", "with spaces in it", "x".repeat(65))) {
            assertThatThrownBy(() -> service.acquire(4L, 9L, session, false, mario()))
                .as(String.valueOf(session))
                .isInstanceOfSatisfying(RequestAlertException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.sessionInvalid");
                });
        }
        verify(repository, never()).lockTarget(anyString(), anyLong());
    }

    @Test
    void letsOthersActOnThePartOnlyWhileNobodyElseIsEditingIt() {
        ScoreEditLock held = lock("lucia", LUCIA_SESSION, "Lucia Bianchi", ZonedDateTime.now().minusMinutes(1), ZonedDateTime.now().plusMinutes(1));
        when(repository.findByTargetTypeAndTargetId(ScoreEditTarget.PART, 9L)).thenReturn(Optional.of(held));

        assertThatThrownBy(() -> service.requireNotHeldByOthers(9L, null, mario()))
            .isInstanceOfSatisfying(RequestAlertException.class, exception -> assertThat(exception.getErrorKey()).isEqualTo("scoreWriting.locked"));
        service.requireNotHeldByOthers(9L, LUCIA_SESSION, lucia());

        held.setExpiresAt(ZonedDateTime.now().minusSeconds(1));
        service.requireNotHeldByOthers(9L, null, mario());
        verify(repository, org.mockito.Mockito.times(3)).lockTarget("PART", 9L);
    }

    @Test
    void showsTheRunningLocksOfTheParts() {
        ScoreEditLock held = lock("lucia", LUCIA_SESSION, "Lucia Bianchi", ZonedDateTime.now().minusMinutes(1), ZonedDateTime.now().plusMinutes(1));
        held.setTargetId(9L);
        when(repository.findActive(eq(ScoreEditTarget.PART), eq(List.of(9L, 10L)), any())).thenReturn(List.of(held));

        Map<Long, EditLockDTO> active = service.active(List.of(9L, 10L));

        assertThat(active).containsOnlyKeys(9L);
        assertThat(active.get(9L)).returns("Lucia Bianchi", EditLockDTO::ownerName).returns(false, EditLockDTO::mine);
        assertThat(service.active(List.of())).isEmpty();
    }

    @Test
    void theLockTimeoutMustLeaveRoomForTheRenewals() {
        properties.getScoreWriting().setLockTimeout(Duration.ofSeconds(45));
        assertThat(properties.getScoreWriting().isLockTimeoutValid()).isFalse();
        properties.getScoreWriting().setLockTimeout(Duration.ofMinutes(2));
        assertThat(properties.getScoreWriting().isLockTimeoutValid()).isTrue();
    }

    private static ScoreEditLock lock(String owner, String session, String name, ZonedDateTime acquiredAt, ZonedDateTime expiresAt) {
        ScoreEditLock lock = new ScoreEditLock();
        lock.initializeAudit(owner);
        lock.setTargetType(ScoreEditTarget.PART);
        lock.setTargetId(9L);
        lock.setOwner(owner);
        lock.setOwnerSession(session);
        lock.setOwnerName(name);
        lock.setAcquiredAt(acquiredAt);
        lock.setHeartbeatAt(expiresAt.minusMinutes(2));
        lock.setExpiresAt(expiresAt);
        return lock;
    }

    private static JwtAuthenticationToken mario() {
        return token("mario", "Mario", "Rossi");
    }

    private static JwtAuthenticationToken lucia() {
        return token("lucia", "Lucia", "Bianchi");
    }

    private static JwtAuthenticationToken token(String subject, String firstName, String lastName) {
        Jwt jwt = Jwt.withTokenValue("token")
            .header("alg", "none")
            .subject(subject)
            .claim("given_name", firstName)
            .claim("family_name", lastName)
            .issuedAt(Instant.now())
            .expiresAt(Instant.now().plusSeconds(300))
            .build();
        return new JwtAuthenticationToken(jwt);
    }
}
