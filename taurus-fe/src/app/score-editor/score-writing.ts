import { respell, setAlter } from './accidentals';
import { child, children, element, insertOrdered, integer, NOTE_ORDER, removeChildren, removeIfEmpty } from './musicxml-dom';
import { diatonic, Fraction, fraction, fromDiatonic, inferType, middleLine, minus, NOTE_TYPES, noteQuarters, NoteType, Step, toNumber } from './notation-rules';
import { EditError, isRest, NoteEvent, pitchOf, ScoreDocument, voiceOf } from './score-document';
import { addTie, addTuplet, clearTies, figureOf, insertAtEnd, insertMeasure, refreshMeasure, removeTie, tieChain, toggleRest, TUPLETS, tupletOf, writeFigure, writePitch } from './score-edits';
import { setGraceFigure } from './score-notation';

/**
 * Operazioni della scrittura: inserimento al cursore come in MuseScore, con le battute sempre complete. Una nota più
 * lunga dello spazio rimasto si divide e si lega oltre la stanghetta, ciò che la nota copre parzialmente diventa pausa e
 * ogni voce di ogni battuta dura quanto il metro. La correzione (`score-edits.ts`) continua ad accettare battute sbagliate.
 */

/** Voci di un rigo: la prima c'è sempre, le altre compaiono nelle battute dove si scrive. */
export const VOICES = [1, 2, 3, 4] as const;

/** Posizione del cursore: battuta, voce e istante dall'inizio della battuta, in semiminime. */
export interface WritingCursor {
    measureIndex: number;
    voice: number;
    offset: Fraction;
}

/** Figura corrente della scrittura. */
export interface WritingFigure {
    type: NoteType;
    dots: number;
}

/** Esito di una scrittura: la prima nota scritta, da selezionare, e il cursore dopo di lei. */
export interface WriteResult {
    noteId: string;
    cursor: WritingCursor;
}

interface Piece {
    type: NoteType;
    dots: number;
    /** Durata in divisioni. */
    value: number;
}

interface TupletRatio {
    actual: number;
    normal: number;
}

export interface TupletGroup {
    start: number;
    end: number;
    ratio: TupletRatio;
    events: NoteEvent[];
}

// Cursore

/** Cursore all'inizio della parte, nella voce indicata. */
export function startCursor(voice = 1): WritingCursor {
    return { measureIndex: 0, voice, offset: fraction(0) };
}

/** Cursore sulla nota indicata: inizio del suo accordo, nella sua voce. */
export function cursorAt(score: ScoreDocument, noteId: string): WritingCursor {
    const note = score.note(noteId);
    const event = score.eventOf(note);
    const measureIndex = score.measureIndex(score.measureOf(note));
    return { measureIndex, voice: voiceNumber(event.voice), offset: fraction(event.start, score.stateAt(measureIndex).divisions) };
}

/** Cursore valido dopo una modifica o un «Annulla»: nella parte e non oltre la fine della sua battuta. */
export function clampCursor(score: ScoreDocument, cursor: WritingCursor): WritingCursor {
    const last = score.measures().length - 1;
    const lengthOf = (index: number) => fraction(Math.round(measureLength(score, index)), score.stateAt(index).divisions);
    if (cursor.measureIndex > last) return { measureIndex: last, voice: cursor.voice, offset: lengthOf(last) };
    if (cursor.measureIndex < 0 || toNumber(cursor.offset) < 0) return { measureIndex: Math.max(0, cursor.measureIndex), voice: cursor.voice, offset: fraction(0) };
    const length = lengthOf(cursor.measureIndex);
    return toNumber(cursor.offset) > toNumber(length) ? { ...cursor, offset: length } : cursor;
}

/** Sposta il cursore alla nota seguente o precedente della sua voce, passando alle battute vicine. */
export function moveCursor(score: ScoreDocument, cursor: WritingCursor, delta: 1 | -1): WritingCursor {
    const measures = score.measures();
    const divisions = score.stateAt(cursor.measureIndex).divisions;
    const position = toNumber(cursor.offset) * divisions;
    const length = measureLength(score, cursor.measureIndex);
    const events = voiceEvents(score, measures[cursor.measureIndex], String(cursor.voice));
    if (delta === 1) {
        const next = events.find((event) => event.start + event.duration > position + 1e-6);
        const target = next ? next.start + next.duration : length;
        if (target < length - 1e-6) return { ...cursor, offset: fraction(target, divisions) };
        if (cursor.measureIndex + 1 < measures.length) return { ...cursor, measureIndex: cursor.measureIndex + 1, offset: fraction(0) };
        return { ...cursor, offset: fraction(length, divisions) };
    }
    const previous = [...events].reverse().find((event) => event.start < position - 1e-6);
    if (previous) return { ...cursor, offset: fraction(previous.start, divisions) };
    if (cursor.measureIndex === 0) return { ...cursor, offset: fraction(0) };
    const index = cursor.measureIndex - 1;
    const before = voiceEvents(score, measures[index], String(cursor.voice));
    const last = before[before.length - 1];
    return { ...cursor, measureIndex: index, offset: fraction(last ? last.start : 0, score.stateAt(index).divisions) };
}

/** Nota o pausa che inizia al cursore nella sua voce, per evidenziarla; `null` alla fine della battuta. */
export function noteAtCursor(score: ScoreDocument, cursor: WritingCursor): string | null {
    const measure = score.measures()[cursor.measureIndex];
    if (!measure) return null;
    const position = toNumber(cursor.offset) * score.stateAt(cursor.measureIndex).divisions;
    const event = voiceEvents(score, measure, String(cursor.voice)).find((candidate) => Math.abs(candidate.start - position) < 1e-6);
    return event?.notes[0].getAttribute('id') ?? null;
}

