import { PartPlayback, RecognitionJob, ScoreChecks, ScoreVersionOrigin } from '../module';

const RECOGNITION_ERRORS: Readonly<Record<string, string>> = {
    engineTimeout: 'i motori hanno superato il tempo massimo',
    engineFailed: 'i motori non sono riusciti a leggere le pagine',
    tooManyPages: 'la parte ha troppe pagine',
    tooLarge: 'le pagine sono troppo grandi',
    unreadableImage: "una pagina non è un'immagine leggibile",
    noPages: 'la parte non ha pagine',
    serviceUnavailable: 'il servizio di riconoscimento non è raggiungibile',
    interrupted: 'il riconoscimento si è interrotto più volte'
};

/** Nome di una parte nel lettore: descrizione, altrimenti gli strumenti, altrimenti il numero d'ordine. */
export function partLabel(part: PartPlayback): string {
    const instruments = part.instruments.map((instrument) => instrument.name).join(', ');
    return part.description?.trim() || instruments || `Parte ${part.order}`;
}

/** Problemi rilevati dai controlli automatici, come elenco leggibile. */
export function checkIssues(checks: ScoreChecks | null | undefined): string[] {
    if (!checks) return [];
    const issues: string[] = [];
    if (checks.wrongDurationCount > 0) {
        const measures = checks.wrongDurationMeasures.length ? ` (battute ${checks.wrongDurationMeasures.join(', ')}${checks.wrongDurationCount > checks.wrongDurationMeasures.length ? '…' : ''})` : '';
        issues.push(`${checks.wrongDurationCount} ${checks.wrongDurationCount === 1 ? 'battuta' : 'battute'} con durata errata${measures}`);
    }
    if (checks.openRepeats > 0) issues.push('ritornelli aperti e non chiusi');
    if (checks.unusualTimeSignatures > 0) issues.push('metro insolito');
    if (checks.octaveClefs > 0) issues.push("chiave all'ottava da verificare");
    if (checks.clefChanges > 2) issues.push(`${checks.clefChanges} cambi di chiave`);
    if (checks.emptyMeasures > 0) issues.push(`${checks.emptyMeasures} ${checks.emptyMeasures === 1 ? 'battuta vuota' : 'battute vuote'}`);
    if (!checks.tempo) issues.push('indicazione di tempo assente');
    return issues;
}

/** Riepilogo per chi ascolta: stato della versione e problemi principali. */
export function checksSummary(part: PartPlayback): string | null {
    const version = part.version;
    if (!version) return null;
    const notes: string[] = [];
    if (version.status !== 'APPROVED') notes.push('Versione non verificata');
    if (version.pagesChanged) notes.push('pagine modificate dopo questa versione');
    notes.push(...checkIssues(version.checks).filter((issue) => issue !== 'indicazione di tempo assente'));
    return notes.length ? notes.join(' · ') : null;
}

export function isRecognitionActive(job: RecognitionJob | null | undefined): boolean {
    return job?.status === 'QUEUED' || job?.status === 'RUNNING';
}

/** Stato di un riconoscimento per la scheda Ascolto; `null` quando è concluso con successo. */
export function recognitionLabel(job: RecognitionJob | null | undefined): string | null {
    if (!job) return null;
    if (job.status === 'QUEUED') return 'Riconoscimento in coda';
    if (job.status === 'RUNNING') return job.attempts > 1 ? `Riconoscimento in corso (tentativo ${job.attempts})` : 'Riconoscimento in corso';
    if (job.status === 'FAILED') return `Riconoscimento non riuscito: ${RECOGNITION_ERRORS[job.errorCode ?? ''] ?? 'errore imprevisto'}`;
    return null;
}

export function originLabel(origin: ScoreVersionOrigin): string {
    return {
        OMR_AUDIVERIS: 'Riconoscimento (Audiveris)',
        OMR_HOMR: 'Riconoscimento (homr)',
        UPLOAD_MUSICXML: 'File MusicXML',
        UPLOAD_MIDI: 'File MIDI',
        CORRECTION: 'Correzione',
        WRITING: 'Scrittura'
    }[origin];
}
