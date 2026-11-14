import { makeAccidentalsExplicit, respell, setAccidental, setAlter } from './accidentals';
import {
    ATTRIBUTES_ORDER,
    BARLINE_ORDER,
    child,
    children,
    CLEF_ORDER,
    DIRECTION_ORDER,
    element,
    ensureChild,
    insertAtStart,
    insertOrdered,
    integer,
    NOTE_ORDER,
    PITCH_ORDER,
    removeChildren,
    removeIfEmpty,
    setChildText,
    text,
    TIME_MODIFICATION_ORDER
} from './musicxml-dom';
import { Alteration, ALTERATIONS, CLEF_OPTIONS, clefBottom, clefValue, diatonic, fraction, fromDiatonic, inferType, middleLine, NOTE_TYPES, noteQuarters, noteTypeOption, NoteType, Step, STEP_NAMES, toNumber } from './notation-rules';
import { EditError, isRest, MusicalState, NoteEvent, pitchOf, ScoreDocument, voiceOf } from './score-document';
import { BreakKind, breakOf, expressionOf, GraceKind, graceKindOf, hasFermata, hasSlur, rehearsalOf, WedgeKind, wedgeOf } from './score-notation';

/**
 * Operazioni dell'editor di correzione sul MusicXML di una parte. Ogni operazione modifica il documento o, se non è
 * possibile, lancia un `EditError` con il motivo; l'editor ripristina allora lo stato precedente.
 */

export type Dynamic = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'sfz' | 'fp';
export const DYNAMICS: readonly Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp'];

export type Articulation = 'accent' | 'strong-accent' | 'staccato' | 'tenuto' | 'breath-mark';
export const ARTICULATIONS: readonly { value: Articulation; label: string }[] = [
    { value: 'accent', label: 'Accento' },
    { value: 'strong-accent', label: 'Marcato' },
    { value: 'staccato', label: 'Staccato' },
    { value: 'tenuto', label: 'Tenuto' },
    { value: 'breath-mark', label: 'Respiro' }
];

/** Indicazioni di tempo proposte accanto al metronomo; se ne può scrivere qualsiasi altra. */
export const TEMPO_TEXTS: readonly string[] = ['Largo', 'Lento', 'Adagio', 'Andante', 'Andantino', 'Moderato', 'Allegretto', 'Allegro', 'Vivace', 'Presto', 'Maestoso', 'Tempo di marcia'];

export type StructureMark = 'segno' | 'coda' | 'toCoda' | 'daCapo' | 'dalSegno' | 'fine';
export const STRUCTURE_MARKS: readonly { value: StructureMark; label: string }[] = [
    { value: 'segno', label: 'Segno' },
    { value: 'toCoda', label: 'Al Coda' },
    { value: 'coda', label: 'Coda' },
    { value: 'daCapo', label: 'D.C.' },
    { value: 'dalSegno', label: 'D.S.' },
    { value: 'fine', label: 'Fine' }
];

export const TUPLETS: readonly { actual: number; normal: number; label: string }[] = [
    { actual: 3, normal: 2, label: 'Terzina' },
    { actual: 5, normal: 4, label: 'Quintina' },
    { actual: 6, normal: 4, label: 'Sestina' }
];

export interface NoteInfo {
    id: string;
    measureIndex: number;
    measureNumber: string;
    rest: boolean;
    unpitched: boolean;
    grace: boolean;
    chordSize: number;
    step: Step | null;
    octave: number | null;
    alter: number;
    alteration: Alteration;
    type: NoteType | null;
    dots: number;
    /** Note del gruppo irregolare a cui appartiene la nota, `null` se non ne fa parte. */
    tuplet: number | null;
    tieStart: boolean;
    tieStop: boolean;
    dynamic: Dynamic | null;
    articulations: Articulation[];
    voice: string;
    /** La nota inizia o finisce una legatura di portamento. */
    slur: boolean;
    /** Forcella che inizia dalla nota. */
    wedge: WedgeKind | null;
    fermata: boolean;
    /** Testo di espressione scritto prima della nota. */
    expression: string | null;
    /** Tipo dell'abbellimento, se la nota è un abbellimento. */
    graceKind: GraceKind | null;
}

export interface MeasureInfo {
    index: number;
    number: string;
    beats: number;
    beatType: number;
    timeChange: boolean;
    fifths: number;
    keyChange: boolean;
    clef: string | null;
    clefChange: boolean;
    forwardRepeat: boolean;
    backwardRepeat: boolean;
    ending: string | null;
    marks: StructureMark[];
    tempo: number | null;
    /** Testo dell'indicazione di tempo, per esempio «Allegro». */
    tempoText: string | null;
    /** Lettera di prova o numero di riferimento all'inizio della battuta. */
    rehearsal: string | null;
    /** La battuta inizia una nuova riga o una nuova pagina. */
    break: BreakKind | null;
    /** Battute raggruppate dalla pausa che inizia qui; 1 se la battuta non apre una pausa di più battute. */
    multiRest: number;
    /** La battuta non contiene né note né pause, come capita in alcune versioni riconosciute o salvate in passato. */
    empty: boolean;
    /** La battuta contiene almeno una nota, non solo pause. */
    hasNotes: boolean;
}

