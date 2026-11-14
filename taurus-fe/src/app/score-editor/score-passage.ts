import { makeAccidentalsExplicit, setAccidental, setAlter } from './accidentals';
import { child, children, DIRECTION_ORDER, ensureChild, integer, NOTE_ORDER, removeChildren, removeIfEmpty, setChildText } from './musicxml-dom';
import { diatonic, Fraction, fraction, fromDiatonic, inferType, keyAlter, minus, noteQuarters, plus, Step, toNumber } from './notation-rules';
import { EditError, isRest, NoteEvent, pitchOf, ScoreDocument, voiceOf } from './score-document';
import { figureOf, hasTie, insertMeasure, tieChain, TUPLETS, writePitch } from './score-edits';
import { clearSpan, eventBefore, finish, graceNotesBefore, measureLength, noteAtCursor, noteDirections, TupletGroup, tupletGroups, voiceEvents, WritingCursor, WritingFigure, writeContent, writeTuplet } from './score-writing';

/**
 * Passaggi della scrittura: selezione di un tratto di una voce o di battute intere, copia, incolla, ripetizione,
 * cancellazione e trasposizione. Incollando e trasponendo le note suonano come previsto: gli accidenti si ricalcolano per
 * la tonalità e le note di arrivo, e le note non toccate della battuta conservano la loro altezza.
 */

/** Punto della parte: battuta e istante dall'inizio della battuta, in semiminime. */
export interface PassagePoint {
    measureIndex: number;
    offset: Fraction;
}

/**
 * Passaggio selezionato, da `from` a `to` escluso, nella voce indicata. Un passaggio che copre battute intere vale per
 * tutte le loro voci, come in MuseScore.
 */
export interface Passage {
    voice: number;
    from: PassagePoint;
    to: PassagePoint;
    wholeMeasures: boolean;
}

/** Accordo copiato, o pausa con dinamiche, a un istante dall'inizio del passaggio, in frammenti MusicXML. */
interface ClipChord {
    kind: 'chord';
    offset: Fraction;
    length: Fraction;
    figure: WritingFigure;
    rest: boolean;
    notes: string[];
    graces: string[];
    directions: string[];
    /** Legato all'accordo che lo segue nel passaggio. */
    tieNext: boolean;
}

/** Gruppo irregolare copiato: lunghezza e rapporto, poi gli elementi da scrivere al suo interno. */
interface ClipTuplet {
    kind: 'tuplet';
    offset: Fraction;
    figure: WritingFigure;
    actual: number;
    members: ClipChord[];
}

type ClipItem = ClipChord | ClipTuplet;

interface ClipVoice {
    voice: number;
    items: ClipItem[];
}

/** Passaggio copiato, indipendente dalla parte da cui viene: si incolla anche in un'altra parte, con l'altezza scritta. */
export interface ScoreClip {
    /** Lunghezza in semiminime. */
    length: Fraction;
    voices: ClipVoice[];
    /** Battute intere: si incollano dall'inizio della battuta, in tutte le voci. */
    wholeMeasures: boolean;
    /** «3 battute», «un passaggio di 5 note». */
    label: string;
}

/** Esito di un'operazione sul passaggio: gli estremi da selezionare e, dopo un incolla, il cursore alla fine. */
export interface PassageResult {
    anchorId: string | null;
    focusId: string | null;
    cursor?: WritingCursor;
}

export interface TranspositionInterval {
    value: string;
    label: string;
    /** Gradi della scala. */
    steps: number;
    semitones: number;
    /** Spostamento dell'armatura, in quinte. */
    fifths: number;
}

/** Intervalli della trasposizione, con la grafia delle note di arrivo: la seconda minore porta Do a Re♭, l'unisono aumentato a Do♯. */
export const INTERVALS: readonly TranspositionInterval[] = [
    { value: 'A1', label: 'Unisono aumentato', steps: 0, semitones: 1, fifths: 7 },
    { value: 'm2', label: 'Seconda minore', steps: 1, semitones: 1, fifths: -5 },
    { value: 'M2', label: 'Seconda maggiore', steps: 1, semitones: 2, fifths: 2 },
    { value: 'm3', label: 'Terza minore', steps: 2, semitones: 3, fifths: -3 },
    { value: 'M3', label: 'Terza maggiore', steps: 2, semitones: 4, fifths: 4 },
    { value: 'P4', label: 'Quarta giusta', steps: 3, semitones: 5, fifths: -1 },
    { value: 'A4', label: 'Quarta aumentata', steps: 3, semitones: 6, fifths: 6 },
    { value: 'd5', label: 'Quinta diminuita', steps: 4, semitones: 6, fifths: -6 },
    { value: 'P5', label: 'Quinta giusta', steps: 4, semitones: 7, fifths: 1 },
    { value: 'm6', label: 'Sesta minore', steps: 5, semitones: 8, fifths: -4 },
    { value: 'M6', label: 'Sesta maggiore', steps: 5, semitones: 9, fifths: 3 },
    { value: 'm7', label: 'Settima minore', steps: 6, semitones: 10, fifths: -2 },
    { value: 'M7', label: 'Settima maggiore', steps: 6, semitones: 11, fifths: 5 },
    { value: 'P8', label: 'Ottava', steps: 7, semitones: 12, fifths: 0 }
];

