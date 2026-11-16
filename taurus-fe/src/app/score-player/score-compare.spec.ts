import cases from './compare-cases.json';
import { compareMeasures, differenceCounts, differenceText, MeasureComparison, opcodes, pitchName, readMeasures } from './score-compare';
import { musicXml } from './score-player.testing';

/** Le differenze come le scrive `compare.py`: prima le battute, poi i segni della versione di riferimento non trovati. */
function asMusicService(comparison: MeasureComparison): { kind: string; measure: string; marks?: string[] }[] {
    const measures = comparison.differences
        .filter((difference) => difference.kind !== 'marks')
        .map((difference) => ({ kind: difference.kind, measure: difference.kind === 'extra' ? (difference.after?.number ?? '0') : (difference.reference?.number ?? '') }));
    const marks = comparison.differences
        .filter((difference) => difference.kind === 'marks' && difference.marks?.reference.length)
        .map((difference) => ({ kind: 'marks', measure: difference.reference?.number ?? '', marks: [...(difference.marks?.reference ?? [])].sort() }));
    return [...measures, ...marks];
}

function sharedCase(name: string): string {
    const found = cases.cases.find((item) => item.name === name);
    if (!found) throw new Error(name);
    return found.candidate;
}

const LABELS = { reference: 'versione 5', candidate: 'versione 4' };

