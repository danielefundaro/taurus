# Taurus frontend

Applicazione Angular 22 di Taurus per utenti e amministratori, con componenti PrimeNG 22 e autenticazione Keycloak (`keycloak-angular`). Il progetto nasce dal template Sakai.

## Struttura

| Percorso | Contenuto |
| --- | --- |
| `src/app/pages` | pagine, una cartella per funzionalità |
| `src/app/components` | componenti condivisi del [Taurus Layout Standard](../docs/taurus-layout-standard.md) |
| `src/app/dialogs` | dialoghi |
| `src/app/service` | accesso alle API del backend |
| `src/app/constants` | messaggi d'errore e comportamenti dello [Standard degli errori applicativi](../docs/application-errors-standard.md) |
| `src/app/score-player`, `src/app/score-editor` | lettore ed editor dell'[ascolto delle parti](../docs/track-score-playback-spec.md) |
| `src/assets` | risorse statiche, compresi Verovio, SpessaSynth e il SoundFont |
| `src/environments` | indirizzi di backend e Keycloak compilati nel bundle: `environment.ts` per lo sviluppo, `environment.prod.ts` come ripiego della configurazione a runtime |
| `src/runtime-config.ts` | configurazione letta da `assets/config.json` prima dell'avvio: nel container la scrive l'entrypoint dalle variabili d'ambiente; in sviluppo vale sopra di essa `assets/config.local.json` |

## Sviluppo

Con Node.js 26 e i servizi del backend avviati (vedi il [README principale](../README.md)):

```bash
npm ci
npm start
```

L'applicazione è su `http://localhost:4200` e chiama il backend su `http://localhost:8080/api` e Keycloak su `http://localhost:9080`.

La configurazione della propria macchina va in `src/assets/config.local.json`, che ha la forma di `assets/config.json` e vale sopra di essa solo in sviluppo. È escluso da git e dall'immagine, e la build di produzione non lo legge. Vi si mette per esempio la chiave della PrimeUI License, senza la quale PrimeNG mostra il suo avviso:

```json
{
    "primeuiLicense": "la-tua-chiave"
}
```

Dopo averlo creato o modificato basta ricaricare la pagina.

`npm start` e `npm run build` eseguono prima `scripts/fetch-soundfont.mjs`, che procura il SoundFont MuseScore General (circa 38 MB, non versionato) e ne verifica lo SHA-256. Le fonti, in ordine: `TAURUS_SOUNDFONT_PATH` per una copia già sulla macchina, `TAURUS_SOUNDFONT_URL` per una copia controllata e, in mancanza di entrambe, il mirror pubblico. Qualunque sia la fonte, una copia con un'impronta diversa viene rifiutata. `TAURUS_SKIP_SOUNDFONT=1` salta il passaggio, per esempio nei job che non usano il lettore.

## Comandi

| Comando | Effetto |
| --- | --- |
| `npm start` | server di sviluppo |
| `npm run build` | build di produzione in `dist/sakai-ng/browser` |
| `npm test -- --watch=false --browsers=ChromeHeadless` | test Karma/Jasmine, una sola esecuzione |
| `npm run test:coverage` | gli stessi test con la copertura e la soglia minima |
| `npm run e2e` | suite end to end Playwright, desktop e mobile: serve un'istanza completa, vedi `e2e/README.md` |
| `npm run e2e:matrix` | la stessa suite su tutti i profili, tablet, Firefox e WebKit compresi |
| `npm run format` | formattazione Prettier |

I test stanno accanto ai file che verificano, come `*.spec.ts`. Le prove end to end e quelle di accessibilità stanno in `e2e/`.

## Convenzioni

TypeScript strict, indentazione a quattro spazi, apici singoli e punto e virgola, formattazione con Prettier. I file seguono il kebab case con il suffisso del ruolo, per esempio `inventory.service.ts`. Per i componenti PrimeNG si consulta `docs/llms-full.md`, limitandosi alle sezioni del componente usato.

## Immagine

Il `Dockerfile` costruisce l'applicazione con Node.js 26 e la serve con nginx. Il workflow
`docker-publish.yml` pubblica l'immagine come `taurus-frontend` a ogni tag `v*.*.*`.

L'immagine non porta dentro la configurazione: all'avvio `docker-entrypoint.d/40-taurus-runtime-config.sh`
scrive `assets/config.json` dalle variabili d'ambiente e `nginx.conf.template` diventa la
configurazione del server. Lo stesso container serve l'applicazione e inoltra `/api` e `/auth` ai
servizi interni, così che tutto stia su una sola origine pubblica: niente CORS e nessun indirizzo
della rete interna nel bundle. Le intestazioni di sicurezza e la Content-Security-Policy stanno in
`security-headers.conf`, incluso da ogni blocco che aggiunge intestazioni proprie.

| Variabile | Cosa configura | Predefinito |
| --- | --- | --- |
| `TAURUS_API_BASE_URL` | indirizzo dell'API per il browser | `/api` |
| `TAURUS_KEYCLOAK_BASE_URL` | indirizzo di Keycloak per il browser | `/auth` |
| `TAURUS_KEYCLOAK_REALM` | realm | `taurus` |
| `TAURUS_KEYCLOAK_CLIENT_ID` | client OIDC | `web_app` |
| `TAURUS_VAPID_PUBLIC_KEY` | chiave pubblica delle notifiche push | `CHANGE_ME` |
| `TAURUS_PRIMEUI_LICENSE` | chiave della PrimeUI License, vedi [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | vuota, con l'avviso di PrimeNG |
| `TAURUS_API_UPSTREAM` | indirizzo interno del backend | `http://backend:8080` |
| `TAURUS_KEYCLOAK_UPSTREAM` | indirizzo interno di Keycloak | `http://keycloak:9080` |
| `TAURUS_MAX_UPLOAD_SIZE` | limite del corpo delle richieste | `500m` |
| `TAURUS_DNS_RESOLVER` | DNS che risolve gli inoltri | `127.0.0.11` |

Il manifest di riferimento che la usa è [`deploy/compose.yml`](../deploy/compose.yml).
