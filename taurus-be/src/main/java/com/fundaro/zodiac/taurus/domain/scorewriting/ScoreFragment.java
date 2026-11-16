package com.fundaro.zodiac.taurus.domain.scorewriting;

import com.fundaro.zodiac.taurus.domain.inventory.TenantAuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

/**
 * A fragment of the library of the tenant: whole measures written once and inserted in the parts, which receive a copy.
 * Removed logically; the name is unique among the fragments not removed, regardless of case.
 */
@Entity
@Table(name = "score_fragment")
public class ScoreFragment extends TenantAuditedEntity {

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false)
    private ScoreFragmentCategory category;

    @Column(name = "note", length = 500)
    private String note;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, updatable = false)
    private ScoreFragmentKind kind;

    /** Compressed MusicXML of one part, in concert pitch for a pitched fragment. */
    @Column(name = "content", nullable = false, updatable = false, columnDefinition = "bytea")
    private byte[] content;

    @Column(name = "measure_count", nullable = false, updatable = false)
    private Integer measureCount;

    /** Sound of each voice of a percussion fragment, as JSON; {@code null} for a pitched fragment. */
    @Column(name = "percussion_keys_json", updatable = false, columnDefinition = "text")
    private String percussionKeysJson;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public ScoreFragmentCategory getCategory() {
        return category;
    }

    public void setCategory(ScoreFragmentCategory category) {
        this.category = category;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public ScoreFragmentKind getKind() {
        return kind;
    }

    public void setKind(ScoreFragmentKind kind) {
        this.kind = kind;
    }

    public byte[] getContent() {
        return content;
    }

    public void setContent(byte[] content) {
        this.content = content;
    }

    public Integer getMeasureCount() {
        return measureCount;
    }

    public void setMeasureCount(Integer measureCount) {
        this.measureCount = measureCount;
    }

    public String getPercussionKeysJson() {
        return percussionKeysJson;
    }

    public void setPercussionKeysJson(String percussionKeysJson) {
        this.percussionKeysJson = percussionKeysJson;
    }
}
