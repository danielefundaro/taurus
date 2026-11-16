package com.fundaro.zodiac.taurus.service.ensemble;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleUpdateDTO;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Objects;

/**
 * The ensemble of the band: the ordered list of the instruments that usually play in it, stored as the position of each
 * instrument. The ensemble is read and saved as a whole.
 */
@Service
@Transactional
public class InstrumentEnsembleService {

    /** More instruments than any band has: a longer list is not an ensemble. */
    static final int MAX_INSTRUMENTS = 500;

    private static final String ENTITY_NAME = Instruments.class.getSimpleName();

    private final InstrumentsRepository repository;

    public InstrumentEnsembleService(InstrumentsRepository repository) {
        this.repository = repository;
    }

    /** The instruments of the ensemble, in their order. */
    @Transactional(readOnly = true)
    public List<EnsembleInstrumentDTO> ensemble() {
        return repository.findEnsemble().stream().map(InstrumentEnsembleService::toDto).toList();
    }

    /** Every instrument in the reference order, with its current position: the proposal of the ensemble. */
    @Transactional(readOnly = true)
    public List<EnsembleInstrumentDTO> reference() {
        return InstrumentEnsembleOrder.sort(repository.findActive()).stream().map(InstrumentEnsembleService::toDto).toList();
    }

    /**
     * Replaces the ensemble. The change applies only to the ensemble the client read: after a concurrent change the client
     * reads it again.
     */
    public List<EnsembleInstrumentDTO> save(EnsembleUpdateDTO update) {
        List<Long> ids = update == null ? null : update.instrumentIds();
        List<Long> previous = update == null ? null : update.previousInstrumentIds();
        if (ids == null || previous == null || ids.size() > MAX_INSTRUMENTS || ids.stream().anyMatch(Objects::isNull)) {
            throw invalid("The ensemble is not a list of instruments");
        }
        if (new HashSet<>(ids).size() != ids.size()) {
            throw invalid("An instrument appears twice in the ensemble");
        }
        repository.lockTenantEnsemble();
        List<Long> current = repository.findEnsemble().stream().map(Instruments::getId).toList();
        if (!current.equals(previous)) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "The ensemble was modified by another request", ENTITY_NAME, "version.conflict");
        }
        if (!ids.isEmpty() && new HashSet<>(repository.findActiveIds(ids)).size() != ids.size()) {
            throw invalid("An instrument of the ensemble does not exist");
        }
        if (!current.equals(ids)) {
            repository.clearEnsemble();
            for (int index = 0; index < ids.size(); index++) {
                repository.setEnsemblePosition(ids.get(index), index + 1);
            }
        }
        return ensemble();
    }

    private static EnsembleInstrumentDTO toDto(Instruments instrument) {
        return new EnsembleInstrumentDTO(
            instrument.getId(),
            instrument.getName(),
            instrument.getEnsemblePosition(),
            InstrumentEnsembleOrder.family(instrument.getName()).orElse(null)
        );
    }

    private static RequestAlertException invalid(String message) {
        return new RequestAlertException(HttpStatus.BAD_REQUEST, message, ENTITY_NAME, "instrument.ensemble.invalid");
    }
}
