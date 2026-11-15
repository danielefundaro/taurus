package com.fundaro.zodiac.taurus.service.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fundaro.zodiac.taurus.domain.Instruments;

/**
 * A DTO for the {@link Instruments} entity.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class InstrumentsDTO extends CommonFieldsOpenSearchDTO {

    /**
     * Quanti utenti hanno assegnato questo strumento. Valorizzato negli elenchi.
     */
    private Long usersCount;

    /** Semitones from written to sounding pitch; {@code null} while the instrument is not configured for playback. */
    private Integer transpositionSemitones;

    /** Semitones for parts written in bass clef, when different from {@link #transpositionSemitones}. */
    private Integer bassClefTranspositionSemitones;

    private Integer soundBank;

    private Integer soundProgram;

    /** General MIDI drum key: when present the instrument is unpitched percussion. */
    private Integer percussionKey;

    /** Lowest written note in the main transposition, as a MIDI note number (C4 = 60); present with the highest. */
    private Integer lowestWrittenPitch;

    private Integer highestWrittenPitch;

    /** Position in the ensemble of the band, from 1; {@code null} outside the ensemble. Read only: the ensemble has its own endpoint. */
    private Integer ensemblePosition;

    public Long getUsersCount() {
        return usersCount;
    }

    public void setUsersCount(Long usersCount) {
        this.usersCount = usersCount;
    }

    public Integer getTranspositionSemitones() {
        return transpositionSemitones;
    }

    public void setTranspositionSemitones(Integer transpositionSemitones) {
        this.transpositionSemitones = transpositionSemitones;
    }

    public Integer getBassClefTranspositionSemitones() {
        return bassClefTranspositionSemitones;
    }

    public void setBassClefTranspositionSemitones(Integer bassClefTranspositionSemitones) {
        this.bassClefTranspositionSemitones = bassClefTranspositionSemitones;
    }

    public Integer getSoundBank() {
        return soundBank;
    }

    public void setSoundBank(Integer soundBank) {
        this.soundBank = soundBank;
    }

    public Integer getSoundProgram() {
        return soundProgram;
    }

    public void setSoundProgram(Integer soundProgram) {
        this.soundProgram = soundProgram;
    }

    public Integer getPercussionKey() {
        return percussionKey;
    }

    public void setPercussionKey(Integer percussionKey) {
        this.percussionKey = percussionKey;
    }

    public Integer getLowestWrittenPitch() {
        return lowestWrittenPitch;
    }

    public void setLowestWrittenPitch(Integer lowestWrittenPitch) {
        this.lowestWrittenPitch = lowestWrittenPitch;
    }

    public Integer getHighestWrittenPitch() {
        return highestWrittenPitch;
    }

    public void setHighestWrittenPitch(Integer highestWrittenPitch) {
        this.highestWrittenPitch = highestWrittenPitch;
    }

    public Integer getEnsemblePosition() {
        return ensemblePosition;
    }

    public void setEnsemblePosition(Integer ensemblePosition) {
        this.ensemblePosition = ensemblePosition;
    }

    /** Whether parts of this instrument play with their own sound and transposition. */
    public boolean isPlaybackConfigured() {
        return percussionKey != null || (soundProgram != null && transpositionSemitones != null);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof InstrumentsDTO)) {
            return false;
        }

        return super.equals(o);
    }

    // prettier-ignore
    @Override
    public String toString() {
        return "InstrumentsDTO{" +
            "id=" + getId() +
            ", name='" + getName() + "'" +
            ", description='" + getDescription() + "'" +
            ", usersCount=" + getUsersCount() +
            ", transpositionSemitones=" + getTranspositionSemitones() +
            ", bassClefTranspositionSemitones=" + getBassClefTranspositionSemitones() +
            ", soundBank=" + getSoundBank() +
            ", soundProgram=" + getSoundProgram() +
            ", percussionKey=" + getPercussionKey() +
            ", lowestWrittenPitch=" + getLowestWrittenPitch() +
            ", highestWrittenPitch=" + getHighestWrittenPitch() +
            ", ensemblePosition=" + getEnsemblePosition() +
            "}";
    }
}
