package com.fundaro.zodiac.taurus.domain.scoreplayback;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

import java.time.ZonedDateTime;

/**
 * What the archivists corrected in a version of a recognition engine: the counts of the comparison, made in the browser,
 * between that version and the latest approved version descending from it. One for each version of an engine; a later
 * approval replaces it. Nothing of the score is stored.
 */
@Entity
@Table(name = "score_recognition_review")
public class ScoreRecognitionReview extends TenantAuditedEntity {

    @Column(name = "sheet_music_id", nullable = false, updatable = false)
    private Long sheetMusicId;

    @Column(name = "engine_version_id", nullable = false, updatable = false)
    private Long engineVersionId;

    @Column(name = "approved_version_id", nullable = false)
    private Long approvedVersionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "engine", nullable = false, updatable = false)
    private RecognitionEngine engine;

    /** When the engine produced its version: the months of the report follow it, so an update of the engines shows. */
    @Column(name = "recognized_at", nullable = false, updatable = false)
    private ZonedDateTime recognizedAt;

    @Column(name = "approved_at", nullable = false)
    private ZonedDateTime approvedAt;

    @Column(name = "reference_measures", nullable = false)
    private int referenceMeasures;

    @Column(name = "engine_measures", nullable = false)
    private int engineMeasures;

    @Column(name = "correct_measures", nullable = false)
    private int correctMeasures;

    @Column(name = "pitch_measures", nullable = false)
    private int pitchMeasures;

    @Column(name = "rhythm_measures", nullable = false)
    private int rhythmMeasures;

    @Column(name = "tie_measures", nullable = false)
    private int tieMeasures;

    @Column(name = "missing_measures", nullable = false)
    private int missingMeasures;

    @Column(name = "extra_measures", nullable = false)
    private int extraMeasures;

    @Column(name = "reference_marks", nullable = false)
    private int referenceMarks;

    @Column(name = "found_marks", nullable = false)
    private int foundMarks;

    public Long getSheetMusicId() {
        return sheetMusicId;
    }

    public void setSheetMusicId(Long sheetMusicId) {
        this.sheetMusicId = sheetMusicId;
    }

    public Long getEngineVersionId() {
        return engineVersionId;
    }

    public void setEngineVersionId(Long engineVersionId) {
        this.engineVersionId = engineVersionId;
    }

    public Long getApprovedVersionId() {
        return approvedVersionId;
    }

    public void setApprovedVersionId(Long approvedVersionId) {
        this.approvedVersionId = approvedVersionId;
    }

    public RecognitionEngine getEngine() {
        return engine;
    }

    public void setEngine(RecognitionEngine engine) {
        this.engine = engine;
    }

    public ZonedDateTime getRecognizedAt() {
        return recognizedAt;
    }

    public void setRecognizedAt(ZonedDateTime recognizedAt) {
        this.recognizedAt = recognizedAt;
    }

    public ZonedDateTime getApprovedAt() {
        return approvedAt;
    }

    public void setApprovedAt(ZonedDateTime approvedAt) {
        this.approvedAt = approvedAt;
    }

    public int getReferenceMeasures() {
        return referenceMeasures;
    }

    public void setReferenceMeasures(int referenceMeasures) {
        this.referenceMeasures = referenceMeasures;
    }

    public int getEngineMeasures() {
        return engineMeasures;
    }

    public void setEngineMeasures(int engineMeasures) {
        this.engineMeasures = engineMeasures;
    }

    public int getCorrectMeasures() {
        return correctMeasures;
    }

    public void setCorrectMeasures(int correctMeasures) {
        this.correctMeasures = correctMeasures;
    }

    public int getPitchMeasures() {
        return pitchMeasures;
    }

    public void setPitchMeasures(int pitchMeasures) {
        this.pitchMeasures = pitchMeasures;
    }

    public int getRhythmMeasures() {
        return rhythmMeasures;
    }

    public void setRhythmMeasures(int rhythmMeasures) {
        this.rhythmMeasures = rhythmMeasures;
    }

    public int getTieMeasures() {
        return tieMeasures;
    }

    public void setTieMeasures(int tieMeasures) {
        this.tieMeasures = tieMeasures;
    }

    public int getMissingMeasures() {
        return missingMeasures;
    }

    public void setMissingMeasures(int missingMeasures) {
        this.missingMeasures = missingMeasures;
    }

    public int getExtraMeasures() {
        return extraMeasures;
    }

    public void setExtraMeasures(int extraMeasures) {
        this.extraMeasures = extraMeasures;
    }

    public int getReferenceMarks() {
        return referenceMarks;
    }

    public void setReferenceMarks(int referenceMarks) {
        this.referenceMarks = referenceMarks;
    }

    public int getFoundMarks() {
        return foundMarks;
    }

    public void setFoundMarks(int foundMarks) {
        this.foundMarks = foundMarks;
    }
}
