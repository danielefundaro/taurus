package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester.Suggestion;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class InstrumentPlaybackSuggesterTest {

    @ParameterizedTest
    @CsvSource(
        delimiter = ';',
        nullValues = "-",
        value = {
            "Clarinetto soprano 1°; clarinetto; -2; -; 71",
            "Clarinetto basso; clarinetto basso; -14; -2; 71",
            "Clarinetto piccolo mib; clarinetto piccolo; 3; -; 71",
            "Sax tenore 2°; sax tenore; -14; -; 66",
            "Sassofono contralto; sax contralto; -9; -; 65",
            "Flicorno baritono 1°; flicorno baritono; -14; 0; 57",
            "Euphonium II; euphonium; -14; 0; 57",
            "Basso 1°; basso; 0; 0; 58",
            "Corno inglese; corno inglese; -7; -; 69",
            "Ottavino; ottavino; 12; -; 72",
        }
    )
    void proposesTheValuesOfTheLongestKeyword(String name, String keyword, Integer transposition, Integer bassClef, Integer program) {
        Suggestion suggestion = InstrumentPlaybackSuggester.suggest(name).orElseThrow();

        assertThat(suggestion.keyword()).isEqualTo(keyword);
        assertThat(suggestion.transposition()).isEqualTo(transposition);
        assertThat(suggestion.bassClefTransposition()).isEqualTo(bassClef);
        assertThat(suggestion.soundBank()).isZero();
        assertThat(suggestion.soundProgram()).isEqualTo(program);
        assertThat(suggestion.percussionKey()).isNull();
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = ';',
        value = {
            "Corno in Mib; -9",
            "Corno in Fa; -7",
            "Clarinetto piccolo in Lab; 8",
            "Sax tenore in Do; -12",
            "Clarinetto in La; -3",
            "Tromba in Si♭; -2",
        }
    )
    void movesTheTranspositionToTheKeyWrittenInTheName(String name, int transposition) {
        assertThat(InstrumentPlaybackSuggester.suggest(name)).get().extracting(Suggestion::transposition).isEqualTo(transposition);
    }

    @Test
    void proposesDrumKeysForUnpitchedPercussion() {
        assertThat(InstrumentPlaybackSuggester.suggest("Gran cassa")).get().satisfies(suggestion -> {
            assertThat(suggestion.percussionKey()).isEqualTo(36);
            assertThat(suggestion.soundProgram()).isNull();
            assertThat(suggestion.transposition()).isNull();
        });
        assertThat(InstrumentPlaybackSuggester.suggest("Piatti")).get().extracting(Suggestion::percussionKey).isEqualTo(49);
    }

    @Test
    void matchesWholeWordsOnly() {
        assertThat(InstrumentPlaybackSuggester.suggest("Contrabbasso")).isEmpty();
        assertThat(InstrumentPlaybackSuggester.suggest("Flicorno")).isEmpty();
        assertThat(InstrumentPlaybackSuggester.suggest("Voce")).isEmpty();
        assertThat(InstrumentPlaybackSuggester.suggest("   ")).isEmpty();
        assertThat(InstrumentPlaybackSuggester.suggest(null)).isEmpty();
    }

    @Test
    void ignoresAccentsCaseAndPunctuation() {
        assertThat(InstrumentPlaybackSuggester.suggest("FLICORNO-SOPRANO (2ª)")).get().extracting(Suggestion::keyword).isEqualTo("flicorno soprano");
        assertThat(InstrumentPlaybackSuggester.tokens("Clarinètto 1° solo")).containsExactly("clarinetto");
    }

    @Test
    void proposesEveryPredefinedInstrument() {
        String[] predefined = {
            "Flauto 1°", "Flauto 2°", "Ottavino", "Oboe", "Clarinetto soprano solo", "Clarinetto soprano 1°", "Clarinetto soprano 2°",
            "Clarinetto soprano 3°", "Clarinetto contralto", "Clarinetto basso", "Clarinetto piccolo mib", "Sax soprano 1°", "Sax soprano 2°",
            "Sax contralto 1°", "Sax contralto 2°", "Sax tenore 1°", "Sax tenore 2°", "Sax baritono 1°", "Sax baritono 2°", "Tromba 1°",
            "Tromba 2°", "Cornetta 1°", "Cornetta 2°", "Trombone 1°", "Trombone 2°", "Flicorno soprano 1°", "Flicorno soprano 2°",
            "Flicorno sopranino 1°", "Flicorno sopranino 2°", "Flicorno baritono 1°", "Flicorno baritono 2°", "Flicorno basso 1°",
            "Flicorno basso 2°", "Euphonium 1°", "Euphonium 2°", "Corno 1°", "Corno 2°", "Corno 3°", "Basso 1°", "Basso 2°", "Tamburo",
            "Gran cassa", "Piatti",
        };
        for (String name : predefined) {
            assertThat(InstrumentPlaybackSuggester.suggest(name)).as(name).isPresent();
        }
    }

    @ParameterizedTest
    @CsvSource(
        delimiter = ';',
        value = {
            "Clarinetto soprano 1°; 52; 96",
            "Sax contralto 2°; 58; 89",
            "Sax baritono; 57; 89",
            "Euphonium; 48; 84",
            "Trombone 1°; 40; 77",
            "Basso tuba; 26; 65",
            "Corno in Mib; 42; 84",
        }
    )
    void proposesTheWrittenRange(String name, int lowest, int highest) {
        Suggestion suggestion = InstrumentPlaybackSuggester.suggest(name).orElseThrow();

        assertThat(suggestion.lowestWrittenPitch()).isEqualTo(lowest);
        assertThat(suggestion.highestWrittenPitch()).isEqualTo(highest);
        assertThat(suggestion.rangeAppliesTo(suggestion.transposition())).isTrue();
    }

    @Test
    void appliesTheRangeOnlyToTheTranspositionOfTheProposal() {
        Suggestion bass = InstrumentPlaybackSuggester.suggest("Basso").orElseThrow();
        Suggestion drum = InstrumentPlaybackSuggester.suggest("Tamburo").orElseThrow();

        assertThat(bass.rangeAppliesTo(-14)).isFalse();
        assertThat(bass.rangeAppliesTo(null)).isFalse();
        assertThat(drum.lowestWrittenPitch()).isNull();
        assertThat(drum.rangeAppliesTo(null)).isFalse();
    }

    @Test
    void givesEveryPitchedInstrumentOfTheCatalogueAValidRange() {
        for (InstrumentPlaybackCatalog.Entry entry : InstrumentPlaybackCatalog.entries()) {
            if (entry.soundProgram() == null) {
                assertThat(entry.lowestWrittenPitch()).as(entry.keywords().get(0)).isNull();
                continue;
            }
            assertThat(entry.lowestWrittenPitch()).as(entry.keywords().get(0)).isBetween(0, 127);
            assertThat(entry.highestWrittenPitch()).as(entry.keywords().get(0)).isBetween(entry.lowestWrittenPitch() + 12, 127);
        }
    }
}
