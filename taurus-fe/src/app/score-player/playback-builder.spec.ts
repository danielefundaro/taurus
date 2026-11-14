import { ScoreNote, ScorePart } from './musicxml-score';
import { allocateChannels, buildPlayback, METRONOME_KEY, PartSound, PlaybackPartInput } from './playback-builder';
import { measure, MidiEvent, readMidi } from './score-player.testing';

function note(start: number, duration: number, midi: number | null, extra: Partial<ScoreNote> = {}): ScoreNote {
    return { start, duration, midi, voice: '1', tieStart: false, tieStop: false, velocity: 85, ...extra };
}

function sound(overrides: Partial<PartSound> = {}): PartSound {
    return { transposition: 0, bank: 0, program: 0, percussionKeys: [], ...overrides };
}

function input(key: string, part: ScorePart, partSound = sound()): PlaybackPartInput {
    return { key, name: key, part, sound: partSound };
}

function noteOns(events: MidiEvent[]): number[][] {
    return events.filter((event) => (event.status & 0xf0) === 0x90).map((event) => [event.tick / 480, event.data[0]]);
}

function noteOffs(events: MidiEvent[]): number[][] {
    return events.filter((event) => (event.status & 0xf0) === 0x80).map((event) => [event.tick / 480, event.data[0]]);
}

describe('buildPlayback', () => {
    const clarinet: ScorePart = {
        id: 'P1',
        name: 'Clarinetto',
        clefSign: 'G',
        measures: [
            measure(0, { notes: [note(0, 2, 62), note(2, 2, 64, { tieStart: true })], tempo: 60 }),
            measure(1, { notes: [note(0, 1, 64, { tieStop: true }), note(1, 1, null), note(2, 2, 65)], backwardRepeatTimes: 2 }),
            measure(2, { notes: [note(0, 4, 67)], tempo: 90 })
        ]
    };

    it('applies the order of the reference part, merges ties and transposes the written notes', () => {
        const built = buildPlayback([input('clarinet', clarinet, sound({ transposition: -2, program: 71 }))], clarinet, { withRepeats: true, tempoBpm: null, countIn: false });
        const part = readMidi(built.midi).tracks[1];

        expect(built.segments.map((segment) => [segment.measureIndex, segment.start])).toEqual([
            [0, 0],
            [1, 4],
            [0, 8],
            [1, 12],
            [2, 16]
        ]);
        expect(built.totalQuarters).toBe(20);
        expect(noteOns(part)).toEqual([
            [0, 60],
            [2, 62],
            [6, 63],
            [8, 60],
            [10, 62],
            [14, 63],
            [16, 65]
        ]);
        expect(noteOffs(part)).toContain([5, 62]);
        expect(part.find((event) => (event.status & 0xf0) === 0xc0)?.data).toEqual([71]);
    });

    it('scales the tempo marks to the chosen tempo and starts with a count-in bar', () => {
        const built = buildPlayback([input('clarinet', clarinet)], clarinet, { withRepeats: false, tempoBpm: 120, countIn: true });

        expect(built.countIn).toBe(4);
        expect(built.initialTempo).toBe(120);
        expect(built.tempo).toEqual([
            { at: 0, bpm: 120 },
            { at: 12, bpm: 180 }
        ]);
        expect(built.totalQuarters).toBe(16);
        expect(noteOns(readMidi(built.midi).tracks[1])[0]).toEqual([4, 62]);
    });

    it('uses the score tempo or 100 when no tempo is chosen', () => {
        const plain: ScorePart = { ...clarinet, measures: [measure(0, { notes: [note(0, 4, 60)] })] };

        expect(buildPlayback([input('clarinet', clarinet)], clarinet, { withRepeats: false, tempoBpm: null, countIn: false }).initialTempo).toBe(60);
        expect(buildPlayback([input('plain', plain)], plain, { withRepeats: false, tempoBpm: null, countIn: false }).initialTempo).toBe(100);
    });

    it('plays the metronome on its own drum channel, with accented downbeats', () => {
        const built = buildPlayback([input('clarinet', clarinet)], clarinet, { withRepeats: false, tempoBpm: null, countIn: true });
        const tracks = readMidi(built.midi).tracks;
        const clicks = noteOns(tracks[tracks.length - 1]);

        expect(built.metronome).toEqual({ key: METRONOME_KEY, port: 0, channel: 9 });
        expect(built.channels).toEqual([{ key: 'clarinet', port: 0, channel: 0 }]);
        expect(clicks.length).toBe(16);
        expect(clicks.slice(0, 5)).toEqual([
            [0, 76],
            [1, 77],
            [2, 77],
            [3, 77],
            [4, 76]
        ]);
    });

    it('maps each percussion voice to the drum sound of the instrument with its number', () => {
        const drums: ScorePart = {
            id: 'P2',
            name: 'Batteria',
            clefSign: 'percussion',
            measures: [measure(0, { notes: [note(0, 1, 64, { voice: '2' }), note(0, 1, 72, { voice: '1' }), note(1, 1, 72, { voice: '3' })] })]
        };
        const withKeys = buildPlayback([input('drums', drums, sound({ percussionKeys: [38, 36] }))], drums, { withRepeats: false, tempoBpm: null, countIn: false });
        const unconfigured = buildPlayback([input('drums', drums)], drums, { withRepeats: false, tempoBpm: null, countIn: false });

        expect(withKeys.channels).toEqual([{ key: 'drums', port: 0, channel: 9 }]);
        expect(withKeys.metronome).toEqual({ key: METRONOME_KEY, port: 1, channel: 9 });
        // La voce 2 compare per prima ma suona il secondo strumento; la voce 3 suona l'ultimo.
        expect(noteOns(readMidi(withKeys.midi).tracks[1])).toEqual([
            [0, 36],
            [0, 38],
            [1, 36]
        ]);
        expect(unconfigured.channels).toEqual([{ key: 'drums', port: 0, channel: 9 }]);
        expect(noteOns(readMidi(unconfigured.midi).tracks[1]).map(([, key]) => key)).toEqual([38, 38, 38]);
    });

    it('cuts notes longer than the measure and ignores measures missing from a part', () => {
        const short: ScorePart = { ...clarinet, measures: [measure(0, { notes: [note(3, 4, 60), note(4, 1, 62)] })] };
        const built = buildPlayback([input('short', short)], clarinet, { withRepeats: false, tempoBpm: null, countIn: false });
        const part = readMidi(built.midi).tracks[1];

        expect(noteOns(part)).toEqual([[3, 60]]);
        expect(noteOffs(part)).toEqual([[4, 60]]);
    });
});

describe('allocateChannels', () => {
    it('spreads melodic parts over the channels of each port, skipping the drum channel', () => {
        const parts = Array.from({ length: 17 }, (_, index) => input(`p${index}`, { id: '', name: '', clefSign: 'G', measures: [] }));
        const channels = allocateChannels(parts);

        expect(channels[8]).toEqual({ key: 'p8', port: 0, channel: 8 });
        expect(channels[9]).toEqual({ key: 'p9', port: 0, channel: 10 });
        expect(channels[14]).toEqual({ key: 'p14', port: 0, channel: 15 });
        expect(channels[15]).toEqual({ key: 'p15', port: 1, channel: 0 });
        expect(channels[17]).toEqual({ key: METRONOME_KEY, port: 0, channel: 9 });
    });
});
