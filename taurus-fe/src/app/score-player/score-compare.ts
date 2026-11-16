/**
 * Confronto per battute di due versioni di una parte, con la regola dello strumento di accuratezza dei motori
 * (`taurus-omr/accuracy/compare.py`): una battuta è uguale se si ascolta uguale, cioè ha la stessa durata e le stesse
 * note per inizio, durata, altezza e legatura di valore, qualunque siano grafia, voci, travature e pause. Le battute si
 * allineano prima del confronto, così una battuta persa o letta due volte conta una volta e non sposta le altre; sulle
 * battute allineate si confrontano i segni di struttura. I casi di `compare-cases.json`, copia di quelli del servizio
 * musicale, tengono uguali le due regole.
 */
import { parseMusicXml, parseMusicXmlParts, ScoreMeasure, ScorePart } from './musicxml-score';

/** Suddivisioni della semiminima: esatte per terzine, quintine, settimine e figure fino alla semibiscroma. */
const TICKS = 20160;

/** Trasposizione con cui suona la parte, come nell'ascolto; senza, si confrontano le note scritte. */
export interface CompareSound {
    transpositionSemitones?: number | null;
    bassClefTranspositionSemitones?: number | null;
}

export interface CompareNote {
    /** Inizio e durata in suddivisioni della semiminima. */
    start: number;
    duration: number;
    /** Altezza MIDI come suona. */
    midi: number;
    /** Altezza MIDI scritta, per descrivere la nota. */
    written: number;
    tie: boolean;
}

export interface CompareMeasure {
    /** Posizione da 0 nella parte. */
    index: number;
    number: string;
    length: number;
    notes: readonly CompareNote[];
    /** Segni di struttura, come «ritornello inizio», «volta 1», «fine» o «tempo 96». */
    marks: readonly string[];
    /** Armatura in vigore, per dare il nome alle note scritte. */
    fifths: number;
}

/** Tipi di una battuta diversa, come in `compare.py`; `marks` sono i segni di struttura di due battute allineate. */
export type DifferenceKind = 'pitch' | 'rhythm' | 'tie' | 'missing' | 'extra' | 'marks';

export interface MeasureDifference {
    kind: DifferenceKind;
    /** Battuta della versione di riferimento; `null` per una battuta solo nell'altra versione. */
    reference: CompareMeasure | null;
    /** Battuta dell'altra versione; `null` per una battuta solo nella versione di riferimento. */
    candidate: CompareMeasure | null;
    /** Per una battuta solo nell'altra versione, la battuta di riferimento che la precede; `null` all'inizio. */
    after?: CompareMeasure | null;
    /** Per le altezze: la prima nota diversa, scritta, nelle due versioni e quante altre note lo sono. */
    pitches?: { reference: number; candidate: number; others: number };
    /** Per i segni di struttura: quelli che ha solo una delle due battute allineate. */
    marks?: { reference: readonly string[]; candidate: readonly string[] };
}

export interface MeasureComparison {
    referenceMeasures: number;
    candidateMeasures: number;
    correctMeasures: number;
    referenceMarks: number;
    /** Segni della versione di riferimento presenti anche nella battuta allineata dell'altra. */
    foundMarks: number;
    /** Le differenze nell'ordine delle battute. */
    differences: readonly MeasureDifference[];
}

/** Battute diverse per tipo, senza i segni di struttura. */
export type DifferenceCounts = Record<Exclude<DifferenceKind, 'marks'>, number>;

/** Battute della parte indicata, come si ascoltano: le altezze con la trasposizione del suono, se c'è. */
export function readMeasures(xml: string, partIndex = 0, sound: CompareSound = {}): CompareMeasure[] {
    return compareMeasuresOf(parseMusicXml(xml, partIndex), keySignatures(xml)[partIndex] ?? [], sound);
}

/** Un rigo di una partitura, con le sue battute come si ascoltano. */
export interface CompareRow {
    /** `id` della parte nel MusicXML. */
    id: string;
    name: string;
    measures: CompareMeasure[];
}

/** Tutti i righi di una partitura, letti una volta sola, ognuno con il suono indicato per il suo `id`. */
export function readRows(xml: string, sound: (id: string) => CompareSound = () => ({})): CompareRow[] {
    const fifths = keySignatures(xml);
    return parseMusicXmlParts(xml).map((part, index) => ({ id: part.id, name: part.name, measures: compareMeasuresOf(part, fifths[index] ?? [], sound(part.id)) }));
}

