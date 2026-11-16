package com.fundaro.zodiac.taurus.repository.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragment;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentCategory;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentKind;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface ScoreFragmentRepository extends JpaRepository<ScoreFragment, Long> {

    Optional<ScoreFragment> findByIdAndDeletedFalse(Long id);

    /** The fragments not removed, by name, without their content. */
    @Query(
        "select new com.fundaro.zodiac.taurus.repository.scorewriting.ScoreFragmentRepository$FragmentSummary(" +
            "fragment.id, fragment.name, fragment.category, fragment.note, fragment.kind, fragment.measureCount, " +
            "fragment.percussionKeysJson, fragment.entityVersion) " +
            "from ScoreFragment fragment where fragment.deleted = false order by lower(fragment.name), fragment.id"
    )
    List<FragmentSummary> findSummaries();

    /** A fragment not removed has the name, regardless of case. */
    boolean existsByNameIgnoreCaseAndDeletedFalse(String name);

    /** Another fragment not removed has the name, regardless of case. */
    boolean existsByNameIgnoreCaseAndDeletedFalseAndIdNot(String name, Long id);

    /** A fragment without its content. */
    record FragmentSummary(
        Long id,
        String name,
        ScoreFragmentCategory category,
        String note,
        ScoreFragmentKind kind,
        Integer measureCount,
        String percussionKeysJson,
        long entityVersion
    ) {}
}
