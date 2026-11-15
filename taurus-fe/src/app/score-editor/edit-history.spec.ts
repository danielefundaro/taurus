import { MeasureHistory, SnapshotHistory } from './edit-history';
import { ScoreDocument } from './score-document';

const half = (step: string): string => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>`;
const part = (id: string, first: string, second: string): string =>
    `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${half(first)}</measure><measure number="2">${half(second)}</measure></part>`;

/** Partitura di due righi, due battute ciascuno. */
const XML = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flauto</part-name></score-part><score-part id="P2"><part-name>Oboe</part-name></score-part></part-list>${part('P1', 'C', 'D')}${part('P2', 'E', 'F')}</score-partwise>`;

const steps = (score: ScoreDocument): string[][] => score.parts().map((item) => Array.from(item.querySelectorAll('step')).map((step) => step.textContent ?? ''));

/** Cambia l'altezza della prima nota della battuta nel rigo indicato. */
function setStep(score: ScoreDocument, row: number, measure: number, step: string): void {
    score.parts()[row].querySelectorAll('measure')[measure].querySelector('step')!.textContent = step;
}

/** Aggiunge in fondo a ogni rigo una battuta vuota. */
function appendMeasure(score: ScoreDocument): void {
    score.everyPart(() => {
        const measure = score.document.createElementNS(null, 'measure');
        measure.setAttribute('id', score.newId('m'));
        measure.setAttribute('number', String(score.measures().length + 1));
        score.parts()[score.partIndex].append(measure);
    });
}

describe('edit history', () => {
    describe('SnapshotHistory', () => {
        it('undoes and redoes the whole document, keeping the active row', () => {
            const history = new SnapshotHistory();
            const score = ScoreDocument.open(XML);
            score.selectPart(1);
            expect(history.canUndo).toBeFalse();

            const before = score.snapshot();
            setStep(score, 1, 0, 'G');
            history.record(score, before, false);
            // Una modifica unita alla precedente non aggiunge un passo.
            const merged = score.snapshot();
            setStep(score, 1, 0, 'A');
            history.record(score, merged, true);
            expect(history.canUndo).toBeTrue();

            const undone = history.undo(score)!;
            expect(undone).not.toBe(score);
            expect(undone.partIndex).toBe(1);
            expect(steps(undone)).toEqual([
                ['C', 'D'],
                ['E', 'F']
            ]);
            expect(history.undo(undone)).toBeNull();
            expect(history.canRedo).toBeTrue();

            const redone = history.redo(undone)!;
            expect(steps(redone)[1]).toEqual(['A', 'F']);
            expect(history.redo(redone)).toBeNull();
        });
    });

    describe('MeasureHistory', () => {
        it('records the changed measures of every row and restores them in the same document', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);

            const before = score.snapshot();
            setStep(score, 0, 1, 'G');
            setStep(score, 1, 0, 'A');
            history.record(score, before, false);

            expect(history.undo(score)).toBe(score);
            expect(steps(score)).toEqual([
                ['C', 'D'],
                ['E', 'F']
            ]);
            expect(history.canUndo).toBeFalse();
            expect(history.undo(score)).toBeNull();

            expect(history.redo(score)).toBe(score);
            expect(steps(score)).toEqual([
                ['C', 'G'],
                ['A', 'F']
            ]);
            expect(history.redo(score)).toBeNull();
        });

        it('merges quick changes into one step, from the first state to the last', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);

            let before = score.snapshot();
            setStep(score, 0, 0, 'G');
            history.record(score, before, false);
            before = score.snapshot();
            setStep(score, 0, 0, 'A');
            setStep(score, 1, 1, 'B');
            history.record(score, before, true);

            history.undo(score);
            expect(steps(score)).toEqual([
                ['C', 'D'],
                ['E', 'F']
            ]);
            expect(history.canUndo).toBeFalse();
            history.redo(score);
            expect(steps(score)).toEqual([
                ['A', 'D'],
                ['E', 'B']
            ]);
        });

        it('undoes measures added to every row', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);

            const before = score.snapshot();
            appendMeasure(score);
            history.record(score, before, false);
            expect(score.everyPart(() => score.measures().length)).toEqual([3, 3]);

            history.undo(score);
            expect(score.everyPart(() => score.measures().length)).toEqual([2, 2]);
            history.redo(score);
            expect(score.everyPart(() => score.measures().length)).toEqual([3, 3]);
        });

        it('records the whole document when the rows or the header change', () => {
            const score = ScoreDocument.open(XML);
            score.selectPart(1);
            const history = new MeasureHistory(score);

            const before = score.snapshot();
            score.document.querySelector('score-part[id="P2"] > part-name')!.textContent = 'Clarinetto';
            score.parts()[0].remove();
            score.document.querySelector('score-part[id="P1"]')!.remove();
            score.selectPart(0);
            history.record(score, before, false);

            const undone = history.undo(score)!;
            expect(undone).not.toBe(score);
            expect(undone.parts().length).toBe(2);
            expect(undone.document.querySelector('score-part[id="P2"] > part-name')?.textContent).toBe('Oboe');
            // Una modifica del documento intero non si unisce alla precedente.
            const redone = history.redo(undone)!;
            expect(redone.parts().length).toBe(1);
            expect(redone.document.querySelector('part-name')?.textContent).toBe('Clarinetto');
        });

        it('records the whole document when two measures share an id', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);

            const before = score.snapshot();
            const first = score.measure(0);
            first.after(first.cloneNode(true));
            history.record(score, before, false);
            const merged = score.snapshot();
            setStep(score, 1, 0, 'A');
            history.record(score, merged, true);

            const undone = history.undo(score)!;
            expect(undone).not.toBe(score);
            expect(steps(undone)[1]).toEqual(['E', 'F']);
            expect(undone.parts()[0].querySelectorAll('measure').length).toBe(3);
            const original = history.undo(undone)!;
            expect(original.parts()[0].querySelectorAll('measure').length).toBe(2);
        });

        it('ignores a record without changes and keeps the last steps within the limit', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score, 2);

            history.record(score, score.snapshot(), false);
            expect(history.canUndo).toBeFalse();

            for (const step of ['G', 'A', 'B']) {
                const before = score.snapshot();
                setStep(score, 0, 0, step);
                history.record(score, before, false);
            }
            history.undo(score);
            history.undo(score);
            expect(history.canUndo).toBeFalse();
            expect(steps(score)[0]).toEqual(['G', 'D']);

            // Una modifica nuova toglie la possibilità di ripristinare.
            const before = score.snapshot();
            setStep(score, 1, 1, 'C');
            history.record(score, before, false);
            expect(history.canRedo).toBeFalse();
        });
    });
});
