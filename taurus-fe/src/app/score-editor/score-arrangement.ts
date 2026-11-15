/**
 * Partitura della traccia: un documento con una parte per rigo, creato dall'organico o dalle parti della traccia, con
 * la struttura comune a tutti i righi. Qui stanno la creazione, l'allineamento delle parti alla parte di riferimento, i
 * righi aggiunti e tolti nell'editor, l'armatura in suoni reali, i passaggi su tutti i righi e il disegno con i righi
 * nascosti.
 */

import { ArrangementRowRequest, PlaybackInstrument, PlaybackSound } from '../module';
import { child, children, element, insertAtStart, integer } from './musicxml-dom';
import { newPartXml, proposedClef, writtenFifths } from './new-part';
import { CLEF_OPTIONS, fraction, NOTE_TYPES, toNumber } from './notation-rules';
import { clefTransposition, derivedPartXml, initialClef, RangeInstrument } from './score-derivation';
import { EditError, ROW_INSTRUMENTS_ATTRIBUTE, ScoreDocument } from './score-document';
import { insertAtEnd, leadingAttributes, setKey, setTime } from './score-edits';
import { clearPassage, copyPassage, Passage, pastePassage, ScoreClip } from './score-passage';
import { measureLength } from './score-writing';

/** Righi al massimo in una partitura, come il limite del backend. */
export const MAX_ROWS = 60;

/** Un rigo della partitura nell'editor: la parte del MusicXML, il nome e gli strumenti, uno o più a percussione. */
export interface EditorRow {
    id: string;
    name: string;
    instruments: PlaybackInstrument[];
}

/** Strumento di un rigo, come lo restituisce il backend o il catalogo degli strumenti. */
export interface RowInstrument extends RangeInstrument {
    id: number;
    name: string;
    percussionKey?: number | null;
}

/** Rigo previsto in una partitura nuova: il nome e gli strumenti, uno o più a percussione. */
export interface PlannedRow<T extends RowInstrument = RowInstrument> {
    name: string;
    instruments: T[];
}

/** Impostazioni di un rigo di una partitura nuova dall'organico. */
export interface NewRowSetup {
    name: string;
    /** Valore di `CLEF_OPTIONS`. */
    clef: string;
    /** Armatura scritta sul rigo. */
    fifths: number;
}

/** Impostazioni comuni di una partitura nuova dall'organico. */
export interface NewArrangementSetup {
    rows: NewRowSetup[];
    beats: number;
    beatType: number;
    tempo: number | null;
    measures: number;
    pickupBeats: number;
    /** Scritta in suoni reali; altrimenti trasposta. */
    concertPitch: boolean;
}

/** Una parte della traccia allineata alla parte di riferimento, con ciò che è cambiato. */
export interface AlignedPart {
    xml: string;
    /** «4 battute in meno, completate con pause», «Metro diverso nelle battute 12 e 13». */
    changes: string[];
}

/** Battute intere copiate da tutti i righi, una copia per rigo. */
export interface RowsClip {
    clips: ScoreClip[];
    label: string;
}

/** Un rigo da aggiungere nell'editor. */
export interface NewRow {
    name: string;
    instrumentIds: number[];
    clef: string;
    /** Armatura scritta del nuovo rigo, dall'armatura scritta del rigo di riferimento nello stesso punto. */
    fifths: (referenceFifths: number) => number;
}

/** Elementi delle direzioni che fanno parte della struttura comune: segni, lettere di prova e tempo. */
const STRUCTURE_TYPES = ['segno', 'coda', 'rehearsal', 'metronome'];
/** Attributi di `<sound>` della struttura: tempo, segni e salti. */
const STRUCTURE_SOUNDS = ['tempo', 'segno', 'coda', 'tocoda', 'dacapo', 'dalsegno', 'fine'];

// Righi e strumenti

/** Il rigo è di percussione: uno o più strumenti con una nota di batteria. */
export function isPercussionRow(instruments: readonly RowInstrument[]): boolean {
    return instruments.some((instrument) => instrument.percussionKey !== null && instrument.percussionKey !== undefined);
}