export const OCTAVE = INTERVALS[INTERVALS.length - 1];

const NATURAL_SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Segni delle direzioni che vanno da una nota a un'altra: si copiano solo con entrambi gli estremi nel passaggio. */
const SPANNERS = ['wedge', 'dashes', 'bracket', 'octave-shift', 'pedal'];
const EPSILON = 1e-6;

// Selezione

/**
 * Passaggio dalla nota di partenza a quella indicata, nella voce della nota di partenza: gli estremi cadono sugli
 * elementi di quella voce e i gruppi irregolari entrano interi. Se copre battute intere vale per tutte le voci.
 */
export function passageBetween(score: ScoreDocument, anchorId: string, focusId: string): Passage {
    const anchor = mainEvent(score, score.note(anchorId));
    const focus = mainEvent(score, score.note(focusId));
    const voice = anchor.event.voice;
    const starts = [startOf(score, anchor), startOf(score, focus)].sort(compare);
    const ends = [endOf(score, anchor), endOf(score, focus)].sort(compare);
    const from = snap(score, voice, starts[0], 'start');
    const to = snap(score, voice, ends[1], 'end');
    return { voice: voiceNumber(voice), from, to, wholeMeasures: toNumber(from.offset) < EPSILON && atMeasureEnd(score, to) };
}

/** Tutta la parte: dal primo all'ultimo elemento della prima voce. */
export function wholePart(score: ScoreDocument): PassageResult {
    const events = score.measures().flatMap((measure) => voiceEvents(score, measure, '1'));
    if (!events.length) throw new EditError('La parte non ha note da selezionare');
    return { anchorId: events[0].notes[0].getAttribute('id'), focusId: events[events.length - 1].notes[0].getAttribute('id') };
}

/**
 * Sposta di un elemento della voce della nota di partenza l'estremo mobile del passaggio, come Maiusc+freccia in
 * MuseScore. Restituisce il nuovo estremo.
 */
export function extendPassage(score: ScoreDocument, anchorId: string, focusId: string | null, delta: 1 | -1): string {
    const voice = voiceOf(score.note(anchorId));
    const sequence = score.measures().flatMap((measure) => voiceEvents(score, measure, voice));
    const focus = mainEvent(score, score.note(focusId ?? anchorId));
    let index = sequence.findIndex((event) => event.notes.includes(focus.event.notes[0]));
    if (index < 0) {
        // L'estremo è in un'altra voce: si parte dall'elemento della voce che inizia con lui o dopo di lui.
        const start = startOf(score, focus);
        index = sequence.findIndex((event) => compare(startOf(score, place(score, event)), start) >= 0);
        if (index < 0) index = sequence.length - 1;
    }
    const next = sequence[Math.max(0, Math.min(sequence.length - 1, index + delta))];
    return next.notes[0].getAttribute('id')!;
}

/** Note, pause e abbellimenti del passaggio, nell'ordine del documento. */
export function passageNotes(score: ScoreDocument, passage: Passage): Element[] {
    return passageEvents(score, passage).flatMap(({ event }) => [...graceNotesBefore(event.notes[0]).reverse(), ...event.notes]);
}

/** Selezione per la barra di stato: «Selezione · battute 3–5 · tutte le voci». */
export function passageLabel(score: ScoreDocument, passage: Passage): string {
    const measures = measureRange(score, passage);
    if (passage.wholeMeasures) return `Selezione · ${measures} · tutte le voci`;
    const count = passageEvents(score, passage).length;
    return `Selezione · ${measures} · voce ${passage.voice} · ${count} ${count === 1 ? 'elemento' : 'elementi'}`;
}

// Copia e incolla

