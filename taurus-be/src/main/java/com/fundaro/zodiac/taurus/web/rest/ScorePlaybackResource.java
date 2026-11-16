package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.CorrectionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ErrorReportDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ErrorReportRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.MusicXmlPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PartPlaybackSettingsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.RecognitionJobDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreEditorDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.TrackPlaybackDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.TrackPlaybackSettingsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.RecognitionReviewRequestDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreErrorReportService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreRecognitionReviewService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreRecognitionService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Score playback of a track for archivists and administrators: player data, MusicXML versions of the parts and their
 * correction, optical music recognition, playback settings and error reports. Access is restricted by the security
 * configuration of {@code /api/tracks/**}.
 */
@RestController
@RequestMapping("/api/tracks/{trackId}")
@RequiresTenantFeature(TenantFeature.SCORE_PLAYBACK)
public class ScorePlaybackResource {

    private final ScorePlaybackService playbackService;
    private final ScoreVersionService versionService;
    private final ScoreRecognitionService recognitionService;
    private final ScoreErrorReportService reportService;
    private final ScoreRecognitionReviewService reviewService;

    public ScorePlaybackResource(
        ScorePlaybackService playbackService,
        ScoreVersionService versionService,
        ScoreRecognitionService recognitionService,
        ScoreErrorReportService reportService,
        ScoreRecognitionReviewService reviewService
    ) {
        this.playbackService = playbackService;
        this.versionService = versionService;
        this.recognitionService = recognitionService;
        this.reportService = reportService;
        this.reviewService = reviewService;
    }

    /** Recognizes every part with pages that has no recognition queued or running. */
    @PostMapping("/recognitions")
    public ResponseEntity<List<RecognitionJobDTO>> recognizeAll(@PathVariable Long trackId, AbstractAuthenticationToken token) {
        return ResponseEntity.accepted().body(recognitionService.start(trackId, null, token));
    }

    @PostMapping("/scores/{scoreId}/recognitions")
    public ResponseEntity<List<RecognitionJobDTO>> recognize(@PathVariable Long trackId, @PathVariable Long scoreId, AbstractAuthenticationToken token) {
        return ResponseEntity.accepted().body(recognitionService.start(trackId, scoreId, token));
    }

    /** Latest recognition job of each part. */
    @GetMapping("/recognitions")
    public ResponseEntity<List<RecognitionJobDTO>> recognitions(@PathVariable Long trackId) {
        return ResponseEntity.ok(recognitionService.latest(trackId));
    }

    @GetMapping("/playback")
    public ResponseEntity<TrackPlaybackDTO> playback(@PathVariable Long trackId, AbstractAuthenticationToken token) {
        return ResponseEntity.ok(playbackService.overview(trackId, token));
    }

    @GetMapping("/scores/{scoreId}/playback-file")
    public ResponseEntity<byte[]> playbackFile(@PathVariable Long trackId, @PathVariable Long scoreId, AbstractAuthenticationToken token) {
        return ScorePlaybackFiles.musicXml(playbackService.playbackFile(trackId, scoreId, token));
    }

    @PutMapping("/playback-settings")
    public ResponseEntity<TrackPlaybackSettingsDTO> updateTrackSettings(
        @PathVariable Long trackId,
        @RequestBody TrackPlaybackSettingsDTO settings,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(versionService.updateTrackSettings(trackId, settings, token));
    }

    @PutMapping("/scores/{scoreId}/playback-settings")
    public ResponseEntity<PartPlaybackSettingsDTO> updatePartSettings(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestBody PartPlaybackSettingsDTO settings
    ) {
        return ResponseEntity.ok(versionService.updatePartSettings(trackId, scoreId, settings));
    }

    @GetMapping("/scores/{scoreId}/score-versions")
    public ResponseEntity<List<ScoreVersionDTO>> versions(@PathVariable Long trackId, @PathVariable Long scoreId) {
        return ResponseEntity.ok(versionService.versions(trackId, scoreId));
    }

    @PostMapping(value = "/scores/{scoreId}/score-versions/inspect", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<List<MusicXmlPartDTO>> inspect(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestPart("file") MultipartFile file
    ) {
        return ResponseEntity.ok(versionService.inspect(trackId, scoreId, file));
    }

    @PostMapping(value = "/scores/{scoreId}/score-versions", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ScoreVersionDTO> upload(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestPart("file") MultipartFile file,
        @RequestParam(value = "partId", required = false) String partId,
        @RequestParam(value = "approve", defaultValue = "false") boolean approve,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(versionService.upload(trackId, scoreId, file, partId, approve, token));
    }

    /** A correction written in the editor, stored as a new version derived from {@code parentVersionId}. */
    @PostMapping(value = "/scores/{scoreId}/score-versions", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ScoreVersionDTO> correct(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestBody CorrectionDTO correction,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(versionService.correct(trackId, scoreId, correction, token));
    }

    @GetMapping("/scores/{scoreId}/score-versions/{versionId}/editor")
    public ResponseEntity<ScoreEditorDTO> editor(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @PathVariable Long versionId,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(versionService.editor(trackId, scoreId, versionId, token));
    }

    @GetMapping("/scores/{scoreId}/score-versions/{versionId}/file")
    public ResponseEntity<byte[]> versionFile(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @PathVariable Long versionId,
        AbstractAuthenticationToken token
    ) {
        MediaService.MediaContent content = versionService.file(trackId, scoreId, versionId, token);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(MusicXmlDocuments.COMPRESSED_MEDIA_TYPE));
        headers.setContentDisposition(ContentDisposition.attachment().filename(content.fileName(), StandardCharsets.UTF_8).build());
        headers.set("X-Content-Type-Options", "nosniff");
        return ResponseEntity.ok().headers(headers).body(content.bytes());
    }

    @PostMapping("/scores/{scoreId}/score-versions/{versionId}/approve")
    public ResponseEntity<ScoreVersionDTO> approve(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @PathVariable Long versionId,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(versionService.approve(trackId, scoreId, versionId, token));
    }

    /**
     * Counts of the comparison, made in the browser, between an approved version and the version of the engine it
     * descends from: only counts, never the content of the score.
     */
    @PutMapping("/scores/{scoreId}/score-versions/{versionId}/recognition-review")
    public ResponseEntity<Void> recordRecognitionReview(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @PathVariable Long versionId,
        @RequestBody RecognitionReviewRequestDTO review,
        AbstractAuthenticationToken token
    ) {
        reviewService.record(trackId, scoreId, versionId, review, token);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/scores/{scoreId}/score-versions/{versionId}/current")
    public ResponseEntity<ScoreVersionDTO> makeCurrent(@PathVariable Long trackId, @PathVariable Long scoreId, @PathVariable Long versionId) {
        return ResponseEntity.ok(versionService.makeCurrent(trackId, scoreId, versionId));
    }

    @PostMapping("/scores/{scoreId}/error-reports")
    public ResponseEntity<Void> reportError(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestBody ErrorReportRequestDTO request,
        AbstractAuthenticationToken token
    ) {
        reportService.report(trackId, scoreId, request, token);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    /** Open error reports of the parts of the track, then the most recent closed ones. */
    @GetMapping("/error-reports")
    public ResponseEntity<List<ErrorReportDTO>> errorReports(@PathVariable Long trackId) {
        return ResponseEntity.ok(reportService.list(trackId));
    }

    @PostMapping("/error-reports/{reportId}/close")
    public ResponseEntity<ErrorReportDTO> closeErrorReport(@PathVariable Long trackId, @PathVariable Long reportId, AbstractAuthenticationToken token) {
        return ResponseEntity.ok(reportService.close(trackId, reportId, token));
    }
}
