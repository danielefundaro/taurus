import { currentAlters, keepAlters, setAccidental } from './accidentals';
import { child, element, insertOrdered, NOTE_ORDER } from './musicxml-dom';
import { Step, STEP_NAMES, toNumber } from './notation-rules';
import { EditError, isRest, pitchOf, ScoreDocument } from './score-document';
import { tieChain, toggleRest, writePitch } from './score-edits';
import { addChordPitchAt, measureLength, WriteResult, WritingCursor, WritingFigure, writeContent } from './score-writing';

/**
 * Note suonate su una tastiera MIDI o sul pianoforte a schermo: la nota suonata è quella che si scrive, con la grafia
 * dell'armatura, e le altre note della battuta conservano il loro suono. Nelle percussioni ogni suono di batteria ha una
 * posizione fissa sul rigo e ogni strumento della parte scrive nella sua voce, come la legge il lettore.
 */

/** Altezza scritta di un tasto: nome, ottava e alterazione. */
export interface KeyPitch {
    step: Step;
    octave: number;
    alter: number;
}

/** Grafia di un tasto per `+`, `-` e `=`: con il diesis, con il bemolle o senza alterazioni. */
export type Spelling = 'sharp' | 'flat' | 'natural';

const WHITE_KEYS: Readonly<Record<number, Step>> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
const SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Tasti neri scritti con il diesis nelle armature senza alterazioni: Do♯, Fa♯ e Sol♯; gli altri con il bemolle. */
const NEUTRAL_SHARPS = [1, 6, 8];

/**
 * Grafia del tasto MIDI (60 è il Do4) nell'armatura indicata: i tasti neri con il diesis nelle armature in diesis, con il
 * bemolle in quelle in bemolle, senza armatura Do♯, Mi♭, Fa♯, Sol♯ e Si♭.
 */
export function spellKey(key: number, fifths: number): KeyPitch {
    if (!Number.isInteger(key) || key < 0 || key > 127) throw new EditError('Nota fuori estensione');
    const octave = Math.floor(key / 12) - 1;
    const pitchClass = key % 12;
    const white = WHITE_KEYS[pitchClass];
    if (white) return { step: white, octave, alter: 0 };
    const sharp = fifths > 0 || (fifths === 0 && NEUTRAL_SHARPS.includes(pitchClass));
    return sharp ? { step: WHITE_KEYS[pitchClass - 1], octave, alter: 1 } : { step: WHITE_KEYS[pitchClass + 1], octave, alter: -1 };
}

/** Nome del tasto per la barra di stato, senza armatura: «Do2», «Do♯3». */
export function keyLabel(key: number): string {
    const pitch = spellKey(key, 0);
    return `${STEP_NAMES[pitch.step]}${pitch.alter === 1 ? '♯' : pitch.alter === -1 ? '♭' : ''}${pitch.octave}`;
}

/** Tasto MIDI che suona la nota scritta, senza trasposizione. */
export function keyOf(pitch: KeyPitch): number {
    return (pitch.octave + 1) * 12 + SEMITONES[pitch.step] + pitch.alter;
}

/** Scrive al cursore la nota suonata, con la figura corrente, e sposta il cursore dopo di lei. */
export function writeKey(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure, key: number): WriteResult {
    const pitch = checked(spellKey(key, score.stateAt(targetMeasure(score, cursor)).fifths));
    const intended = currentAlters(score);
    const template = element(score.document, 'note');
    const pitchElement = template.appendChild(element(score.document, 'pitch'));
    pitchElement.appendChild(element(score.document, 'step', pitch.step));
    pitchElement.appendChild(element(score.document, 'octave', pitch.octave));
    template.appendChild(element(score.document, 'voice', cursor.voice));
    const result = writeContent(score, cursor, figure, [template]);
    keepPitch(score, score.note(result.noteId), pitch.alter, intended);
    return result;
}

/**
 * Aggiunge la nota suonata all'accordo della nota, anche sulle note legate che la seguono; una nota già nell'accordo non
 * si ripete. Restituisce l'`id` della nota aggiunta.
 */
export function addChordKey(score: ScoreDocument, noteId: string, key: number): string {
    const note = score.note(noteId);
    if (isRest(note)) throw new EditError('Le pause non formano accordi: scrivi prima una nota');
    const pitch = checked(spellKey(key, score.stateAt(score.measureIndex(score.measureOf(note))).fifths));
    const present = score.eventOf(note).notes.find((member) => {
        const current = pitchOf(member);
        return !!current && !current.unpitched && keyOf(current) === key;
    });
    if (present) return present.getAttribute('id')!;
    const intended = currentAlters(score);
    const added = addChordPitchAt(score, noteId, pitch.step, pitch.octave);
    keepPitch(score, score.note(added), pitch.alter, intended);
    return added;
}

