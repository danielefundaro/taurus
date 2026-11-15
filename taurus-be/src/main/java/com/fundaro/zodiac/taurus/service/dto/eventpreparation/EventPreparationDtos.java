package com.fundaro.zodiac.taurus.service.dto.eventpreparation;

import com.fundaro.zodiac.taurus.domain.eventpreparation.PreparationProfile;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.ZonedDateTime;
import java.util.List;

public final class EventPreparationDtos {
    /** Rows a program or a materials list may hold. */
    public static final int MAX_ROWS = 100;
    /** Issues an evaluation returns; {@code issueCount} keeps the total. */
    public static final int MAX_ISSUES = 20;
    /** Rows an issue details; {@code detailCount} keeps the total. */
    public static final int MAX_ISSUE_DETAILS = 20;

    private EventPreparationDtos() {
    }

    public enum Phase {PREPARATION, IN_PROGRESS, FOLLOW_UP, UNKNOWN}

    public enum PreparationStatus {NOT_CONFIGURED, BLOCKED, ATTENTION, READY, UNKNOWN}

    public enum ClosureStatus {TO_CLOSE, CLOSED_WITH_WARNINGS, CLOSED, NOT_REQUIRED, UNKNOWN}

    /** {@code INFO} is a heuristic: it is listed but changes no status. */
    public enum Severity {BLOCKER, WARNING, INFO}

    /** The requirement flags are objects so that a missing one is rejected instead of read as {@code false}. */
    public record Configuration(
        @NotNull PreparationProfile profile,
        @NotNull Boolean locationRequired,
        @NotNull Boolean programRequired,
        @NotNull Boolean scoresRequired,
        @NotNull Boolean availabilityRequired,
        @Min(1) Integer minimumAvailableParticipants,
        @Min(0) @Max(43200) int availabilityDeadlineMinutes,
        @NotNull Boolean materialsRequired,
        @Min(0) @Max(43200) int materialsDeadlineMinutes,
        @NotNull Boolean budgetRequired,
        @NotNull Boolean presenceClosureRequired,
        @NotNull Boolean financialClosureRequired,
        long version
    ) {
    }

    public record ProgramEntryRequest(@NotNull Long trackId, Boolean encore, @Min(1) @Max(86400) Integer plannedDurationSeconds,
                                      @Size(max = 2000) String notes) {
    }

    public record ScoreFile(Long mediaId, String fileName) {
    }

    /**
     * A part of the track: {@code instrumentIds} follow the order of {@code instruments}, {@code unengraved} marks a
     * part with a version and without pages, and {@code files} are the media ready to be opened through the catalogue.
     */
    public record ProgramScore(Long id, String description, List<String> instruments, List<Long> instrumentIds, boolean ready,
                               boolean needsReview, boolean unengraved, List<ScoreFile> files) {
    }

    /**
     * {@code trackName} is the current name, or the saved one once the track is deleted; {@code savedTrackName} is
     * set only when it differs from the current name.
     */
    public record ProgramEntry(Long id, Long trackId, String trackName, String savedTrackName, String trackState,
                               boolean trackAvailable, boolean encore, int order, Integer plannedDurationSeconds,
                               String notes, List<ProgramScore> scores) {
    }

    public record MaterialRequest(@NotNull Long itemId, Long assignmentId, @Min(1) int requiredQuantity,
                                  @Size(max = 2000) String notes) {
    }

    /** {@code problems} are the stable codes of what keeps the row from being ready. */
    public record Material(Long id, Long itemId, String itemName, String inventoryNumber, Long assignmentId,
                           String assignee, int requiredQuantity, Integer outstandingQuantity, String condition,
                           boolean unsafeIssueOpen, boolean confirmed, boolean confirmationObsolete, boolean ready,
                           List<String> problems, String notes) {
    }

    public record Availability(int expected, int available, int unavailable, int missing, Integer minimumRequired,
                               ZonedDateTime deadline) {
    }

    /** A row behind an issue: a track, an item or a piece of data, with the place where it is fixed. */
    public record IssueDetail(Long relatedId, String label, String reason, String message, String action) {
    }

    /** {@code action} is an anchor of the page or a route, chosen for the role of the view; null when it cannot act. */
    public record Issue(String code, String area, Severity severity, String message, String action, Long relatedId,
                        List<IssueDetail> details, int detailCount) {
    }

    /**
     * {@code excludedAreas} are the areas the plan requires but the tenant does not evaluate, because their module
     * is off.
     */
    public record Evaluation(
        ZonedDateTime evaluatedAt,
        Phase phase,
        PreparationStatus preparationStatus,
        ClosureStatus closureStatus,
        int completionPercent,
        int passedChecks,
        int applicableChecks,
        int blockerCount,
        int warningCount,
        int infoCount,
        List<Issue> issues,
        int issueCount,
        List<String> excludedAreas
    ) {
    }

    /** When each confirmation was given and whether it still matches the current data. */
    public record Confirmations(ZonedDateTime budgetAt, boolean budgetCurrent, ZonedDateTime presenceAt,
                                boolean presenceCurrent, ZonedDateTime noMovementsAt, boolean noMovementsCurrent,
                                String noMovementsReason) {
    }

    public record View(Configuration configuration, Evaluation evaluation, List<ProgramEntry> program,
                       Long programVersion, Availability availability, List<Material> materials,
                       Long materialsVersion, Confirmations confirmations) {
    }

    public record ProgramRequest(@NotNull @Size(max = MAX_ROWS) List<@Valid ProgramEntryRequest> entries,
                                 @NotNull Long version) {
    }

    public record MaterialsRequest(@NotNull @Size(max = MAX_ROWS) List<@Valid MaterialRequest> materials,
                                   @NotNull Long version) {
    }

    public record NoMovementsRequest(@Size(max = 500) String reason) {
    }
}
