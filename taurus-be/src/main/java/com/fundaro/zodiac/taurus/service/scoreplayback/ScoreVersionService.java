package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.Media;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.CorrectionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.MeasureBoxDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.MusicXmlPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PartPlaybackSettingsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreEditorDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.TrackPlaybackSettingsDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.MusicXmlException;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.PartInfo;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionWriter.NewVersion;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrClient;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrException;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEditLockService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreWritingMetrics;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.w3c.dom.Document;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Management of the MusicXML versions of a part: upload, correction, approval, choice of the current version and
 * playback settings. Reserved to archivists and administrators by the security configuration. MIDI files are converted
 * into MusicXML by the OMR service, when it is configured. Approving a version closes the error reports made on the
 * other versions of the part. Versions written in the correction and in the writing editor are accepted only from the
 * editor session that holds the edit lock of the part.
 */
@Service
@Transactional
public class ScoreVersionService {

    static final String MEDIA_CATEGORY = ScoreVersionWriter.MEDIA_CATEGORY;
    private static final String CORRECTION_FORMAT = "correction";
    private static final List<String> MUSICXML_EXTENSIONS = List.of(".musicxml", ".xml", ".mxl");
    private static final List<String> MIDI_EXTENSIONS = List.of(".mid", ".midi");

    private final ScorePlaybackSupport support;
    private final ScoreVersionRepository versionRepository;
    private final TracksRepository tracksRepository;
    private final MediaService mediaService;
    private final ApplicationProperties properties;
    private final ScoreVersionWriter writer;
    private final OmrClient omrClient;
    private final ScorePlaybackMetrics metrics;
    private final ScoreErrorReportService reportService;
    private final ScoreEditLockService lockService;
    private final ScoreDraftService draftService;
    private final TenantFeatureService tenantFeatureService;
    private final ScoreWritingMetrics writingMetrics;

    public ScoreVersionService(
        ScorePlaybackSupport support,
        ScoreVersionRepository versionRepository,
        TracksRepository tracksRepository,
        MediaService mediaService,
        ApplicationProperties properties,
        ScoreVersionWriter writer,
        OmrClient omrClient,
        ScorePlaybackMetrics metrics,
        ScoreErrorReportService reportService,
        ScoreEditLockService lockService,
        ScoreDraftService draftService,
        TenantFeatureService tenantFeatureService,
        ScoreWritingMetrics writingMetrics
    ) {
        this.support = support;
        this.versionRepository = versionRepository;
        this.tracksRepository = tracksRepository;
        this.mediaService = mediaService;
        this.properties = properties;
        this.writer = writer;
        this.omrClient = omrClient;
        this.metrics = metrics;
        this.reportService = reportService;
        this.lockService = lockService;
        this.draftService = draftService;
        this.tenantFeatureService = tenantFeatureService;
        this.writingMetrics = writingMetrics;
    }

    /** A readable upload: the MusicXML document, converted when the file is MIDI. */
    private record Upload(Document document, ScoreVersionOrigin origin) {}

