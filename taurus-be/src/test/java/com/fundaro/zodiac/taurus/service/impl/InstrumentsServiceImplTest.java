package com.fundaro.zodiac.taurus.service.impl;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.UsersRepository;
import com.fundaro.zodiac.taurus.service.dto.InstrumentsDTO;
import com.fundaro.zodiac.taurus.service.mapper.InstrumentsMapper;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The name of an instrument is unique in the tenant, compared without case, accents, punctuation and repeated spaces. */
class InstrumentsServiceImplTest {

    private final InstrumentsRepository repository = mock(InstrumentsRepository.class);
    private final InstrumentsMapper mapper = mock(InstrumentsMapper.class);
    private final InstrumentsServiceImpl service = new InstrumentsServiceImpl(repository, mapper, mock(UsersRepository.class));

    @Test
    void refusesANewInstrumentWithTheNameOfAnother() {
        names(row(1L, "Clarinetto in Sib"));

        assertThatThrownBy(() -> service.save(instrument(null, "  clarinètto IN sib. "), token()))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("instrument.name.exists");
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            });
        verify(repository).lockTenantNames();
        verify(repository, never()).save(any());
    }

    @Test
    void createsAnInstrumentInAnotherKeyOrWithAnotherOrdinal() {
        names(row(1L, "Clarinetto in Sib"), row(2L, "Corno 1°"));
        Instruments entity = new Instruments();
        when(mapper.toEntity(any(InstrumentsDTO.class))).thenReturn(entity);
        when(repository.save(entity)).thenReturn(entity);

        service.save(instrument(null, "Clarinetto in Mib"), token());
        service.save(instrument(null, "Corno 2°"), token());

        verify(mapper, times(2)).toDto(entity);
    }

    @Test
    void refusesARenameToTheNameOfAnother() {
        Instruments entity = entity(1L, "Clarinetto in Sib");
        names(row(1L, "Clarinetto in Sib"), row(2L, "Clarinetto 1°"));

        assertThatThrownBy(() -> service.update(1L, instrument(1L, "Clarinetto 1°"), token()))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("instrument.name.exists"));
        assertThatThrownBy(() -> service.partialUpdate(1L, instrument(1L, "clarinetto 1"), token()))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("instrument.name.exists"));
        verify(repository, never()).save(entity);
    }

    /** Names doubled before the check stay as they are: changing only the case or the punctuation is not a rename. */
    @Test
    void keepsTheNameWhenOnlyItsFormChanges() {
        Instruments entity = entity(1L, "Clarinetto in Sib");
        when(repository.save(entity)).thenReturn(entity);

        service.update(1L, instrument(1L, "clarinetto in Sib."), token());
        service.update(1L, instrument(1L, null), token());

        verify(repository, never()).lockTenantNames();
        verify(repository, never()).findActiveNames();
    }

    @Test
    void renamesToANameNobodyHas() {
        Instruments entity = entity(1L, "Clarinetto");
        names(row(1L, "Clarinetto"), row(2L, "Flauto"));
        when(repository.save(entity)).thenReturn(entity);

        service.update(1L, instrument(1L, "Clarinetto in Sib"), token());

        verify(repository).lockTenantNames();
        verify(repository).save(entity);
    }

    @Test
    void storesAWrittenRangeWithBothNotesInOrder() {
        Instruments entity = entity(1L, "Clarinetto");
        entity.setLowestWrittenPitch(52);
        entity.setHighestWrittenPitch(96);
        when(repository.save(entity)).thenReturn(entity);

        assertThat(rangeError(() -> service.save(ranged(null, 52, null), token()))).isEqualTo("scorePlayback.settings.invalid");
        assertThat(rangeError(() -> service.update(1L, ranged(1L, 96, 52), token()))).isEqualTo("scorePlayback.settings.invalid");
        assertThat(rangeError(() -> service.update(1L, ranged(1L, -1, 52), token()))).isEqualTo("scorePlayback.settings.invalid");
        assertThat(rangeError(() -> service.partialUpdate(1L, ranged(1L, null, 40), token()))).isEqualTo("scorePlayback.settings.invalid");
        assertThat(rangeError(() -> service.partialUpdate(1L, ranged(1L, 100, null), token()))).isEqualTo("scorePlayback.settings.invalid");
        verify(repository, never()).save(entity);

        service.update(1L, ranged(1L, 58, 89), token());
        assertThat(entity.getLowestWrittenPitch()).isEqualTo(58);
        assertThat(entity.getHighestWrittenPitch()).isEqualTo(89);
        service.update(1L, ranged(1L, null, null), token());
        assertThat(entity.getLowestWrittenPitch()).isNull();
        assertThat(entity.getHighestWrittenPitch()).isNull();
    }

    private static InstrumentsDTO ranged(Long id, Integer lowest, Integer highest) {
        InstrumentsDTO instrument = instrument(id, null);
        instrument.setLowestWrittenPitch(lowest);
        instrument.setHighestWrittenPitch(highest);
        return instrument;
    }

    private static String rangeError(Runnable action) {
        try {
            action.run();
        } catch (RequestAlertException error) {
            assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
            return error.getErrorKey();
        }
        throw new AssertionError("No error");
    }

    private Instruments entity(Long id, String name) {
        Instruments entity = new Instruments();
        entity.setId(id);
        entity.setName(name);
        when(repository.findByIdAndDeletedFalse(id)).thenReturn(Optional.of(entity));
        return entity;
    }

    private void names(Object[]... rows) {
        when(repository.findActiveNames()).thenReturn(List.of(rows));
    }

    private static Object[] row(Long id, String name) {
        return new Object[] { id, name };
    }

    private static InstrumentsDTO instrument(Long id, String name) {
        InstrumentsDTO instrument = new InstrumentsDTO();
        instrument.setId(id);
        instrument.setName(name);
        return instrument;
    }

    private static JwtAuthenticationToken token() {
        Instant now = Instant.now();
        return new JwtAuthenticationToken(
            Jwt.withTokenValue("token").header("alg", "none").subject("user-1").issuedAt(now).expiresAt(now.plusSeconds(300)).build()
        );
    }
}
