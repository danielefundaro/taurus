package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.domain.scorewriting.ArrangementVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.domain.scorewriting.TrackArrangement;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.TrackArrangementRepository;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.TracksService;
import com.fundaro.zodiac.taurus.service.dto.ChildrenEntitiesDTO;
import com.fundaro.zodiac.taurus.service.dto.SheetsMusicDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractedPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractedRowDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractionRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ExtractionResultDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.MusicXmlException;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreErrorReportService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionWriter;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScoreVersionWriter.NewVersion;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementContents.StoredRow;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService.Content;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Extraction of parts from the current version of the score of a track. The browser builds and transposes the MusicXML of
 * each part; the extraction checks rows, parts and instruments, then creates in one transaction the new parts and the
 * versions with origin {@code ARRANGEMENT}, approved when the version of the score is, and links each row to its part.
 */
@Service
@Transactional
public class ArrangementExtractionService {

    private static final String TRACK_ENTITY = "Tracks";
    private static final String FILE_NAME = "estrazione";

    private final ArrangementSupport support;
    private final TrackArrangementRepository repository;
    private final TracksRepository tracksRepository;
    private final TracksService tracksService;
    private final InstrumentsRepository instrumentsRepository;
    private final ScoreDraftService draftService;
    private final ScoreEditLockService lockService;
    private final ScoreVersionWriter writer;
    private final MediaService mediaService;
    private final ScoreErrorReportService reportService;
    private final ScoreWritingMetrics metrics;

    public ArrangementExtractionService(
        ArrangementSupport support,
        TrackArrangementRepository repository,
        TracksRepository tracksRepository,
        TracksService tracksService,
        InstrumentsRepository instrumentsRepository,
        ScoreDraftService draftService,
        ScoreEditLockService lockService,
        ScoreVersionWriter writer,
        MediaService mediaService,
        ScoreErrorReportService reportService,
        ScoreWritingMetrics metrics
    ) {
        this.support = support;
        this.repository = repository;
        this.tracksRepository = tracksRepository;
        this.tracksService = tracksService;
        this.instrumentsRepository = instrumentsRepository;
        this.draftService = draftService;
        this.lockService = lockService;
        this.writer = writer;
        this.mediaService = mediaService;
        this.reportService = reportService;
        this.metrics = metrics;
    }

    /** A row to extract, checked: its row in the score, the part receiving the version and the content. */
    private record Extraction(ExtractedRowDTO request, StoredRow row, SheetsMusic part, Content content) {}

