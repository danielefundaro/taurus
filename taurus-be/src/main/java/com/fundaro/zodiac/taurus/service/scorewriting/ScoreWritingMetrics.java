package com.fundaro.zodiac.taurus.service.scorewriting;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

import java.util.Locale;

/** Saves, drafts and edit locks of the music editors; tags never carry tenant data or contents. */
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
}
