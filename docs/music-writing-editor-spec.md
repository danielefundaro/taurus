# Editor di scrittura musicale

L'editor consente di scrivere parti e partiture direttamente in Taurus: una parte nuova da zero, una parte ricavata da un'altra per uno strumento diverso, un arrangiamento completo per l'organico della banda da cui estrarre le parti. Le parti scritte si ascoltano, si correggono, si approvano, si impaginano e si stampano come quelle ricavate dai PDF. Estende l'[editor di correzione](track-score-playback-spec.md#editor-di-correzione) dell'ascolto delle parti, che corregge una versione esistente ma non serve a scrivere.

## Stato del documento

ID catalogo: `music-writing-editor`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

Le dodici questioni aperte della prima bozza sono decise e raccolte in [Decisioni della revisione](#decisioni-della-revisione). La seconda revisione ha deciso le questioni emerse dal confronto con il codice, raccolte in [Decisioni della seconda revisione](#decisioni-della-seconda-revisione); non restano questioni aperte.

Documenti collegati: [Ascolto e correzione delle parti](track-score-playback-spec.md), [Workspace per la gestione delle parti](track-parts-workspace-spec.md), [Anteprima e stampa degli spartiti](score-preview-printing-spec.md), [Gestione centralizzata dei media](media-asset-spec.md), [Funzionalità configurabili per tenant](tenant-feature-flags-spec.md), [Standard degli errori applicativi](application-errors-standard.md).

## Contesto

- Ogni parte di una traccia (`sheet_music`) ha pagine immagine ricavate dai PDF e, con l'ascolto, versioni MusicXML immutabili (`score_version`) prodotte da riconoscimento, caricamento o correzione. Anteprima, presentazione e stampa usano solo le pagine immagine.
- L'editor di correzione lavora sul DOM MusicXML di **una sola parte** (`src/app/score-editor/`), disegnata da Verovio, che conserva gli `id` di battute e note. Corregge altezze, durate, accidenti, legature, gruppi irregolari, metro, armatura, chiave, battute, ritornelli, volte, salti, tempo, dinamiche e articolazioni, con controllo della durata delle battute, annulla e ripristina su istantanee del documento e ascolto del passaggio.
- L'editor di correzione non prende un blocco e il salvataggio non controlla che la versione di partenza sia ancora la corrente: due persone che correggono la stessa parte producono due versioni, e l'ultima salvata diventa la corrente.
- Una parte può avere più strumenti (`sheet_music_instrument`). Lo strumento dichiara trasposizione e suono (`instrument.transposition_semitones`, `bass_clef_transposition_semitones`, `sound_program`): Taurus sa già quanto traspone ogni strumento.
- Il lettore costruisce l'ascolto da più MusicXML e sa leggere una parte qualsiasi di un file con più parti (`parseMusicXml(xml, partIndex)`).
- La pagina dell'applicazione è servita da nginx con le intestazioni di `taurus-fe/security-headers.conf`, la cui `Permissions-Policy` non nomina `midi`; il backend invia `midi=()` (`SecurityConfiguration`), ma solo sulle risposte delle API, che non sono pagine.
- Il frontend usa Verovio 6.4.1 (`package.json`); il servizio OMR usa Verovio per Python solo nel test di accuratezza, alla versione 6.4.0 (`requirements-accuracy.txt`).
- Misure della fase 4 dell'ascolto: Verovio ridisegna una parte di 300 battute in circa 0,2 secondi su un computer di sviluppo e in 1–3 secondi su uno lento; l'editor riunisce già le modifiche rapide in un solo disegno per fotogramma.

## Obiettivo

- Scrivere una parte da zero con la tastiera, il mouse o una tastiera di pianoforte a schermo, in pochi minuti per una parte da banda di una pagina.
- Ricavare da una parte esistente la parte di un altro strumento, con la trasposizione calcolata dagli strumenti.
- Scrivere o arrangiare una partitura completa e estrarne le parti, ciascuna nella trasposizione del proprio strumento.
- Impaginare le parti scritte in pagine e PDF, così da usarle in anteprima, presentazione, stampa e preparazione degli eventi come le parti ricavate dai PDF.
- Non perdere lavoro: bozze salvate in automatico, un solo autore alla volta per parte o partitura, versioni immutabili.

## Fuori scope

- Incisione professionale: posizionamento manuale fine di ogni simbolo, collisioni risolte a mano, stili tipografici personalizzati. Si accetta l'impaginazione automatica di Verovio con poche opzioni.
- Modifica contemporanea della stessa parte da più persone in tempo reale.
- Testo cantato, sigle degli accordi, intavolature, notazione antica.
- Scrittura a mano libera, riconoscimento della voce o del canto.
- Uscita MIDI verso strumenti esterni e registrazione in tempo reale con quantizzazione: la tastiera MIDI serve all'inserimento nota per nota.
- Esportazione audio, armonizzazione o orchestrazione automatiche, suggerimenti generati.
- Scrittura sul telefono: sul telefono le parti scritte si consultano e si ascoltano.
- Notifiche: la scrittura non ne genera, né ai soci per le parti scritte, ricavate o estratte, né a chi avvia un'impaginazione, che ne segue lo stato nell'editor.
- Trasposizione di parti con più strumenti: si traspone solo una parte con un solo strumento.

## Casi d'uso

1. **Parte perduta o illeggibile**: l'archivista riscrive la parte guardando una fotocopia o ascoltando una registrazione.
2. **Strumento mancante**: la banda ha un sax contralto in Mib ma il brano ha solo la parte di clarinetto in Sib; si ricava la parte trasposta, con controllo dell'estensione.
3. **Parte semplificata**: per un allievo si parte dalla parte esistente e si semplificano ritmi e passaggi.
4. **Arrangiamento**: il maestro arrangia un brano per l'organico della banda in partitura, poi estrae le parti.
5. **Composizione**: un brano nuovo, scritto direttamente in partitura.

## Decisioni principali

1. **Stesso motore dell'editor di correzione.** Il documento resta MusicXML modificato nel DOM del browser e disegnato da Verovio; i moduli di `src/app/score-editor/` vengono estesi, non sostituiti. Il formato è già quello di versioni, ascolto e scaricamento per MuseScore, e la fase 3 dell'ascolto ha mostrato che Verovio conserva gli `id` necessari alla selezione. Le alternative sono nella [tabella delle alternative](#alternative-valutate).
2. **Due livelli: parte e partitura.** L'editor di parte (un rigo, fino a quattro voci) arriva per primo e copre i casi 1–3. L'editor di partitura (più parti in sistemi) arriva dopo e copre i casi 4 e 5. Il codice è lo stesso: la partitura è un documento con più `part`.
3. **Battute sempre complete durante la scrittura.** Nella scrittura una nota più lunga dello spazio rimasto si divide e si lega oltre la stanghetta, le note tolte diventano pause e ogni battuta resta della durata del metro, come in MuseScore. La correzione continua ad accettare battute sbagliate, perché deve poter mostrare gli errori del riconoscimento.
4. **Inserimento con la tastiera del computer e con una tastiera MIDI.** Una modalità di inserimento con cursore, le scorciatoie già usate dall'editor di correzione (durate 1–7, punto, pausa, alterazioni, legatura, grado e ottava) più quelle di MuseScore per l'inserimento (`N`, tasti A–G, accordo con `Maiusc`), e il mouse per la selezione. Una tastiera MIDI collegata al computer scrive le note suonate fin dalla prima fase (vedi [Tastiera MIDI](#tastiera-midi)). Per tablet e per chi non conosce le scorciatoie c'è una tastiera di pianoforte a schermo e una palette.
5. **Bozze sul server, versioni solo al salvataggio.** L'editor salva una bozza automaticamente, pochi secondi dopo l'ultima modifica; la bozza non è una versione e non si ascolta dal lettore. **Salva** produce una versione non verificata, **Salva e approva** una versione approvata, come nella correzione: chi scrive approva il proprio lavoro, senza una seconda persona. Le versioni restano immutabili.
6. **Un solo autore alla volta.** Aprire l'editor, di scrittura o di correzione, prende un blocco sulla parte o sulla partitura, rinnovato ogni 30 secondi finché l'editor è aperto e scaduto dopo due minuti senza rinnovi. Bozze e versioni si salvano solo con il blocco. Gli altri vedono chi sta scrivendo e aprono in sola lettura; chi può gestire la traccia può prendere il controllo, e la bozza dell'altro resta.
7. **La partitura è la fonte delle parti che ne derivano.** Estrarre le parti crea, per ogni parte della partitura, una nuova versione della parte corrispondente della traccia (origine `ARRANGEMENT`), trasposta per il suo strumento. Una parte estratta può essere corretta da sola; la partitura segnala che la parte non coincide più con l'estrazione e lascia scegliere se estrarla di nuovo.
8. **Trasposizione dagli strumenti, uno per parte.** La trasposizione si applica solo a una parte con un solo strumento; nella partitura si applica a ogni rigo, che ha un solo strumento. La partitura si scrive e si mostra in suoni reali o trasposta, con un comando; le parti estratte usano la trasposizione dello strumento del loro rigo, compresa quella in chiave di basso. Uno strumento non configurato blocca l'estrazione della sua parte con un messaggio, invece di indovinare.
9. **Impaginazione con Verovio, pagine come quelle dei PDF.** Una versione si impagina in pagine PNG a 300 DPI e in un PDF, con formato, dimensione del rigo e intestazione scelti dall'utente. Le pagine generate diventano pagine della parte, così anteprima, presentazione, stampa e preparazione degli eventi funzionano senza modifiche; una parte scritta e non ancora impaginata segue le regole delle [parti da impaginare](#parti-da-impaginare). La generazione avviene nel servizio `taurus-omr`, che diventa il servizio musicale interno e mantiene il nome del modulo.
10. **Ruoli e attivazione.** Scrivono super amministratore, amministratore e archivista, come per correzione e approvazione. Nuova funzionalità per tenant `SCORE_WRITING`, disattivata per default e dipendente da `SCORE_PLAYBACK`.
11. **Computer e tablet.** L'editor è progettato per computer e utilizzabile su tablet in orizzontale con la tastiera di pianoforte a schermo; sul telefono le azioni di scrittura non compaiono.
12. **Disegno per pagina.** Con parti lunghe e partiture l'editor non ridisegna più tutto a ogni modifica: ridisegna subito la pagina visibile da un estratto e impagina il resto con Verovio in un Web Worker. Obiettivo: meno di 150 ms tra tasto e nota disegnata su una partitura di 30 parti. Il tempo misurato è di circa 0,4 s, perché Verovio impiega da solo circa 0,25 s per disegnare un sistema di 30 righi; con 10 righi si scende a 0,13 s, e nascondere i righi che non si scrivono riduce allo stesso modo il disegno ([Prestazioni](#prestazioni)). Prima il ridisegno intero della stessa partitura richiedeva 11 secondi.

### Alternative valutate

| Alternativa | Motivo per cui non è la scelta |
| --- | --- |
| Editor online commerciali (Flat, Noteflight) | a pagamento per uso di gruppo e con i dati fuori da Taurus; contrari al vincolo di costo zero |
| MuseScore | applicazione desktop GPL, non incorporabile nel browser; resta il percorso alternativo con scaricamento e nuovo caricamento, già disponibile |
| OpenSheetMusicDisplay, VexFlow | disegnano lo spartito ma non lo modificano: andrebbero costruiti sopra modello, impaginazione ed editing, che Verovio e l'editor di correzione già forniscono |
| abcjs e notazione ABC | scrittura testuale comoda per melodie semplici, ma ABC non rappresenta tutto ciò che serve a una parte da banda e richiederebbe conversioni a ogni passaggio |
| Editor basati su MEI (Verovio editor, mei-friend) | MEI è più ricco di MusicXML ma richiederebbe di convertire ogni versione e di cambiare il formato già usato da ascolto e scaricamento; da riconsiderare solo se MusicXML diventasse un limite |

## Notazione supportata

Nella prima versione dell'editor di parte, oltre a ciò che la correzione già gestisce:

- inserimento di note, accordi e pause con cursore, fino a quattro voci per rigo;
- selezione di intervalli di note e battute, copia, taglia, incolla e ripetizione del passaggio selezionato;
- trasposizione di un passaggio o di tutta la parte, per intervallo o di ottava;
- legature di portamento, forcelle di crescendo e diminuendo, corona, respiro, abbellimenti (acciaccatura e appoggiatura);
- lettere di prova e numeri di riferimento, testo di espressione (per esempio «dolce», «rit.», «a tempo»), cambi di tempo con testo;
- interruzioni di riga e di pagina, numero di battute per riga suggerito;
- chiave di percussione con le note mappate sui suoni di batteria dello strumento, per le parti di percussione: ogni strumento scrive nella propria voce, come la legge il lettore (voce 1 il primo strumento della parte, voce 2 il secondo; le voci oltre gli strumenti suonano l'ultimo), e ogni suono ha una posizione fissa sul rigo. Con gli strumenti di batteria configurati, i tasti A–G, il pianoforte a schermo e la tastiera MIDI scrivono il suono dello strumento della voce, nella sua posizione e con la sua testa, e il selettore della voce porta il nome dello strumento («Voce 2 · tamburo»).

| Suono di batteria (nota General MIDI) | Posizione sul rigo | Testa |
| --- | --- | --- |
| Charleston a pedale (44) | sotto il rigo (Re4) | a croce |
| Gran cassa (35, 36) | primo spazio (Fa4) | normale |
| Tom bassi (41, 43) | secondo spazio (La4) | normale |
| Battito di mani (39) | terza linea (Si4) | a croce |
| Campanaccio (56) | terza linea (Si4) | a rombo |
| Tamburo, rullante (38, 40) | terzo spazio (Do5) | normale |
| Colpo sul cerchio (37) | terzo spazio (Do5) | a croce |
| Tom (45, 47) | quarta linea (Re5) | normale |
| Tamburello (54) | quarta linea (Re5) | a rombo |
| Tom acuti (48, 50) | quarto spazio (Mi5) | normale |
| Triangolo (80, 81) | quarto spazio (Mi5) | a croce |
| Piatto ride (51, 59), campana del ride (53) | quinta linea (Fa5) | a croce; la campana a rombo |
| Charleston chiuso (42) e aperto (46) | spazio sopra il rigo (Sol5) | a croce; aperto a croce cerchiata |
| Piatti (49, 57), piatto cinese (52), piatto splash (55) | sopra il rigo, sul primo taglio addizionale (La5) | a croce |
| Gli altri suoni, compresi quelli fuori da General MIDI | terza linea (Si4) | normale |

Le teste sono quelle che Verovio disegna, perché lo spartito dell'editor mostri ciò che si suona: il triangolo, scritto altrove con la testa a triangolo che Verovio non ha, qui è a croce e si distingue così dai tom sullo stesso spazio.

Gli altri suoni del catalogo di riferimento (triangolo, tamburello) e quelli degli strumenti aggiunti dal tenant ricevono una posizione nella stessa tabella durante la fase 1, con le prove degli archivisti.

Più avanti: battute in levare con metro diverso, metri composti misti (per esempio 2+3/8), parti per strumenti a due righi (glockenspiel, arpa, tastiere), note di richiamo (cue), ottava sopra e sotto (8va, 8vb), tremoli.

## Flussi

### Nuova parte da zero

1. Nella scheda Ascolto della traccia l'archivista sceglie **Nuova parte scritta**, accanto ai comandi di ascolto e correzione delle parti.
2. Indica descrizione e strumenti della parte, poi chiave, armatura, metro, tempo, numero di battute iniziali e battuta in levare. La chiave segue gli strumenti: percussioni, chiave di basso per gli strumenti gravi, altrimenti violino. Metro, battute, levare e tonalità si propongono dalla parte di riferimento dell'ascolto o, in mancanza, dalla prima parte approvata o con una versione; il tempo è quello dell'ascolto della partitura, se impostato. Con un solo strumento l'armatura proposta è trasportata per lo strumento, anche in chiave di basso; con più strumenti la parte non ha trasposizione. Chiave e armatura scelte a mano non cambiano più con gli strumenti.
3. Taurus crea la parte in fondo alla traccia, senza pagine e con la prima bozza (`POST /written-parts`, con la versione della traccia), e apre l'editor con le battute di pausa. Il MusicXML non contiene `<transpose>`: la trasposizione è quella dello strumento, come per l'ascolto.
4. L'archivista scrive; la bozza si salva da sola.
5. **Salva** crea la versione 1 con origine `WRITING`, non verificata; **Salva e approva** la crea approvata.
6. **Impagina** genera pagine e PDF (vedi [Impaginazione](#impaginazione)); da quel momento la parte compare in anteprima e stampa. Fino ad allora è una [parte da impaginare](#parti-da-impaginare).

Una parte della traccia senza versioni né bozza, per esempio senza pagine da riconoscere, si scrive con **Scrivi**: Taurus chiede le stesse impostazioni, tranne descrizione e strumenti, che sono quelli della parte, e apre l'editor senza creare una parte. La prima bozza si salva alla prima modifica.

### Parte ricavata da un'altra

1. Nella scheda Ascolto, su una parte con la versione ascoltata, l'archivista sceglie **Ricava una parte**. Il comando è disattivato, con il motivo, per una parte con più strumenti o senza strumenti, per una parte di percussione e per una parte senza trasposizione, né dello strumento né sua.
2. Nel dialogo sceglie lo strumento di destinazione, che sarà l'unico strumento della parte nuova, tra gli strumenti intonati del tenant tranne quello della parte; quelli senza trasposizione compaiono disattivati, con l'invito a configurarli. Il dialogo propone come nome della parte il nome dello strumento e la chiave dello strumento, come la nuova parte da zero.
3. Taurus calcola l'intervallo scritto dalla trasposizione delle due parti: quella della parte di origine, compresa la sua eventuale sovrascrittura, e quella dello strumento di destinazione, nella chiave in uso (vedi [Intervallo della derivazione](#intervallo-della-derivazione)). Questo intervallo mantiene il suono; l'**ottava** sceglie se la parte nuova suona come l'originale oppure una o due ottave sotto o sopra. Con l'[estensione](#estensione-degli-strumenti) configurata Taurus propone l'ottava con meno note fuori estensione, altrimenti lo stesso suono.
4. Per ogni ottava il dialogo mostra l'intervallo scritto e quante note escono dall'estensione; per quella scelta mostra l'armatura risultante («1 diesis (Sol maggiore)») e le battute con note sopra o sotto l'estensione. Senza estensione configurata lo dice, con il collegamento allo strumento per chi lo gestisce.
5. **Crea e scrivi** traspone la versione nel browser, con la trasposizione di tutta la parte dell'editor, e crea la parte in fondo alla traccia, senza pagine e con il risultato come prima bozza (`POST /scores/{scoreId}/derive`). La parte ricorda la versione da cui è ricavata (`derived_from_version_id`) e si apre nell'editor di scrittura.
6. Il resto segue la nuova parte da zero, dal punto 4: la prima versione salvata ha origine `WRITING`. La parte resta [da impaginare](#parti-da-impaginare) finché non si impagina, e la scheda Ascolto la mostra come ricavata dalla parte di origine.

#### Intervallo della derivazione

- **Tonalità degli strumenti**: dalla trasposizione si ricava la tonalità dello strumento sul circolo delle quinte, come per l'armatura proposta alla nuova parte da zero: −2 semitoni è Si♭ (2 bemolli), −9 è Mi♭ (3 bemolli), −7 è Fa, 0 e 12 sono Do.
- **Intervallo**: la differenza tra le tonalità delle due parti dà la classe dell'intervallo con la sua grafia, la differenza tra le trasposizioni la sua ampiezza. Dal clarinetto in Si♭ (−2) al sax contralto in Mi♭ (−9) l'armatura guadagna un diesis e l'intervallo è una quinta giusta sopra, di 7 semitoni, che mantiene il suono; un'ottava sotto diventa una quarta giusta sotto.
- **Grafia**: note, armature e cambi di armatura si traspongono con le regole della trasposizione dell'editor, che ricalcolano gli accidenti. Se l'armatura di arrivo avesse più di sette alterazioni, o una nota più di due, Taurus usa l'intervallo enarmonico, per esempio la sesta diminuita al posto della quinta giusta, e lo dice; se non basta neanche questo, il dialogo lo segnala e non crea la parte.
- **Chiave**: una chiave scelta diversa da quella iniziale della parte di origine sostituisce tutte le chiavi della parte; altrimenti le chiavi restano. La trasposizione in chiave di basso vale per la parte, di origine o nuova, che inizia in chiave di Fa, come nell'ascolto.
- **Altri cambiamenti**: il nome della parte nel MusicXML diventa quello della parte nuova, e si tolgono le indicazioni `<transpose>` e gli strumenti MIDI del file di origine, perché suono e trasposizione sono quelli dello strumento. Il resto della notazione resta com'è.
- **Ottava proposta**: tra le ottave da due sotto a due sopra che non danno note impossibili, quella con meno note fuori estensione; a parità, quella più vicina al suono dell'originale e poi quella con le note più vicine al centro dell'estensione.

### Estensione degli strumenti

L'estensione è la nota scritta più grave e quella più acuta dello strumento, nella sua trasposizione: per il clarinetto in Si♭, da Mi3 a Do7 scritti.

- **Dato**: i campi facoltativi `lowest_written_pitch` e `highest_written_pitch` dello strumento, numeri di nota MIDI (60 è il Do4), presenti o vuoti insieme e con la nota grave non più acuta di quella acuta. Le percussioni non intonate non hanno estensione.
- **Chiave di basso**: l'estensione vale per la trasposizione principale dello strumento. In una parte in chiave di Fa con una trasposizione in chiave di basso diversa si sposta della differenza tra le due: l'euphonium, scritto da Do3 a Do6 in chiave di violino in Si♭ (−14), in chiave di basso in suoni reali (0) va da Si♭1 a Si♭4.
- **Catalogo**: `InstrumentPlaybackCatalog` aggiunge un'estensione di riferimento a ogni strumento intonato, da verificare con gli archivisti: ottavino Re4–Do7, flauto Do4–Do7, oboe Si♭3–La6, corno inglese Si3–Sol6, fagotto Si♭1–Mi5, clarinetto piccolo Mi3–Sol6, clarinetto Mi3–Do7, clarinetti contralto e basso Mi♭3–Sol6, sassofoni Si♭3–Fa6 (il baritono da La3), trombe, cornette e flicorni sopranino, soprano, contralto e tenore Fa♯3–Do6, flicorni baritono e basso Do3–Do6, corno Fa♯2–Do6, trombone Mi2–Fa5, basso tuba Re1–Fa4, glockenspiel Sol3–Do6, vibrafono Fa3–Fa6, xilofono Fa3–Do7, timpani Re2–La3.
- **Proposta**: **Proponi dal nome** nel dettaglio dello strumento propone anche l'estensione (`GET /api/instruments/playback-suggestion`), mostrata con i nomi delle note; si conferma salvando lo strumento.
- **Strumenti esistenti**: una migrazione compila l'estensione degli strumenti riconosciuti dal nome, come per suono e trasposizione, solo se vuota e solo se la trasposizione salvata coincide con quella del catalogo, così l'estensione si riferisce alla stessa notazione. Gli altri restano senza estensione finché il tenant non la sceglie.
- **Uso**: la proposta dell'ottava e l'avviso della [derivazione](#parte-ricavata-da-unaltra), e i controlli degli editor di scrittura e di correzione per le parti con un solo strumento (vedi [Interfaccia utente](#interfaccia-utente)). Una nota fuori estensione è un avviso e non un errore: la versione si salva e si impagina.

### Passaggi: selezione, copia e trasposizione

- **Selezione**: `Maiusc`+clic o `Maiusc`+`←` `→` selezionano un passaggio dalla nota selezionata, nella sua voce; gli estremi cadono sugli elementi della voce e i gruppi irregolari entrano interi. Un passaggio che copre battute intere vale per tutte le loro voci, come in MuseScore. `Ctrl`+`A` seleziona tutta la parte, `Esc` toglie la selezione. Senza un passaggio, i comandi valgono per la nota selezionata.
- **Appunti**: **Copia** e **Taglia** mettono il passaggio negli appunti dell'editor, che restano finché la pagina è aperta e non toccano quelli del sistema; **Taglia** trasforma il passaggio in pause. **Incolla** scrive al cursore durante l'inserimento, altrimenti dall'inizio della selezione, al posto di ciò che c'è per tutta la lunghezza del passaggio, divide e lega le note oltre le stanghette e aggiunge battute alla fine se serve. Le battute intere si incollano dall'inizio della battuta, con le loro voci, e svuotano le altre voci della destinazione.
- **Altre parti**: si incolla anche in un'altra parte o in un altro brano, con l'altezza scritta, alterazioni comprese: nell'armatura di arrivo l'editor scrive gli accidenti che servono, per esempio il diesis di un Fa♯ copiato da Sol maggiore e incollato in Do maggiore.
- **Ripeti** (`R`) incolla il passaggio subito dopo di lui; ripetendo battute intere alla fine della parte si aggiunge una battuta.
- **Cancella** (`Canc`) trasforma il passaggio in pause: una voce oltre la prima rimasta solo di pause si toglie, e la prima voce di una battuta rimasta solo di pause torna una pausa di battuta.
- **Cosa si copia**: note, accordi, pause, abbellimenti, articolazioni, corone, gruppi irregolari interi (terzina, quintina e sestina di una figura senza punti), le dinamiche e i testi di espressione scritti prima delle note. Legature di portamento e forcelle si copiano solo con entrambi gli estremi nel passaggio; le legature di valore solo verso una nota del passaggio. Gli altri segni della battuta (lettere di prova, tempi, segni di struttura, interruzioni) restano dove sono.
- **Trasposizione**: nella scheda **Passaggio** si sceglie l'intervallo, dall'unisono aumentato all'ottava con la grafia di arrivo (la seconda minore porta Do a Re♭), verso l'alto o verso il basso, per la selezione o per tutta la parte, che traspone anche le armature. Un'armatura di arrivo con più di sette alterazioni, o una nota con più di due, si rifiuta con l'invito a scegliere l'intervallo enarmonico. `↑` `↓` spostano il passaggio di un grado nella tonalità, con `Ctrl` di un'ottava; le note legate a quelle del passaggio si spostano con loro.
- **Altezze conservate**: incollando, cancellando e trasponendo, le note non toccate della battuta conservano la loro altezza, e l'editor scrive gli accidenti che servono, per esempio un bequadro dopo un Fa diventato Fa♯.
- **Passaggi rifiutati**: incollare o cancellare solo una parte di un gruppo irregolare, e incollare un gruppo che non entra nella battuta di arrivo.

### Segni di espressione e impaginazione

I segni non cambiano le durate: si scrivono anche nella correzione, tranne le interruzioni, che solo la scrittura disegna.

- **Legatura di portamento** (`S`): sul passaggio va dalla sua prima alla sua ultima nota, nella voce del passaggio, saltando le pause agli estremi; su una nota va alla nota seguente della voce, da un abbellimento all'elemento seguente. La stessa legatura si toglie, e su una nota che inizia o finisce una legatura si tolgono le sue. Una legatura dentro un'altra prende il numero libero più basso.
- **Forcelle** (`<` crescendo, `>` diminuendo): dal primo all'ultimo elemento del passaggio, pause comprese, oppure dalla nota all'elemento seguente della voce, anche nella battuta dopo. Sono due direzioni scritte prima delle note di inizio e di fine, che le portano con sé come le dinamiche; la stessa forcella si toglie, quella opposta cambia verso. **Togli** elimina legature di portamento e forcelle con un estremo nella nota o nel passaggio.
- **Sempre intere**: nella scrittura, dopo ogni modifica, legature di portamento e forcelle rimaste senza inizio o senza fine si tolgono, per esempio quando la nota dove finivano diventa una pausa. Riscrivendo una nota con un'altra figura la legatura resta sul suo primo pezzo.
- **Corona** su note, accordi e pause; **Respiro** tra le articolazioni, dopo la nota.
- **Abbellimenti**: **Acciaccatura** (barrata) e **Appoggiatura** aggiungono prima della nota una croma della stessa altezza, selezionata per spostarla con le frecce e cambiarne la figura; su un abbellimento selezionato i due comandi ne cambiano il tipo, `Canc` lo toglie. Gli abbellimenti non diventano pause, non si legano di valore e non entrano nei gruppi irregolari.
- **Testo di espressione**: in corsivo prima della nota, con proposte («dolce», «espress.», «rit.», «a tempo», «solo»…) e testo libero fino a 60 caratteri; le indicazioni di tempo e di chi suona vanno sopra il rigo, le altre sotto. Ogni nota ha un testo, che appartiene a lei come le dinamiche.
- **Lettere di prova**: all'inizio della battuta, con la lettera seguente proposta (A, B… Z, poi AA, BB) o il numero della battuta come numero di riferimento.
- **Tempo con testo**: «Allegro» accanto al metronomo, in grassetto; il testo accompagna sempre le semiminime al minuto, che servono all'ascolto. Un'indicazione senza metronomo si scrive come testo di espressione.
- **Interruzioni**: la battuta selezionata può iniziare una nuova riga o una nuova pagina, e **Battute per riga** mette una nuova riga ogni tante battute in tutta la parte, contate dall'inizio e da ogni nuova pagina, al posto delle interruzioni di riga che c'erano. Le interruzioni restano nel MusicXML per l'impaginazione e per MuseScore; la scrittura le disegna, con la nuova pagina mostrata come nuova riga perché lo spartito scorre, mentre correzione e lettore seguono la larghezza dello schermo.

### Partitura e arrangiamento

Una traccia ha al più una partitura: tutte le parti in sistemi, scritta in suoni reali o trasposta, da cui si estraggono le parti. La scheda **Partitura** del dettaglio della traccia la mostra a chi gestisce la traccia, con la scrittura attiva; soci ed esterni continuano ad ascoltare le parti, anche tutte insieme con **Ascolta la partitura** della scheda Ascolto. L'impaginazione della partitura intera non fa parte della fase 4: la partitura si scarica in MusicXML per MuseScore.

#### Nuova partitura

1. Nella scheda **Partitura** di una traccia senza partitura si sceglie **Nuova partitura**, dall'[organico della banda](#organico-della-banda) o dalle parti della traccia. Il dialogo propone, come per la nuova parte da zero, metro, armatura in suoni reali, battute, levare e tempo, e la notazione: **Trasposta**, come le parti, o **In suoni reali**.
2. **Dall'organico**: un rigo per ogni strumento intonato dell'organico, nel suo ordine, con il nome dello strumento, e un rigo solo, «Percussioni», per tutti gli strumenti a percussione, al posto del primo. Gli strumenti si scelgono dal catalogo, proposti dall'organico; quelli fuori dall'organico vanno dopo. Senza organico si scelgono uno per uno, e il dialogo offre **Apri l'organico**, che lo chiude e apre la scheda Organico.
3. **Dalle parti della traccia**: il dialogo elenca le parti con una versione corrente, tutte scelte, e conta quelle senza note, che non diventano righi. Per una parte intonata con più strumenti si sceglie lo strumento del suo rigo, proposto il primo intonato, e una parte senza strumenti lo sceglie dal catalogo; una parte di percussione tiene tutti i suoi strumenti, una voce per strumento come nelle parti. La parte di riferimento, proposta come nell'ascolto, dà il numero di battute e la struttura: ritornelli, volte, segni e salti, cambi di metro e di tempo, lettere di prova.
4. Le battute si allineano per posizione. Prima di creare la partitura il dialogo dice, per ogni parte che non coincide con quella di riferimento, che cosa cambierà: «4 battute in meno, completate con pause», «2 battute in più, tolte», «Ritornelli diversi: si usano quelli della parte di riferimento», per ritornelli e volte, «Segni, salti, tempo o lettere di prova diversi: si usano quelli della parte di riferimento», «Metro diverso nelle battute 12 e 13». Le armature restano quelle di ogni parte, convertite se la notazione scelta è in suoni reali.
5. I righi seguono l'ordine dell'organico; i righi di strumenti fuori dall'organico vengono dopo, nell'ordine delle parti della traccia. Ogni rigo creato da una parte resta collegato a lei, così l'estrazione la aggiorna.
6. **Crea e scrivi** crea la partitura con la prima bozza e apre l'editor. La partitura non cambia la traccia e non tocca le parti.

#### Editor della partitura

- È lo stesso editor a schermo intero della scrittura, con le stesse schede e scorciatoie, su un documento con più parti: i sistemi mostrano tutti i righi, con il nome del rigo a sinistra.
- Cursore, selezione e passaggi stanno in un rigo; `Alt` + `↑` `↓` passa al rigo visibile sopra o sotto, alla stessa battuta, e un clic su una nota o su un pentagramma rende attivo il suo rigo. Nella scheda **Righi**, **Tutti i righi** copia, incolla e cancella le battute selezionate di tutti i righi insieme; si incollano in una partitura con gli stessi righi.
- Inserire o togliere battute e cambiare metro, ritornelli, volte, salti, tempo e lettere di prova vale per tutti i righi, come in MuseScore. Chiave e armatura valgono per il rigo; **Tonalità in suoni reali**, nella scheda Battuta, cambia dalla battuta selezionata l'armatura di ogni rigo secondo la sua trasposizione, lasciando le percussioni, mentre **Armatura del rigo** cambia solo quella del rigo attivo. La pausa di più battute non c'è nella partitura.
- Il pannello **Righi** elenca i righi con i loro strumenti e rende attivo quello scelto: **Mostra** e **Nascondi** per lavorare su alcuni, con almeno un rigo visibile, e **Comprimi i righi vuoti** per togliere dai sistemi i righi con sole pause. Nella scheda **Righi**, **Aggiungi sotto** mette sotto il rigo attivo un rigo di pause per uno strumento del catalogo, con la struttura della partitura e l'armatura scritta per lo strumento, e **Togli il rigo attivo** lo toglie con conferma, finché ne resta un altro; entrambi si annullano con **Annulla**. I righi nascosti restano nel documento, nell'ascolto e nell'estrazione, e i segni della struttura si disegnano solo sul primo rigo mostrato.
- **Ascolto**: dal punto selezionato, la battuta o le battute scelte, suonano tutti i righi, anche quelli nascosti nel disegno, ognuno con il suono del suo strumento; il rigo scelto con **In evidenza** nel pannello Righi suona a volume pieno e gli altri più piano, anche mentre l'ascolto è in corso. In una partitura in suoni reali l'ascolto, le note suonate e l'estensione seguono la notazione: della trasposizione dello strumento resta l'ottava, e il sax tenore suona un'ottava sotto lo scritto.
- **Controlli dei righi**: per ogni rigo con un problema, il nome e i numeri delle battute di durata diversa dal metro, vuote o con note fuori dall'estensione dello strumento («Clarinetto 2°» con 14 e 15); il pulsante della battuta rende attivo il rigo, mostrandolo se è nascosto, e seleziona la battuta o la prima nota fuori estensione. L'estensione vale per i righi con un solo strumento intonato, segue la chiave iniziale del rigo e in suoni reali si sposta con le note.
- **Salva** crea una versione della partitura, **Salva e approva** la crea approvata. Bozze automatiche, copia nel browser e blocco funzionano come per le parti, con la partitura come bersaglio: chi scrive la partitura non blocca le parti, e chi corregge una parte non blocca la partitura.
- La cronologia di Annulla e Ripristina registra le battute cambiate di tutti i righi, prima e dopo, invece di una copia del documento; le operazioni che cambiano i righi o tutta la partitura, come la conversione della notazione, registrano il documento intero.

#### Suoni reali e trasposizione

- La partitura è scritta in una delle due notazioni. Quella in suoni reali è segnata nel MusicXML con `<concert-score/>`, come prevede MusicXML 4.0 e come legge MuseScore.
- **Suoni reali** e **Trasposta**, nella barra superiore, convertono tutta la partitura: ogni rigo si traspone con l'intervallo del suo strumento senza le ottave, che una partitura in suoni reali conserva (il sax tenore scende di una seconda, non di una nona), calcolato come nella [derivazione](#intervallo-della-derivazione) e con la trasposizione in chiave di basso per i righi che iniziano in chiave di Fa, e la scrittura continua nella notazione scelta. La conversione è un solo passo di Annulla; i righi di percussione e quelli degli strumenti in Do non cambiano. Tutti i righi si controllano prima di trasporne uno, così una conversione impossibile, per uno strumento non configurato o per note che uscirebbero dalle altezze scrivibili, lascia la partitura com'era.
- Un rigo con uno strumento senza trasposizione blocca la conversione, con il nome dello strumento («Configura la trasposizione di Corno per convertire la partitura») e il collegamento **Configura Corno**, che apre lo strumento in un'altra scheda per non lasciare la partitura aperta; la scheda Partitura è solo per chi gestisce la traccia, che gestisce anche gli strumenti.
- Quando un rigo usa l'intervallo enarmonico, perché l'armatura avrebbe più di sette alterazioni, la conversione lo dice («Partitura trasposta; Clarinetto usa l'intervallo enarmonico: tornando indietro la grafia può cambiare»): tornando alla notazione di prima, la grafia di quel rigo può non essere identica.

#### Estrazione delle parti

1. **Estrai le parti** apre, sulla versione corrente della partitura, l'elenco dei righi con la parte della traccia che riceverà la nuova versione e il suo stato. Una bozza non salvata non si estrae, e il dialogo lo ricorda.
   - **Nuova**: il rigo non ha una parte; se ne crea una in fondo alla traccia, senza pagine, con il nome del rigo.
   - **Da estrarre**: la parte non è mai stata estratta da questa partitura, oppure la partitura ha una versione più recente dell'ultima estrazione.
   - **Aggiornata**: la versione corrente della parte è quella estratta dalla versione corrente della partitura.
   - **Modificata dopo l'estrazione**: la parte ha una versione più recente di quella estratta, per esempio una correzione.
2. Riceve la versione solo una parte con gli stessi strumenti del rigo: lo strumento del rigo come unico strumento, o tutti gli strumenti di un rigo di percussione. Un rigo collegato a una parte usa quella; per gli altri Taurus propone l'unica parte con gli stessi strumenti non collegata a un altro rigo, se c'è, altrimenti una parte nuova. Si può scegliere un'altra parte con gli stessi strumenti o **Parte nuova**.
3. Sono scelti i righi nuovi e da estrarre. I righi aggiornati e quelli con la parte modificata dopo l'estrazione si scelgono a mano, parte per parte, perché l'estrazione sostituisce la versione corrente. In una partitura in suoni reali un rigo con uno strumento senza trasposizione non si può scegliere e lo spiega; una parte bloccata da un'altra persona non si può scegliere finché il blocco non si libera.
4. **Estrai** costruisce nel browser il MusicXML di ogni parte: le battute del rigo con la struttura comune, il nome della parte, il titolo, il compositore e l'arrangiatore della traccia, che sostituiscono quelli della partitura quando non sono vuoti, e, in una partitura in suoni reali, la trasposizione per lo strumento con lo stesso codice della conversione. Le interruzioni di riga e di pagina della partitura, pensate per i suoi sistemi, non passano alle parti, che vanno a capo da sole come nella scrittura. Il backend controlla righi e parti e crea in una transazione le parti nuove e le versioni con origine `ARRANGEMENT`, approvate se lo è la versione della partitura; le bozze delle parti aggiornate risultano superate, come dopo una correzione.
5. Al termine il dialogo elenca le parti estratte, con «Parte nuova, senza pagine» o «Senza pagine», e offre **Impagina le parti**; senza il servizio musicale ricorda che le parti si leggono e si ascoltano subito, ma non compaiono in anteprima, in presentazione né in stampa finché non si impaginano.
   - **Opzioni**: un solo dialogo di opzioni, con l'anteprima della prima parte, avvia un'impaginazione per ogni parte, una dopo l'altra e ognuna con il nome della sua parte nell'intestazione, poi segue lo stato di tutte; il dialogo si può chiudere e le impaginazioni continuano. Una parte già in impaginazione si segue senza avviarne un'altra, mentre un altro errore ferma l'avvio delle parti seguenti.
   - **Assegnazione**: le pagine di una parte ancora senza pagine al termine del job le sono assegnate; quelle di una parte che ha già pagine aspettano, e la scheda Ascolto mostra «Pagine da assegnare», che apre l'impaginazione di quella versione per sostituirle o aggiungerle in una parte nuova.

#### Divergenze

- Nella scheda **Partitura** ogni rigo riporta lo stato della sua parte, come nell'estrazione; un rigo la cui parte è stata eliminata riporta «Parte eliminata» e alla prossima estrazione crea una parte nuova.
- Nella scheda **Ascolto**, per chi gestisce la traccia, una parte estratta ha l'etichetta «Estratta dalla partitura (versione 4)»; se la partitura ha una versione più recente compare «La partitura è cambiata», e se la parte è stata corretta dopo l'estrazione «Modificata dopo l'estrazione». Una parte estratta non si aggiorna da sola: si estrae di nuovo o si corregge.
- La partitura si elimina dalla scheda Partitura, con conferma: le parti restano, con le loro versioni, e perdono il collegamento ai righi.

### Bozza e ripresa

- La bozza si salva pochi secondi dopo l'ultima modifica e comunque ogni 30 secondi durante la scrittura; una copia resta nel browser se la rete manca, e viene inviata al ritorno della connessione.
- Riaprendo l'editor con una bozza, l'editor mostra al posto dello spartito chi l'ha salvata, con data e ora, e lascia riprenderla oppure scartarla e aprire la versione corrente; scartare chiede conferma. La scelta è nell'editor e non in un dialogo di conferma, così `Esc` non scarta mai una bozza. **Riprendi la bozza** nella scheda Ascolto la riprende senza chiedere; una parte senza versioni riprende sempre la bozza.
- Chiudendo l'editor la bozza si salva subito; se il server non risponde, l'editor avvisa che le ultime modifiche restano nel browser e si riprendono riaprendo la parte.
- Se la bozza è stata cambiata in un'altra finestra (`scoreWriting.draftConflict`), l'editor offre **Tieni le mie modifiche**, che sostituisce la bozza salvata, e **Carica l'altra bozza**.
- Se nel frattempo è stata salvata un'altra versione della stessa parte, la ripresa lo segnala: salvando, la bozza diventa comunque la versione corrente, dopo una conferma esplicita. Non c'è unione automatica.
- **Salva** e **Salva e approva** eliminano la bozza; eliminare la parte o la partitura elimina anche la sua bozza. Le bozze non scadono: decide chi riapre l'editor, riprendendole o scartandole. La scheda Ascolto mostra le parti con una bozza («Bozza non salvata di Mario Rossi, 14/11/2026 10:32»), con **Riprendi la bozza** e **Scarta la bozza** per chi gestisce la traccia; **Scarta la bozza** chiede conferma ed è disattivato mentre qualcuno scrive la parte.

### Copia nel browser rifiutata

La copia nel browser non si elimina mai per un rifiuto del server: si elimina solo quando il server la accetta, quando l'utente la scarta o quando la parte o la partitura non esiste più. Vive solo nel browser in cui è stata fatta.

1. Al ritorno della connessione il server rifiuta la copia se il blocco è passato a un altro (`scoreWriting.locked`).
2. L'editor lo dice, per esempio «Le modifiche fatte senza connessione dalle 10:32 alle 10:41 non sono state salvate: ora sta scrivendo Mario Rossi», e offre **Scarica MusicXML**, **Tienila per dopo** e **Scarta**.
3. Quando lo stesso utente riapre l'editor sulla stessa parte o partitura e il blocco è libero, Taurus propone la copia come una bozza da riprendere, con data e ora, prima di un'eventuale bozza sul server. Se sul server c'è una bozza o una versione più recente, lo dice e il comando diventa **Riprendi e sostituisci**. Una copia uguale alla bozza sul server si elimina senza chiedere.
4. Il MusicXML scaricato da una parte si può anche ricaricare con il caricamento esistente, che crea una nuova versione.

### Blocco e presa di controllo

- Chi apre l'editor, di scrittura o di correzione, prende il blocco; un altro utente vede «In modifica da Mario Rossi dalle 10:32» e apre l'editor in sola lettura. Il blocco della parte è lo stesso nei due editor: chi corregge esclude chi scrive e viceversa.
- L'editor rinnova il blocco ogni 30 secondi; il blocco scade da solo dopo due minuti senza rinnovi, per esempio se il browser si chiude.
- **Prendi il controllo**, dopo una conferma, passa il blocco: l'editor dell'altro diventa di sola lettura e lo avvisa; la sua bozza resta disponibile a chi riprende.
- Bozza e salvataggio di una versione, scritta o corretta, sono accettati solo da chi possiede il blocco, oppure da chi lo riprende perché è scaduto e nessun altro l'ha preso. Negli altri casi rispondono `scoreWriting.locked`: chi ha perso il controllo non sovrascrive la bozza né crea una versione.

### Impaginazione

1. Da una versione l'archivista sceglie **Impagina**: formato (A4 verticale, A4 orizzontale, formato marcia di 18 × 13 cm in orizzontale), dimensione del rigo, margini, intestazione (titolo della traccia, compositore, arrangiatore, nome della parte), numerazione delle pagine e numeri di battuta.
   - **Valori proposti**: rigo di 7 mm e margini di 12 mm in A4, rigo di 5,6 mm e margini di 8 mm nel formato marcia; il rigo va da 4 a 9,6 mm e i margini da 3 a 30 mm.
   - **Intestazione**: solo sulla prima pagina, con il nome della parte in grassetto a sinistra, il titolo al centro e compositore e arrangiatore a destra, uno sotto l'altro. I testi sono proposti dalla traccia e dalla parte e si possono cambiare; un testo vuoto non compare, e senza testi la musica inizia in alto. Il nome della parte non si ripete a sinistra dei righi, e un'intestazione già presente nel MusicXML, per esempio di una parte importata da MuseScore, è sostituita.
   - **Numeri di pagina**: dalla seconda pagina, al centro sotto la musica, in una fascia lasciata libera sopra il margine inferiore.
   - **Numeri di battuta**: all'inizio di ogni rigo (proposto), su ogni battuta per le [parti di studio](#estensioni-approvate) o nessuno.
   - **Righe e pagine**: le interruzioni di riga della parte restano, come nella scrittura, e una riga piena va a capo da sola; un'interruzione di pagina inizia una pagina nuova, che ripete chiave, armatura e tempo.
2. Il browser mostra subito un'anteprima con Verovio, ridisegnata a ogni cambio delle opzioni: stesse opzioni, stessa intestazione e stesse sezioni tra le interruzioni di pagina del servizio, così le pagine dell'anteprima coincidono con quelle generate. L'anteprima segnala una parte oltre le 30 pagine, che il servizio rifiuterebbe; le scelte dell'ultima impaginazione della versione tornano come valori proposti.
3. **Genera pagine** avvia un job: il servizio musicale produce le pagine PNG a 300 DPI e il PDF. Una parte ha una sola impaginazione in coda o in corso alla volta; il PDF si scarica appena il job termina, anche prima di assegnare le pagine. Il dialogo legge lo stato ogni 3 secondi e si può chiudere: riaperto sulla stessa versione, riprende dal job, e un job non riuscito ne mostra il motivo sopra le opzioni.
4. Al termine Taurus mostra le miniature delle pagine e chiede se **sostituire le pagine** della parte o **aggiungerle in una parte nuova**, con la stessa descrizione e gli stessi strumenti; per una parte scritta da zero, senza pagine, offre solo **Aggiungi le pagine alla parte**. Le pagine sostituite seguono le regole delle pagine tolte da una parte: il file si elimina quando nessun'altra parte lo usa.
   - **Pagine non assegnate**: restano con il job finché l'archivista non sceglie. La scheda Ascolto le segnala a chi gestisce la traccia con «Pagine da assegnare» sulla parte, che riapre l'impaginazione della versione da cui derivano. Una nuova impaginazione della stessa parte le sostituisce, e la pulizia notturna le elimina, con il loro PDF, dopo 7 giorni o quando la parte viene eliminata.
   - **PDF**: resta scaricabile finché la parte non riceve altre pagine impaginate; quello delle pagine sostituite si elimina con esse.
5. Pagine e PDF ricordano la versione da cui derivano: la scheda Ascolto segnala con «Pagine non aggiornate» quando la versione ascoltata è più recente delle pagine, e **Impagina** propone di impaginare di nuovo. Il legame vale finché la parte conserva le pagine assegnate: se le pagine cambiano a mano, la parte non risulta più impaginata da una versione.

### Parti da impaginare

Una parte scritta o ricavata non ha pagine finché non viene impaginata. Non si genera nulla da sola: la segnalazione guida chi gestisce a impaginarla.

- **Workspace Parti**: l'icona «Da impaginare» nell'elenco e, nel dettaglio della parte, l'avviso «Parte da impaginare» con **Impagina**, attivo con la traccia salvata. Una parte da impaginare è una parte salvata con una versione e senza pagine.
- **Scheda Ascolto**: l'etichetta «Da impaginare», o «Pagine non aggiornate», e **Impagina** per ogni parte con una versione, con la scrittura attiva e il servizio musicale configurato.
- **Anteprima e presentazione**: al posto dell'avviso generico «Nessuna pagina da mostrare», «Parte scritta non ancora impaginata» («Parti scritte non ancora impaginate»), che indica **Impagina** a chi gestisce la traccia e la scheda Ascolto ai soci.
- **Stampa**: la parte è esclusa dalla stampa, con il conteggio sotto il titolo dell'anteprima, che segue le parti scelte nei filtri («2 parti da impaginare non stampate»).
- **Preparazione degli eventi**: tra gli spartiti di un brano del programma la parte è «Da impaginare», e chi compone il programma ha **Impagina**, che apre la scheda Ascolto della traccia. La criticità degli spartiti la conta a parte («Nessuno spartito pronto: 1 da impaginare»), e la [stampa della scaletta](#stampa-della-scaletta) la esclude e la conta come l'anteprima.
- **Soci**: leggono e ascoltano la parte nella scheda Ascolto, con le regole di visibilità dell'ascolto.

### Stampa della scaletta

È l'[impaginazione per l'evento](#estensioni-approvate): dal programma di un evento, **Stampa la scaletta** apre l'anteprima con le parti già impaginate di tutti i brani, per strumento e nel formato marcia. Taurus non genera pagine né PDF per l'evento: la stampa usa le pagine delle parti, e un PDF unico si ottiene con la stampa del browser.

- **Parti**: quelle che la preparazione mostra a chi stampa, cioè tutte le parti dei brani a chi compone il programma e le sole parti pronte dei propri strumenti a soci ed esterni. Un brano ripetuto, per esempio come bis, si stampa una volta, e una traccia non più nel catalogo non ha parti. Si stampa il programma salvato: con modifiche in corso il comando è disattivato con «Salva il programma prima di stamparlo», e senza pagine da stampare lo dice.
- **Ordine**: per strumento, nell'ordine in cui gli strumenti compaiono nelle parti dei brani, e per ogni strumento nell'ordine della scaletta. Una parte con più strumenti si stampa una volta, sotto il primo strumento scelto. I filtri scelgono gli strumenti da stampare, come per tracce e album.
- **Formato marcia**: l'anteprima propone «2 · formato marcia», cioè due pagine di 18 × 13 cm a grandezza reale su un A4 verticale, con una linea di taglio tratteggiata attorno a ogni pagina, e le pagine impaginate nel formato marcia riempiono il riquadro. Una pagina di un altro formato, per esempio una scansione A4, si riduce per entrare nel riquadro, e l'anteprima lo segnala («1 pagina non in formato marcia, ridotta in stampa»). Restano disponibili «1» e «2 · automatico», e il formato marcia si può scegliere anche per tracce e album.
- **Parti da impaginare**: restano fuori dalla stampa, e il titolo dell'anteprima le conta come per una traccia.
- **Disponibilità**: la stampa della scaletta non dipende da `SCORE_WRITING`, perché usa le pagine che le parti hanno già.

### Organico della banda

L'organico è l'elenco ordinato degli strumenti che suonano abitualmente nella banda del tenant.

- **Dato**: il nuovo campo facoltativo `ensemble_position` dello strumento, da 1 in su senza buchi; vuoto, lo strumento non fa parte dell'organico. Uno strumento eliminato esce dall'organico e gli altri si ricompattano. La posizione si cambia solo dalla scheda Organico: il salvataggio di uno strumento non la tocca.
- **Modifica**: la scheda **Organico** della pagina degli strumenti, per chi gestisce gli strumenti, mostra gli strumenti dell'organico in ordine, da spostare con il trascinamento o, da tastiera, con **Su** e **Giù**, e da togliere con **Togli**. **Aggiungi** sceglie tra gli strumenti fuori dall'organico e mette lo strumento al posto della sua famiglia: dopo l'ultimo strumento che lo precede nell'ordine di riferimento o, se non ce n'è, prima del primo che il catalogo colloca; uno strumento che il catalogo non colloca va in fondo. **Salva** salva l'ordine e **Annulla le modifiche** torna a quello salvato; uscendo dalla pagina, o chiudendo il browser, con modifiche non salvate si chiede conferma. Se nel frattempo un'altra persona ha cambiato l'organico, o uno strumento scelto è stato eliminato, la scheda lo dice e offre **Ricarica l'organico**.
- **Ordine di riferimento**: il catalogo di riferimento degli strumenti (`InstrumentPlaybackCatalog`) aggiunge la famiglia e la posizione nella famiglia. **Proponi l'ordine di riferimento** riordina gli strumenti della scheda o, con l'organico vuoto, vi mette tutti gli strumenti del tenant, da togliere poi uno per uno; nessun dato cambia finché non si salva. Le famiglie seguono l'ordine: legni (ottavino, flauti, oboi, corno inglese, fagotti, clarinetti dal piccolo al basso), sassofoni, corni, trombe e cornette, flicorni dal sopranino al baritono ed euphonium, tromboni, flicorni bassi e bassi, timpani e percussioni intonate, percussioni. Dentro una voce del catalogo gli strumenti si raggruppano per la parola riconosciuta, nell'ordine del catalogo («Tromba» prima di «Cornetta», «Flicorno baritono» prima di «Euphonium»), e gli strumenti numerati («Flauto 1°», «Clarinetto II», «Primo corno») seguono il numero, prima quello senza numero; a parità resta l'ordine attuale. Gli strumenti che il catalogo non colloca, come arpa, chitarra, pianoforte o voce, vanno in fondo nell'ordine attuale.
- **Uso**: nuova partitura dall'organico, ordine dei righi della partitura dalle parti esistenti, ordine delle parti nell'anteprima e in stampa. Nell'anteprima di una traccia, e di ogni brano di un album, le parti seguono il primo dei loro strumenti nell'organico, e i filtri degli strumenti seguono lo stesso ordine; nella stampa della scaletta gli strumenti seguono l'organico e, per ognuno, l'ordine della scaletta. Le parti senza strumenti dell'organico vengono dopo, nell'ordine attuale; senza organico l'anteprima e la stampa non cambiano. L'organico si legge all'apertura dell'anteprima: se la lettura non riesce, l'anteprima si apre nell'ordine attuale, senza avvisi.

### Scaricamento

Nel dialogo **Versioni e suono** della scheda Ascolto, per chi gestisce la traccia, **Scarica** apre un menu con i formati della versione:

- **MusicXML per MuseScore** (`.mxl`): il file compresso della versione, come oggi.
- **MIDI** (`.mid`): costruito nel browser dallo stesso generatore dell'ascolto, con ritornelli e salti eseguiti, il tempo della partitura e il suono e la trasposizione della parte, cioè in suoni reali. Non ha metronomo né battuta di attacco, e una parte di percussione suona sul canale di batteria.
- **PDF delle pagine**: con la scrittura attiva e solo per la versione da cui derivano le pagine della parte. È il PDF dell'ultima impaginazione, lo stesso di **Scarica il PDF** nell'impaginazione.

Nel lettore della partitura, sempre per chi gestisce la traccia, **Scarica MIDI** salva ciò che si sta ascoltando: le parti che si sentono, senza quelle silenziate, con il tempo scelto e con o senza ritornelli, senza metronomo né attacco. Soci ed esterni non scaricano e continuano ad ascoltare nel lettore.

Il backend non converte in MIDI: il file nasce da ciò che si ascolta e suona come il lettore.

## Interfaccia utente

L'editor si apre a schermo intero, come quello di correzione.

- **Barra superiore**: titolo «Scrittura · nome della parte» con lo stato della bozza sotto («Bozza salvata alle 10:41»), annulla e ripristina, ascolto dal punto selezionato, **Tastiera MIDI**, **Salva**, **Salva e approva**, **Impagina**. **Impagina** chiude l'editor e apre l'impaginazione della versione da cui parte la scrittura, quando non ha modifiche; altrimenti è disattivato con «Salva la versione prima di impaginarla».
- **Scheda Nota**: l'interruttore **Inserimento**, la voce del cursore da 1 a 4 e lo spostamento del cursore, poi durata e punti, che durante l'inserimento valgono per le note seguenti. Nella scrittura «Inserisci prima» e «Inserisci dopo» della correzione non compaiono, ed «Elimina» diventa **Cancella**, che trasforma la nota in pausa.
- **Scheda Espressione**: dinamiche; **Crescendo**, **Diminuendo**, **Legatura di portamento** e **Togli**, sulla nota o sul passaggio; articolazioni con **Respiro** e **Corona**; **Acciaccatura** e **Appoggiatura**; il testo di espressione con le proposte. I pulsanti si evidenziano quando la nota selezionata ha già il segno.
- **Scheda Struttura**: ritornelli, volte, segni e salti, la lettera di prova con **Numero di battuta**, il tempo con il suo testo.
- **Scheda Impaginazione**, solo nella scrittura: **Continua**, **Nuova riga** o **Nuova pagina** dalla battuta selezionata, e le battute per riga di tutta la parte.
- **Scheda Passaggio**: **Tutta la parte** e **Togli la selezione**; **Copia**, **Taglia**, **Incolla**, con ciò che è negli appunti, e **Ripeti**; la trasposizione con intervallo, direzione e note da trasporre (la selezione o tutta la parte). Le note del passaggio si colorano sullo spartito e le sue battute si evidenziano; la barra di stato lo descrive («Selezione · battute 3–5 · voce 1 · 12 elementi», «Selezione · battute 3–5 · tutte le voci») e l'ascolto suona le sue battute.
- **Palette laterale** a schede: Note, Battuta (metro, armatura, chiave, battute), Struttura (ritornelli, volte, salti, lettere di prova), Espressione (dinamiche, forcelle, articolazioni, legature, testo), Impaginazione (interruzioni di riga e di pagina). Ogni comando indica la sua scorciatoia.
- **Spartito** al centro, con il cursore di inserimento visibile come una barra verticale colorata nella posizione dove andrà la prossima nota. Le parti lunghe e le partiture, oltre 100 battute contando ogni rigo mostrato, si dividono in pagine alte quanto l'area dello spartito: all'apertura compaiono subito le prime battute, e le pagine definitive arrivano quando è pronta l'impaginazione completa, mentre si scrive. Dopo una modifica la pagina che la contiene si ridisegna subito e le altre si aggiornano poco dopo; se Verovio non riesce a disegnarla compare «Impossibile disegnare lo spartito dopo questa modifica: annullala».
- **Barra di stato**: battuta, tempo nella battuta, voce, nota selezionata letta per esteso («Battuta 12 · tempo 3 · Sib4 · croma puntata»), già annunciata a chi usa uno screen reader; controlli in tempo reale.
- **Tastiera di pianoforte a schermo**, mostrata da sola sui dispositivi touch e a richiesta con **Pianoforte** nella scheda Nota: due ottave dal Do4 in chiave di violino, dal Do3 in chiave di contralto o di tenore e dal Do2 in chiave di basso, da spostare di un'ottava alla volta. Un tocco suona il tasto e lo scrive come una nota della tastiera MIDI: al cursore con la durata corrente durante l'inserimento, al posto dell'altezza della nota selezionata fuori dall'inserimento. Nelle parti di percussione con strumenti mostra un pulsante per strumento, con la sua voce.
- **Scheda Partitura**: senza partitura, **Nuova partitura**; con la partitura, la versione corrente con stato, numero di battute e data, l'eventuale bozza e chi la sta scrivendo, i righi con lo stato della loro parte, e **Scrivi** o **Riprendi la bozza**, **Estrai le parti**, **Ascolta**, **Versioni** (con **Apri**, **Approva** e **Scarica** in MusicXML o MIDI) ed **Elimina la partitura**. **Ascolta** apre il lettore sulla versione corrente, con una riga del mixer per rigo e lo spartito di un rigo alla volta. Sul telefono la scheda mostra lo stato e **Ascolta**, senza i comandi di scrittura.
- **Editor della partitura**: il pannello **Righi** con mostra e nascondi, righi vuoti compressi, aggiunta e rimozione dei righi e il rigo **In evidenza** per l'ascolto; **Suoni reali** e **Trasposta** nella barra superiore.
- **Ricavata da**: nella scheda Ascolto, per chi gestisce la traccia, una parte ricavata ha l'etichetta «Ricavata da Clarinetto 1° (versione 3)». Se la parte di origine ascolta ora un'altra versione compare l'avviso «La parte di origine è cambiata», con la versione attuale nel suggerimento; se la parte di origine è stata eliminata l'etichetta diventa «Ricavata da una parte eliminata». Una parte ricavata non si aggiorna da sola: si corregge o si ricava di nuovo. Le parti estratte dalla partitura hanno le etichette descritte in [Divergenze](#divergenze).
- **Controlli**: nel pannello Controlli degli editor di scrittura e di correzione, per una parte con un solo strumento, senza una trasposizione propria e con l'estensione configurata, «Note fuori estensione di Sax contralto (Si♭3–Fa6):» con i numeri delle battute, come per le battute di durata diversa dal metro, oppure «Tutte le note nell'estensione di Sax contralto (Si♭3–Fa6)»; il pulsante seleziona la prima nota fuori estensione della battuta. L'estensione segue la chiave iniziale della parte, come nella derivazione.
- **Scheda Ascolto**: **Nuova parte scritta**, e per ogni parte **Scrivi** oppure, con una bozza, l'etichetta «Bozza non salvata di …» con **Riprendi la bozza** e **Scarta la bozza**; per le parti con una versione **Ricava una parte**. I comandi stanno accanto a **Correggi** e alle versioni, che sono già nella scheda Ascolto, e sono disattivati finché la traccia ha modifiche da salvare.
- **Strumenti**: nella sezione Ascolto del dettaglio di uno strumento intonato, **Nota più grave** e **Nota più acuta**, scelte per nome («Mi3»), proposte con suono e trasposizione da **Proponi dal nome**. La pagina degli strumenti ha la scheda **Organico** descritta in [Organico della banda](#organico-della-banda).
- **Workspace Parti**: l'etichetta «Da impaginare», con **Impagina**.
- **Programma dell'evento**: l'etichetta «Da impaginare» e **Impagina** tra gli spartiti di ogni brano, e **Stampa la scaletta** sopra la scaletta.
- **Impagina**: un dialogo con le opzioni a sinistra e l'anteprima delle pagine a destra, una sotto l'altra sul telefono; durante il job lo stato, al termine le miniature con le scelte di assegnazione, **Scarica il PDF** e **Impagina di nuovo**. Per le parti estratte lo stesso dialogo impagina più parti e mostra lo stato di ognuna.

### Scorciatoie principali

| Tasto | Azione |
| --- | --- |
| `N` | entra ed esce dalla modalità di inserimento |
| `A`–`G` | inserisce la nota all'ottava più vicina alla precedente |
| `1`–`7` | durata da semibiscroma a semibreve, come in MuseScore |
| `.` | punto di valore |
| `0` | pausa della durata corrente |
| `Maiusc` + `A`–`G` | aggiunge la nota all'accordo |
| `↑` `↓` | un grado; con `Ctrl` un'ottava; un passaggio selezionato si sposta tutto |
| `+` `-` `=` | diesis, bemolle, bequadro; sulle ultime note suonate correggono la grafia senza cambiarne il suono |
| `T` | legatura di valore con la nota seguente; durante l'inserimento scrive al cursore la nota precedente, legata a lei |
| `Canc` | elimina la nota, che diventa pausa nella scrittura, o trasforma in pause il passaggio selezionato; durante l'inserimento il cursore torna al suo posto |
| `←` `→` | nota precedente o seguente; durante l'inserimento spostano il cursore |
| `Esc` | esce dalla modalità di inserimento; fuori dall'inserimento toglie la selezione del passaggio |
| `Maiusc` + clic, `Maiusc` + `←` `→` | seleziona un passaggio dalla nota selezionata |
| `Ctrl` + `A` | seleziona tutta la parte |
| `S` | legatura di portamento sulla selezione o fino alla nota seguente; sulla nota legata la toglie |
| `<` `>` | forcella di crescendo o di diminuendo sulla selezione o fino all'elemento seguente |
| `Alt` + `3` | terzina al cursore, lunga quanto la durata corrente (con `5`, `6` gli altri gruppi irregolari) |
| `Ctrl` + `Alt` + `1`–`4` | voce attiva |
| `Alt` + `↑` `↓` | nella partitura, rigo sopra o sotto, alla stessa posizione |
| `Ctrl` + `C`, `X`, `V` | copia, taglia, incolla, anche in un'altra parte |
| `R` | ripete la selezione, o la nota, subito dopo di lei |
| `Ctrl` + `Z`, `Y` | annulla, ripristina |
| `Spazio` | ascolta dalla selezione o ferma |

Le scorciatoie della tabella che esistono già nell'editor di correzione mantengono lo stesso significato. Voci e gruppi irregolari non usano `Ctrl` + cifra, che nei browser passa da una scheda all'altra e non si può intercettare in modo affidabile: le voci usano `Ctrl` + `Alt`, i gruppi `Alt`, letti dal tasto fisico così da valere con qualsiasi disposizione della tastiera.

### Tastiera MIDI

- **Collegamento**: **Tastiera MIDI** nella barra superiore chiede al browser, la prima volta, il permesso di usare i dispositivi MIDI, poi elenca le tastiere collegate e usa quella scelta, ricordandola nel browser. Una tastiera collegata con l'editor già aperto compare da sola nell'elenco; se la tastiera in uso si scollega, l'editor passa alla prima delle altre e torna a quella scelta quando si ricollega. Lo stesso pannello regola la soglia dell'accordo, tra 30 e 200 ms, ricordata nel browser insieme alla tastiera. Il comando si evidenzia quando una tastiera è in uso; se il browser rifiuta il permesso, il pannello lo dice e offre **Riprova**.
- **Inserimento**: in modalità di inserimento ogni nota suonata si scrive al cursore con la durata corrente e il cursore avanza. La durata si cambia con i tasti 1–7 del computer o con la palette, come in MuseScore.
- **Accordi**: una nota entra nell'accordo se arriva entro la soglia, 80 ms per default, dalla prima nota del gruppo e mentre la prima è ancora premuta. La prima nota si scrive subito, senza attendere la soglia; le successive si aggiungono all'accordo come con `Maiusc` + lettera. Così chi suona legato, premendo la nota seguente prima di rilasciare la precedente, non crea accordi, e un accordo è un solo passo di annulla. Gli accordi suonati da musicisti amatoriali sono di solito sfasati di poche decine di millisecondi, mentre due note distinte inserite una alla volta distano quasi sempre più di 150 ms: la soglia predefinita si verifica nelle prove con gli archivisti.
- **Percussioni**: in una parte con un solo strumento a percussione qualsiasi tasto scrive la nota nella posizione del suo suono, e la tastiera serve solo per il ritmo. In una parte con più strumenti il tasto deve essere la nota di batteria di uno di essi (per esempio 36 gran cassa, 38 tamburo, 49 piatti): la nota va nella voce di quello strumento e nella posizione del suo suono. Gli altri tasti sono ignorati, e la barra di stato indica quali funzionano («Tasti MIDI: Do2 gran cassa, Re2 tamburo, Do♯3 piatti»). Le batterie elettroniche inviano già queste note. Colpi di strumenti diversi suonati insieme, entro la soglia dell'accordo, si scrivono ciascuno nella sua voce allo stesso istante; con un solo strumento le note insieme valgono come una. Una parte in chiave di percussione senza strumenti configurati scrive ogni tasto nella posizione del suo suono, nella voce del cursore.
- **Correzione**: fuori dalla modalità di inserimento una nota suonata sostituisce l'altezza della nota selezionata, e delle note legate a lei; le note suonate insieme si aggiungono al suo accordo. Nelle percussioni, fuori dall'inserimento, la nota suonata si ascolta soltanto.
- **Grafia**: i tasti neri si scrivono secondo l'armatura della battuta dove si scrive, con diesis nelle armature in diesis e bemolli in quelle in bemolle, e senza armatura come Do♯, Mi♭, Fa♯, Sol♯ e Si♭. Sulle ultime note suonate `+`, `-` e `=` correggono la grafia senza cambiarne il suono (con `+` Re♭ diventa Do♯, con `-` Mi diventa Fa♭); una grafia che non esiste, come Re con il diesis, è rifiutata con un messaggio. Dopo un'altra modifica i tre tasti tornano a essere diesis, bemolle e bequadro. Le altre note della battuta conservano il loro suono: gli accidenti che servono, compresi i bequadri, si scrivono da soli.
- **Altezza**: la nota suonata è quella che si vede. Nella partitura in suoni reali è il suono reale; nelle parti e nella partitura trasposta è la nota scritta dello strumento.
- **Ascolto**: la nota suonata si sente subito con il suono della parte, attraverso il sintetizzatore del lettore: per gli strumenti traspositori il suono reale, come nel lettore, e nelle percussioni la nota di batteria dello strumento. Il sintetizzatore si prepara quando si apre il pannello della tastiera MIDI o il pianoforte a schermo, perché la prima nota non arrivi in ritardo.
- **Messaggi ignorati**: intensità, pedale e controlli; un Note On con intensità 0 vale come rilascio, come prevede lo standard MIDI. Taurus non chiede l'accesso ai messaggi di sistema (sysex).
- **Browser**: Chrome, Edge e Opera su computer e Android; Firefox dalla versione 108, dopo che l'utente accetta il permesso del sito che il browser propone. Safari e iPad non supportano Web MIDI: lì il comando non compare e restano la tastiera del computer e il pianoforte a schermo.
- **Pagina**: Web MIDI richiede HTTPS e una `Permissions-Policy` della pagina che lo consenta. La regola predefinita di `midi` lo consente già alla stessa origine; `taurus-fe/security-headers.conf` aggiunge comunque `midi=(self)`, così la scelta è esplicita e non cambia se la regola predefinita cambiasse. Il `midi=()` del backend riguarda solo le risposte delle API e resta.

## Architettura

### Frontend

- **Documento**: `ScoreDocument` apre anche un documento con più `part`, una per rigo, con voci da 1 a 4: il rigo attivo è quello del cursore e le operazioni esistenti lavorano su di lui, mentre quelle sulla struttura (battute, metro, ritornelli, volte, salti, tempo, lettere di prova, interruzioni) si applicano a tutti i righi alla stessa posizione con `everyPart`. Gli strumenti di ogni rigo stanno nel documento come attributo di lavoro `taurus-instruments` di `<score-part>`, così cronologia e bozza li seguono, e `cleanXml` lo toglie dal MusicXML salvato. I metodi esistenti restano validi per la parte singola, e le regole di accidenti, travature, divisioni e ordine degli elementi MusicXML della correzione restano le stesse.
- **Cursore**: posizione come parte, rigo, voce, battuta e istante nella battuta in frazioni esatte; le operazioni di inserimento lavorano sul cursore, quelle di correzione sulla selezione.
- **Operazioni**: le funzioni di `score-edits.ts` si affiancano a operazioni di scrittura (inserisci al cursore, riempi con pause, dividi e lega oltre la stanghetta, copia e incolla di frammenti MusicXML, trasponi). Ogni operazione dichiara le battute che cambia.
- **Cronologia**: per la parte singola restano le istantanee del documento (`SnapshotHistory`); per la partitura `MeasureHistory` registra solo le battute cambiate di ogni rigo, prima e dopo, per non tenere in memoria cento copie di un file di diversi megabyte, e il documento intero quando cambiano i righi, i loro strumenti o l'intestazione. Un `MutationObserver` segue il documento: a ogni modifica si serializzano solo le battute toccate, l'istantanea di prima si ricompone dai pezzi solo se serve, per esempio per ripristinare il documento quando una modifica non riesce, e il confronto con lo stato dell'apertura dice se il documento è cambiato senza serializzarlo (`modified`). La cronologia riporta anche righi e battute dell'ultima modifica, annullata o ripristinata (`lastChange`): i controlli si ricalcolano solo per i righi cambiati e si ridisegnano solo le pagine toccate.
- **Disegno**: `score-pages.ts` prepara il MusicXML da disegnare dal documento aperto, senza rileggerne il testo: con i nomi dei righi, senza i righi nascosti e con i segni della struttura comune solo sul primo rigo mostrato; Verovio usa `condense` per i righi vuoti, disegna una battuta per tutti i righi, e il rigo di un clic si ricava dal pentagramma (`staff@n`). Fino a 100 battute, contando ogni rigo mostrato, l'editor disegna tutto a ogni modifica come nella correzione; oltre, anche per una parte singola, perché le misure ne mostrano il vantaggio, disegna per pagine:
  - **Pagine** (`PagedNotation`): alte quanto l'area visibile dello spartito; solo quelle vicine alla vista hanno il loro SVG, le altre sono riquadri della stessa altezza riempiti quando ci si avvicinano. All'apertura le pagine sono provvisorie, di poche battute (40 divise per i righi mostrati, almeno 4).
  - **Impaginazione completa**: `score-layout.worker.ts` impagina con Verovio tutto lo spartito in un Web Worker e restituisce le pagine SVG con gli `id` delle loro battute (`score-layout.ts`). `ScoreLayoutClient` gli passa una richiesta alla volta: Verovio non si interrompe, quindi mentre lavora resta in attesa solo l'ultima richiesta, e un risultato superato da una modifica si scarta. Una nuova impaginazione parte 400 ms dopo l'ultima modifica.
  - **Dopo una modifica**: la pagina della battuta modificata si ridisegna subito nel thread principale da un estratto (`drawingExcerpt`) con le sue battute di tutti i righi mostrati e lo stato musicale in vigore (divisioni, armatura, chiavi, trasposizione); le altre pagine toccate si ridisegnano allo stesso modo quando si avvicinano alla vista, finché non arriva la nuova impaginazione completa. Le battute si ritrovano per posizione (`measurePositions`), perché Verovio disegna una battuta con l'`id` di un solo rigo; una pagina che non si disegna non si riprova fino a una nuova modifica o alla nuova impaginazione.
  - La mappa tra `id` ed elementi disegnati resta quella della correzione, cercata in tutti i righi e, per una pausa di più battute, nella battuta che la apre.
- **Ascolto**: il lettore esistente, che già legge una parte qualsiasi di un file a più parti e applica trasposizioni e suoni; nella partitura ogni rigo è una parte dell'ascolto, letta con le altre in una sola lettura del file (`parseMusicXmlParts`), con un canale per rigo, e quello in evidenza suona a volume pieno mentre gli altri si abbassano. **Ascolta** della scheda Partitura apre lo stesso lettore sulla versione corrente: ogni rigo è una parte dell'ascolto, con il nome del rigo e il suono del suo strumento, come nell'ascolto dell'editor anche in suoni reali; il mixer ha una riga per rigo, lo spartito mostra un rigo alla volta, scelto in **Rigo mostrato**, e mancano le segnalazioni, che riguardano le parti.
- **Conversione e controlli**: `score-arrangement.ts` converte la notazione con il piano della derivazione applicato a ogni rigo (`applyDerivation` di `score-derivation.ts`) e segna `<concert-score/>` in `<defaults>`, e calcola i controlli di tutti i righi dopo ogni modifica, con l'estensione dello strumento nella notazione della partitura.
- **MIDI**: un servizio (`MidiInputService`) legge i dispositivi con Web MIDI e riunisce in un accordo le note arrivate entro la soglia mentre la prima è premuta; `score-input.ts` sceglie la grafia dall'armatura, scrive l'altezza esatta conservando il suono delle altre note della battuta e traduce le note di batteria in voce e posizione per le percussioni, sopra le stesse operazioni di inserimento della tastiera del computer. Il pianoforte a schermo passa i suoi tocchi alla stessa strada.
- **Impaginazione**: `score-engraving.ts` riproduce in TypeScript la preparazione dell'MEI, le opzioni di Verovio, le sezioni tra le interruzioni di pagina e i numeri di pagina del servizio (`engrave.py`); `ScoreRendererService.engrave` disegna l'anteprima con un toolkit Verovio separato da quello del lettore e dell'editor, perché le opzioni dell'impaginazione non passino al loro disegno.
- **Derivazione**: `score-derivation.ts` calcola l'intervallo dalle trasposizioni, le ottave possibili con le note fuori estensione e l'ottava proposta, poi traspone il documento con la trasposizione di tutta la parte di `score-passage.ts` e cambia chiave e nome della parte. Il controllo dell'estensione è lo stesso negli editor.
- **Partitura**: `score-arrangement.ts` crea la partitura dall'organico o dalle parti, con l'allineamento delle battute e la struttura della parte di riferimento, converte tra suoni reali e trasposizione con la trasposizione di tutta la parte di `score-passage.ts` e l'intervallo di `score-derivation.ts`, e costruisce le parti estratte (`extractedParts`): legge la partitura una volta, tiene di ogni rigo le sue battute, lo traspone se la partitura è in suoni reali e scrive il nome della parte e l'intestazione. Il dialogo `extract-parts-dialog` propone le parti e invia il MusicXML, e `engrave-dialog` impagina anche più parti con le stesse opzioni.
- **Scaricamento MIDI**: `buildPlayback` costruisce anche il file da scaricare, senza metronomo né attacco; per una versione diversa da quella ascoltata il MusicXML arriva dalla lettura dell'editor.
- **Stampa della scaletta**: `PrinterService.previewProgram` apre l'anteprima con le parti del programma e con quelle da impaginare che l'evento segnala, perché il programma non porta la loro versione. L'anteprima le ordina per strumento e propone il formato marcia, le cui regole di stampa sono in `styles.scss`.
- **Bozze e blocco**: un servizio che salva la bozza con ritardo, ne conserva una copia in IndexedDB e rinnova il blocco ogni 30 secondi. La copia resta in IndexedDB anche quando il server la rifiuta, fino all'accettazione o allo scarto. L'editor di correzione usa lo stesso servizio per il blocco, senza bozze.

### Backend

- **Versioni delle parti**: `score_version` esistente, con le nuove origini `WRITING` e `ARRANGEMENT`. Il salvataggio usa la stessa richiesta JSON della correzione, con controlli e limiti invariati, più il controllo del blocco, che vale anche per le correzioni.
- **Partiture**: `track_arrangement`, una per traccia, e `arrangement_version`, immutabile come le versioni delle parti e salvata come media della categoria delle parti (`partitura.mxl`). `ArrangementContents` controlla il documento e i righi: un rigo per ogni parte del MusicXML, nello stesso ordine e con lo stesso identificativo, tutte con lo stesso numero di battute, entro il limite delle partiture; ogni rigo ha uno strumento in uso, o più strumenti tutti a percussione. Il salvataggio di una versione aggiunge i controlli di `MusicXmlInspector` per ogni rigo. Bozza e blocco usano il bersaglio `ARRANGEMENT` con gli stessi servizi delle parti, e la bozza conserva anche i righi. La creazione blocca la traccia e collega a una parte ogni rigo fatto da quella parte con i suoi stessi strumenti; gli altri righi partono senza parte.
- **Stato dei righi**: `ArrangementSupport` lo ricava dal collegamento dei righi e dall'ultima versione di ogni parte estratta dalla partitura. Senza parte il rigo è nuovo, oppure ha la parte eliminata se il collegamento resta su una parte eliminata. Con la parte, il rigo è aggiornato se la versione corrente della parte è l'ultima estratta e viene dalla versione corrente della partitura, modificato dopo l'estrazione se la parte ha una versione più recente di quella estratta, da estrarre negli altri casi. Ogni rigo riporta anche il numero della versione della partitura da cui viene l'ultima versione estratta della sua parte (`extractedFrom`), che la scheda Ascolto mostra.
- **Estrazione**: il browser invia per ogni rigo scelto la parte di destinazione, vuota per una parte nuova, e il MusicXML già estratto. Il backend blocca la traccia e ne controlla la versione, poi controlla che la versione della partitura sia la corrente, che ogni rigo esista e compaia una volta, che ogni parte abbia gli stessi strumenti del rigo, compaia una volta e non sia bloccata da un'altra persona, e che ogni contenuto passi i controlli di una parte scritta e di `MusicXmlInspector`. Crea in una transazione le parti nuove, in fondo alla traccia con il nome inviato o quello del rigo, e le versioni, poi aggiorna il collegamento dei righi, che lascia anche la parte eliminata da cui un rigo si è staccato.
- **Impaginazione**: job su una nuova coda RabbitMQ, `score.engraving` con la coda di scarto `score.engraving.dead`, con lo stesso schema del riconoscimento, senza notifica al termine: l'editor legge lo stato del job.
  - **Job**: la tabella dei job è la fonte di verità. Un worker prende il job con un aggiornamento atomico, chiama il servizio fuori da ogni transazione e scarta il risultato se nel frattempo il job è passato a un altro tentativo. Il recupero pianificato rimette in coda i job interrotti, fino a tre tentativi (`interrupted` dopo l'ultimo), e ripubblica quelli rimasti in coda.
  - **Opzioni**: si controllano prima di accodare il job (rigo da 4 a 9,6 mm, margini da 3 a 30 mm, testi dell'intestazione fino a 200 caratteri, quelli vuoti tolti) e si salvano con il job, che le manda al servizio così come sono.
  - **Pagine e PDF**: media della categoria delle parti, con il nome della parte (`basso-in-do-pagina-1.png`, `basso-in-do.pdf`). Le pagine restano legate al job (`score_engraving_page`) fino all'assegnazione, che blocca la traccia e ne controlla la versione come la modifica delle parti.
  - **Versione impaginata**: l'assegnazione salva con la parte la versione e l'impronta delle pagine; l'ascolto la riporta, solo a chi gestisce la traccia, finché l'impronta coincide.
  - **Parti estratte**: un job chiesto con `assign=true` assegna da solo le pagine al termine se la parte non ne ha ancora: il worker blocca la traccia, assegna le pagine con la versione e l'impronta e aggiorna la traccia, che cambia versione. Altrimenti le pagine aspettano l'assegnazione come quelle degli altri job.
  - **Pagine da assegnare**: l'ascolto riporta a chi gestisce la traccia, per ogni parte, l'ultimo job terminato con pagine non assegnate su una versione esistente (`pendingPages`).
- **Derivazione**: `ScoreDerivationService` controlla la parte di origine (un solo strumento, non di percussione), che la versione sia sua e lo strumento di destinazione, intonato e in uso, poi crea la parte come la nuova parte da zero, con la prima bozza e `derived_from_version_id`. Il contenuto arriva già trasposto dal browser e ha gli stessi controlli di una bozza. L'ascolto riporta a chi gestisce la traccia la parte e la versione di origine (`derivedFrom`).
- **Estensione**: i due campi dello strumento si controllano con le altre impostazioni dell'ascolto (`PlaybackSettingsValidator`) e con un vincolo del database; la migrazione degli strumenti esistenti usa il catalogo come `InstrumentPlaybackDefaultsChange`.
- **Organico**: `InstrumentEnsembleService` riscrive le posizioni in una transazione, sotto un lock consultivo del tenant e dopo aver controllato che l'organico letto sia ancora quello salvato; l'eliminazione di uno strumento prende lo stesso lock, lo toglie dall'organico e ricompatta le posizioni. Le posizioni si scrivono solo con le query dell'organico: la colonna non è aggiornabile dall'entità, così la modifica di uno strumento non riscrive un ordine salvato nel frattempo. `InstrumentEnsembleOrder` calcola l'ordine di riferimento dal catalogo; nel frontend `ensemble-order.ts` ordina le parti e i filtri dell'anteprima.
- **Preparazione degli eventi**: le parti del programma riportano gli identificativi degli strumenti (`instrumentIds`) e se sono da impaginare (`unengraved`), cioè con una versione corrente e senza pagine in nessuno stato. Una pagina ancora in elaborazione non rende la parte da impaginare.

### Servizio musicale

`taurus-omr` aggiunge `POST /v1/engravings`: riceve un MusicXML, normale o compresso, e le opzioni di impaginazione e restituisce il PDF e le pagine PNG in scala di grigi a 300 DPI. Usa Verovio per Python e CairoSVG, gli stessi strumenti con cui il test di accuratezza disegna il proprio corpus, con il carattere musicale incorporato in Verovio reso disponibile a Cairo e Liberation Serif per i testi. Il servizio resta interno, senza stato e senza accesso a database o storage. Le opzioni e i codici di errore sono descritti nel [README del servizio](../taurus-omr/README.md#impaginazione).

- **Processo separato**: l'impaginazione gira in un processo a parte, con slot propri e un tempo massimo di 120 secondi (`TAURUS_OMR_ENGRAVING_TIMEOUT_SECONDS`), come la lettura del testo: non aspetta i riconoscimenti e si interrompe allo scadere del tempo. Il MusicXML non supera 20 MB anche dopo la decompressione, e le pagine non superano il limite del servizio, 30 (`tooManyPages`).
- **Intestazione e righe**: l'intestazione si scrive nell'MEI che Verovio ricava dal MusicXML, così Verovio le lascia spazio; il disegno usa le stesse opzioni di interruzione dell'editor di scrittura (`breaks: smart`, `breaksSmartSb: 0`).
- **Interruzioni di pagina**: Verovio le ignora nel suo impaginare automatico e non disegna l'intestazione di una selezione di battute. Il servizio impagina quindi la parte in sezioni tra due interruzioni di pagina: la prima dalla parte tagliata dopo la sua ultima battuta, con l'intestazione, le altre come selezioni della parte intera, che conservano chiave, armatura e tempo in vigore.
- **Numeri di pagina**: scritti dal servizio nella fascia di 6 mm lasciata libera sopra il margine inferiore, contati su tutte le sezioni.
- **PDF**: vettoriale, in PDF 1.4, con le pagine nel formato scelto, titolo della traccia e nome della parte nei metadati.

Verovio ha la stessa versione nel frontend, nel servizio e nel test di accuratezza, così l'anteprima del browser e le pagine generate coincidono. Le versioni si aggiornano insieme, e `scripts/ops/check-verovio-versions.mjs`, eseguito dalla CI, fallisce se divergono.

## Modello dati e migrazioni

Changelog nello schema del tenant. Tutte le nuove tabelle hanno i campi di audit e, se modificabili, `entity_version`.

| Tabella | Contenuto |
| --- | --- |
| `score_version` (esistente) | nuove origini `WRITING` e `ARRANGEMENT`; nuova colonna facoltativa `arrangement_version_id` per le versioni estratte |
| `track_arrangement` | `id`, `track_id` univoco tra le partiture non eliminate, `current_version_id`, `entity_version`, audit: la [partitura](#partitura-e-arrangiamento) della traccia |
| `arrangement_version` | `id`, `arrangement_id`, `version_number`, `status`, `media_asset_id` (MusicXML compresso a più parti), `parent_version_id`, `rows_json` (per ogni rigo l'identificativo della parte nel MusicXML, il nome e gli strumenti), `concert_pitch` (scritta in suoni reali), `measure_count`, `checks_json`, approvazione; univoco `(arrangement_id, version_number)` |
| `score_draft` | `id`, tipo e identificativo del bersaglio (parte o partitura), `base_version_id`, `content` (MusicXML compresso; il testo inviato non supera il limite dei caricamenti, 10 MB, o quello delle partiture), `rows_json` (righi, presente solo per una partitura), `saved_by`, `saved_at`, `entity_version`; una bozza per bersaglio |
| `score_edit_lock` | tipo e identificativo del bersaglio, `owner`, `owner_name`, `acquired_at`, `heartbeat_at`, `expires_at`; univoco per bersaglio |
| `score_engraving_job` | `id`, `sheet_music_id`, `track_id`, `score_version_id`, `options_json`, `status`, `attempts`, `requested_by`, `started_at`, `finished_at`, `error_code`, `engine_version`, `duration_millis`, `page_count`, `pdf_media_asset_id`, `applied_at`, `applied_sheet_music_id`, `assign_to_empty_part` (assegnazione al termine, per le [parti estratte](#estrazione-delle-parti)), `entity_version`, audit; un solo job in coda o in corso per parte |
| `score_engraving_page` | `job_id`, `page_index`, `media_asset_id`: pagine di un job non ancora assegnate |
| `sheet_music` (esistente) | `engraved_from_version_id` facoltativo: versione da cui derivano le pagine generate; `engraved_pages_fingerprint`: impronta delle pagine assegnate, presente con la versione; `derived_from_version_id` facoltativo: versione di un'altra parte da cui la parte è [ricavata](#parte-ricavata-da-unaltra); `arrangement_row` facoltativo: rigo della partitura della traccia collegato alla parte, univoco tra le parti non eliminate della traccia e scritto solo dalle query della partitura; resta sulla parte eliminata, che così segnala il rigo rimasto senza parte |
| `instrument` (esistente) | `lowest_written_pitch`, `highest_written_pitch`: [estensione](#estensione-degli-strumenti) scritta come numeri di nota MIDI da 0 a 127, facoltativi ma presenti insieme, proposti dal catalogo di riferimento come suono e trasposizione; `ensemble_position` facoltativo: posizione nell'[organico della banda](#organico-della-banda), da 1, unica nel tenant con il controllo alla fine della transazione e vuota per gli strumenti eliminati |
| `track` (esistente) | `arranger` facoltativo, già presente accanto a `composer`: mostrato nel dettaglio della traccia e proposto nell'intestazione delle pagine |

Pagine e PDF generati sono media della categoria delle parti (`scores`); `MediaRepository.isUnreferenced` aggiunge i riferimenti dei job, PDF e pagine non assegnate, e con la [partitura](#partitura-e-arrangiamento) quelli delle sue versioni. La pulizia delle versioni non elimina una versione da cui derivano le pagine di una parte o da cui è ricavata una parte, né una con un'impaginazione in coda, in corso o non assegnata. Le versioni della partitura seguono la stessa pulizia: si conservano le ultime 20, la corrente, quelle approvate e quelle da cui derivano versioni di parti ancora presenti. La pulizia notturna toglie anche le bozze delle partiture eliminate e di quelle delle tracce eliminate. I vincoli sul tipo di bersaglio di bozze e blocchi accettano `ARRANGEMENT`. La funzionalità `SCORE_WRITING` richiede una colonna del flag nel registro dei tenant, come le altre funzionalità.

## API REST

Sotto `/api/tracks/{trackId}`, per super amministratore, amministratore e archivista con la funzionalità attiva:

| Metodo e percorso | Descrizione |
| --- | --- |
| `POST /scores/{scoreId}/score-versions` (esistente) | salvataggio di una versione scritta, con `origin: WRITING` |
| `GET`, `PUT`, `DELETE /scores/{scoreId}/score-draft` | bozza della parte; `PUT` con `entityVersion` per evitare sovrascritture |
| `POST /written-parts` | parte scritta da zero in fondo alla traccia, senza pagine: descrizione, strumenti, MusicXML iniziale e versione della traccia; crea anche la prima bozza, di chi la scrive |
| `POST`, `PUT`, `DELETE /scores/{scoreId}/edit-lock` | prende, rinnova e rilascia il blocco; `POST ?takeOver=true` prende il controllo |
| `POST /scores/{scoreId}/derive` | crea in fondo alla traccia una parte nuova ricavata da una versione della parte: `versionId`, `instrumentId` di destinazione, nome, MusicXML trasposto dal browser e versione della traccia; crea anche la prima bozza, di chi la ricava, e restituisce la parte e la nuova versione della traccia |
| `GET`, `POST`, `DELETE /arrangement` | partitura della traccia, con la versione corrente, la bozza, il blocco e i righi con lo stato della loro parte e la versione della partitura da cui è estratta, 204 se non c'è; `POST` la crea con i righi e la prima bozza, `DELETE` la elimina lasciando le parti e togliendo il loro collegamento ai righi |
| `GET`, `POST /arrangement/versions`, `GET /arrangement/versions/{versionId}/file`, `GET /arrangement/versions/{versionId}/content`, `POST /arrangement/versions/{versionId}/approve` | versioni della partitura: elenco, salvataggio con il blocco e la versione di partenza, MusicXML compresso da scaricare, MusicXML semplice per l'editor e l'ascolto, approvazione, che rende la versione corrente |
| `POST /arrangement/versions/{versionId}/extract` | estrazione delle parti: `trackVersion` e, per ogni rigo scelto, `row`, `sheetMusicId` (vuoto per una parte nuova), `description` e `content`; restituisce le parti, le versioni create e la nuova versione della traccia |
| `GET`, `PUT`, `DELETE /arrangement/draft`; `POST`, `PUT`, `DELETE /arrangement/edit-lock` | bozza e blocco della partitura, come quelli delle parti |
| `POST /scores/{scoreId}/score-versions/{versionId}/engravings` | avvia l'impaginazione con le opzioni, tutte facoltative, e con `?assign=true` per assegnare le pagine al termine a una parte che non ne ha, e risponde 202 con il job; `GET` legge l'ultimo job della versione, 204 se non ce ne sono |
| `POST /scores/{scoreId}/score-versions/{versionId}/engravings/{jobId}/apply` | assegna le pagine del job: `target` `REPLACE`, al posto delle pagine della parte, o `NEW_PART`, e `trackVersion` facoltativa; restituisce la parte e la nuova versione della traccia |
| `GET /scores/{scoreId}/score-versions/{versionId}/engravings/pdf` | scaricamento del PDF dell'ultima impaginazione della versione |
| `GET /scores/{scoreId}/score-versions/{versionId}/file` (esistente) | scaricamento del MusicXML; il MIDI si costruisce nel browser (vedi [Scaricamento](#scaricamento)) |

`GET /api/instruments/playback-suggestion` aggiunge alla proposta l'estensione (`lowestWrittenPitch`, `highestWrittenPitch`), e lo strumento la salva con gli altri campi. L'organico si salva con `PUT /api/instruments/ensemble`, per chi gestisce gli strumenti: riceve l'elenco ordinato degli strumenti che ne fanno parte (`instrumentIds`) e quello letto (`previousInstrumentIds`), e risponde `version.conflict` (409) se nel frattempo l'organico è cambiato. `PUT` risponde con l'organico salvato, `instrument.ensemble.invalid` (400) per uno strumento inesistente, eliminato o ripetuto. `GET /api/instruments/ensemble`, per tutti gli utenti autenticati, restituisce gli strumenti dell'organico nel loro ordine (`id`, `name`, `ensemblePosition`, `family`), vuoto senza organico: lo usano l'anteprima e la stampa. `GET /api/instruments/ensemble/reference` restituisce tutti gli strumenti del tenant nell'ordine di riferimento, con la famiglia riconosciuta e la posizione attuale, senza salvarlo; gli strumenti espongono `ensemblePosition` in sola lettura.

Il blocco di una parte (`/scores/{scoreId}/edit-lock`) richiede solo l'ascolto (`SCORE_PLAYBACK`), perché lo usa anche l'editor di correzione; con `SCORE_WRITING` disattivata restano disponibili solo il blocco e il salvataggio delle correzioni.

Errori nuovi, secondo lo [standard](application-errors-standard.md): `scoreWriting.locked` (409, con nome e ora di chi scrive; anche per bozze e versioni inviate senza il blocco), `scoreWriting.draftOutdated` (409), `scoreWriting.instrumentNotFound` (400, per uno strumento inesistente o eliminato nella parte scritta da zero o ricavata, o in un rigo della partitura), `scoreWriting.derivationUnavailable` (422, con `reason`: `notSingleInstrument` per una parte di origine con più strumenti o senza strumenti, `percussion` per una parte di percussione, `targetPercussion` per uno strumento di destinazione a percussione), `scoreWriting.instrumentNotConfigured` (422, con `instrument`, per un rigo da trasporre nell'estrazione il cui strumento non ha trasposizione), `scoreWriting.arrangementExists` (409, la traccia ha già una partitura), `scoreWriting.arrangementNotFound` (404), `scoreWriting.arrangementOutdated` (409, estrazione da una versione della partitura che non è più la corrente), `scoreWriting.extractionInvalid` (400, con `reason`: `empty` senza righi, `unknownRow`, `duplicateRow`, `duplicateTarget` per due righi verso la stessa parte, anche alla creazione della partitura, `instrumentsMismatch` per una parte con strumenti diversi da quelli del rigo), `instrument.ensemble.invalid` (400, per uno strumento inesistente, eliminato o ripetuto nell'organico), `scoreWriting.engravingUnavailable` (503, senza servizio musicale), `scoreWriting.engravingOptionsInvalid` (400, con `field`), `scoreWriting.engravingRunning` (409, un'impaginazione della parte è già in coda o in corso), `scoreWriting.engravingNotFound` (404), `scoreWriting.engravingNotReady` (409, job non terminato, già assegnato o con le pagine ormai sostituite). Una parte scritta da zero o ricavata, un'estrazione o un'assegnazione di pagine su una traccia modificata nel frattempo riceve `version.conflict` (409); un'estrazione verso una parte bloccata da un'altra persona riceve `scoreWriting.locked`. Un'estensione incompleta, fuori da 0–127 o con la nota grave più acuta di quella acuta riceve `scorePlayback.settings.invalid` (422), come le altre impostazioni dell'ascolto. Bozze e versioni della partitura ricevono `scoreWriting.contentInvalid` anche con `reason` `tooManyRows` (con `maxRows`), `rowsMismatch` per righi che non sono le parti del documento, `unevenMeasures` e `rowInstruments`; nell'estrazione l'errore del contenuto di una parte riporta il rigo (`row`).

Un job fallito riporta il codice del servizio (`unreadableScore`, `invalidOptions`, `tooManyPages`, `tooLarge`, `engineFailed`, `engineTimeout`, `serviceUnavailable` quando non risponde) o del backend (`versionNotFound` per una versione o una parte eliminata nel frattempo, `interrupted`, `unexpected`); un risultato senza pagine o con un numero di pagine diverso da quello dichiarato vale `engineFailed`.

## Autorizzazioni e isolamento tenant

- Scrittura, bozze, blocchi, estrazione e impaginazione sono riservati a super amministratore, amministratore e archivista, sui percorsi di gestione; utenti ed esterni continuano a vedere solo le versioni, con le regole di visibilità dell'ascolto.
- Bozze e blocchi stanno nello schema del tenant; il blocco riporta il nome di chi scrive solo agli utenti dello stesso tenant.
- Le bozze di un utente cancellato restano finché il bersaglio esiste, perché il contenuto è musica dell'archivio e non un dato personale; il nome dell'autore nel blocco scompare alla scadenza.

## Osservabilità e sicurezza

- Metriche: `taurus.score.writing.saves{origin}`, `taurus.score.writing.drafts{outcome}`, `taurus.score.writing.locks{outcome}` (`acquired`, `takenOver`, `expired`), `taurus.score.engravings{outcome}` (`done` o il codice dell'errore), la durata dell'impaginazione (`taurus.score.engraving.duration`) `taurus.score.engravings.applied{target}` (`replace`, `newPart`, `emptyPart` per le pagine assegnate al termine del job) e `taurus.score.arrangement.extractions{target}` (`existing`, `newPart`), una per parte estratta.
- Log con identificativi di parte, partitura, versione e job; mai il contenuto MusicXML.
- Gli stessi limiti di sicurezza dei file MusicXML caricati (entità e DTD disattivate, limiti di dimensione); bozze entro lo stesso limite dei caricamenti (`application.score-playback.max-upload-bytes`, 10 MB di MusicXML non compresso) e al più un salvataggio ogni due secondi per bozza (`application.score-writing.draft-min-interval`), che una sola finestra alla volta può scrivere perché serve il blocco. La partitura ha un limite proprio per bozze e versioni, 30 MB di MusicXML non compresso e 60 righi (`application.score-writing.max-arrangement-bytes`, `application.score-writing.max-arrangement-rows`); ogni parte estratta resta entro il limite delle parti.
- Il servizio musicale resta sulla rete interna con la chiave condivisa; l'impaginazione ha un tempo massimo come il riconoscimento.
- La tastiera MIDI si usa solo dopo il permesso del browser e senza messaggi di sistema (sysex); `midi=(self)` consente il MIDI solo all'origine dell'applicazione, non a contenuti di altre origini.

## Prestazioni

| Misura | Obiettivo |
| --- | --- |
| Tasto → nota disegnata, parte di 300 battute | meno di 100 ms su un computer recente |
| Tasto → nota disegnata, partitura di 30 parti e 150 battute | meno di 150 ms, con il disegno della sola pagina visibile |
| Apertura di una partitura di 30 parti | meno di 3 secondi |
| Salvataggio di una bozza | non blocca la scrittura |
| Impaginazione di una parte di due pagine | meno di 15 secondi |

Le misure seguono il metodo della [fase 4 dell'ascolto](track-score-playback-spec.md#copertura-della-fase-4), anche con il processore rallentato quattro volte.

Misure del 16/11/2026 nel browser (Chrome 157 senza interfaccia, sul computer di sviluppo), con il codice dell'editor, spartiti larghi 1000 px e pagine alte 800 px; le partiture alternano righi di flauto e di tuba ricavati dal corpus, e ogni tasto cambia l'altezza di una nota in una battuta diversa, mediana di 15. Tra parentesi gli stessi tempi con il processore rallentato quattro volte:

| Misura | Parte di 300 battute | Partitura di 10 righi e 150 battute | Partitura di 30 righi e 150 battute |
| --- | --- | --- | --- |
| Tasto → nota disegnata, con l'inserimento nella pagina | 0,06 s (0,98 s) | 0,13 s (0,79 s) | 0,38 s (2,3 s) |
| Di cui il disegno dell'estratto con Verovio | 0,02 s (0,31 s) | 0,06 s (0,35 s) | 0,25 s (1,4 s) |
| Lo stesso tasto con lo spartito ridisegnato intero, come prima | 0,37 s (5,8 s) | 2,9 s (19 s) | 11 s (66 s) |
| Apertura: documento, cronologia, controlli e prima pagina | 0,19 s (0,81 s) | 0,48 s (4,6 s) | 0,92 s (14 s) |
| Impaginazione completa nel Web Worker, che non ferma la scrittura | 0,4 s (1,3 s), 12 pagine | 1,9 s (2,3 s), 31 pagine | 7,1 s (7,9 s), 31 pagine |

- L'obiettivo di 150 ms non si raggiunge con 30 righi: dei 0,38 s, 0,25 s sono il disegno di un solo sistema con tutti i righi, che Verovio non divide, poi vengono l'inserimento nella pagina (0,06 s) e i controlli dei righi (0,03 s). Nascondere i righi che non si scrivono riduce il disegno, come mostra la partitura di 10 righi.
- La cronologia per battute registra un tasto della partitura di 30 righi in 6 ms; prima le due istantanee e la copia completa del documento ne richiedevano circa 0,45.
- Con il processore rallentato quattro volte la partitura di 30 righi si apre in 14 s, oltre l'obiettivo di 3, e un tasto richiede 2,3 s contro i 66 del ridisegno intero: su computer lenti conviene scrivere con pochi righi mostrati.

## Strategia di test

- **Unità (frontend)**: ogni operazione di scrittura su documenti minimi, come le specifiche di `score-edits`: inserimento al cursore, battute sempre complete, divisione e legatura alla stanghetta, voci, copia e incolla, trasposizione con accidenti e armatura, partitura e cronologia per battute; inserimento da MIDI con un dispositivo simulato (accordi entro e oltre la soglia, legato che non forma accordi, Note On con intensità 0, grafia, vista trasposta e suoni reali, percussioni con uno o più strumenti); copia nel browser conservata dopo un rifiuto e proposta alla riapertura; preparazione dell'MEI, opzioni, sezioni e numeri di pagina dell'impaginazione, dialogo con il job simulato, parti da impaginare nella scheda Ascolto, nel Workspace Parti, nell'anteprima e nel programma dell'evento, stampa della scaletta per strumento e nel formato marcia; intervallo e ottava della derivazione (dal clarinetto in Si♭ al sax contralto in Mi♭, chiave di basso, intervallo enarmonico, cambio di chiave), note fuori estensione nel dialogo e negli editor, MIDI scaricato senza metronomo né attacco; organico con ordine di riferimento e posizione di famiglia, anteprima e stampa ordinate con l'organico; partitura dall'organico e dalle parti, con battute e ritornelli diversi e parti di percussione con più strumenti; operazioni su tutti i righi, conversione tra suoni reali e trasposizione e ritorno, cronologia per battute, parti estratte con struttura, intestazione e trasposizione e stati dei righi, dialogo dell'estrazione, impaginazione di più parti ed etichette delle parti estratte e delle pagine da assegnare nella scheda Ascolto.
- **Validità**: ogni documento prodotto dai test viene validato contro lo schema XSD di MusicXML 4.0; un campione si apre in MuseScore durante la verifica manuale.
- **Andata e ritorno**: scrivere, salvare, riaprire e scaricare produce lo stesso MusicXML, senza attributi di lavoro.
- **Backend**: bozze con concorrenza ottimistica, eliminate al salvataggio di una versione e con la parte o la partitura, blocchi con rinnovo, scadenza e presa di controllo, organico con ordine di riferimento proposto e non salvato, salvato con il controllo dell'organico letto e ricompattato con gli strumenti eliminati, bozze e versioni scritte o corrette rifiutate senza il blocco, partitura una per traccia con bozza, blocco e versioni, estrazione dalla versione corrente verso parti con gli stessi strumenti o parti nuove, rifiutata per righi e parti ripetuti, parti bloccate e strumenti non configurati, con il collegamento dei righi e l'impaginazione assegnata alle parti senza pagine, derivazione con la bozza e la versione di origine, rifiutata per parti con più strumenti e di percussione, per versioni di altre parti e per strumenti inesistenti, versione di origine conservata dalla pulizia, estensione controllata e compilata dalla migrazione solo con la trasposizione del catalogo, job di impaginazione con il servizio simulato, parti da impaginare nel programma e nella criticità degli spartiti della preparazione degli eventi, autorizzazioni e isolamento tenant.
- **Servizio musicale**: impaginazione su MusicXML noti, con conteggio delle pagine e confronto delle immagini entro una tolleranza; controllo che la versione di Verovio coincida con quella del frontend. I test che disegnano richiedono la libreria Cairo, installata dalla CI, che con `TAURUS_OMR_REQUIRE_CAIRO=true` li fa fallire invece di saltarli se manca; la pagina di riferimento si confronta a un quarto della dimensione, perché contino l'impaginazione e non le sfumature dei bordi.
- **Prestazioni**: misure ripetibili del disegno su parti e partiture grandi.
- **Manuale**: prove con archivisti su parti reali, tempo per scrivere una parte di una pagina, uso su tablet, tastiera MIDI reale su Chrome, Edge e Firefox.

## Criteri di accettazione

- [ ] Con `SCORE_WRITING` disattivata nessuna azione di scrittura è visibile e le API di scrittura rispondono `403`; il blocco delle parti resta attivo per la correzione.
- [ ] Un archivista scrive da zero una parte di una pagina con la sola tastiera; le battute restano complete e la parte si ascolta.
- [ ] Con una tastiera MIDI collegata, in Chrome ed Edge, le note suonate si scrivono al cursore e quelle premute insieme diventano accordi, mentre una melodia suonata legata no; dove Web MIDI non esiste il comando non compare.
- [ ] In una parte di percussione con più strumenti, le note di batteria degli strumenti della parte si scrivono nella voce e nella posizione del loro suono e si riascoltano con lo stesso suono.
- [ ] **Salva e approva** approva la versione senza l'intervento di una seconda persona e chiude le segnalazioni aperte della parte.
- [ ] Una parte di clarinetto in Sib diventa la parte di sax contralto in Mib con l'intervallo e l'armatura corretti, e le note fuori estensione sono segnalate; una parte con più strumenti non si deriva.
- [ ] Gli strumenti riconosciuti dal nome ricevono un'estensione proposta, e gli editor segnalano le note fuori estensione delle parti con un solo strumento.
- [ ] Il MIDI scaricato da una versione o dal lettore suona come l'ascolto, senza metronomo né battuta di attacco.
- [ ] Chiudendo il browser durante la scrittura e riaprendo l'editor si riprende la bozza.
- [ ] Le modifiche fatte senza connessione e rifiutate perché il blocco è passato a un altro non si perdono: si scaricano subito o si riprendono alla riapertura con il blocco libero.
- [ ] Un secondo utente vede chi sta scrivendo o correggendo e apre in sola lettura; la presa di controllo conserva la bozza del primo, che da quel momento non salva più né bozza né versione.
- [ ] Nessuna azione della scrittura, dell'estrazione o dell'impaginazione crea notifiche.
- [ ] Una partitura di 30 parti si scrive senza ritardi percepibili e si estrae in parti trasposte per strumento.
- [ ] Una partitura si crea dalle parti di una traccia con battute e ritornelli diversi, e il dialogo dice prima che cosa cambierà in ciascuna.
- [ ] Una partitura convertita in suoni reali e di nuovo trasposta torna alle stesse note.
- [ ] L'estrazione sostituisce una parte corretta dopo l'ultima estrazione solo se la si sceglie, e la scheda Ascolto indica le parti estratte, quelle corrette dopo l'estrazione e quelle da estrarre di nuovo.
- [ ] Una parte scritta si impagina in A4 e nel formato marcia, compare in anteprima e si stampa come le parti dei PDF.
- [ ] Prima dell'impaginazione la parte è «da impaginare» nel workspace, in anteprima e in stampa, che la esclude e la conta nel riepilogo; il socio la legge e la ascolta nella scheda Ascolto.
- [ ] Dalla preparazione di un evento la scaletta si stampa per strumento nel formato marcia, due pagine di 18 × 13 cm per foglio A4, e le parti da impaginare sono indicate nel programma e nella criticità degli spartiti.
- [ ] Una partitura nuova segue l'ordine dell'organico, e la stampa ordina le parti allo stesso modo; senza organico la stampa non cambia.
- [ ] Il MusicXML scaricato si apre in MuseScore senza avvisi.
- [ ] Nessun dato di un tenant è accessibile da un altro tenant.

## Piano di implementazione

1. **Scrittura di una parte**: modalità di inserimento con cursore e voci, battute sempre complete, selezione di intervalli, copia, incolla e trasposizione, nuova notazione (legature di portamento, forcelle, lettere di prova, testo, corona, respiro, abbellimenti), inserimento da tastiera MIDI con `midi=(self)`, accordi e percussioni, bozze, copia nel browser e blocco, anche nell'editor di correzione, nuova parte da zero, approvazione da parte di chi scrive, funzionalità `SCORE_WRITING`.
2. **Impaginazione e stampa**: servizio di impaginazione con Verovio allineato al frontend, job e coda, pagine e PDF della parte, formati A4 e marcia, battute numerate a ogni rigo, arrangiatore della traccia, parti da impaginare, indicazione delle pagine non aggiornate, impaginazione per l'evento.
3. **Parti ricavate**: derivazione per un altro strumento, con intervallo e ottava proposti e trasposizione nel browser; estensione degli strumenti con proposta dal catalogo, migrazione degli strumenti esistenti e avvisi nella derivazione e negli editor; scaricamento MIDI dal dialogo delle versioni e dal lettore.
4. **Partitura**: organico della banda per tenant, documento a più parti, disegno per pagina in un Web Worker, suoni reali e trasposizione, partitura dalle parti esistenti, estrazione per rigo e divergenze, cronologia per battute.
5. **Estensioni**: confronto tra versioni, frammenti riutilizzabili, raccolta dai riconoscimenti.
6. **Qualificazione**: misure su partiture grandi, prove con archivisti e su tablet, runbook.

La fase 4 si sviluppa in sei incrementi: l'organico della banda, con l'anteprima e la stampa ordinate; la partitura nel backend, con tabelle, versioni, bozza, blocco ed estrazione; il documento a più parti e la scheda Partitura, con la nuova partitura dall'organico e dalle parti, l'editor della partitura e la cronologia per battute; la conversione tra suoni reali e trasposizione, con l'ascolto e i controlli per rigo; l'estrazione, le divergenze e l'impaginazione delle parti estratte; il disegno per pagina in un Web Worker, con le misure delle prestazioni.

L'impaginazione viene subito dopo la scrittura perché una parte scritta, per esempio al posto di una perduta, serve soprattutto a essere stampata. Per questo la fase 1 non si rilascia da sola: `SCORE_WRITING` diventa attivabile per i tenant quando anche la fase 2 è completa.

## Compatibilità e adozione

- La funzionalità è disattivata per default e richiede l'ascolto delle parti; senza servizio musicale si scrive e si ascolta, ma non si impagina.
- Versioni, ascolto, segnalazioni e scaricamento esistenti non cambiano: le versioni scritte sono versioni come le altre.
- La correzione cambia in un punto: l'editor prende il blocco della parte e il salvataggio lo richiede, anche con `SCORE_WRITING` disattivata. Due persone non correggono più la stessa parte insieme.
- La stampa ordina le parti con l'organico solo quando il tenant l'ha definito; l'organico non si compila da solo con l'ordine di riferimento.
- Le nuove origini di versione sono valori aggiuntivi: il frontend precedente mostra un'origine sconosciuta come «Altro» finché non viene aggiornato.
- Rollback: disattivare la funzionalità; partiture, bozze e versioni restano per una riattivazione.

## Decisioni della revisione

Le questioni aperte della prima bozza, decise il 18/10/2026, con la numerazione originale:

1. **Chi può scrivere**: super amministratore, amministratore e archivista, come per correzione e approvazione. Nessun nuovo ruolo né delega per traccia.
2. **Dove si impagina**: nel servizio musicale, per pagine identiche a ogni generazione e indipendenti dai caratteri del browser. Il modulo mantiene il nome `taurus-omr`, così immagine, compose e workflow non cambiano.
3. **Sostituire o affiancare le pagine**: Taurus chiede ogni volta se sostituire le pagine della parte o aggiungere quelle impaginate in una parte nuova; una parte scritta da zero, senza pagine, le riceve direttamente.
4. **Formato marcia**: 18 × 13 cm in orizzontale, oltre ad A4 verticale e orizzontale; altri formati si aggiungeranno su richiesta.
5. **Estensione degli strumenti**: due nuovi campi facoltativi dello strumento, nota scritta più grave e più acuta, proposti dal catalogo di riferimento. Non c'è un'estensione separata per gli allievi.
6. **Tastiera MIDI**: abilitata dalla prima fase (vedi [Tastiera MIDI](#tastiera-midi)).
7. **Approvazione**: chi scrive approva il proprio lavoro con **Salva e approva**, come nella correzione; non serve l'approvazione di una seconda persona e non c'è un'impostazione del tenant per richiederla.
8. **Unione delle bozze**: nessuna unione automatica; un solo autore alla volta e conferma esplicita in caso di conflitto.
9. **Partitura e parti modificate a mano**: l'estrazione segnala le parti corrette dopo l'ultima estrazione e lascia scegliere, parte per parte, se sostituirle.
10. **Crediti e diritti**: intestazione e metadati riportano compositore e arrangiatore; l'arrangiatore è un nuovo campo facoltativo della traccia, mostrato nel dettaglio, senza un filtro di ricerca dedicato. La responsabilità dei diritti resta del tenant, come per i caricamenti.
11. **Notifiche**: quando le parti estratte sono approvate, i soci che suonano quegli strumenti ricevono una notifica. Superata dalla [seconda revisione](#decisioni-della-seconda-revisione), che esclude le notifiche.
12. **Formato interno**: MusicXML. MEI si rivaluterà solo se servisse notazione che MusicXML non rappresenta.

## Decisioni della seconda revisione

Decise il 14/11/2026, dopo il confronto della specifica con il codice:

1. **Nessuna notifica**: la scrittura non genera notifiche, né ai soci per le parti approvate, ricavate o estratte, né a chi avvia un'impaginazione. Se torneranno, serviranno destinatari per strumento, che il sistema di notifiche non ha, e il filtro sullo stato della traccia, perché i soci vedono solo le tracce `COMPLETE` e `PUBLIC`.
2. **Rinnovo del blocco**: ogni 30 secondi, con scadenza dopo due minuti senza rinnovi.
3. **Blocco verificato al salvataggio**: bozze e versioni sono accettate solo da chi possiede il blocco, o da chi lo riprende scaduto e libero.
4. **Blocco anche nella correzione**: l'editor di correzione prende lo stesso blocco della scrittura, anche con `SCORE_WRITING` disattivata.
5. **Trasposizione per strumento singolo**: si traspone solo una parte con un solo strumento; nella partitura la trasposizione si applica a ogni rigo, che ha un solo strumento. La derivazione è disattivata per le parti con più strumenti, l'estrazione aggiorna solo parti con lo strumento del rigo come unico strumento.
6. **Verovio allineato**: stessa versione nel frontend, nel servizio musicale e nel test di accuratezza, con un controllo che fallisce se divergono.
7. **Intestazioni**: `midi=(self)` entra nelle intestazioni di nginx del frontend; quelle del backend non cambiano.
8. **Proposte approvate**: le sei proposte della prima bozza entrano nello sviluppo come [estensioni approvate](#estensioni-approvate), distribuite nelle fasi 2, 4 e 5 del piano.
9. **Copia nel browser rifiutata**: non si perde; si scarica come MusicXML o si riprende alla riapertura con il blocco libero (vedi [Copia nel browser rifiutata](#copia-nel-browser-rifiutata)). Scartata l'alternativa di una seconda bozza sospesa sul server: tabella, API e scelta tra due bozze per un caso raro.
10. **Accordi e percussioni da MIDI**: accordo per le note arrivate entro 80 ms dalla prima mentre la prima è premuta, soglia regolabile; nelle percussioni, qualsiasi tasto per una parte con un solo strumento e la nota di batteria dello strumento per una parte con più strumenti (vedi [Tastiera MIDI](#tastiera-midi)). Scartate la finestra fissa, che ritarda ogni nota, i tasti tenuti, che trasformano il legato in accordi, e i tasti bianchi in ordine per le percussioni, che non funzionano con le batterie elettroniche.
11. **Ordine della partitura**: dall'[organico della banda](#organico-della-banda), con un ordine di riferimento proposto dal catalogo e confermato dal tenant.
12. **Parti senza pagine**: l'impaginazione diventa la fase 2 e `SCORE_WRITING` si attiva solo dopo di essa; le parti non ancora impaginate sono segnalate e guidano all'impaginazione (vedi [Parti da impaginare](#parti-da-impaginare)). Scartato il disegno nel browser in anteprima e stampa, che darebbe due impaginazioni diverse.
13. **Bozze abbandonate**: non scadono; si eliminano al salvataggio di una versione, con la parte o la partitura, o scartandole, e la scheda Ascolto le mostra. Scartata la scadenza automatica, che senza notifiche eliminerebbe lavoro senza avvisare per risparmiare poco spazio: una bozza per parte o partitura ne limita già il numero.

## Decisioni della terza revisione

Decise il 15/11/2026, nel dettaglio della fase 3:

1. **Trasposizione nel browser**: la derivazione traspone con il codice della trasposizione dell'editor e invia il MusicXML trasposto; il backend controlla parte, versione e strumento e salva. Scartata una trasposizione in Java, che l'anteprima del dialogo dovrebbe ripetere con il rischio che le due divergano. Dove trasporre le parti estratte dalla partitura si decide nel dettaglio della fase 4.
2. **MIDI dal generatore dell'ascolto**: il file si costruisce nel browser, nel dialogo delle versioni e nel lettore della partitura, così suona come l'ascolto. Scartata la conversione nel backend (`format=midi`), una seconda lettura del MusicXML con differenze possibili da ciò che si sente.
3. **Estensione anche negli editor**: le note fuori estensione si segnalano nella derivazione e nei controlli degli editor di scrittura e di correzione, per le parti con un solo strumento.
4. **Estensione degli strumenti esistenti**: una migrazione la compila dal catalogo, come suono e trasposizione, solo per gli strumenti senza estensione e con la trasposizione del catalogo; **Proponi dal nome** la propone per gli altri.
5. **Origine di una parte ricavata**: la parte ricorda la versione da cui è ricavata (`derived_from_version_id`), e la sua prima versione ha origine `WRITING` come le altre versioni scritte. `ARRANGEMENT` resta per le parti estratte dalla partitura.

## Decisioni della quarta revisione

Decise il 15/11/2026, nel dettaglio della fase 4:

1. **Estrazione nel browser**: le parti estratte si costruiscono e si traspongono nel browser, con lo stesso codice della conversione della partitura e della derivazione; il backend controlla righi, parti e strumenti e salva. Scartata la trasposizione in Java, che andrebbe tenuta allineata a quella del frontend.
2. **Conversione di tutta la partitura**: **Suoni reali** e **Trasposta** convertono il documento, e si scrive sempre nella notazione che si vede. Scartate la vista in sola lettura, meno comoda per chi arrangia, e la scrittura in entrambe le viste con la riconversione al volo di ogni nota, molto più complessa e con più rischi di grafie sbagliate.
3. **Una partitura per traccia**: le parti estratte hanno una sola origine e le divergenze sono chiare. La tabella delle partiture resta separata dalla traccia, così potrà accoglierne altre.
4. **Percussioni su un rigo**: un rigo di percussione tiene tutti gli strumenti della sua parte, una voce per strumento, perché le percussioni non si traspongono; l'estrazione aggiorna la parte con gli stessi strumenti. Scartato un rigo per strumento, che dividerebbe in due parti «Gran cassa e piatti».
5. **Chi vede la partitura**: la scheda Partitura è per chi gestisce la traccia, con la scrittura attiva; soci ed esterni ascoltano le parti come oggi.
6. **Collegamento tra righi e parti**: la parte ricorda il rigo della partitura da cui si estrae (`arrangement_row`) e la versione estratta quella della partitura (`arrangement_version_id`), così lo stato di ogni rigo si ricava senza una mappa delle corrispondenze nelle versioni, che sarebbero immutabili.
7. **Impaginazione delle parti estratte**: un'impaginazione per parte con le stesse opzioni, assegnata al termine alle parti senza pagine; per quelle con pagine si sceglie, come sempre, se sostituirle.

## Estensioni approvate

Le proposte della prima bozza, approvate nella seconda revisione. Ognuna si dettaglia prima della fase che la contiene, indicata tra parentesi.

- **Organico della banda per tenant** (fase 4): un modello con gli strumenti e l'ordine in partitura, usato per le nuove partiture e per ordinare le parti in stampa; descritto in [Organico della banda](#organico-della-banda).
- **Confronto tra versioni** (fase 5): una vista che evidenzia le battute diverse tra due versioni, riusando il confronto per battute già scritto per l'[accuratezza dei motori](runbook-operativo.md#46-accuratezza-dei-motori); utile per rivedere correzioni, estrazioni e approvazioni.
- **Parti di studio** (fase 2): l'ascolto della propria parte con le altre attenuate e il tempo rallentato è già possibile con il lettore; si aggiunge la stampa con le battute numerate, come opzione dell'impaginazione. Verovio numera già la prima battuta di ogni rigo, che diventa il valore proposto per tutte le parti; per le parti di studio l'opzione **Su ogni battuta** numera ogni battuta.
- **Frammenti riutilizzabili** (fase 5): introduzioni, marce d'ordinanza, segnali e rulli di tamburo salvati una volta e inseriti nelle parti.
- **Impaginazione per l'evento** (fase 2): dalla preparazione di un evento, la stampa di tutte le parti di una scaletta già impaginate per strumento, nel formato marcia; descritta in [Stampa della scaletta](#stampa-della-scaletta).
- **Raccolta dai riconoscimenti** (fase 5): le battute che gli archivisti correggono più spesso indicano i difetti dei motori e possono diventare nuove parti del corpus di accuratezza.