    /**
     * Extracts the chosen rows of the current version of the score into the parts of the track.
     *
     * @throws RequestAlertException {@code scorePlayback.track.notFound}, {@code version.conflict} when the track changed
     *                               since the author read it, {@code scoreWriting.arrangementNotFound},
     *                               {@code scorePlayback.version.notFound}, {@code scoreWriting.arrangementOutdated} for a
     *                               version that is no longer the current one, {@code scoreWriting.extractionInvalid} with
     *                               the reason, {@code scorePlayback.part.notFound}, {@code scoreWriting.instrumentNotFound},
     *                               {@code scoreWriting.instrumentNotConfigured} for a row to transpose whose instrument
     *                               has no transposition, {@code scoreWriting.locked} for a part someone else is editing,
     *                               and the errors of the content of a part, with the row
     */
    public ExtractionResultDTO extract(Long trackId, Long versionId, ExtractionRequestDTO request, AbstractAuthenticationToken token) {
        if (request == null || request.rows() == null || request.rows().isEmpty()) throw ArrangementSupport.extractionInvalid("empty");
        // The lock on the track serializes the extraction with the other changes of its parts.
        Tracks track = tracksRepository.findByIdForUpdate(trackId)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Track not found", TRACK_ENTITY, "scorePlayback.track.notFound"));
        if (request.trackVersion() != null && !Objects.equals(request.trackVersion(), track.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Track was modified by another request", TRACK_ENTITY, "version.conflict");
        }
        TrackArrangement arrangement = support.requireArrangement(track);
        ArrangementVersion version = support.requireVersion(arrangement, versionId);
        if (!Objects.equals(arrangement.getCurrentVersionId(), version.getId())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "The score has a newer version", ArrangementSupport.ENTITY, "scoreWriting.arrangementOutdated");
        }

        List<Extraction> extractions = check(track, version, request.rows());
        requireInstruments(extractions, Boolean.TRUE.equals(version.getConcertPitch()));
        for (Extraction extraction : extractions) {
            if (extraction.part() != null) lockService.requireNotHeldByOthers(ScoreEditTarget.PART, extraction.part().getId(), null, token);
        }
        extractions = withContents(extractions);
        extractions = withNewParts(track, extractions, token);

        String actor = ArrangementService.actor(token);
        boolean approved = version.getStatus() == ScoreVersionStatus.APPROVED;
        List<ExtractedPartDTO> parts = new ArrayList<>();
        for (Extraction extraction : extractions) {
            boolean created = extraction.request().sheetMusicId() == null;
            SheetsMusic part = extraction.part();
            ScoreVersion extracted;
            try {
                extracted = writer.write(
                    new NewVersion(
                        part,
                        extraction.content().document(),
                        ScoreVersionOrigin.ARRANGEMENT,
                        FILE_NAME,
                        null,
                        extraction.content().part().name(),
                        null,
                        null,
                        null,
                        null,
                        approved,
                        actor,
                        version.getId()
                    ),
                    (content, fileName) -> mediaService.store(content, fileName, MusicXmlDocuments.COMPRESSED_MEDIA_TYPE, ScoreVersionWriter.MEDIA_CATEGORY, token)
                ).version();
            } catch (MusicXmlException exception) {
                throw ScoreDraftService.invalidContent(exception.reason()).with("row", extraction.row().id());
            }
            part.setCurrentScoreVersionId(extracted.getId());
            if (approved) reportService.closeForApproval(part, extracted.getId(), actor);
            metrics.extraction(created ? "newPart" : "existing");
            parts.add(new ExtractedPartDTO(extraction.row().id(), part.getId(), extracted.getId(), created));
        }

        List<String> rows = extractions.stream().map(extraction -> extraction.row().id()).toList();
        List<Long> partIds = extractions.stream().map(extraction -> extraction.part().getId()).toList();
        repository.unlinkRows(track.getId(), rows);
        repository.unlinkParts(partIds);
        extractions.forEach(extraction -> repository.link(track.getId(), extraction.part().getId(), extraction.row().id()));
        tracksRepository.flush();
        return new ExtractionResultDTO(parts, track.getEntityVersion());
    }

    /** Each row exists and appears once; each part is of the track, appears once and has the instruments of its row. */
    private List<Extraction> check(Tracks track, ArrangementVersion version, List<ExtractedRowDTO> requested) {
        Map<String, StoredRow> rows = support.rows(version).stream().collect(Collectors.toMap(StoredRow::id, Function.identity()));
        Map<Long, SheetsMusic> parts = track.getScores().stream().collect(Collectors.toMap(SheetsMusic::getId, Function.identity()));
        Set<String> seenRows = new HashSet<>();
        Set<Long> seenParts = new HashSet<>();
        List<Extraction> extractions = new ArrayList<>();
        for (ExtractedRowDTO extraction : requested) {
            StoredRow row = extraction == null ? null : rows.get(extraction.row());
            if (row == null) throw ArrangementSupport.extractionInvalid("unknownRow");
            if (!seenRows.add(row.id())) throw ArrangementSupport.extractionInvalid("duplicateRow");
            SheetsMusic part = null;
            if (extraction.sheetMusicId() != null) {
                if (!seenParts.add(extraction.sheetMusicId())) throw ArrangementSupport.extractionInvalid("duplicateTarget");
                part = parts.get(extraction.sheetMusicId());
                if (part == null) {
                    throw new RequestAlertException(HttpStatus.NOT_FOUND, "Part not found", ArrangementSupport.ENTITY, "scorePlayback.part.notFound");
                }
                if (!ArrangementService.sameInstruments(part, row.instrumentIds())) throw ArrangementSupport.extractionInvalid("instrumentsMismatch");
            }
            extractions.add(new Extraction(extraction, row, part, null));
        }
        return extractions;
    }

