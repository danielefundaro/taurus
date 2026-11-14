/** Ascolto e correzione delle parti: dati scambiati con il backend. */

export type ScoreVersionOrigin = 'OMR_AUDIVERIS' | 'OMR_HOMR' | 'UPLOAD_MUSICXML' | 'UPLOAD_MIDI' | 'CORRECTION' | 'WRITING';
export type ScoreVersionStatus = 'UNVERIFIED' | 'APPROVED';
export type PlaybackAvailability = 'AVAILABLE' | 'NOT_AVAILABLE';
export type RecognitionJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

/** Esito dei controlli automatici di una versione. */
export interface ScoreChecks {
    measureCount: number;
    wrongDurationCount: number;
    wrongDurationMeasures: string[];
    clefChanges: number;
    octaveClefs: number;
    percussionClef: boolean;
    keyChanges: number;
    timeChanges: number;
    unusualTimeSignatures: number;
    forwardRepeats: number;
    backwardRepeats: number;
    openRepeats: number;
    endings: number;
    segni: number;
    codas: number;
    daCapo: number;
    dalSegno: number;
    fine: number;
    tempo: boolean;
    emptyMeasures: number;
    notes: number;
    chordNotes: number;
}

export interface ScoreVersion {
    id: number;
    scoreId: number;
    versionNumber: number;
    origin: ScoreVersionOrigin;
    status: ScoreVersionStatus;
    measureCount: number;
    checks: ScoreChecks;
    sourceFileName?: string;
    sourcePartName?: string;
    parentVersionId?: number;
    createdAt: string;
    approvedAt?: string;
    current: boolean;
    pagesChanged: boolean;
}

export interface MusicXmlPart {
    id: string;
    name?: string;
    measureCount: number;
}

export interface PlaybackInstrument {
    id: number;
    name: string;
    transpositionSemitones?: number | null;
    bassClefTranspositionSemitones?: number | null;
    soundBank?: number | null;
    soundProgram?: number | null;
    percussionKey?: number | null;
    configured: boolean;
}

/** Suono e trasposizione risolti per una parte. */
export interface PlaybackSound {
    transpositionSemitones?: number | null;
    bassClefTranspositionSemitones?: number | null;
    soundBank?: number | null;
    soundProgram?: number | null;
    percussionKeys: number[];
    configured: boolean;
    conflicting: boolean;
}

export interface PartPlaybackSettings {
    transpositionOverride: number | null;
    soundBankOverride: number | null;
    soundProgramOverride: number | null;
}

export interface PlaybackVersion {
    id: number;
    versionNumber: number;
    status: ScoreVersionStatus;
    origin: ScoreVersionOrigin;
    measureCount: number;
    checks: ScoreChecks;
    pagesChanged: boolean;
}

/** Esito di un motore in un riconoscimento. */
export interface EngineOutcome {
    engine: string;
    version: string;
    status: 'DONE' | 'FAILED';
    errorCode?: string | null;
    durationMillis: number;
    versionId?: number | null;
    /** La versione del motore è stata scelta come proposta. */
    proposed: boolean;
}

/** Riconoscimento ottico delle pagine di una parte. */
export interface RecognitionJob {
    id: number;
    scoreId: number;
    status: RecognitionJobStatus;
    errorCode?: string | null;
    attempts: number;
    requestedAt: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    engines: EngineOutcome[];
}

export interface PartPlayback {
    scoreId: number;
    order: number;
    description?: string;
    instruments: PlaybackInstrument[];
    /** La parte appartiene a uno degli strumenti dell'utente: il suo spartito è visibile. */
    ownPart: boolean;
    sound: PlaybackSound;
    availability: PlaybackAvailability;
    version?: PlaybackVersion | null;
    settings?: PartPlaybackSettings | null;
    /** La parte ha pagine da riconoscere. */
    hasPages: boolean;
    /** Ultimo riconoscimento della parte, solo per archivisti e amministratori. */
    recognition?: RecognitionJob | null;
    /** Segnalazioni d'errore aperte sulla parte, contate solo per archivisti e amministratori. */
    openReports: number;
    /** Chi sta modificando la parte in un editor, solo per archivisti e amministratori. */
    editing?: EditLock | null;
    /** Bozza dell'editor di scrittura, solo per archivisti e amministratori. */
    draft?: DraftSummary | null;
}