/** Posizione del cursore per la barra di stato: «Battuta 12 · tempo 3 · voce 1». */
export function cursorLabel(score: ScoreDocument, cursor: WritingCursor): string {
    const measure = score.measures()[cursor.measureIndex];
    if (!measure) return '';
    const state = score.stateAt(cursor.measureIndex);
    const number = measure.getAttribute('number') ?? String(cursor.measureIndex + 1);
    const length = measureLength(score, cursor.measureIndex);
    const position = toNumber(cursor.offset) * state.divisions;
    const voice = `voce ${cursor.voice}`;
    if (position >= length - 1e-6) return `Battuta ${number} · fine della battuta · ${voice}`;
    const beat = (4 * state.divisions) / state.beatType;
    const compound = state.beatType === 8 && state.beats % 3 === 0 && state.beats > 3;
    const unit = compound ? beat * 3 : beat;
    const index = position / unit;
    const label = Math.abs(index - Math.round(index)) < 1e-6 ? `tempo ${Math.round(index) + 1}` : `dopo il tempo ${Math.floor(index) + 1}`;
    return `Battuta ${number} · ${label} · ${voice}`;
}

// Scrittura al cursore

/**
 * Scrive al cursore una nota con il nome indicato, all'ottava più vicina alla nota precedente della voce, e sposta il
 * cursore dopo di lei. L'alterazione è quella dell'armatura e degli accidenti della battuta, come scrivendo a mano.
 */
export function writeNote(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure, step: Step): WriteResult {
    const at = enterMeasure(score, cursor);
    const state = score.stateAt(at.measureIndex);
    const percussion = state.clef.sign === 'percussion';
    const reference = pitchBefore(score, at) ?? middleLine(state.clef);
    const current = diatonic(reference.step, reference.octave);
    const target = [reference.octave - 1, reference.octave, reference.octave + 1].map((octave) => diatonic(step, octave)).reduce((best, value) => (Math.abs(value - current) < Math.abs(best - current) ? value : best));
    const pitch = fromDiatonic(target);
    if (pitch.octave < 0 || pitch.octave > 9) throw new EditError('Altezza fuori estensione');
    return write(score, at, figure, [noteTemplate(score, at.voice, pitch.step, pitch.octave, percussion)]);
}

/** Scrive al cursore una pausa della figura corrente. */
export function writeRest(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure): WriteResult {
    const at = enterMeasure(score, cursor);
    return write(score, at, figure, [restTemplate(score, at.voice)]);
}

/** Scrive al cursore la nota, o l'accordo, che lo precede nella voce, legata a lei: la legatura di valore della scrittura. */
export function writeTied(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure): WriteResult {
    const previous = eventBefore(score, cursor);
    if (!previous || isRest(previous.notes[0]) || child(previous.notes[0], 'grace')) throw new EditError('Nessuna nota prima del cursore da legare');
    return write(score, enterMeasure(score, cursor), figure, previous.notes, previous.notes);
}

/**
 * Aggiunge all'accordo della nota una nota con il nome indicato, la più vicina sopra la nota più acuta, anche sulle note
 * legate che la seguono. Restituisce l'`id` della nota aggiunta.
 */
export function addChordPitch(score: ScoreDocument, noteId: string, step: Step): string {
    const note = score.note(noteId);
    if (isRest(note)) throw new EditError('Le pause non formano accordi: scrivi prima una nota');
    const chain = tiedEvents(score, score.eventOf(note));
    const top = chain[0].notes.map((member) => pitchOf(member)).reduce((highest, pitch) => (pitch ? Math.max(highest, diatonic(pitch.step, pitch.octave)) : highest), Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(top)) throw new EditError('Nota senza altezza');
    let value = diatonic(step, 0);
    while (value <= top) value += 7;
    const pitch = fromDiatonic(value);
    if (pitch.octave > 9) throw new EditError('Altezza fuori estensione');
    let previous: Element | null = null;
    let added: string | null = null;
    for (const event of chain) {
        const last = event.notes[event.notes.length - 1];
        // La copia mantiene figura, punti e gruppo irregolare dell'accordo.
        const copy = last.cloneNode(true) as Element;
        for (const name of ['tie', 'accidental', 'stem', 'beam', 'lyric', 'notations']) removeChildren(copy, name);
        copy.setAttribute('id', score.newId('n'));
        if (!child(copy, 'chord')) insertOrdered(copy, element(copy.ownerDocument, 'chord'), NOTE_ORDER);
        writePitch(copy, pitch.step, pitch.octave);
        last.after(copy);
        if (previous) {
            addTie(previous, 'start');
            addTie(copy, 'stop');
        }
        previous = copy;
        added ??= copy.getAttribute('id');
    }
    finish(
        score,
        chain.map((event) => score.measureIndex(score.measureOf(event.notes[0])))
    );
    return added!;
}

/**
 * Crea al cursore un gruppo irregolare lungo quanto la figura corrente: terzina di crome al posto di una semiminima,
 * quintina e sestina di semicrome. Il gruppo nasce di pause, il cursore resta al suo inizio e la figura da usare per
 * riempirlo è quella dei suoi elementi.
 */
export function writeTuplet(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure, actual: number): WriteResult & { figure: WritingFigure } {
    const option = TUPLETS.find((candidate) => candidate.actual === actual);
    if (!option) throw new EditError('Gruppo irregolare non previsto');
    if (figure.dots) throw new EditError('Togli il punto di valore per creare un gruppo irregolare');
    const member = inferType(toNumber(noteQuarters(figure.type, 0)) / option.normal);
    if (!member || member.dots) throw new EditError('Per questo gruppo irregolare scegli una figura più lunga');
    const at = enterMeasure(score, cursor);
    const ratio = { actual: option.actual, normal: option.normal };
    const divisions = prepare(score, at, [noteQuarters(figure.type, 0), noteQuarters(member.type, 0, ratio.actual, ratio.normal)]);
    const measure = score.measure(at.measureIndex);
    const position = toNumber(at.offset) * divisions;
    const total = toNumber(noteQuarters(figure.type, 0)) * divisions;
    if (position + total > measureLength(score, at.measureIndex) + 1e-6) throw new EditError('Il gruppo irregolare non entra nella battuta: scegli una figura più breve');
    if (groupAt(score, measure, String(at.voice), position)) throw new EditError('Il cursore è già in un gruppo irregolare');
    const rests = replaceSpan(score, at.measureIndex, String(at.voice), position, total, [restTemplate(score, at.voice)], { preferred: { ...figure, value: total } });
    const placeholder = rests[0][0];
    const members: Element[] = [];
    for (let index = 0; index < ratio.actual; index++) {
        const rest = restTemplate(score, at.voice);
        rest.setAttribute('id', score.newId('n'));
        placeholder.before(rest);
        writeFigure(score, [rest], member.type, 0, ratio);
        members.push(rest);
    }
    for (const piece of rests) for (const item of piece) item.remove();
    addTuplet(members[0], 'start');
    addTuplet(members[members.length - 1], 'stop');
    finish(score, [at.measureIndex]);
    return { noteId: members[0].getAttribute('id')!, cursor: at, figure: { type: member.type, dots: 0 } };
}

