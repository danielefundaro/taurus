package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.domain.Media;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScorePlaybackDtos.PlaybackSoundDTO;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ScorePlaybackSupportTest {

    @Test
    void usesTheFirstInstrumentAndFlagsDisagreements() {
        SheetsMusic part = part(instrument(-2, null, 71, null), instrument(-9, null, 65, null));

        PlaybackSoundDTO sound = ScorePlaybackSupport.sound(part);

        assertThat(sound.transpositionSemitones()).isEqualTo(-2);
        assertThat(sound.soundProgram()).isEqualTo(71);
        assertThat(sound.configured()).isTrue();
        assertThat(sound.conflicting()).isTrue();
    }

    @Test
    void partOverridesWinAndSilenceDisagreements() {
        SheetsMusic part = part(instrument(-2, null, 71, null), instrument(-9, null, 65, null));
        part.setTranspositionOverride(-9);
        part.setSoundProgramOverride(65);

        PlaybackSoundDTO sound = ScorePlaybackSupport.sound(part);

        assertThat(sound.transpositionSemitones()).isEqualTo(-9);
        assertThat(sound.bassClefTranspositionSemitones()).isEqualTo(-9);
        assertThat(sound.soundProgram()).isEqualTo(65);
        assertThat(sound.conflicting()).isFalse();
    }

    @Test
    void percussionPartsPlayTheDrumKeysOfAllTheirInstruments() {
        PlaybackSoundDTO sound = ScorePlaybackSupport.sound(part(instrument(null, null, null, 38), instrument(null, null, null, 36)));

        assertThat(sound.percussionKeys()).containsExactly(38, 36);
        assertThat(sound.soundProgram()).isNull();
        assertThat(sound.configured()).isTrue();
        assertThat(sound.conflicting()).isFalse();
    }

    @Test
    void instrumentsWithoutSettingsAreNotConfigured() {
        assertThat(ScorePlaybackSupport.sound(part(instrument(null, null, null, null))).configured()).isFalse();
        assertThat(ScorePlaybackSupport.sound(part()).configured()).isFalse();
    }

    @Test
    void unverifiedVersionsStopBeingPlayableWhenThePagesChange() {
        SheetsMusic part = part();
        part.getMedia().add(page(1L, "a".repeat(64)));
        ScoreVersion unverified = version(ScoreVersionStatus.UNVERIFIED, ScorePlaybackSupport.pagesFingerprint(part));
        ScoreVersion approved = version(ScoreVersionStatus.APPROVED, ScorePlaybackSupport.pagesFingerprint(part));

        assertThat(ScorePlaybackSupport.usableByListeners(unverified, part)).isTrue();

        part.getMedia().add(page(2L, "b".repeat(64)));

        assertThat(ScorePlaybackSupport.pagesChanged(unverified, part)).isTrue();
        assertThat(ScorePlaybackSupport.usableByListeners(unverified, part)).isFalse();
        assertThat(ScorePlaybackSupport.usableByListeners(approved, part)).isTrue();
    }

    @Test
    void theFingerprintDependsOnPageOrder() {
        SheetsMusic first = part();
        first.getMedia().addAll(List.of(page(1L, "a".repeat(64)), page(2L, "b".repeat(64))));
        SheetsMusic swapped = part();
        swapped.getMedia().addAll(List.of(page(2L, "b".repeat(64)), page(1L, "a".repeat(64))));

        assertThat(ScorePlaybackSupport.pagesFingerprint(first)).isNotEqualTo(ScorePlaybackSupport.pagesFingerprint(swapped)).hasSize(64);
    }

    @Test
    void theEngravedVersionHoldsWhileThePartKeepsTheEngravedPages() {
        SheetsMusic part = part();
        part.getMedia().add(page(1L, "a".repeat(64)));

        assertThat(ScorePlaybackSupport.engravedFromVersionId(part)).isNull();

        part.setEngravedFromVersionId(7L);
        part.setEngravedPagesFingerprint(ScorePlaybackSupport.pagesFingerprint(part));

        assertThat(ScorePlaybackSupport.engravedFromVersionId(part)).isEqualTo(7L);

        part.getMedia().add(page(2L, "b".repeat(64)));

        assertThat(ScorePlaybackSupport.engravedFromVersionId(part)).isNull();

        part.setEngravedPagesFingerprint(null);

        assertThat(ScorePlaybackSupport.engravedFromVersionId(part)).isNull();
    }

    private static SheetsMusic part(Instruments... instruments) {
        SheetsMusic part = new SheetsMusic();
        part.getInstruments().addAll(List.of(instruments));
        return part;
    }

    private static Instruments instrument(Integer transposition, Integer bassClef, Integer program, Integer percussionKey) {
        Instruments instrument = new Instruments();
        instrument.setTranspositionSemitones(transposition);
        instrument.setBassClefTranspositionSemitones(bassClef);
        instrument.setSoundBank(program == null ? null : 0);
        instrument.setSoundProgram(program);
        instrument.setPercussionKey(percussionKey);
        return instrument;
    }

    private static Media page(Long id, String sha256) {
        Media media = new Media();
        media.setId(id);
        media.setSha256(sha256);
        return media;
    }

    private static ScoreVersion version(ScoreVersionStatus status, String fingerprint) {
        ScoreVersion version = new ScoreVersion();
        version.setStatus(status);
        version.setPagesFingerprint(fingerprint);
        return version;
    }
}
