/**
 * Funzioni di base per modificare un documento MusicXML rispettando l'ordine degli elementi previsto dallo schema:
 * programmi come MuseScore rifiutano o interpretano male un file con gli elementi fuori ordine.
 */

export const NOTE_ORDER = [
    'grace',
    'cue',
    'chord',
    'pitch',
    'unpitched',
    'rest',
    'duration',
    'tie',
    'instrument',
    'footnote',
    'level',
    'voice',
    'type',
    'dot',
    'accidental',
    'time-modification',
    'stem',
    'notehead',
    'notehead-text',
    'staff',
    'beam',
    'notations',
    'lyric',
    'play',
    'listen'
] as const;

export const ATTRIBUTES_ORDER = ['footnote', 'level', 'divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part', 'directive', 'measure-style'] as const;

export const BARLINE_ORDER = ['bar-style', 'footnote', 'level', 'wavy-line', 'segno', 'coda', 'fermata', 'ending', 'repeat'] as const;
export const PITCH_ORDER = ['step', 'alter', 'octave'] as const;
export const TIME_MODIFICATION_ORDER = ['actual-notes', 'normal-notes', 'normal-type', 'normal-dot'] as const;
export const CLEF_ORDER = ['sign', 'line', 'clef-octave-change'] as const;
export const DIRECTION_ORDER = ['direction-type', 'offset', 'footnote', 'level', 'voice', 'staff', 'sound', 'listening'] as const;

export function child(parent: Element | null | undefined, name: string): Element | null {
    if (!parent) return null;
    for (const item of Array.from(parent.children)) if (item.tagName === name) return item;
    return null;
}

export function children(parent: Element | null | undefined, name?: string): Element[] {
    if (!parent) return [];
    const all = Array.from(parent.children);
    return name === undefined ? all : all.filter((item) => item.tagName === name);
}

export function text(element: Element | null | undefined): string | null {
    const value = element?.textContent?.trim();
    return value === undefined || value === '' ? null : value;
}

export function integer(element: Element | null | undefined): number | null {
    const value = text(element);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** Nuovo elemento, con testo e attributi facoltativi. */
export function element(owner: Document, name: string, content?: string | number | null, attributes: Record<string, string> = {}): Element {
    const created = owner.createElement(name);
    if (content !== undefined && content !== null) created.textContent = String(content);
    for (const [key, value] of Object.entries(attributes)) created.setAttribute(key, value);
    return created;
}

/** Inserisce un figlio nella posizione prevista dall'ordine indicato; gli elementi non elencati non spostano l'inserimento. */
export function insertOrdered(parent: Element, node: Element, order: readonly string[]): Element {
    const rank = order.indexOf(node.tagName);
    if (rank < 0) {
        parent.appendChild(node);
        return node;
    }
    for (const existing of Array.from(parent.children)) {
        const existingRank = order.indexOf(existing.tagName);
        if (existingRank > rank) {
            parent.insertBefore(node, existing);
            return node;
        }
    }
    parent.appendChild(node);
    return node;
}

/** Figlio con il nome indicato, creato nella posizione prevista se manca. */
export function ensureChild(parent: Element, name: string, order: readonly string[]): Element {
    return child(parent, name) ?? insertOrdered(parent, element(parent.ownerDocument, name), order);
}

/** Imposta il testo di un figlio, creandolo se manca; `null` lo rimuove. */
export function setChildText(parent: Element, name: string, value: string | number | null, order: readonly string[]): void {
    const existing = child(parent, name);
    if (value === null) {
        existing?.remove();
        return;
    }
    (existing ?? insertOrdered(parent, element(parent.ownerDocument, name), order)).textContent = String(value);
}

export function removeChildren(parent: Element, name: string): void {
    for (const item of children(parent, name)) item.remove();
}

/** Rimuove l'elemento se non ha più figli. */
export function removeIfEmpty(target: Element | null): void {
    if (target && target.children.length === 0 && !text(target)) target.remove();
}

/** Inserisce un elemento all'inizio della battuta, dopo stampa, attributi e stanghetta iniziale. */
export function insertAtStart(measure: Element, node: Element): void {
    const anchor = children(measure).find((item) => !['print', 'attributes', 'barline'].includes(item.tagName) || (item.tagName === 'barline' && item.getAttribute('location') !== 'left'));
    measure.insertBefore(node, anchor ?? null);
}
