/** Partitura di una traccia: dati scambiati con il backend. */

import { DraftSummary, EditLock, PlaybackInstrument, ScoreChecks, ScoreDraft, ScoreVersionStatus } from './score-playback.module';

/** Un rigo da salvare: la parte del MusicXML, i suoi strumenti e, alla creazione, la parte della traccia da cui viene. */
export interface ArrangementRowRequest {
    /** `id` della parte del rigo nel MusicXML. */
    id: string;
    /** Uno strumento, o più strumenti a percussione, nell'ordine delle voci. */
    instrumentIds: number[];
    /** Alla creazione, la parte della traccia da cui è fatto il rigo, che resta collegata a lui. */
    scoreId?: number | null;
}

/** Un rigo di una bozza o di una versione della partitura. */
export interface ArrangementRow {
    id: string;
    /** Nome della parte nel MusicXML. */
    name?: string | null;
    instruments: PlaybackInstrument[];
}

/**
 * Stato della parte di un rigo rispetto alla versione corrente della partitura:
 * - `NEW`: il rigo non ha una parte, l'estrazione ne crea una;
 * - `TO_EXTRACT`: la parte non è mai stata estratta da questa partitura, o la partitura ha una versione più recente;
 * - `UP_TO_DATE`: la versione corrente della parte è quella estratta dalla versione corrente della partitura;
 * - `MODIFIED`: la parte ha una versione più recente di quella estratta;
 * - `PART_DELETED`: la parte del rigo è stata eliminata dalla traccia.
 */
export type ArrangementRowStatus = 'NEW' | 'TO_EXTRACT' | 'UP_TO_DATE' | 'MODIFIED' | 'PART_DELETED';

export interface ArrangementRowState extends ArrangementRow {
    /** Parte della traccia collegata al rigo. */
    scoreId?: number | null;
    status: ArrangementRowStatus;
}

/** Controlli automatici di un rigo di una versione. */
export interface RowChecks {
    row: string;
    checks: ScoreChecks;
}

export interface ArrangementVersion {
    id: number;
    versionNumber: number;
    status: ScoreVersionStatus;
    /** Scritta in suoni reali; altrimenti trasposta. */
    concertPitch: boolean;
    measureCount: number;
    checks: RowChecks[];
    parentVersionId?: number | null;
    createdAt: string;
    approvedAt?: string | null;
    /** La versione mostrata e da cui si estraggono le parti. */
    current: boolean;
}

export interface Arrangement {
    id: number;
    trackId: number;
    /** Versione corrente; vuota prima del primo salvataggio. */
    currentVersion?: ArrangementVersion | null;
    /** Righi della versione corrente, o della bozza prima del primo salvataggio, con lo stato della loro parte. */
    rows: ArrangementRowState[];
    draft?: DraftSummary | null;
    /** Chi sta scrivendo la partitura. */
    editing?: EditLock | null;
}

/** Bozza della partitura, con il contenuto e i righi. */
export interface ArrangementDraft extends ScoreDraft {
    rows: ArrangementRow[];
}

/** Partitura nuova: il MusicXML con una parte per rigo, che diventa la prima bozza. */
export interface NewArrangement {
    content: string;
    rows: ArrangementRowRequest[];
}

/** Versione della partitura scritta nell'editor, che possiede il blocco. */
export interface ArrangementVersionRequest {
    editSession: string;
    content: string;
    rows: ArrangementRowRequest[];
    parentVersionId: number | null;
    approve: boolean;
    confirmOutdated: boolean;
}
