/**
 * Lettura di una parte MusicXML (score-partwise) nel modello minimo che serve all'ascolto: battute con durata, note con
 * altezza MIDI scritta, legature di valore, dinamiche e indicazioni di struttura (ritornelli, volte, segno, coda, salti).
 * Le durate sono in semiminime.
 */

export interface ScoreNote {
    /** Inizio dalla battuta, in semiminime. */
    start: number;
    duration: number;
    /** Altezza MIDI scritta; `null` per le pause. */
    midi: number | null;
    voice: string;
    tieStart: boolean;
    tieStop: boolean;
    velocity: number;
}

export interface ScoreEnding {
    numbers: number[];
    start: boolean;
    stop: boolean;
}

export interface ScoreMeasure {
    index: number;
    number: string;
    /** Durata usata per l'ascolto: quella del metro, oppure il contenuto per le battute in levare. */
    length: number;
    beats: number;
    beatType: number;
    notes: ScoreNote[];
    forwardRepeat: boolean;
    /** Numero di esecuzioni del ritornello che si chiude qui; 0 se la battuta non chiude un ritornello. */
    backwardRepeatTimes: number;
    ending: ScoreEnding | null;
    segno: boolean;
    coda: boolean;
    toCoda: boolean;
    fine: boolean;
    daCapo: boolean;
    dalSegno: boolean;
    /** Indicazione metronomica all'inizio della battuta, in semiminime al minuto. */
    tempo: number | null;
}

export interface ScorePart {
    id: string;
    name: string;
    /** Chiave della prima battuta: G, F, C o percussion. */
    clefSign: string;
    measures: ScoreMeasure[];
}

const STEP_SEMITONES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DYNAMICS: Readonly<Record<string, number>> = { ppp: 30, pp: 40, p: 55, mp: 70, mf: 85, f: 100, ff: 112, fff: 124, sf: 110, sfz: 110, fp: 100 };
const DEFAULT_VELOCITY = 85;

export function parseMusicXml(xml: string, partIndex = 0): ScorePart {
    const root = parseDocument(xml);
    const partElement = childElements(root, 'part')[partIndex];
    if (!partElement) throw new Error('Parte non presente');
    return parsePart(root, partElement);
}

/** Tutte le parti di un file, lette una volta sola: per ascoltare insieme i righi di una partitura. */
export function parseMusicXmlParts(xml: string): ScorePart[] {
    const root = parseDocument(xml);
    return childElements(root, 'part').map((partElement) => parsePart(root, partElement));
}

function parseDocument(xml: string): Element {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length > 0) throw new Error('MusicXML non leggibile');
    return document.documentElement;
}

function parsePart(root: Element, partElement: Element): ScorePart {
    const partId = partElement.getAttribute('id') ?? '';
    const scorePart = Array.from(root.getElementsByTagName('score-part')).find((element) => element.getAttribute('id') === partId);

    const state = { divisions: 1, beats: 4, beatType: 4, velocity: DEFAULT_VELOCITY, clefSign: '' };
    const measures = childElements(partElement, 'measure').map((element, index) => parseMeasure(element, index, state));
    assignCodaMarks(measures, partElement);
    return { id: partId, name: text(child(scorePart, 'part-name')) ?? '', clefSign: state.clefSign || 'G', measures };
}

function parseMeasure(element: Element, index: number, state: { divisions: number; beats: number; beatType: number; velocity: number; clefSign: string }): ScoreMeasure {
    const measure: ScoreMeasure = {
        index,
        number: element.getAttribute('number') ?? String(index + 1),
        length: 0,
        beats: state.beats,
        beatType: state.beatType,
        notes: [],
        forwardRepeat: false,
        backwardRepeatTimes: 0,
        ending: null,
        segno: false,
        coda: false,
        toCoda: false,
        fine: false,
        daCapo: false,
        dalSegno: false,
        tempo: null
    };
    let position = 0;
    let furthest = 0;
    let lastStart = 0;
    for (const item of Array.from(element.children)) {
        switch (item.tagName) {
            case 'attributes': {
                const divisions = number(text(child(item, 'divisions')));
                if (divisions && divisions > 0) state.divisions = divisions;
                const time = child(item, 'time');
                if (time) {
                    const beats = (text(child(time, 'beats')) ?? '').split('+').reduce((sum, part) => sum + (Number(part) || 0), 0);
                    const beatType = number(text(child(time, 'beat-type')));
                    if (beats > 0 && beatType) {
                        state.beats = beats;
                        state.beatType = beatType;
                        measure.beats = beats;
                        measure.beatType = beatType;
                    }
                }
                const clef = child(item, 'clef');
                if (clef && !state.clefSign) state.clefSign = text(child(clef, 'sign')) ?? '';
                break;
            }
            case 'note': {
                if (child(item, 'grace') || child(item, 'cue')) break;
                const duration = (number(text(child(item, 'duration'))) ?? 0) / state.divisions;
                const chord = !!child(item, 'chord');
                const start = chord ? lastStart : position;
                if (!chord) {
                    lastStart = position;
                    position += duration;
                    furthest = Math.max(furthest, position);
                }
                const ties = childElements(item, 'tie').map((tie) => tie.getAttribute('type'));
                measure.notes.push({
                    start,
                    duration,
                    midi: child(item, 'rest') ? null : pitchOf(item),
                    voice: text(child(item, 'voice')) ?? '1',
                    tieStart: ties.includes('start'),
                    tieStop: ties.includes('stop'),
                    velocity: state.velocity
                });
                break;
            }
            case 'backup':
                position -= (number(text(child(item, 'duration'))) ?? 0) / state.divisions;
                break;
            case 'forward':
                position += (number(text(child(item, 'duration'))) ?? 0) / state.divisions;
                furthest = Math.max(furthest, position);
                break;
            case 'barline':
                readBarline(item, measure);
                break;
            case 'direction':
                readDirection(item, measure, state);
                break;
            case 'sound':
                readSound(item, measure);
                break;
        }
    }
    const nominal = (measure.beats * 4) / measure.beatType;
    const implicit = element.getAttribute('implicit') === 'yes';
    measure.length = implicit && furthest > 0 ? furthest : nominal;
    return measure;
}

