package com.fundaro.zodiac.taurus.service.ensemble;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleUpdateDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentFamily;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;

import java.util.Arrays;
import java.util.List;
import java.util.stream.LongStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InstrumentEnsembleServiceTest {

    private final InstrumentsRepository repository = mock(InstrumentsRepository.class);
    private final InstrumentEnsembleService service = new InstrumentEnsembleService(repository);

    @Test
    void savesTheNewOrderUnderTheLockOfTheEnsemble() {
        when(repository.findEnsemble()).thenReturn(List.of(instrument(1L, "Flauto 1°", 1), instrument(2L, "Tromba 1°", 2)));
        when(repository.findActiveIds(List.of(3L, 2L, 1L))).thenReturn(List.of(1L, 2L, 3L));

        service.save(new EnsembleUpdateDTO(List.of(3L, 2L, 1L), List.of(1L, 2L)));

        InOrder order = inOrder(repository);
        order.verify(repository).lockTenantEnsemble();
        order.verify(repository).findEnsemble();
        order.verify(repository).clearEnsemble();
        order.verify(repository).setEnsemblePosition(3L, 1);
        order.verify(repository).setEnsemblePosition(2L, 2);
        order.verify(repository).setEnsemblePosition(1L, 3);
    }

    @Test
    void anEmptyListClearsTheEnsemble() {
        when(repository.findEnsemble()).thenReturn(List.of(instrument(1L, "Flauto 1°", 1)));

        service.save(new EnsembleUpdateDTO(List.of(), List.of(1L)));

        verify(repository).clearEnsemble();
        verify(repository, never()).findActiveIds(List.of());
        verify(repository, never()).setEnsemblePosition(anyLong(), anyInt());
    }

    @Test
    void theSameOrderWritesNothing() {
        when(repository.findEnsemble()).thenReturn(List.of(instrument(1L, "Flauto 1°", 1)));
        when(repository.findActiveIds(List.of(1L))).thenReturn(List.of(1L));

        List<EnsembleInstrumentDTO> saved = service.save(new EnsembleUpdateDTO(List.of(1L), List.of(1L)));

        assertThat(saved).containsExactly(new EnsembleInstrumentDTO(1L, "Flauto 1°", 1, InstrumentFamily.WOODWINDS));
        verify(repository, never()).clearEnsemble();
    }

    @Test
    void refusesAChangeMadeOnAnotherEnsemble() {
        when(repository.findEnsemble()).thenReturn(List.of(instrument(1L, "Flauto 1°", 1), instrument(2L, "Tromba 1°", 2)));

        assertThatThrownBy(() -> service.save(new EnsembleUpdateDTO(List.of(2L), List.of(1L))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("version.conflict");
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            });
        verify(repository, never()).clearEnsemble();
    }

    @Test
    void refusesAListThatIsNotAnEnsemble() {
        when(repository.findEnsemble()).thenReturn(List.of());
        when(repository.findActiveIds(List.of(1L, 9L))).thenReturn(List.of(1L));
        List<Long> tooMany = LongStream.rangeClosed(1, InstrumentEnsembleService.MAX_INSTRUMENTS + 1).boxed().toList();

        for (EnsembleUpdateDTO update : List.of(
            new EnsembleUpdateDTO(List.of(1L, 1L), List.of()),
            new EnsembleUpdateDTO(Arrays.asList(1L, null), List.of()),
            new EnsembleUpdateDTO(null, List.of()),
            new EnsembleUpdateDTO(List.of(1L), null),
            new EnsembleUpdateDTO(tooMany, List.of()),
            new EnsembleUpdateDTO(List.of(1L, 9L), List.of())
        )) {
            assertThatThrownBy(() -> service.save(update))
                .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                    assertThat(error.getErrorKey()).isEqualTo("instrument.ensemble.invalid");
                    assertThat(error.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                });
        }
        assertThatThrownBy(() -> service.save(null)).isInstanceOf(RequestAlertException.class);
        verify(repository, never()).clearEnsemble();
    }

    @Test
    void proposesEveryInstrumentInTheReferenceOrderWithItsPosition() {
        when(repository.findActive()).thenReturn(List.of(instrument(1L, "Voce", null), instrument(2L, "Basso 1°", 1), instrument(3L, "Flauto 1°", null)));

        assertThat(service.reference()).containsExactly(
            new EnsembleInstrumentDTO(3L, "Flauto 1°", null, InstrumentFamily.WOODWINDS),
            new EnsembleInstrumentDTO(2L, "Basso 1°", 1, InstrumentFamily.BASSES),
            new EnsembleInstrumentDTO(1L, "Voce", null, null)
        );
        when(repository.findEnsemble()).thenReturn(List.of());
        assertThat(service.ensemble()).isEmpty();
    }

    private static Instruments instrument(Long id, String name, Integer position) {
        Instruments instrument = new Instruments();
        instrument.setId(id);
        instrument.setName(name);
        instrument.setEnsemblePosition(position);
        return instrument;
    }
}
