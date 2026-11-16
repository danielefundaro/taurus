package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.FragmentRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.FragmentUpdateDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.ScoreFragmentDTO;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreFragmentService;
import jakarta.validation.Valid;
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
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The fragment library of the writing editor, for those who write the parts: access is restricted by the security
 * configuration of {@code /api/score-fragments/**}.
 */
@RestController
@RequestMapping("/api/score-fragments")
@RequiresTenantFeature(TenantFeature.SCORE_WRITING)
public class ScoreFragmentResource {

    private final ScoreFragmentService fragmentService;

    public ScoreFragmentResource(ScoreFragmentService fragmentService) {
        this.fragmentService = fragmentService;
    }

    /** The fragments of the library, by name, without their content. */
    @GetMapping
    public ResponseEntity<List<ScoreFragmentDTO>> fragments() {
        return ResponseEntity.ok(fragmentService.list());
    }

    /** Saves a fragment written in the editor. */
    @PostMapping
    public ResponseEntity<ScoreFragmentDTO> createFragment(@Valid @RequestBody FragmentRequestDTO request, AbstractAuthenticationToken token) {
        return ResponseEntity.status(HttpStatus.CREATED).body(fragmentService.create(request, token));
    }

    /** The MusicXML of the fragment. */
    @GetMapping("/{fragmentId}/content")
    public ResponseEntity<byte[]> fragmentContent(@PathVariable Long fragmentId) {
        return ScorePlaybackFiles.musicXml(fragmentService.content(fragmentId));
    }

    /** Changes name, category and note of the fragment. */
    @PutMapping("/{fragmentId}")
    public ResponseEntity<ScoreFragmentDTO> updateFragment(
        @PathVariable Long fragmentId,
        @Valid @RequestBody FragmentUpdateDTO request,
        AbstractAuthenticationToken token
    ) {
        return ResponseEntity.ok(fragmentService.update(fragmentId, request, token));
    }

    /** Removes the fragment from the library; the parts where it was inserted do not change. */
    @DeleteMapping("/{fragmentId}")
    public ResponseEntity<Void> deleteFragment(@PathVariable Long fragmentId, AbstractAuthenticationToken token) {
        fragmentService.delete(fragmentId, token);
        return ResponseEntity.noContent().build();
    }
}
