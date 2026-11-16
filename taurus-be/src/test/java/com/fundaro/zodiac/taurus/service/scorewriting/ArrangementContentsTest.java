package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowRequestDTO;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementContents.ArrangementContent;
import com.fundaro.zodiac.taurus.service.scorewriting.ArrangementContents.StoredRow;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.ObjectMapper;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ArrangementContentsTest {

    private final InstrumentsRepository instrumentsRepository = mock(InstrumentsRepository.class);
    private final ApplicationProperties properties = new ApplicationProperties();
    private final ArrangementContents contents = new ArrangementContents(properties, instrumentsRepository, new ObjectMapper());

    @BeforeEach
    void setUp() {
        when(instrumentsRepository.findAllById(anyIterable())).thenReturn(List.of(
            instrument(1L, null, false),
            instrument(2L, null, false),
            instrument(3L, 38, false),
            instrument(4L, 36, false),
            instrument(5L, null, true)
        ));
    }

    @Test
    void readsTheRowsOfAScoreWithTheirInstrumentsAndItsNotation() {
        ArrangementContent content = contents.read(score(true, part("P1", "Basso", 2), part("P2", "  ", 2)), List.of(row("P1", 1L, 1L), row("P2", 3L, 4L)));

        assertThat(content.rows()).containsExactly(new StoredRow("P1", "Basso", List.of(1L)), new StoredRow("P2", null, List.of(3L, 4L)));
        assertThat(content.concertPitch()).isTrue();
        assertThat(content.measureCount()).isEqualTo(2);
        assertThat(content.compressed()).isNotEmpty();
        assertThat(contents.rows(content.rowsJson())).isEqualTo(content.rows());
        assertThat(content.stored().rowsJson()).isEqualTo(content.rowsJson());
        assertThat(contents.read(score(false, part("P1", "x".repeat(300), 1)), List.of(row("P1", 2L))).rows().get(0).name()).hasSize(255);
        assertThat(contents.read(score(false, part("P1", "Flauto", 1)), List.of(row("P1", 2L))).concertPitch()).isFalse();
    }

    @Test
    void refusesContentsThatAreNotScoresWithinTheLimits() {
        assertInvalid(() -> contents.read(" ", List.of()), "empty");
        assertInvalid(() -> contents.read(null, List.of()), "empty");
        assertInvalid(() -> contents.read("<score-timewise/>", List.of()), "timewise");
        assertInvalid(() -> contents.read("<score-partwise version=\"4.0\"><part-list/></score-partwise>", List.of()), "noParts");

        properties.getScoreWriting().setMaxArrangementRows(1);
        assertInvalid(() -> contents.read(score(false, part("P1", "A", 1), part("P2", "B", 1)), List.of(row("P1", 1L), row("P2", 2L))), "tooManyRows");
        properties.getScoreWriting().setMaxArrangementBytes(1024 * 1024);
        assertThatThrownBy(() -> contents.read("<a>" + "x".repeat(1024 * 1024) + "</a>", List.of()))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scorePlayback.upload.tooLarge");
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONTENT_TOO_LARGE);
                assertThat(error.getArgs().values()).containsEntry("maxMegabytes", 1);
            });
    }

    @Test
    void refusesRowsThatAreNotThePartsOfTheScore() {
        String twoParts = score(false, part("P1", "A", 1), part("P2", "B", 1));
        assertInvalid(() -> contents.read(twoParts, null), "rowsMismatch");
        assertInvalid(() -> contents.read(twoParts, List.of(row("P1", 1L))), "rowsMismatch");
        assertInvalid(() -> contents.read(twoParts, List.of(row("P2", 1L), row("P1", 2L))), "rowsMismatch");
        assertInvalid(() -> contents.read(twoParts, Arrays.asList(row("P1", 1L), null)), "rowsMismatch");
        assertInvalid(() -> contents.read(score(false, part("1st", "A", 1)), List.of(row("1st", 1L))), "rowsMismatch");
        assertInvalid(() -> contents.read(score(false, part("P1", "A", 1), part("P1", "B", 1)), List.of(row("P1", 1L), row("P1", 2L))), "rowsMismatch");
        // A part missing from the part list.
        String unlisted = "<score-partwise version=\"4.0\"><part-list><score-part id=\"P1\"><part-name>A</part-name></score-part></part-list>"
            + "<part id=\"P1\"><measure number=\"1\"/></part><part id=\"P2\"><measure number=\"1\"/></part></score-partwise>";
        assertInvalid(() -> contents.read(unlisted, List.of(row("P1", 1L))), "rowsMismatch");

        assertInvalid(() -> contents.read(score(false, part("P1", "A", 1), part("P2", "B", 2)), List.of(row("P1", 1L), row("P2", 2L))), "unevenMeasures");
    }

    @Test
    void aRowHasOneInstrumentOrSeveralPercussionInstrumentsInUse() {
        String single = score(false, part("P1", "A", 1));
        assertInvalid(() -> contents.read(single, List.of(new ArrangementRowRequestDTO("P1", null, null))), "rowInstruments");
        assertInvalid(() -> contents.read(single, List.of(row("P1"))), "rowInstruments");
        assertInvalid(() -> contents.read(single, List.of(new ArrangementRowRequestDTO("P1", Arrays.asList(1L, null), null))), "rowInstruments");
        assertInvalid(() -> contents.read(single, List.of(row("P1", 1L, 2L))), "rowInstruments");
        assertInvalid(() -> contents.read(single, List.of(row("P1", 3L, 1L))), "rowInstruments");
        assertThat(contents.read(single, List.of(row("P1", 1L, 1L))).rows().get(0).instrumentIds()).containsExactly(1L);

        for (Long missing : List.of(5L, 6L)) {
            assertThatThrownBy(() -> contents.read(single, List.of(row("P1", missing))))
                .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.instrumentNotFound"));
        }
    }

    @Test
    void storedRowsThatCannotBeReadAreAnError() {
        assertThatThrownBy(() -> contents.rows("not json")).isInstanceOf(IllegalStateException.class);
    }

    private static void assertInvalid(ThrowingCallable action, String reason) {
        assertThatThrownBy(action).isInstanceOfSatisfying(RequestAlertException.class, error -> {
            assertThat(error.getErrorKey()).isEqualTo("scoreWriting.contentInvalid");
            assertThat(error.getArgs().values()).containsEntry("reason", reason);
        });
    }

    private static ArrangementRowRequestDTO row(String id, Long... instrumentIds) {
        return new ArrangementRowRequestDTO(id, List.of(instrumentIds), null);
    }

    private static String score(boolean concertPitch, String... parts) {
        StringBuilder list = new StringBuilder();
        StringBuilder body = new StringBuilder();
        for (String part : parts) {
            String[] fields = part.split("\\|", -1);
            list.append("<score-part id=\"").append(fields[0]).append("\"><part-name>").append(fields[1]).append("</part-name></score-part>");
            body.append("<part id=\"").append(fields[0]).append("\">");
            for (int number = 1; number <= Integer.parseInt(fields[2]); number++) body.append("<measure number=\"").append(number).append("\"/>");
            body.append("</part>");
        }
        return "<score-partwise version=\"4.0\">" + (concertPitch ? "<defaults><concert-score/></defaults>" : "") + "<part-list>" + list + "</part-list>"
            + body + "</score-partwise>";
    }

    private static String part(String id, String name, int measures) {
        return id + "|" + name + "|" + measures;
    }

    private static Instruments instrument(Long id, Integer percussionKey, boolean deleted) {
        Instruments instrument = new Instruments();
        instrument.setId(id);
        instrument.setPercussionKey(percussionKey);
        instrument.setDeleted(deleted);
        return instrument;
    }
}
