package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.Media;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJob;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus;
import com.fundaro.zodiac.taurus.multitenancy.TenantContext;
import com.fundaro.zodiac.taurus.repository.MediaRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEngravingJobRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.TracksService;
import com.fundaro.zodiac.taurus.service.dto.ChildrenEntitiesDTO;
import com.fundaro.zodiac.taurus.service.dto.SheetsMusicDTO;
import com.fundaro.zodiac.taurus.service.dto.TracksDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ApplyEngravingDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingAppliedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingHeaderDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingJobDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingOptionsDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingTarget;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrClient;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Engraving of the versions of the parts into pages and a PDF, for archivists and administrators: access is restricted
 * by the security configuration of {@code /api/tracks/**}. The jobs run asynchronously in {@link ScoreEngravingWorker};
 * the pages of a finished job are assigned by the archivist, in place of the pages of the part or in a new part.
 */
@Service
@Transactional
public class ScoreEngravingService {

    static final String ENTITY = "ScoreEngraving";
    static final double MIN_STAFF_SIZE = 4.0;
    static final double MAX_STAFF_SIZE = 9.6;
    static final double MIN_MARGIN = 3.0;
    static final double MAX_MARGIN = 30.0;
    static final int MAX_HEADER_LENGTH = 200;

    private static final Set<ScoreEngravingJobStatus> ACTIVE = Set.of(ScoreEngravingJobStatus.QUEUED, ScoreEngravingJobStatus.RUNNING);
    private static final EngravingOptionsDTO DEFAULTS = new EngravingOptionsDTO(null, null, null, null, null, null);

    private final ScorePlaybackSupport support;
    private final TracksRepository tracksRepository;
    private final TracksService tracksService;
    private final MediaRepository mediaRepository;
    private final MediaService mediaService;
    private final ScoreVersionRepository versionRepository;
    private final ScoreEngravingJobRepository jobRepository;
    private final ScoreEngravingQueue queue;
    private final ScoreEngravingFiles files;
    private final OmrClient omrClient;
    private final ScoreWritingMetrics metrics;
    private final ObjectMapper objectMapper;

    public ScoreEngravingService(
        ScorePlaybackSupport support,
        TracksRepository tracksRepository,
        TracksService tracksService,
        MediaRepository mediaRepository,
        MediaService mediaService,
        ScoreVersionRepository versionRepository,
        ScoreEngravingJobRepository jobRepository,
        ScoreEngravingQueue queue,
        ScoreEngravingFiles files,
        OmrClient omrClient,
        ScoreWritingMetrics metrics,
        ObjectMapper objectMapper
    ) {
        this.support = support;
        this.tracksRepository = tracksRepository;
        this.tracksService = tracksService;
        this.mediaRepository = mediaRepository;
        this.mediaService = mediaService;
        this.versionRepository = versionRepository;
        this.jobRepository = jobRepository;
        this.queue = queue;
        this.files = files;
        this.omrClient = omrClient;
        this.metrics = metrics;
        this.objectMapper = objectMapper;
    }

    /**
     * Queues the engraving of a version of a part.
     *
     * @throws RequestAlertException {@code scoreWriting.engravingUnavailable} without the music service,
     *                               {@code scoreWriting.engravingOptionsInvalid} for an option out of range,
     *                               {@code scoreWriting.engravingRunning} when the part is already being engraved
     */
    public EngravingJobDTO start(Long trackId, Long scoreId, Long versionId, EngravingOptionsDTO options, AbstractAuthenticationToken token) {
        if (!omrClient.isConfigured()) {
            throw new RequestAlertException(HttpStatus.SERVICE_UNAVAILABLE, "Music service not configured", ENTITY, "scoreWriting.engravingUnavailable");
        }
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        requireVersion(part, versionId);
        EngravingOptionsDTO normalized = normalize(options);
        if (jobRepository.existsBySheetMusicIdAndStatusInAndDeletedFalse(part.getId(), ACTIVE)) throw running();

        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        ScoreEngravingJob job = new ScoreEngravingJob();
        job.initializeAudit(actor);
        job.setSheetMusicId(part.getId());
        job.setTrackId(trackId);
        job.setScoreVersionId(versionId);
        job.setOptionsJson(json(normalized));
        job.setStatus(ScoreEngravingJobStatus.QUEUED);
        job.setRequestedBy(actor);
        try {
            jobRepository.saveAndFlush(job);
        } catch (DataIntegrityViolationException exception) {
            throw running();
        }
        String tenant = TenantContext.getTenantCode().orElseGet(() -> SecurityUtils.getTenantIdFromAuthentication(token));
        queue.publishAfterCommit(tenant, job.getId());
        return toDto(job);
    }

    /** Latest engraving of a version of a part, to follow its progress. */
    @Transactional(readOnly = true)
    public Optional<EngravingJobDTO> latest(Long trackId, Long scoreId, Long versionId) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        requireVersion(part, versionId);
        return jobRepository.findFirstBySheetMusicIdAndScoreVersionIdAndDeletedFalseOrderByIdDesc(part.getId(), versionId).map(this::toDto);
    }

    /**
     * Assigns the pages of a finished engraving: in place of the pages of the part, which are removed once nothing else
     * refers to them, or to a new part at the end of the track with the same description and instruments.
     *
     * @throws RequestAlertException {@code version.conflict} when the track changed since the archivist read it,
     *                               {@code scoreWriting.engravingNotFound} for a job of another version,
     *                               {@code scoreWriting.engravingNotReady} when the pages are not there or no longer
     */
    public EngravingAppliedDTO apply(Long trackId, Long scoreId, Long versionId, Long jobId, ApplyEngravingDTO request, AbstractAuthenticationToken token) {
        if (request == null || request.target() == null) throw invalidOption("target");
        // The lock on the track serializes the assignment with the saves of the track.
        Tracks track = tracksRepository.findByIdForUpdate(trackId)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Track not found", ENTITY, "scorePlayback.track.notFound"));
        if (request.trackVersion() != null && !request.trackVersion().equals(track.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Track was modified by another request", ENTITY, "version.conflict");
        }
        SheetsMusic part = support.requirePart(track, scoreId);
        ScoreEngravingJob job = jobRepository.findByIdAndDeletedFalse(jobId)
            .filter(found -> Objects.equals(found.getSheetMusicId(), part.getId()) && Objects.equals(found.getScoreVersionId(), versionId))
            .orElseThrow(ScoreEngravingService::notFound);
        if (job.getStatus() != ScoreEngravingJobStatus.DONE || job.getAppliedAt() != null || job.getPageMediaIds().isEmpty()) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Engraved pages not available", ENTITY, "scoreWriting.engravingNotReady");
        }

        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        String tenant = TenantContext.getTenantCode().orElseGet(() -> SecurityUtils.getTenantIdFromAuthentication(token));
        List<Long> pages = List.copyOf(job.getPageMediaIds());
        SheetsMusic target = request.target() == EngravingTarget.NEW_PART
            ? newPart(track, part, pages, token)
            : replacePages(track, part, pages, tenant, actor);
        target.setEngravedFromVersionId(versionId);
        target.setEngravedPagesFingerprint(ScorePlaybackSupport.pagesFingerprint(target));

        job.setAppliedAt(ZonedDateTime.now());
        job.setAppliedSheetMusicId(target.getId());
        job.getPageMediaIds().clear();
        job.touchAudit(actor);
        tracksRepository.flush();
        metrics.engravingApplied(request.target() == EngravingTarget.NEW_PART ? "newPart" : "replace");
        return new EngravingAppliedDTO(target.getId(), track.getEntityVersion());
    }

    /** PDF of the latest engraving of a version that still has it. */
    @Transactional(readOnly = true)
    public MediaService.MediaContent pdf(Long trackId, Long scoreId, Long versionId, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        requireVersion(part, versionId);
        ScoreEngravingJob job = jobRepository.findFirstByScoreVersionIdAndPdfMediaAssetIdIsNotNullAndDeletedFalseOrderByIdDesc(versionId)
            .filter(found -> Objects.equals(found.getSheetMusicId(), part.getId()))
            .orElseThrow(ScoreEngravingService::notFound);
        return mediaService.getContent(job.getPdfMediaAssetId(), token);
    }

    /** The options within their ranges, with the header texts trimmed and the empty ones left out. */
    static EngravingOptionsDTO normalize(EngravingOptionsDTO options) {
        if (options == null) return DEFAULTS;
        Double staffSize = options.staffSize();
        if (staffSize != null && !(staffSize >= MIN_STAFF_SIZE && staffSize <= MAX_STAFF_SIZE)) throw invalidOption("staffSize");
        Double margin = options.margin();
        if (margin != null && !(margin >= MIN_MARGIN && margin <= MAX_MARGIN)) throw invalidOption("margin");
        EngravingHeaderDTO header = options.header();
        EngravingHeaderDTO texts = header == null
            ? null
            : new EngravingHeaderDTO(
                text(header.title(), "header.title"),
                text(header.composer(), "header.composer"),
                text(header.arranger(), "header.arranger"),
                text(header.partName(), "header.partName")
            );
        return new EngravingOptionsDTO(options.format(), staffSize, margin, texts, options.pageNumbers(), options.measureNumbers());
    }

    public EngravingJobDTO toDto(ScoreEngravingJob job) {
        return new EngravingJobDTO(
            job.getId(),
            job.getSheetMusicId(),
            job.getScoreVersionId(),
            job.getStatus(),
            job.getErrorCode(),
            job.getAttempts(),
            options(job),
            job.getPageCount(),
            List.copyOf(job.getPageMediaIds()),
            job.getPdfMediaAssetId() != null,
            job.getInsertDate(),
            job.getStartedAt(),
            job.getFinishedAt(),
            job.getAppliedAt(),
            job.getAppliedSheetMusicId()
        );
    }

    private SheetsMusic replacePages(Tracks track, SheetsMusic part, List<Long> pages, String tenant, String actor) {
        List<Long> previous = part.getMedia().stream().map(Media::getId).toList();
        // As for an edited page: the old links go first, so that no page is linked twice for a moment.
        part.getMedia().clear();
        tracksRepository.flush();
        pages.forEach(id -> part.getMedia().add(mediaRepository.getReferenceById(id)));
        track.setEditDate(new Date());
        tracksRepository.saveAndFlush(track);
        // The PDF of an earlier engraving no longer matches the pages of the part.
        files.releasePdfs(jobRepository.findAllByAppliedSheetMusicIdAndPdfMediaAssetIdIsNotNullAndDeletedFalse(part.getId()), tenant, actor);
        previous.stream().filter(id -> !pages.contains(id)).forEach(id -> mediaService.deleteIfUnreferenced(id, tenant, actor));
        return part;
    }

    private SheetsMusic newPart(Tracks track, SheetsMusic part, List<Long> pages, AbstractAuthenticationToken token) {
        SheetsMusicDTO created = new SheetsMusicDTO();
        created.setDescription(part.getDescription());
        Set<ChildrenEntitiesDTO> instruments = new LinkedHashSet<>();
        List<Instruments> assigned = part.getInstruments();
        for (int index = 0; index < assigned.size(); index++) instruments.add(child(assigned.get(index).getId(), index));
        created.setInstruments(instruments);
        Set<ChildrenEntitiesDTO> media = new LinkedHashSet<>();
        for (int index = 0; index < pages.size(); index++) media.add(child(pages.get(index), index));
        created.setMedia(media);
        TracksDTO saved = tracksService.appendScores(track.getId(), List.of(created), token);
        Long id = saved.getScores().stream()
            .max(Comparator.comparing(score -> score.getOrder() == null ? 0L : score.getOrder()))
            .map(SheetsMusicDTO::getId)
            .orElseThrow(() -> new IllegalStateException("The engraved part was not added to track " + track.getId()));
        return track.getScores().stream()
            .filter(score -> Objects.equals(score.getId(), id))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("The engraved part " + id + " is not in track " + track.getId()));
    }

    private void requireVersion(SheetsMusic part, Long versionId) {
        if (versionId == null || versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(versionId, part.getId()).isEmpty()) {
            throw new RequestAlertException(HttpStatus.NOT_FOUND, "Score version not found", ENTITY, "scorePlayback.version.notFound");
        }
    }

    private EngravingOptionsDTO options(ScoreEngravingJob job) {
        try {
            return objectMapper.readValue(job.getOptionsJson(), EngravingOptionsDTO.class);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored options of engraving job " + job.getId() + " are not readable", exception);
        }
    }

    private String json(EngravingOptionsDTO options) {
        try {
            return objectMapper.writeValueAsString(options);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to serialize the engraving options", exception);
        }
    }

    private static String text(String value, String field) {
        if (value == null) return null;
        String stripped = value.strip();
        if (stripped.isEmpty()) return null;
        if (stripped.length() > MAX_HEADER_LENGTH) throw invalidOption(field);
        return stripped;
    }

    private static ChildrenEntitiesDTO child(Long id, int index) {
        ChildrenEntitiesDTO child = new ChildrenEntitiesDTO();
        child.setIndex(id);
        child.setOrder((long) index + 1);
        return child;
    }

    private static RequestAlertException invalidOption(String field) {
        return new RequestAlertException(HttpStatus.BAD_REQUEST, "Invalid engraving option", ENTITY, "scoreWriting.engravingOptionsInvalid")
            .with("field", field);
    }

    private static RequestAlertException running() {
        return new RequestAlertException(HttpStatus.CONFLICT, "Engraving already queued or running", ENTITY, "scoreWriting.engravingRunning");
    }

    private static RequestAlertException notFound() {
        return new RequestAlertException(HttpStatus.NOT_FOUND, "Engraving not found", ENTITY, "scoreWriting.engravingNotFound");
    }
}
