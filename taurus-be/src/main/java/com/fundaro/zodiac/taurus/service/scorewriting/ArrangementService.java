package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scorewriting.ArrangementVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.domain.scorewriting.TrackArrangement;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ArrangementVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.TrackArrangementRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDraftDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.NewArrangementDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSavedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementContents.ArrangementContent;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementContents.StoredRow;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService.DraftWrite;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The score of a track, its draft and its edit lock, for archivists and administrators. A track has at most one score;
 * creating it stores its rows and its first draft and links each row made from a part with the same instruments to that
 * part. Removing it leaves the parts, with their versions, and removes their links to the rows.
 */
@Service
@Transactional
public class ArrangementService {

    private static final ScoreEditTarget ARRANGEMENT = ScoreEditTarget.ARRANGEMENT;
    private static final String TRACK_ENTITY = "Tracks";

    private final ScorePlaybackSupport playbackSupport;
    private final ArrangementSupport support;
    private final ArrangementContents contents;
    private final TrackArrangementRepository repository;
    private final ArrangementVersionRepository versionRepository;
    private final TracksRepository tracksRepository;
    private final ScoreDraftService draftService;
    private final ScoreEditLockService lockService;
    private final MediaService mediaService;

    public ArrangementService(
        ScorePlaybackSupport playbackSupport,
        ArrangementSupport support,
        ArrangementContents contents,
        TrackArrangementRepository repository,
        ArrangementVersionRepository versionRepository,
        TracksRepository tracksRepository,
        ScoreDraftService draftService,
        ScoreEditLockService lockService,
        MediaService mediaService
    ) {
        this.playbackSupport = playbackSupport;
        this.support = support;
        this.contents = contents;
        this.repository = repository;
        this.versionRepository = versionRepository;
        this.tracksRepository = tracksRepository;
        this.draftService = draftService;
        this.lockService = lockService;
        this.mediaService = mediaService;
    }

    /** The score of the track with its current version, draft, lock and rows; empty when the track has none. */
    @Transactional(readOnly = true)
    public Optional<ArrangementDTO> get(Long trackId) {
        Tracks track = playbackSupport.requireTrack(trackId, Viewer.MANAGER);
        return repository.findByTrackIdAndDeletedFalse(track.getId()).map(arrangement -> toDto(track, arrangement));
    }

    /**
     * Creates the score of the track with its first draft.
     *
     * @throws RequestAlertException {@code scorePlayback.track.notFound}, {@code scoreWriting.arrangementExists} when the
     *                               track already has a score, {@code scorePlayback.part.notFound} for a row made from a
     *                               part of another track, {@code scoreWriting.extractionInvalid} with reason
     *                               {@code duplicateTarget} for two rows made from the same part, and the errors of the
     *                               content
     */
    public ArrangementDTO create(Long trackId, NewArrangementDTO request, AbstractAuthenticationToken token) {
        if (request == null) throw ScoreDraftService.invalidContent("empty");
        // The lock on the track serializes the creation with the extractions and the saves of the track.
        Tracks track = lockTrack(trackId);
        if (repository.findByTrackIdAndDeletedFalse(track.getId()).isPresent()) throw exists();
        ArrangementContent content = contents.read(request.content(), request.rows());
        Map<String, Long> links = links(track, request.rows(), content.rows());

        TrackArrangement arrangement = new TrackArrangement();
        arrangement.initializeAudit(actor(token));
        arrangement.setTrackId(track.getId());
        try {
            arrangement = repository.saveAndFlush(arrangement);
        } catch (DataIntegrityViolationException exception) {
            throw exists();
        }
        draftService.start(ARRANGEMENT, arrangement.getId(), content.stored(), token);
        // Links left by a removed score, also on removed parts, would make a new row look like it lost its part.
        repository.unlinkTrack(track.getId());
        links.forEach((row, partId) -> repository.link(track.getId(), partId, row));
        return toDto(track, arrangement);
    }

    /**
     * Removes the score of the track with its versions, draft and lock; the parts stay, without their links to the rows.
     *
     * @param session session of the editor making the request, {@code null} when it does not come from an editor
     * @throws RequestAlertException {@code scoreWriting.arrangementNotFound}, {@code scoreWriting.locked} while someone
     *                               else is writing the score
     */
    public void delete(Long trackId, String session, AbstractAuthenticationToken token) {
        Tracks track = lockTrack(trackId);
        TrackArrangement arrangement = support.requireArrangement(track);
        lockService.requireNotHeldByOthers(ARRANGEMENT, arrangement.getId(), session, token);
        String actor = actor(token);
        List<ArrangementVersion> versions = versionRepository.findAllByArrangementIdAndDeletedFalseOrderByVersionNumberDesc(arrangement.getId());
        versions.forEach(version -> {
            version.setDeleted(true);
            version.touchAudit(actor);
        });
        versionRepository.saveAllAndFlush(versions);
        arrangement.setDeleted(true);
        arrangement.touchAudit(actor);
        repository.saveAndFlush(arrangement);
        draftService.remove(ARRANGEMENT, arrangement.getId());
        lockService.forget(ARRANGEMENT, List.of(arrangement.getId()));
        repository.unlinkTrack(track.getId());
        versions.forEach(version -> mediaService.deleteIfUnreferenced(version.getMediaAssetId(), token));
    }

    /** The draft of the score with its plain MusicXML and its rows; empty when there is none. */
    @Transactional(readOnly = true)
    public Optional<ArrangementDraftDTO> draft(Long trackId) {
        TrackArrangement arrangement = support.requireArrangement(playbackSupport.requireTrack(trackId, Viewer.MANAGER));
        return draftService.read(ARRANGEMENT, arrangement.getId()).map(draft -> new ArrangementDraftDTO(
            draft.content(),
            support.rows(contents.rows(draft.rowsJson())),
            draft.baseVersionId(),
            draft.measureCount(),
            draft.savedBy(),
            draft.savedAt(),
            draft.entityVersion(),
            !Objects.equals(arrangement.getCurrentVersionId(), draft.baseVersionId())
        ));
    }

