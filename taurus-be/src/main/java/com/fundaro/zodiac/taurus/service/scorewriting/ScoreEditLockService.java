package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditLock;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEditLockRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.ZonedDateTime;
import java.util.Collection;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * One author at a time on a part, in the writing and in the correction editor, and on the score of a track. A part and
 * the score have separate locks: writing the score does not lock its parts. The editor takes the lock when it opens,
 * renews it every 30 seconds and releases it when it closes; without renewals the lock expires after
 * {@code application.score-writing.lock-timeout}. Drafts and versions written in the editors are accepted only from the
 * session that holds the lock, or from the session that held it when it expired and nobody else took it.
 * <p>
 * Every change to the lock of a target runs under a transaction-level advisory lock on that target, so that two editors
 * cannot both find it free.
 */
@Service
@Transactional
public class ScoreEditLockService {

    static final String ENTITY = "ScoreEditLock";
    private static final ScoreEditTarget PART = ScoreEditTarget.PART;
    private static final Pattern SESSION = Pattern.compile("[A-Za-z0-9-]{8,64}");
    private static final String SYSTEM = "system";

    private final ScorePlaybackSupport support;
    private final ScoreEditLockRepository repository;
    private final ApplicationProperties properties;
    private final ScoreWritingMetrics metrics;

    public ScoreEditLockService(
        ScorePlaybackSupport support,
        ScoreEditLockRepository repository,
        ApplicationProperties properties,
        ScoreWritingMetrics metrics
    ) {
        this.support = support;
        this.repository = repository;
        this.properties = properties;
        this.metrics = metrics;
    }

    /**
     * Takes the lock of the part for the session, or renews it when the session already holds it.
     *
     * @param takeOver takes the lock even when another session holds it: that editor becomes read-only at its next
     *                 renewal, and its draft stays for whoever resumes the writing
     */
    public EditLockDTO acquire(Long trackId, Long scoreId, String session, boolean takeOver, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        return acquire(PART, part.getId(), session, takeOver, token);
    }

    /** Renews the lock held by the session; takes it again when it expired and nobody else took it. */
    public EditLockDTO renew(Long trackId, Long scoreId, String session, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        return acquire(PART, part.getId(), session, false, token);
    }