// Scrittura sulla selezione

/**
 * Cambia la figura della nota come nella scrittura: allungandola copre le note seguenti, che diventano pause per la parte
 * che resta, e se serve si lega oltre la stanghetta; accorciandola lascia una pausa. Restituisce l'`id` della nota.
 */
export function setWrittenDuration(score: ScoreDocument, noteId: string, figure: WritingFigure): string {
    const note = score.note(noteId);
    if (child(note, 'grace')) {
        // Gli abbellimenti cambiano solo la figura scritta: non hanno durata nella battuta.
        for (const member of score.eventOf(note).notes) setGraceFigure(member, figure.type, figure.dots);
        return noteId;
    }
    const event = score.eventOf(note);
    const cursor = cursorAt(score, event.notes[0].getAttribute('id')!);
    // La nota legata alla precedente resta legata.
    const previous = event.notes.some(hasTieStop) ? eventBefore(score, cursor) : null;
    return write(score, cursor, figure, event.notes, previous?.notes).noteId;
}

/** Aggiunge un punto di valore alla figura della nota, fino a due, poi li toglie: come `setWrittenDuration`. */
export function cycleWrittenDots(score: ScoreDocument, noteId: string): string {
    const note = score.note(noteId);
    const figure = figureOf(score, score.eventOf(note).notes[0]);
    if (!figure) throw new EditError('Indica prima la figura della nota');
    return setWrittenDuration(score, noteId, { type: figure.type, dots: (figure.dots + 1) % 3 });
}

/**
 * Crea un gruppo irregolare dalla nota, che diventa il primo elemento di un gruppo lungo quanto lei, oppure toglie il
 * gruppo a cui appartiene, che torna una sola nota con il contenuto del suo primo elemento. Restituisce l'`id` della nota.
 */
export function toggleWrittenTuplet(score: ScoreDocument, noteId: string, actual: number): string {
    const note = score.note(noteId);
    if (child(note, 'grace')) throw new EditError('Gli abbellimenti non entrano nei gruppi irregolari');
    const event = score.eventOf(note);
    const measure = score.measureOf(note);
    const group = groupAt(score, measure, event.voice, event.start);
    const measureIndex = score.measureIndex(measure);
    if (group) {
        const total = group.end - group.start;
        const preferred = inferType(total / score.stateAt(measureIndex).divisions);
        const pieces = replaceSpan(score, measureIndex, event.voice, group.start, total, group.events[0].notes, { preferred: preferred ? { ...preferred, value: total } : undefined });
        finish(score, [measureIndex]);
        return pieces[0][0].getAttribute('id')!;
    }
    const figure = figureOf(score, event.notes[0]);
    if (!figure) throw new EditError('Indica prima la figura della nota');
    const templates = event.notes.map((item) => item.cloneNode(true) as Element);
    const created = writeTuplet(score, cursorAt(score, event.notes[0].getAttribute('id')!), figure, actual);
    if (isRest(templates[0])) return created.noteId;
    return write(score, created.cursor, created.figure, templates).noteId;
}

/**
 * Nella scrittura eliminare una nota la trasforma in pausa, così la battuta resta completa; una voce oltre la prima fatta
 * solo di pause si toglie dalla battuta. Restituisce l'`id` da selezionare.
 */
export function clearWrittenNote(score: ScoreDocument, noteId: string): string | null {
    const note = score.note(noteId);
    const measure = score.measureOf(note);
    const voice = voiceOf(note);
    if (child(note, 'grace')) {
        // Un abbellimento si toglie, e si seleziona la nota che lo seguiva.
        let main = note.nextElementSibling;
        while (main && main.tagName === 'note' && child(main, 'grace')) main = main.nextElementSibling;
        for (const member of score.eventOf(note).notes) member.remove();
        finish(score, [score.measureIndex(measure)]);
        return main?.tagName === 'note' ? main.getAttribute('id') : (child(measure, 'note')?.getAttribute('id') ?? null);
    }
    if (!isRest(note)) {
        toggleRest(score, noteId);
        return noteId;
    }
    if (voice === '1') throw new EditError('Le pause della prima voce restano: la battuta è sempre completa');
    const events = voiceEvents(score, measure, voice);
    if (events.some((event) => !isRest(event.notes[0]))) throw new EditError('Trasforma prima in pause le note di questa voce');
    removeVoice(measure, voice, events);
    finish(score, [score.measureIndex(measure)]);
    return child(measure, 'note')?.getAttribute('id') ?? null;
}

/**
 * Riempie di pause un tratto della voce lungo `length` semiminime dal cursore, anche oltre le stanghette, e aggiunge
 * battute alla fine della parte se serve: è il primo passo per incollare, tagliare e cancellare un passaggio. Le dinamiche
 * delle note tolte spariscono con loro; una voce oltre la prima rimasta solo di pause si toglie dalla battuta, la prima
 * voce di una battuta svuotata del tutto diventa una pausa di battuta. Restituisce le battute toccate.
 */
