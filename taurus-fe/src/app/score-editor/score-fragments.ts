/**
 * Frammenti riutilizzabili: battute intere salvate dalla scrittura e inserite in altre parti. Un frammento intonato si
 * salva in suoni reali, con la trasposizione dello strumento compresa l'ottava, e all'inserimento si traspone con il piano
 * della derivazione; un frammento di percussione si salva com'è, con il suono di ogni voce, e si inserisce solo dove ci
 * sono tutti i suoi suoni. Metro, armatura, ritornelli e volte interni viaggiano con il frammento; lettere di prova,
 * tempo, salti e interruzioni restano nella parte, come negli appunti.
 */

import { FragmentVoiceSound, PlaybackInstrument, PlaybackSound, ScoreFragment, ScoreFragmentCategory, ScoreFragmentKind } from '../module';
import { ATTRIBUTES_ORDER, BARLINE_ORDER, CLEF_ORDER, child, children, element, insertOrdered, NOTE_ORDER } from './musicxml-dom';
import { newPartXml } from './new-part';
import { CLEF_OPTIONS, clefValue, fraction, toNumber } from './notation-rules';
import { concertInstrument, measuresPassage } from './score-arrangement';
import { applyDerivation, clefTransposition, DerivationPlan, planDerivation, RangeInstrument } from './score-derivation';
import { EditError, isRest, MusicalState, ScoreDocument, voiceOf } from './score-document';
import { insertMeasure, leadingAttributes, openScore, setKey, setTime } from './score-edits';
import { drumSound, voiceDrum } from './score-input';
import { copyPassage, Passage, pastePassage } from './score-passage';
import { VOICES } from './score-writing';

/** Battute di un frammento al massimo, come il limite del backend. */
export const MAX_FRAGMENT_MEASURES = 64;
export const FRAGMENT_NAME_LENGTH = 100;
export const FRAGMENT_NOTE_LENGTH = 500;

export const FRAGMENT_CATEGORIES: readonly { value: ScoreFragmentCategory; label: string }[] = [
    { value: 'INTRODUCTION', label: 'Introduzione' },
    { value: 'MARCH', label: "Marcia d'ordinanza" },
    { value: 'SIGNAL', label: 'Segnale' },
    { value: 'ROLL', label: 'Rullo' },
    { value: 'OTHER', label: 'Altro' }
];

/**
 * Come la parte, o il rigo attivo della partitura, salva e riceve i frammenti: intonata con la sua trasposizione e
 * l'estensione del suo strumento, di percussione con i suoni delle voci, oppure non può usarli e si dice perché.
 */
export type FragmentNotation = { kind: 'PITCHED'; instrument: RangeInstrument; name: string } | { kind: 'PERCUSSION'; keys: number[] } | { kind: 'blocked'; reason: string };

/** Il frammento costruito dalle battute selezionate, da salvare. */
export interface FragmentContent {
    kind: ScoreFragmentKind;
    xml: string;
    measureCount: number;
    percussionKeys: FragmentVoiceSound[];
}

/** Il frammento come sarà scritto nella parte: trasposto, nella chiave della parte e, per le percussioni, nelle sue voci. */
export interface PreparedFragment {
    score: ScoreDocument;
    /** Piano della trasposizione di un frammento intonato; `null` per le percussioni. */
    plan: DerivationPlan | null;
    /** Ottava scelta tra quelle del piano. */
    octave: number;
}

/** Ritornelli e volte di una battuta. */
interface MeasureStructure {
    forward: boolean;
    backward: boolean;
    endingStart: string | null;
    endingStop: { number: string; type: string } | null;
}

/**
 * Notazione della parte per i frammenti, come per la derivazione: un solo strumento intonato con la trasposizione
 * configurata, oppure percussioni con i loro suoni. `sound` è il suono della parte, con la trasposizione scelta per lei,
 * o del rigo; in una partitura in suoni reali della trasposizione resta l'ottava.
 */
