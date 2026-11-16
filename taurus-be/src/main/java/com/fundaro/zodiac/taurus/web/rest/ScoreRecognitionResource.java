package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.PendingReviewsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.RecognitionReportDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreRecognitionReviewService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/**
 * Quality of the optical music recognition of the tenant, for those who manage the catalogue: the summary of the
 * reviews collected at approval and the approvals still to collect. Access is restricted by the security configuration
 * of {@code /api/score-recognition/**}.
 */
@RestController
@RequestMapping("/api/score-recognition")
@RequiresTenantFeature(TenantFeature.SCORE_PLAYBACK)
public class ScoreRecognitionResource {

    private final ScoreRecognitionReviewService reviewService;

    public ScoreRecognitionResource(ScoreRecognitionReviewService reviewService) {
        this.reviewService = reviewService;
    }

    /** Sums by engine and month of the versions recognized from {@code from}, or of all of them, and the most corrected parts. */
    @GetMapping("/report")
    public ResponseEntity<RecognitionReportDTO> report(@RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from) {
        return ResponseEntity.ok(reviewService.report(from));
    }

    /** The latest approvals descending from a version of an engine whose counts were not collected yet. */
    @GetMapping("/pending")
    public ResponseEntity<PendingReviewsDTO> pending(@RequestParam(value = "limit", required = false) Integer limit) {
        return ResponseEntity.ok(reviewService.pending(limit));
    }
}
