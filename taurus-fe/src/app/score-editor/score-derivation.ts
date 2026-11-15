/**
 * Parte ricavata da un'altra per uno strumento diverso: l'intervallo scritto che mantiene il suono, le ottave possibili
 * con le note fuori estensione, l'ottava proposta e il MusicXML della parte nuova. Il controllo dell'estensione è lo
 * stesso degli editor di scrittura e di correzione.
 */

import { fifthsShift } from './new-part';
import { ATTRIBUTES_ORDER, child, children, element, insertOrdered, integer } from './musicxml-dom';
import { CLEF_OPTIONS, ClefSpec, clefValue, diatonic, fromDiatonic, KEY_OPTIONS, Step } from './notation-rules';
import { EditError, isRest, pitchOf, ScoreDocument } from './score-document';
import { openScore } from './score-edits';
import { keyLabel, keyOf } from './score-input';
import { transposePassage, TranspositionInterval } from './score-passage';

/** Trasposizioni ed estensione di uno strumento, come le restituisce il backend. */
export interface RangeInstrument {
    transpositionSemitones?: number | null;
    bassClefTranspositionSemitones?: number | null;
    lowestWrittenPitch?: number | null;
    highestWrittenPitch?: number | null;
}

/** Estensione scritta di una parte, in numeri di nota MIDI. */
export interface WrittenRange {
    lowest: number;
    highest: number;
}

/** Intervallo con segno: positivo verso l'alto. */
export interface DerivationInterval {
    steps: number;
    semitones: number;
    fifths: number;
}

/** Una delle ottave della derivazione, da due sotto a due sopra il suono della parte di origine. */
export interface DerivationOctave {
    octave: number;
    interval: DerivationInterval;
    label: string;
    /** Nessuna nota esce dalle altezze che il MusicXML sa scrivere. */
    possible: boolean;
    /** Note fuori estensione; `null` senza estensione. */
    outOfRange: number | null;
    /** Numeri delle battute con note fuori estensione. */
    measures: string[];
}

export interface DerivationPlan {
    sourceTransposition: number;
    targetTransposition: number;
    /** L'intervallo diretto darebbe armature o note impossibili: si usa quello enarmonico. */
    enharmonic: boolean;
    /** La parte non si può ricavare con nessuna grafia; `null` se si può. */
    error: string | null;
    range: WrittenRange | null;
    octaves: DerivationOctave[];
    /** Ottava proposta; `null` se nessuna è possibile. */
    proposed: number | null;
    /** Armatura iniziale della parte nuova, da -7 a 7; `null` se la parte non ne ha. */
    fifths: number | null;
}

/** Nota fuori estensione in un editor: la battuta e la prima nota fuori estensione che contiene. */
export interface RangeWarning {
    measureIndex: number;
    measureNumber: string;
    noteId: string;
}

export const DERIVATION_OCTAVES = [-2, -1, 0, 1, 2] as const;

const DEGREES = ['Unisono', 'Seconda', 'Terza', 'Quarta', 'Quinta', 'Sesta', 'Settima'];
/** Semitoni dell'intervallo giusto (unisono, quarta, quinta) o maggiore, per grado. */
const REFERENCE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const PERFECT = [0, 3, 4];
const NATURAL: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ENHARMONIC_ERROR = "L'armatura o le note della parte nuova avrebbero troppe alterazioni anche con l'intervallo enarmonico";

/**
 * Estensione scritta dello strumento per una parte che inizia con la chiave indicata: in chiave di Fa, con una
 * trasposizione in chiave di basso diversa, si sposta della differenza tra le due. `null` senza estensione o trasposizione.
 */
export function writtenRange(instrument: RangeInstrument | null | undefined, clefSign: string): WrittenRange | null {
    const lowest = instrument?.lowestWrittenPitch;
    const highest = instrument?.highestWrittenPitch;
    const transposition = instrument?.transpositionSemitones;
    if (lowest === null || lowest === undefined || highest === null || highest === undefined || transposition === null || transposition === undefined) return null;
    const bass = instrument?.bassClefTranspositionSemitones;
    const shift = clefSign === 'F' && bass !== null && bass !== undefined ? transposition - bass : 0;
    return { lowest: lowest + shift, highest: highest + shift };
}

/** Estensione con i nomi delle note: «Si♭3–Fa6». */
export function rangeLabel(range: WrittenRange): string {
    return `${keyLabel(range.lowest)}–${keyLabel(range.highest)}`;
}

/** Trasposizione di uno strumento per una parte che inizia con la chiave indicata, come nell'ascolto; `null` se manca. */
export function clefTransposition(instrument: RangeInstrument, clefSign: string): number | null {
    const bass = instrument.bassClefTranspositionSemitones;
    if (clefSign === 'F' && bass !== null && bass !== undefined) return bass;
    return instrument.transpositionSemitones ?? null;
}

