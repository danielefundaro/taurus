import { children } from './musicxml-dom';
import { ScoreDocument } from './score-document';

/** Righi e battute toccati da una modifica, per ridisegnare e ricontrollare solo quelli. */
export interface DocumentChange {
    /** Posizioni dei righi cambiati. */
    rows: ReadonlySet<number>;
    /** `id` delle battute cambiate, aggiunte o tolte. */
    measures: ReadonlySet<string>;
}

/** L'istantanea del documento prima di una modifica, o la funzione che la ricava solo se serve. */
export type Before = string | (() => string);

/** Cronologia di Annulla e Ripristina dell'editor. */
export interface DocumentHistory {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** Righi e battute dell'ultima modifica registrata, annullata o ripristinata; `null` se è cambiato tutto o non si sa. */
    readonly lastChange: DocumentChange | null;
    /** Il documento prima di una modifica, da ricavare solo se serve: per ripristinarlo se la modifica non riesce. */
    checkpoint(score: ScoreDocument): () => string;
    /**
     * Registra una modifica appena fatta al documento: `before` è l'istantanea di prima; con `merge` la modifica si unisce
     * alla precedente, come i tasti tenuti premuti.
     */
    record(score: ScoreDocument, before: Before, merge: boolean): void;
    /** Annulla l'ultima modifica: il documento da usare, lo stesso o uno ricostruito; `null` se non c'è nulla da annullare. */
    undo(score: ScoreDocument): ScoreDocument | null;
    redo(score: ScoreDocument): ScoreDocument | null;
    /** Il documento è cambiato da quando è stato aperto. */
    modified(score: ScoreDocument): boolean;
    /** Legge il documento aperto, se non l'ha ancora fatto: dopo la prima pagina, perché l'apertura non lo attenda. */
    prepare(): void;
    /** Smette di seguire il documento. */
    dispose(): void;
}

/** Battute di un rigo prima e dopo una modifica, per `id`. */
interface PartChange {
    index: number;
    beforeIds: string[];
    afterIds: string[];
}

/** Una modifica: le battute cambiate di ogni rigo, oppure il documento intero quando cambiano i righi o l'intestazione. */
type HistoryEntry = { kind: 'measures'; parts: PartChange[]; before: Map<string, string>; after: Map<string, string> } | { kind: 'document'; before: string; after: string };

/** Il documento come lo vede la cronologia: ciò che sta fuori dalle battute, le battute di ogni rigo e il loro contenuto. */
interface HistoryState {
    frame: string;
    parts: string[][];
    contents: Map<string, string>;
    /** Ogni battuta ha un `id` unico: altrimenti la cronologia registra il documento intero. */
    stable: boolean;
    /** La sequenza del documento, per ricomporne l'istantanea dai pezzi senza serializzarlo di nuovo. */
    layout: DocumentLayout;
}

interface DocumentLayout {
    /** Ciò che precede l'elemento radice, come la dichiarazione del tipo di documento. */
    prolog: string;
    open: string;
    close: string;
    /** Elementi fuori dai righi, serializzati, e posizioni dei righi. */
    items: (string | number)[];
    /** Tag di apertura e chiusura di ogni rigo. */
    partTags: [string, string][];
}

const NO_CHANGE: DocumentChange = { rows: new Set(), measures: new Set() };

/**
 * Cronologia della parte e della partitura: ogni modifica registra le battute cambiate di tutti i righi, prima e dopo,
 * invece di una copia del documento, che in una partitura grande pesa diversi megabyte. Le modifiche che cambiano i righi o
 * l'intestazione, come aggiungere un rigo o convertire la notazione, registrano il documento intero.
 *
 * Un `MutationObserver` segue il documento: a ogni modifica si serializzano solo le battute toccate, e il documento di
 * prima si ricompone dai pezzi solo quando serve.
 *
 * Con `deferred` il documento aperto si legge con `prepare`, per esempio dopo la prima pagina, o alla prima operazione:
 * chi lo modifica chiede prima `checkpoint`, come l'editor, perché la lettura deve precedere la prima modifica.
 */