function compareMeasuresOf(part: ScorePart, fifths: readonly number[], sound: CompareSound): CompareMeasure[] {
    const bass = part.clefSign === 'F' && sound.bassClefTranspositionSemitones !== null && sound.bassClefTranspositionSemitones !== undefined;
    const transposition = (bass ? sound.bassClefTranspositionSemitones : sound.transpositionSemitones) ?? 0;
    return part.measures.map((measure) => ({
        index: measure.index,
        number: measure.number,
        length: ticks(measure.length),
        notes: measure.notes
            .filter((note): note is typeof note & { midi: number } => note.midi !== null)
            .map((note) => ({ start: ticks(note.start), duration: ticks(note.duration), midi: note.midi + transposition, written: note.midi, tie: note.tieStart }))
            .sort((first, second) => first.start - second.start || first.midi - second.midi || first.duration - second.duration),
        marks: marksOf(measure),
        fifths: fifths[measure.index] ?? 0
    }));
}

/**
 * Confronta l'altra versione (`candidate`) con quella di riferimento, come `compare.compare` del servizio musicale:
 * nel confronto tra un motore e la parte corretta il riferimento è la versione corretta.
 */
export function compareMeasures(reference: readonly CompareMeasure[], candidate: readonly CompareMeasure[]): MeasureComparison {
    const differences: MeasureDifference[] = [];
    let correct = 0;
    let found = 0;
    const pair = (first: CompareMeasure, second: CompareMeasure, equal: boolean): void => {
        if (!equal) differences.push(measureDifference(first, second));
        const onlyReference = first.marks.filter((mark) => !second.marks.includes(mark));
        const onlyCandidate = second.marks.filter((mark) => !first.marks.includes(mark));
        found += first.marks.length - onlyReference.length;
        if (onlyReference.length || onlyCandidate.length) differences.push({ kind: 'marks', reference: first, candidate: second, marks: { reference: onlyReference, candidate: onlyCandidate } });
    };
    const keys = (measures: readonly CompareMeasure[]) => measures.map(contentKey);
    for (const [operation, referenceStart, referenceEnd, candidateStart, candidateEnd] of opcodes(keys(reference), keys(candidate))) {
        const expected = reference.slice(referenceStart, referenceEnd);
        const read = candidate.slice(candidateStart, candidateEnd);
        if (operation === 'equal') {
            correct += expected.length;
            expected.forEach((measure, index) => pair(measure, read[index], true));
        } else if (operation === 'replace') {
            for (let index = 0; index < Math.max(expected.length, read.length); index++) {
                if (index < expected.length && index < read.length) pair(expected[index], read[index], false);
                else if (index < expected.length) differences.push({ kind: 'missing', reference: expected[index], candidate: null });
                else differences.push({ kind: 'extra', reference: null, candidate: read[index], after: expected[expected.length - 1] });
            }
        } else if (operation === 'delete') {
            for (const measure of expected) differences.push({ kind: 'missing', reference: measure, candidate: null });
        } else {
            const after = referenceStart > 0 ? reference[referenceStart - 1] : null;
            for (const measure of read) differences.push({ kind: 'extra', reference: null, candidate: measure, after });
        }
    }
    return {
        referenceMeasures: reference.length,
        candidateMeasures: candidate.length,
        correctMeasures: correct,
        referenceMarks: reference.reduce((sum, measure) => sum + measure.marks.length, 0),
        foundMarks: found,
        differences
    };
}

/** Battute diverse per tipo: le battute della versione di riferimento sono corrette, di un tipo o perse. */
export function differenceCounts(comparison: MeasureComparison): DifferenceCounts {
    const counts: DifferenceCounts = { pitch: 0, rhythm: 0, tie: 0, missing: 0, extra: 0 };
    for (const difference of comparison.differences) if (difference.kind !== 'marks') counts[difference.kind]++;
    return counts;
}

/** Come si chiamano le due versioni nei testi, per esempio «versione 5». */
export interface CompareLabels {
    reference: string;
    candidate: string;
}

/**
 * Testo di una differenza: «Battuta 12: altezze diverse (La4 invece di Sol4)», «Battuta 20: solo nella versione 5».
 * La battuta è quella della versione di riferimento, con il numero dell'altra versione quando è diverso.
 */
