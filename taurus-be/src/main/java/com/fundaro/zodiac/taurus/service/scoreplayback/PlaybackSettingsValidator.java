package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;

/**
 * Range checks shared by the playback settings of instruments, parts and tracks. The same limits are enforced by the
 * database constraints of the track score playback changelog.
 */
public final class PlaybackSettingsValidator {

    public static final String INVALID = "scorePlayback.settings.invalid";

    private static final int MAX_TRANSPOSITION = 36;
    private static final int MAX_BANK = 16383;
    private static final int MAX_PROGRAM = 127;
    private static final int MAX_PITCH = 127;
    private static final int MIN_PERCUSSION_KEY = 27;
    private static final int MAX_PERCUSSION_KEY = 87;
    private static final int MIN_TEMPO = 20;
    private static final int MAX_TEMPO = 300;

    private PlaybackSettingsValidator() {}

    public static void requireValidSound(
        String entityName,
        Integer transposition,
        Integer bassClefTransposition,
        Integer soundBank,
        Integer soundProgram,
        Integer percussionKey
    ) {
        if (
            outside(transposition, -MAX_TRANSPOSITION, MAX_TRANSPOSITION) ||
                outside(bassClefTransposition, -MAX_TRANSPOSITION, MAX_TRANSPOSITION) ||
                outside(soundBank, 0, MAX_BANK) ||
                outside(soundProgram, 0, MAX_PROGRAM) ||
                outside(percussionKey, MIN_PERCUSSION_KEY, MAX_PERCUSSION_KEY) ||
                (soundBank != null && soundProgram == null)
        ) {
            throw invalid(entityName);
        }
    }

    /** A written range has both notes or none, each a MIDI note number, the lowest not above the highest. */
    public static void requireValidRange(String entityName, Integer lowestWrittenPitch, Integer highestWrittenPitch) {
        if ((lowestWrittenPitch == null) != (highestWrittenPitch == null)) throw invalid(entityName);
        if (lowestWrittenPitch == null) return;
        if (
            outside(lowestWrittenPitch, 0, MAX_PITCH) ||
                outside(highestWrittenPitch, 0, MAX_PITCH) ||
                lowestWrittenPitch > highestWrittenPitch
        ) {
            throw invalid(entityName);
        }
    }

    public static void requireValidTempo(String entityName, Integer tempoBpm) {
        if (outside(tempoBpm, MIN_TEMPO, MAX_TEMPO)) throw invalid(entityName);
    }

    private static boolean outside(Integer value, int minimum, int maximum) {
        return value != null && (value < minimum || value > maximum);
    }

    private static RequestAlertException invalid(String entityName) {
        return new RequestAlertException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid playback settings", entityName, INVALID);
    }
}