const MAX_TEMPO_TEXT = 40;
const STATE_ATTRIBUTES = ['divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'transpose'];
const MAX_MULTI_REST = 200;

/** Apre il MusicXML di una versione per la correzione. */
export function openScore(xml: string, prefix?: string): ScoreDocument {
    const score = ScoreDocument.open(xml, prefix);
    makeAccidentalsExplicit(score);
    return score;
}

// Informazioni sulla selezione

export function noteInfo(score: ScoreDocument, id: string): NoteInfo {
    const note = score.note(id);
    const measure = score.measureOf(note);
    const pitch = pitchOf(note);
    const accidental = text(child(note, 'accidental'));
    const figure = figureOf(score, note);
    const tuplet = child(note, 'time-modification');
    return {
        id,
        measureIndex: score.measureIndex(measure),
        measureNumber: measure.getAttribute('number') ?? '',
        rest: isRest(note),
        unpitched: !!pitch?.unpitched,
        grace: !!child(note, 'grace'),
        chordSize: score.eventOf(note).notes.length,
        step: pitch?.step ?? null,
        octave: pitch?.octave ?? null,
        alter: pitch?.alter ?? 0,
        alteration: ALTERATIONS.find((option) => option.value === accidental)?.value ?? 'none',
        type: figure?.type ?? null,
        dots: figure?.dots ?? 0,
        tuplet: tuplet ? integer(child(tuplet, 'actual-notes')) : null,
        tieStart: hasTie(note, 'start'),
        tieStop: hasTie(note, 'stop'),
        dynamic: dynamicOf(score.eventOf(note).notes[0]),
        articulations: children(child(child(note, 'notations'), 'articulations')).map((item) => item.tagName as Articulation),
        voice: voiceOf(note),
        slur: hasSlur(score, note),
        wedge: wedgeOf(score, note),
        fermata: hasFermata(score, note),
        expression: expressionOf(score, note),
        graceKind: graceKindOf(note)
    };
}

export function measureInfo(score: ScoreDocument, index: number): MeasureInfo {
    const measure = score.measure(index);
    const state = score.stateAt(index);
    const attributes = leadingAttributes(measure);
    return {
        index,
        number: measure.getAttribute('number') ?? String(index + 1),
        beats: state.beats,
        beatType: state.beatType,
        timeChange: !!child(attributes, 'time'),
        fifths: state.fifths,
        keyChange: !!child(attributes, 'key'),
        clef: clefValue(state.clef),
        clefChange: !!child(attributes, 'clef'),
        forwardRepeat: !!repeatBarline(measure, 'forward'),
        backwardRepeat: !!repeatBarline(measure, 'backward'),
        ending: endingNumbers(score)[index],
        marks: STRUCTURE_MARKS.map((mark) => mark.value).filter((mark) => markElements(measure, mark).length > 0),
        tempo: tempoOf(measure),
        tempoText: tempoTextOf(measure),
        rehearsal: rehearsalOf(measure),
        break: breakOf(measure),
        multiRest: multiRestCount(measure),
        empty: !child(measure, 'note'),
        hasNotes: children(measure, 'note').some((note) => !isRest(note))
    };
}

/** Nome leggibile della nota selezionata, per la barra di stato. */
export function noteLabel(info: NoteInfo): string {
    const figure = NOTE_TYPES.find((option) => option.type === info.type)?.label.toLowerCase() ?? 'durata non indicata';
    const dots = info.dots === 1 ? ' puntata' : info.dots === 2 ? ' doppiamente puntata' : '';
    const tuplet = info.tuplet ? ` in gruppo di ${info.tuplet}` : '';
    if (info.rest) return `Pausa di ${figure}${dots}${tuplet}`;
    const symbol = ({ [-2]: '♭♭', [-1]: '♭', 1: '♯', 2: '♯♯' } as Record<number, string>)[info.alter] ?? '';
    const name = info.step ? `${STEP_NAMES[info.step]}${symbol}${info.octave}` : 'Nota';
    if (info.graceKind) return `${name} · ${info.graceKind} di ${figure}${dots}`;
    return `${name} · ${figure}${dots}${tuplet}${info.chordSize > 1 ? ` · accordo di ${info.chordSize} note` : ''}`;
}

/** Nota precedente o successiva nell'ordine della parte. */
export function adjacentNote(score: ScoreDocument, id: string, delta: number): string | null {
    const notes = score.notes();
    const index = notes.findIndex((note) => note.getAttribute('id') === id);
    return notes[index + delta]?.getAttribute('id') ?? null;
}

/** Prima nota della battuta, per selezionare una battuta dallo spartito. */
export function firstNoteOf(score: ScoreDocument, measureIndex: number): string | null {
    return child(score.measure(measureIndex), 'note')?.getAttribute('id') ?? null;
}

// Altezza

/** Sposta la nota, e quelle legate a lei, di gradi della scala (7 per un'ottava). */
export function moveStep(score: ScoreDocument, id: string, steps: number): void {
    const note = score.note(id);
    const pitch = pitchOf(note);
    if (!pitch) throw new EditError('Le pause non hanno altezza: trasformale prima in nota');
    const chain = tieChain(score, note);
    for (const linked of chain) {
        const current = pitchOf(linked);
        if (!current) continue;
        const target = fromDiatonic(diatonic(current.step, current.octave) + steps);
        if (target.octave < 0 || target.octave > 9) throw new EditError('Altezza fuori estensione');
        writePitch(linked, target.step, target.octave);
        if (linked === note) setAccidental(linked, null);
    }
    respellNotes(score, chain);
    followTies(score, note);
}

/** Cambia il nome della nota scegliendo l'ottava più vicina; una pausa diventa una nota. */
export function setPitchLetter(score: ScoreDocument, id: string, step: Step): void {
    let note = score.note(id);
    if (isRest(note)) {
        toggleRest(score, id);
        note = score.note(id);
    }
    const pitch = pitchOf(note);
    if (!pitch) throw new EditError('Nota senza altezza');
    const current = diatonic(pitch.step, pitch.octave);
    const candidates = [pitch.octave - 1, pitch.octave, pitch.octave + 1].map((octave) => diatonic(step, octave));
    const target = candidates.reduce((best, value) => (Math.abs(value - current) < Math.abs(best - current) ? value : best));
    moveStep(score, id, target - current);
}

/** Scrive l'accidente della nota; le alterazioni della battuta si ricalcolano. */
export function setAlteration(score: ScoreDocument, id: string, alteration: Alteration): void {
    const note = score.note(id);
    const pitch = pitchOf(note);
    if (!pitch || pitch.unpitched) throw new EditError('Solo le note intonate hanno alterazioni');
    setAccidental(note, alteration === 'none' ? null : alteration);
    respell(score, [score.measureIndex(score.measureOf(note))]);
    followTies(score, note);
}

// Durata

export function setNoteType(score: ScoreDocument, id: string, type: NoteType): void {
    const note = score.note(id);
    const event = score.eventOf(note);
    const figure = figureOf(score, event.notes[0]);
    writeFigure(score, event.notes, type, figure?.dots ?? 0, tupletOf(event.notes[0]));
    refreshMeasure(score, score.measureOf(note));
}

/** Aggiunge un punto di valore, fino a due, poi li toglie. */
export function cycleDots(score: ScoreDocument, id: string): void {
    const note = score.note(id);
    const event = score.eventOf(note);
    const figure = figureOf(score, event.notes[0]);
    if (!figure) throw new EditError('Indica prima la figura della nota');
    writeFigure(score, event.notes, figure.type, (figure.dots + 1) % 3, tupletOf(event.notes[0]));
    refreshMeasure(score, score.measureOf(note));
}

/** Trasforma una nota, o un accordo, in pausa e una pausa in nota. */
export function toggleRest(score: ScoreDocument, id: string): void {
    const note = score.note(id);
    if (child(note, 'grace')) throw new EditError('Gli abbellimenti non diventano pause: cancellali con Canc');
    const event = score.eventOf(note);
    const measure = score.measureOf(note);
    if (isRest(note)) {
        const rest = child(note, 'rest')!;
        const percussion = score.stateBefore(note).clef.sign === 'percussion';
        const source = previousPitch(score, note);
        const target = source ?? middleLine(score.stateBefore(note).clef);
        const pitch = element(note.ownerDocument, percussion ? 'unpitched' : 'pitch');
        pitch.appendChild(element(note.ownerDocument, percussion ? 'display-step' : 'step', target.step));
        pitch.appendChild(element(note.ownerDocument, percussion ? 'display-octave' : 'octave', target.octave));
        rest.replaceWith(pitch);
        if (!child(note, 'type')) {
            const figure = figureOf(score, note);
            if (figure) writeFigure(score, [note], figure.type, figure.dots, tupletOf(note));
        }
        respell(score, [score.measureIndex(measure)]);
    } else {
        const kept = note;
        for (const member of event.notes.filter((candidate) => candidate !== note)) removeNote(score, member);
        clearTies(score, kept);
        child(kept, 'pitch')?.replaceWith(element(kept.ownerDocument, 'rest'));
        child(kept, 'unpitched')?.replaceWith(element(kept.ownerDocument, 'rest'));
        for (const name of ['accidental', 'stem', 'notehead', 'beam', 'lyric']) removeChildren(kept, name);
        const notations = child(kept, 'notations');
        for (const item of children(notations)) if (item.tagName !== 'tuplet' && item.tagName !== 'fermata') item.remove();
        removeIfEmpty(notations);
        respell(score, [score.measureIndex(measure)]);
    }
    refreshMeasure(score, measure);
}

// Inserimento ed eliminazione

/** Inserisce prima o dopo la nota una copia della nota, con la stessa figura; restituisce l'`id` della nuova nota. */
export function insertNote(score: ScoreDocument, id: string, where: 'before' | 'after'): string {
    const note = score.note(id);
    if (child(note, 'grace')) throw new EditError('Non si possono copiare le note di abbellimento');
    const event = score.eventOf(note);
    const copy = note.cloneNode(true) as Element;
    for (const name of ['chord', 'tie', 'accidental', 'stem', 'beam', 'lyric', 'notations', 'time-modification']) removeChildren(copy, name);
    copy.setAttribute('id', score.newId('n'));
    if (where === 'after') event.notes[event.notes.length - 1].after(copy);
    else event.notes[0].before(copy);
    if (tupletOf(note)) {
        const figure = figureOf(score, note);
        if (figure) writeFigure(score, [copy], figure.type, figure.dots, null);
    }
    const measure = score.measureOf(note);
    respell(score, [score.measureIndex(measure)]);
    refreshMeasure(score, measure);
    return copy.getAttribute('id')!;
}

/** Aggiunge all'accordo una nota una terza sopra la più acuta; restituisce l'`id` della nuova nota. */
export function addChordNote(score: ScoreDocument, id: string): string {
    const note = score.note(id);
    if (isRest(note)) throw new EditError('Non si può aggiungere una nota a una pausa: trasformala prima in nota');
    const event = score.eventOf(note);
    const top = event.notes
        .map((member) => pitchOf(member))
        .filter((pitch): pitch is NonNullable<typeof pitch> => pitch !== null)
        .reduce((highest, pitch) => Math.max(highest, diatonic(pitch.step, pitch.octave)), Number.NEGATIVE_INFINITY);
    const copy = note.cloneNode(true) as Element;
    for (const name of ['tie', 'accidental', 'stem', 'beam', 'lyric', 'notations']) removeChildren(copy, name);
    if (!child(copy, 'chord')) insertOrdered(copy, element(copy.ownerDocument, 'chord'), NOTE_ORDER);
    const target = fromDiatonic(top + 2);
    writePitch(copy, target.step, target.octave);
    copy.setAttribute('id', score.newId('n'));
    event.notes[event.notes.length - 1].after(copy);
    const measure = score.measureOf(note);
    respell(score, [score.measureIndex(measure)]);
    refreshMeasure(score, measure);
    return copy.getAttribute('id')!;
}

/** Elimina la nota; restituisce l'`id` della nota da selezionare dopo, se esiste. */
export function deleteNote(score: ScoreDocument, id: string): string | null {
    const note = score.note(id);
    const event = score.eventOf(note);
    if (event.notes.length === 1 && tupletOf(note)) throw new EditError('La nota fa parte di un gruppo irregolare: togli prima il gruppo');
    const measure = score.measureOf(note);
    if (children(measure, 'note').length === 1) {
        // Una battuta senza note né pause non si potrebbe più selezionare: l'ultima nota diventa una pausa di battuta.
        if (isRest(note)) throw new EditError('La battuta deve contenere almeno una pausa: per toglierla usa Elimina nella scheda Battuta');
        removeNote(score, note);
        return fillEmptyMeasure(score, score.measureIndex(measure));
    }
    const next = adjacentNote(score, id, 1) ?? adjacentNote(score, id, -1);
    removeNote(score, note);
    respell(score, [score.measureIndex(measure)]);
    refreshMeasure(score, measure);
    return next;
}

// Legature e gruppi irregolari

/** Lega la nota alla successiva della stessa voce, con la stessa altezza, oppure toglie la legatura. */
export function toggleTie(score: ScoreDocument, id: string): void {
    const note = score.note(id);
    const pitch = pitchOf(note);
    if (!pitch || pitch.unpitched) throw new EditError('Si legano solo note intonate');
    if (child(note, 'grace')) throw new EditError('Gli abbellimenti non si legano di valore: usa la legatura di portamento');
    if (hasTie(note, 'start')) {
        const partner = tiePartner(score, note, 'next');
        removeTie(note, 'start');
        if (partner) removeTie(partner, 'stop');
        return;
    }
    const following = nextEvent(score, note);
    if (!following) throw new EditError('Nessuna nota seguente nella stessa voce');
    const partner = following.notes.find((member) => samePosition(pitchOf(member), pitch));
    if (!partner) throw new EditError("La nota seguente nella stessa voce ha un'altezza diversa: correggila prima di legare");
    addTie(note, 'start');
    addTie(partner, 'stop');
    setAccidental(partner, null);
    setAlter(partner, pitch.alter);
    removeSlurBetween(note, partner);
}

/** Crea un gruppo irregolare dalla nota con le note seguenti della voce, oppure toglie il gruppo a cui appartiene. */
export function toggleTuplet(score: ScoreDocument, id: string, actual: number): void {
    const note = score.note(id);
    if (child(note, 'grace')) throw new EditError('Gli abbellimenti non entrano nei gruppi irregolari');
    const measure = score.measureOf(note);
    const events = score.events(measure);
    const event = score.eventOf(note);
    const voiceEvents = events.filter((candidate) => candidate.voice === event.voice && !child(candidate.notes[0], 'grace'));
    const position = voiceEvents.findIndex((candidate) => candidate.notes.includes(note));
    if (tupletOf(note)) {
        let first = position;
        let last = position;
        while (first > 0 && tupletOf(voiceEvents[first - 1].notes[0]) && !hasTuplet(voiceEvents[first].notes[0], 'start')) first--;
        while (last < voiceEvents.length - 1 && tupletOf(voiceEvents[last + 1].notes[0]) && !hasTuplet(voiceEvents[last].notes[0], 'stop')) last++;
        for (const member of voiceEvents.slice(first, last + 1)) {
            const figure = figureOf(score, member.notes[0]);
            for (const item of member.notes) {
                removeChildren(child(item, 'notations') ?? item, 'tuplet');
                removeIfEmpty(child(item, 'notations'));
            }
            if (figure) writeFigure(score, member.notes, figure.type, figure.dots, null);
        }
        refreshMeasure(score, measure);
        return;
    }
    const option = TUPLETS.find((candidate) => candidate.actual === actual);
    if (!option) throw new EditError('Gruppo irregolare non previsto');
    const group = voiceEvents.slice(position, position + option.actual);
    if (group.length < option.actual || group.some((member) => tupletOf(member.notes[0]))) {
        throw new EditError(`Servono ${option.actual} note consecutive della stessa voce nella stessa battuta, fuori da altri gruppi`);
    }
    for (const member of group) {
        const figure = figureOf(score, member.notes[0]);
        if (!figure) throw new EditError('Indica prima la figura di tutte le note del gruppo');
        writeFigure(score, member.notes, figure.type, figure.dots, { actual: option.actual, normal: option.normal });
    }
    addTuplet(group[0].notes[0], 'start');
    addTuplet(group[group.length - 1].notes[0], 'stop');
    refreshMeasure(score, measure);
}

// Espressione

export function setDynamic(score: ScoreDocument, id: string, dynamic: Dynamic | null): void {
    const first = score.eventOf(score.note(id)).notes[0];
    for (const direction of precedingDirections(first)) {
        for (const type of children(direction, 'direction-type')) if (child(type, 'dynamics')) type.remove();
        if (!child(direction, 'direction-type')) direction.remove();
    }
    if (!dynamic) return;
    const owner = first.ownerDocument;
    const direction = element(owner, 'direction', null, { placement: 'below' });
    const type = direction.appendChild(element(owner, 'direction-type'));
    type.appendChild(element(owner, 'dynamics')).appendChild(element(owner, dynamic));
    const staff = text(child(first, 'staff'));
    if (staff) insertOrdered(direction, element(owner, 'staff', staff), DIRECTION_ORDER);
    first.before(direction);
}

export function toggleArticulation(score: ScoreDocument, id: string, articulation: Articulation): void {
    const note = score.note(id);
    if (isRest(note)) throw new EditError('Le articolazioni si mettono sulle note');
    const existing = child(child(child(note, 'notations'), 'articulations'), articulation);
    if (existing) {
        const articulations = existing.parentElement!;
        existing.remove();
        removeIfEmpty(articulations);
        removeIfEmpty(child(note, 'notations'));
        return;
    }
    const notations = ensureChild(note, 'notations', NOTE_ORDER);
    const articulations = child(notations, 'articulations') ?? notations.appendChild(element(note.ownerDocument, 'articulations'));
    articulations.appendChild(element(note.ownerDocument, articulation));
}

// Battute

export function setTime(score: ScoreDocument, index: number, beats: number, beatType: number): void {
    if (!Number.isInteger(beats) || beats < 1 || beats > 32) throw new EditError('Il numeratore del metro va da 1 a 32');
    if (![1, 2, 4, 8, 16, 32].includes(beatType)) throw new EditError('Il denominatore del metro deve essere 1, 2, 4, 8, 16 o 32');
    const measure = score.measure(index);
    const previous = score.stateBefore(measure);
    const attributes = leadingAttributes(measure, true)!;
    removeChildren(attributes, 'time');
    if (index === 0 || previous.beats !== beats || previous.beatType !== beatType) {
        const time = insertOrdered(attributes, element(score.document, 'time'), ATTRIBUTES_ORDER);
        time.appendChild(element(score.document, 'beats', beats));
        time.appendChild(element(score.document, 'beat-type', beatType));
    }
    removeIfEmpty(attributes);
    refitMeasureRests(score, index);
}

export function setKey(score: ScoreDocument, index: number, fifths: number): void {
    if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) throw new EditError("L'armatura va da 7 bemolli a 7 diesis");
    const measure = score.measure(index);
    const before = score.measureStates().map((state) => state.fifths);
    const previous = score.stateBefore(measure);
    const attributes = leadingAttributes(measure, true)!;
    removeChildren(attributes, 'key');
    if (index === 0 || previous.fifths !== fifths) {
        insertOrdered(attributes, element(score.document, 'key'), ATTRIBUTES_ORDER).appendChild(element(score.document, 'fifths', fifths));
    }
    removeIfEmpty(attributes);
    const after = score.measureStates().map((state) => state.fifths);
    respell(
        score,
        after.map((value, position) => (value !== before[position] ? position : -1)).filter((position) => position >= 0)
    );
}

