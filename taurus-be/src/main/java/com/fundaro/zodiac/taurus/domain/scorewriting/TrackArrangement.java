package com.fundaro.zodiac.taurus.domain.scorewriting;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * The score of a track: all its parts in systems, written in concert pitch or transposed, from which the parts of the
 * track are extracted. A track has at most one; removing it soft-deletes it with its versions and leaves the parts.
 */
@Entity
@Table(name = "track_arrangement")
public class TrackArrangement extends TenantAuditedEntity {

    @Column(name = "track_id", nullable = false, updatable = false)
    private Long trackId;

    /** Version shown and extracted; {@code null} until the first version is saved. */
    @Column(name = "current_version_id")
    private Long currentVersionId;

    public Long getTrackId() {
        return trackId;
    }

    public void setTrackId(Long trackId) {
        this.trackId = trackId;
    }

    public Long getCurrentVersionId() {
        return currentVersionId;
    }

    public void setCurrentVersionId(Long currentVersionId) {
        this.currentVersionId = currentVersionId;
    }
}