export function clearSpan(score: ScoreDocument, cursor: WritingCursor, length: Fraction): number[] {
    const voice = String(cursor.voice);
    let measureIndex = cursor.measureIndex;
    let offset = cursor.offset;
    let remaining = length;
    const touched: number[] = [];
    while (toNumber(remaining) > 1e-9) {
        const divisions = prepare(score, { measureIndex, voice: cursor.voice, offset }, [remaining]);
        const size = measureLength(score, measureIndex);
        const position = toNumber(offset) * divisions;
        const span = Math.min(toNumber(remaining) * divisions, size - position);
        if (span > 1e-6) {
            const measure = score.measure(measureIndex);
            completeVoice(score, measureIndex, voice);
            const end = position + span;
            const events = voiceEvents(score, measure, voice);
            for (const group of tupletGroups(events)) {
                const inside = group.end > position + 1e-6 && group.start < end - 1e-6;
                if (inside && (group.start < position - 1e-6 || group.end > end + 1e-6)) throw new EditError('Il passaggio coprirebbe solo una parte di un gruppo irregolare: scegli un altro punto');
            }
            for (const event of events) if (event.start >= position - 1e-6 && event.start < end - 1e-6) removeNoteDirections(event.notes[0]);
            replaceSpan(score, measureIndex, voice, position, span, [restTemplate(score, cursor.voice)], {});
            touched.push(measureIndex);
            remaining = minus(remaining, fraction(Math.round(span), divisions));
        }
        if (toNumber(remaining) <= 1e-9) break;
        if (measureIndex + 1 >= score.measures().length) insertMeasure(score, measureIndex, 'after');
        measureIndex++;
        offset = fraction(0);
    }
    for (const index of touched) tidyVoice(score, index, voice);
    finish(score, touched);
    return touched;
}

/** Scrive al cursore il contenuto dei modelli con la figura indicata, come le altre scritture: serve a incollare. */
export function writeContent(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure, templates: Element[], tieFrom?: Element[]): WriteResult {
    return write(score, enterMeasure(score, cursor), figure, templates, tieFrom);
}

/** Dopo un cambio di metro completa con pause le voci delle battute rimaste più corte, fino al cambio di metro seguente. */
export function completeMeasures(score: ScoreDocument, from: number): void {
    const measures = score.measures();
    const touched: number[] = [];
    for (let index = from; index < measures.length; index++) {
        if (index > from && children(measures[index], 'attributes').some((attributes) => child(attributes, 'time'))) break;
        for (const voice of new Set(score.events(measures[index]).map((event) => event.voice))) completeVoice(score, index, voice);
        touched.push(index);
    }
    finish(score, touched);
}

// Durata della battuta

/** Durata della battuta in divisioni: quella del metro, oppure il contenuto della prima voce per una battuta in levare. */
export function measureLength(score: ScoreDocument, index: number): number {
    const measure = score.measure(index);
    const state = score.stateAt(index);
    if (measure.getAttribute('implicit') === 'yes') {
        const end = voiceEvents(score, measure, '1').reduce((longest, event) => Math.max(longest, event.start + event.duration), 0);
        if (end > 0) return end;
    }
    return score.expectedLength(state);
}

// Funzioni interne

/**
 * Scrive al cursore il contenuto dei modelli (una pausa, una nota o un accordo) con la figura indicata. Restituisce la
 * prima nota scritta e il cursore dopo di lei; `tieFrom` lega la prima nota alle note indicate.
 */
function write(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure, templates: Element[], tieFrom?: Element[]): WriteResult {
    const voice = String(cursor.voice);
    let measureIndex = cursor.measureIndex;
    const measure = score.measure(measureIndex);
    const startDivisions = score.stateAt(measureIndex).divisions;
    const at = toNumber(cursor.offset) * startDivisions;
    const group = groupAt(score, measure, voice, at);
    // Una figura che copre tutto il gruppo dal suo inizio lo sostituisce, invece di entrarci.
    const coversGroup = group !== null && Math.abs(group.start - at) < 1e-6 && toNumber(noteQuarters(figure.type, figure.dots)) * startDivisions >= group.end - group.start - 1e-6;
    if (group && !coversGroup) return writeInTuplet(score, cursor, figure, templates, group, tieFrom);

    // Durate in semiminime: le divisioni possono crescere passando a una battuta con un altro metro.
    let remaining = noteQuarters(figure.type, figure.dots);
    let offset = cursor.offset;
    let previous = tieFrom ?? null;
    let first: Element | null = null;
    const touched: number[] = [];
    let position = 0;
    let divisions = 1;
    for (;;) {
        divisions = prepare(score, { measureIndex, voice: cursor.voice, offset }, [remaining]);
        position = toNumber(offset) * divisions;
        const value = toNumber(remaining) * divisions;
        const span = Math.min(value, measureLength(score, measureIndex) - position);
        const preferred = first === null && Math.abs(span - value) < 1e-6 ? { ...figure, value } : undefined;
        const pieces = replaceSpan(score, measureIndex, voice, position, span, templates, { preferred, tieFrom: previous, continued: previous !== null });
        first ??= pieces[0][0];
        previous = pieces[pieces.length - 1];
        touched.push(measureIndex);
        position += span;
        remaining = minus(remaining, fraction(Math.round(span), divisions));
        if (toNumber(remaining) <= 1e-9) break;
        // La nota continua nella battuta seguente, aggiunta se la parte finisce qui.
        if (measureIndex + 1 >= score.measures().length) insertMeasure(score, measureIndex, 'after');
        measureIndex++;
        offset = fraction(0);
    }
    finish(score, touched);
    const length = measureLength(score, measureIndex);
    const end = position >= length - 1e-6 && measureIndex + 1 < score.measures().length ? { measureIndex: measureIndex + 1, offset: fraction(0) } : { measureIndex, offset: fraction(Math.round(position), divisions) };
    return { noteId: first!.getAttribute('id')!, cursor: { ...end, voice: cursor.voice } };
}

