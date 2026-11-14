package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Users;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreDraft;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.repository.UsersRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreDraftRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreDraftRepository.DraftSummary;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSavedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSummaryDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ScoreDraftDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.MusicXmlException;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.PartInfo;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.Document;

import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * The drafts of the writing editor: one for each part, saved automatically by the session that holds the edit lock.
 * A draft is not a version and never expires; saving a version, discarding it or removing the part removes it.
 */
@Service
@Transactional
public class ScoreDraftService {

    static final String ENTITY = "ScoreDraft";
    private static final ScoreEditTarget PART = ScoreEditTarget.PART;

    private final ScorePlaybackSupport support;
    private final ScoreDraftRepository repository;
    private final ScoreVersionRepository versionRepository;
    private final UsersRepository usersRepository;
    private final ScoreEditLockService lockService;
    private final ApplicationProperties properties;
    private final ScoreWritingMetrics metrics;

    public ScoreDraftService(
        ScorePlaybackSupport support,
        ScoreDraftRepository repository,
        ScoreVersionRepository versionRepository,
        UsersRepository usersRepository,
        ScoreEditLockService lockService,
        ApplicationProperties properties,
        ScoreWritingMetrics metrics
    ) {
        this.support = support;
        this.repository = repository;
        this.versionRepository = versionRepository;
        this.usersRepository = usersRepository;
        this.lockService = lockService;
        this.properties = properties;
        this.metrics = metrics;
    }

