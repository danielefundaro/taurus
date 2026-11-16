package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.ArrangementVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.TrackArrangement;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ArrangementVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.TrackArrangementRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.TrackArrangementRepository.RowLink;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PlaybackInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowStateDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowStatus;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementVersionDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.RowChecksDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementContents.StoredRow;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Lookups and views shared by the services of the score of a track. */
@Component
public class ArrangementSupport {

    static final String ENTITY = "TrackArrangement";

    private final TrackArrangementRepository repository;
    private final ArrangementVersionRepository versionRepository;
    private final ScoreVersionRepository scoreVersionRepository;
    private final InstrumentsRepository instrumentsRepository;
    private final ArrangementContents contents;
    private final ObjectMapper objectMapper;

    public ArrangementSupport(
        TrackArrangementRepository repository,
        ArrangementVersionRepository versionRepository,
        ScoreVersionRepository scoreVersionRepository,
        InstrumentsRepository instrumentsRepository,
        ArrangementContents contents,
        ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.versionRepository = versionRepository;
        this.scoreVersionRepository = scoreVersionRepository;
        this.instrumentsRepository = instrumentsRepository;
        this.contents = contents;
        this.objectMapper = objectMapper;
    }

    /** The score of the track. */
    public TrackArrangement requireArrangement(Tracks track) {
        return repository.findByTrackIdAndDeletedFalse(track.getId()).orElseThrow(ArrangementSupport::notFound);
    }

    /** A version of the score, removed versions excluded. */
    public ArrangementVersion requireVersion(TrackArrangement arrangement, Long versionId) {
        if (versionId == null) throw versionNotFound();
        return versionRepository.findByIdAndArrangementIdAndDeletedFalse(versionId, arrangement.getId()).orElseThrow(ArrangementSupport::versionNotFound);
    }

    /** The current version of the score, {@code null} before the first save. */
    public ArrangementVersion currentVersion(TrackArrangement arrangement) {
        if (arrangement.getCurrentVersionId() == null) return null;
        return versionRepository.findByIdAndArrangementIdAndDeletedFalse(arrangement.getCurrentVersionId(), arrangement.getId()).orElse(null);
    }

    private static RequestAlertException versionNotFound() {
        return new RequestAlertException(HttpStatus.NOT_FOUND, "Score version not found", ENTITY, "scorePlayback.version.notFound");
    }

    /** An extraction, or a new score, that does not fit the rows of the score or the parts of the track. */
    static RequestAlertException extractionInvalid(String reason) {
        return new RequestAlertException(HttpStatus.BAD_REQUEST, "Invalid extraction", ENTITY, "scoreWriting.extractionInvalid").with("reason", reason);
    }

    static RequestAlertException notFound() {
        return new RequestAlertException(HttpStatus.NOT_FOUND, "Score not found", ENTITY, "scoreWriting.arrangementNotFound");
    }

    public ArrangementVersionDTO toDto(ArrangementVersion version, TrackArrangement arrangement) {
        return new ArrangementVersionDTO(
            version.getId(),
            version.getVersionNumber(),
            version.getStatus(),
            Boolean.TRUE.equals(version.getConcertPitch()),
            version.getMeasureCount(),
            checks(version),
            version.getParentVersionId(),
            version.getInsertDate(),
            version.getApprovedAt(),
            Objects.equals(arrangement.getCurrentVersionId(), version.getId())
        );
    }

    /** The rows with their instruments, also those removed after the row was written. */
    public List<ArrangementRowDTO> rows(List<StoredRow> rows) {
        Map<Long, PlaybackInstrumentDTO> instruments = instruments(rows);
        return rows.stream()
            .map(row -> new ArrangementRowDTO(row.id(), row.name(), row.instrumentIds().stream().map(instruments::get).filter(Objects::nonNull).toList()))
            .toList();
    }

