/**
 * Regole di notazione usate dall'editor: durate come frazioni di semiminima, altezze diatoniche, armature e chiavi.
 */

export interface Fraction {
    num: number;
    den: number;
}

export type NoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th';

export interface NoteTypeOption {
    type: NoteType;
    label: string;
    /** Tasto della scorciatoia, come in MuseScore. */
    key: string;
    /** Durata in semiminime. */
    quarters: Fraction;
    /** Livelli di travatura: 0 per le note senza cediglia. */
    beams: number;
}

export const NOTE_TYPES: readonly NoteTypeOption[] = [
    { type: 'whole', label: 'Semibreve', key: '7', quarters: { num: 4, den: 1 }, beams: 0 },
    { type: 'half', label: 'Minima', key: '6', quarters: { num: 2, den: 1 }, beams: 0 },
    { type: 'quarter', label: 'Semiminima', key: '5', quarters: { num: 1, den: 1 }, beams: 0 },
    { type: 'eighth', label: 'Croma', key: '4', quarters: { num: 1, den: 2 }, beams: 1 },
    { type: '16th', label: 'Semicroma', key: '3', quarters: { num: 1, den: 4 }, beams: 2 },
    { type: '32nd', label: 'Biscroma', key: '2', quarters: { num: 1, den: 8 }, beams: 3 },
    { type: '64th', label: 'Semibiscroma', key: '1', quarters: { num: 1, den: 16 }, beams: 4 }
];

export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Step = (typeof STEPS)[number];
export const STEP_NAMES: Readonly<Record<Step, string>> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

export type Alteration = 'none' | 'natural' | 'sharp' | 'flat' | 'double-sharp' | 'flat-flat';

export const ALTERATIONS: readonly { value: Alteration; label: string; symbol: string; alter: number | null }[] = [
    { value: 'none', label: 'Nessuna alterazione', symbol: '∅', alter: null },
    { value: 'flat-flat', label: 'Doppio bemolle', symbol: '♭♭', alter: -2 },
    { value: 'flat', label: 'Bemolle', symbol: '♭', alter: -1 },
    { value: 'natural', label: 'Bequadro', symbol: '♮', alter: 0 },
    { value: 'sharp', label: 'Diesis', symbol: '♯', alter: 1 },
    { value: 'double-sharp', label: 'Doppio diesis', symbol: '♯♯', alter: 2 }
];

/** Alterazione indicata dagli accidenti MusicXML che hanno un effetto sull'altezza. */
const ACCIDENTAL_ALTERS: Readonly<Record<string, number>> = {
    sharp: 1,
    flat: -1,
    natural: 0,
    'double-sharp': 2,
    'sharp-sharp': 2,
    'flat-flat': -2,
    'natural-sharp': 1,
    'natural-flat': -1
};

export function accidentalAlter(accidental: string | null): number | null {
    return accidental === null ? null : (ACCIDENTAL_ALTERS[accidental] ?? null);
}

