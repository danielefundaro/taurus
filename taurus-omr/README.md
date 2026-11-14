# Taurus OMR

Servizio interno di riconoscimento ottico della musica per l'[ascolto delle parti](../docs/track-score-playback-spec.md). Riceve le pagine di una parte, le fa leggere ad Audiveris e a homr e restituisce per ogni motore un MusicXML compresso, con le posizioni delle battute quando il motore le fornisce. Converte anche file MIDI in MusicXML con music21, [legge il testo delle pagine](../docs/omr-text-recognition-spec.md) con RapidOCR, per suggerire gli strumenti delle parti ricavate dai PDF scansionati, e [impagina le parti scritte](../docs/music-writing-editor-spec.md#impaginazione) in pagine PNG e in un PDF con Verovio e Cairo: è il servizio musicale interno di Taurus, che mantiene il nome del modulo.

Il servizio non conserva nulla, non conosce tenant, tracce o utenti e va esposto solo sulla rete interna, con una chiave condivisa.

## API

| Metodo e percorso | Descrizione |
| --- | --- |
| `POST /v1/recognitions` | multipart con le pagine (`pages`, PNG, JPEG o WebP, in ordine di lettura) e i motori (`engines`, predefiniti `AUDIVERIS` e `HOMR`); risponde al termine con un risultato per motore |
| `POST /v1/midi-conversions` | multipart con il file MIDI (`file`); risponde con il MusicXML, una parte per traccia |
| `POST /v1/engravings` | multipart con il MusicXML della parte (`score`, normale o compresso) e le opzioni (`options`, JSON); risponde con le pagine PNG in scala di grigi a 300 DPI e il PDF, in base64 |
| `POST /v1/text-recognitions` | multipart con le pagine (`pages`, PNG, JPEG o WebP); risponde con le righe lette in ogni pagina: testo, affidabilità fra 0 e 1 e rettangolo come frazioni della pagina, dall'alto in basso e da sinistra a destra, senza soglie |
| `GET /v1/health` | stato e versioni, compreso il motore di lettura del testo (`textEngine`); non richiede la chiave |

Le richieste protette portano la chiave nell'intestazione `X-Taurus-Omr-Key`. Gli errori rispondono con `{ "code", "message" }`: `unauthorized` (401), `lengthRequired` (411), `tooLarge` (413), `tooManyPages`, `unreadableImage`, `unknownEngine`, `unreadableMidi`, `unreadableScore`, `invalidOptions` (422), `busy` (503). L'esito di un motore fallito è nel risultato, con `errorCode` `engineFailed` o `engineTimeout`; una lettura del testo o un'impaginazione fallite rispondono invece 500 con gli stessi codici.

La lettura del testo gira in un processo separato (`python -m taurus_omr.text`), con slot propri: non aspetta i riconoscimenti in corso. Usa i modelli PP-OCR dell'immagine, verificati da `models.sha256`, e non scarica nulla: se un modello manca la lettura fallisce con `engineFailed`. Il tempo massimo comprende l'attesa di uno slot.

### Impaginazione

Anche l'impaginazione gira in un processo separato (`python -m taurus_omr.engrave`), con slot e tempo massimo propri. Le opzioni, tutte facoltative:

| Opzione | Valori |
| --- | --- |
| `format` | `A4_PORTRAIT` (predefinito), `A4_LANDSCAPE`, `MARCH` (formato marcia, 18 × 13 cm in orizzontale) |
| `staffSize` | altezza del rigo in millimetri, da 4 a 9,6; predefinita 7 in A4 e 5,6 nel formato marcia |
| `margin` | margini in millimetri, da 3 a 30; predefiniti 12 in A4 e 8 nel formato marcia |
| `header` | `title`, `composer`, `arranger`, `partName`: testi della prima pagina, al più 200 caratteri; un testo vuoto non compare, e senza testi non c'è intestazione |
| `pageNumbers` | numeri di pagina dalla seconda, al centro sotto la musica (predefinito `true`) |
| `measureNumbers` | `SYSTEM` (all'inizio di ogni rigo, predefinito), `EVERY` (su ogni battuta, per le parti di studio), `NONE` |

L'impaginazione segue l'editor di scrittura: Verovio rispetta le interruzioni di riga della parte e manda a capo da solo le righe piene. Un'interruzione di pagina inizia una pagina nuova: la parte si impagina in sezioni, con la prima tagliata dopo la sua ultima battuta, perché Verovio non disegna l'intestazione di una selezione, e le altre come selezioni della parte intera, che conservano chiave, armatura e tempo. Il nome della parte sta nell'intestazione e non a sinistra dei righi; un'intestazione già presente nel MusicXML è sostituita da quella delle opzioni. Le pagine non possono essere più di `TAURUS_OMR_MAX_PAGES` (`tooManyPages`).

Verovio ha la stessa versione del frontend, che mostra l'anteprima: `scripts/ops/check-verovio-versions.mjs` fallisce se le versioni divergono. Il carattere musicale incorporato in Verovio si rende disponibile a Cairo con fontconfig, e per i testi serve un carattere con le metriche di Times (Liberation Serif nell'immagine).

## Configurazione

