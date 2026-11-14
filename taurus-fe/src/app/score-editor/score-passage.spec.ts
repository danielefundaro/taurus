import { child, children, text } from './musicxml-dom';
import { fraction } from './notation-rules';
import { EditError, isRest, pitchOf, ScoreDocument, voiceOf } from './score-document';
import * as edits from './score-edits';
import * as passages from './score-passage';
import * as writing from './score-writing';

const PREFIX = 'tp-';
const QUARTER: writing.WritingFigure = { type: 'quarter', dots: 0 };
const HALF: writing.WritingFigure = { type: 'half', dots: 0 };
const MEASURE_REST = '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>';

function attributes(fifths = 0): string {
    return `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
}

/** Parte di battute di pausa in 4/4, una divisione per semiminima. */
function empty(count = 3, fifths = 0): ScoreDocument {
    const body = Array.from({ length: count }, (_, index) => `<measure number="${index + 1}">${index === 0 ? attributes(fifths) : ''}${MEASURE_REST}</measure>`).join('');
    return edits.openScore(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tromba</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`, PREFIX);
}

function cursor(measureIndex: number, quarters: number, voice = 1): writing.WritingCursor {
    return { measureIndex, voice, offset: fraction(quarters * 8, 8) };
}

/** Scrive note di una semiminima dal cursore indicato. */
function notes(score: ScoreDocument, at: writing.WritingCursor, steps: string, figure = QUARTER): string[] {
    const ids: string[] = [];
    let current = at;
    for (const step of steps.split(' ')) {
        const result = step === 'r' ? writing.writeRest(score, current, figure) : writing.writeNote(score, current, figure, step as 'C');
        ids.push(result.noteId);
        current = result.cursor;
    }
    return ids;
}

/** Contenuto di una battuta come nelle specifiche della scrittura: «F#5 quarter~», «2:G4 whole», «r measure». */
function layout(score: ScoreDocument, index: number): string[] {
    return children(score.measure(index), 'note').map((note) => {
        const pitch = pitchOf(note);
        const voice = voiceOf(note) === '1' ? '' : `${voiceOf(note)}:`;
        const alter = pitch?.alter === -1 ? 'b' : pitch?.alter === 1 ? '#' : '';
        const name = isRest(note) ? 'r' : `${pitch!.step}${alter}${pitch!.octave}`;
        const tie = children(note, 'tie').some((tie) => tie.getAttribute('type') === 'start') ? '~' : '';
        const chord = child(note, 'chord') ? '+' : '';
        const tuplet = child(note, 'time-modification') ? '/3' : '';
        return `${voice}${chord}${name} ${text(child(note, 'type')) ?? 'measure'}${tuplet}${tie}`;
    });
}

function accidentals(score: ScoreDocument, index: number): (string | null)[] {
    return children(score.measure(index), 'note')
        .filter((note) => !isRest(note))
        .map((note) => text(child(note, 'accidental')));
}