/** Copia il passaggio: la voce selezionata o, per battute intere, tutte le voci. */
export function copyPassage(score: ScoreDocument, passage: Passage): ScoreClip {
    const voices = passage.wholeMeasures ? voicesOf(score, passage) : [String(passage.voice)];
    const drafts = voices.map((voice) => ({ voice: voiceNumber(voice), items: copyVoice(score, passage, voice) }));
    const chords = drafts.flatMap((draft) => draft.items.flatMap((item) => (item.kind === 'tuplet' ? item.members : [item])));
    balance(
        chords.flatMap((chord) => [...chord.graces, ...chord.notes]),
        (note) => children(child(note, 'notations'), 'slur')
    );
    balance(
        chords.flatMap((chord) => chord.directions),
        (direction) => children(direction, 'direction-type').flatMap((type) => children(type).filter((item) => SPANNERS.includes(item.tagName)))
    );
    const serializer = new XMLSerializer();
    const serialize = (chord: DraftChord): ClipChord => ({
        ...chord,
        notes: chord.notes.map((note) => serializer.serializeToString(note)),
        graces: chord.graces.map((note) => serializer.serializeToString(note)),
        directions: chord.directions.filter((direction) => child(direction, 'direction-type')).map((direction) => serializer.serializeToString(direction))
    });
    const clipVoices: ClipVoice[] = drafts.map((draft) => ({
        voice: draft.voice,
        items: draft.items.map((item): ClipItem => (item.kind === 'tuplet' ? { ...item, members: item.members.map(serialize) } : serialize(item)))
    }));
    const notes = chords.filter((chord) => !chord.rest).length;
    const count = passage.to.measureIndex - passage.from.measureIndex + 1;
    return {
        length: distance(score, passage.from, passage.to),
        voices: clipVoices,
        wholeMeasures: passage.wholeMeasures,
        label: passage.wholeMeasures ? `${count} ${count === 1 ? 'battuta' : 'battute'}` : `un passaggio di ${notes} ${notes === 1 ? 'nota' : 'note'}`
    };
}

/**
 * Incolla il passaggio copiato al cursore, nella sua voce, al posto di ciò che c'è per tutta la sua lunghezza, e aggiunge
 * battute alla fine se serve; le battute intere si incollano dall'inizio della battuta, in tutte le voci. Restituisce il
 * passaggio incollato, da selezionare, e il cursore dopo di lui.
 */
export function pastePassage(score: ScoreDocument, clip: ScoreClip, target: WritingCursor): PassageResult {
    if (!score.measures()[target.measureIndex]) throw new EditError('Battuta non trovata');
    const origin: PassagePoint = clip.wholeMeasures ? { measureIndex: target.measureIndex, offset: fraction(0) } : target;
    const intended = currentAlters(score);
    const voices = clip.wholeMeasures ? clip.voices.map((voice) => voice.voice) : [target.voice];
    const touched = new Set<number>();
    for (const voice of voices) for (const index of clearSpan(score, { ...origin, voice }, clip.length)) touched.add(index);
    const start = pointAfter(score, origin, fraction(0));
    if (clip.wholeMeasures) {
        // Le voci della destinazione che il passaggio non ha si svuotano: le battute diventano come quelle copiate.
        const end = endPoint(score, start, clip.length);
        const others = new Set<number>();
        for (let index = start.measureIndex; index <= end.measureIndex; index++) for (const event of score.events(score.measure(index))) others.add(voiceNumber(event.voice));
        for (const voice of others) if (!voices.includes(voice)) for (const index of clearSpan(score, { ...start, voice }, clip.length)) touched.add(index);
    }
    clip.voices.forEach((clipVoice, index) => {
        const voice = voices[index];
        let previous: Written | null = null;
        for (const item of clipVoice.items) {
            if (item.kind === 'tuplet') {
                try {
                    writeTuplet(score, { ...pointAfter(score, start, item.offset), voice }, item.figure, item.actual);
                } catch (error) {
                    if (error instanceof EditError) throw new EditError(`Un gruppo irregolare del passaggio non entra nella battuta di arrivo: ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}`);
                    throw error;
                }
                for (const member of item.members) previous = pasteChord(score, start, voice, member, previous, intended);
            } else {
                previous = pasteChord(score, start, voice, item, previous, intended);
            }
        }
    });
    const end = endPoint(score, start, clip.length);
    for (let index = start.measureIndex; index <= end.measureIndex; index++) touched.add(index);
    keepAlters(score, intended, touched);
    finish(score, [...touched]);
    const voice = clip.wholeMeasures ? 1 : target.voice;
    return {
        anchorId: noteAtCursor(score, { ...start, voice }),
        focusId: eventBefore(score, { ...end, voice })?.notes[0].getAttribute('id') ?? null,
        cursor: { ...pointAfter(score, start, clip.length), voice: target.voice }
    };
}

