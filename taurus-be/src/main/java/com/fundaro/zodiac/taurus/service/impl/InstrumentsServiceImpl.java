package com.fundaro.zodiac.taurus.service.impl;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.criteria.InstrumentsCriteria;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.UsersRepository;
import com.fundaro.zodiac.taurus.service.InstrumentsService;
import com.fundaro.zodiac.taurus.service.dto.InstrumentsDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentNames;
import com.fundaro.zodiac.taurus.service.mapper.InstrumentsMapper;
import com.fundaro.zodiac.taurus.service.scoreplayback.PlaybackSettingsValidator;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;

import jakarta.persistence.criteria.Predicate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class InstrumentsServiceImpl extends CommonOpenSearchServiceImpl<Instruments, InstrumentsDTO, InstrumentsCriteria, InstrumentsMapper, InstrumentsRepository>
    implements InstrumentsService {

    private final UsersRepository usersRepository;

    public InstrumentsServiceImpl(InstrumentsRepository repository, InstrumentsMapper mapper, UsersRepository usersRepository) {
        super(repository, mapper, InstrumentsService.class, Instruments.class);
        this.usersRepository = usersRepository;
    }

    @Override
    public InstrumentsDTO save(InstrumentsDTO dto, AbstractAuthenticationToken token) {
        requireValidPlaybackSettings(dto);
        PlaybackSettingsValidator.requireValidRange(getEntityName(), dto.getLowestWrittenPitch(), dto.getHighestWrittenPitch());
        requireUniqueName(dto.getName(), null);
        return super.save(dto, token);
    }

    /**
     * A full update also replaces the playback settings and the written range: a value left empty clears the stored one,
     * so an instrument can go back to "not configured". The other fields keep the partial semantics of the common services.
     */
    @Override
    public InstrumentsDTO update(Long id, InstrumentsDTO dto, AbstractAuthenticationToken token) {
        requireValidPlaybackSettings(dto);
        PlaybackSettingsValidator.requireValidRange(getEntityName(), dto.getLowestWrittenPitch(), dto.getHighestWrittenPitch());
        if (id == null || !Objects.equals(id, dto.getId())) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Invalid ID", getEntityName(), "id.invalid");
        }
        Instruments entity = getRepository().findByIdAndDeletedFalse(id)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Entity not found", getEntityName(), "id.notFound"));
        requireUniqueRename(entity, dto.getName());
        getMapper().partialUpdate(entity, dto);
        entity.setTranspositionSemitones(dto.getTranspositionSemitones());
        entity.setBassClefTranspositionSemitones(dto.getBassClefTranspositionSemitones());
        entity.setSoundBank(dto.getSoundBank());
        entity.setSoundProgram(dto.getSoundProgram());
        entity.setPercussionKey(dto.getPercussionKey());
        entity.setLowestWrittenPitch(dto.getLowestWrittenPitch());
        entity.setHighestWrittenPitch(dto.getHighestWrittenPitch());
        return saveEntity(entity, token, false);
    }

    /** A partial update keeps the stored values it does not send: the range is checked as it will be stored. */
    @Override
    public InstrumentsDTO partialUpdate(Long id, InstrumentsDTO dto, AbstractAuthenticationToken token) {
        requireValidPlaybackSettings(dto);
        Instruments stored = id == null ? null : getRepository().findByIdAndDeletedFalse(id).orElse(null);
        if (stored != null) requireUniqueRename(stored, dto.getName());
        PlaybackSettingsValidator.requireValidRange(
            getEntityName(),
            dto.getLowestWrittenPitch() != null || stored == null ? dto.getLowestWrittenPitch() : stored.getLowestWrittenPitch(),
            dto.getHighestWrittenPitch() != null || stored == null ? dto.getHighestWrittenPitch() : stored.getHighestWrittenPitch()
        );
        return super.update(id, dto, token);
    }

    /**
     * A deleted instrument leaves the ensemble, and the instruments after it move up: the lock of the ensemble keeps the
     * positions consistent with a concurrent save of the ensemble.
     */
    @Override
    public InstrumentsDTO delete(Long id, AbstractAuthenticationToken token) {
        getRepository().lockTenantEnsemble();
        Integer position = id == null ? null : getRepository().findByIdAndDeletedFalse(id).map(Instruments::getEnsemblePosition).orElse(null);
        if (position != null) getRepository().leaveEnsemble(id, position);
        return super.delete(id, token);
    }

    /**
     * L'elenco degli strumenti mostra quanti utenti hanno assegnato ciascuno
     * strumento. Il conteggio non sta sull'entità — la relazione è dichiarata
     * dalla parte degli utenti — e viene quindi recuperato con una sola query
     * raggruppata per l'intera pagina, non una per riga.
     */
    @Override
    @Transactional(readOnly = true)
    public Page<InstrumentsDTO> findEntitiesByCriteria(InstrumentsCriteria criteria, Pageable pageable, AbstractAuthenticationToken token) {
        Page<InstrumentsDTO> page = super.findEntitiesByCriteria(criteria, pageable, token);

        List<Long> instrumentIds = page.getContent().stream().map(InstrumentsDTO::getId).filter(Objects::nonNull).toList();

        if (instrumentIds.isEmpty()) {
            return page;
        }

        Map<Long, Long> countByInstrumentId = new HashMap<>();
        for (Object[] row : usersRepository.countUsersByInstrumentIds(instrumentIds)) {
            countByInstrumentId.put((Long) row[0], (Long) row[1]);
        }

        page.getContent().forEach(instrument -> instrument.setUsersCount(countByInstrumentId.getOrDefault(instrument.getId(), 0L)));

        return page;
    }

    @Override
    protected Specification<Instruments> buildSpecification(InstrumentsCriteria criteria) {
        return super.buildSpecification(criteria).and((root, query, cb) -> {
            if (criteria == null || criteria.getPlaybackConfigured() == null || criteria.getPlaybackConfigured().getEquals() == null) {
                return cb.conjunction();
            }
            Predicate configured = cb.or(
                cb.isNotNull(root.get("percussionKey")),
                cb.and(cb.isNotNull(root.get("soundProgram")), cb.isNotNull(root.get("transpositionSemitones")))
            );
            return Boolean.TRUE.equals(criteria.getPlaybackConfigured().getEquals()) ? configured : cb.not(configured);
        });
    }

    /** A rename is checked only when the name really changes: names already doubled before the check stay as they are. */
    private void requireUniqueRename(Instruments entity, String name) {
        if (name == null || InstrumentNames.uniqueKey(name).equals(InstrumentNames.uniqueKey(entity.getName()))) return;
        requireUniqueName(name, entity.getId());
    }

    /**
     * No two instruments of the tenant may have the same name, compared in lower case without accents, punctuation and
     * repeated spaces. The lock of the tenant, held until the end of the transaction, makes the check atomic.
     */
    private void requireUniqueName(String name, Long excludedId) {
        String key = InstrumentNames.uniqueKey(name);
        if (key.isEmpty()) return;
        getRepository().lockTenantNames();
        for (Object[] row : getRepository().findActiveNames()) {
            if (!Objects.equals(row[0], excludedId) && key.equals(InstrumentNames.uniqueKey((String) row[1]))) {
                throw new RequestAlertException(HttpStatus.CONFLICT, "An instrument with the same name exists", getEntityName(), "instrument.name.exists");
            }
        }
    }

    private void requireValidPlaybackSettings(InstrumentsDTO dto) {
        PlaybackSettingsValidator.requireValidSound(
            getEntityName(),
            dto.getTranspositionSemitones(),
            dto.getBassClefTranspositionSemitones(),
            dto.getSoundBank(),
            dto.getSoundProgram(),
            dto.getPercussionKey()
        );
    }
}
