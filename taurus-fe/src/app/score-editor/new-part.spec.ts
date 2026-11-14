import { parseMusicXml } from '../score-player/musicxml-score';
import { musicXml } from '../score-player/score-player.testing';
import { concertFifths, fifthsShift, newPartXml, NewPartSetup, proposedClef, readReferencePart, setupErrors, writtenFifths } from './new-part';
import { ScoreDocument } from './score-document';

const SETUP: NewPartSetup = { partName: 'Tromba 1ª', clef: 'G2', fifths: 2, beats: 4, beatType: 4, tempo: 96, measures: 3, pickupBeats: 0 };

function xmlDocument(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'application/xml');
}

describe('new written part', () => {
    it('writes the clef, key, time and tempo in the first measure and rests everywhere', () => {
        const xml = newPartXml(SETUP);
        const document = xmlDocument(xml);
        expect(document.querySelector('part-name')?.textContent).toBe('Tromba 1ª');
        expect(document.querySelector('divisions')?.textContent).toBe('1');
        expect(document.querySelector('fifths')?.textContent).toBe('2');
        expect(document.querySelector('clef sign')?.textContent).toBe('G');
        expect(document.querySelector('clef line')?.textContent).toBe('2');
        expect(document.querySelector('transpose')).toBeNull();
        expect(document.querySelector('sound')?.getAttribute('tempo')).toBe('96');
        expect(document.querySelector('per-minute')?.textContent).toBe('96');
        const measures = Array.from(document.querySelectorAll('measure'));
        expect(measures.map((measure) => measure.getAttribute('number'))).toEqual(['1', '2', '3']);
        expect(measures.every((measure) => measure.querySelector('rest')?.getAttribute('measure') === 'yes')).toBeTrue();
        expect(measures[2].querySelector('barline bar-style')?.textContent).toBe('light-heavy');
        expect(measures[0].querySelector('barline')).toBeNull();

        const part = parseMusicXml(xml);
        expect(part.measures.map((measure) => measure.length)).toEqual([4, 4, 4]);
        expect(part.measures[0].tempo).toBe(96);
        const score = ScoreDocument.open(xml);
        expect(score.checks().wrongDuration).toEqual([]);
    });

    it('adds a pickup measure of rests numbered 0', () => {
        const xml = newPartXml({ ...SETUP, beats: 3, pickupBeats: 1, measures: 2, tempo: null });
        const document = xmlDocument(xml);
        const measures = Array.from(document.querySelectorAll('measure'));
        expect(measures.map((measure) => [measure.getAttribute('number'), measure.getAttribute('implicit')])).toEqual([
            ['0', 'yes'],
            ['1', null],
            ['2', null]
        ]);
        expect(measures[0].querySelector('type')?.textContent).toBe('quarter');
        expect(document.querySelector('direction')).toBeNull();
        expect(parseMusicXml(xml).measures.map((measure) => measure.length)).toEqual([1, 3, 3]);
        expect(ScoreDocument.open(xml).checks().wrongDuration).toEqual([]);
    });

    it('uses eighths as divisions in compound time and writes the dotted beat', () => {
        const xml = newPartXml({ ...SETUP, beats: 6, beatType: 8, tempo: 120, pickupBeats: 3, measures: 1 });
        const document = xmlDocument(xml);
        expect(document.querySelector('divisions')?.textContent).toBe('2');
        expect(document.querySelector('beat-unit-dot')).not.toBeNull();
        expect(document.querySelector('per-minute')?.textContent).toBe('80');
        expect(document.querySelector('sound')?.getAttribute('tempo')).toBe('120');
        // Levare di tre crome: una semiminima e una croma.
        expect(Array.from(document.querySelectorAll('measure')[0].querySelectorAll('type')).map((type) => type.textContent)).toEqual(['quarter', 'eighth']);
        expect(parseMusicXml(xml).measures.map((measure) => measure.length)).toEqual([1.5, 3]);
    });

    it('writes the percussion and octave clefs and escapes the part name', () => {
        const percussion = xmlDocument(newPartXml({ ...SETUP, clef: 'percussion', partName: 'Piatti & <tamburo>' }));
        expect(percussion.querySelector('clef sign')?.textContent).toBe('percussion');
        expect(percussion.querySelector('clef line')).toBeNull();
        expect(percussion.querySelector('part-name')?.textContent).toBe('Piatti & <tamburo>');
        const tenor = xmlDocument(newPartXml({ ...SETUP, clef: 'G2-8', partName: '  ' }));
        expect(tenor.querySelector('clef-octave-change')?.textContent).toBe('-1');
        expect(tenor.querySelector('part-name')?.textContent).toBe('Parte');
    });

    it('refuses impossible settings', () => {
        expect(setupErrors(SETUP)).toEqual([]);
        expect(setupErrors({ ...SETUP, clef: 'X', fifths: 8, beats: 0, beatType: 3, measures: 0, pickupBeats: -1, tempo: 10 }).length).toBe(7);
        expect(setupErrors({ ...SETUP, pickupBeats: 4 })).toEqual(['La levare è più breve di una battuta.']);
        expect(() => newPartXml({ ...SETUP, measures: 1000 })).toThrowError(/battute/);
    });

    it('proposes the clef from the instruments', () => {
        expect(proposedClef([{ name: 'Tromba' }])).toBe('G2');
        expect(proposedClef([{ name: 'Trombone' }])).toBe('F4');
        expect(proposedClef([{ name: 'Bombardone' }])).toBe('F4');
        expect(proposedClef([{ name: 'Basso' }])).toBe('F4');
        expect(proposedClef([{ name: 'Clarinetto basso' }])).toBe('G2');
        expect(proposedClef([{ name: 'Flicorno basso' }])).toBe('G2');
        expect(proposedClef([{ name: 'Tromba' }, { name: 'Fagotto' }])).toBe('F4');
        expect(proposedClef([{ name: 'Gran cassa', percussionKey: 36 }, { name: 'Trombone' }])).toBe('percussion');
        expect(proposedClef([])).toBe('G2');
    });

    it('moves the key signature with the transposition of the instruments', () => {
        expect(fifthsShift(0)).toBe(0);
        expect(fifthsShift(-2)).toBe(-2);
        expect(fifthsShift(-14)).toBe(-2);
        expect(fifthsShift(-9)).toBe(-3);
        expect(fifthsShift(-7)).toBe(-1);
        // Clarinetto in Sib scritto in Re: l'orchestra suona in Do; il sax contralto in Mib scrive in La.
        expect(concertFifths(2, -2)).toBe(0);
        expect(writtenFifths(0, -9)).toBe(3);
        // Banda in Mib (3 bemolli): la tromba in Sib scrive in Fa, il corno in Fa scrive in Sib.
        expect(writtenFifths(-3, -2)).toBe(-1);
        expect(writtenFifths(-3, -7)).toBe(-2);
        // Si maggiore per il sax contralto si scrive con meno alterazioni: 7 diesis diventano 5 bemolli.
        expect(writtenFifths(4, -9)).toBe(-5);
    });

    it('reads key, time, tempo, pickup and length from another part', () => {
        const attributes = '<attributes><divisions>2</divisions><key><fifths>-2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>';
        const tempo = '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type><sound tempo="72"/></direction>';
        const xml = musicXml([
            `${attributes}${tempo}<note><rest/><duration>2</duration><voice>1</voice><type>quarter</type></note>`,
            '<note><rest measure="yes"/><duration>6</duration><voice>1</voice></note>',
            '<note><rest measure="yes"/><duration>6</duration><voice>1</voice></note>'
        ]).replace('<measure number="1">', '<measure number="0" implicit="yes">');
        expect(readReferencePart(xml)).toEqual({ fifths: -2, beats: 3, beatType: 4, tempo: 72, measures: 2, pickupBeats: 1, clefSign: 'F' });
        expect(readReferencePart(musicXml(['<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>']))).toEqual({
            fifths: 0,
            beats: 4,
            beatType: 4,
            tempo: null,
            measures: 1,
            pickupBeats: 0,
            clefSign: 'G'
        });
        expect(readReferencePart('<not-xml')).toBeNull();
        expect(readReferencePart(musicXml([]))).toBeNull();
    });
});