/** Ripete il passaggio subito dopo di lui, come il tasto R di MuseScore. */
export function repeatPassage(score: ScoreDocument, passage: Passage): PassageResult {
    const clip = copyPassage(score, passage);
    if (!passage.wholeMeasures) return pastePassage(score, clip, { ...passage.to, voice: passage.voice });
    const next = passage.to.measureIndex + 1;
    if (next >= score.measures().length) insertMeasure(score, passage.to.measureIndex, 'after');
    return pastePassage(score, clip, { measureIndex: next, voice: 1, offset: fraction(0) });
}

/**
 * Cancella il passaggio: le note diventano pause, come cancellando una nota nella scrittura, e le battute intere tornano
 * pause di battuta. Restituisce l'elemento da selezionare all'inizio del passaggio.
 */
export function clearPassage(score: ScoreDocument, passage: Passage): string | null {
    const intended = currentAlters(score);
    const voices = passage.wholeMeasures ? voicesOf(score, passage) : [String(passage.voice)];
    const length = distance(score, passage.from, passage.to);
    const touched = new Set<number>();
    for (const voice of voices) for (const index of clearSpan(score, { ...passage.from, voice: voiceNumber(voice) }, length)) touched.add(index);
    keepAlters(score, intended, touched);
    finish(score, [...touched]);
    return noteAtCursor(score, { ...passage.from, voice: passage.wholeMeasures ? 1 : passage.voice });
}

// Trasposizione

/**
 * Traspone le note del passaggio, o di tutta la parte con `null`, dell'intervallo indicato verso l'alto o verso il basso,
 * con le note legate a loro. Tutta la parte traspone anche le armature. Gli accidenti si ricalcolano.
 */
export function transposePassage(score: ScoreDocument, passage: Passage | null, interval: TranspositionInterval, direction: 1 | -1): void {
    const targets = pitchedNotes(score, passage);
    if (!targets.length) throw new EditError(passage ? 'Il passaggio non ha note da trasporre' : 'La parte non ha note da trasporre');
    const intended = currentAlters(score);
    if (!passage) transposeKeys(score, interval, direction);
    for (const note of targets) {
        const pitch = pitchOf(note)!;
        const next = transposedPitch(pitch.step, pitch.octave, pitch.alter, interval, direction);
        writePitch(note, next.step, next.octave);
        setAccidental(note, null);
        intended.set(note, next.alter);
    }
    const measures = passage ? measuresOf(score, targets) : score.measures().map((_, index) => index);
    keepAlters(score, intended, measures);
    finish(score, measures);
}

/**
 * Sposta le note del passaggio di gradi della scala, come le frecce su una nota sola: le note di arrivo seguono
 * l'armatura e quelle non toccate della battuta conservano la loro altezza.
 */
export function shiftPassage(score: ScoreDocument, passage: Passage, steps: number): void {
    const targets = withTies(
        score,
        passageNotes(score, passage).filter((note) => !isRest(note) && pitchOf(note))
    );
    if (!targets.length) throw new EditError('Il passaggio non ha note da spostare');
    const states = score.measureStates();
    const intended = currentAlters(score);
    for (const note of targets) {
        const pitch = pitchOf(note)!;
        const next = fromDiatonic(diatonic(pitch.step, pitch.octave) + steps);
        if (next.octave < 0 || next.octave > 9) throw new EditError('Altezza fuori estensione');
        writePitch(note, next.step, next.octave);
        if (pitch.unpitched) continue;
        setAccidental(note, null);
        intended.set(note, keyAlter(states[score.measureIndex(score.measureOf(note))].fifths, next.step));
    }
    const measures = measuresOf(score, targets);
    keepAlters(score, intended, measures);
    finish(score, measures);
}

