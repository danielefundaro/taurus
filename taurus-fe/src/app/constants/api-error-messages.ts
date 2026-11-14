import { ApiErrorArgs, ApiErrorArgValue, ApiErrorIssue, ApiFieldError } from '../module/api-error.module';

/**
 * Message of an error key: a text with `{name}` placeholders replaced by the parameters of the error,
 * or a function of the parameters for list-shaped and composite messages.
 */
export type ApiErrorMessage = string | ((args: ApiErrorArgs) => string);

/** Title and detail of a toast. */
export interface ApiErrorText {
    summary: string;
    detail: string;
}

/** Toast title when the caller declares none. */
export const API_ERROR_DEFAULT_SUMMARY = 'Operazione non riuscita';
/** Toast title for the `*.notFound` keys when the caller declares none. */
export const API_ERROR_NOT_FOUND_SUMMARY = 'Elemento non trovato';
/** Toast title of a concurrent modification, whatever the caller declares. */
export const API_ERROR_VERSION_CONFLICT_SUMMARY = 'Dati modificati';
/** Text of a request that never reached the server (status 0). */
export const API_ERROR_NETWORK_TEXT: ApiErrorText = { summary: 'Connessione non disponibile', detail: 'Il server non è raggiungibile: verificare la connessione e riprovare' };

const SERVER_ERROR_TEXT: ApiErrorText = { summary: 'Servizio temporaneamente non disponibile', detail: 'Si è verificato un problema sul server: riprovare tra qualche minuto' };
const NOT_FOUND_TEXT: ApiErrorText = { summary: API_ERROR_NOT_FOUND_SUMMARY, detail: "L'elemento richiesto non esiste più o non è accessibile" };
const TOO_LARGE_TEXT: ApiErrorText = { summary: 'File troppo grande', detail: 'Il file supera la dimensione massima consentita' };
const FAILED_REQUEST_TEXT: ApiErrorText = { summary: 'Richiesta non riuscita', detail: "Non è stato possibile completare l'operazione" };

/** Generic text by status, for the `http.{status}` keys and for keys missing from the catalog. */
export const apiErrorGenericText = (status: number): ApiErrorText => {
    if (status === 0) return API_ERROR_NETWORK_TEXT;
    if (status === 404) return NOT_FOUND_TEXT;
    if (status === 413) return TOO_LARGE_TEXT;
    if (status >= 500) return SERVER_ERROR_TEXT;
    return FAILED_REQUEST_TEXT;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PLACEHOLDER = /\{([a-zA-Z0-9]+)\}/g;

/** Formats a parameter for the user: ISO dates as dd/MM/yyyy, lists of values joined by «o». */
export const formatApiErrorValue = (value: ApiErrorArgValue): string => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
        const items = value.map(formatApiErrorValue).filter((item) => item !== '');
        return items.length > 1 ? `${items.slice(0, -1).join(', ')} o ${items[items.length - 1]}` : (items[0] ?? '');
    }
    if (typeof value === 'string') return value.replace(ISO_DATE, '$3/$2/$1');
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'sì' : 'no';
    return '';
};

/** Replaces the `{name}` placeholders of a message with the formatted parameters. */
export const formatApiErrorTemplate = (template: string, args: ApiErrorArgs = {}): string => template.replace(PLACEHOLDER, (_, name: string) => formatApiErrorValue(args[name]));

const isArgs = (value: ApiErrorArgValue): value is ApiErrorArgs => value !== null && typeof value === 'object' && !Array.isArray(value);
const objects = (value: ApiErrorArgValue): ApiErrorArgs[] => (Array.isArray(value) ? value.filter(isArgs) : []);
const listOf = (value: ApiErrorArgValue): ApiErrorArgValue[] => (Array.isArray(value) ? value : []);
const issueOf = (value: ApiErrorArgs): ApiErrorIssue => ({ code: formatApiErrorValue(value['code']), args: isArgs(value['args']) ? value['args'] : {} });

/** Requirements of the installation missing for the electronic signature (`signature.settings.requirementsMissing`). */
const SIGNATURE_REQUIREMENTS: Readonly<Record<string, string>> = {
    mail: 'il server di posta',
    codes: 'la chiave dei codici di conferma',
    seal: 'il certificato del sigillo'
};

/** Fields of the holder data (`signature.holderData.invalid`). */
export const SIGNATURE_HOLDER_FIELDS: Readonly<Record<string, string>> = {
    birthPlace: 'luogo di nascita',
    residence: 'residenza',
    postalCode: 'CAP',
    cityProvince: 'città e provincia',
    taxCode: 'codice fiscale',
    document: 'documento',
    documentIssuedBy: 'ente di rilascio del documento',
    documentIssuedOn: 'data di rilascio del documento',
    minorBirthPlace: 'luogo di nascita del socio minorenne',
    holderFirstName: 'nome del genitore o tutore',
    holderLastName: 'cognome del genitore o tutore',
    holderBirthDate: 'data di nascita del genitore o tutore, maggiorenne'
};

/** Acts of a sheet named by the signature markers (`signatureActEmpty`). */
const SIGNATURE_ACTS: Readonly<Record<string, string>> = {
    issue: 'emissione',
    variation: 'variazione',
    return: 'riconsegna'
};

/** Waiting time in seconds, or in minutes when longer than two minutes. */
const waitingTime = (value: ApiErrorArgValue): string => {
    const seconds = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return 'qualche secondo';
    return seconds > 120 ? `${Math.ceil(seconds / 60)} minuti` : `${seconds} secondi`;
};

/** Joins the items of a list as «a, b e c». */
const sentenceList = (values: string[]): string => (values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} e ${values[values.length - 1]}`);

/** Texts of the `reason` of `scorePlayback.upload.invalid`. */
const MUSICXML_PROBLEMS: Readonly<Record<string, string>> = {
    empty: 'Il file è vuoto',
    malformed: 'Il file non è un MusicXML valido',
    notMusicXml: 'Il file non contiene una partitura MusicXML',
    timewise: 'La partitura è salvata nel formato MusicXML "timewise", non supportato: esportarla di nuovo da un programma di notazione',
    archive: "L'archivio .mxl non contiene una partitura leggibile",
    archiveTooLarge: "L'archivio .mxl è troppo grande",
    noParts: 'La partitura non contiene parti',
    unreadable: 'Impossibile leggere il file',
    unreadableMidi: 'Il file MIDI non è leggibile o non contiene note'
};

/** Texts of the `reason` of `scorePlayback.correction.invalid`. */
const CORRECTION_PROBLEMS: Readonly<Record<string, string>> = {
    severalParts: 'La correzione deve contenere una sola parte',
    noParts: 'La correzione non contiene la parte',
    measureSources: "Le battute della correzione non corrispondono alla versione di partenza: riaprire l'editor",
    empty: 'La correzione è vuota',
    origin: "Origine della versione non valida: riaprire l'editor"
};

/** Texts of the `reason` of `scoreWriting.contentInvalid`. */
const WRITING_PROBLEMS: Readonly<Record<string, string>> = {
    severalParts: 'La parte scritta deve contenere una sola parte',
    noParts: 'La parte scritta è vuota',
    empty: 'La parte scritta è vuota'
};

/** Time of day of an ISO instant, as HH:mm in the time zone of the browser; empty when unreadable. */
const timeOfDay = (value: ApiErrorArgValue): string => {
    const date = typeof value === 'string' ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Who holds the edit lock of a part, for the error `scoreWriting.locked` and for the editors and the part list:
 * «In modifica da Mario Rossi dalle 10:32», or «aperta in un'altra finestra» for the same user.
 */
export const editLockMessage = (ownerName: string | null | undefined, since: string | null | undefined, sameUser: boolean): string => {
    const time = timeOfDay(since ?? null);
    const from = time ? ` dalle ${time}` : '';
    if (sameUser) return `La parte è aperta in un'altra finestra${from}`;
    return `In modifica da ${ownerName?.trim() || 'un altro utente'}${from}`;
};

