import { ChildrenEntities } from '../module';

/**
 * Le parti di una traccia nell'ordine dell'organico: ogni parte segue il primo dei suoi strumenti nell'organico, e le
 * parti senza strumenti dell'organico vengono dopo, nell'ordine attuale. Senza organico l'ordine non cambia.
 *
 * @param ensemble gli id degli strumenti dell'organico, nel loro ordine
 */
export function byEnsemble<T extends { instruments?: ChildrenEntities[] }>(parts: T[], ensemble: readonly number[]): T[] {
    if (!ensemble.length) return [...parts];
    const ranks = ensembleRanks(ensemble);
    const rank = (part: T): number => Math.min(Infinity, ...(part.instruments ?? []).map((instrument) => ranks.get(instrument.index) ?? Infinity));

    return parts
        .map((part, index) => ({ part, index, rank: rank(part) }))
        .sort((first, second) => compareRanks(first.rank, second.rank) || first.index - second.index)
        .map(({ part }) => part);
}

/**
 * Le chiavi dei filtri degli strumenti (l'id, o `null` per le parti senza strumento) nell'ordine dell'organico; le altre
 * seguono nell'ordine attuale.
 */
export function keysByEnsemble(keys: readonly string[], ensemble: readonly number[]): string[] {
    if (!ensemble.length) return [...keys];
    const ranks = ensembleRanks(ensemble);
    const rank = (key: string): number => ranks.get(Number(key)) ?? Infinity;

    return keys
        .map((key, index) => ({ key, index, rank: rank(key) }))
        .sort((first, second) => compareRanks(first.rank, second.rank) || first.index - second.index)
        .map(({ key }) => key);
}

function ensembleRanks(ensemble: readonly number[]): Map<number, number> {
    return new Map(ensemble.map((id, index) => [id, index]));
}

/** `Infinity - Infinity` non è un numero: due parti fuori dall'organico sono alla pari. */
function compareRanks(first: number, second: number): number {
    return first === second ? 0 : first - second;
}