/** Cambia la chiave della battuta lasciando le note nella stessa posizione sul rigo, come nell'immagine. */
export function setClef(score: ScoreDocument, index: number, value: string): void {
    const option = CLEF_OPTIONS.find((candidate) => candidate.value === value);
    if (!option) throw new EditError('Chiave non prevista');
    const measure = score.measure(index);
    const before = score.clefsByNote();
    const previous = score.stateBefore(measure);
    const attributes = leadingAttributes(measure, true)!;
    for (const clef of children(attributes, 'clef')) if (!clef.getAttribute('number') || clef.getAttribute('number') === '1') clef.remove();
    if (index === 0 || clefValue(previous.clef) !== option.value) {
        const clef = insertOrdered(attributes, element(score.document, 'clef'), ATTRIBUTES_ORDER);
        clef.appendChild(element(score.document, 'sign', option.clef.sign));
        if (option.clef.sign !== 'percussion') clef.appendChild(element(score.document, 'line', option.clef.line));
        if (option.clef.octaveChange) insertOrdered(clef, element(score.document, 'clef-octave-change', option.clef.octaveChange), CLEF_ORDER);
    }
    removeIfEmpty(attributes);
    const after = score.clefsByNote();
    const changed = new Set<number>();
    for (const [note, oldClef] of before) {
        const newClef = after.get(note);
        const oldBottom = clefBottom(oldClef);
        const newBottom = newClef ? clefBottom(newClef) : null;
        const pitch = pitchOf(note);
        if (oldBottom === null || newBottom === null || oldBottom === newBottom || !pitch || pitch.unpitched) continue;
        const target = fromDiatonic(diatonic(pitch.step, pitch.octave) + newBottom - oldBottom);
        writePitch(note, target.step, target.octave);
        changed.add(score.measureIndex(score.measureOf(note)));
    }
    respell(score, changed);
}

