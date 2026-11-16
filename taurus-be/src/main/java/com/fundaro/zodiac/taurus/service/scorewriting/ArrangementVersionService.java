package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.domain.scorewriting.ArrangementVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.domain.scorewriting.TrackArrangement;
import com.fundaro.zodiac.taurus.repository.scorewriting.ArrangementVersionRepository;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.dto.MediaDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementVersionRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.RowChecksDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.MusicXmlException;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector.ScoreChecks;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionWriter;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementContents.ArrangementContent;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The versions of the score of a track: immutable like the versions of the parts, saved only by the editor session that
 * holds the lock of the score, each with the automatic checks of its rows. Saving a version makes it the current one and
 * removes the draft.
 */
@Service
@Transactional
public class ArrangementVersionService {

    /** Name of the stored file of a version, which MuseScore opens. */
    static final String FILE_NAME = "partitura.mxl";

    private final ScorePlaybackSupport playbackSupport;
    private final ArrangementSupport support;
    private final ArrangementContents contents;
    private final ArrangementVersionRepository versionRepository;
    private final ScoreEditLockService lockService;
    private final ScoreDraftService draftService;
    private final MediaService mediaService;
    private final ScoreWritingMetrics metrics;

    public ArrangementVersionService(
        ScorePlaybackSupport playbackSupport,
        ArrangementSupport support,
        ArrangementContents contents,
        ArrangementVersionRepository versionRepository,
        ScoreEditLockService lockService,
        ScoreDraftService draftService,
        MediaService mediaService,
        ScoreWritingMetrics metrics
    ) {
        this.playbackSupport = playbackSupport;
        this.support = support;
        this.contents = contents;
        this.versionRepository = versionRepository;
        this.lockService = lockService;
        this.draftService = draftService;
        this.mediaService = mediaService;
        this.metrics = metrics;
    }

    @Transactional(readOnly = true)
    public List<ArrangementVersionDTO> versions(Long trackId) {
        TrackArrangement arrangement = arrangement(trackId);
        return versionRepository.findAllByArrangementIdAndDeletedFalseOrderByVersionNumberDesc(arrangement.getId()).stream()
            .map(version -> support.toDto(version, arrangement))
            .toList();
    }

    /**
     * Stores the score written in the editor as a new version, makes it the current one and removes the draft. When
     * another version became the current one after the writing started, the author has to confirm that the written one
     * replaces it.
     *
     * @throws RequestAlertException {@code scoreWriting.locked} without the lock, {@code scorePlayback.version.notFound}
     *                               for a parent of another score, {@code scoreWriting.draftOutdated},
     *                               {@code scorePlayback.version.conflict} for two versions saved at the same time, and the
     *                               errors of the content
     */
    public ArrangementVersionDTO save(Long trackId, ArrangementVersionRequestDTO request, AbstractAuthenticationToken token) {
        TrackArrangement arrangement = arrangement(trackId);
        if (request == null) throw ScoreDraftService.invalidContent("empty");
        lockService.requireHeld(ScoreEditTarget.ARRANGEMENT, arrangement.getId(), request.editSession(), token);
        ArrangementVersion parent = request.parentVersionId() == null ? null : support.requireVersion(arrangement, request.parentVersionId());
        if (!request.confirmOutdated() && !Objects.equals(arrangement.getCurrentVersionId(), request.parentVersionId())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Another version became current", ArrangementSupport.ENTITY, "scoreWriting.draftOutdated");
        }
        ArrangementContent content = contents.read(request.content(), request.rows());
        List<RowChecksDTO> checks = checks(content);

        String actor = ArrangementService.actor(token);
        MediaDTO media = mediaService.store(content.compressed(), FILE_NAME, MusicXmlDocuments.COMPRESSED_MEDIA_TYPE, ScoreVersionWriter.MEDIA_CATEGORY, token);
        ArrangementVersion version = new ArrangementVersion();
        version.initializeAudit(actor);
        version.setArrangementId(arrangement.getId());
        version.setVersionNumber(versionRepository.findMaxVersionNumber(arrangement.getId()) + 1);
        version.setStatus(ScoreVersionStatus.UNVERIFIED);
        if (request.approve()) approve(version, actor);
        version.setMediaAssetId(media.getId());
        version.setParentVersionId(parent == null ? null : parent.getId());
        version.setRowsJson(content.rowsJson());
        version.setConcertPitch(content.concertPitch());
        version.setMeasureCount(content.measureCount());
        version.setChecksJson(contents.json(checks));
        try {
            versionRepository.saveAndFlush(version);
        } catch (DataIntegrityViolationException exception) {
            // Two versions of the same score took the same number at the same time: the later one is refused.
            throw new RequestAlertException(HttpStatus.CONFLICT, "Another version of the score was saved at the same time", ArrangementSupport.ENTITY, "scorePlayback.version.conflict");
        }
        metrics.save("arrangement");

        arrangement.setCurrentVersionId(version.getId());
        arrangement.touchAudit(actor);
        draftService.remove(ScoreEditTarget.ARRANGEMENT, arrangement.getId());
        return support.toDto(version, arrangement);
    }

    /** Marks the version as approved and makes it the current one. */
    public ArrangementVersionDTO approve(Long trackId, Long versionId, AbstractAuthenticationToken token) {
        TrackArrangement arrangement = arrangement(trackId);
        ArrangementVersion version = support.requireVersion(arrangement, versionId);
        String actor = ArrangementService.actor(token);
        if (version.getStatus() != ScoreVersionStatus.APPROVED) {
            approve(version, actor);
            version.touchAudit(actor);
        }
        if (!Objects.equals(arrangement.getCurrentVersionId(), version.getId())) {
            arrangement.setCurrentVersionId(version.getId());
            arrangement.touchAudit(actor);
        }
        return support.toDto(version, arrangement);
    }

    /** Compressed MusicXML of a version, for download and for MuseScore. */
    @Transactional(readOnly = true)
    public MediaService.MediaContent file(Long trackId, Long versionId, AbstractAuthenticationToken token) {
        TrackArrangement arrangement = arrangement(trackId);
        return mediaService.getContent(support.requireVersion(arrangement, versionId).getMediaAssetId(), token);
    }

    /** Plain MusicXML of a version, for the editor and the listening of the score. */
    @Transactional(readOnly = true)
    public byte[] content(Long trackId, Long versionId, AbstractAuthenticationToken token) {
        return MusicXmlDocuments.toXml(MusicXmlDocuments.read(file(trackId, versionId, token).bytes()));
    }

    private TrackArrangement arrangement(Long trackId) {
        return support.requireArrangement(playbackSupport.requireTrack(trackId, Viewer.MANAGER));
    }

    /** The checks of each row, in the order of the rows. */
    private static List<RowChecksDTO> checks(ArrangementContent content) {
        Map<String, ScoreChecks> checks;
        try {
            checks = MusicXmlInspector.inspectParts(content.document());
        } catch (MusicXmlException exception) {
            throw ScoreDraftService.invalidContent(exception.reason());
        }
        return content.rows().stream().map(row -> new RowChecksDTO(row.id(), checks.get(row.id()))).toList();
    }

    private static void approve(ArrangementVersion version, String actor) {
        version.setStatus(ScoreVersionStatus.APPROVED);
        version.setApprovedBy(actor);
        version.setApprovedAt(ZonedDateTime.now());
    }
}