/** Scrittura dentro un gruppo irregolare: la nota prende il rapporto del gruppo e non può uscirne. */
function writeInTuplet(score: ScoreDocument, cursor: WritingCursor, figure: WritingFigure, templates: Element[], group: TupletGroup, tieFrom?: Element[]): WriteResult {
    const voice = String(cursor.voice);
    const quarters = noteQuarters(figure.type, figure.dots, group.ratio.actual, group.ratio.normal);
    const divisions = prepare(score, cursor, [quarters]);
    const measure = score.measure(cursor.measureIndex);
    const current = groupAt(score, measure, voice, toNumber(cursor.offset) * divisions)!;
    const position = toNumber(cursor.offset) * divisions;
    const value = toNumber(quarters) * divisions;
    if (position + value > current.end + 1e-6) throw new EditError('La nota è più lunga dello spazio rimasto nel gruppo irregolare');
    if (!current.events.some((event) => Math.abs(event.start - position) < 1e-6)) throw new EditError("Porta il cursore all'inizio di un elemento del gruppo irregolare");
    const pieces = replaceSpan(score, cursor.measureIndex, voice, position, value, templates, { preferred: { ...figure, value }, tuplet: current.ratio, tieFrom: tieFrom ?? null, continued: !!tieFrom });
    markTuplet(score, measure, voice, current.start, current.end);
    finish(score, [cursor.measureIndex]);
    const end = position + value;
    const length = measureLength(score, cursor.measureIndex);
    const next = end >= length - 1e-6 && cursor.measureIndex + 1 < score.measures().length ? { measureIndex: cursor.measureIndex + 1, offset: fraction(0) } : { measureIndex: cursor.measureIndex, offset: fraction(end, divisions) };
    return { noteId: pieces[0][0].getAttribute('id')!, cursor: { ...next, voice: cursor.voice } };
}

/**
 * Sostituisce l'intervallo `[position, position + span)` della voce con il contenuto dei modelli. Ciò che inizia prima
 * dell'intervallo si accorcia, ciò che finisce dopo lascia una pausa per la parte che resta. Restituisce i pezzi scritti,
 * ognuno con le note di un accordo, legati tra loro se sono note.
 */
function replaceSpan(
    score: ScoreDocument,
    measureIndex: number,
    voice: string,
    position: number,
    span: number,
    templates: Element[],
    options: { preferred?: Piece; tuplet?: TupletRatio; tieFrom?: Element[] | null; continued?: boolean }
): Element[][] {
    completeVoice(score, measureIndex, voice);
    const measure = score.measure(measureIndex);
    const end = position + span;
    const events = voiceEvents(score, measure, voice);
    const affected = events.filter((event) => event.start < end - 1e-6 && event.start + event.duration > position + 1e-6);
    if (!affected.length) throw new EditError('Nessuna nota da sostituire al cursore');
    if (!options.tuplet) {
        for (const group of tupletGroups(events)) {
            const touched = group.events.some((event) => affected.includes(event));
            if (touched && (group.start < position - 1e-6 || group.end > end + 1e-6)) {
                throw new EditError('La nota coprirebbe solo una parte di un gruppo irregolare: scegli una figura più breve o scrivi dentro il gruppo');
            }
        }
    }
    const head = affected.find((event) => event.start < position - 1e-6) ?? null;
    const tail = affected.find((event) => event.start + event.duration > end + 1e-6) ?? null;
    const headTuplet = head ? tupletOf(head.notes[0]) : null;
    const tailTuplet = tail ? tupletOf(tail.notes[0]) : null;
    if ((head && headTuplet && !options.tuplet) || (tail && tailTuplet && !options.tuplet)) throw new EditError('La nota coprirebbe solo una parte di un gruppo irregolare');

    const owner = score.document;
    const marker = owner.createComment('scrittura');
    affected[0].notes[0].before(marker);
    // La parte che resta della nota iniziale conserva la legatura con la nota che la precede.
    const tieStop = head ? head.notes.map(hasTieStop) : [];
    for (const event of affected) {
        for (const note of event.notes) {
            if (event === head) removeTie(note, 'start');
            else clearTies(score, note);
        }
    }
    const restTemplates = [restTemplate(score, Number(voice))];
    const ratio = options.tuplet ?? null;
    const divisions = score.stateAt(measureIndex).divisions;

    if (head) {
        const headKind = isRest(head.notes[0]) ? 'rest' : 'note';
        const headPieces = createPieces(score, head.notes, decompose(position - head.start, head.start, headKind, divisions, score, measureIndex, headTuplet), marker, headTuplet, headKind === 'note', tieStop.some(Boolean));
        headPieces[0].forEach((note, index) => {
            if (tieStop[index]) addTie(note, 'stop');
        });
    }
    const kind = isRest(templates[0]) ? 'rest' : 'note';
    const values = options.preferred && Math.abs(options.preferred.value - span) < 1e-6 ? [options.preferred] : decompose(span, position, kind, divisions, score, measureIndex, ratio);
    const written = createPieces(score, templates, values, marker, ratio, kind === 'note', !!options.continued && kind === 'note');
    if (options.tieFrom && kind === 'note') tieAcross(options.tieFrom, written[0]);
    if (tail) {
        const tailEnd = tail.start + tail.duration;
        createPieces(score, restTemplates, decompose(tailEnd - end, end, 'rest', divisions, score, measureIndex, tailTuplet), marker, tailTuplet, false, false);
    }
    for (const event of affected) {
        for (const grace of graceNotesBefore(event.notes[0])) grace.remove();
        for (const note of event.notes) note.remove();
    }
    marker.remove();
    return written;
}

/**
 * Crea i pezzi prima del segnaposto: copie dei modelli con la figura di ogni durata, legati tra loro se `tie`. Con
 * `continued` anche il primo pezzo continua una nota legata e non ripete accidenti e segni.
 */
function createPieces(score: ScoreDocument, templates: Element[], values: Piece[], marker: Node, ratio: TupletRatio | null, tie: boolean, continued: boolean): Element[][] {
    const pieces: Element[][] = [];
    values.forEach((value, index) => {
        const notes = templates.map((template, member) => {
            const copy = strippedCopy(score, template, continued || index > 0);
            removeChildren(copy, 'chord');
            if (member > 0) insertOrdered(copy, element(copy.ownerDocument, 'chord'), NOTE_ORDER);
            marker.parentNode!.insertBefore(copy, marker);
            return copy;
        });
        writeFigure(score, notes, value.type, value.dots, ratio);
        if (tie && pieces.length) tieAcross(pieces[pieces.length - 1], notes);
        pieces.push(notes);
    });
    return pieces;
}

/**
 * Copia di una nota da scrivere: senza legature di valore, travature e figura; oltre il primo pezzo anche senza segni,
 * legature di portamento e accidenti.
 */
