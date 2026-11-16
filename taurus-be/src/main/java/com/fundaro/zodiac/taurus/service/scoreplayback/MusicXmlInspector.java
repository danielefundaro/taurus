package com.fundaro.zodiac.taurus.service.scoreplayback;

import org.w3c.dom.Document;
import org.w3c.dom.Element;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.child;
import static com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.childElements;
import static com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.children;
import static com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlDocuments.text;

/**
 * Automatic checks of a single-part MusicXML score, shown next to a version and used to compare OMR results.
 * Every value counts occurrences; lists of measure numbers are capped to keep the stored JSON small.
 */
public final class MusicXmlInspector {

    static final int MAX_LISTED_MEASURES = 20;

    private MusicXmlInspector() {}

    public static ScoreChecks inspect(Document document) {
        Element root = document.getDocumentElement();
        List<Element> parts = children(root, "part");
        if (parts.isEmpty()) throw new MusicXmlDocuments.MusicXmlException("noParts");
        return inspect(parts.get(0));
    }

    /**
     * The checks of every part of a document with several parts, such as a score, by part id in the order of the file;
     * a part repeated with the same id keeps the checks of the first one.
     */
    public static Map<String, ScoreChecks> inspectParts(Document document) {
        Map<String, ScoreChecks> checks = new LinkedHashMap<>();
        for (Element part : children(document.getDocumentElement(), "part")) {
            checks.putIfAbsent(part.getAttribute("id"), inspect(part));
        }
        return checks;
    }

    private static ScoreChecks inspect(Element part) {
        Counter counter = new Counter();
        for (Element measure : children(part, "measure")) {
            counter.inspectMeasure(measure);
        }
        return counter.result();
    }

    private static final class Counter {

        private int measures;
        private int divisions = 1;
        private Integer beats;
        private Integer beatType;
        private final List<String> wrongDurationMeasures = new ArrayList<>();
        private int wrongDurationCount;
        private int clefChanges;
        private int octaveClefs;
        private boolean percussionClef;
        private int keyChanges;
        private int timeChanges;
        private int unusualTimeSignatures;
        private int forwardRepeats;
        private int backwardRepeats;
        private int endings;
        private int segni;
        private int codas;
        private int daCapo;
        private int dalSegno;
        private int fine;
        private boolean tempo;
        private int emptyMeasures;
        private int chordNotes;
        private int notes;
        private boolean firstAttributes = true;

        void inspectMeasure(Element measure) {
            measures++;
            long position = 0;
            long longest = 0;
            boolean hasNotes = false;
            for (Element element : childElements(measure)) {
                switch (element.getTagName()) {
                    case "attributes" -> inspectAttributes(element);
                    case "note" -> {
                        hasNotes = true;
                        if (child(element, "chord") != null) {
                            chordNotes++;
                            continue;
                        }
                        if (child(element, "rest") == null) notes++;
                        if (child(element, "grace") != null || child(element, "cue") != null) continue;
                        position += duration(element);
                        longest = Math.max(longest, position);
                    }
                    case "backup" -> position -= duration(element);
                    case "forward" -> {
                        position += duration(element);
                        longest = Math.max(longest, position);
                    }
                    case "barline" -> inspectBarline(element);
                    case "direction" -> inspectDirection(element);
                    case "sound" -> inspectSound(element);
                    default -> {
                        // Other measure content does not affect the checks.
                    }
                }
            }
            if (!hasNotes) emptyMeasures++;
            if (beats != null && beatType != null && beatType > 0 && !"yes".equals(measure.getAttribute("implicit"))) {
                long expected = (long) beats * divisions * 4 / beatType;
                if (hasNotes && longest != expected) {
                    wrongDurationCount++;
                    if (wrongDurationMeasures.size() < MAX_LISTED_MEASURES) wrongDurationMeasures.add(measure.getAttribute("number"));
                }
            }
        }

