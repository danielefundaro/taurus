package com.fundaro.zodiac.taurus.domain.scoreplayback;

import java.util.Optional;

/** Optical music recognition engines whose versions the archivists correct. */
public enum RecognitionEngine {
    AUDIVERIS,
    HOMR;

    /** The engine that produced a version of this origin, if a recognition engine did. */
    public static Optional<RecognitionEngine> of(ScoreVersionOrigin origin) {
        if (origin == ScoreVersionOrigin.OMR_AUDIVERIS) return Optional.of(AUDIVERIS);
        if (origin == ScoreVersionOrigin.OMR_HOMR) return Optional.of(HOMR);
        return Optional.empty();
    }
}
