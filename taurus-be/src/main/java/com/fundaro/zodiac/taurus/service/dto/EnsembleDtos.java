package com.fundaro.zodiac.taurus.service.dto;

import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentFamily;

import java.util.List;

/** Data exchanged by the ensemble endpoints of the instruments. */
public final class EnsembleDtos {

    private EnsembleDtos() {}

    /**
     * An instrument with its place in the ensemble.
     *
     * @param ensemblePosition position in the ensemble, from 1; {@code null} outside the ensemble
     * @param family           family of the band recognized in the name, {@code null} when the reference catalogue does not
     *                         place the instrument
     */
    public record EnsembleInstrumentDTO(Long id, String name, Integer ensemblePosition, InstrumentFamily family) {}

    /**
     * A new ensemble.
     *
     * @param instrumentIds         the instruments of the ensemble, in their order; empty to clear the ensemble
     * @param previousInstrumentIds the ensemble the change was made on, to detect a concurrent change
     */
    public record EnsembleUpdateDTO(List<Long> instrumentIds, List<Long> previousInstrumentIds) {}
}