        private void inspectAttributes(Element attributes) {
            Element divisionsElement = child(attributes, "divisions");
            if (divisionsElement != null) divisions = Math.max(1, parseInt(text(divisionsElement), 1));
            for (Element clef : children(attributes, "clef")) {
                if (!firstAttributes) clefChanges++;
                if (child(clef, "clef-octave-change") != null) octaveClefs++;
                if ("percussion".equals(text(child(clef, "sign")))) percussionClef = true;
            }
            if (child(attributes, "key") != null && !firstAttributes) keyChanges++;
            Element time = child(attributes, "time");
            if (time != null) {
                if (!firstAttributes) timeChanges++;
                Integer timeBeats = parseFraction(text(child(time, "beats")));
                Integer timeBeatType = parseIntOrNull(text(child(time, "beat-type")));
                if (timeBeats != null && timeBeatType != null) {
                    beats = timeBeats;
                    beatType = timeBeatType;
                    if (timeBeatType > 8 || timeBeats > 16) unusualTimeSignatures++;
                }
            }
            firstAttributes = false;
        }

        private void inspectBarline(Element barline) {
            Element repeat = child(barline, "repeat");
            if (repeat != null) {
                if ("forward".equals(repeat.getAttribute("direction"))) forwardRepeats++;
                else backwardRepeats++;
            }
            Element ending = child(barline, "ending");
            if (ending != null && "start".equals(ending.getAttribute("type"))) endings++;
            if (child(barline, "segno") != null) segni++;
            if (child(barline, "coda") != null) codas++;
        }

        private void inspectDirection(Element direction) {
            for (Element type : children(direction, "direction-type")) {
                if (child(type, "segno") != null) segni++;
                if (child(type, "coda") != null) codas++;
                if (child(type, "metronome") != null) tempo = true;
            }
            Element sound = child(direction, "sound");
            if (sound != null) inspectSound(sound);
        }

        private void inspectSound(Element sound) {
            if (!sound.getAttribute("tempo").isEmpty()) tempo = true;
            if ("yes".equals(sound.getAttribute("dacapo"))) daCapo++;
            if (!sound.getAttribute("dalsegno").isEmpty()) dalSegno++;
            if (!sound.getAttribute("fine").isEmpty()) fine++;
        }

        ScoreChecks result() {
            return new ScoreChecks(
                measures,
                wrongDurationCount,
                List.copyOf(wrongDurationMeasures),
                clefChanges,
                octaveClefs,
                percussionClef,
                keyChanges,
                timeChanges,
                unusualTimeSignatures,
                forwardRepeats,
                backwardRepeats,
                Math.max(0, forwardRepeats - backwardRepeats),
                endings,
                segni,
                codas,
                daCapo,
                dalSegno,
                fine,
                tempo,
                emptyMeasures,
                notes,
                chordNotes
            );
        }

        private static long duration(Element element) {
            return parseInt(text(child(element, "duration")), 0);
        }

        private static int parseInt(String value, int fallback) {
            Integer parsed = parseIntOrNull(value);
            return parsed == null ? fallback : parsed;
        }

        private static Integer parseIntOrNull(String value) {
            if (value == null || value.isBlank()) return null;
            try {
                return Integer.parseInt(value.trim());
            } catch (NumberFormatException exception) {
                return null;
            }
        }

        /** Beats may be compound ("3+2"): the measure length is their sum. */
        private static Integer parseFraction(String value) {
            if (value == null || value.isBlank()) return null;
            int sum = 0;
            for (String part : value.split("\\+")) {
                Integer parsed = parseIntOrNull(part);
                if (parsed == null) return null;
                sum += parsed;
            }
            return sum;
        }
    }

    /**
     * Results of the automatic checks.
     *
     * @param measureCount          measures of the part
     * @param wrongDurationCount    measures whose length differs from the time signature (pick-up measures excluded)
     * @param wrongDurationMeasures numbers of the first measures with a wrong length
     * @param openRepeats           forward repeats without a matching backward repeat
     * @param notes                 pitched notes, chord members excluded
     * @param chordNotes            notes stacked on the previous one
     */
    public record ScoreChecks(
        int measureCount,
        int wrongDurationCount,
        List<String> wrongDurationMeasures,
        int clefChanges,
        int octaveClefs,
        boolean percussionClef,
        int keyChanges,
        int timeChanges,
        int unusualTimeSignatures,
        int forwardRepeats,
        int backwardRepeats,
        int openRepeats,
        int endings,
        int segni,
        int codas,
        int daCapo,
        int dalSegno,
        int fine,
        boolean tempo,
        int emptyMeasures,
        int notes,
        int chordNotes
    ) {
        /** Share of measures with a correct length, from 0 to 100. */
        public int correctDurationPercent() {
            return measureCount == 0 ? 0 : (int) Math.round(100.0 * (measureCount - wrongDurationCount) / measureCount);
        }
    }
}
