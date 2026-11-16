package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragment;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentCategory;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentKind;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreFragmentRepository;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.FragmentRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.PercussionVoiceDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.ScoreFragmentDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The checks of the content of a fragment, before anything reaches the database. */
class ScoreFragmentServiceTest {

    private static final String PITCHED_NOTE = "<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>";
    private static final String REST = "<note><rest measure=\"yes\"/><duration>4</duration><voice>1</voice></note>";

    private static final JwtAuthenticationToken TOKEN = new JwtAuthenticationToken(Jwt.withTokenValue("token").header("alg", "none").claim("sub", "mario").build());

    private final ScoreFragmentRepository repository = mock(ScoreFragmentRepository.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final ScoreFragmentService service = new ScoreFragmentService(repository, new ObjectMapper(), new ScoreWritingMetrics(registry));

    @Test
    void savesAPitchedFragmentCompressedAndCountsIt() {
        when(repository.saveAndFlush(any(ScoreFragment.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ScoreFragmentDTO saved = service.create(
            new FragmentRequestDTO("  Squilli d'attenti  ", ScoreFragmentCategory.SIGNAL, "  ", ScoreFragmentKind.PITCHED, score(measures(2, PITCHED_NOTE)), null),
            TOKEN
        );

        assertThat(saved.name()).isEqualTo("Squilli d'attenti");
        assertThat(saved.note()).isNull();
        assertThat(saved.measureCount()).isEqualTo(2);
        assertThat(saved.percussionKeys()).isEmpty();
        assertThat(registry.counter("taurus.score.fragments.saves").count()).isEqualTo(1);
    }

    @Test
    void keepsTheSoundOfEachVoiceOfAPercussionFragment() {
        ScoreFragmentService.Content content = service.readContent(
            score(measures(1, drum(2) + "<backup><duration>4</duration></backup>" + drum(1))),
            ScoreFragmentKind.PERCUSSION,
            List.of(new PercussionVoiceDTO(2, 38), new PercussionVoiceDTO(1, 36))
        );

        assertThat(content.measureCount()).isEqualTo(1);
        assertThat(content.percussionKeys()).containsExactly(new PercussionVoiceDTO(1, 36), new PercussionVoiceDTO(2, 38));
        assertThat(MusicXmlDocuments.read(content.compressed()).getElementsByTagName("unpitched").getLength()).isEqualTo(2);
    }

    @Test
    void refusesContentsThatAreNotOneReadablePart() {
        assertReason(null, ScoreFragmentKind.PITCHED, null, "malformed");
        assertReason("<score-partwise", ScoreFragmentKind.PITCHED, null, "malformed");
        assertReason("<score-partwise version=\"4.0\"><part-list/></score-partwise>", ScoreFragmentKind.PITCHED, null, "malformed");
        assertReason(
            """
            <score-partwise version="4.0">
              <part-list><score-part id="P1"><part-name>A</part-name></score-part><score-part id="P2"><part-name>B</part-name></score-part></part-list>
              <part id="P1">%s</part><part id="P2">%s</part>
            </score-partwise>
            """.formatted(measures(1, PITCHED_NOTE), measures(1, PITCHED_NOTE)),
            ScoreFragmentKind.PITCHED,
            null,
            "severalParts"
        );
    }

    @Test
    void refusesTooManyMeasuresAndTooLargeContents() {
        assertThatThrownBy(() -> service.readContent(score(measures(65, PITCHED_NOTE)), ScoreFragmentKind.PITCHED, null))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getArgs().values()).containsEntry("reason", "tooManyMeasures").containsEntry("maxMeasures", 64);
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
            });
        String large = score(measures(1, PITCHED_NOTE)).replace("<part-name>Frammento</part-name>", "<part-name>" + "x".repeat(ScoreFragmentService.MAX_BYTES) + "</part-name>");
        assertThat(large.getBytes(StandardCharsets.UTF_8).length).isGreaterThan(ScoreFragmentService.MAX_BYTES);
        assertReason(large, ScoreFragmentKind.PITCHED, null, "tooLarge");
    }

    @Test
    void refusesIncompleteMeasuresStructureAndMeasuresOfRests() {
        String half = "<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>";
        assertReason(score(measures(1, half)), ScoreFragmentKind.PITCHED, null, "malformed");
        assertReason(score("<measure number=\"1\">" + ATTRIBUTES + "</measure>"), ScoreFragmentKind.PITCHED, null, "malformed");
        String tempo = "<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo=\"120\"/></direction>";
        assertReason(score(measures(1, tempo + PITCHED_NOTE)), ScoreFragmentKind.PITCHED, null, "structure");
        assertReason(score(measures(1, PITCHED_NOTE + "<barline location=\"right\"><bar-style>light-heavy</bar-style></barline><sound dacapo=\"yes\"/>")), ScoreFragmentKind.PITCHED, null, "structure");
        assertReason(score(measures(1, PITCHED_NOTE).replace("<measure number=\"1\">", "<measure number=\"0\" implicit=\"yes\">")), ScoreFragmentKind.PITCHED, null, "structure");
        assertReason(score(measures(2, REST)), ScoreFragmentKind.PITCHED, null, "empty");
    }

    @Test
    void refusesNotesAndSoundsThatDoNotMatchTheKind() {
        String drums = score(measures(1, drum(1)));
        assertReason(drums, ScoreFragmentKind.PITCHED, null, "percussionSounds");
        assertReason(score(measures(1, PITCHED_NOTE)), ScoreFragmentKind.PITCHED, List.of(new PercussionVoiceDTO(1, 38)), "percussionSounds");
        assertReason(score(measures(1, PITCHED_NOTE)), ScoreFragmentKind.PERCUSSION, List.of(new PercussionVoiceDTO(1, 38)), "percussionSounds");
        assertReason(drums, ScoreFragmentKind.PERCUSSION, null, "percussionSounds");
        assertReason(drums, ScoreFragmentKind.PERCUSSION, List.of(new PercussionVoiceDTO(2, 38)), "percussionSounds");
        assertReason(drums, ScoreFragmentKind.PERCUSSION, List.of(new PercussionVoiceDTO(1, 38), new PercussionVoiceDTO(2, 36)), "percussionSounds");
        assertReason(drums, ScoreFragmentKind.PERCUSSION, List.of(new PercussionVoiceDTO(1, 38), new PercussionVoiceDTO(1, 36)), "percussionSounds");
        assertReason(drums, ScoreFragmentKind.PERCUSSION, List.of(new PercussionVoiceDTO(1, 128)), "percussionSounds");
    }

    @Test
    void refusesARepeatedNameAndAMissingFragment() {
        when(repository.existsByNameIgnoreCaseAndDeletedFalse("Rullo")).thenReturn(true);
        assertThatThrownBy(() -> service.create(new FragmentRequestDTO(" Rullo ", ScoreFragmentCategory.ROLL, null, ScoreFragmentKind.PITCHED, score(measures(1, PITCHED_NOTE)), null), TOKEN))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentNameExists"));

        when(repository.saveAndFlush(any(ScoreFragment.class))).thenThrow(new DataIntegrityViolationException("uq_score_fragment_name"));
        assertThatThrownBy(() -> service.create(new FragmentRequestDTO("Rullo lungo", ScoreFragmentCategory.ROLL, null, ScoreFragmentKind.PITCHED, score(measures(1, PITCHED_NOTE)), null), TOKEN))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentNameExists"));

        when(repository.findByIdAndDeletedFalse(9L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.content(9L))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentNotFound");
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
            });
    }

    private void assertReason(String content, ScoreFragmentKind kind, List<PercussionVoiceDTO> keys, String reason) {
        assertThatThrownBy(() -> service.readContent(content, kind, keys))
            .as(reason)
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentInvalid");
                assertThat(error.getArgs().values()).containsEntry("reason", reason);
            });
    }

    private static final String ATTRIBUTES = "<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>";

    private static String drum(int voice) {
        return "<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>4</duration><voice>" + voice + "</voice><type>whole</type></note>";
    }

    private static String measures(int count, String content) {
        StringBuilder result = new StringBuilder();
        for (int index = 1; index <= count; index++) {
            result.append("<measure number=\"").append(index).append("\">").append(index == 1 ? ATTRIBUTES : "").append(content).append("</measure>");
        }
        return result.toString();
    }

    private static String score(String measures) {
        return """
            <?xml version="1.0" encoding="UTF-8"?>
            <score-partwise version="4.0">
              <part-list><score-part id="P1"><part-name>Frammento</part-name></score-part></part-list>
              <part id="P1">%s</part>
            </score-partwise>
            """.formatted(measures);
    }
}
