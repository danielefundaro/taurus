package com.fundaro.zodiac.taurus.repository.eventpreparation;

import com.fundaro.zodiac.taurus.domain.enumeration.MediaAssetStatus;
import com.fundaro.zodiac.taurus.domain.enumeration.RoleEnum;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventPreparation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Plans of the preparation and the reads that evaluate many events at once: each query covers every event of the
 * request, so the cost of an evaluation does not grow with the number of events.
 */
public interface EventPreparationRepository extends JpaRepository<CalendarEventPreparation, Long> {
    Optional<CalendarEventPreparation> findByEvent_IdAndDeletedFalse(Long eventId);

    @Query("""
        select distinct preparation from CalendarEventPreparation preparation
        join fetch preparation.event event
        left join fetch event.costs
        where preparation.deleted = false
          and event.deleted = false
          and (event.seriesExcluded = false or event.seriesExcluded is null)
          and event.startDate <= :to
          and event.endDate >= :from
        order by event.startDate asc, event.id asc
        """)
    List<CalendarEventPreparation> findDashboardCandidates(@Param("from") Date from, @Param("to") Date to);

    /** Advances the program version only if the client saw the current one: zero rows means a concurrent save. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CalendarEventPreparation p set p.programVersion = p.programVersion + 1 where p.id = :id and p.programVersion = :expected")
    int advanceProgramVersion(@Param("id") Long id, @Param("expected") long expected);

    /** Advances the materials version only if the client saw the current one: zero rows means a concurrent save. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CalendarEventPreparation p set p.materialsVersion = p.materialsVersion + 1 where p.id = :id and p.materialsVersion = :expected")
    int advanceMaterialsVersion(@Param("id") Long id, @Param("expected") long expected);

    /** Event id, Keycloak id and answer of every availability of the events. */
    @Query("""
        select event.id, participant.keycloakId, response.availability from CalendarEvents event
        join event.availabilities response
        join response.user participant
        where event.id in :eventIds
        """)
    List<Object[]> findResponses(@Param("eventIds") Collection<Long> eventIds);

    /** Keycloak id, participant role and, when present, instrument id and name of the active participants. */
    @Query("""
        select participant.keycloakId, role, instrument.id, instrument.name from Users participant
        join participant.roles role
        left join participant.instruments instrument on instrument.deleted = false
        where participant.deleted = false
          and participant.active = true
          and participant.keycloakId is not null
          and role in :roles
        """)
    List<Object[]> findParticipants(@Param("roles") Collection<RoleEnum> roles);

    /** Event id, user id, arrival and note of the presences, in the order of the register. */
    @Query("""
        select event.id, participant.id, presence.arrivalTime, presence.note from CalendarEvents event
        join event.presences presence
        join presence.user participant
        where event.id in :eventIds
        order by event.id, index(presence)
        """)
    List<Object[]> findPresences(@Param("eventIds") Collection<Long> eventIds);

    /**
     * Track id, score id, description, review flag, instrument id and name, ready media id and file name, current
     * version and number of pages of any status of the parts of the tracks: one row per instrument and ready file, in
     * the order of the track.
     */
    @Query("""
        select track.id, score.id, score.description, score.needsReview, instrument.id, instrument.name, media.id, media.originalFilename,
            score.currentScoreVersionId, size(score.media)
        from Tracks track
        join track.scores score
        left join score.instruments instrument
        left join score.media media on media.status = :ready
        where track.id in :trackIds
        order by track.id, index(score), index(instrument), index(media)
        """)
    List<Object[]> findScores(@Param("trackIds") Collection<Long> trackIds, @Param("ready") MediaAssetStatus ready);
}