export class MeasureHistory implements DocumentHistory {
    private readonly undoStack: HistoryEntry[] = [];
    private readonly redoStack: HistoryEntry[] = [];
    private state!: HistoryState;
    private initial!: HistoryState;
    /** Il documento aperto, finché non è letto. */
    private opened: ScoreDocument | null;
    private readonly observer: MutationObserver | null;
    private readonly limit: number;
    private watched: Document | null = null;
    private pending: MutationRecord[] = [];
    private change: DocumentChange | null = NO_CHANGE;

    constructor(score: ScoreDocument, options: { limit?: number; deferred?: boolean } = {}) {
        this.limit = options.limit ?? 100;
        this.observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => this.pending.push(...records));
        this.watch(score.document);
        this.opened = score;
        if (!options.deferred) this.prepare();
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    get lastChange(): DocumentChange | null {
        return this.change;
    }

    prepare(): void {
        if (!this.opened) return;
        this.state = capture(this.opened);
        this.initial = this.state;
        this.opened = null;
        // Lo stato appena letto comprende già le modifiche osservate fin qui.
        this.observer?.takeRecords();
        this.pending = [];
    }

    checkpoint(score: ScoreDocument): () => string {
        this.prepare();
        if (!this.following(score) || !this.state.stable) {
            const snapshot = score.snapshot();
            return () => snapshot;
        }
        const state = this.state;
        let rebuilt: string | undefined;
        return () => (rebuilt ??= rebuild(state));
    }

    record(score: ScoreDocument, before: Before, merge: boolean): void {
        this.prepare();
        const next = this.refresh(score);
        const entry = difference(this.state, next, typeof before === 'string' ? () => before : before, () => score.snapshot());
        this.state = next;
        this.change = entry ? changeOf(entry) : NO_CHANGE;
        if (!entry) return;
        this.redoStack.length = 0;
        const last = this.undoStack[this.undoStack.length - 1];
        if (merge && last && combine(last, entry)) return;
        this.undoStack.push(entry);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
    }

    undo(score: ScoreDocument): ScoreDocument | null {
        this.prepare();
        const entry = this.undoStack.pop();
        if (!entry) return null;
        const result = apply(score, entry, 'before');
        this.redoStack.push(entry);
        this.state = this.refresh(result);
        this.change = changeOf(entry);
        return result;
    }

    redo(score: ScoreDocument): ScoreDocument | null {
        this.prepare();
        const entry = this.redoStack.pop();
        if (!entry) return null;
        const result = apply(score, entry, 'after');
        this.undoStack.push(entry);
        this.state = this.refresh(result);
        this.change = changeOf(entry);
        return result;
    }

    /** Con modifiche non ancora registrate, o con un altro documento, lo stato si legge di nuovo dal documento. */
    modified(score: ScoreDocument): boolean {
        this.prepare();
        return !sameState(this.following(score) ? this.state : capture(score), this.initial);
    }

    dispose(): void {
        this.observer?.disconnect();
        this.watched = null;
        this.pending = [];
    }

    /** Lo stato registrato corrisponde al documento: lo stesso documento, senza modifiche ancora da registrare. */
    private following(score: ScoreDocument): boolean {
        if (!this.observer || score.document !== this.watched) return false;
        this.pending.push(...this.observer.takeRecords());
        return this.pending.length === 0;
    }

    /** Lo stato del documento: solo le battute toccate dalle modifiche si serializzano di nuovo. */
    private refresh(score: ScoreDocument): HistoryState {
        if (!this.observer || score.document !== this.watched) {
            this.watch(score.document);
            return capture(score);
        }
        const records = [...this.pending, ...this.observer.takeRecords()];
        this.pending = [];
        return records.length ? capture(score, this.state, touchedMeasures(records)) : this.state;
    }

    private watch(document: Document): void {
        if (!this.observer) return;
        this.observer.disconnect();
        this.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        this.watched = document;
        this.pending = [];
    }
}

