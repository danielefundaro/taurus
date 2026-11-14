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
12. **Disegno per pagina.** Con parti lunghe e partiture l'editor non ridisegna più tutto a ogni modifica: disegna la pagina visibile, con Verovio in un Web Worker, e ridisegna il resto in background. Obiettivo: meno di 150 ms tra tasto e nota disegnata su una partitura di 30 parti.

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

1. Dalla versione corrente di una parte con un solo strumento l'archivista sceglie **Crea una parte da questa**; per una parte con più strumenti il comando è disattivato e lo spiega.
2. Sceglie lo strumento di destinazione, che sarà l'unico strumento della parte nuova. Taurus calcola l'intervallo dalla trasposizione dei due strumenti, propone l'ottava che porta le note più vicine all'estensione dello strumento, mostra l'armatura risultante e segnala le note fuori estensione, se l'estensione è configurata.
3. Si apre l'editor sulla parte trasposta; la parte di origine è indicata nella versione (`parent_version_id`) e nella nuova parte.
4. Il resto segue la nuova parte da zero, dal punto 4.

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

1. Nella nuova scheda **Partitura** della traccia il maestro sceglie **Nuova partitura**, dall'[organico della banda](#organico-della-banda) o dalle parti esistenti della traccia. Ogni rigo della partitura ha un solo strumento, e i righi seguono l'ordine dell'organico.
2. Dalle parti esistenti Taurus unisce le versioni correnti allineando le battute; se le parti hanno numero di battute o ritornelli diversi, lo segnala e lascia scegliere la parte di riferimento, come nella partitura del lettore. Per una parte con più strumenti chiede quale strumento assegnare al suo rigo. I righi di strumenti fuori dall'organico seguono quelli dell'organico, nell'ordine delle parti della traccia.
3. L'editor mostra i sistemi con tutte le parti; si possono nascondere le parti, comprimere i righi vuoti e passare tra suoni reali e trasposizione.
4. **Salva** crea una versione della partitura, **Salva e approva** la crea approvata.
5. **Estrai le parti** mostra, per ogni rigo della partitura, la parte della traccia che riceverà la nuova versione o una parte nuova da creare, e lo stato: nuova, aggiornata, modificata a mano dopo l'ultima estrazione. Riceve la versione solo una parte che ha come unico strumento quello del rigo; per gli altri righi si crea una parte nuova. Dopo la conferma Taurus crea le versioni con origine `ARRANGEMENT`, trasposte per strumento, approvate se lo è la versione della partitura, e offre di impaginarle tutte.

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

1. Da una versione l'archivista sceglie **Impagina**: formato (A4 verticale, A4 orizzontale, formato marcia di 18 × 13 cm in orizzontale), dimensione del rigo, margini, intestazione (titolo della traccia, compositore, arrangiatore, nome della parte) e numerazione delle pagine.
2. Il browser mostra subito un'anteprima con Verovio.
3. **Genera pagine** avvia un job: il servizio musicale produce le pagine PNG a 300 DPI e il PDF.
4. Al termine Taurus chiede se **sostituire le pagine** della parte o **aggiungerle in una parte nuova**; per una parte scritta da zero, senza pagine, le aggiunge direttamente. Le pagine sostituite restano come media della traccia secondo le regole di pulizia esistenti.
5. Pagine e PDF ricordano la versione da cui derivano: l'editor segnala quando la versione corrente è più recente delle pagine e propone di impaginare di nuovo.

### Parti da impaginare

Una parte scritta o ricavata non ha pagine finché non viene impaginata. Non si genera nulla da sola: la segnalazione guida chi gestisce a impaginarla.