/**
 * Trasposizione del rigo nella chiave indicata, come nell'ascolto: quella del suo strumento, 0 per i righi di
 * percussione; `null` se lo strumento non ha la trasposizione configurata.
 */
export function rowTransposition(instruments: readonly RowInstrument[], clefSign: string): number | null {
    if (!instruments.length || isPercussionRow(instruments)) return 0;
    return clefTransposition(instruments[0], clefSign);
}

/**
 * Semitoni con cui un rigo trasposto si scrive in suoni reali: la trasposizione dello strumento senza le ottave, che una
 * partitura in suoni reali conserva (MusicXML 4.0): il sax tenore scende di una seconda, non di una nona.
 */
export function concertSemitones(transposition: number): number {
    const remainder = Math.abs(transposition) % 12;
    return transposition < 0 ? -remainder : remainder;
}

/** Ordine dei righi: quelli degli strumenti dell'organico nel suo ordine, poi gli altri nell'ordine dato. */
export function byEnsembleOrder<T>(items: readonly T[], ensemble: readonly number[], instrumentIds: (item: T) => readonly number[]): T[] {
    const ranks = new Map(ensemble.map((id, index) => [id, index]));
    const rank = (item: T) => Math.min(Infinity, ...instrumentIds(item).map((id) => ranks.get(id) ?? Infinity));
    return items
        .map((item, index) => ({ item, index, rank: rank(item) }))
        .sort((first, second) => (first.rank === second.rank ? 0 : first.rank - second.rank) || first.index - second.index)
        .map(({ item }) => item);
}

// Partitura nuova

/** Righi di una partitura dall'organico: uno per strumento intonato, e uno per tutte le percussioni, dove sta la prima. */
export function ensembleRows<T extends RowInstrument>(instruments: readonly T[]): PlannedRow<T>[] {
    const rows: PlannedRow<T>[] = [];
    let percussion: PlannedRow<T> | null = null;
    for (const instrument of instruments) {
        if (!isPercussionRow([instrument])) {
            rows.push({ name: instrument.name, instruments: [instrument] });
            continue;
        }
        if (!percussion) {
            percussion = { name: '', instruments: [] };
            rows.push(percussion);
        }
        percussion.instruments.push(instrument);
    }
    if (percussion) percussion.name = percussion.instruments.length === 1 ? percussion.instruments[0].name : 'Percussioni';
    return rows;
}

/**
 * Chiave e armatura scritta di un rigo nuovo: la chiave proposta dagli strumenti e, dalla tonalità in suoni reali,
 * l'armatura trasposta per lo strumento, o la stessa in una partitura in suoni reali. `unconfigured` se lo strumento non
 * ha la trasposizione: il rigo si scrive come uno strumento in Do.
 */
export function rowSetup(row: PlannedRow, concertKey: number, concertPitch: boolean): { setup: NewRowSetup; unconfigured: boolean } {
    const clef = proposedClef(row.instruments);
    if (clef === 'percussion') return { setup: { name: row.name, clef, fifths: 0 }, unconfigured: false };
    if (concertPitch) return { setup: { name: row.name, clef, fifths: concertKey }, unconfigured: false };
    const sign = (CLEF_OPTIONS.find((option) => option.value === clef) ?? CLEF_OPTIONS[0]).clef.sign;
    const transposition = rowTransposition(row.instruments, sign);
    return { setup: { name: row.name, clef, fifths: transposition === null ? concertKey : writtenFifths(concertKey, transposition) }, unconfigured: transposition === null };
}

