import { fileName, midiFile, saveFile, versionMidi } from './midi-download';
import { parseMusicXml } from './musicxml-score';
import { MidiEvent, musicXml, readMidi } from './score-player.testing';

const ATTRIBUTES = '<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const NOTE = (step: string) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;

async function midi(blob: Blob): Promise<{ format: number; tracks: MidiEvent[][] }> {
    return readMidi(new Uint8Array(await blob.arrayBuffer()));
}

function noteOns(events: MidiEvent[]): number[][] {
    return events.filter((event) => (event.status & 0xf0) === 0x90).map((event) => [event.tick / 480, event.data[0], event.status & 0x0f]);
}

function tempo(events: MidiEvent[]): number[] {
    return events.filter((event) => event.status === 0xff && event.data[0] === 0x51).map((event) => Math.round(60_000_000 / ((event.data[1] << 16) | (event.data[2] << 8) | event.data[3])));
}

describe('midi-download', () => {
    // Due battute con ritornello: si eseguono quattro battute.
    const xml = musicXml([ATTRIBUTES + NOTE('C') + NOTE('D'), NOTE('E') + NOTE('F') + '<barline location="right"><repeat direction="backward"/></barline>']);

    it('writes a version in sounding pitches, with the repeats, without metronome or count-in', async () => {
        const file = await midi(versionMidi(xml, 'Clarinetto', { transpositionSemitones: -2, soundProgram: 71, percussionKeys: [], configured: true, conflicting: false }, 90));

        expect(file.format).toBe(1);
        // Traccia del tempo e una traccia per la parte: nessun metronomo.
        expect(file.tracks.length).toBe(2);
        expect(tempo(file.tracks[0])).toEqual([90]);
        expect(noteOns(file.tracks[1]).map(([at, key]) => [at, key])).toEqual([
            [0, 58],
            [1, 60],
            [2, 62],
            [3, 63],
            [4, 58],
            [5, 60],
            [6, 62],
            [7, 63]
        ]);
    });

    it('plays a percussion part on the drum channel and the chosen parts only', async () => {
        const drums = await midi(versionMidi(xml, 'Rullante', { percussionKeys: [38], configured: true, conflicting: false }, null));
        expect(noteOns(drums.tracks[1]).every(([, key, channel]) => key === 38 && channel === 9)).toBeTrue();

        const part = parseMusicXml(xml);
        const sound = { transposition: 0, bank: 0, program: 0, percussionKeys: [] };
        const score = await midi(
            midiFile(
                [
                    { key: 'a', name: 'Prima', part, sound },
                    { key: 'b', name: 'Seconda', part, sound: { ...sound, transposition: 12 } }
                ],
                part,
                false,
                null
            )
        );
        expect(score.tracks.length).toBe(3);
        expect(noteOns(score.tracks[2]).map(([, key]) => key)).toEqual([72, 74, 76, 77]);
    });

    it('names the file without the characters the systems refuse and saves it', () => {
        expect(fileName('Clarinetto 1°/2° - "solo"')).toBe('Clarinetto 12 - solo');
        expect(fileName('***', 'traccia')).toBe('traccia');
        const click = spyOn(HTMLAnchorElement.prototype, 'click');
        saveFile(new Blob(['x']), 'parte.mid');
        expect(click).toHaveBeenCalled();
        expect((click.calls.mostRecent().object as HTMLAnchorElement).download).toBe('parte.mid');
    });
});
