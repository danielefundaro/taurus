# Runbook di test e qualificazione Taurus

## 1. Scopo e stato

ID catalogo: `test-runbook`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

Questo runbook definisce la strategia, le suite, i dati, le procedure e le evidenze necessarie per verificare la qualità dell'intero progetto Taurus. Copre backend, frontend, PostgreSQL multi-tenant, Keycloak, RabbitMQ, storage media, sito informativo e processi operativi.

Il documento è una checklist eseguibile e una matrice di copertura. Non sostituisce i test automatici: un caso marcato come manuale o non ancora automatizzato resta un rischio esplicito. Nessuna quantità di test garantisce l'assenza assoluta di difetti; il criterio adottato è produrre evidenze ripetibili, proporzionate al rischio, sufficienti per una decisione di rilascio consapevole.

Copertura presente nel repository (la data dell'ultima verifica è nel catalogo):

- backend: 220 file Java di test e supporto sotto `src/test`, con unit test, test Spring e integrazioni PostgreSQL/Testcontainers;
- frontend: 68 specifiche Jasmine/Karma;
- servizio OMR: 9 file pytest, con test sui motori finti, test dell'impaginazione con Verovio e Cairo veri e test di accuratezza sui motori reali, eseguiti solo con il servizio in esecuzione;
- provider Keycloak: 7 classi di test, fra cui `TaurusOtpTest`, `TaurusOtpResourceIT`, `EmailTemplatesTest` sui modelli di posta del tema, `EmailDeliveryIT`, che fa partire un'e-mail vera verso Mailpit, e `TenantRoleFlowIT`, che attraversa il browser flow e legge i claim del mapper su un Keycloak reale;
- sito informativo: type-check, build e `pnpm test`/`pnpm test:image`, che controllano il sito costruito e l'immagine nginx che lo serve;
- E2E: suite Playwright in `taurus-fe/e2e`, con i profili desktop e mobile, che richiede un'istanza completa e due tenant di prova; eseguita la prima volta il 2026-10-31, calibrata e verde — 46 prove passate e 34 saltate per dati assenti;
- JaCoCo produce i report backend e applica le soglie di copertura della suite intera, unit e integrazione (§8.2);
- la CI esegue test/build dei moduli modificati con le soglie di copertura, impone la presenza di Docker, conserva report e copertura come artefatti, verifica il sito costruito e l'immagine nginx che lo serve e, per `taurus-omr`, misura l'accuratezza sull'immagine appena costruita; il job `security` cerca segreti, vulnerabilità di dipendenze e configurazioni e difetti con analisi statica. Restano fuori dalla CI i test full-stack, le performance, la sicurezza dinamica e il restore.

I gap indicati nella sezione 19 restano rischi espliciti finché non sono risolti o formalmente accettati.

## 2. Obiettivi di qualità

Ogni release deve dimostrare:

1. correttezza delle funzioni previste dal catalogo;
2. isolamento tra tenant in API, database, file e processi asincroni;
3. autorizzazioni coerenti tra backend e interfaccia;
4. compatibilità tra frontend, backend, realm e provider Keycloak;
5. migrazioni ripetibili su database vuoto e aggiornato;
6. integrità e recuperabilità di database e media;
7. comportamento controllato in caso di dipendenze indisponibili;
8. prestazioni compatibili con SLO e volumi attesi;
9. accessibilità, usabilità e compatibilità browser concordate;
10. assenza di vulnerabilità critiche note non accettate;
11. osservabilità sufficiente a diagnosticare un guasto;
12. possibilità di rollback o forward fix documentata.

## 3. Classificazione dei test

| Livello | Scopo | Esecuzione minima |
| --- | --- | --- |
| L0 — statico | Formattazione, compilazione, catalogo, dipendenze e configurazione | Ogni PR |
| L1 — unità | Regole di dominio, mapping, validazione e utility | Ogni PR |
| L2 — componente | Controller, service, componenti Angular e contratti HTTP isolati | Ogni PR |
| L3 — integrazione | PostgreSQL, Liquibase, Keycloak, RabbitMQ e filesystem reali | Ogni PR per aree coinvolte; suite completa nightly |
| L4 — E2E | Flussi utente reali da browser attraverso tutto lo stack | Release candidate |
| L5 — non funzionale | Sicurezza, accessibilità, performance, resilienza, backup/restore | Nightly o release secondo costo/rischio |
| L6 — produzione | Smoke test non distruttivi e osservazione post-deploy | Ogni deploy |

### 3.1 Priorità dei casi

- `P0`: sicurezza, tenant isolation, autenticazione, perdita dati, migrazioni, avvio e funzioni core. Sempre bloccante.
- `P1`: funzione primaria o ruolo importante degradato. Bloccante salvo accettazione formale.
- `P2`: caso secondario, UX o compatibilità non critica. Pianificabile con workaround documentato.

### 3.2 Esiti ammessi

- `PASS`: risultato atteso dimostrato e prova allegata;
- `FAIL`: risultato diverso dall'atteso;
- `BLOCKED`: prerequisito indisponibile, con ticket e owner;
- `NOT RUN`: non eseguito, mai equivalente a `PASS`;
- `N/A`: non applicabile con motivazione approvata.

## 4. Quality gate proposto

I valori seguenti costituiscono la baseline raccomandata; devono essere approvati dagli owner prima di diventare gate automatici.

| Area | Gate di release |
| --- | --- |
| Build | Tutti i moduli interessati compilano in modalità produzione |
| Automatici | 100% test obbligatori verdi; nessun test P0 saltato, imposto in CI da `-Dtaurus.test.requireDocker=true` |
| Difetti | 0 difetti aperti P0; 0 P1 senza accettazione esplicita |
| Tenant isolation | Tutta la matrice negativa P0 superata con almeno due tenant |
| Migrazioni | Fresh install, upgrade e riavvio idempotente superati |
| Sicurezza | 0 vulnerabilità Critical/High sfruttabili non accettate; il job `security` della CI cerca segreti, vulnerabilità di dipendenze e configurazioni, e difetti con analisi statica. Il DAST su staging resta da aggiungere |
| Copertura | Baseline attiva e verificata in CI: backend 77% linee e 62% branch sulla suite intera, frontend 71% istruzioni, 62% branch e 73% linee. La proposta resta 80% linee e 70% branch nei moduli modificati, 90% per logica P0 nuova: la baseline si alza man mano, non si abbassa |
| Accessibilità | Nessuna violazione critica automatica; flussi principali utilizzabili da tastiera |
| Performance | SLO p95/p99, throughput ed error rate approvati e rispettati |
| Resilienza | Recupero dimostrato per riavvio backend e indisponibilità temporanea delle dipendenze |
| Restore | Ultima prova entro la finestra di policy e RTO/RPO misurati con `scripts/ops/restore-test.sh` |
| Evidenze | Report, log, versione e configurazione non segreta archiviati |

Un gate non ancora misurabile è un punto aperto, non un successo implicito.

## 5. Ambienti di test

### 5.1 Locale

Usare per sviluppo rapido e diagnosi. Il compose in `taurus-be/src/main/docker` è esclusivamente di sviluppo e il database non ha un volume persistente attivo. Il profilo `dev` usa il supporto Docker Compose di Spring Boot, che collega il backend al PostgreSQL del compose ignorando `SPRING_DATASOURCE_URL`: per una seconda istanza su un altro database, per esempio la copia di un altro checkout, serve anche `SPRING_DOCKER_COMPOSE_ENABLED=false`, altrimenti le migrazioni degli schemi tenant finiscono sul database `taurus`. `docker compose -f taurus-be/src/main/docker/services.yml up --wait` avvia anche il servizio OMR, con la chiave di sviluppo già condivisa con il profilo `dev` del backend, e attende che tutti i servizi siano `healthy`.

### 5.2 CI effimera

Caratteristiche richieste:

- checkout pulito;
- versioni Java/Node/pnpm/Python fissate;
- Docker disponibile per Testcontainers e per l'immagine del servizio OMR;
- accesso in uscita a `ftp.osuosl.org` per il SoundFont della build frontend e alle sorgenti fissate dell'immagine OMR;
- database e container nuovi per ogni job;
- nessun segreto di produzione;
- report e log pubblicati anche in caso di fallimento.

### 5.3 Integrazione full-stack

Deve contenere PostgreSQL 18, Keycloak 26.8.2 con provider e temi, RabbitMQ 4.4, servizio OMR, backend, frontend, storage persistente temporaneo e browser controllato. Gli URL devono replicare lo schema pubblico HTTPS previsto, non gli hostname interni della configurazione attuale.

### 5.4 Staging production-like

Deve replicare:

- manifest, reverse proxy, TLS e policy di rete;
- immagini per digest della release candidate;
- stessa strategia di replica e scheduler;
- storage e backup equivalenti;
- dati sintetici, anonimizzati o specificamente autorizzati;
- osservabilità e alert reali.

Non usare dati personali di produzione per comodità.

## 6. Dati e identità di prova

### 6.1 Tenant minimi

| Tenant | Configurazione | Scopo |
| --- | --- | --- |
| `TENANT_A` | Tutte le feature abilitate | Happy path completo |
| `TENANT_B` | Tutte le feature abilitate | Verifiche di isolamento incrociato |
| `TENANT_MIN` | Tutte le feature opzionali disabilitate | Kill switch, menu e API negate |
| `TENANT_MIX` | Combinazioni e dipendenze parziali | Feature flag e capability |

Per ogni tenant creare dati con ID potenzialmente coincidenti, nomi riconoscibili e file differenti. I test non devono affidarsi all'unicità globale degli ID tenant-scoped.

### 6.2 Ruoli

Preparare almeno un'identità per:

- `ROLE_SUPER_ADMIN`;
- `ROLE_ADMIN`;
- `ROLE_BOARD`;
- `ROLE_TREASURER`;
- `ROLE_ARCHIVIST`;
- `ROLE_USER`;
- `ROLE_USER_EXTERNAL`;
- utente autenticato privo del ruolo richiesto;
- token senza tenant, tenant sconosciuto, tenant eliminato e token scaduto.

### 6.3 Dati limite

Includere:

- valori minimi, massimi, null, stringhe vuote e Unicode;
- date a cambio anno, mese, ora legale e fuso diverso;
- pagine vuote, una voce, ultima pagina e pagina oltre il limite;
- upload validi, corrotti, MIME falso, nome lungo, duplicato e dimensione al limite;
- CSV onboarding vuoto, 1 riga, 5.000 righe, colonne extra/mancanti e celle al limite;
- ricorrenze fino al limite di 500 occorrenze;
- importi positivi, negativi, zero, arrotondamenti e cambio esercizio;
- subscription push valide, scadute e respinte dal provider;
- file MusicXML (`.musicxml`, `.xml`, `.mxl`) e MIDI con una e più parti, malformati, con DTD o entità esterne, `.mxl` oltre 50 MB decompressi o 100 voci, MIDI oltre 10 MB;
- pagine di parti da riconoscere: digitali, scansioni e foto, a 300 DPI e a risoluzione più bassa. Le parti reali della banda restano negli ambienti di prova e non entrano nel repository; il corpus versionato di `taurus-omr/accuracy` è scritto per il test.

Ogni suite deve creare e ripulire i propri dati. La pulizia non deve mascherare un fallimento.

## 7. Preparazione e raccolta evidenze

Prima dell'esecuzione registrare:

```text
Test run ID:
Commit SHA:
Tag/digest immagini:
Ambiente:
Browser e versione:
Java/Node/pnpm/Python/Docker:
Schema/migration version:
Configurazione feature non segreta:
Dataset/versione fixture:
Esecutore:
Ora inizio UTC:
```

Conservare:

- report JUnit, Karma e coverage;
- log applicativi e container relativi al run;
- screenshot/video solo per fallimenti UI o evidenze richieste;
- risultati scanner e performance;
- tabella di accuratezza dei motori OMR, quando misurata;
- query di verifica prive di segreti/dati personali;
- elenco test saltati con motivazione;
- ticket per ogni fallimento non risolto.

## 8. Comandi delle suite esistenti

### 8.1 Governance documentale

```powershell
node scripts/docs/validate-feature-catalog.mjs
node --test scripts/docs/feature-catalog.test.mjs
node scripts/docs/generate-feature-index.mjs
git diff --exit-code -- docs/features.md
node --test scripts/docs/error-catalog.test.mjs
node scripts/docs/check-error-catalog.mjs
```

### 8.2 Backend

Serve un JDK 25: l'enforcer ferma la build con altre versioni. Il compilatore di Maven non ricompila quando cambia solo `release`, quindi dopo un cambio di versione di Java serve `clean`. Nella fase `package` gira modernizer, che con Java 25 chiede le API più recenti, per esempio `String.formatted`, `Path.of`, `Reader.of` e `List.of`: una violazione ferma la build.

Suite unit/component:

```powershell
Set-Location taurus-be
.\mvnw.cmd test
```

Suite completa, incluse classi `*IT*` e `*IntTest*` tramite Failsafe:

```powershell
Set-Location taurus-be
.\mvnw.cmd verify
```

Build e test con profilo produzione:

```powershell
.\mvnw.cmd -Pprod clean verify
```

Test mirati tenant:

```powershell
.\mvnw.cmd "-Dtest=TenantContextTest,TenantSchemaNameResolverTest,SchemaMultiTenantConnectionProviderTest,TenantProvisioningStatusTest,TenantProvisioningInterceptorTest" test
.\mvnw.cmd "-Dit.test=TenantSchemaProvisioningServiceIT,TenantBootstrapIT" failsafe:integration-test failsafe:verify
```

Isolamento tenant per risorsa, CRUD e IDOR:

```powershell
.\mvnw.cmd "-Dtest=TenantIsolationIT" test
```

`TenantIsolationIT` esegue lo stesso giro di prove su ognuna delle sette risorse elencate nel suo metodo `resources()` — tracce, avvisi, preferenze, ultime ricerche, eventi del calendario, oggetti dell'inventario e conti dell'economia: la riga creata in un tenant non è leggibile, modificabile né cancellabile dall'altro, e resta intatta nel proprio. Una risorsa nuova si aggiunge a quell'elenco e porta con sé le tre prove, invece di richiedere un test scritto a mano. Alcune tabelle nascono con i dati di riferimento del tenant, quindi il controllo confronta la variazione del conteggio, non il totale.

Concorrenza di più repliche sulla coda degli upload:

```powershell
.\mvnw.cmd "-Dtest=UploadJobConcurrencyIT" test
```

Concorrenza di più repliche sulle notifiche:

```powershell
.\mvnw.cmd "-Dit.test=NotificationConcurrencyIT" verify
```

`NotificationConcurrencyIT` qualifica le tre code che lavorano a tempo: l'outbox delle notifiche, la consegna push e i promemoria degli eventi. Sei worker simultanei prendono lo stesso lavoro e il test conta gli effetti: un avviso, una consegna push e una sola chiamata al servizio di invio. Gli scheduler reali sono spenti nel test, perché ruberebbero i lavori ai worker della prova. Serve Docker.

Percorso completo di un caricamento PDF, con PostgreSQL e RabbitMQ reali:

```powershell
.\mvnw.cmd "-Dit.test=UploadJobPipelineIT" verify
```

`UploadJobPipelineIT` carica un PDF vero e segue la catena intera: commit, pubblicazione, consumo, conversione, creazione delle parti e job a `DONE`. Copre anche il consumatore fermato e riavviato con un job in coda, il nuovo tentativo di un job in errore, il recupero di un job rimasto in elaborazione e l'isolamento fra tenant. Serve Docker.

Dashboard operativa su PostgreSQL, con le prestazioni su un dataset realistico:

```powershell
.\mvnw.cmd "-Dit.test=OperationalDashboardIT" verify
```

`OperationalDashboardIT` verifica le voci di ogni profilo su dati veri — utenti inattivi, eventi cancellati, in bozza o esclusi da una serie, restituzioni parziali, esercizi riportati, consegne fallite —, due tenant con dati omonimi e lo stesso utente, e il risultato `PARTIAL` quando la tabella dei movimenti non si legge. La prova di carico prepara 150 persone, 700 eventi con 73.500 risposte, 1.500 movimenti, 2.000 assegnazioni con revisioni e prese visione e 5.000 notifiche, poi misura `p95` della richiesta e di ogni provider, query per richiesta e dimensione della risposta, e fallisce oltre 500 ms, 200 ms, 12 query o 32 kB. Numeri e piani generici di PostgreSQL di ogni query finiscono in `taurus-be/target/dashboard-query-plans.txt`: al 2026-10-27 le sole scansioni sequenziali su tabelle che crescono sono quelle di prese visione dell'inventario e outbox, accettabili a questi volumi come spiega la [specifica](operational-dashboard-spec.md#misura-su-dataset-realistico); una nuova scansione su una tabella grande è il segnale per un indice. Serve Docker.

Preparazione dell'evento su PostgreSQL, con il bilancio di query della dashboard e le prestazioni di un evento grande:

```powershell
.\mvnw.cmd "-Dit.test=EventPreparationIT" verify
```

`EventPreparationIT` verifica la migrazione `20261027100000` con i valori predefiniti delle colonne nuove, il `409` di programma e materiali salvati con una versione superata senza toccare la configurazione, l'isolamento fra due tenant su eventi, tracce e oggetti, le 8 query fisse con cui la dashboard valuta 2 o 15 eventi (la richiesta completa passa da 11 a 19 query) e gli obiettivi della [specifica](event-preparation-spec.md#prestazioni) su un evento con 100 brani, 1.000 utenti con la loro risposta e 100 materiali assegnati: p95 della vista amministrativa sotto 700 ms e di quella personale sotto 400 ms. Serve Docker; le query sono contate da `RecordingStatementInspector`, un `StatementInspector` di Hibernate che i test attivano e fermano intorno all'operazione misurata.

Broker RabbitMQ reale:

```powershell
.\mvnw.cmd "-Dtest=RabbitMqBrokerIT" test
```

`RabbitMqBrokerIT` avvia RabbitMQ con Testcontainers e verifica consegna, riconsegna dopo un errore di elaborazione, messaggio avvelenato, argomenti delle code di lavoro e broker irraggiungibile. Il messaggio avvelenato non torna in coda: il consumatore lo rifiuta senza rimessa (`default-requeue-rejected: false`) e il broker lo instrada sull'exchange `taurus.dead-letter`, da cui la prova lo rilegge nella coda di scarto dopo un solo tentativo. Un'altra prova controlla che `upload.files` e `score.recognition` siano dichiarate con `x-dead-letter-exchange` e `x-dead-letter-routing-key`. Serve Docker.

I test che hanno bisogno di Docker passano da `DockerRequirement.required()`: senza Docker si saltano sulla macchina di uno sviluppatore, mentre con `-Dtaurus.test.requireDocker=true` — come fa la CI — la sua assenza è un fallimento. Un test P0 saltato rende il run incompleto.

La copertura della suite intera è un gate: `verify` unisce i dati di unit e integrazione in `target/jacoco-merged.exec`, ne produce il report in `target/site/jacoco-merged` e verifica le soglie `jacoco.line.minimum` e `jacoco.branch.minimum` del `pom.xml`. Oggi valgono 0,77 e 0,62: alzate il 2026-11-08 appena sotto la copertura misurata quel giorno (77,3% linee e 61,7% branch), la soglia dei branch è salita a 0,62 il 2026-11-13 con le prove dei compensi ai presenti (77,7% linee e 62,3% branch). Con gli stessi test la copertura era salita dal 75,6% e 60,5% del 2026-11-06, quando le soglie erano 0,75 e 0,60: la crescita viene dalla fase 4a dell'aggiornamento della piattaforma, con Spring Boot 3.5.16, JaCoCo 0.8.16 e Java 25, non da prove nuove. Le soglie si alzano quando la copertura sale e non si abbassano senza annotarlo qui.

Spring tiene in cache un contesto per ogni combinazione di configurazione dei test, e ognuno conserva pool di connessioni, listener RabbitMQ e cache interne. La cache è limitata a 8 contesti da `spring.test.context.cache.maxSize` in `taurus-be/src/test/resources/spring.properties`: oltre il limite Spring chiude quello usato meno di recente, mentre il container PostgreSQL condiviso resta acceso. Con il limite predefinito di 32 gli integration test arrivano a una ventina di contesti vivi, circa 50 MB l'uno: il 2026-11-06 l'heap di 1 GB del fork si è riempito all'avvio del contesto di `AccountResourceIT`, che non è mai partito, e il fork è morto per `OutOfMemoryError` dopo 17-19 minuti di garbage collection continua. Con il limite la suite completa dura circa 26 minuti e ogni contesto parte in 10-13 secondi. Un avvio di contesto che sale verso il minuto, o un IT banale che impiega minuti, è il segnale che l'heap è di nuovo al limite: abbassare `maxSize` prima di alzare `-Xmx`.

Il container PostgreSQL dei test parte con `max_connections=400`, impostato in `PostgreSqlTestContainer`. Prima del limite della cache, con una decina di contesti vivi i rispettivi pool di connessioni superavano il valore predefinito di 100 e gli ultimi contesti fallivano l'avvio con `FATAL: sorry, too many clients already`; anche con 8 contesti i pool arrivano a 80 connessioni, quindi il margine resta. L'errore non è un'asserzione e si manifesta solo sulla suite completa, mai sulle classi eseguite da sole: se ricompare, alzare il limite prima di cercare la causa nei test.

In CI nessun RabbitMQ ascolta su `localhost:5672`: i listener dei contesti che non avviano un broker con Testcontainers riprovano a collegarsi ogni cinque secondi e riempiono il log di `Connection refused`, che non è un errore della suite. Per riprodurre in locale le condizioni della CI con i servizi di sviluppo avviati, puntare i test su una porta chiusa: `$env:SPRING_RABBITMQ_PORT = '5679'` prima di `.\mvnw.cmd verify`.

Il `@BeforeAll` degli integration test a tenant prepara uno schema, cioè esegue tutte le migration Liquibase sul container: su una macchina lenta costa circa un minuto. Il limite del `@BeforeAll` in `taurus-be/src/test/resources/junit-platform.properties` è perciò di 180 s, mentre i singoli test restano a 15 s: il 2026-10-30 il limite precedente di 60 s ha fatto fallire `PreferencesResourceIT` con `TimeoutException: provisionTenant() timed out` a provisioning quasi finito, mentre la classe successiva, con lo stesso schema, ci ha messo 56 s ed è passata. Un fallimento così non è un difetto del prodotto; se invece il provisioning supera i 180 s, la causa va cercata nelle migration o nell'host, non alzando di nuovo il limite.

Gli integration test delle risorse le cui tabelle vivono solo negli schemi tenant — `NoticesResourceIT`, `PreferencesResourceIT`, `LastResearchResourceIT`, `TenantBootstrapIT` — estendono `TenantAwareResourceIT`, che provisiona lo schema, registra un tenant attivo in `public.tenant` e apre il `TenantContext` sul thread di test. L'autenticazione passa da `@WithMockTenantUser`: `@WithMockUser` non basta, perché tenant e utente vengono letti dai claim di un `JwtAuthenticationToken` e qualsiasi altra autenticazione viene ignorata o rifiutata.

Report JaCoCo attesi sotto `taurus-be/target/site/jacoco` e `taurus-be/target/site/jacoco-it`.

### 8.3 Frontend

```powershell
Set-Location taurus-fe
npm ci
npm test -- --watch=false --browsers=ChromeHeadless --code-coverage
npm run build -- --configuration production
```

La copertura ha un gate: `npm run test:coverage` esegue i test con `--code-coverage` e fallisce se scende sotto la baseline di `scripts/check-coverage.mjs` (71% istruzioni, 62% branch, 73% linee, misurati sul ramo principale; alzata il 2026-10-27 con le prove del workspace delle parti, dell’editor delle immagini, della dashboard e dei QR dell’inventario, il 2026-10-28 con quelle della preparazione evento, il 2026-10-29 con quelle del feed calendario, il 2026-11-04 con quelle della guida introduttiva, il 2026-11-06 con quelle dei documenti legali, il 2026-11-13 con quelle dei compensi ai presenti e il 2026-11-14 con quelle dell'editor di scrittura, dei suoi passaggi, della nuova notazione e della tastiera MIDI). Anche questa baseline si alza, non si abbassa. La build scarica il SoundFont del lettore da `ftp.osuosl.org` e ne verifica l'impronta; senza rete la build fallisce, salvo `TAURUS_SKIP_SOUNDFONT=1` quando il lettore non serve.

Suite end to end full-stack, con Playwright:

```powershell
Set-Location taurus-fe
npm run e2e:install
npm run e2e
```

La suite vive in `taurus-fe/e2e`, guida un browser reale sui profili desktop e mobile e richiede un'istanza completa — dipendenze, backend, frontend — più due tenant di prova con utenti per ruolo. Credenziali e codici tenant arrivano dalle variabili d'ambiente descritte in `taurus-fe/e2e/README.md`: nel repository non vive nessuna credenziale e, senza quelle variabili, le prove si saltano invece di fallire. Le prove coprono il menu per ruolo, il nome del tenant nella topbar, l'indirizzo di una traccia non raggiungibile dall'altro tenant, il gate di accessibilità e, con `specs/track-parts-workspace.spec.ts`, il workspace delle parti: frecce e Maiusc sull'elenco, trascinamento di una pagina sulla parte di destinazione, divisore da tastiera, conferma di uscita con bozza modificata e dettaglio della parte sotto 768 px. Con `specs/operational-dashboard.spec.ts` copre anche la sezione «Da fare» della dashboard: voci di ogni ruolo dentro la sua matrice, collegamenti già filtrati, **Aggiorna** da tastiera, axe-core sulla sezione e layout a 320, 768 e 1280 pixel. Con `specs/inventory-qr.spec.ts` prova la scansione dei QR inventario: ritorno dopo il login, lo stesso «Codice non disponibile» per un codice sconosciuto o di un altro tenant, sole azioni ammesse per l'amministratore, consegne del socio, 320 pixel e axe-core; il codice da scansionare arriva da `E2E_INVENTORY_QR_CODE` e quello dell'altro tenant da `E2E_SECOND_INVENTORY_QR_CODE`, e senza di essi le prove relative si saltano. La prova prestazionale del workspace vuole una traccia già preparata con 200 parti e 1.000 pagine, indicata in `E2E_LARGE_TRACK_ID`, e senza quella variabile si salta; la misura delle stesse dimensioni su operazioni, filtro e soglia di virtualizzazione vive nei test di componente di `npm run test:coverage`. La prima esecuzione è del 2026-10-31, su un'istanza di sviluppo con due tenant di prova creati per l'occasione. Il primo giro ha dato 38 prove passate, 34 saltate — per dati assenti (parti, QR, evento, traccia grande) o ruoli non configurati — e 8 fallite; corretti i difetti che aveva trovato, la suite passa interamente: 46 passate, 34 saltate, nessuna fallita in 5,3 minuti sui due profili. La calibrazione, descritta in `taurus-fe/e2e/README.md`, ha corretto sette abitudini dei selettori e delle misure: landmark del menu al posto dell'host `app-topbar`, nomi non ancorati per i pulsanti PrimeNG, `alertdialog` per le conferme, apertura del menu sotto i 992 pixel, attesa della navigazione iniziale e dell'indirizzo raggiunto da un clic, misura dello scorrimento orizzontale ripetuta finché il layout si assesta e analisi axe lanciata solo a pagina ferma.

Le prove hanno trovato sette difetti dell'applicazione, tutti corretti. Tre nel guscio: il menu principale non era un landmark di navigazione, i pulsanti Calendario, Notifiche e Profilo della topbar erano senza nome accessibile — l'etichetta è nascosta dal foglio di stile — e la configurazione iniziale proiettava le proprie azioni in `actions` invece che in `pageActions`, così il pulsante **Modello XLSX** non compariva. Tre di accessibilità sulle liste e sulla barra degli elenchi: `aria-label` stava sull'ospite `<p-checkbox>`, che non ha ruolo, invece dell'ingresso `ariaLabel` che la porta sulla casella vera; i due pulsanti della vista elenco/griglia non avevano nome, perché il modello dell'elemento sostituisce l'etichetta del pulsante con la sola icona; `ariaLabel` su `p-selectbutton` non è un ingresso del componente e finiva nel DOM come attributo inerte. Uno di layout: la griglia della dashboard usava `gap-8`, i cui soli spazi chiedono 308 pixel, e a 320 pixel sporgeva di 16; ora usa `gap-4` fino al breakpoint `md`, come le altre pagine. Il contrasto del tema è stato portato sopra 4,5:1 nel livello dei design token — colore primario alla tinta 700 della tavolozza, testo attenuato a `surface.600`, etichette dei pulsanti «outlined» e «text» alla tinta 700 — e il tema Keycloak ha una tinta scura per testo, pulsanti e controlli, con il verde chiaro lasciato alle sole decorazioni; la pagina di accesso dichiarava `lang` con il nome dell'oggetto `LocaleBean` invece di `locale.currentLanguageTag`. Lo scorrimento orizzontale di 212 pixel attribuito allo stepper della configurazione iniziale non esisteva: era la transizione del margine del layout misurata a metà. Resta aperto, annotato fra i gap, il contrasto dei pulsanti pieni delle severità success, info, warn, help e danger, che Aura dà con il fondo alla tinta 500 e l'etichetta bianca, e la regola axe `aria-required-children` esclusa dall'audit della configurazione iniziale per il markup di `p-stepper`.

Il 2026-11-07 le verifiche dell'aggiornamento della piattaforma hanno trovato altri due difetti, già presenti prima e corretti. Il campo data e ora del rinvio personalizzato, nel widget delle notifiche, portava `aria-label` sull'ospite `<p-datepicker>`, che non lo passa al campo: ora usa l'ingresso `ariaLabel`, come `p-checkbox`. Il testo di `p-message` e `p-toast` era alla tinta 600 della tavolozza in modalità chiara, con `warn` a 2,84:1, e alla 500 in modalità scura: ora è alla 700, 800 per `warn`, e alla 400, e `accessible-theme.spec.ts` misura i rapporti sui token del preset installato. Nella stessa occasione è emerso che il preset accessibile definito in `app.config.ts` non arrivava a `providePrimeNG`, che usava ancora Aura senza scostamenti: le pagine pubbliche, che non hanno il configuratore, restavano con il primario alla tinta 500 e il testo attenuato a `surface.500`, e il resto dell'applicazione li riceveva solo quando il configuratore della topbar applicava il tema. Ora il preset di partenza è quello accessibile.

### 8.4 Provider Keycloak

```powershell
Set-Location keycloak-authenticator
.\mvnw.cmd clean verify
```

Serve un JDK 21 o più recente, per esempio il JDK 25 del backend: il modulo si compila con `release` 21, la versione di Java dell'immagine di Keycloak. `TenantRoleFlowIT` avvia Keycloak 26.8.2 con Testcontainers, il JAR del modulo — tema compreso — e un realm il cui browser flow usa `tenant-role-selector-authenticator`. Attraversa la pagina di accesso e quella di scelta, poi scambia il codice e legge i claim del token: tenant e ruolo scelti da soli quando l'utente ne ha uno, pagina di scelta quando il tenant offre più ruoli con `role_choice` nel token, ruolo non posseduto rifiutato, scelta del tenant fra due, utente senza tenant respinto. Sulle pagine del tema verifica i nomi delle app, non le chiavi dei messaggi, nella configurazione dell'app di autenticazione, il link al codice da inserire a mano, che compare una volta e porta alla stessa pagina con il codice in vista anche senza script, il ritorno all'accesso del recupero della password con una freccia sola e la conferma dell'uscita, una pagina che il tema non riscrive, dentro la scheda Taurus. Serve Docker.

Il tema `taurus-theme` viaggia dentro il JAR, che lo dichiara in `META-INF/keycloak-themes.json` e lo porta sotto `theme/taurus-theme` — `theme` al singolare, l'unica cartella che Keycloak legge da un archivio. Non c'è più nessuna copia montata da `taurus-be/src/main/docker`, quindi nessuna copia da cui divergere. `servesTheLoginPageWithTheThemeDeclaredInTheProvider` chiede la pagina di accesso del realm e verifica che arrivi con le classi e il foglio di stile del tema, cioè che Keycloak lo abbia caricato dal JAR. Le pagine che il tema non riscrive, come informazione, errore, uscita, pagina scaduta, aggiornamento del profilo e verifica dell'e-mail, arrivano da `base` e `keycloak.v2` con le classi di PatternFly 5: il tema non carica PatternFly, e `login.css` dà a quelle classi la forma delle pagine Taurus. Il loro aspetto si controlla a vista, nel caso `KC-008`. I modelli di posta li compila Keycloak quando l'e-mail parte, non la build, quindi un errore di sintassi si vede solo a quel punto: `EmailTemplatesTest` li rende con la stessa configurazione di `DefaultFreeMarkerProvider` — output HTML sfuggito, resolver delle classi disattivato, modelli letti dal classpath del JAR — e passa gli attributi che Keycloak passa davvero. Copre le parti HTML e testo dei quattro rami di `executeActions.ftl`, di `password-reset.ftl` e di `email-test.ftl`, un modello del tema base che chiama la macro `emailLayout` senza parametri, i colori e il logo dello [standard delle e-mail](email-layout-standard.md), gli oggetti italiani e lo SHA-256 del logo, lo stesso del backend; verifica che non restino interpolazioni irrisolte né entità sfuggite due volte. `EmailDeliveryIT` avvia Keycloak e Mailpit sulla stessa rete, chiede l'e-mail di configurazione dell'account dall'API di amministrazione e la legge da Mailpit: oggetto italiano, mittente «Taurus», parte testo e logo citato con `url.resourcesUrl`, che Keycloak serve come `image/png`. Serve Docker. Resta manuale il confronto a vista con le e-mail del backend, cioè il caso `KC-011`.

La suite verifica metadata del factory e service descriptor e, per il provider `taurus-otp` della firma, l'autorizzazione e la verifica dei codici (`TaurusOtpTest`). Dopo il pacchetto `TaurusOtpResourceIT` avvia Keycloak 26.8.2 con Testcontainers, il JAR del modulo e un realm di prova, e verifica stato dell'app, codice valido accettato una sola volta, codice errato e chiamanti non autorizzati: serve Docker. La qualificazione richiede anche i casi reali della sezione 12.

### 8.5 Servizio OMR

```powershell
Set-Location taurus-omr
python -m venv .venv
.venv\Scripts\pip install -r requirements-test.txt
.venv\Scripts\python -m pytest
docker build -t taurus-omr:test .
```

I test sostituiscono Audiveris e homr con programmi finti. I test dell'impaginazione usano Verovio e CairoSVG veri e, per disegnare, la libreria Cairo: su Windows di solito manca e quei test si saltano, mentre la CI installa `libcairo2` e `fonts-liberation` e li rende obbligatori con `TAURUS_OMR_REQUIRE_CAIRO=true`. Per eseguirli in locale basta un container Python 3.12 con le due librerie, montando il modulo:

```powershell
docker run --rm -v ${PWD}:/w -w /w -e TAURUS_OMR_REQUIRE_CAIRO=true python:3.12-slim sh -c "apt-get update -qq && apt-get install -y -qq --no-install-recommends libcairo2 fonts-liberation fontconfig > /dev/null && pip install -q -r requirements-test.txt && python -m pytest -p no:cacheprovider"
```

La pagina di riferimento `tests/engraving/marcia-a4-1.png` si ridisegna solo dopo un cambiamento voluto di Verovio o delle opzioni, con lo stesso container. La build dell'immagine verifica di nuovo le impronte di pacchetti, modelli e dati. `node scripts/ops/check-verovio-versions.mjs` controlla che Verovio abbia la stessa versione nel frontend e nel servizio.

L'accuratezza dei motori reali si misura con il servizio in esecuzione, per esempio quello avviato da `services.yml`:

```powershell
$env:TAURUS_OMR_ACCURACY_URL = 'http://localhost:8090'
$env:TAURUS_OMR_ACCURACY_KEY = 'taurus-omr-development-key'
.venv\Scripts\python -m pytest tests\test_accuracy.py -v -s
```

Il test riconosce le sei parti del corpus di riferimento (circa 5 minuti con 4 CPU), stampa la tabella dei risultati e fallisce se un motore legge meno battute del minimo fissato. La CI lo esegue sull'immagine appena costruita. Lo stesso confronto si applica alle parti reali con `python -m accuracy compare` ([Runbook operativo](runbook-operativo.md), §4.6).

### 8.6 Sito informativo

```powershell
Set-Location taurus-info
pnpm install --frozen-lockfile
pnpm check
pnpm build
docker build -t taurus-info:test .
docker run --rm -p 127.0.0.1:8088:8080 taurus-info:test
```

In un secondo terminale verificare `http://localhost:8088/health` e le pagine principali.

I controlli automatici del sito costruito sono in `pnpm test` (`scripts/check-build.mjs`): file attesi, `lang`, titolo, descrizione, canonical e `og:image` di ogni pagina, accessibilità strutturale, collegamenti interni che esistono, corrispondenza con la sitemap e intestazioni di sicurezza della configurazione nginx. L'accessibilità è quella che si legge nel file costruito: un solo `h1` per pagina e livelli di titolo senza salti, il punto di riferimento `<main>`, il testo alternativo delle immagini, il nome accessibile di collegamenti e pulsanti, l'etichetta dei campi e nessun `tabindex` positivo. Contrasto e tastiera restano al gate axe della suite end to end, che gira su un browser vero.

`pnpm test:image` (`scripts/smoke-image.mjs`) costruisce l'immagine, la avvia su una porta libera del loopback e la interroga come farebbe un browser: punto di salute, home con `200`, tipo `text/html`, le intestazioni di sicurezza davvero servite e `<main>` nel corpo, pagina inesistente con `404`, intestazione `Server` senza versione e nginx che non gira come root: l'immagine parte da `nginxinc/nginx-unprivileged` e ascolta sulla `8080` del container. Senza Docker si salta, a meno di `TAURUS_REQUIRE_DOCKER=1`.

Le intestazioni di sicurezza stanno in `security-headers.conf`, incluso dal blocco `server` e da ogni `location` di `nginx.conf`: nginx non eredita gli `add_header` del blocco esterno in un `location` che ne dichiara di propri, quindi senza quell'include le pagine uscirebbero senza nessuna intestazione. È il difetto che lo smoke ha trovato alla prima esecuzione; `check-build.mjs` ora controlla anche che l'include non manchi.

### 8.7 Sicurezza

Gli stessi controlli del job `security` della CI, eseguibili in locale con Docker e con le stesse versioni:

```powershell
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:v8.30.1 detect --source /repo --config /repo/.gitleaks.toml --redact --no-banner --exit-code 1
docker run --rm -v "${PWD}:/repo" aquasec/trivy:0.76.2 fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --ignorefile /repo/.trivyignore.yaml --exit-code 1 /repo
docker run --rm -v "${PWD}:/src" semgrep/semgrep:1.183.0 semgrep scan --config p/ci --error --quiet --metrics=off
```

Dependabot aggiorna le azioni GitHub, non le immagini lanciate con `docker run` nel job né l'input `version` di Trivy: quando si aggiornano gitleaks, Trivy o semgrep in `verify.yml`, si aggiornano anche questi comandi. Su Windows il montaggio della cartella può rendere semgrep lentissimo: in quel caso si copia il repository nel container con `docker create`, `docker cp` e `docker start -a`.

La ricerca dei segreti attraversa tutta la storia del repository. Le eccezioni vivono in `.gitleaks.toml` e sono soltanto valori di prova, di sviluppo e di documentazione: una credenziale vera non va aggiunta lì, va ruotata.

Le vulnerabilità che Trivy ignora sono in `.trivyignore.yaml`, che di norma non ha voci. Una voce serve solo quando la correzione non si può applicare subito: ha il file, il motivo, l'aggiornamento che la toglierà e una scadenza di al massimo 60 giorni, come chiede la decisione 13 dell'[aggiornamento della piattaforma](platform-upgrade-spec.md#13-sblocco-immediato-della-ci). Una voce scaduta torna a far fallire il controllo: si rinnova solo con una nuova motivazione nella pull request.

### 8.8 Manifest di produzione

Il manifest di `deploy/` si verifica senza avviare niente: lo script riempie le variabili
obbligatorie con valori finti, chiede a Compose di risolvere il file e controlla le scelte che non
devono regredire (una sola porta pubblicata e sul loopback, i dati su volumi, le restrizioni del
servizio OMR, Keycloak fuori da `start-dev`, profilo `prod` del backend, bundle dei certificati
della CIE montato in sola lettura). Lo esegue anche il job `documentation` della CI, quindi un
manifest che regredisce ferma la PR.

```powershell
bash scripts/ops/validate-deploy-manifest.sh
```

I certificati delle CA della CIE hanno due controlli. Il primo legge il bundle versionato e lo
confronta con le impronte attese, senza rete, ed è quello che gira a ogni modifica nello stesso job
della CI; il secondo riscarica la lista di fiducia di AgID e verifica che la fonte dica ancora le
stesse cose, e in CI gira una volta al mese (workflow `cie-trust-anchors`), perché dipende da un
servizio esterno:

```powershell
node scripts/ops/fetch-cie-trust-anchors.mjs --verify-bundle
node scripts/ops/fetch-cie-trust-anchors.mjs --check
```

Il secondo fallisce quando una CA della CIE è stata rinnovata: la procedura di aggiornamento è al
punto 4.7 del runbook operativo.

Su un'installazione avviata, lo smoke test non distruttivo di §8.4 del runbook operativo:

```powershell
bash scripts/ops/smoke-test.sh https://taurus.esempio.it
```

Serve Docker Compose v2 per il primo e solo `curl` per il secondo. Nessuno dei due scrive dati.

## 9. Selezione delle suite per modifica

| Modifica | Suite minima aggiuntiva |
| --- | --- |
| Entità/repository/migration | Backend completo, fresh DB, upgrade DB, due tenant, soft delete e backup/restore se distruttiva |
| Security/ruoli/OIDC | Matrice ruoli, token negativi, due tenant, login/logout/refresh E2E, i `*SecurityConfigurationTest` compreso `MethodSecurityConfigurationTest` |
| Feature flag | Tutte le combinazioni dipendenti, API negate, menu/route, cambio senza nuovo login, `TenantFeaturesSecurityConfigurationTest` |
| Scheduler/outbox | Idempotenza, retry, concorrenza, clock/timezone, multi-replica |
| Media/PDF/OCR | Tipi file, path traversal, limiti, rollback DB/file, cleanup e malware/content handling |
| RabbitMQ | Pubblicazione, consumo, redelivery, poison message, outage e recupero |
| Frontend condiviso/layout | Tutti i ruoli, responsive, tastiera, temi, build e smoke browser |
| Anteprima e stampa spartiti | Casi `PRV-*`, con stampa reale su almeno due browser e un documento per orientamento |
| QR, etichette e guasti inventario | Casi `QR-*`, test di `InventoryQr*`, `InventoryScan*`, `InventoryLabelServiceTest` e `InventoryIssueServiceTest`, spec di scansione, etichette e guasti, `e2e/specs/inventory-qr.spec.ts`, stampa e scansione reali come nelle [verifiche fisiche](inventory-qr-code-spec.md#verifiche-fisiche) |
| Preparazione evento | Casi `PREP-*`, `EventPreparationServiceTest`, `PreparationHashesTest`, `EventPreparationIT`, `EventPreparationSecurityConfigurationTest`, `EventPreparationNotificationSchedulerTest`, `CalendarOperationProviderTest` e `OperationalDashboardIT`, spec di `calendar-events/detail` e `detail/preparation/`, `e2e/specs/event-preparation.spec.ts` con `E2E_PREPARATION_EVENT_ID` |
| Firma elettronica | Casi `SIG-*` interessati, `SignatureIT`, `LoanSheetSignatureIT` e test di `service/signature`, specifiche delle finestre di firma e del codice, invio reale con Mailpit e con il server SMTP dell'ambiente, stampa del modello predefinito; per l'app di autenticazione anche `mvnw verify` di `keycloak-authenticator` |
| Ascolto, riconoscimento e correzione delle parti | Casi `PLY-*` interessati, `ScorePlaybackIT` e `ScoreRecognitionIT`, specifiche di `score-player/` e `score-editor/`, prova nel browser anche a larghezza di telefono |
| Servizio OMR, motori o modelli | `pytest`, build dell'immagine, test di accuratezza sul corpus e, se cambiano i motori, `PLY-018` |
| Keycloak provider/theme | Build JAR, avvio Keycloak reale, login, selezione tenant/ruolo e rendering temi |
| Configurazione/manifest | `scripts/ops/validate-deploy-manifest.sh` e `scripts/ops/fetch-cie-trust-anchors.mjs --verify-bundle`, poi deploy staging, probe, secret, rete, restart, rollback e `scripts/ops/smoke-test.sh` |
| Sito informativo | Link, metadata, sitemap, 404, cache, CSP, responsive e health |
| Dipendenze | Suite completa del modulo, vulnerability scan e compatibility smoke |

## 10. Matrice trasversale P0

Eseguire per ogni risorsa tenant-scoped significativa:

| ID | Caso | Risultato atteso |
| --- | --- | --- |
| `MT-001` | Utente A legge record A | Consentito secondo ruolo |
| `MT-002` | Utente A usa ID di record B | `404` o rifiuto senza rivelare l'esistenza |
| `MT-003` | Utente A crea/aggiorna/elimina indicando tenant B nel payload | Tenant da token; nessuna scrittura in B |
| `MT-004` | Token senza claim tenant su endpoint tenant | Rifiuto controllato |
| `MT-005` | Claim tenant sconosciuto/eliminato | Rifiuto fail-closed: `409` con `error.tenant.notProvisioned` sulle API dello schema tenant (per un tenant appena eliminato entro 30 secondi) |
| `MT-006` | Due richieste concorrenti A/B sul pool JDBC | Nessuna contaminazione di schema |
| `MT-007` | Eccezione durante richiesta A e riuso connessione da B | Schema ripristinato, nessun leak |
| `MT-008` | Scheduler attraversa A e B, A fallisce | B prosegue; contesto sempre corretto |
| `MT-009` | Media key/path di B richiesto da A | Accesso negato, nessun path leak |
| `MT-010` | Messaggio Rabbit di A elaborato dopo attività B | Contesto ricavato dal messaggio e isolato |
| `MT-011` | Feed/QR revocato o di altro tenant | Nessun dato esposto |
| `MT-012` | Export/report A | Nessun record o allegato B |

Ripetere CRUD, ricerca, paginazione, export, upload e cancellazione per almeno due tenant.

## 11. Autenticazione, autorizzazione e sessione

| ID | Caso | Priorità | Risultato atteso |
| --- | --- | --- | --- |
| `AUTH-001` | Login per ogni ruolo | P0 | Ruolo e tenant corretti; landing page consentita |
| `AUTH-002` | Password errata/utente disabilitato | P0 | Accesso negato senza dettaglio sensibile |
| `AUTH-003` | Token scaduto, firma errata o issuer diverso | P0 | `401` con `error.auth.unauthenticated`, nessuna elaborazione |
| `AUTH-004` | Token valido ma ruolo insufficiente | P0 | `403` con `error.auth.forbidden`; UI non sostituisce il controllo BE |
| `AUTH-005` | Accesso diretto a route FE non consentita | P1 | Redirect/rifiuto coerente |
| `AUTH-006` | Refresh token | P0 | Sessione rinnovata senza perdere tenant/ruolo |
| `AUTH-007` | Logout | P0 | Sessione locale e IdP chiuse come previsto |
| `AUTH-008` | Cambio tenant/ruolo nel provider | P0 | Nuovo contesto coerente, nessun dato precedente in cache |
| `AUTH-009` | Redirect URI e origin non autorizzati | P0 | Keycloak rifiuta |
| `AUTH-010` | Endpoint Actuator/API docs | P0 | Solo accessi previsti; health pubblico con dettagli limitati |
| `AUTH-011` | Super admin creato tramite API ordinaria | P0 | Operazione impossibile |
| `AUTH-012` | Clock skew e token vicino alla scadenza | P1 | Comportamento deterministico e osservabile |

Controllare la matrice ruolo × funzione almeno per super admin, admin, tesoriere, archivista, utente interno ed esterno. Verificare sia API sia menu/route.

## 12. Keycloak e provider custom

| ID | Caso | Risultato atteso |
| --- | --- | --- |
| `KC-001` | Installazione JAR su Keycloak 26.8.2 pulito | Provider rilevato senza errori SPI |
| `KC-002` | Import realm Taurus | Client, ruoli, flow e temi presenti |
| `KC-003` | Utente con un tenant/un ruolo | Selezione automatica o flow previsto |
| `KC-004` | Utente con più tenant/ruoli | Selettore completo, valori non manipolabili |
| `KC-005` | Tenant disabilitato/eliminato | Non selezionabile |
| `KC-006` | Parametro tenant/ruolo manomesso | Nessun claim non autorizzato |
| `KC-007` | Mapper OIDC | Claim tenant e ruoli corretti in ID/access token |
| `KC-008` | Login, reset password, TOTP, e-mail, uscita, informazione ed errore | Tema renderizzato, anche nelle pagine che non riscrive, e flussi completabili |
| `KC-009` | Upgrade/restart Keycloak | Provider continua a caricarsi |
| `KC-010` | Database Keycloak temporaneamente indisponibile | Fail-closed e recupero dopo ritorno DB |
| `KC-011` | In Mailpit: reimpostazione della password, configurazione dell'account, prova SMTP, codice di conferma, «Firma richiesta» e «Atto firmato» | Stessa intestazione, colori, pulsante e piè di pagina; scheda **Text** con le stesse informazioni; con le immagini remote bloccate il logo del backend resta e quello di Keycloak lascia la scritta «Taurus» ([standard delle e-mail](email-layout-standard.md)) |

Automatizzare questi casi con Keycloak reale; i soli unit test attuali non bastano per qualificare il provider.

## 13. Database, Liquibase e lifecycle tenant

| ID | Caso | Priorità | Risultato atteso |
| --- | --- | --- | --- |
| `DB-001` | Database completamente vuoto | P0 | `master.xml` completa; backend ready |
| `DB-002` | Creazione primo tenant | P0 | Registry `ACTIVE`, schema e changelog completi |
| `DB-003` | Creazione concorrente stesso tenant | P0 | Una sola registrazione/schema; risultato idempotente |
| `DB-004` | Avvio con più tenant esistenti | P0 | Tutti migrati; nessun tenant saltato |
| `DB-005` | Riavvio senza nuove migration | P0 | Nessun cambiamento o errore |
| `DB-006` | Upgrade dalla versione precedente supportata | P0 | Dati preservati e nuovi vincoli validi |
| `DB-007` | Errore migration di un tenant | P0 | Avvio/stato coerente, errore diagnosticabile, nessuna falsa readiness |
| `DB-008` | Lock Liquibase concorrente | P0 | Un solo migrator; nessuna corruzione |
| `DB-009` | Permessi runtime insufficienti per DDL | P1 | Runtime opera; provisioning/migration usa ruolo previsto |
| `DB-010` | Soft delete e cascade | P0 | Record nascosti/cascati secondo specifica |
| `DB-011` | Cancellazione GDPR tenant | P0 | Commit, drop schema e registry `DELETED` coerenti |
| `DB-012` | Restore DB più media | P0 | Referenze e file coerenti allo stesso punto |
| `DB-013` | Primo accesso con tenant senza schema (gruppo di bootstrap `temp`) | P0 | `GET /api/tenant-status` con `provisioned: false`; `409` con `error.tenant.notProvisioned` sulle API dello schema tenant e nessun errore di relazione inesistente; gestione tenant disponibile al super amministratore; altri ruoli sulla pagina «Tenant non configurato»; dopo creazione del tenant e nuovo login nessun errore |
| `DB-014` | Upgrade di un tenant con proforma inventario già generati | P1 | Tabella `inventory_report_export` eliminata; media dei PDF marcati come eliminati, salvo quelli usati da altre tabelle; file rimossi dalla pulizia dei media dopo il periodo di attesa |
| `DB-015` | Upgrade di un tenant con strumenti, tracce e parti esistenti all'ascolto delle parti | P1 | Tabelle di versioni, job e segnalazioni create; gli strumenti senza suono ricevono la proposta del catalogo, quelli già configurati restano invariati; un nuovo avvio non cambia nulla; flag `scorePlayback` spento |

Per ogni changeset verificare fresh install e upgrade. Dopo il rilascio non alterare changeset applicati: aggiungere un nuovo changeset correttivo.

## 14. Casi funzionali

### 14.1 Tenant, utenti e preferenze

- `TEN-001 P0`: CRUD tenant, validazione duplicati e campi obbligatori.
- `TEN-002 P0`: provisioning ruoli e associazioni Keycloak.
- `TEN-003 P0`: aggiornamento concorrente e controllo versione.
- `TEN-004 P0`: disattivazione tenant e accesso successivo negato.
- `USR-001 P0`: creazione, modifica ruoli e appartenenza tenant.
- `USR-002 P0`: utente globale con profili distinti in due tenant.
- `USR-003 P0`: cancellazione `/me`, GDPR e amministrativa; la cancellazione dei dati di un utente elimina anche le sue segnalazioni d'errore sulle parti.
- `USR-004 P1`: preferenze e ultime ricerche isolate e persistenti.
- `USR-005 P1`: accettazioni legali versionate e non riutilizzate impropriamente. Ogni nuova accettazione registra l'impronta SHA-256 del testo confermato; la pagina di accettazione mostra il testo di ogni documento in un riquadro scorrevole, con «Apri in una nuova scheda» verso l'indirizzo permanente della versione, e «Cosa cambia» solo a chi aveva confermato un'altra versione dello stesso documento. Un documento pubblicato con il solo indirizzo mostra il collegamento, come prima.
- `USR-006 P1`: in **Documenti legali** il super amministratore scrive una bozza con l'anteprima accanto (sotto i 1024 px testo e anteprima in due schede), la salva, la pubblica dopo la conferma che nomina la versione sostituita e da quel momento la vede in sola lettura: modifica ed eliminazione rispondono `legal.document.published.immutable`. «Nuova versione da questa» apre una bozza con tipo, titolo e testo compilati; ritiro e riattivazione cambiano la versione in vigore; un documento pubblicato con il solo indirizzo riceve il testo una sola volta e chi l'aveva confermato resta in regola. Gli altri ruoli ricevono `403`.
- `USR-007 P1`: senza login `/legal/terms` e `/legal/privacy` mostrano la versione in vigore, `/legal/terms/<versione>` e `/legal/privacy/<versione>` ogni versione pubblicata, con le altre versioni, l'impronta e «Stampa»; una versione ritirata ha l'avviso e `noindex`; una bozza o una versione inesistente risulta «Versione non trovata», un documento senza versione in vigore «Documento non disponibile». Testo con HTML scritto a mano, link `javascript:` e immagini: nulla di questo arriva alla pagina. Aperta dal piè di pagina con la sessione attiva, la pagina parte in una nuova scheda senza toccare la sessione della scheda di partenza; la stampa nasconde intestazione, pulsanti ed elenco delle versioni. Lettura senza sessione, versione precedente, versione inesistente, accessibilità a 320 pixel e piè di pagina sono anche in `e2e/specs/legal-documents.spec.ts`; con `E2E_LEGAL_PUBLISH=true` la stessa suite pubblica una versione dei termini, la fa confermare a un utente e rimette in vigore quella di prima.

### 14.2 Catalogo musicale

- `CAT-001 P1`: CRUD strumenti, album e tracce con validazioni.
- `CAT-002 P1`: associazioni ordinate album–tracce e parti/strumenti.
- `CAT-003 P0`: utente esterno vede solo contenuti pubblici.
- `CAT-004 P1`: paginazione, ordinamento, ricerca e filtri PostgreSQL.
- `CAT-005 P1`: soft delete, ripristino previsto e riuso dei riferimenti.
- `CAT-006 P1`: media di spartiti accessibili solo ai ruoli autorizzati.

### 14.3 Media, PDF e OCR

- `MED-001 P0`: upload, persistenza atomica, download e metadati.
- `MED-002 P0`: rollback DB elimina il file parziale; errore file non crea record.
- `MED-003 P0`: path traversal assoluto/relativo e separatori misti rifiutati.
- `MED-004 P0`: contenuto oltre 500 MB rifiutato anche dal proxy.
- `MED-005 P0`: estensione/MIME discordante e file corrotto gestiti.
- `MED-006 P1`: conversione PDF, pagine escluse e crop corretti.
- `MED-007 P1`: lettura del testo dei PDF scansionati con il servizio OMR: con il servizio attivo una parte scansionata con il nome dello strumento nel margine sinistro o nella fascia in alto riceve lo strumento suggerito ed è marcata da rivedere; con OCR spento, servizio non configurato, fermo o con chiave diversa il caricamento termina `DONE` senza suggerimenti; un PDF digitale con testo nel margine non chiama il servizio.
- `MED-008 P0`: cleanup elimina solo temporanei/orfani oltre soglia.
- `MED-009 P0`: file referenziato non viene cancellato.
- `MED-010 P1`: concorrenza upload/delete/download sullo stesso asset.
- `MED-011 P0`: upload PDF traccia restituisce `202` con job persistente in `TO_PROCESS`.
- `MED-012 P0`: worker e persistenza coprono `TO_PROCESS -> IN_PROGRESS -> DONE/ERROR` senza parti parziali visibili.
- `MED-013 P0`: consultazione e retry rispettano traccia, tenant, ruolo e idempotenza della pubblicazione.
- `MED-014 P1`: il dettaglio consulta i job una sola volta in `ngOnInit` e mostra lo stato persistente dopo refresh.
- `MED-015 P1`: `ERROR` presenta un'azione di retry che aggiorna la UI a «In coda» senza avviare polling.
- `MED-016 P0`: arresto del consumer, redelivery e retry non duplicano parti o media.
- `MED-017 P1`: riconoscimento dei nomi degli strumenti delle parti: nome esatto con i numeri d'ordine, parola chiave del catalogo con uno, più o nessuno strumento del tenant, strumenti fuori catalogo, tonalità diversa mai assegnata, più nomi sulla stessa riga, righe del PDF e dell'OCR (`InstrumentNamesTest`, `InstrumentNameRecognizerTest`, `PdfProcessingServiceTest`).
- `MED-018 P0`: strumenti da aggiungere su PostgreSQL (`TrackInstrumentSuggestionIT`): salvati con le parti nella stessa transazione, conservati dal salvataggio della traccia ed eliminati con la parte; un solo nome aperto per forma e parte; creazione con la proposta del catalogo, associazione, nomi ignorati e parti deselezionate; nome già esistente, versione cambiata, nome già deciso e parte di un'altra traccia senza nessuna modifica; isolamento fra tenant.
- `MED-019 P0`: unicità del nome dello strumento: creazione e rinomina con il nome di un altro strumento rifiutate con `instrument.name.exists`, rinomina che cambia solo maiuscole o punteggiatura accettata, tonalità e numeri d'ordine diversi accettati (`InstrumentsServiceImplTest`, `TrackInstrumentSuggestionIT`).
- `MED-020 P1`: a fine elaborazione il job riporta quante parti hanno strumenti, strumenti da aggiungere o nessuno strumento; chi ha caricato il PDF riceve la notifica solo con strumenti da aggiungere; un errore del riepilogo non fa fallire il job (`PdfInstrumentsOutcomeTest`, `ReceiverTest`).
- `MED-021 P1`: pannello Strumenti da aggiungere: presente solo con nomi aperti e per i ruoli che gestiscono l'archivio, preselezione delle parti senza strumenti e di nessuna possibile partitura, avviso sui soci, pannello disabilitato con modifiche non salvate, errori `version.conflict`, `instrument.name.exists` e `instrumentSuggestion.notOpen` con rilettura dei nomi, etichetta sulle parti e conferma prima di unirle (`instrument-suggestions-panel.component.spec.ts`, `score-workspace.component.spec.ts`).

### 14.4 Calendario e ricorrenze

- `CAL-001 P1`: CRUD evento, timezone, visibilità e partecipanti.
- `CAL-002 P0`: utenti esterni vedono solo eventi pubblici.
- `CAL-003 P1`: disponibilità/presenza univoca e aggiornabile.
- `CAL-004 P1`: reminder default, override, disabilitazione e cambio orario.
- `REC-001 P0`: generazione serie entro 500 occorrenze.
- `REC-002 P1`: modifica intera serie, singola occorrenza e future.
- `REC-003 P1`: cancellazione e ripristino eccezione.
- `REC-004 P0`: DST, fine mese/anno e ricorrenza senza data valida.
- `REC-005 P0`: retry/idempotenza non duplica occorrenze o reminder.
- `REC-006 P1`: «Salva da questo evento in poi» ripetuto due volte con uno spostamento non lo raddoppia; una regola che porta un'occorrenza sulla data di un'altra risponde `409 calendar.series.occurrence.conflict`.

### 14.5 Preparazione evento

- `PREP-001 P1`: configurazione, programma e materiali per admin.
- `PREP-002 P1`: archivista gestisce solo la parte catalogo autorizzata.
- `PREP-003 P1`: utente interno/esterno vede la vista minimizzata corretta.
- `PREP-004 P1`: tesoriere conferma budget o assenza movimenti.
- `PREP-005 P0`: scadenze generano una sola notifica per destinatario.
- `PREP-006 P0`: feature disabilitata blocca endpoint e scheduler.
- `PREP-007 P1`: con l'evento di `E2E_PREPARATION_EVENT_ID` la suite `e2e/specs/event-preparation.spec.ts` passa per amministratore, archivista, socio e tesoriere: criticità che portano alla sezione con il focus, riordino da tastiera con la guardia che elenca il programma, sola lettura del socio, sole API economiche del tesoriere, axe e 320 px.
- `PREP-008 P1`: due schede sulla stessa preparazione; salvare il programma in una e poi nell'altra produce il dialogo «Programma modificato da un'altra persona»: «Ricarica» mostra il programma della prima scheda, le modifiche dei materiali aperte nella seconda restano e la guardia di uscita le elenca. Lo stesso per materiali e configurazione.
- `PREP-009 P1`: dopo il rilascio le conferme di preventivo, presenze, assenza di movimenti e materiali date prima compaiono come superate e si possono ripetere; con Inventario disattivato un piano che richiedeva i materiali li mostra fra le «Aree escluse dalla valutazione» e non diventa `UNKNOWN`.
- `PREP-010 P1`: cambiare dall'Inventario la condizione dell'oggetto o la quantità ancora in carico dell'assegnazione di un materiale confermato, prima dell'evento, produce una sola notifica «Conferma materiale non più valida» agli amministratori, che apre la sezione Materiali con il focus; una nuova conferma seguita da un altro cambiamento ne produce un'altra.

### 14.6 Inventario e QR

- `INV-001 P0`: quantità totali, assegnate, restituite e residue coerenti.
- `INV-002 P0`: assegnazione oltre disponibilità rifiutata anche in concorrenza.
- `INV-003 P1`: revisioni, decisioni e audit immutabili.
- `INV-004 P1`: reso parziale/totale e foto associate.
- `INV-005 P0`: cancellazione/erasure non rompe la tracciabilità prevista.
- `INV-006 P1`: il proforma PDF dell'inventario non esiste più: nessun pulsante né endpoint `/report`; il socio scarica solo i propri fogli di affidamento.
- `INV-007 P1`: scadenze e notifiche una volta per finestra.
- `LOAN-001 P0`: foglio di affidamento emesso solo con regime di comodato e scadenze coerenti con le regole di durata del tenant, copiate sul foglio; un solo foglio emesso per socio.
- `LOAN-002 P0`: consegne successive, sostituzioni, rinnovi e riconsegne parziali compaiono nel registro delle variazioni; il rinnovo oltre i limiti è rifiutato.
- `LOAN-003 P1`: chiusura solo con beni tutti rientrati; il verbale di riconsegna riporta esito, addebito e firmatario.
- `LOAN-004 P0`: definizione manuale e automatica rimuovono dati personali e PDF del foglio; il socio non scarica più il PDF.
- `LOAN-005 P1`: modello del foglio caricabile per tenant con versioni immutabili; il predefinito e il proprio modello si scaricano; variabili sconosciute, risorse esterne e costrutti non ammessi bloccano anteprima e attivazione; i fogli già emessi restano generati con il proprio modello.
- `LOAN-006 P1`: stampa A4 del foglio sovrapponibile al modello Word dell'associazione (verifica fisica).
- `LOAN-007 P0`: assegnazione, o modifica della scadenza, di un oggetto in comodato con scadenza: data mancante o fuori dall'intervallo rifiutata con un messaggio che indica le date ammesse, mostrato sotto il campo; il calendario resta libero e indica l'intervallo; regole del foglio emesso del socio o, senza foglio, regole correnti del tenant; comodato precario e regime non indicato restano liberi.
- `LOAN-008 P1`: valore concordato del foglio uguale al valore unitario stimato dell'oggetto in euro, copiato sulla riga all'emissione; con altra valuta la cella resta vuota.
- `QR-001 P0`: risoluzione public ID restituisce solo dati pubblici previsti.
- `QR-002 P0`: ID inesistente, ruotato o tenant/feature disabilitati non espongono dati.
- `QR-003 P1`: rate limit per risoluzione applicato e recupera dopo finestra.
- `QR-004 P1`: etichetta/QR leggibile ai formati e dimensioni supportati.
- `QR-005 P0`: segnalazione problema e foto isolate per tenant.
- `QR-006 P1`: rotazione con motivazione: il vecchio codice risponde subito `404`, la scansione resta sulla scheda e propone `Stampa nuova etichetta`, gli altri amministratori ricevono la notifica con la motivazione e l'autore no.
- `QR-007 P1`: la scansione mostra solo le azioni di `allowedActions`; una sola consegna si apre direttamente, più consegne si elencano con i collegamenti a presa visione, riconsegna e segnalazioni, e la sezione raggiunta riceve il focus.
- `QR-008 P1`: stampa oltre il tempo massimo o con tutti i renderer occupati risponde `503 inventory.labels.timeout` o `inventory.labels.busy`, senza PDF parziale; `INVENTORY_QR_LABEL_TIMEOUT_SECONDS` fuori da 1-300 ferma l'avvio.
- `QR-009 P0`: solo admin e super admin rimuovono una foto di guasto; la foto sparisce per tutti, il file lascia lo storage se non è usato altrove e la segnalazione resta intatta.
- `QR-010 P1`: notifiche dei guasti: creazione agli amministratori con la quantità e senza l'autore, presa in carico al solo segnalante, risoluzione e respingimento con `eventKey` distinti per destinatario.
- `QR-011 P1`: metriche `taurus_inventory_*` e log `inventory_*` senza UUID, tenant, subject o testo libero; l'autore compare solo come `actorHash`, il codice come `codeHash`.
- `QR-012 P1`: il socio allega fino a cinque foto nel dialogo del guasto, con anteprima e rimozione; se un caricamento fallisce la segnalazione resta e le foto mancanti si aggiungono dal dettaglio della consegna.

### 14.7 Economia

- `FIN-001 P0`: conti, movimenti, categorie e saldi coerenti.
- `FIN-002 P0`: autorizzazione limitata a super admin/admin/tesoriere.
- `FIN-003 P0`: importi zero, negativi, decimali e arrotondamenti.
- `FIN-004 P1`: allegati seguono lifecycle media e permessi.
- `FIN-005 P0`: rollover annuale idempotente e timezone corretto.
- `FIN-006 P1`: rendiconto e totali riconciliabili con i movimenti.
- `FIN-007 P0`: cancellazione/soft delete non altera il saldo in modo incoerente.
- `FIN-008 P0`: feature disabilitata nasconde UI e nega API senza cancellare dati.
- `FIN-009 P1`: conto archiviato riattivabile; riattivazione negata se un altro conto attivo ha lo stesso nome.
- `FIN-010 P0`: eliminazione conto negata su conto attivo o con movimenti attivi, consentita su conto archiviato i cui movimenti sono tutti eliminati.
- `FIN-011 P1`: conto eliminato assente da elenchi, filtri e rendiconti, con i movimenti eliminati ancora integri a database.
- `FIN-012 P0`: il saldo iniziale di un conto creato in un esercizio successivo resta invariato dopo il riporto automatico e dopo «Ricalcola», ed entra nel saldo d'apertura di estratto conto e rendiconto annuale.

### 14.8 Notifiche, preferenze e Web Push

- `NOT-001 P0`: pubblicazione outbox nello stesso commit del dominio.
- `NOT-002 P0`: rollback dominio non lascia notifica.
- `NOT-003 P0`: dispatcher idempotente non duplica destinatari.
- `NOT-004 P1`: retry esponenziale, errore sanitizzato e chiusura manuale.
- `NOT-005 P1`: retention elimina solo stati e date eleggibili.
- `PREF-001 P1`: default tenant/applicativo e override utente.
- `PREF-002 P1`: pausa, snooze, digest e quiet hours ai limiti.
- `PREF-003 P0`: notification REQUIRED ignora opt-out di categoria previsto.
- `PUSH-001 P0`: registrazione e revoca subscription.
- `PUSH-002 P0`: VAPID errata produce failure osservabile e retry controllato.
- `PUSH-003 P1`: subscription invalida rimossa senza bloccare le altre.
- `PUSH-004 P0`: reminder non viene inviato dopo l'inizio evento.
- `PUSH-005 P1`: anteprima privata non espone titolo/contenuto sensibile.

### 14.9 Feed calendario esterno

- `FEED-001 P0`: creazione, rotazione e revoca token.
- `FEED-002 P0`: token non appare in log, metriche, referrer o errori.
- `FEED-003 P0`: scope interno/pubblico coerente con ruolo proprietario.
- `FEED-004 P1`: GET e HEAD, ETag/cache e contenuto iCalendar valido.
- `FEED-005 P1`: tombstone `CANCELLED` e relativa retention.
- `FEED-006 P0`: rate limit token/IP/globale e risposta non informativa.
- `FEED-007 P0`: idempotency key non duplica operazioni e non attraversa tenant.
- `FEED-008 P1`: collaudo reale con Google Calendar, Apple Calendar e Outlook.

Lo stato della feature è `in-progress`; un rilascio che la abilita deve includere i collaudi client e la verifica della redazione del token su proxy/WAF/APM.

### 14.10 Onboarding e importazione

Riferimento: [Onboarding guidato e importazione iniziale del tenant](tenant-onboarding-import-spec.md). Backend e frontend sono automatizzati (`OnboardingImportIT` per preflight, concorrenza, limiti, sicurezza per ruolo, riavvio in ogni fase della saga e carico da 5.000 righe, `OnboardingKeycloakIT` per la saga delle identità su Keycloak reale, `OnboardingFileInspectionServiceTest` per formato reale e file ostili, le specifiche di `onboarding/` e `onboarding.service` e la suite end to end `onboarding-import.spec.ts`, che non carica e non applica nulla); i casi seguenti richiedono un browser, Mailpit (`http://localhost:8025`) o una casella reale e un tenant di prova, e scrivono nell’ambiente dati che la modalità additiva non può togliere.

- `ONB-001 P0`: template e import valido end-to-end.
- `ONB-002 P0`: validazione limiti file, 5.000 righe, 2.000 utenti, 64 colonne e cella da 10.000 caratteri.
- `ONB-003 P0`: CSV injection, encoding, delimitatori, quote e newline.
- `ONB-004 P1`: preview/report coerente con applicazione effettiva.
- `ONB-005 P0`: errore Keycloak attiva compensazione senza identità orfane.
- `ONB-006 P0`: crash in ogni fase e recovery idempotente.
- `ONB-007 P0`: retry e-mail non reinvia quelle già riuscite.
- `ONB-008 P1`: cancellazione job prima/durante applicazione secondo stato.
- `ONB-009 P0`: sezioni Economia/Inventario filtrate dai feature flag.
- `ONB-010 P1`: retention: dopo 30 giorni dalla conclusione file, righe e problemi rimossi, journal ridotto agli esiti e `409 onboarding.job.sourceRemoved` su nuova validazione o nuovo invio delle e-mail; dopo 365 giorni il job è eliminato; i job `COMPENSATION_REQUIRED` e quelli non conclusi restano intatti.
- `ONB-011 P1`: il foglio `Strumenti` accetta il formato precedente e quello con le colonne di suono e trasposizione; valori non validi sono errori di validazione; per uno strumento già esistente suono e trasposizione indicati non vengono applicati e la validazione lo avvisa.
- `ONB-012 P0`: preflight dell’applicazione: file sostituito dopo il caricamento rifiutato con `SOURCE_INTEGRITY_FAILURE`, conflitto nato dopo la prima validazione rifiutato con `PREFLIGHT_CONFLICT`, seconda applicazione contemporanea respinta con `409 onboarding.tenant.busy` e nessuna scrittura parziale.
- `ONB-013 P1`: limiti oltre il file: celle complessive, lunghezza della singola cella, problemi conservati (`TOO_MANY_ISSUES`) e tre importazioni in attesa per autore (`409 onboarding.pendingJobs.tooMany`).
- `ONB-014 P0`: file ostili: macro, formule, collegamenti esterni, DDE, oggetti incorporati e ActiveX rifiutati; estensione mentita riconosciuta dal contenuto e non dal nome.
- `ONB-015 P1`: interfaccia: esito del passo 5 con conteggi per sezione e identità, elenco problemi paginato con il valore che rimanda al suo problema, vista compatta sotto 768 pixel, «Ultima importazione» nel riepilogo, invito a cambiare istanza nel dettaglio di un altro tenant, `304` al polling con lo stesso ETag e polling sospeso a pagina nascosta.
- `ONB-016 P1`: notifica di riepilogo recapitata una sola volta con i soli conteggi, metriche `taurus.onboarding.*` esposte e importazioni abbandonate annullate dopo sette giorni.

### 14.11 Dashboard e feature flag

- `DASH-001 P1`: operazioni aggregate per ruolo senza duplicati.
- `DASH-002 P1`: blocker, warning e follow-up ordinati e conteggiati.
- `DASH-003 P0`: nessun dato di moduli/tenant non autorizzati.
- `DASH-004 P1`: «Eventi con preparazione bloccata», «Eventi da verificare» ed «Eventi da chiudere» aprono il calendario con «Filtro attività applicato» e gli stessi eventi contati dalla riga; con nessun evento l'elenco è vuoto, non l'intero calendario.
- `DASH-005 P1`: un evento fra sette e quattordici giorni con il solo avviso sulle disponibilità resta in «Risposte agli eventi mancanti»; entro sette giorni passa alla preparazione e non è contato due volte.
- `DASH-006 P0`: con `inventory-warning-days` maggiore di `inventory-expiration-look-ahead-days` il backend non parte e il messaggio nomina le due proprietà.
- `DASH-007 P1`: dopo un cambio di tenant la sezione «Da fare» non mostra mai, neppure durante il caricamento, le voci del tenant precedente.
- `FLAG-001 P0`: tutti i dodici flag default `false` per nuovo tenant.
- `FLAG-002 P0`: capacità globale spenta prevale sul flag tenant acceso.
- `FLAG-003 P0`: dipendenza spenta rende inefficace l'estensione.
- `FLAG-004 P0`: cambio flag diventa effettivo senza nuovo login.
- `FLAG-005 P0`: UI, route, API, scheduler e notifiche reagiscono coerentemente.
- `FLAG-006 P0`: disabilitare/riabilitare conserva i dati.
- `FLAG-007 P1`: update concorrente dei flag non perde modifiche.
- `FLAG-008 P0`: `GET /api/tenant-features/capabilities` risponde `200` al solo super amministratore, `403` ad admin, tesoriere, archivista, utente ed esterno e `401` senza token, mentre `GET /api/tenant-features/current` resta leggibile da ogni ruolo; automatizzato in `TenantFeaturesSecurityConfigurationTest`.
- `FLAG-009 P0`: con «Calendario» spento per il tenant spariscono la voce di menu e il pulsante della topbar, `/calendar` riporta alla dashboard, la dashboard non mostra «Prossimi eventi» né le voci del calendario in «Da fare», il profilo e il dettaglio utente non mostrano gli eventi a cui si è partecipato e il tour guidato salta i passi degli eventi; `/api/calendar-events/**`, `/api/user/calendar-events/**`, `/api/external/calendar-events/**`, `/api/calendar-event-series/**`, gli eventi dell'utente e i filtri della dashboard rispondono `403 tenantFeature.calendar.disabled`. Automatizzati in `TenantFeatureServiceTest`, `OperationalDashboardServiceTest`, `NotificationFeaturePolicyTest`, `app.routes.spec.ts`, `menu.component.spec.ts`, `topbar.component.spec.ts`, `dashboard.component.spec.ts` e `guided-tour-steps.spec.ts`.
- `FLAG-010 P0`: spento il calendario, Feed calendario esterno, Preparazione evento e Promemoria Web Push diventano inefficaci pur restando spuntati; la pagina del tenant li elenca «(per dipendenza)» nella conferma e li mostra tra le estensioni con «Richiede un’altra funzionalità»; riaccendendo il calendario tornano effettivi senza nuovo login. Automatizzati in `TenantFeatureServiceTest`, `TenantsServiceImplTest` e `detail.component.spec.ts` dei tenant.
- `FLAG-011 P0`: spento il calendario con l'Economia attiva, la pagina Economia non mostra la scheda Eventi, i riquadri «Da incassare/Da pagare per gli eventi», il filtro e la scelta dell'evento nei movimenti né gli eventi aperti dell'esercizio; gli endpoint `/api/finance/events/**` e i report degli eventi rispondono `403`; la modifica di un movimento collegato a un evento conserva il collegamento. Riaccendendo il calendario tutto torna visibile. Automatizzati in `FinanceServiceGuardsTest` e `finance.component.spec.ts`.

### 14.12 Anteprima e stampa spartiti

Unità e componente sono automatizzati in `taurus-fe/src/app/pages/preview/preview.component.spec.ts`. I casi seguenti restano manuali perché dipendono da più superfici, dal dialogo di stampa del browser o dal rendering reale.

- `PRV-001 P1`: ingresso da traccia, da album completo e da selezione di tracce conserva titolo, contesto e ordine delle parti.
- `PRV-002 P0`: ogni ruolo ammesso vede solo media già autorizzati; lo stream applica di nuovo autenticazione e isolamento tenant.
- `PRV-003 P1`: filtro per strumento e «Senza strumento» aggiornano anteprima, presentazione e stampa senza duplicare parti multi-strumento.
- `PRV-004 P1`: oltre 960 px la spalla parte aperta, fino a 960 px parte chiusa con maschera; «Filtri», X, maschera, «Apri filtri» ed `Escape` producono l'esito dichiarato e il focus torna dove previsto.
- `PRV-005 P1`: stampa reale da Chrome ed Edge con un documento verticale e uno orizzontale; ordine corretto, nessuna UI, nessun foglio vuoto iniziale o finale.
- `PRV-006 P1`: in 2-up con totale dispari l'ultima pagina occupa il primo slot e il secondo resta vuoto sullo stesso foglio.
- `PRV-007 P1`: formato carta e orientamento restano scelte del dialogo di sistema; con «Pagine per foglio» del browser a 1 non avviene un secondo accorpamento.
- `PRV-008 P1`: lo zoom resta tra 60 e 140 per cento, «Adatta» torna a 100 e la stampa non ne è influenzata.
- `PRV-009 P1`: una pagina non disponibile mostra il segnaposto con «Riprova» senza salto di layout; le altre pagine restano consultabili e stampabili.
- `PRV-010 P1`: un errore nel caricamento delle tracce di un album non apre un'anteprima parziale e conserva la selezione sulla pagina sorgente.
- `PRV-011 P1`: refresh o collegamento diretto a `/preview` senza stato riporta a una destinazione sicura senza errori non gestiti.
- `PRV-012 P1`: la presentazione parte dalla pagina corrente, `Escape` chiude prima la presentazione e alla chiusura l'anteprima resta sull'ultima pagina mostrata.
- `PRV-013 P1`: tema chiaro/scuro, viewport fino a 320 px, nomi lunghi e comandi a sola icona con area attiva di almeno 44 × 44 px.

### 14.13 Ascolto, riconoscimento e correzione delle parti

Riferimento: [Ascolto e correzione delle parti](track-score-playback-spec.md). Backend, frontend e servizio OMR sono automatizzati (`ScorePlaybackIT`, `ScoreRecognitionIT`, specifiche di `score-player/` e `score-editor/`, test pytest e di accuratezza di `taurus-omr`, §8.5); i casi seguenti richiedono il servizio OMR reale, un browser e un tenant di prova.

- `PLY-001 P0`: con la funzionalità del tenant disattivata nessuna azione di ascolto o riconoscimento è visibile e le API rispondono `403`.
- `PLY-002 P0`: un utente vede «Ascolto non ancora disponibile» sulle parti senza versione utilizzabile, ascolta tutte le parti disponibili e vede lo spartito solo delle proprie; un esterno solo sulle tracce `PUBLIC`.
- `PLY-003 P1`: un archivista avvia «Riconosci» su una parte con pagine a 300 DPI; lo stato passa da «in coda» a «in corso» senza ricaricare la pagina e al termine arriva la notifica; la versione proposta si ascolta con l'etichetta «Non verificata».
- `PLY-004 P1`: «Riconosci tutte le parti» produce un riconoscimento per parte e una sola notifica finale.
- `PLY-005 P1`: con il servizio OMR fermo il riconoscimento termina con «servizio non raggiungibile» e «Riprova» lo riavvia a servizio ripristinato.
- `PLY-006 P1`: un MusicXML con più parti chiede quale importare; un MIDI viene convertito e si ascolta.
- `PLY-007 P1`: ritornelli, volte, D.C. al Fine e D.S. al Coda si eseguono correttamente; «Senza ritornelli» li salta; la battuta evidenziata segue l'ascolto anche sulle pause di più battute.
- `PLY-008 P1`: le parti di strumenti traspositori suonano in suoni reali, anche in chiave di basso; «Prova» nel dettaglio dello strumento rispetta suono e trasposizione.
- `PLY-009 P1`: ascolto su un telefono Android di fascia media con Chrome, collegato con il debug remoto (`chrome://inspect`), prima con la cache vuota e poi di nuovo: il messaggio di caricamento indica i circa 40 MB del primo scaricamento, i suoni si caricano e la parte si ascolta senza interruzioni; in Gestione attività di Chrome la memoria della scheda resta entro quella misurata in [Copertura della fase 4](track-score-playback-spec.md#copertura-della-fase-4) più il margine del dispositivo; lettore e partitura restano usabili in verticale, con le righe del mixer chiuse dietro «Mostra le parti» e i tocchi nella parte alta della pagina che non portano alla pagina iniziale.
- `PLY-010 P0`: nessun dato di ascolto, riconoscimento, correzione o segnalazione di un tenant è accessibile da un altro tenant.
- `PLY-011 P1`: «Correggi» su una versione di Audiveris apre l'editor a schermo intero; un clic su una nota la seleziona e la pagina originale mostra il riquadro della sua battuta, tratteggiato se approssimato; senza posizioni un avviso lo spiega.
- `PLY-012 P1`: nell'editor si correggono altezza, alterazione, figura e punto con mouse e tastiera; le battute di durata errata si colorano e si elencano, e «Annulla» e «Ripristina» ripercorrono le modifiche.
- `PLY-013 P1`: correggere la chiave lascia le note sulla stessa riga e correggere l'armatura cambia le note senza accidente; inserire ed eliminare battute mantiene il riquadro sulle battute originali.
- `PLY-014 P1`: ritornelli, volte, salti, tempo e pause di più battute scritti nell'editor si ascoltano come previsto nel lettore; «Ascolta» nell'editor suona la battuta o l'intervallo scelto con Maiusc+clic.
- `PLY-015 P1`: «Salva» crea una versione non verificata e «Salva e approva» una approvata; chiudere con modifiche non salvate chiede conferma; il file scaricato si apre in MuseScore senza avvisi.
- `PLY-016 P1`: un utente e un esterno inviano «Segnala un errore» dal lettore con e senza battuta; archivisti e amministratori ricevono la notifica, vedono l'etichetta sulla parte e chiudono la segnalazione, che si chiude anche approvando una correzione; all'undicesima segnalazione aperta sulla stessa parte l'utente riceve il messaggio del limite.
- `PLY-017 P2`: tempo di disegno nell'editor dopo una modifica su una parte di oltre 150 battute.
- `PLY-018 P1`: parti reali della banda, almeno tre digitali, tre scansioni e due foto: si riconoscono, si correggono e si approvano, poi `python -m accuracy compare` confronta la versione approvata con quella di ciascun motore; si registrano battute corrette, battute lette, struttura e tempo di riconoscimento, e la versione proposta è la migliore delle due nella maggior parte delle parti.
- `PLY-019 P1`: la CI di una modifica a `taurus-omr` costruisce l'immagine, misura l'accuratezza sul corpus e pubblica la tabella nel riepilogo del job; alzando il minimo di un motore oltre il risultato misurato il job fallisce.
- `PLY-020 P1`: creando lo strumento «Corno in Mib» Taurus propone suono French Horn e trasposizione −9, che l'archivista prova con «Prova» e conferma; uno strumento senza proposta resta non configurato, le sue parti si ascoltano con l'avviso e compare nel filtro «Da configurare per l'ascolto».

### 14.14 Firma elettronica

Riferimento: [Firma elettronica del foglio di affidamento e della presa visione](inventory-electronic-signature-spec.md). Backend e frontend sono automatizzati (`SignatureIT`, `LoanSheetSignatureIT`, `InventoryElectronicSignatureMigrationIT`, test unitari di `service/signature`, compresi `SignatureMailServiceTest` e `TaurusMailSenderTest` sulle e-mail HTML e testo, `KeycloakOtpClientTest`, `LoanSheetSigningTest`, `CieSignVerifierTest` con una CA di prova e `CieSignServiceTest`, e `LoanSheetActsTest`, `SignatureSecurityConfigurationTest`, `TaurusOtpTest` e `TaurusOtpResourceIT` del provider Keycloak, specifiche di `signature-code-dialog/`, `signature-act-dialog/`, `own-signature-acts/`, `signature-method-settings/`, `signature.service`, della finestra di emissione e del modello del foglio); i casi seguenti richiedono un browser, Mailpit (`http://localhost:8025`) o una casella reale e un tenant di prova; quelli di CieSign anche una Carta d'Identità Elettronica reale con il PIN, l'app CieSign su Android e iOS o il Software CIE su PC con un lettore NFC, e i certificati della CIE configurati in `SIGNATURE_CIE_TRUST_ANCHORS`.

- `SIG-001 P0`: con la firma disattivata la presa visione si conferma senza codice come prima; con la firma attiva l'endpoint diretto risponde `409` con `inventory.decision.signatureRequired` e le decisioni già registrate non cambiano.
- `SIG-002 P0`: nella pagina del modello l'interruttore non attiva la firma finché un requisito dell'installazione è «Mancante»; con server di posta, chiave dei codici e sigillo configurati l'attivazione chiede conferma e riesce; due amministratori che cambiano l'impostazione insieme ricevono `signature.settings.versionConflict`.
- `SIG-003 P0`: «Firma la scelta» nel dettaglio dell'assegnazione invia un codice di 6 cifre all'e-mail dell'utente; il messaggio riporta associazione, operazione, riferimento e scadenza e non contiene link; il codice corretto registra la scelta, il toast conferma la firma e la decisione mostra la firma.
- `SIG-004 P0`: un codice errato mostra nella finestra i tentativi rimasti; al quinto errore la conferma si blocca; un codice scaduto, già usato o di un'altra conferma è rifiutato; dopo blocco, scadenza o chiusura la finestra propone «Richiedi un nuovo codice».
- `SIG-005 P1`: «Invia un nuovo codice» resta disabilitato per 60 secondi con il conto alla rovescia, il nuovo codice sostituisce il precedente e dopo 5 invii la finestra lo segnala; la ventunesima conferma aperta in un'ora risponde con il tempo d'attesa.
- `SIG-006 P1`: in «I miei oggetti» le consegne in possesso senza presa visione hanno la casella di selezione; «Accetta e firma» accetta tutte le selezionate con un solo codice e le dichiarazioni le elencano tutte; il rifiuto si conferma solo dal dettaglio, con la motivazione.
- `SIG-007 P0`: se un amministratore modifica l'assegnazione dopo l'invio del codice, la conferma fallisce con `inventory.revision.versionConflict`, la finestra si chiude e i dati si ricaricano.
- `SIG-008 P1`: con il server SMTP fermo la richiesta del codice risponde «Non è stato possibile inviare il codice via e-mail», la conferma è annullata e il log registra `signature_mail_failed` senza indirizzo né codice.
- `SIG-009 P0`: `POST /api/inventory/signatures/verify-chain` conferma la catena del tenant; una prova modificata direttamente nel database, con il trigger disattivato, viene rilevata con la sequenza e il problema.
- `SIG-010 P0`: la cancellazione GDPR di un utente rimuove dichiarazione, nome, e-mail, sessione, IP e user agent dalle sue prove, pseudonimizza i suoi firmatari ed elimina le sue conferme; la catena resta verificabile.
- `SIG-011 P0`: conferme, atti e prove di un tenant non sono accessibili da un altro tenant; la conferma di un altro utente risponde `404`.
- `SIG-012 P0`: nei log non compaiono codici, e-mail complete, token o hash dei codici.
- `SIG-013 P0`: con la firma attiva e il modello predefinito, la finestra di emissione propone la firma elettronica per un socio maggiorenne con l'amministratore corrente come firmatario per l'Associazione; per il genitore o tutore, o con un modello senza marcatori, la modalità resta su carta con il motivo.
- `SIG-014 P0`: il socio riceve la notifica, inserisce i dati (codice fiscale errato rifiutato, casella «Non ho un codice fiscale italiano» accettata), apre il documento, spunta la lettura e firma con il codice; la finestra si riapre per l'approvazione delle clausole con un nuovo codice.
- `SIG-015 P0`: l'amministratore designato riceve la notifica e firma per l'Associazione; l'atto diventa «Firmato», documento, clausole e attestazione si scaricano e in Acrobat il sigillo risulta presente e il documento non modificato dopo la firma.
- `SIG-016 P1`: consegna successiva, sostituzione, rinnovo e restituzione parziale creano ciascuna un atto di variazione con la sola riga dell'operazione; più variazioni si firmano insieme con un codice; la restituzione che lascia il foglio vuoto non crea un atto.
- `SIG-017 P0`: alla chiusura nasce il verbale di riconsegna; firmato da entrambe le parti con esito senza addebiti, il foglio si definisce da solo e le variazioni non firmate vengono annullate.
- `SIG-018 P1`: «Cambia firmatario» prima di ogni firma: sull'emissione con documenti pronti il socio deve reinserire i dati; dopo la prima firma il cambio è rifiutato; «Firmato su carta» con nota e codice dell'amministratore chiude l'atto.
- `SIG-019 P0`: il fascicolo ZIP contiene una cartella per atto firmato con documenti sigillati e attestazione e un indice con le impronte SHA-256 corrispondenti ai file; gli atti su carta compaiono solo nell'indice; dopo il periodo di grazia (anticipato nel database) la pulizia elimina file e dati personali e il fascicolo risponde «eliminati da Taurus».
- `SIG-020 P0`: la cancellazione GDPR di un socio con fogli elettronici e senza materiale in carico elimina subito documenti, attestazioni e dati personali delle prove dei suoi atti e il fascicolo risponde «eliminati da Taurus»; con materiale in carico l'eliminazione avviene al completamento della pratica, dopo la riconsegna. La catena resta verificabile.
- `SIG-021 P0`: nel profilo, sezione **Firma elettronica**: con l'app non configurata «Configura app» porta alla configurazione di Keycloak e al ritorno lo stato è «Configurata»; scegliendo «App di autenticazione» prima di configurarla compare l'avviso che le firme useranno il codice via e-mail; al login successivo Keycloak chiede il codice dell'app.
- `SIG-022 P0`: con l'app preferita e configurata la finestra del codice chiede il codice dell'app senza inviare e-mail (Mailpit vuoto); il codice corrente firma, lo stesso codice usato per una seconda firma è rifiutato come errato, un codice errato consuma un tentativo; nelle prove il metodo è «Codice dell'app di autenticazione».
- `SIG-023 P1`: dalla finestra del codice «Ricevi il codice via e-mail» invia il codice e «Usa l'app di autenticazione» torna all'app; per un utente senza app configurata l'opzione dell'app non compare.
- `SIG-024 P1`: con Keycloak fermo durante una firma con l'app la finestra spiega che l'app non si può verificare e propone l'e-mail, il log registra `signature_totp_unavailable` e la firma via e-mail riesce; senza `SIGNATURE_KEYCLOAK_CLIENT_SECRET` il profilo mostra l'app come non disponibile.
- `SIG-025 P0`: emissione elettronica con Affidatario «Genitore o tutore»: senza e-mail del genitore l'emissione è bloccata; con l'e-mail Mailpit riceve «Firma richiesta» con il link `/firma/…` e la sezione **Firme** mostra il link inviato, con scadenza a 7 giorni.
- `SIG-026 P0`: il link aperto in una finestra anonima mostra la pagina senza menu e senza login di Keycloak; il genitore inserisce i propri dati (un genitore minorenne è rifiutato) e il luogo di nascita del socio, legge i documenti e firma foglio e clausole con due codici ricevuti allo stesso indirizzo; il PDF dell'emissione riporta nome, data di nascita ed e-mail del genitore nella sezione 1.
- `SIG-027 P0`: il socio minorenne riceve la notifica, vede l'emissione nel riquadro **Firme** con «Prendi visione» e la conferma con il proprio codice; dopo la firma per l'Associazione il link usato per firmare non si apre più («Collegamento non valido») e Mailpit riceve «Atto firmato» con un nuovo link da cui si scaricano documenti firmati e attestazione.
- `SIG-028 P1`: dalla sezione **Firme** «Reinvia link» manda un nuovo link e quello precedente smette di funzionare; «Revoca link» lo disattiva; una consegna successiva invia al genitore il link della variazione; annullando il foglio il link della variazione non si apre più.
- `SIG-029 P1`: un link scaduto senza firma (scadenza anticipata nel database) produce al passaggio orario dello scheduler una sola notifica «Link di firma scaduto» agli amministratori; più di 120 aperture in un'ora dello stesso link rispondono «Troppe richieste».
- `SIG-030 P0`: all'avvio con i certificati della CIE il log elenca ogni certificato caricato (`signature_ciesign_trust_anchor`, e `signature_ciesign_trust_anchor_expiring` o `_expired` per uno a meno di 60 giorni dalla scadenza); con il manifest di produzione i certificati sono già al loro posto, perché `deploy/cie/trust-anchors.pem` è versionato e montato; senza `SIGNATURE_CIE_TRUST_ANCHORS` registra `signature_ciesign_not_configured` e la finestra di firma non propone CieSign; non la propone nemmeno a chi ha dichiarato di non avere un codice fiscale italiano, né all'amministratore che firma per l'Associazione o al socio minorenne.
- `SIG-031 P0`: il socio maggiorenne, con il codice fiscale della propria CIE, sceglie «CieSign» nella finestra di firma, scarica il PDF, lo firma con l'app CieSign su Android e lo carica: la firma è registrata senza codice e la finestra si riapre per le clausole; le clausole si firmano con CieSign su iOS, oppure con il codice. Nelle prove il metodo è «CieSign» con certificato, emittente ed esito della revoca.
- `SIG-032 P0`: lo stesso con il Software CIE su PC per un genitore dalla pagina pubblica, dove CieSign è indicato come consigliato; a firme complete il documento scaricato contiene la firma CieSign e il sigillo.
- `SIG-033 P0`: in Acrobat Reader il documento sigillato mostra due firme: quella CieSign, valida se le CA della CIE sono tra le identità attendibili, e il sigillo; entrambe risultano senza modifiche dopo la firma. L'attestazione riporta soggetto, emittente, numero di serie e codice fiscale del certificato e l'esito del controllo di revoca.
- `SIG-034 P0`: sono rifiutati nella finestra, con il motivo e senza registrare la firma: un PDF diverso firmato con CieSign («non è il documento scaricato»), il documento firmato e poi modificato o firmato due volte, il documento scaricato e ricaricato senza firma («non contiene una sola firma valida»), il documento firmato con la CIE di un'altra persona («La firma è di un'altra persona») e un file oltre 25 MB; dopo un rifiuto si può caricare un altro file o passare al codice.
- `SIG-035 P1`: con l'indirizzo della CRL della CIE bloccato in uscita la firma CieSign riesce dopo al massimo 10 secondi, il log registra `signature_ciesign_revocation_unavailable`, la metrica `taurus_signature_ciesign_total{outcome="acceptedRevocationUnavailable"}` cresce e l'attestazione riporta «elenco di revoca non raggiungibile»; con la CRL raggiungibile la prova registra il certificato non revocato. Nei log non compaiono nomi, codici fiscali o dati del certificato.
- `SIG-036 P0`: con un socio senza data di nascita nel profilo, «Inserisci i dati e firma» apre la finestra con l'avviso «Aggiungi la tua data di nascita» al posto dei campi e il pulsante «Vai al profilo»; dalla pagina **Profilo** il socio inserisce la data e salva; riaperta la firma, la data compare in sola lettura, i dati si salvano e il documento congelato riporta la data. Il genitore di un socio minorenne senza data di nascita vede nella pagina pubblica l'avviso di rivolgersi all'associazione; `PUT /holder-data` risponde `422 signature.holderData.birthDateMissing` finché la data manca.
- `SIG-037 P0`: con un foglio emesso per un bene di cui il socio non ha preso visione, la riga dell'atto nel riquadro **Firme** indica la presa visione in attesa e la finestra di firma mostra l'avviso con «Chiudi» al posto di dati e documento; l'invio dei dati (`PUT /holder-data`), la richiesta del codice e il caricamento CieSign rispondono `409 signature.act.acknowledgmentsPending`, anche chiamati direttamente. Dopo «Accetta e firma» nell'elenco delle consegne la firma riesce. La firma per l'Associazione e la dichiarazione su carta non sono bloccate; una presa visione rifiutata non blocca la firma.
- `SIG-038 P1`: nella dashboard, in «Da fare», il socio con un atto da firmare vede «Firma richiesta» con il numero degli atti e «Firma» apre «Il mio inventario» con il riquadro **Firme**; dopo le sue firme la voce scompare e compare all'amministratore che firma per l'Associazione, finché non firma anche lui.
- `SIG-039 P0`: nella pagina del tenant «Fogli di affidamento» e «Firma elettronica» compaiono tra le estensioni con la loro dipendenza; dopo la migration i tenant con l'Inventario hanno i fogli attivi e la firma spenta. Spegnendo «Fogli di affidamento» la conferma elenca «Firma elettronica (per dipendenza)»; per gli utenti del tenant spariscono sezione dei fogli nel dettaglio utente, pulsante e pagina del modello, riquadri **Fogli di affidamento** e **Firme**, e le API dei fogli rispondono `403 tenantFeature.inventoryLoanSheet.disabled`, mentre rinnovo e sostituzione delle assegnazioni restano disponibili.
- `SIG-040 P0`: con i fogli attivi e «Firma elettronica» spenta per il tenant, anche se l'interruttore della pagina del modello era acceso: l'emissione propone solo la carta, la presa visione si conferma senza codice, il riquadro **Firme**, la sezione **Firme** del foglio, le impostazioni della firma nel profilo e la voce **Firma richiesta** della dashboard non compaiono, le API della firma rispondono `403 tenantFeature.inventorySignature.disabled`, il link di un genitore risulta non valido e non arrivano notifiche degli atti. Riaccendendo la funzionalità tornano atti, documenti e fascicoli.

Esecuzione del 2026-10-20, commit di base `7c9ffb32` con le modifiche non ancora registrate del branch `feature/inventory-electronic-signature`. Stack locale separato dai servizi del checkout principale: copie dei database di sviluppo (`taurus_sig`, `taurus_keycloak_sig`), Keycloak 26.6.4 con il provider `taurus-otp` e il client `taurus-signature` aggiunto al realm esistente come descritto nel runbook operativo, Mailpit, backend del branch con `SPRING_DOCKER_COMPOSE_ENABLED=false`, frontend `npm start`. I flussi sono eseguiti con login reali di Keycloak (PKCE) verso le API e controllati nel browser per finestra di firma, pagina pubblica, sezione **Firme** e pagina del modello. Al posto delle CA della CIE è configurata come trust anchor una CA di prova, con certificati dei titolari nel formato della CIE e una CRL locale; il sigillo è quello temporaneo di sviluppo.

| Caso | Esito | Note |
| --- | --- | --- |
| SIG-001…009 | `PASS` | SIG-006 attraverso le API, la selezione in «I miei oggetti» è coperta dai test frontend |
| SIG-010 | `PASS` dopo correzione | ogni cancellazione GDPR di un utente del tenant rispondeva `500` |
| SIG-011 | `PASS` | un solo tenant di sviluppo: verificata la conferma di un altro utente (`404`); l'isolamento tra tenant è coperto dai test di integrazione |
| SIG-012 | `PASS` | ai livelli di log di produzione; il profilo `dev` stampa in debug gli argomenti dei metodi e i destinatari SMTP |
| SIG-013…019 | `PASS` | sigillo, attestazione e fascicolo verificati con PDFBox e con le istruzioni dell'attestazione, senza Acrobat |
| SIG-020 | `PASS` dopo correzione | senza materiale in carico i dati restavano fino al termine del periodo di grazia |
| SIG-021…030 | `PASS` | SIG-029 con lo scheduler anticipato a ogni minuto |
| SIG-031, SIG-032 | `PASS` | con la CA di prova il 2026-10-20, ripetuti con una CIE reale il 2026-10-31 (sotto); la finestra di firma della pagina pubblica si bloccava ed è corretta |
| SIG-033 | `PASS` | in Acrobat Reader il 2026-10-31; integrità della firma CieSign e del sigillo verificata anche con PDFBox; attestazione con i dati del certificato |
| SIG-034 | `PASS` dopo correzione | il documento senza firma rispondeva `documentMismatch`, il file oltre 25 MB non era contato nella metrica |
| SIG-035 | `PASS` | CRL non raggiungibile: firma accettata in 10,2 secondi con `UNAVAILABLE` |

Ripetizione del 2026-10-31 con una Carta d'Identità Elettronica reale e il suo PIN, al posto della CA di
prova: come trust anchor i certificati veri delle CA della CIE, dal bundle versionato (§4.7 del runbook
operativo). SIG-031 e SIG-032 eseguiti con l'app CieSign e con il Software CIE, firmando sia
dall'applicazione come socio sia dalla pagina pubblica come genitore: entrambi `PASS`.

Lo stesso giorno sono state eseguite le ultime verifiche esterne, e con esse i casi SIG-001…035
sono tutti `PASS`. SIG-033: in Acrobat Reader il documento sigillato mostra la firma CieSign e il
sigillo, entrambi senza modifiche dopo la firma. Invio dalla casella reale dell'associazione, al
posto di Mailpit: codici di conferma e link di firma recapitati dal suo server SMTP. Stampa A4 del
modello predefinito a confronto con il modello dell'associazione. Un legale ha inoltre confermato i
tre punti della [verifica legale](inventory-electronic-signature-spec.md#verifica-legale) della
specifica, che era la condizione per attivare la firma in un tenant reale.

Le correzioni sono descritte nelle decisioni della fase 6 della [specifica](inventory-electronic-signature-spec.md). Fuori dalla firma elettronica resta un log `ERROR` di `KeycloakServiceImpl` che riporta l'e-mail di un utente alla sua creazione.

### 14.15 Errori applicativi

Riferimento: [Standard degli errori applicativi](application-errors-standard.md).

- `ERR-001 P0`: ogni risposta d'errore, in ogni profilo, contiene solo `type`, `title`, `status`, `message`, eventualmente `args` o `fieldErrors`, ed `errorId`; nessun `detail`, `params`, `path`, `cause`, messaggio di eccezione o risposta di Keycloak.
- `ERR-002 P0`: l'`errorId` della risposta compare nella riga `error_response` del log del backend, con chiave e descrizione interna.
- `ERR-003 P0`: il toast mostra il testo del catalogo del frontend per la chiave, con i parametri formattati (date `dd/MM/yyyy`); il `title` della risposta non compare mai.
- `ERR-004 P0`: un socio che chiede assegnazione, riconsegna, fotografia o foglio di un altro socio riceve `404` con la stessa chiave di una risorsa inesistente.
- `ERR-005 P1`: un 409 di regola (per esempio quantità non disponibile) mostra il messaggio della regola; un 409 di concorrenza mostra il titolo «Dati modificati».
- `ERR-006 P1`: un errore 5xx o 502 mostra nel toast «Codice errore» con l'`errorId`.
- `ERR-007 P1`: la scadenza non valida nel dettaglio inventario compare sotto il campo, senza toast.
- `ERR-008 P0`: `node scripts/docs/check-error-catalog.mjs` termina senza errori: backend, catalogo e frontend riportano le stesse chiavi e gli stessi parametri.

### 14.16 Guida introduttiva

Riferimento: [Guida introduttiva per ruolo](guided-tour-spec.md). Il backend è automatizzato da `GuidedTourServiceTest` (default, validazione, versioni, metriche, interruttore applicativo), `GuidedTourIT` (ruoli separati, isolamento tra tenant, super amministratore senza utente, conflitti, cancellazione GDPR), `GuidedTourMigrationIT` (invito degli utenti esistenti e vincoli) e `GuidedTourResourceIT` (endpoint HTTP, validazione, conflitto di versione, token senza ruolo). Il frontend è automatizzato da `guided-tour-steps.spec.ts` (percorsi dei sette ruoli con le funzionalità accese e spente, punti, limiti della scheda), `guided-tour.service.spec.ts` (regole di avvio, invito, rinvio di sessione, salvataggio accorpato, conflitto con unione delle tappe, errori silenziosi), `guided-tour.component.spec.ts` (benvenuto, ancore mancanti, nascoste o per il mobile, ripresa, navigazione annullata, `Esc`, fuoco, invito, posizionamento) e dalla spec della topbar; `npm run check:tour-anchors` confronta le ancore del catalogo con quelle dei template. Restano manuali il giro completo per ruolo su desktop e su un telefono Android reale, il tema scuro, lo zoom al 200%, il lettore di schermo e la rilettura dei testi da parte del responsabile del progetto, eseguiti con esito positivo il 2026-11-04. Lo stesso giorno il bundle iniziale della build di produzione è cresciuto di 2,1 kB stimati in trasferimento rispetto al commit precedente la guida, entro i 3 kB del criterio 19, e il chunk differito della guida pesa 7,4 kB compressi, entro i 20 kB.

- `TOUR-001 P0`: persona e ruolo vengono solo dal token; un token senza ruolo riconosciuto riceve `403 auth.forbidden`.
- `TOUR-002 P0`: la stessa persona in due tenant ha impostazioni e avanzamento separati; ruoli diversi nello stesso tenant, Direttivo compreso, hanno avanzamenti separati.
- `TOUR-003 P0`: la migrazione crea il profilo con invito per ogni utente non cancellato, nessuno per i cancellati e nessuno in un tenant nuovo.
- `TOUR-004 P0`: la cancellazione GDPR dell'utente elimina profilo e avanzamento nel solo tenant interessato.
- `TOUR-005 P1`: `validation` per stato, ID tappa e contatori non validi, `guidedTour.step.limit` oltre 100 tappe, `guidedTour.versionConflict` per una versione superata.
- `TOUR-006 P1`: con `application.guided-tour.enabled=false` la lettura riporta `enabled: false` e le scritture rispondono `404 guidedTour.disabled`.
- `TOUR-007 P1`: `taurus.guided_tour.decisions` e `taurus.guided_tour.invitations` hanno solo ruolo ed esito tra i tag.
- `TOUR-008 P0`: al primo ingresso, dopo i documenti legali, la dashboard mostra il benvenuto; su altre pagine e con un dialogo aperto la guida non parte; gli utenti presenti al rilascio vedono l'invito al posto del benvenuto.
- `TOUR-009 P1`: ogni ruolo vede solo tappe del proprio ruolo e delle funzionalità attive, al più 10; un'ancora assente o nascosta lascia la scheda centrata senza errori, anche sotto i 992 px.
- `TOUR-010 P1`: chiudere conserva l'ultima tappa e la riapertura riprende da lì; dopo 3 proposte automatiche chiuse la guida non parte più da sola e il pulsante di aiuto mostra il punto; **Salta la guida**, **Non avviare più la guida automaticamente** e **Ricomincia la guida** hanno l'effetto descritto nella specifica.
- `TOUR-011 P1`: la guida si usa da tastiera e con lettore di schermo: fuoco sul comando primario e restituito alla chiusura, `Esc`, annuncio del passo; con tema scuro, zoom al 200% e `prefers-reduced-motion` resta leggibile.

Guide di pagina (fase 2, [Guide di pagina](guided-tour-spec.md#guide-di-pagina)). Automatizzate da `guided-tour-pages.spec.ts` (riconoscimento dell'URL con i percorsi senza parametri per primi, numero di tappe di ogni pagina per i sette ruoli con le funzionalità accese e spente, profilo per ruolo, pagine fuori dal ruolo o con la sezione spenta, limite di 10 tappe, limiti dei testi, formato e unicità degli ID, nessun «tenant» per i ruoli di un'organizzazione), `guided-tour.service.spec.ts` (disponibilità per pagina e ruolo, apertura senza richieste HTTP, chiusura al cambio di pagina, guida introduttiva non avviabile mentre è aperta una guida di pagina, toast sulle pagine senza guida, interruttore applicativo), `guided-tour.component.spec.ts` (solo tappe con ancore visibili, nessun salvataggio, chiusura con **Chiudi**, `Esc` e **Fine**, attesa di 2 secondi e toast), dalla spec della topbar (voce **Guida di questa pagina** solo quando la pagina ha una guida) e da `npm run check:tour-anchors`, esteso al catalogo delle pagine e alle ancore calcolate.

- `TOUR-012 P1`: su ogni pagina del layout, per ogni ruolo che può aprirla, la voce **Guida di questa pagina** compare solo se la pagina ha tappe per la sessione; la guida parla solo delle sezioni visibili, non cambia pagina, si chiude al cambio di pagina e non lascia traccia sul server. Da eseguire per blocco (A: pagine di tutti i ruoli; B: pagine di gestione; C: tenant e documenti legali), su desktop e su un telefono, con le funzionalità accese e spente.
- `TOUR-013 P2`: rilettura dei testi delle guide di pagina da parte del responsabile del progetto.

## 15. Frontend, UX e accessibilità

Eseguire i flussi principali almeno su Chrome, Edge, Firefox e Safari nelle versioni supportate definite dal prodotto; includere viewport mobile, tablet e desktop.

| ID | Caso | Risultato atteso |
| --- | --- | --- |
| `UI-001` | Navigazione da tastiera | Ordine focus logico, focus visibile, nessun trap |
| `UI-002` | Dialoghi | Titolo/label associati, Escape e ripristino focus corretti |
| `UI-003` | Icon-only button | Nome accessibile presente |
| `UI-004` | Validazione form | Errore associato al campo e annunciabile |
| `UI-005` | Loading/empty/error/success | Stato comprensibile e senza layout shift grave |
| `UI-006` | Tema chiaro/scuro e contrasto | Testo e controlli leggibili |
| `UI-007` | Zoom 200% e reflow | Nessuna perdita di funzione/contenuto |
| `UI-008` | Responsive | Tabelle, menu e dialoghi utilizzabili |
| `UI-009` | Refresh/deep link | Route Angular caricata senza 404 |
| `UI-010` | Update service worker | Nuova versione applicata senza bundle incompatibili |
| `UI-011` | Offline/rete lenta | Errore controllato; nessuna falsa conferma di salvataggio |
| `UI-012` | Doppio click/reinvio | Nessuna duplicazione di operazioni non idempotenti |
| `UI-013` | Tocchi sotto la barra in alto, a larghezza di telefono | Arrivano al contenuto della pagina; solo logo e pulsanti della barra sono attivi |

Integrare uno scanner automatico di accessibilità e conservare un controllo manuale per tastiera, screen reader e contenuti dinamici.

## 16. Sito informativo

- `INFO-001 P1`: tutte le pagine costruiscono senza errori.
- `INFO-002 P1`: `SITE_URL`, app URL e contatto corretti nell'artefatto.
- `INFO-003 P1`: link interni/esterni e CTA non rotti.
- `INFO-004 P1`: metadata, canonical, sitemap e robots coerenti.
- `INFO-005 P1`: `/health` restituisce `200`, route inesistente usa 404.
- `INFO-006 P1`: cache immutabile per `_astro`, HTML no-cache.
- `INFO-007 P0`: CSP e security header presenti e senza risorse bloccate.
- `INFO-008 P1`: responsive, accessibilità e performance Lighthouse.
- `INFO-009 P1`: nessun segreto o URL interno nel bundle statico.
- `INFO-010 P1`: `/termini-applicativo/` e `/privacy-applicativo/` rimandano subito a `/legal/terms` e `/legal/privacy` dell'applicativo, con canonical, collegamento visibile e `noindex`, e restano fuori dalla sitemap; piè di pagina, `termini` e `privacy` collegano direttamente l'applicativo.

Automatizzati nella verifica del modulo: `INFO-001` dalla build, `INFO-003`, `INFO-004`, `INFO-010` e l'accessibilità strutturale di `INFO-008` da `pnpm test`, `INFO-005` e la presenza delle intestazioni di `INFO-007` da `pnpm test:image`, che interroga l'immagine nginx. Restano a mano `INFO-002`, `INFO-006`, `INFO-009`, le prestazioni Lighthouse e la prova che nessuna risorsa sia bloccata dalla CSP a browser aperto.

## 17. Test non funzionali

### 17.1 Performance

Definire prima SLO, dataset e capacità attesa. Profili minimi:

- smoke: carico minimo, verifica script;
- load: traffico nominale sostenuto;
- stress: crescita fino al limite e degradazione;
- spike: aumento improvviso;
- soak: traffico nominale prolungato per leak e accumuli;
- capacity: tenant, utenti, media e job ai volumi futuri previsti.

Misurare p50/p95/p99, throughput, errori, CPU, memoria, GC, pool JDBC, query lente, I/O storage, backlog RabbitMQ e durata scheduler. Testare separatamente login, dashboard, liste paginated, upload/download, feed anonimo e notification dispatch.

Lo strumento è k6 e lo script vive in `taurus-be/src/test/k6/api-load.js`: i profili si scelgono con `-e PROFILE=` e coprono funzionalità del tenant, liste paginate e dashboard con un token del tenant di prova.

```powershell
k6 run -e PROFILE=smoke -e BASE_URL=http://localhost:8080 -e TOKEN=$env:TAURUS_TOKEN taurus-be/src/test/k6/api-load.js
```

Le soglie dello script (`http_req_failed` sotto l'1%, p95 di 400 ms per le funzionalità, 800 ms per le liste, 1500 ms per la dashboard) servono a rilevare un peggioramento: i limiti di accettazione restano `TBD` finché SLO e volumi non vengono approvati, e lo script non è ancora stato eseguito su un ambiente con dati realistici.

Per la dashboard operativa `OperationalDashboardIT` misura gli obiettivi della [specifica](operational-dashboard-spec.md#prestazioni) su un tenant con il volume di qualche anno di attività: al 2026-10-27 `p95` della richiesta completa resta sotto i 200 ms, nessun provider supera gli 80 ms, una richiesta di un amministratore esegue 11 query e la risposta pesa circa 2,4 kB. È una misura su Testcontainers, non su staging: non sostituisce il profilo dashboard di k6 sull'ambiente reale.

Per la preparazione dell'evento `EventPreparationIT` misura gli obiettivi della [specifica](event-preparation-spec.md#prestazioni) su un evento con 100 brani, 1.000 utenti e 100 materiali: al 2026-10-28 il p95 della vista amministrativa è 81 ms (obiettivo 700) e quello della vista personale 46 ms (obiettivo 400); la dashboard valuta 15 eventi con le stesse 8 query di 2. Lo script k6 non ha ancora un profilo per queste viste.

Per l'ascolto delle parti la [specifica](track-score-playback-spec.md#copertura-della-fase-4) riporta i tempi misurati nel browser (disegno nell'editor e nel lettore, partitura di 30 parti, caricamento del SoundFont), la memoria della pagina del lettore e la durata del riconoscimento di una pagina: usarli come riferimento per accorgersi di un peggioramento, ripetendo le misure con lo stesso metodo.

### 17.2 Concorrenza

Verificare almeno:

- aggiornamenti concorrenti dello stesso tenant e feature flag;
- assegnazione inventario concorrente;
- rotazione/revoca concorrente di feed e QR;
- dispatch multiplo della stessa outbox;
- provisioning tenant simultaneo;
- più repliche backend con scheduler attivi;
- upload/delete simultaneo dello stesso media.

`UploadJobConcurrencyIT` qualifica la coda degli upload: la presa in carico e la chiusura di un job passano da un `UPDATE` condizionato sullo stato, quindi fra sei worker simultanei uno solo vince e gli altri si ritirano. È il meccanismo che rende sicure più repliche su quella coda.

`TrackPageImageIT` qualifica la modifica di una pagina sullo stesso terreno: quattro salvataggi simultanei sulla stessa immagine con la versione attesa della traccia producono un solo vincitore, gli altri non toccano la relazione, e lo stesso tentativo ripetuto con la stessa chiave riceve il replay della prima risposta senza scrivere un secondo asset. Lo stesso test copre l'isolamento fra tenant, i byte che si dichiarano immagine senza esserlo, una decompression bomb rifiutata dall'header e il limite di tempo del rendering, che risponde `503` senza lasciare asset o ricevute a metà.

`TrackInstrumentSuggestionIT` qualifica il controllo sul nome degli strumenti: due creazioni simultanee dello stesso nome nello stesso tenant passano dal lock transazionale del tenant, e una sola riesce mentre l'altra riceve `instrument.name.exists`.

Le tre code che lavorano a tempo hanno ciascuna la sua presa in carico condizionata, qualificata da `NotificationConcurrencyIT`: l'outbox marca l'evento con un `UPDATE` sullo stato, i promemoria degli eventi (`push_reminders`) leggono le righe dovute con `for update skip locked`, e la consegna push fa lo stesso sulla riga del job e sulle voci del riepilogo. `skip locked` lascia la riga a chi la tiene già, invece di far attendere l'altro worker per poi fargli fallire la presa in carico; la lettura senza `join fetch` evita che PostgreSQL rifiuti il `for update` e che Hibernate ricada su un lock per id e versione, che dopo la consegna dell'altro worker solleverebbe `StaleObjectStateException`. Più repliche con gli scheduler attivi sono quindi sicure su queste code.

### 17.3 Resilienza

In staging, introdurre una dipendenza alla volta:

- PostgreSQL non raggiungibile e lento;
- Keycloak non raggiungibile o certificato invalido;
- RabbitMQ interrotto durante publish/consume;
- filesystem read-only, pieno o smontato;
- provider push con timeout/4xx/5xx;
- servizio OMR fermo, lento, occupato o con chiave diversa da quella del backend;
- kill/restart backend durante onboarding o migration controllata;
- DNS e latenza di rete degradati.

Per ogni prova verificare timeout, retry limitato, assenza di perdita/duplicazione, readiness, alert e recupero automatico. Non eseguire fault injection in produzione senza autorizzazione specifica.

### 17.4 Sicurezza

La suite deve includere:

- SAST e dependency/container scan;
- secret scan della history e degli artefatti;
- DAST autenticato e non autenticato in staging;
- OWASP Top 10 web/API;
- IDOR/BOLA su tutti gli ID tenant-scoped;
- mass assignment, over-posting e campi audit/tenant ignorati;
- SQL injection, path traversal, XSS persistente/riflesso e CSV injection;
- CORS, CSP, cookie, redirect e header;
- rate limit feed/QR e abuso upload;
- token leak in URL/log/APM;
- PDF/immagini malevoli e decompression/resource exhaustion;
- MusicXML con DTD o entità esterne, `.mxl` compressi oltre i limiti e MIDI malformati;
- servizio OMR non raggiungibile da Internet e senza la chiave condivisa;
- esposizione Actuator e messaggi di errore;
- verifica firma e provenienza immagini.

Ogni finding deve avere severità, exploitability, componente, versione, owner e decisione. Una semplice assenza di finding automatizzati non sostituisce i test di autorizzazione.

### 17.5 Backup, restore e DR

Usare la procedura del [runbook operativo](runbook-operativo.md). Il database si prova con `scripts/ops/restore-test.sh`, che fa il backup dell'istanza indicata, lo ripristina in un container temporaneo, confronta schemi tenant e migrazioni applicate con l'origine e stampa i tempi da riportare come RPO e RTO. L'origine non viene toccata. Va programmato sull'host che ha accesso al database, perché la CI non lo raggiunge.

La prova deve dimostrare:

- restore di database Taurus e Keycloak;
- restore dello storage media allo stesso punto;
- login e token validi;
- registry e schemi tenant coerenti;
- download dei media campionati;
- RPO/RTO effettivi;
- assenza di split brain durante failover/failback.

## 18. Cicli di esecuzione

### 18.1 Pull request

- L0, L1 e L2 dei moduli toccati;
- L3 mirati per DB, Keycloak o integrazioni modificate;
- test di regressione del difetto corretto;
- catalogo/spec aggiornati nella stessa PR;
- build produzione dei moduli toccati;
- per `taurus-omr`, build dell'immagine e misura di accuratezza sui motori reali.

### 18.2 Nightly

- backend `verify` completo con Docker disponibile;
- frontend completo con coverage;
- avvio full-stack e E2E;
- scanner sicurezza;
- migrazione da snapshot della versione supportata;
- browser matrix distribuita;
- controllo leak/flaky e test saltati.

### 18.3 Release candidate

1. Congelare commit, dipendenze e digest.
2. Creare staging pulito production-like.
3. Eseguire fresh install e upgrade.
4. Eseguire tutte le P0 e P1.
5. Eseguire E2E per tutti i ruoli.
6. Eseguire sicurezza, accessibilità e performance.
7. Eseguire backup/restore e rollback applicativo.
8. Correggere o accettare formalmente ogni eccezione.
9. Firmare il report go/no-go.

### 18.4 Post-deploy

Eseguire solo test sintetici non distruttivi:

- health/info e asset frontend;
- login/logout con account sintetico;
- lettura isolata su due tenant sintetici;
- query core in sola lettura;
- presenza consumer RabbitMQ e assenza backlog anomalo, comprese le code `upload.files` e `score.recognition`;
- `GET /v1/health` del servizio OMR dalla rete del backend, se l'ascolto con riconoscimento è attivo;
- controllo error rate, latency e scheduler;
- health e link principale del sito informativo.

## 19. Gap di copertura da chiudere

| Priorità | Gap attuale | Azione |
| --- | --- | --- |
| Media | Pulsanti pieni delle severità success, info, warn, help e danger: Aura li dà con il fondo alla tinta 500 e l'etichetta bianca, fra 2,3:1 e 4:1 | Decidere se scurirli alla tinta 700 nel livello dei design token, sapendo che cambia il colore di quei pulsanti in tutta l'applicazione |
| Media | `p-stepper` di PrimeNG, 19, 21 e 22, si dichiara `tablist` e ci annida dentro i pannelli `tabpanel`: `aria-required-children` è escluso dall'audit della configurazione iniziale | Seguire il difetto a monte e togliere l'esclusione quando la libreria lo corregge |
| Media | Suite E2E eseguita sui profili desktop e mobile, con 34 prove saltate per dati assenti | Preparare nell'ambiente di prova parti, QR inventario, evento con programma e traccia grande, e valorizzare le variabili che le abilitano |
| Alta | Script di carico k6 presente ma mai eseguito su dati realistici; SLO non approvati | Preparare il dataset, eseguire i profili e far approvare p95/p99, throughput ed error rate |
| Alta | Prova di ripristino automatizzabile ma non programmata; RPO/RTO reali non misurati | Programmare `scripts/ops/restore-test.sh` sull'host del database, estenderla a Keycloak e allo storage media, registrare i tempi |
| Media | Analisi dinamica (DAST) assente | Aggiungere una scansione su staging, fuori dalla pipeline delle pull request |
| Media | Soglie di copertura alla baseline misurata, lontane dall'obiettivo | Alzare `jacoco.*.minimum` e la baseline di `scripts/check-coverage.mjs` man mano, fino a 80% linee e 70% branch sul codice modificato |
| Media | Specifiche frontend ancora limitate rispetto a pagine e dialoghi | Estendere componenti, form, pagine e casi errore/ruolo, usando la copertura come guida |
| Media | Accuratezza OMR misurata su un corpus scritto per il test | Aggiungere al corpus i casi difficili trovati nelle parti reali di `PLY-018` |
| Media | Matrice browser definita (desktop, mobile, tablet, Firefox, WebKit) ma eseguita solo alla calibrazione | Eseguire `npm run e2e:matrix` nei cicli di release e registrarne l'esito |
| Media | Processo flaky definito, storico negli artefatti della CI, nessuna raccolta automatica | Automatizzare il confronto fra esecuzioni se i casi crescono |

## 20. Gestione difetti e flaky test

| Severità | Definizione | Decisione |
| --- | --- | --- |
| P0/Critical | Violazione tenant/sicurezza, perdita dati, impossibilità di avvio/login/migrazione | Stop release immediato |
| P1/High | Funzione primaria indisponibile o risultato errato senza workaround sicuro | Stop, salvo accettazione formale eccezionale |
| P2/Medium | Funzione secondaria degradata con workaround | Valutazione owner prodotto/tecnico |
| P3/Low | Difetto cosmetico o miglioramento | Pianificabile |

Un test flaky non va semplicemente rilanciato fino al verde. Registrare frequenza, evidenza e ticket; se messo in quarantena, assegnare owner e scadenza. Un flaky P0 rende il gate non affidabile e va risolto prima della release.

Lo storico arriva dagli artefatti della CI: il job backend conserva per trenta giorni `surefire-reports`, `failsafe-reports` e i report JaCoCo, il job frontend la cartella `coverage`. Confrontando i report di esecuzioni diverse si vede quali test cambiano esito senza che il codice cambi.

Quarantena: il test resta nel repository, prende `@Tag("flaky")` (o `test.fixme` in Playwright) e una riga in questa tabella. Si esclude da un run con `-DexcludedGroups=flaky`, mai dal gate in modo silenzioso.

| Test | Sintomo | Owner | Scadenza |
| --- | --- | --- | --- |
| nessuno | — | — | — |

Osservato il 2026-10-25 e non ancora riprodotto: `NotificationPreferencesIT.suppressesTheInAppRowAndStillEnqueuesThePushWhenTheCategoryIsDisabled` e `NotificationOutboxPublisherIT.persistsAudienceAndAllowsTheSameEventKeyInDifferentTenants` sono falliti una volta ciascuno nella suite completa, con un timeout di `provisionTenants()` nel secondo caso, e sono passati da soli e nelle esecuzioni successive. Se ricompaiono vanno messi in quarantena con owner e scadenza.

## 21. Report di esecuzione

```text
Test run ID:
Release candidate / commit / digest:
Ambiente e configurazione:
Data e durata UTC:
Suite previste:
PASS / FAIL / BLOCKED / NOT RUN / N/A:
Test P0 saltati:
Coverage BE line/branch:
Coverage FE line/branch:
Vulnerabilità per severità:
Risultati performance vs SLO:
Risultato accessibilità:
Risultato restore e RPO/RTO:
Difetti aperti e accettazioni:
Rischi residui:
Decisione: GO | NO-GO | CONDITIONAL GO
Approvazioni:
Link artefatti/evidenze:
```

## 22. Checklist go/no-go

- [ ] Commit e digest sono immutabili e registrati.
- [ ] Catalogo documentale valido e specifiche allineate.
- [ ] Nessuna suite obbligatoria è `BLOCKED` o `NOT RUN`.
- [ ] Tutte le P0 e P1 previste sono passate.
- [ ] Nessun test Docker-required è stato saltato.
- [ ] Fresh install e upgrade hanno lo stesso esito funzionale.
- [ ] Tenant isolation verificata su API, DB, media, feed, QR e job.
- [ ] Matrice ruoli verificata lato BE e FE.
- [ ] Login/logout/refresh e provider Keycloak funzionano.
- [ ] RabbitMQ e processi asincroni recuperano dopo un'interruzione.
- [ ] Coverage raggiunge la soglia approvata.
- [ ] Sicurezza, accessibilità e performance rispettano i gate.
- [ ] Backup/restore è valido entro la finestra prevista.
- [ ] Rollback o forward fix è provato e documentato.
- [ ] Difetti e rischi residui hanno owner e accettazione.
- [ ] Report firmato da responsabile tecnico e prodotto/operazioni.

## 23. Manutenzione del runbook

Per ogni nuova funzionalità o regressione:

1. aggiornare la specifica e `docs/features.json`;
2. aggiungere casi positivi, negativi, limite, autorizzazione e tenant isolation;
3. automatizzare almeno i casi P0/P1 ripetibili;
4. indicare il test di regressione nel catalogo;
5. aggiornare dati, ambienti e comandi se cambiano;
6. rieseguire la qualificazione proporzionata al rischio.

Revisionare il runbook almeno a ogni release maggiore e dopo incidenti, restore o cambi infrastrutturali. La fonte autorevole delle funzionalità rimane `docs/features.json`; questo documento deve seguirne l'evoluzione.

## 24. Riferimenti

- [Runbook operativo](runbook-operativo.md);
- [Catalogo funzionalità](features.md);
- [Governance documentazione](documentation-implementation-alignment-spec.md);
- [Schema PostgreSQL multi-tenant](postgres-tenant-schemas.md);
- [Feature flag tenant](tenant-feature-flags-spec.md);
- [Onboarding/import](tenant-onboarding-import-spec.md);
- [Notifiche](notification-delivery-generalization-spec.md);
- [Media](media-asset-spec.md);
- [Elaborazione PDF tracce](track-pdf-processing-spec.md);
- [Ascolto e correzione delle parti](track-score-playback-spec.md) e `taurus-omr/README.md`;
- [Feed calendario](external-calendar-feed-spec.md);
- `.github/workflows/verify.yml` per la CI corrente, compresa la misura di accuratezza dei motori OMR.
