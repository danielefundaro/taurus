package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragment;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentKind;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreFragmentRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreFragmentRepository.FragmentSummary;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.FragmentRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.FragmentUpdateDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.PercussionVoiceDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.ScoreFragmentDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.MusicXmlException;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.PartInfo;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector.ScoreChecks;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * The fragment library of the tenant: whole measures saved from the writing editor and inserted in other parts, which
 * receive a copy. A pitched fragment is saved in concert pitch and transposed in the browser at insertion; a percussion
 * fragment keeps the sound of each voice, so that it goes only into a part with the same sounds.
 */
@Service
@Transactional
public class ScoreFragmentService {

    static final String ENTITY = "ScoreFragment";
    /** Measures of a fragment at most. */
    public static final int MAX_MEASURES = 64;
    /** Plain MusicXML of a fragment at most, in bytes. */
    public static final int MAX_BYTES = 1024 * 1024;
    private static final int MAX_VOICE = 16;

    private final ScoreFragmentRepository repository;
    private final ObjectMapper objectMapper;
    private final ScoreWritingMetrics metrics;

    public ScoreFragmentService(ScoreFragmentRepository repository, ObjectMapper objectMapper, ScoreWritingMetrics metrics) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.metrics = metrics;
    }

    /** The fragments of the library, by name, without their content. */
    @Transactional(readOnly = true)
    public List<ScoreFragmentDTO> list() {
        return repository.findSummaries().stream().map(this::toDto).toList();
    }

    /**
     * The plain MusicXML of a fragment.
     *
     * @throws RequestAlertException {@code scoreWriting.fragmentNotFound}
     */
    @Transactional(readOnly = true)
    public byte[] content(Long id) {
        return MusicXmlDocuments.toXml(MusicXmlDocuments.read(require(id).getContent()));
    }

    /**
     * Saves a fragment with its checked content.
     *
     * @throws RequestAlertException {@code scoreWriting.fragmentNameExists} and {@code scoreWriting.fragmentInvalid}
     */
    public ScoreFragmentDTO create(FragmentRequestDTO request, AbstractAuthenticationToken token) {
        String name = request.name().strip();
        if (repository.existsByNameIgnoreCaseAndDeletedFalse(name)) throw nameExists();
        Content content = readContent(request.content(), request.kind(), request.percussionKeys());
        String actor = actor(token);
        ScoreFragment fragment = new ScoreFragment();
        fragment.initializeAudit(actor);
        fragment.setName(name);
        fragment.setCategory(request.category());
        fragment.setNote(note(request.note()));
        fragment.setKind(request.kind());
        fragment.setContent(content.compressed());
        fragment.setMeasureCount(content.measureCount());
        fragment.setPercussionKeysJson(request.kind() == ScoreFragmentKind.PERCUSSION ? json(content.percussionKeys()) : null);
        ScoreFragment saved = flush(fragment);
        metrics.fragmentSaved();
        return toDto(saved);
    }

    /**
     * Changes name, category and note of a fragment; its content does not change.
     *
     * @throws RequestAlertException {@code scoreWriting.fragmentNotFound}, {@code version.conflict} when the fragment
     *                               changed since the library read it, {@code scoreWriting.fragmentNameExists}
     */
    public ScoreFragmentDTO update(Long id, FragmentUpdateDTO request, AbstractAuthenticationToken token) {
        ScoreFragment fragment = require(id);
        if (!Objects.equals(request.entityVersion(), fragment.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Fragment changed since it was read", ENTITY, "version.conflict");
        }
        String name = request.name().strip();
        if (repository.existsByNameIgnoreCaseAndDeletedFalseAndIdNot(name, id)) throw nameExists();
        fragment.setName(name);
        fragment.setCategory(request.category());
        fragment.setNote(note(request.note()));
        fragment.touchAudit(actor(token));
        return toDto(flush(fragment));
    }

    /**
     * Removes a fragment logically: the parts where it was inserted keep their copy.
     *
     * @throws RequestAlertException {@code scoreWriting.fragmentNotFound}
     */
    public void delete(Long id, AbstractAuthenticationToken token) {
        ScoreFragment fragment = require(id);
        fragment.setDeleted(true);
        fragment.touchAudit(actor(token));
        repository.saveAndFlush(fragment);
    }

    /**
     * Checks and compresses the content of a fragment: a single part of at most {@link #MAX_MEASURES} complete measures,
     * without pickup measures, tempo or jumps, with notes of the kind of the fragment and, for percussion, a sound for
     * each voice with notes.
     *
     * @throws RequestAlertException {@code scoreWriting.fragmentInvalid}
     */
    Content readContent(String text, ScoreFragmentKind kind, List<PercussionVoiceDTO> percussionKeys) {
        if (text == null || text.isBlank()) throw invalid("malformed");
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw invalid("tooLarge");
        Document single;
        PartInfo part;
        try {
            Document document = MusicXmlDocuments.read(bytes);
            List<PartInfo> parts = MusicXmlDocuments.parts(document);
            if (parts.size() > 1 || MusicXmlDocuments.partElementIds(document).size() > 1) throw invalid("severalParts");
            if (parts.isEmpty()) throw invalid("malformed");
            part = parts.get(0);
            single = MusicXmlDocuments.singlePart(document, part.id());
        } catch (MusicXmlException exception) {
            throw invalid("malformed");
        }
        if (part.measureCount() == 0) throw invalid("malformed");
        if (part.measureCount() > MAX_MEASURES) throw invalid("tooManyMeasures").with("maxMeasures", MAX_MEASURES);
        ScoreChecks checks = MusicXmlInspector.inspect(single);
        if (checks.wrongDurationCount() > 0 || checks.emptyMeasures() > 0) throw invalid("malformed");
        if (checks.tempo() || checks.segni() + checks.codas() + checks.daCapo() + checks.dalSegno() + checks.fine() > 0 || hasPickup(single)) {
            throw invalid("structure");
        }
        Notes notes = notes(single);
        if (notes.pitched() + notes.unpitchedVoices().size() == 0) throw invalid("empty");
        List<PercussionVoiceDTO> keys = kind == ScoreFragmentKind.PERCUSSION ? percussionKeys(notes, percussionKeys) : List.of();
        if (kind == ScoreFragmentKind.PITCHED && (!notes.unpitchedVoices().isEmpty() || (percussionKeys != null && !percussionKeys.isEmpty()))) {
            throw invalid("percussionSounds");
        }
        return new Content(MusicXmlDocuments.toCompressed(single), part.measureCount(), keys);
    }

    /** The checked content of a fragment. */
    record Content(byte[] compressed, int measureCount, List<PercussionVoiceDTO> percussionKeys) {}

    /** Pitched notes and the voices with unpitched notes of the content. */
    private record Notes(int pitched, Set<Integer> unpitchedVoices) {}

    /** One sound for each voice with notes, between 0 and 127, and no pitched notes. */
    private static List<PercussionVoiceDTO> percussionKeys(Notes notes, List<PercussionVoiceDTO> keys) {
        if (notes.pitched() > 0 || keys == null || keys.isEmpty()) throw invalid("percussionSounds");
        Set<Integer> voices = new HashSet<>();
        for (PercussionVoiceDTO key : keys) {
            if (key == null || key.voice() < 1 || key.voice() > MAX_VOICE || key.key() < 0 || key.key() > 127 || !voices.add(key.voice())) {
                throw invalid("percussionSounds");
            }
        }
        if (!voices.equals(notes.unpitchedVoices())) throw invalid("percussionSounds");
        return keys.stream().sorted(Comparator.comparingInt(PercussionVoiceDTO::voice)).toList();
    }

    private static Notes notes(Document document) {
        int pitched = 0;
        Set<Integer> unpitchedVoices = new TreeSet<>();
        NodeList elements = document.getElementsByTagName("note");
        for (int index = 0; index < elements.getLength(); index++) {
            Element note = (Element) elements.item(index);
            if (note.getElementsByTagName("pitch").getLength() > 0) pitched++;
            if (note.getElementsByTagName("unpitched").getLength() > 0) unpitchedVoices.add(voice(note));
        }
        return new Notes(pitched, unpitchedVoices);
    }

    /** Voice of the note, 1 when it has none or it is not a number. */
    private static int voice(Element note) {
        NodeList voices = note.getElementsByTagName("voice");
        if (voices.getLength() == 0) return 1;
        try {
            return Integer.parseInt(voices.item(0).getTextContent().strip());
        } catch (NumberFormatException exception) {
            return 1;
        }
    }

    private static boolean hasPickup(Document document) {
        NodeList measures = document.getElementsByTagName("measure");
        for (int index = 0; index < measures.getLength(); index++) {
            if ("yes".equals(((Element) measures.item(index)).getAttribute("implicit"))) return true;
        }
        return false;
    }

    private ScoreFragment require(Long id) {
        return repository.findByIdAndDeletedFalse(id).orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Fragment not found", ENTITY, "scoreWriting.fragmentNotFound"));
    }

    /** Saves the fragment; two fragments with the same name saved at the same time meet the unique index. */
    private ScoreFragment flush(ScoreFragment fragment) {
        try {
            return repository.saveAndFlush(fragment);
        } catch (DataIntegrityViolationException exception) {
            throw nameExists();
        }
    }

    private ScoreFragmentDTO toDto(FragmentSummary fragment) {
        return new ScoreFragmentDTO(
            fragment.id(),
            fragment.name(),
            fragment.category(),
            fragment.note(),
            fragment.kind(),
            fragment.measureCount(),
            readKeys(fragment.percussionKeysJson()),
            fragment.entityVersion()
        );
    }

    private ScoreFragmentDTO toDto(ScoreFragment fragment) {
        return new ScoreFragmentDTO(
            fragment.getId(),
            fragment.getName(),
            fragment.getCategory(),
            fragment.getNote(),
            fragment.getKind(),
            fragment.getMeasureCount(),
            readKeys(fragment.getPercussionKeysJson()),
            fragment.getEntityVersion()
        );
    }

    private List<PercussionVoiceDTO> readKeys(String json) {
        if (json == null) return List.of();
        try {
            return new ArrayList<>(List.of(objectMapper.readValue(json, PercussionVoiceDTO[].class)));
        } catch (JacksonException exception) {
            return List.of();
        }
    }

    private String json(List<PercussionVoiceDTO> keys) {
        try {
            return objectMapper.writeValueAsString(keys);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to write the sounds of a fragment", exception);
        }
    }

    private static String note(String note) {
        if (note == null) return null;
        String stripped = note.strip();
        return stripped.isEmpty() ? null : stripped;
    }

    private static RequestAlertException nameExists() {
        return new RequestAlertException(HttpStatus.CONFLICT, "Another fragment has the name", ENTITY, "scoreWriting.fragmentNameExists");
    }

    private static RequestAlertException invalid(String reason) {
        return new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid fragment", ENTITY, "scoreWriting.fragmentInvalid").with("reason", reason);
    }

    private static String actor(AbstractAuthenticationToken token) {
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        return actor == null || actor.isBlank() ? "system" : actor;
    }
}
