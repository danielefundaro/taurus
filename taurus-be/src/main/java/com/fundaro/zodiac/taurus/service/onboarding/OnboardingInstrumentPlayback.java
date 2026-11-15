package com.fundaro.zodiac.taurus.service.onboarding;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester.Suggestion;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sound and transposition of an imported instrument: the values of the optional columns of the {@code Strumenti}
 * sheet or, when all of them are empty, the proposal computed from the name. Validation and application resolve the
 * same row in the same way.
 */
final class OnboardingInstrumentPlayback {

    static final String SOUND = "suono";
    static final String TRANSPOSITION = "trasposizione";
    static final String BASS_CLEF_TRANSPOSITION = "trasposizione_chiave_basso";

    private static final Pattern DRUM = Pattern.compile("batteria\\s*:\\s*(\\d{1,3})");
    private static final int MAX_TRANSPOSITION = 36;
    private static final int MAX_PROGRAM = 127;
    private static final int MIN_PERCUSSION_KEY = 27;
    private static final int MAX_PERCUSSION_KEY = 87;

    private OnboardingInstrumentPlayback() {}

    /**
     * @param explicit at least one of the columns is filled in: the proposal is not used
     * @param keyword  catalogue keyword of the proposal, {@code null} without proposal or with explicit values
     * @param problems invalid values, as column and message
     */
    record Resolution(Values values, boolean explicit, String keyword, List<Problem> problems) {}

    record Problem(String column, String message) {}

    /** Sound and transposition, with the written range of the catalogue when it applies to the transposition. */
    record Values(
        Integer transposition,
        Integer bassClefTransposition,
        Integer soundBank,
        Integer soundProgram,
        Integer percussionKey,
        Integer lowestWrittenPitch,
        Integer highestWrittenPitch
    ) {
        static final Values NONE = new Values(null, null, null, null, null, null, null);

        boolean configured() {
            return percussionKey != null || (soundProgram != null && transposition != null);
        }

        void applyTo(Instruments instrument) {
            instrument.setTranspositionSemitones(transposition);
            instrument.setBassClefTranspositionSemitones(bassClefTransposition);
            instrument.setSoundBank(soundBank);
            instrument.setSoundProgram(soundProgram);
            instrument.setPercussionKey(percussionKey);
            instrument.setLowestWrittenPitch(lowestWrittenPitch);
            instrument.setHighestWrittenPitch(highestWrittenPitch);
        }
    }

    static Resolution resolve(String name, String sound, String transposition, String bassClefTransposition) {
        if (sound.isBlank() && transposition.isBlank() && bassClefTransposition.isBlank()) {
            return InstrumentPlaybackSuggester.suggest(name)
                .map(suggestion -> new Resolution(
                    new Values(
                        suggestion.transposition(),
                        suggestion.bassClefTransposition(),
                        suggestion.soundBank(),
                        suggestion.soundProgram(),
                        suggestion.percussionKey(),
                        suggestion.lowestWrittenPitch(),
                        suggestion.highestWrittenPitch()
                    ),
                    false,
                    suggestion.keyword(),
                    List.of()
                ))
                .orElse(new Resolution(Values.NONE, false, null, List.of()));
        }

        List<Problem> problems = new ArrayList<>();
        Integer program = null;
        Integer drum = null;
        if (!sound.isBlank()) {
            Matcher matcher = DRUM.matcher(sound.trim().toLowerCase(Locale.ROOT));
            if (matcher.matches()) {
                drum = Integer.valueOf(matcher.group(1));
                if (drum < MIN_PERCUSSION_KEY || drum > MAX_PERCUSSION_KEY) {
                    problems.add(new Problem(SOUND, "Nota di batteria tra " + MIN_PERCUSSION_KEY + " e " + MAX_PERCUSSION_KEY));
                    drum = null;
                }
            } else {
                program = integer(sound);
                if (program == null || program < 0 || program > MAX_PROGRAM) {
                    problems.add(new Problem(SOUND, "Usare un programma General MIDI da 0 a " + MAX_PROGRAM + " oppure batteria:<nota>"));
                    program = null;
                }
            }
        }
        Integer semitones = semitones(transposition, TRANSPOSITION, problems);
        Integer bassClefSemitones = semitones(bassClefTransposition, BASS_CLEF_TRANSPOSITION, problems);
        if (drum != null && (semitones != null || bassClefSemitones != null)) {
            problems.add(new Problem(TRANSPOSITION, "La trasposizione non si applica ai suoni di batteria"));
        }
        Suggestion catalogue = drum == null ? InstrumentPlaybackSuggester.suggest(name).filter(found -> found.rangeAppliesTo(semitones)).orElse(null) : null;
        Values values = new Values(
            semitones,
            bassClefSemitones,
            program == null ? null : 0,
            program,
            drum,
            catalogue == null ? null : catalogue.lowestWrittenPitch(),
            catalogue == null ? null : catalogue.highestWrittenPitch()
        );
        return new Resolution(problems.isEmpty() ? values : Values.NONE, true, null, List.copyOf(problems));
    }

    private static Integer semitones(String value, String column, List<Problem> problems) {
        if (value.isBlank()) return null;
        Integer semitones = integer(value);
        if (semitones == null || Math.abs(semitones) > MAX_TRANSPOSITION) {
            problems.add(new Problem(column, "Semitoni interi tra -" + MAX_TRANSPOSITION + " e " + MAX_TRANSPOSITION));
            return null;
        }
        return semitones;
    }

    /** Whole number, also with the typographic minus sign. */
    private static Integer integer(String value) {
        try {
            return Integer.valueOf(value.trim().replace('−', '-'));
        } catch (NumberFormatException exception) {
            return null;
        }
    }
}