/** Chiave iniziale della parte, come valore di `CLEF_OPTIONS`; violino se non si riconosce. */
export function initialClef(score: ScoreDocument): string {
    return clefValue(score.stateAt(0).clef) ?? 'G2';
}

/**
 * Calcola la derivazione di una parte: l'intervallo dalla trasposizione della parte di origine a quella dello strumento
 * di destinazione nella chiave scelta, la grafia e, per ogni ottava, le note fuori estensione.
 */
export function planDerivation(score: ScoreDocument, sourceTransposition: number, target: RangeInstrument, clef: string): DerivationPlan {
    const clefSign = clefSpec(clef).sign;
    const targetTransposition = clefTransposition(target, clefSign) ?? 0;
    const range = writtenRange(target, clefSign);
    const semitones = sourceTransposition - targetTransposition;
    const notes = pitchedNotes(score);
    const keys = keySignatures(score);
    const candidates = spellings(fifthsShift(sourceTransposition) - fifthsShift(targetTransposition));
    const spelling = candidates.find((fifths) => spells(notes, keys, fifths, semitones));
    const firstKey = keys.length ? keys[0] : null;
    if (spelling === undefined) {
        return { sourceTransposition, targetTransposition, enharmonic: false, error: ENHARMONIC_ERROR, range, octaves: [], proposed: null, fifths: null };
    }
    const octaves = DERIVATION_OCTAVES.map((octave) => octaveOf(score, notes, range, spelling, semitones + 12 * octave, octave));
    return {
        sourceTransposition,
        targetTransposition,
        enharmonic: spelling !== candidates[0],
        error: null,
        range,
        octaves,
        proposed: proposedOctave(octaves, notes, range, semitones),
        fifths: firstKey === null ? null : firstKey + spelling
    };
}

/** Armatura con la tonalità maggiore: «1 diesis (Sol maggiore)». */
export function fifthsLabel(fifths: number): string {
    return KEY_OPTIONS.find((option) => option.value === fifths)?.label ?? `${fifths}`;
}

/**
 * MusicXML della parte nuova: la parte traspone dell'intervallo dell'ottava scelta, cambia chiave se diversa da quella
 * iniziale, prende il nome della parte nuova e perde le indicazioni `<transpose>` e gli strumenti MIDI di origine.
 */
export function derivedPartXml(xml: string, sourceTransposition: number, target: RangeInstrument, clef: string, octave: number, partName: string): string {
    const score = openScore(xml);
    const plan = planDerivation(score, sourceTransposition, target, clef);
    if (plan.error) throw new EditError(plan.error);
    const chosen = plan.octaves.find((candidate) => candidate.octave === octave);
    if (!chosen?.possible) throw new EditError("L'ottava scelta darebbe note fuori dalle altezze scrivibili");
    const { steps, semitones, fifths } = chosen.interval;
    if (steps !== 0 || semitones !== 0 || fifths !== 0) {
        // L'intervallo con segno si applica verso l'alto: gradi e semitoni negativi scendono.
        const interval: TranspositionInterval = { value: 'derivation', label: chosen.label, steps, semitones, fifths };
        if (pitchedNotes(score).length) transposePassage(score, null, interval, 1);
        else transposeKeys(score, fifths);
    }
    if (clef !== initialClef(score)) replaceClefs(score, clefSpec(clef));
    renamePart(score, partName);
    removeSourceInstruments(score);
    return score.cleanXml();
}

/**
 * Battute con note scritte fuori dall'estensione, con la prima nota fuori estensione di ognuna. Le note legate a una
 * precedente non contano: sono la stessa nota.
 */
export function rangeWarnings(score: ScoreDocument, range: WrittenRange | null): RangeWarning[] {
    if (!range) return [];
    const warnings: RangeWarning[] = [];
    score.measures().forEach((measure, measureIndex) => {
        const note = children(measure, 'note').find((candidate) => {
            const key = writtenKey(candidate);
            return key !== null && !continuesTie(candidate) && (key < range.lowest || key > range.highest);
        });
        if (note) warnings.push({ measureIndex, measureNumber: measure.getAttribute('number') ?? String(measureIndex + 1), noteId: note.getAttribute('id') ?? '' });
    });
    return warnings;
}