/** Nota di arrivo della trasposizione; le alterazioni oltre il doppio diesis o il doppio bemolle sono rifiutate. */
export function transposedPitch(step: Step, octave: number, alter: number, interval: TranspositionInterval, direction: 1 | -1): { step: Step; octave: number; alter: number } {
    const target = fromDiatonic(diatonic(step, octave) + direction * interval.steps);
    const semitones = 12 * octave + NATURAL_SEMITONES[step] + alter + direction * interval.semitones;
    const nextAlter = semitones - (12 * target.octave + NATURAL_SEMITONES[target.step]);
    if (target.octave < 0 || target.octave > 9) throw new EditError('Altezza fuori estensione');
    if (Math.abs(nextAlter) > 2) throw new EditError("La trasposizione darebbe note con più di due alterazioni: scegli l'intervallo enarmonico");
    return { step: target.step, octave: target.octave, alter: nextAlter };
}

// Funzioni interne

interface PlacedEvent {
    event: NoteEvent;
    measureIndex: number;
}

/** Accordo copiato con i nodi ancora da serializzare, dopo aver tolto i segni rimasti aperti. */
interface DraftChord extends Omit<ClipChord, 'notes' | 'graces' | 'directions'> {
    notes: Element[];
    graces: Element[];
    directions: Element[];
}

interface DraftTuplet extends Omit<ClipTuplet, 'members'> {
    members: DraftChord[];
}

/** Ultimo pezzo scritto di un accordo incollato, per legarlo al seguente. */
interface Written {
    chord: ClipChord;
    notes: Element[];
}

function place(score: ScoreDocument, event: NoteEvent): PlacedEvent {
    return { event, measureIndex: score.measureIndex(score.measureOf(event.notes[0])) };
}

/** L'elemento a cui appartiene la nota: per un abbellimento, la nota che lo segue. */
function mainEvent(score: ScoreDocument, note: Element): PlacedEvent {
    let target: Element | null = note;
    while (target && target.tagName === 'note' && child(target, 'grace')) target = target.nextElementSibling;
    return place(score, score.eventOf(target && target.tagName === 'note' && voiceOf(target) === voiceOf(note) ? target : note));
}

function startOf(score: ScoreDocument, placed: PlacedEvent): PassagePoint {
    return { measureIndex: placed.measureIndex, offset: fraction(placed.event.start, score.stateAt(placed.measureIndex).divisions) };
}

function endOf(score: ScoreDocument, placed: PlacedEvent): PassagePoint {
    return { measureIndex: placed.measureIndex, offset: fraction(placed.event.start + placed.event.duration, score.stateAt(placed.measureIndex).divisions) };
}

function compare(left: PassagePoint, right: PassagePoint): number {
    if (left.measureIndex !== right.measureIndex) return left.measureIndex - right.measureIndex;
    const difference = toNumber(left.offset) - toNumber(right.offset);
    return Math.abs(difference) < 1e-9 ? 0 : Math.sign(difference);
}

function positionOf(score: ScoreDocument, point: PassagePoint): number {
    return toNumber(point.offset) * score.stateAt(point.measureIndex).divisions;
}

function lengthOf(score: ScoreDocument, index: number): Fraction {
    return fraction(Math.round(measureLength(score, index)), score.stateAt(index).divisions);
}

function atMeasureEnd(score: ScoreDocument, point: PassagePoint): boolean {
    return positionOf(score, point) >= measureLength(score, point.measureIndex) - EPSILON;
}

/** Porta un estremo sull'inizio o sulla fine dell'elemento della voce che lo contiene, fuori dai gruppi irregolari. */
function snap(score: ScoreDocument, voice: string, point: PassagePoint, side: 'start' | 'end'): PassagePoint {
    const measure = score.measure(point.measureIndex);
    const position = positionOf(score, point);
    const events = voiceEvents(score, measure, voice);
    const groups = tupletGroups(events);
    let value: number;
    if (side === 'start') {
        const containing = events.find((event) => event.start <= position + EPSILON && position < event.start + event.duration - EPSILON);
        value = containing ? containing.start : 0;
        value = groups.find((group) => group.start < value - EPSILON && value < group.end - EPSILON)?.start ?? value;
    } else {
        const containing = events.find((event) => event.start < position - EPSILON && position <= event.start + event.duration + EPSILON);
        value = containing ? containing.start + containing.duration : measureLength(score, point.measureIndex);
        value = groups.find((group) => group.start < value - EPSILON && value < group.end - EPSILON)?.end ?? value;
    }
    return { measureIndex: point.measureIndex, offset: fraction(Math.round(value), score.stateAt(point.measureIndex).divisions) };
}

