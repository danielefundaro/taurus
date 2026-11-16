package com.fundaro.zodiac.taurus.service.dto.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentCategory;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentKind;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Data exchanged by the fragment library of the music writing editor. */
public final class ScoreFragmentDtos {

    public static final int MAX_NAME_LENGTH = 100;
    public static final int MAX_NOTE_LENGTH = 500;

    private ScoreFragmentDtos() {}

    /**
     * The sound of a voice of a percussion fragment.
     *
     * @param voice voice of the notes, from 1
     * @param key   MIDI drum key of the sound, from 0 to 127
     */
    public record PercussionVoiceDTO(int voice, int key) {}

    /**
     * A fragment to save.
     *
     * @param content        plain MusicXML with a single part of whole measures, in concert pitch for a pitched fragment
     * @param percussionKeys sound of each voice with notes of a percussion fragment; empty or {@code null} for a pitched one
     */
    public record FragmentRequestDTO(
        @NotBlank @Size(max = MAX_NAME_LENGTH) String name,
        @NotNull ScoreFragmentCategory category,
        @Size(max = MAX_NOTE_LENGTH) String note,
        @NotNull ScoreFragmentKind kind,
        String content,
        List<PercussionVoiceDTO> percussionKeys
    ) {}

    /**
     * New name, category and note of a fragment.
     *
     * @param entityVersion version of the fragment read by the library
     */
    public record FragmentUpdateDTO(
        @NotBlank @Size(max = MAX_NAME_LENGTH) String name,
        @NotNull ScoreFragmentCategory category,
        @Size(max = MAX_NOTE_LENGTH) String note,
        @NotNull Long entityVersion
    ) {}

    /**
     * A fragment of the library, without its content.
     *
     * @param percussionKeys sound of each voice of a percussion fragment, by voice; empty for a pitched fragment
     */
    public record ScoreFragmentDTO(
        Long id,
        String name,
        ScoreFragmentCategory category,
        String note,
        ScoreFragmentKind kind,
        int measureCount,
        List<PercussionVoiceDTO> percussionKeys,
        long entityVersion
    ) {}
}
