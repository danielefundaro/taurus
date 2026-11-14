package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingFormat;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingHeaderDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EngravingOptionsDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.MeasureNumbers;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrClient;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class ScoreEngravingServiceTest {

    @Test
    void keepsTheOptionsWithinTheirRangesAndLeavesOutTheEmptyTexts() {
        EngravingOptionsDTO options = new EngravingOptionsDTO(
            EngravingFormat.A4_LANDSCAPE,
            ScoreEngravingService.MIN_STAFF_SIZE,
            ScoreEngravingService.MAX_MARGIN,
            new EngravingHeaderDTO(" Inno ", "", "  ", "x".repeat(ScoreEngravingService.MAX_HEADER_LENGTH)),
            false,
            MeasureNumbers.NONE
        );

        EngravingOptionsDTO normalized = ScoreEngravingService.normalize(options);

        assertThat(normalized.format()).isEqualTo(EngravingFormat.A4_LANDSCAPE);
        assertThat(normalized.staffSize()).isEqualTo(4.0);
        assertThat(normalized.margin()).isEqualTo(30.0);
        assertThat(normalized.header()).isEqualTo(new EngravingHeaderDTO("Inno", null, null, "x".repeat(200)));
        assertThat(normalized.pageNumbers()).isFalse();
        assertThat(normalized.measureNumbers()).isEqualTo(MeasureNumbers.NONE);
        assertThat(ScoreEngravingService.normalize(null)).isEqualTo(new EngravingOptionsDTO(null, null, null, null, null, null));
        assertThat(ScoreEngravingService.normalize(new EngravingOptionsDTO(null, null, null, null, null, null)).header()).isNull();
    }

    @Test
    void namesTheOptionOutOfRange() {
        assertInvalid(new EngravingOptionsDTO(null, 3.9, null, null, null, null), "staffSize");
        assertInvalid(new EngravingOptionsDTO(null, 9.7, null, null, null, null), "staffSize");
        assertInvalid(new EngravingOptionsDTO(null, Double.NaN, null, null, null, null), "staffSize");
        assertInvalid(new EngravingOptionsDTO(null, null, 30.5, null, null, null), "margin");
        assertInvalid(new EngravingOptionsDTO(null, null, Double.NaN, null, null, null), "margin");
        String tooLong = "y".repeat(ScoreEngravingService.MAX_HEADER_LENGTH + 1);
        assertInvalid(new EngravingOptionsDTO(null, null, null, new EngravingHeaderDTO(null, tooLong, null, null), null, null), "header.composer");
        assertInvalid(new EngravingOptionsDTO(null, null, null, new EngravingHeaderDTO(null, null, tooLong, null), null, null), "header.arranger");
        assertInvalid(new EngravingOptionsDTO(null, null, null, new EngravingHeaderDTO(null, null, null, tooLong), null, null), "header.partName");
    }

    @Test
    void refusesTheEngravingWithoutTheMusicService() {
        OmrClient omrClient = mock(OmrClient.class);
        when(omrClient.isConfigured()).thenReturn(false);
        ScoreEngravingQueue queue = mock(ScoreEngravingQueue.class);
        ScoreEngravingService service = new ScoreEngravingService(null, null, null, null, null, null, null, queue, null, omrClient, null, null);

        assertThatThrownBy(() -> service.start(1L, 2L, 3L, null, null)).isInstanceOfSatisfying(RequestAlertException.class, error -> {
            assertThat(error.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(error.getErrorKey()).isEqualTo("scoreWriting.engravingUnavailable");
        });
        verifyNoMoreInteractions(queue);
    }

    @Test
    void namesTheEngravedFilesAfterThePart() {
        assertThat(ScoreEngravingFiles.pageName("Clarinetto 1° in Si♭", 3)).isEqualTo("clarinetto-1-in-si-pagina-3.png");
        assertThat(ScoreEngravingFiles.pdfName("  Saxofono contralto (Mi♭)  ")).isEqualTo("saxofono-contralto-mi.pdf");
        assertThat(ScoreEngravingFiles.pdfName(null)).isEqualTo("parte.pdf");
        assertThat(ScoreEngravingFiles.pageName("♭♯", 1)).isEqualTo("parte-pagina-1.png");
        assertThat(ScoreEngravingFiles.pdfName("a ".repeat(40))).isEqualTo("a-".repeat(29) + "a.pdf");
    }

    private static void assertInvalid(EngravingOptionsDTO options, String field) {
        assertThatThrownBy(() -> ScoreEngravingService.normalize(options)).isInstanceOfSatisfying(RequestAlertException.class, error -> {
            assertThat(error.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(error.getErrorKey()).isEqualTo("scoreWriting.engravingOptionsInvalid");
            assertThat(error.getArgs().values()).containsEntry("field", field);
        });
    }
}