function pitchOf(note: Element): number | null {
    const pitch = child(note, 'pitch');
    if (pitch) {
        const step = STEP_SEMITONES[text(child(pitch, 'step')) ?? ''];
        const octave = number(text(child(pitch, 'octave')));
        if (step === undefined || octave === null) return null;
        return (octave + 1) * 12 + step + Math.round(Number(text(child(pitch, 'alter')) ?? 0));
    }
    const unpitched = child(note, 'unpitched');
    if (unpitched) {
        const step = STEP_SEMITONES[text(child(unpitched, 'display-step')) ?? ''] ?? 0;
        const octave = number(text(child(unpitched, 'display-octave'))) ?? 4;
        return (octave + 1) * 12 + step;
    }
    return null;
}

function readBarline(barline: Element, measure: ScoreMeasure): void {
    const repeat = child(barline, 'repeat');
    if (repeat?.getAttribute('direction') === 'forward') measure.forwardRepeat = true;
    if (repeat?.getAttribute('direction') === 'backward') measure.backwardRepeatTimes = number(repeat.getAttribute('times')) ?? 2;
    const ending = child(barline, 'ending');
    if (ending) {
        const numbers = (ending.getAttribute('number') ?? '')
            .split(/[,\s]+/)
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);
        const type = ending.getAttribute('type');
        measure.ending = {
            numbers: numbers.length ? numbers : (measure.ending?.numbers ?? [1]),
            start: (measure.ending?.start ?? false) || type === 'start',
            stop: (measure.ending?.stop ?? false) || type === 'stop' || type === 'discontinue'
        };
    }
    if (child(barline, 'segno')) measure.segno = true;
    if (child(barline, 'coda')) measure.coda = true;
}

function readDirection(direction: Element, measure: ScoreMeasure, state: { velocity: number }): void {
    for (const type of childElements(direction, 'direction-type')) {
        if (child(type, 'segno')) measure.segno = true;
        const dynamics = child(type, 'dynamics');
        if (dynamics) {
            const mark = dynamics.firstElementChild?.tagName;
            if (mark && DYNAMICS[mark]) state.velocity = DYNAMICS[mark];
        }
        const words = text(child(type, 'words'))?.toLowerCase().replace(/\s+/g, ' ') ?? '';
        if (words === 'fine') measure.fine = true;
        if (/d\.\s?c\.|da capo/.test(words)) measure.daCapo = true;
        if (/d\.\s?s\.|dal segno/.test(words)) measure.dalSegno = true;
        if (/to coda|alla coda/.test(words)) measure.toCoda = true;
        const metronome = child(type, 'metronome');
        const perMinute = number(text(child(metronome, 'per-minute')));
        if (perMinute && measure.tempo === null) measure.tempo = perMinute * quarterRatio(text(child(metronome, 'beat-unit')), !!child(metronome, 'beat-unit-dot'));
    }
    const sound = child(direction, 'sound');
    if (sound) readSound(sound, measure);
}

function readSound(sound: Element, measure: ScoreMeasure): void {
    const tempo = number(sound.getAttribute('tempo'));
    if (tempo) measure.tempo = tempo;
    if (sound.getAttribute('dacapo') === 'yes') measure.daCapo = true;
    if (sound.getAttribute('dalsegno')) measure.dalSegno = true;
    if (sound.getAttribute('fine')) measure.fine = true;
    if (sound.getAttribute('segno')) measure.segno = true;
    if (sound.getAttribute('coda')) measure.coda = true;
    if (sound.getAttribute('tocoda')) measure.toCoda = true;
}

/**
 * Due segni di coda senza indicazioni `sound` sono, per convenzione, il punto di salto e l'inizio della coda: il primo
 * diventa «alla coda».
 */
function assignCodaMarks(measures: ScoreMeasure[], part: Element): void {
    if (measures.some((measure) => measure.toCoda) || part.querySelector('sound[tocoda]')) return;
    const marked = measures.filter((measure) => measure.coda);
    if (marked.length === 2) {
        marked[0].coda = false;
        marked[0].toCoda = true;
    }
}

function quarterRatio(beatUnit: string | null, dotted: boolean): number {
    const ratio = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[beatUnit ?? 'quarter'] ?? 1;
    return dotted ? ratio * 1.5 : ratio;
}

function child(element: Element | null | undefined, name: string): Element | null {
    if (!element) return null;
    for (const item of Array.from(element.children)) if (item.tagName === name) return item;
    return null;
}

function childElements(element: Element, name: string): Element[] {
    return Array.from(element.children).filter((item) => item.tagName === name);
}

function text(element: Element | null): string | null {
    return element?.textContent?.trim() ?? null;
}

function number(value: string | null): number | null {
    if (value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