export function fragmentNotation(instruments: readonly PlaybackInstrument[], sound: PlaybackSound, concertPitch = false): FragmentNotation {
    const drums = instruments.some((instrument) => instrument.percussionKey !== null && instrument.percussionKey !== undefined);
    if (drums || sound.percussionKeys.length) {
        return sound.percussionKeys.length ? { kind: 'PERCUSSION', keys: [...sound.percussionKeys] } : { kind: 'blocked', reason: 'Configura i suoni delle percussioni della parte per usare i frammenti' };
    }
    if (!instruments.length) return { kind: 'blocked', reason: 'Assegna uno strumento alla parte per usare i frammenti' };
    if (instruments.length > 1) return { kind: 'blocked', reason: 'I frammenti si usano nelle parti di un solo strumento intonato' };
    const [instrument] = instruments;
    if (sound.transpositionSemitones === null || sound.transpositionSemitones === undefined) {
        return { kind: 'blocked', reason: `Configura la trasposizione di ${instrument.name} per usare i frammenti` };
    }
    // L'estensione dello strumento vale solo se la parte usa la sua trasposizione.
    const own = concertPitch ? concertInstrument(instrument) : instrument;
    const ownRange = own.transpositionSemitones === sound.transpositionSemitones;
    return {
        kind: 'PITCHED',
        name: instrument.name,
        instrument: {
            transpositionSemitones: sound.transpositionSemitones,
            bassClefTranspositionSemitones: sound.bassClefTranspositionSemitones ?? null,
            lowestWrittenPitch: ownRange ? own.lowestWrittenPitch : null,
            highestWrittenPitch: ownRange ? own.highestWrittenPitch : null
        }
    };
}

/** Battute intere coperte dal passaggio, dalla prima all'ultima. */
export function passageMeasures(passage: Passage): [number, number] {
    const first = passage.from.measureIndex;
    const last = toNumber(passage.to.offset) === 0 && passage.to.measureIndex > first ? passage.to.measureIndex - 1 : passage.to.measureIndex;
    return [first, last];
}

/**
 * Il frammento delle battute indicate del rigo attivo: metro e armatura dell'inizio e i loro cambi, note, pause, segni di
 * espressione, ritornelli e volte interni. Una parte intonata va in suoni reali; una di percussione resta com'è, con il
 * suono di ogni voce che ha note.
 */
export function fragmentContent(score: ScoreDocument, from: number, to: number, notation: FragmentNotation): FragmentContent {
    if (notation.kind === 'blocked') throw new EditError(notation.reason);
    const first = Math.min(from, to);
    const last = Math.max(from, to);
    const count = last - first + 1;
    if (count > MAX_FRAGMENT_MEASURES) throw new EditError(`Un frammento ha al massimo ${MAX_FRAGMENT_MEASURES} battute: ne hai selezionate ${count}`);
    const measures = score.measures().slice(first, last + 1);
    if (measures.some((measure) => measure.getAttribute('implicit') === 'yes')) throw new EditError('La battuta in levare non entra in un frammento: seleziona dalla battuta seguente');
    if (measures.every((measure) => children(measure, 'note').every(isRest))) throw new EditError('Le battute selezionate hanno solo pause: un frammento ha almeno una nota');

    const clip = copyPassage(score, measuresPassage(score, first, last));
    const states = score.measureStates();
    const start = states[first];
    const percussion = notation.kind === 'PERCUSSION';
    const clef = percussion ? 'percussion' : (clefValue(start.clef) ?? 'G2');
    const fragment = openScore(newPartXml({ partName: 'Frammento', clef, fifths: start.fifths, beats: start.beats, beatType: start.beatType, tempo: null, measures: count, pickupBeats: 0 }));
    // La doppia barra finale della parte nuova non fa parte del frammento.
    for (const barline of children(fragment.measure(count - 1), 'barline')) barline.remove();
    for (let index = 1; index < count; index++) {
        const state = states[first + index];
        const previous = states[first + index - 1];
        if (state.beats !== previous.beats || state.beatType !== previous.beatType) setTime(fragment, index, state.beats, state.beatType);
        if (!percussion && state.fifths !== previous.fifths) setKey(fragment, index, state.fifths);
    }
    pastePassage(fragment, clip, { measureIndex: 0, voice: 1, offset: fraction(0) });
    balancedStructure(score, first, last).forEach((structure, index) => writeStructure(fragment.measure(index), structure));

    if (notation.kind === 'PITCHED') {
        const transposition = clefTransposition(notation.instrument, start.clef.sign) ?? 0;
        if (transposition !== 0) {
            const plan = planDerivation(fragment, transposition, { transpositionSemitones: 0 }, clef);
            if (plan.error) throw new EditError(`${plan.error}: il frammento non si può portare in suoni reali`);
            if (!plan.octaves.find((candidate) => candidate.octave === 0)?.possible) throw new EditError('In suoni reali le note del frammento uscirebbero dalle altezze scrivibili');
            applyDerivation(fragment, plan, 0);
        }
        return { kind: 'PITCHED', xml: fragment.cleanXml(), measureCount: count, percussionKeys: [] };
    }
    const voices = [
        ...new Set(
            fragment
                .notes()
                .filter((note) => !isRest(note))
                .map((note) => Number(voiceOf(note)) || 1)
        )
    ].sort((a, b) => a - b);
    const percussionKeys = voices.map((voice) => ({ voice, key: voiceDrum(notation.keys, voice)! }));
    return { kind: 'PERCUSSION', xml: fragment.cleanXml(), measureCount: count, percussionKeys };
}

