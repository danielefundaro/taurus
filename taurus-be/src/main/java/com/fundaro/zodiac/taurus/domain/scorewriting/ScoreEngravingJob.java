package com.fundaro.zodiac.taurus.domain.scorewriting;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;

import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Engraving of a version of a part into pages and a PDF by the music service. At most one job per part is queued or
 * running. The pages of a finished job stay with it until they are assigned to the part or to a new part, or released.
 */
@Entity
@Table(name = "score_engraving_job")
public class ScoreEngravingJob extends TenantAuditedEntity {

    @Column(name = "sheet_music_id", nullable = false, updatable = false)
    private Long sheetMusicId;

    @Column(name = "track_id", nullable = false, updatable = false)
    private Long trackId;

    @Column(name = "score_version_id", nullable = false, updatable = false)
    private Long scoreVersionId;

    /** Options sent to the service, as JSON. */
    @Column(name = "options_json", nullable = false, updatable = false, columnDefinition = "text")
    private String optionsJson;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ScoreEngravingJobStatus status;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "requested_by", nullable = false, updatable = false)
    private String requestedBy;

    @Column(name = "started_at")
    private ZonedDateTime startedAt;

    @Column(name = "finished_at")
    private ZonedDateTime finishedAt;

    @Column(name = "error_code")
    private String errorCode;

    @Column(name = "engine_version")
    private String engineVersion;

    @Column(name = "duration_millis")
    private Long durationMillis;

    @Column(name = "page_count")
    private Integer pageCount;

    @Column(name = "pdf_media_asset_id")
    private Long pdfMediaAssetId;

    /** Pages not yet assigned to a part, in order; empty once assigned or released. */
    @ElementCollection
    @CollectionTable(name = "score_engraving_page", joinColumns = @JoinColumn(name = "job_id"))
    @OrderColumn(name = "page_index")
    @Column(name = "media_asset_id", nullable = false)
    private List<Long> pageMediaIds = new ArrayList<>();

    @Column(name = "applied_at")
    private ZonedDateTime appliedAt;

    /** The part that received the pages: the engraved one or a new part. */
    @Column(name = "applied_sheet_music_id")
    private Long appliedSheetMusicId;

    /** The pages go to the part when the job ends, if the part has no pages then; otherwise they wait as usual. */
    @Column(name = "assign_to_empty_part", nullable = false, updatable = false)
    private boolean assignToEmptyPart;

    public Long getSheetMusicId() {
        return sheetMusicId;
    }

    public void setSheetMusicId(Long sheetMusicId) {
        this.sheetMusicId = sheetMusicId;
    }

    public Long getTrackId() {
        return trackId;
    }

    public void setTrackId(Long trackId) {
        this.trackId = trackId;
    }

    public Long getScoreVersionId() {
        return scoreVersionId;
    }

    public void setScoreVersionId(Long scoreVersionId) {
        this.scoreVersionId = scoreVersionId;
    }

    public String getOptionsJson() {
        return optionsJson;
    }

    public void setOptionsJson(String optionsJson) {
        this.optionsJson = optionsJson;
    }

    public ScoreEngravingJobStatus getStatus() {
        return status;
    }

    public void setStatus(ScoreEngravingJobStatus status) {
        this.status = status;
    }

    public int getAttempts() {
        return attempts;
    }

    public void setAttempts(int attempts) {
        this.attempts = attempts;
    }

    public String getRequestedBy() {
        return requestedBy;
    }

    public void setRequestedBy(String requestedBy) {
        this.requestedBy = requestedBy;
    }

    public ZonedDateTime getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(ZonedDateTime startedAt) {
        this.startedAt = startedAt;
    }

    public ZonedDateTime getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(ZonedDateTime finishedAt) {
        this.finishedAt = finishedAt;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public void setErrorCode(String errorCode) {
        this.errorCode = errorCode;
    }

    public String getEngineVersion() {
        return engineVersion;
    }

    public void setEngineVersion(String engineVersion) {
        this.engineVersion = engineVersion;
    }

    public Long getDurationMillis() {
        return durationMillis;
    }

    public void setDurationMillis(Long durationMillis) {
        this.durationMillis = durationMillis;
    }

    public Integer getPageCount() {
        return pageCount;
    }

    public void setPageCount(Integer pageCount) {
        this.pageCount = pageCount;
    }

    public Long getPdfMediaAssetId() {
        return pdfMediaAssetId;
    }

    public void setPdfMediaAssetId(Long pdfMediaAssetId) {
        this.pdfMediaAssetId = pdfMediaAssetId;
    }

    public List<Long> getPageMediaIds() {
        return pageMediaIds;
    }

    public void setPageMediaIds(List<Long> pageMediaIds) {
        this.pageMediaIds = pageMediaIds;
    }

    public ZonedDateTime getAppliedAt() {
        return appliedAt;
    }

    public void setAppliedAt(ZonedDateTime appliedAt) {
        this.appliedAt = appliedAt;
    }

    public Long getAppliedSheetMusicId() {
        return appliedSheetMusicId;
    }

    public void setAppliedSheetMusicId(Long appliedSheetMusicId) {
        this.appliedSheetMusicId = appliedSheetMusicId;
    }

    public boolean isAssignToEmptyPart() {
        return assignToEmptyPart;
    }

    public void setAssignToEmptyPart(boolean assignToEmptyPart) {
        this.assignToEmptyPart = assignToEmptyPart;
    }
}