// Funzioni interne

/**
 * Lo stato del documento. Con lo stato precedente e le battute toccate, il contenuto delle altre battute resta quello già
 * serializzato.
 */
function capture(score: ScoreDocument, previous?: HistoryState, touched?: ReadonlySet<Element>): HistoryState {
    const serializer = new XMLSerializer();
    const document = score.document;
    const root = document.documentElement;
    const frame: string[] = [Array.from(root.attributes, (attribute) => `${attribute.name}=${attribute.value}`).join(' ')];
    const parts: string[][] = [];
    const partTags: [string, string][] = [];
    const items: (string | number)[] = [];
    const contents = new Map<string, string>();
    let stable = true;
    for (const item of children(root)) {
        if (item.tagName !== 'part') {
            const text = serializer.serializeToString(item);
            frame.push(text);
            items.push(text);
            continue;
        }
        frame.push(`part ${Array.from(item.attributes, (attribute) => `${attribute.name}=${attribute.value}`).join(' ')}`);
        items.push(parts.length);
        partTags.push([startTag(item), `</${item.tagName}>`]);
        const ids: string[] = [];
        for (const node of children(item)) {
            const id = node.getAttribute('id');
            if (node.tagName !== 'measure' || !id || contents.has(id)) {
                stable = false;
                continue;
            }
            ids.push(id);
            const kept = previous && touched && !touched.has(node) ? previous.contents.get(id) : undefined;
            contents.set(id, kept ?? serializer.serializeToString(node));
        }
        parts.push(ids);
    }
    const prolog: string[] = [declaration(document)];
    for (const node of Array.from(document.childNodes)) {
        if (node === root) break;
        prolog.push(serializer.serializeToString(node));
    }
    return { frame: frame.join('\n'), parts, contents, stable, layout: { prolog: prolog.join(''), open: startTag(root), close: `</${root.tagName}>`, items, partTags } };
}

/**
 * La dichiarazione XML, che non è un nodo del documento: Chrome ricorda versione e codifica e la scrive nelle istantanee;
 * dove il browser non le ricorda il documento ricomposto ne resta senza, come le sue istantanee.
 */
function declaration(document: Document): string {
    const { xmlVersion, xmlEncoding, xmlStandalone } = document as Document & { xmlVersion?: string | null; xmlEncoding?: string | null; xmlStandalone?: boolean };
    if (!xmlEncoding) return '';
    return `<?xml version="${xmlVersion ?? '1.0'}" encoding="${xmlEncoding}"${xmlStandalone ? ' standalone="yes"' : ''}?>`;
}

/** Le battute dei righi toccate dalle modifiche osservate: quelle che contengono il nodo cambiato e quelle aggiunte. */
function touchedMeasures(records: readonly MutationRecord[]): Set<Element> {
    const touched = new Set<Element>();
    for (const record of records) {
        const measure = enclosingMeasure(record.target);
        if (measure) touched.add(measure);
        if (record.type !== 'childList') continue;
        for (const node of Array.from(record.addedNodes)) {
            if (!(node instanceof Element)) continue;
            if (node.tagName === 'measure') touched.add(node);
            for (const inner of Array.from(node.getElementsByTagName('measure'))) touched.add(inner);
        }
    }
    return touched;
}

function enclosingMeasure(node: Node | null): Element | null {
    for (let current = node; current; current = current.parentNode) {
        if (current instanceof Element && current.tagName === 'measure' && current.parentElement?.tagName === 'part') return current;
    }
    return null;
}

/** L'istantanea ricomposta dallo stato, senza gli spazi tra gli elementi, che il documento non usa. */
function rebuild(state: HistoryState): string {
    const { prolog, open, close, items, partTags } = state.layout;
    const body = items.map((item) => (typeof item === 'string' ? item : partTags[item][0] + state.parts[item].map((id) => state.contents.get(id) ?? '').join('') + partTags[item][1]));
    return prolog + open + body.join('') + close;
}