    /**
     * The instruments of the rows still exist; in a score in concert pitch, a row with a pitched instrument needs its
     * transposition to be written for it.
     */
    private void requireInstruments(List<Extraction> extractions, boolean concertPitch) {
        Set<Long> ids = extractions.stream().flatMap(extraction -> extraction.row().instrumentIds().stream()).collect(Collectors.toSet());
        Map<Long, Instruments> instruments = instrumentsRepository.findAllById(ids).stream()
            .filter(instrument -> !Boolean.TRUE.equals(instrument.getDeleted()))
            .collect(Collectors.toMap(Instruments::getId, Function.identity()));
        if (!instruments.keySet().containsAll(ids)) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Instrument not found", ArrangementSupport.ENTITY, "scoreWriting.instrumentNotFound");
        }
        if (!concertPitch) return;
        for (Extraction extraction : extractions) {
            if (extraction.row().instrumentIds().size() != 1) continue;
            Instruments instrument = instruments.get(extraction.row().instrumentIds().get(0));
            if (instrument.getPercussionKey() == null && instrument.getTranspositionSemitones() == null) {
                throw new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Instrument without transposition", ArrangementSupport.ENTITY, "scoreWriting.instrumentNotConfigured")
                    .with("instrument", instrument.getName());
            }
        }
    }

    /** The content of each part, checked within the limits of a part. */
    private List<Extraction> withContents(List<Extraction> extractions) {
        List<Extraction> checked = new ArrayList<>();
        for (Extraction extraction : extractions) {
            Content content;
            try {
                content = draftService.readContent(extraction.request().content());
            } catch (RequestAlertException exception) {
                throw exception.with("row", extraction.row().id());
            }
            checked.add(new Extraction(extraction.request(), extraction.row(), extraction.part(), content));
        }
        return checked;
    }

    /** Adds at the end of the track, without pages, a part for each row extracted without one. */
    private List<Extraction> withNewParts(Tracks track, List<Extraction> extractions, AbstractAuthenticationToken token) {
        List<Extraction> missing = extractions.stream().filter(extraction -> extraction.part() == null).toList();
        if (missing.isEmpty()) return extractions;
        Set<Long> existing = track.getScores().stream().map(SheetsMusic::getId).collect(Collectors.toSet());
        tracksService.appendScores(track.getId(), missing.stream().map(ArrangementExtractionService::newPart).toList(), token);
        // The new parts are added at the end of the track, in the order they were sent.
        List<SheetsMusic> created = track.getScores().stream().filter(part -> !existing.contains(part.getId())).toList();
        if (created.size() != missing.size()) throw new IllegalStateException("The extracted parts were not added to track " + track.getId());
        Iterator<SheetsMusic> next = created.iterator();
        List<Extraction> completed = new ArrayList<>();
        for (Extraction extraction : extractions) {
            completed.add(extraction.part() != null ? extraction : new Extraction(extraction.request(), extraction.row(), next.next(), extraction.content()));
        }
        return completed;
    }

    private static SheetsMusicDTO newPart(Extraction extraction) {
        SheetsMusicDTO part = new SheetsMusicDTO();
        String description = extraction.request().description() == null ? null : extraction.request().description().strip();
        part.setDescription(description == null || description.isEmpty() ? extraction.row().name() : description);
        Set<ChildrenEntitiesDTO> instruments = new LinkedHashSet<>();
        List<Long> instrumentIds = extraction.row().instrumentIds();
        for (int index = 0; index < instrumentIds.size(); index++) {
            ChildrenEntitiesDTO instrument = new ChildrenEntitiesDTO();
            instrument.setIndex(instrumentIds.get(index));
            instrument.setOrder((long) index + 1);
            instruments.add(instrument);
        }
        part.setInstruments(instruments);
        return part;
    }
}
