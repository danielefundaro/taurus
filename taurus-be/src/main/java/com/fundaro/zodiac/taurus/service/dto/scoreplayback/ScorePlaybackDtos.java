package com.fundaro.zodiac.taurus.service.dto.scoreplayback;

import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreErrorReportClosure;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreErrorReportStatus;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreRecognitionJobStatus;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.DraftSummaryDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreWritingDtos.EditLockDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector.ScoreChecks;

import java.time.ZonedDateTime;
import java.util.List;

/** Data exchanged by the score playback endpoints. */
public final class ScorePlaybackDtos {

    private ScorePlaybackDtos() {}

    /** Whether a part can be listened to by the current user. */
    public enum Availability {
        AVAILABLE,
        NOT_AVAILABLE,
    }

    /**
     * A version of a part.
     *
     * @param current      the version played for the part
     * @param pagesChanged the pages of the part changed after the version was produced
     */
    public record ScoreVersionDTO(
        Long id,
        Long scoreId,
        int versionNumber,
        ScoreVersionOrigin origin,
        ScoreVersionStatus status,
        int measureCount,
        ScoreChecks checks,
        String sourceFileName,
        String sourcePartName,
        Long parentVersionId,
        ZonedDateTime createdAt,
        ZonedDateTime approvedAt,
        boolean current,
        boolean pagesChanged
    ) {}

    /** A part found in an uploaded MusicXML file. */
    public record MusicXmlPartDTO(String id, String name, int measureCount) {}

    /** An instrument assigned to a part, with its playback settings. */
    public record PlaybackInstrumentDTO(
        Long id,
        String name,
        Integer transpositionSemitones,
        Integer bassClefTranspositionSemitones,
        Integer soundBank,
        Integer soundProgram,
        Integer percussionKey,
        boolean configured
    ) {}

    /**
     * Sound and transposition resolved for a part: part overrides first, then the first assigned instrument.
     *
     * @param percussionKeys drum keys of the assigned percussion instruments, in order: voice 1 uses the first one
     * @param configured     the part plays with its own sound; otherwise playback falls back to a neutral sound
     * @param conflicting    the assigned instruments have different settings and no override decides
     */
    public record PlaybackSoundDTO(
        Integer transpositionSemitones,
        Integer bassClefTranspositionSemitones,
        Integer soundBank,
        Integer soundProgram,
        List<Integer> percussionKeys,
        boolean configured,
        boolean conflicting
    ) {}

    /** Overrides stored on the part, editable by archivists and administrators. */
    public record PartPlaybackSettingsDTO(Integer transpositionOverride, Integer soundBankOverride, Integer soundProgramOverride) {}

    /** Version played for a part, as shown to listeners. */
    public record PlaybackVersionDTO(
        Long id,
        int versionNumber,
        ScoreVersionStatus status,
        ScoreVersionOrigin origin,
        int measureCount,
        ScoreChecks checks,
        boolean pagesChanged
    ) {}

    /**
     * Outcome of one engine in a recognition job.
     *
     * @param versionId version created from what the engine read, if it succeeded
     * @param proposed  the version was chosen as the proposal of the job
     */
    public record EngineOutcomeDTO(String engine, String version, String status, String errorCode, long durationMillis, Long versionId, boolean proposed) {}

    /**
     * A recognition job of a part.
     *
     * @param errorCode why the job failed: an engine or service code such as {@code engineTimeout}, or {@code noPages},
     *                  {@code interrupted}, {@code unexpected}
     */
    public record RecognitionJobDTO(
        Long id,
        Long scoreId,
        ScoreRecognitionJobStatus status,
        String errorCode,
        int attempts,
        ZonedDateTime requestedAt,
        ZonedDateTime startedAt,
        ZonedDateTime finishedAt,
        List<EngineOutcomeDTO> engines
    ) {}

