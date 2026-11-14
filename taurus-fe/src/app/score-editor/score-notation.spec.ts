import { child, children, text } from './musicxml-dom';
import { fraction } from './notation-rules';
import { EditError, isRest, pitchOf, ScoreDocument } from './score-document';
import * as edits from './score-edits';
import * as notation from './score-notation';
import * as passages from './score-passage';
import * as writing from './score-writing';

const PREFIX = 'tn-';
const QUARTER: writing.WritingFigure = { type: 'quarter', dots: 0 };
const MEASURE_REST = '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>';

/** Parte di battute di pausa in 4/4, una divisione per semiminima. */
function empty(count = 3): ScoreDocument {
    const attributes = '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
    const body = Array.from({ length: count }, (_, index) => `<measure number="${index + 1}">${index === 0 ? attributes : ''}${MEASURE_REST}</measure>`).join('');
    return edits.openScore(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tromba</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`, PREFIX);
}

/** Scrive semiminime dall'inizio della battuta: «C D r F». */
function notes(score: ScoreDocument, measureIndex: number, steps: string): string[] {
    const ids: string[] = [];
    let current: writing.WritingCursor = { measureIndex, voice: 1, offset: fraction(0) };
    for (const step of steps.split(' ')) {
        const result = step === 'r' ? writing.writeRest(score, current, QUARTER) : writing.writeNote(score, current, QUARTER, step as 'C');
        ids.push(result.noteId);
        current = result.cursor;
    }
    return ids;
}

function single(noteId: string): notation.NotationTarget {
    return { noteId, passage: null };
}

function range(score: ScoreDocument, anchorId: string, focusId: string): notation.NotationTarget {
    const passage = passages.passageBetween(score, anchorId, focusId);
    return { noteId: anchorId, passage: { notes: passages.passageNotes(score, passage), voice: String(passage.voice) } };
}

/** Legature di portamento della parte: «id:start:1». */
function slurs(score: ScoreDocument): string[] {
    return score.notes().flatMap((note) => children(child(note, 'notations'), 'slur').map((slur) => `${note.getAttribute('id')}:${slur.getAttribute('type')}:${slur.getAttribute('number')}`));
}

/** Forcelle della parte, con la nota che segue ogni direzione: «crescendo:1>id». */
function wedges(score: ScoreDocument): string[] {
    return score.measures().flatMap((measure) =>
        children(measure, 'direction').flatMap((direction) =>
            children(direction, 'direction-type').flatMap((type) =>
                children(type, 'wedge').map((wedge) => {
                    let next = direction.nextElementSibling;
                    while (next && next.tagName !== 'note') next = next.nextElementSibling;
                    return `${wedge.getAttribute('type')}:${wedge.getAttribute('number')}>${next?.getAttribute('id')}`;
                })
            )
        )
    );
}

function failure(action: () => unknown): string {
    try {
        action();
    } catch (error) {
        if (error instanceof EditError) return error.message;
        throw error;
    }
    return '';
}

describe('score notation', () => {
    it('slurs a note to the next one, a passage from its first to its last note, and removes them', () => {
        const score = empty();
        const ids = notes(score, 0, 'C D r F');
        const next = notes(score, 1, 'G A B C');

        notation.toggleSlur(score, single(ids[0]));
        expect(slurs(score)).toEqual([`${ids[0]}:start:1`, `${ids[1]}:stop:1`]);
        expect(edits.noteInfo(score, ids[1]).slur).toBeTrue();
        // Sulla nota legata la legatura si toglie.
        notation.toggleSlur(score, single(ids[1]));
        expect(slurs(score)).toEqual([]);

        expect(failure(() => notation.toggleSlur(score, single(ids[1])))).toContain('non c’è una nota da legare');
        expect(failure(() => notation.toggleSlur(score, single(ids[2])))).toBe('La legatura di portamento parte da una nota');

        // Il passaggio comincia e finisce sulle note, non sulle pause; una legatura dentro un'altra prende un altro numero.
        notation.toggleSlur(score, range(score, ids[1], next[3]));
        notation.toggleSlur(score, range(score, next[0], next[2]));
        expect(slurs(score)).toEqual([`${ids[1]}:start:1`, `${next[0]}:start:2`, `${next[2]}:stop:2`, `${next[3]}:stop:1`]);
        notation.toggleSlur(score, range(score, ids[1], next[3]));
        expect(slurs(score)).toEqual([`${next[0]}:start:2`, `${next[2]}:stop:2`]);
    });

    it('draws hairpins over a passage or to the next element, switches their direction and removes them', () => {
        const score = empty(2);
        const ids = notes(score, 0, 'C D E F');
        const next = notes(score, 1, 'r A B C');

        notation.toggleWedge(score, range(score, ids[0], ids[2]), 'crescendo');
        expect(wedges(score)).toEqual([`crescendo:1>${ids[0]}`, `stop:1>${ids[2]}`]);
        expect(edits.noteInfo(score, ids[0]).wedge).toBe('crescendo');
        notation.toggleWedge(score, range(score, ids[0], ids[2]), 'diminuendo');
        expect(wedges(score)).toEqual([`diminuendo:1>${ids[0]}`, `stop:1>${ids[2]}`]);

        // Da una sola nota all'elemento seguente, anche una pausa oltre la stanghetta.
        notation.toggleWedge(score, single(ids[3]), 'crescendo');
        expect(wedges(score)).toContain(`crescendo:1>${ids[3]}`);
        expect(wedges(score)).toContain(`stop:1>${next[0]}`);
        notation.toggleWedge(score, single(ids[3]), 'crescendo');
        expect(wedges(score)).toEqual([`diminuendo:1>${ids[0]}`, `stop:1>${ids[2]}`]);

        notation.removeSpanners(score, range(score, ids[1], ids[2]));
        expect(wedges(score)).toEqual([]);
        expect(score.measure(0).querySelector('direction')).toBeNull();
        expect(failure(() => notation.removeSpanners(score, single(ids[1])))).toBe('Nella selezione non ci sono legature di portamento né forcelle');
        expect(failure(() => notation.toggleWedge(score, single(next[3]), 'crescendo'))).toContain('Dopo la nota non c’è un elemento');
    });

    it('keeps slurs and hairpins whole: the end left alone is removed', () => {
        const score = empty();
        const ids = notes(score, 0, 'C D E F');
        notation.toggleSlur(score, range(score, ids[0], ids[2]));
        notation.toggleWedge(score, range(score, ids[0], ids[3]), 'crescendo');

        // La nota dove finisce la legatura diventa una pausa, e la legatura perde la fine.
        writing.clearWrittenNote(score, ids[2]);
        // Il primo elemento della forcella si riscrive: la forcella resta, e la nota cambiata resta il suo inizio.
        writing.setWrittenDuration(score, ids[3], { type: 'eighth', dots: 0 });
        notation.balanceSpanners(score);
        expect(slurs(score)).toEqual([]);
        expect(wedges(score).length).toBe(2);

        const stop = score.measure(0).querySelectorAll('direction')[1];
        stop.remove();
        notation.balanceSpanners(score);
        expect(wedges(score)).toEqual([]);
    });

    it('keeps the slur of a note written again with another duration or pasted elsewhere', () => {
        const score = empty();
        const ids = notes(score, 0, 'C D E F');
        notation.toggleSlur(score, range(score, ids[0], ids[2]));

        // La nota allungata copre il Re e conserva l'inizio della legatura, che finisce sul Mi.
        const first = writing.setWrittenDuration(score, ids[0], { type: 'half', dots: 0 });
        expect(slurs(score).map((slur) => slur.split(':').slice(1).join(':'))).toEqual(['start:1', 'stop:1']);
        expect(slurs(score)[0]).toContain(first);

        const clip = passages.copyPassage(score, passages.passageBetween(score, first, ids[3]));
        passages.pastePassage(score, clip, { measureIndex: 1, voice: 1, offset: fraction(0) });
        expect(
            children(score.measure(1), 'note')
                .flatMap((note) => children(child(note, 'notations'), 'slur'))
                .map((slur) => slur.getAttribute('type'))
        ).toEqual(['start', 'stop']);
    });

    it('puts a fermata on notes, chords and rests', () => {
        const score = empty();
        const ids = notes(score, 0, 'C r E F');
        notation.toggleFermata(score, ids[0]);
        notation.toggleFermata(score, ids[1]);
        expect(edits.noteInfo(score, ids[0]).fermata).toBeTrue();
        expect(edits.noteInfo(score, ids[1]).fermata).toBeTrue();
        expect(child(child(score.note(ids[1]), 'notations'), 'fermata')?.getAttribute('type')).toBe('upright');
        notation.toggleFermata(score, ids[0]);
        expect(edits.noteInfo(score, ids[0]).fermata).toBeFalse();
        expect(child(score.note(ids[0]), 'notations')).toBeNull();
    });

    it('adds grace notes with the pitch of the note, changes their kind and figure, and removes them', () => {
        const score = empty();
        const ids = notes(score, 0, 'C F r G');
        edits.setAlteration(score, ids[1], 'sharp');

        const grace = notation.setGraceNote(score, ids[1], 'acciaccatura');
        const created = score.note(grace);
        expect(created.nextElementSibling).toBe(score.note(ids[1]));
        expect(child(created, 'grace')?.getAttribute('slash')).toBe('yes');
        expect(pitchOf(created)).toEqual({ step: 'F', octave: 5, alter: 1, unpitched: false });
        expect(text(child(created, 'accidental'))).toBe('sharp');
        expect(text(child(created, 'type'))).toBe('eighth');
        expect(child(created, 'duration')).toBeNull();
        expect(edits.noteLabel(edits.noteInfo(score, grace))).toBe('Fa♯5 · acciaccatura di croma');

        notation.setGraceNote(score, grace, 'appoggiatura');
        expect(edits.noteInfo(score, grace).graceKind).toBe('appoggiatura');
        writing.setWrittenDuration(score, grace, { type: '16th', dots: 0 });
        expect(text(child(created, 'type'))).toBe('16th');
        expect(score.checks().wrongDuration).toEqual([]);

        expect(failure(() => notation.setGraceNote(score, ids[2], 'acciaccatura'))).toBe('Gli abbellimenti si mettono prima di una nota');
        expect(failure(() => edits.toggleRest(score, grace))).toContain('Gli abbellimenti non diventano pause');
        expect(failure(() => writing.toggleWrittenTuplet(score, grace, 3))).toBe('Gli abbellimenti non entrano nei gruppi irregolari');

        // Una legatura da un abbellimento va alla nota principale.
        notation.toggleSlur(score, single(grace));
        expect(slurs(score)).toEqual([`${grace}:start:1`, `${ids[1]}:stop:1`]);

        expect(writing.clearWrittenNote(score, grace)).toBe(ids[1]);
        expect(score.find(grace)).toBeNull();
        expect(children(score.measure(0), 'note').some((note) => !!child(note, 'grace'))).toBeFalse();
    });

    it('writes expression text before the note, above or below the staff, and copies it with the note', () => {
        const score = empty();
        const ids = notes(score, 0, 'C D E F');
        const grace = notation.setGraceNote(score, ids[1], 'acciaccatura');

        notation.setExpression(score, ids[1], '  dolce ');
        notation.setExpression(score, ids[2], 'rit.');
        const directions = children(score.measure(0), 'direction');
        expect(directions.map((direction) => direction.getAttribute('placement'))).toEqual(['below', 'above']);
        expect(directions[0].nextElementSibling).toBe(score.note(grace));
        expect(children(child(directions[0], 'direction-type'), 'words')[0].getAttribute('font-style')).toBe('italic');
        expect(edits.noteInfo(score, ids[1]).expression).toBe('dolce');
        expect(edits.noteInfo(score, grace).expression).toBe('dolce');

        notation.setExpression(score, grace, 'espress.');
        expect(edits.noteInfo(score, ids[1]).expression).toBe('espress.');
        expect(writing.noteDirections(score.note(ids[1])).length).toBe(1);

        const clip = passages.copyPassage(score, passages.passageBetween(score, ids[0], ids[3]));
        passages.pastePassage(score, clip, { measureIndex: 1, voice: 1, offset: fraction(0) });
        expect(Array.from(score.measure(1).querySelectorAll('words')).map((words) => words.textContent)).toEqual(['espress.', 'rit.']);

        notation.setExpression(score, ids[1], null);
        expect(edits.noteInfo(score, ids[1]).expression).toBeNull();
        expect(failure(() => notation.setExpression(score, ids[2], 'x'.repeat(61)))).toBe('Il testo può avere al massimo 60 caratteri');

        // «D.C.» ha un suono: è un segno di struttura e non appartiene alla nota.
        edits.toggleMark(score, 2, 'daCapo');
        const last = notes(score, 2, 'C');
        expect(writing.noteDirections(score.note(last[0]))).toEqual([]);
    });

    it('writes rehearsal marks, proposing the next letter or the measure number', () => {
        const score = empty(4);
        expect(notation.nextRehearsal(score, 1)).toBe('A');
        notation.setRehearsal(score, 1, 'A');
        expect(edits.measureInfo(score, 1).rehearsal).toBe('A');
        expect(notation.nextRehearsal(score, 3)).toBe('B');
        notation.setRehearsal(score, 2, 'z');
        expect(notation.nextRehearsal(score, 3)).toBe('AA');
        notation.setRehearsal(score, 2, 'AA');
        expect(notation.nextRehearsal(score, 3)).toBe('BB');

        const measure = score.measure(1);
        expect(child(measure, 'direction')?.getAttribute('placement')).toBe('above');
        expect(child(measure, 'direction')?.nextElementSibling?.tagName).toBe('note');
        notation.setRehearsal(score, 1, null);
        expect(edits.measureInfo(score, 1).rehearsal).toBeNull();
        expect(child(measure, 'direction')).toBeNull();
        expect(failure(() => notation.setRehearsal(score, 1, '1234567890123'))).toBe('La lettera di prova può avere al massimo 12 caratteri');
    });

    it('writes the tempo with its text and removes both', () => {
        const score = empty();
        edits.setTempo(score, 1, 120, 'Allegro');
        const info = edits.measureInfo(score, 1);
        expect(info.tempo).toBe(120);
        expect(info.tempoText).toBe('Allegro');
        const direction = child(score.measure(1), 'direction')!;
        expect(children(direction, 'direction-type').map((type) => type.firstElementChild!.tagName)).toEqual(['words', 'metronome']);
        expect(child(direction, 'sound')?.getAttribute('tempo')).toBe('120');

        edits.setTempo(score, 1, 96);
        expect(edits.measureInfo(score, 1).tempoText).toBeNull();
        expect(edits.measureInfo(score, 1).tempo).toBe(96);
        edits.setTempo(score, 1, null);
        expect(child(score.measure(1), 'direction')).toBeNull();
        expect(failure(() => edits.setTempo(score, 1, null, 'Andante'))).toContain('Indica anche le semiminime al minuto');
    });

    it('starts new lines and pages, also every few measures', () => {
        const score = empty(7);
        notation.setBreak(score, 3, 'page');
        notation.setBreak(score, 1, 'system');
        expect(edits.measureInfo(score, 3).break).toBe('page');
        expect(score.measure(1).firstElementChild?.tagName).toBe('print');
        expect(failure(() => notation.setBreak(score, 0, 'system'))).toBe('La prima battuta apre già la prima riga e la prima pagina');

        notation.setBreaksEvery(score, 2);
        expect(score.measures().map((measure) => notation.breakOf(measure))).toEqual([null, null, 'system', 'page', null, 'system', null]);
        notation.setBreak(score, 2, null);
        expect(child(score.measure(2), 'print')).toBeNull();

        notation.setBreaksEvery(score, null);
        expect(score.measures().map((measure) => notation.breakOf(measure))).toEqual([null, null, null, 'page', null, null, null]);
        expect(failure(() => notation.setBreaksEvery(score, 0))).toBe('Le battute per riga vanno da 1 a 32');
    });

    it('adds the breath mark as an articulation', () => {
        const score = empty();
        const ids = notes(score, 0, 'C D E F');
        edits.toggleArticulation(score, ids[1], 'breath-mark');
        expect(edits.noteInfo(score, ids[1]).articulations).toEqual(['breath-mark']);
        expect(isRest(score.note(ids[1]))).toBeFalse();
    });
});
