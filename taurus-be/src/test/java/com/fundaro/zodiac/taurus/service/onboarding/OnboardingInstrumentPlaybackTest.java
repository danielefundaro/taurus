package com.fundaro.zodiac.taurus.service.onboarding;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.service.onboarding.OnboardingInstrumentPlayback.Problem;
import com.fundaro.zodiac.taurus.service.onboarding.OnboardingInstrumentPlayback.Resolution;
import com.fundaro.zodiac.taurus.service.onboarding.OnboardingInstrumentPlayback.Values;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OnboardingInstrumentPlaybackTest {

    @Test
    void proposesTheValuesFromTheNameWhenTheColumnsAreEmpty() {
        Resolution resolution = OnboardingInstrumentPlayback.resolve("Corno in Mib", "", "", "");

        assertThat(resolution.explicit()).isFalse();
        assertThat(resolution.keyword()).isEqualTo("corno");
        assertThat(resolution.values()).isEqualTo(new Values(-9, null, 0, 60, null, 42, 84));
        assertThat(resolution.values().configured()).isTrue();
        assertThat(resolution.problems()).isEmpty();
    }

    @Test
    void leavesUnknownNamesToConfigure() {
        Resolution resolution = OnboardingInstrumentPlayback.resolve("Zampogna", "", "", "");

        assertThat(resolution.keyword()).isNull();
        assertThat(resolution.values()).isEqualTo(Values.NONE);
        assertThat(resolution.values().configured()).isFalse();
    }

    @Test
    void usesTheGivenValuesInsteadOfTheProposal() {
        Resolution melodic = OnboardingInstrumentPlayback.resolve("Clarinetto", "71", "−2", "+0");
        Resolution drum = OnboardingInstrumentPlayback.resolve("Clarinetto", " Batteria: 38 ", "", "");
        Resolution partial = OnboardingInstrumentPlayback.resolve("Clarinetto", "71", "", "");

        assertThat(melodic.explicit()).isTrue();
        assertThat(melodic.keyword()).isNull();
        assertThat(melodic.values()).isEqualTo(new Values(-2, 0, 0, 71, null, 52, 96));
        assertThat(drum.values()).isEqualTo(new Values(null, null, null, null, 38, null, null));
        assertThat(drum.values().configured()).isTrue();
        assertThat(partial.values().configured()).isFalse();
    }

    @Test
    void reportsInvalidValuesByColumn() {
        assertThat(OnboardingInstrumentPlayback.resolve("Tromba", "128", "", "").problems()).extracting(Problem::column).containsExactly("suono");
        assertThat(OnboardingInstrumentPlayback.resolve("Tromba", "tromba", "", "").problems()).extracting(Problem::column).containsExactly("suono");
        assertThat(OnboardingInstrumentPlayback.resolve("Tamburo", "batteria:99", "", "").problems()).extracting(Problem::column).containsExactly("suono");
        assertThat(OnboardingInstrumentPlayback.resolve("Tromba", "56", "40", "-2.5").problems())
            .extracting(Problem::column)
            .containsExactly("trasposizione", "trasposizione_chiave_basso");
        Resolution drumWithTransposition = OnboardingInstrumentPlayback.resolve("Tamburo", "batteria:38", "-2", "");
        assertThat(drumWithTransposition.problems()).extracting(Problem::message).containsExactly("La trasposizione non si applica ai suoni di batteria");
        assertThat(drumWithTransposition.values()).isEqualTo(Values.NONE);
    }

    @Test
    void writesEveryFieldOfTheInstrument() {
        Instruments instrument = new Instruments();
        instrument.setSoundProgram(0);

        instrument.setLowestWrittenPitch(52);
        instrument.setHighestWrittenPitch(96);

        new Values(null, null, null, null, 49, null, null).applyTo(instrument);

        assertThat(instrument.getSoundProgram()).isNull();
        assertThat(instrument.getPercussionKey()).isEqualTo(49);
        assertThat(instrument.getLowestWrittenPitch()).isNull();
        assertThat(instrument.getHighestWrittenPitch()).isNull();
    }

    @Test
    void takesTheRangeOfTheCatalogueOnlyWithItsTransposition() {
        Resolution catalogue = OnboardingInstrumentPlayback.resolve("Sax contralto", "65", "-9", "");
        Resolution other = OnboardingInstrumentPlayback.resolve("Sax contralto", "65", "-2", "");

        assertThat(catalogue.values().lowestWrittenPitch()).isEqualTo(58);
        assertThat(catalogue.values().highestWrittenPitch()).isEqualTo(89);
        assertThat(other.values().lowestWrittenPitch()).isNull();
        assertThat(other.values().highestWrittenPitch()).isNull();
    }
}
