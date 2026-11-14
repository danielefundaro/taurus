/**
 * Parte nuova dell'editor di scrittura: il MusicXML di partenza, con le battute piene di pause, e le proposte di chiave,
 * armatura, metro e tempo ricavate dagli strumenti e dalle altre parti della traccia.
 */

import { parseMusicXml } from '../score-player/musicxml-score';
import { element, integer } from './musicxml-dom';
import { CLEF_OPTIONS, NOTE_TYPES, toNumber } from './notation-rules';

/** Impostazioni scelte per una parte nuova. */
export interface NewPartSetup {
    /** Nome scritto sulla parte. */
    partName: string;
    /** Valore di `CLEF_OPTIONS`. */
    clef: string;
    /** Armatura scritta, da -7 a 7. */
    fifths: number;
    beats: number;
    beatType: number;
    /** Semiminime al minuto; `null` per non scrivere il tempo. */
    tempo: number | null;
    /** Battute intere, levare esclusa. */
    measures: number;
    /** Durata della levare in unità del metro (`beatType`); 0 se la parte non ha levare. */
    pickupBeats: number;
}

/** Ciò che si ricava da un'altra parte della traccia: armatura scritta, metro, tempo, levare e battute. */
export interface ReferencePart {
    fifths: number;
    beats: number;
    beatType: number;
    tempo: number | null;
    measures: number;
    pickupBeats: number;
    /** Chiave della prima battuta, per la trasposizione delle parti in chiave di basso. */
    clefSign: string;
}

/** Strumento della parte, per proporre la chiave. */
export interface ClefInstrument {
    name: string;
    percussionKey?: number | null;
}

export const DEFAULT_MEASURES = 16;
export const MAX_MEASURES = 999;

/** Nomi degli strumenti scritti in chiave di basso: abbreviazioni e plurali compresi, come nel catalogo degli strumenti. */
const BASS_INSTRUMENTS = /\b(controfagott[oi]|fagott[oi]|fg|fag|trombon[ei]|trb|tbn|tub[ae]|bassotuba|bombardon[ei]|timpan[oi]|timp|contrabbass[oi]|cb|violoncell[oi]|vc|basso elettrico)\b/;
/** «Basso» da solo è la tuba; il clarinetto basso, il flicorno basso e i sassofoni si scrivono in chiave di violino. */
const BASS_WORD = /\bbass[oi]\b/;
const TREBLE_FAMILIES = /\b(clarinett[oi]|clar|cl|flicorn[oi]|flic|sax|sassofon[oi])\b/;

/** Chiave proposta per gli strumenti di una parte: percussioni, chiave di basso per gli strumenti gravi, altrimenti violino. */
export function proposedClef(instruments: readonly ClefInstrument[]): string {
    if (instruments.some((instrument) => instrument.percussionKey !== null && instrument.percussionKey !== undefined)) return 'percussion';
    const bass = instruments.some((instrument) => {
        const name = normalize(instrument.name);
        return BASS_INSTRUMENTS.test(name) || (BASS_WORD.test(name) && !TREBLE_FAMILIES.test(name));
    });
    return bass ? 'F4' : 'G2';
}

/** Quinte di cui si sposta l'armatura trasponendo di `semitones`, tra -5 e 6. */
export function fifthsShift(semitones: number): number {
    const shift = (((semitones * 7) % 12) + 12) % 12;
    return shift > 6 ? shift - 12 : shift;
}

/** Armatura scritta per uno strumento che traspone di `semitones` perché suoni nella tonalità d'orchestra `concertFifths`. */
export function writtenFifths(concertFifths: number, semitones: number): number {
    return normalizeFifths(concertFifths - fifthsShift(semitones));
}

/** Tonalità d'orchestra di una parte scritta con `fifths` per uno strumento che traspone di `semitones`. */
export function concertFifths(fifths: number, semitones: number): number {
    return normalizeFifths(fifths + fifthsShift(semitones));
}

/**
 * Armatura, metro, tempo, levare e numero di battute di un'altra parte, dal suo MusicXML. `null` se il file non si legge
 * o non ha battute.
 */
export function readReferencePart(xml: string): ReferencePart | null {
    let part;
    try {
        part = parseMusicXml(xml);
    } catch {
        return null;
    }
    const first = part.measures[0];
    if (!first) return null;
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const fifths = integer(document.querySelector('part > measure > attributes > key > fifths')) ?? 0;
    const full = (first.beats * 4) / first.beatType;
    const pickup = first.length > 0 && first.length < full - 1e-6;
    const pickupBeats = pickup ? Math.round((first.length * first.beatType) / 4) : 0;
    return {
        fifths: Math.max(-7, Math.min(7, fifths)),
        beats: first.beats,
        beatType: first.beatType,
        tempo: part.measures.find((measure) => measure.tempo !== null)?.tempo ?? null,
        measures: Math.max(1, part.measures.length - (pickup ? 1 : 0)),
        pickupBeats,
        clefSign: part.clefSign
    };
}

/** Errori delle impostazioni, in italiano; vuoto se la parte si può creare. */
export function setupErrors(setup: NewPartSetup): string[] {
    const errors: string[] = [];
    if (!CLEF_OPTIONS.some((option) => option.value === setup.clef)) errors.push('Scegli la chiave.');
    if (!Number.isInteger(setup.fifths) || setup.fifths < -7 || setup.fifths > 7) errors.push("Scegli l'armatura.");
    if (!Number.isInteger(setup.beats) || setup.beats < 1 || setup.beats > 32) errors.push('Il numeratore del tempo va da 1 a 32.');
    if (![1, 2, 4, 8, 16, 32].includes(setup.beatType)) errors.push('Il denominatore del tempo è 1, 2, 4, 8, 16 o 32.');
    if (!Number.isInteger(setup.measures) || setup.measures < 1 || setup.measures > MAX_MEASURES) errors.push(`Le battute vanno da 1 a ${MAX_MEASURES}.`);
    if (!Number.isInteger(setup.pickupBeats) || setup.pickupBeats < 0 || setup.pickupBeats >= setup.beats) errors.push('La levare è più breve di una battuta.');
    if (setup.tempo !== null && (!Number.isFinite(setup.tempo) || setup.tempo < 20 || setup.tempo > 400)) errors.push('Il tempo va da 20 a 400 semiminime al minuto.');
    return errors;
}

