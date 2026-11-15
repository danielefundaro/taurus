package com.fundaro.zodiac.taurus.repository.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.TrackArrangement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * The scores of the tracks, and the links between their rows and the parts of the track. The links live in
 * {@code sheet_music.arrangement_row} and are written only here, after the parts are saved.
 */
public interface TrackArrangementRepository extends JpaRepository<TrackArrangement, Long> {

    Optional<TrackArrangement> findByTrackIdAndDeletedFalse(Long trackId);

    /** The parts of the track linked to a row, removed parts included: a removed part tells that its row lost it. */
    default List<RowLink> findRowLinks(Long trackId) {
        return findRowLinkValues(trackId).stream()
            .map(values -> new RowLink(((Number) values[0]).longValue(), (String) values[1], Boolean.TRUE.equals(values[2])))
            .toList();
    }

    @Query(
        value = "SELECT part.id, part.arrangement_row, part.deleted FROM sheet_music part " +
            "WHERE part.track_id = :trackId AND part.arrangement_row IS NOT NULL",
        nativeQuery = true
    )
    List<Object[]> findRowLinkValues(@Param("trackId") Long trackId);

    /** Unlinks the given rows from the parts of the track, removed parts included. */
    @Modifying(flushAutomatically = true)
    @Query(
        value = "UPDATE sheet_music SET arrangement_row = NULL WHERE track_id = :trackId AND arrangement_row IN (:rows)",
        nativeQuery = true
    )
    int unlinkRows(@Param("trackId") Long trackId, @Param("rows") Collection<String> rows);

    /** Unlinks the given parts from their rows. */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE sheet_music SET arrangement_row = NULL WHERE id IN (:partIds)", nativeQuery = true)
    int unlinkParts(@Param("partIds") Collection<Long> partIds);

    /** Unlinks every part of the track, when its score is removed. */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE sheet_music SET arrangement_row = NULL WHERE track_id = :trackId AND arrangement_row IS NOT NULL", nativeQuery = true)
    int unlinkTrack(@Param("trackId") Long trackId);

    /** Links an active part of the track to a row; the caller unlinks the row and the part first. */
    @Modifying(flushAutomatically = true)
    @Query(
        value = "UPDATE sheet_music SET arrangement_row = :row WHERE id = :partId AND track_id = :trackId AND deleted = FALSE",
        nativeQuery = true
    )
    int link(@Param("trackId") Long trackId, @Param("partId") Long partId, @Param("row") String row);

    /** A part of the track linked to a row of its score. */
    record RowLink(Long partId, String row, boolean deleted) {}
}
