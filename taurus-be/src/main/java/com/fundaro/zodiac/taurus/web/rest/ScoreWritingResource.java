package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ApplyEngravingDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSavedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingAppliedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingJobDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingOptionsDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.NewWrittenPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ScoreDraftDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.WrittenPartDTO;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEditLockService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEngravingService;
import com.fundaro.zodiac.taurus.service.scorewriting.WrittenPartService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

/**
 * Edit lock, drafts, written parts and engravings of a track, for archivists and administrators: access is restricted
 * by the security configuration of {@code /api/tracks/**}. The lock serves the correction editor too and needs only
 * score playback; drafts, written parts and engravings belong to the writing editor.
 */
@RestController
@RequestMapping("/api/tracks/{trackId}")
public class ScoreWritingResource {

    private final ScoreEditLockService lockService;
    private final ScoreDraftService draftService;
    private final WrittenPartService writtenPartService;
    private final ScoreEngravingService engravingService;

    public ScoreWritingResource(
        ScoreEditLockService lockService,
        ScoreDraftService draftService,
        WrittenPartService writtenPartService,
        ScoreEngravingService engravingService
    ) {
        this.lockService = lockService;
        this.draftService = draftService;
        this.writtenPartService = writtenPartService;
        this.engravingService = engravingService;
    }

    /** Adds a part written from scratch at the end of the track, without pages, with its first draft. */
    @PostMapping("/written-parts")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<WrittenPartDTO> createWrittenPart(
        @PathVariable Long trackId,
        @RequestBody NewWrittenPartDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.status(HttpStatus.CREATED).body(writtenPartService.create(trackId, request, token));
    }

    /** Takes the lock when the editor opens; {@code takeOver} takes it from the author holding it. */
    @PostMapping("/scores/{scoreId}/edit-lock")
    @RequiresTenantFeature(TenantFeature.SCORE_PLAYBACK)
    public ResponseEntity<EditLockDTO> acquireLock(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestBody EditLockRequestDTO request,
        @RequestParam(value = "takeOver", defaultValue = "false") boolean takeOver,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(lockService.acquire(trackId, scoreId, session(request), takeOver, token));
    }

    /** Renews the lock, every 30 seconds while the editor is open. */
    @PutMapping("/scores/{scoreId}/edit-lock")
    @RequiresTenantFeature(TenantFeature.SCORE_PLAYBACK)
    public ResponseEntity<EditLockDTO> renewLock(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestBody EditLockRequestDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(lockService.renew(trackId, scoreId, session(request), token));
    }

    @DeleteMapping("/scores/{scoreId}/edit-lock")
    @RequiresTenantFeature(TenantFeature.SCORE_PLAYBACK)
    public ResponseEntity<Void> releaseLock(@PathVariable Long trackId, @PathVariable Long scoreId, @RequestParam("session") String session) {
        lockService.release(trackId, scoreId, session);
        return ResponseEntity.noContent().build();
    }

    /** The draft of the part, or no content when there is none. */
    @GetMapping("/scores/{scoreId}/score-draft")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<ScoreDraftDTO> draft(@PathVariable Long trackId, @PathVariable Long scoreId) {
        return draftService.get(trackId, scoreId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PutMapping("/scores/{scoreId}/score-draft")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<DraftSavedDTO> saveDraft(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestBody DraftRequestDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(draftService.save(trackId, scoreId, request, token));
    }

    /** Discards the draft; {@code session} identifies the editor making the request, if any. */
    @DeleteMapping("/scores/{scoreId}/score-draft")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<Void> discardDraft(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @RequestParam(value = "session", required = false) String session,
        AbstractAuthenticationToken token
    ) {
        draftService.discard(trackId, scoreId, session, token);
        return ResponseEntity.noContent().build();
    }

    /** Queues the engraving of a version into pages and a PDF; the options left out take the defaults of the service. */
    @PostMapping("/scores/{scoreId}/score-versions/{versionId}/engravings")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<EngravingJobDTO> startEngraving(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @PathVariable Long versionId,
        @RequestBody(required = false) EngravingOptionsDTO options,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(engravingService.start(trackId, scoreId, versionId, options, token));
    }

    /** The latest engraving of the version, or no content when there is none. */
    @GetMapping("/scores/{scoreId}/score-versions/{versionId}/engravings")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<EngravingJobDTO> engraving(@PathVariable Long trackId, @PathVariable Long scoreId, @PathVariable Long versionId) {
        return engravingService.latest(trackId, scoreId, versionId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** Assigns the engraved pages, in place of the pages of the part or to a new part. */
    @PostMapping("/scores/{scoreId}/score-versions/{versionId}/engravings/{jobId}/apply")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<EngravingAppliedDTO> applyEngraving(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @PathVariable Long versionId,
        @PathVariable Long jobId,
        @RequestBody ApplyEngravingDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(engravingService.apply(trackId, scoreId, versionId, jobId, request, token));
    }

    /** PDF of the latest engraving of the version. */
    @GetMapping("/scores/{scoreId}/score-versions/{versionId}/engravings/pdf")
    @RequiresTenantFeature(TenantFeature.SCORE_WRITING)
    public ResponseEntity<byte[]> engravingPdf(
        @PathVariable Long trackId,
        @PathVariable Long scoreId,
        @PathVariable Long versionId,
        AbstractAuthenticationToken token
    ) {
        MediaService.MediaContent content = engravingService.pdf(trackId, scoreId, versionId, token);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(content.fileName(), StandardCharsets.UTF_8).build());
        headers.set("X-Content-Type-Options", "nosniff");
        return ResponseEntity.ok().headers(headers).body(content.bytes());
    }

    private static String session(EditLockRequestDTO request) {
        return request == null ? null : request.session();
    }
}
