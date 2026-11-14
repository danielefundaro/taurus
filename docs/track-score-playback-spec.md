# Ascolto e correzione delle parti

La funzionalità consente di ascoltare le parti di una traccia, singolarmente o come partitura, partendo dalle pagine immagine già presenti in Taurus. Le note sono ricavate con il riconoscimento ottico della musica (OMR) oppure da un file MusicXML o MIDI caricato; super amministratori, amministratori e archivisti possono correggere e approvare il risultato. Tutti i componenti sono open source e non comportano costi per il tenant.

## Stato del documento

ID catalogo: `track-score-playback`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

Documenti collegati: [Elaborazione asincrona dei PDF delle tracce](track-pdf-processing-spec.md), [Workspace per la gestione delle parti](track-parts-workspace-spec.md), [Modifica e analisi delle immagini delle parti](track-page-image-editing-spec.md), [Anteprima e stampa degli spartiti](score-preview-printing-spec.md), [Gestione centralizzata dei media](media-asset-spec.md), [Funzionalità configurabili per tenant](tenant-feature-flags-spec.md), [Standard degli errori applicativi](application-errors-standard.md).

## Scelte di sviluppo

Scelte fatte durante lo sviluppo delle fasi del [piano di implementazione](#piano-di-implementazione), già riportate nelle sezioni seguenti.

### Ascolto da file caricati

- il MIDI è generato da Taurus nel browser, non da Verovio: l'ordine delle battute, le trasposizioni e i canali restano sotto controllo diretto e non serve una copia "svolta" del MusicXML;
- il caricamento di file MIDI è passato alla fase di riconoscimento, perché la conversione richiede music21 nel servizio OMR;
- i controlli e l'elenco delle parti di un MusicXML sono calcolati dal backend in Java, per i file caricati come per i risultati dei motori;
- l'ascolto ha una scheda propria nel dettaglio della traccia invece di comparire nel workspace Parti, che si salva come un'unica unità con i dettagli: le azioni di ascolto si salvano da sole e restano disabilitate finché la traccia ha modifiche non salvate;
- gli strumenti esistenti sono configurati da una migrazione Liquibase per tenant invece che da un'attività di avvio;
- il suono si sceglie da un elenco statico dei programmi General MIDI, che coincide con il banco 0 di MuseScore General;
- Verovio è servito come asset statico e caricato al primo uso, così il service worker non lo precarica per tutti gli utenti.

### Riconoscimento

- Audiveris legge ogni pagina come un libro a sé e il servizio unisce pagine e movimenti: le posizioni delle battute restano riferite alla pagina e un errore di lettura non sposta le battute delle pagine successive;
- homr 0.7.0 non scrive posizioni nel MusicXML: le posizioni vengono solo da Audiveris. homr non ha un'opzione per disattivare la lettura del titolo: il titolo letto da entrambi i motori viene scartato;
- la conversione MIDI restituisce una parte per ogni traccia e il backend offre la stessa scelta della parte dei file MusicXML;
- un'unica chiave d'errore `scorePlayback.omr.unavailable` copre il servizio non configurato o non raggiungibile, sia per il riconoscimento sia per la conversione MIDI;
- il risultato di un tentativo superato da un nuovo tentativo viene scartato, così un job ripreso dopo un'interruzione non produce versioni doppie.

### Correzione

- l'editor lavora sul MusicXML e non su MEI: Verovio 6.3.0 conserva gli `id` di `measure` e `note` del MusicXML negli elementi disegnati, e una pausa di più battute prende l'`id` della prima battuta del gruppo. L'editor assegna gli `id` all'apertura e li toglie dal file salvato;
- nell'editor l'accidente scritto è ciò che si vede e l'alterazione è ciò che suona: dopo ogni modifica le alterazioni della battuta si ricavano da accidenti e armatura. All'apertura l'editor scrive gli accidenti che armatura e accidenti precedenti non spiegano, senza cambiare il suono;
- correggere la chiave lascia le note nella stessa posizione sul rigo, come nell'immagine, e correggere l'armatura cambia le note senza accidente: sono gli errori tipici del riconoscimento;
- nelle battute modificate le travature si ricalcolano per movimento e i ritorni delle altre voci tornano all'inizio della battuta;
- la correzione si salva con una richiesta JSON sullo stesso percorso del caricamento; l'origine di ogni battuta (`measureSources`) permette di conservare le posizioni sulle pagine anche dopo inserimenti ed eliminazioni di battute;
- la segnalazione si chiude all'approvazione di una versione diversa da quella segnalata; ogni utente può avere al massimo 10 segnalazioni aperte sulla stessa parte;
- le segnalazioni di un utente si cancellano con la cancellazione dei suoi dati, perché il testo è scritto da lui.

### Qualificazione

- il corpus è scritto per il test e disegnato con Verovio, così può stare nel repository senza problemi di diritti; le parti reali della banda non entrano nel repository e si misurano confrontando la versione approvata con quella di ciascun motore;
- una battuta è corretta se si ascolta uguale, con le stesse regole di lettura del lettore: contano durata della battuta, inizio, durata, altezza e legatura di valore delle note, non la grafia, le voci, le travature e le pause. Le battute sono allineate prima del confronto, così una battuta persa non sposta le successive;
- le indicazioni di struttura (ritornelli, volte, segno, coda, Fine, D.C., D.S. e tempo) sono misurate a parte, perché sono il punto debole di entrambi i motori;
- il minimo di ogni motore è fissato nel test un poco sotto il risultato misurato, per tollerare piccole differenze tra processori;
- il primo scaricamento dei suoni sul telefono dipende dalla rete: il messaggio di caricamento del lettore ne indica la dimensione, circa 40 MB;
- l'editor ridisegna la parte al fotogramma successivo a una modifica: le modifiche rapide, come un tasto tenuto premuto, producono un solo disegno invece di uno per modifica;
- lettore ed editor disegnano la parte senza il nome a sinistra dei righi, già presente nel titolo: Verovio lo ripete su ogni rigo e sul telefono occupava metà della larghezza, con una sola battuta per rigo;
- sul telefono, fino a 768 px, le righe del mixer della partitura partono chiuse dietro **Mostra le parti**, mentre le scorciatoie restano visibili: con molte parti lo spartito restava altrimenti in pochi pixel.

## Obiettivo

- Ascoltare una parte o l'intera partitura di una traccia nel browser, con cursore sullo spartito, mixer per parte, tempo variabile, ripetizione di un intervallo di battute ed esecuzione con o senza ritornelli.
- Ricavare le note dalle pagine immagine con due motori OMR, scegliendo automaticamente il risultato più coerente.
- Accettare in alternativa file MusicXML e MIDI.
- Correggere il risultato con un editor affiancato all'immagine originale, oppure con MuseScore tramite scaricamento e nuovo caricamento.
- Approvare le versioni corrette e segnalare gli errori ascoltati.
- Riprodurre in suoni reali le parti scritte per strumenti traspositori.

## Fuori scope

- Arrangiamento, composizione e scrittura di parti da zero: richiedono un editor completo, progettato nell'[Editor di scrittura musicale](music-writing-editor-spec.md).
- Riconoscimento di manoscritti.
- Esportazione audio (MP3, WAV) e nuova impaginazione PDF delle parti riconosciute.
- Ascolto senza connessione oltre alla cache del service worker già presente.
- Uso di Web MIDI o di strumenti MIDI esterni.
- Riconoscimento del testo cantato.

## Decisioni principali

1. **Riconoscimento su richiesta.** Lo avviano super amministratore, amministratore e archivista, per una parte o per tutte le parti della traccia. Non parte automaticamente al caricamento del PDF.
2. **Ascolto della versione non verificata.** Tutti gli utenti che vedono la parte possono ascoltare anche una versione non verificata, contrassegnata come tale e accompagnata dall'esito dei controlli.
3. **Ascolto non disponibile.** Senza una versione utilizzabile gli utenti senza privilegi vedono l'ascolto disabilitato con il testo «Ascolto non ancora disponibile».
4. **Due motori OMR.** Audiveris e homr vengono eseguiti entrambi; Taurus propone il risultato con i controlli migliori e il revisore può scegliere l'altro.
5. **Servizio OMR separato.** I motori girano in un container dedicato, senza accesso a database o storage, chiamato dal backend via HTTP sulla rete interna.
6. **MusicXML come formato interno.** Ogni versione di una parte è un file MusicXML compresso (`.mxl`). Il MIDI non viene salvato: il browser lo genera al momento.
7. **Ascolto nel browser.** Verovio disegna lo spartito; Taurus genera il MIDI nel browser a partire dal MusicXML e SpessaSynth lo suona con il SoundFont MuseScore General. Il server non produce audio.
8. **Solo correzione.** L'editor modifica note e struttura di una versione esistente; non è uno strumento di scrittura.
9. **Versioni immutabili.** Riconoscimento, caricamento e correzione producono sempre una nuova versione; l'approvazione è uno stato della versione.
10. **Trasposizione e suono dallo strumento.** Ogni strumento dichiara la trasposizione e il suono, come banco e programma del SoundFont; Taurus propone i valori a partire dal nome con un catalogo di riferimento. Uno strumento non configurato si ascolta con un suono neutro e un avviso. La parte può sovrascrivere i valori.
11. **Percussioni incluse.** Le parti di percussione suonano con i suoni di batteria General MIDI dello strumento assegnato.
12. **Formati caricabili.** MusicXML (`.musicxml`, `.xml`, `.mxl`) e, con il servizio OMR configurato, MIDI (`.mid`, `.midi`), convertito in MusicXML dal servizio.
13. **Nessun controllo sui diritti.** Il tenant si assume la responsabilità dei file caricati, come già previsto in Taurus: non sono necessari blocchi o avvisi.
14. **Attivazione per tenant.** Nuova funzionalità `SCORE_PLAYBACK`, disattivata per default.
15. **Partitura per gli utenti senza privilegi.** Nella partitura si sentono tutte le parti disponibili, ma si vede lo spartito solo delle parti dei propri strumenti; le scorciatoie del mixer permettono di ascoltare solo le proprie parti o tutto tranne le proprie.
16. **Utenti esterni.** Ascoltano le tracce `PUBLIC` che già vedono, con le stesse regole degli altri utenti senza privilegi.

## Prova preliminare

Il 15/10/2026 i due motori sono stati provati su tre parti reali, in container Docker, ricostruendo con Verovio quanto riconosciuto.

| Parte | Immagine | Audiveris 5.11.0 | homr 0.7.0 |
| --- | --- | --- | --- |
| Tuba Sib, 34 battute | grafica digitale pulita | 33/34 battute corrette; legature di valore e dinamiche lette; persi ritornelli, forcelle e indicazione di tempo | 34/34 battute corrette e ritornello finale; legature di valore lette come legature di portamento, nessuna dinamica, metro 8/16 spurio |
| Cl piccolo in Lab, circa 138 battute | pulita ma fitta | note in gran parte corrette; numero di battuta letto come chiave all'ottava, pause multiple contate male, volta estesa a metà brano, accordi inesistenti | inutilizzabile: 69 battute |
| Flic. baritono, circa 113 battute | scansione vecchia e sgranata | inutilizzabile: diviso in quattro movimenti, armature perse, accordi spuri | buona: titolo, armature e cambi di tonalità, terzine, 115 battute; metro C letto 16/16, chiavi spurie, nessuna dinamica |

Tempi: Audiveris 34 secondi per le tre pagine su 12 core; homr circa 30 secondi a pagina su CPU.

Conclusioni applicate a questa specifica:

- l'OMR produce una bozza da correggere, non una conversione definitiva;
- i due motori sono complementari e conviene eseguirli entrambi;
- ritornelli, volte, pause multiple e tempo sono il punto debole comune, e sono proprio ciò che determina un ascolto corretto;
- la trasposizione non si ricava dall'immagine;
- Audiveris richiede GTK e un display virtuale anche in modalità batch, e i dati legacy di Tesseract per leggere il testo; il pacchetto `.deb` va estratto senza eseguire gli script di installazione.

Le pagine generate da Taurus a partire dai PDF sono a 300 DPI ([Elaborazione asincrona dei PDF](track-pdf-processing-spec.md)), più adatte delle immagini usate nella prova.

## Contesto tecnico acquisito

- Una parte è `SheetsMusic` (tabella `sheet_music`), con le pagine ordinate in `sheet_music_media` e gli strumenti in `sheet_music_instrument`; tutte le tabelle sono nello schema del tenant.
- `sheet_music.needs_review` indica strumenti suggeriti automaticamente dal PDF e viene sovrascritto da ogni salvataggio della traccia: non va riusato per la revisione delle note.
- `Tracks.tempo` e `Tracks.tone` sono testo libero.
- `instrument` contiene solo nome e descrizione; i 43 strumenti iniziali vengono da `data/instruments.csv`. Il tenant può aggiungerne altri dalla pagina degli strumenti o con l'[importazione iniziale](tenant-onboarding-import-spec.md), che riconosce gli strumenti esistenti dal nome normalizzato.
- L'elaborazione dei PDF usa la coda RabbitMQ `upload.files` con messaggi Java serializzati, consumata dal backend; il frontend legge lo stato una volta, senza aggiornamenti, e non c'è recupero dei job bloccati.
- I file stanno sul filesystem locale (`application.base-path`); non esistono volumi condivisi né API interne di download.
- Super amministratore, amministratore e archivista gestiscono tracce, strumenti e immagini delle pagine; `ROLE_USER` vede le tracce `COMPLETE` e `PUBLIC` con le sole parti dei propri strumenti; `ROLE_USER_EXTERNAL` vede solo le tracce `PUBLIC`.
- Il dettaglio della traccia è lo stesso componente per tutti i ruoli, con schede Dettagli, Parti e, per chi gestisce i PDF, PDF.
- L'intestazione `Permissions-Policy` delle API disabilita Web MIDI, che all'ascolto non serve: l'audio è generato con Web Audio. Le pagine dell'applicazione lo consentono alla stessa origine (`midi=(self)` in `taurus-fe/security-headers.conf`) per la tastiera MIDI dell'[editor di scrittura](music-writing-editor-spec.md#tastiera-midi).
- Il service worker mette in cache in modo differito i file sotto `/assets/**`.

## Flussi

### Riconoscimento di una parte

1. Un utente con privilegi sceglie **Riconosci** su una parte, oppure **Riconosci tutte le parti** sulla traccia.
2. Il backend crea un job per ogni parte e lo pubblica sulla nuova coda `score.recognition`.
3. Il worker del backend prende il job con un aggiornamento condizionale, legge le pagine della parte nell'ordine corrente e chiama il servizio OMR con le immagini, fuori da ogni transazione.
4. Il servizio esegue insieme Audiveris e homr, unisce pagine e movimenti e restituisce per ogni motore MusicXML, posizioni delle battute sulle pagine (solo Audiveris) ed esito.
5. Il backend calcola i controlli, salva una versione per ogni motore riuscito, sceglie la proposta (vedi [Scelta della versione proposta](#scelta-della-versione-proposta)) e la rende corrente, salvo che la versione corrente della parte sia approvata.
6. Chi ha avviato il riconoscimento riceve una notifica di completamento o di errore; per **Riconosci tutte le parti** la notifica è unica.

L'avanzamento è visibile a chi ha privilegi: la pagina interroga lo stato ogni 5 secondi finché esistono job in coda o in corso.

### Caricamento di un file

1. Un utente con privilegi carica un file MusicXML o, con il servizio OMR configurato, MIDI su una parte.
2. Se il file contiene più parti o tracce MIDI, sceglie quale importare; il dialogo mostra nome e numero di battute di ogni parte.
3. Il MIDI viene convertito in MusicXML dal servizio OMR con music21, una parte per traccia, quantizzando le durate.
4. Il backend estrae la parte scelta, calcola i controlli, salva una nuova versione non verificata, oppure approvata se l'utente sceglie **Carica come approvata**, e la rende corrente.

### Correzione e approvazione

1. Un utente con privilegi apre l'editor con **Correggi** sulla parte (versione corrente), su una versione dell'elenco **Versioni e suono** o dalle segnalazioni della parte. Accanto allo spartito c'è la pagina originale con la battuta selezionata evidenziata.
2. Corregge note e struttura; i controlli si aggiornano a ogni modifica.
3. **Salva** crea una nuova versione non verificata; **Salva e approva** la crea già approvata. In entrambi i casi diventa la versione corrente. Chiudendo l'editor con modifiche non salvate si chiede conferma.
4. In alternativa scarica il MusicXML, lo corregge in MuseScore e lo ricarica.
5. **Approva** su una versione esistente la marca come approvata senza modificarla.

### Ascolto

1. L'utente sceglie **Ascolta** sulla parte oppure **Ascolta la partitura** sulla traccia.
2. Il browser scarica il MusicXML delle versioni correnti, calcola l'ordine delle battute, applica le trasposizioni, genera il MIDI e lo suona con SpessaSynth; Verovio disegna lo spartito.
3. Una versione non verificata mostra l'etichetta **Non verificata** e il riepilogo dei controlli.
4. Chi ascolta può usare **Segnala un errore**, indicando facoltativamente la battuta.

### Segnalazione di un errore

1. Chi ascolta sceglie **Segnala un errore** nel lettore: indica la parte (nella partitura), facoltativamente la battuta, proposta da quella in ascolto, e descrive l'errore in al massimo 1000 caratteri.
2. La segnalazione è salvata sulla versione corrente della parte e notificata a super amministratori, amministratori e archivisti, con un collegamento alla scheda Ascolto.
3. Resta aperta finché un utente con privilegi la chiude oppure approva una versione della parte diversa da quella segnalata: con un'approvazione, un caricamento o una correzione salvati come approvati.

Ogni utente può avere al massimo 10 segnalazioni aperte sulla stessa parte, così una persona non può inondare di notifiche chi gestisce l'archivio.

## Disponibilità dell'ascolto

Una versione è **utilizzabile** se è approvata, oppure se è non verificata e ricavata dalle pagine attuali della parte. L'impronta delle pagine è lo SHA-256 dell'elenco ordinato degli SHA-256 delle immagini; una versione caricata prende l'impronta delle pagine al momento del caricamento, una versione corretta eredita quella della versione da cui deriva.

| Situazione della parte | Super amministratore, amministratore, archivista | Altri utenti |
| --- | --- | --- |
| Nessuna versione | **Ascolta** avvia il riconoscimento ed è disponibile anche **Riconosci**; senza servizio OMR solo il caricamento di un file | disabilitato, «Ascolto non ancora disponibile» |
| Riconoscimento in coda o in corso | avanzamento | disabilitato, «Ascolto non ancora disponibile» |
| Riconoscimento non riuscito | errore e **Riprova** | disabilitato, «Ascolto non ancora disponibile» |
| Versione non verificata utilizzabile | ascolto, etichetta e controlli | ascolto, etichetta e controlli |
| Versione non verificata con pagine cambiate | ascolto con avviso e **Riconosci di nuovo** | disabilitato, «Ascolto non ancora disponibile» |
| Versione approvata | ascolto | ascolto |
| Versione approvata con pagine cambiate | ascolto con avviso «Pagine modificate dopo l'approvazione» | ascolto |

Una versione approvata resta utilizzabile dopo una modifica delle pagine perché una correzione di contrasto o raddrizzamento non cambia la musica; l'avviso permette a chi gestisce la traccia di verificarla.

La partitura comprende le parti con una versione utilizzabile per l'utente; le parti mancanti sono elencate nel mixer come non disponibili.

## Servizio OMR

### Modulo

Nuovo modulo `taurus-omr/`: servizio HTTP in Python, immagine Docker propria, test con pytest. Contiene:

- immagine Ubuntu 24.04 con Python 3.12, FastAPI e Uvicorn;
- Audiveris 5.11.0, estratto dal pacchetto `.deb` ufficiale verificato con SHA-256, con GTK 3, Xvfb e i dati Tesseract 4.1.0 di `tesseract-ocr/tessdata` (con il motore legacy) per inglese e italiano;
- homr 0.7.0 in versione CPU, con i modelli scaricati durante la build con `homr --init` e verificati con `models.sha256`; il titolo che homr legge con RapidOCR viene scartato;
- music21 per la conversione MIDI → MusicXML.

Le versioni dei motori, delle dipendenze Python (`requirements.txt`) e dei modelli sono fissate; un aggiornamento passa da una nuova immagine e dai test di accuratezza. I test del modulo sostituiscono i motori con programmi finti e girano senza Audiveris né homr; il test di accuratezza (`accuracy/` e `tests/test_accuracy.py`) usa invece i motori reali attraverso il servizio in esecuzione.

### API interna

| Metodo e percorso | Descrizione |
| --- | --- |
| `POST /v1/recognitions` | multipart con le pagine PNG, JPEG o WebP in ordine (`pages`) e i motori richiesti (`engines`, predefiniti entrambi); risponde, al termine, con un risultato per motore |
| `POST /v1/midi-conversions` | multipart con il file MIDI (`file`); risponde con il MusicXML, una parte per traccia, con le durate quantizzate a sedicesimi e terzine di crome |
| `POST /v1/text-recognitions` | lettura del testo delle pagine, usata dall'elaborazione dei PDF: si veda [Lettura del testo nel servizio OMR](omr-text-recognition-spec.md#api-interna) |
| `GET /v1/health` | stato e versioni dei motori, compreso quello di lettura del testo, senza chiave |

Il risultato di un motore contiene stato, MusicXML compresso, posizioni delle battute (`{ measure, page, x, y, width, height, approximate }`), durata ed eventuale codice di errore. Elenco delle parti e controlli sono calcolati dal backend, come per i file caricati.

- Le posizioni sono ricavate dal progetto `.omr` di Audiveris, come frazioni della pagina: per ogni sistema le pile di battute danno l'estensione orizzontale e i righi quella verticale. Le battute raggruppate da una pausa multipla condividono il riquadro; se il numero di battute di una pagina non corrisponde, le posizioni di quella pagina sono marcate `approximate`. homr non fornisce posizioni.
- Il servizio non conserva nulla: i file temporanei sono eliminati al termine della richiesta.
- Autenticazione con chiave condivisa nell'intestazione `X-Taurus-Omr-Key`, da variabile d'ambiente: il servizio non si avvia senza una chiave di almeno 16 caratteri. È esposto solo sulla rete interna.
- Limiti: 30 pagine e 25 MB per richiesta, 60 milioni di pixel per pagina, MIDI di 10 MB, 5 minuti per motore; le richieste oltre la concorrenza configurata attendono.
- Errori: `{ code, message }` con `unauthorized` (401), `lengthRequired` (411), `tooLarge` (413), `tooManyPages`, `unreadableImage`, `unknownEngine`, `unreadableMidi` (422), `busy` (503). L'esito di un motore fallito è nel suo risultato, con `engineFailed` o `engineTimeout`.

### Configurazione del backend

| Proprietà | Predefinito | Significato |
| --- | --- | --- |
| `application.score-playback.enabled` | `false` | abilitazione a livello di installazione (variabile `SCORE_PLAYBACK_ENABLED`) |
| `application.score-playback.max-upload-bytes` | 10 MB | dimensione massima di un file caricato |
| `application.omr.url` | vuoto | indirizzo del servizio, condiviso con la [lettura del testo dei PDF](omr-text-recognition-spec.md); vuoto nasconde le azioni di riconoscimento |
| `application.omr.api-key` | da variabile d'ambiente | chiave condivisa |
| `application.omr.connect-timeout` | `PT5S` | attesa massima della connessione |
| `application.score-playback.omr.timeout` | `PT12M` | attesa massima della risposta a un riconoscimento |
| `application.score-playback.omr.concurrency` | `1` | job eseguiti in parallelo dal backend |
| `application.score-playback.omr.stale-after` | `PT30M` | dopo questo tempo un job in corso torna in coda e un job in coda viene pubblicato di nuovo |
| `application.score-playback.omr.max-attempts` | `3` | tentativi di un job prima che diventi `FAILED` con `interrupted` |
| `application.score-playback.omr.recovery-enabled` | `true` | recupero pianificato dei job; disattivato nei test |
| `application.score-playback.kept-versions` | `20` | versioni conservate per parte dalla pulizia notturna |
| `application.score-playback.cleanup-cron` | `0 15 4 * * *` | orario della pulizia notturna |

Le variabili d'ambiente sono `TAURUS_OMR_URL` e `TAURUS_OMR_API_KEY`, la stessa chiave del servizio: nel compose una sola variabile configura entrambi.

In sviluppo il servizio si avvia con le altre dipendenze di `taurus-be/src/main/docker/services.yml`, definito in `omr.yml`: immagine `fundanie/taurus-omr` alla versione `TAURUS_OMR_VERSION` (`latest` per default), costruita da `taurus-omr` se non è pubblicata, e chiave di sviluppo condivisa con il profilo `dev` del backend. Il servizio ha file system in sola lettura, `/tmp` in memoria, nessuna capability e limiti di CPU e memoria; l'immagine è verificata da `verify.yml` e pubblicata da `docker-publish.yml` come `taurus-omr`.

### Controlli

Calcolati dal backend (`MusicXmlInspector`) per ogni versione e salvati con essa:

| Controllo | Segnala |
| --- | --- |
| Durata delle battute | battute la cui durata non corrisponde al metro, escluse anacrusi e battute marcate implicite |
| Numero di battute | totale; il confronto tra i motori è nelle versioni del riconoscimento |
| Chiavi | cambi di chiave, chiavi all'ottava, chiavi di percussione in parti non di percussione |
| Armature e metro | cambi di armatura e di metro, metri insoliti come 8/16 o 16/16 |
| Struttura | ritornelli, volte, segno, coda, D.C., D.S. e Fine trovati; ritornelli aperti e non chiusi |
| Tempo | indicazione metronomica trovata |
| Contenuto | battute vuote, accordi in parti monofoniche |

### Scelta della versione proposta

1. Si escludono i motori falliti.
2. Si preferisce la versione con la percentuale più alta di battute di durata corretta.
3. A parità entro due punti percentuali, si preferisce quella con meno chiavi sospette: cambi di chiave, chiavi all'ottava e chiave di percussione in una parte che non è di percussione.
4. A ulteriore parità si preferisce Audiveris, che conserva dinamiche e legature di valore.

Il revisore può rendere corrente l'altra versione con **Usa questa versione**.

## Trasposizione e suoni

### Strumento

Nuovi campi dello strumento, tutti facoltativi:

| Campo | Significato |
| --- | --- |
| `transpositionSemitones` | intervallo in semitoni tra nota scritta e suono reale |
| `bassClefTranspositionSemitones` | intervallo per le parti in chiave di basso, se diverso; vuoto = uguale al precedente |
| `soundBank` | banco del suono nel SoundFont; 0 per i suoni General MIDI |
| `soundProgram` | programma del suono nel banco, da 0 a 127 |
| `percussionKey` | nota di batteria General MIDI; se presente lo strumento è una percussione |

Il suono è salvato come banco e programma, non come solo programma General MIDI: se in futuro si adotta un SoundFont gratuito con suoni specifici per la banda, come flicorni ed euphonium che il General MIDI non prevede, basterà sceglierli senza cambiare il modello dati.

Uno strumento è **configurato per l'ascolto** se ha `percussionKey`, oppure se ha sia `soundProgram` sia `transpositionSemitones`.

### Strumento non configurato

- La parte si ascolta comunque, con il pianoforte (banco 0, programma 0) e senza trasposizione; una parte in chiave di percussione usa il rullante (nota 38).
- La scheda Ascolto mostra «Suono e trasposizione non configurati per *nomi degli strumenti*» e il mixer l'etichetta «Suono non configurato»; chi ha privilegi vede anche il collegamento al dettaglio di ogni strumento da configurare.
- L'elenco degli strumenti offre il filtro **Da configurare per l'ascolto**.

### Catalogo di riferimento

Taurus contiene un catalogo di riferimento (`InstrumentPlaybackCatalog`), usato per proporre i valori degli strumenti. Valori da verificare con un archivista:

| Parole chiave | Tonalità di riferimento | Trasposizione | Chiave di basso | Suono (banco 0) |
| --- | --- | ---: | ---: | --- |
| ottavino | Do | +12 | — | 72 Piccolo |
| flauto | Do | 0 | — | 73 Flute |
| oboe | Do | 0 | — | 68 Oboe |
| corno inglese | Fa | −7 | — | 69 English Horn |
| fagotto | Do | 0 | 0 | 70 Bassoon |
| clarinetto piccolo | Mib | +3 | — | 71 Clarinet |
| clarinetto contralto | Mib | −9 | — | 71 Clarinet |
| clarinetto basso | Sib | −14 | −2 | 71 Clarinet |
| clarinetto | Sib | −2 | — | 71 Clarinet |
| sax soprano | Sib | −2 | — | 64 Soprano Sax |
| sax contralto, sax alto | Mib | −9 | — | 65 Alto Sax |
| sax tenore | Sib | −14 | — | 66 Tenor Sax |
| sax baritono | Mib | −21 | — | 67 Baritone Sax |
| tromba, cornetta | Sib | −2 | — | 56 Trumpet |
| flicorno sopranino | Mib | +3 | — | 56 Trumpet |
| flicorno soprano | Sib | −2 | — | 56 Trumpet |
| flicorno contralto | Mib | −9 | — | 60 French Horn |
| flicorno tenore | Sib | −14 | 0 | 57 Trombone |
| flicorno baritono, euphonium, eufonio, bombardino | Sib | −14 | 0 | 57 Trombone |
| flicorno basso | Sib | −14 | 0 | 58 Tuba |
| trombone | Do | 0 | 0 | 57 Trombone |
| corno | Fa | −7 | — | 60 French Horn |
| basso, tuba, bassotuba | Do | 0 | 0 | 58 Tuba |
| glockenspiel, campanelli | Do | +24 | — | 9 Glockenspiel |
| vibrafono | Do | 0 | — | 11 Vibraphone |
| xilofono | Do | +12 | — | 13 Xylophone |
| timpani, timpano | Do | 0 | 0 | 47 Timpani |
| tamburo, rullante | — | — | — | batteria, nota 38 |
| gran cassa, grancassa | — | — | — | batteria, nota 36 |
| piatti, piatto | — | — | — | batteria, nota 49 |
| triangolo | — | — | — | batteria, nota 81 |
| tamburello | — | — | — | batteria, nota 54 |

### Proposta di configurazione

Quando si crea o si rinomina uno strumento, Taurus calcola una proposta dal nome:

1. Il nome viene normalizzato: minuscole, senza accenti, senza punteggiatura, senza numeri d'ordine (1°, 2°, I, II) e senza le parole «solo», «primo», «secondo», «terzo».
2. Le parole chiave del catalogo si cercano come parole intere; vince la più lunga, così «clarinetto basso» prevale su «clarinetto» e «contrabbasso» non corrisponde a «basso».
3. Una tonalità nel nome vale se segue la parola «in» oppure se è una forma con alterazione a sé stante (`sib`, `mib`, `lab`, `reb`, `solb`, `bb`, `eb`, `ab`). Se è diversa dalla tonalità di riferimento, la trasposizione diventa quella della stessa nota più vicina al valore di riferimento; la trasposizione in chiave di basso resta quella del catalogo. Esempi: corno in Mib −9, clarinetto piccolo in Lab +8, sax tenore in Do −12.
4. Senza parole chiave non c'è proposta e lo strumento resta non configurato.

Nel dettaglio dello strumento la proposta precompila i campi, con la dicitura «Proposta da verificare»; diventa definitiva solo quando l'utente salva. Fanno eccezione due casi:

- **Strumenti esistenti al rilascio**: una migrazione Liquibase dello schema del tenant (`InstrumentPlaybackDefaultsChange`), eseguita una sola volta per tenant, compila con la proposta gli strumenti esistenti che non hanno ancora trasposizione, suono né nota di batteria, compresi i 43 predefiniti. Non sovrascrive mai un valore già impostato; gli strumenti senza proposta restano non configurati.
- **Importazione iniziale del tenant**: il foglio `Strumenti` accetta le colonne facoltative `suono` (programma General MIDI da 0 a 127, oppure `batteria:<nota>`), `trasposizione` e `trasposizione_chiave_basso`, in coda alle colonne esistenti: un file preparato senza di esse resta valido. Se sono tutte vuote si applica la proposta; valori indicati e proposta non si mescolano. Se il tenant usa l'ascolto, il rapporto segnala la proposta (`PLAYBACK_PROPOSED`) e gli strumenti che restano da configurare (`PLAYBACK_NOT_CONFIGURED`). I valori indicati per uno strumento esistente non vengono applicati (`PLAYBACK_NOT_APPLIED`). Dettagli in [Onboarding guidato e importazione iniziale del tenant](tenant-onboarding-import-spec.md).

### Scelta del suono

Nel dettaglio dello strumento si sceglie prima se è intonato o una percussione; il suono si sceglie per nome, raggruppato per famiglia, dall'elenco dei 128 programmi General MIDI, che coincide con il banco 0 di MuseScore General; il banco resta modificabile. Adottando un SoundFont con banchi propri, l'elenco andrà letto dal SoundFont con SpessaSynth. La proposta dal nome si ricalcola con **Proponi dal nome** e, per uno strumento non configurato, all'apertura e al cambio del nome. **Prova** suona una scala di un'ottava scritta in Do e trasposta con i valori correnti, oppure il colpo di batteria scelto, così l'archivista verifica a orecchio suono e trasposizione prima di salvare.

### Parte

La parte può sovrascrivere trasposizione e suono (banco e programma). Se gli strumenti assegnati alla parte hanno valori diversi e non c'è una sovrascrittura, l'ascolto usa il primo strumento e la scheda Ascolto mostra un avviso.

La trasposizione si applica alle altezze scritte durante la generazione del MIDI, con l'intervallo della chiave in uso: quello in chiave di basso per le parti in chiave di Fa, se configurato. Le parti di percussione suonano sul canale 10: con uno strumento ogni nota usa la sua nota di batteria; con più strumenti la voce 1 usa il primo, la voce 2 il secondo e così via, e le voci oltre gli strumenti usano l'ultimo. Una parte in chiave di percussione senza strumenti di batteria configurati usa il rullante.

## Ascolto

### Componenti

- **Verovio** (npm `verovio` 6.3.0, LGPL-3.0 o successiva): disegno dello spartito. Il pacchetto `verovio-toolkit-wasm.js` è copiato non modificato in `/assets/verovio/` e caricato al primo uso: il service worker lo mette in cache solo allora.
- **Generatore MIDI di Taurus** (frontend, `src/app/score-player/`): legge il MusicXML, calcola l'ordine delle battute, applica le trasposizioni e scrive un file MIDI con una traccia per parte, il metronomo e la battuta di attacco.
- **SpessaSynth** (`spessasynth_lib` 4.3.14, Apache-2.0): sintetizzatore SoundFont in AudioWorklet e sequencer, con volume e muto per canale, velocità di riproduzione e posizionamento. Il processore del worklet è copiato in `/assets/spessasynth/`.
- **SoundFont MuseScore General** in formato `.sf3` (circa 38 MB, licenza MIT), in `/assets/soundfonts/`, messo in cache dal service worker al primo ascolto. Non è versionato: lo scarica `scripts/fetch-soundfont.mjs` prima di `npm start` e `npm run build`, verificandone lo SHA-256; `TAURUS_SKIP_SOUNDFONT=1` salta il download. La nota di licenza è versionata accanto al file.

### Svolgimento dei ritornelli

Il frontend calcola l'ordine di esecuzione delle battute da ritornelli, volte, `segno`, `coda`, `dacapo`, `dalsegno`, `tocoda` e `fine` del MusicXML, compresi i testi «D.C.», «D.S.», «Fine» e «To Coda», e genera il MIDI seguendo quell'ordine. Le regole:

- **Con ritornelli**: ogni ritornello è eseguito come scritto; dopo un D.C. o un D.S. i ritornelli non si ripetono, salvo diversa indicazione.
- **Senza ritornelli**: ogni sezione è eseguita una volta, saltando le prime volte e prendendo l'ultima; i salti D.C., D.S. e Coda restano.

Il cursore usa la stessa sequenza per evidenziare la battuta disegnata. Le battute disegnate sono abbinate in ordine per numero di battuta: una pausa di più battute, che Verovio disegna come un solo elemento, resta evidenziata per tutte le battute che raggruppa. Dopo l'ultima volta un ritornello senza segno di inizio riparte dalla battuta successiva alle volte; con strutture malformate l'esecuzione si ferma dopo un numero di battute pari a 16 volte quelle della parte.

### Partitura

Il frontend genera un unico MIDI con le versioni correnti delle parti disponibili:

- le parti sono allineate per indice di battuta; le pause di più battute del MusicXML sono già battute distinte;
- la struttura (ritornelli e salti) è quella della parte di riferimento: quella scelta nella traccia da un utente con privilegi, altrimenti la prima parte in ordine di visualizzazione con versione approvata o, in mancanza, la prima disponibile;
- se le parti hanno lunghezze diverse, le più corte tacciono nelle battute mancanti e il mixer mostra «Le parti hanno lunghezze diverse».

Ogni parte usa un proprio canale MIDI, così il mixer agisce sulla singola parte. Le parti intonate occupano i canali 1-9 e 11-16 di ogni porta MIDI, passando a una porta successiva oltre le 15 parti; percussioni e metronomo usano il canale 10 di porte proprie.

Gli utenti senza privilegi ascoltano tutte le parti disponibili ma vedono lo spartito solo delle parti dei propri strumenti; senza parti proprie il lettore lo spiega al posto dello spartito.

### Controlli dell'interfaccia

- riproduci, pausa, posizionamento su una battuta;
- tempo in semiminime al minuto, partendo dall'indicazione del brano, applicato come velocità di riproduzione;
- intervallo di battute da ripetere;
- metronomo e una battuta di attacco facoltativa;
- con o senza ritornelli;
- nella partitura: volume, muto e solo per ogni parte, più le scorciatoie **Tutte**, **Solo le mie parti** e **Tutto tranne le mie**, basate sugli strumenti dell'utente;
- barra spaziatrice per avviare e fermare l'ascolto.

Il tempo iniziale è, in ordine: il nuovo campo numerico `tempoBpm` della traccia, l'indicazione metronomica della parte di riferimento, 100. Con `tempoBpm` i cambi di tempo successivi della partitura sono scalati nella stessa proporzione.

## Editor di correzione

Disponibile a super amministratore, amministratore e archivista, a schermo intero.

- **Intestazione**: in alto a sinistra la freccia **Torna alla traccia** chiude l'editor e riporta alla scheda Ascolto da cui è stato aperto; con correzioni non salvate chiede prima «Uscire senza salvare?». Seguono titolo e versione di partenza, poi a destra annulla e ripristina, ascolto, **Salva** e **Salva e approva**. Non c'è un secondo comando di chiusura: la freccia è l'unico.
- **Layout**: spartito disegnato da Verovio a sinistra, pagina originale a destra con la battuta selezionata evidenziata, ingrandibile al 100, 150 e 200%. Con posizioni approssimate il riquadro è più ampio e tratteggiato; senza posizioni, o con pagine cambiate dopo la versione, un avviso lo spiega e le pagine si scorrono a mano.
- **Note e pause**: selezione con il mouse o con le frecce; nome della nota (tasti A–G, all'ottava più vicina), su e giù di un grado o di un'ottava, alterazione, figura (tasti 1–7 come in MuseScore), punti di valore; trasformazione tra nota e pausa; inserimento prima o dopo, aggiunta all'accordo ed eliminazione.
- **Legature e terzine**: legature di valore con la nota seguente della stessa altezza, anche nella battuta dopo (una legatura di portamento tra le stesse note viene tolta, come la legge homr); gruppi irregolari di 3, 5 e 6 note. Spostando una nota legata si spostano anche le note legate a lei.
- **Battuta**: metro, armatura, chiave; **Inserisci prima** ed **Elimina**, che conservano gli attributi in vigore; un solo **Numero di battute** (da 1 a 200) usato da due comandi. **Aggiungi dopo** aggiunge quel numero di battute separate dopo la selezionata, ognuna con una pausa di battuta da trasformare in note; se la battuta selezionata è dentro una pausa di più battute, le nuove battute vanno dopo l'intero gruppo, che resta intatto. **Pausa di più battute da qui** trasforma la battuta selezionata in una pausa che dura quel numero di battute, aggiungendo o togliendo le battute del gruppo; se la battuta contiene note chiede prima conferma, perché vanno perse. Selezionando una pausa di più battute il numero mostra la sua durata, così una pausa letta male si corregge in un passaggio; sulle altre battute resta l'ultimo valore scritto. Per inserire una pausa di più battute senza toccare la musica esistente si aggiunge una battuta con **Aggiungi dopo** e la si trasforma con **Pausa di più battute da qui**.
- **Battute vuote**: una battuta senza note né pause, come capita in alcune versioni riconosciute o salvate prima di questa regola, si seleziona con un clic o dall'elenco dei controlli; la barra di stato la indica come «vuota» e offre **Aggiungi una pausa**, da cui si inseriscono le note. I comandi della scheda Battuta valgono anche per lei. L'editor non crea più battute vuote: eliminando l'ultima nota di una battuta resta una pausa di battuta, e quella pausa non si elimina, perché per togliere la battuta c'è **Elimina** nella scheda Battuta.
- **Struttura**: ritornelli, volte 1, 2 e 3, segno, Al Coda, Coda, D.C., D.S., Fine; indicazione metronomica.
- **Espressione**: dinamiche da ppp a fff, sfz e fp; accento, marcato, staccato e tenuto.
- **Controlli in tempo reale**: le battute di durata diversa dal metro sono evidenziate e elencate, come le battute vuote; un clic porta alla battuta. Sono elencate anche le segnalazioni aperte della parte, con la battuta indicata.
- **Annulla e ripristina** nella sessione, fino a 100 modifiche.
- **Ascolto** della battuta selezionata o dell'intervallo scelto con Maiusc+clic, senza ritornelli né salti e con il suono della parte.

Le modifiche agiscono sul DOM MusicXML della versione (`src/app/score-editor/`) e producono a ogni salvataggio una nuova versione. Per riconoscere ciò che si seleziona, l'editor assegna un `id` a battute e note: Verovio lo conserva negli elementi disegnati. Accidenti e alterazioni seguono le regole descritte nelle [scelte di sviluppo della correzione](#correzione).

## Modello dati e migrazioni

### Schema del tenant

Changelog in `tenant-master.xml`. Tutte le nuove tabelle hanno i campi di audit `deleted`, `insert_date`, `insert_by`, `edit_date`, `edit_by`; quelle modificabili anche `entity_version`.

Modifiche a tabelle esistenti:

| Tabella | Colonna | Tipo | Note |
| --- | --- | --- | --- |
| `instrument` | `transposition_semitones` | `SMALLINT` | facoltativo, tra −36 e +36; vuoto = non configurato |
| `instrument` | `bass_clef_transposition_semitones` | `SMALLINT` | facoltativo, tra −36 e +36 |
| `instrument` | `sound_bank` | `SMALLINT` | facoltativo, tra 0 e 16383; richiede `sound_program` |
| `instrument` | `sound_program` | `SMALLINT` | facoltativo, tra 0 e 127 |
| `instrument` | `percussion_key` | `SMALLINT` | facoltativo, tra 27 e 87 |
| `track` | `tempo_bpm` | `SMALLINT` | facoltativo, tra 20 e 300 |
| `track` | `reference_sheet_music_id` | `BIGINT` | facoltativo, parte di riferimento della partitura |
| `sheet_music` | `current_score_version_id` | `BIGINT` | FK verso `score_version` |
| `sheet_music` | `transposition_override` | `SMALLINT` | facoltativo |
| `sheet_music` | `sound_bank_override` | `SMALLINT` | facoltativo; richiede `sound_program_override` |
| `sheet_music` | `sound_program_override` | `SMALLINT` | facoltativo |

Nuove tabelle:

**`score_version`**: `id`, `sheet_music_id`, `version_number` (progressivo per parte), `origin` (`OMR_AUDIVERIS`, `OMR_HOMR`, `UPLOAD_MUSICXML`, `UPLOAD_MIDI`, `CORRECTION`), `status` (`UNVERIFIED`, `APPROVED`), `media_asset_id` (file `.mxl`), `pages_fingerprint`, `recognition_job_id`, `parent_version_id`, `source_file_name`, `source_part_name`, `checks_json`, `layout_json`, `measure_count`, `approved_by`, `approved_at`, audit, `entity_version`. Vincolo univoco `(sheet_music_id, version_number)` sulle righe non cancellate: due caricamenti contemporanei sulla stessa parte non possono prendere lo stesso numero e il secondo riceve `409`.

Le tabelle seguenti arrivano con la fase indicata.

**`score_recognition_job`** (fase 2, `20261017000000_score_recognition_job.xml`): `id`, `sheet_music_id`, `track_id`, `batch_id` (per **Riconosci tutte le parti**), `pages_fingerprint`, `status` (`QUEUED`, `RUNNING`, `DONE`, `FAILED`), `attempts`, `requested_by`, `started_at`, `finished_at`, `error_code`, `engines_json` (esito, durata e versione per motore), audit, `entity_version`. Al massimo un job `QUEUED` o `RUNNING` per parte, garantito da un indice univoco parziale; `error_code` è presente solo sui job `FAILED`. `score_version.recognition_job_id` diventa una chiave esterna verso il job.

**`score_error_report`** (fase 3, `20261018000000_score_error_report.xml`): `id`, `sheet_music_id`, `track_id`, `score_version_id` (versione ascoltata alla segnalazione), `measure_number` (testo, massimo 16 caratteri, facoltativo), `message` (massimo 1000 caratteri, non vuoto), `reported_by`, `reporter_name` (nome e cognome dal token alla segnalazione, mostrato quando chi segnala non è un utente del tenant, come un super amministratore; changeset `20261018000000-2`), `status` (`OPEN`, `CLOSED`), `closure` (`MANUAL` per la chiusura da parte di chi gestisce, `APPROVAL` per l'approvazione di un'altra versione), `closed_by`, `closed_at`, audit, `entity_version`. Un vincolo garantisce che una segnalazione chiusa abbia modo, autore e data della chiusura. Le segnalazioni di un utente sono cancellate fisicamente con la cancellazione dei suoi dati.

`MediaRepository.isUnreferenced` aggiunge `score_version.media_asset_id` ai riferimenti. Le versioni sono categoria media `score-versions`.

All'eliminazione di una parte le sue versioni, i job e le segnalazioni seguono la cancellazione logica esistente. Un job notturno elimina le versioni oltre le ultime 20 di ogni parte che non sono correnti, approvate o all'origine di una versione conservata, e i loro file quando nessuno li usa più.

### Schema pubblico

Nuova colonna `tenant.score_playback_enabled` in `master.xml`, come per le altre funzionalità per tenant.

Changelog della fase 1: `20261016000000_track_score_playback.xml` (schema del tenant) e `20261016000001_tenant_score_playback_flag.xml` (schema pubblico).

### Coda

Nuova coda `score.recognition` sullo scambio `taurus.rabbitmq`, con messaggi JSON `{ tenant, jobId }` pubblicati dopo il commit; un messaggio che non si riesce a pubblicare non è un errore, perché la tabella dei job resta la fonte di verità. Il consumer usa la concorrenza configurata, scarta i messaggi illeggibili o di tenant non attivi e passa il job da `QUEUED` a `RUNNING` con un aggiornamento condizionale che conta i tentativi: un messaggio duplicato non esegue il job due volte. Un job `RUNNING` oltre `stale-after` torna `QUEUED`; al terzo tentativo diventa `FAILED` con `interrupted`. Un job `QUEUED` da oltre `stale-after` viene pubblicato di nuovo.

## API REST

### Gestione (super amministratore, amministratore, archivista)

Prefisso `/api/tracks/{trackId}`:

| Metodo e percorso | Descrizione |
| --- | --- |
| `POST /recognitions` | riconoscimento di tutte le parti con pagine e senza un job attivo; risponde `202` con i job, che condividono un lotto |
| `POST /scores/{scoreId}/recognitions` | riconoscimento di una parte; risponde `202`, `409` se c'è già un job attivo |
| `GET /recognitions` | ultimo job di ogni parte, con stato, tentativi, errore ed esito per motore |
| `GET /scores/{scoreId}/score-versions` | versioni con origine, stato, controlli e impronta |
| `GET /scores/{scoreId}/score-versions/{versionId}/file` | MusicXML compresso (`.mxl`) della versione |
| `POST /scores/{scoreId}/score-versions/inspect` | contenuto di un file prima del caricamento: parti con nome e numero di battute, per un MIDI le tracce convertite |
| `POST /scores/{scoreId}/score-versions` | caricamento, in multipart (`file`, `partId`, `approve`); correzione, in JSON (`parentVersionId`, `content` con il MusicXML della parte, `approve`, `measureSources`) |
| `GET /scores/{scoreId}/score-versions/{versionId}/editor` | per l'editor: la versione, il suo MusicXML non compresso, le immagini attuali delle pagine della parte e le posizioni delle battute, se note |
| `POST /scores/{scoreId}/score-versions/{versionId}/approve` | approvazione |
| `POST /scores/{scoreId}/score-versions/{versionId}/current` | rende corrente la versione |
| `PUT /scores/{scoreId}/playback-settings` | sovrascritture di trasposizione e suono (banco e programma) |
| `PUT /playback-settings` | `tempoBpm`, parte di riferimento e `version` della traccia; risponde con la nuova versione della traccia |
| `GET /error-reports` | segnalazioni delle parti della traccia: tutte le aperte, poi le ultime 50 chiuse, con versione, autore e chiusura |
| `POST /error-reports/{reportId}/close` | chiusura di una segnalazione; idempotente |

`PUT /playback-settings` richiede la versione della traccia, coerentemente con il controllo di concorrenza già usato sulle tracce, e la pagina aggiorna la versione della traccia aperta. Approvazione e scelta della versione corrente sono idempotenti; caricamento e correzione sono protetti dal vincolo sul numero di versione.

La correzione eredita dalla versione di partenza l'impronta delle pagine e il nome della parte d'origine. `measureSources` indica per ogni battuta la posizione, da 0, della battuta di partenza da cui viene, oppure `null` per una battuta inserita: le posizioni delle battute sulle pagine seguono le battute. Senza `measureSources` le posizioni restano solo se il numero di battute non cambia. Approvare una versione, anche caricandola o salvando una correzione come approvata, chiude le segnalazioni aperte fatte sulle altre versioni della parte.

Strumenti, con il prefisso `/api/instruments`:

- le operazioni esistenti di creazione, modifica e lettura includono i nuovi campi e lo stato **configurato per l'ascolto**;
- l'elenco accetta il filtro `playbackConfigured`;
- `GET /playback-suggestion?name=…` restituisce la proposta calcolata dal nome, con la parola chiave riconosciuta e l'eventuale tonalità, oppure nessuna proposta.

### Ascolto (tutti i ruoli che vedono la traccia)

Per `ROLE_USER` il prefisso è `/api/user/tracks/{trackId}`, per `ROLE_USER_EXTERNAL` `/api/external/tracks/{trackId}`, per i ruoli con privilegi `/api/tracks/{trackId}`.

| Metodo e percorso | Descrizione |
| --- | --- |
| `GET /playback` | parti con disponibilità, stato della versione corrente, riepilogo dei controlli, trasposizione, suono, tempo e parte di riferimento; per chi ha privilegi anche presenza delle pagine, ultimo riconoscimento e disponibilità del servizio OMR (`recognitionAvailable`) |
| `GET /scores/{scoreId}/playback-file` | MusicXML della versione corrente, se utilizzabile per l'utente |
| `POST /scores/{scoreId}/error-reports` | segnalazione di un errore sulla versione corrente (`measureNumber` facoltativo, `message`); risponde `201` |

Il servizio applica le stesse regole di visibilità del dettaglio della traccia: tutte le parti di una traccia visibile, con `ownPart` per quelle dei propri strumenti. Una traccia non visibile o una parte senza versione utilizzabile risponde `404`; lo stesso vale per le segnalazioni. `SecurityConfiguration` ammette in modo esplicito il `POST` delle segnalazioni per `ROLE_USER` e `ROLE_USER_EXTERNAL`, che per il resto restano limitati alle letture.

### Errori

Secondo lo [Standard degli errori applicativi](application-errors-standard.md):

| Chiave | HTTP | Caso |
| --- | --- | --- |
| `tenantFeature.scorePlayback.disabled` | 403 | funzionalità disattivata per il tenant |
| `scorePlayback.track.notFound` | 404 | traccia inesistente o non visibile |
| `scorePlayback.part.notFound` | 404 | parte che non appartiene alla traccia |
| `scorePlayback.playback.notAvailable` | 404 | parte senza versione ascoltabile dall'utente |
| `scorePlayback.upload.empty` | 400 | file vuoto |
| `scorePlayback.upload.unsupportedFormat` | 415 | file diverso da MusicXML e, con il servizio OMR configurato, da MIDI |
| `scorePlayback.upload.invalid` | 422 | file non leggibile, con `args.reason` (per un MIDI `unreadableMidi`) |
| `scorePlayback.upload.partRequired` | 422 | file con più parti senza indicazione di quella da importare |
| `scorePlayback.upload.partNotFound` | 422 | parte indicata assente dal file |
| `scorePlayback.upload.tooLarge` | 413 | file oltre la dimensione massima, con `args.maxMegabytes` |
| `scorePlayback.version.notFound` | 404 | versione inesistente o di un'altra parte |
| `scorePlayback.version.conflict` | 409 | un'altra versione della parte salvata nello stesso momento |
| `scorePlayback.settings.invalid` | 422 | trasposizione, suono o tempo fuori intervallo, anche nel dettaglio dello strumento; banco senza programma |
| `scorePlayback.settings.versionConflict` | 409 | traccia modificata da un'altra richiesta |
| `scorePlayback.recognition.alreadyRunning` | 409 | job già in coda o in corso per la parte, o per tutte le parti con pagine |
| `scorePlayback.recognition.noPages` | 422 | parte, o traccia, senza pagine da riconoscere |
| `scorePlayback.omr.unavailable` | 503 | servizio OMR non configurato o non raggiungibile, per il riconoscimento o la conversione di un MIDI |
| `scorePlayback.correction.invalid` | 422 | correzione che non è un MusicXML con una sola parte, o `measureSources` che non corrisponde alla versione di partenza, con `args.reason` |
| `scorePlayback.report.invalid` | 422 | segnalazione senza descrizione, oltre 1000 caratteri o con un numero di battuta oltre 16 caratteri |
| `scorePlayback.report.limitReached` | 409 | 10 segnalazioni aperte dello stesso utente sulla parte, con `args.maxOpen` |
| `scorePlayback.report.notFound` | 404 | segnalazione inesistente o di un'altra traccia |

I codici di errore dei job sono restituiti come dati e tradotti dal frontend e nelle notifiche: `engineTimeout`, `engineFailed`, `tooManyPages`, `tooLarge`, `unreadableImage` dal servizio; `serviceUnavailable` per rete, chiave o capacità del servizio; `noPages`, `interrupted` e `unexpected` dal backend.

## Interfaccia utente

La vista segue il [Taurus Layout Standard](taurus-layout-standard.md) e la documentazione PrimeNG in `docs/llms-full.md`.

- **Dettaglio della traccia, scheda Ascolto**: **Ascolta la partitura**; per chi ha privilegi le impostazioni della partitura (tempo, parte di riferimento) con **Salva impostazioni**; per ogni parte etichetta della versione (**Non verificata**, **Approvata**, «Ascolto non ancora disponibile»), numero di battute, suono e trasposizione, avvisi dei controlli, **Ascolta** e, per chi ha privilegi, **Riconosci** (**Riconosci di nuovo** con una versione, **Riprova** dopo un errore), **Carica MusicXML o MIDI** e **Versioni e suono**; in testa **Riconosci tutte le parti**. Lo stato del riconoscimento («in coda», «in corso», «non riuscito» con il motivo) si aggiorna ogni 5 secondi finché un riconoscimento è attivo e, al termine, la scheda ricarica le versioni. Per chi ha privilegi, **Ascolta** su una parte con pagine e senza versione avvia il riconoscimento; **Correggi** apre l'editor sulla versione corrente, **Segnalazioni** l'elenco delle segnalazioni della parte e un'etichetta rossa indica quante sono aperte.
- **Caricamento**: scelta del file MusicXML o, con il servizio OMR, MIDI, elenco delle parti o tracce contenute con nome e battute, **Carica come approvata**.
- **Notifiche**: a chi ha avviato il riconoscimento, «Riconoscimento completato» o «Riconoscimento non riuscito» con il motivo; per **Riconosci tutte le parti** una sola «Riconoscimento delle parti completato» con il numero di parti riuscite e non riuscite. Aprono la scheda Ascolto della traccia.
- **Lettore della parte**: spartito con cursore, controlli di ascolto, etichetta e riepilogo dei controlli, **Segnala un errore**.
- **Segnala un errore**: parte (nella partitura), battuta facoltativa proposta da quella in ascolto, descrizione; a chi la invia un messaggio di conferma.
- **Segnalazioni della parte**: aperte e chiuse con battuta, versione, autore e data; **Chiudi segnalazione** e **Correggi la parte**; anche qui il piede porta la sola **Chiudi**.
- **Lettore della partitura**: spartito della parte selezionata tra quelle visibili all'utente, mixer, controlli di ascolto.
- **Versioni e suono**: elenco con origine, data, stato, controlli e azioni **Usa questa versione**, **Approva**, **Correggi**, **Scarica**; sovrascritture di trasposizione e suono della parte con **Salva suono**; i campi vuoti mostrano in grigio i valori ereditati dal primo strumento della parte (per esempio «+3 dallo strumento», «Come lo strumento: Clarinet»). Ogni azione ha effetto nel corpo del dialogo, quindi il piede porta la sola **Chiudi**. Con trasposizione, suono o banco modificati e non salvati, **Chiudi**, la X, Esc e **Correggi** chiedono conferma prima di perdere le modifiche.
- **Editor di correzione**: vista a schermo intero descritta in [Editor di correzione](#editor-di-correzione).
- **Strumenti**: nel dettaglio, trasposizione e suono con la proposta calcolata dal nome, il selettore del suono per famiglia e **Prova**; nell'elenco, l'indicazione e il filtro **Da configurare per l'ascolto**.
- **Avviso di strumento non configurato**: nella scheda Ascolto, con i nomi degli strumenti e, per chi ha privilegi, il collegamento al dettaglio di ciascuno; nel mixer come etichetta «Suono non configurato».
- **Utenti senza privilegi**: **Ascolta** disabilitato con il testo «Ascolto non ancora disponibile» quando la parte non ha una versione utilizzabile.

Le azioni sono nascoste se la funzionalità del tenant è disattivata; le azioni di riconoscimento sono nascoste anche quando il servizio OMR non è configurato.

## Autorizzazioni e isolamento tenant

| Operazione | Utente, esterno | Archivista | Admin | Super admin |
| --- | ---: | ---: | ---: | ---: |
| Ascoltare parti e partitura visibili | sì | sì | sì | sì |
| Segnalare un errore | sì | sì | sì | sì |
| Avviare il riconoscimento | no | sì | sì | sì |
| Caricare, correggere, approvare, scegliere la versione | no | sì | sì | sì |
| Configurare trasposizione, suono e tempo | no | sì | sì | sì |
| Chiudere le segnalazioni | no | sì | sì | sì |

- Le tabelle sono nello schema del tenant; il job porta il tenant e il worker imposta il contesto del tenant prima di leggere pagine e salvare versioni.
- Il servizio OMR non riceve identificativi di tenant, tracce o utenti: solo immagini o file.
- Tutti gli endpoint sono protetti da `@RequiresTenantFeature(TenantFeature.SCORE_PLAYBACK)`.

## Osservabilità e sicurezza

- Metriche: `taurus.score.recognition{engine,outcome}`, `taurus.score.recognition.duration{engine}`, `taurus.score.recognition.jobs{outcome}`, `taurus.score.upload{format,outcome}` (formato `musicxml`, `midi` o `correction`), `taurus.score.error_reports{outcome}` (`created`, `closed`, `approved`).
- Log con identificativi di job, parte e tenant ed esito; mai contenuto dei file o testo delle segnalazioni.
- MusicXML: parsing con entità esterne e DTD disabilitate; `.mxl`: al massimo 50 MB decompressi e 100 voci nello zip; MIDI: al massimo 10 MB.
- Servizio OMR: utente non privilegiato nel container, file system di sola lettura salvo la directory temporanea, limiti di CPU e memoria, nessun accesso a Internet in esecuzione.

## Licenze

| Componente | Licenza | Uso |
| --- | --- | --- |
| Audiveris | AGPL-3.0 | processo separato nel servizio OMR, non modificato |
| homr | AGPL-3.0 | processo separato nel servizio OMR, non modificato |
| Pesi dei modelli di homr | AGPL-3.0, con dati di addestramento sotto licenze diverse, tra cui Camera-PrIMuS (CC BY-NC 4.0 nella copia su Hugging Face) | ammesso perché Taurus non è commerciale; va rivalutato se Taurus diventasse commerciale |
| Tesseract e dati linguistici | Apache-2.0 | servizio OMR |
| music21 | BSD-3-Clause | servizio OMR |
| Verovio | LGPL-3.0 o successiva | frontend, file separato non modificato |
| SpessaSynth | Apache-2.0 | frontend |
| SoundFont MuseScore General | MIT | frontend, con le note di copyright |

Il nuovo modulo `taurus-omr` include i testi delle licenze e un riferimento ai sorgenti dei motori usati.

## Strategia di test

### Servizio OMR

- Test di accuratezza (fase 4): sei parti di riferimento scritte per il test (`accuracy/corpus.py`) sono disegnate con Verovio in pagine A4 a 300 DPI, una delle quali come fotocopia consumata, riconosciute dal servizio in esecuzione e confrontate battuta per battuta con le regole del lettore; la quota minima di battute corrette e di indicazioni di struttura per motore è fissata nel test, così un aggiornamento che peggiora fallisce. La CI lo esegue a ogni modifica di `taurus-omr` sull'immagine appena costruita e ne pubblica la tabella nel riepilogo del job.
- Parti reali: `python -m accuracy compare` confronta la versione approvata di una parte con quella di un motore ed elenca le battute diverse.
- Unione di pagine e movimenti, posizioni delle battute, conversione MIDI.
- Limiti di dimensione, timeout, chiave condivisa.

### Backend

- Ciclo del job: coda, esecuzione, completamento, errore, recupero dei job bloccati, unicità per parte.
- Scelta della versione proposta e rispetto della versione approvata.
- Regole di disponibilità per ruolo, incluse pagine cambiate.
- Caricamenti: formati, file con più parti, file non validi, protezione XML.
- Autorizzazioni, isolamento tenant e visibilità delle parti per `ROLE_USER` e `ROLE_USER_EXTERNAL`.
- Migrazioni Liquibase e media non rimossi dalla pulizia finché referenziati.
- Proposta per gli strumenti: normalizzazione del nome, parola chiave più lunga, parole intere, tonalità nel nome (corno in Mib −9, clarinetto piccolo in Lab +8, sax tenore in Do −12), assenza di proposta senza parole chiave.
- Migrazione degli strumenti esistenti: compila solo i campi vuoti, non sovrascrive, è ripetibile senza effetti.
- Importazione iniziale con e senza le colonne di suono e trasposizione.
- Correzioni: versione derivata, impronta delle pagine ereditata, posizioni delle battute seguite con `measureSources`, file con più parti rifiutati.
- Segnalazioni: visibilità come per l'ascolto, validazione, limite per utente, chiusura manuale e all'approvazione, notifica, cancellazione con i dati dell'utente.

### Frontend

- Svolgimento dei ritornelli: ritornelli semplici e annidati, prime e seconde volte, D.C. al Fine, D.S. al Coda, opzione senza ritornelli.
- Unione delle parti, pause multiple, lunghezze diverse.
- Trasposizione, chiave di basso, percussioni, strumento non configurato.
- Selettore del suono e **Prova**.
- Mixer, tempo, intervallo, metronomo.
- Disponibilità e testi per ruolo.
- Editor: ogni operazione, controllo di durata, salvataggio.

### Copertura della fase 1

- Backend: `InstrumentPlaybackSuggesterTest`, `MusicXmlDocumentsTest`, `ScorePlaybackSupportTest`, `ScoreVersionServiceTest`, `OnboardingInstrumentPlaybackTest`, `OnboardingFileInspectionServiceTest`; `ScorePlaybackIT` (migrazione e proposte, regole di caricamento, pagine cambiate e approvazione, file con più parti, conflitto sulle impostazioni, filtro degli strumenti) e `OnboardingImportIT`.
- Frontend: specifiche di `score-player/` (ordine delle battute, scrittura MIDI, lettura MusicXML, costruzione dell'ascolto, tempi, abbinamento delle battute disegnate, etichette), del servizio, del lettore e della scheda Ascolto.
- Prova nel browser del 16/10/2026 con due parti reali ricavate da Audiveris: disegno con Verovio in circa 1,5 secondi, caricamento del SoundFont in circa 1,5 secondi, avanzamento del sequencer e cambio di velocità corretti.

### Copertura della fase 2

- Servizio OMR: 41 test pytest con motori finti (API e chiave, limiti, motori falliti o oltre il tempo, unione di pagine e movimenti, posizioni con pause multiple, immagini, configurazione, MIDI) e prova nel container reale su tre parti.
- Backend: `ScoreRecognitionProposalTest`, `OmrClientTest` (con un server HTTP locale), `ScoreVersionServiceTest` (MIDI) e `ScoreRecognitionIT` con un servizio OMR simulato: job e proposta, versione approvata conservata, motivi degli errori, lotto con notifica unica, recupero dei job interrotti, conversione MIDI, pulizia delle versioni.
- Frontend: stato del riconoscimento con aggiornamento periodico, **Ascolta** che avvia il riconoscimento, chiamate del servizio, etichette.

### Copertura della fase 3

- Prova preliminare in Node del 18/10/2026 con Verovio 6.3.0: gli `id` di `measure` e `note` del MusicXML restano negli elementi disegnati, comprese pause di battuta e accordi; una pausa di più battute prende l'`id` della prima battuta.
- Prova nel browser del 18/10/2026 con l'applicazione completa in locale, il servizio OMR nel container e un super amministratore, su una parte di 16 battute generata con Verovio e caricata come PDF: riconoscimento con Audiveris e homr in circa 50 secondi (Audiveris proposto, 13 battute perché ha letto la pausa di 4 battute come una sola); editor aperto con il riquadro della battuta sulla pagina originale; selezione con il mouse e con le frecce, altezza, figura e alterazione da tastiera, controllo di durata in tempo reale, annulla e ripristina; segnalazione dal lettore sulla battuta 10 con notifica in coda, etichetta sulla parte ed elenco; dalla segnalazione l'editor porta alla battuta 10, la pausa portata a 4 battute rinumera le battute fino a 16; **Salva e approva** crea la versione 3 approvata, chiude la segnalazione con l'approvazione, eredita l'impronta delle pagine e sposta le posizioni (battute 11–13 nuove senza riquadro, le vecchie 11–13 diventano 14–16 con il riquadro giusto); il file salvato non contiene `id` né attributi di lavoro; chiudere con modifiche chiede conferma; l'ascolto della battuta suona.
- Backend: `ScoreVersionServiceTest` (correzione derivata e approvata, file con più parti, origine delle battute non valida, posizioni seguite), `ScorePlaybackIT` (correzione con pagine cambiate e contenuto ascoltato, dati dell'editor; segnalazioni con regole di visibilità, validazione, notifica, chiusura all'approvazione, chiusura manuale idempotente e limite per utente), `SecurityConfigurationTest` (segnalazioni ammesse solo sui percorsi del proprio ruolo).
- Frontend: specifiche di `score-editor/` (`id` e attributi di lavoro tolti dal file salvato, accidenti resi espliciti, altezze con armatura e accidenti, correzione di armatura e chiave, durate con adeguamento delle divisioni, travature, note e pause, accordi, legature anche tra battute, gruppi irregolari, inserimento ed eliminazione di battute, battute aggiunte dopo quella selezionata, battute vuote riempite e mai create, pause di più battute, ritornelli, volte, salti e tempo letti dal lettore, dinamiche e articolazioni, cronologia, ascolto di un passaggio) , del lettore (**Segnala un errore**) e, con il componente disegnato davvero, dell'editor (apertura, disegno, salvataggio con l'origine delle battute) e del lettore (disegno dello spartito).

### Copertura della fase 4

- Servizio OMR: `test_accuracy_compare.py` (corpus e confronto: accidenti, legature, terzine, pause di più battute, grafia e voci ignorate, battute perse o in più, struttura, file compressi, riga di comando) e `test_accuracy.py` sui motori reali.
- Accuratezza misurata il 18/10/2026 con l'immagine del servizio in locale (Audiveris 5.11.0, homr 0.7.0, 4 CPU), due esecuzioni con risultati identici:

| Parte | Battute | Audiveris | homr | Struttura Audiveris | Struttura homr |
| --- | --- | --- | --- | --- | --- |
| Marcia, tromba, 2/4 | 32 | 32 | 31 | 4/7 | 2/7 |
| Valzer, corno con divisi e pause di 8 e 4 battute | 32 | 20 (22 lette) | 21 (22 lette) | 0/1 | 0/1 |
| Corale, tuba in chiave di basso, anacrusi e D.C. al Fine | 21 | 17 (18 lette) | 14 (18 lette) | 0/3 | 0/3 |
| Tarantella, clarinetto in 6/8 | 20 | 19 (19 lette) | 19 | 4/5 | 1/5 |
| Scherzo, flauto con sedicesimi e terzine | 14 | 13 (13 lette) | 12 | 3/3 | 1/3 |
| Marcia come fotocopia consumata | 32 | 31 | 27 | 4/7 | 2/7 |
| **Totale** | 151 | **132 (87%)** | **124 (82%)** | **15/26** | **6/26** |

  Ogni pagina richiede circa 40 secondi con i due motori in parallelo. Errori ricorrenti, che indicano dove guardare durante la correzione:
  - entrambi i motori leggono una pausa di più battute come una battuta sola, e nessuno dei due legge Fine e D.C.;
  - homr perde quasi tutte le legature di valore, l'anacrusi, gli inizi dei ritornelli e le volte, e sbaglia di un grado alcune note molto acute; sulla fotocopia sbaglia anche il ritmo di quattro battute;
  - Audiveris perde l'ultimo sistema quando contiene una sola battuta, più corto della pagina, legge le volte solo in parte, ha letto come pausa una semibreve molto grave e perde qualche legatura di valore, anche sulla fotocopia.

- Misure del 18/10/2026 nel browser (Chrome 155 senza interfaccia, sul computer di sviluppo), con lo stesso codice del lettore e dell'editor e parti ricavate dal corpus; tra parentesi gli stessi tempi con il processore rallentato quattro volte, come il profilo «fascia media» degli strumenti di sviluppo di Chrome per i telefoni:

| Misura | Tempo |
| --- | --- |
| Avvio di Verovio | 0,15 s |
| Disegno nell'editor, larghezza 900 px, compreso l'inserimento nella pagina: 32 battute; 160 battute; 140 battute fitte di sedicesimi; 320 battute | 0,04 s; 0,14 s; 0,2 s; 0,22 s (0,35 s; 1,4 s; 2,7 s; 2,9 s) |
| Disegno nel lettore a 390 px, larghezza di un telefono: 32 battute; 160 battute | 0,04 s; 0,17 s (0,55 s; 1,8 s) |
| Partitura di 30 parti da 128 battute: lettura dei MusicXML; generazione del MIDI (142 KB); caricamento nel sequencer | 0,3 s; 0,02 s; 0,3 s (2,5 s; 0,1 s; —) |
| SoundFont: lettura del file già in cache; caricamento nel sintetizzatore | 0,2 s; 0,65 s |

  Memoria privata del processo della pagina: circa 150 MB all'avvio, 190 MB in più con il SoundFont caricato, nessun aumento dopo 80 secondi di ascolto della partitura di 30 parti, 140 MB in più con Verovio; in tutto circa 470 MB. SpessaSynth trasferisce il file al proprio worklet senza copiarlo: la memoria è quella del SoundFont letto. Il primo scaricamento del SoundFont, circa 40 MB, dipende dalla rete e il lettore lo indica nel messaggio di caricamento.
- Frontend: specifiche dell'editor (modifiche rapide disegnate una volta sola, al fotogramma successivo), del lettore (mixer chiuso sul telefono) e del disegno (nomi della parte tolti, `id` conservati).
- Prova nel browser del 18/10/2026 a 375 × 812 px, con un super amministratore e il servizio OMR reale: scheda Ascolto senza scorrimento orizzontale; lettore della parte con due o tre battute per rigo, avanzamento della battuta durante l'ascolto e spartito che segue; partitura con il mixer chiuso e lo spartito visibile. A 1280 px il mixer resta aperto e senza pulsante.

### Verifica manuale

- Parti reali della banda: digitali, scansioni e foto.
- Ascolto su telefono di fascia media, con misura della memoria usata dal SoundFont.
- Percorso completo con un tenant di prova: attivazione della funzionalità, configurazione di uno strumento con **Prova**, caricamento di un MusicXML con più parti, ascolto da archivista, utente ed esterno.
- Editor su una versione di Audiveris: selezione sullo spartito e riquadro sulla pagina, correzione di note, chiave, armatura e ritornelli, ascolto di un intervallo, **Salva e approva**; segnalazione da utente e chiusura all'approvazione.

## Criteri di accettazione

- [ ] Con la funzionalità disattivata nessuna azione di ascolto o riconoscimento è visibile.
- [ ] Un archivista avvia il riconoscimento di una parte e, al termine, ascolta la versione proposta con controlli ed etichetta.
- [ ] **Riconosci tutte le parti** produce un job per parte e una sola notifica finale.
- [ ] Un utente senza privilegi ascolta una versione non verificata e vede «Ascolto non ancora disponibile» sulle parti senza versione utilizzabile.
- [ ] Il caricamento di un MusicXML con più parti chiede quale importare; un MIDI viene convertito e ascoltato.
- [ ] Una correzione salvata crea una nuova versione; l'approvazione la marca come approvata senza modificarla.
- [ ] La partitura suona tutte le parti disponibili, con mixer, **Solo le mie parti** e **Tutto tranne le mie**.
- [ ] Ritornelli, volte e salti sono eseguiti correttamente, e l'opzione senza ritornelli li salta.
- [ ] Le parti di strumenti traspositori suonano in suoni reali, anche in chiave di basso.
- [ ] Creando lo strumento «Corno in Mib» Taurus propone suono French Horn e trasposizione −9, che l'archivista può provare e confermare.
- [ ] Uno strumento senza proposta resta non configurato: le sue parti si ascoltano con l'avviso e lo strumento compare nel filtro **Da configurare per l'ascolto**.
- [ ] Una segnalazione d'errore notifica archivisti e amministratori e si chiude con l'approvazione di una nuova versione.
- [ ] Nessun dato di un tenant è accessibile da un altro tenant.

## Piano di implementazione

1. **Ascolto da file caricati**: modello dati, funzionalità per tenant, caricamento MusicXML con controlli, versioni e approvazione, scaricamento per MuseScore, campi di strumento, parte e traccia con catalogo di riferimento, proposta, migrazione degli strumenti esistenti e colonne dell'importazione iniziale, lettore della parte e della partitura con mixer, tempo, intervallo e ritornelli.
2. **Riconoscimento**: modulo `taurus-omr`, coda e job con recupero, scelta della versione, notifiche, conversione e caricamento MIDI, eliminazione notturna delle versioni vecchie.
3. **Correzione**: editor con pagina affiancata, segnalazioni d'errore.
4. **Qualificazione**: test di accuratezza sul corpus di riferimento, misure dei prototipi tecnici, procedure dei runbook, prove con parti reali e su telefono.

## Compatibilità e adozione

- La funzionalità è disattivata per default; senza servizio OMR configurato restano disponibili caricamento e ascolto.
- Le colonne nuove sono facoltative o hanno un predefinito: tracce e parti esistenti non cambiano.
- Al rilascio la migrazione compila con la proposta gli strumenti esistenti ancora vuoti; quelli senza proposta restano non configurati e compaiono nel filtro **Da configurare per l'ascolto**.
- La build del frontend scarica il SoundFont (circa 38 MB) da `ftp.osuosl.org`: CI e immagine Docker devono poter raggiungere quell'indirizzo durante `npm run build`.
- Il foglio `Strumenti` dell'importazione iniziale accetta sia il formato precedente sia quello con le nuove colonne.
- Rollback: disattivare la funzionalità; tabelle, versioni e file restano per una riattivazione.

- Il servizio OMR è facoltativo: senza `TAURUS_OMR_URL` riconoscimento e caricamento MIDI non vengono offerti. Per pubblicare l'immagine serve il repository `taurus-omr` su Docker Hub, come per backend e frontend.

Il modulo `taurus-omr` è descritto anche in `AGENTS.md`, è tra i moduli ammessi dal catalogo, è verificato da `verify.yml` e pubblicato da `docker-publish.yml`; le procedure sono nel [Runbook operativo](runbook-operativo.md) e nel [Runbook di test](runbook-test.md).

- La tabella `score_error_report` arriva con il changelog `20261018000000_score_error_report.xml` dello schema del tenant e non richiede proprietà di configurazione.

## Questioni aperte

1. **Catalogo di riferimento**: valori e parole chiave confermati da un archivista, compresi corno in Fa o in Mib, parti in chiave di basso, percussioni intonate e nomi locali degli strumenti.
2. **SoundFont specifico per banda**: valutare in futuro un SoundFont gratuito con suoni di flicorni ed euphonium; il salvataggio del suono come banco e programma lo consente senza modifiche al modello dati.
3. **Prototipi tecnici**: la memoria usata dal lettore, misurata nella fase 4 in circa 190 MB per il SoundFont e 140 MB per Verovio, è stata confermata su un telefono reale (`PLY-009`): la scheda non viene chiusa, quindi un SoundFont più leggero non serve.

   Risolti con la fase 1: la trasposizione è applicata dal generatore MIDI di Taurus; oltre 16 canali si usano più porte MIDI, che SpessaSynth gestisce con 16 canali ciascuna. Risolto con la fase 3: la corrispondenza tra elementi di Verovio e nodi MusicXML è data dagli `id`, che Verovio conserva; MEI non serve. Risolti con la fase 4 (vedi [Copertura della fase 4](#copertura-della-fase-4)): una partitura di 30 parti si prepara in meno di mezzo secondo, e l'editor ridisegna una parte di 300 battute in circa 0,2 secondi, unendo in un solo disegno le modifiche che arrivano prima del fotogramma successivo.
4. **Licenza dei modelli di homr**: l'uso resta ammesso finché Taurus non è commerciale.