describe('score-compare', () => {
    const reference = readMeasures(cases.reference);

    for (const shared of cases.cases) {
        it(`compares the shared case "${shared.name}" like the music service`, () => {
            const comparison = compareMeasures(reference, readMeasures(shared.candidate));
            const { differences, ...counts } = shared.expected;
            expect({
                referenceMeasures: comparison.referenceMeasures,
                candidateMeasures: comparison.candidateMeasures,
                correctMeasures: comparison.correctMeasures,
                referenceMarks: comparison.referenceMarks,
                foundMarks: comparison.foundMarks
            }).toEqual(counts);
            expect(asMusicService(comparison)).toEqual(differences);
        });
    }

    it('aligns like difflib', () => {
        const chars = (text: string) => [...text];
        expect(opcodes(chars('qabxcd'), chars('abycdf'))).toEqual([
            ['delete', 0, 1, 0, 0],
            ['equal', 1, 3, 0, 2],
            ['replace', 3, 4, 2, 3],
            ['equal', 4, 6, 3, 5],
            ['insert', 6, 6, 5, 6]
        ]);
        expect(opcodes(chars('aaabaaa'), chars('aabaaaa'))).toEqual([
            ['delete', 0, 1, 0, 0],
            ['equal', 1, 7, 0, 6],
            ['insert', 7, 7, 6, 7]
        ]);
        expect(opcodes(chars('abcabcabc'), chars('abcxabc'))).toEqual([
            ['equal', 0, 3, 0, 3],
            ['insert', 3, 3, 3, 4],
            ['equal', 3, 6, 4, 7],
            ['delete', 6, 9, 7, 7]
        ]);
        expect(opcodes([], chars('ab'))).toEqual([['insert', 0, 0, 0, 2]]);
        expect(opcodes(chars('ab'), [])).toEqual([['delete', 0, 2, 0, 0]]);
        expect(opcodes([], [])).toEqual([]);
    });

    it('counts the different measures by kind', () => {
        expect(differenceCounts(compareMeasures(reference, readMeasures(sharedCase('notes'))))).toEqual({ pitch: 1, rhythm: 2, tie: 1, missing: 0, extra: 0 });
        expect(differenceCounts(compareMeasures(reference, readMeasures(sharedCase('multiRest'))))).toEqual({ pitch: 0, rhythm: 0, tie: 0, missing: 2, extra: 0 });
    });

    it('describes every difference', () => {
        const texts = (name: string) => compareMeasures(reference, readMeasures(sharedCase(name))).differences.map((difference) => differenceText(difference, LABELS));
        expect(texts('notes')).toEqual(['Battuta 2: altezze diverse (Fa5 invece di Fa4)', 'Battuta 10: legatura di valore', 'Battuta 11: ritmo diverso', 'Battuta 13: ritmo diverso']);
        expect(texts('missing')).toEqual(['Battuta 4: solo nella versione 5']);
        expect(texts('extra')).toEqual(['Battuta x: solo nella versione 4']);
        expect(texts('marks')).toEqual(['Battuta 1: tempo 96 solo nella versione 5', 'Battuta 10: inizio del ritornello solo nella versione 4']);
        expect(texts('same')).toEqual([]);
    });

    it('reports the marks of both versions, the extra ones too', () => {
        const comparison = compareMeasures(reference, readMeasures(sharedCase('marks')));
        expect(comparison.differences.filter((difference) => difference.kind === 'marks').map((difference) => difference.marks)).toEqual([
            { reference: ['tempo 96'], candidate: [] },
            { reference: [], candidate: ['ritornello inizio'] }
        ]);
    });

    it('names the measure of the other version when the numbers differ', () => {
        const document = new DOMParser().parseFromString(sharedCase('notes'), 'application/xml');
        document.querySelectorAll('measure').forEach((measure, index) => measure.setAttribute('number', String(index + 2)));
        const comparison = compareMeasures(reference, readMeasures(new XMLSerializer().serializeToString(document)));
        expect(differenceText(comparison.differences[0], LABELS)).toBe('Battuta 2 (3 nella versione 4): altezze diverse (Fa5 invece di Fa4)');
    });

    it('counts the other different pitches of a measure', () => {
        const note = (step: string, octave: number) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration></note>`;
        const first = readMeasures(musicXml([`<attributes><divisions>1</divisions></attributes>${note('C', 5)}${note('D', 5)}${note('E', 5)}${note('F', 5)}`]));
        const two = readMeasures(musicXml([`<attributes><divisions>1</divisions></attributes>${note('C', 5)}${note('E', 5)}${note('F', 5)}${note('F', 5)}`]));
        const one = readMeasures(musicXml([`<attributes><divisions>1</divisions></attributes>${note('C', 5)}${note('D', 5)}${note('G', 5)}${note('F', 5)}`]));
        expect(differenceText(compareMeasures(first, two).differences[0], LABELS)).toBe("Battuta 1: altezze diverse (Re5 invece di Mi5 e un'altra nota)");
        expect(differenceText(compareMeasures(first, one).differences[0], LABELS)).toBe('Battuta 1: altezze diverse (Mi5 invece di Sol5)');
        const three = readMeasures(musicXml([`<attributes><divisions>1</divisions></attributes>${note('D', 5)}${note('E', 5)}${note('F', 5)}${note('G', 5)}`]));
        expect(differenceText(compareMeasures(first, three).differences[0], LABELS)).toBe('Battuta 1: altezze diverse (Do5 invece di Re5 e altre 3 note)');
    });

    it('compares the sound, so a transposed part equals the same part in concert pitch', () => {
        const attributes = (fifths: number) => `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
        const written = musicXml([`${attributes(0)}<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration></note>`]);
        const concert = musicXml([`${attributes(-2)}<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration></note>`]);
        const trumpet = readMeasures(written, 0, { transpositionSemitones: -2 });
        expect(compareMeasures(readMeasures(concert), trumpet).differences).toEqual([]);
        const difference = compareMeasures(readMeasures(concert), readMeasures(written)).differences[0];
        expect(differenceText(difference, LABELS)).toBe('Battuta 1: altezze diverse (Do5 invece di Re5)');
    });

    it('uses the bass clef transposition for a part in F clef', () => {
        const part = musicXml(['<attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration></note>']);
        expect(readMeasures(part, 0, { transpositionSemitones: -14, bassClefTranspositionSemitones: -2 })[0].notes[0].midi).toBe(46);
        expect(readMeasures(part, 0, { transpositionSemitones: -14, bassClefTranspositionSemitones: null })[0].notes[0].midi).toBe(34);
        expect(readMeasures(part, 0, { transpositionSemitones: -14 })[0].notes[0].written).toBe(48);
    });

    it('names the written notes with the key signature', () => {
        expect(pitchName(60)).toBe('Do4');
        expect(pitchName(61)).toBe('Do♯4');
        expect(pitchName(61, -2)).toBe('Re♭4');
        expect(pitchName(70)).toBe('Si♭4');
        expect(pitchName(70, 1)).toBe('La♯4');
        expect(pitchName(59, -3)).toBe('Si3');
    });
});
