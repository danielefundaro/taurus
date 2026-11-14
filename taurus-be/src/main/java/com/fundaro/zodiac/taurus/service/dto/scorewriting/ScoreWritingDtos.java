package com.fundaro.zodiac.taurus.service.dto.scorewriting;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus;

import java.time.ZonedDateTime;
import java.util.List;

/** Data exchanged by the edit lock, draft and engraving endpoints of the music writing editor. */
public final class ScoreWritingDtos {

    private ScoreWritingDtos() {}

    /**
     * The editor session asking for the lock: a random identifier chosen by the browser when the editor opens, so that
     * two windows of the same user exclude each other.
     */
    public record EditLockRequestDTO(String session) {}

    /**
     * The edit lock of a part.
     *
     * @param ownerName name of the author, {@code null} when unknown
     * @param since     when the author took the lock
     * @param expiresAt when the lock expires without a renewal
     * @param mine      the lock is held by the session of the request
     */
    public record EditLockDTO(String ownerName, ZonedDateTime since, ZonedDateTime expiresAt, boolean mine) {}

    /**
     * A draft to save.
     *
     * @param editSession   session of the editor, which must hold the lock
     * @param content       plain MusicXML with a single part
     * @param baseVersionId version the writing started from, {@code null} for a part without versions
     * @param entityVersion version of the draft the editor is replacing, {@code null} when it starts a new draft
     */
    public record DraftRequestDTO(String editSession, String content, Long baseVersionId, Long entityVersion) {}

    /**
     * The draft of a part, for the editor.
     *
     * @param content  plain MusicXML with a single part
     * @param savedBy  name of the author of the last save, {@code null} when unknown
     * @param outdated another version became the current one of the part after the writing started
     */
    public record ScoreDraftDTO(
        String content,
        Long baseVersionId,
        int measureCount,
        String savedBy,
        ZonedDateTime savedAt,
        long entityVersion,
        boolean outdated
    ) {}

    /** A saved draft: the version to send with the next save. */
    public record DraftSavedDTO(long entityVersion, ZonedDateTime savedAt) {}

    /**
     * A part written from scratch, to add at the end of the track.
     *
     * @param description   description of the part, {@code null} for none
     * @param instrumentIds instruments of the part, in order
     * @param content       plain MusicXML with a single part: the first draft of the part
     * @param trackVersion  version of the track shown to the author, {@code null} to skip the check
     */
    public record NewWrittenPartDTO(String description, List<Long> instrumentIds, String content, Long trackVersion) {}

    /**
     * A part created for the writing editor.
     *
     * @param scoreId      id of the new part
     * @param trackVersion version of the track after the part was added
     */
    public record WrittenPartDTO(Long scoreId, Long trackVersion) {}

    /**
     * A draft shown among the parts of the track, without its content.
     *
     * @param savedBy  name of the author of the last save, {@code null} when unknown
     * @param outdated another version became the current one of the part after the writing started
     */
    public record DraftSummaryDTO(String savedBy, ZonedDateTime savedAt, boolean outdated) {}

    /** Page format of an engraving: A4 portrait or landscape, or the march card of 18 x 13 cm in landscape. */
    public enum EngravingFormat {
        A4_PORTRAIT,
        A4_LANDSCAPE,
        MARCH,
    }

    /** Measure numbers of an engraving: at the start of every system, above every measure for study parts, or none. */
    public enum MeasureNumbers {
        SYSTEM,
        EVERY,
        NONE,
    }

    /** Where the engraved pages go: in place of the pages of the part, or in a new part at the end of the track. */
    public enum EngravingTarget {
        REPLACE,
        NEW_PART,
    }

    /** Texts of the header of the first page; an empty or missing text is left out. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record EngravingHeaderDTO(String title, String composer, String arranger, String partName) {}

    /**
     * Options of an engraving; a missing value takes the default of the music service.
     *
     * @param staffSize height of the staff in millimetres, from 4 to 9.6
     * @param margin    margins in millimetres, from 3 to 30
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record EngravingOptionsDTO(
        EngravingFormat format,
        Double staffSize,
        Double margin,
        EngravingHeaderDTO header,
        Boolean pageNumbers,
        MeasureNumbers measureNumbers
    ) {}

    /**
     * An engraving of a version of a part.
     *
     * @param errorCode      why the job failed: a code of the music service such as {@code tooManyPages} or
     *                       {@code engineTimeout}, or {@code serviceUnavailable}, {@code versionNotFound},
     *                       {@code interrupted}, {@code unexpected}
     * @param pages          media ids of the engraved pages waiting to be assigned, in order; empty once assigned or
     *                       released
     * @param pdf            the PDF of the engraving can be downloaded
     * @param appliedScoreId part that received the pages
     */
    public record EngravingJobDTO(
        Long id,
        Long scoreId,
        Long versionId,
        ScoreEngravingJobStatus status,
        String errorCode,
        int attempts,
        EngravingOptionsDTO options,
        Integer pageCount,
        List<Long> pages,
        boolean pdf,
        ZonedDateTime requestedAt,
        ZonedDateTime startedAt,
        ZonedDateTime finishedAt,
        ZonedDateTime appliedAt,
        Long appliedScoreId
    ) {}

    /**
     * Assignment of the engraved pages.
     *
     * @param trackVersion version of the track shown to the archivist, {@code null} to skip the check
     */
    public record ApplyEngravingDTO(EngravingTarget target, Long trackVersion) {}

    /**
     * Engraved pages assigned to a part.
     *
     * @param scoreId      part that received the pages: the engraved one or the new part
     * @param trackVersion version of the track after the assignment
     */
    public record EngravingAppliedDTO(Long scoreId, Long trackVersion) {}
}