/** Inserisce una battuta di pausa prima o dopo la battuta; restituisce l'indice della nuova battuta. */
export function insertMeasure(score: ScoreDocument, index: number, where: 'before' | 'after'): number {
    const measure = score.measure(index);
    const state = where === 'before' ? score.stateBefore(measure) : score.stateAfter(measure);
    const created = element(score.document, 'measure', null, { number: '', id: score.newId('m') });
    if (where === 'before') {
        measure.before(created);
        if (index === 0) moveStateAttributes(measure, created);
    } else {
        measure.after(created);
    }
    fillWithRest(score, created, index === 0 && where === 'before' ? score.stateAfter(created) : state);
    score.renumber();
    return where === 'before' ? index : index + 1;
}

export function deleteMeasure(score: ScoreDocument, index: number): void {
    const measures = score.measures();
    if (measures.length <= 1) throw new EditError('La parte deve avere almeno una battuta');
    removeMeasure(score, measures[index]);
    score.renumber();
}

/** Mette una pausa di battuta in una battuta senza note né pause; restituisce la pausa, da selezionare. */
export function fillEmptyMeasure(score: ScoreDocument, index: number): string {
    const measure = score.measure(index);
    if (child(measure, 'note')) throw new EditError('La battuta contiene già delle note');
    for (const item of children(measure)) if (['backup', 'forward'].includes(item.tagName)) item.remove();
    fillWithRest(score, measure, score.stateAt(index));
    return child(measure, 'note')!.getAttribute('id')!;
}

/**
 * Aggiunge battute di pausa dopo la battuta, oppure dopo la pausa di più battute che la contiene, che resta intatta.
 * Restituisce l'indice della prima battuta aggiunta.
 */
export function insertMeasures(score: ScoreDocument, index: number, count: number): number {
    if (!Number.isInteger(count) || count < 1 || count > MAX_MULTI_REST) throw new EditError(`Il numero di battute va da 1 a ${MAX_MULTI_REST}`);
    const measures = score.measures();
    let anchor = index;
    for (let start = index; start >= 0; start--) {
        const group = multiRestCount(measures[start]);
        if (group > 1 && start + group - 1 >= index) {
            anchor = Math.min(start + group - 1, measures.length - 1);
            break;
        }
    }
    const first = insertMeasure(score, anchor, 'after');
    for (let added = 1; added < count; added++) insertMeasure(score, first + added - 1, 'after');
    return first;
}