/** Blocco di una parte: un solo autore alla volta, nell'editor di scrittura o di correzione. */
export interface EditLock {
    ownerName?: string | null;
    since: string;
    expiresAt: string;
    /** Il blocco appartiene a questa finestra dell'editor. */
    mine: boolean;
}

/** Bozza dell'editor di scrittura di una parte. */
export interface DraftSummary {
    savedBy?: string | null;
    savedAt: string;
    /** Dopo l'inizio della scrittura è stata salvata un'altra versione della parte. */
    outdated: boolean;
}

/** Bozza dell'editor di scrittura, con il contenuto. */
export interface ScoreDraft {
    /** MusicXML non compresso con una sola parte. */
    content: string;
    /** Versione da cui è partita la scrittura; `null` per una parte senza versioni. */
    baseVersionId: number | null;
    measureCount: number;
    savedBy?: string | null;
    savedAt: string;
    entityVersion: number;
    /** Dopo l'inizio della scrittura è stata salvata un'altra versione della parte. */
    outdated: boolean;
}

/** Bozza salvata: la versione da inviare con il salvataggio successivo. */
export interface DraftSaved {
    entityVersion: number;
    savedAt: string;
}

/** Parte scritta da zero, aggiunta in fondo alla traccia. */
export interface NewWrittenPart {
    description: string | null;
    instrumentIds: number[];
    /** MusicXML iniziale, che diventa la bozza della parte. */
    content: string;
    /** Versione della traccia mostrata all'archivista; `null` per non controllarla. */
    trackVersion: number | null;
}

export interface WrittenPart {
    scoreId: number;
    trackVersion: number;
}

export interface TrackPlayback {
    trackId: number;
    trackName?: string;
    version: number;
    tempoBpm?: number | null;
    referenceScoreId?: number | null;
    parts: PartPlayback[];
    /** Il servizio di riconoscimento è configurato: riconoscimento e caricamento MIDI sono disponibili. */
    recognitionAvailable: boolean;
}

export interface TrackPlaybackSettings {
    tempoBpm: number | null;
    referenceScoreId: number | null;
    version: number | null;
}

/** Proposta di suono e trasposizione calcolata dal nome di uno strumento. */
export interface InstrumentPlaybackSuggestion {
    keyword: string;
    writtenKey?: number | null;
    transposition?: number | null;
    bassClefTransposition?: number | null;
    soundBank?: number | null;
    soundProgram?: number | null;
    percussionKey?: number | null;
}

/** Battuta su una pagina della parte: pagina da 1, coordinate in frazioni della pagina. */
export interface MeasureBox {
    /** Battuta della versione, contata da 1. */
    measure: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    approximate: boolean;
}

/** Ciò che serve all'editor di correzione per aprire una versione. */
export interface ScoreEditorData {
    version: ScoreVersion;
    musicXml: string;
    /** Identificativi delle immagini delle pagine attuali della parte, in ordine. */
    pages: number[];
    /** Posizioni delle battute sulle pagine da cui la versione è stata ricavata; `null` se non note. */
    layout: MeasureBox[] | null;
}

/** Versione scritta nell'editor di correzione o in quello di scrittura. */
export interface ScoreCorrection {
    /** Versione di partenza; per la scrittura `null` quando la parte non ha versioni. */
    parentVersionId: number | null;
    content: string;
    approve: boolean;
    /** Per ogni battuta, la sua posizione nella versione di partenza; `null` per le battute inserite. Ignorato dalla scrittura. */
    measureSources?: (number | null)[];
    origin: 'CORRECTION' | 'WRITING';
    /** Sessione dell'editor, che deve possedere il blocco della parte. */
    editSession: string;
    /** Scrittura: chi scrive ha confermato di sostituire una versione salvata dopo l'inizio della scrittura. */
    confirmOutdated?: boolean;
}

export type ErrorReportStatus = 'OPEN' | 'CLOSED';
export type ErrorReportClosure = 'MANUAL' | 'APPROVAL';

export interface ErrorReportRequest {
    measureNumber: string | null;
    message: string;
}

/** Errore segnalato da chi ascolta una parte. */
export interface ErrorReport {
    id: number;
    scoreId: number;
    versionId: number;
    versionNumber?: number | null;
    measureNumber?: string | null;
    message: string;
    reportedBy?: string | null;
    reportedAt: string;
    status: ErrorReportStatus;
    closure?: ErrorReportClosure | null;
    closedBy?: string | null;
    closedAt?: string | null;
}
