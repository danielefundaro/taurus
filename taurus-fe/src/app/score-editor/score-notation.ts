import { makeAccidentalsExplicit } from './accidentals';
import { child, children, DIRECTION_ORDER, element, ensureChild, insertAtStart, insertOrdered, NOTE_ORDER, removeIfEmpty, setChildText, text } from './musicxml-dom';
import { NoteType } from './notation-rules';
import { EditError, isRest, ScoreDocument, voiceOf } from './score-document';

/**
 * Segni di espressione e d'impaginazione della scrittura: legature di portamento, forcelle, corona, abbellimenti, testi,
 * lettere di prova e interruzioni di riga e di pagina. Le operazioni non cambiano le durate e valgono anche nella
 * correzione; le interruzioni si vedono solo nella scrittura, che le disegna.
 */

export type WedgeKind = 'crescendo' | 'diminuendo';
export type GraceKind = 'acciaccatura' | 'appoggiatura';
export type BreakKind = 'system' | 'page';

export const GRACE_KINDS: readonly { value: GraceKind; label: string; hint: string }[] = [
    { value: 'acciaccatura', label: 'Acciaccatura', hint: 'Piccola nota barrata, rapidissima, prima della nota' },
    { value: 'appoggiatura', label: 'Appoggiatura', hint: 'Piccola nota che prende parte del valore della nota' }
];

export const WEDGES: readonly { value: WedgeKind; label: string; key: string }[] = [
    { value: 'crescendo', label: 'Crescendo', key: '<' },
    { value: 'diminuendo', label: 'Diminuendo', key: '>' }
];

/** Testi di espressione proposti; se ne può scrivere qualsiasi altro. */
export const EXPRESSION_TEXTS: readonly string[] = [
    'dolce',
    'espress.',
    'cantabile',
    'legato',
    'marcato',
    'cresc.',
    'dim.',
    'sempre',
    'sim.',
    'morendo',
    'rit.',
    'rall.',
    'accel.',
    'a tempo',
    'allarg.',
    'rubato',
    'Tempo I',
    'più mosso',
    'meno mosso',
    'solo',
    'tutti',
    'con sord.',
    'senza sord.'
];

/** Testi che riguardano il tempo o chi suona: si scrivono sopra il rigo, gli altri sotto. */
const ABOVE_STAFF =
    /^(rit\.?|ritard\.?|ritardando|rall\.?|rallentando|accel\.?|accelerando|a tempo|allarg\.?|allargando|rubato|string\.?|stringendo|tempo i+|tempo primo|più mosso|meno mosso|largo|lento|adagio|andante|andantino|moderato|allegretto|allegro|vivace|presto|maestoso|tempo di marcia|solo|soli|tutti|con sord\.?|senza sord\.?)$/i;

const MAX_EXPRESSION = 60;
const MAX_REHEARSAL = 12;
const MAX_NUMBER = 16;
const MAX_BREAKS_EVERY = 32;

/** Ciò a cui si applica un segno: la nota selezionata e, se c'è, il passaggio selezionato con la sua voce. */
export interface NotationTarget {
    noteId: string;
    passage: { notes: Element[]; voice: string } | null;
}

interface Span {
    start: Element;
    stop: Element;
}

// Legature di portamento

/**
 * Legatura di portamento dalla prima all'ultima nota del passaggio, nella sua voce; senza passaggio dalla nota alla nota
 * seguente della voce. Se la legatura c'è già si toglie, e su una sola nota si tolgono le legature che iniziano o
 * finiscono lì.
 */