/** La battuta diventa una pausa di più battute: le battute del gruppo diventano pause, aggiunte o tolte secondo il numero. */
export function setMultiRest(score: ScoreDocument, index: number, count: number): void {
    if (!Number.isInteger(count) || count < 1 || count > MAX_MULTI_REST) throw new EditError(`Il numero di battute va da 1 a ${MAX_MULTI_REST}`);
    const measures = score.measures();
    const first = measures[index];
    const current = Math.min(multiRestCount(first), measures.length - index);
    for (let offset = 0; offset < Math.min(current, count); offset++) {
        const measure = measures[index + offset];
        for (const item of children(measure)) if (['note', 'backup', 'forward', 'harmony', 'figured-bass'].includes(item.tagName)) item.remove();
        fillWithRest(score, measure, score.stateAt(index + offset));
    }
    let anchor = measures[index + Math.min(current, count) - 1];
    for (let added = current; added < count; added++) {
        const created = element(score.document, 'measure', null, { number: '', id: score.newId('m') });
        anchor.after(created);
        fillWithRest(score, created, score.stateAfter(anchor));
        anchor = created;
    }
    for (let offset = current - 1; offset >= count; offset--) removeMeasure(score, measures[index + offset]);

    const attributes = leadingAttributes(first, count > 1);
    const style = child(attributes, 'measure-style');
    removeChildren(style ?? first, 'multiple-rest');
    if (count > 1) ensureChild(attributes!, 'measure-style', ATTRIBUTES_ORDER).appendChild(element(score.document, 'multiple-rest', count));
    removeIfEmpty(child(attributes, 'measure-style'));
    removeIfEmpty(attributes);
    score.renumber();
}

// Struttura

export function toggleRepeat(score: ScoreDocument, index: number, direction: 'forward' | 'backward'): void {
    const measure = score.measure(index);
    const existing = repeatBarline(measure, direction);
    if (existing) {
        child(existing, 'repeat')?.remove();
        removeChildren(existing, 'bar-style');
        if (!meaningfulBarline(existing)) existing.remove();
        return;
    }
    const barline = barlineAt(measure, direction === 'forward' ? 'left' : 'right');
    removeChildren(barline, 'bar-style');
    insertOrdered(barline, element(score.document, 'bar-style', direction === 'forward' ? 'heavy-light' : 'light-heavy'), BARLINE_ORDER);
    insertOrdered(barline, element(score.document, 'repeat', null, { direction }), BARLINE_ORDER);
}

/** Assegna la battuta a una volta (1, 2, 3) o la toglie; le battute consecutive con la stessa volta formano una parentesi. */
export function setEnding(score: ScoreDocument, index: number, ending: string | null): void {
    if (ending !== null && !/^[1-9]$/.test(ending)) throw new EditError('Volta non prevista');
    const endings = endingNumbers(score);
    endings[index] = ending;
    const measures = score.measures();
    for (const measure of measures) {
        for (const barline of children(measure, 'barline')) {
            removeChildren(barline, 'ending');
            if (!meaningfulBarline(barline)) barline.remove();
        }
    }
    let start = 0;
    while (start < measures.length) {
        const number = endings[start];
        let end = start;
        while (end + 1 < measures.length && number !== null && endings[end + 1] === number) end++;
        if (number !== null) {
            insertOrdered(barlineAt(measures[start], 'left'), element(score.document, 'ending', null, { number, type: 'start' }), BARLINE_ORDER);
            const type = repeatBarline(measures[end], 'backward') ? 'stop' : 'discontinue';
            insertOrdered(barlineAt(measures[end], 'right'), element(score.document, 'ending', null, { number, type }), BARLINE_ORDER);
        }
        start = end + 1;
    }
}

export function toggleMark(score: ScoreDocument, index: number, mark: StructureMark): void {
    const measure = score.measure(index);
    const existing = markElements(measure, mark);
    if (existing.length) {
        for (const item of existing) {
            if (item.tagName === 'sound') {
                for (const attribute of MARK_SOUNDS[mark]) item.removeAttribute(attribute);
                if (!item.attributes.length && !item.children.length) item.remove();
            } else {
                item.remove();
            }
        }
        for (const barline of children(measure, 'barline')) if (!meaningfulBarline(barline)) barline.remove();
        return;
    }
    const owner = score.document;
    const direction = element(owner, 'direction', null, { placement: 'above' });
    const type = direction.appendChild(element(owner, 'direction-type'));
    const sound = element(owner, 'sound');
    switch (mark) {
        case 'segno':
            type.appendChild(element(owner, 'segno'));
            sound.setAttribute('segno', 'segno');
            break;
        case 'coda':
            type.appendChild(element(owner, 'coda'));
            sound.setAttribute('coda', 'coda');
            break;
        case 'toCoda':
            type.appendChild(element(owner, 'words', 'To Coda'));
            sound.setAttribute('tocoda', 'coda');
            break;
        case 'daCapo':
            type.appendChild(element(owner, 'words', 'D.C.'));
            sound.setAttribute('dacapo', 'yes');
            break;
        case 'dalSegno':
            type.appendChild(element(owner, 'words', 'D.S.'));
            sound.setAttribute('dalsegno', 'segno');
            break;
        case 'fine':
            type.appendChild(element(owner, 'words', 'Fine'));
            sound.setAttribute('fine', 'yes');
            break;
    }
    insertOrdered(direction, sound, DIRECTION_ORDER);
    if (mark === 'segno' || mark === 'coda') insertAtStart(measure, direction);
    else insertAtEnd(measure, direction);
}

/**
 * Indicazione di tempo all'inizio della battuta: semiminime al minuto ed eventualmente un testo, per esempio «Allegro»;
 * `null` la toglie. Il testo accompagna sempre il metronomo, che serve all'ascolto.
 */
export function setTempo(score: ScoreDocument, index: number, bpm: number | null, words: string | null = null): void {
    if (bpm !== null && (!Number.isInteger(bpm) || bpm < 20 || bpm > 400)) throw new EditError('Il tempo va da 20 a 400 semiminime al minuto');
    const label = (words ?? '').replace(/\s+/g, ' ').trim();
    if (label && bpm === null) throw new EditError("Indica anche le semiminime al minuto: servono all'ascolto");
    if (label.length > MAX_TEMPO_TEXT) throw new EditError(`Il testo del tempo può avere al massimo ${MAX_TEMPO_TEXT} caratteri`);
    const measure = score.measure(index);
    for (const direction of children(measure, 'direction')) {
        const tempo = isTempoDirection(direction);
        for (const type of children(direction, 'direction-type')) if (child(type, 'metronome') || (tempo && child(type, 'words'))) type.remove();
        child(direction, 'sound')?.removeAttribute('tempo');
        const sound = child(direction, 'sound');
        if (sound && !sound.attributes.length && !sound.children.length) sound.remove();
        if (!child(direction, 'direction-type')) direction.remove();
    }
    for (const sound of children(measure, 'sound')) {
        sound.removeAttribute('tempo');
        if (!sound.attributes.length && !sound.children.length) sound.remove();
    }
    if (bpm === null) return;
    const owner = score.document;
    const direction = element(owner, 'direction', null, { placement: 'above' });
    if (label) direction.appendChild(element(owner, 'direction-type')).appendChild(element(owner, 'words', label, { 'font-weight': 'bold' }));
    const metronome = direction.appendChild(element(owner, 'direction-type')).appendChild(element(owner, 'metronome', null, label ? { parentheses: 'yes' } : {}));
    metronome.appendChild(element(owner, 'beat-unit', 'quarter'));
    metronome.appendChild(element(owner, 'per-minute', bpm));
    direction.appendChild(element(owner, 'sound', null, { tempo: String(bpm) }));
    insertAtStart(measure, direction);
}

