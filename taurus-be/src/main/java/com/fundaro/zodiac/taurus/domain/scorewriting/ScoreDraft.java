package com.fundaro.zodiac.taurus.domain.scorewriting;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

import java.time.ZonedDateTime;

/**
 * The work in progress of the writing editor on a part or a score, saved automatically a few seconds after the last
 * change. It is not a version: nobody listens to it, saving a version removes it, and it never expires. Removed
 * physically with its part or score, since the content is music of the archive and not personal data.
 */
@Entity
@Table(name = "score_draft")
public class ScoreDraft extends TenantAuditedEntity {

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, updatable = false)
    private ScoreEditTarget targetType;

    @Column(name = "target_id", nullable = false, updatable = false)
    private Long targetId;

    /** Version the writing started from, {@code null} for a part without versions; no foreign key, versions get cleaned. */
    @Column(name = "base_version_id")
    private Long baseVersionId;

    /** Compressed MusicXML: a single part, or one part for each row of a score. */
    @Column(name = "content", nullable = false, columnDefinition = "bytea")
    private byte[] content;

    /** Rows of the draft of a score, as JSON: the id of each part of the content, its name and its instruments. */
    @Column(name = "rows_json", columnDefinition = "text")
    private String rowsJson;

    @Column(name = "measure_count", nullable = false)
    private Integer measureCount;

    /** Keycloak id of the author of the last save. */
    @Column(name = "saved_by", nullable = false)
    private String savedBy;

    @Column(name = "saved_at", nullable = false)
    private ZonedDateTime savedAt;

    public ScoreEditTarget getTargetType() {
        return targetType;
    }

    public void setTargetType(ScoreEditTarget targetType) {
        this.targetType = targetType;
    }

    public Long getTargetId() {
        return targetId;
    }

    public void setTargetId(Long targetId) {
        this.targetId = targetId;
    }

    public Long getBaseVersionId() {
        return baseVersionId;
    }

    public void setBaseVersionId(Long baseVersionId) {
        this.baseVersionId = baseVersionId;
    }

    public byte[] getContent() {
        return content;
    }

    public void setContent(byte[] content) {
        this.content = content;
    }

    public String getRowsJson() {
        return rowsJson;
    }

    public void setRowsJson(String rowsJson) {
        this.rowsJson = rowsJson;
    }

    public Integer getMeasureCount() {
        return measureCount;
    }

    public void setMeasureCount(Integer measureCount) {
        this.measureCount = measureCount;
    }

    public String getSavedBy() {
        return savedBy;
    }

    public void setSavedBy(String savedBy) {
        this.savedBy = savedBy;
    }

    public ZonedDateTime getSavedAt() {
        return savedAt;
    }

    public void setSavedAt(ZonedDateTime savedAt) {
        this.savedAt = savedAt;
    }
}
