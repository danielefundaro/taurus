export type PreparationProfile = 'PERFORMANCE' | 'REHEARSAL' | 'OTHER';
export type PreparationStatus = 'NOT_CONFIGURED' | 'BLOCKED' | 'ATTENTION' | 'READY' | 'UNKNOWN';
export type ClosureStatus = 'TO_CLOSE' | 'CLOSED_WITH_WARNINGS' | 'CLOSED' | 'NOT_REQUIRED' | 'UNKNOWN';
export type PreparationSeverity = 'BLOCKER' | 'WARNING' | 'INFO';
export type PreparationArea = 'EVENT' | 'PROGRAM' | 'SCORES' | 'AVAILABILITY' | 'MATERIALS' | 'BUDGET' | 'PRESENCE' | 'FINANCE';

/** Requirement flags are null while an explicit choice of the profile is still undecided: the backend rejects them. */
export interface EventPreparationConfiguration {
    profile: PreparationProfile;
    locationRequired: boolean | null;
    programRequired: boolean | null;
    scoresRequired: boolean | null;
    availabilityRequired: boolean | null;
    minimumAvailableParticipants?: number;
    availabilityDeadlineMinutes: number;
    materialsRequired: boolean | null;
    materialsDeadlineMinutes: number;
    budgetRequired: boolean | null;
    presenceClosureRequired: boolean | null;
    financialClosureRequired: boolean | null;
    version: number;
}

/** A row behind an issue: a track, an item or a piece of data, with the place where it is fixed. */
export interface EventPreparationIssueDetail {
    relatedId?: number;
    label: string;
    reason: string;
    message: string;
    action?: string;
}

export interface EventPreparationIssue {
    code: string;
    area: PreparationArea;
    severity: PreparationSeverity;
    message: string;
    /** An anchor of the page (`#…`) or a route (`/…`), chosen for the role of the view; absent when the role cannot act. */
    action?: string;
    relatedId?: number;
    details: EventPreparationIssueDetail[];
    /** All the detail rows, of which `details` holds at most twenty. */
    detailCount: number;
}

export interface EventPreparationEvaluation {
    evaluatedAt: string;
    phase: 'PREPARATION' | 'IN_PROGRESS' | 'FOLLOW_UP' | 'UNKNOWN';
    preparationStatus: PreparationStatus;
    closureStatus: ClosureStatus;
    completionPercent: number;
    passedChecks: number;
    applicableChecks: number;
    blockerCount: number;
    warningCount: number;
    infoCount: number;
    issues: EventPreparationIssue[];
    /** All the issues, of which `issues` holds at most twenty. */
    issueCount: number;
    /** Areas the plan requires but the tenant does not evaluate, because their module is off. */
    excludedAreas: PreparationArea[];
}

export interface EventPreparationScoreFile {
    mediaId: number;
    fileName: string;
}

export interface EventPreparationScore {
    id: number;
    description?: string;
    instruments: string[];
    /** The ids of the instruments, in the order of `instruments`. */
    instrumentIds: number[];
    ready: boolean;
    needsReview: boolean;
    /** A part with a version and without pages, written or derived and still to engrave. */
    unengraved: boolean;
    files: EventPreparationScoreFile[];
}

export interface EventPreparationProgramEntry {
    id: number;
    trackId: number;
    /** The current name, or the saved one once the track is deleted. */
    trackName: string;
    /** The name saved with the program, when it differs from the current one. */
    savedTrackName?: string;
    trackState: string;
    /** False when the track is deleted or no longer visible to the reader. */
    trackAvailable: boolean;
    encore: boolean;
    order: number;
    plannedDurationSeconds?: number;
    notes?: string;
    scores: EventPreparationScore[];
}

export type EventPreparationProgramRequest = Pick<EventPreparationProgramEntry, 'trackId' | 'encore' | 'plannedDurationSeconds' | 'notes'>;

export interface EventPreparationMaterial {
    id: number;
    itemId: number;
    itemName: string;
    inventoryNumber?: string;
    assignmentId?: number;
    assignee?: string;
    requiredQuantity: number;
    /** What the assignee still holds of the item. */
    outstandingQuantity?: number;
    condition: string;
    unsafeIssueOpen: boolean;
    confirmed: boolean;
    /** The confirmation no longer matches assignment, quantity or condition. */
    confirmationObsolete: boolean;
    ready: boolean;
    /** Stable codes of what keeps the row from being ready. */
    problems: string[];
    notes?: string;
}

export type EventPreparationMaterialRequest = Pick<EventPreparationMaterial, 'itemId' | 'assignmentId' | 'requiredQuantity' | 'notes'>;

export interface EventPreparationConfirmations {
    budgetAt?: string;
    budgetCurrent: boolean;
    presenceAt?: string;
    presenceCurrent: boolean;
    noMovementsAt?: string;
    noMovementsCurrent: boolean;
    noMovementsReason?: string;
}

export interface EventPreparationView {
    configuration?: EventPreparationConfiguration;
    /** Absent in the personal views of members and external users. */
    evaluation?: EventPreparationEvaluation;
    program: EventPreparationProgramEntry[];
    programVersion?: number;
    availability: { expected: number; available: number; unavailable: number; missing: number; minimumRequired?: number; deadline?: string };
    materials: EventPreparationMaterial[];
    materialsVersion?: number;
    confirmations?: EventPreparationConfirmations;
}