const lockedMessage = (args: ApiErrorArgs): string => {
    const since = args['since'];
    return editLockMessage(formatApiErrorValue(args['ownerName']), typeof since === 'string' ? since : null, args['sameUser'] === true);
};

const LOAN_SETTINGS_PROBLEMS: Readonly<Record<string, string>> = {
    minAboveMax: 'la durata minima non può superare la durata massima',
    maxAboveTotal: 'la durata massima non può superare la durata complessiva massima',
    renewalAboveTotal: "l'estensione di un rinnovo non può superare la durata complessiva massima"
};

/**
 * The message of every key of the error catalog (docs/application-errors-standard.md), without the `error.` prefix.
 * It is the only source of the texts: the backend sends keys and parameters, never texts. The outcomes of the
 * template check are the `inventory.loanTemplate.issue.{code}` keys, the validation constraints the `validation.{code}` keys.
 * Keep one entry per line with the key in single quotes: scripts/docs/check-error-catalog.mjs reads them.
 */
export const API_ERROR_MESSAGES: Readonly<Record<string, ApiErrorMessage>> = {
    // Generic and cross-cutting keys
    validation: 'Alcuni dati non sono validi: controllare i campi evidenziati',
    concurrencyFailure: 'I dati sono cambiati nel frattempo: ricaricare la pagina e riprovare',
    'id.notFound': "L'elemento richiesto non esiste più o non è accessibile",
    'id.exists': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'id.invalid': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'id.null': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'version.conflict': "L'elemento è stato modificato da un'altra richiesta: ricaricare la pagina",

    // Validation constraints of fieldErrors
    'validation.NotNull': 'Campo obbligatorio',
    'validation.NotBlank': 'Campo obbligatorio',
    'validation.Size': (args) => sizeMessage(args),
    'validation.Min': (args) => `Il valore minimo è ${formatApiErrorValue(args['value'] ?? args['min'])}`,
    'validation.Max': (args) => `Il valore massimo è ${formatApiErrorValue(args['value'] ?? args['max'])}`,
    'validation.Email': 'Indirizzo e-mail non valido',
    'validation.Pattern': 'Formato non valido',
    'validation.Positive': 'Il valore deve essere maggiore di zero',

    // Session and tenant
    'auth.unauthenticated': 'Sessione scaduta: accedere di nuovo',
    'auth.forbidden': 'Non si hanno i permessi necessari per questa operazione',
    'auth.identity.missing': 'Sessione non valida: accedere di nuovo',
    'auth.tenant.missing': "L'utente non è associato a un tenant attivo",
    'auth.tenant.mismatch': 'Il tenant della sessione non corrisponde a quello richiesto',
    'auth.user.inactive': "L'utente non è attivo in questo tenant",
    'tenant.notProvisioned': 'Il tenant non è ancora pronto: completare la configurazione iniziale',
    'tenantFeature.finance.disabled': 'La funzionalità Economia non è disponibile per questo tenant',
    'tenantFeature.inventory.disabled': 'La funzionalità Inventario non è disponibile per questo tenant',
    'tenantFeature.onboardingImport.disabled': 'La funzionalità Configurazione iniziale non è disponibile per questo tenant',
    'tenantFeature.externalCalendarFeed.disabled': 'La funzionalità Feed calendario esterno non è disponibile per questo tenant',
    'tenantFeature.inventoryQr.disabled': 'La funzionalità QR code inventario non è disponibile per questo tenant',
    'tenantFeature.notificationPreferences.disabled': 'La funzionalità Preferenze notifiche non è disponibile per questo tenant',
    'tenantFeature.webPushReminders.disabled': 'La funzionalità Promemoria eventi Web Push non è disponibile per questo tenant',
    'tenantFeature.eventPreparation.disabled': 'La funzionalità Preparazione evento non è disponibile per questo tenant',
    'tenantFeature.scorePlayback.disabled': 'La funzionalità Ascolto delle parti non è disponibile per questo tenant',
    'tenantFeature.inventoryLoanSheet.disabled': 'La funzionalità Fogli di affidamento non è disponibile per questo tenant',
    'tenantFeature.inventorySignature.disabled': 'La funzionalità Firma elettronica non è disponibile per questo tenant',
    'tenantFeature.calendar.disabled': 'La funzionalità Calendario non è disponibile per questo tenant',
    'tenantFeature.eventPayouts.disabled': 'La funzionalità Compensi ai presenti non è disponibile per questo tenant',
    'tenantFeature.scoreWriting.disabled': 'La funzionalità Scrittura musicale non è disponibile per questo tenant',

    // Users and tenants
    'user.limit.exceeded': 'Raggiunto il numero massimo di utenti del tenant ({maximum})',
    'user.role.forbidden': 'Il ruolo di super amministratore non può essere assegnato',
    'user.admin.forbidden': 'Solo un amministratore può gestire gli amministratori',
    'user.profile.locked': 'Nome, cognome ed e-mail sono condivisi con altri tenant: può modificarli solo la persona dal proprio profilo',
    'tenant.code.exists': 'Codice tenant già utilizzato',
    'tenant.schema.provisioningFailed': 'Impossibile preparare il database del tenant: il tenant non è stato creato',
    'tenant.timeZone.invalid': 'Fuso orario non valido',

    // Access service (Keycloak)
    'keycloak.users.readFailed': "Impossibile leggere l'elenco degli utenti dal servizio di accesso",
    'keycloak.roleUsers.readFailed': 'Impossibile leggere gli utenti con il ruolo richiesto',
    'keycloak.user.readFailed': "Impossibile leggere l'utente dal servizio di accesso",
    'keycloak.user.createFailed': "Impossibile creare l'utente nel servizio di accesso",
    'keycloak.user.updateFailed': "Impossibile aggiornare l'utente nel servizio di accesso",
    'keycloak.user.deleteFailed': "Impossibile eliminare l'utente dal servizio di accesso",
    'keycloak.userGroup.updateFailed': "Impossibile associare l'utente al tenant",
    'keycloak.userGroups.readFailed': "Impossibile leggere i tenant dell'utente",
    'keycloak.userGroup.deleteFailed': "Impossibile rimuovere l'utente dal tenant",
    'keycloak.group.createFailed': 'Impossibile creare il tenant nel servizio di accesso',
    'keycloak.group.readFailed': 'Impossibile leggere il tenant dal servizio di accesso',
    'keycloak.group.deleteFailed': 'Impossibile eliminare il tenant dal servizio di accesso',
    'keycloak.userRoles.readFailed': "Impossibile leggere i ruoli dell'utente",
    'keycloak.userRoles.assignFailed': "Impossibile assegnare i ruoli all'utente",
    'keycloak.userRoles.removeFailed': "Impossibile rimuovere i ruoli dell'utente",
    'keycloak.configuration.incomplete': "Configurazione del servizio di accesso incompleta: contattare l'amministratore",
    'keycloak.email.resetPasswordFailed': "Impossibile inviare l'e-mail di reimpostazione della password",
    'keycloak.email.verifyAddressFailed': "Impossibile inviare l'e-mail di verifica dell'indirizzo",
    'keycloak.email.setupFailed': "Impossibile inviare l'e-mail di attivazione dell'account",
    'keycloak.authorizationFailed': "Il servizio di accesso non ha autorizzato Taurus: contattare l'amministratore",
    'keycloak.conflict': 'Esiste già un utente o un tenant con questi dati nel servizio di accesso',
    'keycloak.requestFailed': "Il servizio di accesso non ha completato l'operazione",

    // Inventory: items and photos
    'inventory.item.notFound': 'Oggetto inventario non trovato',
    'inventory.number.exists': 'Numero inventariale già utilizzato',
    'inventory.quantity.belowAssigned': 'La quantità totale non può essere inferiore a quella ancora assegnata ({assigned})',
    'inventory.value.currencyRequired': 'Valore unitario e valuta devono essere indicati insieme',
    'inventory.item.assigned': 'Non è possibile eliminare un oggetto ancora assegnato',
    'inventory.photo.notFound': 'Fotografia non trovata',
    'inventory.photo.invalid': 'Immagine non valida o più grande di {maxSide}×{maxSide} pixel',
    'inventory.photo.processingFailed': 'Impossibile elaborare la fotografia: riprovare con un altro file',
    'inventory.photo.tooLarge': 'La fotografia deve essere un file non vuoto di al massimo {maxMegabytes} MB',
    'inventory.photo.unsupported': 'Sono supportate solo immagini JPEG e PNG',
    'inventory.photo.limit': 'Raggiunto il numero massimo di {maximum} fotografie',
    'inventory.photo.order.invalid': "L'ordine deve contenere tutte e sole le fotografie attive dell'oggetto",

    // Inventory: assignments, acknowledgements and returns
    'inventory.assignment.notFound': 'Assegnazione non trovata',
    'inventory.quantity.unavailable': 'Quantità disponibile insufficiente: disponibili {available}',
    'inventory.issue.unsafe': 'Nuove assegnazioni bloccate da una segnalazione di sicurezza aperta',
    'inventory.user.notFound': 'Utente non trovato nel tenant',
    'inventory.user.identityMissing': "L'utente non ha un account di accesso: non può prendere visione dell'assegnazione",
    'inventory.assignment.userImmutable': 'Per cambiare utente occorre creare una nuova assegnazione',
    'inventory.assignment.quantityInvalid': 'La quantità assegnata non può essere inferiore a quella già riconsegnata ({minimum})',
    'inventory.assignment.notRejected': 'È possibile riemettere solo una presa visione rifiutata',
    'inventory.revision.versionConflict': "I dati dell'assegnazione sono cambiati: ricaricare prima di confermare",
    'inventory.decision.immutable': 'La scelta per questa revisione è già definitiva',
    'inventory.decision.reasonRequired': 'La motivazione del rifiuto è obbligatoria',
    'inventory.decision.signatureRequired': 'La presa visione ora richiede la conferma con codice: ricaricare la pagina',
    'inventory.revision.missing': SERVER_ERROR_TEXT.detail,
    'inventory.revision.createFailed': SERVER_ERROR_TEXT.detail,
    'inventory.return.notFound': 'Riconsegna non trovata',
    'inventory.return.quantityExceeded': 'Si possono riconsegnare al massimo {maximum} unità',
    'inventory.return.quantityInvalid': 'Quantità riconsegnata non valida',
    'inventory.return.closed': 'La procedura di riconsegna è già chiusa',
    'inventory.return.materialReassigned': 'La riconsegna non può essere eliminata perché il materiale è già stato riassegnato',
    'inventory.substitution.nothingOutstanding': "L'assegnazione non ha materiale da sostituire",
    'inventory.substitution.pendingReturn': 'Chiudere o annullare le richieste di riconsegna aperte prima della sostituzione',

    // Inventory: issues, labels, QR codes and erasure
    'inventory.issue.notFound': 'Segnalazione non disponibile',
    'inventory.issue.quantityExceeded': 'La quantità segnalata non può superare {maximum}',
    'inventory.issue.transition': 'Cambio di stato non consentito',
    'inventory.issue.resolutionNotes': 'Le note di risoluzione sono obbligatorie',
    'inventory.issue.versionConflict': 'La segnalazione è stata aggiornata da un altro utente: ricaricare la pagina',
    'inventory.issue.closed': 'La segnalazione è già chiusa',
    'inventory.issue.photo.invalid': 'Immagine non valida o più grande di {maxSide}×{maxSide} pixel',
    'inventory.issue.photo.processingFailed': 'Impossibile elaborare la fotografia: riprovare con un altro file',
    'inventory.issue.photo.tooLarge': 'La fotografia deve essere un file non vuoto di al massimo {maxMegabytes} MB',
    'inventory.issue.photo.unsupported': 'Sono supportate solo immagini JPEG e PNG',
    'inventory.issue.photo.limit': 'Raggiunto il numero massimo di {maximum} fotografie',
    'inventory.labels.duplicate': 'Ogni oggetto può comparire una sola volta',
    'inventory.labels.singleLimit': 'Il formato singolo ammette al massimo {maximum} etichette, a partire dalla prima posizione',
    'inventory.labels.sheetLimit': 'Le etichette non possono superare {maxPages} pagine A4',
    'inventory.labels.timeout': 'La generazione delle etichette ha superato il tempo massimo: riprovare con meno etichette',
    'inventory.labels.busy': 'La stampa delle etichette è occupata: riprovare fra poco',
    'inventory.qr.size.invalid': 'La dimensione del QR code deve essere di {sizes} pixel',
    'inventory.qr.notFound': 'Codice inventario non disponibile',
    'inventory.qr.disabled': "I QR code dell'inventario non sono disponibili",
    'inventory.erasure.notFound': 'Pratica di cancellazione non trovata',
    'inventory.erasure.closed': 'La pratica è già chiusa',
    'inventory.erasure.outstanding': 'Esiste ancora materiale da riconsegnare',

    // Loan sheets
    'inventory.loanSheet.notFound': 'Foglio di affidamento non trovato',
    'inventory.loanSheet.alreadyIssued': 'Il socio ha già il foglio di affidamento n. {sheetNumber} emesso',
    'inventory.loanSheet.assignmentNotFound': 'Una o più assegnazioni non sono disponibili',
    'inventory.loanSheet.otherMember': 'Le assegnazioni devono appartenere al socio del foglio',
    'inventory.loanSheet.alreadyLinked': "L'oggetto {itemName} è già in un foglio di affidamento",
    'inventory.loanSheet.nothingOutstanding': "L'oggetto {itemName} non è più in carico al socio",
    'inventory.loanSheet.roleRequired': "Indicare se l'Affidatario è il socio maggiorenne o il genitore o tutore",
    'inventory.loanSheet.validation': (args) =>
        `Emissione non possibile: ${objects(args['issues'])
            .map((issue) => `${formatApiErrorValue(issue['itemName'])} (${formatApiErrorValue(issue['inventoryNumber'])}): ${loanDurationIssueMessage(issueOf(issue))}`)
            .join('; ')}`,
    'inventory.loanSheet.missingLoanType': "L'oggetto non ha il regime di comodato: indicarlo nella scheda dell'oggetto (regole del foglio n. {sheetNumber})",
    'inventory.loanSheet.precariousExpiration': 'Un bene in comodato precario non può avere una data di scadenza (regole del foglio n. {sheetNumber})',
    'inventory.loanSheet.missingExpiration': 'La data di scadenza è obbligatoria per gli strumenti in comodato con scadenza (regole del foglio n. {sheetNumber})',
    'inventory.loanSheet.expirationOutOfRange': 'La data di scadenza deve essere compresa tra il {minimum} e il {maximum}, cioè tra {minMonths} e {maxMonths} mesi dalla consegna del {deliveredOn} (regole del foglio n. {sheetNumber})',
    'inventory.loanSheet.expirationLocked': 'La scadenza di un bene del foglio di affidamento n. {sheetNumber} si modifica solo con un rinnovo',
    'inventory.loanSheet.quantityLocked': 'La quantità di un bene del foglio di affidamento n. {sheetNumber} non è modificabile: registrare una nuova consegna o una riconsegna',
    'inventory.loanSheet.loanTypeLocked': "Il regime di comodato non è modificabile finché l'oggetto è in un foglio di affidamento emesso",
    'inventory.loanSheet.assignmentLocked': "L'assegnazione fa parte del foglio di affidamento n. {sheetNumber} e non può essere eliminata",
    'inventory.loanSheet.returnLocked': 'La riconsegna fa parte del foglio di affidamento n. {sheetNumber} già chiuso',
    'inventory.loanSheet.notClosed': 'Si definisce soltanto un foglio chiuso',
    'inventory.loanSheet.notIssued': "L'operazione è disponibile solo per un foglio emesso",
    'inventory.loanSheet.notLinked': 'Il bene non fa parte di un foglio di affidamento emesso',
    'inventory.loanSheet.notClosable': 'Il foglio si chiude quando tutti i beni sono stati riconsegnati',
    'inventory.loanSheet.chargesRequired': 'Con addebito occorre indicare importo e termine di pagamento',
    'inventory.loanSheet.cancelled': 'Il foglio di affidamento è stato annullato',
    'inventory.loanSheet.purged': 'I dati personali del foglio sono stati rimossi: il PDF non è più disponibile',
    'inventory.loanSheet.tooLarge': 'Il foglio di affidamento generato supera {maxMegabytes} MB',
    'inventory.loanSheet.signatureDisabled': "La firma elettronica non è attiva nell'associazione: emettere il foglio su carta",
    'inventory.loanSheet.holderEmailRequired': "Per la firma elettronica serve l'indirizzo e-mail dell'Affidatario",
    'inventory.loanSheet.templateNotSignable': 'Il modello in uso non è firmabile elettronicamente: correggere i marcatori nella pagina del modello o emettere il foglio su carta',
    'inventory.loanDuration.missingLoanType': "L'oggetto non ha il regime di comodato: indicarlo nella scheda dell'oggetto",
    'inventory.loanDuration.precariousExpiration': 'Un bene in comodato precario non può avere una data di scadenza',
    'inventory.loanDuration.missingExpiration': 'La data di scadenza è obbligatoria per gli strumenti in comodato con scadenza',
    'inventory.loanDuration.expirationOutOfRange': 'La data di scadenza deve essere compresa tra il {minimum} e il {maximum}, cioè tra {minMonths} e {maxMonths} mesi dalla consegna del {deliveredOn}',
    'inventory.renewal.notFixedTerm': 'Si rinnova soltanto un comodato con scadenza',
    'inventory.renewal.nothingOutstanding': 'Il bene è già stato riconsegnato',
    'inventory.renewal.missingExpiration': 'Il comodato non ha una scadenza da rinnovare',
    'inventory.renewal.afterExpiration': 'Il rinnovo deve essere concesso prima della scadenza in corso del {currentExpiration}',
    'inventory.renewal.authorizationAfterRenewal': 'La data della delibera non può essere successiva alla data del rinnovo',
    'inventory.renewal.notExtended': 'La nuova scadenza deve essere successiva a quella in corso',
    'inventory.renewal.renewalLimitExceeded': 'La nuova scadenza non può superare il {limit} ({months} mesi dalla scadenza precedente)',
    'inventory.renewal.totalLimitExceeded': 'La nuova scadenza non può superare il {limit} ({months} mesi complessivi dalla prima consegna del {firstDelivery})',
    'inventory.loanTemplate.invalid': (args) =>
        objects(args['issues'])
            .map((issue) => loanTemplateIssueLine(issueOf(issue), issue['line']))
            .join('; '),
    'inventory.loanTemplate.notFound': 'Versione del modello non trovata',
    'inventory.loanTemplate.tooLarge': 'Il modello supera {maxMegabytes} MB',
    'inventory.loanSettings.invalid': (args) =>
        `Regole di durata incoerenti: ${listOf(args['problems'])
            .map((problem) => LOAN_SETTINGS_PROBLEMS[formatApiErrorValue(problem)] ?? formatApiErrorValue(problem))
            .join('; ')}`,
    'inventory.loanSettings.versionConflict': "Le regole di durata sono state modificate da un'altra richiesta: ricaricare la pagina",

    // Electronic signature
    'signature.disabled': "La firma elettronica non è attiva nell'associazione",
    'signature.challenge.invalid': 'La richiesta di firma non è valida: ricaricare la pagina e riprovare',
    'signature.challenge.notFound': 'Richiesta di firma non trovata',
    'signature.challenge.closed': 'La richiesta di firma è già chiusa: ricominciare la firma',
    'signature.challenge.expired': 'Il codice è scaduto: richiederne uno nuovo',
    'signature.challenge.locked': 'Troppi codici errati: ricominciare la firma',
    'signature.challenge.invalidCode': (args) => (args['remainingAttempts'] === 1 ? 'Codice errato: resta un solo tentativo' : `Codice errato: restano ${formatApiErrorValue(args['remainingAttempts'])} tentativi`),
    'signature.challenge.limit': 'Raggiunto il numero massimo di {maxSends} codici per questa firma: ricominciare la firma',
    'signature.challenge.resendTooSoon': (args) => `Nuovo codice richiesto troppo presto: riprovare tra ${waitingTime(args['retryAfterSeconds'])}`,
    'signature.method.totpNotConfigured': "L'app di autenticazione non è configurata: usare il codice via e-mail",
    'signature.method.unavailable': "L'app di autenticazione non si può verificare in questo momento: usare il codice via e-mail",
    'signature.mail.addressMissing': "Non è registrato un indirizzo e-mail a cui inviare il codice: chiedere all'amministratore di aggiungerlo",
    'signature.mail.sendFailed': 'Non è stato possibile inviare il codice via e-mail: riprovare tra qualche minuto',
    'signature.link.sendFailed': 'Non è stato possibile inviare il link via e-mail: riprovare tra qualche minuto',
    'signature.cieSign.documentMismatch': 'Il file non è il documento scaricato da Taurus o è stato modificato dopo la firma: scaricare di nuovo il documento e firmarlo senza modificarlo',
    'signature.cieSign.invalidSignature': 'Il file non contiene una sola firma valida: firmare il documento una volta con CieSign e caricare il file ottenuto',
    'signature.cieSign.untrustedCertificate': "La firma non è fatta con una Carta d'Identità Elettronica valida",
    'signature.cieSign.signerMismatch': "La firma è di un'altra persona: nome, cognome e codice fiscale della carta devono essere quelli dell'Affidatario",
    'signature.cieSign.tooLarge': 'Il file firmato supera {maxMegabytes} MB',
    'signature.cieSign.notAvailable': 'CieSign non è disponibile senza un codice fiscale italiano: firmare con il codice',
    'signature.cieSign.notConfigured': 'CieSign non è disponibile in questa installazione: firmare con il codice',
    'signature.settings.requirementsMissing': (args) =>
        `La firma elettronica non è attivabile: mancano ${sentenceList(
            listOf(args['missing']).map((value) => SIGNATURE_REQUIREMENTS[formatApiErrorValue(value)] ?? formatApiErrorValue(value))
        )}: chiedere a chi gestisce l'installazione di configurarli`,
    'signature.settings.versionConflict': "Le impostazioni della firma sono state modificate da un'altra richiesta: ricaricare la pagina",
    'signature.act.notFound': 'Atto da firmare non trovato',
    'signature.act.notAwaitingData': "L'atto non attende più i dati dell'Affidatario: ricaricare la pagina",
    'signature.act.notAwaitingSignatures': "L'atto non è in attesa di firme: ricaricare la pagina",
    'signature.act.documentChanged': 'Il documento è cambiato: ricaricare la pagina e rileggerlo prima di firmare',
    'signature.act.alreadySigned': 'Questa firma è già registrata',
    'signature.act.acknowledgmentsPending': (args) =>
        Number(args['count']) === 1
            ? "C'è una presa visione in attesa: confermarla dall'elenco delle consegne, poi firmare"
            : `Ci sono ${formatApiErrorValue(args['count'])} prese visione in attesa: confermarle dall'elenco delle consegne, poi firmare`,
    'signature.act.purged': "I documenti dell'atto sono stati eliminati da Taurus: la conservazione spetta all'associazione",
    'signature.act.batchNotAllowed': 'Solo le variazioni si possono firmare insieme: firmare gli altri atti uno alla volta',
    'signature.act.versionConflict': "L'atto è stato modificato da un'altra richiesta: ricaricare la pagina",
    'signature.holderData.invalid': (args) => `Dati mancanti o non validi: ${sentenceList(listOf(args['fields']).map((value) => SIGNATURE_HOLDER_FIELDS[formatApiErrorValue(value)] ?? formatApiErrorValue(value)))}`,
    'signature.holderData.birthDateMissing': (args) =>
        args['holderRole'] === 'GUARDIAN' ? "Manca la data di nascita del socio minorenne: chiedere all'associazione di inserirla, poi completare i dati" : 'Manca la data di nascita: aggiungerla nella pagina Profilo, poi completare i dati',
    'signature.associationSigner.sameAsHolder': "Chi firma per l'Associazione non può essere l'Affidatario",
    'signature.associationSigner.notAdmin': "Chi firma per l'Associazione deve essere un amministratore o un membro del direttivo attivo: designare un altro firmatario",
    'signature.associationSigner.locked': "Dopo la prima firma il firmatario per l'Associazione non cambia più: se non può firmare, dichiarare l'atto firmato su carta",

    // Outcomes of the loan template check
    'inventory.loanTemplate.issue.empty': 'Il file è vuoto',
    'inventory.loanTemplate.issue.encoding': 'Il file contiene caratteri non leggibili: salvarlo con codifica UTF-8',
    'inventory.loanTemplate.issue.syntax.emptyTag': 'Tag vuoto «{{}}»',
    'inventory.loanTemplate.issue.syntax.unopenedClose': 'Chiusura «{{/{name}}}» senza una sezione aperta',
    'inventory.loanTemplate.issue.syntax.mismatchedClose': 'La sezione «{openName}» aperta alla riga {openLine} è chiusa con «{{/{name}}}»',
    'inventory.loanTemplate.issue.syntax.unclosed': 'La sezione «{name}» non è chiusa',
    'inventory.loanTemplate.issue.syntax.invalid': 'Sintassi Mustache non valida',
    'inventory.loanTemplate.issue.unescaped': "L'inserimento senza escape non è ammesso: usare {{{name}}}",
    'inventory.loanTemplate.issue.include': "L'inclusione di altri modelli non è ammessa: «{name}»",
    'inventory.loanTemplate.issue.delimiters': 'Il cambio dei delimitatori non è ammesso',
    'inventory.loanTemplate.issue.listAsVariable': '«{name}» è un elenco: va usato come sezione',
    'inventory.loanTemplate.issue.unknownVariable': (args) => `Variabile sconosciuta «${formatApiErrorValue(args['name'])}»${args['list'] ? `: è un campo dell'elenco «${formatApiErrorValue(args['list'])}» e va usato dentro la sua sezione` : ''}`,
    'inventory.loanTemplate.issue.forbiddenElement': "L'elemento <{tag}> non è ammesso",
    'inventory.loanTemplate.issue.unsupportedImage': 'Immagine incorporata in un formato non supportato: usare PNG o JPEG',
    'inventory.loanTemplate.issue.externalResource': 'Risorsa esterna non ammessa in {where} ({value}): usare un data: URI',
    'inventory.loanTemplate.issue.import': '@import non è ammesso: il CSS va scritto nel modello',
    'inventory.loanTemplate.issue.fontFace': '@font-face non è ammesso: usare Helvetica, Times o Courier',
    'inventory.loanTemplate.issue.tooLargePdf': 'Il PDF generato con i dati di esempio supera {maxMegabytes} MB',
    'inventory.loanTemplate.issue.renderFailed': 'Il PDF non può essere generato con i dati di esempio',
    'inventory.loanTemplate.issue.font': 'Il font «{font}» non è disponibile: verrà usato un font standard. Usare Helvetica, Times o Courier',
    'inventory.loanTemplate.issue.unsupportedCharacter': 'Il carattere «{character}» ({codePoint}) non è stampabile con i font standard e verrà stampato in modo errato',
    'inventory.loanTemplate.issue.missingSheetNumber': 'Il modello non stampa il numero del foglio',
    'inventory.loanTemplate.issue.missingGoods': 'Il modello non stampa i beni consegnati',
    'inventory.loanTemplate.issue.missingDurations': 'Il modello non usa le variabili delle regole di durata: verificare che il testo sulla durata del comodato corrisponda alle regole applicate dai controlli',
    'inventory.loanTemplate.issue.signatureActMissing': "L'elemento <{tag}> non indica con data-taurus-act a quale atto appartiene",
    'inventory.loanTemplate.issue.signatureActUnknown': 'Valore «{value}» non ammesso in data-taurus-act: usare issue, variation, return o all',
    'inventory.loanTemplate.issue.signatureActEmpty': (args) => `Nessuna parte del modello appartiene all'atto di ${SIGNATURE_ACTS[formatApiErrorValue(args['act'])] ?? formatApiErrorValue(args['act'])}`,
    'inventory.loanTemplate.issue.signatureClausesMissing': 'Manca il blocco dell\'approvazione specifica delle clausole (data-taurus-sign="clauses")',
    'inventory.loanTemplate.issue.signatureClausesDuplicate': 'Il blocco delle clausole (data-taurus-sign="clauses") deve essere uno solo',
    'inventory.loanTemplate.issue.signatureClausesOutsideIssue': 'Il blocco delle clausole deve stare in una parte dell\'emissione (data-taurus-act="issue")',
    'inventory.loanTemplate.issue.signatureClausesEmpty': 'Il blocco delle clausole è vuoto',

    // Finance
    'finance.account.notFound': 'Conto non trovato',
    'finance.account.archived': 'Il conto è archiviato',
    'finance.account.alreadyActive': 'Il conto è già attivo',
    'finance.account.nameExists': 'Esiste già un conto attivo con questo nome',
    'finance.account.notArchived': 'Il conto deve essere archiviato prima di essere eliminato',
    'finance.account.hasMovements': 'Il conto ha movimenti attivi: può essere soltanto archiviato',
    'finance.account.bankFields': 'IBAN e banca sono ammessi soltanto per un conto corrente',
    'finance.category.notFound': 'Categoria non trovata',
    'finance.category.archived': 'La categoria è archiviata',
    'finance.category.nameExists': 'Esiste già una categoria attiva con questo nome',
    'finance.movement.notFound': 'Movimento non trovato',
    'finance.movement.categoryDirection': 'La categoria non è compatibile con la direzione del movimento',
    'finance.movement.versionConflict': 'Il movimento è stato modificato da un altro utente: ricaricalo prima di salvare',
    'finance.movement.payoutSettlement':
        'Il movimento liquida compensi ai presenti: per cambiarne importo o direzione eliminalo e genera una nuova liquidazione',
    'finance.event.notFound': 'Evento non trovato',
    'finance.year.notFound': 'Esercizio non trovato',
    'finance.transfer.sameAccount': 'Il conto di origine e quello di destinazione devono essere diversi',
    'finance.transfer.currencyMismatch': 'I conti del trasferimento devono avere la stessa valuta',
    'finance.transfer.inconsistent': 'Il trasferimento non contiene due movimenti coerenti',
    'finance.attachment.notFound': 'Allegato non trovato',
    'finance.attachment.tooLarge': "L'allegato deve essere un file non vuoto di al massimo {maxMegabytes} MB",
    'finance.attachment.unsupported': 'Sono supportati soltanto PDF, JPEG e PNG',
    'finance.attachment.contentMismatch': 'Il contenuto del file non corrisponde al tipo dichiarato',
    'finance.attachment.limit': 'Sono consentiti al massimo {maximum} allegati per movimento',
    'finance.report.invalidPeriod': 'La data iniziale deve precedere la data finale',
    'finance.report.unsupportedFormat': 'Formato di esportazione non supportato',
    'finance.report.generationFailed': 'Impossibile generare il rendiconto: riprovare',

    // Shares of the participants
    'payout.setting.notFound': 'Versione dei parametri non trovata',
    'payout.setting.dateExists': 'Esiste già una versione dei parametri con questa decorrenza',
    'payout.setting.inUse':
        "La versione è l'unica applicabile ad alcuni eventi con presenti: crea prima una versione con decorrenza anteriore",
    'payout.setting.notConfigured': "Nessuna versione dei parametri dei compensi è applicabile alla data dell'evento",
    'payout.preview.invalid': 'Parametri di anteprima non validi',
    'payout.user.notFound': 'Utente non trovato',
    'payout.adjustment.reasonRequired': 'Il motivo del fattore o del pagamento fisso è obbligatorio',
    'payout.adjustment.valueRequired': 'Indicare un fattore oppure un pagamento fisso',
    'payout.adjustment.factorOutOfRange': 'Il fattore deve essere compreso fra 0 e 1',
    'payout.adjustment.fixedAmountNotPositive': 'Il pagamento fisso deve essere maggiore di zero',
    'payout.adjustment.userNotPresent': "L'utente non risulta presente all'evento",
    'payout.settlement.empty': 'La liquidazione non contiene righe',
    'payout.settlement.multipleUsers': 'Una liquidazione riguarda un solo socio',
    'payout.settlement.amountExceedsDue': "L'importo da liquidare supera il residuo dovuto per l'evento",

    // Event preparation
    'eventPreparation.event.notFound': 'Evento non trovato',
    'eventPreparation.notConfigured': "Configurare prima la preparazione dell'evento",
    'eventPreparation.track.notFound': 'Una traccia del programma non è più disponibile',
    'eventPreparation.item.notFound': 'Un oggetto dei materiali non è più disponibile',
    'eventPreparation.assignment.notFound': "Un'assegnazione dei materiali non è più disponibile",
    'eventPreparation.assignment.itemMismatch': "L'assegnazione non appartiene all'oggetto selezionato",
    'eventPreparation.material.notFound': 'Materiale non trovato',
    'eventPreparation.movements.exists': "Sono presenti movimenti economici per l'evento",
    'eventPreparation.program.required': "Gli spartiti richiedono il programma dell'evento",
    'eventPreparation.participants.required': 'Indicare il numero minimo di partecipanti',
    'eventPreparation.versionConflict': "La preparazione è stata modificata da un'altra richiesta: la pagina mostra ora i dati aggiornati",
    'eventPreparation.requirement.required': 'Scegliere se ogni area della preparazione è richiesta',
    'eventPreparation.program.tooLarge': 'Il programma può contenere al massimo 100 brani',
    'eventPreparation.materials.tooLarge': 'I materiali possono contenere al massimo 100 righe',
    'eventPreparation.reason.tooLong': 'Il motivo può contenere al massimo 500 caratteri',

    // Operational dashboard
    'dashboard.attention.invalid': 'Filtro delle attività non riconosciuto',

    // Calendar: recurring series, reminders and feeds
    'calendar.series.request.invalid': "Indicare l'evento modello e la ricorrenza",
    'calendar.series.template.invalid': "Indicare nome e data di inizio dell'evento",
    'calendar.series.duration.invalid': "La fine dell'evento deve seguire l'inizio",
    'calendar.series.recurrence.invalid': 'Regola di ricorrenza non valida',
    'calendar.series.recurrence.tooManyOccurrences': (args) => `La regola supera il limite di ${args['maximum'] ?? 500} occorrenze: riduci la durata o aumenta l’intervallo`,
    'calendar.series.sourceOccurrence.invalid': "L'occorrenza di partenza non appartiene alla serie",
    'calendar.series.occurrence.notFound': 'Occorrenza non trovata nella serie',
    'calendar.series.idempotencyKey.invalid': "La chiave della richiesta non è valida: riprova a creare la serie",
    'calendar.series.duplicateRequest': "La serie è già in creazione da un'altra richiesta: aggiorna la pagina per vederla",
    'calendar.series.occurrence.conflict': "Un'altra occorrenza della serie inizia già in quella data",
    'calendar.series.reminder.invalid': "Il promemoria deve essere compreso tra 0 e {maximum} minuti prima dell'evento",
    'calendar.reminder.invalid': "Il promemoria deve essere compreso tra 0 e {maximum} minuti prima dell'evento",
    'calendar.reminder.availabilityMissing': 'Confermare la propria disponibilità prima di impostare un promemoria',
    'calendarFeed.notFound': 'Feed non trovato',
    'calendarFeed.limit': 'Raggiunto il numero massimo di {maximum} feed attivi',
    'calendarFeed.active': 'Revocare il feed prima di eliminarlo',
    'calendarFeed.idempotencyKey': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'calendarFeed.idempotency.conflict': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'calendarFeed.idempotency.stale': 'Il feed è cambiato nel frattempo: ricaricare la pagina',
    'calendarFeed.role': 'Il feed personale richiede un ruolo di partecipante',

    // Notification preferences, notices and deliveries
    'preferences.disabled': 'Le preferenze di notifica non sono disponibili',
    'preferences.required': 'Preferenze di notifica mancanti',
    'preferences.invalid': "Indicare l'orario del riepilogo e l'anteprima delle notifiche push",
    'preferences.versionConflict': "Le preferenze sono state modificate da un'altra richiesta: ricaricare la pagina",
    'preferences.timeZone.invalid': 'Fuso orario non valido',
    'preferences.reminder.invalid': 'Il promemoria predefinito deve essere compreso tra 0 e {maximum} minuti',
    'preferences.quietHours.invalid': 'Ore di silenzio non valide: indicare un inizio e una fine diversi',
    'preferences.digest.quietHours': "L'orario del riepilogo non può cadere nelle ore di silenzio",
    'preferences.pushPause.invalid': 'La pausa delle notifiche push deve terminare entro {maxDays} giorni',
    'preferences.categories.incomplete': 'Indicare le preferenze per tutte le categorie di notifica',
    'preferences.categories.invalid': 'Categorie di notifica non valide: ricaricare la pagina e riprovare',
    'notice.snooze.invalid': 'Il posticipo deve essere compreso tra {minMinutes} minuti e {maxDays} giorni',
    'notice.snooze.read': 'Una notifica già letta non può essere posticipata',
    'notification.delivery.notFound': 'Consegna non trovata',
    'notification.delivery.page.invalid': 'Pagina non valida: si possono mostrare al massimo {maxSize} consegne',
    'notification.delivery.range.invalid': "L'inizio dell'intervallo deve precedere la fine",
    'notification.delivery.operation.invalid': 'Filtro per operazione non valido',
    'notification.delivery.sort.invalid': 'Ordinamento non supportato',
    'notification.delivery.ids.invalid': 'Selezionare da 1 a {maximum} consegne',
    'notification.delivery.ids.duplicate': 'La selezione contiene consegne ripetute',
    'notification.delivery.notFailed': 'Si ripetono soltanto le consegne non riuscite',
    'notification.delivery.notClosable': 'Si chiudono soltanto le consegne in attesa o non riuscite',
    'notification.delivery.close.unsupported': 'La distribuzione delle notifiche interne non si chiude manualmente',

    // Guided tour
    'guidedTour.disabled': 'La guida non è disponibile',
    'guidedTour.versionConflict': "La guida è stata aggiornata da un'altra scheda: ricaricare la pagina",
    'guidedTour.step.limit': 'Avanzamento della guida non valido: ricaricare la pagina e riprovare',

    // Legal documents
    'legal.acceptance.incomplete': 'Confermare tutti i documenti obbligatori',
    'legal.document.stale': 'Uno o più documenti non sono più in vigore: ricaricare la pagina',
    'legal.document.notFound': 'Documento legale non trovato',
    'legal.document.version.exists': 'Esiste già questa versione del documento',
    'legal.document.published.immutable': 'Una versione pubblicata non si modifica: crearne una nuova',
    'legal.document.content.required': 'Scrivere il testo del documento',
    'legal.document.content.tooLong': 'Il testo supera i 100.000 caratteri',
    'legal.document.version.invalid': 'Usare per la versione solo lettere, numeri, punto, trattino e trattino basso',

    // Instruments and the instruments to add of the tracks
    'instrument.name.exists': 'Esiste già uno strumento con questo nome',
    'instrumentSuggestion.notOpen': "Uno dei nomi è già stato deciso da un'altra richiesta",

    // Tracks, uploads and page images
    'track.notFound': 'Brano non trovato',
    'track.file.empty': 'Il file è vuoto',
    'track.annotations.invalid': 'Le modifiche alle pagine non sono leggibili: riapri il manipolatore e riprova',
    'track.score.notFound': 'La parte non appartiene al brano',
    'track.queue.failed': "Impossibile avviare l'elaborazione del file: riprovare",
    'track.upload.notFound': 'Elaborazione non trovata',
    'track.upload.notRetryable': "Si ripete soltanto un'elaborazione non riuscita",
    'track.upload.versionConflict': "L'elaborazione è cambiata nel frattempo: ricaricare la pagina",
    'track.upload.mediaRequired': 'Indicare il file da elaborare',
    'track.upload.mediaNotFound': 'File da elaborare non trovato',
    'track.upload.unsupported': 'Sono supportati soltanto file PDF',
    'track.upload.failed': 'Impossibile caricare il file: riprovare',
    'image.forbidden': 'Solo amministratori e archivisti possono modificare le immagini',
    'image.notFound': 'Immagine della pagina non trovata',
    'image.unsupported': 'Formato immagine non supportato',
    'image.empty': "L'immagine è vuota",
    'image.tooLarge': "L'immagine supera {maxMegabytes} MB",
    'image.dimensions.tooLarge': "L'immagine è troppo grande: massimo {maxSide} pixel per lato e {maxMegapixels} milioni di pixel",
    'image.decode': "Impossibile leggere l'immagine",
    'image.encode': "Impossibile salvare l'immagine modificata",
    'image.output.tooLarge': "L'immagine modificata supera {maxMegabytes} MB",
    'image.recipe.empty': 'Nessuna modifica da applicare',
    'image.recipe.invalid': "Regolazioni dell'immagine non valide",
    'image.recipeVersion': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'image.crops.invalid': 'Si possono indicare al massimo {maximum} ritagli',
    'image.crop.invalid': 'Area di ritaglio non valida',
    'image.idempotencyKey': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'image.idempotency.conflict': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'image.idempotency.stale': 'Il brano è cambiato dopo la modifica: ricaricare la pagina',
    'image.timeout': "L'elaborazione dell'immagine ha superato il tempo massimo: riprovare",
    'image.busy': "L'elaborazione delle immagini è occupata: riprovare fra poco",

    // Media
    'media.managedOnly': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'media.notReady': 'Il file non è ancora disponibile',
    'media.integrity': 'Il file archiviato è danneggiato: caricarlo di nuovo',
    'media.fileNotFound': "File non presente nell'archivio",
    'media.referenced': 'Il file è ancora in uso e non può essere eliminato',
    'media.category.invalid': 'Richiesta non valida: ricaricare la pagina e riprovare',
    'media.file.empty': 'Il file è vuoto',
    'media.file.storeFailed': 'Impossibile salvare il file: riprovare',

    // Ascolto e correzione delle parti
    'scorePlayback.track.notFound': 'Brano non trovato',
    'scorePlayback.part.notFound': 'Parte non trovata',
    'scorePlayback.version.notFound': 'Versione della parte non trovata',
    'scorePlayback.version.conflict': "Un'altra versione della parte è stata appena salvata: riprovare",
    'scorePlayback.playback.notAvailable': 'Ascolto non ancora disponibile',
    'scorePlayback.upload.empty': 'Il file è vuoto',
    'scorePlayback.upload.unsupportedFormat': 'Formato non supportato: caricare un file MusicXML (.musicxml, .xml, .mxl) o MIDI (.mid, .midi)',
    'scorePlayback.upload.tooLarge': 'Il file supera {maxMegabytes} MB',
    'scorePlayback.upload.invalid': (args) => MUSICXML_PROBLEMS[formatApiErrorValue(args['reason'])] ?? 'Il file non è un MusicXML valido',
    'scorePlayback.upload.partRequired': 'Scegliere la parte da importare',
    'scorePlayback.upload.partNotFound': 'La parte scelta non è presente nel file',
    'scorePlayback.settings.invalid': 'Impostazioni di ascolto non valide',
    'scorePlayback.settings.versionConflict': 'Il brano è stato modificato nel frattempo: ricaricare la pagina',
    'scorePlayback.recognition.alreadyRunning': 'Riconoscimento già in corso',
    'scorePlayback.recognition.noPages': 'Nessuna pagina da riconoscere',
    'scorePlayback.omr.unavailable': 'Servizio di riconoscimento non disponibile: riprovare più tardi',
    'scorePlayback.correction.invalid': (args) => CORRECTION_PROBLEMS[formatApiErrorValue(args['reason'])] ?? "La correzione non è un MusicXML valido: annullare l'ultima modifica e riprovare",
    'scorePlayback.report.invalid': "Descrivere l'errore in al massimo 1000 caratteri",
    'scorePlayback.report.limitReached': 'Hai già {maxOpen} segnalazioni aperte su questa parte: attendi che vengano esaminate',
    'scorePlayback.report.notFound': 'Segnalazione non trovata',

    // Scrittura musicale e blocco degli editor
    'scoreWriting.locked': lockedMessage,
    'scoreWriting.sessionInvalid': "Sessione dell'editor non valida: ricaricare la pagina",
    'scoreWriting.contentInvalid': (args) => WRITING_PROBLEMS[formatApiErrorValue(args['reason'])] ?? "La parte scritta non è un MusicXML valido: annullare l'ultima modifica e riprovare",
    'scoreWriting.draftConflict': "La bozza è stata modificata altrove: riaprire l'editor",
    'scoreWriting.draftOutdated': "Nel frattempo è stata salvata un'altra versione della parte: confermare per sostituirla",
    'scoreWriting.instrumentNotFound': 'Uno degli strumenti scelti non esiste più: ricaricare la pagina',

    // Onboarding
    'onboarding.disabled': 'La configurazione iniziale non è disponibile',
    'onboarding.file.required': 'Il file è obbligatorio',
    'onboarding.file.tooLarge': 'Il file supera {maxMegabytes} MB',
    'onboarding.file.unreadable': 'Impossibile leggere il file',
    'onboarding.csvSection.required': 'Indicare la sezione del file CSV',
    'onboarding.selectedSections.required': 'Selezionare almeno una sezione',
    'onboarding.section.featureDisabled': 'La sezione richiede una funzionalità non disponibile per questo tenant',
    'onboarding.job.notFound': 'Importazione non trovata',
    'onboarding.job.notReady': "L'importazione non è pronta",
    'onboarding.job.notCancellable': "L'importazione non può essere annullata",
    'onboarding.job.validationNotRetryable': 'La validazione non si può ripetere',
    'onboarding.job.compensationNotRequired': 'Il ripristino non è necessario',
    'onboarding.job.sourceRemoved': "Il file dell'importazione è stato eliminato",
    'onboarding.idempotency.conflict': "L'importazione è già in applicazione da un'altra richiesta",
    'onboarding.warnings.notAccepted': "Accettare gli avvisi prima di applicare l'importazione",
    'onboarding.tenant.busy': "Un'altra importazione è già in corso",
    'onboarding.pendingJobs.tooMany': 'Ci sono già {maxPendingJobs} importazioni in attesa: completarle o annullarle prima di caricarne un’altra',
    'onboarding.email.retryNotAllowed': 'Nessuna e-mail da inviare di nuovo'
};

