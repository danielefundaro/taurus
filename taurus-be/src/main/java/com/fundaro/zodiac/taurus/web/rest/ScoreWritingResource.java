package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSavedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.NewWrittenPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.ScoreDraftDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.WrittenPartDTO;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEditLockService;
import com.fundaro.zodiac.taurus.service.scorewriting.WrittenPartService;
import org.springframework.http.HttpStatus;
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

/**
 * Edit lock, drafts and written parts of a track, for archivists and administrators: access is restricted by the
 * security configuration of {@code /api/tracks/**}. The lock serves the correction editor too and needs only score
 * playback; drafts and written parts belong to the writing editor.
 */
@RestController
@RequestMapping("/api/tracks/{trackId}")
public class ScoreWritingResource {

    private final ScoreEditLockService lockService;
    private final ScoreDraftService draftService;
    private final WrittenPartService writtenPartService;

    public ScoreWritingResource(ScoreEditLockService lockService, ScoreDraftService draftService, WrittenPartService writtenPartService) {
        this.lockService = lockService;
        this.draftService = draftService;
        this.writtenPartService = writtenPartService;
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

    private static String session(EditLockRequestDTO request) {
        return request == null ? null : request.session();
    }
}
