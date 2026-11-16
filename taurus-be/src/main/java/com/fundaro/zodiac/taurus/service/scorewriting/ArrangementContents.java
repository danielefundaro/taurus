package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowRequestDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.MusicXmlException;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.PartInfo;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService.StoredContent;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Reading and checks of the MusicXML of a score written in the editor, with the instruments of its rows: one part for
 * each row, in the same order, all with the same number of measures, within the limits of the scores.
 */
@Component
public class ArrangementContents {

    /** An id of a MusicXML part, which is an XML name; it fits the link of a part to its row. */
    private static final Pattern ROW_ID = Pattern.compile("[A-Za-z_][A-Za-z0-9_.-]{0,63}");
    private static final String ENTITY = "TrackArrangement";

    private final ApplicationProperties properties;
    private final InstrumentsRepository instrumentsRepository;
    private final ObjectMapper objectMapper;

    public ArrangementContents(ApplicationProperties properties, InstrumentsRepository instrumentsRepository, ObjectMapper objectMapper) {
        this.properties = properties;
        this.instrumentsRepository = instrumentsRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * A row of a score as stored with its drafts and versions.
     *
     * @param id            id of the part of the row in the MusicXML
     * @param name          name of the part, {@code null} when it has none
     * @param instrumentIds instruments of the row: one, or several percussion instruments
     */
    public record StoredRow(String id, String name, List<Long> instrumentIds) {}

    /** A checked score: the document, its compressed form, its rows and its notation. */
    public record ArrangementContent(Document document, byte[] compressed, List<StoredRow> rows, boolean concertPitch, int measureCount, String rowsJson) {
        StoredContent stored() {
            return new StoredContent(compressed, measureCount, rowsJson);
        }
    }

    /**
     * Checks a score written in the editor and the instruments of its rows.
     *
     * @throws RequestAlertException {@code scorePlayback.upload.tooLarge} beyond the size of a score,
     *                               {@code scoreWriting.contentInvalid} with the reason ({@code tooManyRows},
     *                               {@code rowsMismatch} when the rows are not the parts of the file, {@code unevenMeasures},
     *                               {@code rowInstruments} for a row without instruments or with a pitched instrument among
     *                               others, or a reason of the MusicXML), {@code scoreWriting.instrumentNotFound} for an
     *                               instrument that does not exist or was removed
     */
    public ArrangementContent read(String text, List<ArrangementRowRequestDTO> rows) {
        if (text == null || text.isBlank()) throw ScoreDraftService.invalidContent("empty");
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        long maxBytes = properties.getScoreWriting().getMaxArrangementBytes();
        if (bytes.length > maxBytes) {
            throw new RequestAlertException(HttpStatus.CONTENT_TOO_LARGE, "Score too large", ENTITY, "scorePlayback.upload.tooLarge")
                .with("maxMegabytes", (int) (maxBytes / (1024 * 1024)));
        }
        Document document;
        List<PartInfo> parts;
        try {
            document = MusicXmlDocuments.read(bytes);
            parts = MusicXmlDocuments.parts(document);
        } catch (MusicXmlException exception) {
            throw ScoreDraftService.invalidContent(exception.reason());
        }
        if (parts.isEmpty()) throw ScoreDraftService.invalidContent("noParts");
        int maxRows = properties.getScoreWriting().getMaxArrangementRows();
        if (parts.size() > maxRows) throw ScoreDraftService.invalidContent("tooManyRows").with("maxRows", maxRows);
        List<String> ids = parts.stream().map(PartInfo::id).toList();
        boolean matching = rows != null
            && rows.size() == parts.size()
            && MusicXmlDocuments.partElementIds(document).equals(ids)
            && new HashSet<>(ids).size() == ids.size()
            && ids.stream().allMatch(id -> ROW_ID.matcher(id).matches());
        for (int index = 0; matching && index < parts.size(); index++) {
            matching = rows.get(index) != null && ids.get(index).equals(rows.get(index).id());
        }
        if (!matching) throw ScoreDraftService.invalidContent("rowsMismatch");
        int measureCount = parts.get(0).measureCount();
        if (parts.stream().anyMatch(part -> part.measureCount() != measureCount)) throw ScoreDraftService.invalidContent("unevenMeasures");

        Map<Long, Instruments> instruments = instruments(rows);
        List<StoredRow> stored = new ArrayList<>();
        for (int index = 0; index < parts.size(); index++) {
            List<Long> rowInstruments = rows.get(index).instrumentIds().stream().distinct().toList();
            boolean percussion = rowInstruments.stream().allMatch(id -> instruments.get(id).getPercussionKey() != null);
            if (rowInstruments.size() > 1 && !percussion) throw ScoreDraftService.invalidContent("rowInstruments");
            stored.add(new StoredRow(ids.get(index), truncate(parts.get(index).name()), rowInstruments));
        }
        return new ArrangementContent(
            document,
            MusicXmlDocuments.toCompressed(document),
            List.copyOf(stored),
            MusicXmlDocuments.concertScore(document),
            measureCount,
            json(stored)
        );
    }

    /** The rows stored with a draft or a version. */
    public List<StoredRow> rows(String json) {
        try {
            return List.of(objectMapper.readValue(json, StoredRow[].class));
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored rows of a score are not readable", exception);
        }
    }

    String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to serialize the rows of a score", exception);
        }
    }

    /** The instruments of the rows, each of them in use; every row has at least one. */
    private Map<Long, Instruments> instruments(List<ArrangementRowRequestDTO> rows) {
        Set<Long> ids = new HashSet<>();
        for (ArrangementRowRequestDTO row : rows) {
            if (row.instrumentIds() == null || row.instrumentIds().isEmpty() || row.instrumentIds().stream().anyMatch(Objects::isNull)) {
                throw ScoreDraftService.invalidContent("rowInstruments");
            }
            ids.addAll(row.instrumentIds());
        }
        Map<Long, Instruments> found = instrumentsRepository.findAllById(ids).stream()
            .filter(instrument -> !Boolean.TRUE.equals(instrument.getDeleted()))
            .collect(Collectors.toMap(Instruments::getId, Function.identity()));
        if (!found.keySet().containsAll(ids)) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Instrument not found", ENTITY, "scoreWriting.instrumentNotFound");
        }
        return found;
    }

    private static String truncate(String value) {
        if (value == null || value.isBlank()) return null;
        return value.length() <= 255 ? value : value.substring(0, 255);
    }
}