/** La nota selezionata prende l'altezza suonata, con le note legate a lei; una pausa diventa una nota. */
export function setNoteKey(score: ScoreDocument, noteId: string, key: number): string {
    let note = score.note(noteId);
    if (isRest(note)) {
        toggleRest(score, noteId);
        note = score.note(noteId);
    }
    if (pitchOf(note)?.unpitched) throw new EditError('Le note delle percussioni non cambiano altezza');
    setExactPitch(score, note, checked(spellKey(key, score.stateAt(score.measureIndex(score.measureOf(note))).fifths)));
    return noteId;
}

/** Scrive la nota con il diesis, con il bemolle o senza alterazioni, senza cambiarne il suono: Re♭ diventa Do♯. */
export function respellNote(score: ScoreDocument, noteId: string, spelling: Spelling): void {
    const note = score.note(noteId);
    const pitch = pitchOf(note);
    if (!pitch || pitch.unpitched || isRest(note)) throw new EditError('Solo le note intonate cambiano grafia');
    const alter = spelling === 'sharp' ? 1 : spelling === 'flat' ? -1 : 0;
    const natural = keyOf(pitch) - alter;
    const step = WHITE_KEYS[((natural % 12) + 12) % 12];
    if (!step) throw new EditError(spelling === 'sharp' ? 'Questa nota non si scrive con il diesis' : spelling === 'flat' ? 'Questa nota non si scrive con il bemolle' : 'Questa nota si scrive solo con un’alterazione');
    setExactPitch(score, note, checked({ step, octave: Math.floor(natural / 12) - 1, alter }));
}

// Percussioni

/** Testa delle note di batteria, come in MusicXML: solo quelle che Verovio disegna, perché lo spartito mostri il suono. */
export type DrumHead = 'normal' | 'x' | 'circle-x' | 'diamond';

/** Suono di batteria General MIDI: nome, posizione fissa sul rigo e testa della nota. */
export interface DrumSound {
    key: number;
    name: string;
    step: Step;
    octave: number;
    head: DrumHead;
}

type DrumRow = [name: string, step: Step, octave: number, head: DrumHead];

/** Posizioni dei suoni di batteria sul rigo a cinque linee, dalla notazione per batteria più diffusa. */
const DRUM_SOUNDS: Readonly<Record<number, DrumRow>> = {
    35: ['gran cassa', 'F', 4, 'normal'],
    36: ['gran cassa', 'F', 4, 'normal'],
    37: ['colpo sul cerchio', 'C', 5, 'x'],
    38: ['tamburo', 'C', 5, 'normal'],
    39: ['battito di mani', 'B', 4, 'x'],
    40: ['tamburo', 'C', 5, 'normal'],
    41: ['tom basso grave', 'A', 4, 'normal'],
    42: ['charleston chiuso', 'G', 5, 'x'],
    43: ['tom basso', 'A', 4, 'normal'],
    44: ['charleston a pedale', 'D', 4, 'x'],
    45: ['tom grave', 'D', 5, 'normal'],
    46: ['charleston aperto', 'G', 5, 'circle-x'],
    47: ['tom medio', 'D', 5, 'normal'],
    48: ['tom medio acuto', 'E', 5, 'normal'],
    49: ['piatti', 'A', 5, 'x'],
    50: ['tom acuto', 'E', 5, 'normal'],
    51: ['piatto ride', 'F', 5, 'x'],
    52: ['piatto cinese', 'A', 5, 'x'],
    53: ['campana del ride', 'F', 5, 'diamond'],
    54: ['tamburello', 'D', 5, 'diamond'],
    55: ['piatto splash', 'A', 5, 'x'],
    56: ['campanaccio', 'B', 4, 'diamond'],
    57: ['piatti', 'A', 5, 'x'],
    59: ['piatto ride', 'F', 5, 'x'],
    80: ['triangolo smorzato', 'E', 5, 'x'],
    81: ['triangolo', 'E', 5, 'x']
};

