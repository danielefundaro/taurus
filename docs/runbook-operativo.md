# Runbook operativo Taurus

## 1. Scopo e stato del documento

Questo runbook descrive come installare, configurare, avviare, verificare, rilasciare, monitorare e ripristinare l'intero applicativo Taurus. È rivolto a sviluppo, operations, supporto applicativo e responsabili di release.

ID catalogo: `operational-runbook`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

Il documento descrive il repository; la data dell'ultima verifica è nel catalogo. Le procedure marcate **baseline da definire** non sono ancora automatizzate o completamente rappresentate nel repository e devono essere validate nell'ambiente di destinazione prima di essere usate in produzione.

Principi operativi:

- non usare i compose presenti come manifest di produzione;
- non inserire segreti nei file versionati o nella riga di comando condivisa;
- eseguire backup verificati prima di ogni variazione irreversibile;
- distribuire immagini identificate da versione o digest, mai affidandosi al solo tag `latest`;
- trattare le migration Liquibase come append-only dopo il rilascio;
- verificare sempre isolamento tenant, autenticazione e storage dei media dopo un deploy;
- registrare nell'incidente o nella change ogni comando distruttivo e relativo esito.

### 1.1 Dati da completare prima dell'uso in produzione

| Campo | Valore |
| --- | --- |
| Owner applicativo | `TBD` |
| Owner infrastruttura | `TBD` |
| Reperibilità/escalation | `TBD` |
| Canale incidenti | `TBD` |
| URL produzione web app | `TBD` |
| URL produzione sito informativo | `TBD` |
| URL pubblico Keycloak | `TBD` |
| Registro immagini autorizzato | Docker Hub e/o GHCR, scelta `TBD` |
| RPO database | `TBD` |
| RTO applicativo | `TBD` |
| Retention backup | `TBD` |
| Regione e sito DR | `TBD` |

Finché questi campi non sono valorizzati e approvati, il runbook è utilizzabile per sviluppo, collaudo e preparazione operativa, ma non costituisce da solo una baseline di produzione.

## 2. Inventario dell'applicativo

| Componente | Tecnologia | Responsabilità | Porta locale | Stato persistente |
| --- | --- | --- | --- | --- |
| `taurus-fe` | Angular 22, Nginx 1.30 senza privilegi | SPA utente/amministrazione, PWA e Web Push; nel container serve anche da ingresso unico, inoltrando `/api` e `/auth` | `4200` in sviluppo, `8080` nel container | Nessuno; configurazione letta all'avvio del container (§4.2) |
| `taurus-be` | Java 25, Spring Boot 4.1, JHipster | API, processi asincroni, scheduler, migrazioni e accesso ai dati | `8080` | Media su filesystem; dati in PostgreSQL |
| PostgreSQL | PostgreSQL 18.6 nel compose locale | Schema globale `public`, schemi tenant e database Keycloak | `5432` | Critico |
| Keycloak | Keycloak 26.8.2 nel compose locale | OIDC, utenti, ruoli, tenant claim, login e-mail e temi | `9080`, `9443` locali | Database `taurus_keycloak` e provider custom |
| RabbitMQ | RabbitMQ 4.4.0 management nel compose locale | Code `upload.files` (elaborazione PDF) e `score.recognition` (riconoscimento delle parti), con le rispettive code di scarto `.dead` | `5672`, console `15672` | Code e messaggi in transito |
| `taurus-omr` | Python 3.12, FastAPI, Audiveris 5.11.0, homr 0.7.0 | Riconoscimento ottico della musica e conversione MIDI per l'ascolto delle parti, chiamato solo dal backend | `8090` | Nessuno; file temporanei in `/tmp`, eliminati a fine richiesta |
| `keycloak-authenticator` | Java 21, provider Keycloak | Selezione tenant/ruolo, protocol mapper e verifica dei codici dell'app per la firma (`taurus-otp`) | n/a | JAR e temi distribuiti in Keycloak |
| `taurus-info` | Astro 7, Nginx 1.30 senza privilegi | Sito informativo statico | `4321` dev, `8088` container locale, `8080` nel container | Nessuno; variabili incorporate in build |
| Prometheus/Grafana | Prometheus 3.13, Grafana 13.3, compose opzionale | Metriche JVM/HTTP e dashboard | `9090`, `3000` | Configurazione e dashboard locali |

### 2.1 Flusso principale

```text
Browser
  |-- sito informativo --> taurus-info/Nginx
  |-- autenticazione ---> Keycloak ----> PostgreSQL/taurus_keycloak
  `-- SPA Angular -------> Taurus API --> PostgreSQL/public
                                    |--> PostgreSQL/tenant_<hash>
                                    |--> filesystem media per tenant
                                    |--> RabbitMQ/upload.files --> worker nello stesso backend
                                    `--> RabbitMQ/score.recognition --> worker --> taurus-omr (HTTP interno)
```

Il claim JWT `tenant` determina lo schema PostgreSQL. Le entità globali restano in `public`; le entità operative risiedono in uno schema fisico `tenant_<hash>`. Una richiesta senza un tenant valido non deve poter leggere uno schema di un altro tenant.

### 2.2 Ordine delle dipendenze

L'ordine di avvio raccomandato è:

1. PostgreSQL;
2. Keycloak e relativo provider;
3. RabbitMQ;
4. servizio OMR `taurus-omr`, se l'ascolto delle parti usa il riconoscimento: il backend si avvia anche senza, ma i riconoscimenti terminano con `serviceUnavailable`;
5. backend, incluse migration globali e tenant;
6. frontend;
7. sito informativo;
8. monitoraggio.

L'ordine di arresto è inverso. Durante un arresto pianificato, fermare prima l'ingresso di nuovo traffico e attendere la conclusione delle richieste e dei job in corso.

## 3. Prerequisiti e accessi

### 3.1 Sviluppo locale

- Git;
- un JDK 25: il backend si compila per Java 25, il provider Keycloak per Java 21, la JVM dell'immagine di Keycloak;
- Node.js 26, con npm per `taurus-fe` e con pnpm 12 per `taurus-info`;
- Docker Engine con Docker Compose, con almeno 4 CPU e 8 GB di memoria assegnati: il servizio OMR del compose è limitato a 4 CPU e 6 GB;
- Chrome/Chromium per i test Karma;
- una copia del SoundFont del lettore per `npm start` e `npm run build` (circa 38 MB, verificata con SHA-256): da `TAURUS_SOUNDFONT_PATH`, da `TAURUS_SOUNDFONT_URL` o, in mancanza di entrambe, da `ftp.osuosl.org`, che richiede accesso a Internet; `TAURUS_SKIP_SOUNDFONT=1` salta il passaggio quando il lettore non serve;
- facoltativo: Python 3.12 per i test di `taurus-omr` fuori da Docker.

Il backend non richiede librerie native: la lettura del testo delle pagine scansionate è del servizio OMR (§4.5).

Verifica rapida:

```powershell
java -version
node --version
npm --version
pnpm --version
docker version
docker compose version
```

### 3.2 Produzione

Prima di operare servono almeno:

- accesso al runtime/container orchestrator;
- accesso in sola lettura a log, metriche e dashboard;
- accesso controllato al registry immagini;
- credenziali separate per runtime DB, migration/provisioning DB e amministrazione Keycloak;
- accesso al secret manager;
- permesso di leggere e ripristinare i backup;
- procedura di change e rollback approvata;
- sincronizzazione oraria affidabile su tutti i nodi.

Gli accessi amministrativi devono essere personali, sottoposti a MFA e registrati. Non usare gli account e le password di sviluppo contenuti nei file locali.

## 4. Configurazione

### 4.1 Regole

- Usare secret manager o secret nativi dell'orchestratore per password DB, client secret OIDC, credenziali amministrative Keycloak, chiave privata VAPID, password SMTP, chiave dei codici di firma e keystore del sigillo con la sua password.
- Usare configurazione non segreta per URL, feature kill switch, limiti e pianificazioni.
- Separare rigorosamente sviluppo, collaudo e produzione.
- Conservare una matrice delle configurazioni per ambiente senza valori segreti.
- Ricostruire `taurus-fe` e `taurus-info` quando cambia una variabile incorporata durante la build.
- Montare `application.base-path` su storage persistente e sottoposto a backup.

I valori dell'installazione stanno in `deploy/.env`, che non è versionato: il modello con tutte le variabili, obbligatorie e facoltative, è [`deploy/.env.example`](../deploy/.env.example), e il manifest che le usa è [`deploy/compose.yml`](../deploy/compose.yml). Le variabili senza valore predefinito fermano Compose prima dell'avvio, invece di lasciare partire lo stack a metà.

Spring Boot accetta override tramite variabili d'ambiente con relaxed binding. La baseline minima di produzione deve includere valori equivalenti ai seguenti:

| Impostazione | Variabile consigliata | Note |
| --- | --- | --- |
| Profilo | `SPRING_PROFILES_ACTIVE=prod` | Aggiungere `api-docs` solo se esplicitamente autorizzato |
| JDBC | `SPRING_DATASOURCE_URL` | URL PostgreSQL raggiungibile dal backend |
| Utente DB | `SPRING_DATASOURCE_USERNAME` | Non usare credenziali predefinite |
| Password DB | `SPRING_DATASOURCE_PASSWORD` | Segreto |
| URL Liquibase | `SPRING_LIQUIBASE_URL` | JDBC, non R2DBC |
| Utente Liquibase | `SPRING_LIQUIBASE_USER` | Preferibilmente ruolo dedicato |
| Password Liquibase | `SPRING_LIQUIBASE_PASSWORD` | Segreto |
| Issuer OIDC | `SPRING_SECURITY_OAUTH2_CLIENT_PROVIDER_OIDC_ISSUER_URI` | Deve coincidere con l'issuer pubblico dei token |
| Client ID OIDC | `SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_OIDC_CLIENT_ID` | Deve coincidere con frontend e realm |
| Client secret OIDC | `SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_OIDC_CLIENT_SECRET` | Segreto |
| Storage | `APPLICATION_BASE_PATH` | Directory/volume persistente, scrivibile solo dal backend |
| Keycloak master | `APPLICATION_KEYCLOAK_MASTER_URI` | URL amministrativo previsto dall'integrazione |
| Keycloak admin issuer | `APPLICATION_KEYCLOAK_ADMIN_ISSUER_URI` | Validare contro l'ambiente reale |
| Keycloak admin user | `APPLICATION_KEYCLOAK_ADMIN_USERNAME` | Preferire service account con privilegi minimi |
| Keycloak admin password | `APPLICATION_KEYCLOAK_ADMIN_PASSWORD` | Segreto |
| Chiave VAPID privata | `VAPID_PRIVATE_KEY` | Segreto; deve corrispondere alla chiave pubblica FE |
| URL pubblico feed | `TAURUS_PUBLIC_BASE_URL` | HTTPS pubblico del backend/feed |
| URL pubblico QR | `INVENTORY_QR_PUBLIC_BASE_URL` | HTTPS pubblico della SPA |
| Kill switch QR | `INVENTORY_QR_ENABLED` | Un flag tenant non supera un kill switch globale spento |
| Timeout etichette QR | `INVENTORY_QR_LABEL_TIMEOUT_SECONDS` | Facoltativo, predefinito 30, da 1 a 300; oltre il limite la stampa risponde `503 inventory.labels.timeout` |
| Kill switch feed | `CALENDAR_FEED_ENABLED` | Come sopra |
| Ascolto delle parti | `SCORE_PLAYBACK_ENABLED` | Capacità di installazione; il tenant la attiva con il proprio flag |
| Scrittura delle parti | `SCORE_WRITING_ENABLED` | Facoltativo, predefinito `false`: capacità di installazione dell'editor di scrittura, effettiva solo con l'ascolto; il tenant la attiva con il proprio flag |
| URL servizio OMR | `TAURUS_OMR_URL` | Indirizzo interno di `taurus-omr`; vuoto nasconde riconoscimento e caricamento MIDI e spegne la lettura del testo dei PDF scansionati |
| Chiave servizio OMR | `TAURUS_OMR_API_KEY` | Segreto condiviso: lo stesso nome e lo stesso valore per servizio e backend, almeno 16 caratteri |
| Lettura del testo dei PDF | `APPLICATION_PDFPROCESSING_OCR_ENABLED` | Facoltativo, predefinito `true`: suggerisce gli strumenti delle parti scansionate con il servizio OMR |
| Server SMTP | `SPRING_MAIL_HOST`, `SPRING_MAIL_PORT`, `SPRING_MAIL_USERNAME` | Senza host il backend non invia e-mail e la firma elettronica non è attivabile (§4.7) |
| Password SMTP | `SPRING_MAIL_PASSWORD` | Segreto |
| TLS SMTP | `SPRING_MAIL_PROPERTIES_MAIL_SMTP_STARTTLS_ENABLE=true` o `SPRING_MAIL_PROPERTIES_MAIL_SMTP_SSL_ENABLE=true` | Secondo la porta del provider (587 STARTTLS, 465 SSL) |
| Mittente e-mail | `JHIPSTER_MAIL_FROM` | Indirizzo che il server SMTP accetta come mittente |
| Chiave dei codici di firma | `SIGNATURE_OTP_SECRET` | Segreto di almeno 32 byte casuali (§4.7) |
| Keystore del sigillo | `SIGNATURE_SEAL_KEYSTORE_PATH`, `SIGNATURE_SEAL_KEY_ALIAS` | File PKCS#12 montato in sola lettura (§4.7) |
| Password del keystore | `SIGNATURE_SEAL_KEYSTORE_PASSWORD` | Segreto |
| Marca temporale del sigillo | `SIGNATURE_SEAL_TSA_URL` | Facoltativa: vuota produce sigilli senza marca temporale |
| Segreto del client della firma | `SIGNATURE_KEYCLOAK_CLIENT_SECRET` | Segreto del client Keycloak `taurus-signature`; vuoto non offre l'app di autenticazione (§4.7) |
| Realm per la verifica dell'app | `SIGNATURE_KEYCLOAK_REALM_URI` | Facoltativo: per default l'issuer OIDC del backend; indirizzo del realm raggiungibile dal backend |
| Indirizzo dei link di firma | `SIGNATURE_PUBLIC_BASE_URL` | HTTPS pubblico dell'applicazione Angular, da cui si costruiscono i link `/firma/{token}` inviati ai genitori; per default `TAURUS_PUBLIC_BASE_URL` (§4.7) |
| Certificati della CIE per CieSign | `SIGNATURE_CIE_TRUST_ANCHORS` | Nel manifest di produzione punta al bundle versionato montato in sola lettura su `/etc/taurus/cie`; vuoto non offre CieSign (§4.7) |

