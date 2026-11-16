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

        it('takes the snapshot before a change at once and does not know what changed', () => {
            const history = new SnapshotHistory();
            const score = ScoreDocument.open(XML);
            const snapshot = score.snapshot();

            const before = history.checkpoint(score);
            setStep(score, 0, 0, 'G');
            expect(before()).toBe(snapshot);
            history.record(score, before, false);

            expect(history.lastChange).toBeNull();
            expect(history.modified()).toBeNull();
            expect(steps(history.undo(score)!)[0]).toEqual(['C', 'D']);
            history.dispose();
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

        it('tells the rows and measures of the last change and whether the document differs from the opened one', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);
            expect(history.lastChange).toEqual({ rows: new Set(), measures: new Set() });
            expect(history.modified(score)).toBeFalse();

            const before = history.checkpoint(score);
            setStep(score, 1, 0, 'A');
            history.record(score, before, false);
            const id = score.parts()[1].querySelector('measure')!.getAttribute('id');
            expect(history.lastChange).toEqual({ rows: new Set([1]), measures: new Set([id]) });
            expect(history.modified(score)).toBeTrue();

            history.undo(score);
            expect(history.lastChange).toEqual({ rows: new Set([1]), measures: new Set([id]) });
            expect(history.modified(score)).toBeFalse();
            history.redo(score);
            expect(history.modified(score)).toBeTrue();

            // Una modifica non ancora registrata: il confronto non si sa.
            setStep(score, 0, 0, 'B');
            expect(history.modified(score)).toBeNull();
            history.dispose();
            expect(history.modified(score)).toBeNull();
        });

        it('rebuilds the document before a change only when it is needed', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);
            const snapshot = score.snapshot();

            const before = history.checkpoint(score);
            setStep(score, 0, 1, 'G');
            expect(before()).toBe(snapshot);
            expect(before()).toBe(before());

            // Con modifiche non ancora registrate lo stato registrato non vale: si prende l'istantanea.
            expect(history.checkpoint(score)()).toBe(score.snapshot());
            // Lo stesso per un altro documento.
            const other = ScoreDocument.open(XML);
            setStep(other, 1, 1, 'B');
            expect(history.checkpoint(other)()).toBe(other.snapshot());
        });

        it('asks for the document before a change only when the whole document changes', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);

            const measures = jasmine.createSpy('before').and.returnValue(score.snapshot());
            setStep(score, 0, 0, 'G');
            history.record(score, measures, false);
            expect(measures).not.toHaveBeenCalled();

            const whole = jasmine.createSpy('before').and.returnValue(score.snapshot());
            score.document.querySelector('part-name')!.textContent = 'Ottavino';
            history.record(score, whole, false);
            expect(whole).toHaveBeenCalledTimes(1);
            expect(history.lastChange).toBeNull();
            expect(history.undo(score)!.document.querySelector('part-name')?.textContent).toBe('Flauto');
        });

        it('serializes again only the touched measures, matching the whole document after every change', () => {
            const score = ScoreDocument.open(XML);
            const history = new MeasureHistory(score);
            const initial = score.snapshot();
            const measures = (row: number): Element[] => Array.from(score.parts()[row].querySelectorAll('measure'));
            const changes = [
                () => setStep(score, 0, 0, 'G'),
                () => appendMeasure(score),
                () => measures(1)[1].setAttribute('number', '9'),
                () => measures(0)[2].append(measures(0)[0].querySelector('note')!.cloneNode(true)),
                () => measures(1)[0].querySelector('note')!.remove(),
                () => score.parts()[0].prepend(measures(0)[2]),
                () => measures(1)[1].querySelector('step')!.firstChild!.replaceWith(score.document.createTextNode('A'))
            ];
            const snapshots = [initial];
            for (const change of changes) {
                const before = history.checkpoint(score);
                change();
                history.record(score, before, false);
                snapshots.push(score.snapshot());
                expect(history.checkpoint(score)()).toBe(score.snapshot());
            }

            for (let index = changes.length - 1; index >= 0; index--) {
                expect(history.undo(score)).toBe(score);
                expect(score.snapshot()).toBe(snapshots[index]);
                expect(history.checkpoint(score)()).toBe(snapshots[index]);
            }
            expect(history.modified(score)).toBeFalse();
            for (let index = 1; index <= changes.length; index++) {
                history.redo(score);
                expect(score.snapshot()).toBe(snapshots[index]);
            }
        });
    });
});
