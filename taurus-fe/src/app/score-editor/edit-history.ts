import { children } from './musicxml-dom';
import { ScoreDocument } from './score-document';

/** Cronologia delle modifiche della sessione di correzione, come istantanee del documento. */
export class EditHistory {
    private readonly undoStack: string[] = [];
    private readonly redoStack: string[] = [];

    constructor(private readonly limit = 100) {}

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** Registra lo stato precedente a una modifica; una nuova modifica annulla la possibilità di ripristinare. */
    record(before: string): void {
        this.undoStack.push(before);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    /** Stato da ripristinare annullando l'ultima modifica, oppure `null`. */
    undo(current: string): string | null {
        const previous = this.undoStack.pop();
        if (previous === undefined) return null;
        this.redoStack.push(current);
        return previous;
    }

    redo(current: string): string | null {
        const next = this.redoStack.pop();
        if (next === undefined) return null;
        this.undoStack.push(current);
        return next;
    }
}

/** Cronologia di Annulla e Ripristina dell'editor: per una parte le istantanee, per la partitura le battute cambiate. */
export interface DocumentHistory {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /**
     * Registra una modifica appena fatta al documento: `before` è l'istantanea di prima; con `merge` la modifica si unisce
     * alla precedente, come i tasti tenuti premuti.
     */
    record(score: ScoreDocument, before: string, merge: boolean): void;
    /** Annulla l'ultima modifica: il documento da usare, lo stesso o uno ricostruito; `null` se non c'è nulla da annullare. */
    undo(score: ScoreDocument): ScoreDocument | null;
    redo(score: ScoreDocument): ScoreDocument | null;
}

/** Istantanee del documento intero, per la parte singola. */
export class SnapshotHistory implements DocumentHistory {
    private readonly history: EditHistory;

    constructor(limit = 100) {
        this.history = new EditHistory(limit);
    }

    get canUndo(): boolean {
        return this.history.canUndo;
    }

    get canRedo(): boolean {
        return this.history.canRedo;
    }

    record(_score: ScoreDocument, before: string, merge: boolean): void {
        if (!merge || !this.history.canUndo) this.history.record(before);
    }

    undo(score: ScoreDocument): ScoreDocument | null {
        const previous = this.history.undo(score.snapshot());
        return previous === null ? null : ScoreDocument.restore(previous, score.prefix, score.partIndex);
    }

    redo(score: ScoreDocument): ScoreDocument | null {
        const next = this.history.redo(score.snapshot());
        return next === null ? null : ScoreDocument.restore(next, score.prefix, score.partIndex);
    }
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
}

/**
 * Cronologia della partitura: ogni modifica registra le battute cambiate di tutti i righi, prima e dopo, invece di una
 * copia del documento, che in una partitura grande pesa diversi megabyte. Le modifiche che cambiano i righi o
 * l'intestazione, come aggiungere un rigo o convertire la notazione, registrano il documento intero.
 */
export class MeasureHistory implements DocumentHistory {
    private readonly undoStack: HistoryEntry[] = [];
    private readonly redoStack: HistoryEntry[] = [];
    private state: HistoryState;

    constructor(
        score: ScoreDocument,
        private readonly limit = 100
    ) {
        this.state = capture(score);
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    record(score: ScoreDocument, before: string, merge: boolean): void {
        const next = capture(score);
        const entry = difference(this.state, next, before, () => score.snapshot());
        this.state = next;
        if (!entry) return;
        this.redoStack.length = 0;
        const last = this.undoStack[this.undoStack.length - 1];
        if (merge && last && combine(last, entry)) return;
        this.undoStack.push(entry);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
    }

    undo(score: ScoreDocument): ScoreDocument | null {
        const entry = this.undoStack.pop();
        if (!entry) return null;
        const result = apply(score, entry, 'before');
        this.redoStack.push(entry);
        this.state = capture(result);
        return result;
    }

    redo(score: ScoreDocument): ScoreDocument | null {
        const entry = this.redoStack.pop();
        if (!entry) return null;
        const result = apply(score, entry, 'after');
        this.undoStack.push(entry);
        this.state = capture(result);
        return result;
    }
}

// Funzioni interne

function capture(score: ScoreDocument): HistoryState {
    const serializer = new XMLSerializer();
    const root = score.document.documentElement;
    const frame: string[] = [Array.from(root.attributes, (attribute) => `${attribute.name}=${attribute.value}`).join(' ')];
    const parts: string[][] = [];
    const contents = new Map<string, string>();
    let stable = true;
    for (const item of children(root)) {
        if (item.tagName !== 'part') {
            frame.push(serializer.serializeToString(item));
            continue;
        }
        frame.push(`part ${Array.from(item.attributes, (attribute) => `${attribute.name}=${attribute.value}`).join(' ')}`);
        const ids: string[] = [];
        for (const node of children(item)) {
            const id = node.getAttribute('id');
            if (node.tagName !== 'measure' || !id || contents.has(id)) {
                stable = false;
                continue;
            }
            ids.push(id);
            contents.set(id, serializer.serializeToString(node));
        }
        parts.push(ids);
    }
    return { frame: frame.join('\n'), parts, contents, stable };
}

function difference(previous: HistoryState, next: HistoryState, before: string, after: () => string): HistoryEntry | null {
    if (!previous.stable || !next.stable || previous.frame !== next.frame || previous.parts.length !== next.parts.length) {
        return previous.frame === next.frame && previous.stable && next.stable && sameMeasures(previous, next) ? null : { kind: 'document', before, after: after() };
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