- **Workspace Parti**: l'etichetta «Da impaginare» e il pulsante **Impagina**.
- **Anteprima e presentazione**: al posto dell'avviso generico «Nessuna pagina da mostrare», «Parte scritta non ancora impaginata», con il collegamento a **Impagina** per chi gestisce la traccia.
- **Stampa e preparazione degli eventi**: la parte compare come «da impaginare» ed è esclusa dalla stampa, con il conteggio nel riepilogo («2 parti da impaginare non stampate»).
- **Soci**: leggono e ascoltano la parte nella scheda Ascolto, con le regole di visibilità dell'ascolto.

### Organico della banda

L'organico è l'elenco ordinato degli strumenti che suonano abitualmente nella banda del tenant.

- **Dato**: il nuovo campo facoltativo `ensemble_position` dello strumento; vuoto, lo strumento non fa parte dell'organico.
- **Modifica**: la scheda **Organico** della pagina degli strumenti, con trascinamento, per chi gestisce gli strumenti. Un nuovo strumento entra nella posizione della sua famiglia, se il catalogo di riferimento la riconosce.
- **Ordine di riferimento**: il catalogo di riferimento degli strumenti (`InstrumentPlaybackCatalog`) aggiunge famiglia e posizione; **Proponi l'ordine di riferimento** lo applica, e il tenant lo conferma. Senza conferma nessun dato cambia. Le famiglie seguono l'ordine: legni (ottavino, flauti, oboi, fagotti, clarinetti dal piccolo al basso), sassofoni, corni, trombe e cornette, flicorni dal sopranino al baritono ed euphonium, tromboni, flicorni bassi e bassi, timpani e percussioni intonate, percussioni. Gli strumenti numerati («Flauto 1°», «Flauto 2°») seguono il numero; quelli non riconosciuti vanno in fondo.
- **Uso**: nuova partitura dall'organico, ordine dei righi della partitura dalle parti esistenti, ordine delle parti in stampa. Le parti senza strumenti dell'organico seguono, nell'ordine attuale; senza organico la stampa non cambia.

### Scaricamento

MusicXML compresso, MIDI e PDF di una versione, come oggi il MusicXML per MuseScore.

## Interfaccia utente

L'editor si apre a schermo intero, come quello di correzione.

