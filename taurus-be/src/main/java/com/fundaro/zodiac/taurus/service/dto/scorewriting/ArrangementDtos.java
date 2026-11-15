package com.fundaro.zodiac.taurus.service.dto.scorewriting;

import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PlaybackInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSummaryDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector.ScoreChecks;

import java.time.ZonedDateTime;
import java.util.List;

/** Data exchanged by the endpoints of the score of a track: the score, its drafts, versions and extraction. */
public final class ArrangementDtos {

    private ArrangementDtos() {}

    /**
     * A row of a score sent by the editor, for each part of the MusicXML in the same order.
     *
     * @param id            id of the part of the row in the MusicXML
     * @param instrumentIds instruments of the row: one, or several percussion instruments
     * @param scoreId       part of the track the row was made from, read only when the score is created: the row stays
     *                      linked to it when the part has the same instruments
     */
    public record ArrangementRowRequestDTO(String id, List<Long> instrumentIds, Long scoreId) {}

    /**
     * A new score of the track, with its first draft.
     *
     * @param content plain MusicXML with one part for each row
     */
    public record NewArrangementDTO(String content, List<ArrangementRowRequestDTO> rows) {}

    /**
     * A draft of the score to save.
     *
     * @param editSession   session of the editor, which must hold the lock of the score
     * @param content       plain MusicXML with one part for each row
     * @param baseVersionId version the writing started from, {@code null} for a score without versions
     * @param entityVersion version of the draft the editor is replacing, {@code null} when it starts a new draft
     */
    public record ArrangementDraftRequestDTO(
        String editSession,
        String content,
        List<ArrangementRowRequestDTO> rows,
        Long baseVersionId,
        Long entityVersion
    ) {}

    /**
     * A version of the score to save, from the editor that holds the lock.
     *
     * @param parentVersionId version the writing started from, {@code null} for the first version
     * @param confirmOutdated the author confirmed that the version replaces one saved meanwhile
     */
    public record ArrangementVersionRequestDTO(
        String editSession,
        String content,
        List<ArrangementRowRequestDTO> rows,
        Long parentVersionId,
        boolean approve,
        boolean confirmOutdated
    ) {}

    /**
     * A row of a draft or of a version of the score.
     *
     * @param id   id of the part of the row in the MusicXML
     * @param name name of the part in the MusicXML, {@code null} when it has none
     */
    public record ArrangementRowDTO(String id, String name, List<PlaybackInstrumentDTO> instruments) {}

    /**
     * The draft of the score, for the editor.
     *
     * @param content  plain MusicXML with one part for each row
     * @param savedBy  name of the author of the last save, {@code null} when unknown
     * @param outdated another version became the current one of the score after the writing started
     */
    public record ArrangementDraftDTO(
        String content,
        List<ArrangementRowDTO> rows,
        Long baseVersionId,
        int measureCount,
        String savedBy,
        ZonedDateTime savedAt,
        long entityVersion,
        boolean outdated
    ) {}

    /** The automatic checks of a row of a version. */
    public record RowChecksDTO(String row, ScoreChecks checks) {}

    /**
     * A version of the score.
     *
     * @param concertPitch written in concert pitch, transposed otherwise
     * @param current      the version shown and extracted
     */
    public record ArrangementVersionDTO(
        Long id,
        int versionNumber,
        ScoreVersionStatus status,
        boolean concertPitch,
        int measureCount,
        List<RowChecksDTO> checks,
        Long parentVersionId,
        ZonedDateTime createdAt,
        ZonedDateTime approvedAt,
        boolean current
    ) {}

    /** How the part of a row stands against the current version of the score. */
    public enum ArrangementRowStatus {
        /** The row has no part: the extraction creates one. */
        NEW,
        /** The part was never extracted from this score, or the score has a newer version than the last extraction. */
        TO_EXTRACT,
        /** The current version of the part is the one extracted from the current version of the score. */
        UP_TO_DATE,
        /** The part has a version more recent than the extracted one, for example a correction. */
        MODIFIED,
        /** The part of the row was removed from the track: the extraction creates a new one. */
        PART_DELETED,
    }

    /**
     * A row of the score with the state of its part.
     *
     * @param scoreId part of the track linked to the row, {@code null} without one
     */
    public record ArrangementRowStateDTO(
        String id,
        String name,
        List<PlaybackInstrumentDTO> instruments,
        Long scoreId,
        ArrangementRowStatus status
    ) {}

    /**
     * The score of a track.
     *
     * @param currentVersion current version, {@code null} before the first save
     * @param rows           rows of the current version, or of the draft before the first save
     * @param draft          the draft, without its content, {@code null} without one
     * @param editing        who is writing the score, {@code null} when nobody is
     */
    public record ArrangementDTO(
        Long id,
        Long trackId,
        ArrangementVersionDTO currentVersion,
        List<ArrangementRowStateDTO> rows,
        DraftSummaryDTO draft,
        EditLockDTO editing
    ) {}

    /**
     * A row to extract.
     *
     * @param row          id of the row in the version of the score
     * @param sheetMusicId part of the track that receives the version, {@code null} for a new part
     * @param description  description of a new part, {@code null} for none
     * @param content      plain MusicXML with the single part extracted in the browser
     */
    public record ExtractedRowDTO(String row, Long sheetMusicId, String description, String content) {}

    /**
     * An extraction of parts from the current version of the score.
     *
     * @param trackVersion version of the track shown to the author, {@code null} to skip the check
     */
    public record ExtractionRequestDTO(Long trackVersion, List<ExtractedRowDTO> rows) {}

    /**
     * A part that received an extracted version.
     *
     * @param created the part was created by the extraction
     */
    public record ExtractedPartDTO(String row, Long scoreId, Long versionId, boolean created) {}

    /**
     * The result of an extraction.
     *
     * @param trackVersion version of the track after the extraction
     */
    public record ExtractionResultDTO(List<ExtractedPartDTO> parts, Long trackVersion) {}
}