/**
 * Perché il frammento non entra nella parte, o nel rigo attivo; `null` se entra. Un frammento di percussione chiede una
 * parte di percussione con tutti i suoi suoni, ognuno in una voce diversa.
 */
export function fragmentBlocker(fragment: ScoreFragment, notation: FragmentNotation): string | null {
    if (notation.kind === 'blocked') return notation.reason;
    if (fragment.kind === 'PERCUSSION') {
        if (notation.kind !== 'PERCUSSION') return 'Un frammento di percussione entra solo in una parte di percussione';
        const missing = missingSounds(fragment.percussionKeys, notation.keys);
        if (missing.length) return `Mancano nella parte ${missing.length === 1 ? 'il suono' : 'i suoni'} ${listed(missing.map((key) => drumSound(key).name))}`;
        return null;
    }
    return notation.kind === 'PITCHED' ? null : 'Un frammento intonato entra solo in una parte intonata';
}

/**
 * Il frammento come sarà scritto nella parte: un frammento intonato si traspone per lo strumento con il piano della
 * derivazione, all'ottava scelta o a quella proposta, e prende la chiave della parte; uno di percussione passa nelle voci
 * della parte con gli stessi suoni.
 *
 * @param clef chiave della parte dove entra il frammento, come valore di `CLEF_OPTIONS`
 */
export function prepareFragment(xml: string, fragment: ScoreFragment, notation: FragmentNotation, clef: string, octave: number | null = null): PreparedFragment {
    const blocker = fragmentBlocker(fragment, notation);
    if (blocker) throw new EditError(blocker);
    const score = openScore(xml);
    if (notation.kind === 'PERCUSSION') {
        const voices = voiceMap(fragment.percussionKeys, notation.keys);
        // Le voci di sole pause prendono numeri liberi, per non finire nelle voci dei suoni.
        const taken = new Set(voices.values());
        for (const voice of new Set(score.notes().map((note) => Number(voiceOf(note)) || 1))) {
            if (voices.has(voice)) continue;
            let free = 1;
            while (taken.has(free)) free++;
            taken.add(free);
            voices.set(voice, free);
        }
        for (const note of score.notes()) {
            const voice = child(note, 'voice') ?? insertOrdered(note, element(score.document, 'voice'), NOTE_ORDER);
            voice.textContent = String(voices.get(Number(voiceOf(note)) || 1) ?? 1);
        }
        replaceClefs(score, 'percussion');
        return { score, plan: null, octave: 0 };
    }
    if (notation.kind !== 'PITCHED') throw new EditError('Un frammento intonato entra solo in una parte intonata');
    const plan = planDerivation(score, 0, notation.instrument, clef);
    if (plan.error) throw new EditError(`${plan.error}: il frammento non si può scrivere per ${notation.name}`);
    const possible = plan.octaves.filter((candidate) => candidate.possible).map((candidate) => candidate.octave);
    const chosen = octave !== null && possible.includes(octave) ? octave : (plan.proposed ?? possible[0]);
    if (chosen === undefined) throw new EditError(`Nessuna ottava dà note scrivibili per ${notation.name}`);
    applyDerivation(score, plan, chosen);
    replaceClefs(score, clef);
    return { score, plan, octave: chosen };
}

/** Chiave della parte dove entra il frammento: quella in vigore prima della battuta indicata, o in fondo alla parte. */
export function insertionClef(score: ScoreDocument, before: number | null): string {
    const measures = score.measures();
    let state: MusicalState;
    if (before === null) state = score.stateAfter(measures[measures.length - 1]);
    else if (before === 0) state = score.stateAt(0);
    else state = score.stateBefore(measures[before]);
    return clefValue(state.clef) ?? 'G2';
}

/**
 * Inserisce il frammento preparato come battute nuove prima della battuta indicata, o in fondo alla parte. Metro e
 * armatura del frammento si scrivono dove cambiano e dopo il frammento tornano quelli della parte. Nella partitura le
 * battute, il metro, i ritornelli e le volte valgono per tutti i righi, mentre note e armature vanno nel rigo attivo.
 * Restituisce la prima nota del frammento, da selezionare.
 */
