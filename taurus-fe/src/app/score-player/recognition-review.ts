import { RecognitionEngine, RecognitionReviewCounts, ScoreVersion, ScoreVersionOrigin } from '../module';
import { compareMeasures, differenceCounts, readMeasures } from './score-compare';

/** Ciò che serve di una versione per risalire a quella del motore. */
export type ReviewedVersion = Pick<ScoreVersion, 'id' | 'origin' | 'parentVersionId'>;

const ENGINES: Partial<Record<ScoreVersionOrigin, RecognitionEngine>> = { OMR_AUDIVERIS: 'AUDIVERIS', OMR_HOMR: 'HOMR' };

/** Il motore che ha prodotto una versione con questa origine, se l'ha prodotta un motore di riconoscimento. */
export function recognitionEngine(origin: ScoreVersionOrigin): RecognitionEngine | null {
    return ENGINES[origin] ?? null;
}

/**
 * La prima versione di un motore risalendo da `version`, compresa, le versioni da cui deriva tra quelle date. Una
 * versione di un motore approvata così com'è si confronta con sé stessa: tutte le sue battute sono corrette.
 *
 * @returns la versione del motore, `null` se la catena finisce senza motore, `undefined` se manca una versione intermedia
 */
export function engineVersion<T extends ReviewedVersion>(versions: readonly T[], version: T): T | null | undefined {
    const byId = new Map<number, T>(versions.map((item) => [item.id, item]));
    const seen = new Set<number>();
    let current: T | undefined = version;
    while (current && !seen.has(current.id)) {
        if (recognitionEngine(current.origin)) return current;
        seen.add(current.id);
        if (current.parentVersionId == null) return null;
        current = byId.get(current.parentVersionId);
    }
    return current ? null : undefined;
}

/**
 * Conteggi del confronto per battute tra la versione del motore e quella approvata, che è il riferimento, come in
 * `python -m accuracy compare`: le altezze scritte, perché le due versioni sono della stessa parte.
 */
export function reviewCounts(engineXml: string, approvedXml: string): RecognitionReviewCounts {
    const comparison = compareMeasures(readMeasures(approvedXml), readMeasures(engineXml));
    const kinds = differenceCounts(comparison);
    return {
        referenceMeasures: comparison.referenceMeasures,
        engineMeasures: comparison.candidateMeasures,
        correctMeasures: comparison.correctMeasures,
        pitchMeasures: kinds.pitch,
        rhythmMeasures: kinds.rhythm,
        tieMeasures: kinds.tie,
        missingMeasures: kinds.missing,
        extraMeasures: kinds.extra,
        referenceMarks: comparison.referenceMarks,
        foundMarks: comparison.foundMarks
    };
}

/** Quota da 0 a 100, arrotondata, oppure `null` senza un totale. */
export function share(part: number, total: number): number | null {
    return total > 0 ? Math.round((part / total) * 100) : null;
}
