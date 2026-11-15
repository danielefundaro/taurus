package com.fundaro.zodiac.taurus.service.scoreplayback;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.Media;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.security.RoleGroups;
import com.fundaro.zodiac.taurus.service.dto.ChildrenEntitiesDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.MeasureBoxDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PlaybackInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PlaybackSoundDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.ScoreVersionDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector.ScoreChecks;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/** Lookups and rules shared by the score playback services. */
@Component
public class ScorePlaybackSupport {

    static final String ENTITY = "ScoreVersion";

    private final TracksRepository tracksRepository;
    private final ObjectMapper objectMapper;

    public ScorePlaybackSupport(TracksRepository tracksRepository, ObjectMapper objectMapper) {
        this.tracksRepository = tracksRepository;
        this.objectMapper = objectMapper;
    }

    /** The audience of a request: archivists and administrators manage, the other roles only listen. */
    public enum Viewer {
        MANAGER(List.of(StateEnum.values())),
        USER(List.of(StateEnum.COMPLETE, StateEnum.PUBLIC)),
        EXTERNAL(List.of(StateEnum.PUBLIC)),
        NONE(List.of());

        private final List<StateEnum> visibleStates;

        Viewer(List<StateEnum> visibleStates) {
            this.visibleStates = visibleStates;
        }

        public boolean sees(StateEnum state) {
            return visibleStates.contains(state);
        }

        public static Viewer of(AbstractAuthenticationToken token) {
            if (RoleGroups.isCatalogueManager(token)) {
                return MANAGER;
            }
            if (hasAuthority(token, AuthoritiesConstants.USER)) return USER;
            if (hasAuthority(token, AuthoritiesConstants.USER_EXTERNAL)) return EXTERNAL;
            return NONE;
        }

        private static boolean hasAuthority(AbstractAuthenticationToken token, String authority) {
            return token != null && token.getAuthorities().stream().anyMatch(granted -> authority.equals(granted.getAuthority()));
        }
    }

    /** The track, if the viewer can see it. */
    public Tracks requireTrack(Long trackId, Viewer viewer) {
        return tracksRepository.findByIdAndDeletedFalse(trackId)
            .filter(track -> viewer.sees(track.getState() == null ? StateEnum.DRAFT : track.getState()))
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Track not found", ENTITY, "scorePlayback.track.notFound"));
    }

    public SheetsMusic requirePart(Tracks track, Long scoreId) {
        return track.getScores().stream()
            .filter(score -> Objects.equals(score.getId(), scoreId))
            .findFirst()
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Part not found", ENTITY, "scorePlayback.part.notFound"));
    }

    /** SHA-256 of the ordered page digests; legacy pages without a digest contribute their id. */
    public static String pagesFingerprint(SheetsMusic part) {
        StringBuilder value = new StringBuilder();
        for (Media page : part.getMedia()) {
            value.append(page.getSha256() == null ? "id:" + page.getId() : page.getSha256()).append('\n');
        }
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }

    /**
     * Version the pages of the part were engraved from, or {@code null}: the pages no longer derive from it once they are
     * changed in another way.
     */
    public static Long engravedFromVersionId(SheetsMusic part) {
        if (part.getEngravedFromVersionId() == null || part.getEngravedPagesFingerprint() == null) return null;
        return part.getEngravedPagesFingerprint().equals(pagesFingerprint(part)) ? part.getEngravedFromVersionId() : null;
    }

    public static boolean pagesChanged(ScoreVersion version, SheetsMusic part) {
        return version.getPagesFingerprint() != null && !version.getPagesFingerprint().equals(pagesFingerprint(part));
    }

    /** Approved versions stay playable after a page change; unverified ones only while they match the pages. */
    public static boolean usableByListeners(ScoreVersion version, SheetsMusic part) {
        return version.getStatus() == ScoreVersionStatus.APPROVED || !pagesChanged(version, part);
    }

    public static PlaybackInstrumentDTO instrument(Instruments instrument) {
        return new PlaybackInstrumentDTO(
            instrument.getId(),
            instrument.getName(),
            instrument.getTranspositionSemitones(),
            instrument.getBassClefTranspositionSemitones(),
            instrument.getSoundBank(),
            instrument.getSoundProgram(),
            instrument.getPercussionKey(),
            instrument.getPercussionKey() != null || (instrument.getSoundProgram() != null && instrument.getTranspositionSemitones() != null),
            instrument.getLowestWrittenPitch(),
            instrument.getHighestWrittenPitch()
        );
    }

