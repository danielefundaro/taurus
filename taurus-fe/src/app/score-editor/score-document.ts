import { child, children, integer, text } from './musicxml-dom';
import { ClefSpec, Fraction, divisionsFactor, Step, STEPS } from './notation-rules';

/** Attributo di lavoro con la posizione, da 0, della battuta nella versione aperta: serve a ritrovarla sulle pagine. */
export const SOURCE_ATTRIBUTE = 'taurus-source';
/** Attributo di lavoro sulla parte: i numeri di battuta erano consecutivi e vanno tenuti tali. */
const SEQUENTIAL_ATTRIBUTE = 'taurus-sequential';
/** Attributo di lavoro sul `<score-part>` di una partitura: gli strumenti del rigo, che cambiano con la cronologia. */
export const ROW_INSTRUMENTS_ATTRIBUTE = 'taurus-instruments';

/** Stato musicale in un punto della parte. */
export interface MusicalState {
    divisions: number;
    beats: number;
    beatType: number;
    fifths: number;
    clef: ClefSpec;
}

/** Una nota con le eventuali note dell'accordo che la seguono. */
export interface NoteEvent {
    notes: Element[];
    voice: string;
    /** Inizio dalla battuta, in divisioni. */
    start: number;
    /** Durata in divisioni; 0 per le note di abbellimento. */
    duration: number;
}

export interface ScoreDocumentChecks {
    /** Indici delle battute la cui durata non corrisponde al metro, battute in levare escluse. */
    wrongDuration: number[];
    /** Indici delle battute senza note né pause. */
    empty: number[];
}

/** Errore di un'operazione dell'editor, con un messaggio per l'utente. */
export class EditError extends Error {}

const DEFAULT_STATE: MusicalState = { divisions: 1, beats: 4, beatType: 4, fifths: 0, clef: { sign: 'G', line: 2, octaveChange: 0 } };

/**
 * Parte MusicXML aperta nell'editor, o partitura con una parte per rigo. Battute e note ricevono un `id`, che Verovio
 * conserva nello spartito disegnato: così un clic sullo spartito individua il nodo MusicXML da modificare. Gli `id`
 * aggiunti e gli attributi di lavoro sono tolti dal file salvato.
 *
 * In una partitura le operazioni lavorano sul rigo attivo, `part`; quelle sulla struttura si ripetono per ogni rigo con
 * `everyPart`.
 */
export class ScoreDocument {
    private counter: number;
    private active: Element;

    private constructor(
        readonly document: Document,
        part: Element,
        readonly prefix: string,
        counter: number
    ) {
        this.active = part;
        this.counter = counter;
    }

    /** Apre il MusicXML di una versione: tutti i righi, con il primo attivo. */
    static open(xml: string, prefix = `te${Math.random().toString(36).slice(2, 7)}-`): ScoreDocument {
        const document = parse(xml);
        const score = new ScoreDocument(document, firstPart(document), prefix, 0);
        score.everyPart(() => {
            score.measures().forEach((measure, index) => measure.setAttribute(SOURCE_ATTRIBUTE, String(index)));
            if (sequentialNumbers(score.measures())) score.part.setAttribute(SEQUENTIAL_ATTRIBUTE, 'yes');
        });
        score.assignAllIds();
        return score;
    }

    /** Ricostruisce il documento da un'istantanea della cronologia delle modifiche, con il rigo attivo indicato. */
    static restore(snapshot: string, prefix: string, partIndex = 0): ScoreDocument {
        const document = parse(snapshot);
        let counter = 0;
        for (const item of Array.from(document.querySelectorAll('[id]'))) {
            const id = item.getAttribute('id') ?? '';
            if (id.startsWith(prefix)) counter = Math.max(counter, Number(id.slice(prefix.length + 1)) || 0);
        }
        const parts = children(document.documentElement, 'part');
        return new ScoreDocument(document, parts[partIndex] ?? firstPart(document), prefix, counter);
    }

    /** Il rigo attivo: l'unica parte di una parte singola. */
    get part(): Element {
        return this.active;
    }

    /** Le parti del documento, una per rigo nella partitura. */
    parts(): Element[] {
        return children(this.document.documentElement, 'part');
    }

    /** Posizione del rigo attivo, da 0. */
    get partIndex(): number {
        return this.parts().indexOf(this.active);
    }

    /** Rende attivo il rigo indicato. */
    selectPart(index: number): void {
        const part = this.parts()[index];
        if (!part) throw new EditError('Rigo non trovato');
        this.active = part;
    }

    /** Posizione del rigo che contiene l'elemento; -1 se è fuori dalle parti. */
    partIndexOf(node: Element): number {
        let current: Element | null = node;
        while (current && current.tagName !== 'part') current = current.parentElement;
        return current ? this.parts().indexOf(current) : -1;
    }