describe('score passages', () => {
    it('selects a passage in the voice of the first note, with whole tuplets and all voices for whole measures', () => {
        const score = empty();
        const first = notes(score, cursor(0, 0), 'C D E F');
        const second = notes(score, cursor(1, 0), 'G A B C');

        const passage = passages.passageBetween(score, second[1], first[1]);
        expect(passage).toEqual({ voice: 1, from: { measureIndex: 0, offset: fraction(1) }, to: { measureIndex: 1, offset: fraction(2) }, wholeMeasures: false });
        expect(passages.passageLabel(score, passage)).toBe('Selezione · battute 1–2 · voce 1 · 5 elementi');
        expect(passages.passageNotes(score, passage).map((note) => note.getAttribute('id'))).toEqual([...first.slice(1), ...second.slice(0, 2)]);

        const whole = passages.passageBetween(score, first[0], second[3]);
        expect(whole.wholeMeasures).toBeTrue();
        expect(passages.passageLabel(score, whole)).toBe('Selezione · battute 1–2 · tutte le voci');

        const tuplet = writing.writeTuplet(score, cursor(2, 1), QUARTER, 3);
        const members = notes(score, tuplet.cursor, 'D E F', { type: 'eighth', dots: 0 });
        const inside = passages.passageBetween(score, members[1], members[1]);
        expect(inside.from).toEqual({ measureIndex: 2, offset: fraction(1) });
        expect(inside.to).toEqual({ measureIndex: 2, offset: fraction(2) });
    });

    it('extends the passage element by element and selects the whole part', () => {
        const score = empty(2);
        const ids = notes(score, cursor(0, 0), 'C D E F');

        let focus = passages.extendPassage(score, ids[1], null, 1);
        expect(focus).toBe(ids[2]);
        focus = passages.extendPassage(score, ids[1], focus, 1);
        expect(focus).toBe(ids[3]);
        expect(passages.extendPassage(score, ids[1], ids[0], -1)).toBe(ids[0]);

        const all = passages.wholePart(score);
        expect(all.anchorId).toBe(ids[0]);
        const passage = passages.passageBetween(score, all.anchorId!, all.focusId!);
        expect(passage.wholeMeasures).toBeTrue();
        expect(passage.to.measureIndex).toBe(1);
    });

    it('pastes a passage elsewhere and in another voice, splitting and tying it over the barline', () => {
        const score = empty();
        notes(score, cursor(0, 0), 'C D');
        writing.writeNote(score, cursor(0, 2), HALF, 'E');
        writing.writeNote(score, cursor(1, 0), { type: 'whole', dots: 0 }, 'F');
        const ids = children(score.measure(0), 'note').map((note) => note.getAttribute('id')!);
        const clip = passages.copyPassage(score, passages.passageBetween(score, ids[1], ids[2]));
        expect(clip.label).toBe('un passaggio di 2 note');
        expect(clip.length).toEqual(fraction(3));

        const result = passages.pastePassage(score, clip, cursor(1, 2));
        expect(layout(score, 1)).toEqual(['F5 half', 'D5 quarter', 'E5 quarter~']);
        expect(layout(score, 2)).toEqual(['E5 quarter', 'r quarter', 'r half']);
        expect(result.anchorId).toBe(children(score.measure(1), 'note')[1].getAttribute('id'));
        expect(result.focusId).toBe(children(score.measure(2), 'note')[0].getAttribute('id'));
        expect(result.cursor).toEqual({ measureIndex: 2, voice: 1, offset: fraction(1) });

        passages.pastePassage(score, clip, cursor(0, 0, 2));
        expect(layout(score, 0)).toEqual(['C5 quarter', 'D5 quarter', 'E5 half', '2:D5 quarter', '2:E5 half', '2:r quarter']);
    });

    it('keeps the sound of the pasted notes in another key and of the untouched notes after them', () => {
        const score = empty(3, 1);
        edits.setKey(score, 1, 0);
        const [fSharp] = notes(score, cursor(0, 0), 'F');
        expect(pitchOf(score.note(fSharp))!.alter).toBe(1);
        const clip = passages.copyPassage(score, passages.passageBetween(score, fSharp, fSharp));

        passages.pastePassage(score, clip, cursor(1, 0));
        expect(layout(score, 1)[0]).toBe('F#4 quarter');
        expect(accidentals(score, 1)[0]).toBe('sharp');

        const [first, second] = notes(score, cursor(2, 0), 'F F');
        edits.setAlteration(score, first, 'sharp');
        expect(pitchOf(score.note(second))!.alter).toBe(1);
        const [g] = notes(score, cursor(1, 2), 'G');
        passages.pastePassage(score, passages.copyPassage(score, passages.passageBetween(score, g, g)), cursor(2, 0));
        expect(layout(score, 2).slice(0, 2)).toEqual(['G4 quarter', 'F#4 quarter']);
        expect(accidentals(score, 2)[1]).toBe('sharp');
    });

    it('pastes whole measures with all their voices and empties the other voices of the destination', () => {
        const score = empty(3);
        const ids = notes(score, cursor(0, 0), 'C D E F');
        writing.writeNote(score, cursor(0, 0, 2), { type: 'whole', dots: 0 }, 'G');
        writing.writeNote(score, cursor(2, 0, 3), HALF, 'A');
        const source = layout(score, 0);
        const clip = passages.copyPassage(score, passages.passageBetween(score, ids[0], ids[3]));
        expect(clip.wholeMeasures).toBeTrue();
        expect(clip.label).toBe('1 battuta');

        passages.pastePassage(score, clip, cursor(1, 3));
        expect(layout(score, 1)).toEqual(source);
        passages.pastePassage(score, clip, cursor(2, 1, 3));
        expect(layout(score, 2)).toEqual(source);
    });

    it('repeats a passage after itself, adding measures at the end of the part', () => {
        const score = empty(1);
        const ids = notes(score, cursor(0, 0), 'C D r r');

        const repeated = passages.repeatPassage(score, passages.passageBetween(score, ids[0], ids[1]));
        expect(layout(score, 0)).toEqual(['C5 quarter', 'D5 quarter', 'C5 quarter', 'D5 quarter']);
        expect(repeated.anchorId).toBe(children(score.measure(0), 'note')[2].getAttribute('id'));

        const all = passages.wholePart(score);
        passages.repeatPassage(score, passages.passageBetween(score, all.anchorId!, all.focusId!));
        expect(score.measures().length).toBe(2);
        expect(layout(score, 1)).toEqual(layout(score, 0));
    });

    it('clears the passage into rests, measure rests for whole measures, with the dynamics of its notes', () => {
        const score = empty(2);
        const ids = notes(score, cursor(0, 0), 'C D E F');
        edits.setDynamic(score, ids[1], 'p');
        writing.writeNote(score, cursor(0, 0, 2), HALF, 'G');

        const selected = passages.clearPassage(score, passages.passageBetween(score, ids[1], ids[2]));
        expect(layout(score, 0).filter((item) => !item.startsWith('2:'))).toEqual(['C5 quarter', 'r quarter', 'r quarter', 'F5 quarter']);
        expect(children(score.measure(0), 'direction').length).toBe(0);
        expect(selected).toBe(children(score.measure(0), 'note')[1].getAttribute('id'));

        const first = child(score.measure(0), 'note')!.getAttribute('id')!;
        const last = children(score.measure(0), 'note')[3].getAttribute('id')!;
        passages.clearPassage(score, passages.passageBetween(score, first, last));
        expect(layout(score, 0)).toEqual(['r measure']);
    });

    it('transposes a passage by an interval, writing the accidentals the notes after it need', () => {
        const score = empty(2);
        const ids = notes(score, cursor(0, 0), 'C D E F');

        passages.transposePassage(
            score,
            passages.passageBetween(score, ids[1], ids[2]),
            passages.INTERVALS.find((interval) => interval.value === 'M2')!,
            1
        );
        expect(layout(score, 0)).toEqual(['C5 quarter', 'E5 quarter', 'F#5 quarter', 'F5 quarter']);
        expect(accidentals(score, 0)).toEqual([null, null, 'sharp', 'natural']);

        passages.transposePassage(
            score,
            passages.passageBetween(score, ids[0], ids[0]),
            passages.INTERVALS.find((interval) => interval.value === 'm2')!,
            -1
        );
        expect(layout(score, 0)[0]).toBe('B4 quarter');
        expect(() => passages.transposedPitch('B', 4, 2, passages.INTERVALS[0], 1)).toThrowError(EditError);
    });

    it('transposes the whole part with its key signatures and refuses keys beyond seven alterations', () => {
        const score = empty(2, -2);
        const [b] = notes(score, cursor(0, 0), 'B');
        expect(pitchOf(score.note(b))!.alter).toBe(-1);

        passages.transposePassage(
            score,
            null,
            passages.INTERVALS.find((interval) => interval.value === 'M2')!,
            1
        );
        expect(text(score.part.querySelector('key fifths'))).toBe('0');
        expect(layout(score, 0)[0]).toBe('C5 quarter');
        expect(accidentals(score, 0)[0]).toBeNull();

        const sharp = empty(1, 6);
        notes(sharp, cursor(0, 0), 'C');
        expect(() =>
            passages.transposePassage(
                sharp,
                null,
                passages.INTERVALS.find((interval) => interval.value === 'M2')!,
                1
            )
        ).toThrowError(EditError, /8 diesis/);
    });

    it('moves a passage by octaves keeping its alterations and by steps following the key', () => {
        const score = empty(2, 1);
        const ids = notes(score, cursor(0, 0), 'C D E');
        notes(score, cursor(1, 0), 'F');

        passages.shiftPassage(score, passages.passageBetween(score, ids[0], ids[2]), 1);
        expect(layout(score, 0).slice(0, 3)).toEqual(['D5 quarter', 'E5 quarter', 'F#5 quarter']);
        expect(accidentals(score, 0).slice(0, 3)).toEqual([null, null, null]);

        const f = child(score.measure(1), 'note')!.getAttribute('id')!;
        passages.transposePassage(score, passages.passageBetween(score, f, f), passages.OCTAVE, -1);
        expect(layout(score, 1)[0]).toBe('F#4 quarter');
    });

    it('pastes tuplets and refuses to paste over part of one', () => {
        const score = empty(3);
        const tuplet = writing.writeTuplet(score, cursor(0, 0), QUARTER, 3);
        const members = notes(score, tuplet.cursor, 'C D E', { type: 'eighth', dots: 0 });
        const clip = passages.copyPassage(score, passages.passageBetween(score, members[1], members[1]));
        expect(clip.length).toEqual(fraction(1));

        passages.pastePassage(score, clip, cursor(1, 1));
        expect(layout(score, 1)).toEqual(['r quarter', 'C5 eighth/3', 'D5 eighth/3', 'E5 eighth/3', 'r half']);

        const [g] = notes(score, cursor(2, 0), 'G');
        const quarter = passages.copyPassage(score, passages.passageBetween(score, g, g));
        expect(() => passages.pastePassage(score, quarter, { measureIndex: 0, voice: 1, offset: fraction(1, 2) })).toThrowError(EditError, /gruppo irregolare/);
    });

    it('copies dynamics and slurs with both ends in the passage and leaves out the open ones', () => {
        const score = empty(3);
        const ids = notes(score, cursor(0, 0), 'C D E F');
        edits.setDynamic(score, ids[0], 'f');
        const slur = (id: string, type: string) => {
            const note = score.note(id);
            const notations = child(note, 'notations') ?? note.appendChild(score.document.createElement('notations'));
            notations.appendChild(score.document.createElement('slur')).setAttribute('type', type);
        };
        slur(ids[0], 'start');
        slur(ids[2], 'stop');

        passages.pastePassage(score, passages.copyPassage(score, passages.passageBetween(score, ids[0], ids[1])), cursor(1, 0));
        expect(score.measure(1).querySelectorAll('slur').length).toBe(0);
        expect(score.measure(1).querySelector('dynamics f')).not.toBeNull();

        passages.pastePassage(score, passages.copyPassage(score, passages.passageBetween(score, ids[0], ids[2])), cursor(2, 0));
        expect(Array.from(score.measure(2).querySelectorAll('slur')).map((item) => item.getAttribute('type'))).toEqual(['start', 'stop']);
    });
});
