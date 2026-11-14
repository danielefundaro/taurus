package com.fundaro.zodiac.taurus.repository.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJob;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.ZonedDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ScoreEngravingJobRepository extends JpaRepository<ScoreEngravingJob, Long> {

    Optional<ScoreEngravingJob> findByIdAndDeletedFalse(Long id);

    /** Latest job of a version of a part. */
    Optional<ScoreEngravingJob> findFirstBySheetMusicIdAndScoreVersionIdAndDeletedFalseOrderByIdDesc(Long sheetMusicId, Long scoreVersionId);

    /** Latest finished job of a version that still has its PDF. */
    Optional<ScoreEngravingJob> findFirstByScoreVersionIdAndPdfMediaAssetIdIsNotNullAndDeletedFalseOrderByIdDesc(Long scoreVersionId);

    boolean existsBySheetMusicIdAndStatusInAndDeletedFalse(Long sheetMusicId, Collection<ScoreEngravingJobStatus> statuses);

    /** Finished jobs of a part whose pages were never assigned, to release when a newer engraving supersedes them. */
    List<ScoreEngravingJob> findAllBySheetMusicIdAndStatusAndAppliedAtIsNullAndDeletedFalse(Long sheetMusicId, ScoreEngravingJobStatus status);

    /** Jobs whose pages went to a part: their PDF is released when the part receives newer pages. */
    List<ScoreEngravingJob> findAllByAppliedSheetMusicIdAndPdfMediaAssetIdIsNotNullAndDeletedFalse(Long appliedSheetMusicId);

    /**
     * Takes a queued job for execution. Only one consumer wins when the same job is delivered twice.
     *
     * @return 1 when the job was queued and is now running
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
        "update ScoreEngravingJob job set job.status = com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus.RUNNING, " +
            "job.attempts = job.attempts + 1, job.startedAt = :now, job.editBy = :actor, job.editDate = :now, " +
            "job.entityVersion = job.entityVersion + 1 " +
            "where job.id = :id and job.deleted = false and job.status = com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus.QUEUED"
    )
    int claim(@Param("id") Long id, @Param("now") ZonedDateTime now, @Param("actor") String actor);

    /** Running jobs started before the given time: the worker that took them stopped or lost them. */
    List<ScoreEngravingJob> findAllByStatusAndStartedAtBeforeAndDeletedFalse(ScoreEngravingJobStatus status, ZonedDateTime startedBefore);

    /** Queued jobs not touched since the given time: their message may have been lost. */
    List<ScoreEngravingJob> findAllByStatusAndEditDateBeforeAndDeletedFalse(ScoreEngravingJobStatus status, ZonedDateTime editedBefore);

    /**
     * Jobs holding files nobody will use: pages never assigned and finished before the given time, or of a part that no
     * longer exists, and PDFs of parts that no longer exist.
     */
    @Query(
        value = """
            SELECT job.id FROM score_engraving_job job
             WHERE job.deleted = FALSE
               AND job.status = 'DONE'
               AND (
                    (job.applied_at IS NULL AND (job.pdf_media_asset_id IS NOT NULL
                        OR EXISTS (SELECT 1 FROM score_engraving_page page WHERE page.job_id = job.id))
                     AND (job.finished_at < :finishedBefore
                          OR NOT EXISTS (SELECT 1 FROM sheet_music part WHERE part.id = job.sheet_music_id AND part.deleted = FALSE)))
                    OR (job.applied_at IS NOT NULL AND job.pdf_media_asset_id IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM sheet_music part WHERE part.id = job.applied_sheet_music_id AND part.deleted = FALSE))
               )
            """,
        nativeQuery = true
    )
    List<Long> findReleasableIds(@Param("finishedBefore") ZonedDateTime finishedBefore);
}
