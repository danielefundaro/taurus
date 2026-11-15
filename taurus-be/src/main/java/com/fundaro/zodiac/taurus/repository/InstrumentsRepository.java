package com.fundaro.zodiac.taurus.repository;

import com.fundaro.zodiac.taurus.domain.Instruments;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface InstrumentsRepository extends CatalogRepository<Instruments> {

    /**
     * Serializes the creation and renaming of the instruments of the current tenant schema, so that the check on the
     * name cannot be passed by two requests at the same time.
     */
    @Query(value = "select 1 from pg_advisory_xact_lock(hashtextextended(current_schema() || ':instrument-name', 0))", nativeQuery = true)
    Integer lockTenantNames();

    /** Id and name of every instrument still in use, for the check on the name. */
    @Query("select instrument.id, instrument.name from Instruments instrument where instrument.deleted = false")
    List<Object[]> findActiveNames();

    /**
     * Serializes the changes to the ensemble of the current tenant schema: saving a new order and deleting an instrument
     * of the ensemble, which compacts the positions.
     */
    @Query(value = "select 1 from pg_advisory_xact_lock(hashtextextended(current_schema() || ':instrument-ensemble', 0))", nativeQuery = true)
    Integer lockTenantEnsemble();

    /** Every instrument still in use, for the reference order. */
    @Query("select instrument from Instruments instrument where instrument.deleted = false")
    List<Instruments> findActive();

    /** The instruments of the ensemble, in their order. */
    @Query(
        "select instrument from Instruments instrument where instrument.deleted = false and instrument.ensemblePosition is not null" +
        " order by instrument.ensemblePosition"
    )
    List<Instruments> findEnsemble();

    /** Ids of the instruments still in use among the given ones. */
    @Query("select instrument.id from Instruments instrument where instrument.deleted = false and instrument.id in :ids")
    List<Long> findActiveIds(@Param("ids") Collection<Long> ids);

    /** Takes every instrument out of the ensemble. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update instrument set ensemble_position = null where ensemble_position is not null", nativeQuery = true)
    int clearEnsemble();

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update instrument set ensemble_position = :position where id = :id and deleted = false", nativeQuery = true)
    int setEnsemblePosition(@Param("id") Long id, @Param("position") int position);

    /** Takes an instrument out of the ensemble and moves up the ones after it, so that positions keep no gaps. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(
        value = "update instrument set ensemble_position = case when id = :id then null else ensemble_position - 1 end" +
        " where ensemble_position >= :position",
        nativeQuery = true
    )
    int leaveEnsemble(@Param("id") Long id, @Param("position") int position);
}
