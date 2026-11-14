package com.fundaro.zodiac.taurus.domain.scorewriting;

public enum ScoreEngravingJobStatus {
    QUEUED,
    RUNNING,
    DONE,
    FAILED;

    public boolean isActive() {
        return this == QUEUED || this == RUNNING;
    }
}
