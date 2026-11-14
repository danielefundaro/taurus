import { child, children, text } from './musicxml-dom';
import { fraction } from './notation-rules';
import { EditError, isRest, pitchOf, ScoreDocument, voiceOf } from './score-document';
import * as edits from './score-edits';
import * as input from './score-input';
import * as writing from './score-writing';

const PREFIX = 'ti-';
const QUARTER: writing.WritingFigure = { type: 'quarter', dots: 0 };
const HALF: writing.WritingFigure = { type: 'half', dots: 0 };
const MEASURE_REST = '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>';
const TREBLE = '<clef><sign>G</sign><line>2</line></clef>';
const PERCUSSION = '<clef><sign>percussion</sign></clef>';

function attributes(fifths = 0, clef = TREBLE): string {
    return `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${clef}</attributes>`;
}

function part(measures: string[]): ScoreDocument {
    const body = measures.map((content, index) => `<measure number="${index + 1}">${content}</measure>`).join('');
    return edits.openScore(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flauto</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`, PREFIX);
}

function empty(count = 1, head = attributes()): ScoreDocument {
    return part(Array.from({ length: count }, (_, index) => (index === 0 ? head : '') + MEASURE_REST));
}

/** Contenuto di una battuta: «C#4 quarter #» con l'accidente scritto, «r half» per le pause, «2:» per la voce 2. */
function layout(score: ScoreDocument, index: number): string[] {
    return children(score.measure(index), 'note').map((note) => {
        const pitch = pitchOf(note);
        const voice = voiceOf(note) === '1' ? '' : `${voiceOf(note)}:`;
        const name = isRest(note) ? 'r' : `${pitch!.step}${pitch!.alter === -1 ? 'b' : pitch!.alter === 1 ? '#' : ''}${pitch!.octave}`;
        const chord = child(note, 'chord') ? '+' : '';
        const tie = children(note, 'tie').some((tie) => tie.getAttribute('type') === 'start') ? '~' : '';
        const accidental = text(child(note, 'accidental'));
        const head = text(child(note, 'notehead'));
        return `${voice}${chord}${name} ${text(child(note, 'type')) ?? 'measure'}${tie}${accidental ? ` ${accidental}` : ''}${head ? ` [${head}]` : ''}`;
    });
}

function cursor(measureIndex: number, quarters: number, voice = 1): writing.WritingCursor {
    return { measureIndex, voice, offset: fraction(quarters) };
}

describe('score input', () => {
    it('spells black keys from the key signature and names the keys for the status bar', () => {
        const spelled = (key: number, fifths: number) => {
            const pitch = input.spellKey(key, fifths);
            return `${pitch.step}${pitch.alter === 1 ? '#' : pitch.alter === -1 ? 'b' : ''}${pitch.octave}`;
        };

        expect([60, 61, 63, 66, 68, 70, 71].map((key) => spelled(key, 0))).toEqual(['C4', 'C#4', 'Eb4', 'F#4', 'G#4', 'Bb4', 'B4']);
        expect([61, 63, 70].map((key) => spelled(key, 2))).toEqual(['C#4', 'D#4', 'A#4']);
        expect([61, 66, 68].map((key) => spelled(key, -1))).toEqual(['Db4', 'Gb4', 'Ab4']);
        expect(spelled(21, 0)).toBe('A0');
        expect(spelled(108, 0)).toBe('C8');
        expect(() => input.spellKey(128, 0)).toThrowError(EditError);
        expect(() => input.spellKey(60.5, 0)).toThrowError(EditError);

        expect(input.keyLabel(36)).toBe('Do2');
        expect(input.keyLabel(49)).toBe('Do♯3');
        expect(input.keyLabel(70)).toBe('Si♭4');
        expect(input.keyOf({ step: 'E', octave: 4, alter: -1 })).toBe(63);
        expect(input.keyOf({ step: 'B', octave: 3, alter: 1 })).toBe(60);
    });

    it('writes the played note at the cursor with the accidentals it needs, keeping the sound of the other notes', () => {
        const score = empty(2);

        // Una nota già scritta più avanti nella battuta conserva il suo Do naturale.
        input.writeKey(score, cursor(0, 2), QUARTER, 60);
        const first = input.writeKey(score, cursor(0, 0), QUARTER, 61);
        expect(layout(score, 0)).toEqual(['C#4 quarter sharp', 'r quarter', 'C4 quarter natural', 'r quarter']);
        expect(first.noteId).toBe(score.notes()[0].getAttribute('id')!);
        expect(first.cursor).toEqual(cursor(0, 1));

        // Una nota più lunga dello spazio rimasto si divide e la parte legata suona come lei.
        const long = input.writeKey(score, cursor(0, 3), HALF, 70);
        expect(layout(score, 0)).toEqual(['C#4 quarter sharp', 'r quarter', 'C4 quarter natural', 'Bb4 quarter~ flat']);
        expect(layout(score, 1)[0]).toBe('Bb4 quarter');
        expect(long.cursor).toEqual(cursor(1, 1));
        expect(score.checks().wrongDuration).toEqual([]);
        expect(() => input.writeKey(score, cursor(1, 1), QUARTER, 5)).toThrowError(EditError);
    });

    it('follows the key signature of the measure where the cursor writes', () => {
        const score = part([attributes(2) + MEASURE_REST, '<attributes><key><fifths>-2</fifths></key></attributes>' + MEASURE_REST]);

        input.writeKey(score, cursor(0, 0), QUARTER, 66);
        input.writeKey(score, cursor(0, 1), QUARTER, 63);
        // Alla fine della battuta il cursore scrive nella seguente, con la sua armatura.
        input.writeKey(score, cursor(0, 4), QUARTER, 70);

        expect(layout(score, 0)).toEqual(['F#4 quarter', 'D#4 quarter sharp', 'r half']);
        expect(layout(score, 1)).toEqual(['Bb4 quarter', 'r quarter', 'r half']);
    });

    it('adds played notes to the chord once, with their spelling, also on the tied notes', () => {
        const score = empty(2);
        const first = input.writeKey(score, cursor(0, 3), HALF, 60);

        const third = input.addChordKey(score, first.noteId, 64);
        input.addChordKey(score, first.noteId, 70);
        expect(input.addChordKey(score, first.noteId, 64)).toBe(third);
        expect(layout(score, 0).slice(2)).toEqual(['C4 quarter~', '+E4 quarter~', '+Bb4 quarter~ flat']);
        expect(layout(score, 1).slice(0, 3)).toEqual(['C4 quarter', '+E4 quarter', '+Bb4 quarter']);

        const rest = score
            .notes()
            .find((note) => isRest(note))!
            .getAttribute('id')!;
        expect(() => input.addChordKey(score, rest, 62)).toThrowError(EditError);
    });

    it('replaces the pitch of the selected note, also on its tied notes, and turns a rest into the played note', () => {
        const score = empty(2);
        const tied = input.writeKey(score, cursor(0, 3), HALF, 60);

        input.setNoteKey(score, tied.noteId, 63);
        expect(layout(score, 0)[2]).toBe('Eb4 quarter~ flat');
        expect(layout(score, 1)[0]).toBe('Eb4 quarter');

        const rest = score.notes()[0].getAttribute('id')!;
        expect(input.setNoteKey(score, rest, 72)).toBe(rest);
        expect(layout(score, 0)[0]).toBe('C5 half');
    });

    it('respells a note without changing its sound', () => {
        const score = empty();
        const flat = input.writeKey(score, cursor(0, 0), QUARTER, 61);
        expect(layout(score, 0)[0]).toBe('C#4 quarter sharp');

        input.respellNote(score, flat.noteId, 'flat');
        expect(layout(score, 0)[0]).toBe('Db4 quarter flat');
        input.respellNote(score, flat.noteId, 'sharp');
        expect(layout(score, 0)[0]).toBe('C#4 quarter sharp');
        expect(() => input.respellNote(score, flat.noteId, 'natural')).toThrowError(EditError);

        const natural = input.writeKey(score, cursor(0, 1), QUARTER, 64);
        input.respellNote(score, natural.noteId, 'flat');
        expect(layout(score, 0)[1]).toBe('Fb4 quarter flat');
        expect(input.keyOf(pitchOf(score.note(natural.noteId))!)).toBe(64);
        expect(() => input.respellNote(score, natural.noteId, 'sharp')).toThrowError(EditError);
        input.respellNote(score, natural.noteId, 'natural');
        expect(layout(score, 0)[1]).toBe('E4 quarter');

        const rest = score
            .notes()
            .find((note) => isRest(note))!
            .getAttribute('id')!;
        expect(() => input.respellNote(score, rest, 'sharp')).toThrowError(EditError);
    });

    it('places every drum sound in its position, with its notehead, and maps the instruments to the voices', () => {
        expect(input.drumSound(36)).toEqual({ key: 36, name: 'gran cassa', step: 'F', octave: 4, head: 'normal' });
        expect(input.drumSound(38)).toEqual({ key: 38, name: 'tamburo', step: 'C', octave: 5, head: 'normal' });
        expect(input.drumSound(49)).toEqual({ key: 49, name: 'piatti', step: 'A', octave: 5, head: 'x' });
        expect(input.drumSound(54).head).toBe('diamond');
        expect(input.drumSound(81)).toEqual({ key: 81, name: 'triangolo', step: 'E', octave: 5, head: 'x' });
        expect(input.drumSound(70)).toEqual({ key: 70, name: 'maracas', step: 'B', octave: 4, head: 'normal' });
        expect(input.drumSound(100)).toEqual({ key: 100, name: 'suono 100', step: 'B', octave: 4, head: 'normal' });

        const keys = [36, 38, 49];
        expect([1, 2, 3, 4].map((voice) => input.voiceDrum(keys, voice))).toEqual([36, 38, 49, 49]);
        expect(input.voiceDrum([], 1)).toBeNull();
        expect(input.drumVoice(keys, 38, 1)).toBe(2);
        expect(input.drumVoice(keys, 40, 1)).toBeNull();
        expect(input.drumVoice([36], 50, 3)).toBe(3);
        expect(input.drumVoice([], 50, 2)).toBe(2);
        expect(input.drumKeysLabel(keys)).toBe('Do2 gran cassa, Re2 tamburo, Do♯3 piatti');
    });

    it('writes drum sounds in the voice of the cursor, keeping the measure complete', () => {
        const score = empty(1, attributes(0, PERCUSSION));

        let result = input.writeDrum(score, cursor(0, 0), QUARTER, 36);
        result = input.writeDrum(score, result.cursor, QUARTER, 36);
        input.writeDrum(score, cursor(0, 0, 2), HALF, 49);
        input.writeDrum(score, cursor(0, 2, 2), HALF, 38);

        expect(layout(score, 0)).toEqual(['F4 quarter', 'F4 quarter', 'r half', '2:A5 half [x]', '2:C5 half']);
        expect(score.notes().every((note) => isRest(note) || pitchOf(note)!.unpitched)).toBeTrue();
        expect(score.checks().wrongDuration).toEqual([]);
        expect(result.cursor).toEqual(cursor(0, 2));
    });
});