/** MusicXML di una partitura nuova dall'organico: un rigo di pause per strumento, con la stessa struttura. */
export function newArrangementXml(setup: NewArrangementSetup): string {
    if (!setup.rows.length) throw new EditError('Scegli almeno un rigo');
    if (setup.rows.length > MAX_ROWS) throw new EditError(`La partitura ha al massimo ${MAX_ROWS} righi`);
    const parts = setup.rows.map((row) => newPartXml({ partName: row.name, clef: row.clef, fifths: row.fifths, beats: setup.beats, beatType: setup.beatType, tempo: setup.tempo, measures: setup.measures, pickupBeats: setup.pickupBeats }));
    return combineParts(
        parts.map((xml, index) => ({ xml, name: setup.rows[index].name })),
        setup.concertPitch
    );
}

/**
 * Unisce parti singole in una partitura, nell'ordine dato, con gli `id` P1, P2…: i nomi dei righi, la notazione in suoni
 * reali segnata con `<concert-score/>` e senza gli strumenti MIDI e le trasposizioni dei file di origine.
 */
export function combineParts(parts: readonly { xml: string; name: string }[], concertPitch: boolean): string {
    if (!parts.length) throw new EditError('Scegli almeno un rigo');
    const document = new DOMParser().parseFromString('<score-partwise version="4.0"/>', 'application/xml');
    const root = document.documentElement;
    if (concertPitch) root.appendChild(element(document, 'defaults')).append(element(document, 'concert-score'));
    const partList = root.appendChild(element(document, 'part-list'));
    parts.forEach((source, index) => {
        const id = `P${index + 1}`;
        const parsed = new DOMParser().parseFromString(source.xml, 'application/xml');
        const part = children(parsed.documentElement, 'part')[0];
        if (parsed.getElementsByTagName('parsererror').length || !part) throw new EditError(`La parte «${source.name}» non è leggibile`);
        const scorePart = element(document, 'score-part', null, { id });
        scorePart.append(element(document, 'part-name', source.name.trim() || `Rigo ${index + 1}`));
        partList.append(scorePart);
        const imported = document.importNode(part, true) as Element;
        imported.setAttribute('id', id);
        root.append(imported);
    });
    for (const name of ['transpose', 'score-instrument', 'midi-device', 'midi-instrument']) {
        for (const item of Array.from(document.getElementsByTagName(name))) item.remove();
    }
    for (const note of Array.from(document.getElementsByTagName('note'))) for (const item of children(note, 'instrument')) item.remove();
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(document)}`;
}

/**
 * Allinea le parti alla parte di riferimento per posizione: le battute mancanti si completano con pause, quelle in più si
 * tolgono, e ritornelli, volte, segni, salti, metro, tempo, lettere di prova e numeri di battuta sono quelli della parte
 * di riferimento. Le armature restano quelle di ogni parte.
 */
export function alignParts(xmls: readonly string[], referenceIndex: number): AlignedPart[] {
    const reference = ScoreDocument.open(xmls[referenceIndex]);
    const sources = reference.measures();
    const states = reference.measureStates();
    return xmls.map((xml, index) => {
        if (index === referenceIndex) return { xml: reference.cleanXml(), changes: [] };
        const score = ScoreDocument.open(xml);
        const changes: string[] = [];
        const count = score.measures().length;
        if (count < sources.length) {
            const missing = sources.length - count;
            for (let added = 0; added < missing; added++) appendRestMeasure(score);
            changes.push(missing === 1 ? '1 battuta in meno, completata con pause' : `${missing} battute in meno, completate con pause`);
        } else if (count > sources.length) {
            const extra = count - sources.length;
            for (const measure of score.measures().slice(sources.length)) measure.remove();
            changes.push(extra === 1 ? '1 battuta in più, tolta' : `${extra} battute in più, tolte`);
        }
        const measures = score.measures();
        if (sources.some((source, position) => barlinesOf(source) !== barlinesOf(measures[position]))) changes.push('Ritornelli diversi: si usano quelli della parte di riferimento');
        if (sources.some((source, position) => structureOf(source) !== structureOf(measures[position]))) changes.push('Segni, salti, tempo o lettere di prova diversi: si usano quelli della parte di riferimento');
        const own = score.measureStates();
        const meters = sources.map((source, position) => position).filter((position) => own[position].beats !== states[position].beats || own[position].beatType !== states[position].beatType);
        if (meters.length) {
            const numbers = meters.map((position) => sources[position].getAttribute('number') ?? String(position + 1));
            changes.push(`Metro diverso ${numbers.length === 1 ? `nella battuta ${numbers[0]}` : `nelle battute ${numbers.slice(0, -1).join(', ')} e ${numbers[numbers.length - 1]}`}`);
        }
        sources.forEach((source, position) => copyStructure(score, source, position, states));
        return { xml: score.cleanXml(), changes };
    });
}

/**
 * Rigo trasposto scritto in suoni reali, dalla trasposizione del suo strumento: le note scendono o salgono
 * dell'intervallo senza le ottave, con armature e grafie ricalcolate. Percussioni e strumenti in Do non cambiano.
 */
export function concertPartXml(xml: string, transposition: number, name: string): string {
    const semitones = concertSemitones(transposition);
    if (semitones === 0) return xml;
    const score = ScoreDocument.open(xml);
    const octave = (semitones - transposition) / 12;
    return derivedPartXml(xml, transposition, { transpositionSemitones: 0 }, initialClef(score), octave, name);
}

// Righi nell'editor

/** Nome del rigo nel MusicXML. */
export function rowName(score: ScoreDocument, index: number): string {
    const id = score.parts()[index]?.getAttribute('id');
    const scorePart = scoreParts(score).find((candidate) => candidate.getAttribute('id') === id);
    return child(scorePart, 'part-name')?.textContent?.trim() || `Rigo ${index + 1}`;
}

/**
 * Aggiunge un rigo di pause nella posizione indicata, con la struttura del rigo di riferimento: battute, metro,
 * ritornelli, volte, segni, tempo e lettere di prova; l'armatura viene dalla sua. Restituisce l'`id` del rigo, che
 * diventa quello attivo.
 */
export function addRow(score: ScoreDocument, row: NewRow, position: number, referenceIndex = 0): string {
    if (score.parts().length >= MAX_ROWS) throw new EditError(`La partitura ha al massimo ${MAX_ROWS} righi`);
    const owner = score.document;
    const id = newRowId(score);
    score.selectPart(referenceIndex);
    const states = score.measureStates();
    const lengths = score.measures().map((_, index) => measureLength(score, index));
    const clef = (CLEF_OPTIONS.find((option) => option.value === row.clef) ?? CLEF_OPTIONS[0]).clef;
    const part = element(owner, 'part', null, { id });
    let previousFifths: number | null = null;
    score.measures().forEach((source, index) => {
        const measure = element(owner, 'measure', null, { id: score.newId('m') });
        for (const name of ['number', 'implicit']) if (source.hasAttribute(name)) measure.setAttribute(name, source.getAttribute(name)!);
        const state = states[index];
        const previous = index > 0 ? states[index - 1] : null;
        const attributes = element(owner, 'attributes');
        if (!previous || previous.divisions !== state.divisions) attributes.append(element(owner, 'divisions', state.divisions));
        const fifths = row.fifths(state.fifths);
        if (previousFifths === null || fifths !== previousFifths) attributes.appendChild(element(owner, 'key')).append(element(owner, 'fifths', fifths));
        previousFifths = fifths;
        if (!previous || previous.beats !== state.beats || previous.beatType !== state.beatType) {
            const time = attributes.appendChild(element(owner, 'time'));
            time.append(element(owner, 'beats', state.beats), element(owner, 'beat-type', state.beatType));
        }
        if (index === 0) {
            const clefElement = attributes.appendChild(element(owner, 'clef'));
            clefElement.append(element(owner, 'sign', clef.sign));
            if (clef.sign !== 'percussion') clefElement.append(element(owner, 'line', clef.line));
            if (clef.octaveChange) clefElement.append(element(owner, 'clef-octave-change', clef.octaveChange));
        }
        if (attributes.children.length) measure.append(attributes);
        for (const note of restNotes(owner, lengths[index], state.divisions, source.getAttribute('implicit') === 'yes')) measure.append(note);
        copyStructureInto(measure, source);
        part.append(measure);
    });
    const parts = score.parts();
    const at = Math.max(0, Math.min(position, parts.length));
    const scorePart = element(owner, 'score-part', null, { id, [ROW_INSTRUMENTS_ATTRIBUTE]: row.instrumentIds.join(' ') });
    scorePart.append(element(owner, 'part-name', row.name.trim() || `Rigo ${at + 1}`));
    const list = child(owner.documentElement, 'part-list') ?? owner.documentElement.insertBefore(element(owner, 'part-list'), parts[0] ?? null);
    list.insertBefore(scorePart, scoreParts(score)[at] ?? null);
    owner.documentElement.insertBefore(part, parts[at] ?? null);
    score.selectPart(at);
    score.assignIds();
    return id;
}

/** Segna sui righi i loro strumenti, che seguono il documento nella cronologia e nel salvataggio. */
export function annotateRows(score: ScoreDocument, rows: readonly { id: string; instrumentIds: readonly number[] }[]): void {
    for (const scorePart of scoreParts(score)) {
        const row = rows.find((candidate) => candidate.id === scorePart.getAttribute('id'));
        if (row) scorePart.setAttribute(ROW_INSTRUMENTS_ATTRIBUTE, row.instrumentIds.join(' '));
    }
}

/** I righi da salvare, nell'ordine delle parti, con i loro strumenti. */
export function rowRequests(score: ScoreDocument): ArrangementRowRequest[] {
    const lists = new Map(scoreParts(score).map((scorePart) => [scorePart.getAttribute('id'), scorePart]));
    return score.parts().map((part) => {
        const id = part.getAttribute('id') ?? '';
        return { id, instrumentIds: instrumentIdsOf(lists.get(id)) };
    });
}

/** Strumenti del rigo segnati sul documento. */
export function rowInstrumentIds(score: ScoreDocument, index: number): number[] {
    const id = score.parts()[index]?.getAttribute('id');
    return instrumentIdsOf(scoreParts(score).find((candidate) => candidate.getAttribute('id') === id));
}

/** La partitura è scritta in suoni reali. */
export function isConcertScore(score: ScoreDocument): boolean {
    return !!child(child(score.document.documentElement, 'defaults'), 'concert-score');
}

/** Suono del rigo per l'ascolto e le note suonate: quello del suo strumento, o i suoni di batteria delle percussioni. */
export function rowSound(instruments: readonly PlaybackInstrument[]): PlaybackSound {
    const drums = instruments.filter((instrument) => instrument.percussionKey !== null && instrument.percussionKey !== undefined);
    if (drums.length) return { percussionKeys: drums.map((instrument) => instrument.percussionKey!), configured: true, conflicting: false };
    const instrument = instruments[0];
    return {
        transpositionSemitones: instrument?.transpositionSemitones ?? null,
        bassClefTranspositionSemitones: instrument?.bassClefTranspositionSemitones ?? null,
        soundBank: instrument?.soundBank ?? null,
        soundProgram: instrument?.soundProgram ?? null,
        percussionKeys: [],
        configured: !!instrument?.configured,
        conflicting: false
    };
}

/** MusicXML di un solo rigo, per ascoltarlo. */
export function rowXml(xml: string, index: number): string {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const root = document.documentElement;
    const parts = children(root, 'part');
    const kept = parts[index]?.getAttribute('id');
    for (const part of parts) if (part.getAttribute('id') !== kept) part.remove();
    for (const scorePart of children(child(root, 'part-list'), 'score-part')) if (scorePart.getAttribute('id') !== kept) scorePart.remove();
    return new XMLSerializer().serializeToString(document);
}

/**
 * Per ogni pentagramma disegnato, dall'alto, la posizione del suo rigo nel documento: i righi nascosti non si disegnano e
 * un rigo può avere più pentagrammi.
 */
export function staffRows(score: ScoreDocument, hidden: ReadonlySet<string>): number[] {
    const parts = score.parts();
    let shown = parts.map((part, index) => ({ part, index })).filter(({ part }) => !hidden.has(part.getAttribute('id') ?? ''));
    if (!shown.length) shown = parts.map((part, index) => ({ part, index }));
    return shown.flatMap(({ part, index }) => {
        const staves = Math.max(1, ...Array.from(part.getElementsByTagName('staves')).map((item) => integer(item) ?? 1));
        return Array.from({ length: staves }, () => index);
    });
}

/** Posizione della battuta nel suo rigo, da 0. */
export function measurePosition(measure: Element): number {
    return children(measure.parentElement, 'measure').indexOf(measure);
}

/** Chiave iniziale del rigo, per la trasposizione in chiave di basso. */
export function rowClefSign(score: ScoreDocument, index: number): string {
    return score.parts()[index]?.querySelector('measure > attributes > clef > sign')?.textContent?.trim() || 'G';
}

/** Toglie il rigo; il rigo attivo diventa quello sopra, o il primo. */
export function removeRow(score: ScoreDocument, index: number): void {
    const parts = score.parts();
    if (parts.length <= 1) throw new EditError('La partitura ha almeno un rigo');
    const part = parts[index];
    if (!part) throw new EditError('Rigo non trovato');
    const id = part.getAttribute('id');
    const active = score.partIndex;
    scoreParts(score)
        .find((candidate) => candidate.getAttribute('id') === id)
        ?.remove();
    part.remove();
    score.selectPart(active === index ? Math.max(0, index - 1) : active > index ? active - 1 : active);
}

/** Esegue l'operazione su tutti i righi e restituisce il risultato del rigo attivo, per esempio la nota da selezionare. */
export function onEveryRow<T>(score: ScoreDocument, change: () => T): T {
    const active = score.partIndex;
    const results = score.everyPart(() => change());
    return results[active];
}

/**
 * Armatura scelta in suoni reali per tutti i righi dalla battuta indicata: ogni rigo trasposto la scrive secondo la
 * trasposizione del suo strumento; i righi di percussione non cambiano.
 */
export function setConcertKey(score: ScoreDocument, index: number, concertFifths: number, rows: readonly EditorRow[], concertPitch: boolean): void {
    score.everyPart((position) => {
        const row = rows[position];
        if (!row || isPercussionRow(row.instruments)) return;
        const transposition = concertPitch ? 0 : rowTransposition(row.instruments, score.stateAt(index).clef.sign);
        if (transposition === null) throw new EditError(`Configura la trasposizione di ${row.instruments[0]?.name ?? row.name} per scriverne l'armatura`);
        setKey(score, index, concertPitch ? concertFifths : writtenFifths(concertFifths, transposition));
    });
}

