import { byEnsemble, keysByEnsemble } from './ensemble-order';

describe('ensemble order', () => {
    const part = (id: number, ...instruments: number[]) => ({ id, instruments: instruments.map((index) => ({ index })) });

    it('puts each part under the first of its instruments in the ensemble and the others after, in their order', () => {
        const parts = [part(1, 9), part(2, 30), part(3), part(4, 30, 20), part(5, 8)];

        expect(byEnsemble(parts, [20, 30]).map((value) => value.id)).toEqual([4, 2, 1, 3, 5]);
        const withoutInstruments: { id: number; instruments?: { index: number }[] }[] = [{ id: 6 }, part(7, 30)];
        expect(byEnsemble(withoutInstruments, [30]).map((value) => value.id)).toEqual([7, 6]);
    });

    it('keeps the order without an ensemble', () => {
        const parts = [part(1, 30), part(2, 20)];

        expect(byEnsemble(parts, [])).toEqual(parts);
        expect(byEnsemble(parts, [])).not.toBe(parts);
        expect(keysByEnsemble(['30', 'null', '20'], [])).toEqual(['30', 'null', '20']);
    });

    it('orders the keys of the instrument filters, leaving the others and the parts without instrument after', () => {
        expect(keysByEnsemble(['9', '30', 'null', '20', '8'], [20, 30])).toEqual(['20', '30', '9', 'null', '8']);
    });
});
