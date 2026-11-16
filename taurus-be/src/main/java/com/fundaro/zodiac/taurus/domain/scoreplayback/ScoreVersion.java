package com.fundaro.zodiac.taurus.domain.scoreplayback;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

import java.time.ZonedDateTime;

/**
 * Immutable MusicXML version of a part. Recognition, upload and correction always create a new version; approval only
 * changes its status.
 */
@Entity
@Table(name = "score_version")
public class ScoreVersion extends TenantAuditedEntity {

    @Column(name = "sheet_music_id", nullable = false, updatable = false)
    private Long sheetMusicId;

    @Column(name = "version_number", nullable = false, updatable = false)
    private Integer versionNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "origin", nullable = false, updatable = false)
    private ScoreVersionOrigin origin;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ScoreVersionStatus status;

    @Column(name = "media_asset_id", nullable = false, updatable = false)
    private Long mediaAssetId;

    /** SHA-256 of the ordered page digests of the part when the version was produced. */
    @Column(name = "pages_fingerprint", updatable = false)
    private String pagesFingerprint;

    @Column(name = "recognition_job_id", updatable = false)
    private Long recognitionJobId;

    @Column(name = "parent_version_id", updatable = false)
    private Long parentVersionId;

    @Column(name = "source_file_name", updatable = false)
    private String sourceFileName;

    @Column(name = "source_part_name", updatable = false)
    private String sourcePartName;

    @Column(name = "measure_count", nullable = false, updatable = false)
    private Integer measureCount;

    @Column(name = "checks_json", nullable = false, updatable = false, columnDefinition = "text")
    private String checksJson;

    @Column(name = "layout_json", updatable = false, columnDefinition = "text")
    private String layoutJson;

    /** Version of the score of the track the version was extracted from, for the origin {@code ARRANGEMENT}. */
    @Column(name = "arrangement_version_id", updatable = false)
    private Long arrangementVersionId;

    @Column(name = "approved_by")
    private String approvedBy;

    @Column(name = "approved_at")
    private ZonedDateTime approvedAt;

    public Long getSheetMusicId() {
        return sheetMusicId;
    }

    public void setSheetMusicId(Long sheetMusicId) {
        this.sheetMusicId = sheetMusicId;
    }

    public Integer getVersionNumber() {
        return versionNumber;
    }

    public void setVersionNumber(Integer versionNumber) {
        this.versionNumber = versionNumber;
    }

    public ScoreVersionOrigin getOrigin() {
        return origin;
    }

    public void setOrigin(ScoreVersionOrigin origin) {
        this.origin = origin;
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

    public String getPagesFingerprint() {
        return pagesFingerprint;
    }

    public void setPagesFingerprint(String pagesFingerprint) {
        this.pagesFingerprint = pagesFingerprint;
    }

    public Long getRecognitionJobId() {
        return recognitionJobId;
    }

    public void setRecognitionJobId(Long recognitionJobId) {
        this.recognitionJobId = recognitionJobId;
    }

    public Long getParentVersionId() {
        return parentVersionId;
    }

    public void setParentVersionId(Long parentVersionId) {
        this.parentVersionId = parentVersionId;
    }

    public String getSourceFileName() {
        return sourceFileName;
    }

    public void setSourceFileName(String sourceFileName) {
        this.sourceFileName = sourceFileName;
    }

    public String getSourcePartName() {
        return sourcePartName;
    }

    public void setSourcePartName(String sourcePartName) {
        this.sourcePartName = sourcePartName;
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

    public String getLayoutJson() {
        return layoutJson;
    }

    public void setLayoutJson(String layoutJson) {
        this.layoutJson = layoutJson;
    }

    public Long getArrangementVersionId() {
        return arrangementVersionId;
    }

    public void setArrangementVersionId(Long arrangementVersionId) {
        this.arrangementVersionId = arrangementVersionId;
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