export function toggleSlur(score: ScoreDocument, target: NotationTarget): void {
    const spans = pairs(slurMarks(score));
    if (target.passage) {
        const heads = target.passage.notes.filter((note) => voiceOf(note) === target.passage!.voice && !child(note, 'chord') && !isRest(note));
        if (heads.length < 2) throw new EditError('La legatura di portamento unisce almeno due note della stessa voce');
        const [from, to] = [heads[0], heads[heads.length - 1]];
        const existing = spans.filter((span) => slurOwner(span.start) === from && slurOwner(span.stop) === to);
        if (existing.length) existing.forEach(removeSpan);
        else addSlur(score, from, to);
        return;
    }
    const note = score.note(target.noteId);
    const event = score.eventOf(note);
    const touching = spans.filter((span) => event.notes.includes(slurOwner(span.start)) || event.notes.includes(slurOwner(span.stop)));
    if (touching.length) {
        touching.forEach(removeSpan);
        return;
    }
    const from = event.notes[0];
    if (isRest(from)) throw new EditError('La legatura di portamento parte da una nota');
    // Da un abbellimento si lega all'elemento seguente, anche un altro abbellimento; da una nota alla nota seguente.
    const sequence = heads(score, voiceOf(from));
    const following = sequence.slice(sequence.indexOf(from) + 1);
    const next = child(from, 'grace') ? following[0] : following.find((head) => !child(head, 'grace'));
    if (!next || isRest(next)) throw new EditError('Dopo la nota non c’è una nota da legare: seleziona un passaggio');
    addSlur(score, from, next);
}

function addSlur(score: ScoreDocument, from: Element, to: Element): void {
    const number = freeNumber(slurMarks(score), from, to);
    ensureChild(from, 'notations', NOTE_ORDER).appendChild(element(score.document, 'slur', null, { type: 'start', number }));
    ensureChild(to, 'notations', NOTE_ORDER).appendChild(element(score.document, 'slur', null, { type: 'stop', number }));
}

function slurMarks(score: ScoreDocument): Element[] {
    return score.notes().flatMap((note) => children(child(note, 'notations'), 'slur'));
}

function slurOwner(mark: Element): Element {
    return mark.parentElement!.parentElement!;
}

// Forcelle

/**
 * Forcella dal primo all'ultimo elemento del passaggio, nella sua voce; senza passaggio dalla nota all'elemento seguente
 * della voce. La stessa forcella si toglie, quella opposta cambia verso.
 */
export function toggleWedge(score: ScoreDocument, target: NotationTarget, kind: WedgeKind): void {
    const spans = pairs(wedgeMarks(score));
    let from: Element;
    let to: Element;
    if (target.passage) {
        const elements = target.passage.notes.filter((note) => voiceOf(note) === target.passage!.voice && !child(note, 'chord') && !child(note, 'grace'));
        if (elements.length < 2) throw new EditError('La forcella va da un elemento a un altro della stessa voce');
        [from, to] = [elements[0], elements[elements.length - 1]];
        const existing = spans.filter((span) => wedgeOwner(span.start) === from && wedgeOwner(span.stop) === to);
        if (existing.length) {
            switchOrRemove(existing, kind);
            return;
        }
    } else {
        const note = score.note(target.noteId);
        if (child(note, 'grace')) throw new EditError('Le forcelle partono da una nota o da una pausa');
        from = score.eventOf(note).notes[0];
        const existing = spans.filter((span) => wedgeOwner(span.start) === from);
        if (existing.length) {
            switchOrRemove(existing, kind);
            return;
        }
        const sequence = heads(score, voiceOf(from)).filter((head) => !child(head, 'grace'));
        const next = sequence[sequence.indexOf(from) + 1];
        if (!next) throw new EditError('Dopo la nota non c’è un elemento dove finire la forcella: seleziona un passaggio');
        to = next;
    }
    const number = freeNumber(wedgeMarks(score), anchorOf(from), anchorOf(to));
    anchorOf(from).before(wedgeDirection(score, from, kind, number));
    anchorOf(to).before(wedgeDirection(score, from, 'stop', number));
}

function switchOrRemove(spans: Span[], kind: WedgeKind): void {
    for (const span of spans) {
        if (span.start.getAttribute('type') === kind) removeSpan(span);
        else span.start.setAttribute('type', kind);
    }
}

