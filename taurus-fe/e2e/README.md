# Suite end to end

Guida un browser reale contro un'istanza completa di Taurus: frontend, backend, Keycloak,
PostgreSQL e RabbitMQ. È la suite chiesta dal [Runbook di test](../../docs/runbook-test.md) per i
percorsi con ruoli e tenant multipli e per il gate di accessibilità, e non sostituisce i test di
componente di `npm test`.

Le prove sono in `specs`:

- `roles-and-tenants.spec.ts`: menu per ruolo, nome del tenant nella topbar e indirizzo di una
  traccia non raggiungibile dall'altro tenant;
- `accessibility.spec.ts`: axe-core con le regole WCAG 2.1 A e AA sulla pagina di accesso e sulle
  pagine principali di un amministratore. Lo scanner trova le violazioni automatiche, non tutte: la
  verifica a mano con tastiera e lettore di schermo resta nel runbook;
- `track-parts-workspace.spec.ts`: il workspace delle parti con un archivista — frecce e Maiusc
  sull'elenco, trascinamento di una pagina sulla parte di destinazione, divisore da tastiera,
  conferma di uscita con bozza modificata e dettaglio della parte sotto 768 px. Le prove aprono la
  prima traccia dell'elenco che ha parti, e si saltano se quella traccia non ha almeno due parti e
  una pagina, perché il workspace non crea pagine: nascono dall'elaborazione di un PDF. Trascinamento
  e divisore si saltano anche sotto 768 px, dove elenco e dettaglio non stanno affiancati;
- `operational-dashboard.spec.ts`: la sezione «Da fare» per ogni ruolo configurato — voci
  restituite dal server dentro la matrice del ruolo, risposta `no-store`, una riga per voce o lo
  stato vuoto —, ogni azione di un amministratore che apre la pagina già filtrata, **Aggiorna** da
  tastiera con l'annuncio dell'esito, axe-core sulla sezione per amministratore e utente, nessuno
  scorrimento orizzontale a 320, 768 e 1280 pixel con azioni di riga alte almeno 44 pixel. I dati
  dei tenant di prova non sono fissati: le prove verificano invarianti, non conteggi, e quella dei
  collegamenti si salta se l'amministratore non ha attività. Risultato parziale, isolamento fra
  tenant con dati omonimi e obiettivi di prestazione sono in `OperationalDashboardIT` del backend;
- `inventory-qr.spec.ts`: la scansione dei QR inventario — deep link senza sessione che passa dal
  login e torna alla scansione, stesso stato «Codice non disponibile» con `404` per un codice
  sconosciuto o di un altro tenant, per amministratore e utente, pulsanti amministrativi presenti
  solo se compaiono in `allowedActions`, collegamento **Assegna** che apre e mette a fuoco la
  sezione della scheda, apertura diretta della consegna quando il socio ne ha una sola, axe-core e
  nessuno scorrimento orizzontale a 320 pixel con azioni alte almeno 44 pixel. La rotazione non è
  provata perché invaliderebbe le etichette dell'ambiente: resta nelle verifiche fisiche. Le prove
  sull'oggetto si saltano senza `E2E_INVENTORY_QR_CODE`, e tutte si saltano se il tenant di prova
  non ha inventario e QR attivi.
- `onboarding-import.spec.ts`: la configurazione iniziale — amministratore che apre la procedura
  guidata con il nome dell'organizzazione, **Ultima importazione** e i limiti del tenant in risposta
  `no-store` e senza stati tecnici a schermo, scaricamento del modello XLSX, socio che non vede la
  voce di menu e riceve `403` dal contesto, axe-core e nessuno scorrimento orizzontale a 320, 768 e
  1280 pixel. Il suo audit esclude la regola `aria-required-children`: `p-stepper` di PrimeNG, 19, 21 e 22, si
  dichiara `tablist` e ci annida dentro i propri pannelli `tabpanel`, con i passi a `presentation`,
  ed è il markup del componente, non del nostro modello. Le prove non caricano e non applicano
  nulla, perché l'importazione è additiva e lascerebbe dati nell'ambiente: validazione, file
  ostili, preflight, concorrenza, riavvio in ogni fase della saga e carico da 5.000 righe sono in
  `OnboardingImportIT` del backend. Si saltano se il tenant di prova non ha la funzionalità di
  importazione iniziale;
