# Aggiornamento di librerie, framework e servizi

Il documento pianifica l'aggiornamento di tutto ciò da cui Taurus dipende all'ultima versione stabile: runtime, framework, librerie, servizi, immagini Docker, strumenti di build e azioni della CI, in tutti i moduli. Fissa anche le regole per restare aggiornati dopo, così che il ritardo non si accumuli di nuovo.

L'occasione è il job `security` di `.github/workflows/verify.yml`: tornato a funzionare il 02/11/2026, Trivy ha trovato 90 vulnerabilità `HIGH` e `CRITICAL` nelle dipendenze e 4 problemi nei Dockerfile, e blocca la pipeline. Molte vulnerabilità non hanno una correzione nelle versioni maggiori in uso: Angular 19, Spring Boot 3.3, Keycloak 26.6 e nginx 1.29 sono fuori supporto.

Le verifiche di ogni modulo restano quelle di `AGENTS.md` e del [Runbook di test](runbook-test.md); le procedure di aggiornamento in produzione vanno nel [Runbook operativo](runbook-operativo.md).

## Stato del documento

ID catalogo: `platform-upgrade`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

Bozza del 2026-11-02, approvata il 2026-11-06 con tutte le scelte di [Decisioni](#decisioni). Le versioni obiettivo sono le ultime stabili a quella data, lette dai registri ufficiali (Maven Central, npm, PyPI, GitHub, endoflife.date).

Applicata dalla fase 0 alla fase 8, l'ultima verificata il 2026-11-10 e unita su `main` il 2026-11-11: l'aggiornamento è concluso (vedi [Esito della fase 8](#esito-della-fase-8)). Le versioni rimaste indietro sono in [Eccezioni](#eccezioni-alla-versione-più-recente); da qui in avanti gli aggiornamenti arrivano da Dependabot (decisione 7).

Il 2026-11-13 l'evolutiva successiva della decisione 5 ha portato il frontend ad Angular 22 e PrimeNG 22, con la PrimeUI License, sul ramo `upgrade-angular-22` (vedi [Esito del passo ad Angular e PrimeNG 22](#esito-del-passo-ad-angular-e-primeng-22)).

## Problema

- **CI bloccata.** Trivy segnala 9 vulnerabilità nel backend, 38 nel frontend, 14 nel sito informativo e 29 nel servizio OMR, di cui 8 `CRITICAL`. Fra queste: un'esecuzione di codice remoto in Astro, un aggiramento dell'autenticazione degli endpoint Actuator di Spring Boot, vulnerabilità XSS nel compilatore di Angular e certificati compromessi in `certifi`.
- **Versioni fuori supporto.** Angular 19 è fuori supporto dal 19/05/2026, Spring Boot 3.3 dal 2025, Keycloak 26.6 dal 09/07/2026, nginx 1.29 dal 13/05/2026, JHipster 8 dall'11/03/2026. Per alcune vulnerabilità di Angular la correzione esiste solo dalla 20 in su.
- **Ritardo accumulato.** Il frontend è fermo alla prima patch di Angular 19 (19.0.5), il backend a Spring Boot 3.3.5 di fine 2024, la CI usa azioni di due versioni maggiori fa. Il job `security` è rimasto rotto per mesi senza che nessuno se ne accorgesse.
- **Nessun aggiornamento automatico.** Il repository non ha Dependabot né altri strumenti che propongano gli aggiornamenti: ogni versione resta ferma finché qualcuno non la cambia a mano.

## Obiettivo

- Ogni componente all'ultima versione stabile compatibile con gli altri, con le eccezioni motivate in [Eccezioni](#eccezioni-alla-versione-più-recente).
- Il job `security` verde senza eccezioni permanenti: ogni vulnerabilità ignorata ha un motivo e una scadenza.
- Nessuna regressione: le verifiche di ogni modulo, le soglie di copertura e la suite end-to-end passano come prima.
- Aggiornamenti futuri proposti in automatico, piccoli e frequenti, e non più un grande salto ogni due anni.
- Nessun costo: solo strumenti gratuiti, come chiede il vincolo del progetto.

## Fuori scope

- Nuove funzionalità o cambi di comportamento visibili all'utente, salvo quelli imposti da un aggiornamento e descritti qui.
- Il passaggio di Angular alla rilevazione delle modifiche senza zone.js (zoneless), che è un cambio di architettura del frontend: da valutare a parte.
- La migrazione dei test del frontend da Karma e Jasmine a Vitest (decisione 6).
- Il riordino del codice generato da JHipster che non serve più, salvo quando l'aggiornamento lo rende inutilizzabile.
- Il passaggio del servizio OMR a Ubuntu 26.04 finché Audiveris non pubblica un pacchetto per quella versione (decisione 9).
- La riscrittura della cronologia git o la rotazione dei segreti: la ricerca dei segreti è già verde.

## Contesto attuale

Inventario del 02/11/2026. «Salto» indica il tipo di aggiornamento: patch e minor non dovrebbero rompere nulla, una maggiore richiede modifiche al codice.

### Runtime e strumenti

| Componente | Attuale | Obiettivo | Salto | Note |
| --- | --- | --- | --- | --- |
| Java (backend) | 17 | 25 LTS | maggiore | supporto fino al 2031 |
| Java (provider Keycloak) | 17 | quella del runtime di Keycloak | — | decisione 3 |
| Node.js | 22 | 26 LTS | maggiore | LTS dal 28/10/2026; Angular 21 e Astro 7 lo accettano |
| pnpm | 11.16 | 12.x | maggiore | sito informativo |
| Python (OMR) | 3.12 | 3.12 | — | eccezione: decisione 9 |
| TypeScript | 5.6 (FE), 5.9 (info) | 5.9 (FE), 6.0 (info) | minor (FE), maggiore (info) | eccezione: Angular 21 non accetta la 6 (decisione 5), `@astrojs/check` non supporta la 7 |
| Maven | 3.9.6 (immagine), wrapper | 3.10.x | minor | |

### Backend (`taurus-be`)

| Componente | Attuale | Obiettivo | Salto | Note |
| --- | --- | --- | --- | --- |
| Spring Boot | 3.3.5 | 4.1.x | maggiore | Spring Framework 7, Spring Security 7, Hibernate 7, Jackson 3 |
| JHipster framework | 8.7.2 | 9.4.x | maggiore | costruito su Spring Boot 4.1 |
| Spring Cloud (BOM) | 2023.0.3 | rimosso | — | importato ma non usato da nessuna classe |
| springdoc-openapi | 2.6.0 | 3.x | maggiore | linea per Spring Boot 4 |
| Liquibase e liquibase-hibernate | 4.x | 5.x, `liquibase-hibernate7` | maggiore | licenza: vedi [Licenze](#licenze) |
| Testcontainers | 1.21.4 | 2.x | maggiore | nuovi nomi di artefatti e package |
| PostgreSQL JDBC | 42.7.4 | 42.7.x | patch | 3 CVE |
| RabbitMQ Java client | 5.25.0 | 5.37.x | minor | 4 CVE |
| commons-beanutils | 1.9.4 | 1.11.x | minor | 1 CVE |
| Apache POI | 5.3.0 | 6.x | maggiore | |
| PDFBox, pdfbox-tools, jbig2 | 3.0.3 | 3.0.x | patch | |
| openhtmltopdf | 1.1.44 | 1.1.x | patch | |
| ical4j | 4.2.4 | 4.4.x | minor | |
| MapStruct, ArchUnit, ZXing, commons-csv, commons-compress, web-push | varie | ultime | minor/patch | |
| Plugin Maven (compiler, surefire, failsafe, enforcer, jar, javadoc…) | varie | ultime | minor | JaCoCo almeno 0.8.14 per Java 25 |
| Spotless, Checkstyle, Jib, git-commit-id, modernizer, Sonar | varie | ultime | maggiore per alcuni | |

### Frontend (`taurus-fe`)

| Componente | Attuale | Obiettivo | Salto | Note |
| --- | --- | --- | --- | --- |
| Angular (core, CLI, CDK) | 19.0.5 | 21.2.x | due maggiori | 22 CVE, alcune corrette solo dalla 20; la 22 è rimandata: decisione 5 |
| Builder | `@angular-devkit/build-angular` | `@angular/build` | — | migrazione di `ng update` |
| PrimeNG | 19.0.10 | 21.1.x | due maggiori | dalla 22 PrimeUI License: decisione 5 |
| Temi PrimeNG | `@primeng/themes` 19 | `@primeuix/themes` 2.x | pacchetto nuovo | il vecchio pacchetto è deprecato; la 3 ha la PrimeUI License |
| PrimeIcons | 7.0.0 | 7.0.0 | — | la 8 ha la PrimeUI License: decisione 5 |
| keycloak-angular / keycloak-js | 19.0.2 / 26.2.2 | 21.x / 26.2.x | maggiore / patch | |
| ngx-extended-pdf-viewer | 28.1.2 | 31.x | maggiore | la 28 include un pdf.js vulnerabile |
| Tailwind CSS e tailwindcss-primeui | 3.4 / 0.5 | 4.3 / 0.6 | maggiore | configurazione CSS al posto di `tailwind.config.js` |
| zone.js, rxjs, tslib | 0.15, 7.8.1 | 0.16, 7.8.x | minor | zone.js resta: [Fuori scope](#fuori-scope) |
| chart.js, verovio, spessasynth_lib | 4.4.2, 6.3.0, 4.3.14 | 4.6, 6.4, 4.4 | minor | lettore e rendering degli spartiti da ricontrollare |
| ESLint, Prettier, Playwright, axe-core | 9, 3.4, 1.49, 4.10 | 10, 3.9, 1.64, 4.14 | maggiore per ESLint | |
| Karma, Jasmine | 6.4, 5.4 | 6.4, ultima compatibile | — | decisione 6 |
| Dipendenze transitive (form-data, glob, minimatch, nanoid, postcss, tmp…) | varie | corrette | — | si allineano con il nuovo lockfile |

### Sito informativo (`taurus-info`)

| Componente | Attuale | Obiettivo | Salto | Note |
| --- | --- | --- | --- | --- |
| Astro | 5.18.2 | 7.4.x | due maggiori | esecuzione di codice remoto (`CRITICAL`) corretta nella 7 |
| @astrojs/sitemap, @astrojs/check | 3.7.3, 0.9.10 | ultime | patch | |
| Tailwind CSS e @tailwindcss/vite | 4.3.3 | 4.3.x | — | già aggiornati |
| Dipendenze transitive (sharp, vite, devalue, svgo, js-yaml) | varie | corrette | — | arrivano con Astro 7 |

### Servizio OMR (`taurus-omr`)

| Componente | Attuale | Obiettivo | Salto | Note |
| --- | --- | --- | --- | --- |
| Pillow | 12.3.0 | 13.0.x | maggiore | 28 CVE, 5 `CRITICAL`; homr 0.7.0 dichiara `Pillow<13`: [Pillow 13 nel servizio OMR](#pillow-13-nel-servizio-omr) |
| certifi | 2026.7.22 | 2026.10.x | — | radici emSign compromesse (`CRITICAL`) |
| FastAPI, Starlette, Pydantic, python-multipart, ONNX Runtime | varie | ultime | minor | |
| opencv-python-headless | 4.14 | 5.0 | maggiore | solo se homr lo accetta: decisione 9 |
| music21 | 9.7.1 | 10.x | maggiore | solo se homr lo accetta: decisione 9 |
| homr, RapidOCR, Audiveris | 0.7.0, 3.10.0, 5.11.0 | invariati | — | già alle ultime versioni |
| Immagine di base | Ubuntu 24.04 | Ubuntu 24.04 | — | eccezione: decisione 9 |

### Provider Keycloak (`keycloak-authenticator`)

| Componente | Attuale | Obiettivo | Salto | Note |
| --- | --- | --- | --- | --- |
| Keycloak (SPI e immagine) | 26.6.4 | 26.8.x | minor | la 26.6 è fuori supporto |
| FreeMarker | 2.3.32 | quella di Keycloak 26.8 | patch | resta allineata al runtime |
| Spring Boot (parent del modulo) | 4.0.2 | 4.1.x | minor | |

### Servizi e immagini Docker

| Componente | Attuale | Obiettivo | Salto | Note |
| --- | --- | --- | --- | --- |
| PostgreSQL | 17.0 | 18.x | maggiore | migrazione dei dati: decisione 10 |
| RabbitMQ | 4.0.7 | 4.4.x | minor | percorso di aggiornamento: decisione 11 |
| nginx (frontend e sito) | 1.29-alpine | 1.30 stabile, senza root | minor | decisione 8 |
| eclipse-temurin (backend) | 17-jre | 25-jre | maggiore | anche l'immagine di Jib, oggi `17-jre-focal` |
| maven (build del backend) | 3.9.6-eclipse-temurin-17 | 3.10.x con Temurin 25 | — | |
| node (build di frontend e sito) | 22-alpine | 26-alpine | maggiore | |
| Prometheus | 2.55.0 | 3.13 LTS | maggiore | solo sviluppo |
| Grafana | 11.3.0 | 13.3.x | maggiore | solo sviluppo |
| SonarQube | 10.7.0-community | Community Build 26.x | maggiore | solo sviluppo |
| Mailpit | 1.31.3 | 1.33.x | minor | solo sviluppo |
| JHipster Control Center | v0.5.0 (2021) | rimosso | — | abbandonato dal 2021: decisione 12 |
| Dev container | `vscode/devcontainers/java:0-17` | immagine `devcontainers/java` per Java 25 | maggiore | utente non root |

### CI e strumenti di sicurezza

| Componente | Attuale | Obiettivo | Note |
| --- | --- | --- | --- |
| actions/checkout | v4 | v7 | |
| actions/setup-node, setup-java, setup-python | v4, v4, v5 | v7, v6, v7 | |
| actions/upload-artifact, attest-build-provenance | v4, v1 | v7, v4 | |
| docker/build-push-action, login, metadata, setup-buildx | v5, v3, v5, v3 | v7, v4, v6, v4 | un riferimento a login era alla v1.9.0, trovato nella fase 1 |
| sigstore/cosign-installer | v3.5.0 | v4.x | con la v4 si installa cosign 3 |
| pnpm/action-setup | v4 | v6 | |
| aquasecurity/trivy-action | v0.36.0, Trivy 0.70.0 | ultima azione, Trivy 0.76.x | la versione di Trivy diventa esplicita |
| gitleaks | 8.21.2 | 8.30.x | |
| semgrep | 1.97.0 | 1.183.x | |
| Trivy nel runbook di test | 0.56.2 | uguale alla CI | |

## Decisioni

Proposte del 02/11/2026, approvate il 06/11/2026.

### 1. Ultima versione stabile, non l'ultima pubblicata

Si usa l'ultima versione **stabile**: niente milestone, release candidate, beta o versioni `next`. Se un componente non supporta ancora la versione più recente di un altro, si sceglie la più recente compatibile e la si elenca in [Eccezioni](#eccezioni-alla-versione-più-recente). Al momento di ogni fase si rileggono le patch: le versioni di questo documento sono il minimo, non un tetto.

### 2. Versioni maggiori un passo alla volta

Dove il produttore fornisce migrazioni automatiche, si sale una maggiore per volta: Angular e PrimeNG da 19 a 20, 21 e 22 con `ng update`; Astro da 5 a 6 e poi a 7; Spring Boot prima a 3.5, togliendo le deprecazioni, poi a 4.0 e a 4.1. Ogni passo compila e supera i test prima del successivo. Saltare direttamente all'ultima versione perderebbe le migrazioni automatiche intermedie.

### 3. Java 25 per il backend, la versione di Keycloak per il provider

Il backend passa a Java 25 LTS: build, immagini, Jib, CI e `java.version`. Il provider Keycloak gira dentro l'immagine di Keycloak e deve essere compilato per la versione di Java di quell'immagine, con `--release`. Un provider compilato per una versione più recente non verrebbe caricato. La versione si legge dall'immagine di Keycloak 26.8 al momento dell'implementazione.

### 4. Spring Boot 4.1 con JHipster framework 9.4

JHipster framework 9.4 è costruito su Spring Boot 4.1: le due versioni salgono insieme. Fanno parte della migrazione:

- Jackson 3: i package `com.fasterxml.jackson.core` e `databind` diventano `tools.jackson`, mentre le annotazioni restano in `com.fasterxml.jackson.annotation`. Riguarda 88 file. Non si usa il modulo di compatibilità con Jackson 2, per non dover fare la migrazione due volte.
- Hibernate 7 e Jakarta Persistence 3.2, nei 14 file che importano Hibernate.
- I nuovi nomi degli starter, per esempio `spring-boot-starter-aspectj` al posto di `spring-boot-starter-aop`.
- La rimozione di Undertow, non più supportato: oggi compare solo nel profilo Maven `eclipse`.
- Testcontainers 2 nei 10 file di test che lo usano.
- La rimozione del BOM di Spring Cloud, importato ma non usato da nessuna classe.

### 5. Angular e PrimeNG alla 21, con TypeScript 5.9

Approvata il 06/11/2026 come passo ad Angular 22 con PrimeNG 22 e TypeScript 6.0, rivista il 2026-11-08: per la licenza di PrimeNG 22, la fase 5 si chiude alla linea 21. Restano Angular 21 con TypeScript 5.9, PrimeNG 21, `@primeuix/themes` 2 e PrimeIcons 7, tutti MIT. PrimeNG 21 chiede Angular 21, e PrimeNG 22 è la prima versione che dichiara il supporto ad Angular 22: le due librerie salgono insieme. Il tema passa comunque a `@primeuix/themes`, che sostituisce `@primeng/themes`, deprecato. `docs/llms-full.md`, che `AGENTS.md` indica come riferimento, descriveva la 22 ed è rigenerato per la 21. Tailwind passa alla 4, perché `tailwindcss-primeui` 0.6 accompagna i temi nuovi. L'impatto riguarda 129 file che importano PrimeNG, 81 dei quali per `DynamicDialog`.

**Licenza di PrimeNG 22.** Dalla 22 PrimeNG, `@primeuix/themes` e `@primeuix/styles` 3 e PrimeIcons 8 non sono più MIT: si usano con la PrimeUI License. La sua Community License è gratuita per le organizzazioni con meno di un milione di dollari di ricavi annui e meno di cinque sviluppatori, per i singoli, per gli enti senza scopo di lucro e per i progetti open source non commerciali. Si rinnova ogni anno e chiede una chiave di licenza. Le versioni fino alla 21 restano MIT.

Taurus è GPLv3, che non permette di distribuire il programma combinato con una libreria sotto una licenza più restrittiva. Il 2026-11-08 è stata valutata la salita a PrimeNG 22 con un permesso aggiuntivo della sezione 7 della GPLv3, nella forma che la FAQ della GPL propone per le librerie incompatibili: Taurus resterebbe GPLv3, e chi lo distribuisce potrebbe combinarlo con le librerie PrimeUI. Per ora non si applica. Il testo proposto, da aggiungere in fondo a `LICENSE` e da citare nel README:

> Additional permission under GNU GPL version 3 section 7
>
> If you modify this Program, or any covered work, by linking or combining it with PrimeNG, PrimeIcons, @primeuix/themes or @primeuix/styles (or a modified version of those libraries), containing parts covered by the terms of the PrimeUI License, the licensors of this Program grant you additional permission to convey the resulting work.

Il testo non chiede di includere il codice delle librerie PrimeUI nel sorgente corrispondente: i termini PrimeUI vietano di ridistribuirle perché altri ci sviluppino, salvo con una licenza OEM. Il repository di Taurus non le contiene, le scarica `npm ci`.

- **Chiave.** La chiave è personale e non entra nel repository né nell'immagine pubblicata. Il frontend la legge all'avvio da `TAURUS_PRIMEUI_LICENSE`, che `docker-entrypoint.d/40-taurus-runtime-config.sh` scrive in `assets/config.json` come gli indirizzi dell'API e di Keycloak, e la passa a `providePrimeNG({ license })`. Nel browser la chiave resta leggibile, come in ogni applicazione PrimeNG: la configurazione a runtime evita solo di pubblicarla. Senza una chiave valida PrimeNG scrive un avviso in console e mostra un banner rosso.
- **Note di terze parti.** Un nuovo `taurus-fe/THIRD_PARTY_NOTICES.md` annota la PrimeUI License e viene copiato nell'immagine del frontend, come quello del backend per Liquibase.

**Scadenza della linea 21.** Angular 21 è in LTS dal 2026-06-03 e riceve solo correzioni critiche e di sicurezza fino a giugno 2027. Dopo la 21.1.10 del 2026-09-09 non sono uscite altre versioni gratuite di PrimeNG 21, mentre la 22 è arrivata alla 22.1.4; per le maggiori precedenti il `LICENSE.md` di PrimeNG prevede versioni `-lts` con licenza commerciale.

**Evolutiva successiva.** L'aggiornamento di PrimeNG, e di conseguenza di tutto ciò che questa decisione non permette di aggiornare, sarà oggetto di una successiva evolutiva. Comprende:

- PrimeNG 22, `@primeuix/themes` 3 e PrimeIcons 8, con le modifiche ai componenti descritte in [Passo ad Angular e PrimeNG 22](#passo-ad-angular-e-primeng-22);
- Angular, CLI e CDK 22 e keycloak-angular 22, che seguono PrimeNG;
- TypeScript 6.0 nel frontend, che Angular 21 non accetta;
- le 18 vulnerabilità moderate di `npm audit` nella catena della CLI di Angular, corrette nella CLI 22.1.

L'evolutiva sceglie fra PrimeNG 22 o successive con la PrimeUI License, un'altra libreria di componenti e un fork di PrimeNG 21, prima che Angular 21 esca dal supporto a giugno 2027.

**Scelta del 2026-11-13.** L'evolutiva adotta PrimeNG 22 con la PrimeUI License: il permesso aggiuntivo è in fondo a `LICENSE`, la chiave arriva da `TAURUS_PRIMEUI_LICENSE` e la licenza è annotata in `taurus-fe/THIRD_PARTY_NOTICES.md`. Rispetto al testo proposto sopra, il permesso nomina anche le altre librerie PrimeUI che PrimeNG 22 porta con sé (`@primeuix/styled`, `@primeuix/utils`, `@primeuix/motion`, `@primeicons/angular`, `@primeui/license-manager`), tutte con la stessa licenza. Il risultato è in [Esito del passo ad Angular e PrimeNG 22](#esito-del-passo-ad-angular-e-primeng-22).

### 6. Karma e Jasmine restano per ora

Karma è deprecato, ma `@angular/build` 22 lo supporta ancora. Migrare 99 file di test a Vitest nello stesso momento renderebbe impossibile capire se un test fallisce per l'aggiornamento o per la migrazione. La migrazione a Vitest è un lavoro a parte, da fare dopo questo. Diventa prioritaria se Karma riceve vulnerabilità senza correzione.

### 7. Dependabot con aggiornamenti raggruppati

Si aggiunge `.github/dependabot.yml`, gratuito, per Maven, npm, pnpm, pip, Docker e GitHub Actions in tutte le cartelle dei moduli. Le pull request sono settimanali e raggruppate per modulo: un gruppo per patch e minor, una pull request separata per ogni maggiore. Le azioni GitHub restano fissate per SHA del commit con la versione in commento, come in `docker-publish.yml` e come imposto dopo la manomissione dei tag di `trivy-action` del marzo 2026. Dependabot aggiorna sia lo SHA sia il commento.

### 8. nginx stabile e senza root

Frontend e sito informativo usano la linea stabile di nginx (le versioni pari, oggi la 1.30) nella variante senza privilegi `nginxinc/nginx-unprivileged`. Il container ascolta sulla porta 8080 e non sulla 80. Questo risolve DS-0002 di Trivy e cambia la porta interna nei compose, nei controlli di salute e negli esempi del reverse proxy. Il backend aggiunge `--no-install-recommends` all'installazione di `curl` (DS-0029).

### 9. Servizio OMR su Ubuntu 24.04 e Python 3.12

Audiveris 5.11.0, ultima versione, pubblica pacchetti solo per Ubuntu 22.04 e 24.04. Il servizio resta quindi su Ubuntu 24.04 e sul suo Python 3.12, supportato per la sicurezza fino al 2028. Tutte le librerie Python salgono all'ultima versione che homr 0.7.0 accetta. Se homr limita una maggiore, come OpenCV 5 o music21 10, resta la versione più recente ammessa e la si elenca in [Eccezioni](#eccezioni-alla-versione-più-recente). Il passaggio a Ubuntu 26.04 si fa quando esce il pacchetto di Audiveris. Prima del rilascio servono i test di accuratezza sul corpus in `accuracy/`.

Pillow fa eccezione, deciso il 2026-11-10: la 13 corregge 28 vulnerabilità e non cambia le funzioni che homr usa. Si installa quindi nonostante il limite `<13` di homr 0.7.0, con i test di accuratezza a garanzia (vedi [Pillow 13 nel servizio OMR](#pillow-13-nel-servizio-omr)).

### 10. PostgreSQL 18 con dump e ripristino

Il passaggio da 17 a 18 è una maggiore: i file dei dati non sono compatibili. La procedura è un `pg_dumpall` dal 17 e un ripristino nel 18, con il backend e Keycloak fermi. È più lenta di `pg_upgrade`, ma è la stessa per ogni installazione e non richiede entrambe le versioni nello stesso container. L'immagine `postgres:18` cambia anche il punto di montaggio del volume, da `/var/lib/postgresql/data` a `/var/lib/postgresql`: il compose va adattato. La procedura e il ritorno indietro vanno nel runbook operativo. Gli ambienti di sviluppo possono ricreare il volume.

### 11. RabbitMQ 4.4 dopo aver svuotato le code

Prima dell'aggiornamento si abilitano tutti i feature flag stabili e si verifica nella documentazione di RabbitMQ se il salto da 4.0 a 4.4 è diretto. Se non lo è, le code di Taurus contengono solo lavori ripetibili, come l'elaborazione dei PDF. Si può quindi lasciarle svuotare, fermare il nodo e ricrearlo con la 4.4 su un volume nuovo, invece di passare per ogni versione minore intermedia.

### 12. Rimozione di JHipster Control Center

`jhipster-control-center` è fermo alla v0.5.0 del 2021 e non riceve correzioni. Il suo compose di sviluppo viene rimosso. Prometheus e Grafana restano lo strumento di monitoraggio in sviluppo.

### 13. Sblocco immediato della CI

Le fasi maggiori richiedono settimane. Nel frattempo la fase 0 sblocca la pipeline senza spegnere il controllo:

- si applicano subito gli aggiornamenti patch e minor che correggono vulnerabilità senza cambiare API: pgjdbc, amqp-client, commons-beanutils, certifi, Pillow (dopo i test di accuratezza), le dipendenze transitive dei lockfile e i Dockerfile;
- le vulnerabilità che richiedono una maggiore vanno in `.trivyignore.yaml`, una per voce, con il motivo, la fase che la risolve e una scadenza `expired_at` di 60 giorni;
- alla scadenza la voce torna a far fallire la CI: o la fase è arrivata, o la scadenza si rinnova con una nuova motivazione nella pull request.

Le voci di `.trivyignore.yaml` vengono tolte dalla fase che risolve la vulnerabilità.

Dopo l'aggiornamento il file resta, senza voci, con le stesse regole. Una voce nuova serve solo quando la correzione non si può applicare subito: ha il motivo, l'aggiornamento che la toglierà e una scadenza di al massimo 60 giorni, e la pull request di quell'aggiornamento la toglie.

## Eccezioni alla versione più recente

| Componente | Versione scelta | Più recente | Motivo |
| --- | --- | --- | --- |
| TypeScript | 6.0 nel frontend e nel sito | 7.0 | Angular 22 richiede `>=6.0 <6.1`; `@astrojs/check` supporta fino alla 6 |
| Preset di PrimeNG | varianti `-compat` di `@primeuix/themes` 3 | preset standard | il font di base dell'applicazione è a 14 pixel, i preset standard della 3 lo assumono a 16. PrimeTek mantiene le varianti `-compat` fino a giugno 2027: il passaggio a 16 pixel è un lavoro a parte, da fare prima |
| Python e Ubuntu del servizio OMR | 3.12 / 24.04 | 3.15 / 26.04 | Audiveris non ha pacchetti per Ubuntu 26.04 |
| opencv-python-headless del servizio OMR | 4.14.0.94 | 5.0.0.93 | homr 0.7.0 richiede `<5`: decisione 9 |
| musicxml del servizio OMR | 1.4 | 1.6.3 | homr 0.7.0 richiede `==1.4`: decisione 9 |
| Java del provider Keycloak | 21, quella dell'immagine di Keycloak 26.8.2 | 25 | il provider gira nella JVM di Keycloak |
| Prometheus | 3.13 LTS | 3.15 | la 3.15 esce dal supporto il 06/11/2026; la LTS è supportata fino a luglio 2027 |
| Karma | 6.4 | — | deprecato senza successore diretto: decisione 6 |
| Jasmine nei test del frontend | 4.6.1 durante i test; 6.3 nel `package.json` | 7.0 | karma-jasmine 5.1.0, ultima versione, dipende da `jasmine-core` ^4.1 e carica la propria copia, la 4.6.1; quella del `package.json` serve a `karma-jasmine-html-reporter`. Forzando la versione con `overrides`, Jasmine 7 non parte con la patch di zone.js (`Cannot assign to read only property 'describe'`) e Jasmine 6 ferma la suite dopo 112 test, su una promise rifiutata senza gestione. Dependabot esclude dalla 7 `jasmine-core` e `@types/jasmine`, che restano alla 6. Si risolve con la migrazione a Vitest della decisione 6 |

## Fasi

Ogni fase è una pull request separata, di un solo modulo, come chiede `AGENTS.md`. L'ordine è quello consigliato. Le fasi 2–6 sono indipendenti fra loro e possono procedere in parallelo, anche in sessioni diverse.

| Fase | Contenuto | Moduli | Vulnerabilità risolte |
| --- | --- | --- | --- |
| 0 | Sblocco della CI (decisione 13) | tutti | patch e minor, Dockerfile |
| 1 | Azioni GitHub alle nuove versioni maggiori, già fissate per SHA dalla fase 0; Trivy, gitleaks e semgrep aggiornati, Dependabot | repository | — |
| 2 | Servizio OMR: librerie Python | `taurus-omr` | 29 |
| 3 | Provider e immagine Keycloak 26.8 | `keycloak-authenticator`, compose | 3, emerse nella fase 1 |
| 4a | Backend: Java 25, Spring Boot 3.5, JHipster 8.12, librerie e plugin, API deprecate | `taurus-be` | 72 delle 73 voci del backend in `.trivyignore.yaml` |
| 4b | Backend: Spring Boot 4.0 → 4.1, JHipster 9.4, Jackson 3, Hibernate 7, Testcontainers 2, Liquibase 5, springdoc-openapi 3 | `taurus-be` | le 2 di spring-webmvc |
| 5 | Frontend: Node 26, Angular e PrimeNG 20 → 21, Tailwind 4, librerie; la 22 in un'evolutiva successiva (decisione 5) | `taurus-fe` | 38 |
| 6 | Sito informativo: Node 26, pnpm 12, Astro 6 → 7 | `taurus-info` | 14 |
| 7 | Servizi: PostgreSQL 18, RabbitMQ 4.4, nginx senza root, monitoraggio | compose, `deploy/`, Dockerfile | 4 configurazioni |
| 8 | Documentazione e chiusura: runbook, `AGENTS.md`, README, `.trivyignore.yaml` vuoto | repository | — |

La fase 4 è divisa in due pull request, scelte il 2026-11-07. La 4a fa il primo passo della decisione 2: Spring Boot 3.5 senza API deprecate, insieme a Java 25. La 4b fa i due passi successivi, a Spring Boot 4.0 e 4.1, con le migrazioni della decisione 4.

### Esito della fase 0

Applicata e verificata il 2026-11-06 sul ramo `update-versions`; i commit per modulo sono descritti in [Stato dei lavori](#stato-dei-lavori). Trivy 0.70.0, la versione della CI, trovava 90 vulnerabilità e 4 configurazioni: ne restano 45 e 3, tutte in `.trivyignore.yaml` con scadenza 2027-01-05. Il job `security` legge il file con l'input `trivyignores` di `trivy-action`, e il comando del [Runbook di test](runbook-test.md) usa la stessa versione di Trivy e lo stesso file.

- Backend: pgjdbc 42.7.14, amqp-client 5.37.1, commons-beanutils 1.11.0 e `--no-install-recommends` nel Dockerfile. Resta la CVE di Actuator, corretta da Spring Boot 3.5.12 (fase 4). Nei test, la cache dei contesti di Spring è limitata a 8: senza limite gli IT esaurivano l'heap, un difetto già presente prima della fase 0 (vedi [Memoria esaurita negli IT del backend](#memoria-esaurita-negli-it-del-backend)).
- Frontend: Angular 19.2.25 e strumenti di build 19.2.27, ultime della 19, che correggono 9 delle 18 segnalazioni di Angular; PrimeNG e `@primeng/themes` 19.1.4; postcss 8.5 e le dipendenze transitive del lockfile. Restano le altre 9 di Angular, corrette solo dalla 20.3, e quella di `ngx-extended-pdf-viewer` (fase 5). Il lockfile porta anche Playwright 1.65 ed ESLint 9.39, dentro gli intervalli del `package.json`: i browser di Playwright vanno reinstallati. In PrimeNG 19.1 ToggleButton ha perso il ruolo di pulsante, che `ToggleButtonRoleDirective` gli restituisce (vedi [Suite end to end](#suite-end-to-end)).
- Sito informativo: devalue, js-yaml, source-map-js, svgo e vite alle versioni corrette. Restano Astro e sharp 0.34, l'ultima linea che Astro 5 accetta (fase 6).
- Servizio OMR: certifi 2026.10.23. Pillow resta alla 12.3.0 per il vincolo di homr (vedi [Pillow 13 nel servizio OMR](#pillow-13-nel-servizio-omr)).
- Dockerfile: restano le immagini nginx e il dev container che girano come root (fase 7).
- CI: le sette azioni GitHub che usavano un tag (`actions/checkout`, `setup-node`, `setup-java`, `setup-python`, `upload-artifact`, `attest-build-provenance` e `pnpm/action-setup`, 29 riferimenti) sono fissate per SHA del commit a cui portava il loro tag maggiore, con la versione in commento: nessuna versione cambia. Le segnalava semgrep (vedi [Stato dei lavori](#stato-dei-lavori)).

Trivy risolve le dipendenze del `pom.xml` scaricando i POM da Maven Central e non sempre ci riesce: due esecuzioni sullo stesso file possono dare risultati diversi. Il confronto vale sul report completo, quello che elenca anche Spring Boot e il driver PostgreSQL. Nemmeno quel report era completo: vedi [Esito della fase 1](#esito-della-fase-1).

### Esito della fase 1

Applicata e verificata il 2026-11-07 sul ramo `upgrade-phase-1`, che parte da `0dc1d7d`.

- **Azioni GitHub.** Ogni azione è all'ultima release della sua versione maggiore più recente, fissata per SHA del commit con la versione in commento: `actions/checkout` 7.0.1, `setup-node` 7.1.0, `setup-java` 6.2.0, `setup-python` 7.1.0, `upload-artifact` 7.0.2, `attest-build-provenance` 4.2.2, `pnpm/action-setup` 6.1.1, `docker/setup-buildx-action` 4.4.1, `login-action` 4.8.0, `metadata-action` 6.2.0, `build-push-action` 7.4.0 e `sigstore/cosign-installer` 4.1.3. `trivy-action` era già all'ultima, la 0.36.0. Gli SHA vengono da `git ls-remote` sui tag, con i tag annotati risolti al loro commit. In `docker-publish.yml` un riferimento a `login-action` era ancora alla 1.9.0, senza commento.
- **Cambi di comportamento.** Le note di rilascio non chiedono modifiche ai workflow. Le azioni girano su Node 24, che chiede un runner 2.327.1 o successivo, come quelli di GitHub. `setup-node` dalla v5 attiva da sé la cache quando `package.json` dichiara `packageManager`, e dalla v6 solo per npm: i job del frontend e del sito la configurano già, gli altri due non hanno un `package.json`. `checkout` 7 rifiuta il checkout delle pull request da fork negli eventi `pull_request_target`, che nessun workflow usa. `attest-build-provenance` 4 si appoggia ad `actions/attest` e accetta lo stesso `subject-path`.
- **Firme delle immagini.** `cosign-installer` 4 installa cosign 3, oggi la 3.1.4. `docker-publish.yml` non fissa più `cosign-release: v2.2.4`, così cosign segue l'installer, che Dependabot aggiorna. Il comando di firma, `cosign sign --yes` sull'immagine per digest, non cambia; cosign 3 però salva la firma come referrer OCI 1.1, nel formato bundle nuovo, e chi verifica le immagini deve usare cosign 3. Nessuna procedura del progetto le verifica. `docker-publish.yml` gira solo ai tag `v*.*.*`, e `cie-trust-anchors.yml` una volta al mese o a mano: le loro prime esecuzioni con le azioni nuove saranno il prossimo rilascio e il prossimo aggiornamento delle ancore. Finora li ha controllati solo actionlint.
- **Strumenti di sicurezza.** Trivy 0.76.2, ora esplicita nell'input `version` di `trivy-action`; gitleaks 8.30.1 e semgrep 1.183.0, fissati per tag e digest. Per semgrep è la versione del tag `latest` su Docker Hub: la 1.184.0 è ancora solo nel canale canary. Il [Runbook di test](runbook-test.md), sezione 8.7, usa le stesse versioni. Dependabot non vede le immagini dentro `run` né l'input `version`: le tre versioni si aggiornano a mano, insieme al runbook.
- **Maven nel job `security`.** Dalla 0.71 Trivy si ferma con un errore quando Maven Central risponde 429, come è successo nelle prove locali; prima saltava in silenzio le dipendenze che non riusciva a risolvere. Trivy cerca i POM prima nel repository Maven locale, quindi il job installa Java 17 con la cache Maven del job `backend` ed esegue `dependency:resolve` nei due moduli Java prima della scansione.
- **Vulnerabilità emerse.** Con tutte le dipendenze risolte Trivy trova 75 vulnerabilità nel `pom.xml` del backend, con 72 identificativi, e 3 in quello del provider. Trivy 0.70.0 sullo stesso repository locale trova le stesse: nella fase 0 le dipendenze transitive degli starter di Spring Boot restavano fuori dalla scansione senza errori. Nel backend sono Tomcat 10.1.31 (24), Jackson 2.17.2, Netty 4.1.114, Spring Framework 6.1.14, Spring Security 6.3.4, Spring Boot e Spring Data 3.3.5, Micrometer 1.13.6 e Thymeleaf 3.1.2, corrette da Spring Boot 3.5 e 4 (fase 4); json-smart 2.5.1, che arriva solo nei test con `spring-boot-starter-test`; async-http-client 2.10.4 e jose4j 0.7.0, che arrivano con `nl.martijndwars:web-push` 5.1.1, ultima versione della libreria: la fase 4 deve forzarle a una versione corretta o sostituire la libreria. Nel provider sono Spring Boot 4.0.2 e Spring Framework 7.0.3, da `spring-boot-starter` 4.0.2 del suo `pom.xml` (fase 3). Sono tutte in `.trivyignore.yaml`, una voce per identificativo con la fase che la risolve e scadenza 2027-01-06, come chiede la decisione 13.
- **gitleaks 8.30.** La regola `generic-api-key` dà 5 falsi positivi in due test del backend: prende per valore la parola dopo un identificatore che contiene «key», come nel record `Issued(PrivateKey key, …)` di `CieSignTestSupport` e nei filtri `"key.contains=" + DEFAULT_KEY` di `PreferencesResourceIT`. I due file sono nell'allowlist di `.gitleaks.toml`.
- **Dependabot.** `.github/dependabot.yml` ha 13 blocchi: le azioni GitHub; Maven, npm e i Dockerfile dell'immagine e del dev container del backend; Maven del provider; npm e Dockerfile del frontend; npm, che legge anche `pnpm-lock.yaml`, Dockerfile e compose del sito; pip e Dockerfile del servizio OMR; il compose di `deploy/`. Ogni blocco gira il lunedì alle 6 (Europe/Rome) e raggruppa patch e minor in una pull request; ogni maggiore arriva in una pull request a sé. `cooldown` aspetta 7 giorni dalla pubblicazione di una versione: è il minimo della regola `dependabot-missing-cooldown` del set `p/ci` di semgrep, che con 3 giorni dava 13 segnalazioni, una per blocco. Gli aggiornamenti di sicurezza non aspettano. I compose di sviluppo del backend, in `src/main/docker`, hanno nomi che Dependabot non riconosce come compose: le loro immagini restano alla fase 7 e agli aggiornamenti a mano.
- **Prima esecuzione di Dependabot.** Al merge Dependabot ha girato subito in tutti i blocchi e ha aperto 26 pull request, dalla #121 alla #146: quasi tutte sono le maggiori delle fasi 2–6. Cinque proponevano versioni che la specifica esclude: Node 25, che non è LTS, nel frontend e nel sito (#125, #124); Maven con Temurin 26 nel backend (#121); Ubuntu 26.04 nel servizio OMR (#122); Pillow 13 (#145). Il gruppo di patch e minor dell'OMR (#138) porta anche musicxml dalla 1.4 alla 1.6.3, che homr 0.7.0 fissa a `==1.4`. Le cause sono due. Per le immagini Docker `cooldown` conta dall'ultimo push del tag su Docker Hub: `node:26-alpine`, ripubblicato il 5 novembre, era ancora in attesa, mentre `node:25-alpine`, fermo da aprile, è passato. Nel tag `maven:3.9.6-eclipse-temurin-17` Dependabot legge il numero di Java come parte della versione, quindi sceglie sempre la Java più alta. La #123, Temurin 25 per l'immagine del backend, è corretta ma appartiene alla fase 4. music21 non dipende da homr: la 10 (#140) resta un obiettivo della fase 2.
- **Esclusioni di Dependabot.** Dopo la prima esecuzione, il ramo `fix-dependabot-rules` aggiunge a `.github/dependabot.yml` regole `ignore` per le versioni che la specifica esclude. Nel backend: solo Java LTS per `eclipse-temurin`, dalla 26 alla 28 escluse, e nessun aggiornamento automatico dell'immagine `maven`. Nel frontend e nel sito: Node 25; le minor dispari di nginx, cioè la linea mainline, anche per `nginxinc/nginx-unprivileged` della decisione 8; TypeScript dalla 6.1 nel frontend, perché Angular 22 chiede `<6.1`, e dalla 7 nel sito. Nel servizio OMR: Ubuntu dopo la 24.04, comprese le versioni intermedie non LTS; i limiti che homr 0.7.0 dichiara su nove librerie fissate nei requisiti (Pillow, opencv-python-headless, musicxml, numpy, onnxruntime, rapidocr, requests, typing-extensions, types-Pillow), che Dependabot non ricava da solo. Nel frontend un gruppo raccoglie in una pull request le maggiori di Angular, dei suoi strumenti, di PrimeNG e di keycloak-angular, che cambiano maggiore insieme con `ng update`: la prima esecuzione ne aveva aperte quattro, una per pacchetto Angular (#133–#136). Secondo `ignore_condition.rb` di dependabot-core, un'esclusione con le versioni vale anche per gli aggiornamenti di sicurezza; quella di `maven`, senza versioni, solo per gli aggiornamenti di versione.
- **Seconda esecuzione di Dependabot.** Il merge `e5b4b8b` della #147 ha fatto girare di nuovo Dependabot, che ha chiuso da solo le sei pull request escluse: #121, #122, #124, #125, #145 e #138, sostituita dalla #150 senza musicxml né Pillow. Restavano tre problemi. Il primo è Node 23 nel frontend e nel sito (#149, #148): `node:23-alpine` è fermo dal 2025-05-31 e supera `cooldown`, mentre `24-alpine` e `26-alpine`, ripubblicati il 2026-11-05, sono ancora in attesa. Il secondo è il gruppo delle maggiori di Angular, che non ha aperto nessuna pull request: le quattro singole (#133–#136) restavano aperte, come Astro 7 nel sito (#131). Sono salti di più maggiori, che la decisione 2 esclude. Il terzo sono le versioni che funzionano solo con la maggiore successiva del framework: zone.js 0.16 nel gruppo del frontend (#132), con cui `npm ci` si ferma perché Angular 19 chiede `~0.15.0`, e springdoc-openapi 3 nel backend (#139), la linea per Spring Boot 4. Entrambe hanno la CI rossa.
- **Maggiori a mano.** Il ramo `fix-dependabot-majors` toglie il gruppo delle maggiori di Angular. Come chiede la decisione 2, ignora le maggiori di Angular, dei suoi strumenti, di PrimeNG e di keycloak-angular nel frontend, di Astro e delle integrazioni `@astrojs/*` nel sito e di Spring Boot nel backend; minor e patch restano nei gruppi. Ignora anche le maggiori di springdoc-openapi e, nel frontend, le minor e le maggiori di TypeScript, zone.js e tailwindcss-primeui, che seguono Angular e PrimeNG: TypeScript non segue semver e nelle versioni 0.x la minor è una maggiore. La regola su TypeScript sostituisce quella dalla 6.1. Per Node esclude dalla 23 alla 25 e la 27: restano le LTS pari dalla 26. Secondo `ignore_condition.rb`, le regole con `update-types` valgono solo per gli aggiornamenti di versione, non per quelli di sicurezza. La #137, il gruppo Maven del backend, si ferma in `./mvnw verify`: il log richiede l'accesso al repository, e il suo contenuto, Maven 3.10 e i plugin, appartiene alla fase 4.
- **Terza esecuzione di Dependabot.** Il merge `f02bae8` della #151 ha fatto chiudere a Dependabot #131, #132, #133–#136, #139, #148 e #149. Ha chiuso anche la #137, sostituita dalla #157: con le maggiori di Spring Boot ignorate, il gruppo Maven del backend contiene ora Spring Boot 3.5.16, il primo passo della decisione 2, e springdoc-openapi 2.10.0. La sua CI si ferma in `./mvnw verify` e nella scansione di Trivy: è lavoro della fase 4. Nel frontend sono arrivate cinque pull request. Il gruppo di patch e minor (#152), con zone.js 0.15.1, supera `npm ci` e si ferma in `npm run test:coverage`. Tailwind 4 (#153) si ferma allo stesso passo ed è una maggiore della fase 5. eslint-config-prettier 10 (#154) e primeicons 8 (#155) hanno la CI verde. jasmine-core 7 (#156) si ferma in `npm ci`, perché `karma-jasmine-html-reporter` 2.1 accetta Jasmine fino alla 5; la 2.3 della #152 arriva alla 7. Probabilmente queste maggiori non comparivano prima perché il frontend era già al limite predefinito di cinque pull request aperte per blocco, con la #132 e le quattro di Angular.

### Esito della fase 2

Applicata e verificata il 2026-11-07 sul ramo `upgrade-phase-2`, che parte da `f02bae8`.

- **Motori.** homr 0.7.0, RapidOCR 3.10.0 e Audiveris 5.11.0 sono ancora le ultime versioni, quindi valgono gli stessi limiti di homr. `homr --init` scarica gli stessi modelli e `models.sha256` non cambia.
- **Versioni.** I tre file dei requisiti sono rigenerati insieme in Python 3.12 da `pip freeze`, partendo dalle dipendenze di `pyproject.toml`, da homr 0.7.0, da pytest e httpx per i test e dagli strumenti di rendering del corpus. Ogni libreria è all'ultima versione che homr accetta e che è pubblicata da almeno sette giorni, come chiede `cooldown` per Dependabot (decisione 7); l'opzione `--uploaded-prior-to 2026-10-31T18:00:00Z` di pip esclude le più recenti. Nel servizio: music21 da 9.7.1 a 10.5.2, FastAPI da 0.143.3 a 0.162.0, Starlette da 1.8.0 a 1.10.0, Pydantic 2.14.2 con pydantic-core 2.50.2, python-multipart 0.0.33, ONNX Runtime 1.31.1, python-dateutil 3.0.0 con la nuova dipendenza `tzdata` 2026.6, chardet 7.7.0, fonttools 4.68.0 e opentelemetry-api 1.45.2. Nei test, pytest 9.2.0; nel rendering del corpus, verovio 6.4.0, brotli 1.2.1 e pycparser 3.12. setuptools sale alla 84.2.1 in `pyproject.toml`. Sono le versioni delle pull request di Dependabot #150, #140, #142 e #144. pip, che Dependabot non vede dentro `RUN`, sale alla 26.2.2 nel Dockerfile. Restano fuori, perché pubblicate da meno di sette giorni, FastAPI 0.162.2, Pydantic 2.14.3, python-dateutil 4.0.0, anyio 4.16.0, click 8.5.1, typing-inspection 0.4.5, verovio 6.4.1 e pip 26.3: arriveranno con Dependabot.
- **Limiti di homr.** Pillow resta alla 12.3.0, opencv-python-headless alla 4.14.0.94 e musicxml alla 1.4, tutte elencate in [Eccezioni](#eccezioni-alla-versione-più-recente). Delle 29 vulnerabilità del servizio, certifi è stata corretta nella fase 0, mentre le 28 di Pillow restano in `.trivyignore.yaml` finché homr non accetta Pillow 13: la fase 2 non ne risolve altre. music21 non è una dipendenza di homr, quindi sale alla 10. La conversione MIDI e i suoi test non cambiano, e `/v1/health` riporta music21 10.5.2.
- **Accuratezza.** Sull'immagine nuova, con le restrizioni di `omr.yml`, i test di accuratezza danno gli stessi risultati di prima: 132 battute su 151 corrette con Audiveris (87%) e 124 con homr (82%), segni di struttura 15 e 6 su 26, nomi delle parti 6 su 6.

### Esito della fase 3

Applicata e verificata il 2026-11-07 sul ramo `upgrade-phase-3`, che parte da `3d4b45b`.

- **Versioni.** Keycloak 26.8.2 nelle SPI del provider, nei compose di sviluppo e di produzione, in `deploy/.env.example` e nei Testcontainers dei tre IT del provider e dei due IT del backend che usano Keycloak. È uscita il 2026-11-05, quindi da meno di sette giorni, ma è un rilascio di sicurezza, che per la decisione 7 non aspetta: corregge, fra le altre, una XSS memorizzata nella pagina di accesso e un furto di account. Nel provider salgono anche il parent Spring Boot alla 4.1.2, FreeMarker alla 2.3.35, la versione che Keycloak 26.8.2 porta a runtime e che `EmailTemplatesTest` usa per rendere i modelli, il wrapper Maven alla 3.10.0 e i plugin compiler 3.16.0, jar 3.5.1 e resources 3.5.0. Sono le versioni della #129 di Dependabot, che proponeva Keycloak 26.8.1.
- **Java.** L'immagine di Keycloak 26.8.2 gira su OpenJDK 21.0.13: il provider si compila con `release` 21 al posto di `source` e `target` 17, come chiede la decisione 3, e le classi del JAR sono nella versione 65. Serve un JDK 21, quindi i job `keycloak` di `verify.yml` e `publish-provider` di `docker-publish.yml` installano Java 21; `backend` e `security` restano su Java 17, che basta a `dependency:resolve`. Il compilatore di Maven non ricompila quando cambia solo `release`: dopo l'aggiornamento serve `clean verify`, come già indica il [Runbook di test](runbook-test.md).
- **Vulnerabilità.** Spring Boot 4.1.2 corregge le tre vulnerabilità del provider emerse nella fase 1, CVE-2026-41850 di spring-expression 7.0.3 e CVE-2026-40973 e CVE-2026-40976 di spring-boot 4.0.2: le loro voci escono da `.trivyignore.yaml`. Le voci con gli stessi identificativi per il backend restano alla fase 4.
- **Tema.** I modelli `keycloak.v2` e `base` di 26.6.4 e 26.8.2, estratti dalle immagini, cambiano poco per il tema Taurus. La macro `registrationLayout` ha gli stessi parametri e le stesse sezioni del nostro `template.ftl`. Nei modelli che il tema sostituisce cambia solo la macro `buttons`, che i nostri non usano. `login-update-profile.ftl` e `login-verify-email.ftl` sono nuovi in `keycloak.v2`, prima arrivavano da `base`, e funzionano con il nostro layout. Fra i messaggi italiani c'è una chiave nuova; i modelli delle e-mail che Taurus usa sono identici. La versione nuova non chiede modifiche al tema; quelle della fase correggono difetti già presenti.
- **Prova a mano.** Su un Keycloak 26.8.2 usa e getta, con il JAR della build, il realm di Taurus e Mailpit, nel browser integrato: accesso con nome utente e con e-mail; scelta di tenant e ruolo con due tenant e due ruoli, scelta automatica con un tenant e un ruolo; configurazione dell'app di autenticazione e accesso con il codice, con l'errore su un codice sbagliato; recupero della password dall'e-mail fino alla password nuova, con l'errore su due password diverse; invito con l'e-mail di configurazione dell'account e scelta della password; pagine di aggiornamento del profilo e di verifica dell'e-mail; prova SMTP. Le e-mail hanno oggetto italiano, mittente «Taurus», logo e colori dello [standard delle e-mail](email-layout-standard.md). La registrazione, spenta nel realm, è stata accesa solo nel realm di prova per vedere la pagina. Nel log di Keycloak nessun errore dei modelli; gli avvisi `KC-SERVICES0047` sulle SPI interne compaiono anche nel Keycloak 26.6.4 di sviluppo.
- **Difetti già presenti, corretti.** La prova a mano li ha trovati, ma i modelli e i messaggi coinvolti sono identici in 26.6.4: non sono regressioni. Nella configurazione dell'app di autenticazione i nomi delle app comparivano come chiavi, `totpAppGoogleName` e le altre, perché `login-config-totp.ftl` stampava `${app}` dove il tema base usa `${msg(app)}`. Nella stessa pagina «Non riesci a scansionare il codice QR?» compariva due volte, come testo e come link, e senza script il link riapriva la pagina del codice QR. Ora compare una volta e porta a `totp.manualUrl`: la stessa pagina in modo manuale, con il codice da inserire già in vista e il modo conservato nel form. Nel recupero della password il ritorno all'accesso si leggeva «← « Torna al Login», perché il tema aggiungeva una freccia al messaggio, che ha già «: la freccia del tema è tolta. Le pagine che vengono da `base` e `keycloak.v2`, cioè conferma dell'uscita, informazione, errore, pagina scaduta, aggiornamento del profilo, verifica dell'e-mail e registrazione, usano classi di PatternFly 5 che `login.css` non definiva: campi e pulsanti avevano lo stile predefinito del browser e il titolo era testo semplice. Ora `login.css` dà a titolo, testi, campi, messaggi di errore e pulsanti di quelle pagine la forma delle pagine Taurus, senza caricare PatternFly; il pulsante per mostrare la password delle pagine `keycloak.v2`, che dipende da uno script che il tema non carica, è nascosto. Nei messaggi italiani del tema tornano gli accenti di «È necessario» e «non è valido». Due contrasti, visti nella stessa prova, restavano sotto il 4,5:1 di WCAG 2.1 AA: il testo degli avvisi gialli, 3,1:1 sul loro fondo, e il rosso dei messaggi di errore e degli asterischi, 3,8:1 sul bianco. Passano a 4,8:1 entrambi, e il testo degli avvisi di errore da 4,4:1 a 5,9:1. Resta com'è il recupero della password che toglie anche l'app di autenticazione, da configurare di nuovo al primo accesso: il flow di reimpostazione del realm ha `reset-otp` senza configurazione, come quello predefinito di Keycloak.
- **Runbook.** Il [Runbook operativo](runbook-operativo.md) descrive l'aggiornamento di Keycloak e il ritorno indietro (§8.5): la versione nuova aggiorna lo schema di `taurus_keycloak` all'avvio e non si torna indietro senza il backup preso prima. Il [README del deploy](../deploy/README.md) ci rimanda. Anche il Keycloak di sviluppo aggiorna il proprio database al primo avvio con `keycloak.yml`, quindi il JAR in `realm-config` va ricompilato e copiato insieme.

### Esito della fase 4a

Applicata e verificata il 2026-11-08 sul ramo `upgrade-phase-4a`, che parte da `385acb0`.

- **Versioni.** Spring Boot 3.5.16, l'ultima 3.5, porta Spring Framework 6.2.19 e Spring Security 6.5.11. JHipster framework passa alla 8.12.0, l'ultima 8.x, e springdoc-openapi alla 2.10.0: sono le versioni della #157 di Dependabot.
  - Librerie: ArchUnit 1.5.1, MapStruct 1.6.3, ical4j 4.4.0, PDFBox e pdfbox-tools 3.0.8, openhtmltopdf 1.1.105 (costruito su PDFBox 3.0.8), ZXing 3.5.4, Apache POI 6.0.0, commons-csv 1.14.1, commons-compress 1.28.0, jbig2-imageio 3.0.5 e web-push 5.1.2.
  - Plugin: compiler 3.16.0, surefire e failsafe 3.6.1, enforcer 3.7.0, jar 3.5.1, javadoc 3.12.0, resources 3.5.0, clean 3.5.0, site 3.22.0, war 3.5.1, properties 1.3.1, JaCoCo 0.8.16, Checkstyle 14.4.0, Spotless 3.10.4, Jib 3.5.2, git-commit-id 10.0.1, modernizer 3.5.0 e Sonar 5.8.0.7211.
  - Il wrapper Maven passa alla 3.10.0.

  Tutte le versioni sono pubblicate da almeno sette giorni, come chiede la decisione 7. Il BOM di Spring Cloud è tolto, perché nessuna classe lo usava. Testcontainers resta alla 1.21.4, che ora gestisce Spring Boot.
- **Patch sopra Spring Boot.** Spring Boot 3.5.16 è del 2026-06-25 e gestisce Tomcat 10.1.55, Netty 4.1.135 e Jackson 2.21.4. Le loro vulnerabilità sono corrette da Tomcat 10.1.58, Netty 4.1.137 e Jackson 2.21.7.
  - Il `pom.xml` alza le proprietà di Spring Boot alle ultime patch delle stesse linee: Tomcat 10.1.61, Netty 4.1.139 e Jackson 2.21.8.
  - Fa lo stesso con il driver PostgreSQL 42.7.14, già dalla fase 0.
  - Le quattro proprietà si tolgono nella fase 4b, con Spring Boot 4.1.
- **Web Push.** web-push 5.1.2 è ancora l'ultima versione e dichiara le sue dipendenze solo a runtime. Porta async-http-client 2.12.4 e jose4j 0.7.9, entrambe vulnerabili.
  - `PushServiceImpl` usa `PushService`, che invia con Apache HttpAsyncClient. async-http-client serve solo a `PushAsyncService` ed è escluso.
  - Il codice usa `HttpResponse` di httpcore 4 e `JoseException` di jose4j, che con lo scope runtime non si compilano più. Diventano dipendenze dirette: httpcore 4.4.16 nella versione gestita e jose4j alla 0.9.7.
  - Nessun test copre l'invio. Una prova con il classpath del backend e Java 25 ha inviato a un server HTTP locale una notifica come quelle di `PushServiceImpl`. Il server ha risposto 201 e ha ricevuto il payload cifrato (`aesgcm`), con un JWT VAPID che jose4j 0.9.7 verifica con la chiave pubblica.
- **Apache POI 6.** POI 6.0.0 chiede commons-io 2.22.0 e commons-collections4 4.6.0. Le due versioni sono fissate in `dependencyManagement`: senza, Maven sceglierebbe le versioni più vecchie, che arrivano prima nell'albero con Liquibase.
- **Thymeleaf 3.1.5.** Rifiuta gli apostrofi nei parametri delle espressioni di frammento, sia scritti `\'` sia nei letterali `|...|`.
  - Quattro testi di `signature-link.html` e `signature-signed.html`, come «L'associazione ti chiede di firmare…», fermavano le e-mail di firma con `TemplateProcessingException`.
  - Ora il testo arriva al frammento da una variabile di `th:with`, che gli apostrofi li accetta. Il commento che lo spiega è un commento di Thymeleaf (`<!--/* */-->`), quindi non finisce nelle e-mail.
  - `SignatureMailServiceTest` controlla i quattro testi nelle e-mail generate.
- **Liquibase.** Da Spring Boot 3.5 `LiquibaseProperties` restituisce contesti ed etichette come liste. `LiquibaseConfiguration` e `TenantSchemaProvisioningService` le uniscono con le virgole. Liquibase resta alla 4.31.1 gestita da Spring Boot fino alla fase 4b.
- **API deprecate.** Prima del passo a Spring Boot 4 sono tolte le API che Spring Boot 3.5 e le librerie nuove deprecano (decisione 2):
  - `@MockitoBean` e `@MockitoSpyBean` al posto di `@MockBean` e `@SpyBean`, in 37 file di test;
  - in `SecurityConfiguration`, `PathPatternRequestMatcher` al posto di `AntPathRequestMatcher` e `permissionsPolicyHeader` al posto di `permissionsPolicy`;
  - `UriComponentsBuilder.fromUriString` al posto di `fromHttpUrl`, in quattro risorse REST;
  - `useFastMode()` di openhtmltopdf tolto dal PDF del foglio di affidamento: è deprecato e non fa più niente, perché la modalità veloce è quella predefinita;
  - `management.endpoint.jhimetrics.access: unrestricted` al posto di `enabled: true`.

  Negli 11 test `*SecurityConfigurationTest` cambiano solo le annotazioni dei mock, e `@SuppressWarnings("removal")` non serve più. La compilazione con Java 25 non dà avvisi di deprecazione.
- **Prometheus.** Spring Boot 3.5 non configura più `micrometer-registry-prometheus-simpleclient`, deprecato dalla 3.3: senza modifiche `/management/prometheus` sparirebbe.
  - Il backend passa a `micrometer-registry-prometheus`, con il client Prometheus 1.x.
  - La prova ha usato i binder delle metriche JVM, di sistema e di Logback e un timer `http.server.requests`: i due registri espongono gli stessi 31 nomi. La dashboard `JVM.json` di Grafana non risente del cambio.
  - Una parte dei suoi pannelli usa però nomi che nessuno dei due registri espone. Per esempio `jvm_classes_loaded` e `jvm_threads_live` al posto di `jvm_classes_loaded_classes` e `jvm_threads_live_threads`, o le metriche di memoria del processo di una libreria che il backend non ha. È un difetto già presente, che resta al monitoraggio della fase 7.
- **Java 25.** Con `java.version` 25 il compilatore usa `release` 25, e l'enforcer accetta solo un JDK 25.
  - Immagini: Jib usa `eclipse-temurin:25-jre` al posto di `17-jre-focal`. Il `Dockerfile` usa `maven:3.10.0-eclipse-temurin-25` per la build e `eclipse-temurin:25-jre` per l'esecuzione, come proponeva per l'immagine finale la #123 di Dependabot.
  - CI: i job `backend` e `security` di `verify.yml` installano Java 25.
  - modernizer 3.5.0 usa la versione di Java del progetto, chiede le API più recenti e ferma la build alla fase `package`. 54 punti del codice passano a `String.formatted`, `Path.of`, `Reader.of`, `List.of`, `Set.of` e `Map.of`.
  - Il dev container resta su Java 17: la sua immagine con utente non root è nella fase 7, come la voce DS-0002 di `.trivyignore.yaml`.
- **Vulnerabilità.** Senza `.trivyignore.yaml`, Trivy 0.76.2 come nella CI trova nel backend solo due vulnerabilità critiche di spring-webmvc 6.2.19.
  - CVE-2026-47884 era già fra le voci della fase 1.
  - CVE-2026-47890 riguarda solo le linee 6.2 e 7.0 ed è comparsa con il passaggio da Spring Framework 6.1 a 6.2.
  - Per entrambe la correzione pubblica è solo nella 7.0.9, che arriva con Spring Boot 4 nella fase 4b.

  Le voci del backend in `.trivyignore.yaml` erano 73: la CVE di Actuator della fase 0 e le 72 della fase 1. Ne escono 72. Restano CVE-2026-47884 e la nuova CVE-2026-47890, con scadenza 2027-01-06 e 2027-01-07. Con il file Trivy non trova niente nel backend.
- **Test e copertura.** `./mvnw verify` con Java 25 supera gli stessi 1225 test unitari e 279 di integrazione delle fasi precedenti. La copertura unita sale dal 75,59% al 77,28% delle linee e dal 60,53% al 61,70% dei branch senza prove nuove. Come chiede `AGENTS.md`, le soglie del `pom.xml` salgono a 0,77 e 0,61, appena sotto il misurato, e il [Runbook di test](runbook-test.md) lo annota.

### Esito della fase 4b

Applicata e verificata il 2026-11-08 sul ramo `upgrade-phase-4b`, che parte da `b53d9cc`.

- **Versioni.** Spring Boot 4.1.2 con JHipster framework 9.4.0 e springdoc-openapi 3.2.0, costruito su Spring Boot 4.1.2.
  - Spring Boot porta Spring Framework 7.0.10, Spring Security 7.1.2, Spring Data 2026.0.2, Spring AMQP 4.1.2, Hibernate 7.4.13, Jackson 3.1.7, Tomcat 11.0.27, Netty 4.2.19, Liquibase 5.0.4, Testcontainers 2.0.5, JUnit 6.0.3 e Micrometer 1.17.2.
  - Il plugin Maven di Liquibase usa `liquibase-hibernate7` 5.0.4.
  - Tutte le versioni sono pubblicate da almeno sette giorni, come chiede la decisione 7.
  - Come chiede la decisione 2, il passo intermedio è stato Spring Boot 4.0.9 con JHipster 9.1.0 e springdoc 3.0.3. Su quel passo compilazione, 1225 test unitari e 279 di integrazione sono passati prima di salire alla 4.1.
- **Patch sopra Spring Boot.** Spring Boot 4.1.2 gestisce versioni corrette di Tomcat, Netty e Jackson e il driver PostgreSQL 42.7.14: le quattro proprietà della fase 4a sono tolte. Resta fissato amqp-client 5.37.1 della fase 0, perché Spring Boot 4.1.2 gestisce ancora la 5.30.0.
- **Starter e dipendenze.**
  - Starter rinominati: `spring-boot-starter-webmvc`, `-aspectj`, `-security-oauth2-client`, `-security-oauth2-resource-server` e `-liquibase` al posto di `liquibase-core`.
  - Nei test, `-webmvc-test` e `-security-test` al posto di `spring-boot-starter-test`, `spring-boot-test` e `spring-security-test`.
  - Gli artefatti di Testcontainers 2 hanno il prefisso `testcontainers-`.
  - Sono tolti `jackson-datatype-jsr310`, perché Jackson 3 gestisce già le date di `java.time`, e quattro dipendenze che nessuna classe usava: `jackson-datatype-hppc`, `jackson-module-jaxb-annotations`, `spring-boot-loader-tools`, che Spring Boot 4 non gestisce più, e Undertow nel profilo `eclipse`.
- **Jackson 3.**
  - In 37 file i package `com.fasterxml.jackson.core` e `databind` diventano `tools.jackson`. `JsonProcessingException` diventa `JacksonException`, che non è più un'eccezione controllata: due `catch (IOException)` intorno a Jackson cambiano o spariscono. `asText()`, deprecato, diventa `asString()`.
  - `JacksonConfiguration` è tolta: i moduli che registrava, `JavaTimeModule` e `Jdk8Module`, sono già dentro Jackson 3.
  - In Jackson 3 gli `ObjectMapper` sono immutabili. Quelli creati a mano, per hash e firme, Keycloak, RabbitMQ, Web Push e annotazioni delle tracce, nascono con `JsonMapper.builderWithJackson2Defaults()`. Mantengono `ORDER_MAP_ENTRIES_BY_KEYS` e `FAIL_ON_UNKNOWN_PROPERTIES` dove li avevano.
  - `spring.jackson.use-jackson2-defaults: true`, in `application.yml` e nella configurazione dei test, dà a Jackson 3 i default che Spring Boot usava con Jackson 2. Non è il modulo di compatibilità che la decisione 4 esclude: la libreria resta Jackson 3, cambiano solo i default. Senza, il JSON delle API cambierebbe: proprietà in ordine alfabetico, date `java.util.Date` con `Z` al posto di `+00:00`, classi vuote serializzate come `{}` invece di un errore.
  - Nella configurazione dei test `write-durations-as-timestamps` passa da `spring.jackson.serialization` a `spring.jackson.datatype.datetime`: in Jackson 3 fa parte di `DateTimeFeature`. Con la chiave vecchia 11 test di configurazione della sicurezza non avviavano il contesto.
  - Confronto prima e dopo, come chiede il rischio su Jackson 3. Un test temporaneo, non committato, ha serializzato con valori fissi 230 classi DTO con il mapper dell'applicazione, e con i mapper di hash e firme i loro record. Le esecuzioni sono tre: Jackson 2 su `b53d9cc`, e Jackson 3 su Spring Boot 4.0.9 e 4.1.2. Il JSON delle API è identico in tutte le classi, rilettura compresa, e il JSON canonico di hash e firme è identico byte per byte. Cambia solo il record `Checked` di `LoanSheetSigning`, che Jackson 2 non sapeva serializzare per una data `ZonedDateTime` e Jackson 3 sì: il mapper canonico non lo serializza mai, scrive solo la lista di `Item`.
- **Spring Boot 4.**
  - `LiquibaseProperties`, `DataSourceProperties`, `HibernatePropertiesCustomizer`, `AutoConfigureMockMvc` e `WebMvcTest` sono passate nei package dei nuovi moduli.
  - `HttpHeaders` non è più una `MultiValueMap`: `KeycloakServiceImpl` usa `containsHeader` al posto di `containsKey`.
  - `IntegrationTest` e `OnboardingImportIT` non caricano più `JacksonConfiguration`.
- **Problemi con codice 422.** Spring Framework 7 chiama il 422 come RFC 9110: il `title` dei problemi passa da «Unprocessable Entity» a «Unprocessable Content». Il frontend non legge `title` (`api-error.service.ts`), e `ExceptionTranslatorIT` si aspetta il testo nuovo.
- **API deprecate.** Come nella fase 4a, sono tolte le API che Spring Boot 4.0 e 4.1 e le librerie nuove deprecano (decisione 2):
  - `HttpStatus.UNPROCESSABLE_CONTENT` e `CONTENT_TOO_LARGE` al posto di `UNPROCESSABLE_ENTITY` e `PAYLOAD_TOO_LARGE`, in 67 punti, e `isUnprocessableContent()` nei test;
  - `@NonNull` e `@Nullable` di JSpecify al posto di quelle di `org.springframework.lang`, in tre classi;
  - `PostgreSQLContainer` e `RabbitMQContainer` dei package nuovi di Testcontainers 2, in sette test;
  - slf4j 2.0.20 depreca i marker annidati: `CRLFLogConverter` cerca il marker `CRLF_SAFE` fra i marker dell'evento, senza `Marker.contains`;
  - `spring.devtools.livereload.enabled` tolta dai profili `dev` e `prod`: Spring Boot 4.1 la depreca senza sostituto, e da Spring Boot 4.0 il valore predefinito è già `false`.

  Restano solo le due `@Temporal(TemporalType.DATE)` di `Albums.date` e `Users.birthDate`, deprecate da Jakarta Persistence 3.2 insieme a `java.util.Date`. Il sostituto, `LocalDate`, cambia il JSON delle API di quei campi, e `java.util.Date` è usato anche da DTO, filtri e calendario: è una modifica a sé.
- **Configurazione.** `spring-boot-properties-migrator`, aggiunto per la fase e tolto alla fine, non ha segnalato proprietà rinominate. Le chiavi di `application*.yml`, confrontate con i metadati di Spring Boot 4.0.9 e 4.1.2, sono tutte valide. `spring.output.ansi.console-available` non è nei metadati, ma Spring Boot 4 la legge ancora, come la 3.5.
- **Hibernate 7 e tenant.** Hibernate 7.4 non chiede modifiche al codice: `@SoftDelete`, `@SQLDelete`, `@SQLRestriction`, `@JdbcTypeCode` e le SPI multi-tenant restano le stesse. I test di autorizzazione e di isolamento tenant passano: cambiano solo gli import delle classi spostate e il container di Testcontainers 2. Non serve nessuna migrazione Liquibase.
- **Licenza di Liquibase 5.** Il nuovo `taurus-be/THIRD_PARTY_NOTICES.md` annota la FSL-1.1-ALv2. L'immagine del backend è pubblicata, e la FSL chiede a chi ridistribuisce il software di includere i termini, o un collegamento ai termini. Per questo il `Dockerfile` copia il file accanto al JAR, come fa il servizio OMR con il suo.
- **Statistiche di Liquibase.** Dalla 4.30, quindi già con la 4.31.1 della fase 4a, Liquibase legge `https://config.liquibase.com/analytics.yaml` e, se quella configurazione lo prevede, invia a Liquibase dati d'uso anonimi a ogni esecuzione, a meno che `liquibase.analytics.enabled` non sia `false`. Spring Boot ha `spring.liquibase.analytics-enabled`, ma `LiquibaseConfiguration` e `TenantSchemaProvisioningService` creano `SpringLiquibase` a mano e non la passano. Spegnerle è un cambio di comportamento fuori dal perimetro della fase: resta da decidere.
- **Prometheus.** Micrometer 1.17.2 usa il client Prometheus 1.7.0. Con gli stessi binder della fase 4a restano tutti i 31 nomi. Se ne aggiunge uno nuovo di Micrometer 1.17, `jvm_classes_loaded_count_classes_total`, e compaiono le serie `jvm_gc_pause_seconds`, che dipendono da quando la JVM segnala la pausa del GC.
- **Web Push.** La catena di web-push non cambia: httpcore 4.4.16, httpasyncclient 4.1.5, jose4j 0.9.7 e Bouncy Castle 1.86. `PushServiceImpl` serializza con Jackson 3 una `Map` di stringhe, come prima.
- **Vulnerabilità.** Senza `.trivyignore.yaml`, Trivy 0.76.2 come nella CI non trova vulnerabilità nel `pom.xml` del backend. Risolve 212 pacchetti, fra cui spring-webmvc 7.0.10. Escono da `.trivyignore.yaml` CVE-2026-47884 e CVE-2026-47890. Resta la voce DS-0002 del dev container, della fase 7.
  - Anche l'immagine costruita con il `Dockerfile` è stata scansionata, come chiede [Osservabilità e sicurezza](#osservabilità-e-sicurezza). Nel JAR Trivy non trova niente. Nel sistema dell'immagine base `eclipse-temurin:25-jre`, Ubuntu 26.04, trova CVE-2026-109518 (HIGH) in `apt` e `libapt-pkg`, già corretta da Ubuntu nella 3.2.1ubuntu0.1. Non dipende dalla fase, e il job `security` non scansiona le immagini: la correzione arriva quando l'immagine base viene ripubblicata, e il prossimo tag `v*.*.*` la prende alla build. Va ricontrollata a quel rilascio.
- **Test e copertura.** `./mvnw verify -Dtaurus.test.requireDocker=true` con Java 25 su Spring Boot 4.1.2 supera 1225 test unitari e 279 di integrazione in 30 minuti. La copertura unita è del 77,27% delle linee e del 61,68% dei branch, contro il 77,28% e il 61,70% della fase 4a. Resta sopra le soglie, che non cambiano: 0,77 e 0,61.
  - Una prima esecuzione si era fermata su `staysWithinTheTimeBudgetOnAnA4PageAt300Dpi`: 5,3 secondi contro un limite di 5, mentre sulla stessa macchina giravano Trivy e la prova delle metriche. Senza quel carico il test passa.

### Avanzamento della fase 5

In corso dal 2026-11-08 sul ramo `upgrade-phase-5`, che parte da `6abf728`. Sono fatti i passi ad Angular 20 e 21, Tailwind 4, le librerie e Node 26. Lo stesso giorno si è deciso di chiudere la fase alla linea 21: il passo ad Angular e PrimeNG 22 è rimandato a un'evolutiva successiva (decisione 5), e il suo piano resta in [Passo ad Angular e PrimeNG 22](#passo-ad-angular-e-primeng-22). Le versioni sono le ultime pubblicate da almeno sette giorni, come chiede la decisione 7: il lockfile è rigenerato con `npm install --before=2026-11-01T23:59:59Z`. In `angular.json` il builder è `@angular/build`, al posto di `@angular-devkit/build-angular`.

- **Angular 20.** `ng update` porta Angular 20.3.34, la CLI 20.3.42, PrimeNG 20.4.0 e TypeScript 5.9.3.
  - Le migrazioni di `ng update` cambiano solo i valori predefiniti di generazione in `angular.json`. La migrazione facoltativa al control flow a blocchi converte gli ultimi cinque template con `*ngIf` e `*ngFor`: configuratore, spinner di caricamento, menu, voce di menu e barra superiore.
  - PrimeNG 20 toglie `primeng/dropdown`, ancora importato da `ImportsModule`. `DialogService.open` può restituire `null`: le 41 sottoscrizioni a `onClose` passano a `?.onClose`. Il tipo dei componenti del preset accessibile, `AccessibleComponents`, passa da `interface` a `type` per restare assegnabile ai token di design di PrimeNG 20.
  - A questo passo un solo test falliva, quello di `aria-disabled` della direttiva dei ToggleButton, poi riscritta al passo 21.
- **Angular 21.** `ng update` porta Angular 21.2.25, `@angular/build` e la CLI 21.2.29, il CDK 21.2.14, PrimeNG 21.1.10 e keycloak-angular 21.0.0. TypeScript resta alla 5.9.3. I temi passano da `@primeng/themes`, deprecato, a `@primeuix/themes` 2.0.3.
  - Le migrazioni spostano le opzioni di avvio fra i provider in `main.ts` e rendono un segnale `Router.lastSuccessfulNavigation` nell'anteprima.
  - Tolte le API che Angular 21 depreca: `ChangeDetectionStrategy.Default` diventa `Eager` in 11 componenti, `TestBed.flushEffects` diventa `TestBed.tick`, `router.isActive` la funzione `isActive`, e non si usano più `statusText` di `HttpErrorResponse` né `returnValue` dell'evento `beforeunload`.
  - `@angular/animations` è deprecato dalla 20.2 e PrimeNG 21 usa animazioni CSS: `provideAnimationsAsync` è tolto, e il sottomenu laterale si chiude con la classe `layout-submenu-collapsed` di `_menu.scss` al posto dell'animazione di Angular.
- **Deprecazioni di PrimeNG.** Al passo 21 sono tolte le API deprecate dalla 20 che la 22 rimuove:
  - `icon` e `label` di `pButton` diventano gli elementi `pButtonIcon` e `pButtonLabel`, in 12 pulsanti di sei template;
  - `styleClass` diventa `class` sui componenti che applicano la classe all'host: InputIcon, DatePicker, Skeleton, Table e Image;
  - `responsiveLayout="scroll"` è tolto da 10 tabelle, perché è già il comportamento predefinito, e `p-checkBox` diventa `p-checkbox`;
  - `pTemplate` diventa un `ng-template` con il nome come variabile di riferimento, in quattro template. Nel dettaglio dell'inventario e nel dialogo di sostituzione `#item` nascondeva la proprietà `item` del componente: le proprietà diventano `inventoryItem` e `substituteItem`.

  Restano 16 selettori in camel case della tabella, che la 22 toglie: `p-sortIcon`, `p-tableHeaderCheckbox` e `p-tableCheckbox`, in cinque template.
- **Tailwind 4.** Tailwind CSS 4.3.3 con tailwindcss-primeui 0.6.1, migrato con lo strumento ufficiale `@tailwindcss/upgrade`.
  - Lo strumento non legge la configurazione con il plugin di tailwindcss-primeui, che importa `tailwindcss/plugin`: il plugin passa a `@import 'tailwindcss-primeui'`. Nei file SCSS lo strumento aveva riscritto la proprietà `flex-shrink` come se fosse una utility: le due modifiche sono tolte.
  - La configurazione passa da `tailwind.config.js`, tolto, a `src/tailwind.css`: punti di rottura nel blocco `@theme`, variante scura sulla classe `app-dark`, sorgenti con `@source`. PostCSS usa `@tailwindcss/postcss` da `.postcssrc.json`, e `autoprefixer` non serve più. `src/tailwind.css` è una voce a sé degli stili in `angular.json`, prima di `styles.scss`.
  - Le utility rinominate cambiano nei template: per esempio `!p-0` diventa `p-0!` in otto pagine e `break-words` diventa `wrap-break-word`. Tre regole di `@layer base` mantengono i valori di Tailwind 3 che la 4 cambia: il colore dei bordi, il cursore dei pulsanti e il colore dei placeholder.
  - In Tailwind 4 le utility stanno nel cascade layer `utilities`. Gli stili di PrimeNG e le regole globali dell'applicazione non hanno layer e vincono su qualunque regola di un layer, a prescindere dalla specificità: dove una utility e una regola globale toccano la stessa proprietà, il risultato può cambiare. La verifica visiva lo deve controllare.
- **Librerie.** ngx-extended-pdf-viewer 31.0.1, senza modifiche al codice; chart.js 4.6.1, verovio 6.4.0, spessasynth_lib 4.4.2, zone.js 0.16.3, rxjs 7.8.2, tslib 2.9.1 e keycloak-js 26.2.5. Fra gli strumenti: ESLint 10.14 con eslint-config-prettier 10.1.8 e eslint-plugin-prettier 5.5.7, Prettier 3.9.10, axe-core per Playwright 4.14.0, karma-jasmine-html-reporter 2.3.0, `jasmine-core` 6.3 e `@types/jasmine` 6.0, postcss 8.5.32. `eslint-plugin-import` ed `eslint-plugin-prefer-arrow` sono tolti, perché `eslint.config.js` non li usa; nessuno script e nessun job della CI esegue ESLint. Jasmine resta alla 4.6.1 durante i test: vedi [Eccezioni](#eccezioni-alla-versione-più-recente).
  - Playwright scende dalla 1.65.0 del lockfile della fase 0 alla 1.64.1: la 1.65.0 è del 2026-11-05, dentro i sette giorni. La 1.64.1 usa Chromium 1248, da installare prima della suite end to end.
- **Direttiva dei ToggleButton.** PrimeNG 21 dà di nuovo a ToggleButton il ruolo di pulsante e il nome da `ariaLabel`, ma lo stato disabilitato resta solo in `data-p-disabled` e nel `tabindex`. `ToggleButtonRoleDirective` diventa `ToggleButtonDisabledDirective`, in `toggle-button-disabled.directive.ts`: aggiunge solo `aria-disabled`, sui ToggleButton e sulle opzioni di SelectButton, e i suoi quattro test controllano anche il ruolo e il nome dati da PrimeNG.
- **Node 26.** Angular 21 accetta Node 20.19, 22.12 e dalla 24 in su. Il `Dockerfile` del frontend usa `node:26-alpine` per la build, e il job `frontend` di `verify.yml` Node 26; gli altri job restano su Node 22 fino alla fase 6. README, README del frontend e Runbook operativo lo indicano.
- **Vulnerabilità.** Senza `.trivyignore.yaml`, Trivy 0.76.2 come nella CI non trova vulnerabilità nel lockfile del frontend: escono da `.trivyignore.yaml` le sue nove voci. Resta DS-0002 del `Dockerfile`, nginx come root, della fase 7. `npm audit` segnala 18 vulnerabilità moderate, tutte in dipendenze di sviluppo della catena della CLI di Angular, corrette nella CLI 22.1: con la fase chiusa alla 21 restano aperte.
- **Dependabot.** `.github/dependabot.yml` ignora anche le maggiori di `@primeuix/themes` e PrimeIcons, che dalla 3 e dalla 8 hanno la PrimeUI License: le maggiori di PrimeNG erano già escluse.
- **Test e build.** `npm run test:coverage` supera 751 test su 751, con copertura sopra la baseline: statements 64,57%, branches 54,40%, lines 66,63%. `npm run build` riesce con i due avvisi di budget CSS già presenti.
- **Suite end to end e verifica visiva.** Eseguite il 2026-11-08 sul risultato del passo 21 (vedi [Suite end to end e verifica visiva della fase 5](#suite-end-to-end-e-verifica-visiva-della-fase-5)). Nessuna regressione di aspetto nelle pagine viste, cascade layer di Tailwind 4 compresi. Sono stati trovati due difetti, corretti lo stesso giorno: la regola `label-content-name-mismatch`, che axe-core 4.14.0 applica da sé, su markup già presente dell'applicazione, e la direttiva `AutoFocus` di PrimeNG 21, che scrive l'attributo `autofocus` su quasi tutti i componenti. Dopo le correzioni le prove di accessibilità passano. Il 2026-11-09 è stata corretta anche una prova instabile del workspace delle parti, non legata alla fase, insieme ad altri difetti delle prove dello stesso file che i salti nascondevano. L'esclusione di `aria-required-children` su `p-stepper` serve ancora: README della suite, prova e Runbook di test la annotano per la 19 e la 21.
- **Documentazione di PrimeNG.** Il 2026-11-09 `docs/llms-full.md` è sostituito con la documentazione ufficiale di PrimeNG 21, `https://v21.primeng.org/llms/llms-full.txt`, generata da PrimeTek il 2026-06-04: 47.982 righe al posto delle 52.869 di quella della 22, generata il 2026-06-28. Le guide di migrazione arrivano alla 21, l'installazione non chiede la chiave di licenza, e mancano le pagine dei componenti nuovi della 22: CommandMenu, Compare, InputColor, InputPassword, InputTags, Label, Scroll Area e Sidebar.

#### Passo ad Angular e PrimeNG 22

Programmato e rimandato il 2026-11-08: la fase 5 si chiude alla linea 21 (decisione 5). Il piano è stato seguito dall'evolutiva successiva il 2026-11-13, sul ramo `upgrade-angular-22` (vedi [Esito del passo ad Angular e PrimeNG 22](#esito-del-passo-ad-angular-e-primeng-22)).

1. **Angular 22.** `ng update` di Angular, CLI e CDK alla 22.2.x, con TypeScript 6.0 (vedi [Eccezioni](#eccezioni-alla-versione-più-recente)), keycloak-angular 22 e la linea di zone.js che Angular 22 chiede. Si tolgono le API che Angular 22 depreca, come ai passi 20 e 21.
2. **PrimeNG 22.** PrimeNG 22, `@primeuix/themes` 3 e PrimeIcons 8.
   - L'applicazione ha il font di base a 14 pixel (`src/assets/layout/_core.scss`), mentre i preset della 22 lo assumono a 16. Il preset accessibile parte da `@primeuix/themes/aura-compat`, la variante calibrata su 14 pixel, mantenuta fino a giugno 2027. Il passaggio a 16 pixel e al preset standard è un lavoro a parte, da fare prima di quella data.
   - I 16 selettori della tabella passano al kebab case, e la direttiva dei ToggleButton perde i selettori in camel case che la 22 non riconosce più.
   - Le icone `pi` usate dall'applicazione si confrontano con PrimeIcons 8, e le misure di contrasto di `accessible-theme.spec.ts` si ripetono sui token nuovi.
   - Se PrimeNG 22 scrive `aria-disabled` sui ToggleButton, `ToggleButtonDisabledDirective` si toglie.
3. **Chiave di licenza.** `TAURUS_PRIMEUI_LICENSE` in `40-taurus-runtime-config.sh`, nel tipo `RuntimeConfig` con i suoi test, in `providePrimeNG({ license })`, nel compose e in `.env.example` di `deploy/` e nella tabella delle variabili del Runbook operativo, con il rinnovo annuale. In sviluppo la chiave non va nel `src/assets/config.json` versionato. Si verifica cosa vede chi installa l'immagine senza chiave.
4. **Note di terze parti.** `taurus-fe/THIRD_PARTY_NOTICES.md` con la PrimeUI License, copiato dal `Dockerfile` nell'immagine.
5. **Permesso aggiuntivo.** Il testo della decisione 5 in fondo a `LICENSE` e una nota nel README, in un commit del repository separato da quelli del frontend.
6. **Documentazione di PrimeNG.** `docs/llms-full.md` descrive la 21: si sostituisce con quella della 22, `https://primeng.org/llms/llms-full.txt`, come chiede `AGENTS.md`.
7. **Verifiche.** `npm run build`, `npm run test:coverage`, Trivy come nella CI e `npm audit`; la suite end to end, ricontrollando l'esclusione su `p-stepper` annotata per PrimeNG 19 nel [README della suite](../taurus-fe/e2e/README.md) e nel [Runbook di test](runbook-test.md); la verifica visiva delle pagine del [Taurus Layout Standard](taurus-layout-standard.md) in chiaro e scuro, desktop e mobile, con il controllo dei cascade layer di Tailwind 4. Il banner di PrimeNG non deve comparire con la chiave valida.
8. **Riferimenti.** `AGENTS.md`, README e runbook passano ad Angular 22 e PrimeNG 22.

#### Esito del passo ad Angular e PrimeNG 22

Applicato il 2026-11-13 sul ramo `upgrade-angular-22`, che parte da `5394f2a`, dopo la scelta di PrimeNG 22 con la PrimeUI License (decisione 5). Le versioni sono le ultime pubblicate da almeno sette giorni, come chiede la decisione 7: npm ha installato con `before` fissato al 2026-11-06, anche le dipendenze indirette.

- **Versioni.** Angular 22.2.5, CLI, `@angular/build` e CDK 22.2.6, TypeScript 6.0.3, keycloak-angular 22.0.0; PrimeNG 22.1.4, `@primeuix/themes` 3.1.0, PrimeIcons 8.0.2. Restano zone.js 0.16.3 e tailwindcss-primeui 0.6.1, che Angular 22 e PrimeNG 22 accettano. PrimeNG 22 porta con sé `@primeuix/styles` 3.1.0, `@primeicons/angular` 8.0.2 e `@primeui/license-manager` 1.1.0. Angular 22.2.6, PrimeNG 22.1.5 e `@primeuix/themes` 3.1.1 sono uscite da meno di sette giorni: arriveranno con Dependabot.
- **Migrazioni di Angular.** `ng update` aggiunge `changeDetection: ChangeDetectionStrategy.Eager` a 105 componenti, perché Angular 22 rende OnPush il predefinito: il comportamento resta quello di prima, e il passaggio a OnPush è un lavoro a parte. Aggiunge `withXhr()` a `provideHttpClient`, che tiene il backend XHR e quindi l'avanzamento dei caricamenti, sopprime due diagnostiche estese e mette `istanbul-lib-instrument` fra le dipendenze di sviluppo, come chiede Karma. Le due migrazioni facoltative, a Vitest e al builder `application`, non sono applicate (decisione 6).
- **Safe navigation nei template.** In Angular 22 `a?.b` restituisce `undefined` invece di `null`, e la migrazione avvolge 33 espressioni in 10 template in `$safeNavigationMigration()`, riformattando quei file. Le espressioni sono tornate come prima: arrivano tutte a input e funzioni che trattano allo stesso modo `null` e `undefined`, o stanno dentro un `@if` che esclude il caso. `detail-section` nasconde ora il contatore quando la lista manca, invece di mostrare uno span vuoto.
- **Selettori e input di PrimeNG.** I selettori in camel case non ci sono più: `p-sortIcon`, `p-tableCheckbox` e `p-tableHeaderCheckbox` diventano `p-sort-icon`, `p-table-checkbox` e `p-table-header-checkbox` in sei template, e `ToggleButtonDisabledDirective` perde `p-toggleButton` e `p-selectButton`. Le direttive ad attributo della tabella (`pSortableColumn` e le altre) non cambiano. Gli attributi statici che un componente non dichiara non danno errore di compilazione: un controllo con il parser dei template di Angular li ha confrontati con gli input dichiarati da PrimeNG 22. `styleClass` non esiste più su `p-message` e `p-table` e diventa `class`. Lo stesso controllo ha trovato due difetti già presenti: `filterPlaceholder` su `p-multiselect`, che si scrive `filterPlaceHolder`, e `ariaLabel` su `p-progressbar` e `p-selectbutton`, che non hanno quell'input e finivano nel DOM come `arialabel`; ora sono `aria-label`. `Image` espone `previewButton` e `closeButton` come signal, `FileSelectEvent` ha `files` di tipo `FileList | File[]`, e `surfacePalette` di `@primeuix/themes` 3 non accetta più una palette assente.
- **AutoFocus.** PrimeNG 22 legge l'`autofocus` con `booleanAttribute`, che tratta il valore assente come `false`: il difetto della 21 è corretto, e `neutralizePrimeNgAutoFocusDefault` è tolto con il suo `provideAppInitializer`. Il suo test resta come `primeng-autofocus-regression.spec.ts` e controlla lo stesso comportamento sulla direttiva di PrimeNG.
- **Preset e tema accessibile.** I preset passano alle varianti `aura-compat`, `lara-compat` e `nora-compat` (vedi [Eccezioni](#eccezioni-alla-versione-più-recente)). In `@primeuix/themes` 3 un token vale per i due modi nella forma CSS `light-dark(chiaro, scuro)`, e `colorScheme.light` e `colorScheme.dark` non ci sono più nei preset. `@primeuix/styled` 1.2 li accetta ancora, ma uno scostamento scritto solo in `colorScheme.light` finisce su `:root` dopo il token del preset e lo sostituisce anche nel modo scuro: il CSS generato lo ha mostrato per `--p-primary-color`, che sarebbe rimasto alla tinta 700 anche su fondo scuro. Il tema accessibile costruisce ora gli scostamenti dal preset scelto, con la metà chiara di Taurus e quella scura del preset (`accessibleSemantic`, `accessibleComponents`), e messaggi e toast hanno un solo token con le due tinte. Il configuratore usa le stesse funzioni per il testo attenuato. `accessible-theme.spec.ts` misura i rapporti sui token della 3, aggiunge pulsanti, primario e testo attenuato, e controlla che la metà scura resti quella di Aura, Lara e Nora.
- **Chiave della licenza.** `TAURUS_PRIMEUI_LICENSE` passa da `40-taurus-runtime-config.sh` ad `assets/config.json`, a `RuntimeConfig` e a `providePrimeNG({ license })`. Lo script accetta solo i caratteri di una chiave, base64url e punti, perché il valore finisce in un file JSON; senza chiave, o con una chiave scartata, scrive un avviso nel log. La verifica di `@primeui/license-manager` è offline, senza connessioni né telemetria. Senza una chiave valida PrimeNG scrive un avviso in console e mostra un banner in basso a destra, in uno shadow DOM chiuso con `pointer-events: none`: l'applicazione funziona e il banner non blocca i clic. In sviluppo nessuna chiave è nel repository, e il banner compare.
- **Icone.** Tutte le icone `pi-*` usate dall'applicazione esistono in PrimeIcons 8. `pi-archive` e `pi-music` non esistevano nemmeno nella 7 e restavano vuote: diventano `pi-inbox` e `pi-headphones`.
- **Deprecazioni di PrimeNG 22.** Restano da togliere entro la 24, quando PrimeNG le rimuoverà: le direttive `pButtonIcon` e `pButtonLabel`, in 6 template; `p-image`, in 4 template, e `p-galleria`, in uno, che PrimeNG sostituisce con Gallery; `p-multiselect`, in 2 template, che diventa `p-select` con `multiple`. Il frontend non usa `p-chart`, che passa a PrimeUI PRO Charts, a pagamento, né gli altri componenti deprecati.
- **Stepper.** Nel codice della 22 la radice di `p-stepper` è ancora `tablist` e contiene i pannelli `tabpanel`: l'esclusione di `aria-required-children` nell'audit della configurazione iniziale resta.
- **Vulnerabilità.** `npm audit` non segnala più le 18 vulnerabilità moderate della catena della CLI di Angular. Ne restano 3 moderate, in `minimatch` sotto ESLint 10.14, solo in sviluppo e indipendenti da questo passo.
- **Verifiche.** Con Node 24.21, che Angular 22 accetta: `ng build` senza errori, con i due avvisi di budget sui fogli di stile di `pdf-manipulator-dialog` e `preview` che c'erano già; `npm run test:coverage` con 813 test superati e la copertura sopra la baseline (statements 65,53%, branches 55,91%, lines 67,59%). L'immagine costruita dal `Dockerfile`, con `node:26-alpine` come la CI, parte sana: `config.json` porta la chiave, una chiave con caratteri non ammessi è scartata con l'avviso, nginx gira con l'uid 101 e le note sono in `/usr/share/doc/taurus-fe/`. Nel browser, sulla pagina pubblica dei termini servita dall'immagine, il primario è emerald.700 in chiaro ed emerald.400 in scuro, il testo attenuato slate.600 e zinc.400, il titolo del toast di errore red.700 e red.400; senza chiave compare il banner di PrimeNG. La stessa pagina ha mostrato un difetto già presente, ora corretto: senza sessione `TenantStatusService.load()` non legge lo stato e ricade sul funzionamento normale, così `LayoutService` provava a salvare sul server ogni preferenza del layout e la console si riempiva dei 401 che l'interceptor dà a `/api/preferences/count`. `TenantStatusService.whenProvisioned()` non emette nelle pagine pubbliche, e lì le preferenze del layout e della vista delle liste restano locali.
- **Da verificare.** Trivy, che non è installato in locale, gira nel job `security` della CI. La suite end to end e la verifica visiva delle pagine del [Taurus Layout Standard](taurus-layout-standard.md) in chiaro e scuro, desktop e mobile, chiedono un'istanza completa con i tenant di prova: restano da eseguire prima del merge, con e senza chiave di licenza.

### Esito della fase 6

Applicata e verificata il 2026-11-09 sul ramo `upgrade-phase-6`, che parte da `6f0f222`. Le versioni sono le ultime pubblicate da almeno sette giorni, come chiede la decisione 7: il lockfile è risolto da capo con `pnpm install --config.minimumReleaseAge=10080`, che rifiuta i pacchetti pubblicati da meno di sette giorni.

- **Versioni.** Astro 7.4.5, `@astrojs/sitemap` 3.7.4, `@astrojs/check` 0.9.12 e TypeScript 6.0.3, l'ultima che `@astrojs/check` accetta (vedi [Eccezioni](#eccezioni-alla-versione-più-recente)); pnpm 12.17.0 in `packageManager`.
  - Astro 7 porta Vite 8.3.5 con Rolldown 1.2.16, sharp 0.35.5, devalue 6.0.3 e svgo 4.1.0; esbuild e js-yaml escono dal lockfile.
  - Come chiede la decisione 2, il passo intermedio è stato Astro 6.4.8, l'ultima della 6: `pnpm check`, `pnpm build` e `pnpm test` sono passati prima di salire alla 7.
  - Tailwind CSS e `@tailwindcss/vite` restano alla 4.3.3, come nel frontend: la 4.3.4 è uscita il 2026-11-02 alle 21:30 UTC, meno di sette giorni prima. Per lo stesso motivo Astro è alla 7.4.5 e non alla 7.4.8, del 2026-11-09.
- **Codice.** Il sito non usa le API che Astro 6 e 7 tolgono, come le collezioni di contenuti, `Astro.glob`, `<ViewTransitions />` e il Markdown: né i sorgenti né `astro.config.mjs` cambiano. Due cambi di comportamento toccano l'HTML prodotto:
  - con Astro 6 stili e script dei componenti seguono l'ordine dei sorgenti, e lo stile del logo, in `Brand.astro`, passa dalla pagina al foglio di stile comune;
  - con Astro 7 `compressHTML` vale `'jsx'` e toglie gli spazi fra gli elementi. La guida all'aggiornamento avverte che può togliere anche gli spazi fra elementi in linea.

  Per controllarlo, le build con Astro 5.18.2 e 7.4.5, con gli stessi indirizzi, sono state confrontate pagina per pagina in Chromium, con il Playwright del frontend. Il testo visibile (`innerText`) e gli screenshot dell'intera pagina sono identici in tutte le otto pagine, a 1280×800 e a 375×812. `compressHTML` resta quindi al valore predefinito.
- **pnpm 12.** pnpm 12 è un eseguibile nativo: il pacchetto `pnpm` ne porta uno per piattaforma, e lo collega con il suo script di installazione.
  - Quando `packageManager` indica la 12 o una versione successiva, il lockfile comincia con un documento che fissa la versione di pnpm e la sua integrità, `packageManagerDependencies`. Il parser di Dependabot salta quel documento, e pnpm 12 è fra le versioni che Dependabot supporta.
  - `pnpm-workspace.yaml` è tolto. Conteneva solo `allowBuilds` per esbuild e sharp: esbuild non è più una dipendenza, sharp 0.35 non ha più script di installazione, e nessun pacchetto del lockfile ne ha.
- **Dockerfile.** La build usa `node:26-alpine`, che non include più corepack. pnpm si installa con `npm install --global`, alla versione di `packageManager` letta da `package.json`. Serve `--allow-scripts=pnpm`: npm 11 non esegue gli script di installazione che non sono stati ammessi, e senza il suo script pnpm non collega l'eseguibile nativo e passa da Node. L'immagine servita da nginx non cambia.
- **CI.**
  - Il job `info-site` usa Node 26, e `pnpm/action-setup` legge la versione di pnpm da `taurus-info/package.json` con `package_json_file`, al posto di `version: 11`. Prima l'azione cercava `package.json` alla radice del repository, dove non c'è: installava l'ultima pnpm 11, e pnpm passava da sé alla versione di `packageManager`.
  - Passano a Node 26 anche gli altri job rimasti su Node 22: `changes` e `documentation` di `verify.yml`, `documentation` di `docker-publish.yml` e il workflow mensile `cie-trust-anchors`. Con Node 26 i loro script danno lo stesso esito che con Node 22.
- **Vulnerabilità.** Senza `.trivyignore.yaml`, Trivy 0.76.2 come nella CI non trova vulnerabilità nel lockfile del sito, letto per intero con i suoi 304 pacchetti. Escono da `.trivyignore.yaml` le sei voci del sito, tre di Astro 5.18.2 e tre di sharp 0.34.5. Resta DS-0002 del `Dockerfile`, nginx come root, della fase 7.

### Esito della fase 7

Applicata e verificata il 2026-11-10 sul ramo `upgrade-phase-7`, che parte da `9ff2468`. Le versioni sono le ultime pubblicate da almeno sette giorni, come chiede la decisione 7; le date sono quelle di Docker Hub e delle release su GitHub.

- **Versioni.**
  - nginx 1.30.6, del 2026-10-19, in `nginxinc/nginx-unprivileged:1.30-alpine`, per frontend e sito informativo.
    - Il 2026-11-18 i due Dockerfile hanno ricevuto `apk upgrade`: l'immagine di nginx non era ripubblicata dal 2026-10-19 e i suoi pacchetti di Alpine avevano una vulnerabilità critica e 12 alte già corrette. Vedi il [report sulle vulnerabilità delle dipendenze](reports/vulnerabilita-dipendenze.md).
  - PostgreSQL 18.6, l'ultima della 18, di agosto 2026; RabbitMQ 4.4.0, del 2026-10-19, nella variante `management-alpine`. Anche i test del backend, `restore-test.sh` e `deploy/.env.example` usano queste due versioni.
    - Il 2026-11-18 PostgreSQL è passato alla 18.7, del 2026-11-12, negli stessi file: è un rilascio di sicurezza, che per la decisione 7 non aspetta i sette giorni.
  - Nei compose di sviluppo: Prometheus 3.13.5 LTS, del 2026-10-21; Grafana 13.3.0, del 2026-10-27; SonarQube Community Build 26.10, del 2026-10-29; Mailpit 1.33.0, del 2026-10-31, anche nell'IT delle e-mail del provider. SonarQube 26.11, del 2026-11-05, e Mailpit 1.33.1, del 2026-11-07, sono uscite da meno di sette giorni. Dependabot non legge i compose di sviluppo: arriveranno con il prossimo aggiornamento a mano.
  - Dev container su `mcr.microsoft.com/devcontainers/java:3-25-trixie`, con Java 25 e Node 26.
- **nginx senza privilegi.** Frontend e sito partono da `nginxinc/nginx-unprivileged`: nginx gira con l'utente `nginx` (uid 101) e ascolta sulla porta 8080 del container.
  - Nell'immagine `/usr/share/nginx/html` resta di root. Il Dockerfile del frontend ripulisce la cartella e copia l'applicazione come root, poi passa all'utente 101. `assets/config.json`, che l'entrypoint riscrive all'avvio dalle variabili d'ambiente, appartiene a nginx; il resto dell'applicazione non è scrivibile dal processo.
  - I compose pubblicano la 8080 del container sulla stessa porta dell'host di prima: il reverse proxy non cambia. I controlli di salute dei Dockerfile interrogano la 8080.
  - `validate-deploy-manifest.sh` controlla che il frontend pubblichi la 8080 del container, e `pnpm test:image` del sito che nginx non giri come root.
- **`X-Forwarded-Port` verso Keycloak.** Il blocco `/auth/` del frontend inoltrava `$server_port`, la porta su cui ascolta il container. Con la 8080 Keycloak costruiva indirizzi come `https://taurus.esempio.it:8080/auth/realms/...`. Ora inoltra la porta dichiarata dal reverse proxy dell'host, come già fa con lo schema, e l'esempio del reverse proxy la imposta. Con Keycloak 26.8.2 dietro l'immagine nuova e le intestazioni del reverse proxy, l'issuer è `https://taurus.esempio.it/auth/realms/master`.
- **PostgreSQL 18.** Il volume si monta su `/var/lib/postgresql`, come chiede l'immagine della 18, e `validate-deploy-manifest.sh` controlla il punto di montaggio esatto. La procedura del runbook operativo (§8.6) è stata provata con `deploy/compose.yml`, in un progetto Compose di prova:
  - dati di partenza sulla 17.0: tre schemi di tenant da 5000 righe, 240 righe in `databasechangelog` e il database di Keycloak con 800 utenti;
  - il container della 18 si rifiuta di partire sia con il solo tag cambiato sia con il montaggio nuovo sul volume della 17, con il messaggio citato nel runbook, e non tocca i dati;
  - `pg_dumpall` in 1 secondo, 1,5 MB; ripristino in 2 secondi, con i soli due errori attesi sul ruolo che esegue il ripristino;
  - dopo `vacuumdb` dati identici, accesso a Keycloak e accesso del ruolo `taurus` con le password di prima;
  - ritorno indietro alla 17.0 con la copia del volume: dati identici.
- **Servizi di sviluppo.** `services.yml` tiene i dati in volumi anonimi. Con la 18 il container ricreato riceve un volume nuovo, perché cambia il punto di montaggio: il database riparte vuoto e i dati della 17 restano in un volume orfano. Il runbook operativo (§5.5) descrive come portarli. L'avvio completo di `services.yml`, in una copia senza nomi fissi dei container, con un'altra sottorete e senza porte pubblicate, porta tutti e cinque i servizi a `healthy` in 75 secondi: PostgreSQL 18.6 con i database `taurus` e `taurus_keycloak`, Keycloak con il realm importato e il provider caricato, RabbitMQ con il nodo `rabbit@rabbitmq`, il servizio OMR e Mailpit.
- **RabbitMQ.**
  - *Difetto trovato.* I compose non fissavano l'hostname del container. Il nodo prende il nome dall'hostname, quindi si chiamava `rabbit@<id del container>`, e ogni container ricreato apriva un nodo vuoto nello stesso volume. Provato sul manifest di produzione: dopo `up --force-recreate` il vhost creato prima non c'era più e nel volume restavano due cartelle di nodo. Con `hostname: rabbitmq`, ora nel compose di produzione e in quello di sviluppo, il vhost resta dopo la ricreazione. `validate-deploy-manifest.sh` controlla l'hostname.
  - *Salto dalla 4.0.* La documentazione di RabbitMQ non ammette il passaggio diretto dalla 4.0 alla 4.4. In una prova la 4.4.0 è partita sui dati di una 4.0.7 con tutti i feature flag abilitati, ha migrato i metadati a Khepri e ha mantenuto il vhost, ma non è un percorso supportato. Il runbook (§8.7) segue la decisione 11: code svuotate, nodo nuovo con la 4.4. Il ritorno alla 4.0.7 con il manifest precedente parte sano, con un nodo nuovo.
  - *Code non durevoli.* Dalla 4.4 RabbitMQ rifiuta per impostazione predefinita le code non durevoli e non esclusive, una funzione deprecata (`transient_nonexcl_queues`). `RabbitMqBrokerIT` le usava per le sue prove e falliva in 5 test su 5; ora le dichiara durevoli e a cancellazione automatica. Le code di produzione sono già durevoli (`DeadLetterQueueConfiguration.workQueue`), e `UploadJobPipelineIT` passa sulla 4.4.0 senza modifiche.
- **Monitoraggio.**
  - `promtool check config` di Prometheus 3.13.5 accetta la configurazione di sviluppo così com'è.
  - Grafana 13 non ha più i pannelli Angular. Alla prima apertura la dashboard JVM (Micrometer) migra da sé `graph` in `timeseries` e `singlestat` in `stat`. Il plugin `grafana-piechart-panel`, Angular e non usato dalla dashboard, esce da `GF_INSTALL_PLUGINS`.
  - Con il provisioning del repository Grafana parte senza errori, con la sorgente Prometheus predefinita e la dashboard. Aperta con Playwright, la dashboard disegna 28 pannelli, senza «Panel plugin not found».
  - SonarQube 26.10 non è stato avviato: cambia solo il tag.
- **JHipster Control Center.** `jhipster-control-center.yml` è tolto (decisione 12). Nel realm di sviluppo resta il client `taurus-control-center`, che serviva solo a lui: toglierlo è un cambio del realm, da fare a parte.
- **Dev container.** L'immagine `devcontainers/java:3-25-trixie` ha l'utente `vscode`, che `USER` rende esplicito nel Dockerfile. Le due feature di prima, `docker-in-docker` e `docker-from-docker`, non si possono installare insieme: resta `ghcr.io/devcontainers/features/docker-in-docker:2`. La build con Docker dà l'utente `vscode`, OpenJDK 25.0.5 di Microsoft, Node 26.13.0 e npm 11.20.0. La feature si installa solo con la CLI dei dev container o con un editor, e non è stata provata.
- **Vulnerabilità.** Trivy 0.76.2 come nella CI, senza le due voci DS-0002, non segnala configurazioni in nessuno dei cinque Dockerfile: le voci escono da `.trivyignore.yaml`. Restano le 28 voci di Pillow della fase 2, tolte poi con [Pillow 13 nel servizio OMR](#pillow-13-nel-servizio-omr).

### Pillow 13 nel servizio OMR

Applicato e verificato il 2026-11-10 sul ramo `upgrade-omr-pillow-13`, che parte da `63a9c36`, prima di chiudere la fase 8. Le 28 vulnerabilità di Pillow 12.3.0 erano le ultime voci di `.trivyignore.yaml`. homr 0.7.0, ancora l'ultima versione, dichiara sempre `Pillow<13`: la prova è stata installare Pillow 13 nonostante il limite e misurare il riconoscimento sul corpus.

- **Cosa usano di Pillow.**
  - homr usa solo `Image.open`, `Image.fromarray` e il tipo `Image.Image`.
  - RapidOCR usa `Image.open`, `new`, `fromarray` e `blend`, `ImageOps`, `ImageDraw` e `ImageFont`.
  - Il servizio usa `Image.open`, `new`, `convert`, `split`, `alpha_composite` e `save`, con `MAX_IMAGE_PIXELS` e l'avviso e l'errore delle immagini troppo grandi.

  Le note di rilascio della 13.0.0, del 2026-10-16, non cambiano nessuna di queste funzioni. Le modifiche incompatibili riguardano i PNG a 16 bit, i tag TIFF duplicati, le icone ICO, `ImageColor.getcolor()` e alcune API di `ImageCms` ed `ExifTags`. La 13 toglie Python 3.10 e pubblica i pacchetti per Python 3.12.
- **Installazione.** Pillow 13.0.0 in `requirements.txt`, `requirements-test.txt`, `requirements-accuracy.txt` e `pyproject.toml`.
  - Il resolver di pip rifiuta la 13 insieme a homr 0.7.0. Il Dockerfile installa quindi `requirements.txt` con `--no-deps`, possibile perché il file fissa già ogni pacchetto.
  - Dopo l'installazione `pip check` deve segnalare il limite di homr 0.7.0 su Pillow e nient'altro: ogni altro conflitto, compreso un pacchetto mancante, ferma la build. Il filtro è stato provato a parte con un conflitto in più e con un limite su Pillow di un altro pacchetto.
  - I test non installano homr: `requirements-test.txt` si installa come prima.
- **Dependabot.** Esce la regola che escludeva Pillow 13. Le versioni nuove di Pillow arrivano come le altre librerie del servizio, e la CI le prova con i test di accuratezza sull'immagine costruita.
- **Riconoscimento.** I test di accuratezza sull'immagine costruita, con le restrizioni di `omr.yml`, passano 6 su 6 in 4 minuti, con gli stessi numeri della fase 2: 132 battute su 151 con Audiveris (87%) e 124 con homr (82%), segni di struttura 15 e 6 su 26, nomi delle parti 6 su 6.
- **Vulnerabilità.** Trivy 0.76.2 come nella CI non trova vulnerabilità nel servizio OMR. Escono da `.trivyignore.yaml` le 28 voci di Pillow, e il file resta senza voci.
- **Quando si ricontrolla.** A ogni versione nuova di homr. Il filtro di `pip check` nomina la 0.7.0: una versione nuova che dichiari ancora `Pillow<13` ferma la build, e la prova si ripete. Quando homr accetta Pillow 13, il Dockerfile torna a installare con le dipendenze ed escono il filtro e il commento in `requirements.txt`.

### Esito della fase 8

Applicata e verificata il 2026-11-10 sul ramo `upgrade-phase-8`, che parte da `237f910`. La fase chiude l'aggiornamento.

- **`.trivyignore.yaml`.** Il file resta senza voci, e le regole dell'intestazione valgono anche dopo l'aggiornamento (decisione 13). Una voce entra solo quando la correzione non si può applicare subito: ha il motivo, l'aggiornamento che la toglierà e una scadenza di al massimo 60 giorni. Il commento del job `security` in `verify.yml` e il Runbook di test (§8.7) dicono lo stesso.
- **Dependabot.**
  - Esclude dalla 7 `jasmine-core` e `@types/jasmine`, come chiedono le [Eccezioni](#eccezioni-alla-versione-più-recente). La regola chiude la #156 e la #173.
  - I commenti non citano più le fasi.
- **Aggiornamenti fermi.** Il controllo del primo criterio di accettazione ne ha trovati tre che Dependabot non riusciva a portare.
  - *Frontend.* La #172, con Angular 21.2.26 e Tailwind 4.3.4, si fermava su `npm ci`. `@angular/platform-browser-dynamic`, deprecato da Angular e non usato dal codice, restava alla 21.2.25, che chiede esattamente `@angular/core` 21.2.25. Dependabot non propone versioni deprecate, quindi ogni patch di Angular si sarebbe fermata allo stesso modo. Il pacchetto esce dal `package.json`. Il lockfile porta Angular 21.2.26, Tailwind 4.3.4 e lightningcss 1.33.0, e nient'altro cambia.
  - *Servizio OMR.* La #164, python-dateutil 4.0.0, falliva nella build dell'immagine sulla sua base, `6abf728`. Sul `main` di oggi l'immagine si costruisce: python-dateutil 4 chiede solo `tzdata`, già fissato, e matplotlib, l'unico pacchetto che lo usa, chiede `>=2.7`. Insieme arriva pip 26.3 nel Dockerfile, che Dependabot non legge.
  - *Strumenti npm del backend.* Erano fermi a generator-jhipster 9.0.0, Prettier 3.3.3 e lint-staged 15: la #126 e le maggiori #127 e #128.
    - Ora generator-jhipster 9.4.0, come JHipster nel backend, husky 9.1.7, Prettier 3.9.10, prettier-plugin-java 2.11.0, lint-staged 17.6.0 e prettier-plugin-packagejson 3.1.0. `engines` chiede Node `^22.22.1 || >=24.11.0`, come lint-staged 17 e generator-jhipster 9.4.
    - Maven e la CI non li usano: servono all'hook di pre-commit e agli script `prettier:*`. Per questo `./mvnw verify` non è stato ripetuto in locale; lo esegue la CI.
    - `npm audit` scende da 56 avvisi, 3 critici e 19 alti, a 38, 2 critici e 2 alti. Quelli critici e alti vengono tutti da simple-git 3.36.0, che generator-jhipster 9.4.0, ultima versione, fissa esattamente: la correzione è solo nella 4. Il generatore si lancia solo a mano, e Trivy non legge le dipendenze di sviluppo.
    - Il 2026-11-18 generator-jhipster è uscito dal `package.json`, per chiudere quegli avvisi: per un aggiornamento di JHipster si lancia con `npx`. Vedi il [report sulle vulnerabilità delle dipendenze](reports/vulnerabilita-dipendenze.md).
- **Componenti che Dependabot non legge.** Sono tutti all'ultima versione stabile, tranne pip, aggiornato qui:
  - gitleaks 8.30.1, semgrep 1.183.0 e Trivy 0.76.2 della CI;
  - Audiveris 5.11.0, homr 0.7.0, RapidOCR 3.10.0 e i dati Tesseract 4.1.0 del servizio OMR;
  - Maven 3.10.0 e pnpm 12.17.0;
  - le immagini dei compose di sviluppo.

  semgrep 1.184.0, Mailpit 1.33.1, SonarQube 26.11 e pnpm 12.18.0 sono usciti da meno di sette giorni (decisione 7).
- **Pull request di Dependabot rimaste.**
  - La #165 (anyio), la #168 (Tailwind del sito) e la #169 (Maven del backend) hanno la CI verde e si uniscono come sempre.
  - La #143 e la #119 sono superate: POI 6.0.0 e Angular 21 sono già su `main`.
  - Le altre, che questa fase contiene o esclude, Dependabot le chiude da sé dopo il merge.
- **Criteri di accettazione.**

| Criterio | Esito |
| --- | --- |
| Ogni componente all'ultima versione stabile o nelle Eccezioni | sì, con questa fase e le tre pull request di Dependabot con la CI verde |
| Nessun componente fuori supporto | sì. Secondo endoflife.date: Java 25 fino al 2031, Node 26 LTS fino ad aprile 2029, Spring Boot 4.1 fino a luglio 2027, Angular 21 fino a giugno 2027, PostgreSQL 18 fino a novembre 2030, RabbitMQ 4.4 fino a luglio 2027, Python 3.12 fino a ottobre 2028, Ubuntu 24.04 fino a maggio 2029, Prometheus 3.13 LTS e Grafana 13.3 fino a luglio 2027. Keycloak 26.8, nginx 1.30 e Tailwind 4.3 sono le linee correnti. Karma, deprecato, è nelle Eccezioni (decisione 6) |
| Il job `security` passa con `.trivyignore.yaml` vuoto | sì: CI della #171 e di `main` sul merge `237f910`, e Trivy in locale con le modifiche di questa fase |
| Verifiche di tutti i moduli e suite end to end; soglie di copertura | CI di `main` verde in tutti gli otto job; i tre moduli toccati qui sono verificati in locale, con le soglie rispettate. La suite end to end è stata eseguita per intero nella fase 5, il 2026-11-08, e poi corretta nella prova instabile. Da allora il frontend è cambiato solo nel `Dockerfile` e in `nginx.conf.template`, provati con l'immagine nella fase 7, e nelle patch di questa fase: la suite non è stata ripetuta |
| Azioni GitHub fissate per SHA; Dependabot attivo | sì: i 55 riferimenti `uses:` dei tre workflow sono tutti per SHA; Dependabot ha 13 blocchi settimanali e apre le pull request ogni lunedì |
| Frontend e sito informativo senza root | sì, dalla fase 7 |
| Runbook operativo: PostgreSQL, RabbitMQ e Keycloak, con il ritorno indietro | sì: §8.5 Keycloak, §8.6 PostgreSQL, §8.7 RabbitMQ e §5.5 per i servizi di sviluppo |

### Stato dei lavori

Fase 0 verificata e committata il 2026-11-06 sul ramo `update-versions`, che parte da `4839484`. I commit sono sei, uno per modulo e due per il backend:

- `Limit the cached test contexts`: il limite alla cache dei contesti di test del backend;
- `Update vulnerable backend dependencies`: `pom.xml` e `Dockerfile` del backend;
- `Update Angular and PrimeNG to their last 19.x releases`: `package.json` e lockfile del frontend;
- `Update vulnerable info site dependencies`: lockfile del sito informativo;
- `Update certifi in the OMR service`: i requisiti del servizio OMR;
- `Add expiring Trivy exceptions for the platform upgrade`: `.trivyignore.yaml`, il job `security` e la documentazione.

La verifica visiva ha aggiunto un settimo commit il 2026-11-07, `Align PrimeNG themes with PrimeNG 19.1`: `@primeng/themes` 19.1.4 nel `package.json` e nel lockfile del frontend, allineato a PrimeNG 19.1 (vedi [Verifica visiva del frontend](#verifica-visiva-del-frontend)). La suite end to end ha aggiunto un ottavo commit lo stesso giorno, `Restore the button role of PrimeNG toggle buttons`: `ToggleButtonRoleDirective` nel frontend, con il suo test e una nota nel README della suite (vedi [Suite end to end](#suite-end-to-end)). Sempre il 2026-11-07 il merge `4d78dfb` ha unito il ramo `fix-a11y-defects`, che parte da `main` e ne porta anche `6cdd31c`, `Mark track page image editing as implemented`. I suoi tre commit correggono due difetti di accessibilità già presenti, trovati dalla suite end to end: il nome del campo data del rinvio nel widget delle notifiche e il contrasto di `p-message` e `p-toast`, insieme al preset accessibile di `app.config.ts`, che non arrivava a `providePrimeNG`.

Il ramo è pubblicato e la pull request è la #118. Nella prima esecuzione della CI, il 2026-11-07, sono passati tutti i job tranne `security`, compreso il backend con Java 17. Trivy passava; si fermava semgrep, con 29 segnalazioni della regola `github-actions-mutable-action-tag`, che il set `p/ci` ha aggiunto da poco. semgrep scarica le regole a ogni esecuzione, e su `main` non era mai arrivato a girare perché il job si fermava prima, su Trivy. Il commit `Pin GitHub Actions to commit SHAs` fissa le sette azioni allo SHA del commit a cui portava il loro tag maggiore, con la versione in commento, e anticipa così la parte della fase 1 che le fissa per SHA. Per `pnpm/action-setup` il tag `v4` porta alla 4.3.0: la 4.4.0 è lo stesso commit della 5.0.0. Con quel commit la CI della pull request è passata in tutti gli otto job, lo stesso giorno: il backend in 11 minuti con Java 17, il servizio OMR in 5, gli altri in meno di 2.

Dopo il commit `3838a8d`, che registrava la CI verde, il job `frontend` è fallito una volta, su `GuidedTourService invites the members present at the release instead of opening the tour`. Il test dipendeva dall'ordine casuale di Jasmine. La spec di `MediaThumbnailComponent` chiudeva l'anteprima di PrimeNG con `closePreview()` e distruggeva subito il componente: `Image` è `OnPush`, la vista non si aggiornava e la maschera, spostata nel `body`, restava nel documento. Il servizio della guida non si apre con una maschera aperta, quindi falliva il primo test della guida eseguito dopo, se si aspettava la guida aperta. Il commit `b2c16dc`, `Fix order-dependent guided tour test`, chiude l'anteprima dal pulsante e attende la fine dell'animazione; la spec della guida toglie le maschere anche prima di ogni test. Con quel commit la CI è passata di nuovo in tutti gli otto job. La pull request è stata unita su `main` il 2026-11-07 con il merge `0dc1d7d`: la fase 0 è chiusa.

Fase 1 verificata il 2026-11-07 sul ramo `upgrade-phase-1`, che parte da `0dc1d7d` (vedi [Esito della fase 1](#esito-della-fase-1)). I commit sono quattro:

- `Update GitHub Actions to their latest releases`: le azioni dei tre workflow;
- `Update the CI security scanners`: il job `security`, `.gitleaks.toml`, `.trivyignore.yaml` e il Runbook di test;
- `Add Dependabot configuration`: `.github/dependabot.yml`;
- `Record phase 1 of the platform upgrade`: questa specifica e il catalogo.

La pull request è la #120: la CI è passata in tutti gli otto job alla prima esecuzione. È stata unita su `main` il 2026-11-07 con il merge `0a68922`, e anche lì la CI è passata in tutti gli otto job: la fase 1 è chiusa. Gli aggiornamenti di sicurezza di Dependabot erano già attivi nelle impostazioni del repository: dopo il merge della fase 0 hanno aperto la #119, che porta `http-proxy-middleware` alla 3.0.7 e con lui `@angular-devkit/build-angular` dalla 19.2.27 alla 21.2.29. È un salto di due maggiori, che appartiene alla fase 5, e nel job `frontend` `npm ci` fallisce. Altri tre aggiornamenti di sicurezza, di npm nel backend e nel frontend, non sono arrivati a una pull request; dopo il merge della fase 1 è fallito anche quello di esbuild nel frontend, il cui log richiede l'accesso al repository.

Con il merge della fase 1 gli aggiornamenti di versione hanno aperto 26 pull request, e cinque contraddicevano la specifica (vedi [Esito della fase 1](#esito-della-fase-1)). Le esclusioni sono arrivate con la #147, dal ramo `fix-dependabot-rules`: la CI è passata in tutti gli otto job, e anche su `main` dopo il merge `e5b4b8b` del 2026-11-07. Alla seconda esecuzione Dependabot ha chiuso da solo le pull request escluse, ma ne ha aperte altre che la specifica non vuole. Le regole sulle maggiori sono arrivate con la #151, dal ramo `fix-dependabot-majors`, unita su `main` il 2026-11-07 con il merge `f02bae8`: la CI di `main` è passata in tutti gli otto job. Alla terza esecuzione le pull request aperte rispettano la specifica.

Fase 2 verificata il 2026-11-07 sul ramo `upgrade-phase-2`, che parte da `f02bae8` (vedi [Esito della fase 2](#esito-della-fase-2)). I commit sono due:

- `Update the OMR service libraries`: requisiti, `pyproject.toml`, Dockerfile e `THIRD_PARTY_NOTICES.md` del servizio OMR;
- `Record phase 2 of the platform upgrade`: questa specifica e il catalogo.

La pull request è la #158, unita su `main` il 2026-11-07 con il merge `3d4b45b`: la CI di `main` è passata in tutti i job. Subito dopo Dependabot ha chiuso da solo #140, #142, #144 e #150, che la fase conteneva. Uno dei cinque job di Dependabot sul merge è fallito, e il suo log richiede l'accesso al repository. La fase 2 è chiusa.

Fase 3 verificata il 2026-11-07 sul ramo `upgrade-phase-3`, che parte da `3d4b45b` (vedi [Esito della fase 3](#esito-della-fase-3)). I commit sono sei:

- `Update the Keycloak provider to Keycloak 26.8.2`: `pom.xml`, wrapper Maven, IT e README del provider;
- `Fix the Taurus theme on Keycloak pages`: modelli, messaggi italiani e `login.css` del tema, con le prove nuove di `TenantRoleFlowIT` e il suo realm (vedi [Esito della fase 3](#esito-della-fase-3));
- `Build the Keycloak provider with Java 21 in CI`: i job `keycloak` e `publish-provider` dei workflow;
- `Use Keycloak 26.8.2 in the backend development services`: `keycloak.yml` e i due IT del backend su Keycloak;
- `Use Keycloak 26.8.2 in the deployment manifest`: `compose.yml`, `.env.example` e README del deploy;
- `Record phase 3 of the platform upgrade`: `.trivyignore.yaml`, `AGENTS.md`, `README.md`, i runbook, lo standard delle e-mail, questa specifica e il catalogo.

La pull request è la #159, unita su `main` il 2026-11-07 con il merge `385acb0`. La CI di `main` è passata in tutti gli otto job. Dependabot ha chiuso da solo la #129, che la fase conteneva con Keycloak 26.8.2 al posto della 26.8.1. La fase 3 è chiusa.

Fase 4a verificata il 2026-11-08 sul ramo `upgrade-phase-4a`, che parte da `385acb0` (vedi [Esito della fase 4a](#esito-della-fase-4a)). I commit sono quattro:

- `Update the backend to Spring Boot 3.5.16 and Java 25`: `pom.xml`, con le soglie di copertura nuove, wrapper Maven e `Dockerfile` del backend, con il codice e i modelli delle e-mail che le versioni nuove chiedono;
- `Replace deprecated APIs in the backend`: mock dei test, `SecurityConfiguration`, `UriComponentsBuilder`, openhtmltopdf e l'endpoint `jhimetrics` in `application.yml`;
- `Build the backend with Java 25 in CI`: i job `backend` e `security` di `verify.yml` e il commento sull'immagine `maven` in `.github/dependabot.yml`;
- `Record phase 4a of the platform upgrade`: `.trivyignore.yaml`, `AGENTS.md`, `README.md`, il README del backend, i runbook, la specifica del riconoscimento del testo, questa specifica e il catalogo.

La pull request è la #160, unita su `main` il 2026-11-08 con il merge `b53d9cc`. La CI di `main` è passata in tutti gli otto job. Dependabot ha chiuso da solo la #157 e la #123, che la fase conteneva, e ha aperto la #161, che porta `maven-wrapper` del backend dalla 3.3.2 alla 3.3.4, con la CI verde. La fase 4a è chiusa.

Fase 4b verificata il 2026-11-08 sul ramo `upgrade-phase-4b`, che parte da `b53d9cc` (vedi [Esito della fase 4b](#esito-della-fase-4b)). I commit sono quattro:

- `Update the backend to Spring Boot 4.1.2 and JHipster 9.4`: `pom.xml`, codice, test e configurazione per Spring Boot 4, Jackson 3 e Testcontainers 2;
- `Replace APIs deprecated by Spring Boot 4`: codici HTTP, annotazioni di JSpecify, container di Testcontainers 2, marker di `CRLFLogConverter` e LiveReload nei profili;
- `Add third-party notices to the backend image`: `THIRD_PARTY_NOTICES.md`, `Dockerfile`, `.dockerignore` e README del backend;
- `Record phase 4b of the platform upgrade`: `.trivyignore.yaml`, il Runbook operativo, questa specifica e il catalogo.

La pull request è la #162, unita su `main` il 2026-11-08 con il merge `6abf728`. La fase 4b è chiusa.

Fase 5 in corso dal 2026-11-08 sul ramo `upgrade-phase-5`, che parte da `6abf728` (vedi [Avanzamento della fase 5](#avanzamento-della-fase-5)). Lo stesso giorno si è deciso di chiudere la fase alla linea 21: il passo ad Angular e PrimeNG 22 sarà oggetto di un'evolutiva successiva (decisione 5). I commit sono quattro:

- `Update the frontend to Angular 21, PrimeNG 21 and Tailwind 4`: `package.json`, lockfile, `angular.json`, configurazione di Tailwind e PostCSS, codice, test e `Dockerfile` del frontend;
- `Build the frontend with Node 26 in CI`: il job `frontend` di `verify.yml`;
- `Exclude PrimeUI-licensed majors from Dependabot`: `.github/dependabot.yml`;
- `Record phase 5 of the platform upgrade`: `.trivyignore.yaml`, `AGENTS.md`, `README.md`, il README del frontend, il Runbook operativo, questa specifica e il catalogo.

La suite end to end e la verifica visiva sono state eseguite il 2026-11-08, e i due difetti trovati sono stati corretti lo stesso giorno (vedi [Suite end to end e verifica visiva della fase 5](#suite-end-to-end-e-verifica-visiva-della-fase-5)). Hanno aggiunto quattro commit:

- `Neutralize the PrimeNG 21 AutoFocus default`: `primeng-autofocus.ts`, con il suo test, e `app.config.ts`;
- `Match accessible names to visible text`: i nomi accessibili della barra superiore, dei widget delle notifiche e delle statistiche e delle pagine di album, calendario, tenant, tracce e utenti;
- `Stabilize the track parts workspace e2e tests`: la prova del workspace delle parti e il README della suite;
- `Record the phase 5 end-to-end run`: la prova dell'importazione iniziale, il README della suite, il Runbook di test, questa specifica e il catalogo.

Il 2026-11-09 il commit `Use the PrimeNG 21 documentation` sostituisce `docs/llms-full.md` con la documentazione della 21 e aggiorna questa specifica e il catalogo. Con questo la fase è pronta per la pull request.

La pull request è la #166, unita su `main` il 2026-11-09 con il merge `6f0f222`. La fase 5 è chiusa.

Fase 6 verificata il 2026-11-09 sul ramo `upgrade-phase-6`, che parte da `6f0f222` (vedi [Esito della fase 6](#esito-della-fase-6)). I commit sono quattro:

- `Update the info site to Astro 7 and pnpm 12`: `package.json`, lockfile, `Dockerfile` e README del sito, e la rimozione di `pnpm-workspace.yaml`;
- `Build the info site with Node 26 in CI`: il job `info-site` di `verify.yml`;
- `Run the repository scripts with Node 26 in CI`: i job `changes` e `documentation` di `verify.yml`, il job `documentation` di `docker-publish.yml` e `cie-trust-anchors.yml`;
- `Record phase 6 of the platform upgrade`: `.trivyignore.yaml`, il commento sulle maggiori di Astro in `.github/dependabot.yml`, `AGENTS.md`, `README.md`, il Runbook operativo, questa specifica e il catalogo.

La pull request è la #167, unita su `main` il 2026-11-09 con il merge `9ff2468`. La fase 6 è chiusa.

Fase 7 verificata il 2026-11-10 sul ramo `upgrade-phase-7`, che parte da `9ff2468` (vedi [Esito della fase 7](#esito-della-fase-7)). I commit sono sette:

- `Serve the frontend with unprivileged nginx`: `Dockerfile` e `nginx.conf.template` del frontend;
- `Serve the info site with unprivileged nginx`: `Dockerfile`, `nginx.conf`, `docker-compose.yml`, smoke test dell'immagine e README del sito;
- `Update the development services`: i compose di `taurus-be/src/main/docker`, con la rimozione di `jhipster-control-center.yml`, e le immagini dei test del backend, con le code durevoli di `RabbitMqBrokerIT`;
- `Move the dev container to Java 25`: il dev container del backend;
- `Test the provider e-mails with Mailpit 1.33`: l'IT delle e-mail del provider;
- `Update PostgreSQL and RabbitMQ in the production manifest`: `deploy/compose.yml`, `.env.example` e README del deploy, `validate-deploy-manifest.sh` e `restore-test.sh`;
- `Record phase 7 of the platform upgrade`: `.trivyignore.yaml`, il Runbook operativo, il Runbook di test, questa specifica e il catalogo.

La pull request è la #170, unita su `main` il 2026-11-10 con il merge `63a9c36`. La fase 7 è chiusa.

Pillow 13 verificato il 2026-11-10 sul ramo `upgrade-omr-pillow-13`, che parte da `63a9c36`, prima di chiudere la fase 8 (vedi [Pillow 13 nel servizio OMR](#pillow-13-nel-servizio-omr)). I commit sono due:

- `Update Pillow to 13 in the OMR service`: requisiti, `pyproject.toml`, `Dockerfile` e `THIRD_PARTY_NOTICES.md` del servizio OMR;
- `Record Pillow 13 in the OMR service`: `.trivyignore.yaml`, `.github/dependabot.yml`, questa specifica e il catalogo.

La pull request è la #171, unita su `main` il 2026-11-10 con il merge `237f910`. La CI è passata in tutti gli otto job, sulla pull request e su `main`: il job `security` passa con `.trivyignore.yaml` senza voci.

Fase 8 verificata il 2026-11-10 sul ramo `upgrade-phase-8`, che parte da `237f910` (vedi [Esito della fase 8](#esito-della-fase-8)). I commit sono cinque:

- `Update Angular and Tailwind in the frontend`: `package.json` e lockfile del frontend, senza `@angular/platform-browser-dynamic`;
- `Update python-dateutil and pip in the OMR service`: i requisiti e il `Dockerfile` del servizio OMR;
- `Update the backend npm tools`: `package.json` e lockfile del backend;
- `Keep the Trivy and Dependabot rules after the platform upgrade`: `.trivyignore.yaml`, `.github/dependabot.yml` e il job `security` di `verify.yml`;
- `Record phase 8 of the platform upgrade`: il Runbook di test, questa specifica e il catalogo.

La pull request è la #175, unita su `main` il 2026-11-11 con il merge `da7d102`. La CI di `main` è passata in tutti gli otto job, `security` compreso con `.trivyignore.yaml` senza voci. Dopo il merge Dependabot ha chiuso da sé le pull request che la fase contiene o esclude: la #126, la #127, la #128, la #156, la #164, la #172, la #173 e la #174. Ha sostituito la #165 e la #169 con la #178 e la #177, che portano anche gli aggiornamenti usciti nel frattempo, e ha aperto la #176. Da qui le pull request di Dependabot seguono il flusso ordinario della decisione 7. La fase 8 è chiusa, e con lei l'aggiornamento.

#### Verifiche eseguite

| Modulo | Comando | Esito |
| --- | --- | --- |
| Repository | Trivy 0.70.0 come nella CI, con `--ignorefile .trivyignore.yaml` | nessuna segnalazione, codice di uscita 0 |
| Repository | `validate-feature-catalog.mjs`, `feature-catalog.test.mjs`, `check-feature-drift.mjs` | superati |
| Frontend | `npm run build` | riuscita; due avvisi di budget CSS: `pdf-manipulator-dialog.component.scss` 7,72 kB e `preview.component.scss` 7,95 kB, sul limite di 7 kB |
| Frontend | `npm run test:coverage` | 736 test su 736; copertura sopra la baseline (statements 64,46%, branches 54,29%, lines 66,53%) |
| Frontend | `npm run build` e `npm run test:coverage` con `@primeng/themes` 19.1.4 | build riuscita con gli stessi due avvisi di budget; 736 test su 736, copertura sopra la baseline (statements 64,48%, branches 54,31%, lines 66,54%) |
| Frontend | verifica visiva nel browser integrato | vedi [Verifica visiva del frontend](#verifica-visiva-del-frontend) |
| Frontend | `npm run e2e`, profili desktop e mobile, con i tenant di prova `E2E1` ed `E2E2` | 40 superate, 38 saltate, 16 fallite in 19 minuti: vedi [Suite end to end](#suite-end-to-end) |
| Frontend | `inventory-qr.spec.ts` e `onboarding-import.spec.ts` con le funzionalità accese su `E2E1` | 14 superate, 6 saltate: le prove sull'oggetto, senza `E2E_INVENTORY_QR_CODE` |
| Frontend | `npm run build` e `npm run test:coverage` con `ToggleButtonRoleDirective` | build riuscita con gli stessi due avvisi di budget; 741 test su 741, copertura sopra la baseline (statements 64,54%, branches 54,36%, lines 66,59%) |
| Frontend | `accessibility.spec.ts` dopo la correzione, e axe su tracce, album e calendario | pagina di accesso senza violazioni; la dashboard dell'amministratore resta con `label` sul campo data delle notifiche, difetto già presente; tracce, album e calendario senza violazioni |
| Frontend | login in Google Chrome 156 con il service worker attivo | riuscito: vedi [Suite end to end](#suite-end-to-end) |
| Frontend | `npm run build` e `npm run test:coverage` dopo il merge di `fix-a11y-defects` | build riuscita con gli stessi due avvisi di budget; 752 test su 752, copertura sopra la baseline (statements 64,59%, branches 54,37%, lines 66,64%); le misure di contrasto di `accessible-theme.spec.ts` passano sui token di `@primeng/themes` 19.1.4 |
| Repository | `validate-feature-catalog.mjs` e `check-feature-drift.mjs` dopo il merge | superati |
| Tutti | CI della pull request #118, prima esecuzione | superati tutti i job tranne `security`: 29 segnalazioni di semgrep sulle azioni non fissate per SHA |
| Repository | semgrep 1.97.0 con `p/ci`, come nel job `security`, sui file versionati con le azioni fissate per SHA | 0 segnalazioni su 1798 file, codice di uscita 0; sui workflow di prima, 29 segnalazioni come in CI |
| Tutti | CI della pull request #118 sul commit `Pin GitHub Actions to commit SHAs` | otto job su otto superati, fra cui `security` e `backend` con Java 17 |
| Frontend | `npm run test:coverage` dopo `Fix order-dependent guided tour test`, e la spec della guida con una maschera inserita prima di ogni test | 752 test su 752, copertura sopra la baseline (statements 64,66%, branches 54,48%, lines 66,68%); con la maschera la spec precedente falliva 3 test, quella corretta nessuno |
| Tutti | CI della pull request #118 sul commit `Fix order-dependent guided tour test` | otto job su otto superati |
| Tutti | CI di `main` sul merge `0dc1d7d` | superata |
| Repository | actionlint 1.7.12 sui tre workflow della fase 1 | gli stessi 6 avvisi di shellcheck di `main`, nessuno nuovo |
| Repository | `./mvnw -B -q dependency:resolve` nel backend e nel provider, come nel job `security` | riuscito in entrambi: meno di mezzo minuto ciascuno con il repository Maven locale già pieno, circa 2 minuti ciascuno, 307 MB in tutto, partendo da un repository vuoto |
| Repository | Trivy 0.76.2 come nella CI, con il solo repository Maven creato da `dependency:resolve` | nessun errore di Maven Central, codice di uscita 0; soppresse 76 voci nel backend e 3 nel provider, cioè tutte: il passo basta anche senza la cache del job `backend` |
| Repository | Trivy 0.76.2 come nella CI, senza repository Maven locale | errore 429 di Maven Central sul `pom.xml`, codice di uscita 1 |
| Repository | Trivy 0.76.2 e 0.70.0 con il repository Maven locale e il `.trivyignore.yaml` della fase 0 | 75 vulnerabilità nel `pom.xml` del backend e 3 in quello del provider, le stesse con le due versioni |
| Repository | Trivy 0.76.2 come nella CI, con il repository Maven locale e le voci della fase 1 | nessuna segnalazione, codice di uscita 0 |
| Repository | gitleaks 8.30.1 come nella CI, su tutta la storia | nessuna fuga su 612 commit; senza le due voci nuove dell'allowlist, 5 falsi positivi |
| Repository | semgrep 1.183.0 con `p/ci`, come nel job `security` | 0 segnalazioni con 88 regole su 1785 file, codice di uscita 0; con `cooldown` di 3 giorni, 13 segnalazioni |
| Repository | `.github/dependabot.yml` contro lo schema di SchemaStore, con `ajv-cli` 5.0.0 | valido |
| Repository | `validate-feature-catalog.mjs`, `feature-catalog.test.mjs` e `check-feature-drift.mjs` dopo la fase 1 | superati |
| Tutti | CI della pull request #120 | otto job su otto superati alla prima esecuzione |
| Tutti | CI di `main` sul merge `0a68922` | otto job su otto superati |
| Repository | tag su Docker Hub delle immagini proposte da Dependabot, e `ignore_condition.rb` e `requirement.rb` di dependabot-core | ultimo push di `node:26-alpine` il 2026-11-05 e di `node:25-alpine` il 2026-04-15; `nginx:1.31-alpine`, mainline, ripubblicata il 2026-11-06 come `alpine`; gli intervalli separati da virgola valgono come «e» per Docker |
| Repository | `requires_dist` di homr 0.7.0 su PyPI | limiti superiori su nove librerie fissate nei requisiti, nessuno su music21 |
| Repository | `.github/dependabot.yml` con le esclusioni, contro lo schema di SchemaStore con ajv 8.18.0 | valido |
| Repository | semgrep 1.183.0 con `p/ci`, come nel job `security`, con le esclusioni | 0 segnalazioni con 88 regole su 1785 file, codice di uscita 0 |
| Repository | `validate-feature-catalog.mjs`, `feature-catalog.test.mjs` e `check-feature-drift.mjs` con le esclusioni | superati |
| Tutti | CI della pull request #147 e di `main` sul merge `e5b4b8b` | otto job su otto superati in entrambe |
| Repository | seconda esecuzione di Dependabot e CI delle sue pull request | 20 job di Dependabot superati; chiuse da sole #121, #122, #124, #125, #138 e #145; CI rossa su #132 (`npm ci`), #137 (`./mvnw verify`), #133–#136 e #139 |
| Frontend | `npm ci --ignore-scripts --dry-run` con `package.json` e lockfile della #132, Node 22.11.0 | `ERESOLVE`: zone.js 0.16.3 contro `~0.15.0` di `@angular/core` 19.2.25 |
| Repository | `node:23-alpine` su Docker Hub e `version.rb` di dependabot-core | ultimo push il 2025-05-31; con `update-types` l'intervallo parte dalla versione installata: `>= 20.a` per le maggiori di Angular 19, `>= 0.16.a, < 1` e `>= 1.a` per minor e maggiori di zone.js 0.15 |
| Repository | `.github/dependabot.yml` con le regole sulle maggiori, contro lo schema di SchemaStore con ajv 8.18.0 | valido |
| Repository | semgrep 1.183.0 con `p/ci`, come nel job `security`, con le regole sulle maggiori | 0 segnalazioni con 88 regole su 1785 file, codice di uscita 0 |
| Repository | i controlli del job `documentation` con le regole sulle maggiori | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento |
| Tutti | CI di `main` sul merge `f02bae8` e terza esecuzione di Dependabot | otto job su otto superati e 19 job di Dependabot superati; chiuse da sole #131–#137, #139, #148 e #149 |
| Servizio OMR | in `python:3.12-slim`, `pip install` con `--uploaded-prior-to 2026-10-31T18:00:00Z` delle dipendenze di `pyproject.toml` con homr 0.7.0, di quelle dei test e del rendering del corpus, poi `pip freeze` e `pip check` | nessun conflitto nei tre ambienti; senza il limite di data, otto versioni più recenti |
| Servizio OMR | `python -m pytest` in `python:3.12-slim` con i requisiti nuovi | 71 superati, 6 saltati: i test di accuratezza |
| Servizio OMR | `docker build` dell'immagine | riuscita; le otto impronte di `models.sha256` corrispondono |
| Servizio OMR | `tests/test_accuracy.py` sull'immagine nuova, con le restrizioni di `omr.yml` | 6 test su 6 in 3 minuti: 132 battute su 151 con Audiveris (87%) e 124 con homr (82%), segni di struttura 15 e 6 su 26, nomi delle parti 6 su 6 |
| Servizio OMR | `/v1/midi-conversions` dell'immagine nuova con un file MIDI di due parti creato con music21 | risposta 200 con 2 parti, 4 battute e 16 note; `/v1/health` riporta music21 10.5.2 |
| Repository | Trivy 0.76.2 come nella CI sul servizio OMR | con `.trivyignore.yaml` nessuna segnalazione; senza, le 28 vulnerabilità di Pillow 12.3.0 e nessun'altra |
| Repository | i controlli del job `documentation` con la fase 2 | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento |
| Sito informativo | `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:image` | superati |
| Servizio OMR | `python -m pytest` in `python:3.12-slim` con `requirements-test.txt` | 71 superati, 6 saltati: i test di accuratezza, che chiedono un servizio con i motori reali |
| Backend | `./mvnw verify -Dtaurus.test.requireDocker=true`, con RabbitMQ irraggiungibile come in CI | superata in 26 minuti: 1225 test unitari e 279 di integrazione; copertura unita 75,59% delle linee e 60,53% dei branch, sopra le soglie |
| Servizio OMR | `docker build` e `tests/test_accuracy.py` sull'immagine costruita, come il job `omr` della CI | immagine costruita con certifi 2026.10.23; 6 test su 6 in 3 minuti: battute lette 87% con Audiveris e 82% con homr, nomi delle parti 6 su 6 |
| Tutti | CI di `main` sul merge `3d4b45b` della fase 2 e quarta esecuzione di Dependabot | tutti i job superati; chiuse da sole #140, #142, #144 e #150; un job di Dependabot su cinque fallito |
| Provider Keycloak | `./mvnw clean verify` con JDK 21 e Maven 3.10.0 | superata in 2 minuti e 15 secondi: 32 test unitari e 10 di integrazione su Keycloak 26.8.2, cioè `TenantRoleFlowIT` 6, `TaurusOtpResourceIT` 3 ed `EmailDeliveryIT` 1; con `javap` le classi sono nella versione 65, Java 21, in `target/classes` e nel JAR |
| Provider Keycloak | `java -version` nell'immagine `quay.io/keycloak/keycloak:26.8.2` | OpenJDK 21.0.13 |
| Backend | `SharedUserAccountKeycloakIT` e `OnboardingKeycloakIT` con Keycloak 26.8.2 e `-Dtaurus.test.requireDocker=true` | 9 test su 9, 7 e 2 |
| Repository | Trivy 0.76.2 come nella CI sul provider, con i POM del repository Maven locale dopo `dependency:resolve` | nessuna segnalazione, con e senza `.trivyignore.yaml`; senza il repository locale Maven Central risponde 429, come nella fase 1 |
| Provider Keycloak | modelli e messaggi di `keycloak.v2` e `base` estratti dalle immagini 26.6.4 e 26.8.2 | `registrationLayout` e sezioni invariati; nuovi `login-update-profile.ftl` e `login-verify-email.ftl`; una chiave italiana nuova; modelli delle e-mail usati da Taurus identici |
| Provider Keycloak | prova a mano su Keycloak 26.8.2 con il JAR della build, il realm di Taurus e Mailpit, nel browser integrato | flussi riusciti, e-mail con il tema Taurus: vedi [Esito della fase 3](#esito-della-fase-3) |
| Repository | i controlli del job `documentation` con la fase 3 | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento |
| Provider Keycloak | `./mvnw clean verify` con JDK 21 dopo la correzione del tema | superata: 32 test unitari e 13 di integrazione, cioè `TenantRoleFlowIT` 9, con le tre prove nuove sulle pagine del tema, `TaurusOtpResourceIT` 3 ed `EmailDeliveryIT` 1 |
| Provider Keycloak | prova a mano del tema corretto su Keycloak 26.8.2 usa e getta, con il JAR della build, il realm di Taurus e Mailpit, nel browser integrato a 375×812 | in stile Taurus conferma dell'uscita, errore, aggiornamento del profilo con l'errore su un campo vuoto, verifica dell'e-mail, informazione dell'invito, account aggiornato e pagina scaduta; app di autenticazione con i nomi delle app, un solo link al codice manuale, codice in vista con lo script, aprendo il link e dopo un codice sbagliato, configurazione conclusa; ritorno all'accesso con una sola «; «È necessario selezionare un tenant» con l'accento; nessun errore dei modelli nel log |
| Repository | i controlli del job `documentation` dopo la correzione del tema | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento |
| Backend | compilazione con JDK 25.0.5 e `release` 25 | riuscita; gli unici avvisi sono le proprietà non mappate di MapStruct, già presenti, e nessuno di deprecazione |
| Backend | `./mvnw clean package -DskipTests` con JDK 25 dopo le correzioni chieste da modernizer | riuscita: modernizer 3.5.0 senza violazioni, contro le 54 della prima prova |
| Backend | Checkstyle 14.4.0 con nohttp 0.0.11 | 0 violazioni |
| Backend | `./mvnw verify -Dtaurus.test.requireDocker=true` con JDK 25 e RabbitMQ irraggiungibile come in CI | superata in 27 minuti: 1225 test unitari e 279 di integrazione; copertura unita 77,28% delle linee e 61,70% dei branch, sopra le soglie di allora, 0,75 e 0,60; con le soglie nuove, 0,77 e 0,61, `jacoco:check` sugli stessi dati passa |
| Backend | invio di una notifica Web Push, con il classpath del backend e Java 25, a un server HTTP locale | risposta 201, payload `aesgcm`, JWT VAPID valido per jose4j 0.9.7: vedi [Esito della fase 4a](#esito-della-fase-4a) |
| Backend | nomi delle metriche con `micrometer-registry-prometheus` 1.15.12 e con `micrometer-registry-prometheus-simpleclient` 1.15.12, con gli stessi binder | gli stessi 31 nomi |
| Provider Keycloak | `./mvnw -DskipTests package` con JDK 25 | riuscita: lo stesso JDK compila il backend per Java 25 e il provider per Java 21 |
| Repository | Trivy 0.76.2 come nella CI sul backend, con i POM del repository Maven locale | senza `.trivyignore.yaml` CVE-2026-47884 e CVE-2026-47890 di spring-webmvc 6.2.19 e DS-0002 del dev container; con il file nessuna segnalazione |
| Repository | i controlli del job `documentation` con la fase 4a | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento |
| Backend | compilazione con JDK 25 su Spring Boot 4.0.9 e su 4.1.2, con gli avvisi di deprecazione | riuscita in entrambe; gli unici avvisi di deprecazione sono le quattro di `@Temporal` in `Albums` e `Users` |
| Backend | `./mvnw verify -Dtaurus.test.requireDocker=true` su Spring Boot 4.0.9, con RabbitMQ irraggiungibile come in CI | prima esecuzione: 265 errori in 11 test di configurazione della sicurezza, senza contesto per la chiave `spring.jackson.serialization.write-durations-as-timestamps`; seconda: 1225 test unitari e 278 di integrazione su 279, con `ExceptionTranslatorIT` che si aspettava «Unprocessable Entity»; dopo la correzione i suoi 14 test passano |
| Backend | test temporaneo di confronto del JSON: Jackson 2 su `b53d9cc`, Jackson 3 su 4.0.9 e su 4.1.2 | 230 classi DTO con JSON identico, rilettura compresa; JSON canonico di hash e firme identico, salvo il record `Checked` che Jackson 2 non serializzava; senza `use-jackson2-defaults`, 39 righe diverse |
| Backend | chiavi di `application*.yml` contro i metadati di configurazione di Spring Boot 4.0.9 e 4.1.2 | tutte valide; nella 4.1 è deprecata solo `spring.devtools.livereload.enabled`, tolta |
| Backend | `./mvnw verify -Dtaurus.test.requireDocker=true` su Spring Boot 4.1.2, con RabbitMQ irraggiungibile come in CI | prima esecuzione, con Trivy in parallelo: fallito il test di tempo dell'analisi di una pagina A4 (5298 ms su 5000); seconda: superata in 30 minuti, 1225 test unitari e 279 di integrazione, copertura unita 77,27% delle linee e 61,68% dei branch, sopra le soglie 0,77 e 0,61 |
| Backend | nomi delle metriche con `micrometer-registry-prometheus` 1.17.2, con i binder della fase 4a | i 31 nomi della fase 4a, più `jvm_classes_loaded_count_classes_total` e le tre serie di `jvm_gc_pause_seconds` |
| Repository | Trivy 0.76.2 come nella CI sul backend, con i POM del repository Maven locale | senza `.trivyignore.yaml` nessuna vulnerabilità nel `pom.xml`, con 212 pacchetti risolti fra cui spring-webmvc 7.0.10, e DS-0002 del dev container; con il file nessuna segnalazione |
| Backend | `docker build` del `Dockerfile` e Trivy 0.76.2 sull'immagine, `HIGH` e `CRITICAL` corrette | build riuscita, `THIRD_PARTY_NOTICES.md` accanto ad `app.jar`, processo con l'utente `taurus`; nel JAR nessuna vulnerabilità, nell'immagine base Ubuntu 26.04 CVE-2026-109518 di `apt` e `libapt-pkg` |
| Repository | i controlli del job `documentation` con la fase 4b | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento |
| Frontend | `npm run build` e `npm run test:coverage` su Angular 20.3.34 e PrimeNG 20.4.0 | build riuscita; 751 test superati e 1 fallito, quello di `aria-disabled` della direttiva dei ToggleButton |
| Frontend | `npm run build` su Angular 21.2.25, PrimeNG 21.1.10 e Tailwind 4.3.3, Node 26.13.0 | riuscita, con i due avvisi di budget CSS già presenti: `pdf-manipulator-dialog.component.scss` 7,72 kB e `preview.component.scss` 7,95 kB |
| Frontend | `npm run test:coverage` sullo stesso stato | 751 test su 751; copertura sopra la baseline (statements 64,57%, branches 54,40%, lines 66,63%) |
| Frontend | `npm ls --all` con il lockfile rigenerato | nessun errore |
| Frontend | `npm run test:coverage` con `jasmine-core` 7 e 6 forzati con `overrides` | con la 7 nessun test parte; con la 6 la suite si ferma dopo 112 test: vedi [Eccezioni](#eccezioni-alla-versione-più-recente) |
| Repository | Trivy 0.76.2 come nella CI sul frontend | senza `.trivyignore.yaml` nessuna vulnerabilità nel lockfile e DS-0002 del `Dockerfile`; con il file nessuna segnalazione |
| Frontend | `npm audit` | 18 vulnerabilità moderate, tutte in dipendenze di sviluppo della CLI di Angular |
| Frontend | `npm run e2e` su Angular 21 e PrimeNG 21, profili desktop e mobile, con i tenant di prova `E2E1` ed `E2E2` | 53 superate, 39 saltate, 2 fallite in 6 minuti: la prova di accessibilità, nei due profili, per `label-content-name-mismatch`; vedi [Suite end to end e verifica visiva della fase 5](#suite-end-to-end-e-verifica-visiva-della-fase-5) |
| Frontend | verifica visiva con Playwright, chiaro e scuro, 1280×800 e 375×812 | nessuna regressione di aspetto, nessuno scorrimento orizzontale, nessun errore in console; focus spostato al caricamento dalla direttiva `AutoFocus` di PrimeNG 21 |
| Frontend | `npm run test:coverage` e `npm run build` dopo le correzioni dei due difetti, Node 26.13.0 | 757 test su 757, copertura sopra la baseline (statements 64,64%, branches 54,57%, lines 66,68%); build riuscita con i due avvisi di budget CSS già presenti. Un primo giro dei test si era fermato a 553, tutti superati, per un ping timeout di Karma verso Chrome headless |
| Frontend | axe con Playwright dopo le correzioni, su dashboard, tracce, album, calendario e utenti, a 1280 e a 375 pixel, e con il menu della topbar aperto su mobile | nessuna `label-content-name-mismatch`; `color-contrast` solo nella vista mese del calendario, già presente. Nessun elemento con `autofocus` su Economia, dettaglio di una traccia, Inventario, Utenti e Calendario, focus sul documento |
| Frontend | `npm run e2e` dopo le correzioni, Node 26.13.0 | 56 superate, 37 saltate, 1 fallita in 7,5 minuti: accessibilità superata nei due profili; fallita la prova del divisore del workspace delle parti, instabile e non legata alla fase |
| Frontend | `track-parts-workspace.spec.ts` dopo la correzione della prova, profili desktop e mobile, ripetuto due volte, Node 26.13.0 | 16 superate e 8 saltate in 3,5 minuti. Le saltate sono la traccia da 200 parti, senza `E2E_LARGE_TRACK_ID`, e nel profilo mobile trascinamento e divisore. La prova del divisore, ripetuta 8 volte da sola su desktop, passa tutte le volte |
| Repository | `docs/llms-full.md` di PrimeNG 21 confrontato con quello della 22 | 47.982 righe contro 52.869; guide di migrazione fino alla v21; nessuna chiave di licenza nell'installazione; mancano solo le otto pagine dei componenti nuovi della 22 |
| Repository | i controlli del job `documentation` con `docs/llms-full.md` della 21 | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento |
| Sito informativo | `pnpm check`, `pnpm build` e `pnpm test` su Astro 5.18.2 con Node 24.21.0 e pnpm 11.16.0, poi su Astro 6.4.8 e 7.4.5 con Node 26.13.0 e pnpm 12.17.0 | superati a ogni passo: nessun errore né avviso di `astro check`, 8 pagine costruite |
| Sito informativo | confronto delle build di Astro 5.18.2 e 7.4.5, con gli stessi indirizzi, in Chromium 1248 con Playwright 1.64.1 del frontend: otto pagine a 1280×800 e a 375×812 | `innerText` e screenshot dell'intera pagina identici in tutte; nell'HTML spariscono solo spazi fra elementi a blocco |
| Sito informativo | `pnpm install --frozen-lockfile` senza `pnpm-workspace.yaml`, e ricerca degli script di installazione in tutte le dipendenze | riuscito; nessun pacchetto con script `preinstall`, `install` o `postinstall` |
| Sito informativo | `pnpm test:image` con `TAURUS_REQUIRE_DOCKER=1` | immagine costruita da `node:26-alpine` con pnpm 12.17.0 nativo, senza avvisi di npm; salute, home con le intestazioni, pagina di errore e server anonimo verificati |
| Repository | Trivy 0.76.2 come nella CI sul sito, senza `.trivyignore.yaml` | nessuna vulnerabilità nel lockfile, letto per intero: 304 pacchetti, fra cui astro 7.4.5, sharp 0.35.5 e vite 8.3.5; DS-0002 del `Dockerfile` |
| Repository | Trivy 0.76.2 come nella CI su tutto il repository, con il `.trivyignore.yaml` senza le voci del sito e il repository Maven locale | nessuna segnalazione, codice di uscita 0 |
| Repository | gli script dei job `changes`, `documentation` e `cie-trust-anchors` con Node 26.13.0 | superati: moduli coinvolti calcolati, catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori e con lo stesso esito di Node 22.11.0, `features.md` uguale a quello generato, bundle della CIE in regola |
| Servizi | `scripts/ops/validate-deploy-manifest.sh` | manifest valido; con la porta 80 del frontend, con il volume di PostgreSQL su `/var/lib/postgresql/data` o senza l'hostname di RabbitMQ il controllo fallisce, come deve |
| Servizi | procedura del Runbook operativo §8.6 su `deploy/compose.yml`, da PostgreSQL 17.0 a 18.6, e ritorno indietro | dati identici dopo l'aggiornamento e dopo il ritorno; la 18 non parte sul volume della 17, né con il solo tag né con il montaggio nuovo |
| Servizi | RabbitMQ con il manifest di produzione: ricreazione del container senza e con `hostname`, avvio della 4.4.0 sui dati della 4.0.7, ritorno alla 4.0.7 | senza hostname il vhost si perde, con l'hostname resta; la 4.4.0 parte e migra a Khepri, percorso non supportato; la 4.0.7 riparte sana con un nodo nuovo |
| Servizi | avvio di `services.yml` in una copia senza nomi fissi, con un'altra sottorete e senza porte | cinque servizi `healthy` in 75 secondi; PostgreSQL 18.6 con il volume su `/var/lib/postgresql`, nodo `rabbit@rabbitmq`, realm importato con il provider |
| Servizi | `promtool check config` di Prometheus 3.13.5; Grafana 13.3.0 con il provisioning, dashboard JVM aperta con Playwright | configurazione valida; 28 pannelli, quelli Angular migrati a `timeseries` e `stat`, nessun plugin mancante |
| Frontend | immagine costruita e avviata con un Keycloak 26.8.2 di prova | nginx con l'utente 101; `/health`, intestazioni di sicurezza e CSP; `config.json` scritto dall'entrypoint; controllo di salute `healthy`; issuer di Keycloak senza porta attraverso il proxy |
| Sito informativo | `pnpm test:image` con `TAURUS_REQUIRE_DOCKER=1` | superato, compreso il controllo dell'utente non root |
| Backend | dev container costruito con Docker, `VARIANT` 25-trixie e Node 26 | utente `vscode`, OpenJDK 25.0.5, Node 26.13.0 |
| Backend | `./mvnw verify -Dtaurus.test.requireDocker=true`, Java 25.0.5, prima della correzione di `RabbitMqBrokerIT` | 1225 test unitari superati; 279 IT con 5 errori, tutti in `RabbitMqBrokerIT`, sulle code non durevoli rifiutate dalla 4.4 |
| Backend | `./mvnw verify -Dtaurus.test.requireDocker=true` dopo la correzione | 1225 test unitari e 279 IT superati in 23 minuti, compresi `RabbitMqBrokerIT` e `UploadJobPipelineIT` su RabbitMQ 4.4.0 e le migrazioni su PostgreSQL 18.6; soglie di copertura rispettate |
| Provider Keycloak | `./mvnw verify` con Mailpit 1.33.0 | 32 test unitari e 13 IT superati, compreso `EmailDeliveryIT` |
| Servizi | `scripts/ops/restore-test.sh` con PostgreSQL 18.6, contro un database sorgente di prova con due schemi e 240 migrazioni | ripristino verificato: schemi e migrazioni corrispondono all'origine |
| Repository | Trivy 0.76.2 come nella CI, con `.trivyignore.yaml` senza le voci DS-0002 | nessuna segnalazione, codice di uscita 0 |
| Repository | i controlli del job `documentation` con la fase 7, Node 26.13.0 | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento; moduli coinvolti: tutti e cinque |
| Servizio OMR | `python -m pytest` in `python:3.12-slim` con Pillow 13.0.0 | 71 superati, 6 saltati: i test di accuratezza |
| Servizio OMR | `pip install --dry-run -r requirements-accuracy.txt` in `python:3.12-slim` | dipendenze del rendering del corpus risolte con Pillow 13.0.0, senza conflitti |
| Servizio OMR | `docker build` dell'immagine, con `--no-deps` e il filtro di `pip check` | riuscita in un minuto e mezzo; nell'immagine Pillow 13.0.0 e l'utente `omr`; `pip check` segnala solo il limite di homr su Pillow |
| Servizio OMR | il filtro di `pip check` in `ubuntu:24.04`, con uscite di prova | passa con l'uscita vuota e con la sola riga di homr; fallisce con un conflitto in più e con un limite su Pillow di un altro pacchetto, e in una catena con `set -e` ferma la build mostrando la riga in più |
| Servizio OMR | `tests/test_accuracy.py` sull'immagine con Pillow 13.0.0, con le restrizioni di `omr.yml` | 6 test su 6 in 4 minuti: 132 battute su 151 con Audiveris (87%) e 124 con homr (82%), segni di struttura 15 e 6 su 26, nomi delle parti 6 su 6, come nella fase 2 |
| Repository | Trivy 0.76.2 come nella CI sul servizio OMR, senza `.trivyignore.yaml` | nessuna vulnerabilità |
| Repository | Trivy 0.76.2 come nella CI su tutto il repository, con `.trivyignore.yaml` senza voci | nessuna segnalazione, codice di uscita 0 |
| Repository | i controlli del job `documentation` con Pillow 13, Node 26.13.0 | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento; moduli coinvolti: tutti e cinque |
| Tutti | CI della #171 e di `main` sul merge `237f910` | otto job su otto superati in entrambe, compreso `security` con `.trivyignore.yaml` senza voci |
| Repository | `.github/dependabot.yml` della fase 8, contro lo schema di SchemaStore con ajv 8.18.0 | valido; il blocco npm del frontend ignora anche `jasmine-core` e `@types/jasmine` dalla 7 |
| Repository | riferimenti `uses:` dei tre workflow | 55, tutti fissati per SHA del commit |
| Repository | ultime versioni su GitHub, PyPI, npm, Docker Hub e Maven Central dei componenti che Dependabot non legge | tutti all'ultima versione stabile tranne pip 26.2.2, la 26.3 è del 2026-11-02; più recenti, ma da meno di sette giorni: semgrep 1.184.0, Mailpit 1.33.1, SonarQube 26.11, pnpm 12.18.0 |
| Repository | date di fine supporto su endoflife.date | nessun componente fuori supporto; la prima scadenza è Angular 21, a giugno 2027 |
| Servizio OMR | CI della #164 | fallita sulla build dell'immagine, sulla base `6abf728`; test e Trivy superati |
| Servizio OMR | `python -m pytest` in `python:3.12-slim` con python-dateutil 4.0.0 | 71 superati, 6 saltati: i test di accuratezza; `pip check` senza conflitti |
| Servizio OMR | `docker build` con pip 26.3 e python-dateutil 4.0.0, e `tests/test_accuracy.py` sull'immagine con le restrizioni di `omr.yml` | build riuscita; nell'immagine pip 26.3, python-dateutil 4.0.0 e tzdata 2026.6, `pip check` con la sola riga di homr su Pillow; 6 test su 6 in 5 minuti, con gli stessi numeri della fase 2 |
| Frontend | CI della #172 | fallita su `npm ci`: `@angular/platform-browser-dynamic` 21.2.25 chiede `@angular/core` 21.2.25 |
| Frontend | lockfile senza `@angular/platform-browser-dynamic`, risolto con `npm install --before=2026-11-03T23:59:59Z` dopo aver tolto le voci con il nome esatto dei pacchetti aggiornati | Angular 21.2.26, Tailwind 4.3.4 e lightningcss 1.33.0; nessun'altra versione cambia; `npm audit` uguale a prima, 18 avvisi moderati |
| Frontend | `npm install`, `npm ls --all`, `npm run check:tour-anchors`, `npm run test:coverage`, `npm run build` con Node 26.13.0 | lockfile invariato dall'installazione; 757 test su 757, copertura sopra la baseline (statements 64,62%, branches 54,54%, lines 66,67%); build riuscita con i due soliti avvisi di budget CSS |
| Backend | `npm install` degli strumenti nuovi con Node 26.13.0, `lint-staged --version`, `jhipster --version`, `lint-staged --debug` senza file in stage | installati; lint-staged 17.6.0 e generator-jhipster 9.4.0; lint-staged carica `.lintstagedrc.cjs` |
| Backend | `prettier --end-of-line auto --check` sui file degli script `prettier:*`, con gli strumenti vecchi e con i nuovi | nessun errore dei plugin; file non formattati 865 con i vecchi e 872 con i nuovi: il codice non è tenuto formattato con Prettier e nessun controllo lo chiede |
| Backend | `npm audit --package-lock-only` prima e dopo | da 56 avvisi (3 critici, 19 alti) a 38 (2 critici, 2 alti), tutti da simple-git 3.36.0 fissato da generator-jhipster 9.4.0 |
| Repository | Trivy 0.76.2 come nella CI su tutto il repository, con le modifiche della fase 8 | nessuna segnalazione, codice di uscita 0 |
| Repository | i controlli del job `documentation` con la fase 8, Node 26.13.0 | superati: catalogo valido, 11 e 13 test superati, catalogo degli errori senza errori, `features.md` uguale a quello generato, nessun disallineamento; moduli coinvolti: tutti e cinque |

Non ripetuta dopo la correzione: l'intera `npm run e2e`. La direttiva tocca solo attributi ARIA, e la suite di accessibilità è stata ripetuta. Dopo il merge di `fix-a11y-defects` non sono stati ripetuti né axe né la suite end to end: le due correzioni sono state verificate con axe sul loro ramo, con PrimeNG 19.0.10, e sul ramo unito le coprono i test unitari.

#### Verifica visiva del frontend

Eseguita il 2026-11-06 nel browser integrato dell'app desktop di Claude, con `npm start`, il backend locale e il superadmin di sviluppo sul tenant della banda. Sono state viste le pagine del [Taurus Layout Standard](taurus-layout-standard.md) in tema scuro e chiaro, a 1280×800 e a 375×812: Utenti, Strumenti in lista e griglia, Tenant, Inventario, Economia, Calendario in lista e mese, Documenti legali con l'editor, Profilo, Configurazione iniziale, Consegne notifiche, Feed calendario, la pagina 404. Anche i dialoghi Nuovo utente e Nuovo evento con il selettore di data e ora, la conferma di eliminazione, il menu laterale su mobile, il dettaglio di una traccia con parti, ascolto e file PDF, l'anteprima degli spartiti nel lettore PDF e il lettore della partitura con Verovio.

- **Difetto trovato e corretto.** PrimeNG 19.1 usa token di tema che `@primeng/themes` 19.0.5 non definisce, fra cui `togglebutton.content.padding`, `button.sm.icon.only.width` e `progressspinner.color.one`. Le variabili CSS mancanti azzeravano le proprietà: il contenuto di SelectButton e ToggleButton misurava 14×14 pixel, senza padding né arrotondamento. Con `@primeng/themes` 19.1.4 le variabili sono definite e il contenuto misura 35×21, con padding e angoli di 6 pixel.
- **Service worker nel browser integrato.** Dopo il riavvio di `npm start` il worker, in stato degradato per l'hash cambiato di un chunk, rispondeva 504 a ogni richiesta verso Keycloak e il backend: la sua `fetch` falliva con `TypeError: Failed to fetch` e l'app tornava alla pagina di logout. Non dipende dall'aggiornamento: in `ngsw-worker.js` il codice che inoltra le richieste di altre origini è identico fra la 19.0.5 e la 19.2.25, che cambiano solo le richieste di cache-busting degli asset e lo scope degli script dei worker. Per la verifica il worker è stato disattivato a mano e la modifica è stata tolta subito dopo. Il login in Chrome con il worker attivo, il 2026-11-07, è riuscito (vedi [Suite end to end](#suite-end-to-end)).
- **Già presenti, non regressioni.** In Inventario il cestino va sotto «Modifica» perché la pagina è dentro `<p-fluid>`, e in Button la regola che rende il pulsante fluido è identica fra PrimeNG 19.0.10 e 19.1.4. Nel dialogo Nuovo utente il campo Strumenti resta stretto. Su mobile gli step di Configurazione iniziale scorrono in orizzontale dentro la loro riga, senza allargare la pagina. In console restano i 401 delle pagine pubbliche senza sessione e due NG0100 della sola modalità di sviluppo: `p-inputtext-fluid` nel dettaglio della traccia, da InputText, identico fra le due versioni di PrimeNG, e `LoadingSpinnerComponent`.

#### Suite end to end

Eseguita il 2026-11-07 con `npm start`, il backend locale e i profili desktop e mobile.

- **Ambiente.** Le password dei sei utenti `e2e-*` del realm di sviluppo sono state reimpostate nel Keycloak locale, e le variabili `E2E_*` le passano alla suite. `E2E2` era stato cancellato del tutto: riga in `public.tenant`, registro degli schemi, schema e gruppo di Keycloak. È stato ricreato come chiede il [README della suite](../taurus-fe/e2e/README.md): il backend crea lo schema subito dopo l'avvio, poi si aggiungono `app_user` e ruoli dei due utenti. Il lockfile della fase 0 porta Playwright dalla 1.49.1 alla 1.65.0: al primo giro ogni prova falliva in pochi millisecondi perché mancava `chromium_headless_shell-1254`, poi installato con `npx playwright install --only-shell chromium`.
- **Regressione trovata e corretta.** In PrimeNG 19.1 ToggleButton non disegna più un `<button>`: `aria-pressed`, `tabindex` e la tastiera stanno sull'elemento `p-togglebutton`, che non ha ruolo. axe segnala `aria-allowed-attr` (critical) sui selettori lista e griglia di tracce, album e calendario, e un lettore di schermo non annuncia un pulsante. Il difetto tocca ogni SelectButton e ToggleButton. La 19.1.4 è l'ultima 19 gratuita e nessuna vulnerabilità la richiede: si tiene e si corregge nell'applicazione. `ToggleButtonRoleDirective`, in `taurus-fe/src/app/directive`, sta nel modulo condiviso `ImportsModule` e nei tre componenti che importano PrimeNG da sé. Aggiunge `role="button"` e `aria-disabled`, e porta sull'elemento l'`ariaLabel` di ToggleButton, che nessuna delle due versioni usa. I ToggleButton creati da SelectButton li cerca sotto l'host e li segue con un `MutationObserver`. Dopo la correzione tracce, album e calendario sono senza violazioni, e il selettore lista e griglia risponde al clic e a Invio.
- **Effetti dell'ambiente.** Le prove del QR inventario e della configurazione iniziale, 7 per profilo, andavano in timeout: su `E2E1` inventario, QR e importazione iniziale sono spenti dal 2026-11-04. Con la funzionalità spenta il frontend non apre la pagina e la risposta che la prova aspetta non arriva, mentre la prova si salta solo davanti a un 403 del backend. Accese per la prova e poi rimesse com'erano, le funzionalità fanno passare tutte le prove che non chiedono un codice QR.
- **Già presenti, non regressioni.** Sulla dashboard il campo data per posticipare una notifica riceve l'etichetta con `[attr.aria-label]`, che resta sull'host di `p-datepicker`: axe segnala `label` (critical) per ogni notifica. Il 2026-10-31 non si vedeva perché l'amministratore non aveva notifiche. Su `/legal/privacy`, senza un documento in vigore, l'avviso `warn` ha il testo a 2,84:1 sul fondo, con token e CSS di Message identici fra le due versioni. Nel profilo il titolo della zona pericolosa e i pulsanti `danger` restano sotto 4,5:1, il gap già annotato in `accessible-theme.ts`. I primi due sono stati corretti il 2026-11-07 nel ramo `fix-a11y-defects`, unito a questo: il campo usa l'ingresso `ariaLabel`, che arriva all'input, e il testo di Message e Toast passa alla tinta 700 in modalità chiara, alla 800 per `warn`, e alla 400 in modalità scura. L'avviso di `/legal/privacy` arriva così a 6,63:1 in chiaro e a 8,43:1 in scuro. Il terzo resta aperto.
- **Login con il service worker.** L'estensione Claude in Chrome non era collegata: Playwright ha guidato il Google Chrome 156 installato, con un profilo pulito e i worker ammessi. Primo accesso, ricarica con la pagina controllata dal worker e nuova scheda sono riusciti. Le richieste del token passano dal worker con risposta 200, e nessuna chiamata verso Keycloak o le API risponde 5xx o fallisce.

#### Suite end to end e verifica visiva della fase 5

Eseguite il 2026-11-08 sul risultato del passo 21: Angular 21.2.25, PrimeNG 21.1.10, `@primeuix/themes` 2.0.3 e Tailwind 4.3.3.

- **Ambiente.**
  - Al primo giro `npm start` è partito con Node 24.21.0 e non con Node 26: build e test unitari restano quelli con Node 26.13.0. Il secondo giro, dopo le correzioni, è partito con Node 26.13.0.
  - Il backend locale gira con Java 25. In `application.yml` la chiave pubblica VAPID è valorizzata e la privata vale `CHANGE_ME` se manca `VAPID_PRIVATE_KEY`. `PushServiceImpl` controlla solo la pubblica, e all'avvio il backend si fermava con «Last unit does not have enough valid bits». Per la prova è stata generata una chiave privata usa e getta, solo nell'ambiente del processo. Il controllo incompleto è già presente e non dipende dalla fase.
  - Le password dei sei utenti `e2e-*` sono state reimpostate nel Keycloak locale, come nella fase 0.
  - Su `E2E1` inventario, QR e importazione iniziale sono stati accesi per la suite, ed Economia per la verifica visiva. Alla fine di ciascun giro sono stati rimessi com'erano, tutti spenti.
- **Suite end to end.**
  - 94 prove, 47 per profilo: 53 superate, 39 saltate per dati o variabili che l'ambiente locale non ha, 2 fallite.
  - Le due fallite sono la prova di accessibilità sulle pagine principali dell'amministratore, nei profili desktop e mobile. axe-core 4.14.0 applica da sé `label-content-name-mismatch` (WCAG 2.5.3), che nella 4.10.3 era sperimentale. La regola chiede che il nome accessibile contenga il testo visibile. Il nome dato con `aria-label` non lo contiene in quattro punti: il pulsante Notifiche della topbar, i link delle schede statistiche della dashboard, i pulsanti delle righe di notifica e le miniature dell'elenco delle tracce. È markup dell'applicazione, non di Angular o PrimeNG: difetti già presenti, che la versione nuova di axe ora vede.
  - Le prove della configurazione iniziale passano. PrimeNG 21 disegna `p-stepper` ancora con `tablist`, `tabpanel` e `presentation`, quindi l'esclusione di `aria-required-children` resta.
  - Dopo le correzioni descritte sotto, il secondo giro dà 56 superate, 37 saltate e 1 fallita in 7,5 minuti. Le prove di accessibilità passano nei due profili.
  - La fallita è «il divisore dei pannelli si muove da tastiera» del workspace delle parti, nel profilo desktop, ed è instabile. Ripetuta sei volte da sola, si salta quattro volte, passa una e fallisce una. Fallisce perché legge `aria-valuenow` subito dopo la freccia, senza aspettare. Con `eventCoalescing`, attivo dal 2025, Angular aggiorna il DOM al frame successivo: in 8 tentativi su 8 il valore resta 34 subito dopo il tasto e diventa 32 dopo un frame. Il difetto è della prova e non dipende dalla fase; è stato corretto il 2026-11-09, come descritto sotto.
- **Verifica visiva.** Screenshot con Playwright, in chiaro e in scuro, a 1280×800 e a 375×812, con l'amministratore di `E2E1`. Le pagine viste sono Dashboard, Utenti con il dialogo Nuovo utente, Strumenti in lista e griglia, Inventario, Economia, Calendario in lista e mese con il dialogo Nuovo evento e il selettore di data, Tracce, il dettaglio di una traccia, Album, Profilo, Configurazione iniziale, Consegne notifiche, la pagina 404 e il menu laterale su mobile. Nessuna differenza di aspetto evidente, nessuno scorrimento orizzontale e nessun errore in console. Non sono state viste le pagine del solo superadmin, cioè Tenant e l'editor dei Documenti legali, né Feed calendario, che su `E2E1` è spento e rimanda alla dashboard.
- **Regressione trovata e corretta.**
  - In PrimeNG 19.1.4 la direttiva `AutoFocus` aveva due ingressi: `autofocus`, con `booleanAttribute` e falso di default, che governa l'attributo HTML, e `pAutoFocus`, che sposta il focus.
  - Nella 21.1.10 resta un solo ingresso, `pAutoFocus`, senza trasformazione, a cui i componenti passano il proprio `autofocus`. Quell'ingresso non ha valore di default. La direttiva toglie l'attributo solo se il valore è esattamente `false`, e con `undefined` scrive `autofocus="true"`.
  - Lo fanno 18 componenti, fra cui Button, Select, DatePicker, InputNumber e MultiSelect. Su Economia gli elementi con l'attributo sono più di 90.
  - Al primo caricamento di una pagina il browser dà il focus al primo di questi elementi che può riceverlo. Su Economia è il filtro Evento dei movimenti, che si presenta evidenziato senza che l'utente l'abbia toccato. Sulle altre pagine viste il focus resta sul documento.
  - La 21.1.10 è l'ultima versione della linea 21, quindi la correzione sta nell'applicazione. `neutralizePrimeNgAutoFocusDefault`, in `taurus-fe/src/app/constants/primeng-autofocus.ts`, gira con `provideAppInitializer` prima del primo disegno. Sostituisce `onAfterContentChecked` della direttiva con una versione che tratta il valore assente come `false`, e lascia funzionare `true` e l'attributo vuoto: il campo del codice di firma, che chiede `[autofocus]="true"`, prende ancora il focus.
  - Il test unitario prova Button, Select e DatePicker senza attributo, InputOtp con l'attributo e la direttiva da sola. Senza la correzione fallisce sul pulsante, che esce con `autofocus="true"`. Con la correzione, su Economia, sul dettaglio di una traccia, su Inventario, Utenti e Calendario nessun elemento ha l'attributo e il focus resta sul documento.
  - La correzione va tolta con l'aggiornamento di PrimeNG previsto dall'evolutiva, se la versione nuova ha corretto la direttiva.
- **`label-content-name-mismatch` corretto.** Il nome accessibile ora contiene il testo visibile:
  - Il pulsante Notifiche della topbar si chiama «Notifiche, 3 da leggere» quando ci sono notifiche non lette: sul desktop il testo visibile è solo il numero del badge. Il badge segue l'etichetta, separato da uno spazio che Angular conserva (`&ngsp;`), così nel menu mobile si legge «Notifiche 3» e non «3Notifiche». L'etichetta del pulsante Calendario, «Calendar», diventa «Calendario» come il suo nome.
  - I link delle schede statistiche della dashboard e i pulsanti delle righe di notifica non hanno più `aria-label`, e il nome viene dal contenuto. Nelle notifiche l'azione, «Segna come letta» o «Apri» quando la notifica porta a una pagina, la sente solo il lettore di schermo, prima del testo. Prima il nome era «Segna come letta» anche per le notifiche che aprono una pagina.
  - Le miniature delle righe di tracce, album, tenant, utenti e calendario ripetono il link del nome accanto: escono dall'ordine di tabulazione e dall'albero di accessibilità, e il clic del mouse continua a funzionare. Nel calendario il giorno, che stava solo nella miniatura, passa nel link del nome come testo per il lettore di schermo. Le miniature dell'inventario, con foto o icona e senza testo, non violano la regola e restano come sono.
- **Prova instabile corretta il 2026-11-09.** Le modifiche toccano solo `track-parts-workspace.spec.ts` e il README della suite.
  - La prova del divisore aspetta il nuovo valore di `aria-valuenow`, due punti sotto quello di partenza, invece di leggerlo subito dopo il tasto.
  - Il salto veniva da `openWorkspace`. Dopo il clic sul menu cliccava il primo link `/tracks/` visibile. Finché la dashboard restava a schermo, quel link era il primo delle tracce recenti, la più recente, che ha parti. Altrimenti era la prima traccia dell'elenco per nome, che su `E2E1` non ne ha. Ora la prova aspetta il titolo della pagina Tracce e apre la prima traccia dell'elenco che ha parti.
  - Con una traccia con parti sempre aperta sono emersi altri fallimenti che i salti nascondevano, tutti difetti delle prove. Nel profilo mobile, sotto 768 px, elenco e dettaglio non sono affiancati e il divisore è nascosto: trascinamento e divisore ora si saltano.
  - «sotto 768 px il dettaglio della parte è una vista a sé» cercava il pulsante con `/^parti$/i`. Il nome però comprende il glifo dell'icona, che `p-button` non nasconde con `aria-hidden`, né nella 19.1.4 né nella 21.1.10. Ora la prova ammette caratteri non alfabetici prima di «Parti».
  - Il file intero, ripetuto due volte nei profili desktop e mobile, dà 16 superate e 8 saltate. La prova del divisore, ripetuta 8 volte da sola su desktop, passa tutte le volte senza saltarsi.
- **Già presenti, non regressioni.**
  - Il pulsante secondario «Nuova traccia» si distingue poco dal fondo in chiaro. Il token del fondo, `surface.100` in chiaro e `surface.800` in scuro, è identico in `@primeng/themes` 19.1.4 e `@primeuix/themes` 2.0.3.
  - Il messaggio «Nessun risultato trovato» di DataView non ha padding, e nessuna delle due versioni dà stili a `p-dataview-emptymessage`.
  - Nel dialogo Nuovo evento, a 1280×800, il pannello del selettore di data, alto 409 pixel, si apre sopra il campo perché sotto non c'è spazio.
  - Il menu mobile aperto si salva fra le preferenze dell'utente (`staticMenuMobileActive`) e si riapre al caricamento successivo, anche in un browser nuovo. Lo stesso vale per la vista lista o griglia (`listLayout.*`): la verifica visiva aveva lasciato Calendario e Strumenti in griglia per l'amministratore di `E2E1`, e sono stati rimessi in lista.
  - Nella vista mese del Calendario i giorni degli altri mesi hanno `opacity: 0.3`, e i loro numeri restano sotto 4,5:1: axe segnala `color-contrast` su 6 elementi a novembre. La regola è nel foglio di stile della pagina dal primo commit del calendario. La prova di accessibilità analizza solo la vista lista, quella predefinita.

#### Memoria esaurita negli IT del backend

Risolto il 2026-11-06.

- **Sintomo.** Dopo `SignatureIT` il contesto di `AccountResourceIT` non partiva: l'heap di 1 GB del fork era pieno e, dopo 17-19 minuti di garbage collection continua, il fork moriva con codice 99. Gli IT successivi non giravano.
- **Causa.** Spring tiene in cache un contesto per ogni configurazione di test, fino a 32, e nel fork degli IT ne nascono 18 prima di `AccountResourceIT`, intorno ai 50 MB l'uno. Nell'istogramma dell'heap dominano le cache di ogni contesto: le corrispondenze dei pointcut AspectJ (un milione di `ShadowMatchImpl`), gli oggetti `Method` della riflessione, i `Lazy` di Spring Data. Le centinaia di thread dei listener RabbitMQ che riprovano a collegarsi sono un effetto dei contesti vivi, non la causa.
- **Non è una regressione della fase 0.** La stessa prova su `4839484`, con RabbitMQ irraggiungibile come in CI, si è fermata nello stesso punto: heap pieno al 100%, 578 thread, contesto di `AccountResourceIT` non avviato dopo 10 minuti. La suite era già al limite: il 2026-11-06 alle 01:18, prima del commit `ac95a27`, `AccountResourceIT` aveva impiegato 146 secondi.
- **Correzione.** `spring.test.context.cache.maxSize=8` in `taurus-be/src/test/resources/spring.properties`. Oltre il limite Spring chiude il contesto usato meno di recente, con i suoi pool e listener; il container PostgreSQL condiviso, registrato senza callback di distruzione, resta acceso. Con il limite ogni contesto parte in 10-13 secondi e `AccountResourceIT` dura 14 secondi. Il [Runbook di test](runbook-test.md) spiega il limite e come riconoscere un heap di nuovo al limite.

#### Note sull'ambiente locale

- Fino alla fase 3 il backend è stato verificato con Java 21.0.2, e la CI usava Java 17. Dalla fase 4a entrambi usano Java 25: in locale Temurin 25.0.5, scelto solo con `JAVA_HOME`. Con i servizi di sviluppo avviati, `SPRING_RABBITMQ_PORT=5679` punta i test su una porta chiusa, come in CI dove nessun broker ascolta su `localhost:5672`.
- Fino alla fase 4b il frontend è stato verificato con Node 22.11.0, come la CI che usava Node 22. Dalla fase 5 usa Node 26.13.0, come il job `frontend` della CI. pnpm 11.16 non parte su Node 22.11.0 e il corepack di quella versione rifiuta le chiavi di firma di pnpm: per il sito è stato usato Node 24.21.0. Dalla fase 6 il sito usa Node 26.13.0 e pnpm 12.17.0, come il job `info-site` della CI: senza corepack in Node 26, pnpm è stato installato con npm in una cartella temporanea.
- Il lockfile del frontend è stato rigenerato così: `npm audit fix`, minimi del `package.json` alzati a mano, poi rimozione dal lock delle sole voci con nome esatto (`@angular/*`, `@angular-devkit/*`, `@ngtools/*`, `@schematics/angular`, `primeng`, `postcss`) e `npm install`. Una rimozione per prefisso toglie anche `postcss-modules-*`, che npm non ripristina: la build passa, ma Karma non trova `postcss-modules-values`. `npm ls --all` deve uscire senza errori. Nella fase 5 il lockfile è rigenerato da `npm install --before=2026-11-01T23:59:59Z`, che sceglie solo versioni pubblicate da almeno sette giorni.
- Il `node_modules` del sito era collegato allo store pnpm `D:\Daniele\Zodiac\Taurus\.pnpm-store`, che non esisteva più. Lo store è stato ricreato per l'aggiornamento e poi cancellato: se pnpm segnala uno store inatteso, `pnpm install` ricollega le dipendenze. Nella fase 6 l'installazione di riferimento con pnpm 11.16 ha ricreato la cartella, cancellata alla fine; pnpm 12 usa lo store predefinito, `D:\.pnpm-store`.
- La coda `upload.files` del RabbitMQ locale è precedente alla dead-letter exchange introdotta il 2026-10-31 con `67dde44b`: all'avvio il backend registra `PRECONDITION_FAILED - inequivalent arg 'x-dead-letter-exchange'`. Non dipende dalla fase 0: cancellata la coda dalla console di RabbitMQ, il backend la dichiara di nuovo.
- L'enforcer del backend segnala due divergenze di dipendenze, solo come avvisi: amqp-client, 5.21.0 da `spring-rabbit` contro quella dichiarata, già presente con la 5.25.0, e `checker-qual`, 3.55.1 da pgjdbc 42.7.14 contro 3.37.0 da Caffeine, nuova. Dalla fase 4a gli avvisi riguardano jaxb-api, amqp-client, bcpkix, nimbus-jose-jwt, commons-text e jose4j, dove vince la 0.9.7 dichiarata; quello su `checker-qual` non c'è più. La regola resta non bloccante.

## Modifiche per modulo

### Repository

- `.github/workflows/*.yml`: azioni alle nuove versioni maggiori, fissate per SHA come già dalla fase 0; Trivy con `version` esplicita e le dipendenze Maven risolte prima della scansione; gitleaks e semgrep aggiornati. Fatto nella fase 1. Java 25 nei job `backend` e `security` è arrivato con la fase 4a; Node 26 è arrivato con le fasi 5 e 6: dalla 6 lo usano tutti i job, e il job `info-site` prende la versione di pnpm da `packageManager`.
- `.github/dependabot.yml`: nuovo (decisione 7), nella fase 1. Nella fase 5 ignora anche le maggiori di `@primeuix/themes` e PrimeIcons (decisione 5).
- `.gitleaks.toml`: due test del backend nell'allowlist, falsi positivi di gitleaks 8.30 (fase 1).
- `.trivyignore.yaml`: nuovo nella fase 0, senza voci da Pillow 13. Nella fase 8 le regole dell'intestazione diventano permanenti (decisione 13).
- `.github/dependabot.yml`: nella fase 8 esclude Jasmine 7 e i suoi tipi (Eccezioni), e i commenti non citano più le fasi.
- `AGENTS.md` e `README.md`: Java 25, Node.js 26, pnpm 12, Angular 21.

### Backend

- `pom.xml`: versioni del parent, delle proprietà e dei plugin; `java.version` 25; rimozione di Spring Cloud e Undertow; starter rinominati; immagine di Jib.
- Codice: Jackson 3, Hibernate 7, Spring Security 7, Testcontainers 2 e le API rimosse in Spring Boot 4, guidate dalle note di migrazione ufficiali e da OpenRewrite dove disponibile.
- `Dockerfile`: immagini Temurin 25 e `--no-install-recommends`.
- Configurazione: proprietà rinominate da Spring Boot 4, segnalate all'avvio da `spring-boot-properties-migrator`, che si toglie a fine fase.
- Fatto nella fase 4a: Spring Boot 3.5.16, JHipster 8.12, librerie e plugin, `java.version` 25, rimozione di Spring Cloud, immagini Temurin 25 di Jib e del `Dockerfile`, API deprecate. Fatto nella fase 4b: Spring Boot 4.0 e 4.1 con JHipster 9.4, il codice e la configurazione, Undertow, gli starter rinominati, `liquibase-hibernate7` e le API deprecate di Spring Boot 4, tranne `@Temporal` su due campi `java.util.Date`. Fatto nella fase 8: gli strumenti npm del `package.json`, con generator-jhipster 9.4.0.

### Frontend

- `package.json` e lockfile dopo ogni `ng update`; builder `@angular/build`; `@primeuix/themes`; Tailwind 4 con lo strumento di migrazione ufficiale.
- Componenti: le modifiche richieste da PrimeNG 20 e 21, verificate pagina per pagina sulle schermate del [Taurus Layout Standard](taurus-layout-standard.md).
- `ToggleButtonRoleDirective`, aggiunta nella fase 0: con PrimeNG 21 diventa `ToggleButtonDisabledDirective` e aggiunge solo `aria-disabled`; da togliere quando PrimeNG lo scriverà da sé, verificandolo con la suite di accessibilità. PrimeNG 22 non lo scrive ancora.
- `Dockerfile`: `node:26-alpine` e nginx senza root sulla porta 8080.
- `docs/llms-full.md` rigenerato per PrimeNG 21.
- Fatto nella fase 7: nginx 1.30 senza privilegi sulla porta 8080 e la porta pubblica inoltrata a Keycloak (vedi [Esito della fase 7](#esito-della-fase-7)).
- Fatto nella fase 8: Angular 21.2.26 e Tailwind 4.3.4; esce `@angular/platform-browser-dynamic`, deprecato e non usato.
- Fatto nella fase 5: Angular 21 e PrimeNG 21, le API deprecate, Tailwind 4, le librerie, la direttiva dei ToggleButton, Node 26 nel `Dockerfile` e nella CI, le correzioni trovate dalla suite end to end e `docs/llms-full.md` di PrimeNG 21 (vedi [Avanzamento della fase 5](#avanzamento-della-fase-5)).
- Fatto il 2026-11-13: Angular 22.2 e PrimeNG 22.1 con TypeScript 6.0, i preset `-compat`, il tema accessibile nella forma `light-dark()`, la chiave della PrimeUI License a runtime, `THIRD_PARTY_NOTICES.md` e `docs/llms-full.md` di PrimeNG 22 (vedi [Esito del passo ad Angular e PrimeNG 22](#esito-del-passo-ad-angular-e-primeng-22)).

### Sito informativo

- `package.json`, `packageManager` pnpm 12, lockfile; adeguamenti di Astro 6 e 7; `Dockerfile` come il frontend.
- Fatto nella fase 6: Astro 7.4.5, passando dalla 6.4.8, pnpm 12.17.0 e TypeScript 6.0.3; `Dockerfile` su `node:26-alpine` senza corepack e `pnpm-workspace.yaml` tolto. Il codice non ha richiesto adeguamenti (vedi [Esito della fase 6](#esito-della-fase-6)).
- Fatto nella fase 7: nginx 1.30 senza privilegi sulla porta 8080, con il controllo dell'utente nello smoke test dell'immagine.

### Servizio OMR

- `requirements.txt`, `requirements-test.txt`, `requirements-accuracy.txt` aggiornati insieme, come chiede l'intestazione del file; `models.sha256` invariato salvo nuovi modelli di homr.
- Fatto nella fase 8: python-dateutil 4.0.0 e pip 26.3 nel `Dockerfile`.
- Pillow 13.0.0 nonostante il limite `<13` di homr 0.7.0: il `Dockerfile` installa `requirements.txt` con `--no-deps` e accetta in `pip check` solo quel conflitto (vedi [Pillow 13 nel servizio OMR](#pillow-13-nel-servizio-omr)).

### Provider Keycloak

- `pom.xml`: Keycloak 26.8, FreeMarker del runtime, `--release` della JVM di Keycloak; temi verificati sulle pagine di login, registrazione ed e-mail. Fatto nella fase 3, con Keycloak 26.8.2 e Java 21.

### Servizi

- `deploy/compose.yml`, `taurus-be/src/main/docker/*.yml`: nuove immagini, volume di PostgreSQL, porte di nginx; rimozione di `jhipster-control-center.yml`.
- `deploy/reverse-proxy.example.conf`: la porta pubblicata resta la stessa, cambia solo quella interna del container.
- Fatto nella fase 7: PostgreSQL 18.6 con il volume su `/var/lib/postgresql`, RabbitMQ 4.4.0 con l'hostname fisso, Prometheus 3.13, Grafana 13.3, SonarQube 26.10, Mailpit 1.33 e il dev container per Java 25; `jhipster-control-center.yml` tolto; i controlli nuovi di `validate-deploy-manifest.sh`; le procedure di aggiornamento nel Runbook operativo (§5.5, §8.6 e §8.7). `reverse-proxy.example.conf` non cambia.

## Autorizzazioni e isolamento tenant

Nessun cambio di regole. Il passaggio a Spring Security 7 e a Hibernate 7 tocca però i punti in cui le regole sono applicate: la configurazione della sicurezza e il cambio di schema per tenant di [PostgreSQL schema per tenant](postgres-tenant-schemas.md). I test di autorizzazione e di isolamento tenant devono passare senza essere modificati. Se un test va cambiato, la modifica si motiva nella pull request.

## Osservabilità e sicurezza

- Actuator: la correzione di CVE-2026-22733 è arrivata con Spring Boot 3.5.16, nella fase 4a. Gli endpoint esposti si ricontrollano con la configurazione di produzione.
- Le metriche Prometheus e i nomi esposti da Micrometer possono cambiare con Spring Boot 4: i pannelli Grafana di `taurus-be/src/main/docker/grafana` si verificano. Nella fase 4a il registro passa al client Prometheus 1.x con gli stessi nomi (vedi [Esito della fase 4a](#esito-della-fase-4a)); nella fase 4b Micrometer 1.17 li mantiene tutti e ne aggiunge uno (vedi [Esito della fase 4b](#esito-della-fase-4b)).
- Il job `security` resta bloccante per vulnerabilità `HIGH` e `CRITICAL` corrette, configurazioni e segreti.
- Ogni immagine Docker pubblicata viene ricontrollata con Trivy dopo la fase che la cambia.

## Licenze

| Componente | Licenza | Nota |
| --- | --- | --- |
| Liquibase 5 Community | Functional Source License 1.1, con licenza futura Apache-2.0 (`FSL-1.1-ALv2`) | dalla 5 non è più Apache-2.0: l'uso interno è gratuito. Accettata il 2026-11-07 per la fase 4b, che la annota in un nuovo `taurus-be/THIRD_PARTY_NOTICES.md`, copiato anche nell'immagine come chiede la licenza a chi ridistribuisce. L'alternativa era restare sull'ultima 4.x, fuori supporto dal 30/09/2025 |
| PrimeNG 22, `@primeuix/themes` e `@primeuix/styles` 3, PrimeIcons 8 e le altre librerie PrimeUI | PrimeUI License, Community gratuita con chiave e rinnovo annuale | fino alla 21 erano MIT. Valutata il 2026-11-08 e adottata il 2026-11-13, con un permesso aggiuntivo della sezione 7 della GPLv3 in fondo a `LICENSE` e la chiave letta a runtime da `TAURUS_PRIMEUI_LICENSE`; annotata in `taurus-fe/THIRD_PARTY_NOTICES.md`, copiato nell'immagine (decisione 5) |
| Tutti gli altri componenti | invariata | da ricontrollare a ogni maggiore in `THIRD_PARTY_NOTICES.md` |

## Strategia di test

Ogni fase esegue le verifiche complete del suo modulo, come in `AGENTS.md`:

- backend: `./mvnw verify -Dtaurus.test.requireDocker=true` con le soglie JaCoCo attuali, che non si abbassano;
- frontend: `npm run build`, `npm run test:coverage` e `npm run e2e` su un'istanza completa;
- sito informativo: `pnpm check`, `pnpm build`, `pnpm test` e `pnpm test:image`;
- servizio OMR: `python -m pytest` e i test di accuratezza sull'immagine nuova;
- provider Keycloak: `./mvnw verify` e il login sull'immagine di Keycloak 26.8;
- servizi: avvio di `services.yml` e del compose di produzione con `scripts/ops/validate-deploy-manifest.sh`.

### Verifica manuale

- Frontend: le pagine principali in chiaro e scuro, desktop e mobile; dialoghi, tabelle, calendario, lettore PDF e lettore degli spartiti.
- Aggiornamento di un database di prova da PostgreSQL 17 a 18 con la procedura del runbook, e ritorno indietro.
- Login, registrazione, recupero della password ed e-mail di Keycloak con il tema Taurus.
- Riconoscimento di una parte e lettura del testo con il servizio OMR aggiornato.

## Criteri di accettazione

Verificati il 2026-11-10 nella fase 8: vedi [Esito della fase 8](#esito-della-fase-8).

- Ogni componente dell'inventario è all'ultima versione stabile del momento dell'implementazione o è elencato in [Eccezioni](#eccezioni-alla-versione-più-recente).
- Nessun componente in uso è fuori supporto.
- Il job `security` passa con `.trivyignore.yaml` vuoto.
- Le verifiche di tutti i moduli e la suite end-to-end passano; le soglie di copertura non scendono.
- Tutte le azioni GitHub sono fissate per SHA del commit e Dependabot apre le pull request settimanali.
- Frontend e sito informativo girano come utente non root.
- Il runbook operativo descrive l'aggiornamento di PostgreSQL, RabbitMQ e Keycloak e il ritorno indietro.

## Piano di adozione e compatibilità

- Ogni fase si rilascia da sola. Per la fase 7 le installazioni esistenti devono seguire la procedura del runbook: PostgreSQL non si aggiorna cambiando solo il tag dell'immagine.
- Backend e frontend non cambiano API fra loro: possono essere rilasciati in fasi diverse.
- Il frontend aggiornato richiede browser recenti: Angular 21 supporta le ultime due versioni dei browser principali.
- Le variabili d'ambiente del compose restano le stesse. Cambiano solo i valori predefiniti delle versioni (`TAURUS_POSTGRES_VERSION`, `TAURUS_KEYCLOAK_VERSION`, `TAURUS_RABBITMQ_VERSION`). Chi le ha fissate nel proprio `.env` le aggiorna seguendo il runbook.
- Nessuna migrazione Liquibase prevista. Se Hibernate 7 cambia il DDL atteso, la differenza si corregge con una nuova migrazione e non modificando quelle esistenti.

## Rischi

- **Volume del lavoro nel frontend.** Due maggiori di Angular e PrimeNG su 117 componenti. Mitigazione: un passo alla volta con `ng update`, test a ogni passo e verifica visiva con la suite end-to-end.
- **Jackson 3 nel backend.** Serializzazione di date, enum e valori nulli può cambiare in modo silenzioso. Mitigazione: test delle API REST e controllo delle risposte JSON prima e dopo.
- **Hibernate 7 e schema per tenant.** Il cambio di schema dipende da API interne di Hibernate. Mitigazione: test di isolamento tenant e prova con più tenant reali.
- **Dati di PostgreSQL.** Un errore nella migrazione dei dati è il rischio più grave. Mitigazione: backup verificato prima, prova su una copia, procedura di ritorno indietro.
- **Licenza di Liquibase 5.** Mitigazione: verifica prima della fase 4, con l'ultima 4.x come ripiego.
- **Fine del supporto della linea 21.** Angular 21 riceve solo correzioni critiche e di sicurezza fino a giugno 2027, e dopo la 21.1.10 non sono uscite versioni gratuite di PrimeNG 21: un difetto o una vulnerabilità di PrimeNG va aggirato nell'applicazione, come con la direttiva dei ToggleButton, o corretto con una patch propria, che la licenza MIT permette. Mitigazione: l'evolutiva successiva della decisione 5, da fare prima di giugno 2027.
- **Eccezioni che diventano permanenti.** Mitigazione: scadenza obbligatoria in `.trivyignore.yaml`.
- **Pillow oltre il limite di homr.** homr non è provato dai suoi autori con Pillow 13, e con `--no-deps` pip non impedisce più una combinazione che homr non accetta. Mitigazione: i test di accuratezza della CI sull'immagine costruita, a ogni aggiornamento del servizio; il filtro di `pip check`, che ferma la build su ogni altro conflitto; il ricontrollo a ogni versione nuova di homr.
- **Modifiche in corso su altri rami.** Una fase lunga entra in conflitto con le funzionalità sviluppate nel frattempo. Mitigazione: fasi piccole, rilasciate appena pronte, e Dependabot per non accumulare di nuovo ritardo.
