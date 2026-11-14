package com.fundaro.zodiac.taurus.repository.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreDraft;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.ZonedDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ScoreDraftRepository extends JpaRepository<ScoreDraft, Long> {

    Optional<ScoreDraft> findByTargetTypeAndTargetId(ScoreEditTarget targetType, Long targetId);

    /** Who saved the drafts of the given targets and when, without their content. */
    @Query(
        "select new com.fundaro.zodiac.taurus.repository.scorewriting.ScoreDraftRepository$DraftSummary(" +
            "draft.targetId, draft.savedBy, draft.savedAt, draft.baseVersionId) " +
            "from ScoreDraft draft where draft.targetType = :targetType and draft.targetId in :targetIds"
    )
    List<DraftSummary> findSummaries(@Param("targetType") ScoreEditTarget targetType, @Param("targetIds") Collection<Long> targetIds);

    @Modifying
    @Query("delete from ScoreDraft draft where draft.targetType = :targetType and draft.targetId in :targetIds")
    int deleteAllByTargets(@Param("targetType") ScoreEditTarget targetType, @Param("targetIds") Collection<Long> targetIds);

    /**
     * Removes the drafts of parts that no longer exist or were deleted, for example by a track removed without passing
     * through the update of its parts.
     */
    @Modifying
    @Query(
        value = "delete from score_draft draft where draft.target_type = 'PART' and not exists (" +
            "select 1 from sheet_music part where part.id = draft.target_id and part.deleted = false)",
        nativeQuery = true
    )
    int deleteOrphanPartDrafts();

    record DraftSummary(Long targetId, String savedBy, ZonedDateTime savedAt, Long baseVersionId) {}
}
