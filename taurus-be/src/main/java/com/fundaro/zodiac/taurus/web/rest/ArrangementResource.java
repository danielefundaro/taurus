package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDraftDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementDraftRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementVersionRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractionRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractionResultDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.NewArrangementDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSavedDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockRequestDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementExtractionService;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementService;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementVersionService;
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
import java.util.List;

/**
 * The score of a track, with its versions, draft, edit lock and the extraction of the parts, for archivists and
 * administrators: access is restricted by the security configuration of {@code /api/tracks/**}. The score belongs to
 * the writing editor.
 */
@RestController
@RequestMapping("/api/tracks/{trackId}/arrangement")
@RequiresTenantFeature(TenantFeature.SCORE_WRITING)
public class ArrangementResource {

    private final ArrangementService arrangementService;
    private final ArrangementVersionService versionService;
    private final ArrangementExtractionService extractionService;

    public ArrangementResource(
        ArrangementService arrangementService,
        ArrangementVersionService versionService,
        ArrangementExtractionService extractionService
    ) {
        this.arrangementService = arrangementService;
        this.versionService = versionService;
        this.extractionService = extractionService;
    }

    /** The score of the track, or no content when it has none. */
    @GetMapping
    public ResponseEntity<ArrangementDTO> arrangement(@PathVariable Long trackId) {
        return arrangementService.get(trackId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** Creates the score of the track with its rows and its first draft. */
    @PostMapping
    public ResponseEntity<ArrangementDTO> create(@PathVariable Long trackId, @RequestBody NewArrangementDTO request, AbstractAuthenticationToken token) {
        return ResponseEntity.status(HttpStatus.CREATED).body(arrangementService.create(trackId, request, token));
    }

    /** Removes the score; the parts stay. {@code session} identifies the editor making the request, if any. */
    @DeleteMapping
    public ResponseEntity<Void> delete(
        @PathVariable Long trackId,
        @RequestParam(value = "session", required = false) String session,
        AbstractAuthenticationToken token
    ) {
        arrangementService.delete(trackId, session, token);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/versions")
    public ResponseEntity<List<ArrangementVersionDTO>> versions(@PathVariable Long trackId) {
        return ResponseEntity.ok(versionService.versions(trackId));
    }

    /** Saves a version from the editor that holds the lock and makes it the current one. */
    @PostMapping("/versions")
    public ResponseEntity<ArrangementVersionDTO> saveVersion(
        @PathVariable Long trackId,
        @RequestBody ArrangementVersionRequestDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.status(HttpStatus.CREATED).body(versionService.save(trackId, request, token));
    }

    /** Compressed MusicXML of a version, for MuseScore. */
    @GetMapping("/versions/{versionId}/file")
    public ResponseEntity<byte[]> versionFile(@PathVariable Long trackId, @PathVariable Long versionId, AbstractAuthenticationToken token) {
        MediaService.MediaContent content = versionService.file(trackId, versionId, token);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(MusicXmlDocuments.COMPRESSED_MEDIA_TYPE));
        headers.setContentDisposition(ContentDisposition.attachment().filename(content.fileName(), StandardCharsets.UTF_8).build());
        headers.set("X-Content-Type-Options", "nosniff");
        return ResponseEntity.ok().headers(headers).body(content.bytes());
    }

    /** Plain MusicXML of a version, for the editor and the listening. */
    @GetMapping("/versions/{versionId}/content")
    public ResponseEntity<byte[]> versionContent(@PathVariable Long trackId, @PathVariable Long versionId, AbstractAuthenticationToken token) {
        return ScorePlaybackFiles.musicXml(versionService.content(trackId, versionId, token));
    }

    /** Marks the version as approved and makes it the current one. */
    @PostMapping("/versions/{versionId}/approve")
    public ResponseEntity<ArrangementVersionDTO> approve(@PathVariable Long trackId, @PathVariable Long versionId, AbstractAuthenticationToken token) {
        return ResponseEntity.ok(versionService.approve(trackId, versionId, token));
    }

    /** Extracts the chosen rows of the current version into the parts of the track. */
    @PostMapping("/versions/{versionId}/extract")
    public ResponseEntity<ExtractionResultDTO> extract(
        @PathVariable Long trackId,
        @PathVariable Long versionId,
        @RequestBody ExtractionRequestDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(extractionService.extract(trackId, versionId, request, token));
    }

    /** The draft of the score, or no content when there is none. */
    @GetMapping("/draft")
    public ResponseEntity<ArrangementDraftDTO> draft(@PathVariable Long trackId) {
        return arrangementService.draft(trackId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PutMapping("/draft")
    public ResponseEntity<DraftSavedDTO> saveDraft(
        @PathVariable Long trackId,
        @RequestBody ArrangementDraftRequestDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(arrangementService.saveDraft(trackId, request, token));
    }

    /** Discards the draft; {@code session} identifies the editor making the request, if any. */
    @DeleteMapping("/draft")
    public ResponseEntity<Void> discardDraft(
        @PathVariable Long trackId,
        @RequestParam(value = "session", required = false) String session,
        AbstractAuthenticationToken token
    ) {
        arrangementService.discardDraft(trackId, session, token);
        return ResponseEntity.noContent().build();
    }

    /** Takes the lock when the editor opens; {@code takeOver} takes it from the author holding it. */
    @PostMapping("/edit-lock")
    public ResponseEntity<EditLockDTO> acquireLock(
        @PathVariable Long trackId,
        @RequestBody EditLockRequestDTO request,
        @RequestParam(value = "takeOver", defaultValue = "false") boolean takeOver,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(arrangementService.acquireLock(trackId, session(request), takeOver, token));
    }

    /** Renews the lock, every 30 seconds while the editor is open. */
    @PutMapping("/edit-lock")
    public ResponseEntity<EditLockDTO> renewLock(@PathVariable Long trackId, @RequestBody EditLockRequestDTO request, AbstractAuthenticationToken token) {
        return ResponseEntity.ok(arrangementService.renewLock(trackId, session(request), token));
    }

    @DeleteMapping("/edit-lock")
    public ResponseEntity<Void> releaseLock(@PathVariable Long trackId, @RequestParam("session") String session) {
        arrangementService.releaseLock(trackId, session);
        return ResponseEntity.noContent().build();
    }

    private static String session(EditLockRequestDTO request) {
        return request == null ? null : request.session();
    }
}