/** Elementi del passaggio, senza abbellimenti, battuta per battuta. */
function passageEvents(score: ScoreDocument, passage: Passage): PlacedEvent[] {
    const result: PlacedEvent[] = [];
    for (let index = passage.from.measureIndex; index <= passage.to.measureIndex; index++) {
        const [low, high] = bounds(score, passage, index);
        for (const event of score.events(score.measure(index))) {
            if (event.duration <= 0 || (!passage.wholeMeasures && event.voice !== String(passage.voice))) continue;
            if (event.start >= low - EPSILON && event.start < high - EPSILON) result.push({ event, measureIndex: index });
        }
    }
    return result;
}

/** Inizio e fine del passaggio nella battuta indicata, in divisioni. */
function bounds(score: ScoreDocument, passage: Passage, index: number): [number, number] {
    const low = index === passage.from.measureIndex ? positionOf(score, passage.from) : 0;
    const high = index === passage.to.measureIndex ? positionOf(score, passage.to) : measureLength(score, index);
    return [low, high];
}

function voicesOf(score: ScoreDocument, passage: Passage): string[] {
    const voices = new Set<string>(passageEvents(score, passage).map(({ event }) => event.voice));
    return [...voices].sort();
}

function measureRange(score: ScoreDocument, passage: Passage): string {
    const numbers = [passage.from.measureIndex, passage.to.measureIndex].map((index) => score.measure(index).getAttribute('number') ?? String(index + 1));
    return numbers[0] === numbers[1] ? `battuta ${numbers[0]}` : `battute ${numbers[0]}–${numbers[1]}`;
}

/** Semiminime da un punto all'altro della parte. */
function distance(score: ScoreDocument, from: PassagePoint, to: PassagePoint): Fraction {
    let total = minus(to.offset, from.offset);
    for (let index = from.measureIndex; index < to.measureIndex; index++) total = plus(total, lengthOf(score, index));
    return total;
}

/** Punto a `quarters` semiminime dal punto indicato; la fine di una battuta è l'inizio della seguente, se esiste. */
function pointAfter(score: ScoreDocument, from: PassagePoint, quarters: Fraction): PassagePoint {
    return walk(score, from, quarters, false);
}

/** Come `pointAfter`, ma la fine di una battuta resta nella battuta: è l'estremo escluso di un passaggio. */
function endPoint(score: ScoreDocument, from: PassagePoint, quarters: Fraction): PassagePoint {
    return walk(score, from, quarters, true);
}

function walk(score: ScoreDocument, from: PassagePoint, quarters: Fraction, keepEnd: boolean): PassagePoint {
    let measureIndex = from.measureIndex;
    let offset = plus(from.offset, quarters);
    for (;;) {
        const length = toNumber(lengthOf(score, measureIndex));
        const inside = keepEnd ? toNumber(offset) <= length + 1e-9 : toNumber(offset) < length - 1e-9;
        if (inside || measureIndex + 1 >= score.measures().length) return { measureIndex, offset };
        offset = minus(offset, lengthOf(score, measureIndex));
        measureIndex++;
    }
}

/** Copia gli elementi di una voce del passaggio: note e accordi, gruppi irregolari interi, pause con dinamiche. */
function copyVoice(score: ScoreDocument, passage: Passage, voice: string): (DraftChord | DraftTuplet)[] {
    const items: (DraftChord | DraftTuplet)[] = [];
    const chords: DraftChord[] = [];
    for (let index = passage.from.measureIndex; index <= passage.to.measureIndex; index++) {
        const divisions = score.stateAt(index).divisions;
        const base = distance(score, passage.from, { measureIndex: index, offset: fraction(0) });
        const [low, high] = bounds(score, passage, index);
        const all = voiceEvents(score, score.measure(index), voice);
        const groups = tupletGroups(all);
        const offsetOf = (position: number) => plus(base, fraction(Math.round(position), divisions));
        const done = new Set<NoteEvent>();
        for (const event of all.filter((candidate) => candidate.start >= low - EPSILON && candidate.start < high - EPSILON)) {
            if (done.has(event)) continue;
            const group = groups.find((candidate) => candidate.events.includes(event));
            if (group) {
                if (group.start < low - EPSILON || group.end > high + EPSILON) throw new EditError('Il passaggio contiene solo una parte di un gruppo irregolare');
                const tuplet = copyTuplet(score, group, divisions, offsetOf);
                for (const member of group.events) done.add(member);
                items.push(tuplet);
                chords.push(...tuplet.members);
                continue;
            }
            const chord = copyChord(score, event, offsetOf(event.start), fraction(event.duration, divisions));
            if (chord) {
                items.push(chord);
                chords.push(chord);
            }
        }
    }
    // Una legatura di valore resta solo verso l'accordo che segue subito nel passaggio.
    chords.forEach((chord, index) => {
        const next = chords[index + 1];
        chord.tieNext = chord.tieNext && !chord.rest && !!next && !next.rest && Math.abs(toNumber(plus(chord.offset, chord.length)) - toNumber(next.offset)) < 1e-9;
    });
    return items;
}