- **Barra superiore**: titolo «Scrittura · nome della parte» con lo stato della bozza sotto («Bozza salvata alle 10:41»), annulla e ripristina, ascolto dal punto selezionato, **Tastiera MIDI**, **Salva**, **Salva e approva**, **Impagina**.
- **Scheda Nota**: l'interruttore **Inserimento**, la voce del cursore da 1 a 4 e lo spostamento del cursore, poi durata e punti, che durante l'inserimento valgono per le note seguenti. Nella scrittura «Inserisci prima» e «Inserisci dopo» della correzione non compaiono, ed «Elimina» diventa **Cancella**, che trasforma la nota in pausa.
- **Scheda Espressione**: dinamiche; **Crescendo**, **Diminuendo**, **Legatura di portamento** e **Togli**, sulla nota o sul passaggio; articolazioni con **Respiro** e **Corona**; **Acciaccatura** e **Appoggiatura**; il testo di espressione con le proposte. I pulsanti si evidenziano quando la nota selezionata ha già il segno.
- **Scheda Struttura**: ritornelli, volte, segni e salti, la lettera di prova con **Numero di battuta**, il tempo con il suo testo.
- **Scheda Impaginazione**, solo nella scrittura: **Continua**, **Nuova riga** o **Nuova pagina** dalla battuta selezionata, e le battute per riga di tutta la parte.
- **Scheda Passaggio**: **Tutta la parte** e **Togli la selezione**; **Copia**, **Taglia**, **Incolla**, con ciò che è negli appunti, e **Ripeti**; la trasposizione con intervallo, direzione e note da trasporre (la selezione o tutta la parte). Le note del passaggio si colorano sullo spartito e le sue battute si evidenziano; la barra di stato lo descrive («Selezione · battute 3–5 · voce 1 · 12 elementi», «Selezione · battute 3–5 · tutte le voci») e l'ascolto suona le sue battute.
- **Palette laterale** a schede: Note, Battuta (metro, armatura, chiave, battute), Struttura (ritornelli, volte, salti, lettere di prova), Espressione (dinamiche, forcelle, articolazioni, legature, testo), Impaginazione (interruzioni di riga e di pagina). Ogni comando indica la sua scorciatoia.
- **Spartito** al centro, con il cursore di inserimento visibile come una barra verticale colorata nella posizione dove andrà la prossima nota.
- **Barra di stato**: battuta, tempo nella battuta, voce, nota selezionata letta per esteso («Battuta 12 · tempo 3 · Sib4 · croma puntata»), già annunciata a chi usa uno screen reader; controlli in tempo reale.
- **Tastiera di pianoforte a schermo**, mostrata da sola sui dispositivi touch e a richiesta con **Pianoforte** nella scheda Nota: due ottave dal Do4 in chiave di violino, dal Do3 in chiave di contralto o di tenore e dal Do2 in chiave di basso, da spostare di un'ottava alla volta. Un tocco suona il tasto e lo scrive come una nota della tastiera MIDI: al cursore con la durata corrente durante l'inserimento, al posto dell'altezza della nota selezionata fuori dall'inserimento. Nelle parti di percussione con strumenti mostra un pulsante per strumento, con la sua voce.
- **Partitura**: elenco delle parti con mostra e nascondi, righi vuoti compressi, interruttore tra suoni reali e trasposizione, scelta della parte da ascoltare in evidenza.
- **Ricavata da**: per le parti estratte o trasposte, un'etichetta con la parte o la partitura di origine e, se divergono, un avviso.
- **Scheda Ascolto**: **Nuova parte scritta**, e per ogni parte **Scrivi** oppure, con una bozza, l'etichetta «Bozza non salvata di …» con **Riprendi la bozza** e **Scarta la bozza**. I comandi stanno accanto a **Correggi** e alle versioni, che sono già nella scheda Ascolto, e sono disattivati finché la traccia ha modifiche da salvare.
- **Workspace Parti**: l'etichetta «Da impaginare», con **Impagina**.

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

- **Documento**: `ScoreDocument` passa da una parte a più parti e più righi, con voci da 1 a 4; i metodi esistenti restano validi per la parte singola. Le regole di accidenti, travature, divisioni e ordine degli elementi MusicXML della correzione restano le stesse.
- **Cursore**: posizione come parte, rigo, voce, battuta e istante nella battuta in frazioni esatte; le operazioni di inserimento lavorano sul cursore, quelle di correzione sulla selezione.
- **Operazioni**: le funzioni di `score-edits.ts` si affiancano a operazioni di scrittura (inserisci al cursore, riempi con pause, dividi e lega oltre la stanghetta, copia e incolla di frammenti MusicXML, trasponi). Ogni operazione dichiara le battute che cambia.
- **Cronologia**: per la parte singola restano le istantanee del documento; per la partitura la cronologia registra solo le battute cambiate, prima e dopo, per non tenere in memoria cento copie di un file di diversi megabyte.
- **Disegno**: Verovio in un Web Worker, con la selezione di un intervallo di battute per disegnare solo la pagina visibile e le battute vicine; il resto si aggiorna in background. La mappa tra `id` e elementi disegnati resta quella della correzione.
- **Ascolto**: il lettore esistente, che già legge una parte qualsiasi di un file a più parti e applica trasposizioni e suoni.
- **MIDI**: un servizio (`MidiInputService`) legge i dispositivi con Web MIDI e riunisce in un accordo le note arrivate entro la soglia mentre la prima è premuta; `score-input.ts` sceglie la grafia dall'armatura, scrive l'altezza esatta conservando il suono delle altre note della battuta e traduce le note di batteria in voce e posizione per le percussioni, sopra le stesse operazioni di inserimento della tastiera del computer. Il pianoforte a schermo passa i suoi tocchi alla stessa strada.
- **Bozze e blocco**: un servizio che salva la bozza con ritardo, ne conserva una copia in IndexedDB e rinnova il blocco ogni 30 secondi. La copia resta in IndexedDB anche quando il server la rifiuta, fino all'accettazione o allo scarto. L'editor di correzione usa lo stesso servizio per il blocco, senza bozze.

