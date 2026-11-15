import { child, children, text } from './musicxml-dom';
import { EditError, pitchOf } from './score-document';
import * as derivation from './score-derivation';
import { openScore } from './score-edits';

const CLARINET = -2;
const ALTO_SAX: derivation.RangeInstrument = { transpositionSemitones: -9, lowestWrittenPitch: 58, highestWrittenPitch: 89 };
const EUPHONIUM: derivation.RangeInstrument = { transpositionSemitones: -14, bassClefTranspositionSemitones: 0, lowestWrittenPitch: 48, highestWrittenPitch: 84 };

function note(step: string, octave: number, alter = 0, extra = ''): string {
    return `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${extra}</note>`;
}

function attributes(fifths: number, clef = '<clef><sign>G</sign><line>2</line></clef>', transpose = ''): string {
    return `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${clef}${transpose}</attributes>`;
}

/** Parte in 4/4 con le battute indicate, la prima con gli attributi. */
function part(measures: string[], first = attributes(0)): string {
    const body = measures.map((content, index) => `<measure number="${index + 1}">${index === 0 ? first : ''}${content}</measure>`).join('');
    return (
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinetto 1°</part-name>' +
        '<score-instrument id="P1-I1"><instrument-name>Clarinet</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>72</midi-program></midi-instrument>' +
        `</score-part></part-list><part id="P1">${body}</part></score-partwise>`
    );
}

function pitches(xml: string): string[] {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(document.getElementsByTagName('note')).map((item) => {
        const pitch = pitchOf(item)!;
        return `${pitch.step}${pitch.alter > 0 ? '#'.repeat(pitch.alter) : 'b'.repeat(-pitch.alter)}${pitch.octave}`;
    });
}

function fifths(xml: string): number[] {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(document.getElementsByTagName('fifths')).map((item) => Number(item.textContent));
}

