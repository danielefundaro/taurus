package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DerivedPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.NewWrittenPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.WrittenPartDTO;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

/**
 * Parts derived from a version of another part for a different instrument. The browser transposes the version and sends
 * the result; the derivation checks the source and the instrument, then adds the part at the end of the track like a
 * part written from scratch, with the transposed content as its first draft and the version it comes from.
 */
@Service
@Transactional
public class ScoreDerivationService {

    private static final String ENTITY = "Tracks";
    private static final String VERSION_ENTITY = "ScoreVersion";
    static final String UNAVAILABLE = "scoreWriting.derivationUnavailable";

    private final TracksRepository tracksRepository;
    private final ScoreVersionRepository versionRepository;
    private final InstrumentsRepository instrumentsRepository;
    private final WrittenPartService writtenPartService;

    public ScoreDerivationService(
        TracksRepository tracksRepository,
        ScoreVersionRepository versionRepository,
        InstrumentsRepository instrumentsRepository,
        WrittenPartService writtenPartService
    ) {
        this.tracksRepository = tracksRepository;
        this.versionRepository = versionRepository;
        this.instrumentsRepository = instrumentsRepository;
        this.writtenPartService = writtenPartService;
    }

    /**
     * Adds to the track a part derived from a version of one of its parts.
     *
     * @throws RequestAlertException {@code scorePlayback.track.notFound}, {@code scorePlayback.part.notFound},
     *                               {@code scorePlayback.version.notFound} for a version of another part,
     *                               {@code scoreWriting.derivationUnavailable} with the reason, and the errors of a part
     *                               written from scratch: {@code version.conflict}, {@code scoreWriting.instrumentNotFound},
     *                               {@code scoreWriting.contentInvalid}, {@code scorePlayback.upload.tooLarge}
     */
    public WrittenPartDTO derive(Long trackId, Long scoreId, DerivedPartDTO request, AbstractAuthenticationToken token) {
        if (request == null) throw ScoreDraftService.invalidContent("empty");
        // The lock on the track keeps the source part from changing while the new part is added.
        Tracks track = tracksRepository.findByIdForUpdate(trackId)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Track not found", ENTITY, "scorePlayback.track.notFound"));
        SheetsMusic source = track.getScores().stream()
            .filter(part -> Objects.equals(part.getId(), scoreId))
            .findFirst()
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Part not found", VERSION_ENTITY, "scorePlayback.part.notFound"));
        if (request.versionId() == null || versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(request.versionId(), source.getId()).isEmpty()) {
            throw new RequestAlertException(HttpStatus.NOT_FOUND, "Score version not found", VERSION_ENTITY, "scorePlayback.version.notFound");
        }
        List<Instruments> instruments = source.getInstruments();
        if (instruments.size() != 1) throw unavailable("notSingleInstrument");
        if (instruments.get(0).getPercussionKey() != null) throw unavailable("percussion");
        Instruments target = request.instrumentId() == null
            ? null
            : instrumentsRepository.findById(request.instrumentId()).filter(instrument -> !Boolean.TRUE.equals(instrument.getDeleted())).orElse(null);
        if (target == null) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Instrument not found", ENTITY, "scoreWriting.instrumentNotFound");
        }
        if (target.getPercussionKey() != null) throw unavailable("targetPercussion");

        WrittenPartDTO created = writtenPartService.create(
            trackId,
            new NewWrittenPartDTO(request.description(), List.of(target.getId()), request.content(), request.trackVersion()),
            token
        );
        track.getScores().stream()
            .filter(part -> Objects.equals(part.getId(), created.scoreId()))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("The derived part was not added to track " + trackId))
            .setDerivedFromVersionId(request.versionId());
        return created;
    }

    private static RequestAlertException unavailable(String reason) {
        return new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "The part cannot be derived", VERSION_ENTITY, UNAVAILABLE)
            .with("reason", reason);
    }
}
