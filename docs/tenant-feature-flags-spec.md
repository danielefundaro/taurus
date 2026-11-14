# Funzionalità configurabili per tenant

## Stato del documento

ID catalogo: `tenant-feature-flags`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

I flag tenant descritti in questo documento sono tredici; `notification-delivery-generalization` resta esplicitamente fuori perimetro.

## Obiettivo

Consentire a un super amministratore di attivare o disattivare dalla pagina di dettaglio del singolo tenant:

- **Economia**;
- **Inventario**;
- **Onboarding e importazione iniziale**;
- **Feed calendario esterno**;
- **QR code inventario**;
- **Preferenze notifiche**;
- **Promemoria eventi Web Push**;
- **Preparazione evento**;
- **Ascolto delle parti**, aggiunto dopo la prima versione (vedi [Ascolto delle parti](#ascolto-delle-parti));
- **Fogli di affidamento** e **Firma elettronica**, aggiunti dopo la prima versione (vedi [Fogli di affidamento e firma elettronica](#fogli-di-affidamento-e-firma-elettronica));
- **Calendario**, aggiunto dopo la prima versione (vedi [Comportamento del Calendario](#comportamento-del-calendario));
- **Compensi ai presenti**, aggiunto dopo la prima versione (vedi [Compensi ai presenti](#compensi-ai-presenti)).

`notification-delivery-generalization` è esclusa da questa evolutiva: è un'infrastruttura trasversale autorevole e non una funzionalità tenant disattivabile.

La configurazione deve:

- essere indipendente per ogni tenant;
- controllare sia la visibilità nel frontend sia l'accesso reale nel backend;
- diventare effettiva per gli utenti già collegati senza richiedere logout e login;
- conservare tutti i dati quando una funzionalità viene disattivata;
- evitare l'introduzione di una WebSocket dedicata.

Ruoli e funzionalità sono verificati insieme:

```text
Accesso consentito = ruolo autorizzato AND funzionalità attiva per il tenant corrente
```

## Decisioni architetturali

1. I flag tenant sono memorizzati nella tabella pubblica `tenant`, non negli schemi dei singoli tenant.
2. I flag non sono inseriti nel token Keycloak, perché altrimenti sarebbe necessario rinnovare il token o ripetere il login per osservare le modifiche.
3. Il backend è sempre la fonte autorevole e verifica la funzionalità prima di eseguire un'operazione protetta.
4. Il frontend mantiene una copia in memoria della configurazione per decidere quali elementi mostrare.
5. Non viene aperto alcun canale WebSocket: il frontend aggiorna periodicamente la configurazione e reagisce comunque agli eventuali rifiuti del backend.
6. Disattivare una funzionalità non cancella, archivia o modifica i dati del relativo modulo.
7. Le proprietà applicative esistenti restano kill switch di installazione. Un flag tenant non può abilitare una capacità disabilitata a livello applicativo.
8. Il valore esposto agli utenti è sempre quello effettivo, calcolato applicando flag globale, flag tenant e dipendenze.

```text
Funzionalità effettiva = capacità applicativa AND flag tenant AND dipendenze effettive
```

La generalizzazione della consegna notifiche resta sempre attiva dopo il relativo rollout. Disabilitare Preferenze notifiche o Web Push non riattiva percorsi sincroni legacy e non crea un secondo dispatcher.

## Modello dati

### Tabella `public.tenant`

Aggiungere tramite Liquibase:

```text
finance_enabled                    BOOLEAN NOT NULL DEFAULT FALSE
inventory_enabled                  BOOLEAN NOT NULL DEFAULT FALSE
onboarding_import_enabled          BOOLEAN NOT NULL DEFAULT FALSE
external_calendar_feed_enabled     BOOLEAN NOT NULL DEFAULT FALSE
inventory_qr_enabled               BOOLEAN NOT NULL DEFAULT FALSE
notification_preferences_enabled   BOOLEAN NOT NULL DEFAULT FALSE
web_push_reminders_enabled         BOOLEAN NOT NULL DEFAULT FALSE
event_preparation_enabled          BOOLEAN NOT NULL DEFAULT FALSE
score_playback_enabled             BOOLEAN NOT NULL DEFAULT FALSE
inventory_loan_sheet_enabled       BOOLEAN NOT NULL DEFAULT FALSE
inventory_signature_enabled        BOOLEAN NOT NULL DEFAULT FALSE
calendar_enabled                   BOOLEAN NOT NULL DEFAULT FALSE
event_payouts_enabled              BOOLEAN NOT NULL DEFAULT FALSE
score_writing_enabled              BOOLEAN NOT NULL DEFAULT FALSE
```

Il valore predefinito è `FALSE`: nessuna funzionalità opzionale viene concessa implicitamente a un nuovo tenant. La creazione richiede quindi un'abilitazione esplicita da parte del super amministratore, oltre alla disponibilità applicativa e alle eventuali dipendenze.

La migration non deve sovrascrivere i valori `finance_enabled` e `inventory_enabled` già persistiti dai tenant esistenti: per queste colonne modifica soltanto il default dello schema. Le sei nuove colonne vengono invece aggiunte con `DEFAULT FALSE`, quindi i tenant esistenti partono con le nuove funzionalità disabilitate finché non vengono inclusi esplicitamente nel rollout. Allo stesso modo `20261016000001_tenant_score_playback_flag.xml` aggiunge `score_playback_enabled` con `DEFAULT FALSE`.

`20261104000000_tenant_calendar_flag.xml` aggiunge `calendar_enabled` con `DEFAULT FALSE` e, in un secondo changeset, lo porta a `TRUE` per tutti i tenant già presenti: prima di questo flag il calendario era sempre attivo e il rilascio non deve toglierlo a nessuno. Un tenant creato dopo la migration segue la regola generale e riceve il calendario solo se il super amministratore lo spunta.

`20261113000000_tenant_event_payouts_flag.xml` aggiunge `event_payouts_enabled` con `DEFAULT FALSE` e non lo attiva per nessun tenant esistente: prima del rilascio nessuno usava i compensi ai presenti, quindi non c'è un comportamento da preservare.

`20261114000000_tenant_score_writing_flag.xml` aggiunge `score_writing_enabled` con `DEFAULT FALSE`, per la stessa ragione: l'editor di scrittura è nuovo e nessun tenant lo riceve senza una scelta esplicita.

Non è necessario modificare gli schemi tenant: la configurazione è globale rispetto all'istanza del tenant e risiede nel catalogo pubblico.

### Modello backend

Aggiungere i campi a:

- `Tenants`;
- `TenantsDTO`;
- mapping MapStruct;
- metodi `equals`, `hashCode` e `toString`.

I campi dell'entità devono essere non null e inizializzati a `false`. Durante la creazione il servizio normalizza a `false` eventuali valori null provenienti da vecchi client. Durante un aggiornamento, invece, un campo omesso da un client precedente conserva il valore persistito e non deve disabilitare accidentalmente una funzionalità.

### Modello frontend

Aggiungere a `Tenants`:

```typescript
financeEnabled: boolean = false;
inventoryEnabled: boolean = false;
onboardingImportEnabled: boolean = false;
externalCalendarFeedEnabled: boolean = false;
inventoryQrEnabled: boolean = false;
notificationPreferencesEnabled: boolean = false;
webPushRemindersEnabled: boolean = false;
eventPreparationEnabled: boolean = false;
scorePlaybackEnabled: boolean = false;
inventoryLoanSheetEnabled: boolean = false;
inventorySignatureEnabled: boolean = false;
calendarEnabled: boolean = false;
eventPayoutsEnabled: boolean = false;
scoreWritingEnabled: boolean = false;
```

I nuovi tenant nascono con tutti i flag configurati a `false`. La pagina di creazione può consentire al super amministratore di abilitarli esplicitamente prima del salvataggio; in assenza di scelta rimangono disabilitati.

## Gestione nella pagina di dettaglio tenant

Nella pagina di dettaglio la sezione **Funzionalità disponibili** contiene checkbox PrimeNG binarie per tutti i flag tenant, divise in due gruppi: **Moduli principali**, le funzionalità autonome, ed **Estensioni**, quelle che dipendono da un modulo. L'appartenenza deriva dalle dipendenze dichiarate, quindi una funzionalità nuova finisce nel gruppo giusto senza altre modifiche. Il gruppo delle estensioni ricorda che restano inefficaci finché il modulo da cui dipendono è spento.

Ogni checkbox usa `[binary]="true"`, un `inputId` stabile e una `label` semanticamente associata. Accanto al controllo viene mostrato lo stato della capacità applicativa: **Disponibile**, **Non disponibile nell'installazione** oppure **Richiede un'altra funzionalità**.

I controlli, nell'ordine della pagina, sono:

- **Moduli principali**: Calendario; Economia; Inventario; Onboarding e importazione iniziale; Ascolto delle parti; Preferenze notifiche.
- **Estensioni**: Feed calendario esterno; Preparazione evento; QR code inventario; Fogli di affidamento; Firma elettronica; Compensi ai presenti; Promemoria eventi Web Push.

Una funzionalità può dipendere da più moduli: Promemoria eventi Web Push richiede sia Preferenze notifiche sia Calendario, e Compensi ai presenti sia Economia sia Calendario; ciascuna risulta **Richiede un'altra funzionalità** finché uno dei due è spento.

Ogni checkbox deve avere un `inputId`, una label associata e una breve descrizione. Esempio:

> Disabilitando Economia verranno nascosti conti, movimenti, rendiconti e informazioni economiche degli eventi. I dati saranno conservati.

Il cambiamento viene salvato insieme agli altri dati del tenant. Se una o più funzionalità passano da attive a disattive, prima del salvataggio viene mostrata un'unica conferma che elenca per nome gli effetti e le dipendenze che diventeranno inefficaci. La riattivazione non richiede conferma.

Il valore tenant rimane modificabile anche se il kill switch globale è spento, permettendo di preparare un rollout. In questo caso la UI mostra lo stato **Non disponibile nell'installazione** e spiega che cosa significa il valore scelto: con la checkbox attiva si tratta di un'abilitazione pianificata, che diventerà effettiva quando l'installazione renderà disponibile la funzionalità; con la checkbox spenta, che il valore viene comunque salvato.

Il salvataggio aggiorna atomicamente tutti i flag. Quando il client invia `entityVersion`, una versione diversa da quella persistita risponde `409` (`version.conflict`); senza `entityVersion` la versione non viene controllata.

## API delle funzionalità correnti

Esporre un endpoint minimale per tutti gli utenti autenticati:

```http
GET /api/tenant-features/current
```

Esempio di risposta:

```json
{
  "tenantCode": "ORCHESTRA_A",
  "tenantName": "Orchestra A",
  "version": 12,
  "financeEnabled": true,
  "inventoryEnabled": true,
  "onboardingImportEnabled": true,
  "externalCalendarFeedEnabled": false,
  "inventoryQrEnabled": true,
  "notificationPreferencesEnabled": true,
  "webPushRemindersEnabled": false,
  "eventPreparationEnabled": true,
  "scorePlaybackEnabled": false,
  "inventoryLoanSheetEnabled": true,
  "inventorySignatureEnabled": false,
  "calendarEnabled": true,
  "eventPayoutsEnabled": false,
  "scoreWritingEnabled": false
}
```

Requisiti:

- il codice tenant è ricavato esclusivamente dall'autenticazione e dal `TenantContext`;
- il client non può indicare il tenant tramite parametro o header applicativo;
- la risposta non espone il resto dell'anagrafica del tenant, a parte il nome (`tenantName`);
- tenant inesistente, eliminato o non valido produce un errore e non abilita funzionalità per impostazione predefinita;
- la risposta può essere mantenuta in memoria dal frontend, ma non deve essere incorporata nel token.

I booleani di questa risposta rappresentano lo stato **effettivo**, non il solo valore persistito. Il dettaglio amministrativo del tenant continua invece a restituire i valori configurati, necessari per modificarli e per conservare un'abilitazione pianificata mentre il kill switch globale è spento.

### Capacità dell'installazione

La pagina amministrativa interroga inoltre:

```http
GET /api/tenant-features/capabilities
```

L'endpoint è riservato al super amministratore da un matcher esplicito di `SecurityConfiguration`, posto prima della regola generale `/api/**`, e dall'annotazione `@PreAuthorize` della risorsa: gli altri ruoli ricevono `403` e una richiesta senza autenticazione `401`, mentre `GET /api/tenant-features/current` resta leggibile da ogni ruolo autenticato. Per ogni funzionalità opzionale restituisce soltanto:

- `available`, calcolato dalla configurazione applicativa e dalla presenza dei prerequisiti tecnici;
- `reasonCode`, valorizzato quando non disponibile;
- l'elenco stabile delle dipendenze tenant.

Non vengono mai restituiti URL interni, chiavi VAPID, segreti, nomi di bean o altri dettagli di configurazione. Il frontend usa questi metadati solo per spiegare lo stato; il backend ricalcola comunque capacità e dipendenze su ogni richiesta protetta.

DTO:

```java
public record TenantFeaturesDTO(
    String tenantCode,
    String tenantName,
    Long version,
    boolean financeEnabled,
    boolean inventoryEnabled,
    boolean onboardingImportEnabled,
    boolean externalCalendarFeedEnabled,
    boolean inventoryQrEnabled,
    boolean notificationPreferencesEnabled,
    boolean webPushRemindersEnabled,
    boolean eventPreparationEnabled,
    boolean scorePlaybackEnabled,
    boolean inventoryLoanSheetEnabled,
    boolean inventorySignatureEnabled,
    boolean calendarEnabled,
    boolean eventPayoutsEnabled,
    boolean scoreWritingEnabled
) {}
```

## Controllo centralizzato nel backend

L'enum `TenantFeature` associa a ogni funzionalità la chiave usata nei codici d'errore:

```java
public enum TenantFeature {
    FINANCE,
    INVENTORY,
    ONBOARDING_IMPORT,
    EXTERNAL_CALENDAR_FEED,
    INVENTORY_QR,
    NOTIFICATION_PREFERENCES,
    WEB_PUSH_REMINDERS,
    EVENT_PREPARATION,
    SCORE_PLAYBACK,
    INVENTORY_LOAN_SHEET,
    INVENTORY_SIGNATURE,
    CALENDAR,
    EVENT_PAYOUTS,
    SCORE_WRITING
}
```

e un servizio con operazioni equivalenti a:

```java
boolean isEnabled(TenantFeature feature);
void requireEnabled(TenantFeature feature);
```

`TenantFeatureService` deve:

1. ottenere il codice dal `TenantContext`;
2. cercare esattamente quel codice in `public.tenant`;
3. verificare che il tenant non sia eliminato e sia attivo;
4. valutare soltanto i flag della funzionalità richiesta e delle sue dipendenze;
5. negare l'accesso in assenza di un contesto tenant valido.

Non deve utilizzare uno stato statico condiviso tra tenant. Può leggere la configurazione applicativa immutabile per applicare il kill switch globale, ma questa non sostituisce il flag del tenant.

### Dipendenze e stato effettivo

| Funzionalità | Capacità applicativa | Dipendenze tenant | Stato effettivo |
| --- | --- | --- | --- |
| `CALENDAR` | sempre disponibile dopo il deploy | nessuna | `calendar_enabled` |
| `FINANCE` | sempre disponibile dopo il deploy | nessuna | `finance_enabled` |
| `INVENTORY` | sempre disponibile dopo il deploy | nessuna | `inventory_enabled` |
| `ONBOARDING_IMPORT` | `application.onboarding.enabled` | nessuna per il wizard; Economia e Inventario per le relative sezioni | globale AND `onboarding_import_enabled` |
| `EXTERNAL_CALENDAR_FEED` | `application.calendar-feed.enabled` | `CALENDAR` | globale AND `external_calendar_feed_enabled` AND `calendar_enabled` |
| `INVENTORY_QR` | `application.inventory.qr.enabled` e URL pubblico valido | `INVENTORY` | globale AND `inventory_qr_enabled` AND `inventory_enabled` |
| `INVENTORY_LOAN_SHEET` | sempre disponibile dopo il deploy | `INVENTORY` | `inventory_loan_sheet_enabled` AND `inventory_enabled` |
| `INVENTORY_SIGNATURE` | sempre disponibile dopo il deploy; posta, chiave dei codici e sigillo li verifica l'attivazione dell'amministratore del tenant | `INVENTORY_LOAN_SHEET` | `inventory_signature_enabled` AND fogli di affidamento effettivi |
| `NOTIFICATION_PREFERENCES` | `application.notification-preferences.enabled` | outbox generalizzata disponibile | globale AND `notification_preferences_enabled` |
| `WEB_PUSH_REMINDERS` | chiavi VAPID pubblica e privata non vuote e diverse da `CHANGE_ME` | `NOTIFICATION_PREFERENCES`, `CALENDAR` | capacità push AND `web_push_reminders_enabled` AND preferenze effettive AND `calendar_enabled` |
| `EVENT_PREPARATION` | `application.event-preparation.enabled` | `CALENDAR` | globale AND `event_preparation_enabled` AND `calendar_enabled` |
| `SCORE_PLAYBACK` | `application.score-playback.enabled` | nessuna | globale AND `score_playback_enabled` |
| `EVENT_PAYOUTS` | sempre disponibile dopo il deploy | `FINANCE`, `CALENDAR` | `event_payouts_enabled` AND `finance_enabled` AND `calendar_enabled` |
| `SCORE_WRITING` | `application.score-writing.enabled` e capacità dell'ascolto | `SCORE_PLAYBACK` | globale AND `score_writing_enabled` AND ascolto effettivo |

Economia non dipende dal Calendario e il Calendario non dipende da Economia: con il calendario spento Economia resta attiva e perde soltanto le informazioni economiche degli eventi (vedi [Comportamento del Calendario](#comportamento-del-calendario)). Economia e Inventario non sono prerequisiti dell'intera Preparazione evento. Quando sono disabilitati, soltanto le aree dipendenti escono dalla valutazione, come descritto nella [specifica di preparazione](event-preparation-spec.md#contratto-della-vista-completa).

Il backend calcola la matrice in un solo punto. Controller, scheduler, dispatcher e frontend non devono ricostruire autonomamente le dipendenze.

### Annotazione e interceptor

Per gli endpoint interamente appartenenti a un modulo è consigliata un'annotazione:

```java
@RequiresTenantFeature(TenantFeature.FINANCE)
```

Un interceptor MVC la verifica dopo `TenantContextInterceptor`. I normali controlli Spring Security sui ruoli restano invariati e vengono eseguiti prima dei controller.

Applicazioni:

| Endpoint | Funzionalità richiesta |
| --- | --- |
| `/api/calendar-events/**`, `/api/user/calendar-events/**`, `/api/external/calendar-events/**` e `/api/calendar-event-series/**` | `CALENDAR` |
| `GET /api/users/{id}/calendar-events`, `GET /api/users/me/calendar-events` e `GET /api/operations/calendar-events` | `CALENDAR` |
| `/api/finance/**` | `FINANCE` |
| `/api/finance/events/**`, `/api/finance/reports/events` e `/api/finance/reports/event-statement` | `FINANCE` e `CALENDAR` |
| `/api/finance/payouts/**` | `EVENT_PAYOUTS` |
| `/api/inventory/**` | `INVENTORY` |
| `/api/user/inventory/**` | `INVENTORY` |
| sotto `/api/onboarding/**`: `GET /context`, template XLSX e CSV, creazione, nuova validazione e applicazione | `ONBOARDING_IMPORT` |
| `/api/calendar-feeds/**` | `EXTERNAL_CALENDAR_FEED` |
| `/api/admin/calendar-feeds/**` | `EXTERNAL_CALENDAR_FEED` |
| endpoint QR, etichette, scansione e guasti | `INVENTORY_QR` |
| fogli di affidamento amministrativi e personali e modello del foglio, tranne intervallo di scadenza, rinnovo e sostituzione delle assegnazioni | `INVENTORY_LOAN_SHEET` |
| atti, prove, fascicolo e link di firma amministrativi, firme personali e attivazione della firma nel modello | `INVENTORY_SIGNATURE` |
| `/api/notification-preferences/**` e `/api/push-subscriptions` | `NOTIFICATION_PREFERENCES` |
| configurazione e pianificazione promemoria calendario | `WEB_PUSH_REMINDERS` |
| endpoint di preparazione amministrativi, personali, esterni ed economici | `EVENT_PREPARATION` |
| ascolto e correzione delle parti sotto `/api/tracks/{trackId}`, `/api/user/tracks/{trackId}` e `/api/external/tracks/{trackId}`; `GET /api/instruments/playback-suggestion` in `InstrumentsResource` | `SCORE_PLAYBACK` |
| blocco di modifica di una parte, `/api/tracks/{trackId}/scores/{scoreId}/edit-lock`, usato anche dall'editor di correzione | `SCORE_PLAYBACK` |
| bozza dell'editor di scrittura, `/api/tracks/{trackId}/scores/{scoreId}/score-draft`; il salvataggio di una versione scritta (`origin: WRITING`) lo verifica il servizio | `SCORE_WRITING` |

I requisiti sono cumulativi: gli endpoint economici degli eventi richiedono `FINANCE` e `CALENDAR`; quelli dei compensi ai presenti richiedono `EVENT_PAYOUTS`, che incorpora già entrambe le dipendenze; quelli economici di Preparazione richiedono `EVENT_PREPARATION` e `FINANCE`; quelli QR richiedono `INVENTORY_QR`, che incorpora già la dipendenza da `INVENTORY`. Consultazione di elenco, esiti, righe, problemi e rapporti Onboarding, eliminazione di un job, `retry-compensation`, `retry-setup-emails`, retention e cleanup non portano l'annotazione e non vengono bloccati dal flag.

Un'annotazione sul metodo sostituisce quella della classe: per questo gli endpoint degli eventi sotto `/api/finance` dichiarano entrambe le funzionalità, mentre gli endpoint dei promemoria nelle risorse del calendario dichiarano soltanto `WEB_PUSH_REMINDERS`, che include già `CALENDAR` tra le dipendenze.

Le operazioni interne non raggiunte tramite controller, in particolare job schedulati e dispatcher, devono chiamare esplicitamente `isEnabled` o `requireEnabled`.

### Risposta in caso di funzionalità disabilitata

Restituire `403 Forbidden` con un codice applicativo distinguibile dal normale errore di ruolo (`error.auth.forbidden`), nella forma prevista dallo [Standard degli errori applicativi](application-errors-standard.md):

```json
{
  "message": "error.tenantFeature.inventory.disabled"
}
```

Codici previsti:

```text
error.tenantFeature.finance.disabled
error.tenantFeature.inventory.disabled
error.tenantFeature.onboardingImport.disabled
error.tenantFeature.externalCalendarFeed.disabled
error.tenantFeature.inventoryQr.disabled
error.tenantFeature.notificationPreferences.disabled
error.tenantFeature.webPushReminders.disabled
error.tenantFeature.eventPreparation.disabled
error.tenantFeature.scorePlayback.disabled
error.tenantFeature.inventoryLoanSheet.disabled
error.tenantFeature.inventorySignature.disabled
error.tenantFeature.calendar.disabled
error.tenantFeature.eventPayouts.disabled
error.tenantFeature.scoreWriting.disabled
```

Il resolver anonimo del feed calendario e gli identificatori QR non restituiscono `403`: per non rivelare l'esistenza di token, tenant o oggetti rispondono `404` con lo stesso corpo usato per una credenziale inesistente. Gli endpoint autenticati di amministrazione e profilo usano invece il `403` applicativo distinguibile.

In una prima versione non è consigliata una cache backend: la lettura riguarda pochi booleani su una riga individuata da un codice univoco, mentre l'assenza di cache rende la modifica effettiva dalla richiesta successiva anche in un'installazione con più istanze applicative.

## Comportamento del Calendario

`calendarEnabled` (checkbox **Calendario**) governa eventi, serie ricorrenti, disponibilità, presenze e informazioni economiche degli eventi. Non ha capacità applicativa né dipendenze tenant; ne dipendono Feed calendario esterno, Preparazione evento, Promemoria eventi Web Push e Compensi ai presenti.

Quando `calendarEnabled` è `false`:

- la voce **Calendario** del menu e il pulsante della topbar non compaiono, e la rotta `/calendar` riporta alla dashboard;
- la dashboard non mostra **Prossimi eventi** e la sezione «Da fare» non interroga il provider del calendario;
- profilo e dettaglio utente non mostrano gli eventi a cui la persona ha partecipato;
- il tour guidato salta i passi dedicati agli eventi;
- gli endpoint del calendario, delle serie, degli eventi dell'utente e della dashboard degli eventi restituiscono `403 tenantFeature.calendar.disabled`;
- Feed calendario esterno, Preparazione evento, Promemoria eventi Web Push e Compensi ai presenti diventano inefficaci per dipendenza, conservando il proprio flag;
- le notifiche con sorgente `CALENDAR` sono escluse da lista e conteggio e quelle ancora in outbox sono soppresse;
- eventi, serie, disponibilità, presenze, preparazioni, scalette e costi restano nello schema del tenant.

Economia resta attiva e indipendente:

- la pagina Economia non mostra la scheda **Eventi**, i riquadri «Da incassare dagli eventi» e «Da pagare per gli eventi», gli eventi aperti, il filtro per evento dei movimenti né gli eventi economicamente aperti dell'esercizio;
- il dialog dei movimenti non offre la scelta dell'evento;
- gli endpoint economici degli eventi e i relativi rapporti restituiscono `403`;
- creando un movimento non si può collegarlo a un evento; modificandone uno già collegato il backend conserva evento e nome dell'evento registrati, anche se la richiesta non li contiene;
- il riepilogo dell'esercizio non elenca gli eventi aperti, mentre saldi e totali dei movimenti restano invariati.

Alla riattivazione eventi, collegamenti e informazioni economiche tornano visibili; le notifiche soppresse non vengono inviate in ritardo e i promemoria chiusi come `SKIPPED` non ripartono.

## Comportamento della funzionalità Economia

Quando `financeEnabled` è `false`:

- la voce **Economia** non compare nel menu;
- le rotte `/finance` e figlie non sono attivabili;
- il frontend non esegue chiamate tramite `FinanceService`;
- tutti gli endpoint `/api/finance/**` restituiscono `403`;
- conti, categorie, movimenti, trasferimenti, allegati, esercizi e rendiconti non sono utilizzabili;
- il job di riporto annuale salta il tenant;
- le notifiche con sorgente `FINANCE` non vengono mostrate o consegnate;
- Compensi ai presenti diventa inefficace per dipendenza, conservando il proprio flag.

### Integrazione con il Calendario

Il Calendario rimane disponibile. Devono invece essere nascosti:

- il campo **Compenso** (`fee`);
- la sezione **Costi** (`costs`);
- la sezione **Consuntivo economico**;
- il pulsante **Registra movimento**;
- gli stessi campi nei dialog di creazione evento e nella gestione delle serie ricorrenti.

Il frontend non deve richiedere il riepilogo economico dell'evento quando Economia è disabilitata.

### Conservazione dei dati economici del Calendario

La sola omissione dei campi nel frontend non è sufficiente. Attualmente l'aggiornamento di un evento sostituisce la collezione dei costi; una richiesta priva dei campi economici potrebbe quindi cancellare involontariamente dati esistenti.

Quando Economia è disabilitata, il backend deve applicare queste regole:

- nella lettura, restituire `fee = null` e `costs = []`;
- nell'aggiornamento di un evento, ignorare `fee` e `costs` ricevuti e conservare i valori persistiti;
- nella creazione di un evento, forzare `fee = null` e `costs = []`;
- applicare le stesse regole ai template e alle occorrenze delle serie ricorrenti;
- non bloccare le modifiche non economiche, come data, luogo, descrizione, disponibilità e promemoria.

Alla riattivazione di Economia, i valori precedenti tornano visibili.

## Comportamento della funzionalità Inventario

Quando `inventoryEnabled` è `false`:

- la voce **Inventario** non compare nel menu;
- tutte le rotte `/inventory/**` sono bloccate;
- la card Inventario non compare nella dashboard personale o amministrativa;
- la sezione delle assegnazioni non compare nel dettaglio utente;
- il frontend non invoca `InventoryService` o `UserInventoryService`;
- gli endpoint amministrativi e personali dell'Inventario restituiscono `403`;
- il job delle scadenze inventariali salta il tenant;
- le notifiche con sorgente `INVENTORY` non vengono mostrate o consegnate.

Alla riattivazione tornano disponibili oggetti, assegnazioni, fotografie, riconsegne e report esistenti.

## Comportamento di Onboarding e importazione iniziale

Quando `onboardingImportEnabled` è `false`:

- la voce **Configurazione iniziale** e il collegamento dal dettaglio tenant non compaiono;
- non è possibile creare, caricare, validare, applicare o ritentare un job;
- gli endpoint di mutazione sotto `/api/onboarding/**` restituiscono `403`;
- i worker non acquisiscono nuovi job del tenant negli stati precedenti ad `APPLYING`;
- file, staging, rapporti e audit già presenti vengono conservati secondo la normale retention.

La disattivazione non deve interrompere un job che ha già iniziato `APPLYING`, la finalizzazione Keycloak o una compensazione: queste operazioni raggiungono uno stato terminale per evitare identità o dati parziali. Restano inoltre consentiti, con le normali autorizzazioni, la consultazione dell'esito, il download del rapporto e le attività tecniche di compensazione e cleanup dei job esistenti. Queste eccezioni non consentono di avviare una nuova importazione.

Le sezioni **Inventario**, **Categorie**, **Conti** e **Saldi iniziali** hanno anche dipendenze proprie:

- con Inventario disabilitato, template, contesto e validazione non propongono né accettano la sezione Inventario;
- con Economia disabilitata, non propongono né accettano Categorie, Conti e Saldi iniziali;
- Strumenti e Utenti restano importabili se Onboarding è effettivamente attivo.

Il preflight ripete il controllo subito prima dell'applicazione. Se una dipendenza viene disabilitata dopo la validazione, il job torna `INVALID` senza iniziare modifiche esterne. Alla riattivazione i job non terminali possono essere rivalidati esplicitamente; non ripartono automaticamente.

## Comportamento del Feed calendario esterno

Quando `externalCalendarFeedEnabled` è `false`:

- le UI personali e amministrative per creare, ruotare, revocare o elencare feed sono nascoste;
- gli endpoint autenticati di gestione restituiscono `403`;
- il download anonimo di qualsiasi token del tenant restituisce `404` come un token inesistente;
- token, sottoscrizioni, UID, sequence e tombstone restano conservati;
- nessun feed viene revocato e nessun segreto viene ruotato automaticamente.

Il lifecycle che aggiorna UID, sequence e tombstone degli eventi continua anche durante la disattivazione, così la prima lettura successiva alla riattivazione rappresenta lo stato corrente senza perdere cancellazioni. Cleanup, retention, revoche dovute a cancellazione utente o tenant e procedure GDPR continuano a operare.

Il resolver pubblico legge il tenant dal registro globale del digest e verifica il flag prima di aprire lo schema tenant. Il risultato negativo non deve distinguere tra token inesistente, tenant inattivo e funzionalità disabilitata.

## Comportamento dei QR code inventario

`inventoryQrEnabled` è una funzionalità figlia di Inventario. Quando il flag QR oppure Inventario è `false`:

- stampa etichette, scansione, resolver, rotazione, azioni rapide e gestione guasti QR non sono disponibili;
- pulsanti, selezione multipla, pagina mobile e criticità QR della dashboard non compaiono;
- gli endpoint autenticati restituiscono `403`, mentre il resolver basato su codice restituisce `404` uniforme;
- i codici pubblici, le rotazioni, le segnalazioni e il relativo storico restano persistiti;
- le notifiche originate esclusivamente dai guasti QR non vengono prodotte o consegnate.

La disattivazione non rende disponibile per riuso alcun codice e non altera le normali operazioni Inventario. Alla riattivazione le vecchie etichette valide tornano risolvibili; i codici revocati rimangono revocati.

Il kill switch applicativo continua a proteggere l'intera installazione e la validazione dell'URL pubblico. Un tenant non può superare una configurazione applicativa QR non valida o disabilitata.

## Fogli di affidamento e firma elettronica

`inventoryLoanSheetEnabled` è una funzionalità figlia di Inventario e `inventorySignatureEnabled` è figlia dei Fogli di affidamento: la firma è effettiva solo con fogli e Inventario effettivi. La migration `20261021100000_tenant_loan_sheet_signature_flags.xml` attiva i fogli per i tenant che hanno già l'Inventario, perché i fogli ne facevano parte; la firma parte disattivata.

La firma elettronica ha due livelli: il super amministratore concede la funzionalità al tenant, l'amministratore del tenant la accende dalla pagina del modello del foglio, quando l'installazione ha posta, chiave dei codici e sigillo. Il valore usato da emissione, prese visione e pagina del modello è l'AND dei due.

Quando i Fogli di affidamento non sono effettivi:

- la sezione dei fogli nel dettaglio utente, il riquadro **Fogli di affidamento** de **I miei oggetti**, il pulsante e la rotta del modello del foglio non compaiono;
- gli endpoint dei fogli e del modello rispondono `403 tenantFeature.inventoryLoanSheet.disabled`; intervallo di scadenza, rinnovo e sostituzione delle assegnazioni restano operazioni dell'Inventario;
- i fogli esistenti restano coerenti: le nuove consegne a un foglio emesso entrano nel registro delle variazioni e le regole sulle assegnazioni collegate continuano a valere.

Quando la Firma elettronica non è effettiva:

- emissione e prese visione tornano al flusso senza codice, come con l'interruttore del tenant spento;
- il riquadro **Firme**, la sezione **Firme** del foglio, le impostazioni della firma nel profilo, la sezione della firma nel modello e la voce **Firma richiesta** della dashboard non compaiono;
- gli endpoint amministrativi e personali della firma rispondono `403 tenantFeature.inventorySignature.disabled` e i link dei genitori rispondono come non validi;
- le notifiche degli atti (`SIGNATURE_ACT`) non vengono prodotte o consegnate;
- atti, documenti, prove e fascicoli restano conservati e tornano disponibili alla riattivazione.

Retention dei fogli, eliminazione degli atti al termine del periodo di grazia, scadenza dei link e pulizia delle conferme continuano su tutti i tenant attivi: chi disattiva la firma deve scaricare prima i fascicoli da conservare.

## Comportamento delle Preferenze notifiche

Quando `notificationPreferencesEnabled` è `false`:

- la sezione di configurazione notifiche nel profilo e le relative azioni non compaiono;
- gli endpoint `/api/notification-preferences/**` restituiscono `403`;
- profili, preferenze di categoria, ore silenziose, pause e digest persistiti non vengono cancellati;
- il fan-out continua a usare l'outbox generalizzata, senza riattivare la consegna sincrona legacy;
- le notifiche `REQUIRED` e la normale cronologia in-app continuano a essere consegnate.

Il resolver ignora temporaneamente le preferenze personalizzate e applica il profilo di compatibilità: notifiche in-app abilitate, nessun nuovo push generico configurabile, nessun digest e nessuna ora silenziosa. In questo modo disabilitare la pagina delle preferenze non equivale a spegnere il sistema di notifiche.

Alla riattivazione tornano effettive le preferenze precedentemente salvate soltanto per nuovi fan-out. Le consegne già decise non vengono ricostruite e i digest scaduti non vengono inviati in ritardo.

## Comportamento dei Promemoria eventi Web Push

`webPushRemindersEnabled` controlla esclusivamente i promemoria push legati agli eventi; non spegne il trasporto Web Push condiviso usato da altre categorie.

Quando il flag è `false` o Preferenze notifiche non è effettivamente disponibile:

- profilo e dettaglio evento non mostrano impostazioni relative ai promemoria push;
- creazione, aggiornamento e disponibilità degli eventi ignorano i campi push ricevuti, conservando i valori persistiti sulle entità esistenti;
- non vengono pianificati nuovi promemoria per il tenant;
- i job pendenti vengono marcati `SKIPPED` con motivo tecnico `FEATURE_DISABLED`, non mantenuti in backlog per una consegna tardiva;
- sottoscrizioni browser e credenziali del dispositivo restano conservate perché possono servire ad altri push;
- cleanup degli endpoint scaduti, retention e GDPR continuano a essere eseguiti.

La riattivazione ricalcola soltanto i promemoria futuri ancora utili e idempotenti, senza recuperare finestre già trascorse. La capacità effettiva resta falsa se le chiavi VAPID pubblica e privata sono vuote o valgono `CHANGE_ME`.

## Comportamento della Preparazione evento

Quando `eventPreparationEnabled` è `false`:

- il workspace, le sezioni, gli indicatori e le azioni di preparazione scompaiono dal dettaglio evento;
- gli endpoint amministrativi, personali, esterni ed economici di preparazione restituiscono `403`;
- la dashboard operativa non interroga il provider di preparazione;
- lo scheduler non produce promemoria o follow-up di preparazione per il tenant;
- programma, configurazione, materiali e conferme restano nelle relative tabelle.

Calendario, disponibilità, presenze, tracce, spartiti, Inventario ed Economia continuano a funzionare secondo i rispettivi flag. Se Preparazione è attiva ma Economia o Inventario sono disabilitati, le aree che ne dipendono (materiali, preventivo, chiusura economica) escono dalla valutazione e i relativi requisiti sono restituiti come non richiesti; la valutazione non diventa `UNKNOWN`, elenca in `excludedAreas` le aree richieste dal piano ma non valutate, che l'amministratore vede segnalate, e le altre aree restano utilizzabili. Non vengono eseguite chiamate ai moduli disabilitati.

Alla riattivazione gli hash di conferma vengono rivalutati sui dati correnti. Taurus non forza una conferma precedente a tornare valida e non genera retroattivamente notifiche la cui scadenza è trascorsa.

## Compensi ai presenti

`eventPayoutsEnabled` (checkbox **Compensi ai presenti**, gruppo **Estensioni**) governa la ripartizione del compenso degli eventi fra i presenti, i pagamenti fissi e le liquidazioni descritti in [Ripartizione dei compensi ai presenti](event-payout-shares-spec.md). Non ha capacità applicativa; dipende da Economia e da Calendario, perché le quote nascono dalle presenze e dal preventivo e consuntivo degli eventi e la liquidazione è un movimento economico.

Quando la funzionalità non è effettiva, per il flag spento o per una dipendenza spenta:

- la scheda **Compensi** della pagina Economia e il pulsante **Ripartisci compenso** del dettaglio evento non compaiono; se la scheda è aperta, l'utente torna ai movimenti e resta nella pagina Economia;
- la guida di pagina di Economia salta la tappa della scheda **Compensi** (`page.finance.payouts`);
- gli endpoint `/api/finance/payouts/**` rispondono `403 tenantFeature.eventPayouts.disabled`;
- le notifiche `PAYOUT_*` non vengono prodotte né consegnate;
- parametri, fattori, pagamenti fissi e righe di liquidazione restano nello schema del tenant;
- i movimenti generati dalle liquidazioni restano normali movimenti di Economia; la loro eliminazione continua a liberare le righe di liquidazione collegate, perché la regola appartiene al modulo economico.

Alla riattivazione le quote vengono ricalcolate sui dati correnti e confrontate con quanto già liquidato.

## Ascolto delle parti

`scorePlaybackEnabled` (checkbox **Ascolto delle parti**) governa l'ascolto e la correzione delle parti descritti in [Ascolto e correzione delle parti](track-score-playback-spec.md). La capacità applicativa è `application.score-playback.enabled`; non ha dipendenze tenant.

Quando la funzionalità non è effettiva:

- gli endpoint di ascolto sotto `/api/tracks/{trackId}`, `/api/user/tracks/{trackId}` e `/api/external/tracks/{trackId}` e `GET /api/instruments/playback-suggestion` rispondono `403 tenantFeature.scorePlayback.disabled`;
- le pagine di traccia e strumento non mostrano i relativi controlli;
- il recupero del riconoscimento (`ScoreRecognitionRecovery`) e la pulizia delle versioni (`ScoreVersionCleanup`) saltano il tenant;
- la validazione dell'onboarding non propone suono e trasposizione degli strumenti;
- parti, versioni e configurazioni degli strumenti restano conservate.

## Scrittura delle parti

`scoreWritingEnabled` (checkbox **Scrittura delle parti**, gruppo **Estensioni**) governa l'editor di scrittura descritto in [Editor di scrittura musicale](music-writing-editor-spec.md). La capacità applicativa è `application.score-writing.enabled`, insieme a quella dell'ascolto; dipende dall'Ascolto delle parti, perché le parti scritte diventano versioni ascoltabili.

Quando la funzionalità non è effettiva:

- gli endpoint della bozza rispondono `403 tenantFeature.scoreWriting.disabled`, e così il salvataggio di una versione scritta;
- il blocco di modifica delle parti resta attivo, perché lo prende anche l'editor di correzione, e con lui il salvataggio delle correzioni;
- bozze e versioni scritte restano conservate; la pulizia notturna dei blocchi scaduti e delle bozze di parti eliminate vale per ogni tenant attivo, anche con la funzionalità spenta.

## Protezione dei file

Gli endpoint specifici di fotografie e allegati sono coperti dal controllo del rispettivo modulo. Anche l'accesso generico a `/api/media/**`, aperto agli utenti privilegiati del tenant, verifica le funzionalità.

Prima di restituire un file, il backend (`MediaServiceImpl`) determina se il media è collegato a entità Economia o Inventario:

- se è collegato esclusivamente a un modulo disabilitato, l'accesso viene negato;
- se è collegato anche a un modulo ancora accessibile, valgono le normali autorizzazioni di quel modulo;
- non bisogna affidarsi soltanto al prefisso dello `storageKey`: la relazione nel database è la fonte autorevole.

Le procedure GDPR, la pulizia degli orfani e le attività di conservazione devono continuare a elaborare i media anche quando il relativo modulo è disabilitato.

## Sincronizzazione del frontend

Introdurre un `TenantFeatureService` singleton, preferibilmente basato su signal Angular, che esponga:

```typescript
financeEnabled: Signal<boolean>;
inventoryEnabled: Signal<boolean>;
onboardingImportEnabled: Signal<boolean>;
externalCalendarFeedEnabled: Signal<boolean>;
inventoryQrEnabled: Signal<boolean>;
notificationPreferencesEnabled: Signal<boolean>;
webPushRemindersEnabled: Signal<boolean>;
eventPreparationEnabled: Signal<boolean>;
scorePlaybackEnabled: Signal<boolean>;
inventoryLoanSheetEnabled: Signal<boolean>;
inventorySignatureEnabled: Signal<boolean>;
calendarEnabled: Signal<boolean>;
eventPayoutsEnabled: Signal<boolean>;
scoreWritingEnabled: Signal<boolean>;
loaded: Signal<boolean>;
refresh(force?: boolean): Observable<TenantFeatures>;
```

Comportamento:

- caricamento subito dopo l'autenticazione e prima di mostrare le parti condizionali del layout;
- aggiornamento ogni 60 secondi, solo quando la scheda è visibile;
- aggiornamento quando la scheda torna in primo piano, se lo stato è scaduto;
- aggiornamento durante la navigazione, se sono trascorsi almeno 60 secondi dall'ultima lettura;
- una sola richiesta concorrente condivisa tra menu, guard e componenti;
- aggiornamento immediato dopo il salvataggio del tenant se il tenant modificato coincide con quello della sessione corrente.

Durante il caricamento iniziale, gli elementi soggetti a feature devono rimanere nascosti per evitare che appaiano brevemente e poi scompaiano.

Non è necessario usare `localStorage`: una nuova scheda può leggere nuovamente la configurazione, mentre una copia persistente rischierebbe di mostrare dati obsoleti o appartenenti a un tenant selezionato in precedenza.

### Organizzazione e ruolo nella topbar

La topbar mostra, accanto al logo, il nome del tenant della sessione (`tenantName` della risposta di `GET /api/tenant-features/current`). Così chi appartiene a più organizzazioni vede in ogni pagina quella scelta all'accesso.

Regole:

- il nome compare per tutti i ruoli e per tutti gli utenti, anche per chi ha un solo tenant: la topbar non sa quanti tenant ha la persona e non lo deve rivelare;
- il tenant si sceglie nel selettore Keycloak a ogni accesso (`TenantRoleSelectorAuthenticator`); durante la sessione la topbar non offre un cambio di tenant;
- il nome è quello letto da `TenantFeatureService` e si aggiorna con gli stessi refresh dei flag, quindi una modifica dal dettaglio tenant compare senza nuovo accesso;
- nella modalità bootstrap del primo accesso, quando il tenant non ha ancora uno schema attivo ([Schema PostgreSQL per tenant](postgres-tenant-schemas.md)), al posto del nome compare «Primo accesso»;
- se il nome è vuoto o la lettura non è riuscita, la topbar non mostra nulla al suo posto;
- un nome lungo è troncato con i puntini su una sola riga e resta leggibile per intero nel tooltip nativo (`title`); sotto i 576 pixel il testo si riduce.

Il ruolo della sessione segue il nome, nella forma «Orchestra A · Tesoriere», solo quando l'utente l'ha scelto tra più ruoli del tenant selezionato:

- il selettore Keycloak registra nella sessione utente se il tenant scelto offriva più ruoli (nota `selected_role_choice`); `tenant-role-mapper` aggiunge allora al token il claim `role_choice` con valore `true`, e lo omette negli altri casi;
- chi ha un solo ruolo nel tenant scelto non vede il ruolo, anche se ne ha altri in tenant diversi;
- l'etichetta è quella italiana di `RoleLabelsMap`; un ruolo senza etichetta non è mostrato;
- in modalità bootstrap compare solo «Primo accesso», senza ruolo;
- il nome dell'organizzazione cede spazio al ruolo, che resta sempre intero; il tooltip riporta nome e ruolo insieme;
- le sessioni aperte prima dell'aggiornamento del provider non hanno il claim e non mostrano il ruolo fino al nuovo accesso.

## Route guard e componenti frontend

Creare un `tenantFeatureGuard` che legga dalla route:

```typescript
data: { feature: TenantFeature.INVENTORY }
```

Usarlo sulle route lazy-loaded `/inventory`, `/finance` e `/calendar`, insieme al guard dei ruoli. Il guard deve attendere il primo caricamento della configurazione e reindirizzare alla dashboard quando la feature non è disponibile.

Principali punti di applicazione:

| Area frontend | Regola |
| --- | --- |
| Menu | Filtrare Calendario, Economia e Inventario prima di costruire il modello |
| Topbar | Nascondere il pulsante Calendario finché i flag non sono letti o quando il calendario è spento |
| Dashboard | Non creare la card Inventario né il widget dei prossimi eventi e non avviare le loro richieste |
| Dettaglio utente | Non creare `InventoryAssignmentsComponent` né la tabella degli eventi a cui ha partecipato |
| Profilo | Nascondere gli eventi a cui si è partecipato |
| Economia | Senza Calendario nascondere scheda Eventi, riepiloghi, filtro e scelta dell'evento nei movimenti |
| Tour guidato | Saltare i passi degli eventi senza Calendario |
| Dettaglio evento | Nascondere compenso, costi e consuntivo |
| Dialog nuovo evento | Nascondere il compenso |
| Route Calendario/Economia/Inventario | Impedire anche l'accesso diretto tramite URL |
| Menu e dettaglio tenant | Nascondere collegamenti Onboarding quando non effettivo |
| Profilo e amministrazione feed | Nascondere gestione e URL del feed calendario |
| Inventario | Nascondere etichette, scansione, rotazione, azioni rapide e guasti QR |
| Profilo notifiche | Nascondere preferenze, digest, silenzioso e pausa |
| Profilo e dettaglio evento | Nascondere configurazione dei promemoria Web Push |
| Dettaglio evento e dashboard | Non creare workspace o provider di Preparazione evento |
| Economia e dettaglio evento | Nascondere la scheda Compensi, la sua tappa nella guida di pagina e il pulsante Ripartisci compenso, senza chiamare gli endpoint dei compensi |

## Modifica mentre l'utente è collegato

Non è richiesto logout/login.

Se un utente si trova già in una funzionalità appena disabilitata:

1. al successivo aggiornamento periodico il frontend aggiorna il menu e lo reindirizza alla dashboard;
2. se prima dell'aggiornamento prova a eseguire un'operazione, il backend risponde immediatamente `403`;
3. l'interceptor HTTP (`http-interceptor.service.ts`, comportamento `tenantFeatureDisabled` di `api-error-behaviors.ts`) riconosce il codice `tenantFeature.*.disabled`, mostra il toast, forza il refresh dei flag e naviga a `/` soltanto se la pagina aperta è quella dedicata a quella funzionalità.

Messaggio suggerito:

> La funzionalità Inventario non è disponibile per questa istanza.

Il normale `403` dovuto a un ruolo insufficiente continua invece a produrre il messaggio **Permesso negato**.

Per le funzionalità incorporate in una pagina condivisa, come Preparazione evento, Preferenze notifiche, QR inventario o Compensi ai presenti, la navigazione a `/` non avviene: l'utente resta dov'è e il refresh dei flag fa sparire la sola sezione interessata. La distinzione non è un elenco da mantenere: una pagina è dedicata a una funzionalità quando una route dell'albero attivo la dichiara in `data.feature`, come fa `tenantFeatureGuard`.

Una disattivazione dipendente produce lo stesso aggiornamento. Per esempio, spegnere Inventario rende immediatamente inefficace anche QR inventario pur conservando `inventoryQrEnabled = true` come configurazione pianificata.

Una richiesta già iniziata prima del commit della modifica potrebbe concludersi. Tutte le nuove richieste effettuate dopo il commit vengono bloccate.

## Notifiche

Il dominio possiede già le sorgenti `FINANCE`, `INVENTORY` e `CALENDAR`, che devono essere utilizzate per il filtro.

Quando una funzionalità è disabilitata:

- la lista delle notifiche esclude la sorgente corrispondente;
- il conteggio delle notifiche non lette applica lo stesso filtro;
- le notifiche esistenti restano conservate nello schema tenant;
- gli eventi non ancora consegnati presenti nell'outbox vengono marcati come soppressi e non inviati;
- nessun nuovo evento applicativo del modulo dovrebbe essere generato, perché le relative operazioni sono già bloccate.

Per i nuovi flag valgono inoltre queste regole:

- le notifiche con sorgente `CALENDAR` richiedono il Calendario, oltre all'eventuale funzionalità propria del tipo, come Preparazione evento;
- le notifiche di QR inventario (`INVENTORY_ISSUE`), Preparazione evento, atti della firma elettronica (`SIGNATURE_ACT`) e compensi ai presenti (`EVENT_PAYOUT`) sono soppresse quando la funzionalità origine non è effettiva; l'Onboarding non produce notifiche e `NotificationFeaturePolicy` non ha una regola per esso;
- disabilitare Preferenze notifiche non sopprime le notifiche: applica il profilo di compatibilità e conserva quelle obbligatorie;
- disabilitare Promemoria Web Push chiude come `SKIPPED` soltanto i job reminder interessati;
- la generalizzazione della consegna e il relativo scheduler restano attivi per tutti i tenant.

`NotificationSource` non è abbastanza granulare per applicare questi controlli: QR inventario condivide `INVENTORY`, mentre Preparazione evento condivide aree calendario e finanza. Introdurre quindi una `NotificationFeaturePolicy` centralizzata che associ i tipi di evento notificabili a un eventuale `TenantFeature`. Publisher e dispatcher la consultano rispettivamente prima dell'enqueue e prima della consegna. Gli eventi senza associazione continuano normalmente; non si aggiungono dispatcher alternativi e non si deduce la funzionalità analizzando testo o prefissi liberi.

Per gli eventi già `PENDING` al momento della disattivazione, il dispatcher applica nuovamente la policy e li marca con lo stato terminale di soppressione già previsto. La riattivazione non li rimette in coda.

Alla riattivazione possono ricomparire le notifiche già consegnate e conservate, mentre quelle esplicitamente soppresse nell'outbox non devono essere inviate in ritardo.

## Processi schedulati

`TenantSchemaRegistry.findActiveTenantCodes` restituisce tutti i tenant attivi. Per evitare query dinamiche sui nomi delle colonne, il registro offre metodi espliciti soltanto per tre funzionalità:

```java
List<String> findFinanceEnabledTenantCodes();
List<String> findInventoryEnabledTenantCodes();
List<String> findEventPreparationEnabledTenantCodes();
```

Le altre funzionalità iterano i tenant attivi e verificano il flag con `TenantFeatureService.isEnabledForTenant`, oppure con `isEnabled` nel contesto del tenant.

Utilizzo:

- `FinanceRolloverScheduler` usa soltanto i tenant con Economia attiva;
- `InventoryExpirationNotificationScheduler` usa soltanto i tenant con Inventario attivo;
- i worker Onboarding acquisiscono nuovi job soltanto per tenant con Onboarding effettivo, fermo restando il completamento sicuro di applicazioni e compensazioni già iniziate;
- il resolver del feed applica il flag prima di aprire lo schema, mentre lifecycle, tombstone cleanup e revoche di sicurezza continuano su tutti i tenant attivi;
- dashboard e notifiche QR elaborano soltanto tenant con Inventario e QR effettivi;
- dispatcher di preferenze e digest applicano il profilo di compatibilità ai tenant con Preferenze disabilitate;
- lo scheduler Web Push non pianifica o consegna reminder evento per tenant con il flag disabilitato o senza Calendario;
- lo scheduler Preparazione evento usa soltanto i tenant con Preparazione effettiva: la query di `findEventPreparationEnabledTenantCodes` richiede anche `calendar_enabled`;
- recupero del riconoscimento e pulizia delle versioni delle parti saltano i tenant senza Ascolto delle parti effettivo;
- scheduler generici, GDPR, retention e pulizia media continuano a usare tutti i tenant attivi.

## Isolamento tra tenant

L'isolamento è garantito da quattro regole:

1. il codice tenant viene ricavato dall'identità autenticata;
2. il controllo legge una sola riga di `public.tenant` tramite il codice esatto;
3. ogni operazione sui dati continua a usare lo schema selezionato dal `TenantContext`;
4. scheduler e processi trasversali iterano liste di tenant filtrate per funzionalità.

Esempio:

```text
Tenant A: Economia ON,  Inventario OFF
Tenant B: Economia ON,  Inventario ON
```

Una richiesta Inventario di A riceve `403`; la stessa richiesta autenticata sul tenant B continua a usare esclusivamente lo schema di B.

## Logging e audit

Ogni modifica dei flag produce in `TenantsServiceImpl.update` il log strutturato `tenant_features_updated` contenente:

- ID e codice del tenant modificato;
- valore precedente e nuovo valore di ciascun flag;
- identificativo dell'amministratore;
- data e ora;
- versione dell'entità.

Il log elenca in `dependentChanges` le funzionalità figlie il cui flag non cambia ma il cui stato effettivo cambia perché cambia una funzionalità da cui dipendono, anche in modo indiretto, con il nuovo stato effettivo di ciascuna. Le dipendenze sono dichiarate una sola volta, in `TenantFeature.dependencies()`, e sono le stesse usate per calcolare lo stato effettivo.

Non devono essere registrati token o altri dati sensibili. I normali campi di audit del tenant continuano a indicare autore e data dell'ultima modifica.

## Piano di test

### Backend

- migrazione che conserva Economia e Inventario dei tenant esistenti, imposta a `false` le sei nuove colonne e modifica a `FALSE` tutti i default dello schema;
- creazione di un tenant con valori omessi da un vecchio client, verificando tutti i flag a `false`;
- aggiornamento da un vecchio client con campi omessi, verificando la conservazione dei valori persistiti;
- lettura delle funzionalità del tenant corrente;
- capacità dell'installazione leggibili dal solo super amministratore, con `403` per gli altri ruoli e `401` senza autenticazione (`TenantFeaturesSecurityConfigurationTest`);
- calcolo centralizzato tra kill switch globale, flag tenant e dipendenze;
- rifiuto in assenza di un tenant valido;
- `403` su ogni endpoint Economia e Inventario disabilitato;
- accesso invariato quando la funzionalità è attiva;
- test con tenant A disabilitato e tenant B abilitato nella stessa esecuzione;
- conservazione di `fee` e `costs` durante l'aggiornamento di un evento;
- conservazione dei dati nelle serie ricorrenti;
- protezione di allegati, fotografie e accesso media generico;
- esclusione del tenant dai job specifici;
- filtro coerente tra lista notifiche e conteggio non letti;
- esecuzione invariata di GDPR, retention e pulizia media;
- blocco di nuovi job Onboarding e completamento sicuro di `APPLYING` o compensazione;
- rifiuto delle sezioni Onboarding Economia/Inventario quando il modulo padre è disabilitato;
- `404` uniforme del feed pubblico disabilitato e conservazione di token, sequence e tombstone;
- QR inefficace quando Inventario è disabilitato e riutilizzo impossibile dei codici esistenti;
- profilo di compatibilità quando Preferenze notifiche è disabilitata;
- reminder Web Push pendenti marcati `SKIPPED` senza consegna tardiva;
- Preparazione evento assente, dati conservati e aree Economia/Inventario degradate indipendentemente;
- Calendario spento: `403` sugli endpoint degli eventi, dipendenti inefficaci, notifiche `CALENDAR` soppresse, provider della dashboard saltato, collegamento dei movimenti agli eventi conservato e nessun evento aperto nell'esercizio (`TenantFeatureServiceTest`, `TenantsServiceImplTest`, `NotificationFeaturePolicyTest`, `OperationalDashboardServiceTest`, `FinanceServiceGuardsTest`);
- Compensi ai presenti: stato effettivo falso con il flag spento o con Economia o Calendario spenti, `403 tenantFeature.eventPayouts.disabled` su ogni endpoint con i tenant A, C e D esclusi e il tenant B ammesso nella stessa esecuzione, notifiche `PAYOUT_*` soppresse e righe di liquidazione liberate dall'eliminazione del movimento (`TenantFeatureServiceTest`, `PayoutResourceFeatureTest`, `NotificationFeaturePolicyTest`, `FinanceServiceGuardsTest`, `PayoutIT`);
- verifica che l'outbox generalizzata rimanga l'unico percorso con ogni combinazione di flag.

### Frontend

- caricamento e aggiornamento di `TenantFeatureService`;
- deduplicazione delle richieste concorrenti;
- menu con tutte le combinazioni dei flag;
- blocco delle route dirette;
- assenza della card Inventario e delle relative chiamate API;
- assenza dell'Inventario nel dettaglio utente;
- assenza dei campi economici nel Calendario e nei dialog;
- mancata chiamata a `FinanceService` quando Economia è disabilitata;
- aggiornamento periodico e al ritorno in primo piano;
- gestione specifica del `403` per feature disabilitata;
- conferma prima della disattivazione dal dettaglio tenant;
- rendering delle tredici checkbox nei due gruppi, stato della capacità applicativa, spiegazione dell'abilitazione pianificata e dipendenze;
- permanenza nella pagina condivisa, e uscita dalla sola pagina dedicata, quando una funzionalità viene disattivata;
- Onboarding nascosto e polling interrotto dopo la disattivazione;
- gestione feed nascosta senza esporre URL o token conservati;
- assenza di comandi QR e chiamate resolver quando QR o Inventario sono disabilitati;
- sezione Preferenze notifiche nascosta senza influire sul centro notifiche obbligatorio;
- impostazioni reminder nascoste senza disabilitare push di altre categorie;
- workspace Preparazione e relativo provider dashboard non creati quando disabilitati;
- combinazioni padre/figlio, compreso il ripristino automatico dell'efficacia del figlio quando il padre viene riattivato;
- Calendario spento: menu, topbar, route, dashboard, profilo, dettaglio utente, tour guidato e pagina Economia senza eventi;
- Compensi ai presenti: scheda, pulsante e tappa della guida di Economia assenti senza la funzionalità, scheda chiusa sui movimenti quando viene disattivata mentre è aperta, checkbox tra le estensioni con Economia e Calendario come dipendenze.

### Test di accettazione multi-tenant

1. Configurare A con Inventario disattivato e B con Inventario attivato.
2. Accedere contemporaneamente ai due tenant.
3. Verificare che A non mostri menu, card e pagine Inventario.
4. Verificare che una chiamata manuale di A riceva `403`.
5. Verificare che B continui a visualizzare e modificare i propri dati.
6. Riattivare Inventario per A e verificare la ricomparsa dei dati precedenti senza nuovo login.
7. Ripetere la matrice per Economia, includendo i dati economici del Calendario.
8. Ripetere attivazione, disattivazione e riattivazione per ciascuno dei sei nuovi flag, verificando che i dati precedenti ricompaiano.
9. Verificare `INVENTORY_QR = true` con Inventario disabilitato e `WEB_PUSH_REMINDERS = true` con Preferenze notifiche disabilitata.
10. Disabilitare Onboarding durante validazione e durante applicazione, verificando rispettivamente arresto sicuro e completamento atomico.
11. Verificare che un token feed del tenant disabilitato restituisca `404`, mentre lo stesso endpoint continui a funzionare per un altro tenant.
12. Verificare che la consegna generalizzata delle notifiche degli altri moduli non venga mai disattivata.
13. Spegnere il Calendario per A con Economia attiva: A non vede eventi né economia degli eventi, i movimenti già collegati conservano l'evento, B continua a usare il proprio calendario; riattivandolo A ritrova eventi e collegamenti.
14. Attivare Compensi ai presenti per B e non per A: A non vede la scheda Compensi e riceve `403` sugli endpoint dei compensi, B simula e liquida; spegnendo Economia o Calendario per B la scheda sparisce, e riattivandoli B ritrova parametri, fattori, pagamenti fissi e liquidazioni.

## Strategia di rilascio

Ordine consigliato:

1. aggiungere la migrazione pubblica con tutti i default a `FALSE`, preservando i valori Economia e Inventario già persistiti;
2. mantenere spenti i kill switch delle capacità non ancora rilasciate e configurare i tenant pilota;
3. distribuire il calcolo centralizzato delle dipendenze, gli endpoint e i controlli backend;
4. proteggere Calendario, file, notifiche, resolver pubblici, worker e scheduler;
5. distribuire servizio, guard e condizioni frontend;
6. eseguire i test multi-tenant e padre/figlio;
7. abilitare i kill switch globali e poi i tenant secondo il piano di rollout;
8. disattivare manualmente una funzionalità soltanto dopo aver verificato le regole per attività in corso e dati conservati.

Questo ordine mantiene compatibile il frontend precedente durante il rilascio. In caso di problemi operativi, riattivare i flag interessati ripristina immediatamente l'accesso senza dover recuperare o migrare dati.

## Criteri di accettazione

La funzionalità è completata quando:

- tutti i tredici flag sono modificabili dalla pagina di dettaglio tenant;
- menu, route, card e azioni collegate rispettano i flag;
- il backend impedisce ogni accesso diretto ai moduli disabilitati;
- il Calendario resta utilizzabile senza mostrare o alterare dati economici nascosti;
- la dashboard e il dettaglio utente non interrogano Inventario quando è disabilitato;
- i processi schedulati e le notifiche rispettano la configurazione;
- una modifica diventa visibile agli utenti collegati entro 60 secondi, senza logout;
- i dati tornano disponibili alla riattivazione;
- la configurazione di un tenant non produce alcun effetto sugli altri tenant;
- kill switch globale, flag tenant e dipendenze producono uno stato effettivo unico e coerente tra backend e frontend;
- Onboarding non lascia job o identità in stato parziale quando viene disabilitato;
- Feed calendario e QR usano una risposta non enumerabile sui resolver basati su token o codice;
- disabilitare Preferenze notifiche non disabilita l'outbox né le notifiche obbligatorie;
- disabilitare Web Push reminder non spegne i push di altre categorie e non causa invii tardivi;
- Preparazione evento conserva dati e conferme, degradando separatamente le aree Economia e Inventario;
- spegnere il Calendario conserva tutti i dati degli eventi e lascia Economia utilizzabile senza alterare i collegamenti esistenti;
- Compensi ai presenti è effettiva soltanto con Economia e Calendario attivi e la sua disattivazione conserva parametri, fattori, pagamenti fissi e liquidazioni;
- `notification-delivery-generalization` non compare tra i controlli tenant e resta l'unico meccanismo di consegna.
