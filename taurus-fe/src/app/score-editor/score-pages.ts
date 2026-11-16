import { child, children } from './musicxml-dom';
import { isStructureDirection } from './score-arrangement';
import { ScoreDocument } from './score-document';

/** Come preparare il MusicXML da disegnare nell'editor. */
export interface DrawingSource {
    /** `id` dei righi nascosti nel disegno della partitura; se lo sono tutti si disegnano tutti. */
    hidden?: ReadonlySet<string>;
    /** Restano i nomi dei righi, come nella partitura; altrimenti si tolgono, perché l'editor li riporta nel titolo. */
    partNames?: boolean;
    /** Le interruzioni di pagina diventano interruzioni di riga: lo spartito scorre in una pagina sola. */
    pageBreaksAsSystems?: boolean;
    /** Posizioni da 0 delle battute che aprono un sistema: l'estratto vi va a capo, come il disegno che sostituisce. */
    systems?: ReadonlySet<number>;
}

/**
 * Elementi di `<attributes>` che non passano all'inizio di un estratto: quelli che valgono solo dove sono scritti, e il
 * metro, che Verovio disegnerebbe all'inizio della pagina anche nascosto con `print-object`; le durate vengono dalle
 * divisioni e le travature sono scritte nel MusicXML.
 */
const LOCAL_ATTRIBUTES = new Set(['measure-style', 'directive', 'footnote', 'level', 'time']);
/** Ordine degli elementi di `<attributes>` in MusicXML. */
const ATTRIBUTE_ORDER = ['divisions', 'key', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part'];
/** Elementi che aprono il contenuto musicale di una battuta. */
const MUSIC = new Set(['note', 'backup', 'forward']);

/**
 * Il MusicXML di tutta la parte o la partitura da disegnare, ricavato dal documento aperto senza rileggerne il testo: senza
 * i righi nascosti e con i segni della struttura comune solo sul primo rigo mostrato, perché Verovio li disegnerebbe una
 * volta per rigo.
 */
export function drawingXml(score: ScoreDocument, source: DrawingSource = {}): string {
    return build(score, 0, Number.MAX_SAFE_INTEGER, source);
}

/**
 * Le battute da `from` a `to`, comprese, di tutti i righi mostrati, per ridisegnare una pagina. La prima battuta riceve lo
 * stato in vigore (divisioni, armatura, chiavi, trasposizione) e i righi hanno il nome abbreviato, come i sistemi che non
 * aprono la partitura.
 */
export function drawingExcerpt(score: ScoreDocument, from: number, to: number, source: DrawingSource = {}): string {
    return build(score, Math.max(0, from), to, source);
}

/** Posizione da 0 di ogni battuta di tutti i righi, per `id`: Verovio disegna una battuta con l'`id` di un solo rigo. */
export function measurePositions(score: ScoreDocument): Map<string, number> {
    const positions = new Map<string, number>();
    for (const part of score.parts()) {
        children(part, 'measure').forEach((measure, index) => {
            const id = measure.getAttribute('id');
            if (id) positions.set(id, index);
        });
    }
    return positions;
}

// Funzioni interne

function build(score: ScoreDocument, from: number, to: number, source: DrawingSource): string {
    const root = score.document.documentElement;
    const target = document.implementation.createDocument(null, null, null);
    const copy = target.importNode(root, false) as Element;
    target.append(copy);
    const parts = children(root, 'part');
    const hidden = source.hidden ?? new Set<string>();
    const visible = parts.filter((part) => !hidden.has(part.getAttribute('id') ?? ''));
    const shown = visible.length ? visible : parts;
    const shownIds = new Set(shown.map((part) => part.getAttribute('id') ?? ''));
    for (const item of children(root)) {
        if (item.tagName === 'part') {
            if (shownIds.has(item.getAttribute('id') ?? '')) copy.append(partCopy(target, item, from, to, item === shown[0], source));
            continue;
        }
        const cloned = target.importNode(item, true) as Element;
        if (cloned.tagName === 'part-list') prepareList(cloned, shownIds, from > 0, !!source.partNames);
        copy.append(cloned);
    }
    return new XMLSerializer().serializeToString(target);
}

function prepareList(list: Element, shown: ReadonlySet<string>, continued: boolean, partNames: boolean): void {
    for (const scorePart of children(list, 'score-part')) {
        if (!shown.has(scorePart.getAttribute('id') ?? '')) scorePart.remove();
    }
    if (!partNames) {
        for (const name of ['part-name', 'part-abbreviation']) for (const item of Array.from(list.getElementsByTagName(name))) item.textContent = '';
        for (const name of ['part-name-display', 'part-abbreviation-display']) for (const item of Array.from(list.getElementsByTagName(name))) item.remove();
        return;
    }
    if (!continued) return;
    // Il primo sistema di un estratto non apre la partitura: porta il nome abbreviato, o nessun nome.
    for (const scorePart of children(list, 'score-part')) {
        const name = child(scorePart, 'part-name');
        if (name) name.textContent = child(scorePart, 'part-abbreviation')?.textContent ?? '';
        child(scorePart, 'part-name-display')?.remove();
    }
}

function partCopy(target: Document, part: Element, from: number, to: number, first: boolean, source: DrawingSource): Element {
    const copy = target.importNode(part, false) as Element;
    const measures = children(part, 'measure');
    const last = Math.min(to, measures.length - 1);
    const state = from > 0 ? stateBefore(measures, from) : null;
    for (let index = from; index <= last; index++) {
        const measure = target.importNode(measures[index], true) as Element;
        if (!first) for (const item of children(measure).filter(isStructureDirection)) item.remove();
        if (source.pageBreaksAsSystems) {
            for (const print of children(measure, 'print')) {
                if (print.getAttribute('new-page') !== 'yes') continue;
                print.removeAttribute('new-page');
                print.setAttribute('new-system', 'yes');
            }
        }
        if (first && source.systems?.has(index)) newSystem(target, measure);
        if (index === from && state) prependState(target, measure, state);
        copy.append(measure);
    }
    return copy;
}

/** La battuta apre un sistema: Verovio legge l'interruzione di riga dal primo rigo. */
function newSystem(target: Document, measure: Element): void {
    const print = child(measure, 'print') ?? measure.insertBefore(target.createElement('print'), measure.firstChild);
    print.removeAttribute('new-page');
    print.setAttribute('new-system', 'yes');
}

/** Ultimo valore di ogni elemento di `<attributes>` scritto prima della battuta `from`. */
function stateBefore(measures: readonly Element[], from: number): Map<string, Element> {
    const state = new Map<string, Element>();
    for (const measure of measures.slice(0, from)) {
        for (const attributes of children(measure, 'attributes')) {
            for (const item of children(attributes)) if (!LOCAL_ATTRIBUTES.has(item.tagName)) state.set(attributeKey(item), item);
        }
    }
    return state;
}

/** Le chiavi e i dettagli del pentagramma senza numero valgono per il primo pentagramma. */
function attributeKey(item: Element): string {
    const number = item.getAttribute('number') ?? (item.tagName === 'clef' || item.tagName === 'staff-details' ? '1' : '');
    return `${item.tagName}:${number}`;
}

function prependState(target: Document, measure: Element, state: Map<string, Element>): void {
    const defined = new Set<string>();
    for (const item of children(measure)) {
        if (MUSIC.has(item.tagName)) break;
        if (item.tagName === 'attributes') for (const value of children(item)) defined.add(attributeKey(value));
    }
    const items = Array.from(state.entries())
        .filter(([key]) => !defined.has(key))
        .map(([, item]) => item)
        .sort((left, right) => order(left) - order(right));
    if (!items.length) return;
    const attributes = target.createElement('attributes');
    for (const item of items) attributes.append(target.importNode(item, true));
    measure.insertBefore(attributes, children(measure).find((item) => item.tagName !== 'print') ?? null);
}

function order(item: Element): number {
    const index = ATTRIBUTE_ORDER.indexOf(item.tagName);
    return index < 0 ? ATTRIBUTE_ORDER.length : index;
}