Keycloak non usa `SPRING_MAIL_*`: le e-mail che manda lui — la scelta della password al primo accesso e le altre azioni richieste — passano dal server SMTP configurato nel realm (**Realm settings › Email**: host, porta, mittente ed eventuali credenziali). Senza quella configurazione l'invito a un nuovo utente fallisce con `keycloak.email.setupFailed` anche se il backend spedisce regolarmente le proprie e-mail, perché il messaggio non parte da Taurus. In sviluppo il realm versionato punta a Mailpit (`mailpit:1025`), come il backend; un realm Keycloak già esistente va configurato a mano, perché `--import-realm` non lo sovrascrive.

Le e-mail di Keycloak e quelle del backend hanno lo stesso aspetto ([standard delle e-mail](email-layout-standard.md)). I modelli di Keycloak viaggiano nel JAR del provider; il logo delle sue e-mail è un'immagine servita da Keycloak all'indirizzo pubblico delle risorse del tema, quello del backend è allegato al messaggio. Il realm ha l'italiano come unica lingua, da cui vengono gli oggetti delle e-mail e i testi della pagina di login: il realm versionato lo dichiara, un realm esistente lo riceve a mano da **Realm settings › Localization** (**Internationalization** attiva, solo `it` fra le lingue supportate, `it` come predefinita). Senza questa impostazione gli oggetti delle e-mail di Keycloak escono in inglese.

Le altre proprietà dell'ascolto (dimensione dei caricamenti, tempi e concorrenza del servizio OMR, recupero dei job, versioni conservate e orario della pulizia) hanno valori predefiniti adatti alla produzione e sono elencate nella [specifica](track-score-playback-spec.md#configurazione-del-backend).

Le proprietà RabbitMQ standard Spring, per esempio `SPRING_RABBITMQ_HOST`, `SPRING_RABBITMQ_PORT`, `SPRING_RABBITMQ_USERNAME` e `SPRING_RABBITMQ_PASSWORD`, devono essere impostate nell'ambiente distribuito. Le code applicative sono `upload.files` e `score.recognition`, l'exchange è `taurus.rabbitmq`. La coda `upload.files` ha due consumatori per replica, quello configurato e quello dell'annotazione sul worker: è atteso, e un messaggio resta comunque consegnato a uno solo. I messaggi di `score.recognition` sono JSON `{ tenant, jobId }`: la tabella dei job resta la fonte di verità e un messaggio perso viene ripubblicato dal recupero pianificato.

Un messaggio che il consumatore rifiuta non torna in coda: `spring.rabbitmq.listener.simple.default-requeue-rejected` è `false`, le due code di lavoro dichiarano `x-dead-letter-exchange: taurus.dead-letter` con la propria `x-dead-letter-routing-key`, e il broker lo instrada una volta sola nella coda di scarto corrispondente — `upload.files.dead` e `score.recognition.dead`. La riconsegna infinita non servirebbe come nuovo tentativo, perché in entrambe le pipeline la tabella dei job è la fonte di verità e ha la sua ripresa pianificata (§11), mentre occuperebbe un consumatore senza far avanzare nulla. Le code di scarto sono materiale di diagnosi: vanno osservate (§10.2) e svuotate a mano dopo l'analisi, non riversate nella coda di lavoro.

### 4.2 Frontend Angular

Il frontend si configura all'avvio del container, non alla build: l'entrypoint scrive
`assets/config.json` dalle variabili d'ambiente e l'applicazione lo legge prima di partire
(`taurus-fe/src/runtime-config.ts`). La stessa immagine serve quindi installazioni diverse, e nel
bundle non finisce nessun indirizzo della rete interna.

| Variabile del container | Cosa configura | Predefinito |
| --- | --- | --- |
| `TAURUS_API_BASE_URL` | Indirizzo dell'API per il browser | `/api` |
| `TAURUS_KEYCLOAK_BASE_URL` | Indirizzo di Keycloak per il browser | `/auth` |
| `TAURUS_KEYCLOAK_REALM` | Realm | `taurus` |
| `TAURUS_KEYCLOAK_CLIENT_ID` | Client OIDC, lo stesso del realm e del backend | `web_app` |
| `TAURUS_VAPID_PUBLIC_KEY` | Chiave pubblica delle notifiche push | `CHANGE_ME`, che le disattiva |
| `TAURUS_PRIMEUI_LICENSE` | Chiave della PrimeUI License di chi installa Taurus, Community o commerciale; si rinnova ogni anno (vedi `taurus-fe/THIRD_PARTY_NOTICES.md`) | vuota: l'applicazione funziona, ma PrimeNG mostra un avviso di licenza mancante |
| `TAURUS_API_UPSTREAM` | Indirizzo interno del backend a cui inoltrare `/api` | `http://backend:8080` |
| `TAURUS_KEYCLOAK_UPSTREAM` | Indirizzo interno di Keycloak a cui inoltrare `/auth` | `http://keycloak:9080` |
| `TAURUS_MAX_UPLOAD_SIZE` | Limite del corpo delle richieste, da tenere con quello del backend | `500m` |
| `TAURUS_DNS_RESOLVER` | DNS che risolve gli indirizzi degli inoltri a ogni richiesta | `127.0.0.11`, il DNS di Docker |

Il container serve l'applicazione e inoltra `/api` e `/auth`: una sola origine pubblica, quindi
niente CORS e nessun contenuto misto. I valori compilati in `environment.prod.ts` sono solo il
ripiego di quel file — `/api` e `/auth` sulla stessa origine — e non contengono più nomi della rete
interna né il client `web-app`, che non esisteva nel realm.

Da verificare prima del rilascio:

- realm e client ID coincidano con il realm importato;
- la chiave VAPID pubblica corrisponda alla privata del backend;
- redirect URI, web origin e post-logout URI siano autorizzati in Keycloak;
- il service worker sia servito via HTTPS, cioè il reverse proxy termini TLS.

La build (`npm run build` e il `Dockerfile` del frontend) procura il SoundFont del lettore e ne
verifica l'impronta SHA-256. Le fonti, in ordine: `TAURUS_SOUNDFONT_PATH` (una copia già sulla
macchina), `TAURUS_SOUNDFONT_URL` (la copia controllata dell'installazione, per esempio un allegato
di release) e infine il mirror pubblico `ftp.osuosl.org`. Qualunque sia la fonte, una copia con
un'impronta diversa viene rifiutata. Verovio e il SoundFont sono serviti come asset statici e messi
in cache dal service worker al primo ascolto, non precaricati.

### 4.3 Sito informativo

Variabili build-time:

| Variabile | Scopo |
| --- | --- |
| `SITE_URL` | URL canonico, sitemap e metadata |
| `PUBLIC_APP_URL` | Destinazione dei pulsanti di accesso |
| `PUBLIC_CONTACT_EMAIL` | Contatto pubblico |
| `TAURUS_INFO_PORT` | Solo compose locale |

Per cambiarle occorre ricostruire l'immagine. Il TLS termina sul reverse proxy o ingress.

### 4.4 Feature flag

Dodici funzioni sono configurabili per tenant: calendario, economia, inventario, onboarding/import, feed calendario esterno, QR inventario, fogli di affidamento, firma elettronica, preferenze notifiche, Web Push, preparazione evento e ascolto delle parti. Feed calendario esterno, preparazione evento e Web Push dipendono dal calendario; al rilascio della migration `20261104000000_tenant_calendar_flag.xml` il calendario risulta attivo per tutti i tenant esistenti, mentre un tenant nuovo lo riceve solo se il super amministratore lo spunta. Spegnere il calendario non cancella eventi, presenze, preparazioni e collegamenti dei movimenti economici agli eventi; i promemoria Web Push ancora in coda vengono chiusi come `SKIPPED`. I fogli di affidamento dipendono dall'inventario e la firma elettronica dai fogli; al rilascio della migration `20261021100000_tenant_loan_sheet_signature_flags.xml` i fogli risultano attivi per i tenant con l'inventario e la firma resta spenta finché il super amministratore non la concede. Prima di spegnere la firma a un tenant scaricare i fascicoli da conservare: l'eliminazione degli atti al termine del periodo di grazia continua anche con la funzione spenta.

```text
funzione effettiva = capacità installazione AND flag tenant AND dipendenze effettive
```

Disabilitare un flag nasconde e blocca la funzione, ma non cancella i dati. Dopo una modifica verificare `GET /api/tenant-features/current` come utente del tenant e, come super amministratore, le capability esposte da `GET /api/tenant-features/capabilities`.

### 4.5 Servizio OMR

- Avvio locale: fa parte di `services.yml` e si avvia con le altre dipendenze (§5.1). L'immagine è `fundanie/taurus-omr`, pubblicata su Docker Hub dal workflow `docker-publish.yml` a ogni tag `v*.*.*` come quelle di backend e frontend; `TAURUS_OMR_VERSION` nel file `.env` del compose sceglie la versione, `latest` per default. Se l'immagine non è pubblicata, Compose la costruisce da `taurus-omr` (pochi minuti la prima volta); dopo una modifica del servizio si ricostruisce con `docker compose -f taurus-be/src/main/docker/services.yml up -d --build omr`.
- Chiave e indirizzo in sviluppo: il file `.env` del compose e il profilo `dev` del backend usano la stessa chiave di sviluppo e `http://localhost:8090`; `TAURUS_OMR_API_KEY` e `TAURUS_OMR_URL` li sostituiscono. Negli ambienti distribuiti la chiave va sempre impostata, diversa da quella di sviluppo. Le vecchie variabili `SCORE_PLAYBACK_OMR_URL` e `SCORE_PLAYBACK_OMR_API_KEY` sono ignorate: con le sole vecchie variabili il servizio risulta non configurato e all'avvio il backend lo segnala con un messaggio informativo.
- In produzione il servizio non pubblica porte: sta su una rete interna raggiungibile solo dal backend, con file system in sola lettura, `/tmp` in memoria, utente non privilegiato e limiti di CPU e memoria come in `omr.yml`.
- Stato: `GET /v1/health` restituisce senza chiave stato e versioni dei motori di riconoscimento e del motore di lettura del testo (`textEngine`). Un riconoscimento di una pagina richiede circa 40 secondi con 4 CPU, con i due motori in parallelo; la concorrenza predefinita è un job alla volta.
- Lettura del testo: l'elaborazione dei PDF manda al servizio (`POST /v1/text-recognitions`) la prima pagina delle parti senza testo selezionabile, a lotti di 8 pagine, e suggerisce gli strumenti letti nel margine sinistro o nella fascia in alto. RapidOCR gira in un processo separato, con slot propri che non aspettano i riconoscimenti: circa 4 secondi a pagina con 2 thread. `TAURUS_OMR_TEXT_CONCURRENCY` (1), `TAURUS_OMR_TEXT_THREADS` (2) e `TAURUS_OMR_TEXT_TIMEOUT_SECONDS` (60) regolano il servizio; `application.pdf-processing.ocr.*` il backend (attivazione, attesa, affidabilità minima, pagine per richiesta). Se il servizio non risponde, l'elaborazione termina comunque e le parti restano senza suggerimenti.
- Rotazione della chiave: aggiornare insieme `TAURUS_OMR_API_KEY` del servizio e del backend (§15.4); con chiavi diverse i job terminano con `serviceUnavailable`, le parti scansionate restano senza suggerimenti e il backend registra un errore.
- Aggiornamento dei motori: nuova immagine con le versioni e le impronte aggiornate in `Dockerfile`, `requirements.txt` e `models.sha256`. La CI (`verify.yml`) costruisce l'immagine, la avvia e misura l'accuratezza sul corpus di riferimento: il job fallisce se un motore legge meno battute del minimo fissato in `taurus-omr/tests/test_accuracy.py` e la tabella dei risultati è nel riepilogo del job. Se i risultati migliorano si alza il minimo. Prima del rilascio si ripete la misura su parti reali (§4.6).

### 4.6 Accuratezza dei motori

Il modulo `taurus-omr` contiene gli strumenti di misura (`accuracy/`), da eseguire nella cartella del modulo con le dipendenze di `requirements-test.txt`:

- corpus di riferimento: `python -m accuracy run --url http://localhost:8090 --key <chiave>` riconosce le sei parti del corpus con il servizio indicato e stampa, per motore, le battute corrette, le indicazioni di struttura lette e i tempi; `--save <cartella>` conserva ciò che ha letto ogni motore;
- nomi delle parti: `python -m accuracy names --url http://localhost:8090 --key <chiave>` legge la prima pagina di ogni parte del corpus con il motore di lettura del testo e stampa le righe che il backend terrebbe, con le stesse regole di zona e affidabilità; `tests/test_accuracy.py` fissa la quota minima di nomi letti;
- parti reali: dopo che un archivista ha corretto e approvato una parte riconosciuta, si scaricano dal dialogo delle versioni la versione approvata e quella del motore, e `python -m accuracy compare approvata.mxl audiveris.mxl` elenca le battute diverse e la quota di battute corrette;
- una battuta è corretta se si ascolta uguale: stessa durata, stesse note per inizio, durata, altezza e legatura di valore; non contano grafia degli accidenti, voci, travature e pause. Le battute sono allineate, quindi una battuta persa o letta due volte conta una volta sola;
- nuove parti di riferimento: si aggiungono a `accuracy/corpus.py` e si ridisegnano con `python -m accuracy render` (dipendenze di `requirements-accuracy.txt`, la libreria Cairo e un carattere compatibile con Times), per esempio in un container: `docker run --rm -v "${PWD}:/work" -w /work python:3.12-slim-bookworm sh -c "apt-get update && apt-get install -y libcairo2 fonts-liberation && pip install -r requirements-accuracy.txt && python -m accuracy render"`.

### 4.7 Firma elettronica

La firma elettronica di fogli e prese visione ([specifica](inventory-electronic-signature-spec.md)) è attivata da ogni tenant nella pagina **Modello del foglio di affidamento**, ma solo se l'installazione fornisce tre requisiti, che la pagina mostra come «Pronto» o «Mancante»:

