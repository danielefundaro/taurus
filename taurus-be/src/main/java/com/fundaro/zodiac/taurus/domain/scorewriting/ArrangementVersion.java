package com.fundaro.zodiac.taurus.domain.scorewriting;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

import java.time.ZonedDateTime;

/**
 * Immutable version of the score of a track: compressed MusicXML with one part for each row, stored as media of the
 * parts. Saving always creates a new version; approval only changes its status.
 */
@Entity
@Table(name = "arrangement_version")
public class ArrangementVersion extends TenantAuditedEntity {

    @Column(name = "arrangement_id", nullable = false, updatable = false)
    private Long arrangementId;

    @Column(name = "version_number", nullable = false, updatable = false)
    private Integer versionNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ScoreVersionStatus status;

    @Column(name = "media_asset_id", nullable = false, updatable = false)
    private Long mediaAssetId;

    /** Version the writing started from, {@code null} for the first one. */
    @Column(name = "parent_version_id", updatable = false)
    private Long parentVersionId;

    /** The rows, as JSON: for each part of the file, in order, its id, its name and the instruments of the row. */
    @Column(name = "rows_json", nullable = false, updatable = false, columnDefinition = "text")
    private String rowsJson;

    /** Written in concert pitch, as the {@code concert-score} element of the file says; transposed otherwise. */
    @Column(name = "concert_pitch", nullable = false, updatable = false)
    private Boolean concertPitch;

    @Column(name = "measure_count", nullable = false, updatable = false)
    private Integer measureCount;

    /** The automatic checks of each row, as JSON, in the order of the rows. */
    @Column(name = "checks_json", nullable = false, updatable = false, columnDefinition = "text")
    private String checksJson;

    @Column(name = "approved_by")
    private String approvedBy;

    @Column(name = "approved_at")
    private ZonedDateTime approvedAt;

    public Long getArrangementId() {
        return arrangementId;
    }

    public void setArrangementId(Long arrangementId) {
        this.arrangementId = arrangementId;
    }

    public Integer getVersionNumber() {
        return versionNumber;
    }

    public void setVersionNumber(Integer versionNumber) {
        this.versionNumber = versionNumber;
    }

    public ScoreVersionStatus getStatus() {
        return status;
    }

    public void setStatus(ScoreVersionStatus status) {
        this.status = status;
    }

    public Long getMediaAssetId() {
        return mediaAssetId;
    }

    public void setMediaAssetId(Long mediaAssetId) {
        this.mediaAssetId = mediaAssetId;
    }

    public Long getParentVersionId() {
        return parentVersionId;
    }

    public void setParentVersionId(Long parentVersionId) {
        this.parentVersionId = parentVersionId;
    }

    public String getRowsJson() {
        return rowsJson;
    }

    public void setRowsJson(String rowsJson) {
        this.rowsJson = rowsJson;
    }

    public Boolean getConcertPitch() {
        return concertPitch;
    }

    public void setConcertPitch(Boolean concertPitch) {
        this.concertPitch = concertPitch;
    }

    public Integer getMeasureCount() {
        return measureCount;
    }

    public void setMeasureCount(Integer measureCount) {
        this.measureCount = measureCount;
    }

    public String getChecksJson() {
        return checksJson;
    }

    public void setChecksJson(String checksJson) {
        this.checksJson = checksJson;
    }

    public String getApprovedBy() {
        return approvedBy;
    }

    public void setApprovedBy(String approvedBy) {
        this.approvedBy = approvedBy;
    }

    public ZonedDateTime getApprovedAt() {
        return approvedAt;
    }

    public void setApprovedAt(ZonedDateTime approvedAt) {
        this.approvedAt = approvedAt;
    }
}
