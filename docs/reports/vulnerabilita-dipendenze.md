# Vulnerabilità delle dipendenze

Il 2026-11-14, durante il push di `feature/music-writing-phase-1`, GitHub ha segnalato 8 vulnerabilità sul branch predefinito: 2 critiche, 2 alte, 3 moderate e 1 bassa. I dettagli sono nella pagina Dependabot del repository (`Security` → `Dependabot`).

La pagina non era consultabile al momento della segnalazione. L'elenco che segue viene quindi dagli audit locali, sugli stessi lockfile di `main`. La pagina Dependabot resta il riferimento.

Il 2026-11-18 gli audit sono stati ripetuti e le segnalazioni che hanno una versione corretta sono state chiuse, sul ramo `feature/dependency-vulnerabilities`. Restano aperte quelle senza una versione corretta: vedi [Ancora aperte](#ancora-aperte).

## Come è stato ricavato

- `npm audit` in `taurus-be` e `taurus-fe`, `pnpm audit` in `taurus-info`; il 2026-11-18 con pnpm 12.17.0, la versione di `packageManager`.
- Le dipendenze Maven risolte con `./mvnw -o dependency:list`, di ogni scope, in `taurus-be` e `keycloak-authenticator`, e i pacchetti fissati in `taurus-omr/requirements*.txt`: tutti verificati sul database [OSV](https://osv.dev), che comprende gli avvisi di GitHub.
- Il 2026-11-18 anche i JAR dell'immagine `quay.io/keycloak/keycloak:26.8.2`, nella cartella `/opt/keycloak/lib/lib/main`.

Le dipendenze Maven del backend e i pacchetti Python del servizio OMR non hanno vulnerabilità note, né il 2026-11-14 né il 2026-11-18.

## Quadro d'insieme

| # | Pacchetto | Versione | Modulo | Gravità | Avviso | Corretta in | Stato al 2026-11-18 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `simple-git` | 3.36.0 | `taurus-be` (npm, sviluppo) | Critica | [GHSA-x6jw-m9v5-85vh](https://github.com/advisories/GHSA-x6jw-m9v5-85vh) | 4.0.1 | chiusa: generatore tolto |
| 2 | `@simple-git/argv-parser` | 1.1.1 | `taurus-be` (npm, sviluppo) | Critica | [GHSA-v5rq-49vh-5v5c](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) | 2.0.1 | chiusa: generatore tolto |
| 3 | `simple-git` | 3.36.0 | `taurus-be` (npm, sviluppo) | Alta | [GHSA-g4wm-2vf7-vfgr](https://github.com/advisories/GHSA-g4wm-2vf7-vfgr) | 4.0.0 | chiusa: generatore tolto |
| 4 | `simple-git` | 3.36.0 | `taurus-be` (npm, sviluppo) | Alta | [GHSA-858h-whjf-mvg5](https://github.com/advisories/GHSA-858h-whjf-mvg5) | 4.0.0 | chiusa: generatore tolto |
| 5 | `fast-xml-parser` | 5.11.1 | `taurus-be` (npm, sviluppo) | Bassa | [GHSA-474x-hrwr-fgx4](https://github.com/advisories/GHSA-474x-hrwr-fgx4) | 5.12.0 | chiusa: generatore tolto |
| 6 | `glob` | 13.0.6 | `taurus-be` (npm, sviluppo) | Moderata | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | 14.0.2 | chiusa: generatore tolto |
| 7 | `minimatch` | 10.2.6 | `taurus-be` (npm, sviluppo) | Moderata | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | 11.0.1 | chiusa: generatore tolto |
| 8 | `minimatch` | 10.2.6 | `taurus-fe` (npm, sviluppo) | Moderata | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | 11.0.1 | chiusa: ESLint 10.15.0 |
| 9 | `astro` | 7.4.5 | `taurus-info` | Moderata | [GHSA-r3h5-4585-7x3w](https://github.com/advisories/GHSA-r3h5-4585-7x3w) | 7.4.7 | chiusa: Astro 7.4.12 |
| 10 | `com.google.guava:guava` | 32.1.2-jre; 33.6.0-jre nell'immagine | `keycloak-authenticator` (`provided`) | Alta | [GHSA-xxph-c9ww-hj94](https://github.com/advisories/GHSA-xxph-c9ww-hj94) | 33.7.2 | aperta: serve una versione di Keycloak |
| 11 | `io.opentelemetry:opentelemetry-api` | 1.62.0 | `keycloak-authenticator` (`provided`) | Moderata | [GHSA-ccrj-gw8r-854m](https://github.com/advisories/GHSA-ccrj-gw8r-854m) | 1.67.0 | aperta: serve una versione di Keycloak |
| 12 | `picomatch` | 2.3.2 e 4.0.7 | `taurus-be`, `taurus-fe` e `taurus-info` (npm, sviluppo) | Alta | [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) | nessuna | aperta: nessuna versione corretta |

Corrispondenza con le 8 segnalazioni di GitHub del 2026-11-14:

- le 2 critiche, le 2 alte e la bassa sono le righe 1–5;
- le 3 moderate sono con ogni probabilità tre delle righe 6–9, che sono quattro: la pagina Dependabot dirà quale manca;
- le righe 10 e 11 non rientrano nel conteggio, perché Dependabot legge solo le dipendenze dichiarate nei `pom.xml` e queste arrivano dalle librerie di Keycloak;
- la riga 12 è successiva: l'audit del 2026-11-18 la trova in tutti e tre i lockfile npm, e Dependabot la mostrerà come segnalazione nuova.

## Interventi del 2026-11-18

### `taurus-be`: strumenti npm

Le righe 1–7 venivano tutte da `generator-jhipster` 9.4.0, una `devDependency` di `taurus-be/package.json`. È l'ultima versione pubblicata, e fissa esattamente `simple-git` 3.36.0: nessun aggiornamento del generatore le avrebbe chiuse.

- Il generatore esce da `package.json`. Il lockfile scende da 459 pacchetti a 19, senza cambiare la versione di quelli che restano.
- Restano husky, lint-staged, Prettier e i suoi due plugin, che servono all'hook di pre-commit e agli script `prettier:*`.
- `.yo-rc.json` e `.jhipster/` restano nel repository. Per un futuro aggiornamento di JHipster il generatore si lancia senza installarlo, con `npx generator-jhipster@<versione>`.
- Maven e la CI non usano questi strumenti: il `pom.xml` cita `node_modules` solo fra i file esclusi, e Spotless non usa Prettier. Per questo `./mvnw verify` non è stato ripetuto in locale; lo esegue la CI.

La libreria `tech.jhipster:jhipster-framework` del `pom.xml` è un'altra cosa: gira nel backend, non ha vulnerabilità note e non cambia.

### `taurus-fe`: ESLint

La riga 8 è chiusa da ESLint 10.15.0, che porta `@eslint/config-array` 0.23.6 e `minimatch` 11.0.9. `package.json` chiede `eslint` `^10.15.0`.

- Il lockfile cambia solo per questi pacchetti e per `@isaacs/nonrecursive-glob-match` 1.1.0, una dipendenza nuova di `minimatch` 11 con licenza BlueOak-1.0.0, permissiva, che serve solo allo sviluppo.
- Non si è usato `npm audit fix`: avrebbe portato `@angular/cli` e `@schematics/angular` alla 22.2.7 lasciando il resto di Angular alla 22.2.6.
- npm riscrive il lockfile con il rientro di quattro spazi di `package.json`. Il file versionato ne usa due, e li conserva.

### `taurus-info`: Astro

La riga 9 è chiusa da Astro 7.4.12, l'ultima versione della 7, con pnpm 12.17.0. Astro porta vite 8.3.8 e rolldown.

Con Astro 7.4.12 `@astrojs/astro2tsx` 0.1.3, usato da `@astrojs/check`, riceveva `@emnapi/runtime` 2.0.0-beta.2, incompatibile con il suo `@emnapi/core` 1.11.3. `pnpm check` si fermava con `this.bridge.setLastError is not a function`. La 0.1.4 dichiara `@emnapi/runtime` 1.11.3 come dipendenza propria: con lei `pnpm check` torna a passare.

## Ancora aperte

### `picomatch` (riga 12)

L'avviso riguarda un ReDoS: un pattern con un extglob a un solo ramo ripetuto può far lavorare a lungo la conversione in espressione regolare. La 4.0.7 è l'ultima versione pubblicata, e l'avviso la comprende; anche la 2.3.2 è vulnerabile.

- `picomatch` arriva solo dagli strumenti di sviluppo: lint-staged e `prettier-plugin-packagejson` nel backend, gli strumenti di build e di test di Angular (`@angular/build`, vite, karma) nel frontend, Astro e vite nel sito. Non entra nel bundle né nelle immagini.
- I pattern che riceve sono scritti nella configurazione di questi strumenti, non arrivano da chi usa Taurus.
- Va aggiornato appena esce una versione corretta, nei tre lockfile.

### Librerie di Keycloak (righe 10 e 11)

Le righe 10 e 11 sono dipendenze `provided` delle librerie di Keycloak 26.8.2 (`keycloak.version`). Non finiscono nel JAR del provider: le fornisce il server Keycloak.

- Keycloak 26.8.2 è ancora l'ultima versione pubblicata.
- L'immagine `quay.io/keycloak/keycloak:26.8.2` contiene `guava` 33.6.0-jre e `opentelemetry-api` 1.62.0: entrambe sono ancora sotto le versioni corrette.
- L'avviso di OpenTelemetry riguarda l'intestazione `tracestate` del tracing. Né `taurus-be/src/main/docker/keycloak.yml` né `deploy/compose.yml` accendono il tracing di Keycloak, spento in modo predefinito.

Vanno corrette aggiornando Keycloak, quando una versione le include:

- `keycloak.version` in `keycloak-authenticator/pom.xml`;
- l'immagine `quay.io/keycloak/keycloak` in `taurus-be/src/main/docker/keycloak.yml`;
- l'immagine usata in produzione, `TAURUS_KEYCLOAK_VERSION` di `deploy/compose.yml`.

Prima di decidere va controllato quali versioni contiene davvero l'immagine nuova, nella cartella `/opt/keycloak/lib/lib/main`: possono essere diverse da quelle degli artefatti Maven, come per `guava` nella 26.8.2.

## Verifica

Il 2026-11-18, dopo gli interventi:

- **Audit:**
  - `npm audit` in `taurus-be` trova 6 voci alte;
  - `npm audit` in `taurus-fe` ne trova 17 alte;
  - `pnpm audit` in `taurus-info` ne trova 1 alta.
  - Sono tutte della riga 12, cioè pacchetti che dipendono da `picomatch`.
- **Maven e Python:** OSV trova solo le righe 10 e 11.
- **`taurus-be`:**
  - `npm run prettier:check` gira con i due plugin. Le 946 segnalazioni di formattazione c'erano già: Prettier e i plugin non cambiano versione.
  - `npx lint-staged --version` risponde 17.6.0.
- **`taurus-fe`:** `npm run build` passa, con i due avvisi di budget dei fogli di stile che c'erano già; `npm run test:coverage` passa con 1266 test e la copertura invariata.
- **`taurus-info`:** `pnpm check`, `pnpm build` e `pnpm test` passano, con Node.js 24.21; la CI usa Node.js 26.

Dopo il merge su `main` resta da controllare che la pagina Dependabot chiuda le righe 1–9.

Questo report sta in `docs/reports/`: il validatore controlla solo i file al primo livello di `docs/`, quindi non richiede una voce nel catalogo e non compare in `features.md`.
