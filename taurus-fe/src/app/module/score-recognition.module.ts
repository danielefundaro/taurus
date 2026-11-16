/** Qualità del riconoscimento: conteggi raccolti all'approvazione e loro riepilogo. */

export type RecognitionEngine = 'AUDIVERIS' | 'HOMR';

/**
 * Conteggi del confronto tra una versione di un motore e la versione approvata che ne discende: ogni battuta della
 * versione approvata è corretta, di un tipo o persa; le battute in più sono quelle aggiunte dal motore.
 */
export interface RecognitionReviewCounts {
    referenceMeasures: number;
    engineMeasures: number;
    correctMeasures: number;
    pitchMeasures: number;
    rhythmMeasures: number;
    tieMeasures: number;
    missingMeasures: number;
    extraMeasures: number;
    referenceMarks: number;
    foundMarks: number;
}

export interface RecognitionReviewRequest extends RecognitionReviewCounts {
    engineVersionId: number;
}

/** Somme delle raccolte di un motore, di un mese o di entrambi. */
export interface RecognitionCounts extends RecognitionReviewCounts {
    parts: number;
}

export interface EngineSummary {
    engine: RecognitionEngine;
    counts: RecognitionCounts;
}

/** Raccolte delle versioni riconosciute in un mese, `yyyy-MM` nel fuso del tenant. */
export interface MonthSummary {
    month: string;
    engine: RecognitionEngine;
    counts: RecognitionCounts;
}

/** Una parte corretta dagli archivisti, con le due versioni da confrontare. */
export interface ReviewedPart {
    trackId: number;
    trackName: string;
    scoreId: number;
    partName?: string | null;
    engine: RecognitionEngine;
    engineVersionId: number;
    engineVersionNumber: number;
    approvedVersionId: number;
    approvedVersionNumber: number;
    approvedAt: string;
    referenceMeasures: number;
    correctMeasures: number;
    correctedMeasures: number;
}

export interface RecognitionReport {
    from?: string | null;
    engines: EngineSummary[];
    months: MonthSummary[];
    parts: ReviewedPart[];
}

/** Un'approvazione che discende da una versione di un motore e non ha ancora la raccolta. */
export interface PendingReview {
    trackId: number;
    trackName: string;
    scoreId: number;
    partName?: string | null;
    engine: RecognitionEngine;
    engineVersionId: number;
    engineVersionNumber: number;
    approvedVersionId: number;
    approvedVersionNumber: number;
    approvedAt: string;
}

export interface PendingReviews {
    total: number;
    items: PendingReview[];
}