    /**
     * A part of the track for the player.
     *
     * @param ownPart     the part belongs to one of the user's instruments: its notation is shown to standard users
     * @param settings    overrides of the part, returned to archivists and administrators only
     * @param hasPages    the part has page images that can be recognized
     * @param recognition latest recognition job of the part, returned to archivists and administrators only
     * @param openReports error reports of the part still open, counted for archivists and administrators only
     * @param editing     who is editing the part in an editor, returned to archivists and administrators only
     * @param draft       draft of the writing editor, returned to archivists and administrators only
     */
    public record PartPlaybackDTO(
        Long scoreId,
        int order,
        String description,
        List<PlaybackInstrumentDTO> instruments,
        boolean ownPart,
        PlaybackSoundDTO sound,
        Availability availability,
        PlaybackVersionDTO version,
        PartPlaybackSettingsDTO settings,
        boolean hasPages,
        RecognitionJobDTO recognition,
        int openReports,
        EditLockDTO editing,
        DraftSummaryDTO draft
    ) {}

    /**
     * Everything the player needs to know about a track.
     *
     * @param recognitionAvailable the OMR service is configured and the user can start recognitions and upload MIDI files
     */
    public record TrackPlaybackDTO(
        Long trackId,
        String trackName,
        Long version,
        Integer tempoBpm,
        Long referenceScoreId,
        List<PartPlaybackDTO> parts,
        boolean recognitionAvailable
    ) {}

    /** Track-level playback settings; {@code version} is the track version the change is based on. */
    public record TrackPlaybackSettingsDTO(Integer tempoBpm, Long referenceScoreId, Long version) {}

    /** A measure on a page image of the part: page from 1, coordinates as fractions of the page size. */
    public record MeasureBoxDTO(int measure, int page, double x, double y, double width, double height, boolean approximate) {}

    /**
     * What the correction editor needs to open a version.
     *
     * @param musicXml plain MusicXML of the version
     * @param pages    media ids of the current pages of the part, in order
     * @param layout   position of the measures on the pages the version was produced from; {@code null} when unknown.
     *                 {@code measure} counts the measures of the version from 1
     */
    public record ScoreEditorDTO(ScoreVersionDTO version, String musicXml, List<Long> pages, List<MeasureBoxDTO> layout) {}

    /**
     * A version written in the correction or in the writing editor.
     *
     * @param parentVersionId version the correction starts from, required; for the writing editor the version the writing
     *                        started from, {@code null} for a part without versions
     * @param content         plain MusicXML with a single part
     * @param approve         stores the version as already approved
     * @param measureSources  for each measure of the correction, the position from 0 of the measure of the parent it comes
     *                        from, {@code null} for an inserted measure; used to keep the positions on the pages. When
     *                        omitted the positions are kept only if the number of measures did not change. Ignored for
     *                        the writing editor
     * @param origin          {@code CORRECTION} (also when omitted) or {@code WRITING}
     * @param editSession     session of the editor, which must hold the edit lock of the part
     * @param confirmOutdated for the writing editor: the author confirmed that the version replaces one saved after the
     *                        writing started
     */
    public record CorrectionDTO(
        Long parentVersionId,
        String content,
        boolean approve,
        List<Integer> measureSources,
        ScoreVersionOrigin origin,
        String editSession,
        boolean confirmOutdated
    ) {}

    /** An error heard by a listener; the measure is optional. */
    public record ErrorReportRequestDTO(String measureNumber, String message) {}

    /**
     * An error report, for archivists and administrators.
     *
     * @param reportedBy name of the listener: the current one of the tenant user, otherwise the one given at the report;
     *                   {@code null} when unknown
     * @param closure    how the report was closed, {@code null} while it is open
     */
    public record ErrorReportDTO(
        Long id,
        Long scoreId,
        Long versionId,
        Integer versionNumber,
        String measureNumber,
        String message,
        String reportedBy,
        ZonedDateTime reportedAt,
        ScoreErrorReportStatus status,
        ScoreErrorReportClosure closure,
        String closedBy,
        ZonedDateTime closedAt
    ) {}
}