    @Transactional(readOnly = true)
    public List<ScoreVersionDTO> versions(Long trackId, Long scoreId) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        return versionRepository.findAllBySheetMusicIdAndDeletedFalseOrderByVersionNumberDesc(part.getId()).stream()
            .map(version -> support.toDto(version, part))
            .toList();
    }

    /** Parts contained in a MusicXML file, or tracks of a MIDI file, so that the user can choose which one to import. */
    @Transactional(readOnly = true)
    public List<MusicXmlPartDTO> inspect(Long trackId, Long scoreId, MultipartFile file) {
        support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        Document document = readUpload(file).document();
        return MusicXmlDocuments.parts(document).stream()
            .map(part -> new MusicXmlPartDTO(part.id(), part.name(), part.measureCount()))
            .toList();
    }

    /**
     * Stores one part of an uploaded MusicXML or MIDI file as a new version and makes it the current one.
     *
     * @param partId  part of the file to import; may be omitted when the file contains a single part
     * @param approve stores the version as already approved
     */
    public ScoreVersionDTO upload(Long trackId, Long scoreId, MultipartFile file, String partId, boolean approve, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        Upload upload = readUpload(file);
        List<PartInfo> parts = MusicXmlDocuments.parts(upload.document());
        if (parts.isEmpty()) throw rejectedUpload(upload.origin(), invalidUpload("noParts"));
        PartInfo selected = selectPart(parts, partId);

        Document single = MusicXmlDocuments.singlePart(upload.document(), selected.id());
        ScoreVersion version;
        String actor = actor(token);
        try {
            version = writer.write(
                new NewVersion(
                    part,
                    single,
                    upload.origin(),
                    file.getOriginalFilename(),
                    file.getOriginalFilename(),
                    selected.name(),
                    ScorePlaybackSupport.pagesFingerprint(part),
                    null,
                    null,
                    null,
                    approve,
                    actor
                ),
                (content, fileName) -> mediaService.store(content, fileName, MusicXmlDocuments.COMPRESSED_MEDIA_TYPE, MEDIA_CATEGORY, token)
            ).version();
        } catch (MusicXmlException exception) {
            throw rejectedUpload(upload.origin(), invalidUpload(exception.reason()));
        }
        metrics.upload(format(upload.origin()), "stored");

        part.setCurrentScoreVersionId(version.getId());
        if (approve) reportService.closeForApproval(part, version.getId(), actor);
        return support.toDto(version, part);
    }

    /** A version opened in the correction editor: its MusicXML, the pages of the part and the position of the measures. */
    @Transactional(readOnly = true)
    public ScoreEditorDTO editor(Long trackId, Long scoreId, Long versionId, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        ScoreVersion version = requireVersion(part, versionId);
        byte[] stored = mediaService.getContent(version.getMediaAssetId(), token).bytes();
        String musicXml = new String(MusicXmlDocuments.toXml(MusicXmlDocuments.read(stored)), StandardCharsets.UTF_8);
        List<Long> pages = part.getMedia().stream().map(Media::getId).toList();
        return new ScoreEditorDTO(support.toDto(version, part), musicXml, pages, support.layout(version));
    }

    /**
     * Stores the content written in an editor as a new version and makes it the current one: a correction or, with
     * origin {@code WRITING}, a version written in the writing editor.
     * <p>
     * A correction derives from {@code parentVersionId}: it inherits the pages of its parent and, through
     * {@code measureSources}, the position of the measures on them.
     */
    public ScoreVersionDTO correct(Long trackId, Long scoreId, CorrectionDTO correction, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        if (correction != null && correction.origin() == ScoreVersionOrigin.WRITING) return write(part, correction, token);
        if (correction != null && correction.origin() != null && correction.origin() != ScoreVersionOrigin.CORRECTION) {
            throw rejectedCorrection(invalidCorrection("origin"));
        }
        if (correction == null || correction.parentVersionId() == null) throw versionNotFound();
        lockService.requireHeld(part.getId(), correction.editSession(), token);
        ScoreVersion parent = requireVersion(part, correction.parentVersionId());
        if (correction.content() == null || correction.content().isBlank()) throw rejectedCorrection(invalidCorrection("empty"));
        byte[] content = correction.content().getBytes(StandardCharsets.UTF_8);
        long maxBytes = properties.getScorePlayback().getMaxUploadBytes();
        if (content.length > maxBytes) {
            throw rejectedCorrection(
                new RequestAlertException(HttpStatus.CONTENT_TOO_LARGE, "Score file too large", ScorePlaybackSupport.ENTITY, "scorePlayback.upload.tooLarge")
                    .with("maxMegabytes", (int) (maxBytes / (1024 * 1024)))
            );
        }

        Document document;
        List<PartInfo> parts;
        try {
            document = MusicXmlDocuments.read(content);
            parts = MusicXmlDocuments.parts(document);
        } catch (MusicXmlException exception) {
            throw rejectedCorrection(invalidCorrection(exception.reason()));
        }
        if (parts.size() != 1) throw rejectedCorrection(invalidCorrection(parts.isEmpty() ? "noParts" : "severalParts"));
        PartInfo single = parts.get(0);
        List<MeasureBoxDTO> layout;
        try {
            layout = correctionLayout(support.layout(parent), parent.getMeasureCount(), single.measureCount(), correction.measureSources());
        } catch (RequestAlertException exception) {
            throw rejectedCorrection(exception);
        }

        String actor = actor(token);
        ScoreVersion version;
        try {
            version = writer.write(
                new NewVersion(
                    part,
                    MusicXmlDocuments.singlePart(document, single.id()),
                    ScoreVersionOrigin.CORRECTION,
                    "correzione",
                    null,
                    parent.getSourcePartName(),
                    parent.getPagesFingerprint(),
                    null,
                    parent.getId(),
                    layout,
                    correction.approve(),
                    actor
                ),
                (stored, fileName) -> mediaService.store(stored, fileName, MusicXmlDocuments.COMPRESSED_MEDIA_TYPE, MEDIA_CATEGORY, token)
            ).version();
        } catch (MusicXmlException exception) {
            throw rejectedCorrection(invalidCorrection(exception.reason()));
        }
        metrics.upload(CORRECTION_FORMAT, "stored");
        writingMetrics.save("correction");

        part.setCurrentScoreVersionId(version.getId());
        if (correction.approve()) reportService.closeForApproval(part, version.getId(), actor);
        return support.toDto(version, part);
    }

    /**
     * Stores a version written in the writing editor and removes the draft of the part. When another version became the
     * current one after the writing started, the author has to confirm that the written one replaces it.
     */
    private ScoreVersionDTO write(SheetsMusic part, CorrectionDTO request, AbstractAuthenticationToken token) {
        tenantFeatureService.requireEnabled(TenantFeature.SCORE_WRITING);
        lockService.requireHeld(part.getId(), request.editSession(), token);
        ScoreVersion parent = request.parentVersionId() == null ? null : requireVersion(part, request.parentVersionId());
        if (!request.confirmOutdated() && !Objects.equals(part.getCurrentScoreVersionId(), request.parentVersionId())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Another version became current", ScorePlaybackSupport.ENTITY, "scoreWriting.draftOutdated");
        }
        ScoreDraftService.Content content = draftService.readContent(request.content());

        String actor = actor(token);
        ScoreVersion version;
        try {
            version = writer.write(
                new NewVersion(
                    part,
                    content.document(),
                    ScoreVersionOrigin.WRITING,
                    "scrittura",
                    null,
                    content.part().name(),
                    null,
                    null,
                    parent == null ? null : parent.getId(),
                    null,
                    request.approve(),
                    actor
                ),
                (stored, fileName) -> mediaService.store(stored, fileName, MusicXmlDocuments.COMPRESSED_MEDIA_TYPE, MEDIA_CATEGORY, token)
            ).version();
        } catch (MusicXmlException exception) {
            throw new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid written score", ScorePlaybackSupport.ENTITY, "scoreWriting.contentInvalid")
                .with("reason", exception.reason());
        }
        writingMetrics.save("writing");

        part.setCurrentScoreVersionId(version.getId());
        draftService.remove(part.getId());
        if (request.approve()) reportService.closeForApproval(part, version.getId(), actor);
        return support.toDto(version, part);
    }

    /** Marks the version as approved and plays it for the part. */
    public ScoreVersionDTO approve(Long trackId, Long scoreId, Long versionId, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        ScoreVersion version = requireVersion(part, versionId);
        if (version.getStatus() != ScoreVersionStatus.APPROVED) {
            String actor = actor(token);
            ScoreVersionWriter.approve(version, actor);
            version.touchAudit(actor);
            reportService.closeForApproval(part, version.getId(), actor);
        }
        part.setCurrentScoreVersionId(version.getId());
        return support.toDto(version, part);
    }

    public ScoreVersionDTO makeCurrent(Long trackId, Long scoreId, Long versionId) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        ScoreVersion version = requireVersion(part, versionId);
        part.setCurrentScoreVersionId(version.getId());
        return support.toDto(version, part);
    }

    /** Compressed MusicXML of a version, for download and editing in a notation program. */
    @Transactional(readOnly = true)
    public MediaService.MediaContent file(Long trackId, Long scoreId, Long versionId, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        return mediaService.getContent(requireVersion(part, versionId).getMediaAssetId(), token);
    }

    public PartPlaybackSettingsDTO updatePartSettings(Long trackId, Long scoreId, PartPlaybackSettingsDTO settings) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        PlaybackSettingsValidator.requireValidSound(
            ScorePlaybackSupport.ENTITY,
            settings.transpositionOverride(),
            null,
            settings.soundBankOverride(),
            settings.soundProgramOverride(),
            null
        );
        part.setTranspositionOverride(settings.transpositionOverride());
        part.setSoundBankOverride(settings.soundBankOverride());
        part.setSoundProgramOverride(settings.soundProgramOverride());
        return new PartPlaybackSettingsDTO(part.getTranspositionOverride(), part.getSoundBankOverride(), part.getSoundProgramOverride());
    }

    /** Changes tempo and reference part of the track; the response carries the new track version. */
    public TrackPlaybackSettingsDTO updateTrackSettings(Long trackId, TrackPlaybackSettingsDTO settings, AbstractAuthenticationToken token) {
        Tracks track = support.requireTrack(trackId, Viewer.MANAGER);
        if (settings.version() != null && !settings.version().equals(track.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Track was modified by another request", ScorePlaybackSupport.ENTITY, "scorePlayback.settings.versionConflict");
        }
        PlaybackSettingsValidator.requireValidTempo(ScorePlaybackSupport.ENTITY, settings.tempoBpm());
        if (settings.referenceScoreId() != null) support.requirePart(track, settings.referenceScoreId());
        track.setTempoBpm(settings.tempoBpm());
        track.setReferenceSheetMusicId(settings.referenceScoreId());
        track.setEditBy(actor(token));
        track.setEditDate(new Date());
        Tracks saved = tracksRepository.saveAndFlush(track);
        return new TrackPlaybackSettingsDTO(saved.getTempoBpm(), saved.getReferenceSheetMusicId(), saved.getEntityVersion());
    }

    private Upload readUpload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "File is empty", ScorePlaybackSupport.ENTITY, "scorePlayback.upload.empty");
        }
        String name = Objects.requireNonNullElse(file.getOriginalFilename(), "").toLowerCase(Locale.ROOT);
        boolean midi = omrClient.isConfigured() && MIDI_EXTENSIONS.stream().anyMatch(name::endsWith);
        if (!midi && MUSICXML_EXTENSIONS.stream().noneMatch(name::endsWith)) {
            throw new RequestAlertException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported score file", ScorePlaybackSupport.ENTITY, "scorePlayback.upload.unsupportedFormat");
        }
        ScoreVersionOrigin origin = midi ? ScoreVersionOrigin.UPLOAD_MIDI : ScoreVersionOrigin.UPLOAD_MUSICXML;
        long maxBytes = properties.getScorePlayback().getMaxUploadBytes();
        if (file.getSize() > maxBytes) {
            throw rejectedUpload(
                origin,
                new RequestAlertException(HttpStatus.CONTENT_TOO_LARGE, "Score file too large", ScorePlaybackSupport.ENTITY, "scorePlayback.upload.tooLarge")
                    .with("maxMegabytes", (int) (maxBytes / (1024 * 1024)))
            );
        }
        try {
            byte[] content = file.getBytes();
            return new Upload(MusicXmlDocuments.read(midi ? convertMidi(file.getOriginalFilename(), content) : content), origin);
        } catch (MusicXmlException exception) {
            throw rejectedUpload(origin, invalidUpload(exception.reason()));
        } catch (IOException exception) {
            throw rejectedUpload(origin, invalidUpload("unreadable"));
        }
    }

    private byte[] convertMidi(String fileName, byte[] content) {
        try {
            return omrClient.convertMidi(fileName, content);
        } catch (OmrException exception) {
            if (exception.isUnavailable()) {
                metrics.upload("midi", "unavailable");
                throw new RequestAlertException(HttpStatus.SERVICE_UNAVAILABLE, "OMR service unavailable", ScorePlaybackSupport.ENTITY, "scorePlayback.omr.unavailable");
            }
            throw rejectedUpload(ScoreVersionOrigin.UPLOAD_MIDI, invalidUpload("unreadableMidi"));
        }
    }

    private RequestAlertException rejectedUpload(ScoreVersionOrigin origin, RequestAlertException exception) {
        metrics.upload(format(origin), "rejected");
        return exception;
    }

    private static String format(ScoreVersionOrigin origin) {
        return origin == ScoreVersionOrigin.UPLOAD_MIDI ? "midi" : "musicxml";
    }

    private static PartInfo selectPart(List<PartInfo> parts, String partId) {
        if (partId == null || partId.isBlank()) {
            if (parts.size() == 1) return parts.get(0);
            throw new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "The file contains several parts", ScorePlaybackSupport.ENTITY, "scorePlayback.upload.partRequired");
        }
        return parts.stream()
            .filter(part -> part.id().equals(partId))
            .findFirst()
            .orElseThrow(() -> new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Part not found in the file", ScorePlaybackSupport.ENTITY, "scorePlayback.upload.partNotFound"));
    }

    private ScoreVersion requireVersion(SheetsMusic part, Long versionId) {
        return versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(versionId, part.getId()).orElseThrow(ScoreVersionService::versionNotFound);
    }

    private static RequestAlertException versionNotFound() {
        return new RequestAlertException(HttpStatus.NOT_FOUND, "Score version not found", ScorePlaybackSupport.ENTITY, "scorePlayback.version.notFound");
    }

    /**
     * Positions of the measures of a correction, taken from those of its parent.
     *
     * @param sources for each measure of the correction, the position from 0 of the measure of the parent it comes from;
     *                {@code null} keeps the positions only when the number of measures did not change
     */
    static List<MeasureBoxDTO> correctionLayout(List<MeasureBoxDTO> parentLayout, int parentMeasures, int measures, List<Integer> sources) {
        if (sources != null) {
            boolean valid = sources.size() == measures && sources.stream().allMatch(source -> source == null || (source >= 0 && source < parentMeasures));
            if (!valid) throw invalidCorrection("measureSources");
        }
        if (parentLayout == null) return null;
        if (sources == null) return parentMeasures == measures ? parentLayout : null;
        Map<Integer, List<MeasureBoxDTO>> byMeasure = parentLayout.stream().collect(Collectors.groupingBy(MeasureBoxDTO::measure));
        List<MeasureBoxDTO> layout = new ArrayList<>();
        for (int index = 0; index < sources.size(); index++) {
            Integer source = sources.get(index);
            if (source == null) continue;
            for (MeasureBoxDTO box : byMeasure.getOrDefault(source + 1, List.of())) {
                layout.add(new MeasureBoxDTO(index + 1, box.page(), box.x(), box.y(), box.width(), box.height(), box.approximate()));
            }
        }
        return layout.isEmpty() ? null : layout;
    }

    private RequestAlertException rejectedCorrection(RequestAlertException exception) {
        metrics.upload(CORRECTION_FORMAT, "rejected");
        return exception;
    }

    private static RequestAlertException invalidUpload(String reason) {
        return new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid MusicXML file", ScorePlaybackSupport.ENTITY, "scorePlayback.upload.invalid")
            .with("reason", reason);
    }

    private static RequestAlertException invalidCorrection(String reason) {
        return new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid correction", ScorePlaybackSupport.ENTITY, "scorePlayback.correction.invalid")
            .with("reason", reason);
    }

    private static String actor(AbstractAuthenticationToken token) {
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        return actor == null || actor.isBlank() ? "system" : actor;
    }

}
