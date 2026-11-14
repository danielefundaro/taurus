import { parseMusicXml } from '../score-player/musicxml-score';
import { child, children, text } from './musicxml-dom';
import { fraction } from './notation-rules';
import { EditError, isRest, pitchOf, ScoreDocument, voiceOf } from './score-document';
import * as edits from './score-edits';
import * as writing from './score-writing';

const PREFIX = 'tw-';
const QUARTER: writing.WritingFigure = { type: 'quarter', dots: 0 };
const HALF: writing.WritingFigure = { type: 'half', dots: 0 };

function attributes(fifths = 0, beats = 4, beatType = 4, clef = '<clef><sign>G</sign><line>2</line></clef>'): string {
    return `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${clef}</attributes>`;
}

const MEASURE_REST = '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>';

/** Parte di battute di pausa, 4/4, chiave di violino, una divisione per semiminima. */
function part(measures: string[]): ScoreDocument {
    const body = measures.map((content, index) => `<measure number="${index + 1}">${content}</measure>`).join('');
    return edits.openScore(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tromba</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`, PREFIX);
}

function empty(count = 2, head = attributes()): ScoreDocument {
    return part(Array.from({ length: count }, (_, index) => (index === 0 ? head : '') + MEASURE_REST));
}

/** Contenuto di una battuta: «C5 quarter~» con la legatura in partenza, «r half» per le pause, «2:» per la voce 2. */
function layout(score: ScoreDocument, index: number): string[] {
    return children(score.measure(index), 'note').map((note) => {
        const pitch = pitchOf(note);
        const voice = voiceOf(note) === '1' ? '' : `${voiceOf(note)}:`;
        const name = isRest(note) ? 'r' : `${pitch!.step}${pitch!.alter === -1 ? 'b' : pitch!.alter === 1 ? '#' : ''}${pitch!.octave}`;
        const tie = children(note, 'tie').some((tie) => tie.getAttribute('type') === 'start') ? '~' : '';
        const chord = child(note, 'chord') ? '+' : '';
        const tuplet = child(note, 'time-modification') ? '/3' : '';
        return `${voice}${chord}${name} ${text(child(note, 'type')) ?? 'measure'}${children(note, 'dot').length ? '.' : ''}${tuplet}${tie}`;
    });
}

function cursor(measureIndex: number, quarters: number, voice = 1): writing.WritingCursor {
    return { measureIndex, voice, offset: fraction(quarters * 8, 8) };
}

function quarters(value: writing.WritingCursor): number {
    return value.offset.num / value.offset.den;
}

describe('score writing', () => {
    it('writes notes at the cursor over the measure rest, keeping the measure complete', () => {
        const score = empty();

        let result = writing.writeNote(score, writing.startCursor(), QUARTER, 'C');
        expect(layout(score, 0)).toEqual(['C5 quarter', 'r quarter', 'r half']);
        expect(quarters(result.cursor)).toBe(1);
        expect(score.note(result.noteId)).toBe(score.notes()[0]);

        result = writing.writeNote(score, result.cursor, QUARTER, 'D');
        result = writing.writeRest(score, result.cursor, QUARTER);
        result = writing.writeNote(score, result.cursor, QUARTER, 'B');
        expect(layout(score, 0)).toEqual(['C5 quarter', 'D5 quarter', 'r quarter', 'B4 quarter']);
        // Alla fine della battuta il cursore passa alla seguente.
        expect(result.cursor).toEqual({ measureIndex: 1, voice: 1, offset: fraction(0) });
        expect(score.checks()).toEqual({ wrongDuration: [], empty: [] });
        expect(parseMusicXml(score.cleanXml()).measures.map((measure) => measure.notes.length)).toEqual([4, 1]);
    });

    it('splits a note longer than the space left and ties it over the barline, adding a measure at the end', () => {
        const score = empty(1, attributes(-1));

        const result = writing.writeNote(score, cursor(0, 3), HALF, 'B');

        expect(score.measures().length).toBe(2);
        expect(layout(score, 0)).toEqual(['r half', 'r quarter', 'Bb4 quarter~']);
        expect(layout(score, 1)).toEqual(['Bb4 quarter', 'r quarter', 'r half']);
        // La nota continuata non ripete l'accidente e suona come quella legata.
        expect(score.measure(1).querySelector('accidental')).toBeNull();
        expect(quarters(result.cursor)).toBe(1);
        expect(result.cursor.measureIndex).toBe(1);
        expect(score.measure(1).getAttribute('number')).toBe('2');
        expect(score.checks().wrongDuration).toEqual([]);
        const notes = parseMusicXml(score.cleanXml()).measures.flatMap((measure) => measure.notes.filter((note) => note.midi !== null));
        expect(notes.map((note) => [note.midi, note.tieStart, note.tieStop])).toEqual([
            [70, true, false],
            [70, false, true]
        ]);
    });

    it('turns into rests what a note covers only in part, and keeps a dotted figure that fits', () => {
        const score = part([attributes() + '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>']);

        writing.writeNote(score, writing.startCursor(), QUARTER, 'D');
        expect(layout(score, 0)).toEqual(['D5 quarter', 'r quarter', 'r half']);

        writing.writeNote(score, cursor(0, 1), { type: 'half', dots: 1 }, 'E');
        expect(layout(score, 0)).toEqual(['D5 quarter', 'E5 half.']);
    });

    it('shortens the note that starts before the cursor and keeps its tie with the previous note', () => {
        const score = part([
            attributes() +
                '<note><rest/><duration>2</duration><voice>1</voice><type>half</type></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><type>half</type><notations><tied type="start"/></notations></note>',
            '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice><type>whole</type><notations><tied type="stop"/></notations></note>'
        ]);

        writing.writeNote(score, cursor(1, 2), QUARTER, 'A');

        expect(layout(score, 0)).toEqual(['r half', 'G4 half~']);
        expect(layout(score, 1)).toEqual(['G4 half', 'A4 quarter', 'r quarter']);
        expect(children(score.measure(1).querySelector('note')!, 'tie').map((tie) => tie.getAttribute('type'))).toEqual(['stop']);
    });

    it('writes in the other voices, which appear in the measure as a measure rest and stay complete', () => {
        const score = empty(1);
        writing.writeNote(score, writing.startCursor(), HALF, 'E');

        const result = writing.writeNote(score, cursor(0, 0, 2), QUARTER, 'C');

        expect(layout(score, 0)).toEqual(['E5 half', 'r half', '2:C5 quarter', '2:r quarter', '2:r half']);
        expect(score.measure(0).querySelector('backup duration')?.textContent).toBe('4');
        expect(result.cursor).toEqual({ measureIndex: 0, voice: 2, offset: fraction(1) });
        expect(score.checks().wrongDuration).toEqual([]);
        expect(writing.cursorLabel(score, result.cursor)).toBe('Battuta 1 · tempo 2 · voce 2');

        // Una voce oltre la prima, fatta solo di pause, si toglie dalla battuta.
        const second = score.notes().find((note) => voiceOf(note) === '2' && !isRest(note))!;
        writing.clearWrittenNote(score, second.getAttribute('id')!);
        writing.clearWrittenNote(
            score,
            score
                .notes()
                .find((note) => voiceOf(note) === '2')!
                .getAttribute('id')!
        );
        expect(layout(score, 0)).toEqual(['E5 half', 'r half']);
        expect(score.measure(0).querySelector('backup')).toBeNull();
        expect(() => writing.clearWrittenNote(score, score.notes()[1].getAttribute('id')!)).toThrowError(EditError);
    });

    it('creates a tuplet at the cursor and fills it with the notes written after', () => {
        const score = empty(1);

        const tuplet = writing.writeTuplet(score, writing.startCursor(), QUARTER, 3);
        expect(tuplet.figure).toEqual({ type: 'eighth', dots: 0 });
        expect(layout(score, 0)).toEqual(['r eighth/3', 'r eighth/3', 'r eighth/3', 'r quarter', 'r half']);

        let result = writing.writeNote(score, tuplet.cursor, tuplet.figure, 'C');
        result = writing.writeNote(score, result.cursor, tuplet.figure, 'D');
        expect(() => writing.writeNote(score, result.cursor, QUARTER, 'E')).toThrowError(EditError, /gruppo irregolare/);
        result = writing.writeNote(score, result.cursor, tuplet.figure, 'E');
        expect(layout(score, 0)).toEqual(['C5 eighth/3', 'D5 eighth/3', 'E5 eighth/3', 'r quarter', 'r half']);
        expect(quarters(result.cursor)).toBe(1);
        const marks = children(score.measure(0), 'note').map((note) =>
            children(child(note, 'notations'), 'tuplet')
                .map((item) => item.getAttribute('type'))
                .join()
        );
        expect(marks.slice(0, 3)).toEqual(['start', '', 'stop']);
        expect(score.checks().wrongDuration).toEqual([]);

        // Una nota da fuori non copre solo una parte del gruppo.
        expect(() => writing.writeNote(score, writing.startCursor(), { type: 'eighth', dots: 0 }, 'G')).not.toThrow();
        expect(() => writing.writeRest(score, cursor(0, 0), HALF)).not.toThrow();
        expect(layout(score, 0)).toEqual(['r half', 'r half']);
        expect(() => writing.writeTuplet(score, writing.startCursor(), { type: 'quarter', dots: 1 }, 3)).toThrowError(EditError);
    });

    it('turns a note into a tuplet and back, keeping its pitch', () => {
        const score = empty(1);
        const { noteId } = writing.writeNote(score, writing.startCursor(), QUARTER, 'G');

        const first = writing.toggleWrittenTuplet(score, noteId, 3);
        expect(layout(score, 0)).toEqual(['G4 eighth/3', 'r eighth/3', 'r eighth/3', 'r quarter', 'r half']);

        const back = writing.toggleWrittenTuplet(score, first, 3);
        expect(layout(score, 0)).toEqual(['G4 quarter', 'r quarter', 'r half']);
        expect(score.note(back)).toBe(score.notes()[0]);
    });

    it('lengthens a note over the next ones and shortens it leaving a rest', () => {
        const score = empty(1);
        let result = writing.writeNote(score, writing.startCursor(), QUARTER, 'C');
        result = writing.writeNote(score, result.cursor, QUARTER, 'D');
        writing.writeNote(score, result.cursor, HALF, 'E');
        const first = score.notes()[0].getAttribute('id')!;

        const longer = writing.setWrittenDuration(score, first, { type: 'half', dots: 1 });
        expect(layout(score, 0)).toEqual(['C5 half.', 'r quarter']);

        writing.setWrittenDuration(score, longer, { type: 'eighth', dots: 0 });
        expect(layout(score, 0)).toEqual(['C5 eighth', 'r eighth', 'r quarter', 'r quarter', 'r quarter']);

        writing.cycleWrittenDots(score, score.notes()[0].getAttribute('id')!);
        expect(layout(score, 0)[0]).toBe('C5 eighth.');
        expect(score.checks().wrongDuration).toEqual([]);
    });

    it('ties the next note to the previous one and adds notes to the chord, also on the tied notes', () => {
        const score = empty(1);
        let result = writing.writeNote(score, writing.startCursor(), QUARTER, 'C');
        const tied = writing.writeTied(score, result.cursor, QUARTER);
        expect(layout(score, 0)).toEqual(['C5 quarter~', 'C5 quarter', 'r half']);

        const added = writing.addChordPitch(score, result.noteId, 'E');
        expect(layout(score, 0)).toEqual(['C5 quarter~', '+E5 quarter~', 'C5 quarter', '+E5 quarter', 'r half']);
        expect(score.note(added)).toBe(score.notes()[1]);
        expect(() => writing.writeTied(score, writing.startCursor(), QUARTER)).toThrowError(EditError);
        expect(() => writing.addChordPitch(score, score.notes()[4].getAttribute('id')!, 'G')).toThrowError(EditError);

        result = writing.writeRest(score, tied.cursor, QUARTER);
        expect(() => writing.writeTied(score, result.cursor, QUARTER)).toThrowError(EditError);
    });

    it('moves the cursor note by note across the measures and keeps it inside the part', () => {
        const score = empty(2);
        writing.writeNote(score, writing.startCursor(), HALF, 'C');

        let current = writing.moveCursor(score, writing.startCursor(), 1);
        expect(quarters(current)).toBe(2);
        expect(writing.noteAtCursor(score, current)).toBe(score.notes()[1].getAttribute('id'));
        current = writing.moveCursor(score, current, 1);
        expect(current).toEqual({ measureIndex: 1, voice: 1, offset: fraction(0) });
        current = writing.moveCursor(score, current, 1);
        expect(writing.cursorLabel(score, current)).toBe('Battuta 2 · fine della battuta · voce 1');
        expect(writing.noteAtCursor(score, current)).toBeNull();
        current = writing.moveCursor(score, writing.moveCursor(score, current, -1), -1);
        expect(quarters(current)).toBe(2);
        expect(current.measureIndex).toBe(0);
        expect(writing.moveCursor(score, writing.startCursor(), -1)).toEqual(writing.startCursor());

        expect(writing.clampCursor(score, { measureIndex: 7, voice: 1, offset: fraction(0) })).toEqual({ measureIndex: 1, voice: 1, offset: fraction(4) });
        expect(writing.clampCursor(score, { measureIndex: 0, voice: 1, offset: fraction(9) })).toEqual({ measureIndex: 0, voice: 1, offset: fraction(4) });
        expect(writing.cursorAt(score, score.notes()[1].getAttribute('id')!)).toEqual({ measureIndex: 0, voice: 1, offset: fraction(2) });
    });

    it('starts the next note at the end of the part in a new measure', () => {
        const score = empty(1);
        const result = writing.writeNote(score, { measureIndex: 0, voice: 1, offset: fraction(4) }, QUARTER, 'F');

        expect(score.measures().length).toBe(2);
        expect(layout(score, 1)).toEqual(['F4 quarter', 'r quarter', 'r half']);
        expect(result.cursor.measureIndex).toBe(1);
    });

    it('completes the measures shortened by a change of time signature', () => {
        const score = empty(2);
        writing.writeNote(score, writing.startCursor(), { type: 'whole', dots: 0 }, 'C');

        edits.setTime(score, 0, 5, 4);
        writing.completeMeasures(score, 0);

        expect(layout(score, 0)).toEqual(['C5 whole', 'r quarter']);
        expect(score.checks().wrongDuration).toEqual([]);
    });

    it('writes the pickup measure with its own length and continues into the first measure', () => {
        const score = part([attributes() + '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>', MEASURE_REST]);
        score.measure(0).setAttribute('implicit', 'yes');

        const result = writing.writeNote(score, writing.startCursor(), HALF, 'G');

        expect(layout(score, 0)).toEqual(['G4 quarter~']);
        expect(layout(score, 1)).toEqual(['G4 quarter', 'r quarter', 'r half']);
        expect(result.cursor).toEqual({ measureIndex: 1, voice: 1, offset: fraction(1) });
        expect(writing.measureLength(score, 0)).toBe(1);
    });

    it('writes the key signature alterations and the percussion positions', () => {
        const flat = empty(1, attributes(-1));
        writing.writeNote(flat, writing.startCursor(), QUARTER, 'B');
        expect(pitchOf(flat.notes()[0])).toEqual({ step: 'B', octave: 4, alter: -1, unpitched: false });
        expect(flat.notes()[0].querySelector('accidental')).toBeNull();

        const drums = empty(1, attributes(0, 4, 4, '<clef><sign>percussion</sign></clef>'));
        writing.writeNote(drums, writing.startCursor(), QUARTER, 'C');
        expect(drums.notes()[0].querySelector('unpitched display-step')?.textContent).toBe('C');
        expect(drums.notes()[0].querySelector('pitch')).toBeNull();
    });

    it('rests in compound time follow the dotted beats', () => {
        const score = empty(1, attributes(0, 6, 8));
        score.notes()[0].querySelector('duration')!.textContent = '3';

        writing.writeNote(score, writing.startCursor(), { type: 'eighth', dots: 0 }, 'A');

        expect(layout(score, 0)).toEqual(['A4 eighth', 'r eighth', 'r eighth', 'r quarter.']);
        expect(writing.cursorLabel(score, { measureIndex: 0, voice: 1, offset: fraction(3, 2) })).toBe('Battuta 1 · tempo 2 · voce 1');
        expect(writing.figureLabel({ type: 'quarter', dots: 1 })).toBe('semiminima puntata');
    });

    it('refuses voices and measures that do not exist', () => {
        const score = empty(1);
        expect(() => writing.writeNote(score, { measureIndex: 3, voice: 1, offset: fraction(0) }, QUARTER, 'C')).toThrowError(EditError);
        expect(() => writing.writeNote(score, { measureIndex: 0, voice: 5, offset: fraction(0) }, QUARTER, 'C')).toThrowError(EditError);
    });
});