    /**
     * The rows of the score with the state of their part against the current version of the score.
     *
     * @param rows rows of the current version, or of the draft before the first save
     */
    public List<ArrangementRowStateDTO> rowStates(Tracks track, TrackArrangement arrangement, List<StoredRow> rows) {
        Map<Long, PlaybackInstrumentDTO> instruments = instruments(rows);
        Map<String, Long> linked = new HashMap<>();
        Set<String> lost = new HashSet<>();
        Set<Long> activeParts = track.getScores().stream().map(SheetsMusic::getId).collect(Collectors.toSet());
        for (RowLink link : repository.findRowLinks(track.getId())) {
            if (!link.deleted() && activeParts.contains(link.partId())) linked.put(link.row(), link.partId());
            else lost.add(link.row());
        }
        Map<Long, SheetsMusic> parts = track.getScores().stream().collect(Collectors.toMap(SheetsMusic::getId, Function.identity()));
        Map<Long, ScoreVersion> extracted = linked.isEmpty() ? Map.of() : latestExtracted(linked.values(), arrangement.getId());
        List<Long> currentIds = linked.values().stream().map(parts::get).map(SheetsMusic::getCurrentScoreVersionId).filter(Objects::nonNull).toList();
        Map<Long, ScoreVersion> current = currentIds.isEmpty()
            ? Map.of()
            : scoreVersionRepository.findAllByIdInAndDeletedFalse(currentIds).stream().collect(Collectors.toMap(ScoreVersion::getId, Function.identity()));
        // Also the removed versions of the score tell where a part comes from.
        Set<Long> sourceIds = extracted.values().stream().map(ScoreVersion::getArrangementVersionId).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, Integer> sourceNumbers = sourceIds.isEmpty()
            ? Map.of()
            : versionRepository.findAllById(sourceIds).stream().collect(Collectors.toMap(ArrangementVersion::getId, ArrangementVersion::getVersionNumber));

        return rows.stream().map(row -> {
            Long partId = linked.get(row.id());
            ArrangementRowStatus status;
            ScoreVersion source = partId == null ? null : extracted.get(partId);
            if (partId == null) {
                status = lost.contains(row.id()) ? ArrangementRowStatus.PART_DELETED : ArrangementRowStatus.NEW;
            } else {
                Long currentId = parts.get(partId).getCurrentScoreVersionId();
                status = status(source, currentId == null ? null : current.get(currentId), arrangement);
            }
            return new ArrangementRowStateDTO(
                row.id(),
                row.name(),
                row.instrumentIds().stream().map(instruments::get).filter(Objects::nonNull).toList(),
                partId,
                status,
                source == null ? null : sourceNumbers.get(source.getArrangementVersionId())
            );
        }).toList();
    }

    /**
     * The state of a linked part: never extracted, up to date with the current version of the score, changed after the
     * extraction, or to extract again.
     *
     * @param extracted latest version of the part extracted from the score, {@code null} without one
     * @param current   current version of the part, {@code null} without one
     */
    static ArrangementRowStatus status(ScoreVersion extracted, ScoreVersion current, TrackArrangement arrangement) {
        if (extracted == null) return ArrangementRowStatus.TO_EXTRACT;
        if (current != null && current.getId().equals(extracted.getId())) {
            return Objects.equals(extracted.getArrangementVersionId(), arrangement.getCurrentVersionId())
                ? ArrangementRowStatus.UP_TO_DATE
                : ArrangementRowStatus.TO_EXTRACT;
        }
        if (current != null && current.getVersionNumber() > extracted.getVersionNumber()) return ArrangementRowStatus.MODIFIED;
        return ArrangementRowStatus.TO_EXTRACT;
    }

    /** The latest version of each part extracted from a version of the score, by part. */
    private Map<Long, ScoreVersion> latestExtracted(Collection<Long> partIds, Long arrangementId) {
        return scoreVersionRepository.findExtracted(partIds, arrangementId).stream().collect(Collectors.toMap(
            ScoreVersion::getSheetMusicId,
            Function.identity(),
            (first, second) -> Comparator.comparing(ScoreVersion::getVersionNumber).compare(first, second) >= 0 ? first : second
        ));
    }

    private Map<Long, PlaybackInstrumentDTO> instruments(List<StoredRow> rows) {
        Set<Long> ids = rows.stream().flatMap(row -> row.instrumentIds().stream()).collect(Collectors.toSet());
        if (ids.isEmpty()) return Map.of();
        return instrumentsRepository.findAllById(ids).stream().collect(Collectors.toMap(Instruments::getId, ScorePlaybackSupport::instrument));
    }

    public List<StoredRow> rows(ArrangementVersion version) {
        return contents.rows(version.getRowsJson());
    }

    private List<RowChecksDTO> checks(ArrangementVersion version) {
        try {
            return List.of(objectMapper.readValue(version.getChecksJson(), RowChecksDTO[].class));
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored checks of score version " + version.getId() + " are not readable", exception);
        }
    }
}