// Funzioni di supporto, usate anche dalla scrittura (`score-writing.ts`)

const MARK_SOUNDS: Readonly<Record<StructureMark, string[]>> = {
    segno: ['segno'],
    coda: ['coda'],
    toCoda: ['tocoda'],
    daCapo: ['dacapo'],
    dalSegno: ['dalsegno'],
    fine: ['fine']
};

const MARK_WORDS: Readonly<Record<StructureMark, RegExp | null>> = {
    segno: null,
    coda: null,
    toCoda: /^(to coda|al coda|alla coda)$/,
    daCapo: /d\.\s?c\.|da capo/,
    dalSegno: /d\.\s?s\.|dal segno/,
    fine: /^fine$/
};

/** Elementi che danno l'indicazione nella battuta: direzioni, `sound` e simboli sulle stanghette. */
function markElements(measure: Element, mark: StructureMark): Element[] {
    const found: Element[] = [];
    for (const direction of children(measure, 'direction')) {
        const types = children(direction, 'direction-type');
        const sound = child(direction, 'sound');
        const symbol = (mark === 'segno' || mark === 'coda') && types.some((type) => child(type, mark));
        const words = MARK_WORDS[mark];
        const written = !!words && types.some((type) => children(type, 'words').some((item) => words.test((item.textContent ?? '').trim().toLowerCase().replace(/\s+/g, ' '))));
        const sounding = !!sound && MARK_SOUNDS[mark].some((attribute) => sound.hasAttribute(attribute) && (mark !== 'daCapo' || sound.getAttribute(attribute) === 'yes'));
        if (symbol || written || sounding) found.push(direction);
    }
    for (const sound of children(measure, 'sound')) if (MARK_SOUNDS[mark].some((attribute) => sound.hasAttribute(attribute))) found.push(sound);
    if (mark === 'segno' || mark === 'coda') for (const barline of children(measure, 'barline')) found.push(...children(barline, mark));
    return found;
}

function tempoOf(measure: Element): number | null {
    for (const direction of children(measure, 'direction')) {
        const sound = Number(child(direction, 'sound')?.getAttribute('tempo'));
        if (sound) return Math.round(sound);
        for (const type of children(direction, 'direction-type')) {
            const perMinute = integer(child(child(type, 'metronome'), 'per-minute'));
            if (perMinute) return perMinute;
        }
    }
    const sound = Number(child(measure, 'sound')?.getAttribute('tempo'));
    return sound ? Math.round(sound) : null;
}

/** Direzione con l'indicazione di tempo: metronomo o tempo dell'ascolto. */
function isTempoDirection(direction: Element): boolean {
    return children(direction, 'direction-type').some((type) => child(type, 'metronome')) || !!child(direction, 'sound')?.hasAttribute('tempo');
}

/** Testo che accompagna l'indicazione di tempo della battuta, per esempio «Allegro». */
function tempoTextOf(measure: Element): string | null {
    const direction = children(measure, 'direction').find(isTempoDirection);
    const words = children(direction, 'direction-type').flatMap((type) => children(type, 'words').map((item) => (item.textContent ?? '').trim()));
    return words.filter(Boolean).join(' ') || null;
}

function multiRestCount(measure: Element): number {
    for (const attributes of children(measure, 'attributes')) {
        const count = integer(child(child(attributes, 'measure-style'), 'multiple-rest'));
        if (count && count > 1) return count;
    }
    return 1;
}

/** Volta di ogni battuta, ricavata dalle parentesi di inizio e fine. */
function endingNumbers(score: ScoreDocument): (string | null)[] {
    let open: string | null = null;
    return score.measures().map((measure) => {
        let current: string | null = open;
        for (const barline of children(measure, 'barline')) {
            for (const ending of children(barline, 'ending')) {
                const number = (ending.getAttribute('number') ?? '').split(/[,\s]+/)[0] || '1';
                const type = ending.getAttribute('type');
                if (type === 'start') {
                    current = number;
                    open = number;
                } else {
                    current = current ?? number;
                    open = null;
                }
            }
        }
        return current;
    });
}

function repeatBarline(measure: Element, direction: 'forward' | 'backward'): Element | null {
    return children(measure, 'barline').find((barline) => child(barline, 'repeat')?.getAttribute('direction') === direction) ?? null;
}

/** La stanghetta ha un contenuto oltre a uno stile normale. */
function meaningfulBarline(barline: Element): boolean {
    return children(barline).some((item) => item.tagName !== 'bar-style' || !['regular', ''].includes(text(item) ?? ''));
}

function barlineAt(measure: Element, location: 'left' | 'right'): Element {
    const existing = children(measure, 'barline').find((barline) => (barline.getAttribute('location') ?? 'right') === location);
    if (existing) return existing;
    const created = element(measure.ownerDocument, 'barline', null, { location });
    if (location === 'left') {
        const print = child(measure, 'print');
        if (print) print.after(created);
        else measure.insertBefore(created, measure.firstElementChild);
    } else {
        measure.appendChild(created);
    }
    return created;
}

/** Gli attributi che aprono la battuta, prima di note e avanzamenti; creati se richiesto. */
export function leadingAttributes(measure: Element, create = false): Element | null {
    for (const item of children(measure)) {
        if (item.tagName === 'attributes') return item;
        if (['note', 'backup', 'forward'].includes(item.tagName)) break;
    }
    if (!create) return null;
    const created = element(measure.ownerDocument, 'attributes');
    const anchor = children(measure).find((item) => item.tagName !== 'print' && !(item.tagName === 'barline' && item.getAttribute('location') === 'left'));
    measure.insertBefore(created, anchor ?? null);
    return created;
}

export function insertAtEnd(measure: Element, node: Element): void {
    const right = children(measure, 'barline').find((barline) => (barline.getAttribute('location') ?? 'right') === 'right');
    measure.insertBefore(node, right ?? null);
}

/** Riempie una battuta vuota con una pausa di battuta nella voce 1. */
function fillWithRest(score: ScoreDocument, measure: Element, state: MusicalState): void {
    const divisions = score.ensureDivisions(fraction(state.beats * 4, state.beatType), state.divisions);
    const owner = score.document;
    const rest = element(owner, 'note', null, { id: score.newId('n') });
    rest.appendChild(element(owner, 'rest', null, { measure: 'yes' }));
    rest.appendChild(element(owner, 'duration', Math.round((state.beats * 4 * divisions) / state.beatType)));
    rest.appendChild(element(owner, 'voice', '1'));
    insertAtEnd(measure, rest);
}

/** Dopo un cambio di metro le pause di battuta prendono la nuova durata, fino al cambio di metro seguente. */
function refitMeasureRests(score: ScoreDocument, from: number): void {
    const measures = score.measures();
    const states = score.measureStates();
    for (let index = from; index < measures.length; index++) {
        if (index > from && leadingAttributes(measures[index]) && child(leadingAttributes(measures[index]), 'time')) break;
        const state = states[index];
        for (const note of children(measures[index], 'note')) {
            if (child(note, 'rest')?.getAttribute('measure') !== 'yes') continue;
            const divisions = score.ensureDivisions(fraction(state.beats * 4, state.beatType), state.divisions);
            setChildText(note, 'duration', Math.round((state.beats * 4 * divisions) / state.beatType), NOTE_ORDER);
        }
    }
}

