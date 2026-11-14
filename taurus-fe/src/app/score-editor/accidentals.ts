import { child, element, insertOrdered, NOTE_ORDER, PITCH_ORDER, setChildText, text } from './musicxml-dom';
import { accidentalAlter, accidentalFor, keyAlter } from './notation-rules';
import type { ScoreDocument } from './score-document';
import { isRest, pitchOf } from './score-document';

/**
 * Nell'editor l'accidente scritto (`accidental`) è ciò che si vede e l'alterazione (`alter`) è ciò che suona. Dopo ogni
 * modifica l'alterazione delle note di una battuta si ricava come in uno spartito: l'accidente della nota, altrimenti
 * quello di una nota precedente con lo stesso nome e ottava nella battuta, altrimenti l'armatura. Le note legate dalla
 * battuta precedente conservano la loro alterazione.
 */
export function respell(score: ScoreDocument, measureIndexes: Iterable<number>): void {
    const states = score.measureStates();
    const measures = score.measures();
    for (const index of new Set(measureIndexes)) {
        const measure = measures[index];
        if (!measure) continue;
        const carried = new Map<string, number>();
        for (const note of measureNotes(measure)) {
            const pitch = pitchOf(note);
            if (!pitch || pitch.unpitched) continue;
            const key = `${pitch.step}${pitch.octave}`;
            const written = accidentalAlter(text(child(note, 'accidental')));
            if (written !== null) {
                carried.set(key, written);
                setAlter(note, written);
            } else if (!isTieContinuation(note)) {
                setAlter(note, carried.get(key) ?? keyAlter(states[index].fifths, pitch.step));
            }
        }
    }
}

/**
 * All'apertura rende visibile ogni alterazione che armatura e accidenti non spiegano, scrivendo l'accidente
 * corrispondente: il suono della versione non cambia e le modifiche successive non alterano le note non toccate. Con le
 * battute indicate vale solo per loro, per esempio dopo aver incollato o trasposto un passaggio.
 */
export function makeAccidentalsExplicit(score: ScoreDocument, measureIndexes?: Iterable<number>): void {
    const states = score.measureStates();
    const only = measureIndexes ? new Set(measureIndexes) : null;
    score.measures().forEach((measure, index) => {
        if (only && !only.has(index)) return;
        const carried = new Map<string, number>();
        for (const note of measureNotes(measure)) {
            const pitch = pitchOf(note);
            if (!pitch || pitch.unpitched || isTieContinuation(note)) continue;
            const key = `${pitch.step}${pitch.octave}`;
            const accidental = child(note, 'accidental');
            const written = accidentalAlter(text(accidental));
            if (written !== null) {
                if (written !== pitch.alter && Number.isInteger(pitch.alter) && Math.abs(pitch.alter) <= 2) setAccidental(note, accidentalFor(pitch.alter));
                carried.set(key, pitch.alter);
                continue;
            }
            const expected = carried.get(key) ?? keyAlter(states[index].fifths, pitch.step);
            if (expected !== pitch.alter && Number.isInteger(pitch.alter) && Math.abs(pitch.alter) <= 2) {
                setAccidental(note, accidentalFor(pitch.alter));
                carried.set(key, pitch.alter);
            }
        }
    });
}

/** Alterazione di ogni nota intonata, prima di una modifica: le note non toccate la conservano. */
export function currentAlters(score: ScoreDocument): Map<Element, number> {
    const result = new Map<Element, number>();
    for (const note of score.notes()) {
        const pitch = pitchOf(note);
        if (pitch && !pitch.unpitched && !isRest(note)) result.set(note, pitch.alter);
    }
    return result;
}

/** Riporta le note all'altezza prevista e scrive gli accidenti che servono nelle battute indicate. */
export function keepAlters(score: ScoreDocument, intended: Map<Element, number>, measureIndexes: Iterable<number>): void {
    for (const [note, alter] of intended) if (score.part.contains(note)) setAlter(note, alter);
    makeAccidentalsExplicit(score, measureIndexes);
}

export function setAlter(note: Element, alter: number): void {
    const pitch = child(note, 'pitch');
    if (pitch) setChildText(pitch, 'alter', alter === 0 ? null : alter, PITCH_ORDER);
}

/** Scrive o toglie l'accidente della nota; `null` lo toglie. */
export function setAccidental(note: Element, accidental: string | null): void {
    child(note, 'accidental')?.remove();
    if (accidental !== null) insertOrdered(note, element(note.ownerDocument, 'accidental', accidental), NOTE_ORDER);
}

function measureNotes(measure: Element): Element[] {
    return Array.from(measure.children).filter((item) => item.tagName === 'note' && !child(item, 'rest'));
}

function isTieContinuation(note: Element): boolean {
    return Array.from(note.children).some((item) => item.tagName === 'tie' && item.getAttribute('type') === 'stop');
}