function wedgeDirection(score: ScoreDocument, note: Element, type: WedgeKind | 'stop', number: string): Element {
    const owner = score.document;
    const direction = element(owner, 'direction', null, { placement: 'below' });
    direction.appendChild(element(owner, 'direction-type')).appendChild(element(owner, 'wedge', null, { type, number }));
    setChildText(direction, 'voice', voiceOf(note), DIRECTION_ORDER);
    const staff = text(child(note, 'staff'));
    if (staff) setChildText(direction, 'staff', staff, DIRECTION_ORDER);
    return direction;
}

function wedgeMarks(score: ScoreDocument): Element[] {
    return score.measures().flatMap((measure) => children(measure, 'direction').flatMap((direction) => children(direction, 'direction-type').flatMap((type) => children(type, 'wedge'))));
}

/** La nota a cui appartiene la direzione della forcella: la prima che la segue, dopo altre direzioni e abbellimenti. */
function wedgeOwner(mark: Element): Element | null {
    let current = mark.parentElement?.parentElement?.nextElementSibling ?? null;
    while (current && (current.tagName === 'direction' || (current.tagName === 'note' && child(current, 'grace')))) current = current.nextElementSibling;
    return current?.tagName === 'note' ? current : null;
}

/** Toglie le legature di portamento e le forcelle con un estremo tra le note indicate, oppure sulla nota. */
export function removeSpanners(score: ScoreDocument, target: NotationTarget): void {
    const notes = new Set(target.passage ? target.passage.notes : score.eventOf(score.note(target.noteId)).notes);
    const slurs = pairs(slurMarks(score)).filter((span) => notes.has(slurOwner(span.start)) || notes.has(slurOwner(span.stop)));
    const wedges = pairs(wedgeMarks(score)).filter((span) => [wedgeOwner(span.start), wedgeOwner(span.stop)].some((owner) => !!owner && notes.has(owner)));
    if (!slurs.length && !wedges.length) throw new EditError('Nella selezione non ci sono legature di portamento né forcelle');
    [...slurs, ...wedges].forEach(removeSpan);
}

/**
 * Toglie gli estremi rimasti soli di legature di portamento e forcelle, per esempio dopo aver cancellato la nota dove
 * finivano: nella scrittura ogni segno ha inizio e fine.
 */
export function balanceSpanners(score: ScoreDocument): void {
    for (const marks of [slurMarks(score), wedgeMarks(score)]) {
        const matched = new Set(pairs(marks).flatMap((span) => [span.start, span.stop]));
        for (const mark of marks) if (!matched.has(mark) && mark.getAttribute('type') !== 'continue') removeMark(mark);
    }
}

// Corona e abbellimenti

/** Corona sulla nota, sull'accordo o sulla pausa; se c'è già si toglie. */
export function toggleFermata(score: ScoreDocument, noteId: string): void {
    const note = score.note(noteId);
    if (child(note, 'grace')) throw new EditError('La corona si mette su una nota o su una pausa');
    const event = score.eventOf(note);
    const existing = event.notes.flatMap((member) => children(child(member, 'notations'), 'fermata'));
    if (existing.length) {
        existing.forEach(removeMark);
        return;
    }
    ensureChild(event.notes[0], 'notations', NOTE_ORDER).appendChild(element(score.document, 'fermata', null, { type: 'upright' }));
}

/**
 * Su una nota aggiunge prima di lei un abbellimento della stessa altezza, una croma da spostare con le frecce; su un
 * abbellimento ne cambia il tipo. Restituisce l'abbellimento, da selezionare.
 */