export function insertFragment(score: ScoreDocument, prepared: PreparedFragment, before: number | null, allRows = false): string | null {
    const fragment = prepared.score;
    const count = fragment.measures().length;
    const states = fragment.measureStates();
    const structures = fragment.measures().map(structureOf);
    const percussion = prepared.plan === null;
    const clip = copyPassage(fragment, measuresPassage(fragment, 0, count - 1));
    const index = before ?? score.measures().length;
    const atEnd = before === null;
    const rows = (change: () => void): void => {
        if (allRows) score.everyPart(change);
        else change();
    };
    if (!atEnd && !score.measures()[index]) throw new EditError('Battuta non trovata');

    // Stato della parte dove riprende dopo il frammento, da ogni rigo.
    const originals = new Map<Element, MusicalState>();
    if (!atEnd) rows(() => originals.set(score.part, score.stateAt(index)));
    rows(() => {
        if (atEnd) {
            const previous = score.measures().length - 1;
            let at = previous;
            for (let added = 0; added < count; added++) at = insertMeasure(score, at, 'after');
            moveFinalBarline(score.measure(previous), score.measure(at), !!structures[count - 1].backward || !!structures[count - 1].endingStop);
        } else {
            let at = insertMeasure(score, index, 'before');
            for (let added = 1; added < count; added++) at = insertMeasure(score, at, 'after');
            // La battuta che segue tiene metro e armatura della parte mentre cambiano quelli del frammento.
            pinState(score, index + count, originals.get(score.part)!);
        }
        for (let offset = 0; offset < count; offset++) {
            setTime(score, index + offset, states[offset].beats, states[offset].beatType);
            writeStructure(score.measure(index + offset), structures[offset]);
        }
    });
    if (!percussion) for (let offset = 0; offset < count; offset++) setKey(score, index + offset, states[offset].fifths);
    if (!atEnd) {
        rows(() => {
            const original = originals.get(score.part)!;
            setTime(score, index + count, original.beats, original.beatType);
            setKey(score, index + count, original.fifths);
        });
    }
    const result = pastePassage(score, clip, { measureIndex: index, voice: 1, offset: fraction(0) });
    return result.anchorId;
}

// Funzioni interne

/** Suoni del frammento che la parte non ha in voci distinte, una per suono. */
function missingSounds(sounds: readonly FragmentVoiceSound[], keys: readonly number[]): number[] {
    const voices = voiceMap(sounds, keys);
    return sounds.filter((sound) => !voices.has(sound.voice)).map((sound) => sound.key);
}

/** Voce della parte per ogni voce del frammento: una voce diversa con lo stesso suono, come nel lettore. */
function voiceMap(sounds: readonly FragmentVoiceSound[], keys: readonly number[]): Map<number, number> {
    const used = new Set<number>();
    const result = new Map<number, number>();
    for (const sound of [...sounds].sort((a, b) => a.voice - b.voice)) {
        const voice = VOICES.find((candidate) => !used.has(candidate) && voiceDrum(keys, candidate) === sound.key);
        if (voice === undefined) continue;
        used.add(voice);
        result.set(sound.voice, voice);
    }
    return result;
}

