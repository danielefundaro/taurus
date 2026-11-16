/** Frammenti riutilizzabili della scrittura: battute intere salvate una volta e inserite nelle parti. */

export type ScoreFragmentCategory = 'INTRODUCTION' | 'MARCH' | 'SIGNAL' | 'ROLL' | 'OTHER';

/** Frammento intonato, in suoni reali, o di percussione, con il suono di ogni voce. */
export type ScoreFragmentKind = 'PITCHED' | 'PERCUSSION';

/** Suono di batteria di una voce di un frammento di percussione. */
export interface FragmentVoiceSound {
    voice: number;
    key: number;
}

/** Un frammento della biblioteca, senza il contenuto. */
export interface ScoreFragment {
    id: number;
    name: string;
    category: ScoreFragmentCategory;
    note?: string | null;
    kind: ScoreFragmentKind;
    measureCount: number;
    /** Suoni delle voci di un frammento di percussione, per voce; vuoto per un frammento intonato. */
    percussionKeys: FragmentVoiceSound[];
    entityVersion: number;
}

/** Frammento da salvare, con il MusicXML costruito nell'editor. */
export interface ScoreFragmentRequest {
    name: string;
    category: ScoreFragmentCategory;
    note: string | null;
    kind: ScoreFragmentKind;
    content: string;
    percussionKeys: FragmentVoiceSound[];
}

/** Nome, categoria e nota nuovi di un frammento, con la versione letta. */
export interface ScoreFragmentUpdate {
    name: string;
    category: ScoreFragmentCategory;
    note: string | null;
    entityVersion: number;
}