- **Server di posta**: `SPRING_MAIL_*` e `JHIPSTER_MAIL_FROM`. Il server è unico per l'installazione e ogni messaggio riporta il nome del tenant. Per restare a costo zero si usa la casella dell'associazione o un provider con piano gratuito, verificandone il limite di invii giornalieri: ogni firma invia almeno un codice e un utente può chiedere al massimo 20 conferme all'ora. Se il server rifiuta un messaggio la conferma è annullata, l'utente vede «Non è stato possibile inviare il codice via e-mail» e il log registra `signature_mail_failed`.
- **Chiave dei codici**: `SIGNATURE_OTP_SECRET`, con cui il backend calcola l'HMAC dei codici salvati. Si genera una volta per ambiente, per esempio con `openssl rand -base64 48`, e si conserva nel secret manager.
- **Certificato del sigillo**: keystore PKCS#12 con chiave privata e certificato, con cui il backend sigilla documenti e attestazioni. Un certificato autoemesso non costa nulla e basta a rendere evidente ogni modifica; l'impronta del certificato compare nelle attestazioni. Esempio di creazione, da eseguire fuori dal server su una macchina fidata:

  ```powershell
  keytool -genkeypair -storetype PKCS12 -keystore taurus-seal.p12 -alias taurus-seal -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 3650 -dname "CN=Taurus sigillo elettronico, O=<gestore dell'installazione>, C=IT" -ext KeyUsage:critical=digitalSignature,nonRepudiation
  ```

  Il file va montato in sola lettura nel container del backend (`SIGNATURE_SEAL_KEYSTORE_PATH`), con `SIGNATURE_SEAL_KEY_ALIAS=taurus-seal` e la password in `SIGNATURE_SEAL_KEYSTORE_PASSWORD`. All'avvio il log registra `signature_seal_loaded` con soggetto, impronta SHA-256 e scadenza del certificato, oppure `signature_seal_not_configured`; un keystore illeggibile produce `signature_seal_unavailable` e il requisito resta «Mancante». Il keystore entra nel backup dei segreti, non in quello dei dati.

Facoltativamente `SIGNATURE_SEAL_TSA_URL` indica un servizio di marca temporale RFC 3161 gratuito: i sigilli diventano PAdES B-T. Se il servizio non risponde il sigillo fallisce, quindi va scelto un servizio affidabile o lasciato vuoto.

**App di autenticazione** (facoltativa, non è un requisito): chi ha configurato in Keycloak l'app OTP può confermare le firme con il suo codice invece che via e-mail. Servono:

1. il provider `taurus-otp`, compreso nel JAR di `keycloak-authenticator` (§7.3), installato sulla stessa versione di Keycloak con cui è compilato (26.8.2);
2. nel realm un client confidenziale `taurus-signature` con solo **Service accounts roles** attivo (nessun flusso browser né direct access grant), un ruolo del client `otp-verifier` assegnato al suo service account e lo scope client `basic`. Il realm di sviluppo `taurus-realm.json` lo contiene già; un realm esistente lo riceve dalla console di amministrazione (**Clients › Create client**, poi **Roles › Create role** `otp-verifier`, poi **Service accounts roles › Assign role**), oppure, in sviluppo, ricreando il realm;
3. il segreto del client, dalla scheda **Credentials**, in `SIGNATURE_KEYCLOAK_CLIENT_SECRET`; il backend raggiunge il realm all'indirizzo dell'issuer OIDC o a `SIGNATURE_KEYCLOAK_REALM_URI`.

In sviluppo `keycloak.yml` monta il JAR da `taurus-be/src/main/docker/realm-config/keycloak-authenticator.jar`, file non versionato: dopo `.\mvnw.cmd verify` in `keycloak-authenticator` si copia lì `target/keycloak-authenticator.jar` e si riavvia Keycloak. Va rifatto anche quando cambia l'immagine di `keycloak.yml`: al primo avvio la versione nuova aggiorna il database `taurus_keycloak` di sviluppo, che la precedente non riapre più. `--import-realm` non sovrascrive un realm già presente, quindi un database Keycloak esistente riceve il client solo a mano o ricreando il realm.

Senza segreto il profilo mostra l'app come non disponibile e le firme usano il codice via e-mail. Se Keycloak non risponde entro 5 secondi la firma con l'app fallisce senza consumare tentativi, l'utente può passare all'e-mail e il log registra `signature_totp_unavailable`: più errori consecutivi indicano Keycloak irraggiungibile o il ruolo `otp-verifier` mancante. La policy OTP del realm deve restare con codici non riutilizzabili. Chi configura l'app la usa anche al login, come già previsto dal flusso del realm. Nel profilo `dev` il backend usa il segreto di sviluppo `taurus-signature`.

**Firma del genitore o tutore** (nessun requisito aggiuntivo): quando l'Affidatario è il genitore o tutore del socio minorenne, che non ha un account, l'amministratore inserisce all'emissione la sua e-mail e Taurus gli invia per ogni atto un link alla pagina pubblica `/firma/{token}`, valido 7 giorni (`application.signature.link-validity`). Il link si costruisce solo da `SIGNATURE_PUBLIC_BASE_URL`, che deve essere l'indirizzo pubblico in HTTPS dell'applicazione Angular, mai dall'header `Host`: un valore sbagliato produce link che non si aprono. Il reverse proxy deve servire `/firma/*` con l'applicazione Angular, come ogni altra rotta, e inoltrare al backend `/api/signature-links/v1/*`, che risponde senza autenticazione; nessun'altra configurazione di Keycloak è necessaria, perché la pagina non avvia il login.

- Un'e-mail del link rifiutata dal server SMTP non blocca l'operazione: il log registra `signature_link_mail_failed`, la metrica `taurus_signature_links_total{outcome="mailFailed"}` cresce e la sezione **Firme** del foglio mostra il link «non inviato», da reinviare.
- Le richieste alla pagina pubblica sono limitate a 120 l'ora per link e 600 l'ora per indirizzo (`application.signature.link-rate-limit-per-token-hour`, `link-rate-limit-per-ip-hour`); oltre rispondono `429`. Dietro un proxy il backend deve ricevere l'indirizzo reale del client (`server.forward-headers-strategy`), altrimenti il limite per indirizzo vale per tutti.
- Ogni ora (`application.signature.link-expiry-cron`) Taurus notifica agli amministratori i link scaduti senza firma e rimuove dal registro pubblico `public.signature_link_registry` le righe dei link revocati o scaduti (§11). Il registro non contiene dati personali.
- Il token del link compare solo nell'e-mail e nell'indirizzo della pagina: non va mai incollato in ticket o log. Un link inoltrato per errore si revoca dalla sezione **Firme** e se ne invia uno nuovo.

**CieSign** (facoltativo, non è un requisito): l'Affidatario con codice fiscale italiano, socio maggiorenne o genitore, può firmare i documenti con l'app CieSign o con il Software CIE e caricarli in Taurus, che verifica firma, certificato e integrità. Serve solo che il backend riconosca le CA della CIE, e nel manifest di produzione è già così: il bundle dei certificati è versionato in [`deploy/cie/trust-anchors.pem`](../deploy/cie/trust-anchors.pem), il manifest lo monta in sola lettura su `/etc/taurus/cie` e `SIGNATURE_CIE_TRUST_ANCHORS` ci punta per default. Un'installazione parte quindi con CieSign disponibile, senza chiamare nessuno all'avvio; per non offrirlo si mette `TAURUS_SIGNATURE_CIE_TRUST_ANCHORS=` vuoto nel `.env`.

Il bundle si procura e si rinnova con uno script, che gira nel repository e non sull'host (serve Node.js 26, come la CI), perché lo scaricamento sia ripetibile e la fiducia non dipenda da chi lo esegue:

```bash
node scripts/ops/fetch-cie-trust-anchors.mjs                  # scarica, verifica e riscrive il bundle
node scripts/ops/fetch-cie-trust-anchors.mjs --verify-bundle   # controlla il bundle versionato, senza rete
```

Lo script legge la lista di fiducia italiana pubblicata da AgID (`https://eidas.agid.gov.it/TL/TSL-IT.xml`) e prende i certificati del prestatore «Ministero dell'Interno» i cui servizi sono in vigore: la CA radice della Carta d'Identità Elettronica e le issuing sub CA che emettono i certificati delle carte. Scarta i servizi ritirati e quello che non risale a una di quelle radici. La decisione di fiducia però non è dello script: le impronte SHA-256 accettate stanno in [`scripts/ops/cie-trust-anchors.sha256`](../scripts/ops/cie-trust-anchors.sha256), versionate, e un certificato che non è in quell'elenco fa fallire lo script invece di finire nel bundle. È lo stesso schema del SoundFont del lettore e dei modelli del servizio OMR: la rete porta i byte, il repository dice quali byte sono accettabili.

Quando una CA della CIE viene rinnovata lo script fallisce, dicendo quale impronta non si aspettava. Il certificato nuovo si verifica sulla fonte ufficiale — `keytool -printcert -file <file>` oppure `openssl x509 -in <file> -noout -subject -enddate -fingerprint -sha256` — e il rinnovo si registra con `node scripts/ops/fetch-cie-trust-anchors.mjs --update-pins`, che riscrive bundle e impronte: la modifica va in un commit, rivista, e arriva all'installazione con l'aggiornamento. Il workflow `cie-trust-anchors` ripete il confronto il primo giorno di ogni mese, così il rinnovo si scopre prima che qualcuno provi a firmare.

Fuori dal manifest — un backend avviato a mano, un host che non usa `deploy/` — `SIGNATURE_CIE_TRUST_ANCHORS` accetta uno o più percorsi separati da virgola, file PEM o DER, anche con più certificati in un solo file; tutti i certificati indicati sono considerati attendibili. In sviluppo, per provare una firma con una CIE reale, basta avviare il backend con `SIGNATURE_CIE_TRUST_ANCHORS=deploy/cie/trust-anchors.pem`.

All'avvio il log registra `signature_ciesign_trust_anchor` con soggetto e scadenza di ogni certificato caricato, oppure `signature_ciesign_not_configured`; un file illeggibile produce `signature_ciesign_trust_anchor_invalid` ed è ignorato. Un certificato che scade entro 60 giorni aggiunge `signature_ciesign_trust_anchor_expiring` con i giorni che restano, uno già scaduto `signature_ciesign_trust_anchor_expired`: sono il promemoria che il bundle va rigenerato, perché le carte emesse da una CA non più valida vengono rifiutate. Senza certificati la finestra di firma non propone CieSign e una richiesta diretta risponde `signature.cieSign.notConfigured`.

- La revoca si controlla con la CRL indicata nel certificato della carta: il backend deve poter raggiungere in uscita, in HTTP, l'indirizzo della CRL. La lista della CIE può essere grande: si scarica al massimo 20 MB entro `application.signature.cie.revocation-timeout` (10 secondi) e si tiene in memoria fino al suo aggiornamento, al massimo un giorno. Se non arriva in tempo la firma è accettata senza controllo di revoca: il log registra `signature_ciesign_revocation_unavailable` con il motivo e la metrica `taurus_signature_ciesign_total{outcome="acceptedRevocationUnavailable"}` cresce, mentre la prova e l'attestazione riportano «elenco di revoca non raggiungibile».
- Un file rifiutato non viene salvato: il log registra `signature_ciesign_rejected` con la chiave, la metrica conta l'esito (`documentMismatch`, `invalidSignature`, `untrustedCertificate`, `signerMismatch`, …) e l'utente vede il motivo nella finestra. Molti `untrustedCertificate` dopo l'avvio indicano un certificato della CIE mancante o scaduto nell'elenco.
- Il file firmato con CieSign, al massimo 25 MB, si salva nello storage dei media con i documenti dell'atto ed è eliminato con loro; a firme complete il sigillo si aggiunge a quel file.

Nel profilo `dev` il backend invia le e-mail a Mailpit, avviato da `services.yml`, usa una chiave dei codici di sviluppo e sigilla con un certificato temporaneo generato all'avvio: i messaggi si leggono su `http://localhost:8025` e non sono mai consegnati. Il certificato temporaneo cambia a ogni riavvio e il log lo segnala con `signature_seal_ephemeral`; non va mai usato fuori dallo sviluppo.

Taurus non conserva i documenti firmati a lungo termine: la conservazione per il tempo richiesto dalla legge spetta all'associazione, che scarica il fascicolo di ogni foglio dalla sezione **Firme** del dettaglio. Documenti degli atti e attestazioni stanno nello storage dei media (categoria `signature-acts`) finché il foglio non è definito o annullato e poi per `application.signature.download-grace-days` giorni (30 per default); la pulizia notturna li elimina insieme ai dati personali delle prove (§11). Le conferme con codice chiuse sono eliminate dopo 30 giorni; le prove delle firme restano, senza dati personali, per la verifica della catena. Il PDF di un foglio firmato elettronicamente porta la filigrana «COPIA DI CONSULTAZIONE – NON FIRMATA».

Il modello predefinito (versione `2026-10-19`) contiene già i marcatori degli atti. Un tenant con un modello caricato deve aggiungerli, insieme all'informativa sulla conservazione degli atti firmati: finché la pagina del modello segnala problemi nella sezione **Firma elettronica**, i fogli si emettono solo su carta.

## 5. Avvio e arresto locale

### 5.1 Primo avvio

Dalla root del repository:

```powershell
docker compose -f taurus-be/src/main/docker/services.yml up --wait
```

Il comando avvia PostgreSQL, Keycloak, RabbitMQ, Mailpit e il servizio OMR e attende che siano pronti. La prima volta scarica, o costruisce, l'immagine del servizio OMR (circa 1,5 GB).

In terminali separati:

```powershell
Set-Location taurus-be
.\mvnw.cmd
```

```powershell
Set-Location taurus-fe
npm ci
npm start
```

Facoltativamente:

```powershell
Set-Location taurus-info
pnpm install --frozen-lockfile
pnpm dev
```

Endpoint locali attesi:

| Servizio | URL |
| --- | --- |
| Frontend | `http://localhost:4200` |
| Backend health | `http://localhost:8080/management/health` |
| Keycloak | `http://localhost:9080` |
| RabbitMQ management | `http://localhost:15672` |
| Mailpit (e-mail di sviluppo) | `http://localhost:8025` |
| Servizio OMR | `http://localhost:8090/v1/health` |
| Sito Astro dev | `http://localhost:4321` |

Il backend abilita Spring Docker Compose e può tentare di avviare `services.yml` automaticamente, servizio OMR compreso: se l'immagine OMR non è pubblicata, il primo avvio la costruisce e richiede alcuni minuti. Per evitare due owner dello stesso stack, scegliere una sola modalità: avvio manuale del compose oppure lifecycle Spring.

### 5.2 Primo accesso su ambiente vuoto