/** Accidente da scrivere per ottenere l'alterazione indicata. */
export function accidentalFor(alter: number): Alteration {
    return ({ [-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' } as Record<number, Alteration>)[alter] ?? 'natural';
}

const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Alterazione data dall'armatura (quinte, negative per i bemolli) al nome di nota. */
export function keyAlter(fifths: number, step: Step): number {
    if (fifths > 0) return SHARP_ORDER.slice(0, Math.min(7, fifths)).includes(step) ? 1 : 0;
    if (fifths < 0) return FLAT_ORDER.slice(0, Math.min(7, -fifths)).includes(step) ? -1 : 0;
    return 0;
}

const MAJOR_KEYS = ['Do♭', 'Sol♭', 'Re♭', 'La♭', 'Mi♭', 'Si♭', 'Fa', 'Do', 'Sol', 'Re', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯'];

/** Armature da 7 bemolli a 7 diesis, con la tonalità maggiore corrispondente. */
export const KEY_OPTIONS: readonly { value: number; label: string }[] = Array.from({ length: 15 }, (_, index) => index - 7).map((fifths) => {
    const count = Math.abs(fifths);
    const accidentals = fifths === 0 ? 'Nessuna alterazione' : `${count} ${fifths > 0 ? 'diesis' : count === 1 ? 'bemolle' : 'bemolli'}`;
    return { value: fifths, label: `${accidentals} (${MAJOR_KEYS[fifths + 7]} maggiore)` };
});

export function diatonic(step: Step, octave: number): number {
    return octave * 7 + STEPS.indexOf(step);
}

export function fromDiatonic(value: number): { step: Step; octave: number } {
    const octave = Math.floor(value / 7);
    return { step: STEPS[value - octave * 7], octave };
}

export interface ClefSpec {
    sign: string;
    line: number;
    octaveChange: number;
}

export interface ClefOption {
    value: string;
    label: string;
    clef: ClefSpec;
}

export const CLEF_OPTIONS: readonly ClefOption[] = [
    { value: 'G2', label: 'Violino', clef: { sign: 'G', line: 2, octaveChange: 0 } },
    { value: 'G2-8', label: "Violino all'ottava bassa", clef: { sign: 'G', line: 2, octaveChange: -1 } },
    { value: 'F4', label: 'Basso', clef: { sign: 'F', line: 4, octaveChange: 0 } },
    { value: 'C3', label: 'Contralto', clef: { sign: 'C', line: 3, octaveChange: 0 } },
    { value: 'C4', label: 'Tenore', clef: { sign: 'C', line: 4, octaveChange: 0 } },
    { value: 'percussion', label: 'Percussioni', clef: { sign: 'percussion', line: 3, octaveChange: 0 } }
];

export function clefValue(clef: ClefSpec): string | null {
    return CLEF_OPTIONS.find((option) => option.clef.sign === clef.sign && (clef.sign === 'percussion' || (option.clef.line === clef.line && option.clef.octaveChange === clef.octaveChange)))?.value ?? null;
}

/** Altezza diatonica della prima riga del rigo; `null` per le chiavi senza altezza. */
export function clefBottom(clef: ClefSpec): number | null {
    const reference = { G: diatonic('G', 4), F: diatonic('F', 3), C: diatonic('C', 4) }[clef.sign];
    if (reference === undefined) return null;
    return reference - (clef.line - 1) * 2 + 7 * clef.octaveChange;
}

/** Nota sulla riga centrale, usata per le pause trasformate in note. */
export function middleLine(clef: ClefSpec): { step: Step; octave: number } {
    return fromDiatonic((clefBottom(clef) ?? diatonic('B', 4) - 4) + 4);
}

export function fraction(num: number, den = 1): Fraction {
    const divisor = gcd(Math.abs(num), Math.abs(den)) || 1;
    return { num: num / divisor, den: den / divisor };
}

export function multiply(left: Fraction, right: Fraction): Fraction {
    return fraction(left.num * right.num, left.den * right.den);
}

export function plus(left: Fraction, right: Fraction): Fraction {
    return fraction(left.num * right.den + right.num * left.den, left.den * right.den);
}

export function minus(left: Fraction, right: Fraction): Fraction {
    return fraction(left.num * right.den - right.num * left.den, left.den * right.den);
}

export function toNumber(value: Fraction): number {
    return value.num / value.den;
}

export function gcd(left: number, right: number): number {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a;
}

export function lcm(left: number, right: number): number {
    return (left / gcd(left, right)) * right;
}

/** Fattore dei punti di valore: 1, 3/2, 7/4, 15/8. */
export function dotsFactor(dots: number): Fraction {
    const power = 2 ** dots;
    return fraction(2 * power - 1, power);
}

/** Durata in semiminime di una figura con punti e gruppo irregolare (`actual` note al posto di `normal`). */
export function noteQuarters(type: NoteType, dots: number, actual = 1, normal = 1): Fraction {
    const option = NOTE_TYPES.find((item) => item.type === type) ?? NOTE_TYPES[2];
    return multiply(multiply(option.quarters, dotsFactor(dots)), fraction(normal, actual));
}

/** Figura e punti corrispondenti a una durata in semiminime, se ne esiste una. */
export function inferType(quarters: number, actual = 1, normal = 1): { type: NoteType; dots: number } | null {
    for (const option of NOTE_TYPES) {
        for (let dots = 0; dots <= 2; dots++) {
            if (Math.abs(toNumber(noteQuarters(option.type, dots, actual, normal)) - quarters) < 1e-6) return { type: option.type, dots };
        }
    }
    return null;
}

/** Fattore per cui moltiplicare le divisioni perché la durata indicata sia un numero intero di divisioni. */
export function divisionsFactor(quarters: Fraction, divisions: number): number {
    const needed = quarters.den / gcd(quarters.num, quarters.den);
    return needed / gcd(divisions, needed);
}

export function noteTypeOption(type: string | null): NoteTypeOption | undefined {
    return NOTE_TYPES.find((option) => option.type === type);
}