/**
 * MusicXML di una parte nuova: chiave, armatura, metro e tempo nella prima battuta, battute di pause, una levare se
 * richiesta e la doppia barra finale. Il file non contiene `<transpose>`: la trasposizione è quella dello strumento.
 */
export function newPartXml(setup: NewPartSetup): string {
    const errors = setupErrors(setup);
    if (errors.length) throw new Error(errors.join(' '));
    const document = new DOMParser().parseFromString('<score-partwise version="4.0"/>', 'application/xml');
    const root = document.documentElement;
    const name = setup.partName.trim() || 'Parte';
    const partList = element(document, 'part-list');
    const scorePart = element(document, 'score-part', null, { id: 'P1' });
    scorePart.append(element(document, 'part-name', name));
    partList.append(scorePart);
    const part = element(document, 'part', null, { id: 'P1' });
    root.append(partList, part);

    const divisions = setup.beatType > 4 ? setup.beatType / 4 : 1;
    const unit = (4 * divisions) / setup.beatType;
    const length = setup.beats * unit;
    const count = setup.measures + (setup.pickupBeats > 0 ? 1 : 0);
    for (let index = 0; index < count; index++) {
        const pickup = setup.pickupBeats > 0 && index === 0;
        const measure = element(document, 'measure', null, pickup ? { number: '0', implicit: 'yes' } : { number: String(setup.pickupBeats > 0 ? index : index + 1) });
        if (index === 0) {
            measure.append(attributes(document, setup, divisions));
            if (setup.tempo !== null) measure.append(tempoDirection(document, setup));
        }
        if (pickup) {
            for (const rest of pickupRests(setup.pickupBeats * unit, divisions)) measure.append(restNote(document, rest.duration, rest.type, rest.dots));
        } else {
            measure.append(restNote(document, length, null, 0));
        }
        if (index === count - 1) {
            const barline = element(document, 'barline', null, { location: 'right' });
            barline.append(element(document, 'bar-style', 'light-heavy'));
            measure.append(barline);
        }
        part.append(measure);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(document)}`;
}

// Funzioni interne

function attributes(document: Document, setup: NewPartSetup, divisions: number): Element {
    const result = element(document, 'attributes');
    result.append(element(document, 'divisions', divisions));
    const key = element(document, 'key');
    key.append(element(document, 'fifths', setup.fifths));
    result.append(key);
    const time = element(document, 'time');
    time.append(element(document, 'beats', setup.beats), element(document, 'beat-type', setup.beatType));
    result.append(time);
    const clef = CLEF_OPTIONS.find((option) => option.value === setup.clef)!.clef;
    const clefElement = element(document, 'clef');
    clefElement.append(element(document, 'sign', clef.sign));
    if (clef.sign !== 'percussion') clefElement.append(element(document, 'line', clef.line));
    if (clef.octaveChange) clefElement.append(element(document, 'clef-octave-change', clef.octaveChange));
    result.append(clefElement);
    return result;
}

/** Indicazione metronomica: in semiminima puntata nei tempi composti, se il tempo si divide esattamente. */
function tempoDirection(document: Document, setup: NewPartSetup): Element {
    const tempo = setup.tempo!;
    const compound = setup.beatType === 8 && setup.beats % 3 === 0 && setup.beats > 3;
    const dotted = compound && (tempo * 2) % 3 === 0;
    const direction = element(document, 'direction', null, { placement: 'above' });
    const type = element(document, 'direction-type');
    const metronome = element(document, 'metronome');
    metronome.append(element(document, 'beat-unit', 'quarter'));
    if (dotted) metronome.append(element(document, 'beat-unit-dot'));
    metronome.append(element(document, 'per-minute', dotted ? (tempo * 2) / 3 : tempo));
    type.append(metronome);
    direction.append(type, element(document, 'sound', null, { tempo: String(tempo) }));
    return direction;
}

/** Pause della levare, dalla più lunga, senza punti. */
function pickupRests(duration: number, divisions: number): { duration: number; type: string; dots: number }[] {
    const rests: { duration: number; type: string; dots: number }[] = [];
    let left = duration;
    for (const option of NOTE_TYPES) {
        const size = toNumber(option.quarters) * divisions;
        if (!Number.isInteger(size) || size <= 0) continue;
        while (left >= size) {
            rests.push({ duration: size, type: option.type, dots: 0 });
            left -= size;
        }
    }
    return rests;
}

/** Pausa: senza figura è la pausa di battuta intera. */
function restNote(document: Document, duration: number, type: string | null, dots: number): Element {
    const note = element(document, 'note');
    note.append(type ? element(document, 'rest') : element(document, 'rest', null, { measure: 'yes' }));
    note.append(element(document, 'duration', duration), element(document, 'voice', 1));
    if (type) note.append(element(document, 'type', type));
    for (let index = 0; index < dots; index++) note.append(element(document, 'dot'));
    return note;
}

function normalizeFifths(fifths: number): number {
    if (fifths > 6) return fifths - 12;
    if (fifths < -6) return fifths + 12;
    return fifths;
}

function normalize(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