/** Gruppo irregolare copiato, se l'editor sa riscriverlo come lo crea: terzina, quintina e sestina di una figura senza punti. */
function copyTuplet(score: ScoreDocument, group: TupletGroup, divisions: number, offsetOf: (position: number) => Fraction): DraftTuplet {
    const option = TUPLETS.find((candidate) => candidate.actual === group.ratio.actual && candidate.normal === group.ratio.normal);
    const total = inferType((group.end - group.start) / divisions);
    const member = total && !total.dots ? inferType(toNumber(noteQuarters(total.type, 0)) / group.ratio.normal) : null;
    if (!option || !total || total.dots || !member || member.dots) throw new EditError("Il passaggio contiene un gruppo irregolare che l'editor non sa riscrivere");
    const members = group.events.map((event) => copyChord(score, event, offsetOf(event.start), fraction(event.duration, divisions))).filter((chord): chord is DraftChord => chord !== null);
    return { kind: 'tuplet', offset: offsetOf(group.start), figure: { type: total.type, dots: 0 }, actual: group.ratio.actual, members };
}

/** Copia di un accordo, con abbellimenti e dinamiche; `null` per una pausa senza dinamiche, che l'incolla rifà da sé. */
function copyChord(score: ScoreDocument, event: NoteEvent, offset: Fraction, length: Fraction): DraftChord | null {
    const first = event.notes[0];
    const rest = isRest(first);
    const directions = noteDirections(first).map((direction) => {
        const copy = direction.cloneNode(true) as Element;
        copy.removeAttribute('id');
        removeChildren(copy, 'offset');
        return copy;
    });
    if (rest && !directions.length) return null;
    const figure = figureOf(score, first);
    if (!figure) throw new EditError('Una nota del passaggio non ha figura: indicala prima di copiare');
    return {
        kind: 'chord',
        offset,
        length,
        figure,
        rest,
        notes: event.notes.map(cleanCopy),
        graces: graceNotesBefore(first).reverse().map(cleanCopy),
        directions,
        tieNext: event.notes.some((note) => hasTie(note, 'start'))
    };
}

/** Copia di una nota senza `id`, legature di valore, travature e parentesi dei gruppi, che l'incolla rifà. */
function cleanCopy(note: Element): Element {
    const copy = note.cloneNode(true) as Element;
    copy.removeAttribute('id');
    for (const name of ['tie', 'beam', 'stem']) removeChildren(copy, name);
    const notations = child(copy, 'notations');
    for (const item of children(notations)) if (item.tagName === 'tied' || item.tagName === 'tuplet') item.remove();
    removeIfEmpty(notations);
    return copy;
}

/** Toglie i segni con un solo estremo nel passaggio, come legature di portamento e forcelle iniziate o finite fuori. */
function balance(owners: Element[], marks: (owner: Element) => Element[]): void {
    const open = new Map<string, Element[]>();
    for (const owner of owners) {
        for (const mark of marks(owner)) {
            const number = mark.getAttribute('number') ?? '1';
            const type = mark.getAttribute('type') ?? '';
            if (type === 'continue' || type === 'change') continue;
            const stack = open.get(number) ?? [];
            if (type !== 'stop') open.set(number, [...stack, mark]);
            else if (stack.length) stack.pop();
            else removeMark(mark);
        }
    }
    for (const stack of open.values()) for (const mark of stack) removeMark(mark);
}

function removeMark(mark: Element): void {
    const parent = mark.parentElement;
    mark.remove();
    removeIfEmpty(parent);
}