Dopo un reset completo di PostgreSQL e Keycloak l'ambiente non contiene tenant reali. Il realm importato da `taurus-be/src/main/docker/realm-config/taurus-realm.json` definisce solo il gruppo di bootstrap `temp`, che non ha una riga in `public.tenant` né uno schema PostgreSQL. Il primo accesso serve solo a creare il primo tenant reale.

Segnale di ambiente vuoto: all'avvio il backend registra `No active PostgreSQL tenant schemas to migrate`.

**1. Preparare il super amministratore in Keycloak.** Dalla console `http://localhost:9080`, nel realm `taurus` (non `master`), creare l'utente, ad esempio `superadmin`, e configurarlo così:

| Impostazione | Dove | Valore |
| --- | --- | --- |
| Password | Credentials | Password non temporanea |
| Ruolo client | Role mapping → Assign role → filtro per client | `web_app` → `ROLE_SUPER_ADMIN`, assegnato direttamente all'utente |
| Gruppo | Groups → Join group | `temp` |
| Attributo | Attributes | Chiave `temp_roles`, valore `ROLE_SUPER_ADMIN` |

Perché servono:

- il flusso di login `Browser with Tenant and Role` ricava i tenant dai gruppi dell'utente e i ruoli dall'attributo `<gruppo>_roles`, con valori separati da virgola. Se nessun gruppo ha il relativo attributo, il login fallisce dopo la password con `INVALID_USER`;
- alla creazione di un tenant il backend aggiunge al nuovo gruppo solo gli utenti che hanno il ruolo client `web_app` → `ROLE_SUPER_ADMIN` assegnato direttamente, non tramite un gruppo o un ruolo composito.

**2. Accedere con il tenant `temp`.** Accedere a `http://localhost:4200` come `superadmin`. Con un solo tenant e un solo ruolo la selezione è automatica.

`temp` non ha uno schema, quindi l'app entra in **modalità bootstrap**: `GET /api/tenant-status` risponde `provisioned: false`. In questa modalità:

- il menu contiene solo la voce Tenant e ogni altra pagina riporta a `/tenants`;
- la pagina Tenant mostra l'avviso «Primo accesso» con il pulsante Esci;
- la barra in alto mostra «Primo accesso» e, al posto di calendario, notifiche e profilo, il pulsante Esci;
- notifiche, promemoria push, preferenze e funzioni del tenant non vengono richiesti;
- un utente senza `ROLE_SUPER_ADMIN` vede invece la pagina «Tenant non configurato».

Il backend risponde `409` con `error.tenant.notProvisioned` a ogni API che richiede lo schema del tenant, invece di fallire su tabelle inesistenti. Restano disponibili solo le API annotate con `@TenantSchemaNotRequired`: gestione tenant, capability delle funzioni, account, `auth-info`, logout e stato del tenant.

**3. Creare il primo tenant.** Dalla pagina Tenant, aperta automaticamente, creare il tenant. La pagina usa solo lo schema `public` e Keycloak.

Il codice diventa il nome del gruppo Keycloak e il prefisso dell'attributo `<codice>_roles`. Usare quindi solo minuscole, cifre e trattini, senza spazi né virgole.

La creazione esegue il provisioning descritto al §13.1 e, in più:

1. crea il gruppo Keycloak `<codice>`;
2. vi aggiunge ogni utente con il ruolo client `ROLE_SUPER_ADMIN`;
3. imposta su ciascuno l'attributo `<codice>_roles` con i suoi ruoli client `web_app`.

Verifiche:

- nel log del backend compare `Tenant <codice> PostgreSQL schema tenant_<hash> is ready`;
- in Keycloak l'utente è membro del gruppo `<codice>` e ha l'attributo `<codice>_roles` = `ROLE_SUPER_ADMIN`. Se manca, aggiungerlo a mano.

Se la creazione fallisce, la riga del tenant viene rimossa: seguire il §13.2.

**4. Rientrare nel tenant reale.**

1. Eseguire il logout con il pulsante Esci della barra in alto o dell'avviso «Primo accesso». Le preferenze di layout scelte sotto `temp` restano solo nel browser e vengono cancellate all'uscita.
2. Eseguire di nuovo il login e scegliere il nuovo tenant nella schermata di selezione.

**5. Facoltativo: dismettere `temp`.** Rimuovere l'utente dal gruppo `temp` ed eliminare l'attributo `temp_roles`: da quel momento il login entra direttamente nel tenant reale. Il gruppo `temp` può restare, perché serve solo al bootstrap.

| Sintomo | Causa | Intervento |
| --- | --- | --- |
| `user_not_found` nei log Keycloak | Utente creato in un altro realm, ad esempio `master` | Creare l'utente nel realm `taurus` |
| Login rifiutato dopo la password, con `AuthenticationFlowException` o `INVALID_USER` | Nessun gruppo con attributo `<gruppo>_roles` valorizzato | Passo 1 |
| Avviso «Primo accesso» e menu con la sola voce Tenant | Sessione su un tenant senza schema, ad esempio `temp` | Passi 3 e 4 |
| Risposte `409` con `error.tenant.notProvisioned` nel log del backend | Richieste fatte con un tenant senza schema | Nessuno durante il primo accesso; altrimenti verificare il registro (§13.2) |
| Pagina «Tenant non configurato» | Utente senza `ROLE_SUPER_ADMIN` su un tenant senza schema | Accedere con il super amministratore e creare il tenant, oppure scegliere un tenant configurato |
| Il nuovo tenant non compare nella selezione | Ruolo client non assegnato direttamente oppure attributo `<codice>_roles` assente | Aggiungere a mano gruppo e attributo |

### 5.3 Controllo stato

```powershell
docker compose -f taurus-be/src/main/docker/services.yml ps
Invoke-RestMethod http://localhost:8080/management/health
Test-NetConnection localhost -Port 5432
Test-NetConnection localhost -Port 5672
Test-NetConnection localhost -Port 9080
Invoke-RestMethod http://localhost:8090/v1/health
```

Health atteso del backend: HTTP `200` e stato `UP`. I dettagli completi richiedono autorizzazione amministrativa. Nel compose PostgreSQL, Keycloak e servizio OMR devono risultare `healthy`; il servizio OMR risponde con stato `UP` e le versioni dei motori.

### 5.4 Arresto

Arrestare backend e frontend con `Ctrl+C`, quindi:

```powershell
docker compose -f taurus-be/src/main/docker/services.yml down
```

Avvertenza: nel compose corrente il volume dati PostgreSQL è commentato. La ricreazione del container può quindi eliminare dati locali. Non usare `down -v` e non rimuovere il container finché i dati necessari non sono stati esportati.

### 5.5 Aggiornamento dei servizi di sviluppo

`services.yml` non dichiara volumi per i dati: PostgreSQL e RabbitMQ li tengono nei volumi anonimi dei loro container.

Quando cambia la versione maggiore di PostgreSQL, come nel passaggio dalla 17 alla 18, `docker compose up` ricrea il container con un volume nuovo, perché cambia il punto di montaggio. Il database riparte vuoto e Keycloak reimporta il realm. I dati della versione precedente restano in un volume anonimo orfano, finché non lo cancella `docker volume prune`. Per portarli nella versione nuova, con il container della versione precedente ancora presente:

```powershell
docker compose -f taurus-be/src/main/docker/services.yml stop keycloak
docker exec postgresql-container sh -c 'pg_dumpall --clean --if-exists -U "$POSTGRES_USER" > /tmp/sviluppo.sql'
docker cp postgresql-container:/tmp/sviluppo.sql sviluppo.sql
docker compose -f taurus-be/src/main/docker/services.yml rm -s -v postgresql
docker compose -f taurus-be/src/main/docker/services.yml up -d --wait postgresql
docker cp sviluppo.sql postgresql-container:/tmp/sviluppo.sql
docker exec postgresql-container sh -c 'psql -U "$POSTGRES_USER" -d postgres -f /tmp/sviluppo.sql'
docker compose -f taurus-be/src/main/docker/services.yml up -d --wait
```

Il dump passa da un file dentro il container, così il redirect di PowerShell non ne cambia la codifica. Come in produzione (§8.6), gli unici errori attesi sono sul ruolo `taurus`, che esiste già.

Per RabbitMQ i dati di sviluppo non servono. Con l'hostname fisso, arrivato con RabbitMQ 4.4, il nodo nasce comunque vuoto la prima volta. Per non lasciare nel volume il nodo vecchio, prima di `up` si toglie il container con il suo volume: `docker compose -f taurus-be/src/main/docker/services.yml rm -s -v rabbitmq`. È anche il modo che la documentazione di RabbitMQ suggerisce per gli ambienti di sviluppo, perché salta i vincoli fra le versioni.

## 6. Build e verifiche

Eseguire dalla root:

```powershell
node scripts/docs/validate-feature-catalog.mjs
node --test scripts/docs/feature-catalog.test.mjs
node --test scripts/docs/error-catalog.test.mjs
node scripts/docs/check-error-catalog.mjs
node scripts/docs/generate-feature-index.mjs
git diff --exit-code -- docs/features.md
```

Backend:

```powershell
Set-Location taurus-be
.\mvnw.cmd verify
.\mvnw.cmd -Pprod clean verify
```

Frontend:

```powershell
Set-Location taurus-fe
npm ci
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

`npm run build` scarica il SoundFont la prima volta (§3.1).

Servizio OMR:

```powershell
Set-Location taurus-omr
python -m venv .venv
.venv\Scripts\pip install -r requirements-test.txt
.venv\Scripts\python -m pytest
docker build -t taurus-omr:local .
```

I test usano motori finti; l'accuratezza dei motori reali si misura con il servizio in esecuzione (§4.6). La CI la misura a ogni modifica del modulo.

Provider Keycloak:

```powershell
Set-Location keycloak-authenticator
.\mvnw.cmd verify
```

Sito informativo:

```powershell
Set-Location taurus-info
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm test:image
```

`pnpm test` controlla il sito costruito — file attesi, metadati, accessibilità strutturale, collegamenti, sitemap e intestazioni della configurazione nginx — e `pnpm test:image` costruisce l'immagine, la avvia e la interroga: salute, home con le intestazioni di sicurezza davvero servite, pagina di errore, `Server` senza versione e nginx che gira con un utente diverso da root. Senza Docker lo smoke si salta.

Per una modifica PrimeNG consultare solo le sezioni pertinenti di `docs/llms-full.md`. Per una migration tenant eseguire anche:

```powershell
Set-Location taurus-be
.\mvnw.cmd "-Dtest=TenantContextTest,TenantSchemaNameResolverTest,SchemaMultiTenantConnectionProviderTest" test
.\mvnw.cmd "-Dtest=TenantSchemaProvisioningServiceIT" test
```

## 7. Release e artefatti

### 7.1 Versionamento

I tag seguono `vMAJOR.MINOR.PATCH`. Un push di tag conforme avvia `.github/workflows/docker-publish.yml`, valida il catalogo funzionale e pubblica le immagini backend, frontend e servizio OMR (`taurus-omr`) su Docker Hub e GHCR, firmandole con Cosign. Su Docker Hub devono esistere i repository delle tre immagini; quello di `taurus-omr` va creato prima del primo tag che lo include.

Il workflow attuale **non** pubblica `taurus-info` né il provider Keycloak. Questi due artefatti richiedono una pipeline o procedura controllata aggiuntiva prima di poter dichiarare completa una release.

### 7.2 Checklist pre-release

- [ ] Feature ID e stato release aggiornati in `docs/features.json`.
- [ ] `docs/features.md` rigenerato e senza diff residuo.
- [ ] Tutti i job del workflow `Verify` verdi, compresa la misura di accuratezza dei motori se `taurus-omr` è cambiato.
- [ ] Se cambiano i motori OMR, accuratezza su parti reali misurata e registrata (§4.6).
- [ ] Migration globali incluse in `master.xml`.
- [ ] Migration tenant incluse in `tenant-master.xml`.
- [ ] Compatibilità di rollback valutata.
- [ ] Configurazioni FE, Keycloak e URL pubblici coerenti.
- [ ] Immagine info e JAR provider prodotti con versione tracciabile.
- [ ] Backup completato e restore recentemente provato.
- [ ] Spazio DB e storage sufficiente per migrazione e rollback.
- [ ] Change window e responsabile del go/no-go identificati.
- [ ] Smoke test e osservazione post-deploy assegnati.

### 7.3 Produzione degli artefatti mancanti

```powershell
docker build -t <registry>/taurus-info:<version> taurus-info
Set-Location keycloak-authenticator
.\mvnw.cmd clean verify
```

Registrare digest dell'immagine e checksum del JAR. Non sostituire il provider su un nodo Keycloak attivo senza una procedura rolling compatibile con la topologia scelta.

## 8. Deploy di produzione

### 8.1 Gate obbligatori

Non procedere se uno dei seguenti punti è vero:

- backup non disponibile o restore mai provato;
- configurazione Angular contiene hostname interni/non pubblici;
- manifest usa `start-dev` per Keycloak;
- PostgreSQL o storage media non sono persistenti;
- credenziali di esempio sono ancora attive;
- non è definito il routing HTTPS tra browser, frontend, API e Keycloak;
- non sono definiti readiness/liveness e limiti di risorse;
- le immagini non sono fissate per digest/versione;
- manca una strategia per eseguire una sola volta le migration in presenza di più repliche.

Il manifest di riferimento è [`deploy/compose.yml`](../deploy/compose.yml), con il suo [README](../deploy/README.md): stack completo su un host singolo, una sola porta pubblicata e legata al loopback, dati su volumi, servizio OMR con le restrizioni di `omr.yml` (rete interna senza porte pubblicate, file system in sola lettura, `/tmp` in memoria, nessuna capability, limiti di CPU e memoria) e Keycloak in modalità produzione. `scripts/ops/validate-deploy-manifest.sh` lo verifica a ogni esecuzione della CI. Il vecchio `app.yml`, erede di JHipster e mai valido per la produzione, è stato rimosso.

Resta aperto il gate che nessun file può chiudere: il manifest non è ancora stato eseguito su un host di produzione. Finché non lo è, va trattato come riferimento da validare, non come configurazione collaudata.

### 8.2 Sequenza standard

1. Aprire la change e registrare versione corrente, versione target e digest.
2. Verificare health, tasso errori, code RabbitMQ, spazio disco e stato backup.
3. Sospendere modifiche amministrative ai tenant durante la finestra.
4. Eseguire backup coerente di PostgreSQL e storage media. Se la release cambia la versione maggiore di PostgreSQL o la versione di RabbitMQ, aggiornarli ora, con §8.6 e §8.7.
5. Distribuire l'eventuale provider Keycloak compatibile; riavviare e verificare Keycloak. Se cambia anche la versione di Keycloak, seguire §8.5.
6. Se la release cambia il servizio OMR, distribuire la nuova immagine e verificare `GET /v1/health` dalla rete del backend; il servizio non ha stato e si sostituisce senza migration.
7. Avviare un'unica istanza backend target per applicare Liquibase.
8. Verificare `public.databasechangelog` e il changelog di ogni schema attivo.
9. Se le migration sono riuscite, distribuire tutte le repliche backend.
10. Distribuire frontend e invalidare solo la cache HTML/service worker necessaria.
11. Distribuire il sito informativo se incluso nella release.
12. Eseguire gli smoke test.
13. Osservare metriche e log per almeno una finestra operativa concordata.
14. Chiudere la change riportando esito, anomalie e versione effettiva.

I comandi della sequenza, per un'installazione con il manifest di riferimento, stanno nel [README del deploy](../deploy/README.md): primo insediamento, import del realm, aggiornamento.

Una volta sola, alla prima release che porta le code di scarto: `upload.files` e `score.recognition` cambiano argomenti e RabbitMQ non riapre una coda esistente con argomenti diversi, quindi il backend si fermerebbe all'avvio con `PRECONDITION_FAILED`. Con il backend fermo e le code vuote (ready e unacked a zero sulla console, o `rabbitmqctl list_queues name messages messages_unacknowledged`), cancellarle prima del punto 9 con `rabbitmqctl delete_queue upload.files` e `rabbitmqctl delete_queue score.recognition`; il backend le ricrea all'avvio con gli argomenti nuovi. Se un messaggio è ancora in coda non è una perdita di lavoro: il job resta nel database e la ripresa pianificata lo chiude in errore o lo ripubblica.

Una volta sola, alla prima release che porta la lettura del testo nel servizio OMR:

- le variabili del backend `SCORE_PLAYBACK_OMR_URL` e `SCORE_PLAYBACK_OMR_API_KEY` diventano `TAURUS_OMR_URL` e `TAURUS_OMR_API_KEY`: i nomi vecchi sono ignorati e senza i nuovi riconoscimento, caricamento MIDI e lettura del testo non vengono offerti. Il manifest di riferimento usa già i nomi nuovi;
- le proprietà `application.tesseract.*` non esistono più: un'installazione che le imposta, nel file di configurazione o con variabili `APPLICATION_TESSERACT_*`, va ripulita prima, altrimenti il backend non si avvia;
- il servizio OMR va aggiornato insieme al backend (punto 6): un servizio precedente risponde 404 alla lettura del testo e le parti scansionate restano senza suggerimenti.

Una volta sola, alla prima release con nginx senza privilegi, PostgreSQL 18 e RabbitMQ 4.4:

- nei container del frontend e del sito informativo nginx gira con l'utente `nginx` (uid 101) e ascolta sulla porta `8080`, non più sulla `80`. Il manifest di riferimento pubblica la `8080` del container sulla stessa porta dell'host di prima, quindi il proxy inverso non cambia; un compose o un proxy propri che puntano alla `80` del container vanno aggiornati;
- PostgreSQL passa dalla 17 alla 18 con un dump e un ripristino (§8.6), e il volume dei dati si monta su `/var/lib/postgresql`;
- RabbitMQ passa dalla 4.0 alla 4.4 con un nodo nuovo (§8.7), che da questa release ha un hostname fisso.

### 8.3 Verifica migration tenant

Elencare il registro globale:

```sql
SELECT tenant_code, schema_name, status, last_error, updated_at
FROM public.tenant_schema_registry
ORDER BY tenant_code;
```

Condizione di successo:

- nessun tenant attivo in stato di errore;
- nessun lock Liquibase persistente;
- lo stesso set di changeset atteso è applicato agli schemi attivi;
- il backend raggiunge readiness.

Non modificare manualmente `databasechangelog` o `databasechangeloglock` senza diagnosi e approvazione. Un lock può indicare una migration ancora in corso o interrotta.

### 8.4 Smoke test post-deploy

La parte automatizzabile è in `scripts/ops/smoke-test.sh`, che non scrive nulla e si esegue
subito dopo il deploy:

```bash
TAURUS_MANAGEMENT_URL=http://127.0.0.1:8080 scripts/ops/smoke-test.sh https://taurus.esempio.it
```

Controlla l'applicazione e il suo instradamento, la configurazione servita al browser (che non deve
contenere indirizzi di sviluppo), le intestazioni di sicurezza, i metadati del realm con il suo
issuer pubblico, il rifiuto di una richiesta API senza token e il fatto che gli endpoint di gestione
non siano raggiungibili dall'origine pubblica. Il resto dell'elenco resta a mano, perché richiede
un'identità vera e dati di collaudo:

- [ ] `GET /management/health` restituisce `200/UP`.
- [ ] `GET /management/info` risponde e identifica la build prevista.
- [ ] Login e logout funzionano con un utente non amministratore.
- [ ] Il token contiene ruoli e tenant attesi.
- [ ] Un utente vede solo i dati del proprio tenant.
- [ ] Un secondo tenant non può accedere allo stesso record/ID.
- [ ] Lettura e scrittura di una funzione core riuscite.
- [ ] Upload e download di un piccolo file riusciti.
- [ ] La coda `upload.files` viene consumata senza crescita anomala.
- [ ] Le feature abilitate/disabilitate coincidono con la configurazione tenant.
- [ ] Il feed calendario e il QR usano URL pubblici HTTPS corretti, se abilitati.
- [ ] Registrazione Web Push e invio di prova riusciti, se abilitati.
- [ ] Ascolto delle parti, se abilitato: il lettore di una parte di prova si apre e suona; con il servizio OMR configurato un riconoscimento di prova termina e la coda `score.recognition` resta vuota.
- [ ] Il frontend non presenta errori di CORS, mixed content o service worker.
- [ ] `/health` del sito informativo restituisce `200`, se rilasciato.

Usare dati di collaudo dedicati ed eliminarli secondo le regole applicative, evitando cancellazioni SQL dirette.

### 8.5 Aggiornamento di Keycloak

La versione di Keycloak è `TAURUS_KEYCLOAK_VERSION` in `.env`, o il valore predefinito di `deploy/compose.yml`. Il provider è compilato per una versione precisa di Keycloak (`keycloak.version` nel `pom.xml` di `keycloak-authenticator`) e per la JVM della sua immagine: immagine e JAR cambiano insieme, e il JAR è quello della stessa release di Taurus.

All'avvio la versione nuova aggiorna lo schema del database `taurus_keycloak`, e Keycloak non supporta il ritorno a una versione precedente sullo stesso database. L'unico ritorno indietro è il backup preso prima.

1. Fare il backup di `taurus_keycloak` (§12.2) e copiare il contenuto di `keycloak/providers/`.
2. Fermare Keycloak: `docker compose --env-file .env -f compose.yml stop keycloak`. Il login resta indisponibile fino al punto 5. Il manifest di riferimento ha un'istanza sola; con più istanze si fermano tutte prima di avviare la versione nuova.
3. Sostituire in `keycloak/providers/` il JAR con `keycloak-authenticator-<versione>.jar` della release, dopo averne controllato l'impronta con il file `.sha256` che lo accompagna. Aggiornare `TAURUS_KEYCLOAK_VERSION`.
4. `docker compose --env-file .env -f compose.yml pull keycloak`, poi `up -d keycloak`. Con `start` Keycloak ricostruisce la configurazione all'avvio, perché provider e versione sono cambiati: il primo avvio è più lento.
5. Nel log di Keycloak verificare la versione nuova e il caricamento di `tenant-role-selector-authenticator`, `tenant-role-mapper` e `taurus-otp`. Gli avvisi `KC-SERVICES0047`, che dicono che questi provider usano SPI interne, sono attesi.
6. Subito dopo l'avvio, prima di chiudere la change: smoke test (§8.4), login di un utente non amministratore con la scelta di tenant e ruolo, codice dell'app di autenticazione se configurata, e un'e-mail di reimpostazione della password ricevuta con il tema Taurus.

**Ritorno indietro.** Fermare Keycloak, ripristinare il dump del punto 1 in un database `taurus_keycloak` vuoto (§12.4), rimettere il JAR e la versione precedenti e riavviare. Le modifiche fatte in Keycloak dopo l'aggiornamento, come utenti creati, password cambiate e app di autenticazione configurate, vanno perse: per questo la verifica del punto 6 si fa subito.

### 8.6 Aggiornamento di PostgreSQL a una nuova versione maggiore

La versione di PostgreSQL è `TAURUS_POSTGRES_VERSION` in `.env`, o il valore predefinito di `deploy/compose.yml`. Una patch, per esempio dalla 18.6 alla 18.7, si applica cambiando il tag. Una maggiore no: la 18 non legge i file dei dati della 17. Il container della 18 si rifiuta di partire su un volume della 17, con `Error: in 18+, these Docker images are configured to store database data in a format which is compatible with "pg_ctlcluster"`, e non lo modifica. Si passa con un dump di tutto il cluster, preso dalla versione vecchia, e un ripristino nella nuova, con Keycloak e il backend fermi: i database `taurus` e `taurus_keycloak`, i ruoli e le loro password passano insieme.

Dalla 18 l'immagine tiene i dati in `/var/lib/postgresql/18/docker`, e il volume va montato su `/var/lib/postgresql`, non più su `/var/lib/postgresql/data`. Il manifest della release che porta la 18 lo monta già così, e `scripts/ops/validate-deploy-manifest.sh` lo controlla.

I comandi si eseguono dalla cartella `deploy/`, con `alias dc='docker compose --env-file .env -f compose.yml'`. Il volume dei dati si chiama `taurus_taurus-db` (`docker volume ls`).

1. Fare il backup dei due database (§12.2). Il disco deve avere libero almeno il doppio dello spazio del volume, per il dump e per la copia del volume del punto 4 (`docker system df -v`).
2. Fermare chi scrive: `dc stop frontend backend keycloak`. Applicazione e login restano indisponibili fino al punto 9.
3. Fare il dump dell'intero cluster con la versione ancora in uso:

   ```bash
   dc exec -T postgresql sh -c 'pg_dumpall --clean --if-exists -U "$POSTGRES_USER"' > taurus-pg17-<UTC_TIMESTAMP>.sql
   tail -n 3 taurus-pg17-<UTC_TIMESTAMP>.sql
   ```

   L'ultima riga di commento deve essere `-- PostgreSQL database cluster dump complete`: se manca, il dump è troncato e non si prosegue. Il file contiene le impronte delle password dei ruoli: va trattato come un backup e cancellato alla scadenza della retention.
4. Mettere da parte il volume della 17, che è il ritorno indietro:

   ```bash
   dc stop postgresql
   docker volume create taurus-db-pg17
   docker run --rm -v taurus_taurus-db:/from:ro -v taurus-db-pg17:/to postgres:17.0 cp -a /from/. /to/
   dc rm -f postgresql
   docker volume rm taurus_taurus-db
   ```

   `postgres:17.0` è l'immagine già presente sull'host; `cp -a` conserva proprietari e permessi dei file.
5. Portare `deploy/` alla release nuova, con il montaggio su `/var/lib/postgresql`. Se `TAURUS_POSTGRES_VERSION` è fissata in `.env`, aggiornarla. Poi `dc pull postgresql`.
6. `dc up -d --wait postgresql`. Il cluster nuovo nasce sul volume vuoto, con l'utente e il database di `.env` e il database di Keycloak di `initdb/`.
7. Ripristinare il dump:

   ```bash
   dc exec -T postgresql sh -c 'psql -U "$POSTGRES_USER" -d postgres' < taurus-pg17-<UTC_TIMESTAMP>.sql > ripristino.log 2>&1
   grep -E 'ERROR|FATAL' ripristino.log
   ```

   Gli errori attesi sono due, tutti e due sul ruolo che esegue il ripristino, che esiste già: `current user cannot be dropped` e `role "taurus" already exists`. Il dump cancella e ricrea i due database e il ruolo di Keycloak, con la password di prima. Qualsiasi altro errore ferma la procedura: si torna indietro.
8. Ricalcolare le statistiche, che il dump non porta: `dc exec postgresql sh -c 'vacuumdb -U "$POSTGRES_USER" --all --analyze-in-stages'`.
9. Prima di riaprire, verificare la versione (`select version()`) e che il numero degli schemi dei tenant e delle righe di `databasechangelog` sia quello di prima del punto 3: sono le query di `scripts/ops/restore-test.sh`. Poi `dc up -d`, gli smoke test (§8.4) e un accesso con la scelta di tenant e ruolo.
10. Dopo il periodo di esercizio fissato nella change, per esempio una settimana, `docker volume rm taurus-db-pg17`. Il dump resta con i backup, per la loro retention.

**Ritorno indietro.** Si fa subito, se la verifica del punto 9 fallisce:

```bash
dc stop
dc rm -f postgresql
docker volume rm taurus_taurus-db
```

Rimettere i file di `deploy/` della release precedente, con il montaggio su `/var/lib/postgresql/data`, e `TAURUS_POSTGRES_VERSION=17.0`, poi:

```bash
dc up --no-start postgresql
docker run --rm -v taurus-db-pg17:/from:ro -v taurus_taurus-db:/to postgres:17.0 cp -a /from/. /to/
dc up -d
```

`up --no-start` crea il volume come lo vuole Compose, vuoto, e la copia lo riporta allo stato del punto 4. Le scritture fatte sulla 18 dopo la riapertura vanno perse: per questo la verifica del punto 9 si fa prima di riaprire il traffico.

Per l'ambiente di sviluppo vedi §5.5.

### 8.7 Aggiornamento di RabbitMQ

La versione di RabbitMQ è `TAURUS_RABBITMQ_VERSION`. Le code di Taurus non sono un archivio (§12.1): contengono lavori che il database ricorda e che la ripresa pianificata chiude o ripubblica (§14.6). L'aggiornamento quindi non porta con sé il nodo: si lasciano svuotare le code, si ferma il nodo e se ne avvia uno nuovo, vuoto, con la versione nuova. All'avvio il backend dichiara di nuovo code, exchange e binding, e l'utente arriva da `.env`.

Il nodo non si aggiorna per due motivi. La documentazione di RabbitMQ non ammette il salto dalla 4.0 alla 4.4: dalla 4.0 e dalla 4.1 si passa prima per la 4.2. Inoltre, fino alla release che porta la 4.4, il manifest non fissava l'hostname del container. Il nodo prende il nome dall'hostname, quindi si chiamava come il container (`rabbit@<id>`), e ogni container ricreato apriva un nodo vuoto nello stesso volume. Da quella release il servizio ha `hostname: rabbitmq`, il nodo si chiama `rabbit@rabbitmq` e si ritrova quando il container viene ricreato. Negli aggiornamenti successivi si potrà quindi seguire il percorso di versioni della documentazione, dopo aver abilitato tutti i feature flag stabili (`rabbitmqctl enable_feature_flag all`).

1. In un momento di poco traffico, controllare le code: `dc exec rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged`. Si prosegue quando `upload.files` e `score.recognition` sono a zero. Le code di scarto `.dead` non si svuotano da sole: se contengono messaggi, leggerli prima (§14.6), perché il nodo nuovo parte senza. Se sull'installazione sono stati aggiunti a mano utenti, vhost o policy, esportarli con `dc exec rabbitmq rabbitmqctl export_definitions /tmp/definizioni.json` e copiarli fuori con `dc cp rabbitmq:/tmp/definizioni.json .`.
2. Fermare chi produce e chi consuma: `dc stop frontend backend`. Ricontrollare le code. Un messaggio rimasto non è un lavoro perso: il job resta nel database, e la ripresa pianificata lo chiude in errore, con «Riprova» per l'utente, o lo ripubblica.
3. Togliere il nodo vecchio:

   ```bash
   dc stop rabbitmq
   dc rm -f rabbitmq
   docker volume rm taurus_taurus-rabbit
   ```

4. Portare `deploy/` alla release nuova e, se `TAURUS_RABBITMQ_VERSION` è fissata in `.env`, aggiornarla. Poi `dc pull rabbitmq` e `dc up -d --wait rabbitmq`. Se al punto 1 sono state esportate delle definizioni, reimportarle ora con `rabbitmqctl import_definitions`.
5. Verificare la versione (`dc exec rabbitmq rabbitmqctl version`), poi `dc up -d`. Dopo l'avvio del backend, `list_queues` mostra `upload.files`, `score.recognition` e le due code `.dead`. Chiudere con gli smoke test (§8.4), compreso il caricamento di un file.

**Ritorno indietro.** È la stessa procedura, all'indietro: code vuote, frontend e backend fermi, nodo e volume tolti come al punto 3, i file di `deploy/` e `TAURUS_RABBITMQ_VERSION` della release precedente, `dc up -d`. RabbitMQ non supporta il ritorno a una versione precedente sugli stessi dati, quindi anche qui il nodo riparte vuoto.

## 9. Rollback

### 9.1 Solo applicazione, senza migration incompatibili

1. Fermare il rollout.
2. Riportare frontend e backend ai digest precedenti, e il servizio OMR alla versione precedente se era cambiato.
3. Ripristinare l'eventuale provider Keycloak precedente. Se la release aveva cambiato anche la versione di Keycloak, il provider da solo non basta: il ritorno indietro è quello di §8.5. Allo stesso modo, se aveva cambiato la versione maggiore di PostgreSQL o la versione di RabbitMQ, i ritorni indietro sono quelli di §8.6 e §8.7.
4. Verificare health, login, tenant isolation, coda e storage.
5. Lasciare aperto l'incidente e conservare log e artefatti.

Per un problema limitato all'ascolto delle parti basta disattivare la funzionalità `SCORE_PLAYBACK` (§4.4), per il tenant o per l'installazione: tabelle, versioni e file restano disponibili per la riattivazione.

### 9.2 Con migration database

Le migration Liquibase non vanno annullate automaticamente. Preferire, in ordine:

1. forward fix compatibile;
2. rollback dell'app solo se il vecchio codice è compatibile con lo schema nuovo;
3. restore di database **e storage media** allo stesso punto temporale, se la modifica è incompatibile o distruttiva.

Un restore del solo database può lasciare record che puntano a file assenti o file orfani. Durante un restore completo bloccare le scritture, ripristinare entrambi gli insiemi e poi riavviare i consumer.

### 9.3 Criteri di rollback immediato

- isolamento tenant violato o non dimostrabile;
- autenticazione indisponibile senza workaround controllato;
- errori di migration su uno o più tenant;
- corruzione/perdita dati o storage non montato;
- aumento sostenuto di errori 5xx oltre la soglia approvata;
- backlog RabbitMQ in crescita senza consumo;
- incompatibilità frontend/backend bloccante.

## 10. Monitoraggio e osservabilità

### 10.1 Endpoint backend

| Endpoint | Uso | Accesso |
| --- | --- | --- |
| `/management/health` | Stato generale | Pubblico, dettagli limitati |
| `/management/health/liveness` | Processo vivo | Pubblico |
| `/management/health/readiness` | Pronto al traffico | Pubblico |
| `/management/info` | Informazioni build | Pubblico |
| `/management/prometheus` | Metriche Prometheus | Authority prevista dalla security; non esporre su Internet |
| `/management/loggers` | Livelli log runtime | Amministrativo |
| `/management/liquibase` | Changeset | Amministrativo |
| `/management/threaddump` | Diagnosi thread | Amministrativo e sensibile |

Nel profilo `prod` l'Actuator espone solo `health`, `info` e `prometheus`: `env`, `configprops`, `loggers`, `logfile`, `threaddump`, `jhimetrics` e `liquibase` restano disponibili in sviluppo e fuori dalla produzione, dove raccontano configurazione e segreti a chi li raggiunge. Le due righe che restano — `env` e `configprops` — sono comunque configurate per non stampare i valori. `/management` non è inoltrato dal container del frontend, quindi dall'origine pubblica risponde `404`: le probe e Prometheus lo raggiungono dalla rete interna. Lo smoke test di §8.4 verifica entrambe le cose.

### 10.2 Segnali minimi e allarmi

Definire soglie specifiche per ambiente e almeno i seguenti alert:

- readiness non `UP`;
- tasso 5xx e latenza p95/p99;
- esaurimento pool JDBC;
- connessioni o storage PostgreSQL prossimi al limite;
- spazio/inode del filesystem media;
- backlog e messaggi non confermati sulle code `upload.files` e `score.recognition`;
- messaggi nelle code di scarto `upload.files.dead` e `score.recognition.dead`: ogni messaggio è un lavoro che il consumatore ha rifiutato e che nessuno riprenderà dalla coda, da analizzare e svuotare a mano;
- riconoscimenti terminati con errore (`taurus_score_recognition_jobs_total` con `outcome` diverso da `done`) e servizio OMR non `UP`;
- invii falliti dei codici e dei link di firma (`taurus_signature_mail_total` con `outcome` diverso da `sent`, `taurus_signature_links_total{outcome="mailFailed"}`) e catene delle prove non coerenti (`signature_chain_inconsistent` nel log);
- firme CieSign rifiutate per certificato non attendibile (`taurus_signature_ciesign_total{outcome="untrustedCertificate"}`) o accettate senza controllo di revoca (`outcome="acceptedRevocationUnavailable"`) in crescita costante: certificati della CIE da aggiornare o CRL non raggiungibile;
- consumer RabbitMQ assenti;
- Keycloak non raggiungibile o incremento errori OIDC;
- tenant in stato diverso da `ACTIVE` con `last_error` valorizzato;
- errori ripetuti degli scheduler;
- modifiche delle immagini delle pagine respinte dal limite di tempo (`taurus_image_edit_total{outcome="image.timeout"}`) o dal pool pieno (`outcome="image.busy"`): rendering troppo lento per l'hardware o richieste troppo grandi, da leggere insieme ai percentili di `taurus_image_edit_duration_seconds` e alle distribuzioni di pixel e byte;
- compensazioni storage delle immagini (`taurus_image_storage_compensations_total`) in crescita: un salvataggio sta fallendo dopo la scrittura degli asset, che vengono rimossi ma segnalano un problema di database o di storage;
- valutazioni della preparazione evento fallite (`event_preparation_evaluation_failed` nel log) e conflitti di versione in crescita costante (`taurus_event_preparation_command_total{outcome="conflict"}`): più persone salvano la stessa sezione, oppure una pagina rimasta aperta a lungo continua a inviare versioni superate;
- crescita di notification outbox/push fallite;
- certificati TLS e chiavi in scadenza;
- backup fallito o restore test scaduto.

### 10.3 Telemetria d'uso dell'interfaccia

Il frontend conta gli eventi d'uso di una funzione, li aggrega nel browser e li spedisce in un'unica richiesta a `POST /api/ux-telemetry` al salvataggio e alla chiusura della pagina. Il backend li traduce nel contatore `taurus.ux.events{feature,event}` e nel timer `taurus.ux.session.duration{feature}`: oggi l'unica funzione misurata è `track-parts-workspace`, con gli eventi `open`, `search`, `reorder`, `move`, `merge`, `split`, `undo`, `save`, `save-error`, `conflict` e `reload`.

La misura non lascia l'installazione e non contiene contenuti: né nomi di parti o di file, né testi cercati, né identificativi di tracce. Le etichette arrivano da un browser, quindi la funzione deve essere fra quelle note e il nome dell'evento deve avere la forma di un identificativo; numero di eventi, conteggi e durata sono limitati. Una segnalazione scartata riceve comunque `204`, perché una misura vale meno del lavoro di chi sta usando l'applicazione: un `204` non garantisce che la segnalazione sia stata registrata. Le serie sono utili per confrontare il tempo dalla prima apertura al salvataggio e il numero di operazioni per sessione; non sono un allarme.

### 10.4 Modifica delle immagini delle pagine

Analisi e salvataggio delle pagine espongono il prefisso `taurus.image.`: contatori e timer per esito (`done`, `replayed`, `error` o la chiave dell'errore), distribuzioni di pixel e byte in ingresso e in uscita, tipi di trasformazione applicati, conflitti distinti per genere (versione superata, chiave riusata con un'altra ricetta, ricevuta non più attuale) e asset recuperati dalla compensazione. Le etichette sono chiuse: nessun nome di parte, file o tenant, e nessuna coordinata della ricetta.

Il rendering gira su un pool dedicato, fuori da ogni transazione, con il limite di tempo di `application.media.image-edit-timeout-seconds` (30 secondi): oltre il limite la richiesta risponde `503` e non scrive nulla, quindi non lascia asset o ricevute a metà. Alzare il limite ha senso solo con pagine molto grandi e hardware lento; abbassarlo rende più frequenti i `503` su pagine legittime. I log di analisi e salvataggio correlano schema del tenant, traccia, parte, media sorgente, media risultanti, versione e primi dodici caratteri dell'impronta della richiesta: bastano a ricostruire un tentativo senza registrarne il contenuto.

### 10.5 Log

Il profilo `prod` usa livello `INFO` e scrive una riga JSON per evento su `stdout`
(`jhipster.logging.use-json-format`), con Logstash disabilitato. Ogni riga porta i campi del
contesto, che sono quelli con cui si ricostruisce un guasto:

| Campo | Da dove viene | A cosa serve |
| --- | --- | --- |
| `requestId` | `RequestCorrelationFilter`, dall'intestazione `X-Request-Id` del proxy o generato | Collega le righe della stessa richiesta, anche fra repliche e thread diversi; torna al chiamante nella stessa intestazione |
| `tenant` | `TenantContextInterceptor`, dal token | Dice di quale associazione è il guasto |
| `app_name`, `app_port` | `LoggingConfiguration` | Distinguono le istanze |

Il reverse proxy dell'host inoltra `X-Request-Id` (l'esempio in `deploy/reverse-proxy.example.conf`
lo fa): così la stessa richiesta ha lo stesso identificativo nei log del proxy e in quelli
dell'applicazione, e la segnalazione di un utente — che quell'identificativo lo legge nella risposta
— si ritrova nei log.

L'utente non compare nei log: chi ha fatto cosa sta nelle tabelle di audit, dove il dato è protetto e
cancellabile. La raccolta appartiene all'host, che deve acquisire `stdout/stderr`, aggiungere
l'identità del container e applicare una retention dichiarata.

Non registrare token, password, contenuto dei file, chiavi VAPID o dati personali completi. Un aumento temporaneo del livello log va annotato e ripristinato al termine della diagnosi.

## 11. Job pianificati

Gli orari cron senza `zone` esplicita usano il timezone del processo JVM. Impostare e documentare il timezone del container oppure configurare una zona esplicita.

| Job | Frequenza predefinita | Scopo |
| --- | --- | --- |
| Promemoria eventi Web Push | ogni minuto | Invia reminder dovuti per tenant |
| Dispatch notification outbox | ogni 5 s | Materializza notifiche pendenti |
| Dispatch push | ogni 5 s | Invia consegne push con retry |
| Recovery onboarding | ogni 2 s | Riprende import caricati/interrotti |
| Retention dati | 03:00 giornaliero | Elimina dati oltre retention per tenant |
| Cleanup media | 03:30 giornaliero | Elimina temporanei e orfani per tenant |
| Cleanup outbox | 03:30 giornaliero | Elimina eventi consegnati scaduti |
| Cleanup tombstone feed | 03:15 giornaliero | Elimina tombstone calendario scadute |
| Avvisi scadenza inventario | 08:00 Europe/Rome | Genera notifiche scadenze |
| Rollover economia | 00:10 Europe/Rome | Aggiorna saldi/aperture annuali |
| Scadenze preparazione evento | ogni minuto Europe/Rome | Genera notifiche operative e quelle delle conferme materiali non più valide |
| Recupero riconoscimenti | ogni minuto | Rimette in coda i riconoscimenti interrotti da oltre 30 minuti (al massimo tre tentativi) e ripubblica quelli in coda da oltre 30 minuti |
| Pulizia versioni delle parti | 04:15 giornaliero | Elimina le versioni oltre le ultime 20 di ogni parte che non sono correnti né approvate |
| Pulizia conferme di firma | 03:45 giornaliero | Elimina per tenant le conferme con codice chiuse da oltre 30 giorni (`application.signature.cleanup-cron`, `challenge-retention-days`) |
| Eliminazione atti firmati | 03:50 giornaliero | Elimina per tenant documenti, attestazioni e dati personali delle prove degli atti dei fogli definiti o annullati da oltre il periodo di grazia (`application.signature.purge-cron`, `download-grace-days`) |
| Link di firma scaduti | ogni ora al minuto 20 | Notifica una volta agli amministratori i link dei genitori scaduti senza firma e rimuove dal registro pubblico le righe dei link revocati o scaduti (`application.signature.link-expiry-cron`) |
| Conservazione dei fogli di affidamento | 03:15 Europe/Rome | Definisce per tenant i fogli chiusi senza addebiti da oltre `application.inventory.loan-sheet.auto-settle-days` (30), eliminandone dati personali e PDF (`application.inventory.loan-sheet.settle-cron`) |
| Conservazione degli import di onboarding | 04:30 Europe/Rome | Elimina per tenant file, righe e problemi degli import conclusi da oltre `source-retention-days` (30) ed elimina i job dopo `audit-retention-days` (365) (`application.onboarding.cleanup-cron`) |

Fogli di affidamento, firma elettronica e onboarding applicano la conservazione a tutti i tenant attivi, anche quando la funzionalità è disattivata per il tenant. Il primo passaggio della conservazione dell'onboarding dopo l'aggiornamento elimina subito i dati degli import conclusi da oltre 30 giorni.

In una distribuzione con più repliche, verificare il comportamento concorrente di ogni scheduler. Il repository non mostra un coordinatore distribuito generale: prima di scalare il backend oltre una replica, validare idempotenza e locking o assegnare i job a una sola replica.

## 12. Backup e restore

### 12.1 Perimetro obbligatorio

Il backup completo comprende:

- database PostgreSQL `taurus`, inclusi `public` e tutti gli schemi tenant;
- database Keycloak `taurus_keycloak`;
- filesystem configurato da `APPLICATION_BASE_PATH`, che contiene anche i file MusicXML delle versioni delle parti, salvati come media;
- realm/configurazione Keycloak esportabile, provider JAR e temi;
- manifest e configurazioni non segrete della release;
- riferimenti ai segreti e alle relative versioni, non i segreti in chiaro nel repository;
- digest delle immagini distribuite.

RabbitMQ non deve essere usato come archivio. Per ottenere un punto coerente, fermare temporaneamente producer/consumer oppure usare una strategia applicativa validata che gestisca i messaggi in volo.

### 12.2 Esempio backup PostgreSQL

Eseguire da un host protetto, usando `.pgpass` o secret injection e una directory specifica già verificata:

```bash
pg_dump --format=custom --no-owner --file=taurus_<UTC_TIMESTAMP>.dump "$TAURUS_DATABASE_URL"
pg_dump --format=custom --no-owner --file=taurus_keycloak_<UTC_TIMESTAMP>.dump "$KEYCLOAK_DATABASE_URL"
```

Calcolare checksum, cifrare lato storage, copiare fuori dal dominio di guasto e registrare dimensione, durata ed esito. Non dichiarare riuscito un backup solo perché il comando ha creato un file.

### 12.3 Backup storage media

Usare snapshot consistente o copia incrementale del volume `APPLICATION_BASE_PATH`. Coordinare il punto temporale con il database. Escludere solo temporanei documentati; non dedurre gli orfani durante il backup.

### 12.4 Restore di prova

La parte del database è automatizzata da `scripts/ops/restore-test.sh`: fa il backup dell'istanza indicata dalle variabili `PG*`, la ripristina in un container temporaneo, confronta il numero di schemi tenant e di migrazioni applicate con l'origine e stampa durata del backup, durata del ripristino e dimensione del dump — i tre numeri da registrare come misura di RPO e RTO. L'origine non viene mai toccata e il container di prova viene eliminato alla fine.

```bash
PGHOST=... PGPORT=5432 PGUSER=taurus PGPASSWORD=... PGDATABASE=taurus scripts/ops/restore-test.sh
```

Lo script va programmato sull'host che raggiunge il database: la CI non lo raggiunge. Copre il solo database Taurus, quindi i passi su Keycloak, storage media e applicazione restano da eseguire con la procedura seguente, almeno con la frequenza prevista dalla policy:

1. creare un ambiente isolato;
2. ripristinare i due database su istanze vuote;
3. ripristinare lo storage media allo stesso punto;
4. distribuire la versione applicativa associata al backup;
5. avviare Keycloak e poi il backend;
6. verificare schema registry, Liquibase e health;
7. eseguire login, lettura tenant, download media e consumo di un job controllato;
8. misurare RPO/RTO effettivi;
9. eliminare in sicurezza l'ambiente di prova.

Esempio su database vuoto:

```bash
pg_restore --exit-on-error --no-owner --dbname="$RESTORE_TAURUS_DATABASE_URL" taurus_<UTC_TIMESTAMP>.dump
pg_restore --exit-on-error --no-owner --dbname="$RESTORE_KEYCLOAK_DATABASE_URL" taurus_keycloak_<UTC_TIMESTAMP>.dump
```

Non usare questi comandi contro un database esistente senza un piano esplicito di pulizia e approvazione.

## 13. Operazioni tenant

### 13.1 Provisioning

La creazione tramite `POST /api/tenants`:

1. registra il tenant in `public`;
2. genera uno schema fisico sicuro;
3. applica `tenant-master.xml`;
4. copia eventuali dati legacy in modo idempotente;
5. porta il registro a `ACTIVE`;
6. crea il gruppo Keycloak con lo stesso codice e vi associa i super amministratori, impostando su ciascuno l'attributo `<codice>_roles`.

Verificare registro, log e presenza delle tabelle Liquibase nello schema. Il ruolo DB deve avere `CREATE` sul database e `USAGE, CREATE` su `public`; in produzione separare per quanto possibile privilegi di migration e runtime.

### 13.2 Provisioning fallito

1. Non creare manualmente un secondo schema.
2. Leggere `status` e `last_error` nel registro.
3. Correlare l'errore con i log Liquibase/backend.
4. Correggere la causa: permessi, lock, spazio o changeset.
5. Riavviare/ripetere solo il flusso idempotente previsto dall'applicazione.
6. Verificare che il tenant diventi `ACTIVE` e sia isolato.

### 13.3 Cancellazione GDPR

La cancellazione tenant pianifica `DROP SCHEMA ... CASCADE` dopo il commit e porta il registro a `DELETED`. È distruttiva.

Prima dell'azione:

- validare identità e autorizzazione del richiedente;
- identificare esattamente tenant e impatto;
- applicare retention/hold legale;
- creare l'eventuale backup autorizzato;
- verificare che non si stia operando sul tenant errato.

Dopo l'azione verificare stato `DELETED`, assenza dello schema e rimozione/anonimizzazione dei file previsti. Non ricreare manualmente lo stesso tenant per simulare un restore.

### 13.4 Cancellazione dei dati di un utente

Il completamento di una pratica di cancellazione dell'account e la retention pianificata eliminano i dati personali dell'utente nel tenant, comprese le sue segnalazioni d'errore sulle parti, perché il testo è scritto da lui. I fogli di affidamento e gli atti firmati elettronicamente del socio sono eliminati al completamento della pratica oppure, se non ha materiale in carico, subito con la cancellazione: prima di confermarla conviene scaricare i fascicoli dei suoi fogli. Le versioni delle parti che ha corretto restano, perché fanno parte dell'archivio musicale.

## 14. Procedure di incidente

### 14.1 Metodo comune

1. Dichiarare severità e incident commander.
2. Annotare in UTC inizio, versione, ambiente e sintomo.
3. Contenere l'impatto senza cancellare prove.
4. Verificare cambi recenti prima di riavviare indiscriminatamente.
5. Conservare log, metriche, eventi orchestrator e query diagnostiche.
6. Applicare workaround/rollback approvato.
7. Confermare recupero con smoke test e metriche.
8. Comunicare stato e impatto con cadenza concordata.
9. Chiudere con timeline, causa radice e azioni correttive.

### 14.2 Backend non disponibile

Diagnosi:

- interrogare liveness e readiness separatamente;
- controllare eventi di restart/OOM e log di startup;
- verificare PostgreSQL, Keycloak, RabbitMQ e mount dello storage;
- cercare errori Liquibase o pool JDBC.

Azione:

- se liveness fallisce, riavviare una sola istanza dopo aver raccolto le prove;
- se readiness fallisce per dipendenza, ripristinare prima la dipendenza;
- se il problema coincide con un deploy, applicare i criteri di rollback;
- non scalare repliche se il DB è saturo o se gli scheduler non sono coordinati.

### 14.3 PostgreSQL indisponibile o saturo

- verificare reachability, connessioni, spazio, I/O, replica e lock;
- bloccare deploy e operazioni tenant;
- ridurre traffico solo tramite meccanismi previsti;
- non terminare query o sessioni senza identificare owner e transazione;
- dopo il recupero verificare Liquibase, registro tenant e integrità funzionale.

In caso di perdita dati attivare la procedura DR e ripristinare database e media allo stesso punto.

### 14.4 Lock o errore Liquibase

- assicurarsi che nessuna migration sia ancora attiva;
- identificare istanza, changeset e schema interessato;
- acquisire dump e log;
- non modificare checksum o lock a mano durante un'esecuzione attiva;
- correggere il changeset con una nuova migration se già rilasciato;
- rimuovere un lock orfano solo con approvazione DB e prova che il processo originario è terminato.

### 14.5 Login/Keycloak non funzionante

- verificare health e certificato di Keycloak;
- confrontare issuer del token, URL pubblico, realm e client ID;
- verificare redirect URI e web origins;
- controllare connessione al database `taurus_keycloak`;
- verificare caricamento e compatibilità del provider custom;
- escludere clock skew tra browser, backend e Keycloak;
- su un ambiente appena resettato verificare gruppo, attributo `<gruppo>_roles` e ruolo client del super amministratore (§5.2).

Non bypassare OIDC e non distribuire client secret nel frontend.

### 14.6 RabbitMQ o upload bloccati

- verificare connessione del backend e presenza di consumer su `upload.files`;
- osservare ready/unacked, publish rate e redelivery;
- verificare spazio/memoria e allarmi RabbitMQ;
- controllare nei log `queueId`/`jobId`, `trackId`, stato e tenant senza esporre contenuto sensibile;
- confrontare stato e anzianità dei record `upload_job`: molti `TO_PROCESS` indicano in genere una coda o un consumer indisponibile, mentre `IN_PROGRESS` oltre soglia richiede la verifica del worker, delle risorse PDF e dello storage. Le stesse grandezze sono su `taurus.upload.jobs.pending`, `taurus.upload.jobs.oldest.age` e `taurus.upload.queue.messages`, che vale `-1` quando il broker non risponde;
- un job fermo oltre `application.upload.stale-after` (trenta minuti) viene chiuso in `ERROR` dal recupero pianificato e l'utente lo vede con «Riprova»: i contatori sono `taurus.upload.jobs{operation="CLOSED_STALE"}` e `taurus.upload.failures{reason="STALE_WORKER"|"STALE_QUEUE"}`. Il contatore `LATE` segnala invece un'elaborazione conclusa su un job già chiuso, cioè una soglia troppo stretta: in quel caso le parti sono state create e un nuovo tentativo le duplicherebbe;
- per un job in `ERROR`, conservare il file sorgente e usare il retry applicativo solo dopo aver escluso un consumer ancora attivo sullo stesso job;
- leggere `upload.files.dead`: i messaggi rifiutati finiscono lì, con il `jobId` nel corpo, e indicano un errore ripetibile del consumatore invece di una coda ferma;
- non eliminare o requeue massivamente i messaggi senza valutarne l'idempotenza; dalla coda di scarto si riparte dal job nel database, non rimettendo il messaggio nella coda di lavoro;
- sospendere nuovi upload se il backlog continua a crescere.

Per la coda `score.recognition` seguire il §14.9.

### 14.7 Storage media pieno o non disponibile

- mettere in pausa upload e operazioni che scrivono file;
- verificare mount, permessi, spazio e inode;
- non lanciare manualmente una cancellazione ricorsiva;
- controllare esito del cleanup pianificato e riferimenti DB;
- espandere/ripristinare il volume;
- validare upload, download e isolamento del path tenant.

### 14.8 Notifiche o Web Push degradati

- verificare feature flag globali e tenant;
- controllare corrispondenza della coppia VAPID;
- osservare outbox, consegne `FAILED/SKIPPED`, retry e subscription invalide;
- verificare HTTPS e service worker del frontend;
- usare la console amministrativa di delivery per retry/chiusura controllati;
- evitare retry massivi finché la causa esterna persiste.

### 14.9 Riconoscimento delle parti lento o fallito

- verificare `GET /v1/health` del servizio OMR dalla rete del backend e che `TAURUS_OMR_API_KEY` abbia lo stesso valore nel servizio e nel backend: con chiavi diverse ogni job termina con `serviceUnavailable`;
- leggere il codice d'errore dei job (`score_recognition_job.error_code`) e i log del backend per `jobId`, parte e tenant: `serviceUnavailable` indica servizio fermo o irraggiungibile, `engineFailed` ed `engineTimeout` un motore fallito su quelle pagine, che resta ripetibile con «Riprova»;
- nei log del servizio ogni riconoscimento riporta pagine, esito e durata di ciascun motore; con la concorrenza predefinita le richieste attendono il proprio turno e oltre il tempo massimo rispondono `busy`, che il backend registra come `serviceUnavailable`;
- verificare CPU, memoria e `/tmp` del container: Audiveris e homr insieme usano fino a 4 CPU e alcuni GB di memoria per pagina;
- i job interrotti vengono rimessi in coda dal recupero pianificato (§11), al massimo tre volte, poi terminano con `interrupted`: non ripubblicare a mano i messaggi;
- se un motore peggiora dopo un aggiornamento, tornare alla versione precedente dell'immagine con `TAURUS_OMR_VERSION` e misurare di nuovo l'accuratezza (§4.6);
- parti dei PDF scansionati senza strumenti suggeriti: il backend registra al massimo un avviso per caricamento con il motivo (servizio non raggiungibile, chiave rifiutata, `busy`, `engineTimeout`, 404 da un servizio non aggiornato); il caricamento termina comunque `DONE` e gli strumenti si assegnano a mano. Nei log del servizio ogni lettura riporta pagine, righe lette e durata, mai il testo; il testo letto compare nel backend solo a livello debug.

### 14.10 Sospetta violazione tenant o sicurezza

Classificare come incidente critico:

1. contenere l'accesso e fermare il rollout;
2. preservare audit log, token metadata e query coinvolte;
3. non cancellare tenant, schemi o utenti come prima risposta;
4. coinvolgere owner sicurezza e privacy;
5. verificare claim `tenant`, `TenantContext` e schema effettivo;
6. ruotare credenziali/chiavi solo con piano che preservi le prove;
7. seguire gli obblighi di notifica applicabili.

## 15. Sicurezza e rotazioni

### 15.1 Controlli minimi

- TLS pubblico obbligatorio per SPA, API, Keycloak e feed;
- rete privata per PostgreSQL, RabbitMQ e Actuator amministrativo;
- nessun `start-dev` Keycloak in produzione;
- password e account predefiniti rimossi;
- backup cifrati e accesso tracciato;
- immagini scansionate e firme Cosign verificate;
- privilegi DB e Keycloak minimi;
- CSP e header del sito informativo verificati a ogni modifica;
- limite upload da 500 MB rivalutato a livello reverse proxy e capacità;
- dati OCR/PDF trattati come contenuto non fidato;
- file MusicXML e MIDI caricati trattati come contenuto non fidato: DTD ed entità esterne disattivate, `.mxl` al massimo 50 MB decompressi e 100 voci, MIDI al massimo 10 MB;
- servizio OMR raggiungibile solo dal backend, con una chiave di almeno 16 caratteri diversa da quella di sviluppo.

### 15.2 Rotazione client secret OIDC

1. Creare una seconda credenziale se supportato.
2. Aggiornare il secret manager.
3. Distribuire il backend e verificare login/refresh/logout.
4. Revocare la credenziale precedente.
5. Registrare versione e data di rotazione.

### 15.3 Rotazione VAPID

La chiave pubblica è incorporata nel frontend. La rotazione richiede coordinamento tra backend e nuova build FE e può rendere inutilizzabili le subscription esistenti.

1. Valutare migrazione/ri-registrazione delle subscription.
2. Generare la nuova coppia in ambiente sicuro.
3. Aggiornare privata backend e pubblica frontend nella stessa release coordinata.
4. Distribuire, verificare una nuova subscription e un invio.
5. Eliminare la vecchia privata secondo policy.

### 15.4 Rotazione della chiave del servizio OMR

1. Generare una nuova chiave di almeno 16 caratteri nel secret manager.
2. Aggiornare `TAURUS_OMR_API_KEY`, che nel manifest di riferimento configura insieme servizio e backend, e riavviarli.
3. Verificare un riconoscimento di prova: con chiavi diverse i job terminano con `serviceUnavailable`.
4. Riavviare con «Riprova» i riconoscimenti falliti durante la rotazione. I PDF caricati nel frattempo hanno le parti scansionate senza strumenti suggeriti: si assegnano a mano.

### 15.5 Rotazione della chiave dei codici di firma

1. Generare una nuova chiave nel secret manager e aggiornare `SIGNATURE_OTP_SECRET`.
2. Riavviare il backend: i codici già inviati e non ancora confermati smettono di valere e gli utenti ne chiedono uno nuovo. Firme e prove registrate non dipendono dalla chiave.

### 15.6 Rinnovo del certificato del sigillo

1. Creare il nuovo keystore come in §4.7, almeno un mese prima della scadenza del certificato in uso.
2. Aggiornare il file montato, l'alias e la password e riavviare il backend; verificare nel log la nuova impronta (`signature_seal_loaded`).
3. Comunicare ai tenant la nuova impronta: i documenti già sigillati restano verificabili con il certificato incorporato nel loro sigillo.
4. Conservare il vecchio keystore solo finché serve per eventuali verifiche, poi distruggerlo secondo policy.

### 15.7 Rotazione certificati TLS

Monitorare scadenza con anticipo, aggiornare reverse proxy/ingress, verificare catena completa e hostname, quindi provare login OIDC, API, service worker e feed calendario da una rete esterna.

### 15.8 Revoca dei feed calendario per incidente

Un URL di sottoscrizione è una credenziale: chi lo possiede legge gli eventi inclusi finché il token resta valido. Vale per un link finito in una chat, in un messaggio inoltrato o in un calendario condiviso, e per il sospetto che un elenco di token sia stato esposto.

1. Delimitare l'incidente. Un singolo feed si riconosce dal fingerprint mostrato nell'elenco; `GET /api/admin/calendar-feeds` elenca i feed tenant e i metadati di quelli personali, e `/audit` ne dà la cronologia (creazione, rotazioni, revoche, autore e momento). I log `calendar_feed_credential` e `calendar_feed_download` non contengono mai il token.
2. Un solo feed compromesso: dal pannello, «Genera nuovo link» se il proprietario deve continuare a usarlo, «Revoca» se no. Un amministratore non può ruotare un feed personale — riceverebbe la credenziale dell'utente — e può soltanto revocarlo, chiedendo al proprietario di crearne uno nuovo.
3. Più feed o esposizione di origine ignota su un tenant: togliere la funzionalità `EXTERNAL_CALENDAR_FEED` al tenant (`public.tenant.external_calendar_feed_enabled = false`). Da quel momento ogni download risponde `404` e le API di gestione sono negate, senza toccare le sottoscrizioni: riattivando la funzionalità i link tornano validi, quindi è una misura di contenimento, non una revoca.
4. Incidente sull'intera istanza: `CALENDAR_FEED_ENABLED=false` e riavvio. Stesso effetto del punto precedente su tutti i tenant.
5. Revoca definitiva: dopo il contenimento revocare i feed interessati, così il registro globale chiude le righe e il token non è più risolvibile nemmeno riattivando la funzionalità.
6. Comunicare che cosa resta visibile. Rotazione e revoca non eliminano le copie già memorizzate dai provider: Google, Apple e Outlook continuano a mostrare l'ultimo calendario scaricato finché non riprovano l'aggiornamento, e l'intervallo lo decide il provider.
7. Verificare la chiusura. Nessun feed interessato resta `ACTIVE` nell'elenco; il job notturno (`application.calendar-feed.cleanup-cron`) non deve segnalare righe globali orfane (`taurus.calendar_feed.registry.orphans`); un calo a zero di `taurus.calendar_feed.requests` con `outcome=200` sui feed revocati conferma che nessuno li sta più scaricando.
8. Annotare nel verbale dell'incidente fingerprint, momento della revoca e tenant coinvolti, leggendoli dalla cronologia: il valore del token non esiste in chiaro da nessuna parte e non va ricostruito.

La revoca di tutti i feed di un tenant avviene anche da sola quando il tenant viene disattivato o cancellato, e quella dei feed personali quando il proprietario perde i ruoli partecipanti o viene cancellato.

## 16. Manutenzione ricorrente

### Giornaliera

- health e alert aperti;
- esito backup;
- spazio DB/storage;
- backlog RabbitMQ;
- errori scheduler, notification delivery e provisioning tenant;
- riconoscimenti delle parti terminati con errore, se l'ascolto è attivo.

### Settimanale

- trend di latenza/errori e capacità;
- tenant non `ACTIVE`;
- dipendenze/certificati prossimi a scadenza;
- crescita media e outbox;
- verifica che i cleanup abbiano completato.

### Mensile

- restore di prova secondo policy;
- revisione accessi privilegiati;
- patching immagini base e dipendenze, compresa l'immagine del servizio OMR, seguito dalla misura di accuratezza dei motori (§4.6);
- revisione RPO/RTO misurati;
- audit configurazione e drift dei manifest;
- prova della procedura di rollback in collaudo.

## 17. Disaster recovery

### 17.1 Dichiarazione DR

Attivare il DR quando l'ambiente primario non può rispettare l'RTO o quando il ripristino in-place aumenta il rischio di perdita/corruzione dati. L'incident commander autorizza il failover e congela le scritture sul primario se ancora raggiungibile.

### 17.2 Sequenza di recupero

1. Identificare l'ultimo punto coerente disponibile.
2. Preparare rete, DNS, TLS, secret references e storage nel sito DR.
3. Ripristinare PostgreSQL Taurus e Keycloak.
4. Ripristinare media e provider/temi Keycloak.
5. Avviare Keycloak.
6. Avviare una sola istanza backend e verificare migration/schema.
7. Avviare RabbitMQ vuoto o ripristinato secondo la policy approvata, e il servizio OMR se l'ascolto lo usa: non ha dati da ripristinare e il recupero pianificato rimette in coda i riconoscimenti interrotti.
8. Avviare backend completo, frontend e sito.
9. Eseguire smoke test multi-tenant e media.
10. Aprire il traffico gradualmente e monitorare.
11. Comunicare perdita dati massima effettiva e tempo di ripristino.

Prima del failback impedire split brain e decidere quale sito è la fonte autorevole.

## 18. Gap noti e piano di completamento produzione

I seguenti punti emergono direttamente dal repository e devono diventare attività tracciate.

Chiusi il 2026-10-30 con il manifest di produzione e quello che gli sta intorno: manifest completo con reti, volumi, probe, limiti e segreti fuori dal repository; volume dei dati di PostgreSQL; configurazione del frontend a runtime, che toglie gli indirizzi interni dal bundle; client OIDC uniformato su `web_app`; Keycloak in modalità produzione con hostname, proxy e database; `app.yml` rimosso; pipeline che pubblica anche l'immagine del sito informativo e il JAR del provider, firmati e con la provenienza attestata; log in JSON con `requestId` e `tenant`; Actuator ristretto a `health`, `info` e `prometheus`; RabbitMQ di sviluppo sul loopback; smoke test non distruttivo (`scripts/ops/smoke-test.sh`); servizio OMR nel manifest con le sue restrizioni; SoundFont procurabile da una copia controllata.

Chiuso il 2026-11-06: il carattere Lato è servito dall'applicazione (pacchetto `lato-font`) e la Content-Security-Policy non ammette più domini esterni per caratteri e stili.

| Priorità | Gap | Azione richiesta |
| --- | --- | --- |
| Bloccante | Il manifest di produzione esiste ([`deploy/compose.yml`](../deploy/compose.yml)) ma non è mai stato eseguito su un host reale | Insediarlo su un server, registrare l'esito e promuoverlo da riferimento a configurazione collaudata |
| Alta | Backup non programmati: la prova di ripristino del database è automatizzata con `scripts/ops/restore-test.sh`, ma nessuno la esegue, e RPO, RTO e retention non sono approvati | Programmare backup e prova sull'host, estenderla a Keycloak e allo storage media, far approvare i tempi misurati. L'informativa privacy e i termini di utilizzo oggi dichiarano che non si fanno copie di sicurezza: attivarle richiede prima una loro nuova versione ([`docs/legal`](legal/)) |
| Alta | Degli scheduler, hanno una presa in carico condizionata solo quelli di upload, onboarding, outbox delle notifiche, consegna push e promemoria eventi | Qualificare i restanti (ritenzione, pulizie, recuperi) per idempotenza o worker dedicato; finché non lo sono, il manifest avvia una replica sola del backend |
| Media | La copia controllata del SoundFont non è ancora pubblicata: la build usa il mirror pubblico se non le viene indicata | Pubblicare il file come allegato di una release e impostare `TAURUS_SOUNDFONT_URL` nella pipeline |
| Media | Raccolta dei log e allarmi non configurati sull'host | Acquisire `stdout/stderr` con una retention di 5 giorni, quella dichiarata dall'informativa privacy, e definire gli allarmi di §10.2 |

## 19. Scheda rapida di change

```text
Change ID:
Ambiente:
Versione attuale / digest:
Versione target / digest:
Immagine servizio OMR / digest:
Feature ID interessati:
Migration globali:
Migration tenant:
Modifiche Keycloak:
Modifiche configurazione/segreti:
Backup ID e timestamp UTC:
Restore test più recente:
Owner go/no-go:
Ora inizio UTC:
Esito pre-check:
Esito migration:
Esito smoke test:
Decisione: GO | ROLLBACK | HOLD
Ora fine UTC:
Note/link incidente:
```

## 20. Riferimenti nel repository

- `README.md`: panoramica e comandi comuni;
- `docs/features.md`: catalogo funzionalità generato;
- `docs/postgres-tenant-schemas.md`: isolamento e provisioning tenant;
- `docs/migrazione-opensearch-postgresql.md`: modello dati relazionale e strategia migration;
- `docs/tenant-feature-flags-spec.md`: feature flag e capability;
- `docs/media-asset-spec.md`: storage e lifecycle media;
- `docs/track-pdf-processing-spec.md`: contratto, ciclo di vita e recovery dell'elaborazione PDF delle tracce;
- `docs/notification-delivery-generalization-spec.md`: outbox e consegna;
- `docs/web-push-reminders-spec.md`: Web Push e VAPID;
- `docs/tenant-onboarding-import-spec.md`: import e recovery;
- `docs/track-score-playback-spec.md`: ascolto, riconoscimento, correzione delle parti e accuratezza dei motori;
- `taurus-omr/README.md`: API, configurazione e strumenti di accuratezza del servizio OMR;
- `taurus-be/src/main/resources/config/application*.yml`: configurazione backend;
- `taurus-be/src/main/docker/*.yml`: stack esclusivamente locale; `omr.yml` documenta le restrizioni del servizio OMR;
- `deploy/compose.yml` e `deploy/README.md`: manifest di produzione, con `.env.example` e l'esempio del reverse proxy dell'host;
- `scripts/ops/smoke-test.sh`: smoke test non distruttivo di un'installazione;
- `scripts/ops/validate-deploy-manifest.sh`: controllo del manifest, eseguito dalla CI;
- `scripts/ops/restore-test.sh`: prova di ripristino del database;
- `scripts/ops/fetch-cie-trust-anchors.mjs`, `scripts/ops/cie-trust-anchors.sha256` e `deploy/cie/trust-anchors.pem`: certificati delle CA della CIE, impronte attese e bundle montato dal manifest;
- `.github/workflows/verify.yml`: verifiche CI, compresa l'accuratezza dei motori OMR;
- `.github/workflows/cie-trust-anchors.yml`: confronto mensile dei certificati della CIE con la lista di fiducia di AgID;
- `.github/workflows/docker-publish.yml`: pubblicazione e firma delle immagini di backend, frontend, OMR e sito informativo, e del JAR del provider Keycloak come allegato della release.

## 21. Criterio di “servizio ripristinato”

Un componente che risponde al solo health check non basta. Taurus è ripristinato quando:

- health e readiness sono stabili;
- login, refresh e logout OIDC funzionano;
- almeno due tenant di verifica risultano isolati;
- DB globale e schemi tenant hanno migration coerenti;
- lettura/scrittura core e media funzionano;
- RabbitMQ consuma i job senza backlog crescente, compresi i riconoscimenti delle parti;
- il servizio OMR risponde `UP`, se l'ascolto con riconoscimento è attivo;
- scheduler e notification delivery non producono errori ripetuti;
- frontend, QR, feed e Web Push usano URL e certificati corretti;
- metriche restano entro le soglie concordate per la finestra di osservazione;
- l'incident commander o il change owner registra formalmente il recupero.
