# Standard degli errori applicativi

## Stato del documento

ID catalogo: `application-errors-standard`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

Documenti collegati: [Taurus Layout Standard](taurus-layout-standard.md), che stabilisce canali e forma di toast, banner ed errori di campo; [Foglio di affidamento](inventory-loan-sheet-spec.md), l'ambito con più errori che dipendono da dati del caso.

## Obiettivo

Taurus ha un'unica linea guida per gli errori che il backend restituisce al frontend. La linea guida stabilisce:

- che cosa contiene la risposta d'errore, e che cosa non deve mai contenere;
- come si nomina la chiave che identifica l'errore;
- quale stato HTTP usare;
- come il frontend costruisce il messaggio e sceglie il comportamento;
- dove si trova il significato di ogni chiave.

Il [catalogo delle chiavi](#catalogo-delle-chiavi) spiega, per ogni chiave, quando si verifica, con quali parametri e quale messaggio mostra il frontend. Una segnalazione arrivata da un utente, da un log o da un test si interpreta cercando la chiave in questo documento.

## Situazione prima dell'adozione

Censimento eseguito sul codice di `taurus-be` e `taurus-fe` il 2026-10-10, rivisto il 2026-10-11, prima dell'adozione di questo standard.

Il backend lancia gli errori applicativi con `RequestAlertException`, direttamente o tramite metodi di supporto dei servizi (`error`, `notFound`, `badRequest`, `conflict`, `problem`). Le chiavi distinte sono 242, più quattro famiglie generate da codici: `tenantFeature.{funzionalità}.disabled`, `inventory.loanSheet.{codice}`, `inventory.loanDuration.{codice}` e `inventory.renewal.{codice}`.

Ogni `RequestAlertException` porta un titolo, scritto per l'utente in alcune aree e per lo sviluppatore in altre. Il frontend mostra il titolo del backend solo per le chiavi dei fogli di affidamento; per le altre usa un `switch` di testi propri, che copre 65 chiavi, oppure un testo generico per stato.

### Difetti rilevati

1. **La risposta espone dettagli interni.**
   - `detail` contiene il messaggio dell'eccezione, anche in produzione, salvo che citi un nome di package.
   - I titoli degli errori Keycloak contengono il messaggio di `HttpClientErrorException`, cioè la risposta grezza di Keycloak.
   - `recurrence.invalid` usa come titolo il messaggio interno del generatore delle ricorrenze; l'esito di verifica `syntax` del modello del foglio riporta il messaggio della libreria Mustache.
   - `params` contiene il nome interno dell'entità; `fieldErrors` contiene il nome del DTO e il messaggio predefinito di Bean Validation; `type` rivela il framework.
2. **Non tutti gli errori hanno una chiave.** I 401 per token assente o scaduto e i 403 decisi dalle regole sugli URL di `SecurityConfiguration` sono prodotti dalla catena di sicurezza di Spring, non da `ExceptionTranslator`: arrivano senza corpo.
3. **Il messaggio dipende dallo stato, non dal caso.** Ogni 409 non riconosciuto diventa «Dati modificati – Ricarica la pagina e riprova», anche per `inventory.quantity.unavailable` o `finance.category.nameExists`, che non hanno a che fare con una modifica concorrente.
4. **Lo stato rivela l'esistenza di risorse altrui.** Sugli endpoint del socio, `inventory.photo.forbidden`, `inventory.assignment.forbidden` e `inventory.return.forbidden` rispondono 403, mentre una risorsa inesistente risponde 404: il socio distingue «esiste ma non è mio» da «non esiste».
5. **Una chiave, più messaggi.** `inventory.notFound` copre sei entità, `inventory.loanSheet.invalidState` quattro situazioni, `invalid` nove condizioni della preparazione evento, `status.conflict` quattro condizioni dell'onboarding; `calendarFeed.limit` segnala anche due conflitti di idempotenza.
6. **Stessa condizione, chiavi diverse.** L'identità mancante nel token ha sette chiavi, il tenant mancante cinque, con stati 400, 401 e 403.
7. **Un 401 applicativo non produce messaggi.** L'interceptor tratta ogni 401 come token scaduto: rinnova il token e ripete la richiesta, anche quando il token è valido ma privo dell'identità. `credentials.error` restituisce 401 quando Keycloak rifiuta le credenziali di servizio di Taurus, che è un errore di configurazione del server.
8. **Errore mostrato due volte.** Diversi componenti mostrano un proprio toast nel callback di errore della chiamata (profilo, documenti legali, dettaglio evento, dettaglio brano), che si somma a quello dell'interceptor. Il dettaglio inventario mostra la scadenza non valida sotto il campo e l'interceptor la ripete in un toast.
9. **Nessun riferimento per la diagnosi.** La risposta non contiene un identificativo che permetta di ritrovare l'errore nei log.

## Fuori scope

- traduzione in altre lingue: Taurus è un'applicazione solo italiana, ma la scelta di costruire i testi nel frontend la rende possibile;
- validazione dei moduli lato client, già regolata dal [Taurus Layout Standard](taurus-layout-standard.md);
- notifiche interne, il cui testo resta composto dal backend secondo lo [Stile editoriale delle notifiche interne](notification-editorial-style.md): non sono errori;
- report di validazione dell'onboarding, che restituisce esiti per riga come dati: sarà oggetto di un intervento separato;
- risorse consumate fuori dal frontend, come il feed iCal letto dai client di calendario;
- temi e autenticatore Keycloak (`keycloak-authenticator`).

## Principi

1. **Il backend identifica, il frontend spiega.** Ogni risposta d'errore contiene una chiave che identifica il caso. Il backend non invia mai testi per l'utente: il frontend costruisce titolo e dettaglio del toast, e i messaggi sotto i campi, a partire dalla chiave.
2. **Nessun dettaglio tecnico nella risposta.** Messaggi di eccezione, nomi di classi ed entità, risposte di sistemi esterni e stack trace restano nei log. Un attaccante legge la risposta HTTP, non il toast: la protezione si ottiene nel backend.
3. **Dati di dominio come parametri strutturati.** Quando il messaggio serve solo se contiene un dato del caso (date ammesse, numero del foglio, nome dell'oggetto, limiti), il backend lo invia come parametro tipizzato, da un elenco chiuso per chiave. Mai testo libero.
4. **Una chiave, un messaggio.** Ogni chiave produce un solo messaggio, eventualmente completato dai parametri. Due condizioni con messaggi diversi hanno chiavi diverse.
5. **Le chiavi non rivelano dati altrui.** Sugli endpoint del socio, una risorsa di un altro utente risponde come una risorsa inesistente.
6. **Lo stato HTTP classifica l'errore.** Ogni stato ha un significato fisso, da cui il frontend deriva il comportamento predefinito.
7. **Un errore, un canale.** Un errore compare una sola volta: come toast oppure accanto al campo, mai in entrambi.
8. **Ogni errore è rintracciabile.** La risposta porta un identificativo opaco che compare anche nella riga di log.

## Contratto della risposta

Gli errori seguono il formato Problem Details (RFC 9457) e contengono soltanto questi campi:

| Campo | Contenuto |
| --- | --- |
| `type` | Sempre `about:blank` |
| `title` | Descrizione standard dello stato HTTP, per esempio `Unprocessable Entity`. Il frontend la ignora |
| `status` | Stato HTTP |
| `message` | `error.` seguito dalla chiave |
| `args` | Parametri della chiave, solo se il catalogo ne prevede; altrimenti assente |
| `fieldErrors` | Solo per `error.validation`: per ogni campo, nome, codice del vincolo e parametri del vincolo |
| `errorId` | Identificativo dell'errore: 12 caratteri alfanumerici casuali, scritto anche nella riga di log |

Esempio di errore applicativo:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "status": 422,
  "message": "error.inventory.loanDuration.expirationOutOfRange",
  "args": {
    "minimum": "2026-11-10",
    "maximum": "2027-11-10",
    "minMonths": 1,
    "maxMonths": 12,
    "deliveredOn": "2026-10-10"
  },
  "errorId": "K7Q2M9XD4TPA"
}
```

Esempio di errore di validazione:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "message": "error.validation",
  "fieldErrors": [{ "field": "accessories", "code": "Size", "args": { "max": 500 } }],
  "errorId": "3HF8W0QZ1CNE"
}
```

Spariscono dalla risposta `detail`, `params`, `path` e `cause`; dai `fieldErrors` spariscono il nome dell'oggetto e il messaggio predefinito. Il contratto vale in tutti i profili: in sviluppo i dettagli si leggono nei log.

### Parametri

- I nomi sono in camelCase inglese: `minimum`, `sheetNumber`, `itemName`.
- I tipi ammessi sono: data ISO `yyyy-MM-dd`, intero, stringa, booleano, elenco di valori, elenco di oggetti con `code` e `args`.
- Una stringa contiene soltanto un dato che il chiamante può già vedere tramite le API: nome dell'oggetto, numero inventariale, numero del foglio, nome di una variabile del modello caricato dall'amministratore.
- Mai: messaggi di eccezione, identificativi tecnici diversi da quelli già usati nella richiesta, dati di altri utenti.
- I limiti citati dal messaggio (dimensione massima di un file, numero massimo di fotografie) arrivano come parametri anche quando sono costanti del backend, così il frontend non li duplica.

### Chiavi generiche

Gli errori che non nascono da `RequestAlertException` ricevono comunque una chiave, scritta nel campo `message` con il prefisso `error.`:

| Chiave | Quando si verifica |
| --- | --- |
| `auth.unauthenticated` | La catena di sicurezza rifiuta la richiesta: token assente, scaduto o non valido |
| `auth.forbidden` | Accesso negato da una regola sugli URL o dalla sicurezza dei metodi |
| `validation` | Il corpo della richiesta non supera `@Valid` |
| `concurrencyFailure` | Conflitto di concorrenza rilevato dal livello dati |
| `http.{stato}` | Ogni altra eccezione: percorso inesistente, metodo non ammesso, corpo illeggibile, file oltre il limite multipart, errore imprevisto |

## Regole per il backend

### `RequestAlertException`

- Il costruttore riceve stato, descrizione per i log, nome dell'entità e chiave: `new RequestAlertException(HttpStatus.CONFLICT, "Quantità disponibile insufficiente", ENTITY, "inventory.quantity.unavailable")`. Descrizione e nome dell'entità finiscono soltanto nel log: possono contenere dettagli tecnici e non vengono mai serializzati.
- I parametri si aggiungono con `.with("available", available)`, oppure con `.with(ErrorArgs)` per un insieme già pronto, come i parametri di una violazione delle regole di durata.
- `ErrorArgs` accetta solo i tipi ammessi, converte le date nel formato ISO e rifiuta ogni altro tipo con un'eccezione, così un dettaglio tecnico non può finire nella risposta per errore.
- La chiave è un letterale nel punto di lancio, o in un metodo di supporto del servizio, perché la verifica automatica possa trovarla. Fanno eccezione le chiavi composte dai codici degli enum di `LoanDurationPolicy` e di `TenantFeature`.

### `ExceptionTranslator`

- Produce la risposta del [contratto](#contratto-della-risposta) per ogni eccezione, in tutti i profili, comprese le eccezioni di Spring MVC gestite da `ResponseEntityExceptionHandler`.
- Delega la costruzione a `ApiErrorResponses`, che genera l'`errorId` e lo scrive nella riga di log `error_response`, insieme a stato, chiave e descrizione: in `WARN` per gli errori 4xx, in `ERROR` con lo stack trace per i 5xx.
- Per le eccezioni non applicative usa le [chiavi generiche](#chiavi-generiche).
- Non aggiunge più le intestazioni `X-…-error` e `X-…-params`, che ripetevano chiave e nome dell'entità.

### Catena di sicurezza

`SecurityProblemSupport` è insieme `AuthenticationEntryPoint` e `AccessDeniedHandler` e scrive la stessa risposta, costruita da `ApiErrorResponses`, con `auth.unauthenticated` (401, mantenendo l'intestazione `WWW-Authenticate` del token bearer) e `auth.forbidden` (403). `SecurityConfiguration` lo registra per il resource server e per i percorsi `/api/**`; le altre pagine mantengono il reindirizzamento al login.

### La chiave

- Formato `{area}.{oggetto}.{condizione}`, in camelCase, con l'oggetto omesso quando coincide con l'area: `inventory.photo.tooLarge`, `onboarding.disabled`.
- L'area è obbligatoria. Le aree sono: `auth`, `calendar`, `calendarFeed`, `eventPreparation`, `finance`, `guidedTour`, `image`, `inventory`, `keycloak`, `legal`, `media`, `notice`, `notification`, `onboarding`, `preferences`, `scorePlayback`, `signature`, `tenant`, `tenantFeature`, `track`, `user`.
- Fanno eccezione le chiavi trasversali dei servizi CRUD comuni: `id.notFound`, `id.exists`, `id.invalid`, `id.null` e `version.conflict`.
- Una chiave produce un solo messaggio e ha un solo stato HTTP. La stessa condizione usa la stessa chiave in tutti i punti in cui si verifica.
- Le nuove chiavi usano un vocabolario chiuso per la condizione. Le chiavi esistenti già conformi ad area e significato restano invariate: si rinominano solo per i motivi elencati in [Corrispondenza con le chiavi precedenti](#corrispondenza-con-le-chiavi-precedenti).

| Condizione | Significato |
| --- | --- |
| `notFound` | La risorsa non esiste o non è visibile al chiamante |
| `exists`, `nameExists` | Esiste già una risorsa con lo stesso codice o nome |
| `required` | Manca un dato obbligatorio |
| `invalid` | Un dato ha un valore non ammesso |
| `tooLarge`, `unsupported` | File troppo grande o formato non supportato |
| `limit` | Raggiunto un numero massimo |
| `closed`, `locked`, `immutable` | Lo stato della risorsa non ammette l'operazione |
| `forbidden` | L'operazione richiede un ruolo che il chiamante non ha |
| `disabled` | La funzione è disattivata |
| `versionConflict` | Modifica concorrente |
| `{azione}Failed` | Un'operazione tecnica non è riuscita: lettura, scrittura, generazione, chiamata a un sistema esterno |

- Le chiavi composte da codici, come `inventory.renewal.{codice}`, nascono da un enum Java; ogni valore è una chiave del catalogo.
- Una chiave è stabile. Rinominarla significa aggiornare nello stesso intervento backend, frontend, test e catalogo.

### Lo stato HTTP

| Stato | Significato in Taurus | Esempi |
| --- | --- | --- |
| 400 | Richiesta incompleta o malformata: dato obbligatorio mancante, formato errato, parametro tecnico fuori dominio | `finance.transfer.sameAccount`, `inventory.photo.invalid` |
| 401 | Solo autenticazione: token assente, scaduto o privo dell'identità dell'utente | `auth.unauthenticated`, `auth.identity.missing` |
| 403 | Ruolo insufficiente, funzionalità del tenant disattivata, utente senza tenant o non attivo. Mai per una risorsa di un altro utente sugli endpoint del socio | `auth.forbidden`, `tenantFeature.inventory.disabled` |
| 404 | Risorsa inesistente, eliminata o non visibile al chiamante, compresa la risorsa di un altro utente sugli endpoint del socio; anche una funzione disattivata nella configurazione dell'applicazione | `inventory.photo.notFound`, `inventory.qr.disabled` |
| 405 | Operazione non disponibile per quella risorsa | `media.managedOnly` |
| 409 | Conflitto con lo stato attuale: risorsa già chiusa o già esistente, quantità non disponibile, modifica concorrente | `inventory.return.closed`, `version.conflict` |
| 410 | Risorsa esistita ma non più disponibile | `inventory.loanSheet.purged` |
| 413, 415 | File troppo grande o formato non supportato | `finance.attachment.tooLarge` |
| 422 | Dati formalmente corretti che violano una regola di dominio | `inventory.loanDuration.expirationOutOfRange` |
| 500 | Errore interno o di generazione | `finance.report.generationFailed` |
| 502 | Un sistema esterno ha rifiutato o non ha completato la richiesta | `keycloak.user.createFailed` |

Una modifica concorrente usa `version.conflict` o una chiave che termina con `.versionConflict`: è l'unico 409 per cui il frontend propone di ricaricare.

### Esiti restituiti come dati

Due risposte senza errore riportano problemi da mostrare all'utente, con gli stessi casi degli errori:

- la verifica del modello del foglio (`CheckResult.issues`), che elenca gli [esiti della verifica](#esiti-della-verifica-del-modello);
- l'anteprima di emissione del foglio (`InventoryLoanSheetDtos.Issue`), che elenca i problemi di durata per ogni assegnazione con i codici `inventory.loanDuration.*`.

Seguono la stessa regola degli errori: ogni problema ha `code` e `args`, senza testo. Il frontend usa lo stesso catalogo dei messaggi.

## Regole per il frontend

### Catalogo dei messaggi

`constants/api-error-messages.ts` associa a ogni chiave il messaggio: un testo fisso o una funzione che riceve i parametri. Le date si mostrano nel formato `dd/MM/yyyy`.

```ts
export const API_ERROR_MESSAGES: Record<string, ApiErrorMessage> = {
    'inventory.quantity.unavailable': (args) => `Quantità disponibile insufficiente: disponibili ${args['available']}`,
    'inventory.loanDuration.expirationOutOfRange': (args) =>
        `La data di scadenza deve essere compresa tra il ${date(args['minimum'])} e il ${date(args['maximum'])}, ` +
        `cioè tra ${args['minMonths']} e ${args['maxMonths']} mesi dalla consegna del ${date(args['deliveredOn'])}`,
    // ...
};
```

Il catalogo dei messaggi è l'unica fonte dei testi. I messaggi:

- sono in italiano e rivolti all'utente finale;
- dicono cosa è successo e, se l'utente può rimediare, come;
- usano l'infinito per le indicazioni operative: «ricaricare la pagina», «indicare l'importo»;
- non terminano con il punto;
- non citano termini tecnici (ID, token, claim, idempotenza).

I codici dei vincoli di validazione (`NotNull`, `NotBlank`, `Size`, `Min`, `Max`, `Email`, `Pattern`, `Positive`) hanno messaggi generici nello stesso catalogo, con chiavi `validation.{codice}` e i parametri del vincolo. Un codice di vincolo, di regola di durata o di esito del modello non ancora catalogato produce un testo generico del suo ambito, mai un testo del backend.

### Un solo punto di risoluzione

`ApiErrorService` traduce `HttpErrorResponse` in un errore risolto: chiave, stato, parametri, `errorId`, titolo, dettaglio e comportamento. L'interceptor lo usa per ogni risposta in errore; non esiste più uno `switch` di testi nell'interceptor.

La risoluzione segue quest'ordine:

1. **Rete assente** (stato 0): messaggio di connessione.
2. **Chiave con un comportamento registrato**: si applica il comportamento (vedi [Registro dei comportamenti](#registro-dei-comportamenti)).
3. **Chiave nel catalogo dei messaggi**: toast con il titolo del contesto e il messaggio del catalogo.
4. **Chiave assente dal catalogo**: testo generico per stato; in sviluppo un avviso in console.

Per gli errori 5xx e 502, e per le chiavi assenti dal catalogo, il dettaglio termina con «Codice errore: {errorId}»: è il riferimento che l'utente comunica a chi gestisce l'applicazione. Per gli altri errori l'`errorId` resta disponibile nell'errore risolto.

### Testi generici

| Caso | Titolo del toast | Dettaglio |
| --- | --- | --- |
| Stato 0 | Connessione non disponibile | Il server non è raggiungibile: verificare la connessione e riprovare |
| `http.404` | Elemento non trovato | L'elemento richiesto non esiste più o non è accessibile |
| `http.413` | File troppo grande | Il file supera la dimensione massima consentita |
| `http.500` e altri 5xx | Servizio temporaneamente non disponibile | Si è verificato un problema sul server: riprovare tra qualche minuto |
| Altri | Richiesta non riuscita | Non è stato possibile completare l'operazione |

### Titolo del toast

Il Layout Standard chiede che il titolo dica l'esito, non la categoria. Il chiamante lo dichiara nel contesto della richiesta con un `HttpContextToken` (`ERROR_SUMMARY`):

```ts
this.inventoryService.createAssignment(request, withErrorSummary('Assegnazione non riuscita'));
```

Senza un titolo dichiarato si usa «Operazione non riuscita»; per una chiave `*.notFound` «Elemento non trovato».

I componenti non mostrano un proprio toast per un errore HTTP: il titolo specifico si dichiara con `withErrorSummary`.

### Errori mostrati dal componente

Un componente che mostra l'errore accanto al campo dichiara le chiavi che gestisce con un secondo `HttpContextToken` (`HANDLED_ERRORS`, con `withHandledErrors`). Per quelle chiavi l'interceptor non mostra il toast, e il componente chiede il testo ad `ApiErrorService` e lo mostra sotto il campo.

Lo usano la scadenza dell'assegnazione nel dettaglio inventario, con le chiavi `inventory.loanDuration.*` e i codici di scadenza di `inventory.loanSheet.*`, i dialoghi della firma elettronica per i codici di conferma, i dati del firmatario e il documento firmato con CieSign, e il pannello Strumenti da aggiungere della traccia, che per `version.conflict`, `instrument.name.exists` e `instrumentSuggestion.notOpen` mostra il messaggio nel pannello e rilegge i nomi.

### Registro dei comportamenti

`constants/api-error-behaviors.ts` elenca le chiavi che richiedono qualcosa oltre al toast:

| Chiave | Comportamento |
| --- | --- |
| `auth.unauthenticated` | Nessun toast: rinnovo del token e ripetizione della richiesta; se il rinnovo fallisce, «Sessione scaduta: accedere di nuovo» e uscita dalla sessione |
| `auth.identity.missing`, `auth.user.inactive` | Toast, poi uscita dalla sessione: il rinnovo del token non risolve |
| `auth.forbidden` | Toast e pagina `forbidden` |
| `tenant.notProvisioned` | Nessun toast; invalida lo stato del tenant e torna alla radice, dove la guardia apre la configurazione iniziale |
| `tenantFeature.{funzionalità}.disabled` | Toast; aggiorna le funzionalità del tenant e torna alla radice |
| `version.conflict`, `*.versionConflict`, `concurrencyFailure` | Toast con titolo «Dati modificati» |
| `id.notFound` su una richiesta `GET` | Pagina `notfound`; su un salvataggio resta il toast |

Ogni altro 403 produce un toast senza lasciare la pagina.

## Alternative scartate

- **Testi scritti dal backend.** Era l'impostazione della prima versione di questo documento. Obbliga il backend a inviare testo libero, dove prima o poi finiscono dettagli interni, come già accade per Keycloak e per le ricorrenze; mescola testi in due lingue; rende impossibile una traduzione futura.
- **Enum Java per tutte le chiavi.** Richiederebbe di riscrivere tutti i punti di lancio senza aggiungere garanzie rispetto alla verifica automatica. L'enum resta per le sole chiavi composte da codici.
- **Categoria dell'errore nella risposta.** Stato e chiave bastano a scegliere il comportamento; un campo in più andrebbe mantenuto coerente con entrambi.

## Verifica automatica del catalogo

Lo script `scripts/docs/check-error-catalog.mjs` confronta quattro insiemi:

1. le chiavi del backend: letterali passati come chiave a `RequestAlertException` o ai metodi di supporto che la restituiscono, più i valori degli enum delle chiavi composte e dei codici degli esiti della verifica del modello;
2. le chiavi e i codici di questo documento, letti dalla prima colonna delle tabelle del catalogo;
3. le chiavi di `api-error-messages.ts`;
4. le chiavi di `api-error-behaviors.ts`.

Fallisce se una chiave del backend manca dal catalogo o dai messaggi del frontend, se il catalogo o il frontend riportano una chiave non più lanciata, o se i parametri usati da un messaggio non sono quelli del catalogo.

Lo script si esegue nel job documentazione di `verify.yml`, accanto alla validazione del catalogo funzionalità, con i test in `scripts/docs/error-catalog.test.mjs`. Un controllo bloccante è necessario: senza, una chiave nuova arriverebbe all'utente come testo generico.

## Componenti dell'adozione

Togliere i titoli dalla risposta e costruire i messaggi nel frontend sono due facce della stessa modifica, rilasciate insieme. Backend e frontend vivono nello stesso repository e il frontend è l'unico consumatore delle chiavi, quindi non servono periodi di compatibilità. L'adozione comprende tre blocchi.

### Backend

- `RequestAlertException` con chiave, parametri e descrizione per i log; `ErrorArgs`.
- `ExceptionTranslator` con la risposta minima, l'`errorId` e il log.
- `AuthenticationEntryPoint` e `AccessDeniedHandler` della catena di sicurezza.
- Rinomine e scomposizioni della [corrispondenza](#corrispondenza-con-le-chiavi-precedenti), con i parametri del catalogo.
- 404 al posto di 403 per le risorse di altri utenti sugli endpoint del socio.
- Keycloak: stato 502, nessun messaggio di Keycloak nella risposta.
- Esiti della verifica del modello e dell'anteprima di emissione con `code` e `args`.

### Frontend

- `ApiErrorService`, catalogo dei messaggi, registro dei comportamenti, `ERROR_SUMMARY` e `HANDLED_ERRORS`.
- Rimozione del `switch` dell'interceptor, della lettura del `title` e dei toast di errore duplicati nei componenti.
- Messaggi degli esiti di verifica del modello e dell'anteprima di emissione dal catalogo.

### Verifica

Script di verifica del catalogo, suoi test e inserimento nella CI.

## Test

Backend:

- `ExceptionTranslatorIT`: la risposta contiene solo i campi del contratto, in ogni profilo; nessun `detail`, `params` o `path`; `errorId` presente e scritto nel log; parametri serializzati nei tipi ammessi;
- un test della catena di sicurezza: richiesta senza token con `auth.unauthenticated`, ruolo insufficiente con `auth.forbidden`;
- per ogni servizio toccato, i test esistenti verificano chiave, stato e parametri dei casi d'errore;
- endpoint del socio: una risorsa di un altro socio risponde 404 con la stessa chiave di una risorsa inesistente;
- `KeycloakServiceImpl`: un rifiuto delle credenziali di servizio produce 502 senza il messaggio di Keycloak.

Frontend, in `api-error.service.spec.ts`:

- rete assente; `auth.unauthenticated` con rinnovo; `auth.identity.missing` con uscita dalla sessione;
- `auth.forbidden` con pagina `forbidden`; altro 403 con toast e senza navigazione;
- messaggio con parametri, per esempio l'intervallo di scadenza; date nel formato `dd/MM/yyyy`;
- chiave assente dal catalogo: testo generico con `errorId`; errore 5xx con `errorId`;
- 409 di concorrenza con titolo «Dati modificati»; 409 di regola con il titolo del contesto;
- titolo dichiarato con `ERROR_SUMMARY`; chiave in `HANDLED_ERRORS` senza toast;
- il `title` della risposta non compare mai nel toast.

Script: `node --test scripts/docs/error-catalog.test.mjs` con chiave mancante dal catalogo, chiave mancante dai messaggi, chiave obsoleta e parametro non previsto.

## Corrispondenza con le chiavi precedenti

Il catalogo riporta le chiavi di questo standard. Le chiavi precedenti all'adozione che sono cambiate sono elencate qui: una chiave letta in un log precedente all'adozione si cerca in questa tabella. Le chiavi non elencate sono rimaste invariate.

### Sessione, tenant e utenti

| Chiave precedente | Nuova chiave | Motivo |
| --- | --- | --- |
| 401 e 403 della catena di sicurezza, senza corpo | `auth.unauthenticated`, `auth.forbidden` | Chiave sempre presente |
| `http.403` per accesso negato | `auth.forbidden` | Chiave dedicata |
| `identity.missing`, `finance.identity.missing`, `inventory.identity.missing`, `subject.missing`, `notification.delivery.user.missing`, `legal.token.claim.missing` e `dashboard.token.claim.missing` per l'utente | `auth.identity.missing` | Stessa condizione |
| `tenant.missing`, `inventory.tenant.missing`, `finance.tenant.missing`, `tenantFeature.tenant.invalid`, `legal.token.claim.missing` e `dashboard.token.claim.missing` per il tenant, `tenant.notFound` in `UsersServiceImpl`, `tenant.inactive` dell'onboarding | `auth.tenant.missing` (403) | Stessa condizione |
| `tenant.schemaInactive` | `tenant.notProvisioned` | Stessa condizione |
| `tenant.mismatch` | `auth.tenant.mismatch` | Area |
| `user.notFound` | `auth.user.inactive` (403) | Stessa condizione |
| `id.notfound` | `id.notFound` | Duplicato |
| `not.allow` | `user.role.forbidden` | Area |
| `code.exists` | `tenant.code.exists` (409) | Area e stato |
| `save.tenant.schema` | `tenant.schema.provisioningFailed` | Area |
| `timeZone.invalid` del tenant | `tenant.timeZone.invalid` | Area |

### Servizio di accesso (Keycloak)

Tutte passano a 502, tranne `conflict.error`.

| Chiave precedente | Nuova chiave |
| --- | --- |
| `users.list` | `keycloak.users.readFailed` |
| `get.users` | `keycloak.roleUsers.readFailed` |
| `get.user` | `keycloak.user.readFailed` |
| `save.user` | `keycloak.user.createFailed` |
| `update.user` | `keycloak.user.updateFailed` |
| `delete.user` | `keycloak.user.deleteFailed` |
| `update.user.group` | `keycloak.userGroup.updateFailed` |
| `get.user.groups` | `keycloak.userGroups.readFailed` |
| `delete.user.group` | `keycloak.userGroup.deleteFailed` |
| `save.group` | `keycloak.group.createFailed` |
| `get.group` | `keycloak.group.readFailed` |
| `delete.group` | `keycloak.group.deleteFailed` |
| `get.user.roles` | `keycloak.userRoles.readFailed` |
| `save.user.roles` | `keycloak.userRoles.assignFailed` |
| `delete.user.roles` | `keycloak.userRoles.removeFailed` |
| `get.client`, `get.client.roles`, `role.provision` | `keycloak.configuration.incomplete` |
| `send.user.reset.password` | `keycloak.email.resetPasswordFailed` |
| `send.user.verify.email` | `keycloak.email.verifyAddressFailed` |
| `send.user.execute.actions.email` | `keycloak.email.setupFailed` |
| `token.error`, `token.invalid`, `credentials.error` | `keycloak.authorizationFailed` |
| `conflict.error` | `keycloak.conflict` (409) |
| `generic.error` | `keycloak.requestFailed` |

### Inventario e fogli di affidamento

| Chiave precedente | Nuova chiave | Motivo |
| --- | --- | --- |
| `inventory.notFound` per oggetto, etichette e QR code PNG; `inventory.loanSheet.notFound` per l'oggetto della sostituzione | `inventory.item.notFound` | Un messaggio per chiave |
| `inventory.notFound` per assegnazione; `inventory.assignment.forbidden`; `inventory.loanSheet.notFound` per assegnazione | `inventory.assignment.notFound` | Un messaggio per chiave; risorsa altrui |
| `inventory.notFound` per riconsegna; `inventory.return.forbidden` | `inventory.return.notFound` | Un messaggio per chiave; risorsa altrui |
| `inventory.notFound` per fotografia e fotografia di riconsegna; `inventory.photo.forbidden` | `inventory.photo.notFound` | Un messaggio per chiave; risorsa altrui |
| `inventory.loanSheet.notFound` per utente; `inventory.user.notFound` (400) | `inventory.user.notFound` (404) | Un messaggio per chiave; stato |
| `inventory.photo.invalid` per normalizzazione non riuscita | `inventory.photo.processingFailed` (500) | Un messaggio per chiave |
| `inventory.issue.photo.invalid` per normalizzazione non riuscita | `inventory.issue.photo.processingFailed` (500) | Un messaggio per chiave |
| `inventory.return.quantityInvalid` alla richiesta | `inventory.return.quantityExceeded` | Un messaggio per chiave |
| `inventory.issue.quantity` | `inventory.issue.quantityExceeded` | Parametro al posto di due testi |
| `inventory.issue.version` | `inventory.issue.versionConflict` | Concorrenza |
| `inventory.revision.stale` | `inventory.revision.versionConflict` | Concorrenza |
| `inventory.revision.serialization` | `inventory.revision.createFailed` | Vocabolario |
| `inventory.labels.limit` | `inventory.labels.singleLimit`, `inventory.labels.sheetLimit` | Un messaggio per chiave |
| `inventory.loanSheet.invalidState` per la definizione | `inventory.loanSheet.notClosed` | Un messaggio per chiave |
| `inventory.loanSheet.invalidState` negli altri casi | `inventory.loanSheet.notIssued` | Un messaggio per chiave |
| `inventory.renewal.limitExceeded` | `inventory.renewal.renewalLimitExceeded`, `inventory.renewal.totalLimitExceeded` | Un messaggio per chiave |

### Altre aree

| Chiave precedente | Nuova chiave |
| --- | --- |
| `invalid`: traccia del programma inesistente | `eventPreparation.track.notFound` |
| `invalid`: oggetto inventario inesistente | `eventPreparation.item.notFound` |
| `invalid`: assegnazione inesistente | `eventPreparation.assignment.notFound` |
| `invalid`: assegnazione di un altro oggetto | `eventPreparation.assignment.itemMismatch` |
| `invalid`: materiale inesistente | `eventPreparation.material.notFound` |
| `invalid`: movimenti economici presenti | `eventPreparation.movements.exists` |
| `invalid`: spartiti senza programma | `eventPreparation.program.required` |
| `invalid`: partecipanti minimi mancanti | `eventPreparation.participants.required` |
| `invalid`: preparazione non configurata | `eventPreparation.notConfigured` |
| `notFound` | `eventPreparation.event.notFound` |
| `concurrentModification` | `eventPreparation.versionConflict` |
| `request.invalid`, `template.invalid`, `duration.invalid`, `recurrence.invalid`, `sourceOccurrence.invalid`, `occurrence.notFound` | Stesso nome con prefisso `calendar.series.` |
| `reminder.invalid` della serie, dell'evento e delle preferenze | `calendar.series.reminder.invalid`, `calendar.reminder.invalid`, `preferences.reminder.invalid` |
| `reminder.availabilityMissing` | `calendar.reminder.availabilityMissing` |
| `calendarFeed.limit` per chiave di idempotenza già usata | `calendarFeed.idempotency.conflict` |
| `calendarFeed.limit` per risposta idempotente non più attuale | `calendarFeed.idempotency.stale` |
| `quietHours.invalid`, `digest.quietHours`, `pushPause.invalid`, `categories.incomplete`, `categories.invalid`, `timeZone.invalid` delle preferenze | Stesso nome con prefisso `preferences.` |
| `snooze.invalid`, `snooze.read` | Stesso nome con prefisso `notice.` |
| `file.empty` dei brani | `track.file.empty` |
| annotazioni illeggibili all'upload | `track.annotations.invalid` |
| `file.unsupported` | `track.upload.unsupported` |
| `file.upload` | `track.upload.failed` (500) |
| `media.required` | `track.upload.mediaRequired` |
| `media.notFound` | `track.upload.mediaNotFound` |
| `queue.error` | `track.queue.failed` |
| `upload.notFound` | `track.upload.notFound` |
| `upload.notRetryable` per elaborazione non fallita | `track.upload.notRetryable` |
| `upload.notRetryable` per stato cambiato | `track.upload.versionConflict` |
| `score.id.exists` | `id.exists` |
| `score.id.invalid` | `track.score.notFound` |
| `category.invalid` | `media.category.invalid` |
| `file.empty` dei media | `media.file.empty` |
| `file.store` | `media.file.storeFailed` |
| `disabled` | `onboarding.disabled` |
| `id.notFound` dell'onboarding | `onboarding.job.notFound` |
| `file.required`, `file.tooLarge`, `csvSection.required`, `selectedSections.required`, `section.featureDisabled`, `idempotency.conflict`, `warnings.notAccepted`, `email.retryNotAllowed`, `tenant.busy` dell'onboarding | Stesso nome con prefisso `onboarding.` |
| `file.read` | `onboarding.file.unreadable` |
| `status.conflict`: applicazione di un'importazione non pronta | `onboarding.job.notReady` |
| `status.conflict`: annullamento non ammesso | `onboarding.job.notCancellable` |
| `status.conflict`: validazione non ripetibile | `onboarding.job.validationNotRetryable` |
| `status.conflict`: ripristino non richiesto | `onboarding.job.compensationNotRequired` |

## Catalogo delle chiavi

Le chiavi sono riportate senza il prefisso `error.` che il backend aggiunge nel campo `message`. Nella colonna «Messaggio» i segnaposto tra graffe sono i parametri, formattati dal frontend. Per gli errori 5xx e 502 il frontend aggiunge al messaggio il codice errore.

### Chiavi generiche e trasversali

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `validation` | 400 | Il corpo della richiesta non supera `@Valid`; il dettaglio per campo è in `fieldErrors` | — | «Alcuni dati non sono validi: controllare i campi evidenziati» |
| `concurrencyFailure` | 409 | Conflitto di concorrenza rilevato dal livello dati | — | «I dati sono cambiati nel frattempo: ricaricare la pagina e riprovare» |
| `http.{stato}` | Lo stato | Errore senza chiave applicativa: percorso inesistente, metodo non ammesso, corpo illeggibile, file oltre il limite multipart, errore imprevisto | — | [Testo generico](#testi-generici) per stato |
| `id.notFound` | 404 | L'elemento richiesto non esiste o è stato eliminato. Servizi CRUD comuni: album, brani, eventi, notifiche, utenti, tenant, media, serie ricorrenti | — | «L'elemento richiesto non esiste più o non è accessibile» |
| `id.exists` | 400 | Una richiesta di creazione contiene già un identificativo, anche per una parte generata di un brano: errore del client | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `id.invalid` | 400 | Nell'aggiornamento, l'identificativo del percorso è diverso da quello del corpo | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `id.null` | 400 | Aggiornamento senza identificativo nel corpo | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `version.conflict` | 409 | Un'altra richiesta ha modificato serie ricorrente, tenant o brano, anche durante la modifica di un'immagine | — | «L'elemento è stato modificato da un'altra richiesta: ricaricare la pagina» |

### Sessione e tenant

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `auth.unauthenticated` | 401 | Token assente, scaduto o non valido | — | Nessuno: il frontend rinnova la sessione; se non riesce, «Sessione scaduta: accedere di nuovo» |
| `auth.forbidden` | 403 | Il ruolo non consente l'endpoint | — | «Non si hanno i permessi necessari per questa operazione» |
| `auth.identity.missing` | 401 | Il token non contiene l'identificativo dell'utente | — | «Sessione non valida: accedere di nuovo» |
| `auth.tenant.missing` | 403 | Il token o il contesto non indicano un tenant, oppure il tenant è eliminato o non attivo | — | «L'utente non è associato a un tenant attivo» |
| `auth.tenant.mismatch` | 403 | Nella dashboard operativa il tenant del token è diverso da quello attivo della richiesta | — | «Il tenant della sessione non corrisponde a quello richiesto» |
| `auth.user.inactive` | 403 | L'utente autenticato non esiste in Taurus o non è attivo | — | «L'utente non è attivo in questo tenant» |
| `tenant.notProvisioned` | 409 | Il tenant della sessione non ha uno schema attivo: Taurus è in modalità primo accesso | — | Nessuno: il frontend apre la configurazione iniziale |
| `tenantFeature.finance.disabled` | 403 | La funzionalità Economia è disattivata per il tenant | — | «La funzionalità Economia non è disponibile per questo tenant» |
| `tenantFeature.inventory.disabled` | 403 | La funzionalità Inventario è disattivata | — | «La funzionalità Inventario non è disponibile per questo tenant» |
| `tenantFeature.onboardingImport.disabled` | 403 | La configurazione iniziale è disattivata | — | «La funzionalità Configurazione iniziale non è disponibile per questo tenant» |
| `tenantFeature.externalCalendarFeed.disabled` | 403 | Il feed calendario esterno è disattivato | — | «La funzionalità Feed calendario esterno non è disponibile per questo tenant» |
| `tenantFeature.inventoryQr.disabled` | 403 | I QR code dell'inventario sono disattivati | — | «La funzionalità QR code inventario non è disponibile per questo tenant» |
| `tenantFeature.notificationPreferences.disabled` | 403 | Le preferenze di notifica sono disattivate | — | «La funzionalità Preferenze notifiche non è disponibile per questo tenant» |
| `tenantFeature.webPushReminders.disabled` | 403 | I promemoria Web Push sono disattivati | — | «La funzionalità Promemoria eventi Web Push non è disponibile per questo tenant» |
| `tenantFeature.eventPreparation.disabled` | 403 | La preparazione evento è disattivata | — | «La funzionalità Preparazione evento non è disponibile per questo tenant» |
| `tenantFeature.scorePlayback.disabled` | 403 | L'ascolto e la correzione delle parti sono disattivati | — | «La funzionalità Ascolto delle parti non è disponibile per questo tenant» |
| `tenantFeature.inventoryLoanSheet.disabled` | 403 | I fogli di affidamento sono disattivati, direttamente o perché lo è l'Inventario | — | «La funzionalità Fogli di affidamento non è disponibile per questo tenant» |
| `tenantFeature.inventorySignature.disabled` | 403 | La firma elettronica è disattivata, direttamente o perché lo sono i Fogli di affidamento | — | «La funzionalità Firma elettronica non è disponibile per questo tenant» |
| `tenantFeature.calendar.disabled` | 403 | Il calendario è disattivato: eventi, serie, presenze, eventi del profilo e dell'utente, voci della dashboard ed economia degli eventi | — | «La funzionalità Calendario non è disponibile per questo tenant» |
| `tenantFeature.eventPayouts.disabled` | 403 | I compensi ai presenti sono disattivati, direttamente o perché lo sono l'Economia o il Calendario | — | «La funzionalità Compensi ai presenti non è disponibile per questo tenant» |
| `tenantFeature.scoreWriting.disabled` | 403 | La scrittura musicale è disattivata, direttamente, perché non è installata o perché lo è l'Ascolto delle parti: bozze e versioni scritte | — | «La funzionalità Scrittura musicale non è disponibile per questo tenant» |

### Utenti e tenant

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `user.limit.exceeded` | 400 | Creazione di un utente quando il tenant ha già raggiunto il numero massimo di utenti | `maximum` | «Raggiunto il numero massimo di utenti del tenant ({maximum})» |
| `user.role.forbidden` | 403 | Creazione o modifica di un utente con il ruolo di super amministratore, che non si assegna dall'applicazione | — | «Il ruolo di super amministratore non può essere assegnato» |
| `user.admin.forbidden` | 403 | Un membro del direttivo assegna il ruolo di amministratore, oppure crea, modifica, invita o elimina un amministratore o un super amministratore, anche collegando un account che lo è in un altro tenant ([Ruolo direttivo](board-role-spec.md)) | — | «Solo un amministratore può gestire gli amministratori» |
| `user.profile.locked` | 409 | Modifica di nome, cognome o e-mail di un utente il cui account di accesso appartiene anche ad altri tenant ([Account di accesso condiviso](shared-user-account-spec.md#profilo-di-un-account-condiviso)) | — | «Nome, cognome ed e-mail sono condivisi con altri tenant: può modificarli solo la persona dal proprio profilo» |
| `tenant.code.exists` | 409 | Creazione di un tenant con un codice già usato | — | «Codice tenant già utilizzato» |
| `tenant.schema.provisioningFailed` | 500 | Creazione di un tenant: la preparazione dello schema non è riuscita e il tenant viene rimosso | — | «Impossibile preparare il database del tenant: il tenant non è stato creato» |
| `tenant.timeZone.invalid` | 400 | Fuso orario del tenant non riconosciuto | — | «Fuso orario non valido» |

### Servizio di accesso (Keycloak)

Il messaggio di Keycloak e lo stato della sua risposta finiscono solo nel log.

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `keycloak.users.readFailed` | 502 | Lettura dell'elenco utenti | — | «Impossibile leggere l'elenco degli utenti dal servizio di accesso» |
| `keycloak.roleUsers.readFailed` | 502 | Lettura degli utenti con un ruolo del client | — | «Impossibile leggere gli utenti con il ruolo richiesto» |
| `keycloak.user.readFailed` | 502 | Lettura di un utente per identificativo, nome utente o e-mail | — | «Impossibile leggere l'utente dal servizio di accesso» |
| `keycloak.user.createFailed` | 502 | Creazione dell'utente | — | «Impossibile creare l'utente nel servizio di accesso» |
| `keycloak.user.updateFailed` | 502 | Aggiornamento dell'utente | — | «Impossibile aggiornare l'utente nel servizio di accesso» |
| `keycloak.user.deleteFailed` | 502 | Eliminazione dell'utente | — | «Impossibile eliminare l'utente dal servizio di accesso» |
| `keycloak.userGroup.updateFailed` | 502 | Associazione dell'utente al gruppo del tenant | — | «Impossibile associare l'utente al tenant» |
| `keycloak.userGroups.readFailed` | 502 | Lettura dei gruppi dell'utente | — | «Impossibile leggere i tenant dell'utente» |
| `keycloak.userGroup.deleteFailed` | 502 | Rimozione dell'utente dal gruppo del tenant | — | «Impossibile rimuovere l'utente dal tenant» |
| `keycloak.group.createFailed` | 502 | Creazione del gruppo del tenant | — | «Impossibile creare il tenant nel servizio di accesso» |
| `keycloak.group.readFailed` | 502 | Lettura del gruppo del tenant | — | «Impossibile leggere il tenant dal servizio di accesso» |
| `keycloak.group.deleteFailed` | 502 | Eliminazione del gruppo del tenant | — | «Impossibile eliminare il tenant dal servizio di accesso» |
| `keycloak.userRoles.readFailed` | 502 | Lettura dei ruoli dell'utente | — | «Impossibile leggere i ruoli dell'utente» |
| `keycloak.userRoles.assignFailed` | 502 | Assegnazione dei ruoli all'utente | — | «Impossibile assegnare i ruoli all'utente» |
| `keycloak.userRoles.removeFailed` | 502 | Rimozione di ruoli dall'utente | — | «Impossibile rimuovere i ruoli dell'utente» |
| `keycloak.configuration.incomplete` | 502 | Il client di Taurus o i suoi ruoli non si leggono, o un ruolo mancante non si crea | — | «Configurazione del servizio di accesso incompleta: contattare l'amministratore» |
| `keycloak.email.resetPasswordFailed` | 502 | Invio dell'e-mail di reimpostazione della password | — | «Impossibile inviare l'e-mail di reimpostazione della password» |
| `keycloak.email.verifyAddressFailed` | 502 | Invio dell'e-mail di verifica dell'indirizzo | — | «Impossibile inviare l'e-mail di verifica dell'indirizzo» |
| `keycloak.email.setupFailed` | 502 | Invio dell'e-mail con le azioni richieste, per esempio la scelta della password al primo accesso | — | «Impossibile inviare l'e-mail di attivazione dell'account» |
| `keycloak.authorizationFailed` | 502 | Taurus non ottiene il token di servizio: risposta vuota, credenziali rifiutate o richiesta respinta | — | «Il servizio di accesso non ha autorizzato Taurus: contattare l'amministratore» |
| `keycloak.conflict` | 409 | Keycloak segnala un conflitto, di norma un utente con lo stesso nome utente o e-mail, o un gruppo già esistente | — | «Esiste già un utente o un tenant con questi dati nel servizio di accesso» |
| `keycloak.requestFailed` | 502 | Qualunque altro errore di Keycloak | — | «Il servizio di accesso non ha completato l'operazione» |

### Inventario: oggetti e fotografie

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `inventory.item.notFound` | 404 | Oggetto inesistente o eliminato; anche un oggetto non più presente nella richiesta di etichette, di QR code PNG o di sostituzione | — | «Oggetto inventario non trovato» |
| `inventory.number.exists` | 409 | Creazione o modifica di un oggetto con un numero inventariale già usato da un altro oggetto, senza distinguere maiuscole e minuscole | — | «Numero inventariale già utilizzato» |
| `inventory.quantity.belowAssigned` | 409 | Modifica di un oggetto con una quantità totale inferiore a quella ancora in carico ai soci | `assigned` | «La quantità totale non può essere inferiore a quella ancora assegnata ({assigned})» |
| `inventory.value.currencyRequired` | 400 | Valore unitario stimato indicato senza valuta | — | «Valore unitario e valuta devono essere indicati insieme» |
| `inventory.item.assigned` | 409 | Eliminazione di un oggetto con materiale ancora in carico | — | «Non è possibile eliminare un oggetto ancora assegnato» |
| `inventory.photo.notFound` | 404 | Fotografia dell'oggetto o della riconsegna inesistente; sugli endpoint del socio, anche una fotografia di materiale non suo | — | «Fotografia non trovata» |
| `inventory.photo.invalid` | 400 | Il file non è un'immagine leggibile o supera le dimensioni massime | `maxSide` | «Immagine non valida o più grande di {maxSide}×{maxSide} pixel» |
| `inventory.photo.processingFailed` | 500 | Normalizzazione dell'immagine non riuscita | — | «Impossibile elaborare la fotografia: riprovare con un altro file» |
| `inventory.photo.tooLarge` | 413 | File vuoto o oltre la dimensione massima, prima o dopo la normalizzazione | `maxMegabytes` | «La fotografia deve essere un file non vuoto di al massimo {maxMegabytes} MB» |
| `inventory.photo.unsupported` | 415 | Formato diverso da JPEG e PNG | — | «Sono supportate solo immagini JPEG e PNG» |
| `inventory.photo.limit` | 409 | L'oggetto o la riconsegna hanno già il numero massimo di fotografie | `maximum` | «Raggiunto il numero massimo di {maximum} fotografie» |
| `inventory.photo.order.invalid` | 400 | Il nuovo ordine non contiene esattamente le fotografie attive dell'oggetto: ne mancano, ne ripete o ne aggiunge | — | «L'ordine deve contenere tutte e sole le fotografie attive dell'oggetto» |

### Inventario: assegnazioni, prese visione e riconsegne

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `inventory.assignment.notFound` | 404 | Assegnazione inesistente o eliminata; sugli endpoint del socio, anche un'assegnazione di un altro socio | — | «Assegnazione non trovata» |
| `inventory.quantity.unavailable` | 409 | Nuova assegnazione, o aumento di quantità, oltre la disponibilità: quantità totale meno quella in carico agli altri soci | `available` | «Quantità disponibile insufficiente: disponibili {available}» |
| `inventory.issue.unsafe` | 409 | Nuova assegnazione di un oggetto con una segnalazione di sicurezza aperta o presa in carico | — | «Nuove assegnazioni bloccate da una segnalazione di sicurezza aperta» |
| `inventory.user.notFound` | 404 | L'assegnazione o il foglio indicano un utente che non esiste nel tenant | — | «Utente non trovato nel tenant» |
| `inventory.user.identityMissing` | 400 | L'utente scelto non ha un account di accesso: non potrebbe prendere visione dell'assegnazione | — | «L'utente non ha un account di accesso: non può prendere visione dell'assegnazione» |
| `inventory.assignment.userImmutable` | 400 | Modifica di un'assegnazione con un utente diverso | — | «Per cambiare utente occorre creare una nuova assegnazione» |
| `inventory.assignment.quantityInvalid` | 409 | Modifica con una quantità inferiore a quella già riconsegnata | `minimum` | «La quantità assegnata non può essere inferiore a quella già riconsegnata ({minimum})» |
| `inventory.assignment.notRejected` | 409 | Riemissione di una presa visione che il socio non ha rifiutato | — | «È possibile riemettere solo una presa visione rifiutata» |
| `inventory.revision.versionConflict` | 409 | Il socio conferma o rifiuta una versione superata dell'assegnazione | — | «I dati dell'assegnazione sono cambiati: ricaricare prima di confermare» |
| `inventory.decision.immutable` | 409 | La scelta del socio per questa revisione è già registrata | — | «La scelta per questa revisione è già definitiva» |
| `inventory.decision.reasonRequired` | 400 | Rifiuto della presa visione senza motivazione | — | «La motivazione del rifiuto è obbligatoria» |
| `inventory.decision.signatureRequired` | 409 | Decisione diretta di presa visione mentre il tenant richiede la firma elettronica | — | «La presa visione ora richiede la conferma con codice: ricaricare la pagina» |
| `inventory.revision.missing` | 500 | Manca la revisione corrente dell'assegnazione: dato incoerente | — | [Testo generico](#testi-generici) per stato |
| `inventory.revision.createFailed` | 500 | Impossibile creare l'istantanea della revisione | — | [Testo generico](#testi-generici) per stato |
| `inventory.return.notFound` | 404 | Procedura di riconsegna inesistente; sugli endpoint del socio, anche una riconsegna di un altro socio | — | «Riconsegna non trovata» |
| `inventory.return.quantityExceeded` | 409 | Richiesta di riconsegna oltre il materiale ancora in carico, contando le richieste aperte | `maximum` | «Si possono riconsegnare al massimo {maximum} unità» |
| `inventory.return.quantityInvalid` | 409 | Completamento della riconsegna con una quantità minore di 1 o superiore a quella richiesta o in carico | — | «Quantità riconsegnata non valida» |
| `inventory.return.closed` | 409 | Completamento o annullamento di una riconsegna non più in stato «richiesta» | — | «La procedura di riconsegna è già chiusa» |
| `inventory.return.materialReassigned` | 409 | Eliminazione di una riconsegna completata quando il materiale è già stato riassegnato: ripristinarla supererebbe la quantità totale | — | «La riconsegna non può essere eliminata perché il materiale è già stato riassegnato» |
| `inventory.substitution.nothingOutstanding` | 409 | Sostituzione di un'assegnazione senza materiale in carico | — | «L'assegnazione non ha materiale da sostituire» |
| `inventory.substitution.pendingReturn` | 409 | Sostituzione con richieste di riconsegna ancora aperte | — | «Chiudere o annullare le richieste di riconsegna aperte prima della sostituzione» |

### Inventario: segnalazioni, etichette, QR code e cancellazione

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `inventory.issue.notFound` | 404 | Segnalazione, oggetto o assegnazione inesistente, oppure assegnazione di un altro socio | — | «Segnalazione non disponibile» |
| `inventory.issue.quantityExceeded` | 400 | La quantità segnalata supera la quantità del bene (amministratore) o quella ancora in carico (socio) | `maximum` | «La quantità segnalata non può superare {maximum}» |
| `inventory.issue.transition` | 400 | Cambio di stato non ammesso, o segnalazione già risolta o respinta | — | «Cambio di stato non consentito» |
| `inventory.issue.resolutionNotes` | 400 | Segnalazione portata a «Risolta» o «Respinta» senza note di risoluzione | — | «Le note di risoluzione sono obbligatorie» |
| `inventory.issue.versionConflict` | 409 | Un altro utente ha modificato la segnalazione | — | «La segnalazione è stata aggiornata da un altro utente: ricaricare la pagina» |
| `inventory.issue.closed` | 409 | Il socio aggiunge una fotografia a una segnalazione chiusa | — | «La segnalazione è già chiusa» |
| `inventory.issue.photo.invalid` | 400 | Immagine illeggibile o oltre le dimensioni massime | `maxSide` | «Immagine non valida o più grande di {maxSide}×{maxSide} pixel» |
| `inventory.issue.photo.processingFailed` | 500 | Normalizzazione dell'immagine non riuscita | — | «Impossibile elaborare la fotografia: riprovare con un altro file» |
| `inventory.issue.photo.tooLarge` | 413 | File vuoto o oltre la dimensione massima | `maxMegabytes` | «La fotografia deve essere un file non vuoto di al massimo {maxMegabytes} MB» |
| `inventory.issue.photo.unsupported` | 415 | Formato diverso da JPEG e PNG | — | «Sono supportate solo immagini JPEG e PNG» |
| `inventory.issue.photo.limit` | 409 | La segnalazione ha già il numero massimo di fotografie | `maximum` | «Raggiunto il numero massimo di {maximum} fotografie» |
| `inventory.labels.duplicate` | 400 | Lo stesso oggetto compare più volte nella richiesta di etichette | — | «Ogni oggetto può comparire una sola volta» |
| `inventory.labels.singleLimit` | 400 | Formato singolo con troppe etichette o con una posizione iniziale diversa dalla prima | `maximum` | «Il formato singolo ammette al massimo {maximum} etichette, a partire dalla prima posizione» |
| `inventory.labels.sheetLimit` | 400 | Le etichette richieste non stanno nel numero massimo di pagine A4 | `maxPages` | «Le etichette non possono superare {maxPages} pagine A4» |
| `inventory.labels.timeout` | 503 | La generazione del PDF delle etichette ha superato il limite di tempo (`INVENTORY_QR_LABEL_TIMEOUT_SECONDS`, 30 secondi) | — | «La generazione delle etichette ha superato il tempo massimo: riprovare con meno etichette» |
| `inventory.labels.busy` | 503 | Tutti i posti di generazione delle etichette sono occupati | — | «La stampa delle etichette è occupata: riprovare fra poco» |
| `inventory.qr.size.invalid` | 400 | Dimensione del PNG non ammessa | `sizes` | «La dimensione del QR code deve essere di {sizes} pixel», con le dimensioni unite da «o» |
| `inventory.qr.notFound` | 404 | Codice QR inesistente o revocato, oggetto eliminato, nessuna assegnazione visibile; anche scansione senza identità o tenant, per non rivelare se il codice esiste | — | «Codice inventario non disponibile» |
| `inventory.qr.disabled` | 404 | QR code disattivati nella configurazione dell'applicazione, indipendentemente dal tenant | — | «I QR code dell'inventario non sono disponibili» |
| `inventory.erasure.notFound` | 404 | Pratica di cancellazione dell'account inesistente | — | «Pratica di cancellazione non trovata» |
| `inventory.erasure.closed` | 409 | Completamento di una pratica non più in attesa della risoluzione dell'inventario | — | «La pratica è già chiusa» |
| `inventory.erasure.outstanding` | 409 | Completamento della pratica quando il socio ha ancora materiale da riconsegnare | — | «Esiste ancora materiale da riconsegnare» |

### Fogli di affidamento

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `inventory.loanSheet.notFound` | 404 | Foglio inesistente; sugli endpoint del socio, anche un foglio di un altro socio | — | «Foglio di affidamento non trovato» |
| `inventory.loanSheet.alreadyIssued` | 409 | Emissione per un socio che ha già un foglio emesso | `sheetNumber` | «Il socio ha già il foglio di affidamento n. {sheetNumber} emesso» |
| `inventory.loanSheet.assignmentNotFound` | 422 | L'emissione indica assegnazioni inesistenti o eliminate | — | «Una o più assegnazioni non sono disponibili» |
| `inventory.loanSheet.otherMember` | 422 | L'emissione o il collegamento includono assegnazioni di un altro socio | — | «Le assegnazioni devono appartenere al socio del foglio» |
| `inventory.loanSheet.alreadyLinked` | 409 | L'assegnazione è già in un foglio | `itemName` | «L'oggetto {itemName} è già in un foglio di affidamento» |
| `inventory.loanSheet.nothingOutstanding` | 422 | L'assegnazione non ha più materiale in carico | `itemName` | «L'oggetto {itemName} non è più in carico al socio» |
| `inventory.loanSheet.roleRequired` | 422 | Emissione senza ruolo dell'Affidatario, quando la data di nascita del socio non permette di dedurlo | — | «Indicare se l'Affidatario è il socio maggiorenne o il genitore o tutore» |
| `inventory.loanSheet.validation` | 422 | All'emissione uno o più beni violano le regole di durata | `issues`: elenco con `assignmentId`, `itemName`, `inventoryNumber`, `code` e `args`; `code` è un codice di `inventory.loanDuration.*` | «Emissione non possibile:» seguito da un elenco: «{itemName} ({inventoryNumber}): {messaggio di inventory.loanDuration.{code}}» |
| `inventory.loanSheet.missingLoanType` | 422 | Consegna a un socio con foglio emesso di un oggetto senza regime di comodato | `sheetNumber` | Messaggio di `inventory.loanDuration.missingLoanType`, seguito da «(regole del foglio n. {sheetNumber})» |
| `inventory.loanSheet.precariousExpiration` | 422 | Consegna a un socio con foglio emesso di un bene in comodato precario con data di scadenza | `sheetNumber` | Messaggio di `inventory.loanDuration.precariousExpiration`, seguito da «(regole del foglio n. {sheetNumber})» |
| `inventory.loanSheet.missingExpiration` | 422 | Consegna a un socio con foglio emesso di uno strumento in comodato con scadenza senza data di scadenza | `sheetNumber` | Messaggio di `inventory.loanDuration.missingExpiration`, seguito da «(regole del foglio n. {sheetNumber})» |
| `inventory.loanSheet.expirationOutOfRange` | 422 | Consegna, o modifica della scadenza, di un bene di un socio con foglio emesso: la scadenza è fuori dalle regole copiate sul foglio | `minimum`, `maximum`, `minMonths`, `maxMonths`, `deliveredOn`, `sheetNumber` | Messaggio di `inventory.loanDuration.expirationOutOfRange`, seguito da «(regole del foglio n. {sheetNumber})» |
| `inventory.loanSheet.expirationLocked` | 409 | Modifica diretta della scadenza di un bene di un foglio | `sheetNumber` | «La scadenza di un bene del foglio di affidamento n. {sheetNumber} si modifica solo con un rinnovo» |
| `inventory.loanSheet.quantityLocked` | 409 | Modifica della quantità di un bene di un foglio | `sheetNumber` | «La quantità di un bene del foglio di affidamento n. {sheetNumber} non è modificabile: registrare una nuova consegna o una riconsegna» |
| `inventory.loanSheet.loanTypeLocked` | 409 | Cambio del regime di comodato di un oggetto presente in un foglio emesso | — | «Il regime di comodato non è modificabile finché l'oggetto è in un foglio di affidamento emesso» |
| `inventory.loanSheet.assignmentLocked` | 409 | Eliminazione di un'assegnazione che fa parte di un foglio | `sheetNumber` | «L'assegnazione fa parte del foglio di affidamento n. {sheetNumber} e non può essere eliminata» |
| `inventory.loanSheet.returnLocked` | 409 | Eliminazione di una riconsegna che fa parte di un foglio già chiuso | `sheetNumber` | «La riconsegna fa parte del foglio di affidamento n. {sheetNumber} già chiuso» |
| `inventory.loanSheet.notClosed` | 409 | Definizione di un foglio non ancora chiuso | — | «Si definisce soltanto un foglio chiuso» |
| `inventory.loanSheet.notIssued` | 409 | Operazione riservata a un foglio emesso, compresi rinnovo e sostituzione di un bene di un foglio non più emesso | — | «L'operazione è disponibile solo per un foglio emesso» |
| `inventory.loanSheet.notLinked` | 409 | Rinnovo o sostituzione di un bene che non appartiene a un foglio | — | «Il bene non fa parte di un foglio di affidamento emesso» |
| `inventory.loanSheet.notClosable` | 409 | Chiusura di un foglio con beni non ancora riconsegnati | — | «Il foglio si chiude quando tutti i beni sono stati riconsegnati» |
| `inventory.loanSheet.chargesRequired` | 422 | Chiusura con addebito senza importo positivo o senza termine di pagamento | — | «Con addebito occorre indicare importo e termine di pagamento» |
| `inventory.loanSheet.cancelled` | 409 | Download del PDF di un foglio annullato | — | «Il foglio di affidamento è stato annullato» |
| `inventory.loanSheet.purged` | 410 | Download del PDF di un foglio i cui dati personali sono stati rimossi alla scadenza della conservazione | — | «I dati personali del foglio sono stati rimossi: il PDF non è più disponibile» |
| `inventory.loanSheet.tooLarge` | 413 | Il PDF generato supera la dimensione massima | `maxMegabytes` | «Il foglio di affidamento generato supera {maxMegabytes} MB» |
| `inventory.loanSheet.signatureDisabled` | 422 | Emissione con firma elettronica mentre il tenant non la usa | — | «La firma elettronica non è attiva nell'associazione: emettere il foglio su carta» |
| `inventory.loanSheet.holderEmailRequired` | 422 | Emissione con firma elettronica per un Affidatario senza indirizzo e-mail: socio maggiorenne senza e-mail o genitore senza l'e-mail inserita all'emissione | — | «Per la firma elettronica serve l'indirizzo e-mail dell'Affidatario» |
| `inventory.loanSheet.templateNotSignable` | 422 | Emissione con firma elettronica mentre il modello in uso non ha marcatori validi | — | «Il modello in uso non è firmabile elettronicamente: correggere i marcatori nella pagina del modello o emettere il foglio su carta» |
| `inventory.loanDuration.missingLoanType` | 422 | Oggetto senza regime di comodato. Compare negli elenchi `issues` dell'emissione e dell'anteprima | — | «L'oggetto non ha il regime di comodato: indicarlo nella scheda dell'oggetto» |
| `inventory.loanDuration.precariousExpiration` | 422 | Bene in comodato precario con data di scadenza. Compare negli elenchi `issues` dell'emissione e dell'anteprima | — | «Un bene in comodato precario non può avere una data di scadenza» |
| `inventory.loanDuration.missingExpiration` | 422 | Assegnazione, o modifica della scadenza, di uno strumento in comodato con scadenza senza data, a un socio senza foglio emesso: valgono le regole correnti del tenant | — | «La data di scadenza è obbligatoria per gli strumenti in comodato con scadenza» |
| `inventory.loanDuration.expirationOutOfRange` | 422 | Come sopra, con la scadenza fuori dall'intervallo ammesso. Il frontend mostra il messaggio sotto il campo | `minimum`, `maximum`, `minMonths`, `maxMonths`, `deliveredOn` | «La data di scadenza deve essere compresa tra il {minimum} e il {maximum}, cioè tra {minMonths} e {maxMonths} mesi dalla consegna del {deliveredOn}» |
| `inventory.renewal.notFixedTerm` | 422 | Rinnovo di un bene che non è in comodato con scadenza | — | «Si rinnova soltanto un comodato con scadenza» |
| `inventory.renewal.nothingOutstanding` | 409 | Rinnovo di un bene già riconsegnato | — | «Il bene è già stato riconsegnato» |
| `inventory.renewal.missingExpiration` | 422 | Rinnovo di un comodato senza scadenza in corso | — | «Il comodato non ha una scadenza da rinnovare» |
| `inventory.renewal.afterExpiration` | 422 | Rinnovo concesso dopo la scadenza in corso | `currentExpiration` | «Il rinnovo deve essere concesso prima della scadenza in corso del {currentExpiration}» |
| `inventory.renewal.authorizationAfterRenewal` | 422 | Data della delibera successiva al rinnovo | — | «La data della delibera non può essere successiva alla data del rinnovo» |
| `inventory.renewal.notExtended` | 422 | Nuova scadenza non successiva a quella in corso | — | «La nuova scadenza deve essere successiva a quella in corso» |
| `inventory.renewal.renewalLimitExceeded` | 422 | Nuova scadenza oltre il limite del singolo rinnovo | `limit`, `months` | «La nuova scadenza non può superare il {limit} ({months} mesi dalla scadenza precedente)» |
| `inventory.renewal.totalLimitExceeded` | 422 | Nuova scadenza oltre la durata complessiva massima dalla prima consegna | `limit`, `months`, `firstDelivery` | «La nuova scadenza non può superare il {limit} ({months} mesi complessivi dalla prima consegna del {firstDelivery})» |
| `inventory.loanTemplate.invalid` | 422 | Anteprima o attivazione di un modello con problemi bloccanti | `issues`: fino a cinque [esiti della verifica](#esiti-della-verifica-del-modello) bloccanti, con `code`, `line` e `args` | Titolo dal contesto («Anteprima non disponibile», «Attivazione non riuscita»), seguito dall'elenco: «Riga {line}: {messaggio dell'esito}» |
| `inventory.loanTemplate.notFound` | 404 | Versione del modello inesistente, oppure attivazione di una versione non caricata dal tenant | — | «Versione del modello non trovata» |
| `inventory.loanTemplate.tooLarge` | 413 | Il modello supera la dimensione massima | `maxMegabytes` | «Il modello supera {maxMegabytes} MB» |
| `inventory.loanSettings.invalid` | 422 | Regole di durata incoerenti | `problems`: elenco di codici tra `minAboveMax`, `maxAboveTotal`, `renewalAboveTotal` | «Regole di durata incoerenti:» seguito da «la durata minima non può superare la durata massima», «la durata massima non può superare la durata complessiva massima», «l'estensione di un rinnovo non può superare la durata complessiva massima» |
| `inventory.loanSettings.versionConflict` | 409 | Un'altra richiesta ha modificato le regole di durata | — | «Le regole di durata sono state modificate da un'altra richiesta: ricaricare la pagina» |

### Esiti della verifica del modello

Codici dell'elenco `issues` restituito dalla verifica del modello del foglio e dall'errore `inventory.loanTemplate.invalid`. Ogni esito porta anche `line`, quando è nota, e `blocking`. Nel catalogo dei messaggi del frontend sono le chiavi `inventory.loanTemplate.issue.{codice}`.

| Codice | Blocca | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `empty` | Sì | Il file è vuoto | — | «Il file è vuoto» |
| `encoding` | Sì | Il file contiene caratteri non UTF-8 | — | «Il file contiene caratteri non leggibili: salvarlo con codifica UTF-8» |
| `syntax.emptyTag` | Sì | Tag Mustache vuoto | — | «Tag vuoto «{{}}»» |
| `syntax.unopenedClose` | Sì | Chiusura di una sezione mai aperta | `name` | «Chiusura «{{/{name}}}» senza una sezione aperta» |
| `syntax.mismatchedClose` | Sì | Una sezione è chiusa con il nome di un'altra | `name`, `openName`, `openLine` | «La sezione «{openName}» aperta alla riga {openLine} è chiusa con «{{/{name}}}»» |
| `syntax.unclosed` | Sì | Sezione aperta e mai chiusa | `name` | «La sezione «{name}» non è chiusa» |
| `syntax.invalid` | Sì | La libreria Mustache rifiuta il modello; il suo messaggio va solo nel log | — | «Sintassi Mustache non valida» |
| `unescaped` | Sì | Inserimento senza escape, `{{{…}}}` o `{{&…}}` | `name` | «L'inserimento senza escape non è ammesso: usare {{{name}}}» |
| `include` | Sì | Inclusione di un altro modello | `name` | «L'inclusione di altri modelli non è ammessa: «{name}»» |
| `delimiters` | Sì | Cambio dei delimitatori Mustache | — | «Il cambio dei delimitatori non è ammesso» |
| `listAsVariable` | Sì | Un elenco usato come variabile semplice | `name` | ««{name}» è un elenco: va usato come sezione» |
| `unknownVariable` | Sì | Variabile inesistente; se è un campo di un elenco usato fuori dall'elenco, il parametro `list` lo indica | `name`, `list` facoltativo | «Variabile sconosciuta «{name}»», con «: è un campo dell'elenco «{list}» e va usato dentro la sua sezione» se `list` è presente |
| `forbiddenElement` | Sì | Elemento HTML non ammesso, per esempio `script` | `tag` | «L'elemento <{tag}> non è ammesso» |
| `unsupportedImage` | Sì | Immagine incorporata in un formato diverso da PNG e JPEG | — | «Immagine incorporata in un formato non supportato: usare PNG o JPEG» |
| `externalResource` | Sì | Risorsa esterna in un attributo o nel CSS | `where`, `value` abbreviato | «Risorsa esterna non ammessa in {where} ({value}): usare un data: URI» |
| `import` | Sì | `@import` nel CSS | — | «@import non è ammesso: il CSS va scritto nel modello» |
| `fontFace` | Sì | `@font-face` nel CSS | — | «@font-face non è ammesso: usare Helvetica, Times o Courier» |
| `tooLargePdf` | Sì | Il PDF generato con i dati di esempio supera la dimensione massima | `maxMegabytes` | «Il PDF generato con i dati di esempio supera {maxMegabytes} MB» |
| `renderFailed` | Sì | Il PDF non si genera con i dati di esempio; il messaggio dell'errore va solo nel log | — | «Il PDF non può essere generato con i dati di esempio» |
| `font` | No | Font non standard: verrà sostituito | `font` | «Il font «{font}» non è disponibile: verrà usato un font standard. Usare Helvetica, Times o Courier» |
| `unsupportedCharacter` | No | Carattere non stampabile con i font standard | `character`, `codePoint` | «Il carattere «{character}» ({codePoint}) non è stampabile con i font standard e verrà stampato in modo errato» |
| `missingSheetNumber` | No | Il modello non stampa il numero del foglio | — | «Il modello non stampa il numero del foglio» |
| `missingGoods` | No | Il modello non stampa i beni consegnati | — | «Il modello non stampa i beni consegnati» |
| `missingDurations` | No | Il modello non usa le variabili delle regole di durata | — | «Il modello non usa le variabili delle regole di durata: verificare che il testo sulla durata del comodato corrisponda alle regole applicate dai controlli» |
| `signatureActMissing` | No | Un figlio diretto di `<body>` non ha `data-taurus-act`; solo con la firma elettronica attiva e nella firmabilità del modello in uso | `tag` | «L'elemento <{tag}> non indica con data-taurus-act a quale atto appartiene» |
| `signatureActUnknown` | No | Valore di `data-taurus-act` diverso da `issue`, `variation`, `return` e `all` | `value` | «Valore «{value}» non ammesso in data-taurus-act: usare issue, variation, return o all» |
| `signatureActEmpty` | No | Nessuna parte del modello per uno dei tipi di atto | `act`: `issue`, `variation` o `return` | «Nessuna parte del modello appartiene all'atto di {act}», con il tipo di atto tradotto |
| `signatureClausesMissing` | No | Manca il blocco `data-taurus-sign="clauses"` | — | «Manca il blocco dell'approvazione specifica delle clausole (data-taurus-sign="clauses")» |
| `signatureClausesDuplicate` | No | Più blocchi `data-taurus-sign="clauses"` | — | «Il blocco delle clausole (data-taurus-sign="clauses") deve essere uno solo» |
| `signatureClausesOutsideIssue` | No | Il blocco delle clausole non sta in una parte dell'emissione | — | «Il blocco delle clausole deve stare in una parte dell'emissione (data-taurus-act="issue")» |
| `signatureClausesEmpty` | No | Il blocco delle clausole non ha testo | — | «Il blocco delle clausole è vuoto» |

### Firma elettronica

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `signature.disabled` | 422 | Richiesta di un codice per la presa visione mentre il tenant non usa la firma elettronica | — | «La firma elettronica non è attiva nell'associazione» |
| `signature.challenge.invalid` | 400 | Elementi della conferma mancanti, duplicati, oltre il massimo o di uno scopo non supportato; nuovo invio chiesto per una conferma con l'app di autenticazione | — | «La richiesta di firma non è valida: ricaricare la pagina e riprovare» |
| `signature.challenge.notFound` | 404 | Conferma inesistente o di un altro utente | — | «Richiesta di firma non trovata» |
| `signature.challenge.closed` | 409 | Codice o nuovo invio per una conferma già confermata o annullata | — | «La richiesta di firma è già chiusa: ricominciare la firma» |
| `signature.challenge.expired` | 410 | Codice confermato o reinviato dopo la scadenza | — | «Il codice è scaduto: richiederne uno nuovo» |
| `signature.challenge.locked` | 409 | Tentativi esauriti | — | «Troppi codici errati: ricominciare la firma» |
| `signature.challenge.invalidCode` | 422 | Codice errato; il tentativo è consumato | `remainingAttempts` | «Codice errato: restano {remainingAttempts} tentativi» |
| `signature.challenge.limit` | 409 | Nuovo invio oltre il numero massimo di codici della conferma | `maxSends` | «Raggiunto il numero massimo di {maxSends} codici per questa firma: ricominciare la firma» |
| `signature.challenge.resendTooSoon` | 429 | Nuovo codice chiesto prima dell'intervallo minimo, o troppi codici chiesti dall'utente nell'ultima ora | `retryAfterSeconds` | «Nuovo codice richiesto troppo presto: riprovare tra {retryAfterSeconds} secondi», in minuti oltre i due minuti |
| `signature.method.totpNotConfigured` | 422 | Conferma con l'app di autenticazione non configurata dall'utente o non offerta dall'installazione | — | «L'app di autenticazione non è configurata: usare il codice via e-mail» |
| `signature.method.unavailable` | 502 | Keycloak non risponde alla verifica dell'app di autenticazione; nessun tentativo consumato | — | «L'app di autenticazione non si può verificare in questo momento: usare il codice via e-mail» |
| `signature.mail.addressMissing` | 422 | Il firmatario non ha un indirizzo e-mail | — | «Non è registrato un indirizzo e-mail a cui inviare il codice: chiedere all'amministratore di aggiungerlo» |
| `signature.mail.sendFailed` | 502 | Il server SMTP non ha accettato l'e-mail del codice; la conferma è annullata | — | «Non è stato possibile inviare il codice via e-mail: riprovare tra qualche minuto» |
| `signature.link.sendFailed` | 502 | Il server SMTP non ha accettato l'e-mail del nuovo link al genitore o tutore; il link è creato ma non inviato | — | «Non è stato possibile inviare il link via e-mail: riprovare tra qualche minuto» |
| `signature.cieSign.documentMismatch` | 422 | Il file caricato con CieSign non inizia con il documento congelato, l'aggiornamento della firma cambia il documento o il file è stato modificato dopo la firma | — | «Il file non è il documento scaricato da Taurus o è stato modificato dopo la firma: scaricare di nuovo il documento e firmarlo senza modificarlo» |
| `signature.cieSign.invalidSignature` | 422 | File CieSign vuoto o illeggibile, senza firma, con più firme o con una firma non valida | — | «Il file non contiene una sola firma valida: firmare il documento una volta con CieSign e caricare il file ottenuto» |
| `signature.cieSign.untrustedCertificate` | 422 | Certificato della firma CieSign non emesso dalle CA della CIE configurate, scaduto, revocato o non adatto alla firma | — | «La firma non è fatta con una Carta d'Identità Elettronica valida» |
| `signature.cieSign.signerMismatch` | 422 | Nome, cognome o codice fiscale del certificato diversi da quelli dell'Affidatario | — | «La firma è di un'altra persona: nome, cognome e codice fiscale della carta devono essere quelli dell'Affidatario» |
| `signature.cieSign.tooLarge` | 413 | File CieSign oltre 25 MB | `maxMegabytes` | «Il file firmato supera {maxMegabytes} MB» |
| `signature.cieSign.notAvailable` | 422 | CieSign richiesto da un Affidatario che ha dichiarato di non avere un codice fiscale italiano | — | «CieSign non è disponibile senza un codice fiscale italiano: firmare con il codice» |
| `signature.cieSign.notConfigured` | 422 | CieSign richiesto in un'installazione senza i certificati delle CA della CIE | — | «CieSign non è disponibile in questa installazione: firmare con il codice» |
| `signature.settings.requirementsMissing` | 422 | Attivazione della firma, o richiesta di un codice, senza server SMTP, chiave dei codici o sigillo | `missing` | «La firma elettronica non è attivabile: mancano {missing}: chiedere a chi gestisce l'installazione di configurarli» |
| `signature.settings.versionConflict` | 409 | Impostazione della firma modificata da un'altra richiesta | — | «Le impostazioni della firma sono state modificate da un'altra richiesta: ricaricare la pagina» |
| `signature.act.notFound` | 404 | Atto inesistente, oppure di cui l'utente non è firmatario | — | «Atto da firmare non trovato» |
| `signature.act.notAwaitingData` | 409 | Dati dell'Affidatario inviati per un atto che non li attende, già firmato da qualcuno o di un foglio non più emesso | — | «L'atto non attende più i dati dell'Affidatario: ricaricare la pagina» |
| `signature.act.notAwaitingSignatures` | 409 | Firma, cambio del firmatario o dichiarazione su carta di un atto completato, annullato o ancora in attesa dei dati | — | «L'atto non è in attesa di firme: ricaricare la pagina» |
| `signature.act.documentChanged` | 409 | L'impronta confermata non corrisponde al documento congelato | — | «Il documento è cambiato: ricaricare la pagina e rileggerlo prima di firmare» |
| `signature.act.alreadySigned` | 409 | Il firmatario ha già dato questa conferma | — | «Questa firma è già registrata» |
| `signature.act.acknowledgmentsPending` | 409 | Firma o invio dei dati dell'Affidatario mentre il socio ha prese visione in attesa sulle assegnazioni del foglio | `count`: numero delle prese visione in attesa | «C'è una presa visione in attesa: confermarla dall'elenco delle consegne, poi firmare»; con più prese visione «Ci sono {count} prese visione in attesa: confermarle dall'elenco delle consegne, poi firmare» |
| `signature.act.purged` | 410 | Download di documenti, attestazione o fascicolo già eliminati alla fine del periodo di grazia o con la cancellazione GDPR | — | «I documenti dell'atto sono stati eliminati da Taurus: la conservazione spetta all'associazione» |
| `signature.act.batchNotAllowed` | 422 | Conferma multipla con atti diversi dalle variazioni, o per l'approvazione delle clausole | — | «Solo le variazioni si possono firmare insieme: firmare gli altri atti uno alla volta» |
| `signature.act.versionConflict` | 409 | Atto modificato da un'altra richiesta durante il cambio del firmatario | — | «L'atto è stato modificato da un'altra richiesta: ricaricare la pagina» |
| `signature.holderData.invalid` | 422 | Dati dell'Affidatario mancanti o non validi | `fields`: nomi tra `birthPlace`, `residence`, `postalCode`, `cityProvince`, `taxCode`, `document`, `documentIssuedBy`, `documentIssuedOn`, `minorBirthPlace` | «Dati mancanti o non validi: {fields}», con i nomi dei campi tradotti |
| `signature.holderData.birthDateMissing` | 422 | Dati dell'Affidatario inviati quando il profilo del socio non ha la data di nascita | `holderRole`: `MEMBER` o `GUARDIAN` | «Manca la data di nascita: aggiungerla nella pagina Profilo, poi completare i dati»; con `GUARDIAN` «Manca la data di nascita del socio minorenne: chiedere all'associazione di inserirla, poi completare i dati» |
| `signature.associationSigner.sameAsHolder` | 422 | Firmatario per l'Associazione coincidente con l'Affidatario | — | «Chi firma per l'Associazione non può essere l'Affidatario» |
| `signature.associationSigner.notAdmin` | 422 | Firmatario per l'Associazione mancante, o non più amministratore o membro del direttivo attivo | — | «Chi firma per l'Associazione deve essere un amministratore o un membro del direttivo attivo: designare un altro firmatario» |
| `signature.associationSigner.locked` | 409 | Cambio del firmatario per l'Associazione dopo la prima firma dell'atto | — | «Dopo la prima firma il firmatario per l'Associazione non cambia più: se non può firmare, dichiarare l'atto firmato su carta» |

### Economia

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `finance.account.notFound` | 404 | Conto inesistente o eliminato | — | «Conto non trovato» |
| `finance.account.archived` | 409 | Movimento o trasferimento su un conto archiviato | — | «Il conto è archiviato» |
| `finance.account.alreadyActive` | 409 | Ripristino di un conto non archiviato | — | «Il conto è già attivo» |
| `finance.account.nameExists` | 409 | Creazione, modifica o ripristino di un conto con il nome di un altro conto attivo | — | «Esiste già un conto attivo con questo nome» |
| `finance.account.notArchived` | 409 | Eliminazione di un conto non archiviato | — | «Il conto deve essere archiviato prima di essere eliminato» |
| `finance.account.hasMovements` | 409 | Eliminazione di un conto con movimenti attivi | — | «Il conto ha movimenti attivi: può essere soltanto archiviato» |
| `finance.account.bankFields` | 400 | IBAN o banca indicati per un conto di cassa | — | «IBAN e banca sono ammessi soltanto per un conto corrente» |
| `finance.category.notFound` | 404 | Categoria inesistente o eliminata | — | «Categoria non trovata» |
| `finance.category.archived` | 409 | Movimento con una categoria archiviata | — | «La categoria è archiviata» |
| `finance.category.nameExists` | 409 | Creazione o modifica di una categoria con il nome di un'altra categoria attiva | — | «Esiste già una categoria attiva con questo nome» |
| `finance.movement.notFound` | 404 | Movimento inesistente o eliminato | — | «Movimento non trovato» |
| `finance.movement.categoryDirection` | 400 | La categoria ammette solo entrate o solo uscite, e il movimento ha la direzione opposta | — | «La categoria non è compatibile con la direzione del movimento» |
| `finance.movement.versionConflict` | 409 | Modifica di un movimento con una versione diversa da quella corrente | — | «Il movimento è stato modificato da un altro utente: ricaricalo prima di salvare» |
| `finance.movement.payoutSettlement` | 409 | Modifica dell'importo o della direzione di un movimento che liquida compensi ai presenti | — | «Il movimento liquida compensi ai presenti: per cambiarne importo o direzione eliminalo e genera una nuova liquidazione» |
| `finance.event.notFound` | 404 | Riepilogo economico o compensi di un evento inesistente, o movimento collegato a un evento inesistente | — | «Evento non trovato» |
| `finance.year.notFound` | 404 | Esercizio contabile inesistente | — | «Esercizio non trovato» |
| `finance.transfer.sameAccount` | 400 | Trasferimento con lo stesso conto di origine e di destinazione | — | «Il conto di origine e quello di destinazione devono essere diversi» |
| `finance.transfer.currencyMismatch` | 400 | Trasferimento fra conti con valute diverse | — | «I conti del trasferimento devono avere la stessa valuta» |
| `finance.transfer.inconsistent` | 409 | Il trasferimento da modificare non ha esattamente due movimenti | — | «Il trasferimento non contiene due movimenti coerenti» |
| `finance.attachment.notFound` | 404 | Allegato inesistente o eliminato | — | «Allegato non trovato» |
| `finance.attachment.tooLarge` | 413 | Allegato vuoto o oltre la dimensione massima | `maxMegabytes` | «L'allegato deve essere un file non vuoto di al massimo {maxMegabytes} MB» |
| `finance.attachment.unsupported` | 415 | Allegato in un formato diverso da PDF, JPEG e PNG | — | «Sono supportati soltanto PDF, JPEG e PNG» |
| `finance.attachment.contentMismatch` | 415 | Il contenuto dell'allegato non corrisponde al tipo dichiarato | — | «Il contenuto del file non corrisponde al tipo dichiarato» |
| `finance.attachment.limit` | 409 | Il movimento ha già il numero massimo di allegati | `maximum` | «Sono consentiti al massimo {maximum} allegati per movimento» |
| `finance.report.invalidPeriod` | 400 | Rendiconto o riepilogo con data iniziale successiva alla finale | — | «La data iniziale deve precedere la data finale» |
| `finance.report.unsupportedFormat` | 400 | Esportazione in un formato diverso da PDF e XLSX | — | «Formato di esportazione non supportato» |
| `finance.report.generationFailed` | 500 | Generazione del file XLSX o PDF non riuscita | — | «Impossibile generare il rendiconto: riprovare» |

### Compensi ai presenti

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `payout.setting.notFound` | 404 | Versione dei parametri inesistente o eliminata | — | «Versione dei parametri non trovata» |
| `payout.setting.dateExists` | 409 | Creazione o modifica di una versione con la decorrenza di un'altra versione | — | «Esiste già una versione dei parametri con questa decorrenza» |
| `payout.setting.inUse` | 409 | Eliminazione, o spostamento in avanti della decorrenza, della prima versione quando lascerebbe senza parametri eventi con presenti | — | «La versione è l'unica applicabile ad alcuni eventi con presenti: crea prima una versione con decorrenza anteriore» |
| `payout.setting.notConfigured` | 409 | Simulazione di un evento la cui data precede la prima versione dei parametri | — | «Nessuna versione dei parametri dei compensi è applicabile alla data dell'evento» |
| `payout.preview.invalid` | 400 | Anteprima con percentuale fuori dall'intervallo 0–100 o passo negativo | — | «Parametri di anteprima non validi» |
| `payout.user.notFound` | 404 | Fattore, pagamento fisso, quote o liquidazione di un utente inesistente o eliminato | — | «Utente non trovato» |
| `payout.adjustment.reasonRequired` | 400 | Fattore o pagamento fisso senza motivo | — | «Il motivo del fattore o del pagamento fisso è obbligatorio» |
| `payout.adjustment.valueRequired` | 400 | Richiesta con fattore e pagamento fisso insieme, o con nessuno dei due | — | «Indicare un fattore oppure un pagamento fisso» |
| `payout.adjustment.factorOutOfRange` | 400 | Fattore minore di zero o maggiore di uno | — | «Il fattore deve essere compreso fra 0 e 1» |
| `payout.adjustment.fixedAmountNotPositive` | 400 | Pagamento fisso pari a zero o negativo | — | «Il pagamento fisso deve essere maggiore di zero» |
| `payout.adjustment.userNotPresent` | 409 | Fattore o pagamento fisso per un utente non presente all'evento | — | «L'utente non risulta presente all'evento» |
| `payout.settlement.empty` | 409 | Liquidazione senza righe | — | «La liquidazione non contiene righe» |
| `payout.settlement.multipleUsers` | 400 | Liquidazione con righe di soci diversi | — | «Una liquidazione riguarda un solo socio» |
| `payout.settlement.amountExceedsDue` | 400 | Riga di liquidazione che supera il residuo dovuto sulla quota reale o sul pagamento fisso | — | «L'importo da liquidare supera il residuo dovuto per l'evento» |

### Preparazione evento

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `eventPreparation.event.notFound` | 404 | Evento inesistente, escluso da una serie o non visibile: in bozza, oppure non pubblico per un utente esterno | — | «Evento non trovato» |
| `eventPreparation.notConfigured` | 400 | Operazione su un evento la cui preparazione non è configurata | — | «Configurare prima la preparazione dell'evento» |
| `eventPreparation.track.notFound` | 400 | Il programma indica una traccia inesistente | — | «Una traccia del programma non è più disponibile» |
| `eventPreparation.item.notFound` | 400 | I materiali indicano un oggetto inventario inesistente | — | «Un oggetto dei materiali non è più disponibile» |
| `eventPreparation.assignment.notFound` | 400 | I materiali indicano un'assegnazione inesistente | — | «Un'assegnazione dei materiali non è più disponibile» |
| `eventPreparation.assignment.itemMismatch` | 400 | L'assegnazione indicata appartiene a un altro oggetto | — | «L'assegnazione non appartiene all'oggetto selezionato» |
| `eventPreparation.material.notFound` | 400 | Conferma di un materiale inesistente | — | «Materiale non trovato» |
| `eventPreparation.movements.exists` | 400 | Conferma dell'assenza di movimenti economici quando ce ne sono | — | «Sono presenti movimenti economici per l'evento» |
| `eventPreparation.program.required` | 400 | Spartiti richiesti senza programma | — | «Gli spartiti richiedono il programma dell'evento» |
| `eventPreparation.participants.required` | 400 | Partecipanti richiesti senza numero minimo | — | «Indicare il numero minimo di partecipanti» |
| `eventPreparation.requirement.required` | 400 | Configurazione senza la scelta di un'area: ogni requisito va indicato come richiesto o no | — | «Scegliere se ogni area della preparazione è richiesta» |
| `eventPreparation.program.tooLarge` | 400 | Programma con più di 100 voci | — | «Il programma può contenere al massimo 100 brani» |
| `eventPreparation.materials.tooLarge` | 400 | Materiali con più di 100 righe | — | «I materiali possono contenere al massimo 100 righe» |
| `eventPreparation.reason.tooLong` | 400 | Motivo della conferma “nessun movimento” oltre i 500 caratteri | — | «Il motivo può contenere al massimo 500 caratteri» |
| `eventPreparation.versionConflict` | 409 | Un'altra richiesta ha modificato configurazione, programma o materiali della preparazione dopo la lettura: la versione inviata non è più quella corrente | — | «La preparazione è stata modificata da un'altra richiesta: la pagina mostra ora i dati aggiornati». Le sezioni della pagina chiedono prima se ricaricare, così le modifiche locali non vanno perse senza conferma |

### Dashboard operativa

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `dashboard.attention.invalid` | 400 | `GET /api/dashboard/operations/calendar-events` con un valore di `attention` diverso da `event-preparation` ed `event-follow-up` | — | «Filtro delle attività non riconosciuto» |

### Calendario: serie ricorrenti, promemoria e feed

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `calendar.series.request.invalid` | 400 | Serie ricorrente senza evento modello o senza ricorrenza | — | «Indicare l'evento modello e la ricorrenza» |
| `calendar.series.template.invalid` | 400 | Evento modello senza nome o data di inizio | — | «Indicare nome e data di inizio dell'evento» |
| `calendar.series.duration.invalid` | 400 | La fine dell'evento modello non segue l'inizio di almeno un minuto | — | «La fine dell'evento deve seguire l'inizio» |
| `calendar.series.recurrence.invalid` | 400 | Regola di ricorrenza non valida; il messaggio del generatore delle occorrenze va solo nel log | — | «Regola di ricorrenza non valida» |
| `calendar.series.recurrence.tooManyOccurrences` | 400 | La regola genererebbe più occorrenze del limite della serie | `maximum` | «La regola supera il limite di {maximum} occorrenze: riduci la durata o aumenta l'intervallo» |
| `calendar.series.sourceOccurrence.invalid` | 400 | L'occorrenza di partenza indicata non appartiene alla serie | — | «L'occorrenza di partenza non appartiene alla serie» |
| `calendar.series.occurrence.notFound` | 404 | Ripristino di un'occorrenza che non appartiene alla serie | — | «Occorrenza non trovata nella serie» |
| `calendar.series.idempotencyKey.invalid` | 400 | Chiave di idempotenza della creazione vuota o più lunga del limite di 64 caratteri | — | «La chiave della richiesta non è valida: riprova a creare la serie» |
| `calendar.series.duplicateRequest` | 409 | Due richieste di creazione con la stessa chiave di idempotenza arrivate insieme | — | «La serie è già in creazione da un'altra richiesta: aggiorna la pagina per vederla» |
| `calendar.series.occurrence.conflict` | 409 | La nuova regola porta un'occorrenza sull'inizio già occupato da un'altra occorrenza della serie | — | «Un'altra occorrenza della serie inizia già in quella data» |
| `calendar.series.reminder.invalid` | 400 | Promemoria dell'evento modello fuori dall'intervallo ammesso | `maximum` | «Il promemoria deve essere compreso tra 0 e {maximum} minuti prima dell'evento» |
| `calendar.reminder.invalid` | 400 | Promemoria di un evento fuori dall'intervallo ammesso | `maximum` | «Il promemoria deve essere compreso tra 0 e {maximum} minuti prima dell'evento» |
| `calendar.reminder.availabilityMissing` | 409 | Promemoria impostato su un evento per cui l'utente non ha confermato la disponibilità | — | «Confermare la propria disponibilità prima di impostare un promemoria» |
| `calendarFeed.notFound` | 404 | Feed inesistente, non dell'utente, di un tipo non ammesso per l'operazione, oppure feed esterni disattivati | — | «Feed non trovato» |
| `calendarFeed.limit` | 409 | L'utente ha già il numero massimo di feed personali attivi, o il tenant di feed del tenant | `maximum` | «Raggiunto il numero massimo di {maximum} feed attivi» |
| `calendarFeed.active` | 409 | Eliminazione di un feed non ancora revocato | — | «Revocare il feed prima di eliminarlo» |
| `calendarFeed.idempotencyKey` | 400 | La richiesta non ha una chiave di idempotenza valida: errore del client | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `calendarFeed.idempotency.conflict` | 409 | La chiave di idempotenza è già stata usata per una richiesta diversa | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `calendarFeed.idempotency.stale` | 409 | La risposta di una richiesta già eseguita non è più attuale: il feed è cambiato | — | «Il feed è cambiato nel frattempo: ricaricare la pagina» |
| `calendarFeed.role` | 403 | Feed personale richiesto da un utente senza ruolo di partecipante | — | «Il feed personale richiede un ruolo di partecipante» |

### Preferenze di notifica, notifiche e consegne

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `preferences.disabled` | 404 | Preferenze di notifica disattivate nella configurazione dell'applicazione | — | «Le preferenze di notifica non sono disponibili» |
| `preferences.required` | 400 | Salvataggio senza preferenze | — | «Preferenze di notifica mancanti» |
| `preferences.invalid` | 400 | Mancano l'orario del riepilogo o l'anteprima delle notifiche push | — | «Indicare l'orario del riepilogo e l'anteprima delle notifiche push» |
| `preferences.versionConflict` | 409 | Un'altra richiesta ha modificato le preferenze | — | «Le preferenze sono state modificate da un'altra richiesta: ricaricare la pagina» |
| `preferences.timeZone.invalid` | 400 | Fuso orario non riconosciuto | — | «Fuso orario non valido» |
| `preferences.reminder.invalid` | 400 | Promemoria predefinito fuori dall'intervallo ammesso | `maximum` | «Il promemoria predefinito deve essere compreso tra 0 e {maximum} minuti» |
| `preferences.quietHours.invalid` | 400 | Ore di silenzio senza inizio o fine, oppure attive con inizio uguale alla fine | — | «Ore di silenzio non valide: indicare un inizio e una fine diversi» |
| `preferences.digest.quietHours` | 400 | L'orario del riepilogo cade nelle ore di silenzio | — | «L'orario del riepilogo non può cadere nelle ore di silenzio» |
| `preferences.pushPause.invalid` | 400 | Pausa delle notifiche push nel passato o oltre il massimo configurato | `maxDays` | «La pausa delle notifiche push deve terminare entro {maxDays} giorni» |
| `preferences.categories.incomplete` | 400 | Le preferenze non coprono tutte le categorie di notifica | — | «Indicare le preferenze per tutte le categorie di notifica» |
| `preferences.categories.invalid` | 400 | Categoria sconosciuta, ripetuta o incompleta | — | «Categorie di notifica non valide: ricaricare la pagina e riprovare» |
| `notice.snooze.invalid` | 400 | Posticipo di una notifica fuori dall'intervallo ammesso | `minMinutes`, `maxDays` | «Il posticipo deve essere compreso tra {minMinutes} minuti e {maxDays} giorni» |
| `notice.snooze.read` | 409 | Posticipo di una notifica già letta | — | «Una notifica già letta non può essere posticipata» |
| `notification.delivery.notFound` | 404 | Consegna inesistente | — | «Consegna non trovata» |
| `notification.delivery.page.invalid` | 400 | Pagina negativa o dimensione fuori dall'intervallo ammesso | `maxSize` | «Pagina non valida: si possono mostrare al massimo {maxSize} consegne» |
| `notification.delivery.range.invalid` | 400 | Inizio dell'intervallo non precedente alla fine | — | «L'inizio dell'intervallo deve precedere la fine» |
| `notification.delivery.operation.invalid` | 400 | Filtro per operazione con caratteri non ammessi o troppo lungo | — | «Filtro per operazione non valido» |
| `notification.delivery.sort.invalid` | 400 | Campo o direzione di ordinamento non supportati | — | «Ordinamento non supportato» |
| `notification.delivery.ids.invalid` | 400 | Selezione vuota o oltre il massimo | `maximum` | «Selezionare da 1 a {maximum} consegne» |
| `notification.delivery.ids.duplicate` | 400 | Selezione con consegne ripetute | — | «La selezione contiene consegne ripetute» |
| `notification.delivery.notFailed` | 409 | Nuovo tentativo su una consegna non fallita | — | «Si ripetono soltanto le consegne non riuscite» |
| `notification.delivery.notClosable` | 409 | Chiusura di una consegna che non è in attesa né fallita | — | «Si chiudono soltanto le consegne in attesa o non riuscite» |
| `notification.delivery.close.unsupported` | 409 | Chiusura di un evento della coda di distribuzione delle notifiche interne | — | «La distribuzione delle notifiche interne non si chiude manualmente» |

### Guida introduttiva

La guida non mostra all'utente gli errori delle proprie chiamate automatiche: i messaggi compaiono solo per i comandi della sezione **Guida** del profilo. La [specifica](guided-tour-spec.md#validazione-ed-errori) descrive il comportamento del client.

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `guidedTour.disabled` | 404 | Scrittura di impostazioni o avanzamento con l'interruttore applicativo `application.guided-tour.enabled` spento | — | «La guida non è disponibile» |
| `guidedTour.versionConflict` | 409 | Un'altra richiesta, per esempio da un'altra scheda, ha modificato impostazioni o avanzamento della guida | — | «La guida è stata aggiornata da un'altra scheda: ricaricare la pagina» |
| `guidedTour.step.limit` | 400 | Avanzamento con più di 100 tappe viste | — | «Avanzamento della guida non valido: ricaricare la pagina e riprovare» |

### Documenti legali

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `legal.acceptance.incomplete` | 400 | L'utente non conferma tutti i documenti obbligatori ancora da accettare | — | «Confermare tutti i documenti obbligatori» |
| `legal.document.stale` | 400 | L'utente accetta un documento non più in vigore: nel frattempo è stata pubblicata una nuova versione | — | «Uno o più documenti non sono più in vigore: ricaricare la pagina» |
| `legal.document.notFound` | 404 | Documento inesistente; dall'API pubblica anche una bozza, un tipo sconosciuto o un documento senza versione in vigore | — | «Documento legale non trovato» |
| `legal.document.version.exists` | 409 | Creazione o modifica con tipo e versione di un documento già esistente | — | «Esiste già questa versione del documento» |
| `legal.document.version.invalid` | 400 | Versione con caratteri diversi da lettere, cifre, punto, trattino e trattino basso, che non inizia con una lettera o una cifra o supera i 32 caratteri | — | «Usare per la versione solo lettere, numeri, punto, trattino e trattino basso» |
| `legal.document.content.required` | 400 | Bozza o completamento con il testo vuoto | — | «Scrivere il testo del documento» |
| `legal.document.content.tooLong` | 400 | Testo di una bozza, di un completamento o di un’anteprima oltre 100 000 caratteri | — | «Il testo supera i 100.000 caratteri» |
| `legal.document.published.immutable` | 409 | Modifica o eliminazione di una versione già pubblicata, o secondo completamento di un documento pubblicato con il solo indirizzo | — | «Una versione pubblicata non si modifica: crearne una nuova» |

### Strumenti e strumenti da aggiungere

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `instrument.name.exists` | 409 | Creazione o rinomina di uno strumento, a mano o dal pannello Strumenti da aggiungere, con il nome di un altro strumento del tenant, confrontato senza maiuscole, accenti, punteggiatura e spazi ripetuti | — | «Esiste già uno strumento con questo nome» |
| `instrumentSuggestion.notOpen` | 409 | Decisione su un nome da aggiungere che non è più aperto per la traccia o per una delle parti indicate | — | «Uno dei nomi è già stato deciso da un'altra richiesta» |

### Brani, upload e immagini delle pagine

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `track.notFound` | 404 | L'elaborazione indica un brano inesistente | — | «Brano non trovato» |
| `track.file.empty` | 400 | Caricamento di un file vuoto in un brano | — | «Il file è vuoto» |
| `track.annotations.invalid` | 400 | Le annotazioni del manipolatore PDF non sono leggibili come JSON | — | «Le modifiche alle pagine non sono leggibili: riapri il manipolatore e riprova» |
| `track.score.notFound` | 400 | La parte indicata non appartiene al brano | — | «La parte non appartiene al brano» |
| `track.queue.failed` | 500 | Impossibile accodare l'elaborazione del file, al caricamento o al nuovo tentativo | — | «Impossibile avviare l'elaborazione del file: riprovare» |
| `track.upload.notFound` | 404 | Elaborazione inesistente o di un altro brano | — | «Elaborazione non trovata» |
| `track.upload.notRetryable` | 409 | Nuovo tentativo su un'elaborazione non fallita | — | «Si ripete soltanto un'elaborazione non riuscita» |
| `track.upload.versionConflict` | 409 | Lo stato dell'elaborazione è cambiato durante il nuovo tentativo | — | «L'elaborazione è cambiata nel frattempo: ricaricare la pagina» |
| `track.upload.mediaRequired` | 400 | Elaborazione senza il file di origine | — | «Indicare il file da elaborare» |
| `track.upload.mediaNotFound` | 404 | Il file di origine dell'elaborazione non esiste | — | «File da elaborare non trovato» |
| `track.upload.unsupported` | 415 | Il file da elaborare non è un PDF | — | «Sono supportati soltanto file PDF» |
| `track.upload.failed` | 500 | Errore di lettura durante il caricamento | — | «Impossibile caricare il file: riprovare» |
| `image.forbidden` | 403 | Modifica di un'immagine da parte di un utente che non è amministratore né archivista | — | «Solo amministratori e archivisti possono modificare le immagini» |
| `image.notFound` | 404 | Brano, parte o immagine della pagina non trovati | — | «Immagine della pagina non trovata» |
| `image.unsupported` | 415 | Il media non è un'immagine o il formato non è leggibile | — | «Formato immagine non supportato» |
| `image.empty` | 400 | Immagine vuota | — | «L'immagine è vuota» |
| `image.tooLarge` | 413 | Immagine oltre la dimensione massima del file | `maxMegabytes` | «L'immagine supera {maxMegabytes} MB» |
| `image.dimensions.tooLarge` | 413 | Immagine oltre il lato massimo o il numero massimo di pixel | `maxSide`, `maxMegapixels` | «L'immagine è troppo grande: massimo {maxSide} pixel per lato e {maxMegapixels} milioni di pixel» |
| `image.decode` | 422 | Impossibile decodificare l'immagine | — | «Impossibile leggere l'immagine» |
| `image.encode` | 422 | Impossibile salvare l'immagine modificata | — | «Impossibile salvare l'immagine modificata» |
| `image.output.tooLarge` | 413 | L'immagine modificata supera la dimensione massima | `maxMegabytes` | «L'immagine modificata supera {maxMegabytes} MB» |
| `image.recipe.empty` | 400 | La modifica non contiene cambiamenti | — | «Nessuna modifica da applicare» |
| `image.recipe.invalid` | 400 | Luminosità, contrasto o soglia fuori intervallo | — | «Regolazioni dell'immagine non valide» |
| `image.recipeVersion` | 400 | Versione delle istruzioni di modifica non supportata: errore del client | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `image.crops.invalid` | 400 | Troppi ritagli | `maximum` | «Si possono indicare al massimo {maximum} ritagli» |
| `image.crop.invalid` | 400 | Ritaglio fuori dall'immagine o troppo piccolo | — | «Area di ritaglio non valida» |
| `image.idempotencyKey` | 400 | La richiesta non ha una chiave di idempotenza valida: errore del client | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `image.idempotency.conflict` | 409 | La chiave di idempotenza è già stata usata per una modifica diversa | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `image.idempotency.stale` | 409 | La risposta di una modifica già eseguita non è più attuale: il brano è cambiato | — | «Il brano è cambiato dopo la modifica: ricaricare la pagina» |
| `image.timeout` | 503 | L'elaborazione dell'immagine ha superato il limite di tempo | — | «L'elaborazione dell'immagine ha superato il tempo massimo: riprovare» |
| `image.busy` | 503 | Tutti i posti di elaborazione delle immagini sono occupati | — | «L'elaborazione delle immagini è occupata: riprovare fra poco» |

### Media

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `media.managedOnly` | 405 | Creazione o modifica di un media tramite le API generiche: i media nascono solo dal caricamento di un file | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `media.notReady` | 409 | Lettura di un media non ancora pronto o non valido | — | «Il file non è ancora disponibile» |
| `media.integrity` | 409 | Il file archiviato non corrisponde a dimensione o impronta registrate: il media viene marcato come non valido | — | «Il file archiviato è danneggiato: caricarlo di nuovo» |
| `media.fileNotFound` | 404 | Il file del media non è presente nell'archivio | — | «File non presente nell'archivio» |
| `media.referenced` | 409 | Eliminazione di un media ancora usato da un'altra entità | — | «Il file è ancora in uso e non può essere eliminato» |
| `media.category.invalid` | 400 | Categoria del media non conforme al formato ammesso | — | «Richiesta non valida: ricaricare la pagina e riprovare» |
| `media.file.empty` | 400 | Salvataggio di un file vuoto | — | «Il file è vuoto» |
| `media.file.storeFailed` | 500 | Scrittura del file nell'archivio non riuscita | — | «Impossibile salvare il file: riprovare» |

### Ascolto e correzione delle parti

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `scorePlayback.track.notFound` | 404 | Brano inesistente o non visibile all'utente | — | «Brano non trovato» |
| `scorePlayback.part.notFound` | 404 | La parte non appartiene al brano | — | «Parte non trovata» |
| `scorePlayback.version.notFound` | 404 | Versione inesistente o di un'altra parte | — | «Versione della parte non trovata» |
| `scorePlayback.version.conflict` | 409 | Un'altra versione della stessa parte è stata salvata nello stesso momento | — | «Un'altra versione della parte è stata appena salvata: riprovare» |
| `scorePlayback.playback.notAvailable` | 404 | La parte non ha una versione ascoltabile dall'utente | — | «Ascolto non ancora disponibile» |
| `scorePlayback.upload.empty` | 400 | Caricamento di un file vuoto | — | «Il file è vuoto» |
| `scorePlayback.upload.unsupportedFormat` | 415 | Il file non è MusicXML (`.musicxml`, `.xml`, `.mxl`) né, con il servizio OMR configurato, MIDI (`.mid`, `.midi`) | — | «Formato non supportato: caricare un file MusicXML (.musicxml, .xml, .mxl) o MIDI (.mid, .midi)» |
| `scorePlayback.upload.tooLarge` | 413 | Il file, la correzione o la parte scritta negli editor, o la sua bozza, supera la dimensione massima | `maxMegabytes` | «Il file supera {maxMegabytes} MB» |
| `scorePlayback.upload.invalid` | 422 | Il file non è una partitura MusicXML leggibile, o un MIDI convertibile | `reason`: `empty`, `malformed`, `notMusicXml`, `timewise`, `archive`, `archiveTooLarge`, `noParts`, `unreadable`, `unreadableMidi` | Testo per motivo, per esempio «Il file non è un MusicXML valido» |
| `scorePlayback.upload.partRequired` | 422 | Il file contiene più parti e non è indicata quella da importare | — | «Scegliere la parte da importare» |
| `scorePlayback.upload.partNotFound` | 422 | La parte indicata non è nel file | — | «La parte scelta non è presente nel file» |
| `scorePlayback.settings.invalid` | 422 | Trasposizione, suono o tempo fuori intervallo, anche nel dettaglio dello strumento; banco senza programma | — | «Impostazioni di ascolto non valide» |
| `scorePlayback.settings.versionConflict` | 409 | Le impostazioni di ascolto del brano sono state modificate da un'altra richiesta | — | «Il brano è stato modificato nel frattempo: ricaricare la pagina» |
| `scorePlayback.recognition.alreadyRunning` | 409 | Il riconoscimento della parte, o di tutte le parti con pagine, è già in coda o in corso | — | «Riconoscimento già in corso» |
| `scorePlayback.recognition.noPages` | 422 | La parte, o nessuna parte del brano, ha pagine da riconoscere | — | «Nessuna pagina da riconoscere» |
| `scorePlayback.omr.unavailable` | 503 | Il servizio di riconoscimento non è configurato o non risponde, per il riconoscimento o la conversione di un MIDI | — | «Servizio di riconoscimento non disponibile: riprovare più tardi» |
| `scorePlayback.correction.invalid` | 422 | La correzione scritta nell'editor non è un MusicXML con una sola parte, l'origine delle battute non corrisponde alla versione di partenza, oppure l'origine indicata non è né una correzione né una scrittura | `reason`: `empty`, `malformed`, `notMusicXml`, `timewise`, `noParts`, `severalParts`, `measureSources`, `origin` | Testo per motivo, per esempio «La correzione deve contenere una sola parte» |
| `scorePlayback.report.invalid` | 422 | Segnalazione senza descrizione, con una descrizione oltre 1000 caratteri o un numero di battuta oltre 16 caratteri | — | «Descrivere l'errore in al massimo 1000 caratteri» |
| `scorePlayback.report.limitReached` | 409 | L'utente ha già il numero massimo di segnalazioni aperte sulla parte | `maxOpen` | «Hai già {maxOpen} segnalazioni aperte su questa parte: attendi che vengano esaminate» |
| `scorePlayback.report.notFound` | 404 | Segnalazione inesistente o di un'altra traccia | — | «Segnalazione non trovata» |

### Scrittura musicale e blocco degli editor

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `scoreWriting.locked` | 409 | Un'altra sessione dell'editor, di scrittura o di correzione, ha il blocco della parte: all'apertura, al rinnovo, al salvataggio di una bozza o di una versione, o allo scarto di una bozza mentre qualcuno scrive. `ownerName` è il nome di chi ha il blocco, `since` l'istante ISO 8601 in cui l'ha preso, `sameUser` indica lo stesso utente in un'altra finestra | `ownerName` facoltativo, `since`, `sameUser` | «In modifica da {ownerName} dalle {since}», oppure «La parte è aperta in un'altra finestra dalle {since}» |
| `scoreWriting.sessionInvalid` | 400 | La sessione dell'editor manca o non è un identificativo di 8–64 lettere, cifre o trattini | — | «Sessione dell'editor non valida: ricaricare la pagina» |
| `scoreWriting.contentInvalid` | 422 | La bozza o la versione scritta non è un MusicXML con una sola parte | `reason`: `empty`, `malformed`, `notMusicXml`, `timewise`, `noParts`, `severalParts` | Testo per motivo, per esempio «La parte scritta deve contenere una sola parte» |
| `scoreWriting.draftConflict` | 409 | La bozza sul server è cambiata, o è stata eliminata, dopo che l'editor l'ha letta | — | «La bozza è stata modificata altrove: riaprire l'editor» |
| `scoreWriting.draftTooFrequent` | 429 | Salvataggio della stessa bozza prima dell'intervallo minimo dal precedente | — | Nessuno: l'editor riprova al salvataggio successivo |
| `scoreWriting.draftOutdated` | 409 | Salvataggio di una versione scritta quando un'altra versione è diventata corrente dopo l'inizio della scrittura, senza la conferma esplicita | — | «Nel frattempo è stata salvata un'altra versione della parte: confermare per sostituirla» |
| `scoreWriting.instrumentNotFound` | 400 | Uno degli strumenti scelti per una parte scritta da zero non esiste o è stato eliminato | — | «Uno degli strumenti scelti non esiste più: ricaricare la pagina» |

### Onboarding

| Chiave | HTTP | Quando si verifica | Parametri | Messaggio |
| --- | --- | --- | --- | --- |
| `onboarding.disabled` | 404 | Onboarding disattivato nella configurazione dell'applicazione | — | «La configurazione iniziale non è disponibile» |
| `onboarding.file.required` | 400 | Caricamento senza file | — | «Il file è obbligatorio» |
| `onboarding.file.tooLarge` | 413 | File oltre la dimensione massima configurata | `maxMegabytes` | «Il file supera {maxMegabytes} MB» |
| `onboarding.file.unreadable` | 400 | Impossibile leggere il file caricato | — | «Impossibile leggere il file» |
| `onboarding.csvSection.required` | 400 | File CSV senza indicazione della sezione | — | «Indicare la sezione del file CSV» |
| `onboarding.selectedSections.required` | 400 | File XLSX senza sezioni selezionate | — | «Selezionare almeno una sezione» |
| `onboarding.section.featureDisabled` | 400 | Una sezione richiede una funzionalità del tenant non disponibile | — | «La sezione richiede una funzionalità non disponibile per questo tenant» |
| `onboarding.job.notFound` | 404 | Importazione inesistente | — | «Importazione non trovata» |
| `onboarding.job.notReady` | 409 | Applicazione di un'importazione non pronta | — | «L'importazione non è pronta» |
| `onboarding.job.notCancellable` | 409 | Annullamento di un'importazione già applicata o in applicazione | — | «L'importazione non può essere annullata» |
| `onboarding.job.validationNotRetryable` | 409 | Nuova validazione di un'importazione non invalida né fallita | — | «La validazione non si può ripetere» |
| `onboarding.job.compensationNotRequired` | 409 | Ripristino di un'importazione che non lo richiede | — | «Il ripristino non è necessario» |
| `onboarding.job.sourceRemoved` | 409 | Nuova validazione o nuovo invio delle e-mail dopo che la conservazione ha eliminato file e righe | — | «Il file dell'importazione è stato eliminato» |
| `onboarding.idempotency.conflict` | 409 | Applicazione con una chiave diversa da quella già registrata per l'importazione | — | «L'importazione è già in applicazione da un'altra richiesta» |
| `onboarding.warnings.notAccepted` | 409 | Applicazione di un'importazione con avvisi non accettati | — | «Accettare gli avvisi prima di applicare l'importazione» |
| `onboarding.tenant.busy` | 409 | Un'altra importazione del tenant è in applicazione | — | «Un'altra importazione è già in corso» |
| `onboarding.pendingJobs.tooMany` | 409 | Caricamento con il limite di importazioni in attesa dello stesso utente già raggiunto | `maxPendingJobs` | «Ci sono già {maxPendingJobs} importazioni in attesa: completarle o annullarle prima di caricarne un'altra» |
| `onboarding.email.retryNotAllowed` | 409 | Nuovo invio delle e-mail su un'importazione non completata o senza invii falliti | — | «Nessuna e-mail da inviare di nuovo» |
