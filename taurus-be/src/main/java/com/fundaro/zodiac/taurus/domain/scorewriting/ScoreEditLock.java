package com.fundaro.zodiac.taurus.domain.scorewriting;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

import java.time.ZonedDateTime;

/**
 * The author editing a part, in the writing or in the correction editor. The holder is an editor session: two windows
 * of the same user exclude each other too. The row is removed on release and by the nightly purge once expired, so the
 * name of the author does not outlive the editing.
 */
@Entity
@Table(name = "score_edit_lock")
public class ScoreEditLock extends TenantAuditedEntity {

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, updatable = false)
    private ScoreEditTarget targetType;

    @Column(name = "target_id", nullable = false, updatable = false)
    private Long targetId;

    /** Keycloak id of the author. */
    @Column(name = "owner", nullable = false)
    private String owner;

    /** Session of the editor that holds the lock, chosen by the browser. */
    @Column(name = "owner_session", nullable = false)
    private String ownerSession;

    /** Name of the author shown to the other users; super administrators are not always users of the tenant. */
    @Column(name = "owner_name")
    private String ownerName;

    @Column(name = "acquired_at", nullable = false)
    private ZonedDateTime acquiredAt;

    @Column(name = "heartbeat_at", nullable = false)
    private ZonedDateTime heartbeatAt;

    @Column(name = "expires_at", nullable = false)
    private ZonedDateTime expiresAt;

    public boolean isExpired(ZonedDateTime now) {
        return !expiresAt.isAfter(now);
    }

    public boolean isHeldBy(String session) {
        return ownerSession.equals(session);
    }

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

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }

    public String getOwnerSession() {
        return ownerSession;
    }

    public void setOwnerSession(String ownerSession) {
        this.ownerSession = ownerSession;
    }

    public String getOwnerName() {
        return ownerName;
    }

    public void setOwnerName(String ownerName) {
        this.ownerName = ownerName;
    }

    public ZonedDateTime getAcquiredAt() {
        return acquiredAt;
    }

    public void setAcquiredAt(ZonedDateTime acquiredAt) {
        this.acquiredAt = acquiredAt;
    }

    public ZonedDateTime getHeartbeatAt() {
        return heartbeatAt;
    }

    public void setHeartbeatAt(ZonedDateTime heartbeatAt) {
        this.heartbeatAt = heartbeatAt;
    }

    public ZonedDateTime getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(ZonedDateTime expiresAt) {
        this.expiresAt = expiresAt;
    }
}