export function differenceText(difference: MeasureDifference, labels: CompareLabels): string {
    const { reference, candidate } = difference;
    if (!reference) return `Battuta ${candidate?.number ?? ''}: solo nella ${labels.candidate}`;
    if (!candidate) return `Battuta ${reference.number}: solo nella ${labels.reference}`;
    const measure = `Battuta ${reference.number}${candidate.number !== reference.number ? ` (${candidate.number} nella ${labels.candidate})` : ''}`;
    switch (difference.kind) {
        case 'pitch': {
            const pitches = difference.pitches;
            if (!pitches) return `${measure}: altezze diverse`;
            const others = pitches.others === 0 ? '' : pitches.others === 1 ? " e un'altra nota" : ` e altre ${pitches.others} note`;
            return `${measure}: altezze diverse (${pitchName(pitches.reference, reference.fifths)} invece di ${pitchName(pitches.candidate, candidate.fifths)}${others})`;
        }
        case 'rhythm':
            return `${measure}: ritmo diverso`;
        case 'tie':
            return `${measure}: legatura di valore`;
        default: {
            const parts = [
                [difference.marks?.reference ?? [], labels.reference],
                [difference.marks?.candidate ?? [], labels.candidate]
            ] as const;
            const texts = parts.filter(([marks]) => marks.length).map(([marks, label]) => `${list(marks.map(markLabel))} solo nella ${label}`);
            return `${measure}: ${texts.join('; ')}`;
        }
    }
}

/** Nome italiano di una nota scritta, con l'armatura per scegliere tra diesis e bemolle: «La4», «Si♭3». */
export function pitchName(midi: number, fifths = 0): string {
    const octave = Math.floor(midi / 12) - 1;
    const pitchClass = ((midi % 12) + 12) % 12;
    const white = WHITE_KEYS[pitchClass];
    if (white !== undefined) return `${STEP_NAMES[white]}${octave}`;
    const sharp = fifths > 0 || (fifths === 0 && NEUTRAL_SHARPS.includes(pitchClass));
    return sharp ? `${STEP_NAMES[WHITE_KEYS[pitchClass - 1]]}♯${octave}` : `${STEP_NAMES[WHITE_KEYS[pitchClass + 1]]}♭${octave}`;
}

const STEP_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const WHITE_KEYS: Readonly<Record<number, number>> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
/** Senza armatura Do♯, Fa♯ e Sol♯, ma Mi♭ e Si♭, come nell'editor. */
const NEUTRAL_SHARPS = [1, 6, 8];
const MARK_LABELS: Readonly<Record<string, string>> = {
    'ritornello inizio': 'inizio del ritornello',
    'ritornello fine': 'fine del ritornello',
    fine: 'Fine',
    'da capo': 'D.C.',
    'dal segno': 'D.S.'
};

function markLabel(mark: string): string {
    return MARK_LABELS[mark] ?? mark;
}

function list(items: readonly string[]): string {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : (items[0] ?? '');
}

/** Armatura in vigore in ogni battuta, per ogni parte. */
function keySignatures(xml: string): number[][] {
    const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
    return Array.from(root.children)
        .filter((item) => item.tagName === 'part')
        .map((part) => {
            let fifths = 0;
            return Array.from(part.children)
                .filter((item) => item.tagName === 'measure')
                .map((measure) => {
                    const value = measure.querySelector(':scope > attributes > key > fifths')?.textContent?.trim();
                    if (value && Number.isInteger(Number(value))) fifths = Number(value);
                    return fifths;
                });
        });
}

/** Operazioni che trasformano `b` in `a`, come `difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()`. */
export function opcodes(a: readonly string[], b: readonly string[]): [operation: 'equal' | 'replace' | 'delete' | 'insert', aStart: number, aEnd: number, bStart: number, bEnd: number][] {
    const result: ReturnType<typeof opcodes> = [];
    let i = 0;
    let j = 0;
    for (const [aStart, bStart, size] of matchingBlocks(a, b)) {
        const operation = i < aStart && j < bStart ? 'replace' : i < aStart ? 'delete' : j < bStart ? 'insert' : null;
        if (operation) result.push([operation, i, aStart, j, bStart]);
        i = aStart + size;
        j = bStart + size;
        if (size) result.push(['equal', aStart, i, bStart, j]);
    }
    return result;
}

