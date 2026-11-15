package com.fundaro.zodiac.taurus.service.instrumentsuggestion;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.instrumentsuggestion.SheetMusicInstrumentSuggestion;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.UsersRepository;
import com.fundaro.zodiac.taurus.repository.instrumentsuggestion.SheetMusicInstrumentSuggestionRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.InstrumentsService;
import com.fundaro.zodiac.taurus.service.dto.InstrumentsDTO;
import com.fundaro.zodiac.taurus.service.dto.TracksDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDtos.Action;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDtos.ApplyRequestDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDtos.CandidateDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDtos.DecisionDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDtos.NameDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDtos.PartDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDtos.SuggestionsDTO;
import com.fundaro.zodiac.taurus.service.mapper.InstrumentsMapper;
import com.fundaro.zodiac.taurus.service.mapper.TracksMapper;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The names to add of a track: read with the current instruments of the tenant, and applied in one transaction that
 * creates or associates the instruments and assigns them to the selected parts.
 */
@Service
@Transactional
public class TrackInstrumentSuggestionService {

    /** Beyond this number of names a part is probably the full score of the conductor. */
    static final int SCORE_NAMES = 4;

    private static final String ENTITY = "Tracks";
    private static final Logger log = LoggerFactory.getLogger(TrackInstrumentSuggestionService.class);

    private final TracksRepository tracksRepository;
    private final SheetMusicInstrumentSuggestionRepository suggestionRepository;
    private final InstrumentsRepository instrumentsRepository;
    private final InstrumentsService instrumentsService;
    private final InstrumentsMapper instrumentsMapper;
    private final UsersRepository usersRepository;
    private final TracksMapper tracksMapper;

    public TrackInstrumentSuggestionService(
        TracksRepository tracksRepository,
        SheetMusicInstrumentSuggestionRepository suggestionRepository,
        InstrumentsRepository instrumentsRepository,
        InstrumentsService instrumentsService,
        InstrumentsMapper instrumentsMapper,
        UsersRepository usersRepository,
        TracksMapper tracksMapper
    ) {
        this.tracksRepository = tracksRepository;
        this.suggestionRepository = suggestionRepository;
        this.instrumentsRepository = instrumentsRepository;
        this.instrumentsService = instrumentsService;
        this.instrumentsMapper = instrumentsMapper;
        this.usersRepository = usersRepository;
        this.tracksMapper = tracksMapper;
    }

    /**
     * The open names of the track, grouped by name. Every name is evaluated again with the current instruments: a name
     * for which an instrument has been created meanwhile, here or elsewhere, is proposed for association.
     */
    @Transactional(readOnly = true)
    public SuggestionsDTO find(Long trackId) {
        Tracks track = tracksRepository.findByIdAndDeletedFalse(trackId).orElseThrow(TrackInstrumentSuggestionService::trackNotFound);
        Map<Long, SheetsMusic> parts = parts(track);
        List<SheetMusicInstrumentSuggestion> open = parts.isEmpty() ? List.of() : suggestionRepository.findOpenBySheetMusicIds(parts.keySet());
        if (open.isEmpty()) return new SuggestionsDTO(track.getEntityVersion(), List.of());

        Map<Long, Integer> openByPart = new HashMap<>();
        open.forEach(suggestion -> openByPart.merge(suggestion.getSheetMusicId(), 1, Integer::sum));
        List<Long> order = new ArrayList<>(parts.keySet());
        Map<String, List<SheetMusicInstrumentSuggestion>> byName = new LinkedHashMap<>();
        open.stream()
            .sorted(Comparator.comparingInt((SheetMusicInstrumentSuggestion suggestion) -> order.indexOf(suggestion.getSheetMusicId()))
                .thenComparing(SheetMusicInstrumentSuggestion::getId))
            .forEach(suggestion -> byName.computeIfAbsent(suggestion.getNormalizedName(), name -> new ArrayList<>()).add(suggestion));

        List<InstrumentsDTO> instruments = activeInstruments();
        InstrumentNameRecognizer recognizer = new InstrumentNameRecognizer(instruments);
        Map<String, List<InstrumentsDTO>> candidatesByName = new LinkedHashMap<>();
        Set<Long> candidateIds = new HashSet<>();
        byName.forEach((name, suggestions) -> {
            List<InstrumentsDTO> candidates = candidates(recognizer, instruments, suggestions.get(0));
            candidatesByName.put(name, candidates);
            candidates.forEach(candidate -> candidateIds.add(candidate.getId()));
        });
        Map<Long, Long> usersCount = usersCount(candidateIds);

        List<NameDTO> names = new ArrayList<>();
        byName.forEach((name, suggestions) -> {
            SheetMusicInstrumentSuggestion first = suggestions.get(0);
            List<CandidateDTO> candidates = candidatesByName.get(name).stream()
                .map(candidate -> new CandidateDTO(candidate.getId(), candidate.getName(), usersCount.getOrDefault(candidate.getId(), 0L)))
                .toList();
            List<PartDTO> partsOfName = suggestions.stream().map(suggestion -> {
                SheetsMusic part = parts.get(suggestion.getSheetMusicId());
                int instrumentsCount = part.getInstruments().size();
                return new PartDTO(
                    part.getId(),
                    suggestion.getReadText(),
                    suggestion.getSource(),
                    instrumentsCount > 0,
                    instrumentsCount + openByPart.getOrDefault(part.getId(), 0) > SCORE_NAMES
                );
            }).toList();
            names.add(new NameDTO(
                name,
                first.getProposedName(),
                first.getCatalogKeyword(),
                candidates.isEmpty() ? Action.CREATE : Action.ASSOCIATE,
                candidates,
                partsOfName
            ));
        });
        return new SuggestionsDTO(track.getEntityVersion(), names);
    }

