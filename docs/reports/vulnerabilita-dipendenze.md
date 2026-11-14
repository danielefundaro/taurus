# Vulnerabilità delle dipendenze

Il 2026-11-14, durante il push di `feature/music-writing-phase-1`, GitHub ha segnalato 8 vulnerabilità sul branch predefinito: 2 critiche, 2 alte, 3 moderate e 1 bassa. I dettagli sono nella pagina Dependabot del repository (`Security` → `Dependabot`).

La pagina non era consultabile al momento della segnalazione. L'elenco che segue viene quindi dagli audit locali dello stesso giorno, sugli stessi lockfile di `main`. Prima di intervenire va confrontato con la pagina Dependabot, che resta il riferimento.

## Come è stato ricavato

- `npm audit` in `taurus-be` e `taurus-fe`, `pnpm audit` in `taurus-info`.
- Le dipendenze Maven risolte con `./mvnw -o dependency:list`, di ogni scope, in `taurus-be` e `keycloak-authenticator`, e i pacchetti fissati in `taurus-omr/requirements*.txt`: tutti verificati sul database [OSV](https://osv.dev), che comprende gli avvisi di GitHub.

Le dipendenze Maven del backend e i pacchetti Python del servizio OMR non hanno vulnerabilità note.

## Quadro d'insieme

| # | Pacchetto | Versione | Modulo | Gravità | Avviso | Corretta in |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `simple-git` | 3.36.0 | `taurus-be` (npm, sviluppo) | Critica | [GHSA-x6jw-m9v5-85vh](https://github.com/advisories/GHSA-x6jw-m9v5-85vh) | 4.0.1 |
| 2 | `@simple-git/argv-parser` | 1.1.1 | `taurus-be` (npm, sviluppo) | Critica | [GHSA-v5rq-49vh-5v5c](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) | 2.0.1 |
| 3 | `simple-git` | 3.36.0 | `taurus-be` (npm, sviluppo) | Alta | [GHSA-g4wm-2vf7-vfgr](https://github.com/advisories/GHSA-g4wm-2vf7-vfgr) | 4.0.0 |
| 4 | `simple-git` | 3.36.0 | `taurus-be` (npm, sviluppo) | Alta | [GHSA-858h-whjf-mvg5](https://github.com/advisories/GHSA-858h-whjf-mvg5) | 4.0.0 |
| 5 | `fast-xml-parser` | 5.11.1 | `taurus-be` (npm, sviluppo) | Bassa | [GHSA-474x-hrwr-fgx4](https://github.com/advisories/GHSA-474x-hrwr-fgx4) | 5.12.0 |
| 6 | `glob` | 13.0.6 | `taurus-be` (npm, sviluppo) | Moderata | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | 14.0.2 |
| 7 | `minimatch` | 10.2.6 | `taurus-be` (npm, sviluppo) | Moderata | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | 11.0.1 |
| 8 | `minimatch` | 10.2.6 | `taurus-fe` (npm, sviluppo) | Moderata | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | 11.0.1 |
| 9 | `astro` | 7.4.5 | `taurus-info` | Moderata | [GHSA-r3h5-4585-7x3w](https://github.com/advisories/GHSA-r3h5-4585-7x3w) | 7.4.7 |
| 10 | `com.google.guava:guava` | 32.1.2-jre | `keycloak-authenticator` (`provided`) | Alta | [GHSA-xxph-c9ww-hj94](https://github.com/advisories/GHSA-xxph-c9ww-hj94) | 33.7.2 |
| 11 | `io.opentelemetry:opentelemetry-api` | 1.62.0 | `keycloak-authenticator` (`provided`) | Moderata | [GHSA-ccrj-gw8r-854m](https://github.com/advisories/GHSA-ccrj-gw8r-854m) | 1.67.0 |

Corrispondenza con le 8 segnalazioni di GitHub:

- le 2 critiche, le 2 alte e la bassa sono le righe 1–5;
- le 3 moderate sono con ogni probabilità tre delle righe 6–9, che sono quattro: la pagina Dependabot dirà quale manca;
- le righe 10 e 11 non rientrano nel conteggio, perché Dependabot legge solo le dipendenze dichiarate nei `pom.xml` e queste arrivano dalle librerie di Keycloak.

## Interventi

### `taurus-be`: strumenti npm

Le righe 1–7 vengono tutte da `generator-jhipster` 9.4.0, una `devDependency` di `taurus-be/package.json`. Questi pacchetti girano solo sulle macchine di sviluppo e in CI. Non entrano nel JAR né nell'immagine, che Jib costruisce con il solo codice Java.

Le vulnerabilità critiche e alte di `simple-git` permettono di eseguire comandi quando Git riceve opzioni o configurazioni scelte da un attaccante. Il generatore usa Git solo quando si rigenera il progetto.

1. Verificare se `generator-jhipster` serve ancora. `.yo-rc.json` indica che il progetto è stato generato con JHipster 8.7.3, e il pacchetto serve solo a rigenerare il codice. Se non serve, toglierlo da `package.json` e rigenerare il lockfile con `npm install` risolve da solo le righe 1–7.
2. Se serve ancora, forzare le versioni corrette con `overrides` in `package.json`: `simple-git` ≥ 4.0.1, `@simple-git/argv-parser` ≥ 2.0.1, `fast-xml-parser` ≥ 5.12.0, `glob` ≥ 14.0.2, `minimatch` ≥ 11.0.1. Poi verificare che il generatore funzioni ancora, per esempio con `npx jhipster info`. `simple-git` 4, `glob` 14 e `minimatch` 11 sono versioni maggiori.
3. Non usare `npm audit fix --force`: propone `generator-jhipster` 7.9.4, cioè di scendere di due versioni maggiori.
4. Verificare che gli strumenti rimasti funzionino ancora: `npm run prettier:check` in `taurus-be` e `./mvnw verify`, che comprende Spotless.

### `taurus-fe`: ESLint

La riga 8 è `minimatch` 10.2.6, usato da `eslint` 10.14.0 e da `@eslint/config-array` 0.23.5. Servono solo allo sviluppo. `npm audit` indica una correzione senza cambi di versione maggiore, quindi `npm audit fix` dovrebbe bastare. Dopo l'aggiornamento:

- controllare il diff di `package-lock.json`;
- lanciare `npm run build` e `npm run test:coverage`.

### `taurus-info`: Astro

La riga 9 riguarda l'endpoint delle immagini dell'adattatore `@astrojs/node`. Il sito non usa quell'adattatore: è statico e servito da nginx. L'avviso quindi non si applica, ma l'aggiornamento è a basso rischio. I passi sono:

1. `pnpm update astro` per arrivare a una versione ≥ 7.4.7;
2. poi `pnpm check`, `pnpm build` e `pnpm test`, con pnpm 12 e Node.js 26.

### `keycloak-authenticator`: librerie di Keycloak

Le righe 10 e 11 sono dipendenze `provided` delle librerie di Keycloak 26.8.2 (`keycloak.version`). Non finiscono nel JAR del provider: le fornisce il server Keycloak. Per questo vanno corrette aggiornando Keycloak, quando una versione le include:

- `keycloak.version` in `keycloak-authenticator/pom.xml`;
- l'immagine `quay.io/keycloak/keycloak` in `taurus-be/src/main/docker/keycloak.yml`;
- l'immagine usata in produzione.

Prima di decidere va controllato quali versioni contiene davvero l'immagine, nella cartella `/opt/keycloak/lib/lib/main`: possono essere diverse da quelle degli artefatti Maven.

## Verifica

Dopo gli interventi:

1. rilanciare gli audit descritti in [Come è stato ricavato](#come-è-stato-ricavato);
2. rilanciare i comandi di verifica dei moduli toccati, come indicato in `AGENTS.md`;
3. controllare che la pagina Dependabot chiuda le segnalazioni dopo il merge su `main`.

Questo report sta in `docs/reports/`: il validatore controlla solo i file al primo livello di `docs/`, quindi non richiede una voce nel catalogo e non compare in `features.md`.
