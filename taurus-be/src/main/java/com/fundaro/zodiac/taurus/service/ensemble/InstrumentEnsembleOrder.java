package com.fundaro.zodiac.taurus.service.ensemble;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentFamily;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackCatalog;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester;

import java.text.Normalizer;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Reference order of the ensemble of a band, from the family and the order of the catalogue entry recognized in the name
 * of each instrument.
 * <p>
 * Within an entry the instruments are grouped by the keyword recognized, in the order of the catalogue ("Tromba" before
 * "Cornetta"), and numbered instruments ("Flauto 1°", "Clarinetto II", "Primo corno") follow their number, an instrument
 * without number coming first. At equal reference the current position is kept, and the instruments the catalogue does
 * not place go after the others.
 */
public final class InstrumentEnsembleOrder {

    private static final Pattern MARKS = Pattern.compile("\\p{M}+");
    private static final Pattern SEPARATORS = Pattern.compile("[^a-z0-9]+");
    private static final Pattern DIGITS = Pattern.compile("\\d{1,6}");
    private static final Map<String, Integer> NUMBER_WORDS = Map.ofEntries(
        Map.entry("i", 1),
        Map.entry("ii", 2),
        Map.entry("iii", 3),
        Map.entry("iv", 4),
        Map.entry("primo", 1),
        Map.entry("prima", 1),
        Map.entry("secondo", 2),
        Map.entry("seconda", 2),
        Map.entry("terzo", 3),
        Map.entry("terza", 3),
        Map.entry("quarto", 4),
        Map.entry("quarta", 4)
    );

    private static final Comparator<Key> ORDER = Comparator
        .comparing((Key key) -> key.entry() == null)
        .thenComparingInt(key -> key.entry() == null ? 0 : key.entry().ensembleOrder())
        .thenComparingInt(Key::keyword)
        .thenComparingInt(Key::number)
        .thenComparing(Key::position, Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(Key::name)
        .thenComparing(Key::id, Comparator.nullsLast(Comparator.naturalOrder()));

    private InstrumentEnsembleOrder() {}

    /** The instruments in the reference order. */
    public static List<Instruments> sort(List<Instruments> instruments) {
        return instruments.stream().map(Key::of).sorted(ORDER).map(Key::instrument).toList();
    }

    /** The family of the band recognized in the name, empty when the catalogue does not place the instrument. */
    public static Optional<InstrumentFamily> family(String name) {
        return placed(name).map(match -> match.entry().family());
    }

    /**
     * The number of an instrument of a section: the first number of the name, with or without the ordinal sign, or a
     * roman numeral or ordinal word up to four; {@code 0} without number.
     */
    static int number(String name) {
        if (name == null) return 0;
        String text = MARKS.matcher(Normalizer.normalize(name.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)).replaceAll("");
        for (String token : SEPARATORS.split(text)) {
            if (DIGITS.matcher(token).matches()) return Integer.parseInt(token);
            if (NUMBER_WORDS.containsKey(token)) return NUMBER_WORDS.get(token);
        }
        return 0;
    }

    private static Optional<InstrumentPlaybackSuggester.Match> placed(String name) {
        return InstrumentPlaybackSuggester.match(name).filter(match -> match.entry().family() != null && match.entry().ensembleOrder() != null);
    }

    private record Key(
        Instruments instrument,
        InstrumentPlaybackCatalog.Entry entry,
        int keyword,
        int number,
        Integer position,
        String name,
        Long id
    ) {
        static Key of(Instruments instrument) {
            String name = instrument.getName() == null ? "" : instrument.getName();
            InstrumentPlaybackSuggester.Match match = placed(name).orElse(null);
            return new Key(
                instrument,
                match == null ? null : match.entry(),
                match == null ? 0 : match.entry().keywords().indexOf(match.keyword()),
                InstrumentEnsembleOrder.number(name),
                instrument.getEnsemblePosition(),
                name.toLowerCase(Locale.ROOT),
                instrument.getId()
            );
        }
    }
}
