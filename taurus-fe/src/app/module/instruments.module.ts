import { CommonFieldsOpenSearch } from "./common-fields-open-search.module";

export class Instruments extends CommonFieldsOpenSearch {
    /** Quanti utenti hanno assegnato questo strumento. Valorizzato solo negli elenchi. */
    usersCount?: number;
    /** Semitoni tra nota scritta e suono reale; vuoto finché lo strumento non è configurato per l'ascolto. */
    transpositionSemitones?: number | null;
    /** Semitoni per le parti in chiave di basso, se diversi. */
    bassClefTranspositionSemitones?: number | null;
    soundBank?: number | null;
    soundProgram?: number | null;
    /** Nota di batteria General MIDI: se presente lo strumento è una percussione. */
    percussionKey?: number | null;
    /** Nota scritta più grave, come numero di nota MIDI (60 è il Do4), nella trasposizione principale; vuota con la più acuta. */
    lowestWrittenPitch?: number | null;
    /** Nota scritta più acuta, come numero di nota MIDI. */
    highestWrittenPitch?: number | null;
    /** Calcolato dal backend: lo strumento ha suono e trasposizione. */
    playbackConfigured?: boolean;
    /** Posizione nell'organico della banda, da 1; vuota fuori dall'organico. Si cambia solo dalla scheda Organico. */
    ensemblePosition?: number | null;
}
/** Famiglie della banda, nell'ordine dell'organico di riferimento. */
export type InstrumentFamily =
    | 'WOODWINDS'
    | 'SAXOPHONES'
    | 'HORNS'
    | 'TRUMPETS'
    | 'FLUGELHORNS'
    | 'TROMBONES'
    | 'BASSES'
    | 'PITCHED_PERCUSSION'
    | 'PERCUSSION';

export const INSTRUMENT_FAMILY_LABELS: Record<InstrumentFamily, string> = {
    WOODWINDS: 'Legni',
    SAXOPHONES: 'Sassofoni',
    HORNS: 'Corni',
    TRUMPETS: 'Trombe e cornette',
    FLUGELHORNS: 'Flicorni',
    TROMBONES: 'Tromboni',
    BASSES: 'Bassi',
    PITCHED_PERCUSSION: 'Timpani e percussioni intonate',
    PERCUSSION: 'Percussioni'
};

/** Uno strumento con il suo posto nell'organico della banda. */
export interface EnsembleInstrument {
    id: number;
    name: string;
    /** Posizione nell'organico, da 1; vuota fuori dall'organico. */
    ensemblePosition?: number | null;
    /** Famiglia riconosciuta dal catalogo di riferimento; vuota se il catalogo non colloca lo strumento. */
    family?: InstrumentFamily | null;
}