export function setGraceNote(score: ScoreDocument, noteId: string, kind: GraceKind): string {
    const note = score.note(noteId);
    const grace = child(note, 'grace');
    if (grace) {
        if (kind === 'acciaccatura') grace.setAttribute('slash', 'yes');
        else grace.removeAttribute('slash');
        return noteId;
    }
    const head = score.eventOf(note).notes[0];
    if (isRest(head) || (!child(head, 'pitch') && !child(head, 'unpitched'))) throw new EditError('Gli abbellimenti si mettono prima di una nota');
    const owner = score.document;
    const created = element(owner, 'note', null, { id: score.newId('n') });
    created.appendChild(element(owner, 'grace', null, kind === 'acciaccatura' ? { slash: 'yes' } : {}));
    for (const name of ['pitch', 'unpitched', 'instrument', 'accidental', 'notehead', 'staff']) {
        const source = child(head, name);
        if (source) insertOrdered(created, source.cloneNode(true) as Element, NOTE_ORDER);
    }
    setChildText(created, 'voice', voiceOf(head), NOTE_ORDER);
    setChildText(created, 'type', 'eighth', NOTE_ORDER);
    head.before(created);
    makeAccidentalsExplicit(score, [score.measureIndex(score.measureOf(head))]);
    return created.getAttribute('id')!;
}

/** Figura di un abbellimento: solo la figura scritta, che non cambia la durata della battuta. */
export function setGraceFigure(note: Element, type: NoteType, dots: number): void {
    setChildText(note, 'type', type, NOTE_ORDER);
    for (const dot of children(note, 'dot')) dot.remove();
    for (let index = 0; index < dots; index++) insertOrdered(note, element(note.ownerDocument, 'dot'), NOTE_ORDER);
}

export function graceKindOf(note: Element): GraceKind | null {
    const grace = child(note, 'grace');
    if (!grace) return null;
    return grace.getAttribute('slash') === 'yes' ? 'acciaccatura' : 'appoggiatura';
}

// Testo di espressione

/**
 * Testo di espressione prima della nota, in corsivo: sopra il rigo le indicazioni di tempo e di chi suona («rit.»,
 * «solo»), sotto le altre («dolce»). Sostituisce il testo che la nota aveva già; `null` o un testo vuoto lo toglie.
 */
export function setExpression(score: ScoreDocument, noteId: string, value: string | null): void {
    const head = mainNote(score, score.note(noteId));
    if (!head) throw new EditError('Abbellimento senza nota principale');
    for (const direction of expressionDirections(head)) direction.remove();
    const words = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!words) return;
    if (words.length > MAX_EXPRESSION) throw new EditError(`Il testo può avere al massimo ${MAX_EXPRESSION} caratteri`);
    const owner = score.document;
    const direction = element(owner, 'direction', null, { placement: ABOVE_STAFF.test(words) ? 'above' : 'below' });
    direction.appendChild(element(owner, 'direction-type')).appendChild(element(owner, 'words', words, { 'font-style': 'italic' }));
    setChildText(direction, 'voice', voiceOf(head), DIRECTION_ORDER);
    const staff = text(child(head, 'staff'));
    if (staff) setChildText(direction, 'staff', staff, DIRECTION_ORDER);
    anchorOf(head).before(direction);
}

/** Il testo di espressione della nota, se ne ha uno. */
export function expressionOf(score: ScoreDocument, note: Element): string | null {
    const head = mainNote(score, note);
    if (!head) return null;
    const words = expressionDirections(head).flatMap((direction) => children(direction, 'direction-type').flatMap((type) => children(type, 'words').map((item) => (item.textContent ?? '').trim())));
    return words.filter(Boolean).join(' ') || null;
}

/** Le direzioni fatte solo di testo, senza suono, scritte subito prima della nota e dei suoi abbellimenti. */
function expressionDirections(note: Element): Element[] {
    const result: Element[] = [];
    let current = anchorOf(note).previousElementSibling;
    while (current && current.tagName === 'direction') {
        const types = children(current, 'direction-type');
        if (!child(current, 'sound') && types.length && types.every((type) => children(type).length > 0 && children(type).every((item) => item.tagName === 'words'))) result.unshift(current);
        current = current.previousElementSibling;
    }
    return result;
}

// Informazioni per l'editor

/** La nota fa parte di una legatura di portamento, all'inizio o alla fine. */
export function hasSlur(score: ScoreDocument, note: Element): boolean {
    return score.eventOf(note).notes.some((member) => children(child(member, 'notations'), 'slur').length > 0);
}

