package com.fundaro.zodiac.taurus.service.scoreplayback;

import java.util.List;

/**
 * Reference catalogue used to propose the playback settings of an instrument from its name.
 * <p>
 * Every entry lists the keywords that identify the instrument, the key it is usually written in (pitch class, C = 0) and
 * its default values, written range included. The same keywords recognize the names of the instruments read on the parts of a PDF. Values follow the track score playback specification and are meant to be confirmed by an archivist.
 */
public final class InstrumentPlaybackCatalog {

    /** Sound bank of the General MIDI sounds. */
    public static final int GENERAL_MIDI_BANK = 0;

    private static final int C = 0;
    private static final int E_FLAT = 3;
    private static final int F = 5;
    private static final int B_FLAT = 10;

    /**
     * Keywords include the usual abbreviations of band parts ("cl", "sax a") and plurals; ambiguous abbreviations, such
     * as "tr" for tromba and trombone, are left out. Entries without sound only name an instrument for the text read on
     * the parts.
     */
    private static final List<Entry> ENTRIES = List.of(
        pitched(List.of("ottavino", "ott", "piccolo"), C, 12, null, 72, 62, 96),
        pitched(List.of("flauto", "flauti", "fl"), C, 0, null, 73, 60, 96),
        pitched(List.of("oboe", "oboi", "ob"), C, 0, null, 68, 58, 93),
        pitched(List.of("corno inglese", "c ingl"), F, -7, null, 69, 59, 91),
        pitched(List.of("fagotto", "fagotti", "fg", "fag"), C, 0, 0, 70, 34, 76),
        pitched(List.of("clarinetto piccolo", "cl piccolo", "requinto"), E_FLAT, 3, null, 71, 52, 91),
        pitched(List.of("clarinetto contralto", "clarinetto alto", "cl contralto", "cl alto"), E_FLAT, -9, null, 71, 51, 91),
        pitched(List.of("clarinetto basso", "cl basso", "clarinetti bassi"), B_FLAT, -14, -2, 71, 51, 91),
        pitched(List.of("clarinetto", "clarinetti", "cl", "clar"), B_FLAT, -2, null, 71, 52, 96),
        pitched(List.of("sax soprano", "sax s", "sax sop"), B_FLAT, -2, null, 64, 58, 89),
        pitched(List.of("sax contralto", "sax alto", "sax a", "sax contr"), E_FLAT, -9, null, 65, 58, 89),
        pitched(List.of("sax tenore", "sax t", "sax ten"), B_FLAT, -14, null, 66, 58, 89),
        pitched(List.of("sax baritono", "sax b", "sax bar"), E_FLAT, -21, null, 67, 57, 89),
        pitched(List.of("tromba", "trombe", "cornetta", "cornette"), B_FLAT, -2, null, 56, 54, 84),
        pitched(List.of("flicorno sopranino", "flic sopranino"), E_FLAT, 3, null, 56, 54, 84),
        pitched(List.of("flicorno soprano", "flicorni soprani", "flic soprano"), B_FLAT, -2, null, 56, 54, 84),
        pitched(List.of("flicorno contralto", "flicorni contralti", "flic contralto"), E_FLAT, -9, null, 60, 54, 84),
        pitched(List.of("flicorno tenore", "flicorni tenori", "flic tenore"), B_FLAT, -14, 0, 57, 54, 84),
        pitched(
            List.of("flicorno baritono", "flicorni baritoni", "flic baritono", "euphonium", "eufonio", "bombardino", "euph", "euf"),
            B_FLAT,
            -14,
            0,
            57,
            48,
            84
        ),
        pitched(List.of("flicorno basso", "flicorni bassi", "flic basso"), B_FLAT, -14, 0, 58, 48, 84),
        pitched(List.of("trombone", "tromboni", "trb", "tbn"), C, 0, 0, 57, 40, 77),
        pitched(List.of("corno", "corni"), F, -7, null, 60, 42, 84),
        pitched(List.of("basso", "bassi", "tuba", "tube", "bassotuba", "basso tuba"), C, 0, 0, 58, 26, 65),
        pitched(List.of("glockenspiel", "campanelli", "glock"), C, 24, null, 9, 55, 84),
        pitched(List.of("vibrafono", "vib"), C, 0, null, 11, 53, 89),
        pitched(List.of("xilofono", "xil"), C, 12, null, 13, 53, 96),
        pitched(List.of("timpani", "timpano", "timp"), C, 0, 0, 47, 38, 57),
        percussion(List.of("tamburo", "rullante", "tamb"), 38),
        percussion(List.of("gran cassa", "grancassa", "gr cassa"), 36),
        percussion(List.of("piatti", "piatto"), 49),
        percussion(List.of("triangolo"), 81),
        percussion(List.of("tamburello"), 54),
        named(List.of("contrabbasso", "contrabbassi", "cb")),
        named(List.of("arpa")),
        named(List.of("chitarra", "chitarre")),
        named(List.of("basso elettrico")),
        named(List.of("pianoforte", "piano", "pf", "tastiera")),
        named(List.of("batteria", "drum set")),
        named(List.of("percussioni", "perc")),
        named(List.of("marimba")),
        named(List.of("campane tubolari", "campane")),
        named(List.of("violoncello", "violoncelli", "vc"))
    );

    private InstrumentPlaybackCatalog() {}

    public static List<Entry> entries() {
        return ENTRIES;
    }

    private static Entry pitched(
        List<String> keywords,
        int referenceKey,
        int transposition,
        Integer bassClefTransposition,
        int soundProgram,
        int lowestWrittenPitch,
        int highestWrittenPitch
    ) {
        return new Entry(keywords, referenceKey, transposition, bassClefTransposition, soundProgram, null, lowestWrittenPitch, highestWrittenPitch);
    }

    private static Entry percussion(List<String> keywords, int percussionKey) {
        return new Entry(keywords, null, null, null, null, percussionKey, null, null);
    }

    private static Entry named(List<String> keywords) {
        return new Entry(keywords, null, null, null, null, null, null, null);
    }

    /**
     * A reference instrument.
     *
     * @param keywords              normalized keywords, matched as whole words
     * @param referenceKey          pitch class of the usual key (C = 0), {@code null} for unpitched percussion
     * @param transposition         semitones from written to sounding pitch
     * @param bassClefTransposition semitones for parts written in bass clef, {@code null} when equal to {@code transposition}
     * @param soundProgram          General MIDI program, {@code null} for unpitched percussion
     * @param percussionKey         General MIDI drum key, {@code null} for pitched instruments
     * @param lowestWrittenPitch    lowest written note in {@code transposition}, as a MIDI note number (C4 = 60)
     * @param highestWrittenPitch   highest written note in {@code transposition}
     */
    public record Entry(
        List<String> keywords,
        Integer referenceKey,
        Integer transposition,
        Integer bassClefTransposition,
        Integer soundProgram,
        Integer percussionKey,
        Integer lowestWrittenPitch,
        Integer highestWrittenPitch
    ) {
        /** Entries that only name an instrument have no sound to propose. */
        public boolean hasSound() {
            return soundProgram != null || percussionKey != null;
        }
    }
}
