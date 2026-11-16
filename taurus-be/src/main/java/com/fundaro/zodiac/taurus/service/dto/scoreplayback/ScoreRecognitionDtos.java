package com.fundaro.zodiac.taurus.service.dto.scoreplayback;

import com.fundaro.zodiac.taurus.domain.scoreplayback.RecognitionEngine;

import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.List;

/** Quality of the optical music recognition: the counts collected at approval and their summary. */
public final class ScoreRecognitionDtos {

    private ScoreRecognitionDtos() {}

    /**
     * Counts of the comparison, made in the browser, between a version of an engine and an approved version descending
     * from it. Each measure of the approved version is correct, of one kind or missing; extra measures are those the
     * engine added.
     */
    public record RecognitionReviewRequestDTO(
        Long engineVersionId,
        Integer referenceMeasures,
        Integer engineMeasures,
        Integer correctMeasures,
        Integer pitchMeasures,
        Integer rhythmMeasures,
        Integer tieMeasures,
        Integer missingMeasures,
        Integer extraMeasures,
        Integer referenceMarks,
        Integer foundMarks
    ) {}

    /** Sums of the reviews of an engine, of a month or of both. */
    public record RecognitionCountsDTO(
        long parts,
        long referenceMeasures,
        long engineMeasures,
        long correctMeasures,
        long pitchMeasures,
        long rhythmMeasures,
        long tieMeasures,
        long missingMeasures,
        long extraMeasures,
        long referenceMarks,
        long foundMarks
    ) {}

    public record EngineSummaryDTO(RecognitionEngine engine, RecognitionCountsDTO counts) {}

    /** Reviews of the versions an engine produced in a month, {@code yyyy-MM} in the time zone of the tenant. */
    public record MonthSummaryDTO(String month, RecognitionEngine engine, RecognitionCountsDTO counts) {}

    /** A part the archivists corrected, with the two versions to compare. */
    public record ReviewedPartDTO(
        Long trackId,
        String trackName,
        Long scoreId,
        String partName,
        RecognitionEngine engine,
        Long engineVersionId,
        int engineVersionNumber,
        Long approvedVersionId,
        int approvedVersionNumber,
        ZonedDateTime approvedAt,
        int referenceMeasures,
        int correctMeasures,
        int correctedMeasures
    ) {}

    /** Summary of the reviews of the versions recognized from {@code from}, or of all of them. */
    public record RecognitionReportDTO(
        LocalDate from,
        List<EngineSummaryDTO> engines,
        List<MonthSummaryDTO> months,
        List<ReviewedPartDTO> parts
    ) {}

    /** An approved version descending from a version of an engine, whose counts were not collected yet. */
    public record PendingReviewDTO(
        Long trackId,
        String trackName,
        Long scoreId,
        String partName,
        RecognitionEngine engine,
        Long engineVersionId,
        int engineVersionNumber,
        Long approvedVersionId,
        int approvedVersionNumber,
        ZonedDateTime approvedAt
    ) {}

    /** The first approvals to collect and how many there are. */
    public record PendingReviewsDTO(long total, List<PendingReviewDTO> items) {}
}
