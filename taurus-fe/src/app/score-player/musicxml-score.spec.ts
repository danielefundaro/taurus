import { parseMusicXml, parseMusicXmlParts } from './musicxml-score';
import { musicXml } from './score-player.testing';

const ATTRIBUTES = '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>';

function note(step: string, octave: number, duration: number, extra = ''): string {
    return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra}</note>`;
}

describe('parseMusicXml', () => {
    it('reads the part name, the clef and written MIDI pitches in quarters', () => {
        const xml = musicXml([
            ATTRIBUTES +
                '<note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>2</duration><voice>1</voice></note>' +
                '<note><rest/><duration>1</duration><voice>1</voice></note>' +
                '<note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice></note>'
        ]);
        const part = parseMusicXml(xml);

        expect(part.id).toBe('P1');
        expect(part.name).toBe('Clarinetto in Sib');
        expect(part.clefSign).toBe('F');
        const measure = part.measures[0];
        expect(measure.beats).toBe(3);
        expect(measure.beatType).toBe(4);
        expect(measure.length).toBe(3);
        expect(measure.notes.map((item) => [item.start, item.duration, item.midi])).toEqual([
            [0, 1, 58],
            [1, 0.5, null],
            [1.5, 1.5, 60]
        ]);
    });

    it('places chords, backups and forwards and skips grace notes', () => {
        const xml = musicXml([
            '<attributes><divisions>1</divisions></attributes>' +
                note('C', 4, 2) +
                '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>' +
                '<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>' +
                note('G', 4, 2) +
                '<backup><duration>4</duration></backup>' +
                '<forward><duration>1</duration></forward>' +
                '<note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><voice>2</voice></note>'
        ]);
        const notes = parseMusicXml(xml).measures[0].notes;

        expect(notes.map((item) => [item.start, item.midi, item.voice])).toEqual([
            [0, 60, '1'],
            [0, 64, '1'],
            [2, 67, '1'],
            [1, 48, '2']
        ]);
    });

    it('reads ties, dynamics and unpitched notes', () => {
        const xml = musicXml([
            '<attributes><divisions>1</divisions><clef><sign>percussion</sign></clef></attributes>' + '<direction><direction-type><dynamics><pp/></dynamics></direction-type></direction>' + note('C', 5, 4, '<tie type="start"/>'),
            '<direction><direction-type><dynamics><ff/></dynamics></direction-type></direction>' +
                note('C', 5, 2, '<tie type="stop"/>') +
                '<note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>2</duration></note>'
        ]);
        const part = parseMusicXml(xml);

        expect(part.clefSign).toBe('percussion');
        expect(part.measures[0].notes[0]).toEqual(jasmine.objectContaining({ tieStart: true, tieStop: false, velocity: 40 }));
        expect(part.measures[1].notes[0]).toEqual(jasmine.objectContaining({ tieStart: false, tieStop: true, velocity: 112 }));
        expect(part.measures[1].notes[1].midi).toBe(64);
    });

    it('uses the content of an implicit pickup measure as its length', () => {
        const xml = musicXml(['<attributes><divisions>1</divisions></attributes>' + note('G', 4, 1), note('C', 5, 4)]).replace('<measure number="1">', '<measure number="0" implicit="yes">');
        const part = parseMusicXml(xml);

        expect(part.measures.map((item) => [item.number, item.length])).toEqual([
            ['0', 1],
            ['2', 4]
        ]);
    });

    it('reads repeats, endings, segno, coda, jumps and tempo marks', () => {
        const xml = musicXml([
            '<barline location="left"><repeat direction="forward"/></barline>' +
                '<direction><direction-type><segno/></direction-type></direction>' +
                '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>',
            '<barline location="left"><ending number="1, 2" type="start"/></barline><barline location="right"><ending number="1, 2" type="stop"/><repeat direction="backward" times="3"/></barline>',
            '<direction><direction-type><words>Fine</words></direction-type></direction>',
            '<direction><direction-type><words>D.S. al Coda</words></direction-type></direction><direction><direction-type><words>To Coda</words></direction-type></direction>',
            '<direction><sound tempo="132" dacapo="yes"/></direction>'
        ]);
        const measures = parseMusicXml(xml).measures;

        expect(measures[0]).toEqual(jasmine.objectContaining({ forwardRepeat: true, segno: true, tempo: 90 }));
        expect(measures[1].ending).toEqual({ numbers: [1, 2], start: true, stop: true });
        expect(measures[1].backwardRepeatTimes).toBe(3);
        expect(measures[2].fine).toBeTrue();
        expect(measures[3]).toEqual(jasmine.objectContaining({ dalSegno: true, toCoda: true, daCapo: false }));
        expect(measures[4]).toEqual(jasmine.objectContaining({ daCapo: true, tempo: 132 }));
    });

    it('treats the first of two coda signs as the jump to the coda', () => {
        const xml = musicXml([note('C', 4, 4), `<barline><coda/></barline>`, note('C', 4, 4), `<barline><coda/></barline>`]);
        const measures = parseMusicXml(xml).measures;

        expect(measures.map((item) => [item.toCoda, item.coda])).toEqual([
            [false, false],
            [true, false],
            [false, false],
            [false, true]
        ]);
    });

    it('reads the requested part and rejects unreadable files', () => {
        const xml = musicXml([note('C', 4, 4)]).replace('</score-partwise>', '<part id="P2"><measure number="1"/></part></score-partwise>');

        expect(parseMusicXml(xml, 1).id).toBe('P2');
        expect(() => parseMusicXml(xml, 2)).toThrowError('Parte non presente');
        expect(() => parseMusicXml('<score-partwise><part>')).toThrowError('MusicXML non leggibile');
    });

    it('reads all the parts of a file at once', () => {
        const xml = musicXml([note('C', 4, 4)]).replace('</score-partwise>', '<part id="P2"><measure number="1"/></part></score-partwise>');

        const parts = parseMusicXmlParts(xml);
        expect(parts.map((part) => part.id)).toEqual(['P1', 'P2']);
        expect(parts[0].measures[0].notes.length).toBe(1);
        expect(parts[1].measures[0].notes.length).toBe(0);
        expect(() => parseMusicXmlParts('<score-partwise><part>')).toThrowError('MusicXML non leggibile');
    });
});