/** Passaggio di battute intere del rigo attivo, dalla prima all'ultima indicata. */
export function measuresPassage(score: ScoreDocument, from: number, to: number): Passage {
    const last = Math.max(from, to);
    return { voice: 1, from: { measureIndex: Math.min(from, to), offset: fraction(0) }, to: { measureIndex: last, offset: fraction(measureLength(score, last), score.stateAt(last).divisions) }, wholeMeasures: true };
}

/** Copia le battute indicate di tutti i righi. */
export function copyRows(score: ScoreDocument, from: number, to: number): RowsClip {
    const clips = score.everyPart(() => copyPassage(score, measuresPassage(score, from, to)));
    const count = Math.abs(to - from) + 1;
    return { clips, label: `${count} ${count === 1 ? 'battuta' : 'battute'} di tutti i righi` };
}

/** Incolla le battute copiate da tutti i righi dalla battuta indicata, in una partitura con gli stessi righi. */
export function pasteRows(score: ScoreDocument, clip: RowsClip, measureIndex: number): void {
    if (clip.clips.length !== score.parts().length) throw new EditError(`Le battute copiate hanno ${clip.clips.length} righi: si incollano in una partitura con gli stessi righi`);
    score.everyPart((position) => pastePassage(score, clip.clips[position], { measureIndex, voice: 1, offset: fraction(0) }));
}

