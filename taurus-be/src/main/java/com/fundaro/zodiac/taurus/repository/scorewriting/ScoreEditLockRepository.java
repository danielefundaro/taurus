package com.fundaro.zodiac.taurus.repository.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditLock;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.ZonedDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ScoreEditLockRepository extends JpaRepository<ScoreEditLock, Long> {

    /**
     * Serializes taking, renewing and releasing the lock of one target in the current tenant schema, so that two editors
     * cannot both find it free. Held until the end of the transaction.
     */
    @Query(
        value = "select 1 from pg_advisory_xact_lock(hashtextextended(current_schema() || ':score-edit-lock:' || :targetType || ':' || :targetId, 0))",
        nativeQuery = true
    )
    Integer lockTarget(@Param("targetType") String targetType, @Param("targetId") Long targetId);

    Optional<ScoreEditLock> findByTargetTypeAndTargetId(ScoreEditTarget targetType, Long targetId);

    /** Locks still running on the given targets, to show who is editing them. */
    @Query(
        "select editLock from ScoreEditLock editLock " +
            "where editLock.targetType = :targetType and editLock.targetId in :targetIds and editLock.expiresAt > :now"
    )
    List<ScoreEditLock> findActive(
        @Param("targetType") ScoreEditTarget targetType,
        @Param("targetIds") Collection<Long> targetIds,
        @Param("now") ZonedDateTime now
    );

    @Modifying
    @Query("delete from ScoreEditLock editLock where editLock.targetType = :targetType and editLock.targetId in :targetIds")
    int deleteAllByTargets(@Param("targetType") ScoreEditTarget targetType, @Param("targetIds") Collection<Long> targetIds);

    /** Removes the expired locks, and with them the names of their authors. */
    @Modifying
    @Query("delete from ScoreEditLock editLock where editLock.expiresAt <= :now")
    int deleteExpired(@Param("now") ZonedDateTime now);
}