    /** The draft of the part, with its plain MusicXML; empty when there is none. */
    @Transactional(readOnly = true)
    public Optional<ScoreDraftDTO> get(Long trackId, Long scoreId) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        return repository.findByTargetTypeAndTargetId(PART, part.getId()).map(draft -> new ScoreDraftDTO(
            new String(MusicXmlDocuments.toXml(MusicXmlDocuments.read(draft.getContent())), StandardCharsets.UTF_8),
            draft.getBaseVersionId(),
            draft.getMeasureCount(),
            names(List.of(draft.getSavedBy())).get(draft.getSavedBy()),
            draft.getSavedAt(),
            draft.getEntityVersion(),
            outdated(part, draft.getBaseVersionId())
        ));
    }

    /**
     * Saves the draft of the part for the session that holds the edit lock.
     *
     * @throws RequestAlertException {@code scoreWriting.locked} without the lock, {@code scoreWriting.draftConflict} when
     *                               the draft changed since the editor read it, {@code scoreWriting.draftTooFrequent}
     *                               when the previous save is too recent
     */
    public DraftSavedDTO save(Long trackId, Long scoreId, DraftRequestDTO request, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        if (request == null) throw rejected(invalidContent("empty"));
        lockService.requireHeld(part.getId(), request.editSession(), token);
        Content content;
        try {
            content = readContent(request.content());
        } catch (RequestAlertException exception) {
            throw rejected(exception);
        }
        if (request.baseVersionId() != null && versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(request.baseVersionId(), part.getId()).isEmpty()) {
            throw rejected(new RequestAlertException(HttpStatus.NOT_FOUND, "Score version not found", ENTITY, "scorePlayback.version.notFound"));
        }

        String actor = actor(token);
        ZonedDateTime now = ZonedDateTime.now();
        ScoreDraft draft = repository.findByTargetTypeAndTargetId(PART, part.getId()).orElse(null);
        if (draft == null) {
            if (request.entityVersion() != null) throw rejected(conflict());
            draft = new ScoreDraft();
            draft.initializeAudit(actor);
            draft.setTargetType(PART);
            draft.setTargetId(part.getId());
        } else {
            if (!Objects.equals(request.entityVersion(), draft.getEntityVersion())) throw rejected(conflict());
            if (now.isBefore(draft.getSavedAt().plus(properties.getScoreWriting().getDraftMinInterval()))) {
                throw rejected(new RequestAlertException(HttpStatus.TOO_MANY_REQUESTS, "Draft saved too often", ENTITY, "scoreWriting.draftTooFrequent"));
            }
            draft.touchAudit(actor);
        }
        draft.setBaseVersionId(request.baseVersionId());
        draft.setContent(content.compressed());
        draft.setMeasureCount(content.measureCount());
        draft.setSavedBy(actor);
        draft.setSavedAt(now);
        ScoreDraft saved = repository.saveAndFlush(draft);
        metrics.draft("saved");
        return new DraftSavedDTO(saved.getEntityVersion(), saved.getSavedAt());
    }

    /**
     * Discards the draft of the part, from the editor that holds the lock or from the parts of the track while nobody is
     * writing it.
     *
     * @param session session of the editor making the request, {@code null} outside the editor
     */
    public void discard(Long trackId, Long scoreId, String session, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        lockService.requireNotHeldByOthers(part.getId(), session, token);
        if (repository.deleteAllByTargets(PART, List.of(part.getId())) > 0) metrics.draft("discarded");
    }

    /** Stores the first draft of a part just created for the writing editor, which nobody can be writing yet. */
    void start(Long partId, Content content, AbstractAuthenticationToken token) {
        String actor = actor(token);
        ScoreDraft draft = new ScoreDraft();
        draft.initializeAudit(actor);
        draft.setTargetType(PART);
        draft.setTargetId(partId);
        draft.setContent(content.compressed());
        draft.setMeasureCount(content.measureCount());
        draft.setSavedBy(actor);
        draft.setSavedAt(ZonedDateTime.now());
        repository.saveAndFlush(draft);
        metrics.draft("saved");
    }

    /** Removes the draft of a part that received a new version from the writing editor. */
    public void remove(Long partId) {
        repository.deleteAllByTargets(PART, List.of(partId));
    }

    /** The drafts of the given parts, by part, without their content. */
    @Transactional(readOnly = true)
    public Map<Long, DraftSummaryDTO> summaries(Collection<SheetsMusic> parts) {
        Map<Long, SheetsMusic> byId = parts.stream().filter(part -> part.getId() != null)
            .collect(Collectors.toMap(SheetsMusic::getId, part -> part, (first, second) -> first));
        if (byId.isEmpty()) return Map.of();
        List<DraftSummary> drafts = repository.findSummaries(PART, byId.keySet());
        Map<String, String> names = names(drafts.stream().map(DraftSummary::savedBy).toList());
        return drafts.stream().collect(Collectors.toMap(
            DraftSummary::targetId,
            draft -> new DraftSummaryDTO(names.get(draft.savedBy()), draft.savedAt(), outdated(byId.get(draft.targetId()), draft.baseVersionId()))
        ));
    }

    /**
     * Checks and compresses MusicXML written in the editor: well-formed {@code score-partwise} with a single part.
     *
     * @throws RequestAlertException {@code scorePlayback.upload.tooLarge} or {@code scoreWriting.contentInvalid}
     */
    public Content readContent(String text) {
        if (text == null || text.isBlank()) throw invalidContent("empty");
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        long maxBytes = properties.getScorePlayback().getMaxUploadBytes();
        if (bytes.length > maxBytes) {
            throw new RequestAlertException(HttpStatus.CONTENT_TOO_LARGE, "Score too large", ENTITY, "scorePlayback.upload.tooLarge")
                .with("maxMegabytes", (int) (maxBytes / (1024 * 1024)));
        }
        try {
            Document document = MusicXmlDocuments.read(bytes);
            List<PartInfo> parts = MusicXmlDocuments.parts(document);
            if (parts.size() != 1) throw invalidContent(parts.isEmpty() ? "noParts" : "severalParts");
            Document single = MusicXmlDocuments.singlePart(document, parts.get(0).id());
            return new Content(single, MusicXmlDocuments.toCompressed(single), parts.get(0));
        } catch (MusicXmlException exception) {
            throw invalidContent(exception.reason());
        }
    }

    /** MusicXML written in the editor, checked: the single part, its compressed form and its description. */
    public record Content(Document document, byte[] compressed, PartInfo part) {
        int measureCount() {
            return part.measureCount();
        }
    }

    static RequestAlertException invalidContent(String reason) {
        return new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid written score", ENTITY, "scoreWriting.contentInvalid")
            .with("reason", reason);
    }

    private static boolean outdated(SheetsMusic part, Long baseVersionId) {
        return part != null && !Objects.equals(part.getCurrentScoreVersionId(), baseVersionId);
    }

    private static RequestAlertException conflict() {
        return new RequestAlertException(HttpStatus.CONFLICT, "Draft changed since it was read", ENTITY, "scoreWriting.draftConflict");
    }

    private RequestAlertException rejected(RequestAlertException exception) {
        metrics.draft("rejected");
        return exception;
    }

    /** Current names of the tenant users with the given ids; ids without a user are left out. */
    private Map<String, String> names(Collection<String> keycloakIds) {
        List<String> ids = keycloakIds.stream().filter(Objects::nonNull).distinct().toList();
        Map<String, String> names = new HashMap<>();
        if (ids.isEmpty()) return names;
        for (Users user : usersRepository.findAllByKeycloakIdIn(ids)) {
            String name = Stream.of(user.getName(), user.getLastName()).filter(Objects::nonNull).map(String::strip)
                .filter(value -> !value.isEmpty()).collect(Collectors.joining(" "));
            if (!name.isEmpty()) names.putIfAbsent(user.getKeycloakId(), name);
        }
        return names;
    }

    private static String actor(AbstractAuthenticationToken token) {
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        return actor == null || actor.isBlank() ? "system" : actor;
    }
}
