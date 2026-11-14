package com.fundaro.zodiac.taurus.domain.scoreplayback;

/** How a score version was produced. */
public enum ScoreVersionOrigin {
    OMR_AUDIVERIS,
    OMR_HOMR,
    UPLOAD_MUSICXML,
    UPLOAD_MIDI,
    CORRECTION,
    /** Written in the music writing editor. */
    WRITING,
}
