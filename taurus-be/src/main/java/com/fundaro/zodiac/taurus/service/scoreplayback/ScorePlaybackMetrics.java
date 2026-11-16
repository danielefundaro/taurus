package com.fundaro.zodiac.taurus.service.scoreplayback;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Recognition, review, upload and error report metrics; tags never carry tenant data, file contents or report texts. */
@Component
public class ScorePlaybackMetrics {

    private static final String PREFIX = "taurus.score.";

    private final MeterRegistry registry;

    public ScorePlaybackMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /** Outcome and duration of one engine on one job. */
    public void engine(String engine, boolean succeeded, long durationMillis) {
        String tag = tag(engine);
        registry.counter(PREFIX + "recognition", "engine", tag, "outcome", succeeded ? "done" : "failed").increment();
        Timer.builder(PREFIX + "recognition.duration").tag("engine", tag).register(registry).record(durationMillis, TimeUnit.MILLISECONDS);
    }

    /** End of a job: {@code done} or the error code. */
    public void job(String outcome) {
        registry.counter(PREFIX + "recognition.jobs", "outcome", tag(outcome)).increment();
    }

    /**
     * A new version from a file or from the editor: format {@code musicxml}, {@code midi} or {@code correction}, outcome
     * {@code stored}, {@code rejected} or {@code unavailable}.
     */
    public void upload(String format, String outcome) {
        registry.counter(PREFIX + "upload", "format", format, "outcome", outcome).increment();
    }

    /** An error report: outcome {@code created}, {@code closed} or {@code approved} (closed by the approval of a version). */
    public void errorReport(String outcome, int count) {
        registry.counter(PREFIX + "error_reports", "outcome", outcome).increment(count);
    }

    /**
     * The first review of a version of an engine, summed over all tenants: its measures by outcome ({@code correct},
     * {@code pitch}, {@code rhythm}, {@code tie}, {@code missing}, {@code extra}) and its structure marks ({@code found},
     * {@code missed}). A later approval of the same version replaces the review without counting it again.
     */
    public void recognitionReview(String engine, Map<String, Integer> measures, int foundMarks, int missedMarks) {
        String tag = tag(engine);
        measures.forEach((outcome, count) -> registry.counter(PREFIX + "recognition.measures", "engine", tag, "outcome", outcome).increment(count));
        registry.counter(PREFIX + "recognition.marks", "engine", tag, "outcome", "found").increment(foundMarks);
        registry.counter(PREFIX + "recognition.marks", "engine", tag, "outcome", "missed").increment(missedMarks);
    }

    private static String tag(String value) {
        return value == null ? "unknown" : value.toLowerCase(Locale.ROOT);
    }
}
