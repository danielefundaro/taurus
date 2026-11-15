package com.fundaro.zodiac.taurus.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;
import org.hibernate.annotations.SoftDelete;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
@Entity
@Table(name = "sheet_music")
@SQLDelete(sql = "UPDATE sheet_music SET deleted = true WHERE id = ? AND deleted = false")
@SQLRestriction("deleted = false")
public class SheetsMusic extends AuditFields implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "description", columnDefinition = "text")
    private String description;

    @Transient
    private Long order;

    @ManyToMany
    @JoinTable(name = "sheet_music_media", joinColumns = @JoinColumn(name = "sheet_music_id"), inverseJoinColumns = @JoinColumn(name = "media_asset_id"))
    @OrderColumn(name = "display_order")
    @SoftDelete(columnName = "deleted")
    private List<Media> media = new ArrayList<>();

    @ManyToMany
    @JoinTable(name = "sheet_music_instrument", joinColumns = @JoinColumn(name = "sheet_music_id"), inverseJoinColumns = @JoinColumn(name = "instrument_id"))
    @OrderColumn(name = "display_order")
    @SoftDelete(columnName = "deleted")
    private List<Instruments> instruments = new ArrayList<>();

    @Column(name = "needs_review", nullable = false)
    private Boolean needsReview = Boolean.FALSE;

    /** Score version played for this part; managed by the score playback services, not by the track form. */
    @Column(name = "current_score_version_id")
    private Long currentScoreVersionId;

    @Column(name = "transposition_override")
    private Integer transpositionOverride;

    @Column(name = "sound_bank_override")
    private Integer soundBankOverride;

    @Column(name = "sound_program_override")
    private Integer soundProgramOverride;

    /** Version the pages were engraved from; it holds only while the pages match {@link #engravedPagesFingerprint}. */
    @Column(name = "engraved_from_version_id")
    private Long engravedFromVersionId;

    /** Fingerprint of the engraved pages, to tell when the pages were changed in another way. */
    @Column(name = "engraved_pages_fingerprint")
    private String engravedPagesFingerprint;

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Long getOrder() {
        return order;
    }

    public void setOrder(Long order) {
        this.order = order;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public List<Media> getMedia() {
        return media;
    }

    public void setMedia(List<Media> media) {
        this.media = media;
    }

    public List<Instruments> getInstruments() {
        return instruments;
    }

    public void setInstruments(List<Instruments> instruments) {
        this.instruments = instruments;
    }

    public Boolean getNeedsReview() {
        return needsReview;
    }

    public Long getCurrentScoreVersionId() {
        return currentScoreVersionId;
    }

    public void setCurrentScoreVersionId(Long currentScoreVersionId) {
        this.currentScoreVersionId = currentScoreVersionId;
    }

    public Integer getTranspositionOverride() {
        return transpositionOverride;
    }

    public void setTranspositionOverride(Integer transpositionOverride) {
        this.transpositionOverride = transpositionOverride;
    }

    public Integer getSoundBankOverride() {
        return soundBankOverride;
    }

    public void setSoundBankOverride(Integer soundBankOverride) {
        this.soundBankOverride = soundBankOverride;
    }

    public Integer getSoundProgramOverride() {
        return soundProgramOverride;
    }

    public void setSoundProgramOverride(Integer soundProgramOverride) {
        this.soundProgramOverride = soundProgramOverride;
    }

    public Long getEngravedFromVersionId() {
        return engravedFromVersionId;
    }

    public void setEngravedFromVersionId(Long engravedFromVersionId) {
        this.engravedFromVersionId = engravedFromVersionId;
    }

    public String getEngravedPagesFingerprint() {
        return engravedPagesFingerprint;
    }

    public void setEngravedPagesFingerprint(String engravedPagesFingerprint) {
        this.engravedPagesFingerprint = engravedPagesFingerprint;
    }

    public void setNeedsReview(Boolean needsReview) {
        this.needsReview = Boolean.TRUE.equals(needsReview);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof SheetsMusic)) {
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
        return "{" +
            "description='" + getDescription() + "'" +
            ", order=" + getOrder() +
            ", media=" + getMedia() +
            ", instruments=" + getInstruments() +
            "}";
    }
}