    /**
     * Saves the draft of the score for the session that holds its lock.
     *
     * @throws RequestAlertException {@code scoreWriting.locked}, {@code scoreWriting.draftConflict},
     *                               {@code scoreWriting.draftTooFrequent}, {@code scorePlayback.version.notFound} for a
     *                               base version of another score, and the errors of the content
     */
    public DraftSavedDTO saveDraft(Long trackId, ArrangementDraftRequestDTO request, AbstractAuthenticationToken token) {
        TrackArrangement arrangement = support.requireArrangement(playbackSupport.requireTrack(trackId, Viewer.MANAGER));
        if (request == null) throw ScoreDraftService.invalidContent("empty");
        return draftService.save(
            ARRANGEMENT,
            arrangement.getId(),
            new DraftWrite(request.editSession(), request.baseVersionId(), request.entityVersion()),
            () -> contents.read(request.content(), request.rows()).stored(),
            baseVersionId -> versionRepository.findByIdAndArrangementIdAndDeletedFalse(baseVersionId, arrangement.getId()).isPresent(),
            token
        );
    }

    /** Discards the draft of the score while nobody else is writing it. */
    public void discardDraft(Long trackId, String session, AbstractAuthenticationToken token) {
        TrackArrangement arrangement = support.requireArrangement(playbackSupport.requireTrack(trackId, Viewer.MANAGER));
        draftService.discard(ARRANGEMENT, arrangement.getId(), session, token);
    }

    /** Takes the lock of the score when the editor opens; {@code takeOver} takes it from the author holding it. */
    public EditLockDTO acquireLock(Long trackId, String session, boolean takeOver, AbstractAuthenticationToken token) {
        TrackArrangement arrangement = support.requireArrangement(playbackSupport.requireTrack(trackId, Viewer.MANAGER));
        return lockService.acquire(ARRANGEMENT, arrangement.getId(), session, takeOver, token);
    }

    /** Renews the lock of the score held by the session. */
    public EditLockDTO renewLock(Long trackId, String session, AbstractAuthenticationToken token) {
        TrackArrangement arrangement = support.requireArrangement(playbackSupport.requireTrack(trackId, Viewer.MANAGER));
        return lockService.acquire(ARRANGEMENT, arrangement.getId(), session, false, token);
    }

    /** Releases the lock of the score if the session holds it. */
    public void releaseLock(Long trackId, String session) {
        TrackArrangement arrangement = support.requireArrangement(playbackSupport.requireTrack(trackId, Viewer.MANAGER));
        lockService.release(ARRANGEMENT, arrangement.getId(), session);
    }

    private ArrangementDTO toDto(Tracks track, TrackArrangement arrangement) {
        ArrangementVersion current = support.currentVersion(arrangement);
        List<StoredRow> rows = current != null
            ? support.rows(current)
            : draftService.read(ARRANGEMENT, arrangement.getId()).map(draft -> contents.rows(draft.rowsJson())).orElse(List.of());
        return new ArrangementDTO(
            arrangement.getId(),
            track.getId(),
            current == null ? null : support.toDto(current, arrangement),
            support.rowStates(track, arrangement, rows),
            draftService.summary(ARRANGEMENT, arrangement.getId(), arrangement.getCurrentVersionId()).orElse(null),
            lockService.active(ARRANGEMENT, List.of(arrangement.getId())).get(arrangement.getId())
        );
    }

    /**
     * The rows made from a part of the track that keep it: the part has the same instruments as the row. The other rows
     * start without a part.
     */
    private static Map<String, Long> links(Tracks track, List<ArrangementRowRequestDTO> requested, List<StoredRow> rows) {
        Map<Long, SheetsMusic> parts = track.getScores().stream().collect(Collectors.toMap(SheetsMusic::getId, Function.identity()));
        Map<String, Long> links = new LinkedHashMap<>();
        Set<Long> seen = new HashSet<>();
        for (int index = 0; index < rows.size(); index++) {
            Long scoreId = requested.get(index).scoreId();
            if (scoreId == null) continue;
            SheetsMusic part = parts.get(scoreId);
            if (part == null) {
                throw new RequestAlertException(HttpStatus.NOT_FOUND, "Part not found", ArrangementSupport.ENTITY, "scorePlayback.part.notFound");
            }
            if (!seen.add(scoreId)) throw ArrangementSupport.extractionInvalid("duplicateTarget");
            if (sameInstruments(part, rows.get(index).instrumentIds())) links.put(rows.get(index).id(), scoreId);
        }
        return links;
    }

    /** The part has exactly the instruments of the row. */
    static boolean sameInstruments(SheetsMusic part, List<Long> instrumentIds) {
        Set<Long> partInstruments = part.getInstruments().stream().map(Instruments::getId).collect(Collectors.toSet());
        return partInstruments.equals(new HashSet<>(instrumentIds));
    }

    private Tracks lockTrack(Long trackId) {
        return tracksRepository.findByIdForUpdate(trackId)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Track not found", TRACK_ENTITY, "scorePlayback.track.notFound"));
    }

    private static RequestAlertException exists() {
        return new RequestAlertException(HttpStatus.CONFLICT, "The track already has a score", ArrangementSupport.ENTITY, "scoreWriting.arrangementExists");
    }

    static String actor(AbstractAuthenticationToken token) {
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        return actor == null || actor.isBlank() ? "system" : actor;
    }
}