function strippedCopy(score: ScoreDocument, template: Element, continuation: boolean): Element {
    const copy = template.cloneNode(true) as Element;
    for (const name of ['tie', 'beam', 'stem', 'dot', 'type', 'duration', 'time-modification', 'lyric']) removeChildren(copy, name);
    child(copy, 'rest')?.removeAttribute('measure');
    const notations = child(copy, 'notations');
    if (notations) {
        for (const item of children(notations)) if (continuation || ['tied', 'tuplet'].includes(item.tagName)) item.remove();
        removeIfEmpty(notations);
    }
    if (continuation) removeChildren(copy, 'accidental');
    copy.setAttribute('id', score.newId('n'));
    return copy;
}

/** Lega le note di un accordo alle note corrispondenti dell'accordo seguente, per altezza. */
function tieAcross(from: Element[], to: Element[]): void {
    for (const target of to) {
        const pitch = pitchOf(target);
        const source = from.find((candidate) => {
            const other = pitchOf(candidate);
            return !!other && !!pitch && other.step === pitch.step && other.octave === pitch.octave;
        });
        if (!source) continue;
        addTie(source, 'start');
        addTie(target, 'stop');
    }
}

/**
 * Divide una durata in figure, dalla più lunga. Le pause seguono i movimenti: ogni pausa inizia su un multiplo della sua
 * figura, una pausa più breve del movimento non lo attraversa, e le pause puntate si usano solo nei tempi composti.
 */
function decompose(value: number, position: number, kind: 'note' | 'rest', divisions: number, score: ScoreDocument, measureIndex: number, ratio: TupletRatio | null): Piece[] {
    const state = score.stateAt(measureIndex);
    const compound = state.beatType === 8 && state.beats % 3 === 0;
    const beat = ((4 * divisions) / state.beatType) * (compound && state.beats > 3 ? 3 : 1);
    const scale = ratio ? ratio.normal / ratio.actual : 1;
    const pieces: Piece[] = [];
    let remaining = value;
    let at = position;
    while (remaining > 1e-6) {
        let chosen: Piece | null = null;
        for (const option of NOTE_TYPES) {
            for (const dots of [1, 0]) {
                if (kind === 'rest' && dots && !compound) continue;
                const size = toNumber(noteQuarters(option.type, dots)) * divisions * scale;
                if (Math.abs(size - Math.round(size)) > 1e-6 || size > remaining + 1e-6) continue;
                const unit = toNumber(noteQuarters(option.type, kind === 'rest' ? dots : 0)) * divisions * scale;
                if (kind === 'rest' && !ratio && Math.abs(at / unit - Math.round(at / unit)) > 1e-6) continue;
                if (kind === 'rest' && !ratio && size < beat - 1e-6 && Math.floor((at + 1e-6) / beat) !== Math.floor((at + size - 1e-6) / beat)) continue;
                chosen = { type: option.type, dots, value: Math.round(size) };
                break;
            }
            if (chosen) break;
        }
        if (!chosen) throw new EditError('Durata non rappresentabile con le figure disponibili');
        pieces.push(chosen);
        remaining -= chosen.value;
        at += chosen.value;
    }
    return pieces;
}

/**
 * Prepara la battuta del cursore: divisioni sufficienti per le durate indicate, per la posizione del cursore e per la
 * battuta. Restituisce le divisioni in vigore nella battuta.
 */
function prepare(score: ScoreDocument, cursor: WritingCursor, durations: Fraction[]): number {
    const state = score.stateAt(cursor.measureIndex);
    let divisions = score.ensureDivisions(fraction(state.beats * 4, state.beatType), state.divisions);
    divisions = score.ensureDivisions(cursor.offset, divisions);
    for (const duration of durations) divisions = score.ensureDivisions(duration, divisions);
    return divisions;
}

/** Il cursore alla fine di una battuta passa all'inizio della seguente, aggiunta se la parte finisce lì. */
function enterMeasure(score: ScoreDocument, cursor: WritingCursor): WritingCursor {
    if (!score.measures()[cursor.measureIndex]) throw new EditError('Battuta non trovata');
    if (!Number.isInteger(cursor.voice) || cursor.voice < 1 || cursor.voice > VOICES.length) throw new EditError('Voce non prevista');
    const divisions = score.stateAt(cursor.measureIndex).divisions;
    if (toNumber(cursor.offset) * divisions < measureLength(score, cursor.measureIndex) - 1e-6) return cursor;
    if (cursor.measureIndex + 1 >= score.measures().length) insertMeasure(score, cursor.measureIndex, 'after');
    return { measureIndex: cursor.measureIndex + 1, voice: cursor.voice, offset: fraction(0) };
}

/**
 * Rende completa una voce della battuta: le pause invisibili (`forward`) diventano pause, la parte mancante alla fine si
 * riempie di pause e una voce assente nasce come pausa di battuta.
 */
function completeVoice(score: ScoreDocument, measureIndex: number, voice: string): void {
    const measure = score.measure(measureIndex);
    const state = score.stateAt(measureIndex);
    const divisions = score.ensureDivisions(fraction(state.beats * 4, state.beatType), state.divisions);
    const length = measureLength(score, measureIndex);
    let position = 0;
    let currentVoice: string | null = null;
    for (const item of children(measure)) {
        if (item.tagName === 'note') {
            currentVoice = voiceOf(item);
            if (!child(item, 'chord') && !child(item, 'grace') && !child(item, 'cue')) position += integer(child(item, 'duration')) ?? 0;
        } else if (item.tagName === 'backup') {
            position -= integer(child(item, 'duration')) ?? 0;
            currentVoice = null;
        } else if (item.tagName === 'forward') {
            const duration = integer(child(item, 'duration')) ?? 0;
            const owner = child(item, 'voice')?.textContent?.trim() ?? currentVoice;
            if (owner === voice && duration > 0) {
                const marker = score.document.createComment('pausa');
                item.before(marker);
                createPieces(score, [restTemplate(score, Number(voice))], decompose(duration, position, 'rest', divisions, score, measureIndex, null), marker, null, false, false);
                marker.remove();
                item.remove();
            }
            position += duration;
        }
    }
    const events = voiceEvents(score, measure, voice);
    if (!events.length) {
        if (children(measure, 'note').length) {
            const backup = element(score.document, 'backup');
            backup.appendChild(element(score.document, 'duration', 0));
            insertAtEnd(measure, backup);
        }
        const rest = restTemplate(score, Number(voice));
        rest.setAttribute('id', score.newId('n'));
        insertAtEnd(measure, rest);
        if (Math.abs(length - score.expectedLength(state)) < 1e-6) {
            // Una voce nuova nasce come pausa di battuta, come in MuseScore.
            child(rest, 'rest')!.setAttribute('measure', 'yes');
            insertOrdered(rest, element(score.document, 'duration', Math.round(length)), NOTE_ORDER);
        } else {
            createPieces(score, [restTemplate(score, Number(voice))], decompose(length, 0, 'rest', divisions, score, measureIndex, null), rest, null, false, false);
            rest.remove();
        }
        refreshMeasure(score, measure);
        return;
    }
    const last = events[events.length - 1];
    const end = last.start + last.duration;
    if (end < length - 1e-6) {
        const marker = score.document.createComment('fine');
        last.notes[last.notes.length - 1].after(marker);
        createPieces(score, [restTemplate(score, Number(voice))], decompose(length - end, end, 'rest', divisions, score, measureIndex, null), marker, null, false, false);
        marker.remove();
    }
}