/** Descrizione dell'intervallo: «Quinta giusta sopra», «Quarta giusta e un'ottava sotto», «Unisono». */
export function intervalLabel(interval: DerivationInterval): string {
    const down = interval.semitones < 0 || (interval.semitones === 0 && interval.steps < 0);
    const steps = Math.abs(interval.steps);
    const semitones = Math.abs(interval.semitones);
    if (steps === 0 && semitones === 0) return 'Unisono';
    let octaves = Math.floor(steps / 7);
    const degree = steps % 7;
    let reference = REFERENCE_SEMITONES[degree];
    let name = DEGREES[degree];
    const direction = down ? 'sotto' : 'sopra';
    if (degree === 0 && octaves > 0) {
        if (semitones === 12 * octaves) return `${octaves === 1 ? 'Ottava' : `${octaves} ottave`} ${direction}`;
        octaves--;
        reference = 12;
        name = 'Ottava';
    }
    const difference = semitones - 12 * octaves - reference;
    const masculine = name === 'Unisono';
    const quality = PERFECT.includes(degree) || name === 'Ottava' ? perfectQuality(difference, masculine) : imperfectQuality(difference);
    const compound = octaves === 0 ? '' : octaves === 1 ? " e un'ottava" : ` e ${octaves} ottave`;
    return `${name}${quality ? ` ${quality}` : ''}${compound} ${direction}`;
}

// Funzioni interne

interface WrittenNote {
    step: Step;
    octave: number;
    alter: number;
    key: number;
    measureIndex: number;
    /** Continua una nota legata: non si conta tra le note fuori estensione. */
    tied: boolean;
}

function clefSpec(clef: string): ClefSpec {
    return (CLEF_OPTIONS.find((option) => option.value === clef) ?? CLEF_OPTIONS[0]).clef;
}

function pitchedNotes(score: ScoreDocument): WrittenNote[] {
    const notes: WrittenNote[] = [];
    score.measures().forEach((measure, measureIndex) => {
        for (const note of children(measure, 'note')) {
            const pitch = pitchOf(note);
            if (!pitch || pitch.unpitched || isRest(note)) continue;
            notes.push({ ...pitch, key: keyOf(pitch), measureIndex, tied: continuesTie(note) });
        }
    });
    return notes;
}

function keySignatures(score: ScoreDocument): number[] {
    const result: number[] = [];
    for (const measure of score.measures()) {
        for (const attributes of children(measure, 'attributes')) {
            for (const key of children(attributes, 'key')) {
                const fifths = integer(child(key, 'fifths'));
                if (fifths !== null) result.push(fifths);
            }
        }
    }
    return result;
}

/** Grafie dell'intervallo, dalla più semplice: la differenza tra le tonalità e la sua enarmonica. */
function spellings(fifths: number): number[] {
    const primary = fifths > 6 ? fifths - 12 : fifths < -6 ? fifths + 12 : fifths;
    const alternatives = [primary - 12, primary + 12].sort((left, right) => Math.abs(left) - Math.abs(right));
    return [primary, ...alternatives];
}

/** La grafia non porta armature oltre sette alterazioni né note oltre due; non dipende dall'ottava. */
function spells(notes: WrittenNote[], keys: number[], fifths: number, semitones: number): boolean {
    if (keys.some((key) => Math.abs(key + fifths) > 7)) return false;
    const interval = intervalOf(fifths, semitones);
    return notes.every((note) => Math.abs(transposed(note, interval).alter) <= 2);
}

/** L'intervallo di `semitones` con la grafia data dallo spostamento dell'armatura: quinte e ottave. */
function intervalOf(fifths: number, semitones: number): DerivationInterval {
    const octaves = (semitones - 7 * fifths) / 12;
    return { steps: 4 * fifths + 7 * octaves, semitones, fifths };
}

function transposed(note: WrittenNote, interval: DerivationInterval): { octave: number; alter: number } {
    const target = fromDiatonic(diatonic(note.step, note.octave) + interval.steps);
    const alter = note.key + interval.semitones - (12 * (target.octave + 1) + NATURAL[target.step]);
    return { octave: target.octave, alter };
}

function octaveOf(score: ScoreDocument, notes: WrittenNote[], range: WrittenRange | null, fifths: number, semitones: number, octave: number): DerivationOctave {
    const interval = intervalOf(fifths, semitones);
    const possible = notes.every((note) => {
        const target = transposed(note, interval);
        return target.octave >= 0 && target.octave <= 9 && note.key + semitones >= 0 && note.key + semitones <= 127;
    });
    const outside = range ? notes.filter((note) => !note.tied && (note.key + semitones < range.lowest || note.key + semitones > range.highest)) : [];
    const measures = Array.from(new Set(outside.map((note) => note.measureIndex))).map((index) => score.measures()[index].getAttribute('number') ?? String(index + 1));
    return { octave, interval, label: intervalLabel(interval), possible, outOfRange: range ? outside.length : null, measures };
}

