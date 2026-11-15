import { PlaybackSound } from '../module';
import { parseMusicXml, ScorePart } from './musicxml-score';
import { buildPlayback, PlaybackPartInput } from './playback-builder';
import { partSound } from './timeline';

/**
 * File MIDI di ciò che si ascolta, dallo stesso generatore dell'ascolto: le parti indicate in suoni reali, con o senza
 * ritornelli, senza metronomo né battuta di attacco. Una parte di percussione suona sul canale di batteria.
 */
export function midiFile(parts: PlaybackPartInput[], reference: ScorePart, withRepeats: boolean, tempoBpm: number | null): Blob {
    const built = buildPlayback(parts, reference, { withRepeats, tempoBpm, countIn: false, metronome: false });
    const bytes = new Uint8Array(built.midi.length);
    bytes.set(built.midi);
    return new Blob([bytes], { type: 'audio/midi' });
}

/** MIDI di una versione di una parte, con ritornelli e salti eseguiti, il suono e la trasposizione della parte. */
export function versionMidi(xml: string, name: string, sound: PlaybackSound, tempoBpm: number | null): Blob {
    const part = parseMusicXml(xml);
    return midiFile([{ key: 'part', name, part, sound: partSound(sound, part.clefSign) }], part, true, tempoBpm);
}

/** Nome di file dal nome di una parte o di una traccia, senza i caratteri che i sistemi rifiutano. */
export function fileName(label: string, fallback = 'parte'): string {
    return label.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || fallback;
}

/** Fa scaricare il file al browser con il nome indicato. */
export function saveFile(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}