/** Nomi degli altri suoni General MIDI, scritti sulla linea centrale. */
const OTHER_DRUM_NAMES: Readonly<Record<number, string>> = {
    58: 'vibraslap',
    60: 'bongo acuto',
    61: 'bongo grave',
    62: 'conga acuta smorzata',
    63: 'conga acuta',
    64: 'conga grave',
    65: 'timbales acuto',
    66: 'timbales grave',
    67: 'agogô acuto',
    68: 'agogô grave',
    69: 'cabasa',
    70: 'maracas',
    71: 'fischietto corto',
    72: 'fischietto lungo',
    73: 'güiro corto',
    74: 'güiro lungo',
    75: 'claves',
    76: 'wood block acuto',
    77: 'wood block grave',
    78: 'cuíca smorzata',
    79: 'cuíca aperta'
};

/** Suono di batteria del tasto; quelli senza posizione propria vanno sulla linea centrale (Si4) con la testa normale. */
export function drumSound(key: number): DrumSound {
    const row = DRUM_SOUNDS[key];
    if (row) return { key, name: row[0], step: row[1], octave: row[2], head: row[3] };
    return { key, name: OTHER_DRUM_NAMES[key] ?? `suono ${key}`, step: 'B', octave: 4, head: 'normal' };
}

/** Suono della voce: lo strumento con lo stesso numero, l'ultimo per le voci oltre gli strumenti, come nel lettore. */
export function voiceDrum(keys: readonly number[], voice: number): number | null {
    return keys.length ? keys[Math.min(Math.max(voice, 1), keys.length) - 1] : null;
}

/**
 * Voce in cui va il tasto suonato: con più strumenti la voce dello strumento che ha quella nota di batteria, `null` per
 * gli altri tasti; con uno strumento, o senza strumenti, la voce del cursore.
 */
export function drumVoice(keys: readonly number[], key: number, voice: number): number | null {
    if (keys.length <= 1) return voice;
    const index = keys.indexOf(key);
    return index < 0 || index >= 4 ? null : index + 1;
}

/** Tasti che scrivono in una parte con più strumenti, per la barra di stato: «Do2 gran cassa, Re2 tamburo». */
export function drumKeysLabel(keys: readonly number[]): string {
    return keys
        .slice(0, 4)
        .map((key) => `${keyLabel(key)} ${drumSound(key).name}`)
        .join(', ');
}

/** Scrive al cursore il suono di batteria, nella sua posizione e con la sua testa, e sposta il cursore dopo di lui. */
export function writeDrum(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure, key: number): WriteResult {
    const sound = drumSound(key);
    const template = element(score.document, 'note');
    const unpitched = template.appendChild(element(score.document, 'unpitched'));
    unpitched.appendChild(element(score.document, 'display-step', sound.step));
    unpitched.appendChild(element(score.document, 'display-octave', sound.octave));
    template.appendChild(element(score.document, 'voice', cursor.voice));
    if (sound.head !== 'normal') insertOrdered(template, element(score.document, 'notehead', sound.head), NOTE_ORDER);
    return writeContent(score, cursor, figure, [template]);
}

// Interni

function checked(pitch: KeyPitch): KeyPitch {
    if (pitch.octave < 0 || pitch.octave > 9) throw new EditError('Altezza fuori estensione');
    return pitch;
}

/** Battuta dove scrive il cursore: alla fine di una battuta la scrittura passa alla seguente. */
function targetMeasure(score: ScoreDocument, cursor: WritingCursor): number {
    const last = score.measures().length - 1;
    const index = Math.min(Math.max(cursor.measureIndex, 0), last);
    const atEnd = toNumber(cursor.offset) * score.stateAt(index).divisions >= measureLength(score, index) - 1e-6;
    return atEnd ? Math.min(index + 1, last) : index;
}

/** La nota, con quelle legate, prende nome, ottava e alterazione indicati; le altre note conservano il loro suono. */
function setExactPitch(score: ScoreDocument, note: Element, pitch: KeyPitch): void {
    const intended = currentAlters(score);
    const chain = tieChain(score, note);
    for (const linked of chain) {
        writePitch(linked, pitch.step, pitch.octave);
        setAccidental(linked, null);
        intended.set(linked, pitch.alter);
    }
    keepAlters(score, intended, measuresOf(score, chain));
}

/** La nota appena scritta, con quelle legate a lei, suona con l'alterazione indicata; le altre conservano la loro. */
function keepPitch(score: ScoreDocument, note: Element, alter: number, intended: Map<Element, number>): void {
    const chain = child(note, 'grace') ? [note] : tieChain(score, note);
    for (const linked of chain) intended.set(linked, alter);
    keepAlters(score, intended, measuresOf(score, chain));
}

function measuresOf(score: ScoreDocument, notes: Element[]): number[] {
    return [...new Set(notes.map((note) => score.measureIndex(score.measureOf(note))))];
}