### Backend

- **Versioni delle parti**: `score_version` esistente, con le nuove origini `WRITING` e `ARRANGEMENT`. Il salvataggio usa la stessa richiesta JSON della correzione, con controlli e limiti invariati, più il controllo del blocco, che vale anche per le correzioni.
- **Partiture**: nuove entità per la partitura della traccia e le sue versioni, con lo stesso modello immutabile delle parti.
- **Estrazione**: il backend divide la versione della partitura in parti, applica la trasposizione dello strumento e crea le versioni delle parti in una transazione; i controlli MusicXML esistenti (`MusicXmlInspector`) valgono anche qui.
- **Impaginazione**: job su una nuova coda RabbitMQ, con lo stesso schema del riconoscimento (tabella dei job come fonte di verità, recupero pianificato), senza notifica al termine: l'editor legge lo stato del job.

### Servizio musicale

`taurus-omr` aggiunge `POST /v1/engravings`: riceve un MusicXML e le opzioni di impaginazione e restituisce il PDF e le pagine PNG. Usa Verovio per Python e Cairo, gli stessi strumenti con cui il test di accuratezza disegna il proprio corpus, già provati con il carattere musicale incorporato. Il servizio resta interno, senza stato e senza accesso a database o storage.

Verovio ha la stessa versione nel frontend, nel servizio e nel test di accuratezza, così l'anteprima del browser e le pagine generate coincidono. Le versioni si aggiornano insieme, e un controllo del repository fallisce se divergono.

## Modello dati e migrazioni

Changelog nello schema del tenant. Tutte le nuove tabelle hanno i campi di audit e, se modificabili, `entity_version`.

| Tabella | Contenuto |
| --- | --- |
| `score_version` (esistente) | nuove origini `WRITING` e `ARRANGEMENT`; nuova colonna facoltativa `arrangement_version_id` per le versioni estratte |
| `track_arrangement` | `id`, `track_id`, `name`, `current_version_id`, `concert_pitch` (scrittura in suoni reali) |
| `arrangement_version` | `id`, `arrangement_id`, `version_number`, `status`, `media_asset_id` (MusicXML compresso a più parti), `parent_version_id`, `part_map_json` (parte della partitura → parte della traccia), `measure_count`, `checks_json`, approvazione; univoco `(arrangement_id, version_number)` |
| `score_draft` | `id`, tipo e identificativo del bersaglio (parte o partitura), `base_version_id`, `content` (MusicXML compresso; il testo inviato non supera il limite dei caricamenti, 10 MB), `saved_by`, `saved_at`, `entity_version`; una bozza per bersaglio |
| `score_edit_lock` | tipo e identificativo del bersaglio, `owner`, `owner_name`, `acquired_at`, `heartbeat_at`, `expires_at`; univoco per bersaglio |
| `score_engraving_job` | `id`, `sheet_music_id`, `score_version_id`, `options_json`, `status`, `attempts`, `error_code`, `pdf_media_asset_id`, `page_count`, audit |
| `sheet_music` (esistente) | `engraved_from_version_id` facoltativo: versione da cui derivano le pagine generate |
| `instrument` (esistente) | `lowest_written_pitch`, `highest_written_pitch`: estensione scritta come numeri di nota MIDI, facoltativi, proposti dal catalogo di riferimento come suono e trasposizione; `ensemble_position` facoltativo: posizione nell'[organico della banda](#organico-della-banda) |
| `track` (esistente) | `arranger` facoltativo, come `composer`: mostrato nel dettaglio della traccia e nell'intestazione delle pagine |

