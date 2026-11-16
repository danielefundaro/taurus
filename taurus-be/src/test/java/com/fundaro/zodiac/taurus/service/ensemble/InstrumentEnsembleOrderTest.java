package com.fundaro.zodiac.taurus.service.ensemble;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentFamily;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class InstrumentEnsembleOrderTest {

    /** The instruments every tenant starts with, in the reference order, followed by two the catalogue does not place. */
    private static final List<String> REFERENCE = List.of(
        "Ottavino",
        "Flauto 1°",
        "Flauto 2°",
        "Oboe",
        "Clarinetto piccolo mib",
        "Clarinetto soprano solo",
        "Clarinetto soprano 1°",
        "Clarinetto soprano 2°",
        "Clarinetto soprano 3°",
        "Clarinetto contralto",
        "Clarinetto basso",
        "Sax soprano 1°",
        "Sax soprano 2°",
        "Sax contralto 1°",
        "Sax contralto 2°",
        "Sax tenore 1°",
        "Sax tenore 2°",
        "Sax baritono 1°",
        "Sax baritono 2°",
        "Corno 1°",
        "Corno 2°",
        "Corno 3°",
        "Tromba 1°",
        "Tromba 2°",
        "Cornetta 1°",
        "Cornetta 2°",
        "Flicorno sopranino 1°",
        "Flicorno sopranino 2°",
        "Flicorno soprano 1°",
        "Flicorno soprano 2°",
        "Flicorno baritono 1°",
        "Flicorno baritono 2°",
        "Euphonium 1°",
        "Euphonium 2°",
        "Trombone 1°",
        "Trombone 2°",
        "Flicorno basso 1°",
        "Flicorno basso 2°",
        "Basso 1°",
        "Basso 2°",
        "Tamburo",
        "Gran cassa",
        "Piatti",
        "Arpa",
        "Voce"
    );

    private final AtomicLong ids = new AtomicLong();

    @Test
    void sortsThePredefinedInstrumentsByFamilyKeywordAndNumber() {
        List<Instruments> shuffled = new ArrayList<>(REFERENCE.stream().map(name -> instrument(name, null)).toList());
        Collections.shuffle(shuffled, new Random(42));

        assertThat(InstrumentEnsembleOrder.sort(shuffled)).extracting(Instruments::getName).containsExactlyElementsOf(REFERENCE);
    }

    @Test
    void keepsTheCurrentPositionAtEqualReferenceAndPutsTheUnplacedInstrumentsLast() {
        Instruments voice = instrument("Voce", 1);
        Instruments secondFlute = instrument("Flauto 1° bis", 2);
        Instruments firstFlute = instrument("Flauto 1°", 3);
        Instruments guitar = instrument("Chitarra", null);
        Instruments organ = instrument("Organo", null);

        assertThat(InstrumentEnsembleOrder.sort(List.of(guitar, organ, voice, firstFlute, secondFlute)))
            .containsExactly(secondFlute, firstFlute, voice, guitar, organ);
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = ';',
        value = {
            "Flauto 1°; 1",
            "Sax contralto 3ª; 3",
            "Clarinetto in Sib 2; 2",
            "Clarinetto II; 2",
            "Primo corno; 1",
            "Tromba terza; 3",
            "Tromba; 0",
        }
    )
    void readsTheNumberOfAnInstrumentOfASection(String name, int number) {
        assertThat(InstrumentEnsembleOrder.number(name)).isEqualTo(number);
    }

    @Test
    void recognizesTheFamilyOfTheInstrumentsItPlaces() {
        assertThat(InstrumentEnsembleOrder.family("Euphonium 2°")).contains(InstrumentFamily.FLUGELHORNS);
        assertThat(InstrumentEnsembleOrder.family("Flicorno basso 1°")).contains(InstrumentFamily.BASSES);
        assertThat(InstrumentEnsembleOrder.family("Timpani")).contains(InstrumentFamily.PITCHED_PERCUSSION);
        assertThat(InstrumentEnsembleOrder.family("Arpa")).isEmpty();
        assertThat(InstrumentEnsembleOrder.family("Voce")).isEmpty();
        assertThat(InstrumentEnsembleOrder.number(null)).isZero();
    }

    private Instruments instrument(String name, Integer position) {
        Instruments instrument = new Instruments();
        instrument.setId(ids.incrementAndGet());
        instrument.setName(name);
        instrument.setEnsemblePosition(position);
        return instrument;
    }
}