/** The message of a catalog key with its parameters, or `undefined` when the key is missing from the catalog. */
export const apiErrorMessage = (key: string, args: ApiErrorArgs = {}): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(API_ERROR_MESSAGES, key)) return undefined;
    const message = API_ERROR_MESSAGES[key];
    return typeof message === 'function' ? message(args) : formatApiErrorTemplate(message, args);
};

/** Message of a duration problem of a good (`inventory.loanDuration.{code}`), in the sheet proposal or in an issue error. */
export const loanDurationIssueMessage = (issue: ApiErrorIssue): string => apiErrorMessage(`inventory.loanDuration.${issue.code}`, issue.args) ?? 'Il bene non rispetta le regole di durata del comodato';

/** Message of an outcome of the template check (`inventory.loanTemplate.issue.{code}`). */
export const loanTemplateIssueMessage = (issue: ApiErrorIssue): string => apiErrorMessage(`inventory.loanTemplate.issue.${issue.code}`, issue.args) ?? 'Il modello contiene un elemento non ammesso';

/** Message of a field rejected by `@Valid` (`validation.{code}`). */
export const apiFieldErrorMessage = (fieldError: ApiFieldError): string => apiErrorMessage(`validation.${fieldError.code}`, fieldError.args) ?? 'Valore non valido';

function loanTemplateIssueLine(issue: ApiErrorIssue, line: ApiErrorArgValue): string {
    const message = loanTemplateIssueMessage(issue);
    return line === null || line === undefined ? message : `Riga ${formatApiErrorValue(line)}: ${message}`;
}

function sizeMessage(args: ApiErrorArgs): string {
    const min = typeof args['min'] === 'number' ? args['min'] : 0;
    const max = args['max'];
    if (typeof max === 'number' && min > 0) return `La lunghezza deve essere compresa tra ${min} e ${max}`;
    if (typeof max === 'number') return `La lunghezza massima è ${max}`;
    return `La lunghezza minima è ${min}`;
}
