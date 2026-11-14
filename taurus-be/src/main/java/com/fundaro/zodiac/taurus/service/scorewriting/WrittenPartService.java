package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.service.TracksService;
import com.fundaro.zodiac.taurus.service.dto.ChildrenEntitiesDTO;
import com.fundaro.zodiac.taurus.service.dto.SheetsMusicDTO;
import com.fundaro.zodiac.taurus.service.dto.TracksDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.NewWrittenPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.WrittenPartDTO;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService.Content;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Parts written from scratch: the part is added at the end of the track, without pages, and its first content is kept as
 * its draft until the author saves a version.
 */
@Service
@Transactional
public class WrittenPartService {

    private static final String ENTITY = "Tracks";

    private final TracksRepository tracksRepository;
    private final TracksService tracksService;
    private final InstrumentsRepository instrumentsRepository;
    private final ScoreDraftService draftService;

    public WrittenPartService(
        TracksRepository tracksRepository,
        TracksService tracksService,
        InstrumentsRepository instrumentsRepository,
        ScoreDraftService draftService
    ) {
        this.tracksRepository = tracksRepository;
        this.tracksService = tracksService;
        this.instrumentsRepository = instrumentsRepository;
        this.draftService = draftService;
    }

    /**
     * Adds a written part to the track and stores its first draft.
     *
     * @throws RequestAlertException {@code scorePlayback.track.notFound}, {@code version.conflict} when the track changed
     *                               since the author read it, {@code scoreWriting.instrumentNotFound} for an instrument
     *                               that does not exist, {@code scoreWriting.contentInvalid} or
     *                               {@code scorePlayback.upload.tooLarge} for the content
     */
    public WrittenPartDTO create(Long trackId, NewWrittenPartDTO request, AbstractAuthenticationToken token) {
        if (request == null) throw ScoreDraftService.invalidContent("empty");
        // The lock on the track serializes the parts added at the same time and the saves of the track.
        Tracks track = tracksRepository.findByIdForUpdate(trackId)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Track not found", ENTITY, "scorePlayback.track.notFound"));
        if (request.trackVersion() != null && !request.trackVersion().equals(track.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Track was modified by another request", ENTITY, "version.conflict");
        }
        List<Long> instrumentIds = instrumentIds(request.instrumentIds());
        Content content = draftService.readContent(request.content());

        SheetsMusicDTO part = new SheetsMusicDTO();
        String description = request.description() == null ? null : request.description().strip();
        part.setDescription(description == null || description.isEmpty() ? null : description);
        Set<ChildrenEntitiesDTO> instruments = new LinkedHashSet<>();
        for (int index = 0; index < instrumentIds.size(); index++) {
            ChildrenEntitiesDTO instrument = new ChildrenEntitiesDTO();
            instrument.setIndex(instrumentIds.get(index));
            instrument.setOrder((long) index + 1);
            instruments.add(instrument);
        }
        part.setInstruments(instruments);
        TracksDTO saved = tracksService.appendScores(trackId, List.of(part), token);
        SheetsMusicDTO created = saved.getScores().stream()
            .max(Comparator.comparing(score -> score.getOrder() == null ? 0L : score.getOrder()))
            .orElseThrow(() -> new IllegalStateException("The written part was not added to track " + trackId));
        draftService.start(created.getId(), content, token);
        return new WrittenPartDTO(created.getId(), saved.getVersion());
    }

    /** Distinct ids in their order, each of an instrument still in use. */
    private List<Long> instrumentIds(List<Long> requested) {
        if (requested == null || requested.isEmpty()) return List.of();
        List<Long> ids = requested.stream().filter(Objects::nonNull).distinct().toList();
        Set<Long> found = instrumentsRepository.findAllById(ids).stream()
            .filter(instrument -> !Boolean.TRUE.equals(instrument.getDeleted()))
            .map(Instruments::getId)
            .collect(Collectors.toSet());
        if (!found.containsAll(ids)) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Instrument not found", ENTITY, "scoreWriting.instrumentNotFound");
        }
        return ids;
    }
}