/** Forcella che inizia dalla nota, se c'è. */
export function wedgeOf(score: ScoreDocument, note: Element): WedgeKind | null {
    if (child(note, 'grace')) return null;
    const head = score.eventOf(note).notes[0];
    let current = anchorOf(head).previousElementSibling;
    while (current && current.tagName === 'direction') {
        for (const type of children(current, 'direction-type')) {
            const kind = child(type, 'wedge')?.getAttribute('type');
            if (kind === 'crescendo' || kind === 'diminuendo') return kind;
        }
        current = current.previousElementSibling;
    }
    return null;
}

export function hasFermata(score: ScoreDocument, note: Element): boolean {
    return score.eventOf(note).notes.some((member) => children(child(member, 'notations'), 'fermata').length > 0);
}

// Lettere di prova

/** Lettera di prova, o numero di riferimento, all'inizio della battuta; `null` o un testo vuoto la toglie. */
export function setRehearsal(score: ScoreDocument, index: number, value: string | null): void {
    const measure = score.measure(index);
    for (const direction of children(measure, 'direction')) {
        for (const type of children(direction, 'direction-type')) if (child(type, 'rehearsal')) type.remove();
        if (!child(direction, 'direction-type')) direction.remove();
    }
    const mark = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!mark) return;
    if (mark.length > MAX_REHEARSAL) throw new EditError(`La lettera di prova può avere al massimo ${MAX_REHEARSAL} caratteri`);
    const owner = score.document;
    const direction = element(owner, 'direction', null, { placement: 'above' });
    direction.appendChild(element(owner, 'direction-type')).appendChild(element(owner, 'rehearsal', mark));
    insertAtStart(measure, direction);
}

export function rehearsalOf(measure: Element): string | null {
    for (const direction of children(measure, 'direction')) {
        for (const type of children(direction, 'direction-type')) {
            const mark = text(child(type, 'rehearsal'));
            if (mark) return mark;
        }
    }
    return null;
}

/** Lettera proposta per la battuta: quella che segue l'ultima lettera prima di lei, dalla A; dopo la Z, AA, BB… */
export function nextRehearsal(score: ScoreDocument, index: number): string {
    let last: string | null = null;
    for (const measure of score.measures().slice(0, index)) {
        const mark = rehearsalOf(measure)?.toUpperCase() ?? null;
        if (mark && /^([A-Z])\1*$/.test(mark)) last = mark;
    }
    if (!last) return 'A';
    const letter = last[0];
    return letter === 'Z' ? 'A'.repeat(last.length + 1) : String.fromCharCode(letter.charCodeAt(0) + 1).repeat(last.length);
}

// Interruzioni di riga e di pagina

/** La battuta inizia una nuova riga o una nuova pagina; `null` toglie l'interruzione. */
export function setBreak(score: ScoreDocument, index: number, kind: BreakKind | null): void {
    if (index === 0 && kind) throw new EditError('La prima battuta apre già la prima riga e la prima pagina');
    const measure = score.measure(index);
    for (const print of children(measure, 'print')) {
        print.removeAttribute('new-system');
        print.removeAttribute('new-page');
        if (!print.attributes.length && !print.children.length) print.remove();
    }
    if (!kind) return;
    const print = child(measure, 'print') ?? measure.insertBefore(element(score.document, 'print'), measure.firstElementChild);
    print.setAttribute(kind === 'page' ? 'new-page' : 'new-system', 'yes');
}

export function breakOf(measure: Element): BreakKind | null {
    const prints = children(measure, 'print');
    if (prints.some((print) => print.getAttribute('new-page') === 'yes')) return 'page';
    if (prints.some((print) => print.getAttribute('new-system') === 'yes')) return 'system';
    return null;
}

/**
 * Interruzioni di riga ogni `count` battute, contate dall'inizio e da ogni nuova pagina, al posto di quelle che c'erano;
 * `null` toglie le interruzioni di riga. Le interruzioni di pagina restano.
 */