/** Sposta gli attributi di stato (divisioni, armatura, metro, chiave…) che aprono una battuta all'inizio di un'altra. */
function moveStateAttributes(from: Element, to: Element): void {
    const source = leadingAttributes(from);
    if (!source) return;
    const target = leadingAttributes(to, true)!;
    for (const item of children(source)) if (STATE_ATTRIBUTES.includes(item.tagName)) insertOrdered(target, item, ATTRIBUTES_ORDER);
    removeIfEmpty(source);
}

/** Toglie una battuta portando i suoi attributi di stato sulla battuta seguente, se questa non li ridefinisce. */
function removeMeasure(score: ScoreDocument, measure: Element): void {
    const next = measure.nextElementSibling?.tagName === 'measure' ? measure.nextElementSibling : null;
    if (next) {
        const latest = new Map<string, Element>();
        for (const attributes of children(measure, 'attributes')) for (const item of children(attributes)) if (STATE_ATTRIBUTES.includes(item.tagName)) latest.set(item.tagName, item);
        const target = leadingAttributes(next);
        const missing = Array.from(latest.entries()).filter(([name]) => !child(target, name));
        if (missing.length) {
            const attributes = target ?? leadingAttributes(next, true)!;
            for (const [, item] of missing) insertOrdered(attributes, item.cloneNode(true) as Element, ATTRIBUTES_ORDER);
        }
    }
    for (const note of children(measure, 'note')) clearTies(score, note);
    measure.remove();
}

/** Toglie una nota dal documento, mantenendo coerenti accordo, legature e gruppo irregolare. */
function removeNote(score: ScoreDocument, note: Element): void {
    const event = score.eventOf(note);
    clearTies(score, note);
    if (event.notes.length > 1 && event.notes[0] === note) {
        const heir = event.notes[1];
        child(heir, 'chord')?.remove();
        const tuplets = children(child(note, 'notations'), 'tuplet');
        if (tuplets.length) {
            const notations = ensureChild(heir, 'notations', NOTE_ORDER);
            for (const tuplet of tuplets) notations.appendChild(tuplet);
        }
    }
    note.remove();
}

/** Figura e punti della nota; per le note senza `type` si ricavano dalla durata. */
export function figureOf(score: ScoreDocument, note: Element): { type: NoteType; dots: number } | null {
    const type = text(child(note, 'type'));
    if (noteTypeOption(type)) return { type: type as NoteType, dots: children(note, 'dot').length };
    const divisions = score.stateBefore(note).divisions;
    const duration = integer(child(note, 'duration'));
    if (!duration) return null;
    const tuplet = tupletOf(note);
    return inferType(duration / divisions, tuplet?.actual ?? 1, tuplet?.normal ?? 1);
}

export function tupletOf(note: Element): { actual: number; normal: number } | null {
    const modification = child(note, 'time-modification');
    const actual = integer(child(modification, 'actual-notes'));
    const normal = integer(child(modification, 'normal-notes'));
    return actual && normal ? { actual, normal } : null;
}

/** Scrive figura, punti, gruppo irregolare e durata sulle note di un accordo. */
export function writeFigure(score: ScoreDocument, notes: Element[], type: NoteType, dots: number, tuplet: { actual: number; normal: number } | null): void {
    const quarters = noteQuarters(type, dots, tuplet?.actual ?? 1, tuplet?.normal ?? 1);
    const divisions = score.ensureDivisions(quarters, score.stateBefore(notes[0]).divisions);
    const duration = Math.round(divisions * toNumber(quarters));
    for (const note of notes) {
        child(note, 'rest')?.removeAttribute('measure');
        if (!child(note, 'grace')) setChildText(note, 'duration', duration, NOTE_ORDER);
        setChildText(note, 'type', type, NOTE_ORDER);
        removeChildren(note, 'dot');
        for (let index = 0; index < dots; index++) insertOrdered(note, element(note.ownerDocument, 'dot'), NOTE_ORDER);
        removeChildren(note, 'time-modification');
        if (tuplet) {
            const modification = insertOrdered(note, element(note.ownerDocument, 'time-modification'), NOTE_ORDER);
            setChildText(modification, 'actual-notes', tuplet.actual, TIME_MODIFICATION_ORDER);
            setChildText(modification, 'normal-notes', tuplet.normal, TIME_MODIFICATION_ORDER);
        }
    }
}

export function writePitch(note: Element, step: Step, octave: number): void {
    const pitch = child(note, 'pitch');
    if (pitch) {
        setChildText(pitch, 'step', step, PITCH_ORDER);
        setChildText(pitch, 'octave', octave, PITCH_ORDER);
    } else {
        const unpitched = child(note, 'unpitched');
        if (!unpitched) return;
        setChildText(unpitched, 'display-step', step, ['display-step', 'display-octave']);
        setChildText(unpitched, 'display-octave', octave, ['display-step', 'display-octave']);
    }
    removeChildren(note, 'stem');
}

/** Ricalcola le alterazioni delle battute delle note indicate. */
function respellNotes(score: ScoreDocument, notes: Element[]): void {
    respell(
        score,
        notes.map((note) => score.measureIndex(score.measureOf(note)))
    );
}

/** Le note legate alla nota prendono la sua alterazione. */
function followTies(score: ScoreDocument, note: Element): void {
    const alter = pitchOf(note)?.alter ?? 0;
    for (const linked of tieChain(score, note)) if (linked !== note) setAlter(linked, alter);
}

/** La nota con le note legate prima e dopo di lei. */
export function tieChain(score: ScoreDocument, note: Element): Element[] {
    const chain = [note];
    let current: Element | null = note;
    while (current && hasTie(current, 'stop')) {
        current = tiePartner(score, current, 'previous');
        if (!current || chain.includes(current)) break;
        chain.unshift(current);
    }
    current = note;
    while (current && hasTie(current, 'start')) {
        current = tiePartner(score, current, 'next');
        if (!current || chain.includes(current)) break;
        chain.push(current);
    }
    return chain;
}

function tiePartner(score: ScoreDocument, note: Element, direction: 'next' | 'previous'): Element | null {
    const pitch = pitchOf(note);
    const event = direction === 'next' ? nextEvent(score, note) : previousEvent(score, note);
    return event?.notes.find((member) => samePosition(pitchOf(member), pitch) && hasTie(member, direction === 'next' ? 'stop' : 'start')) ?? null;
}

function samePosition(left: { step: Step; octave: number } | null, right: { step: Step; octave: number } | null): boolean {
    return !!left && !!right && left.step === right.step && left.octave === right.octave;
}

/** Accordo o nota seguente nella stessa voce, anche nella battuta seguente. */
function nextEvent(score: ScoreDocument, note: Element): NoteEvent | null {
    return neighbourEvent(score, note, 1);
}

function previousEvent(score: ScoreDocument, note: Element): NoteEvent | null {
    return neighbourEvent(score, note, -1);
}