/** Incolla un accordo al suo istante, legato al precedente se lo era nel passaggio copiato. */
function pasteChord(score: ScoreDocument, start: PassagePoint, voice: number, chord: ClipChord, previous: Written | null, intended: Map<Element, number>): Written {
    const at: WritingCursor = { ...pointAfter(score, start, chord.offset), voice };
    const templates = chord.notes.map((xml) => imported(score, xml, voice));
    const tieFrom = previous?.chord.tieNext ? previous.notes : undefined;
    const result = writeContent(score, at, chord.figure, templates, tieFrom);
    const written = score.eventOf(score.note(result.noteId)).notes;
    written.forEach((note, index) => {
        const template = templates[index];
        if (!template) return;
        // Una nota legata alla precedente si scrive come continuazione, senza segni: le legature di portamento si rimettono.
        const slurs = tieFrom ? children(child(template, 'notations'), 'slur') : [];
        if (slurs.length) {
            const notations = ensureChild(note, 'notations', NOTE_ORDER);
            for (const slur of slurs) notations.appendChild(slur.cloneNode(true));
        }
        const pitch = pitchOf(template);
        if (pitch && !pitch.unpitched && !tieFrom) intended.set(note, pitch.alter);
    });
    let anchor: Element = written[0];
    for (const xml of [...chord.graces].reverse()) {
        const grace = imported(score, xml, voice);
        grace.setAttribute('id', score.newId('n'));
        anchor.before(grace);
        anchor = grace;
        const pitch = pitchOf(grace);
        if (pitch && !pitch.unpitched) intended.set(grace, pitch.alter);
    }
    for (const xml of [...chord.directions].reverse()) {
        const direction = imported(score, xml, voice);
        anchor.before(direction);
        anchor = direction;
    }
    return { chord, notes: eventBefore(score, result.cursor)?.notes ?? written };
}

/** Frammento MusicXML del passaggio copiato, portato nel documento con la voce di destinazione. */
function imported(score: ScoreDocument, xml: string, voice: number): Element {
    const node = score.document.importNode(new DOMParser().parseFromString(xml, 'application/xml').documentElement, true) as Element;
    if (node.tagName === 'note') setChildText(node, 'voice', voice, NOTE_ORDER);
    else if (child(node, 'voice')) setChildText(node, 'voice', voice, DIRECTION_ORDER);
    return node;
}

/** Alterazione di ogni nota intonata, prima di una modifica: le note non toccate la conservano. */
function currentAlters(score: ScoreDocument): Map<Element, number> {
    const result = new Map<Element, number>();
    for (const note of score.notes()) {
        const pitch = pitchOf(note);
        if (pitch && !pitch.unpitched && !isRest(note)) result.set(note, pitch.alter);
    }
    return result;
}

/** Riporta le note all'altezza prevista e scrive gli accidenti che servono nelle battute indicate. */
function keepAlters(score: ScoreDocument, intended: Map<Element, number>, measureIndexes: Iterable<number>): void {
    for (const [note, alter] of intended) if (score.part.contains(note)) setAlter(note, alter);
    makeAccidentalsExplicit(score, measureIndexes);
}

function pitchedNotes(score: ScoreDocument, passage: Passage | null): Element[] {
    const notes = passage ? passageNotes(score, passage) : score.notes();
    return withTies(
        score,
        notes.filter((note) => {
            const pitch = pitchOf(note);
            return !isRest(note) && !!pitch && !pitch.unpitched;
        })
    );
}

/** Le note con quelle legate a loro, anche fuori dal passaggio, perché la legatura resti tra note uguali. */
function withTies(score: ScoreDocument, notes: Element[]): Element[] {
    const result = new Set<Element>();
    for (const note of notes) {
        if (result.has(note)) continue;
        for (const linked of child(note, 'grace') ? [note] : tieChain(score, note)) result.add(linked);
    }
    return [...result];
}

function measuresOf(score: ScoreDocument, notes: Element[]): number[] {
    return [...new Set(notes.map((note) => score.measureIndex(score.measureOf(note))))];
}

/** Armature della parte spostate dell'intervallo; oltre sette alterazioni si chiede l'intervallo enarmonico. */
function transposeKeys(score: ScoreDocument, interval: TranspositionInterval, direction: 1 | -1): void {
    for (const measure of score.measures()) {
        for (const attributes of children(measure, 'attributes')) {
            for (const key of children(attributes, 'key')) {
                const fifths = integer(child(key, 'fifths'));
                if (fifths === null) continue;
                const next = fifths + direction * interval.fifths;
                if (Math.abs(next) > 7) throw new EditError(`La tonalità di arrivo avrebbe ${Math.abs(next)} ${next > 0 ? 'diesis' : 'bemolli'}: scegli l'intervallo enarmonico`);
                child(key, 'fifths')!.textContent = String(next);
            }
        }
    }
}

function voiceNumber(voice: string): number {
    const value = Number.parseInt(voice, 10);
    return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1;
}
