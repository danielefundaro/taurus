package com.fundaro.zodiac.taurus.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.util.Date;

/**
 * A Instruments.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@Entity
@Table(name = "instrument")
public class Instruments extends CommonFieldsOpenSearch {

    @Column(name = "transposition_semitones")
    private Integer transpositionSemitones;

    @Column(name = "bass_clef_transposition_semitones")
    private Integer bassClefTranspositionSemitones;

    @Column(name = "sound_bank")
    private Integer soundBank;

    @Column(name = "sound_program")
    private Integer soundProgram;

    @Column(name = "percussion_key")
    private Integer percussionKey;

    /** Lowest written note in the main transposition, as a MIDI note number; present together with the highest. */
    @Column(name = "lowest_written_pitch")
    private Integer lowestWrittenPitch;

    @Column(name = "highest_written_pitch")
    private Integer highestWrittenPitch;

    /**
     * Position in the ensemble of the band, from 1 without gaps; {@code null} outside the ensemble. Only the ensemble
     * queries of the repository write it, so saving an instrument never overwrites a new order.
     */
    @Column(name = "ensemble_position", insertable = false, updatable = false)
    private Integer ensemblePosition;

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

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Instruments)) {
            return false;
        }

        return super.equals(o);
    }

    @Override
    public int hashCode() {
        // see https://vladmihalcea.com/how-to-implement-equals-and-hashcode-using-the-jpa-entity-identifier/
        return getClass().hashCode();
    }

    // prettier-ignore
    @Override
    public String toString() {
        return "Instruments{" +
            "id=" + getId() +
            ", deleted='" + getDeleted() + "'" +
            ", insertBy='" + getInsertBy() + "'" +
            ", insertDate='" + getInsertDate() + "'" +
            ", editBy='" + getEditBy() + "'" +
            ", editDate='" + getEditDate() + "'" +
            ", name='" + getName() + "'" +
            ", description='" + getDescription() + "'" +
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