Pagine e PDF generati sono media delle categorie esistenti; `MediaRepository.isUnreferenced` aggiunge i riferimenti dei job e delle partiture. La funzionalità `SCORE_WRITING` richiede una colonna del flag nel registro dei tenant, come le altre funzionalità.

## API REST

Sotto `/api/tracks/{trackId}`, per super amministratore, amministratore e archivista con la funzionalità attiva:

| Metodo e percorso | Descrizione |
| --- | --- |
| `POST /scores/{scoreId}/score-versions` (esistente) | salvataggio di una versione scritta, con `origin: WRITING` |
| `GET`, `PUT`, `DELETE /scores/{scoreId}/score-draft` | bozza della parte; `PUT` con `entityVersion` per evitare sovrascritture |
| `POST /written-parts` | parte scritta da zero in fondo alla traccia, senza pagine: descrizione, strumenti, MusicXML iniziale e versione della traccia; crea anche la prima bozza, di chi la scrive |
| `POST`, `PUT`, `DELETE /scores/{scoreId}/edit-lock` | prende, rinnova e rilascia il blocco; `POST ?takeOver=true` prende il controllo |
| `POST /scores/{scoreId}/derive` | crea una parte nuova da una versione, con strumento di destinazione e ottava |
| `GET`, `POST /arrangements`, `GET /arrangements/{id}/versions` | partiture della traccia e loro versioni |
| `POST /arrangements/{id}/versions/{versionId}/extract` | estrazione delle parti, con la corrispondenza confermata |
| `GET`, `PUT`, `DELETE /arrangements/{id}/draft`, `.../edit-lock` | bozza e blocco della partitura |
| `POST /scores/{scoreId}/score-versions/{versionId}/engravings` | avvia l'impaginazione; `GET` ne legge lo stato |
| `GET /scores/{scoreId}/score-versions/{versionId}/file` (esistente) | scaricamento del MusicXML; nuovo parametro `format=midi\|pdf` |

L'organico si salva con `PUT /api/instruments/ensemble`, che riceve l'elenco ordinato degli strumenti che ne fanno parte, per chi gestisce gli strumenti; `GET /api/instruments/ensemble/reference` restituisce l'ordine di riferimento proposto, senza salvarlo.

Il blocco di una parte (`/scores/{scoreId}/edit-lock`) richiede solo l'ascolto (`SCORE_PLAYBACK`), perché lo usa anche l'editor di correzione; con `SCORE_WRITING` disattivata restano disponibili solo il blocco e il salvataggio delle correzioni.

