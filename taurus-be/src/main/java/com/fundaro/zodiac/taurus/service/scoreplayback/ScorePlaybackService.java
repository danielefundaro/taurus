package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreRecognitionJob;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.UsersService;
import com.fundaro.zodiac.taurus.service.dto.UsersDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.Availability;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PartPlaybackDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PartPlaybackSettingsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PlaybackVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.TrackPlaybackDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSummaryDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEditLockService;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Read side of score playback, for every role that can see the track.
 * <p>
 * Archivists and administrators listen to any current version and see every warning. The other roles listen to approved
 * versions and to unverified versions that still match the pages of the part; all the parts of a visible track are
 * audible, while the notation of the parts of other instruments stays hidden in the player ({@code ownPart}).
 */
@Service
@Transactional(readOnly = true)
public class ScorePlaybackService {

    private final ScorePlaybackSupport support;
    private final ScoreVersionRepository versionRepository;
    private final MediaService mediaService;
    private final UsersService usersService;
    private final ScoreRecognitionService recognitionService;
    private final ScoreErrorReportService reportService;
    private final ScoreEditLockService lockService;
    private final ScoreDraftService draftService;

    public ScorePlaybackService(
        ScorePlaybackSupport support,
        ScoreVersionRepository versionRepository,
        MediaService mediaService,
        UsersService usersService,
        ScoreRecognitionService recognitionService,
        ScoreErrorReportService reportService,
        ScoreEditLockService lockService,
        ScoreDraftService draftService
    ) {
        this.support = support;
        this.versionRepository = versionRepository;
        this.mediaService = mediaService;
        this.usersService = usersService;
        this.recognitionService = recognitionService;
        this.reportService = reportService;
        this.lockService = lockService;
        this.draftService = draftService;
    }

    public TrackPlaybackDTO overview(Long trackId, AbstractAuthenticationToken token) {
        Viewer viewer = Viewer.of(token);
        Tracks track = support.requireTrack(trackId, viewer);
        Set<Long> ownInstruments = viewer == Viewer.MANAGER ? Set.of() : ScorePlaybackSupport.instrumentIds(
            usersService.findMe(token).map(UsersDTO::getInstruments).orElse(null)
        );
        List<Long> currentIds = track.getScores().stream().map(SheetsMusic::getCurrentScoreVersionId).filter(Objects::nonNull).toList();
        Map<Long, ScoreVersion> versions = currentIds.isEmpty()
            ? Map.of()
            : versionRepository.findAllByIdInAndDeletedFalse(currentIds).stream().collect(Collectors.toMap(ScoreVersion::getId, Function.identity()));
        Map<Long, ScoreRecognitionJob> recognitions = viewer == Viewer.MANAGER ? recognitionService.latestByPart(track.getId()) : Map.of();
        Map<Long, Integer> openReports = viewer == Viewer.MANAGER
            ? reportService.openCounts(track.getScores().stream().map(SheetsMusic::getId).toList())
            : Map.of();
        Map<Long, EditLockDTO> editing = viewer == Viewer.MANAGER
            ? lockService.active(track.getScores().stream().map(SheetsMusic::getId).filter(Objects::nonNull).toList())
            : Map.of();
        Map<Long, DraftSummaryDTO> drafts = viewer == Viewer.MANAGER ? draftService.summaries(track.getScores()) : Map.of();

        List<PartPlaybackDTO> parts = new ArrayList<>();
        int order = 0;
        for (SheetsMusic part : track.getScores()) {
            order++;
            ScoreVersion version = part.getCurrentScoreVersionId() == null ? null : versions.get(part.getCurrentScoreVersionId());
            boolean available = version != null && (viewer == Viewer.MANAGER || ScorePlaybackSupport.usableByListeners(version, part));
            boolean ownPart = viewer == Viewer.MANAGER || part.getInstruments().stream().anyMatch(instrument -> ownInstruments.contains(instrument.getId()));
            parts.add(new PartPlaybackDTO(
                part.getId(),
                order,
                part.getDescription(),
                part.getInstruments().stream().map(ScorePlaybackSupport::instrument).toList(),
                ownPart,
                ScorePlaybackSupport.sound(part),
                available ? Availability.AVAILABLE : Availability.NOT_AVAILABLE,
                available ? playbackVersion(version, part) : null,
                viewer == Viewer.MANAGER
                    ? new PartPlaybackSettingsDTO(part.getTranspositionOverride(), part.getSoundBankOverride(), part.getSoundProgramOverride())
                    : null,
                !part.getMedia().isEmpty(),
                recognitions.containsKey(part.getId()) ? recognitionService.toDto(recognitions.get(part.getId())) : null,
                openReports.getOrDefault(part.getId(), 0),
                editing.get(part.getId()),
                drafts.get(part.getId())
            ));
        }
        Long referenceScoreId = track.getScores().stream().anyMatch(part -> Objects.equals(part.getId(), track.getReferenceSheetMusicId()))
            ? track.getReferenceSheetMusicId()
            : null;
        return new TrackPlaybackDTO(
            track.getId(),
            track.getName(),
            track.getEntityVersion(),
            track.getTempoBpm(),
            referenceScoreId,
            parts,
            viewer == Viewer.MANAGER && recognitionService.isAvailable()
        );
    }

    /** Plain MusicXML of the version played for the part. */
    public byte[] playbackFile(Long trackId, Long scoreId, AbstractAuthenticationToken token) {
        Viewer viewer = Viewer.of(token);
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, viewer), scoreId);
        ScoreVersion version = part.getCurrentScoreVersionId() == null
            ? null
            : versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(part.getCurrentScoreVersionId(), part.getId()).orElse(null);
        if (version == null || (viewer != Viewer.MANAGER && !ScorePlaybackSupport.usableByListeners(version, part))) {
            throw new RequestAlertException(HttpStatus.NOT_FOUND, "Playback not available", ScorePlaybackSupport.ENTITY, "scorePlayback.playback.notAvailable");
        }
        byte[] stored = mediaService.getContent(version.getMediaAssetId(), token).bytes();
        return MusicXmlDocuments.toXml(MusicXmlDocuments.read(stored));
    }

    private PlaybackVersionDTO playbackVersion(ScoreVersion version, SheetsMusic part) {
        return new PlaybackVersionDTO(
            version.getId(),
            version.getVersionNumber(),
            version.getStatus(),
            version.getOrigin(),
            version.getMeasureCount(),
            support.checks(version),
            ScorePlaybackSupport.pagesChanged(version, part)
        );
    }
}