function listed(names: readonly string[]): string {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** Ritornelli e volte scritti nelle stanghette della battuta. */
function structureOf(measure: Element): MeasureStructure {
    const result: MeasureStructure = { forward: false, backward: false, endingStart: null, endingStop: null };
    for (const barline of children(measure, 'barline')) {
        const direction = child(barline, 'repeat')?.getAttribute('direction');
        if (direction === 'forward') result.forward = true;
        if (direction === 'backward') result.backward = true;
        for (const ending of children(barline, 'ending')) {
            const number = ending.getAttribute('number') || '1';
            const type = ending.getAttribute('type');
            if (type === 'start') result.endingStart = number;
            else if (type === 'stop' || type === 'discontinue') result.endingStop = { number, type };
        }
    }
    return result;
}

/**
 * Ritornelli e volte interni alle battute: un ritornello si tiene con il suo inizio e la sua fine, e quello che torna
 * all'inizio della parte riceve l'inizio esplicito; una volta si tiene se comincia e finisce tra le battute.
 */
function balancedStructure(score: ScoreDocument, first: number, last: number): MeasureStructure[] {
    const source = score
        .measures()
        .slice(first, last + 1)
        .map(structureOf);
    const result = source.map((): MeasureStructure => ({ forward: false, backward: false, endingStart: null, endingStop: null }));
    // Inizio del ritornello aperto: esplicito, o quello implicito all'inizio della parte o dopo un ritornello chiuso.
    let open: number | null = first === 0 ? 0 : null;
    for (const [index, structure] of source.entries()) {
        if (structure.forward) open = index;
        if (!structure.backward) continue;
        if (open !== null) {
            result[open].forward = true;
            result[index].backward = true;
        }
        open = index + 1 < source.length ? index + 1 : null;
    }
    let ending: { index: number; number: string } | null = null;
    for (const [index, structure] of source.entries()) {
        if (structure.endingStart !== null) ending = { index, number: structure.endingStart };
        if (structure.endingStop && ending) {
            result[ending.index].endingStart = ending.number;
            result[index].endingStop = structure.endingStop;
            ending = null;
        }
    }
    return result;
}

/** Scrive ritornelli e volte nelle stanghette di una battuta nuova. */
function writeStructure(measure: Element, structure: MeasureStructure): void {
    const owner = measure.ownerDocument;
    if (structure.forward || structure.endingStart !== null) {
        const left = barline(measure, 'left');
        if (structure.forward) {
            insertOrdered(left, element(owner, 'bar-style', 'heavy-light'), BARLINE_ORDER);
            insertOrdered(left, element(owner, 'repeat', null, { direction: 'forward' }), BARLINE_ORDER);
        }
        if (structure.endingStart !== null) insertOrdered(left, element(owner, 'ending', null, { number: structure.endingStart, type: 'start' }), BARLINE_ORDER);
    }
    if (structure.backward || structure.endingStop) {
        const right = barline(measure, 'right');
        if (structure.backward) {
            insertOrdered(right, element(owner, 'bar-style', 'light-heavy'), BARLINE_ORDER);
            insertOrdered(right, element(owner, 'repeat', null, { direction: 'backward' }), BARLINE_ORDER);
        }
        if (structure.endingStop) insertOrdered(right, element(owner, 'ending', null, { number: structure.endingStop.number, type: structure.endingStop.type }), BARLINE_ORDER);
    }
}

function barline(measure: Element, location: 'left' | 'right'): Element {
    const existing = children(measure, 'barline').find((item) => (item.getAttribute('location') ?? 'right') === location);
    if (existing) return existing;
    const created = element(measure.ownerDocument, 'barline', null, { location });
    if (location === 'right') return measure.appendChild(created);
    const print = child(measure, 'print');
    if (print) print.after(created);
    else measure.insertBefore(created, measure.firstElementChild);
    return created;
}

/**
 * La doppia barra finale passa dall'ultima battuta della parte all'ultima del frammento; se questa chiude un ritornello o
 * una volta, la doppia barra si toglie.
 */
function moveFinalBarline(from: Element, to: Element, closed: boolean): void {
    const final = children(from, 'barline').find((item) => (item.getAttribute('location') ?? 'right') === 'right' && children(item).length === 1 && child(item, 'bar-style')?.textContent?.trim() === 'light-heavy');
    if (!final) return;
    final.remove();
    if (!closed) to.appendChild(final);
}

/** Scrive nella battuta metro e armatura indicati, anche se uguali a quelli della battuta precedente. */
function pinState(score: ScoreDocument, index: number, state: MusicalState): void {
    const owner = score.document;
    const attributes = leadingAttributes(score.measure(index), true)!;
    if (!child(attributes, 'key')) insertOrdered(attributes, element(owner, 'key'), ATTRIBUTES_ORDER).appendChild(element(owner, 'fifths', state.fifths));
    if (!child(attributes, 'time')) {
        const time = insertOrdered(attributes, element(owner, 'time'), ATTRIBUTES_ORDER);
        time.append(element(owner, 'beats', state.beats), element(owner, 'beat-type', state.beatType));
    }
}

/** Il frammento prende la chiave della parte: una sola, all'inizio. */
function replaceClefs(score: ScoreDocument, value: string): void {
    const spec = (CLEF_OPTIONS.find((option) => option.value === value) ?? CLEF_OPTIONS[0]).clef;
    for (const clef of Array.from(score.document.getElementsByTagName('clef'))) {
        const attributes = clef.parentElement;
        clef.remove();
        if (attributes && !attributes.children.length) attributes.remove();
    }
    const owner = score.document;
    const clef = insertOrdered(leadingAttributes(score.measure(0), true)!, element(owner, 'clef'), ATTRIBUTES_ORDER);
    insertOrdered(clef, element(owner, 'sign', spec.sign), CLEF_ORDER);
    if (spec.sign !== 'percussion') insertOrdered(clef, element(owner, 'line', spec.line), CLEF_ORDER);
    if (spec.octaveChange) insertOrdered(clef, element(owner, 'clef-octave-change', spec.octaveChange), CLEF_ORDER);
}