    /** Part overrides first, then the first assigned instrument; percussion uses the drum keys of all the instruments. */
    public static PlaybackSoundDTO sound(SheetsMusic part) {
        List<Instruments> instruments = part.getInstruments();
        List<Integer> percussionKeys = instruments.stream().map(Instruments::getPercussionKey).filter(Objects::nonNull).toList();
        Instruments first = instruments.isEmpty() ? null : instruments.get(0);
        boolean hasProgramOverride = part.getSoundProgramOverride() != null;
        Integer transposition = part.getTranspositionOverride() != null
            ? part.getTranspositionOverride()
            : first == null ? null : first.getTranspositionSemitones();
        Integer bassClefTransposition = part.getTranspositionOverride() != null
            ? part.getTranspositionOverride()
            : first == null ? null : first.getBassClefTranspositionSemitones();
        Integer soundBank = hasProgramOverride ? part.getSoundBankOverride() : first == null ? null : first.getSoundBank();
        Integer soundProgram = hasProgramOverride ? part.getSoundProgramOverride() : first == null ? null : first.getSoundProgram();
        boolean percussion = !percussionKeys.isEmpty() && !hasProgramOverride;
        boolean configured = percussion || (soundProgram != null && transposition != null);
        boolean overridden = hasProgramOverride || part.getTranspositionOverride() != null;
        long distinctSettings = instruments.stream()
            .map(instrument -> List.of(
                Objects.toString(instrument.getTranspositionSemitones()),
                Objects.toString(instrument.getBassClefTranspositionSemitones()),
                Objects.toString(instrument.getSoundBank()),
                Objects.toString(instrument.getSoundProgram()),
                Objects.toString(instrument.getPercussionKey())
            ))
            .distinct()
            .count();
        // Several drums on one staff are expected to differ: only pitched instruments can disagree.
        boolean allPercussion = !instruments.isEmpty() && instruments.stream().allMatch(instrument -> instrument.getPercussionKey() != null);
        boolean conflicting = !overridden && !allPercussion && distinctSettings > 1;
        return new PlaybackSoundDTO(
            percussion ? null : transposition,
            percussion ? null : bassClefTransposition,
            percussion ? null : soundBank,
            percussion ? null : soundProgram,
            percussion ? percussionKeys : List.of(),
            configured,
            conflicting
        );
    }

    public ScoreVersionDTO toDto(ScoreVersion version, SheetsMusic part) {
        return new ScoreVersionDTO(
            version.getId(),
            version.getSheetMusicId(),
            version.getVersionNumber(),
            version.getOrigin(),
            version.getStatus(),
            version.getMeasureCount(),
            checks(version),
            version.getSourceFileName(),
            version.getSourcePartName(),
            version.getParentVersionId(),
            version.getInsertDate(),
            version.getApprovedAt(),
            Objects.equals(part.getCurrentScoreVersionId(), version.getId()),
            pagesChanged(version, part)
        );
    }

    public ScoreChecks checks(ScoreVersion version) {
        try {
            return objectMapper.readValue(version.getChecksJson(), ScoreChecks.class);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored checks of score version " + version.getId() + " are not readable", exception);
        }
    }

    /** Position of the measures of the version on the pages, or {@code null} when unknown. */
    public List<MeasureBoxDTO> layout(ScoreVersion version) {
        if (version.getLayoutJson() == null) return null;
        try {
            return List.of(objectMapper.readValue(version.getLayoutJson(), MeasureBoxDTO[].class));
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored layout of score version " + version.getId() + " is not readable", exception);
        }
    }

    public String checksJson(ScoreChecks checks) {
        try {
            return objectMapper.writeValueAsString(checks);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to serialize score checks", exception);
        }
    }

    /** Ids of the instruments of the current user, to mark the parts whose notation standard users can see. */
    public static Set<Long> instrumentIds(Set<ChildrenEntitiesDTO> instruments) {
        if (instruments == null) return Set.of();
        return instruments.stream().filter(Objects::nonNull).map(ChildrenEntitiesDTO::getIndex).filter(Objects::nonNull).collect(Collectors.toSet());
    }
}