/** Note e accordi di una voce della battuta, senza abbellimenti, in ordine di tempo. */
export function voiceEvents(score: ScoreDocument, measure: Element, voice: string): NoteEvent[] {
    return score
        .events(measure)
        .filter((event) => event.voice === voice && event.duration > 0)
        .sort((left, right) => left.start - right.start);
}

/** Gruppi irregolari di una voce: elementi consecutivi con lo stesso rapporto, delimitati dalle parentesi. */
export function tupletGroups(events: NoteEvent[]): TupletGroup[] {
    const groups: TupletGroup[] = [];
    let current: TupletGroup | null = null;
    for (const event of events) {
        const ratio = tupletOf(event.notes[0]);
        const starts = hasTupletMark(event.notes[0], 'start');
        if (!ratio) {
            current = null;
            continue;
        }
        const contiguous = current && Math.abs(current.end - event.start) < 1e-6 && current.ratio.actual === ratio.actual && current.ratio.normal === ratio.normal;
        if (!current || starts || !contiguous) {
            current = { start: event.start, end: event.start, ratio, events: [] };
            groups.push(current);
        }
        current.events.push(event);
        current.end = event.start + event.duration;
        if (hasTupletMark(event.notes[0], 'stop')) current = null;
    }
    return groups;
}

function groupAt(score: ScoreDocument, measure: Element, voice: string, position: number): TupletGroup | null {
    return tupletGroups(voiceEvents(score, measure, voice)).find((group) => position >= group.start - 1e-6 && position < group.end - 1e-6) ?? null;
}

/** Parentesi del gruppo irregolare sul primo e sull'ultimo elemento, dopo una scrittura al suo interno. */
function markTuplet(score: ScoreDocument, measure: Element, voice: string, start: number, end: number): void {
    const members = voiceEvents(score, measure, voice).filter((event) => event.start >= start - 1e-6 && event.start < end - 1e-6);
    for (const event of members) {
        for (const note of event.notes) {
            removeChildren(child(note, 'notations') ?? note, 'tuplet');
            removeIfEmpty(child(note, 'notations'));
        }
    }
    if (!members.length) return;
    addTuplet(members[0].notes[0], 'start');
    addTuplet(members[members.length - 1].notes[0], 'stop');
}

function hasTupletMark(note: Element, type: 'start' | 'stop'): boolean {
    return children(child(note, 'notations'), 'tuplet').some((tuplet) => tuplet.getAttribute('type') === type);
}

function hasTieStop(note: Element): boolean {
    return children(note, 'tie').some((tie) => tie.getAttribute('type') === 'stop');
}

/** Gli abbellimenti che precedono la nota nella sua voce, che spariscono con lei. */
export function graceNotesBefore(note: Element): Element[] {
    const graces: Element[] = [];
    let current = note.previousElementSibling;
    while (current && current.tagName === 'note' && child(current, 'grace') && voiceOf(current) === voiceOf(note)) {
        graces.push(current);
        current = current.previousElementSibling;
    }
    return graces;
}

/** L'accordo seguito dagli accordi legati a lui, anche nelle battute seguenti. */
function tiedEvents(score: ScoreDocument, event: NoteEvent): NoteEvent[] {
    const chain = [event];
    let current = event;
    for (;;) {
        const tied = current.notes.find((note) => children(note, 'tie').some((tie) => tie.getAttribute('type') === 'start'));
        if (!tied) break;
        const measure = score.measureOf(tied);
        const measureIndex = score.measureIndex(measure);
        const end = current.start + current.duration;
        const sameMeasure = voiceEvents(score, measure, current.voice).find((candidate) => Math.abs(candidate.start - end) < 1e-6);
        const next = sameMeasure ?? (score.measures()[measureIndex + 1] ? voiceEvents(score, score.measures()[measureIndex + 1], current.voice)[0] : undefined);
        if (!next || chain.includes(next) || !next.notes.some(hasTieStop)) break;
        chain.push(next);
        current = next;
    }
    return chain;
}

/** Accordo o pausa che termina al cursore nella sua voce, anche alla fine della battuta precedente. */
export function eventBefore(score: ScoreDocument, cursor: WritingCursor): NoteEvent | null {
    const measures = score.measures();
    const divisions = score.stateAt(cursor.measureIndex).divisions;
    const position = toNumber(cursor.offset) * divisions;
    const voice = String(cursor.voice);
    const events = voiceEvents(score, measures[cursor.measureIndex], voice);
    const inMeasure = [...events].reverse().find((event) => event.start + event.duration <= position + 1e-6);
    if (inMeasure) return inMeasure;
    if (position > 1e-6 || cursor.measureIndex === 0) return null;
    const previous = voiceEvents(score, measures[cursor.measureIndex - 1], voice);
    return previous[previous.length - 1] ?? null;
}

