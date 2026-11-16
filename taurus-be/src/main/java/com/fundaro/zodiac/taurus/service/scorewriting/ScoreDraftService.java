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
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * The drafts of the writing editor: one for each part and one for the score of a track, saved automatically by the
 * session that holds the edit lock. A draft is not a version and never expires; saving a version, discarding it or
 * removing the part or the score removes it.
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
        return save(
            PART,
            part.getId(),
            new DraftWrite(request.editSession(), request.baseVersionId(), request.entityVersion()),
            () -> readContent(request.content()).stored(),
            baseVersionId -> versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(baseVersionId, part.getId()).isPresent(),
            token
        );
    }

    /**
     * Saves the draft of a part or a score, found by the caller, for the session that holds its edit lock.
     *
     * @param content           reads and checks the content, after the lock
     * @param baseVersionExists tells whether the version the writing started from is a version of the target
     * @throws RequestAlertException {@code scoreWriting.locked}, {@code scoreWriting.draftConflict},
     *                               {@code scoreWriting.draftTooFrequent}, {@code scorePlayback.version.notFound} and the
     *                               errors of the content
     */
    public DraftSavedDTO save(
        ScoreEditTarget type,
        Long targetId,
        DraftWrite write,
        Supplier<StoredContent> content,
        Predicate<Long> baseVersionExists,
        AbstractAuthenticationToken token
    ) {
        lockService.requireHeld(type, targetId, write.editSession(), token);
        StoredContent stored;
        try {
            stored = content.get();
        } catch (RequestAlertException exception) {
            throw rejected(exception);
        }
        if (write.baseVersionId() != null && !baseVersionExists.test(write.baseVersionId())) {
            throw rejected(new RequestAlertException(HttpStatus.NOT_FOUND, "Score version not found", ENTITY, "scorePlayback.version.notFound"));
        }

        String actor = actor(token);
        ZonedDateTime now = ZonedDateTime.now();
        ScoreDraft draft = repository.findByTargetTypeAndTargetId(type, targetId).orElse(null);
        if (draft == null) {
            if (write.entityVersion() != null) throw rejected(conflict());
            draft = new ScoreDraft();
            draft.initializeAudit(actor);
            draft.setTargetType(type);
            draft.setTargetId(targetId);
        } else {
            if (!Objects.equals(write.entityVersion(), draft.getEntityVersion())) throw rejected(conflict());
            if (now.isBefore(draft.getSavedAt().plus(properties.getScoreWriting().getDraftMinInterval()))) {
                throw rejected(new RequestAlertException(HttpStatus.TOO_MANY_REQUESTS, "Draft saved too often", ENTITY, "scoreWriting.draftTooFrequent"));
            }
            draft.touchAudit(actor);
        }
        draft.setBaseVersionId(write.baseVersionId());
        draft.setContent(stored.compressed());
        draft.setRowsJson(stored.rowsJson());
        draft.setMeasureCount(stored.measureCount());
        draft.setSavedBy(actor);
        draft.setSavedAt(now);
        ScoreDraft saved = repository.saveAndFlush(draft);
        metrics.draft("saved");
        return new DraftSavedDTO(saved.getEntityVersion(), saved.getSavedAt());
    }

    /**
     * The draft of a part or a score with its plain MusicXML and the name of its author; empty when there is none.
     */
    @Transactional(readOnly = true)
    public Optional<StoredDraft> read(ScoreEditTarget type, Long targetId) {
        return repository.findByTargetTypeAndTargetId(type, targetId).map(draft -> new StoredDraft(
            new String(MusicXmlDocuments.toXml(MusicXmlDocuments.read(draft.getContent())), StandardCharsets.UTF_8),
            draft.getRowsJson(),
            draft.getBaseVersionId(),
            draft.getMeasureCount(),
            names(List.of(draft.getSavedBy())).get(draft.getSavedBy()),
            draft.getSavedAt(),
            draft.getEntityVersion()
        ));
    }

    /**
     * Who saved the draft of a score and when, without its content; empty when there is none.
     *
     * @param currentVersionId current version of the score, to tell whether another version was saved meanwhile
     */
    @Transactional(readOnly = true)
    public Optional<DraftSummaryDTO> summary(ScoreEditTarget type, Long targetId, Long currentVersionId) {
        return repository.findSummaries(type, List.of(targetId)).stream().findFirst().map(draft -> new DraftSummaryDTO(
            names(List.of(draft.savedBy())).get(draft.savedBy()),
            draft.savedAt(),
            !Objects.equals(currentVersionId, draft.baseVersionId())
        ));
    }

    /**
     * Discards the draft of the part, from the editor that holds the lock or from the parts of the track while nobody is
     * writing it.
     *
     * @param session session of the editor making the request, {@code null} outside the editor
     */
    public void discard(Long trackId, Long scoreId, String session, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        discard(PART, part.getId(), session, token);
    }

    /** Discards the draft of a part or a score, found by the caller, while nobody else is writing it. */
    public void discard(ScoreEditTarget type, Long targetId, String session, AbstractAuthenticationToken token) {
        lockService.requireNotHeldByOthers(type, targetId, session, token);
        if (repository.deleteAllByTargets(type, List.of(targetId)) > 0) metrics.draft("discarded");
    }

    /** Stores the first draft of a part just created for the writing editor, which nobody can be writing yet. */
    void start(Long partId, Content content, AbstractAuthenticationToken token) {
        start(PART, partId, content.stored(), token);
    }

    /** Stores the first draft of a part or a score just created, which nobody can be writing yet. */
    public void start(ScoreEditTarget type, Long targetId, StoredContent content, AbstractAuthenticationToken token) {
        String actor = actor(token);
        ScoreDraft draft = new ScoreDraft();
        draft.initializeAudit(actor);
        draft.setTargetType(type);
        draft.setTargetId(targetId);
        draft.setContent(content.compressed());
        draft.setRowsJson(content.rowsJson());
        draft.setMeasureCount(content.measureCount());
        draft.setSavedBy(actor);
        draft.setSavedAt(ZonedDateTime.now());
        repository.saveAndFlush(draft);
        metrics.draft("saved");
    }

    /** Removes the draft of a part that received a new version from the writing editor. */
    public void remove(Long partId) {
        remove(PART, partId);
    }

    /** Removes the draft of a part or a score. */
    public void remove(ScoreEditTarget type, Long targetId) {
        repository.deleteAllByTargets(type, List.of(targetId));
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

        StoredContent stored() {
            return new StoredContent(compressed, part.measureCount(), null);
        }
    }

    /**
     * The content of a draft, checked and ready to store.
     *
     * @param compressed   compressed MusicXML
     * @param measureCount measures of the content
     * @param rowsJson     rows of a score as JSON, {@code null} for a part
     */
    public record StoredContent(byte[] compressed, int measureCount, String rowsJson) {}

    /**
     * What the editor sends with a draft.
     *
     * @param editSession   session of the editor, which must hold the lock
     * @param baseVersionId version the writing started from, {@code null} without versions
     * @param entityVersion version of the draft the editor is replacing, {@code null} when it starts a new draft
     */
    public record DraftWrite(String editSession, Long baseVersionId, Long entityVersion) {}

    /**
     * A stored draft, read back.
     *
     * @param content  plain MusicXML
     * @param rowsJson rows of a score as JSON, {@code null} for a part
     * @param savedBy  name of the author of the last save, {@code null} when unknown
     */
    public record StoredDraft(
        String content,
        String rowsJson,
        Long baseVersionId,
        int measureCount,
        String savedBy,
        ZonedDateTime savedAt,
        long entityVersion
    ) {}

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
