package com.fundaro.zodiac.taurus.repository.scoreplayback;

import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreRecognitionReview;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;

public interface ScoreRecognitionReviewRepository extends JpaRepository<ScoreRecognitionReview, Long> {

    /**
     * For each approved version of an active part, the version of an engine it descends from, climbing the versions it
     * derives from within the part; for each version of an engine, only its latest approval, whose counts were not
     * collected yet.
     */
    String PENDING = """
        WITH RECURSIVE chain AS (
            SELECT approved.id AS approved_id, approved.id AS ancestor_id, approved.parent_version_id AS parent_id,
                   approved.origin AS origin, approved.sheet_music_id AS part_id, 0 AS depth
              FROM score_version approved
              JOIN sheet_music part ON part.id = approved.sheet_music_id AND part.deleted = FALSE
              JOIN track ON track.id = part.track_id AND track.deleted = FALSE
             WHERE approved.status = 'APPROVED' AND approved.deleted = FALSE
            UNION ALL
            SELECT chain.approved_id, parent.id, parent.parent_version_id, parent.origin, chain.part_id, chain.depth + 1
              FROM chain
              JOIN score_version parent
                ON parent.id = chain.parent_id AND parent.sheet_music_id = chain.part_id AND parent.deleted = FALSE
             WHERE chain.origin NOT IN ('OMR_AUDIVERIS', 'OMR_HOMR') AND chain.depth < 1000
        ),
        latest AS (
            SELECT DISTINCT ON (chain.ancestor_id) chain.ancestor_id AS engine_id, chain.approved_id
              FROM chain
              JOIN score_version approved ON approved.id = chain.approved_id
             WHERE chain.origin IN ('OMR_AUDIVERIS', 'OMR_HOMR')
             ORDER BY chain.ancestor_id, approved.approved_at DESC, approved.id DESC
        ),
        pending AS (
            SELECT latest.engine_id, latest.approved_id
              FROM latest
             WHERE NOT EXISTS (
                 SELECT 1 FROM score_recognition_review review
                  WHERE review.engine_version_id = latest.engine_id AND review.approved_version_id = latest.approved_id
             )
        )
        """;

    Optional<ScoreRecognitionReview> findByEngineVersionId(Long engineVersionId);

    /** Engine, then parts and the sums of the counts, for the versions recognized from {@code from}. */
    @Query(
        "select review.engine, count(review), sum(review.referenceMeasures), sum(review.engineMeasures), sum(review.correctMeasures), " +
            "sum(review.pitchMeasures), sum(review.rhythmMeasures), sum(review.tieMeasures), sum(review.missingMeasures), " +
            "sum(review.extraMeasures), sum(review.referenceMarks), sum(review.foundMarks) " +
            "from ScoreRecognitionReview review where review.deleted = false and review.recognizedAt >= :from " +
            "group by review.engine order by review.engine"
    )
    List<Object[]> sumByEngine(@Param("from") ZonedDateTime from);

    /** Month ({@code yyyy-MM} in the given time zone) and engine, then parts and the sums of the counts. */
    @Query(
        value = """
            SELECT to_char(date_trunc('month', review.recognized_at AT TIME ZONE :zone), 'YYYY-MM') AS month, review.engine,
                   count(*), sum(review.reference_measures), sum(review.engine_measures), sum(review.correct_measures),
                   sum(review.pitch_measures), sum(review.rhythm_measures), sum(review.tie_measures), sum(review.missing_measures),
                   sum(review.extra_measures), sum(review.reference_marks), sum(review.found_marks)
              FROM score_recognition_review review
             WHERE review.deleted = FALSE AND review.recognized_at >= :from
             GROUP BY 1, 2
             ORDER BY 1, 2
            """,
        nativeQuery = true
    )
    List<Object[]> sumByMonth(@Param("from") ZonedDateTime from, @Param("zone") String zone);

    /**
     * The parts of active tracks with the most measures corrected by the archivists: track, part, engine, the two
     * versions, approval, measures of the approved version, correct and corrected measures.
     */
    @Query(
        value = """
            SELECT track.id AS track_id, track.name AS track_name, part.id AS part_id, part.description AS part_name,
                   review.engine, review.engine_version_id, engine.version_number AS engine_number,
                   review.approved_version_id, approved.version_number AS approved_number, review.approved_at,
                   review.reference_measures, review.correct_measures,
                   review.pitch_measures + review.rhythm_measures + review.tie_measures + review.missing_measures
                       + review.extra_measures AS corrected
              FROM score_recognition_review review
              JOIN sheet_music part ON part.id = review.sheet_music_id AND part.deleted = FALSE
              JOIN track ON track.id = part.track_id AND track.deleted = FALSE
              JOIN score_version engine ON engine.id = review.engine_version_id AND engine.deleted = FALSE
              JOIN score_version approved ON approved.id = review.approved_version_id AND approved.deleted = FALSE
             WHERE review.deleted = FALSE AND review.recognized_at >= :from
               AND review.pitch_measures + review.rhythm_measures + review.tie_measures + review.missing_measures
                   + review.extra_measures > 0
             ORDER BY corrected DESC, review.approved_at DESC, review.id DESC
             LIMIT :limit
            """,
        nativeQuery = true
    )
    List<Object[]> findMostCorrected(@Param("from") ZonedDateTime from, @Param("limit") int limit);

    /** The approvals to collect, the latest first: track, part, engine origin, the two versions and the approval. */
    @Query(
        value = PENDING + """
            SELECT track.id AS track_id, track.name AS track_name, part.id AS part_id, part.description AS part_name,
                   engine.origin, engine.id AS engine_id, engine.version_number AS engine_number,
                   approved.id AS approved_id, approved.version_number AS approved_number, approved.approved_at
              FROM pending
              JOIN score_version engine ON engine.id = pending.engine_id
              JOIN score_version approved ON approved.id = pending.approved_id
              JOIN sheet_music part ON part.id = approved.sheet_music_id
              JOIN track ON track.id = part.track_id
             ORDER BY approved.approved_at DESC, approved.id DESC
             LIMIT :limit
            """,
        nativeQuery = true
    )
    List<Object[]> findPending(@Param("limit") int limit);

    @Query(value = PENDING + "SELECT count(*) FROM pending", nativeQuery = true)
    long countPending();
}