/** Le battute indicate di tutti i righi tornano pause di battuta. */
export function clearRows(score: ScoreDocument, from: number, to: number): void {
    score.everyPart(() => clearPassage(score, measuresPassage(score, from, to)));
}

/** Il rigo ha solo pause. */
export function emptyRow(score: ScoreDocument, index: number): boolean {
    const part = score.parts()[index];
    return !!part && Array.from(part.getElementsByTagName('note')).every((note) => !!child(note, 'rest'));
}

/**
 * MusicXML da disegnare: senza i righi nascosti, che restano nel documento, e con i segni della struttura solo sul primo
 * rigo mostrato, come in una partitura stampata. Se tutti i righi sono nascosti si mostrano tutti.
 */
export function displayedXml(snapshot: string, hidden: ReadonlySet<string>): string {
    const document = new DOMParser().parseFromString(snapshot, 'application/xml');
    const root = document.documentElement;
    const parts = children(root, 'part');
    const shown = parts.filter((part) => !hidden.has(part.getAttribute('id') ?? ''));
    if (!shown.length) return snapshot;
    const list = child(root, 'part-list');
    for (const part of parts) {
        if (shown.includes(part)) continue;
        const id = part.getAttribute('id');
        children(list, 'score-part')
            .find((candidate) => candidate.getAttribute('id') === id)
            ?.remove();
        part.remove();
    }
    for (const part of shown.slice(1)) {
        for (const measure of children(part, 'measure')) for (const item of children(measure).filter(isStructureDirection)) item.remove();
    }
    return new XMLSerializer().serializeToString(document);
}