    /** Elemento con l'`id` indicato in qualsiasi rigo, per esempio la nota cliccata su un altro rigo. */
    findInScore(id: string): Element | null {
        const safe = id.replace(/"/g, '');
        for (const part of this.parts()) {
            const found = part.querySelector(`[id="${safe}"]`);
            if (found) return found;
        }
        return null;
    }

    /** Esegue l'operazione su ogni rigo, attivo a turno, e torna al rigo attivo di prima. */
    everyPart<T>(change: (index: number) => T): T[] {
        const previous = this.active;
        try {
            return this.parts().map((part, index) => {
                this.active = part;
                return change(index);
            });
        } finally {
            this.active = previous.parentNode ? previous : (this.parts()[0] ?? previous);
        }
    }

    /** Assegna gli `id` mancanti, o ripetuti in un altro rigo, alle battute e alle note di tutti i righi. */
    assignAllIds(): void {
        const seen = new Set<string>();
        this.everyPart(() => this.assignIds(seen));
    }

    /** Documento completo, con gli `id` di lavoro: per disegnarlo e per la cronologia. */
    snapshot(): string {
        return new XMLSerializer().serializeToString(this.document);
    }

    /** MusicXML da salvare, senza `id` e attributi di lavoro. */
    cleanXml(): string {
        const copy = this.document.cloneNode(true) as Document;
        for (const item of Array.from(copy.querySelectorAll('[id]'))) {
            if ((item.getAttribute('id') ?? '').startsWith(this.prefix)) item.removeAttribute('id');
        }
        for (const item of Array.from(copy.querySelectorAll(`[${SOURCE_ATTRIBUTE}], [${SEQUENTIAL_ATTRIBUTE}], [${ROW_INSTRUMENTS_ATTRIBUTE}]`))) {
            item.removeAttribute(SOURCE_ATTRIBUTE);
            item.removeAttribute(SEQUENTIAL_ATTRIBUTE);
            item.removeAttribute(ROW_INSTRUMENTS_ATTRIBUTE);
        }
        const xml = new XMLSerializer().serializeToString(copy);
        return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    }

    /** Per ogni battuta, la sua posizione nella versione aperta; `null` per le battute inserite. */
    measureSources(): (number | null)[] {
        return this.measures().map((measure) => {
            const value = measure.getAttribute(SOURCE_ATTRIBUTE);
            return value === null ? null : Number(value);
        });
    }

    measures(): Element[] {
        return children(this.part, 'measure');
    }

    measure(index: number): Element {
        const measure = this.measures()[index];
        if (!measure) throw new EditError('Battuta non trovata');
        return measure;
    }

    measureIndex(measure: Element): number {
        return this.measures().indexOf(measure);
    }

    /** Note e pause della parte, nell'ordine del documento. */
    notes(): Element[] {
        return this.measures().flatMap((measure) => children(measure, 'note'));
    }

    find(id: string): Element | null {
        return this.part.querySelector(`[id="${id.replace(/"/g, '')}"]`);
    }

    note(id: string): Element {
        const found = this.find(id);
        if (!found || found.tagName !== 'note') throw new EditError('Nota non trovata');
        return found;
    }

    measureOf(note: Element): Element {
        const measure = note.parentElement;
        if (!measure || measure.tagName !== 'measure') throw new EditError('Nota fuori da una battuta');
        return measure;
    }

    newId(kind: 'm' | 'n'): string {
        this.counter++;
        return `${this.prefix}${kind}${this.counter}`;
    }

    /** Assegna un `id` univoco a battute e note del rigo attivo che non lo hanno. */
    assignIds(seen = new Set<string>()): void {
        for (const measure of this.measures()) {
            this.assignId(measure, 'm', seen);
            for (const note of children(measure, 'note')) this.assignId(note, 'n', seen);
        }
    }

    /** Stato musicale all'inizio di ogni battuta, dopo gli attributi che la aprono. */
    measureStates(): MusicalState[] {
        const states: MusicalState[] = [];
        let state = { ...DEFAULT_STATE };
        for (const measure of this.measures()) {
            let opened = false;
            for (const item of children(measure)) {
                if (item.tagName === 'note' || item.tagName === 'backup' || item.tagName === 'forward') {
                    if (!opened) states.push({ ...state });
                    opened = true;
                } else if (item.tagName === 'attributes') {
                    state = applyAttributes(state, item);
                }
            }
            if (!opened) states.push({ ...state });
        }
        return states;
    }

    stateAt(measureIndex: number): MusicalState {
        return this.measureStates()[measureIndex] ?? { ...DEFAULT_STATE };
    }

    /**
     * Stato in vigore in un punto preciso della parte: prima di una battuta, oppure prima di un elemento di una battuta,
     * compresi gli attributi che lo precedono nella stessa battuta.
     */
    stateBefore(node: Element): MusicalState {
        let state = { ...DEFAULT_STATE };
        for (const measure of this.measures()) {
            if (measure === node) return state;
            for (const item of children(measure)) {
                if (item === node) return state;
                if (item.tagName === 'attributes') state = applyAttributes(state, item);
            }
        }
        return state;
    }

    /** Stato alla fine della battuta, dopo tutti i suoi attributi. */
    stateAfter(measure: Element): MusicalState {
        let state = { ...DEFAULT_STATE };
        for (const current of this.measures()) {
            for (const item of children(current, 'attributes')) state = applyAttributes(state, item);
            if (current === measure) return state;
        }
        return state;
    }

    /** Chiave in vigore per ogni nota della parte, compresi i cambi di chiave all'interno delle battute. */
    clefsByNote(): Map<Element, ClefSpec> {
        const result = new Map<Element, ClefSpec>();
        let state = { ...DEFAULT_STATE };
        for (const measure of this.measures()) {
            for (const item of children(measure)) {
                if (item.tagName === 'attributes') state = applyAttributes(state, item);
                else if (item.tagName === 'note') result.set(item, state.clef);
            }
        }
        return result;
    }

    /** Note della battuta raggruppate per accordo, con voce, inizio e durata in divisioni. */
    events(measure: Element): NoteEvent[] {
        const events: NoteEvent[] = [];
        let position = 0;
        for (const item of children(measure)) {
            if (item.tagName === 'note') {
                if (child(item, 'chord') && events.length) {
                    events[events.length - 1].notes.push(item);
                    continue;
                }
                const duration = child(item, 'grace') || child(item, 'cue') ? 0 : (integer(child(item, 'duration')) ?? 0);
                events.push({ notes: [item], voice: voiceOf(item), start: position, duration });
                position += duration;
            } else if (item.tagName === 'backup') {
                position = Math.max(0, position - (integer(child(item, 'duration')) ?? 0));
            } else if (item.tagName === 'forward') {
                position += integer(child(item, 'duration')) ?? 0;
            }
        }
        return events;
    }

    /** L'accordo, o la nota singola, a cui appartiene la nota. */
    eventOf(note: Element): NoteEvent {
        const event = this.events(this.measureOf(note)).find((candidate) => candidate.notes.includes(note));
        if (!event) throw new EditError('Nota non trovata');
        return event;
    }

    /** Controlli in tempo reale: battute di durata errata e battute vuote. */
    checks(): ScoreDocumentChecks {
        const wrongDuration: number[] = [];
        const empty: number[] = [];
        const states = this.measureStates();
        this.measures().forEach((measure, index) => {
            const events = this.events(measure);
            if (!events.length) {
                empty.push(index);
                return;
            }
            if (measure.getAttribute('implicit') === 'yes') return;
            if (Math.abs(this.contentLength(measure) - this.expectedLength(states[index])) > 1e-6) wrongDuration.push(index);
        });
        return { wrongDuration, empty };
    }

    /** Lunghezza del contenuto della battuta in divisioni: la posizione più avanzata raggiunta da note e avanzamenti. */
    contentLength(measure: Element): number {
        let position = 0;
        let longest = 0;
        for (const item of children(measure)) {
            if (item.tagName === 'note') {
                if (child(item, 'chord') || child(item, 'grace') || child(item, 'cue')) continue;
                position += integer(child(item, 'duration')) ?? 0;
            } else if (item.tagName === 'backup') {
                position -= integer(child(item, 'duration')) ?? 0;
            } else if (item.tagName === 'forward') {
                position += integer(child(item, 'duration')) ?? 0;
            }
            longest = Math.max(longest, position);
        }
        return longest;
    }

    /** Durata prevista dal metro, in divisioni. */
    expectedLength(state: MusicalState): number {
        return (state.beats * 4 * state.divisions) / state.beatType;
    }

    /**
     * Moltiplica divisioni e durate della parte, se serve, perché la durata indicata in semiminime sia un numero intero di
     * divisioni dove valgono le divisioni indicate. Restituisce le divisioni in vigore lì dopo l'adeguamento.
     */
    ensureDivisions(quarters: Fraction, divisions: number): number {
        const factor = divisionsFactor(quarters, divisions);
        if (factor > 1) {
            for (const item of Array.from(this.part.querySelectorAll('divisions, duration, offset'))) {
                const value = integer(item);
                if (value !== null) item.textContent = String(value * factor);
            }
        }
        return divisions * factor;
    }

    /** Numeri di battuta consecutivi dopo un inserimento o un'eliminazione, se lo erano all'apertura. */
    renumber(): void {
        const measures = this.measures();
        if (!measures.length) return;
        if (this.part.getAttribute(SEQUENTIAL_ATTRIBUTE) === 'yes') {
            let counter = Number.parseInt(measures[0].getAttribute('number') ?? '', 10);
            if (!Number.isFinite(counter)) counter = measures[0].getAttribute('implicit') === 'yes' ? 0 : 1;
            measures[0].setAttribute('number', String(counter));
            for (const measure of measures.slice(1)) {
                if (measure.getAttribute('implicit') === 'yes' && measure.getAttribute('number')) continue;
                counter++;
                measure.setAttribute('number', String(counter));
            }
            return;
        }
        measures.forEach((measure, index) => {
            if (measure.getAttribute('number')) return;
            const previous = index > 0 ? measures[index - 1].getAttribute('number') : null;
            measure.setAttribute('number', previous ? `${previous}a` : '1');
        });
    }

    private assignId(item: Element, kind: 'm' | 'n', seen: Set<string>): void {
        const id = item.getAttribute('id');
        if (!id || seen.has(id)) item.setAttribute('id', this.newId(kind));
        seen.add(item.getAttribute('id')!);
    }
}

export function voiceOf(note: Element): string {
    return text(child(note, 'voice')) ?? '1';
}

/** Nome di nota e ottava, scritte; per le note senza altezza la posizione sul rigo. */
export function pitchOf(note: Element): { step: Step; octave: number; alter: number; unpitched: boolean } | null {
    const pitch = child(note, 'pitch');
    if (pitch) {
        const step = text(child(pitch, 'step')) as Step | null;
        const octave = integer(child(pitch, 'octave'));
        if (!step || !STEPS.includes(step) || octave === null) return null;
        return { step, octave, alter: Number(text(child(pitch, 'alter')) ?? 0) || 0, unpitched: false };
    }
    const unpitched = child(note, 'unpitched');
    if (unpitched) {
        const step = (text(child(unpitched, 'display-step')) ?? 'B') as Step;
        return { step: STEPS.includes(step) ? step : 'B', octave: integer(child(unpitched, 'display-octave')) ?? 4, alter: 0, unpitched: true };
    }
    return null;
}

export function isRest(note: Element): boolean {
    return !!child(note, 'rest');
}

function applyAttributes(state: MusicalState, attributes: Element): MusicalState {
    const next = { ...state };
    const divisions = integer(child(attributes, 'divisions'));
    if (divisions && divisions > 0) next.divisions = divisions;
    const key = child(attributes, 'key');
    const fifths = integer(child(key, 'fifths'));
    if (fifths !== null) next.fifths = fifths;
    const time = child(attributes, 'time');
    if (time) {
        const beats = (text(child(time, 'beats')) ?? '').split('+').reduce((sum, part) => sum + (Number(part) || 0), 0);
        const beatType = integer(child(time, 'beat-type'));
        if (beats > 0 && beatType && beatType > 0) {
            next.beats = beats;
            next.beatType = beatType;
        }
    }
    const clef = children(attributes, 'clef').find((item) => !item.getAttribute('number') || item.getAttribute('number') === '1');
    if (clef) {
        next.clef = {
            sign: text(child(clef, 'sign')) ?? 'G',
            line: integer(child(clef, 'line')) ?? ({ G: 2, F: 4, C: 3 } as Record<string, number>)[text(child(clef, 'sign')) ?? 'G'] ?? 3,
            octaveChange: integer(child(clef, 'clef-octave-change')) ?? 0
        };
    }
    return next;
}

function parse(xml: string): Document {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) throw new EditError('Il MusicXML della versione non è leggibile');
    if (document.documentElement.tagName !== 'score-partwise') throw new EditError('Il MusicXML della versione non è una partitura per parti');
    return document;
}

function firstPart(document: Document): Element {
    const part = children(document.documentElement, 'part')[0];
    if (!part) throw new EditError('La versione non contiene parti');
    return part;
}

/** I numeri delle battute, levare escluse, sono interi consecutivi. */
function sequentialNumbers(measures: Element[]): boolean {
    let previous: number | null = null;
    for (const [index, measure] of measures.entries()) {
        if (index > 0 && measure.getAttribute('implicit') === 'yes') continue;
        const value = Number(measure.getAttribute('number'));
        if (!Number.isInteger(value)) return false;
        if (previous !== null && value !== previous + 1) return false;
        previous = value;
    }
    return true;
}