/** Altezza dell'ultima nota prima del cursore nella sua voce, per scegliere l'ottava della nota da scrivere. */
function pitchBefore(score: ScoreDocument, cursor: WritingCursor): { step: Step; octave: number } | null {
    const measures = score.measures();
    const voice = String(cursor.voice);
    const position = toNumber(cursor.offset) * score.stateAt(cursor.measureIndex).divisions;
    for (let index = cursor.measureIndex; index >= 0; index--) {
        const events = voiceEvents(score, measures[index], voice).filter((event) => index < cursor.measureIndex || event.start + event.duration <= position + 1e-6);
        for (const event of [...events].reverse()) {
            const pitch = pitchOf(event.notes[0]);
            if (pitch) return { step: pitch.step, octave: pitch.octave };
        }
    }
    return null;
}

function noteTemplate(score: ScoreDocument, voice: number, step: Step, octave: number, unpitched: boolean): Element {
    const owner = score.document;
    const note = element(owner, 'note');
    const pitch = note.appendChild(element(owner, unpitched ? 'unpitched' : 'pitch'));
    pitch.appendChild(element(owner, unpitched ? 'display-step' : 'step', step));
    pitch.appendChild(element(owner, unpitched ? 'display-octave' : 'octave', octave));
    note.appendChild(element(owner, 'voice', voice));
    return note;
}

function restTemplate(score: ScoreDocument, voice: number): Element {
    const owner = score.document;
    const note = element(owner, 'note');
    note.appendChild(element(owner, 'rest'));
    note.appendChild(element(owner, 'voice', voice));
    return note;
}

/**
 * Dinamiche, forcelle e testi di espressione scritti prima di una nota: le appartengono e si copiano, si tolgono e si
 * incollano con lei. Un testo con un suono, come «D.C.» o «Fine», è un segno di struttura e resta nella battuta.
 */
export const NOTE_DIRECTIONS: readonly string[] = ['dynamics', 'wedge', 'words'];

/** Le direzioni subito prima della nota e dei suoi abbellimenti fatte solo di dinamiche, forcelle e testi, in ordine. */
export function noteDirections(note: Element): Element[] {
    const result: Element[] = [];
    let current = note.previousElementSibling;
    while (current && current.tagName === 'note' && child(current, 'grace')) current = current.previousElementSibling;
    while (current && current.tagName === 'direction') {
        const items = children(current, 'direction-type').flatMap((type) => children(type));
        const owned = items.length > 0 && items.every((item) => NOTE_DIRECTIONS.includes(item.tagName));
        if (owned && !(child(current, 'sound') && items.some((item) => item.tagName === 'words'))) result.unshift(current);
        current = current.previousElementSibling;
    }
    return result;
}

function removeNoteDirections(note: Element): void {
    for (const direction of noteDirections(note)) direction.remove();
}

/** Una voce fatta solo di pause: oltre la prima si toglie, la prima diventa una pausa di battuta se la battuta è intera. */
function tidyVoice(score: ScoreDocument, measureIndex: number, voice: string): void {
    const measure = score.measure(measureIndex);
    const events = voiceEvents(score, measure, voice);
    if (!events.length || events.some((event) => !isRest(event.notes[0]))) return;
    if (voice !== '1') {
        removeVoice(measure, voice, events);
        return;
    }
    const length = measureLength(score, measureIndex);
    if (Math.abs(length - score.expectedLength(score.stateAt(measureIndex))) > 1e-6) return;
    if (events.length === 1 && child(events[0].notes[0], 'rest')?.getAttribute('measure') === 'yes') return;
    const rest = restTemplate(score, 1);
    rest.setAttribute('id', score.newId('n'));
    child(rest, 'rest')!.setAttribute('measure', 'yes');
    insertOrdered(rest, element(score.document, 'duration', Math.round(length)), NOTE_ORDER);
    events[0].notes[0].before(rest);
    for (const event of events) {
        for (const grace of graceNotesBefore(event.notes[0])) grace.remove();
        for (const note of event.notes) note.remove();
    }
}

/** Toglie dalla battuta le note di una voce, con i suoi abbellimenti, i suoi avanzamenti e i ritorni rimasti senza note. */
function removeVoice(measure: Element, voice: string, events: NoteEvent[]): void {
    for (const event of events) for (const item of event.notes) item.remove();
    for (const item of children(measure, 'note')) if (child(item, 'grace') && voiceOf(item) === voice) item.remove();
    for (const item of children(measure, 'forward')) if (child(item, 'voice')?.textContent?.trim() === voice) item.remove();
    tidyBackups(measure);
}

/** Toglie i ritorni (`backup`) che non precedono più alcuna nota, dopo aver tolto una voce. */
function tidyBackups(measure: Element): void {
    const items = children(measure);
    for (const [index, item] of items.entries()) {
        if (item.tagName !== 'backup') continue;
        if (!items.slice(index + 1).some((next) => next.tagName === 'note' && next.parentElement === measure)) item.remove();
    }
}

/** Alterazioni, ritorni tra le voci e travature delle battute scritte; le note legate suonano come quella da cui partono. */
export function finish(score: ScoreDocument, measureIndexes: number[]): void {
    const unique = Array.from(new Set(measureIndexes)).filter((index) => index >= 0 && index < score.measures().length);
    respell(score, unique);
    for (const index of unique) {
        for (const note of children(score.measure(index), 'note')) {
            if (!hasTieStop(note) || isRest(note)) continue;
            const chain = tieChain(score, note);
            const alter = pitchOf(chain[0])?.alter ?? 0;
            for (const linked of chain.slice(1)) setAlter(linked, alter);
        }
        refreshMeasure(score, score.measure(index));
    }
    score.assignIds();
}

function voiceNumber(voice: string): number {
    const value = Number.parseInt(voice, 10);
    return Number.isInteger(value) && value >= 1 && value <= VOICES.length ? value : 1;
}

/** Nome leggibile della figura corrente, per la barra di stato. */
export function figureLabel(figure: WritingFigure): string {
    const label = NOTE_TYPES.find((option) => option.type === figure.type)?.label.toLowerCase() ?? '';
    return `${label}${figure.dots === 1 ? ' puntata' : figure.dots === 2 ? ' doppiamente puntata' : ''}`;
}
