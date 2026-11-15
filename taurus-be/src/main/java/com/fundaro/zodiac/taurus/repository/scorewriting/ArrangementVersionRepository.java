package com.fundaro.zodiac.taurus.repository.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ArrangementVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ArrangementVersionRepository extends JpaRepository<ArrangementVersion, Long> {

    List<ArrangementVersion> findAllByArrangementIdAndDeletedFalseOrderByVersionNumberDesc(Long arrangementId);

    Optional<ArrangementVersion> findByIdAndArrangementIdAndDeletedFalse(Long id, Long arrangementId);

    /** Highest number given to a version of the score, removed versions included, so that a number is never reused. */
    @Query("select coalesce(max(version.versionNumber), 0) from ArrangementVersion version where version.arrangementId = :arrangementId")
    int findMaxVersionNumber(@Param("arrangementId") Long arrangementId);

    /**
     * Versions beyond the newest {@code kept} of their score that are not approved, not current and not the origin of a
     * version of a part still present.
     */
    @Query(
        value = """
            SELECT ranked.id FROM (
                SELECT version.id, version.status,
                       row_number() OVER (PARTITION BY version.arrangement_id ORDER BY version.version_number DESC) AS position
                FROM arrangement_version version
                WHERE version.deleted = FALSE
            ) ranked
            WHERE ranked.position > :kept
              AND ranked.status <> 'APPROVED'
              AND NOT EXISTS (SELECT 1 FROM track_arrangement arrangement WHERE arrangement.current_version_id = ranked.id)
              AND NOT EXISTS (
                  SELECT 1 FROM score_version extracted
                   WHERE extracted.arrangement_version_id = ranked.id AND extracted.deleted = FALSE
              )
            """,
        nativeQuery = true
    )
    List<Long> findRemovableIds(@Param("kept") int kept);
}
