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
}