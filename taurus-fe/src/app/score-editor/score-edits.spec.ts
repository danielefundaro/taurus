import { parseMusicXml } from '../score-player/musicxml-score';
import { excerpt } from './excerpt';
import { EditError, pitchOf, ScoreDocument } from './score-document';
import * as edits from './score-edits';

const PREFIX = 'tx-';

/** Si bemolle maggiore, 4/4, chiave di violino, una divisione per semiminima. */
function score(measures: string[] = DEFAULT_MEASURES): ScoreDocument {
    const body = measures.map((content, index) => `<measure number="${index + 1}">${content}</measure>`).join('');
    return edits.openScore(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flicorno</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`, PREFIX);
}

const ATTRIBUTES = '<attributes><divisions>1</divisions><key><fifths>-2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';

function note(step: string, octave: number, type = 'quarter', extra = ''): string {
    const duration = ({ whole: 4, half: 2, quarter: 1 } as Record<string, number>)[type] ?? 1;
    return `<note><pitch><step>${step}</step>${extra}<octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type></note>`;
}

function rest(type = 'quarter'): string {
    const duration = ({ whole: 4, half: 2, quarter: 1 } as Record<string, number>)[type] ?? 1;
    return `<note><rest/><duration>${duration}</duration><voice>1</voice><type>${type}</type></note>`;
}

const DEFAULT_MEASURES = [
    ATTRIBUTES + note('B', 4, 'quarter', '<alter>-1</alter>') + note('C', 5) + note('D', 5) + rest(),
    note('F', 4) + note('F', 4) + note('E', 4, 'half', '<alter>-1</alter>'),
    '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>'
];

function ids(document: ScoreDocument): string[] {
    return document.notes().map((item) => item.getAttribute('id')!);
}

function pitch(document: ScoreDocument, index: number): string {
    const value = pitchOf(document.notes()[index])!;
    return `${value.step}${value.alter > 0 ? '#'.repeat(value.alter) : 'b'.repeat(-value.alter)}${value.octave}`;
}

describe('score editor', () => {
    it('gives an id to every measure and note and removes the working attributes from the saved file', () => {
        const document = score();

        expect(document.measures().every((measure) => measure.getAttribute('id')?.startsWith(PREFIX))).toBeTrue();
        expect(ids(document).every((id) => id.startsWith(PREFIX))).toBeTrue();
        expect(document.measureSources()).toEqual([0, 1, 2]);
        const saved = document.cleanXml();
        expect(saved).toContain('<?xml');
        expect(saved).not.toContain(PREFIX);
        expect(saved).not.toContain('taurus-');
        expect(parseMusicXml(saved).measures.length).toBe(3);
    });

    it('writes the accidentals that the key signature does not explain, without changing the sound', () => {
        const document = score([ATTRIBUTES + note('A', 4, 'quarter', '<alter>-1</alter>') + note('A', 4, 'quarter', '<alter>-1</alter>') + note('B', 4, 'half', '<alter>-1</alter>')]);

        const accidentals = document.notes().map((item) => item.querySelector('accidental')?.textContent ?? null);

        expect(accidentals).toEqual(['flat', null, null]);
        expect([pitch(document, 0), pitch(document, 1), pitch(document, 2)]).toEqual(['Ab4', 'Ab4', 'Bb4']);
    });

    it('moves notes by degree following the key signature and the accidentals of the measure', () => {
        const document = score();
        const [, second] = ids(document);

        edits.moveStep(document, second, -1);
        expect(pitch(document, 1)).toBe('Bb4');
        edits.moveStep(document, second, 7);
        expect(pitch(document, 1)).toBe('Bb5');
        edits.setPitchLetter(document, second, 'D');
        expect(pitch(document, 1)).toBe('D6');

        const [, , , , fifth] = ids(document);
        edits.setAlteration(document, fifth, 'sharp');
        expect([pitch(document, 4), pitch(document, 5)]).toEqual(['F#4', 'F#4']);
        edits.setAlteration(document, fifth, 'none');
        expect([pitch(document, 4), pitch(document, 5)]).toEqual(['F4', 'F4']);
    });

    it('applies a corrected key signature to the notes without accidentals', () => {
        const document = score();

        edits.setKey(document, 0, 0);

        expect([pitch(document, 0), pitch(document, 6)]).toEqual(['B4', 'E4']);
        expect(edits.measureInfo(document, 0).fifths).toBe(0);
    });

    it('keeps the notes on the same staff positions when the clef is corrected', () => {
        const document = score();

        edits.setClef(document, 0, 'F4');

        expect(pitch(document, 1)).toBe('Eb3');
        expect(pitch(document, 0)).toBe('D3');
        expect(edits.measureInfo(document, 0).clef).toBe('F4');
        edits.setClef(document, 1, 'G2');
        expect(pitch(document, 4)).toBe('F4');
        expect(pitch(document, 1)).toBe('Eb3');
    });

    it('changes durations, refines the divisions and reports the measures of the wrong length', () => {
        const document = score();
        const [first] = ids(document);

        edits.setNoteType(document, first, 'eighth');

        expect(document.stateAt(0).divisions).toBe(2);
        expect(document.notes()[1].querySelector('duration')?.textContent).toBe('2');
        expect(document.checks().wrongDuration).toEqual([0]);
        edits.cycleDots(document, first);
        expect(edits.noteInfo(document, first).dots).toBe(1);
        edits.setNoteType(document, first, 'quarter');
        edits.cycleDots(document, first);
        edits.cycleDots(document, first);
        expect(edits.noteInfo(document, first).dots).toBe(0);
        expect(document.checks().wrongDuration).toEqual([]);
    });

    it('beams the eighths of the same beat', () => {
        const document = score([ATTRIBUTES + note('C', 5) + note('D', 5) + note('E', 5) + note('F', 5)]);
        const [first, second] = ids(document);

        edits.setNoteType(document, first, 'eighth');
        edits.setNoteType(document, second, 'eighth');

        const beams = document.notes().map((item) => item.querySelector('beam')?.textContent ?? null);
        expect(beams).toEqual(['begin', 'end', null, null]);
    });

    it('turns notes into rests and back, inserts, adds to chords and deletes', () => {
        const document = score();
        const [first, second] = ids(document);

        edits.toggleRest(document, second);
        expect(edits.noteInfo(document, second).rest).toBeTrue();
        edits.toggleRest(document, second);
        expect(pitch(document, 1)).toBe('Bb4');

        const inserted = edits.insertNote(document, first, 'after');
        expect(ids(document)[1]).toBe(inserted);
        expect(document.checks().wrongDuration).toEqual([0]);
        expect(edits.deleteNote(document, inserted)).toBe(ids(document)[1]);

        const chord = edits.addChordNote(document, first);
        expect(edits.noteInfo(document, first).chordSize).toBe(2);
        expect(pitch(document, 1)).toBe('D5');
        edits.deleteNote(document, first);
        expect(edits.noteInfo(document, chord).chordSize).toBe(1);
        expect(document.note(chord).querySelector('chord')).toBeNull();
        expect(document.checks().wrongDuration).toEqual([]);
    });

    it('ties notes of the same pitch, also across the bar line, and refuses different pitches', () => {
        const document = score([ATTRIBUTES + note('C', 5, 'half') + note('C', 5, 'half'), note('C', 5, 'whole')]);
        const [first, second] = ids(document);

        edits.toggleTie(document, first);
        expect(edits.noteInfo(document, first).tieStart).toBeTrue();
        expect(edits.noteInfo(document, second).tieStop).toBeTrue();
        edits.toggleTie(document, second);
        expect(edits.noteInfo(document, ids(document)[2]).tieStop).toBeTrue();

        edits.moveStep(document, first, 1);
        expect([pitch(document, 0), pitch(document, 1), pitch(document, 2)]).toEqual(['D5', 'D5', 'D5']);

        edits.toggleTie(document, first);
        expect(edits.noteInfo(document, second).tieStop).toBeFalse();
        edits.moveStep(document, second, 1);
        expect(() => edits.toggleTie(document, first)).toThrowError(EditError);
    });

    it('groups three notes in a triplet and removes the group', () => {
        const document = score([ATTRIBUTES + note('C', 5) + note('D', 5) + note('E', 5) + note('F', 5)]);
        const [first] = ids(document);
        edits.setNoteType(document, first, 'eighth');
        edits.setNoteType(document, ids(document)[1], 'eighth');
        edits.setNoteType(document, ids(document)[2], 'eighth');

        edits.toggleTuplet(document, first, 3);

        expect(edits.noteInfo(document, ids(document)[1]).tuplet).toBe(3);
        expect(document.checks().wrongDuration).toEqual([0]);
        expect(() => edits.deleteNote(document, ids(document)[1])).toThrowError(EditError);
        edits.toggleTuplet(document, ids(document)[2], 3);
        expect(edits.noteInfo(document, ids(document)[1]).tuplet).toBeNull();
    });

    it('inserts and deletes measures keeping their attributes and the source of each measure', () => {
        const document = score();

        edits.insertMeasure(document, 0, 'before');
        expect(document.measureSources()).toEqual([null, 0, 1, 2]);
        expect(document.measures().map((measure) => measure.getAttribute('number'))).toEqual(['1', '2', '3', '4']);
        expect(edits.measureInfo(document, 0).fifths).toBe(-2);
        expect(document.checks().wrongDuration).toEqual([]);

        edits.deleteMeasure(document, 0);
        edits.deleteMeasure(document, 0);
        expect(document.measureSources()).toEqual([1, 2]);
        expect(document.stateAt(0)).toEqual(jasmine.objectContaining({ divisions: 1, fifths: -2, beats: 4 }));
        expect(pitch(document, 0)).toBe('F4');
    });

    it('never leaves a measure without notes and fills the empty ones with a measure rest', () => {
        const document = score([ATTRIBUTES + note('C', 5, 'whole'), '', note('D', 5, 'whole')]);
        expect(document.checks().empty).toEqual([1]);
        expect(edits.measureInfo(document, 1).empty).toBeTrue();

        const rest = edits.fillEmptyMeasure(document, 1);
        expect(edits.noteInfo(document, rest).rest).toBeTrue();
        expect(document.checks()).toEqual({ wrongDuration: [], empty: [] });
        expect(() => edits.fillEmptyMeasure(document, 1)).toThrowError(EditError);

        const replaced = edits.deleteNote(document, ids(document)[0])!;
        expect(edits.noteInfo(document, replaced)).toEqual(jasmine.objectContaining({ rest: true, measureIndex: 0 }));
        expect(document.checks().empty).toEqual([]);
        expect(() => edits.deleteNote(document, replaced)).toThrowError(EditError);
    });

    it('adds measures after the selected one, also after a whole multi-measure rest', () => {
        const document = score();

        expect(edits.insertMeasures(document, 0, 2)).toBe(1);
        expect(document.measureSources()).toEqual([0, null, null, 1, 2]);
        expect(document.checks()).toEqual({ wrongDuration: [], empty: [] });
        expect(edits.measureInfo(document, 0).hasNotes).toBeTrue();
        expect(edits.measureInfo(document, 1).hasNotes).toBeFalse();

        // Una battuta aggiunta che diventa una pausa di più battute: il gruppo nasce senza toccare le battute esistenti.
        edits.insertMeasures(document, 4, 1);
        edits.setMultiRest(document, 5, 4);
        expect(document.measures().length).toBe(9);
        expect(edits.measureInfo(document, 5).multiRest).toBe(4);

        // Dentro una pausa di più battute le battute si aggiungono dopo l'intero gruppo, che resta intatto.
        expect(edits.insertMeasures(document, 6, 1)).toBe(9);
        expect(edits.measureInfo(document, 5).multiRest).toBe(4);
        expect(parseMusicXml(document.cleanXml()).measures.length).toBe(10);
        expect(() => edits.insertMeasures(document, 0, 0)).toThrowError(EditError);
    });

    it('fixes the number of measures of a multi-measure rest', () => {
        const document = score();

        edits.setMultiRest(document, 2, 3);

        expect(document.measures().length).toBe(5);
        expect(edits.measureInfo(document, 2).multiRest).toBe(3);
        expect(parseMusicXml(document.cleanXml()).measures.length).toBe(5);
        edits.setMultiRest(document, 2, 1);
        expect(document.measures().length).toBe(3);
        expect(edits.measureInfo(document, 2).multiRest).toBe(1);
    });

    it('writes repeats, endings, jumps and tempo that the player reads', () => {
        const document = score();

        edits.toggleRepeat(document, 0, 'forward');
        edits.toggleRepeat(document, 1, 'backward');
        edits.setEnding(document, 1, '1');
        edits.setEnding(document, 2, '2');
        edits.toggleMark(document, 2, 'daCapo');
        edits.setTempo(document, 0, 96);

        const part = parseMusicXml(document.cleanXml());
        expect(part.measures[0].forwardRepeat).toBeTrue();
        expect(part.measures[1].backwardRepeatTimes).toBe(2);
        expect(part.measures[1].ending).toEqual(jasmine.objectContaining({ numbers: [1], start: true, stop: true }));
        expect(part.measures[2].ending?.numbers).toEqual([2]);
        expect(part.measures[2].daCapo).toBeTrue();
        expect(part.measures[0].tempo).toBe(96);
        expect(edits.measureInfo(document, 2).marks).toEqual(['daCapo']);

        edits.toggleMark(document, 2, 'daCapo');
        edits.setEnding(document, 2, null);
        edits.setTempo(document, 0, null);
        const reread = parseMusicXml(document.cleanXml());
        expect(reread.measures[2].daCapo).toBeFalse();
        expect(reread.measures[2].ending).toBeNull();
        expect(reread.measures[0].tempo).toBeNull();
    });

    it('adds dynamics and articulations to the selected note', () => {
        const document = score();
        const [first] = ids(document);

        edits.setDynamic(document, first, 'mf');
        edits.setDynamic(document, first, 'p');
        edits.toggleArticulation(document, first, 'staccato');

        expect(edits.noteInfo(document, first)).toEqual(jasmine.objectContaining({ dynamic: 'p', articulations: ['staccato'] }));
        expect(document.measure(0).querySelectorAll('dynamics').length).toBe(1);
        edits.toggleArticulation(document, first, 'staccato');
        expect(document.note(first).querySelector('notations')).toBeNull();
    });

    it('restores a snapshot with its ids, giving new ids after the restored ones', () => {
        const document = score();
        const before = document.snapshot();
        edits.moveStep(document, ids(document)[0], 1);

        expect(pitch(ScoreDocument.restore(before, PREFIX), 0)).toBe('Bb4');
        const restored = ScoreDocument.restore(document.snapshot(), PREFIX);
        expect(pitch(restored, 0)).toBe('C5');
        expect(ids(restored)).toEqual(ids(document));
        expect(restored.newId('n')).not.toEqual(ids(restored)[ids(restored).length - 1]);
    });

    it('plays a passage straight, without repeats and jumps', () => {
        const document = score();
        edits.toggleRepeat(document, 1, 'backward');
        edits.setTempo(document, 0, 80);

        const passage = excerpt(parseMusicXml(document.cleanXml()), 2, 1);

        expect(passage.measures.length).toBe(2);
        expect(passage.measures[1].backwardRepeatTimes).toBe(0);
        expect(passage.measures[0].tempo).toBe(80);
    });
});
