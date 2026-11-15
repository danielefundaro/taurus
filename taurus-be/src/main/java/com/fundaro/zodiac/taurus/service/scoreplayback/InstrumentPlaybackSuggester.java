package com.fundaro.zodiac.taurus.service.scoreplayback;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Proposes the playback settings of an instrument from its name, using {@link InstrumentPlaybackCatalog}.
 * <p>
 * The name is normalized (lower case, no accents, no punctuation, no ordinals), the longest catalogue keyword found as
 * whole words wins, and a key written in the name ("in Mib", "Lab") moves the transposition to the same pitch class
 * nearest to the reference value. Without a keyword, or for an entry without sound, there is no proposal.
 */
public final class InstrumentPlaybackSuggester {

    private static final Pattern MARKS = Pattern.compile("\\p{M}+");
    private static final Pattern SEPARATORS = Pattern.compile("[^a-z0-9#]+");
    private static final Pattern ORDINAL = Pattern.compile("\\d+[°ºª]?|[°ºª]");
    private static final Set<String> IGNORED_WORDS = Set.of(
        "i", "ii", "iii", "iv", "solo", "primo", "secondo", "terzo", "quarto", "prima", "seconda", "terza"
    );
    private static final Map<String, String> SYNONYMS = Map.of(
        "sassofono", "sax",
        "saxofono", "sax",
        "saxophone", "sax",
        "sassofoni", "sax"
    );
    private static final Map<String, Integer> KEYS = Map.ofEntries(
        Map.entry("do", 0), Map.entry("c", 0),
        Map.entry("reb", 1), Map.entry("db", 1), Map.entry("do#", 1),
        Map.entry("re", 2), Map.entry("d", 2),
        Map.entry("mib", 3), Map.entry("eb", 3), Map.entry("re#", 3),
        Map.entry("mi", 4), Map.entry("e", 4),
        Map.entry("fa", 5), Map.entry("f", 5),
        Map.entry("fa#", 6), Map.entry("solb", 6), Map.entry("gb", 6),
        Map.entry("sol", 7), Map.entry("g", 7),
        Map.entry("lab", 8), Map.entry("ab", 8), Map.entry("sol#", 8),
        Map.entry("la", 9), Map.entry("a", 9),
        Map.entry("sib", 10), Map.entry("bb", 10), Map.entry("la#", 10),
        Map.entry("si", 11), Map.entry("b", 11)
    );
    /** Keys recognized even without a preceding "in": only the forms with an accidental, which are not ordinary words. */
    private static final Set<String> STANDALONE_KEYS = Set.of("sib", "mib", "lab", "reb", "solb", "bb", "eb", "ab");

    private InstrumentPlaybackSuggester() {}

    public static Optional<Suggestion> suggest(String name) {
        List<String> tokens = tokens(name);
        Match match = match(tokens);
        if (match == null || !match.entry().hasSound()) return Optional.empty();
        InstrumentPlaybackCatalog.Entry best = match.entry();
        String bestKeyword = match.keyword();

        if (best.percussionKey() != null) {
            return Optional.of(new Suggestion(bestKeyword, null, null, null, null, null, best.percussionKey(), null, null));
        }
        Integer key = writtenKey(tokens);
        int transposition = key == null || key.equals(best.referenceKey())
            ? best.transposition()
            : nearestWithPitchClass(key, best.transposition());
        return Optional.of(new Suggestion(
            bestKeyword,
            key,
            transposition,
            best.bassClefTransposition(),
            InstrumentPlaybackCatalog.GENERAL_MIDI_BANK,
            best.soundProgram(),
            null,
            best.lowestWrittenPitch(),
            best.highestWrittenPitch()
        ));
    }

    /** The catalogue entry of the longest keyword found as whole words in the name, also for entries without sound. */
    public static Optional<Match> match(String name) {
        return Optional.ofNullable(match(tokens(name)));
    }

    /** Pitch class of the key written in the name ("in Mib", "Lab"), or {@code null}. */
    public static Integer writtenKey(String name) {
        return writtenKey(tokens(name));
    }

    private static Match match(List<String> tokens) {
        if (tokens.isEmpty()) return null;
        Match best = null;
        int bestLength = 0;
        for (InstrumentPlaybackCatalog.Entry entry : InstrumentPlaybackCatalog.entries()) {
            for (String keyword : entry.keywords()) {
                List<String> keywordTokens = List.of(keyword.split(" "));
                int length = keywordTokens.size() * 1000 + keyword.length();
                if (length > bestLength && containsSequence(tokens, keywordTokens)) {
                    best = new Match(entry, keyword);
                    bestLength = length;
                }
            }
        }
        return best;
    }

    static List<String> tokens(String name) {
        if (name == null) return List.of();
        String text = name.toLowerCase(Locale.ROOT).replace('♭', 'b').replace('♯', '#');
        text = MARKS.matcher(Normalizer.normalize(text, Normalizer.Form.NFD)).replaceAll("");
        text = ORDINAL.matcher(text).replaceAll(" ");
        List<String> tokens = new ArrayList<>();
        for (String token : SEPARATORS.split(text)) {
            if (token.isBlank() || IGNORED_WORDS.contains(token)) continue;
            tokens.add(SYNONYMS.getOrDefault(token, token));
        }
        return tokens;
    }

    private static Integer writtenKey(List<String> tokens) {
        for (int index = 0; index < tokens.size(); index++) {
            String token = tokens.get(index);
            boolean afterIn = index > 0 && "in".equals(tokens.get(index - 1));
            if ((afterIn || STANDALONE_KEYS.contains(token)) && KEYS.containsKey(token)) return KEYS.get(token);
        }
        return null;
    }

    private static int nearestWithPitchClass(int pitchClass, int reference) {
        int candidate = reference - Math.floorMod(reference - pitchClass, 12);
        int above = candidate + 12;
        return Math.abs(above - reference) < Math.abs(candidate - reference) ? above : candidate;
    }

    private static boolean containsSequence(List<String> tokens, List<String> sequence) {
        for (int start = 0; start + sequence.size() <= tokens.size(); start++) {
            if (tokens.subList(start, start + sequence.size()).equals(sequence)) return true;
        }
        return false;
    }

    /** The catalogue entry recognized in a name and the keyword that recognized it. */
    public record Match(InstrumentPlaybackCatalog.Entry entry, String keyword) {}

    /**
     * A proposal: values are {@code null} when they do not apply (no transposition and no range for unpitched
     * percussion, no drum key for pitched instruments, no bass-clef value when equal to the main transposition).
     *
     * @param keyword             catalogue keyword recognized in the name
     * @param writtenKey          pitch class of the key written in the name, if any
     * @param lowestWrittenPitch  lowest written note, a MIDI note number, in the notation of {@code transposition}
     * @param highestWrittenPitch highest written note
     */
    public record Suggestion(
        String keyword,
        Integer writtenKey,
        Integer transposition,
        Integer bassClefTransposition,
        Integer soundBank,
        Integer soundProgram,
        Integer percussionKey,
        Integer lowestWrittenPitch,
        Integer highestWrittenPitch
    ) {
        /**
         * The written range applies to an instrument with the transposition of the proposal: with another one it would
         * refer to a different notation, for example a bass written in treble clef.
         */
        public boolean rangeAppliesTo(Integer instrumentTransposition) {
            return lowestWrittenPitch != null && highestWrittenPitch != null && Objects.equals(instrumentTransposition, transposition);
        }
    }
}