/** Blocchi comuni più lunghi, trovati ricorsivamente a sinistra e a destra di ciascuno, come `get_matching_blocks`. */
function matchingBlocks(a: readonly string[], b: readonly string[]): [number, number, number][] {
    const positions = new Map<string, number[]>();
    b.forEach((item, index) => {
        const list = positions.get(item);
        if (list) list.push(index);
        else positions.set(item, [index]);
    });
    const blocks: [number, number, number][] = [];
    const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
    while (queue.length) {
        const [aLow, aHigh, bLow, bHigh] = queue.pop()!;
        const [i, j, size] = longestMatch(a, b, positions, aLow, aHigh, bLow, bHigh);
        if (!size) continue;
        blocks.push([i, j, size]);
        if (aLow < i && bLow < j) queue.push([aLow, i, bLow, j]);
        if (i + size < aHigh && j + size < bHigh) queue.push([i + size, aHigh, j + size, bHigh]);
    }
    blocks.sort((first, second) => first[0] - second[0] || first[1] - second[1] || first[2] - second[2]);
    const merged: [number, number, number][] = [];
    let current: [number, number, number] = [0, 0, 0];
    for (const block of blocks) {
        if (current[0] + current[2] === block[0] && current[1] + current[2] === block[1]) current = [current[0], current[1], current[2] + block[2]];
        else {
            if (current[2]) merged.push(current);
            current = block;
        }
    }
    if (current[2]) merged.push(current);
    merged.push([a.length, b.length, 0]);
    return merged;
}

/** Il blocco comune più lungo nei due intervalli; a parità, quello che inizia prima in `a` e poi in `b`. */
function longestMatch(a: readonly string[], b: readonly string[], positions: ReadonlyMap<string, number[]>, aLow: number, aHigh: number, bLow: number, bHigh: number): [number, number, number] {
    let bestI = aLow;
    let bestJ = bLow;
    let bestSize = 0;
    let lengths = new Map<number, number>();
    for (let i = aLow; i < aHigh; i++) {
        const next = new Map<number, number>();
        for (const j of positions.get(a[i]) ?? []) {
            if (j < bLow) continue;
            if (j >= bHigh) break;
            const size = (lengths.get(j - 1) ?? 0) + 1;
            next.set(j, size);
            if (size > bestSize) {
                bestI = i - size + 1;
                bestJ = j - size + 1;
                bestSize = size;
            }
        }
        lengths = next;
    }
    while (bestI > aLow && bestJ > bLow && a[bestI - 1] === b[bestJ - 1]) {
        bestI--;
        bestJ--;
        bestSize++;
    }
    while (bestI + bestSize < aHigh && bestJ + bestSize < bHigh && a[bestI + bestSize] === b[bestJ + bestSize]) bestSize++;
    return [bestI, bestJ, bestSize];
}

/** Perché due battute allineate sono diverse: il ritmo, solo le altezze o solo le legature di valore. */
function measureDifference(reference: CompareMeasure, candidate: CompareMeasure): MeasureDifference {
    const rhythm = (measure: CompareMeasure) => sortedKeys(measure.notes.map((note) => `${note.start}:${note.duration}`));
    if (reference.length !== candidate.length || rhythm(reference) !== rhythm(candidate)) return { kind: 'rhythm', reference, candidate };
    const order = (measure: CompareMeasure) => [...measure.notes].sort((first, second) => first.start - second.start || first.duration - second.duration || first.midi - second.midi);
    const expected = order(reference);
    const read = order(candidate);
    const different = expected.map((note, index) => [note, read[index]] as const).filter(([first, second]) => first.midi !== second.midi);
    if (!different.length) return { kind: 'tie', reference, candidate };
    return { kind: 'pitch', reference, candidate, pitches: { reference: different[0][0].written, candidate: different[0][1].written, others: different.length - 1 } };
}

function contentKey(measure: CompareMeasure): string {
    return `${measure.length}|${measure.notes.map((note) => `${note.start}:${note.duration}:${note.midi}${note.tie ? '~' : ''}`).join(',')}`;
}

function sortedKeys(keys: string[]): string {
    return keys.sort().join(',');
}

function marksOf(measure: ScoreMeasure): string[] {
    const marks: string[] = [];
    if (measure.forwardRepeat) marks.push('ritornello inizio');
    if (measure.backwardRepeatTimes > 0) marks.push('ritornello fine');
    if (measure.ending?.start) marks.push(`volta ${measure.ending.numbers.join(', ')}`);
    if (measure.segno) marks.push('segno');
    if (measure.coda) marks.push('coda');
    if (measure.toCoda) marks.push('al coda');
    if (measure.fine) marks.push('fine');
    if (measure.daCapo) marks.push('da capo');
    if (measure.dalSegno) marks.push('dal segno');
    if (measure.tempo !== null) marks.push(`tempo ${Math.round(measure.tempo)}`);
    return marks;
}

function ticks(quarters: number): number {
    return Math.round(quarters * TICKS);
}
