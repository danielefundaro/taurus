package com.fundaro.zodiac.taurus.repository.scoreplayback;

import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ScoreVersionRepository extends JpaRepository<ScoreVersion, Long> {

    List<ScoreVersion> findAllBySheetMusicIdAndDeletedFalseOrderByVersionNumberDesc(Long sheetMusicId);

    List<ScoreVersion> findAllByIdInAndDeletedFalse(Collection<Long> ids);

    Optional<ScoreVersion> findByIdAndSheetMusicIdAndDeletedFalse(Long id, Long sheetMusicId);

    @Query("select coalesce(max(version.versionNumber), 0) from ScoreVersion version where version.sheetMusicId = :sheetMusicId")
    int findMaxVersionNumber(@Param("sheetMusicId") Long sheetMusicId);

    /**
     * Versions beyond the newest {@code kept} of their part that are not approved, not current, not the origin of a kept
     * version, of pages, of a derived part or of an engraving still running or waiting to be assigned.
     */
    @Query(
        value = """
            SELECT ranked.id FROM (
                SELECT version.id, version.status,
                       row_number() OVER (PARTITION BY version.sheet_music_id ORDER BY version.version_number DESC) AS position
                FROM score_version version
                WHERE version.deleted = FALSE
            ) ranked
            WHERE ranked.position > :kept
              AND ranked.status <> 'APPROVED'
              AND NOT EXISTS (SELECT 1 FROM sheet_music part WHERE part.current_score_version_id = ranked.id)
              AND NOT EXISTS (SELECT 1 FROM score_version child WHERE child.parent_version_id = ranked.id AND child.deleted = FALSE)
              AND NOT EXISTS (SELECT 1 FROM sheet_music part WHERE part.engraved_from_version_id = ranked.id AND part.deleted = FALSE)
              AND NOT EXISTS (SELECT 1 FROM sheet_music part WHERE part.derived_from_version_id = ranked.id AND part.deleted = FALSE)
              AND NOT EXISTS (
                  SELECT 1 FROM score_engraving_job job
                   WHERE job.score_version_id = ranked.id AND job.deleted = FALSE
                     AND (job.status IN ('QUEUED', 'RUNNING') OR EXISTS (SELECT 1 FROM score_engraving_page page WHERE page.job_id = job.id))
              )
            """,
        nativeQuery = true
    )
    List<Long> findRemovableIds(@Param("kept") int kept);
}
