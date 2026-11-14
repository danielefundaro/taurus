import { MidiNoteEvent, MidiTempoChange, MidiTrackData, writeMidiFile } from './midi-file';
import { ScorePart } from './musicxml-score';
import { playbackOrder } from './playback-order';

/** Suono già risolto per una parte: trasposizione della chiave in uso, banco e programma, tasti di batteria. */
export interface PartSound {
    transposition: number;
    bank: number;
    program: number;
    /** Tasti di batteria per voce: se presenti la parte suona sul canale di batteria. */
    percussionKeys: number[];
}

export interface PlaybackPartInput {
    key: string;
    name: string;
    part: ScorePart;
    sound: PartSound;
}

export interface PlaybackOptions {
    withRepeats: boolean;
    /** Tempo iniziale in semiminime al minuto; se assente si usa l'indicazione della partitura o 100. */
    tempoBpm: number | null;
    countIn: boolean;
}

/** Una battuta eseguita: indice nella parte di riferimento, inizio e durata in semiminime (attacco escluso). */
export interface TimelineSegment {
    measureIndex: number;
    start: number;
    length: number;
}

export interface PlaybackChannel {
    key: string;
    port: number;
    channel: number;
}

export interface BuiltPlayback {
    midi: Uint8Array;
    segments: TimelineSegment[];
    /** Semiminime della battuta di attacco, che precede la musica. */
    countIn: number;
    totalQuarters: number;
    /** Tempo iniziale, in semiminime al minuto. */
    initialTempo: number;
    tempo: MidiTempoChange[];
    channels: PlaybackChannel[];
    /** Canale del metronomo, da silenziare o attivare durante l'ascolto. */
    metronome: PlaybackChannel;
}

export const METRONOME_KEY = '__metronome__';
const DRUM_CHANNEL = 9;
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
const CLICK_ACCENT = 76;
const CLICK = 77;
const DEFAULT_TEMPO = 100;
const NEUTRAL_DRUM = 38;

/**
 * Costruisce il MIDI dell'ascolto: l'ordine delle battute viene dalla parte di riferimento ed è applicato a tutte le
 * parti per indice di battuta. Ogni parte ha un proprio canale, così mixer e silenziamento agiscono sulla singola parte.
 */
export function buildPlayback(parts: PlaybackPartInput[], reference: ScorePart, options: PlaybackOptions): BuiltPlayback {
    const order = playbackOrder(reference.measures, options.withRepeats);
    const firstMeasure = reference.measures[order[0] ?? 0];
    const countIn = options.countIn && firstMeasure ? firstMeasure.length : 0;

    const segments: TimelineSegment[] = [];
    let position = 0;
    for (const index of order) {
        const length = reference.measures[index].length;
        segments.push({ measureIndex: index, start: position, length });
        position += length;
    }

    const firstMark = reference.measures.find((measure) => measure.tempo !== null)?.tempo ?? null;
    const initialTempo = options.tempoBpm ?? firstMark ?? DEFAULT_TEMPO;
    const ratio = options.tempoBpm && firstMark ? options.tempoBpm / firstMark : 1;
    const tempo: MidiTempoChange[] = [{ at: 0, bpm: initialTempo }];
    segments.forEach((segment, segmentIndex) => {
        const mark = reference.measures[segment.measureIndex].tempo;
        if (mark !== null && segmentIndex > 0) tempo.push({ at: countIn + segment.start, bpm: mark * ratio });
    });

    const channels = allocateChannels(parts);
    const tracks: MidiTrackData[] = parts.map((input, partIndex) => {
        const channel = channels[partIndex];
        const percussion = isPercussion(input);
        return {
            name: input.name,
            port: channel.port,
            channel: channel.channel,
            program: percussion ? undefined : input.sound.program,
            bank: percussion ? undefined : input.sound.bank,
            notes: partNotes(input, segments, countIn)
        };
    });
    const metronome = channels[channels.length - 1];
    tracks.push({ name: 'Metronomo', port: metronome.port, channel: metronome.channel, notes: clicks(reference, segments, countIn) });

    return {
        midi: writeMidiFile(tempo, tracks),
        segments,
        countIn,
        totalQuarters: countIn + position,
        initialTempo,
        tempo,
        channels: channels.slice(0, parts.length),
        metronome
    };
}