| Variabile | Predefinito | Significato |
| --- | --- | --- |
| `TAURUS_OMR_API_KEY` | obbligatoria | chiave condivisa con il backend, almeno 16 caratteri |
| `TAURUS_OMR_ENGINE_TIMEOUT_SECONDS` | `300` | tempo massimo di ogni motore |
| `TAURUS_OMR_MAX_PAGES` | `30` | pagine per richiesta |
| `TAURUS_OMR_MAX_REQUEST_MB` | `25` | dimensione massima delle pagine |
| `TAURUS_OMR_MAX_MIDI_MB` | `10` | dimensione massima di un file MIDI |
| `TAURUS_OMR_MAX_IMAGE_PIXELS` | `60000000` | pixel massimi di una pagina, controllati prima della decodifica (`unreadableImage`) |
| `TAURUS_OMR_CONCURRENCY` | `1` | richieste elaborate insieme; le altre attendono |
| `TAURUS_OMR_TEXT_CONCURRENCY` | `1` | letture del testo eseguite in parallelo, con slot separati da quelli dei riconoscimenti |
| `TAURUS_OMR_TEXT_THREADS` | `2` | thread di ONNX Runtime per lettura |
| `TAURUS_OMR_TEXT_TIMEOUT_SECONDS` | `60` | tempo massimo di una richiesta di lettura |
| `TAURUS_OMR_ENGRAVING_CONCURRENCY` | `1` | impaginazioni eseguite in parallelo, con slot separati |
| `TAURUS_OMR_ENGRAVING_TIMEOUT_SECONDS` | `120` | tempo massimo di un'impaginazione, compresa l'attesa di uno slot |
| `TAURUS_OMR_MAX_SCORE_MB` | `20` | dimensione massima del MusicXML da impaginare, anche dopo la decompressione |

L'immagine imposta anche i comandi dei motori, la versione di Audiveris e la cartella di lavoro (`TAURUS_OMR_AUDIVERIS_COMMAND`, `TAURUS_OMR_AUDIVERIS_VERSION`, `TAURUS_OMR_HOMR_COMMAND`, `TAURUS_OMR_TEXT_COMMAND`, `TAURUS_OMR_ENGRAVING_COMMAND`, `TAURUS_OMR_WORK_DIR`): servono ai test e non vanno cambiati nell'immagine.

## Sviluppo

I test sostituiscono i motori con programmi finti e non richiedono Audiveris, homr né RapidOCR. I test dell'impaginazione usano Verovio e CairoSVG veri, installati da `requirements-test.txt`; quelli che disegnano le pagine richiedono anche la libreria Cairo (su Debian e Ubuntu `libcairo2`, con `fonts-liberation` per i testi) e senza di essa si saltano, salvo con `TAURUS_OMR_REQUIRE_CAIRO=true`, come nella CI. Il confronto con la pagina di riferimento (`tests/engraving`) ammette piccole differenze di carattere e di sfumatura dei bordi, non un'impaginazione diversa; dopo un aggiornamento voluto di Verovio la pagina si ridisegna nell'immagine. Con Python 3.12:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements-test.txt
.venv/bin/python -m pytest
```

## Accuratezza

La cartella `accuracy` misura quanto leggono bene i motori reali. Il corpus (`accuracy/corpus`) contiene sei parti scritte per il test, simili a parti per banda (tromba, corno con divisi e pause di più battute, tuba in chiave di basso con D.C. al Fine, clarinetto in 6/8, flauto con sedicesimi e terzine, e la stessa marcia come fotocopia consumata), con il MusicXML di riferimento e le pagine A4 a 300 DPI disegnate con Verovio. Il confronto segue le regole del lettore di Taurus: una battuta è corretta se si ascolta uguale.

```bash
# con il servizio in esecuzione, per esempio quello di services.yml
.venv/bin/python -m accuracy run --url http://localhost:8090 --key <chiave> --save /tmp/letture
# il nome della parte sulla prima pagina di ogni brano, con le regole del backend
.venv/bin/python -m accuracy names --url http://localhost:8090 --key <chiave>
# una parte reale: versione approvata e versione di un motore, scaricate da Taurus
.venv/bin/python -m accuracy compare approvata.mxl audiveris.mxl
```

`tests/test_accuracy.py` fissa la quota minima di battute corrette per motore e di nomi delle parti letti e si esegue solo con `TAURUS_OMR_ACCURACY_URL` e `TAURUS_OMR_ACCURACY_KEY`; la CI lo esegue sull'immagine appena costruita. Per aggiungere parti al corpus si modifica `accuracy/corpus.py` e si ridisegnano le pagine con `python -m accuracy render`, che richiede `requirements-accuracy.txt`, la libreria Cairo e un carattere compatibile con Times (si veda il [Runbook operativo](../docs/runbook-operativo.md)).

## Immagine

L'immagine completa si costruisce con `docker build -t taurus-omr .`; il file `taurus-be/src/main/docker/omr.yml` la avvia con le restrizioni previste (file system di sola lettura con `/tmp` in memoria, nessun privilegio aggiuntivo, limiti di CPU e memoria, porta pubblicata solo su `127.0.0.1`) ed è incluso in `services.yml`, che avvia tutte le dipendenze del backend. Il workflow `docker-publish.yml` pubblica l'immagine su Docker Hub come `fundanie/taurus-omr` a ogni tag `v*.*.*`.

Licenze e sorgenti dei componenti: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