- `event-preparation.spec.ts`: la preparazione di un evento per ruolo — stato, avanzamento e
  criticità dell'amministratore con risposta `no-store`, collegamento di una criticità che aggiorna
  il fragment e mette a fuoco la sezione, archivista che legge soltanto la vista di catalogo e
  riordina il programma da tastiera con l'annuncio nella live region e la guardia che elenca
  l'unità «programma», socio che legge il programma senza stato né strumenti di modifica, tesoriere
  che chiama soltanto `/api/finance/**`, axe-core e nessuno scorrimento orizzontale a 320 pixel. Le
  prove non salvano nulla e si saltano senza `E2E_PREPARATION_EVENT_ID`; isolamento fra tenant,
  limiti, conflitti di versione e prestazioni sono in `EventPreparationIT` del backend.
- `legal-documents.spec.ts`: i documenti legali dentro l'applicativo — visitatore senza sessione
  che legge i termini in vigore senza passare da Keycloak, con `Cache-Control` della risposta
  pubblica, apre una versione precedente con l'avviso e il `noindex` e torna a quella in vigore,
  versione inesistente con il rimando, axe-core e nessuno scorrimento orizzontale a 320 pixel sulla
  pagina pubblica, link del piè di pagina che aprono i documenti in una nuova scheda. Queste prove
  leggono soltanto e valgono con qualunque versione in vigore. Lo scenario di pubblicazione — il
  super amministratore salva una bozza dei termini e la pubblica, l'utente al passaggio successivo
  legge il testo nella pagina di accettazione e conferma, un visitatore trova la versione nuova e
  quella di prima — si abilita con `E2E_LEGAL_PUBLISH=true`, gira solo sul profilo desktop e alla
  fine rimette in vigore la versione di prima. Una versione pubblicata non si elimina: ogni
  esecuzione lascia nell'ambiente una versione `e2e-…` ritirata. Ciclo di vita, immutabilità,
  cache con `ETag` e vincoli sono in `LegalResourceIT` del backend.