function startTag(element: Element): string {
    const attributes = Array.from(element.attributes, (attribute) => ` ${attribute.name}="${attribute.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}"`);
    return `<${element.tagName}${attributes.join('')}>`;
}

function changeOf(entry: HistoryEntry): DocumentChange | null {
    if (entry.kind === 'document') return null;
    return { rows: new Set(entry.parts.map((part) => part.index)), measures: new Set([...entry.before.keys(), ...entry.after.keys()]) };
}

function sameState(left: HistoryState, right: HistoryState): boolean {
    return left === right || (left.frame === right.frame && left.stable === right.stable && sameMeasures(left, right));
}

function difference(previous: HistoryState, next: HistoryState, before: () => string, after: () => string): HistoryEntry | null {
    if (!previous.stable || !next.stable || previous.frame !== next.frame || previous.parts.length !== next.parts.length) {
        return previous.frame === next.frame && previous.stable && next.stable && sameMeasures(previous, next) ? null : { kind: 'document', before: before(), after: after() };
    }
    const parts: PartChange[] = [];
    const beforeContents = new Map<string, string>();
    const afterContents = new Map<string, string>();
    previous.parts.forEach((beforeIds, index) => {
        const afterIds = next.parts[index];
        const kept = new Set(afterIds);
        const changed = afterIds.filter((id) => previous.contents.get(id) !== next.contents.get(id));
        const removed = beforeIds.filter((id) => !kept.has(id));
        if (!changed.length && !removed.length && sameOrder(beforeIds, afterIds)) return;
        parts.push({ index, beforeIds, afterIds });
        for (const id of [...changed, ...removed]) {
            const content = previous.contents.get(id);
            if (content !== undefined) beforeContents.set(id, content);
        }
        for (const id of changed) afterContents.set(id, next.contents.get(id)!);
    });
    return parts.length ? { kind: 'measures', parts, before: beforeContents, after: afterContents } : null;
}

function sameMeasures(previous: HistoryState, next: HistoryState): boolean {
    if (previous.parts.length !== next.parts.length) return false;
    return previous.parts.every((ids, index) => sameOrder(ids, next.parts[index]) && ids.every((id) => previous.contents.get(id) === next.contents.get(id)));
}

function sameOrder(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Unisce una modifica di battute alla precedente; `false` se una delle due riguarda il documento intero. */
function combine(last: HistoryEntry, entry: HistoryEntry): boolean {
    if (last.kind !== 'measures' || entry.kind !== 'measures') return false;
    for (const change of entry.parts) {
        const existing = last.parts.find((candidate) => candidate.index === change.index);
        if (existing) existing.afterIds = change.afterIds;
        else last.parts.push(change);
    }
    // Lo stato di prima resta quello della prima modifica; quello di dopo è dell'ultima.
    for (const [id, content] of entry.before) if (!last.before.has(id)) last.before.set(id, content);
    for (const [id, content] of entry.after) last.after.set(id, content);
    return true;
}

function apply(score: ScoreDocument, entry: HistoryEntry, side: 'before' | 'after'): ScoreDocument {
    if (entry.kind === 'document') return ScoreDocument.restore(entry[side], score.prefix, score.partIndex);
    const contents = entry[side];
    const parser = new DOMParser();
    const parts = score.parts();
    for (const change of entry.parts) {
        const part = parts[change.index];
        const existing = new Map(children(part, 'measure').map((measure) => [measure.getAttribute('id') ?? '', measure]));
        const nodes = (side === 'before' ? change.beforeIds : change.afterIds).map((id) => {
            const content = contents.get(id);
            if (content === undefined) {
                const kept = existing.get(id);
                if (!kept) throw new Error(`Battuta ${id} non trovata nella cronologia`);
                return kept;
            }
            return score.document.importNode(parser.parseFromString(content, 'application/xml').documentElement, true) as Element;
        });
        for (const measure of children(part, 'measure')) measure.remove();
        part.append(...nodes);
    }
    return score;
}