    /** Releases the lock if the session holds it; does nothing otherwise. */
    public void release(Long trackId, Long scoreId, String session) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        release(PART, part.getId(), session);
    }

    /**
     * Takes or renews the lock of a part or a score that the caller found.
     *
     * @param takeOver takes the lock even when another session holds it
     */
    public EditLockDTO acquire(ScoreEditTarget type, Long targetId, String session, boolean takeOver, AbstractAuthenticationToken token) {
        return toDto(hold(type, targetId, session, takeOver, token), session);
    }

    /** Releases the lock of a part or a score if the session holds it; does nothing otherwise. */
    public void release(ScoreEditTarget type, Long targetId, String session) {
        requireSession(session);
        repository.lockTarget(type.name(), targetId);
        repository.findByTargetTypeAndTargetId(type, targetId)
            .filter(lock -> lock.isHeldBy(session))
            .ifPresent(repository::delete);
    }

    /**
     * Checks, before a draft or a version is saved, that the session holds the lock of the part, and renews it.
     *
     * @throws RequestAlertException {@code scoreWriting.locked} when another session holds the lock
     */
    public void requireHeld(Long partId, String session, AbstractAuthenticationToken token) {
        requireHeld(PART, partId, session, token);
    }

    /** Checks that the session holds the lock of a part or a score, and renews it. */
    public void requireHeld(ScoreEditTarget type, Long targetId, String session, AbstractAuthenticationToken token) {
        hold(type, targetId, session, false, token);
    }

    /**
     * Checks that no other session is editing the part, for actions taken outside the editor such as discarding a draft.
     *
     * @param session session of the editor making the request, {@code null} when the request does not come from an editor
     */
    public void requireNotHeldByOthers(Long partId, String session, AbstractAuthenticationToken token) {
        requireNotHeldByOthers(PART, partId, session, token);
    }

    /** Checks that no other session is editing the part or the score. */
    public void requireNotHeldByOthers(ScoreEditTarget type, Long targetId, String session, AbstractAuthenticationToken token) {
        if (session != null) requireSession(session);
        repository.lockTarget(type.name(), targetId);
        ZonedDateTime now = ZonedDateTime.now();
        repository.findByTargetTypeAndTargetId(type, targetId)
            .filter(lock -> !lock.isExpired(now) && !(lock.isHeldBy(session) && lock.getOwner().equals(actor(token))))
            .ifPresent(lock -> {
                throw locked(lock, actor(token));
            });
    }

    /** The locks still running on the given parts, by part, as seen by a user who does not hold them. */
    @Transactional(readOnly = true)
    public Map<Long, EditLockDTO> active(Collection<Long> partIds) {
        return active(PART, partIds);
    }

    /** The locks still running on the given parts or scores, by target, as seen by a user who does not hold them. */
    @Transactional(readOnly = true)
    public Map<Long, EditLockDTO> active(ScoreEditTarget type, Collection<Long> targetIds) {
        if (targetIds.isEmpty()) return Map.of();
        return repository.findActive(type, targetIds, ZonedDateTime.now()).stream()
            .collect(Collectors.toMap(ScoreEditLock::getTargetId, lock -> toDto(lock, null)));
    }

    /** Forgets the locks of targets removed together with them. */
    public void forget(ScoreEditTarget type, Collection<Long> targetIds) {
        if (!targetIds.isEmpty()) repository.deleteAllByTargets(type, targetIds);
    }

    private ScoreEditLock hold(ScoreEditTarget type, Long targetId, String session, boolean takeOver, AbstractAuthenticationToken token) {
        requireSession(session);
        String actor = actor(token);
        repository.lockTarget(type.name(), targetId);
        ZonedDateTime now = ZonedDateTime.now();
        ScoreEditLock lock = repository.findByTargetTypeAndTargetId(type, targetId).orElse(null);
        if (lock == null) {
            lock = new ScoreEditLock();
            lock.initializeAudit(actor);
            lock.setTargetType(type);
            lock.setTargetId(targetId);
            assign(lock, session, actor, token, now);
            metrics.lock("acquired");
            return repository.saveAndFlush(lock);
        }
        if (lock.isHeldBy(session) && lock.getOwner().equals(actor)) {
            ZonedDateTime heartbeat = now.isAfter(lock.getHeartbeatAt()) ? now : lock.getHeartbeatAt();
            lock.setHeartbeatAt(heartbeat);
            lock.setExpiresAt(heartbeat.plus(properties.getScoreWriting().getLockTimeout()));
            lock.touchAudit(actor);
            return repository.saveAndFlush(lock);
        }
        boolean expired = lock.isExpired(now);
        if (!expired && !takeOver) {
            metrics.lock("refused");
            throw locked(lock, actor);
        }
        assign(lock, session, actor, token, now);
        lock.touchAudit(actor);
        metrics.lock(expired ? "expired" : "takenOver");
        return repository.saveAndFlush(lock);
    }

    private void assign(ScoreEditLock lock, String session, String actor, AbstractAuthenticationToken token, ZonedDateTime now) {
        lock.setOwner(actor);
        lock.setOwnerSession(session);
        lock.setOwnerName(tokenName(token));
        lock.setAcquiredAt(now);
        lock.setHeartbeatAt(now);
        lock.setExpiresAt(now.plus(properties.getScoreWriting().getLockTimeout()));
    }

    private static EditLockDTO toDto(ScoreEditLock lock, String session) {
        return new EditLockDTO(lock.getOwnerName(), lock.getAcquiredAt(), lock.getExpiresAt(), session != null && lock.isHeldBy(session));
    }

    /** Someone else holds the lock: their name and since when, and whether it is the same user in another window. */
    static RequestAlertException locked(ScoreEditLock lock, String actor) {
        return new RequestAlertException(HttpStatus.CONFLICT, "Someone else is editing the score", ENTITY, "scoreWriting.locked")
            .with("ownerName", lock.getOwnerName())
            .with("since", lock.getAcquiredAt().toInstant().toString())
            .with("sameUser", Objects.equals(lock.getOwner(), actor));
    }

    private static void requireSession(String session) {
        if (session == null || !SESSION.matcher(session).matches()) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Invalid editor session", ENTITY, "scoreWriting.sessionInvalid");
        }
    }

    private static String actor(AbstractAuthenticationToken token) {
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        return actor == null || actor.isBlank() ? SYSTEM : actor;
    }

    /** Name and surname of the authenticated user, {@code null} when the token does not carry them. */
    private static String tokenName(AbstractAuthenticationToken token) {
        String value = Stream.of(SecurityUtils.getFirstNameFromAuthentication(token), SecurityUtils.getLastNameFromAuthentication(token))
            .filter(Objects::nonNull).map(String::strip).filter(part -> !part.isEmpty())
            .collect(Collectors.joining(" "));
        if (value.isEmpty()) return null;
        return value.length() <= 255 ? value : value.substring(0, 255);
    }
}