/** La direzione, o il suono, fa parte della struttura comune: segni, salti, tempo o lettere di prova. */
export function isStructureDirection(item: Element): boolean {
    if (item.tagName === 'sound') return STRUCTURE_SOUNDS.some((attribute) => item.hasAttribute(attribute));
    if (item.tagName !== 'direction') return false;
    if (children(item, 'direction-type').some((type) => children(type).some((mark) => STRUCTURE_TYPES.includes(mark.tagName)))) return true;
    const sound = child(item, 'sound');
    return !!sound && STRUCTURE_SOUNDS.some((attribute) => sound.hasAttribute(attribute));
}

// Funzioni interne

function scoreParts(score: ScoreDocument): Element[] {
    return children(child(score.document.documentElement, 'part-list'), 'score-part');
}

function instrumentIdsOf(scorePart: Element | undefined): number[] {
    return (scorePart?.getAttribute(ROW_INSTRUMENTS_ATTRIBUTE) ?? '')
        .split(' ')
        .filter(Boolean)
        .map(Number)
        .filter((id) => Number.isInteger(id));
}

/** Primo `id` P1, P2… non usato da un rigo. */
function newRowId(score: ScoreDocument): string {
    const used = new Set([...score.parts(), ...scoreParts(score)].map((item) => item.getAttribute('id')));
    let number = 1;
    while (used.has(`P${number}`)) number++;
    return `P${number}`;
}

