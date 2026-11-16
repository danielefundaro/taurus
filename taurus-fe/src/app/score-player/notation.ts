import { ScoreMeasure } from './musicxml-score';

/**
 * Elemento disegnato per ogni battuta della parte, nell'ordine delle battute. Verovio raggruppa le pause di più battute
 * in un solo elemento: le battute senza un elemento proprio usano quello precedente. Gli elementi si abbinano in ordine
 * per numero di battuta (`data-n`); se i numeri non corrispondono ma restano tanti elementi quante battute, si abbinano
 * per posizione.
 */
export function measureElements(measures: readonly Pick<ScoreMeasure, 'number'>[], elements: readonly Element[]): (Element | undefined)[] {
    const result: (Element | undefined)[] = [];
    let next = 0;
    let current: Element | undefined;
    measures.forEach((measure, index) => {
        const element = elements[next];
        if (element && (element.getAttribute('data-n') === measure.number || elements.length - next === measures.length - index)) {
            current = element;
            next++;
        }
        result.push(current);
    });
    return result;
}