/**
 * Tra le ottave possibili, quella con meno note fuori estensione; a parità la più vicina al suono di origine e poi quella
 * con le note più vicine al centro dell'estensione. Senza estensione il suono di origine, se possibile.
 */
function proposedOctave(octaves: DerivationOctave[], notes: WrittenNote[], range: WrittenRange | null, semitones: number): number | null {
    const possible = octaves.filter((candidate) => candidate.possible);
    if (!possible.length) return null;
    const center = range ? (range.lowest + range.highest) / 2 : 0;
    const distance = (octave: number) => (range ? notes.reduce((sum, note) => sum + Math.abs(note.key + semitones + 12 * octave - center), 0) : 0);
    const sorted = [...possible].sort((left, right) => (left.outOfRange ?? 0) - (right.outOfRange ?? 0) || Math.abs(left.octave) - Math.abs(right.octave) || distance(left.octave) - distance(right.octave));
    return sorted[0].octave;
}

function transposeKeys(score: ScoreDocument, fifths: number): void {
    for (const measure of score.measures()) {
        for (const attributes of children(measure, 'attributes')) {
            for (const key of children(attributes, 'key')) {
                const current = child(key, 'fifths');
                const value = integer(current);
                if (current && value !== null) current.textContent = String(value + fifths);
            }
        }
    }
}

/** Sostituisce tutte le chiavi della parte, o scrive quella iniziale se la parte non ne ha. */
function replaceClefs(score: ScoreDocument, clef: ClefSpec): void {
    const clefs = score.measures().flatMap((measure) =>
        children(measure)
            .filter((item) => item.tagName === 'attributes')
            .flatMap((attributes) => children(attributes, 'clef'))
    );
    for (const current of clefs) writeClef(score.document, current, clef);
    if (clefs.length) return;
    const first = score.measures()[0];
    if (!first) return;
    let attributes = child(first, 'attributes');
    if (!attributes) {
        attributes = element(score.document, 'attributes');
        first.insertBefore(attributes, first.firstChild);
    }
    insertOrdered(attributes, writeClef(score.document, element(score.document, 'clef'), clef), ATTRIBUTES_ORDER);
}

function writeClef(document: Document, target: Element, clef: ClefSpec): Element {
    while (target.firstChild) target.removeChild(target.firstChild);
    target.append(element(document, 'sign', clef.sign));
    if (clef.sign !== 'percussion') target.append(element(document, 'line', clef.line));
    if (clef.octaveChange) target.append(element(document, 'clef-octave-change', clef.octaveChange));
    return target;
}

function renamePart(score: ScoreDocument, partName: string): void {
    const name = partName.trim() || 'Parte';
    const id = score.part.getAttribute('id');
    const scorePart = Array.from(score.document.getElementsByTagName('score-part')).find((candidate) => candidate.getAttribute('id') === id);
    if (!scorePart) return;
    const current = child(scorePart, 'part-name');
    if (current) current.textContent = name;
    else scorePart.insertBefore(element(score.document, 'part-name', name), scorePart.firstChild);
    for (const item of children(scorePart, 'part-name-display')) scorePart.removeChild(item);
}

/** Toglie trasposizioni e strumenti MIDI del file di origine: suono e trasposizione sono quelli dello strumento. */
function removeSourceInstruments(score: ScoreDocument): void {
    for (const name of ['transpose', 'score-instrument', 'midi-device', 'midi-instrument']) {
        for (const item of Array.from(score.document.getElementsByTagName(name))) item.parentNode?.removeChild(item);
    }
    for (const note of score.notes()) {
        for (const item of children(note, 'instrument')) note.removeChild(item);
    }
}

function writtenKey(note: Element): number | null {
    const pitch = pitchOf(note);
    if (!pitch || pitch.unpitched || isRest(note)) return null;
    return keyOf(pitch);
}

function continuesTie(note: Element): boolean {
    return children(note, 'tie').some((tie) => tie.getAttribute('type') === 'stop');
}

function perfectQuality(difference: number, masculine: boolean): string {
    if (difference === 0) return masculine ? '' : 'giusta';
    const ending = masculine ? 'o' : 'a';
    if (difference > 0) return `${difference > 1 ? 'più che ' : ''}aumentat${ending}`;
    return `${difference < -1 ? 'più che ' : ''}diminuit${ending}`;
}

function imperfectQuality(difference: number): string {
    if (difference === 0) return 'maggiore';
    if (difference === -1) return 'minore';
    if (difference > 0) return `${difference > 1 ? 'più che ' : ''}aumentata`;
    return `${difference < -2 ? 'più che ' : ''}diminuita`;
}