/** Aggiunge in fondo alla parte una battuta di pause, con il metro dell'ultima. */
function appendRestMeasure(score: ScoreDocument): void {
    const measures = score.measures();
    const last = measures[measures.length - 1];
    const state = score.stateAfter(last);
    const measure = element(score.document, 'measure', null, { number: '', id: score.newId('m') });
    for (const note of restNotes(score.document, score.expectedLength(state), state.divisions, false)) measure.append(note);
    last.after(measure);
    score.assignIds();
}

/** Pause di una battuta: la pausa di battuta, o per una levare le pause della sua durata, dalla più lunga. */
function restNotes(owner: Document, duration: number, divisions: number, pickup: boolean): Element[] {
    const rest = (length: number, type: string | null) => {
        const note = element(owner, 'note');
        note.append(type ? element(owner, 'rest') : element(owner, 'rest', null, { measure: 'yes' }));
        note.append(element(owner, 'duration', Math.round(length)), element(owner, 'voice', 1));
        if (type) note.append(element(owner, 'type', type));
        return note;
    };
    if (!pickup) return [rest(duration, null)];
    const notes: Element[] = [];
    let left = duration;
    for (const option of NOTE_TYPES) {
        const size = toNumber(option.quarters) * divisions;
        if (!Number.isInteger(size) || size <= 0) continue;
        while (left >= size) {
            notes.push(rest(size, option.type));
            left -= size;
        }
    }
    return notes.length ? notes : [rest(duration, null)];
}