function neighbourEvent(score: ScoreDocument, note: Element, delta: 1 | -1): NoteEvent | null {
    const measure = score.measureOf(note);
    const event = score.eventOf(note);
    const sameVoice = (candidate: NoteEvent) => candidate.voice === event.voice && !child(candidate.notes[0], 'grace');
    const events = score.events(measure).filter(sameVoice);
    const index = events.findIndex((candidate) => candidate.notes.includes(note));
    if (index < 0) return null;
    const inMeasure = events[index + delta];
    if (inMeasure) return inMeasure;
    const neighbour = score.measures()[score.measureIndex(measure) + delta];
    if (!neighbour) return null;
    const candidates = score.events(neighbour).filter(sameVoice);
    return (delta === 1 ? candidates[0] : candidates[candidates.length - 1]) ?? null;
}

export function hasTie(note: Element, type: 'start' | 'stop'): boolean {
    return children(note, 'tie').some((tie) => tie.getAttribute('type') === type);
}

export function addTie(note: Element, type: 'start' | 'stop'): void {
    if (!hasTie(note, type)) insertOrdered(note, element(note.ownerDocument, 'tie', null, { type }), NOTE_ORDER);
    const notations = ensureChild(note, 'notations', NOTE_ORDER);
    if (!children(notations, 'tied').some((tied) => tied.getAttribute('type') === type)) notations.appendChild(element(note.ownerDocument, 'tied', null, { type }));
}

export function removeTie(note: Element, type: 'start' | 'stop'): void {
    for (const tie of children(note, 'tie')) if (tie.getAttribute('type') === type) tie.remove();
    const notations = child(note, 'notations');
    for (const tied of children(notations, 'tied')) if (tied.getAttribute('type') === type) tied.remove();
    removeIfEmpty(notations);
}

/** Toglie le legature della nota anche dalle note a cui era legata. */
export function clearTies(score: ScoreDocument, note: Element): void {
    if (hasTie(note, 'start')) {
        const partner = tiePartner(score, note, 'next');
        if (partner) removeTie(partner, 'stop');
        removeTie(note, 'start');
    }
    if (hasTie(note, 'stop')) {
        const partner = tiePartner(score, note, 'previous');
        if (partner) removeTie(partner, 'start');
        removeTie(note, 'stop');
    }
}

/** Una legatura di portamento tra due note della stessa altezza era una legatura di valore letta male. */
function removeSlurBetween(start: Element, stop: Element): void {
    for (const slur of children(child(start, 'notations'), 'slur')) {
        if (slur.getAttribute('type') !== 'start') continue;
        const number = slur.getAttribute('number') ?? '1';
        const closing = children(child(stop, 'notations'), 'slur').find((item) => item.getAttribute('type') === 'stop' && (item.getAttribute('number') ?? '1') === number);
        if (!closing) continue;
        slur.remove();
        closing.remove();
    }
}

export function hasTuplet(note: Element, type: 'start' | 'stop'): boolean {
    return children(child(note, 'notations'), 'tuplet').some((tuplet) => tuplet.getAttribute('type') === type);
}

export function addTuplet(note: Element, type: 'start' | 'stop'): void {
    const notations = ensureChild(note, 'notations', NOTE_ORDER);
    notations.appendChild(element(note.ownerDocument, 'tuplet', null, type === 'start' ? { type, bracket: 'yes' } : { type }));
}

/** Altezza della nota intonata precedente nella stessa voce, per trasformare una pausa in nota. */
export function previousPitch(score: ScoreDocument, note: Element): { step: Step; octave: number } | null {
    const notes = score.notes();
    const voice = voiceOf(note);
    for (let index = notes.indexOf(note) - 1; index >= 0; index--) {
        const pitch = pitchOf(notes[index]);
        if (pitch && voiceOf(notes[index]) === voice) return { step: pitch.step, octave: pitch.octave };
    }
    return null;
}

/** Direzioni immediatamente prima della nota, che le appartengono (dinamiche). */
function precedingDirections(note: Element): Element[] {
    const result: Element[] = [];
    let current = note.previousElementSibling;
    while (current && current.tagName === 'direction') {
        result.push(current);
        current = current.previousElementSibling;
    }
    return result;
}

function dynamicOf(note: Element): Dynamic | null {
    for (const direction of precedingDirections(note)) {
        for (const type of children(direction, 'direction-type')) {
            const mark = child(type, 'dynamics')?.firstElementChild?.tagName as Dynamic | undefined;
            if (mark && DYNAMICS.includes(mark)) return mark;
        }
    }
    return null;
}

/** Dopo una modifica delle note: ritorni all'inizio della battuta per le altre voci e travature per movimento. */
export function refreshMeasure(score: ScoreDocument, measure: Element): void {
    let position = 0;
    for (const item of children(measure)) {
        if (item.tagName === 'note') {
            if (!child(item, 'chord') && !child(item, 'grace') && !child(item, 'cue')) position += integer(child(item, 'duration')) ?? 0;
        } else if (item.tagName === 'forward') {
            position += integer(child(item, 'duration')) ?? 0;
        } else if (item.tagName === 'backup') {
            if (position <= 0) {
                item.remove();
                continue;
            }
            setChildText(item, 'duration', position, ['duration', 'footnote', 'level']);
            position = 0;
        }
    }
    rebeam(score, measure);
}

/**
 * Travature ricalcolate per movimento: le crome e le figure più brevi consecutive della stessa voce nello stesso
 * movimento sono unite; nei tempi composti il movimento è la semiminima puntata.
 */
function rebeam(score: ScoreDocument, measure: Element): void {
    const state = score.stateAt(score.measureIndex(measure));
    const compound = state.beatType === 8 && state.beats % 3 === 0;
    const beat = state.divisions * (compound ? 1.5 : 1);
    const events = score.events(measure).filter((event) => !child(event.notes[0], 'grace'));
    for (const event of events) for (const note of event.notes) removeChildren(note, 'beam');
    const voices = new Set(events.map((event) => event.voice));
    for (const voice of voices) {
        let run: NoteEvent[] = [];
        const flush = () => {
            if (run.length > 1) writeBeams(run);
            run = [];
        };
        for (const event of events.filter((candidate) => candidate.voice === voice)) {
            const levels = noteTypeOption(text(child(event.notes[0], 'type')))?.beams ?? 0;
            const previous = run[run.length - 1];
            const contiguous = previous && Math.abs(previous.start + previous.duration - event.start) < 1e-6;
            const sameBeat = previous && Math.floor((previous.start + 1e-6) / beat) === Math.floor((event.start + 1e-6) / beat);
            if (levels === 0 || isRest(event.notes[0])) {
                flush();
                continue;
            }
            if (!previous || !contiguous || !sameBeat) flush();
            run.push(event);
        }
        flush();
    }
}

function writeBeams(run: NoteEvent[]): void {
    const levels = run.map((event) => noteTypeOption(text(child(event.notes[0], 'type')))?.beams ?? 0);
    const deepest = Math.max(...levels);
    for (let level = 1; level <= deepest; level++) {
        run.forEach((event, index) => {
            if (levels[index] < level) return;
            const before = index > 0 && levels[index - 1] >= level;
            const after = index < run.length - 1 && levels[index + 1] >= level;
            let value: string;
            if (before && after) value = 'continue';
            else if (after) value = 'begin';
            else if (before) value = 'end';
            else value = index === 0 ? 'forward hook' : 'backward hook';
            insertOrdered(event.notes[0], element(event.notes[0].ownerDocument, 'beam', value, { number: String(level) }), NOTE_ORDER);
        });
    }
}