describe('score-derivation', () => {
    it('keeps the sound from the clarinet in B flat to the alto sax in E flat with a perfect fifth up', () => {
        const xml = part([note('C', 4) + note('D', 4) + note('E', 4) + note('F', 4, 1), note('C', 6) + note('B', 5, -1) + note('C', 5) + note('C', 5)]);
        const plan = derivation.planDerivation(openScore(xml), CLARINET, ALTO_SAX, 'G2');

        expect(plan.error).toBeNull();
        expect(plan.enharmonic).toBeFalse();
        expect(plan.sourceTransposition).toBe(-2);
        expect(plan.targetTransposition).toBe(-9);
        expect(plan.fifths).toBe(1);
        expect(plan.range).toEqual({ lowest: 58, highest: 89 });
        const zero = plan.octaves.find((octave) => octave.octave === 0)!;
        expect(zero.interval).toEqual({ steps: 4, semitones: 7, fifths: 1 });
        expect(zero.label).toBe('Quinta giusta sopra');
        expect(zero.outOfRange).toBe(1);
        expect(zero.measures).toEqual(['2']);
        const below = plan.octaves.find((octave) => octave.octave === -1)!;
        expect(below.label).toBe('Quarta giusta sotto');
        expect(below.outOfRange).toBe(2);
        expect(below.measures).toEqual(['1']);
        expect(plan.octaves.find((octave) => octave.octave === 2)!.label).toBe('Quinta giusta e 2 ottave sopra');
        expect(plan.proposed).toBe(0);

        const derived = derivation.derivedPartXml(xml, CLARINET, ALTO_SAX, 'G2', -1, 'Sax contralto');
        expect(pitches(derived)).toEqual(['G3', 'A3', 'B3', 'C#4', 'G5', 'F5', 'G4', 'G4']);
        expect(fifths(derived)).toEqual([1]);
        const document = new DOMParser().parseFromString(derived, 'application/xml');
        expect(text(document.querySelector('part-name'))).toBe('Sax contralto');
        expect(document.getElementsByTagName('midi-instrument').length).toBe(0);
        expect(document.getElementsByTagName('score-instrument').length).toBe(0);
        expect(derived).not.toContain('taurus-source');
    });

    it('proposes the octave with fewer notes out of range and then the one nearest the centre of the range', () => {
        // A parità di note fuori estensione vince il suono dell'originale.
        const low = part([note('G', 3) + note('A', 3) + note('B', 3) + note('C', 4)]);
        expect(derivation.planDerivation(openScore(low), CLARINET, ALTO_SAX, 'G2').proposed).toBe(0);
        const veryLow = part([note('C', 2) + note('D', 2) + note('E', 2) + note('F', 2)]);
        const plan = derivation.planDerivation(openScore(veryLow), CLARINET, ALTO_SAX, 'G2');
        expect(plan.octaves.map((octave) => octave.outOfRange)).toEqual([4, 4, 4, 2, 0]);
        expect(plan.proposed).toBe(2);
        // Un'ottava sopra e una sotto lasciano fuori una nota: vince quella con le note più vicine al centro.
        const wide = part([note('E', 5) + note('A', 3)]);
        const centred = derivation.planDerivation(openScore(wide), 0, { transpositionSemitones: 0, lowestWrittenPitch: 60, highestWrittenPitch: 72 }, 'G2');
        expect(centred.octaves.map((octave) => octave.outOfRange)).toEqual([2, 1, 2, 1, 2]);
        expect(centred.proposed).toBe(-1);
        const unranged = derivation.planDerivation(openScore(veryLow), CLARINET, { transpositionSemitones: -9 }, 'G2');
        expect(unranged.range).toBeNull();
        expect(unranged.octaves.every((octave) => octave.outOfRange === null && !octave.measures.length)).toBeTrue();
        expect(unranged.proposed).toBe(0);
    });

    it('leaves out the octaves that would write impossible notes', () => {
        const plan = derivation.planDerivation(openScore(part([note('C', 0) + note('A', 8)])), 0, { transpositionSemitones: 0 }, 'G2');
        expect(plan.octaves.map((octave) => octave.possible)).toEqual([false, false, true, false, false]);
        const xml = part([note('C', 0)]);
        expect(() => derivation.derivedPartXml(xml, 0, { transpositionSemitones: 0 }, 'G2', -1, 'Basso')).toThrowError(EditError);
    });

    it('uses the bass clef transposition of the target when the part starts in the F clef', () => {
        const xml = part([note('B', 2, -1) + note('F', 3) + note('B', 3, -1) + note('D', 4)], attributes(-2, '<clef><sign>F</sign><line>4</line></clef>'));
        expect(derivation.initialClef(openScore(xml))).toBe('F4');
        const bass = derivation.planDerivation(openScore(xml), 0, EUPHONIUM, 'F4');
        expect(bass.targetTransposition).toBe(0);
        expect(bass.range).toEqual({ lowest: 34, highest: 70 });
        expect(bass.octaves.find((octave) => octave.octave === 0)!.label).toBe('Unisono');
        expect(bass.proposed).toBe(0);
        expect(derivation.derivedPartXml(xml, 0, EUPHONIUM, 'F4', 0, 'Euphonium')).toContain('<sign>F</sign>');

        const treble = derivation.planDerivation(openScore(xml), 0, EUPHONIUM, 'G2');
        expect(treble.targetTransposition).toBe(-14);
        expect(treble.range).toEqual({ lowest: 48, highest: 84 });
        expect(treble.octaves.find((octave) => octave.octave === 0)!.label).toBe("Seconda maggiore e un'ottava sopra");
        expect(treble.fifths).toBe(0);
        const derived = derivation.derivedPartXml(xml, 0, EUPHONIUM, 'G2', 0, 'Euphonium');
        expect(pitches(derived)).toEqual(['C4', 'G4', 'C5', 'E5']);
        const document = new DOMParser().parseFromString(derived, 'application/xml');
        const clefs = Array.from(document.getElementsByTagName('clef'));
        expect(clefs.map((clef) => `${text(child(clef, 'sign'))}${text(child(clef, 'line'))}`)).toEqual(['G2']);
    });

    it('replaces every clef of the part and writes one when the part has none', () => {
        const changes = part([note('C', 4), `<attributes><clef><sign>F</sign><line>4</line></clef></attributes>${note('C', 3)}`]);
        const derived = new DOMParser().parseFromString(derivation.derivedPartXml(changes, 0, { transpositionSemitones: 0 }, 'C3', 0, 'Viola'), 'application/xml');
        expect(Array.from(derived.getElementsByTagName('clef')).map((clef) => `${text(child(clef, 'sign'))}${text(child(clef, 'line'))}`)).toEqual(['C3', 'C3']);

        const noClef = part([note('C', 4)], attributes(0, ''));
        const written = new DOMParser().parseFromString(derivation.derivedPartXml(noClef, 0, { transpositionSemitones: 0 }, 'G2-8', 0, 'Tenore'), 'application/xml');
        const clef = written.getElementsByTagName('clef')[0];
        expect(text(child(clef, 'clef-octave-change'))).toBe('-1');
        expect(children(clef.parentElement!).map((item) => item.tagName)).toEqual(['divisions', 'key', 'time', 'clef']);
    });

    it('takes the enharmonic interval when the key would have more than seven accidentals', () => {
        const xml = part([note('C', 4, 1) + note('E', 4, 1)], attributes(7));
        const plan = derivation.planDerivation(openScore(xml), CLARINET, ALTO_SAX, 'G2');
        expect(plan.enharmonic).toBeTrue();
        expect(plan.fifths).toBe(-4);
        expect(plan.octaves.find((octave) => octave.octave === 0)!.label).toBe('Sesta diminuita sopra');
        const derived = derivation.derivedPartXml(xml, CLARINET, ALTO_SAX, 'G2', 0, 'Sax contralto');
        expect(pitches(derived)).toEqual(['Ab4', 'C5']);
        expect(fifths(derived)).toEqual([-4]);

        const impossible = part([note('C', 4), `<attributes><key><fifths>-7</fifths></key></attributes>${note('C', 4, -1)}`], attributes(7));
        const refused = derivation.planDerivation(openScore(impossible), CLARINET, ALTO_SAX, 'G2');
        expect(refused.error).toContain('troppe alterazioni');
        expect(refused.octaves).toEqual([]);
        expect(refused.proposed).toBeNull();
        expect(() => derivation.derivedPartXml(impossible, CLARINET, ALTO_SAX, 'G2', 0, 'Sax')).toThrowError(EditError);
    });

    it('removes the transposition of the source file and moves the key of a part made only of rests', () => {
        const rests = part(['<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>'], attributes(0, '<clef><sign>G</sign><line>2</line></clef>', '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'));
        const derived = derivation.derivedPartXml(rests, CLARINET, ALTO_SAX, 'G2', 0, '');
        expect(derived).not.toContain('<transpose>');
        expect(fifths(derived)).toEqual([1]);
        expect(text(new DOMParser().parseFromString(derived, 'application/xml').querySelector('part-name'))).toBe('Parte');
        expect(derivation.derivedPartXml(rests, CLARINET, { transpositionSemitones: -2 }, 'G2', 0, 'Tromba')).toContain('<fifths>0</fifths>');
    });

    it('names the intervals with quality, compound octaves and direction', () => {
        expect(derivation.intervalLabel({ steps: 0, semitones: 0, fifths: 0 })).toBe('Unisono');
        expect(derivation.intervalLabel({ steps: 0, semitones: 1, fifths: 7 })).toBe('Unisono aumentato sopra');
        expect(derivation.intervalLabel({ steps: 2, semitones: 3, fifths: -3 })).toBe('Terza minore sopra');
        expect(derivation.intervalLabel({ steps: -7, semitones: -12, fifths: 0 })).toBe('Ottava sotto');
        expect(derivation.intervalLabel({ steps: 7, semitones: 11, fifths: -5 })).toBe('Ottava diminuita sopra');
        expect(derivation.intervalLabel({ steps: 3, semitones: 6, fifths: 6 })).toBe('Quarta aumentata sopra');
        expect(derivation.intervalLabel({ steps: 4, semitones: 6, fifths: -6 })).toBe('Quinta diminuita sopra');
        expect(derivation.intervalLabel({ steps: -8, semitones: -14, fifths: 2 })).toBe("Seconda maggiore e un'ottava sotto");
        expect(derivation.intervalLabel({ steps: 14, semitones: 24, fifths: 0 })).toBe('2 ottave sopra');
        expect(derivation.fifthsLabel(1)).toBe('1 diesis (Sol maggiore)');
    });

    it('shifts the range in the bass clef and names its notes', () => {
        expect(derivation.writtenRange(EUPHONIUM, 'F')).toEqual({ lowest: 34, highest: 70 });
        expect(derivation.writtenRange(EUPHONIUM, 'G')).toEqual({ lowest: 48, highest: 84 });
        expect(derivation.writtenRange({ transpositionSemitones: 0, lowestWrittenPitch: 40 }, 'G')).toBeNull();
        expect(derivation.writtenRange({ lowestWrittenPitch: 40, highestWrittenPitch: 77 }, 'G')).toBeNull();
        expect(derivation.writtenRange(null, 'G')).toBeNull();
        expect(derivation.rangeLabel({ lowest: 58, highest: 89 })).toBe('Si♭3–Fa6');
        expect(derivation.clefTransposition(EUPHONIUM, 'F')).toBe(0);
        expect(derivation.clefTransposition({}, 'G')).toBeNull();
    });

    it('warns about the measures with written notes out of range, once per tied note', () => {
        const xml = part([
            note('C', 4) + note('E', 4) + note('G', 4) + note('C', 5),
            note('A', 3) + note('F', 3) + note('C', 7, 0, '<tie type="start"/>') + note('C', 7, 0, '<tie type="stop"/>'),
            note('C', 7, 0, '<tie type="stop"/>') + note('C', 5) + note('C', 5) + note('C', 5)
        ]);
        const score = openScore(xml);
        const warnings = derivation.rangeWarnings(score, { lowest: 58, highest: 89 });
        expect(warnings.map((warning) => warning.measureNumber)).toEqual(['2']);
        expect(warnings[0].noteId).toBe(children(score.measure(1), 'note')[0].getAttribute('id')!);
        expect(derivation.rangeWarnings(score, null)).toEqual([]);
    });
});