/**
 * Ritornelli e volte della battuta, per confrontare le parti; le altre stanghette, come la doppia barra finale di una
 * parte più corta, non sono una differenza da segnalare.
 */
function barlinesOf(measure: Element | undefined): string {
    return children(measure, 'barline')
        .filter((barline) => !!child(barline, 'repeat') || !!child(barline, 'ending'))
        .map(
            (barline) =>
                `${barline.getAttribute('location') ?? 'right'}:${children(barline, 'repeat')
                    .map((repeat) => repeat.getAttribute('direction'))
                    .join()}:${children(barline, 'ending')
                    .map((ending) => `${ending.getAttribute('number')}/${ending.getAttribute('type')}`)
                    .join()}`
        )
        .join('|');
}

/** Segni, salti, tempo e lettere di prova della battuta, per confrontare le parti. */
function structureOf(measure: Element | undefined): string {
    const serializer = new XMLSerializer();
    return children(measure)
        .filter(isStructureDirection)
        .map((item) => serializer.serializeToString(item).replace(/ id="[^"]*"/g, ''))
        .join('');
}

/** Porta nella battuta della parte la struttura della battuta di riferimento: numero, metro, stanghette e direzioni. */
function copyStructure(score: ScoreDocument, source: Element, position: number, states: readonly { beats: number; beatType: number }[]): void {
    const measure = score.measure(position);
    for (const name of ['number', 'implicit']) {
        if (source.hasAttribute(name)) measure.setAttribute(name, source.getAttribute(name)!);
        else measure.removeAttribute(name);
    }
    const state = states[position];
    const explicit = children(source, 'attributes').some((attributes) => !!child(attributes, 'time'));
    const own = !!child(leadingAttributes(measure), 'time');
    if (explicit || own) {
        // Senza un cambio di metro nella parte di riferimento, il metro della parte torna quello precedente.
        const previous = position > 0 ? score.stateAt(position - 1) : null;
        const beats = explicit || !previous ? state.beats : previous.beats;
        const beatType = explicit || !previous ? state.beatType : previous.beatType;
        setTime(score, position, beats, beatType);
    }
    for (const item of children(measure).filter((node) => node.tagName === 'barline' || isStructureDirection(node))) item.remove();
    copyStructureInto(measure, source);
}

/** Copia stanghette e direzioni della struttura: quelle prima della prima nota all'inizio, le altre alla fine. */
function copyStructureInto(measure: Element, source: Element): void {
    let started = false;
    const atStart: Element[] = [];
    const atEnd: Element[] = [];
    for (const item of children(source)) {
        if (item.tagName === 'note') started = true;
        if (item.tagName === 'barline') {
            ((item.getAttribute('location') ?? 'right') === 'left' ? atStart : atEnd).push(item);
        } else if (isStructureDirection(item)) {
            (started ? atEnd : atStart).push(item);
        }
    }
    const owner = measure.ownerDocument;
    for (const item of atStart.reverse()) {
        const copy = owner.importNode(item, true) as Element;
        if (copy.tagName === 'barline') measure.insertBefore(copy, children(measure).find((node) => !['print', 'attributes'].includes(node.tagName)) ?? null);
        else insertAtStart(measure, copy);
    }
    for (const item of atEnd) {
        const copy = owner.importNode(item, true) as Element;
        if (copy.tagName === 'barline') measure.append(copy);
        else insertAtEnd(measure, copy);
    }
}