    /**
     * Applies the decisions in one transaction: instruments created with the playback proposal of the catalogue, assigned
     * after the instruments the selected parts already have, parts marked to be reviewed, names closed. Nothing is
     * created when a decision fails. The names without a decision stay open.
     */
    public TracksDTO apply(Long trackId, ApplyRequestDTO request, AbstractAuthenticationToken token) {
        Tracks track = tracksRepository.findByIdForUpdate(trackId).orElseThrow(TrackInstrumentSuggestionService::trackNotFound);
        if (!Objects.equals(request.trackVersion(), track.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Track was modified by another request", ENTITY, "version.conflict");
        }
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        Map<Long, SheetsMusic> parts = parts(track);
        List<SheetMusicInstrumentSuggestion> open = parts.isEmpty() ? List.of() : suggestionRepository.findOpenBySheetMusicIds(parts.keySet());
        Map<String, List<SheetMusicInstrumentSuggestion>> byName = new HashMap<>();
        open.forEach(suggestion -> byName.computeIfAbsent(suggestion.getNormalizedName(), name -> new ArrayList<>()).add(suggestion));

        int created = 0;
        int associated = 0;
        int ignored = 0;
        for (DecisionDTO decision : request.decisions()) {
            List<SheetMusicInstrumentSuggestion> suggestions = byName.remove(decision.normalizedName());
            if (suggestions == null) throw notOpen();
            Set<Long> selected = selectedParts(decision, suggestions, parts);
            if (decision.action() == Action.IGNORE) {
                suggestions.forEach(suggestion -> suggestion.ignore(actor));
                ignored++;
                continue;
            }
            Long instrumentId = decision.action() == Action.CREATE ? create(decision.name(), token) : associate(decision.instrumentId());
            if (decision.action() == Action.CREATE) created++;
            else associated++;
            Instruments instrument = instrumentsRepository.getReferenceById(instrumentId);
            for (SheetMusicInstrumentSuggestion suggestion : suggestions) {
                if (!selected.contains(suggestion.getSheetMusicId())) {
                    suggestion.ignore(actor);
                    continue;
                }
                SheetsMusic part = parts.get(suggestion.getSheetMusicId());
                if (part.getInstruments().stream().noneMatch(value -> instrumentId.equals(value.getId()))) {
                    part.getInstruments().add(instrument);
                }
                part.setNeedsReview(true);
                suggestion.accept(instrumentId, actor);
            }
        }
        suggestionRepository.saveAll(open);

        // A new version of the track, so that a workspace open elsewhere notices it when saving.
        track.setEditBy(actor);
        track.setEditDate(new Date());
        tracksRepository.saveAndFlush(track);
        log.info("Names to add of track {} applied: {} created, {} associated, {} ignored", trackId, created, associated, ignored);
        return tracksMapper.toDto(track);
    }

    /** The parts selected for a name: each must be a part of the track that reports the name. */
    private static Set<Long> selectedParts(DecisionDTO decision, List<SheetMusicInstrumentSuggestion> suggestions, Map<Long, SheetsMusic> parts) {
        Set<Long> selected = new HashSet<>(decision.sheetMusicIds() == null ? List.of() : decision.sheetMusicIds());
        Set<Long> reporting = new HashSet<>();
        suggestions.forEach(suggestion -> reporting.add(suggestion.getSheetMusicId()));
        for (Long id : selected) {
            if (!parts.containsKey(id)) {
                throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Score does not belong to track", ENTITY, "track.score.notFound");
            }
            if (!reporting.contains(id)) throw notOpen();
        }
        return selected;
    }

    private Long create(String name, AbstractAuthenticationToken token) {
        InstrumentsDTO instrument = new InstrumentsDTO();
        instrument.setName(InstrumentNames.truncated(name));
        InstrumentPlaybackSuggester.suggest(instrument.getName()).ifPresent(suggestion -> {
            instrument.setTranspositionSemitones(suggestion.transposition());
            instrument.setBassClefTranspositionSemitones(suggestion.bassClefTransposition());
            instrument.setSoundBank(suggestion.soundBank());
            instrument.setSoundProgram(suggestion.soundProgram());
            instrument.setPercussionKey(suggestion.percussionKey());
            instrument.setLowestWrittenPitch(suggestion.lowestWrittenPitch());
            instrument.setHighestWrittenPitch(suggestion.highestWrittenPitch());
        });
        // Through the service: the same check on the name, audit and notices as a manual creation.
        return instrumentsService.save(instrument, token).getId();
    }

    private Long associate(Long instrumentId) {
        return instrumentsRepository.findByIdAndDeletedFalse(instrumentId)
            .map(Instruments::getId)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Instrument not found", "Instruments", "id.notFound"));
    }

    /** The instruments a name could be: the outcome of the rules, plus any instrument with the very same name. */
    private static List<InstrumentsDTO> candidates(
        InstrumentNameRecognizer recognizer,
        List<InstrumentsDTO> instruments,
        SheetMusicInstrumentSuggestion suggestion
    ) {
        List<InstrumentsDTO> candidates = new ArrayList<>();
        InstrumentNameRecognizer.Outcome outcome = recognizer.evaluate(suggestion.getProposedName());
        if (outcome instanceof InstrumentNameRecognizer.Assigned assigned) candidates.add(assigned.instrument());
        if (outcome instanceof InstrumentNameRecognizer.Suggested suggested) candidates.addAll(suggested.candidates());
        for (InstrumentsDTO instrument : instruments) {
            boolean sameName = suggestion.getNormalizedName().equals(InstrumentNames.uniqueKey(instrument.getName()));
            if (sameName && candidates.stream().noneMatch(candidate -> candidate.getId().equals(instrument.getId()))) {
                candidates.add(0, instrument);
            }
        }
        return candidates;
    }

    private List<InstrumentsDTO> activeInstruments() {
        return instrumentsRepository.findAll().stream().filter(instrument -> !Boolean.TRUE.equals(instrument.getDeleted())).map(instrumentsMapper::toDto).toList();
    }

    private Map<Long, Long> usersCount(Collection<Long> instrumentIds) {
        Map<Long, Long> counts = new HashMap<>();
        if (instrumentIds.isEmpty()) return counts;
        for (Object[] row : usersRepository.countUsersByInstrumentIds(instrumentIds)) {
            counts.put((Long) row[0], (Long) row[1]);
        }
        return counts;
    }

    /** The active parts of the track, in their order. */
    private static Map<Long, SheetsMusic> parts(Tracks track) {
        Map<Long, SheetsMusic> parts = new LinkedHashMap<>();
        track.getScores().stream().filter(part -> part.getId() != null).forEach(part -> parts.put(part.getId(), part));
        return parts;
    }

    private static RequestAlertException trackNotFound() {
        return new RequestAlertException(HttpStatus.NOT_FOUND, "Entity not found", ENTITY, "id.notFound");
    }

    private static RequestAlertException notOpen() {
        return new RequestAlertException(HttpStatus.CONFLICT, "The name to add is no longer open", ENTITY, "instrumentSuggestion.notOpen");
    }
}