Errori nuovi, secondo lo [standard](application-errors-standard.md): `scoreWriting.locked` (409, con nome e ora di chi scrive; anche per bozze e versioni inviate senza il blocco), `scoreWriting.draftOutdated` (409), `scoreWriting.instrumentNotFound` (400, per uno strumento inesistente nella parte scritta da zero), `scoreWriting.instrumentNotConfigured` (422, per l'estrazione), `scoreWriting.engravingUnavailable` (503). Una parte scritta da zero su una traccia modificata nel frattempo riceve `version.conflict` (409).

## Autorizzazioni e isolamento tenant

- Scrittura, bozze, blocchi, estrazione e impaginazione sono riservati a super amministratore, amministratore e archivista, sui percorsi di gestione; utenti ed esterni continuano a vedere solo le versioni, con le regole di visibilità dell'ascolto.
- Bozze e blocchi stanno nello schema del tenant; il blocco riporta il nome di chi scrive solo agli utenti dello stesso tenant.
- Le bozze di un utente cancellato restano finché il bersaglio esiste, perché il contenuto è musica dell'archivio e non un dato personale; il nome dell'autore nel blocco scompare alla scadenza.

## Osservabilità e sicurezza

- Metriche: `taurus.score.writing.saves{origin}`, `taurus.score.writing.drafts{outcome}`, `taurus.score.writing.locks{outcome}` (`acquired`, `takenOver`, `expired`), `taurus.score.engravings{outcome}` e la durata dell'impaginazione.
- Log con identificativi di parte, partitura, versione e job; mai il contenuto MusicXML.
- Gli stessi limiti di sicurezza dei file MusicXML caricati (entità e DTD disattivate, limiti di dimensione); bozze entro lo stesso limite dei caricamenti (`application.score-playback.max-upload-bytes`, 10 MB di MusicXML non compresso) e al più un salvataggio ogni due secondi per bozza (`application.score-writing.draft-min-interval`), che una sola finestra alla volta può scrivere perché serve il blocco.
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

## Strategia di test

- **Unità (frontend)**: ogni operazione di scrittura su documenti minimi, come le specifiche di `score-edits`: inserimento al cursore, battute sempre complete, divisione e legatura alla stanghetta, voci, copia e incolla, trasposizione con accidenti e armatura, partitura e cronologia per battute; inserimento da MIDI con un dispositivo simulato (accordi entro e oltre la soglia, legato che non forma accordi, Note On con intensità 0, grafia, vista trasposta e suoni reali, percussioni con uno o più strumenti); copia nel browser conservata dopo un rifiuto e proposta alla riapertura.
- **Validità**: ogni documento prodotto dai test viene validato contro lo schema XSD di MusicXML 4.0; un campione si apre in MuseScore durante la verifica manuale.
- **Andata e ritorno**: scrivere, salvare, riaprire e scaricare produce lo stesso MusicXML, senza attributi di lavoro.
- **Backend**: bozze con concorrenza ottimistica, eliminate al salvataggio di una versione e con la parte o la partitura, blocchi con rinnovo, scadenza e presa di controllo, organico con ordine di riferimento proposto e non salvato, bozze e versioni scritte o corrette rifiutate senza il blocco, estrazione con trasposizione per rigo e strumenti non configurati, derivazione rifiutata per parti con più strumenti, job di impaginazione con il servizio simulato, autorizzazioni e isolamento tenant.
- **Servizio musicale**: impaginazione su MusicXML noti, con conteggio delle pagine e confronto delle immagini entro una tolleranza; controllo che la versione di Verovio coincida con quella del frontend.
- **Prestazioni**: misure ripetibili del disegno su parti e partiture grandi.
- **Manuale**: prove con archivisti su parti reali, tempo per scrivere una parte di una pagina, uso su tablet, tastiera MIDI reale su Chrome, Edge e Firefox.

## Criteri di accettazione

- [ ] Con `SCORE_WRITING` disattivata nessuna azione di scrittura è visibile e le API di scrittura rispondono `403`; il blocco delle parti resta attivo per la correzione.
- [ ] Un archivista scrive da zero una parte di una pagina con la sola tastiera; le battute restano complete e la parte si ascolta.
- [ ] Con una tastiera MIDI collegata, in Chrome ed Edge, le note suonate si scrivono al cursore e quelle premute insieme diventano accordi, mentre una melodia suonata legata no; dove Web MIDI non esiste il comando non compare.
- [ ] In una parte di percussione con più strumenti, le note di batteria degli strumenti della parte si scrivono nella voce e nella posizione del loro suono e si riascoltano con lo stesso suono.
- [ ] **Salva e approva** approva la versione senza l'intervento di una seconda persona e chiude le segnalazioni aperte della parte.
- [ ] Una parte di clarinetto in Sib diventa la parte di sax contralto in Mib con l'intervallo e l'armatura corretti, e le note fuori estensione sono segnalate; una parte con più strumenti non si deriva.
- [ ] Chiudendo il browser durante la scrittura e riaprendo l'editor si riprende la bozza.
- [ ] Le modifiche fatte senza connessione e rifiutate perché il blocco è passato a un altro non si perdono: si scaricano subito o si riprendono alla riapertura con il blocco libero.
- [ ] Un secondo utente vede chi sta scrivendo o correggendo e apre in sola lettura; la presa di controllo conserva la bozza del primo, che da quel momento non salva più né bozza né versione.
- [ ] Nessuna azione della scrittura, dell'estrazione o dell'impaginazione crea notifiche.
- [ ] Una partitura di 30 parti si scrive senza ritardi percepibili e si estrae in parti trasposte per strumento.
- [ ] Una parte scritta si impagina in A4 e nel formato marcia, compare in anteprima e si stampa come le parti dei PDF.
- [ ] Prima dell'impaginazione la parte è «da impaginare» nel workspace, in anteprima e in stampa, che la esclude e la conta nel riepilogo; il socio la legge e la ascolta nella scheda Ascolto.
- [ ] Una partitura nuova segue l'ordine dell'organico, e la stampa ordina le parti allo stesso modo; senza organico la stampa non cambia.
- [ ] Il MusicXML scaricato si apre in MuseScore senza avvisi.
- [ ] Nessun dato di un tenant è accessibile da un altro tenant.

## Piano di implementazione

1. **Scrittura di una parte**: modalità di inserimento con cursore e voci, battute sempre complete, selezione di intervalli, copia, incolla e trasposizione, nuova notazione (legature di portamento, forcelle, lettere di prova, testo, corona, respiro, abbellimenti), inserimento da tastiera MIDI con `midi=(self)`, accordi e percussioni, bozze, copia nel browser e blocco, anche nell'editor di correzione, nuova parte da zero, approvazione da parte di chi scrive, funzionalità `SCORE_WRITING`.
2. **Impaginazione e stampa**: servizio di impaginazione con Verovio allineato al frontend, job e coda, pagine e PDF della parte, formati A4 e marcia, battute numerate a ogni rigo, arrangiatore della traccia, parti da impaginare, indicazione delle pagine non aggiornate, impaginazione per l'evento.
3. **Parti ricavate**: derivazione per un altro strumento, estensione degli strumenti con proposta dal catalogo e avvisi, scaricamento MIDI.
4. **Partitura**: organico della banda per tenant, documento a più parti, disegno per pagina in un Web Worker, suoni reali e trasposizione, partitura dalle parti esistenti, estrazione per rigo e divergenze, cronologia per battute.
5. **Estensioni**: confronto tra versioni, frammenti riutilizzabili, raccolta dai riconoscimenti.
6. **Qualificazione**: misure su partiture grandi, prove con archivisti e su tablet, runbook.

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

## Estensioni approvate

Le proposte della prima bozza, approvate nella seconda revisione. Ognuna si dettaglia prima della fase che la contiene, indicata tra parentesi.

- **Organico della banda per tenant** (fase 4): un modello con gli strumenti e l'ordine in partitura, usato per le nuove partiture e per ordinare le parti in stampa; descritto in [Organico della banda](#organico-della-banda).
- **Confronto tra versioni** (fase 5): una vista che evidenzia le battute diverse tra due versioni, riusando il confronto per battute già scritto per l'[accuratezza dei motori](runbook-operativo.md#46-accuratezza-dei-motori); utile per rivedere correzioni, estrazioni e approvazioni.
- **Parti di studio** (fase 2): l'ascolto della propria parte con le altre attenuate e il tempo rallentato è già possibile con il lettore; si aggiunge la stampa con le battute numerate a ogni rigo, come opzione dell'impaginazione.
- **Frammenti riutilizzabili** (fase 5): introduzioni, marce d'ordinanza, segnali e rulli di tamburo salvati una volta e inseriti nelle parti.
- **Impaginazione per l'evento** (fase 2): dalla preparazione di un evento, la stampa di tutte le parti di una scaletta già impaginate per strumento, nel formato marcia.
- **Raccolta dai riconoscimenti** (fase 5): le battute che gli archivisti correggono più spesso indicano i difetti dei motori e possono diventare nuove parti del corpus di accuratezza.
