package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DerivedPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.NewWrittenPartDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.WrittenPartDTO;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScoreDerivationServiceTest {

    private static final Long TRACK_ID = 7L;
    private static final Long SOURCE_ID = 11L;
    private static final Long VERSION_ID = 30L;
    private static final Long CLARINET = 3L;
    private static final Long ALTO_SAX = 4L;
    private static final Long DRUM = 5L;
    private static final String CONTENT = "<score-partwise version=\"4.0\"/>";

    private final TracksRepository tracksRepository = mock(TracksRepository.class);
    private final ScoreVersionRepository versionRepository = mock(ScoreVersionRepository.class);
    private final InstrumentsRepository instrumentsRepository = mock(InstrumentsRepository.class);
    private final WrittenPartService writtenPartService = mock(WrittenPartService.class);
    private final ScoreDerivationService service = new ScoreDerivationService(tracksRepository, versionRepository, instrumentsRepository, writtenPartService);
    private final JwtAuthenticationToken token = token();
    private final Tracks track = new Tracks();
    private final SheetsMusic source = part(SOURCE_ID);

    @BeforeEach
    void track() {
        track.setId(TRACK_ID);
        track.getScores().add(source);
        source.getInstruments().add(instrument(CLARINET, null));
        when(tracksRepository.findByIdForUpdate(TRACK_ID)).thenReturn(Optional.of(track));
        when(versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(VERSION_ID, SOURCE_ID)).thenReturn(Optional.of(new ScoreVersion()));
        when(instrumentsRepository.findById(ALTO_SAX)).thenReturn(Optional.of(instrument(ALTO_SAX, null)));
        when(instrumentsRepository.findById(DRUM)).thenReturn(Optional.of(instrument(DRUM, 38)));
    }

    @Test
    void addsThePartForTheInstrumentAndRemembersTheVersionItComesFrom() {
        SheetsMusic created = part(12L);
        when(writtenPartService.create(eq(TRACK_ID), any(), eq(token))).thenAnswer(invocation -> {
            track.getScores().add(created);
            return new WrittenPartDTO(12L, 5L);
        });

        WrittenPartDTO result = service.derive(TRACK_ID, SOURCE_ID, request(ALTO_SAX), token);

        assertThat(result).isEqualTo(new WrittenPartDTO(12L, 5L));
        verify(writtenPartService).create(TRACK_ID, new NewWrittenPartDTO("Sax contralto", List.of(ALTO_SAX), CONTENT, 4L), token);
        assertThat(created.getDerivedFromVersionId()).isEqualTo(VERSION_ID);
        assertThat(source.getDerivedFromVersionId()).isNull();
    }

    @Test
    void refusesPartsAndVersionsItCannotFind() {
        assertThat(errorKey(() -> service.derive(8L, SOURCE_ID, request(ALTO_SAX), token))).isEqualTo("scorePlayback.track.notFound");
        assertThat(errorKey(() -> service.derive(TRACK_ID, 99L, request(ALTO_SAX), token))).isEqualTo("scorePlayback.part.notFound");
        assertThat(errorKey(() -> service.derive(TRACK_ID, SOURCE_ID, new DerivedPartDTO(31L, ALTO_SAX, null, CONTENT, null), token)))
            .isEqualTo("scorePlayback.version.notFound");
        assertThat(errorKey(() -> service.derive(TRACK_ID, SOURCE_ID, new DerivedPartDTO(null, ALTO_SAX, null, CONTENT, null), token)))
            .isEqualTo("scorePlayback.version.notFound");
        assertThatThrownBy(() -> service.derive(TRACK_ID, SOURCE_ID, null, token)).isInstanceOf(RequestAlertException.class);
        verify(writtenPartService, never()).create(anyLong(), any(), any());
    }

    @Test
    void derivesOnlyPitchedPartsOfOneInstrumentForAPitchedInstrument() {
        assertThat(reason(() -> service.derive(TRACK_ID, SOURCE_ID, request(DRUM), token))).isEqualTo("targetPercussion");
        assertThat(errorKey(() -> service.derive(TRACK_ID, SOURCE_ID, request(77L), token))).isEqualTo("scoreWriting.instrumentNotFound");
        assertThat(errorKey(() -> service.derive(TRACK_ID, SOURCE_ID, request(null), token))).isEqualTo("scoreWriting.instrumentNotFound");
        Instruments deleted = instrument(6L, null);
        deleted.setDeleted(true);
        when(instrumentsRepository.findById(6L)).thenReturn(Optional.of(deleted));
        assertThat(errorKey(() -> service.derive(TRACK_ID, SOURCE_ID, request(6L), token))).isEqualTo("scoreWriting.instrumentNotFound");

        source.getInstruments().add(instrument(ALTO_SAX, null));
        assertThat(reason(() -> service.derive(TRACK_ID, SOURCE_ID, request(ALTO_SAX), token))).isEqualTo("notSingleInstrument");
        source.getInstruments().clear();
        assertThat(reason(() -> service.derive(TRACK_ID, SOURCE_ID, request(ALTO_SAX), token))).isEqualTo("notSingleInstrument");
        source.getInstruments().add(instrument(DRUM, 38));
        assertThat(reason(() -> service.derive(TRACK_ID, SOURCE_ID, request(ALTO_SAX), token))).isEqualTo("percussion");
        verify(writtenPartService, never()).create(anyLong(), any(), any());
    }

    private static DerivedPartDTO request(Long instrumentId) {
        return new DerivedPartDTO(VERSION_ID, instrumentId, "Sax contralto", CONTENT, 4L);
    }

    private static String errorKey(Runnable action) {
        try {
            action.run();
        } catch (RequestAlertException error) {
            return error.getErrorKey();
        }
        throw new AssertionError("No error");
    }

    private static String reason(Runnable action) {
        try {
            action.run();
        } catch (RequestAlertException error) {
            assertThat(error.getErrorKey()).isEqualTo("scoreWriting.derivationUnavailable");
            assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
            return String.valueOf(error.getArgs().values().get("reason"));
        }
        throw new AssertionError("No error");
    }

    private static SheetsMusic part(Long id) {
        SheetsMusic part = new SheetsMusic();
        part.setId(id);
        return part;
    }

    private static Instruments instrument(Long id, Integer percussionKey) {
        Instruments instrument = new Instruments();
        instrument.setId(id);
        instrument.setDeleted(false);
        instrument.setPercussionKey(percussionKey);
        return instrument;
    }

    private static JwtAuthenticationToken token() {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("mario").issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt);
    }
}