export function setBreaksEvery(score: ScoreDocument, count: number | null): void {
    if (count !== null && (!Number.isInteger(count) || count < 1 || count > MAX_BREAKS_EVERY)) throw new EditError(`Le battute per riga vanno da 1 a ${MAX_BREAKS_EVERY}`);
    const measures = score.measures();
    measures.forEach((measure, index) => {
        if (breakOf(measure) === 'system') setBreak(score, index, null);
    });
    if (count === null) return;
    let lineStart = 0;
    for (let index = 1; index < measures.length; index++) {
        if (breakOf(measures[index]) === 'page') lineStart = index;
        else if (index - lineStart >= count) {
            setBreak(score, index, 'system');
            lineStart = index;
        }
    }
}

// Funzioni interne

/** Primi elementi di ogni accordo, pausa e abbellimento di una voce, nell'ordine della parte. */
function heads(score: ScoreDocument, voice: string): Element[] {
    return score.measures().flatMap((measure) =>
        score
            .events(measure)
            .filter((event) => event.voice === voice)
            .map((event) => event.notes[0])
    );
}

/** La nota principale dell'accordo: per un abbellimento, la nota che lo segue. */
function mainNote(score: ScoreDocument, note: Element): Element | null {
    let current: Element | null = note;
    while (current && current.tagName === 'note' && child(current, 'grace')) current = current.nextElementSibling;
    return current?.tagName === 'note' ? score.eventOf(current).notes[0] : null;
}

/** Il punto prima della nota e dei suoi abbellimenti, dove si scrivono le direzioni che le appartengono. */
function anchorOf(note: Element): Element {
    let anchor = note;
    let current = note.previousElementSibling;
    while (current && current.tagName === 'note' && child(current, 'grace') && voiceOf(current) === voiceOf(note)) {
        anchor = current;
        current = current.previousElementSibling;
    }
    return anchor;
}

/** Inizi e fini dei segni con lo stesso numero, accoppiati nell'ordine della parte. */
function pairs(marks: Element[]): Span[] {
    const open = new Map<string, Element[]>();
    const result: Span[] = [];
    for (const mark of marks) {
        const number = mark.getAttribute('number') ?? '1';
        const type = mark.getAttribute('type');
        if (type === 'stop') {
            const start = open.get(number)?.pop();
            if (start) result.push({ start, stop: mark });
        } else if (type !== 'continue') {
            open.set(number, [...(open.get(number) ?? []), mark]);
        }
    }
    return result;
}

/** Il numero più basso libero per un segno da `start` a `stop`: né aperto in quel punto, né usato tra i due estremi. */
function freeNumber(marks: Element[], start: Element, stop: Element): string {
    const open = new Set<string>();
    const used = new Set<string>();
    for (const mark of marks) {
        const number = mark.getAttribute('number') ?? '1';
        if (precedes(mark, start)) {
            if (mark.getAttribute('type') === 'stop') open.delete(number);
            else open.add(number);
        } else if (precedes(mark, stop) || stop.contains(mark)) {
            used.add(number);
        }
    }
    for (let number = 1; number <= MAX_NUMBER; number++) if (!open.has(String(number)) && !used.has(String(number))) return String(number);
    throw new EditError('Troppi segni sovrapposti in questo punto');
}

function precedes(node: Node, other: Node): boolean {
    return !other.contains(node) && !node.contains(other) && !!(node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function removeSpan(span: Span): void {
    removeMark(span.start);
    removeMark(span.stop);
}

/** Toglie il segno e ciò che resta vuoto: le notazioni della nota, oppure il tipo e la direzione della forcella. */
function removeMark(mark: Element): void {
    const parent = mark.parentElement;
    mark.remove();
    if (parent?.tagName === 'direction-type') {
        const direction = parent.parentElement;
        removeIfEmpty(parent);
        if (direction && !child(direction, 'direction-type')) direction.remove();
    } else {
        removeIfEmpty(parent);
    }
}