- `score-writing.spec.ts`: la scrittura della musica — un archivista crea una parte nuova, la scrive
  in modalità di inserimento con le lettere della tastiera sul desktop e con il pianoforte a schermo
  sul tablet, annulla e ripristina l'ultima nota, salva e approva la versione; chiude l'editor e
  riprende la bozza con le note scritte; un amministratore che apre la parte mentre l'archivista la
  scrive vede la bozza in sola lettura, con «Prendi il controllo» e senza salvataggio, e chi scrive
  tiene il blocco. Le prove si saltano senza `E2E_SCORE_WRITING_TRACK_ID` e sotto 768 pixel; il
  profilo tablet è nella matrice (`--project=tablet`), ma su Windows WebKit non lo esegue (vedi
  [Esecuzione del 2026-11-17](#esecuzione-del-2026-11-17)). Ogni prova crea una parte `e2e-scrittura-…` e
  alla fine la rimuove dalla traccia con «Salva traccia»: l'eliminazione è logica, quindi la base dati
  conserva la parte e le sue versioni. La tastiera MIDI vera, le partiture grandi e i tempi di
  scrittura degli archivisti restano nelle verifiche a mano del runbook (casi `SCW`).

## Prerequisiti

1. Dipendenze avviate: `docker compose -f ../taurus-be/src/main/docker/services.yml up --wait`.
2. Backend in esecuzione: `cd ../taurus-be && ./mvnw`.
3. Frontend in esecuzione: `npm start` (serve su `http://localhost:4200`).
4. Browser di Playwright installati con `npm run e2e:install` (Chromium, Firefox e WebKit). L'installazione
   va ripetuta quando il lockfile cambia versione di Playwright: senza i browser di quella versione ogni
   prova fallisce subito con «Executable doesn't exist».
5. Due tenant di prova, con utenti per i ruoli usati dalle prove (vedi [Ambiente di prova](#ambiente-di-prova)).

## Ambiente di prova

I due tenant non nascono da soli: il codice del tenant vive in tre posti, che vanno allineati.

1. **Base dati**: una riga in `public.tenant` per ogni codice — con le funzionalità da provare attive — e
   una in `public.tenant_schema_registry` con `status = 'ACTIVE'` e `schema_name` uguale a
   `tenant_` più i primi 32 caratteri esadecimali dello SHA-256 del codice, come fa
   `TenantSchemaNameResolver`. Al riavvio il backend crea lo schema e vi esegue Liquibase.
2. **Keycloak**: un gruppo per ogni codice — la descrizione è il nome mostrato nella scelta del
   tenant — e un utente per ruolo, iscritto al gruppo, con l'attributo `<CODICE>_roles` che vale
   `ROLE_ADMIN`, `ROLE_BOARD`, `ROLE_ARCHIVIST`, `ROLE_USER`, `ROLE_TREASURER`, `ROLE_USER_EXTERNAL` o
   `ROLE_SUPER_ADMIN`: l'authenticator legge i tenant dai gruppi e i ruoli da quell'attributo.
3. **Schema del tenant**: per ogni utente una riga in `public.user_identity`, una in
   `public.tenant_user_membership` e una in `<schema>.app_user` con il suo `<schema>.app_user_role`.

Chi è iscritto a più tenant, come il super amministratore, in Keycloak sceglie il tenant prima di
entrare: le prove scelgono il tenant della variabile da cui vengono le credenziali — il primo per
`E2E_FIRST_…`, il secondo per `E2E_SECOND_…` — e, se lì l'utente ha più ruoli, quello della prova.

Le prove di una funzionalità del tenant, come i QR inventario o la configurazione iniziale, si
saltano se il tenant di prova non la ha attiva: la guardia del router riporterebbe alla dashboard
senza chiamare il server, e la risposta che la prova aspetta non arriverebbe. `featureEnabled`
legge le funzionalità che l'applicazione chiede all'avvio (`/api/tenant-features/current`).

Le prove sull'elenco delle tracce vogliono almeno una traccia nel primo tenant; quelle del workspace
aprono la prima traccia dell'elenco che ha parti, e si saltano se non ne ha due: le parti nascono
solo dall'elaborazione di un PDF.

## Variabili d'ambiente

Nessuna credenziale vive nel repository: la suite legge utenti e password dall'ambiente e si salta
quando non sono configurati.

| Variabile | Significato |
| --- | --- |
| `E2E_BASE_URL` | Indirizzo del frontend; senza di essa `http://localhost:4200` |
| `E2E_FIRST_TENANT`, `E2E_SECOND_TENANT` | Codici dei due tenant di prova |
| `E2E_FIRST_ADMIN_USERNAME`, `E2E_FIRST_ADMIN_PASSWORD` | Amministratore del primo tenant |
| `E2E_FIRST_<RUOLO>_USERNAME`, `E2E_FIRST_<RUOLO>_PASSWORD` | Altri ruoli del primo tenant |
| `E2E_SECOND_<RUOLO>_USERNAME`, `E2E_SECOND_<RUOLO>_PASSWORD` | Ruoli del secondo tenant |
| `E2E_INVENTORY_QR_CODE` | Identificatore pubblico del QR di un oggetto del primo tenant con `INVENTORY_QR` attivo, letto dall'etichetta stampata; senza di esso le prove sull'oggetto si saltano |
| `E2E_SECOND_INVENTORY_QR_CODE` | Identificatore di un oggetto del secondo tenant, per provare che dal primo risponde come un codice sconosciuto; facoltativo |
| `E2E_PREPARATION_EVENT_ID` | Evento del primo tenant con `EVENT_PREPARATION` attivo, piano configurato e programma richiesto, possibilmente con almeno due brani e una criticità; senza di esso le prove della preparazione si saltano |
| `E2E_LEGAL_PUBLISH` | `true` per pubblicare una versione dei termini nello scenario dei documenti legali; servono il super amministratore e un utente del primo tenant. Senza di essa lo scenario si salta |
| `E2E_SCORE_WRITING_TRACK_ID` | Traccia del primo tenant con `SCORE_PLAYBACK` e `SCORE_WRITING` attivi, dove le prove della scrittura creano e poi rimuovono le loro parti; servono un archivista e, per la sola lettura, un amministratore. Senza di essa quelle prove si saltano |
| `E2E_LARGE_TRACK_ID` | Traccia del primo tenant con 200 parti e 1.000 pagine, per il gate prestazionale del workspace; senza di essa quella prova si salta |

I ruoli ammessi sono `SUPERADMIN`, `ADMIN`, `BOARD` (direttivo), `ARCHIVIST`, `USER`, `EXTERNAL` e `TREASURER`.

## Esecuzione

```bash
npm run e2e                      # il gate: profili desktop e mobile
npm run e2e:matrix               # tutta la matrice: desktop, mobile, tablet, Firefox, WebKit
npm run e2e -- --project=desktop
npm run e2e -- --headed --project=desktop
```

I profili sono dichiarati in `playwright.config.ts`. Il gate resta su desktop e mobile perché
Firefox e WebKit raddoppiano la durata del run: la matrice completa va eseguita nei cicli di
release, come dice il runbook.

Tracce, video e report delle prove fallite restano in `target/e2e` e `target/e2e-report`.

## Prima esecuzione

La prima esecuzione è del 2026-10-31, su un'istanza completa di sviluppo con due tenant di prova.
Il primo giro ha dato 38 prove passate, 34 saltate per mancanza di dati o di variabili e 8 fallite;
dopo la correzione dei difetti che aveva trovato la suite passa interamente: **46 passate, 34
saltate, nessuna fallita** in 5,3 minuti sui profili desktop e mobile. Le prove saltate aspettano
dati che l'ambiente non ha — una traccia con due parti e pagine, un oggetto con QR, un evento con
programma, la traccia grande della prova prestazionale — e le variabili che le abilitano.

La calibrazione ha riguardato sette punti, utili a chi scriverà nuove prove:

- l'host `<app-topbar>` non ha un riquadro proprio, perché la barra è a posizione fissa: l'ingresso
  nell'applicazione si aspetta dal landmark del menu, `navigation` con nome «Menu principale»;
- il nome accessibile dei pulsanti PrimeNG comprende l'icona, che è contenuto generato: i nomi
  ancorati come `/^logout$/` non combaciano mai;
- la conferma di PrimeNG è un `alertdialog`, non un `dialog`, e la pagina ne tiene più d'uno in
  attesa nel DOM;
- sotto i 992 pixel il menu laterale sta fuori schermo e la sua maschera intercetta ogni clic:
  `goToSection` lo apre quando serve e aspetta che si richiuda;
- la navigazione iniziale del router finisce dopo il menu: un clic anticipato viene annullato, e
  `signIn` aspetta la quiete della rete prima di restituire il controllo; per lo stesso motivo
  l'indirizzo raggiunto da un clic si legge dopo `waitForURL`, non subito dopo il clic;
- dopo un cambio di viewport il layout anima per 0,2 secondi il margine del contenitore
  principale: una misura letta subito vede la pagina sporgere di quanto resta all'animazione, e
  `expectNoHorizontalOverflow` ripete la lettura finché si assesta — era la causa dei 212 pixel
  attribuiti allo stepper della configurazione iniziale, che in realtà non sporge;
- axe va lanciato su una pagina ferma: subito dopo `goto` l'analisi muore con «Execution context
  was destroyed», perché il router sta ancora navigando.

## Esecuzione del 2026-11-17

Il 2026-11-17 il gate gira sulla stessa istanza dopo l'arrivo dell'editor di scrittura: **56 prove
passate, 29 saltate e 15 fallite** in 27,5 minuti. Le cadute avevano tre cause:

- il gate di accessibilità trovava sulla dashboard il contatore delle notifiche a 1,02:1, perché il
  badge lampeggiava senza fine portando a zero la propria opacità. Ora si annuncia con due impulsi
  di un anello attorno al numero, che resta pieno, e nessuno con il movimento ridotto; il tema
  accessibile porta il fondo chiaro dei badge pieni alla tinta 700, sopra 4,5:1;
- le prove dei QR inventario e della configurazione iniziale scadevano: con la funzionalità spenta
  nel tenant la guardia del router riporta alla dashboard e la risposta attesa non arriva. Ora si
  saltano, e nel primo tenant di prova inventario, QR e importazione iniziale sono stati accesi,
  con un oggetto di prova assegnato all'utente e indicato in `E2E_INVENTORY_QR_CODE`;
- le prove del super amministratore si fermavano sulla scelta del tenant di Keycloak, perché quel
  profilo è iscritto a più tenant: `signIn` ora sceglie il tenant e il ruolo.

La scrittura, con l'ascolto e la scrittura accesi nel primo tenant, passa sul desktop: 3 prove su 3
in 2,4 minuti, dopo aver reso indifferente alle maiuscole l'espressione dello stato di inserimento.
Rieseguite sul desktop e sul mobile le sei suite toccate, 61 prove passano, 3 si saltano — la
scrittura sotto 768 pixel — e 2 falliscono: la scheda di scansione a 320 pixel, che ora ha un
oggetto vero, mostra il pulsante pieno «Segnala guasto» a 2,8:1. È il difetto dei pulsanti pieni
delle severità, annotato fra i gap del runbook di test.

Su Windows WebKit di Playwright non porta a termine l'accesso: dopo il ritorno da Keycloak la pagina
resta bianca e si chiude entro pochi secondi, in ogni prova che entra nell'applicazione e non solo
in quelle della scrittura. I profili tablet e webkit della matrice vanno eseguiti su macOS o Linux;
fino ad allora la scrittura sul tablet resta al caso a mano `SCW-003` su un iPad vero.