/** Parti melodiche sui canali 0-8 e 10-15 di ogni porta; percussioni e metronomo sul canale 9 di porte diverse. */
export function allocateChannels(parts: PlaybackPartInput[]): PlaybackChannel[] {
    let melodic = 0;
    let drums = 0;
    const result = parts.map((input) => {
        if (isPercussion(input)) return { key: input.key, port: drums++, channel: DRUM_CHANNEL };
        const slot = melodic++;
        return { key: input.key, port: Math.floor(slot / MELODIC_CHANNELS.length), channel: MELODIC_CHANNELS[slot % MELODIC_CHANNELS.length] };
    });
    result.push({ key: METRONOME_KEY, port: drums, channel: DRUM_CHANNEL });
    return result;
}

/** Suona sul canale di batteria la parte con suoni di batteria o, se non configurata, scritta in chiave di percussione. */
function isPercussion(input: PlaybackPartInput): boolean {
    return input.sound.percussionKeys.length > 0 || input.part.clefSign === 'percussion';
}

function partNotes(input: PlaybackPartInput, segments: TimelineSegment[], countIn: number): MidiNoteEvent[] {
    const notes: MidiNoteEvent[] = [];
    const open = new Map<string, MidiNoteEvent>();
    const percussion = isPercussion(input);
    const drumKeys = input.sound.percussionKeys;
    for (const segment of segments) {
        const measure = input.part.measures[segment.measureIndex];
        if (!measure) continue;
        for (const note of measure.notes) {
            if (note.midi === null || note.start >= segment.length) continue;
            const start = countIn + segment.start + note.start;
            const duration = Math.min(note.duration, segment.length - note.start);
            let key: number;
            if (percussion && drumKeys.length > 0) {
                // Voce 1 il primo strumento, voce 2 il secondo: le voci oltre gli strumenti suonano l'ultimo.
                const voice = Number.parseInt(note.voice, 10);
                key = drumKeys[Math.min(Number.isInteger(voice) && voice > 0 ? voice : 1, drumKeys.length) - 1];
            } else if (percussion) {
                key = NEUTRAL_DRUM;
            } else {
                key = note.midi + input.sound.transposition;
            }
            const tieKey = `${note.voice}:${note.midi}`;
            const tied = note.tieStop ? open.get(tieKey) : undefined;
            if (tied && Math.abs(tied.start + tied.duration - start) < 0.001) {
                tied.duration += duration;
            } else {
                const event = { start, duration, key, velocity: note.velocity };
                notes.push(event);
                open.set(tieKey, event);
            }
            if (!note.tieStart) open.delete(tieKey);
        }
    }
    return notes;
}

function clicks(reference: ScorePart, segments: TimelineSegment[], countIn: number): MidiNoteEvent[] {
    const result: MidiNoteEvent[] = [];
    const first = segments.length ? reference.measures[segments[0].measureIndex] : null;
    if (countIn > 0 && first) result.push(...measureClicks(0, countIn, first.beatType));
    for (const segment of segments) {
        result.push(...measureClicks(countIn + segment.start, segment.length, reference.measures[segment.measureIndex].beatType));
    }
    return result;
}

function measureClicks(start: number, length: number, beatType: number): MidiNoteEvent[] {
    const beat = 4 / Math.max(1, beatType);
    const result: MidiNoteEvent[] = [];
    for (let offset = 0, index = 0; offset < length - 0.001; offset += beat, index++) {
        result.push({ start: start + offset, duration: Math.min(beat, 0.25), key: index === 0 ? CLICK_ACCENT : CLICK, velocity: index === 0 ? 110 : 80 });
    }
    return result;
}
