package com.fundaro.zodiac.taurus.service.dto.scorewriting;

import java.time.ZonedDateTime;
import java.util.List;

/** Data exchanged by the edit lock and draft endpoints of the music writing editor. */
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
}
