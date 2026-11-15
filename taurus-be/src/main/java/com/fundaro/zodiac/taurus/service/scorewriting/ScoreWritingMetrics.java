package com.fundaro.zodiac.taurus.service.scorewriting;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Locale;

/** Saves, drafts, edit locks, engravings and extractions of the music editors; tags never carry tenant data or contents. */
@Component
public class ScoreWritingMetrics {

    private static final String PREFIX = "taurus.score.writing.";

    private final MeterRegistry registry;

    public ScoreWritingMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /** A version saved by an editor: origin {@code writing} or {@code correction}. */
    public void save(String origin) {
        registry.counter(PREFIX + "saves", "origin", origin.toLowerCase(Locale.ROOT)).increment();
    }

    /** A draft: outcome {@code saved}, {@code rejected} or {@code discarded}. */
    public void draft(String outcome) {
        registry.counter(PREFIX + "drafts", "outcome", outcome).increment();
    }

    /** An edit lock: outcome {@code acquired}, {@code takenOver}, {@code expired} (taken after the expiry) or {@code refused}. */
    public void lock(String outcome) {
        registry.counter(PREFIX + "locks", "outcome", outcome).increment();
    }

    /**
     * A finished engraving job: outcome {@code done} or the error code of the job, a small fixed set such as
     * {@code tooManyPages}, {@code engineTimeout} or {@code serviceUnavailable}.
     */
    public void engraving(String outcome) {
        registry.counter("taurus.score.engravings", "outcome", outcome).increment();
    }

    /** Time the music service took for an engraving that produced pages. */
    public void engravingDuration(Duration duration) {
        registry.timer("taurus.score.engraving.duration").record(duration);
    }

    /** Engraved pages assigned to a part: target {@code replace}, {@code newPart} or {@code emptyPart}, when the job assigns them. */
    public void engravingApplied(String target) {
        registry.counter("taurus.score.engravings.applied", "target", target).increment();
    }

    /** A part extracted from the score of its track: target {@code existing} or {@code newPart}. */
    public void extraction(String target) {
        registry.counter("taurus.score.arrangement.extractions", "target", target).increment();
    }
}
