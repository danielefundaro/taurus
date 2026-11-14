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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WrittenPartServiceTest {

    private static final Long TRACK_ID = 7L;
    private static final String CONTENT = "<score-partwise version=\"4.0\"/>";

    private final TracksRepository tracksRepository = mock(TracksRepository.class);
    private final TracksService tracksService = mock(TracksService.class);
    private final InstrumentsRepository instrumentsRepository = mock(InstrumentsRepository.class);
    private final ScoreDraftService draftService = mock(ScoreDraftService.class);
    private final WrittenPartService service = new WrittenPartService(tracksRepository, tracksService, instrumentsRepository, draftService);
    private final Content content = new Content(null, new byte[] { 1 }, null);
    private final JwtAuthenticationToken token = token();

    @BeforeEach
    void track() {
        Tracks track = new Tracks();
        track.setId(TRACK_ID);
        track.setEntityVersion(4L);
        when(tracksRepository.findByIdForUpdate(TRACK_ID)).thenReturn(Optional.of(track));
        when(draftService.readContent(CONTENT)).thenReturn(content);
        when(instrumentsRepository.findAllById(anyList())).thenAnswer(invocation -> {
            List<Long> ids = invocation.getArgument(0);
            return ids.stream().filter(id -> id > 0).map(id -> instrument(id, id == 99L)).toList();
        });
    }

    @Test
    void addsThePartAtTheEndOfTheTrackAndStartsItsDraft() {
        when(tracksService.appendScores(eq(TRACK_ID), anyList(), eq(token))).thenReturn(saved(part(1L, 1L), part(12L, 2L)));

        WrittenPartDTO created = service.create(TRACK_ID, new NewWrittenPartDTO("  Tromba 2ª ", List.of(3L, 2L, 3L), CONTENT, 4L), token);

        assertThat(created).isEqualTo(new WrittenPartDTO(12L, 5L));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SheetsMusicDTO>> parts = ArgumentCaptor.forClass(List.class);
        verify(tracksService).appendScores(eq(TRACK_ID), parts.capture(), eq(token));
        SheetsMusicDTO part = parts.getValue().getFirst();
        assertThat(part.getId()).isNull();
        assertThat(part.getDescription()).isEqualTo("Tromba 2ª");
        assertThat(part.getMedia()).isNull();
        assertThat(part.getInstruments()).extracting(ChildrenEntitiesDTO::getIndex, ChildrenEntitiesDTO::getOrder)
            .containsExactly(org.assertj.core.groups.Tuple.tuple(3L, 1L), org.assertj.core.groups.Tuple.tuple(2L, 2L));
        verify(draftService).start(12L, content, token);
    }

    @Test
    void aPartWithoutDescriptionOrInstrumentsCanBeWritten() {
        when(tracksService.appendScores(eq(TRACK_ID), anyList(), eq(token))).thenReturn(saved(part(5L, null)));

        WrittenPartDTO created = service.create(TRACK_ID, new NewWrittenPartDTO(" ", null, CONTENT, null), token);

        assertThat(created.scoreId()).isEqualTo(5L);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SheetsMusicDTO>> parts = ArgumentCaptor.forClass(List.class);
        verify(tracksService).appendScores(eq(TRACK_ID), parts.capture(), eq(token));
        assertThat(parts.getValue().getFirst().getDescription()).isNull();
        assertThat(parts.getValue().getFirst().getInstruments()).isEmpty();
        verify(instrumentsRepository, never()).findAllById(anyList());
    }

    @Test
    void refusesAChangedTrackMissingInstrumentsAndInvalidContent() {
        assertThatThrownBy(() -> service.create(TRACK_ID, new NewWrittenPartDTO(null, List.of(), CONTENT, 3L), token))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("version.conflict");
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            });
        assertThatThrownBy(() -> service.create(TRACK_ID, new NewWrittenPartDTO(null, List.of(2L, -1L), CONTENT, 4L), token))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scoreWriting.instrumentNotFound");
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            });
        assertThatThrownBy(() -> service.create(TRACK_ID, new NewWrittenPartDTO(null, List.of(99L), CONTENT, 4L), token))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.instrumentNotFound"));
        when(draftService.readContent("broken")).thenThrow(ScoreDraftService.invalidContent("malformed"));
        assertThatThrownBy(() -> service.create(TRACK_ID, new NewWrittenPartDTO(null, List.of(), "broken", 4L), token))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.contentInvalid"));
        assertThatThrownBy(() -> service.create(TRACK_ID, null, token))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.contentInvalid"));
        when(tracksRepository.findByIdForUpdate(8L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.create(8L, new NewWrittenPartDTO(null, List.of(), CONTENT, null), token))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scorePlayback.track.notFound"));

        verify(tracksService, never()).appendScores(anyLong(), anyList(), any());
        verify(draftService, never()).start(any(), any(), any());
    }

    private static TracksDTO saved(SheetsMusicDTO... parts) {
        TracksDTO track = new TracksDTO();
        track.setVersion(5L);
        track.setScores(new LinkedHashSet<>(Set.of(parts)));
        return track;
    }

    private static SheetsMusicDTO part(Long id, Long order) {
        SheetsMusicDTO part = new SheetsMusicDTO();
        part.setId(id);
        part.setOrder(order);
        return part;
    }

    private static Instruments instrument(Long id, boolean deleted) {
        Instruments instrument = new Instruments();
        instrument.setId(id);
        instrument.setDeleted(deleted);
        return instrument;
    }

    private static JwtAuthenticationToken token() {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("mario").issuedAt(now).expiresAt(now.plusSeconds(60)).build();
        return new JwtAuthenticationToken(jwt);
    }
}
