package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.criteria.InstrumentsCriteria;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.service.InstrumentsService;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleUpdateDTO;
import com.fundaro.zodiac.taurus.service.dto.InstrumentsDTO;
import com.fundaro.zodiac.taurus.service.ensemble.InstrumentEnsembleService;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for managing {@link Instruments}.
 */
@RestController
@RequestMapping("/api/instruments")
public class InstrumentsResource extends CommonOpenSearchResource<Instruments, InstrumentsDTO, InstrumentsCriteria, InstrumentsService> {

    private final InstrumentEnsembleService ensembleService;

    public InstrumentsResource(InstrumentsService instrumentsService, InstrumentEnsembleService ensembleService) {
        super(instrumentsService, Instruments.class.getSimpleName(), InstrumentsResource.class);
        this.ensembleService = ensembleService;
    }

    /** {@code GET /ensemble} : the instruments of the ensemble of the band, in their order; empty without an ensemble. */
    @GetMapping("/ensemble")
    public List<EnsembleInstrumentDTO> ensemble() {
        return ensembleService.ensemble();
    }

    /** {@code GET /ensemble/reference} : every instrument in the reference order, with its family and current position. */
    @GetMapping("/ensemble/reference")
    public List<EnsembleInstrumentDTO> ensembleReference() {
        return ensembleService.reference();
    }

    /**
     * {@code PUT /ensemble} : replaces the ensemble.
     *
     * @return {@code 200} with the new ensemble, {@code 400} {@code instrument.ensemble.invalid} for an unknown or repeated
     * instrument, {@code 409} {@code version.conflict} when the ensemble changed after the client read it.
     */
    @PutMapping("/ensemble")
    public List<EnsembleInstrumentDTO> saveEnsemble(@RequestBody EnsembleUpdateDTO update) {
        return ensembleService.save(update);
    }

    /**
     * {@code GET /playback-suggestion?name=} : playback settings proposed from an instrument name.
     *
     * @return {@code 200} with the proposal, or {@code 204} when the name does not match the reference catalogue.
     */
    @GetMapping("/playback-suggestion")
    @RequiresTenantFeature(TenantFeature.SCORE_PLAYBACK)
    public ResponseEntity<InstrumentPlaybackSuggester.Suggestion> playbackSuggestion(@RequestParam("name") String name) {
        return InstrumentPlaybackSuggester.suggest(name)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.noContent().build());
    }
}
