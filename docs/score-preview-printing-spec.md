# Anteprima e stampa degli spartiti

## Stato del documento

ID catalogo: `score-preview-printing`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

## 1. Contesto e obiettivo

Taurus consente di raccogliere in una sola anteprima le pagine degli spartiti appartenenti a una traccia oppure alle tracce di un album. Prima della stampa l'utente può limitare il documento agli strumenti necessari, controllare le singole pagine e aprire una presentazione a schermo intero.

Questa specifica definisce il contratto funzionale, visuale e tecnico della route `/preview`. Il suo scopo è rendere prevedibili:

- l'ingresso da tracce e album;
- la selezione delle parti da includere;
- la consultazione e la presentazione delle pagine;
- la stampa tramite il browser;
- il comportamento della spalla filtri a ogni larghezza;
- gli stati vuoti, l'accessibilità e le verifiche necessarie.

La specifica completa il [Workspace per la gestione delle parti di una traccia](track-parts-workspace-spec.md), che lascia esplicitamente fuori ambito il visualizzatore e il flusso di stampa esistenti. Usa inoltre i principi del [Taurus Layout Standard](taurus-layout-standard.md) e il contratto di accesso ai file della [Gestione centralizzata dei media](media-asset-spec.md).

### Terminologia

- **Parte**: raggruppamento logico di pagine associato a zero o più strumenti.
- **Pagina**: singolo media visualizzabile e stampabile.
- **Foglio**: unità inviata al dialogo di stampa; può contenere uno o due slot di pagina.
- **Spalla filtri**: pannello laterale «Parti da includere».
- **Anteprima**: pagina applicativa usata per filtrare, consultare e avviare la stampa.
- **Presentazione**: visualizzazione delle pagine a schermo intero.

## 2. Ambito

### Compreso

- Apertura dell'anteprima da una traccia, da un album completo o da una selezione di tracce di un album.
- Aggregazione ordinata delle parti e delle relative pagine.
- Filtro per strumento, inclusa la voce «Senza strumento».
- Selezione e deselezione globale delle parti.
- Navigazione tra pagine, adattamento e zoom visuale.
- Presentazione a schermo intero.
- Stampa delle sole pagine incluse dal filtro, con una o due pagine per foglio o nel formato marcia.
- Comportamento responsive della spalla filtri.
- Stati senza contenuto, caricamento ed errore dei media.
- Accessibilità tramite tastiera e tecnologie assistive.

### Fuori ambito

- Modifica di strumenti, parti o immagini dalla pagina di anteprima.
- Riordino, unione, divisione o spostamento delle pagine.
- Elaborazione, ritaglio o correzione dei PDF sorgente.
- Generazione server-side di un nuovo PDF, download ZIP o invio a stampanti proprietarie.
- Persistenza delle preferenze di filtro tra sessioni differenti.
- Annotazioni musicali o grafiche sulle pagine.

## 3. Utenti, autorizzazioni e isolamento tenant

La route è disponibile a super amministratori, amministratori, archivisti, utenti interni e utenti esterni autenticati. L'anteprima non amplia mai la visibilità ricevuta dalla pagina sorgente:

- una traccia o un album può fornire soltanto parti già autorizzate per il ruolo corrente;
- ogni richiesta allo stream di un media applica nuovamente autenticazione, autorizzazione e isolamento tenant lato backend;
- conoscere l'identificativo o l'URL di un media non consente di aggirare i controlli;
- l'anteprima non salva né trasmette una nuova copia dei file;
- titoli, nomi degli strumenti e identificativi dei media non vengono scritti in log o telemetria applicativa.

L'apertura diretta di `/preview` non ricostruisce dati assenti dalla sessione e non effettua ricerche implicite. Se il servizio di stampa non contiene pagine, `PreviewComponent` avvisa l'utente e lo riporta alla superficie precedente, invece di mostrare una pagina vuota inutilizzabile. L'avviso distingue le due cause: lo stato assente dopo un accesso diretto o un ricaricamento e la sorgente priva di pagine.

## 4. Origini e preparazione dei dati

### Traccia

L'azione di anteprima riceve la traccia già caricata, conserva l'ordine delle parti e, dentro ogni parte, l'ordine dei media. Il titolo visualizzato deriva dal nome della traccia; in sua assenza usa «Spartiti selezionati». L'etichetta di contesto è «Traccia».

### Album

L'azione di anteprima usa le tracce selezionate quando la selezione non è vuota; altrimenti usa tutte le tracce dell'album. Le tracce vengono risolte prima della navigazione, mantenendo l'ordine dell'album o della selezione. Il titolo deriva dal nome dell'album e l'etichetta di contesto è «Album».

Un errore durante il caricamento di una o più tracce impedisce l'apertura di un'anteprima parziale silenziosa. `PrinterService` libera lo stato e mostra il riepilogo d'errore «Anteprima non disponibile»; la pagina sorgente — elenco o dettaglio dell'album — conserva la selezione e presenta un avviso con l'azione «Riprova», che ripete il comando con la stessa sorgente e la stessa selezione. L'avviso resta finché l'anteprima non si apre; aprendo un'altra pagina sorgente l'avviso non viene riproposto.

### Scaletta dell'evento

Il programma di un evento apre l'anteprima con **Stampa la scaletta**, descritta nella [stampa della scaletta](music-writing-editor-spec.md#stampa-della-scaletta). Le parti arrivano già caricate con la preparazione e con le sole pagine che la vista mostra a chi stampa, ogni brano una volta. Il titolo deriva dal nome dell'evento, o «Scaletta» in sua assenza, e l'etichetta di contesto è «Scaletta». Le pagine seguono gli strumenti e, per ognuno, l'ordine dei brani; una parte con più strumenti compare una volta, sotto il primo strumento scelto. L'anteprima propone il formato marcia, e le parti che l'evento segnala da impaginare sono contate come quelle di una traccia.

### Durata dello stato

I dati preparati vivono nella sessione applicativa necessaria alla navigazione verso `/preview`. Uscendo dall'anteprima, lo stato viene liberato. Un refresh o un collegamento diretto non ricostruisce la selezione: l'anteprima spiega che i dati non sopravvivono al ricaricamento e torna alla home, senza errori JavaScript.

Non sono richiesti nuovi modelli persistenti, endpoint o migrazioni Liquibase.

## 5. Composizione dell'interfaccia

La pagina usa quattro zone, nell'ordine seguente:

1. intestazione con ritorno, contesto, titolo, metadati e azioni;
2. spalla «Parti da includere»;
3. barra strumenti della pagina corrente;
4. canvas del documento oppure stato vuoto.

### Intestazione

L'intestazione contiene:

- pulsante «Torna indietro»;
- etichetta «Traccia», «Album» o «Scaletta»;
- titolo «Anteprima spartiti»;
- nome della sorgente e numero di pagine incluse;
- pulsante «Filtri»;
- azione secondaria «Presentazione»;
- azione primaria «Stampa n fogli».

Il conteggio e l'etichetta singolare/plurale si aggiornano immediatamente dopo ogni variazione dei filtri. «Presentazione» e «Stampa» sono disabilitati quando non è inclusa alcuna pagina.

### Impostazioni di stampa

La barra strumenti espone soltanto l'impaginazione a una o due pagine. Formato carta e orientamento vengono scelti nel dialogo di stampa del browser o del sistema. Il conteggio dei fogli e l'etichetta del pulsante «Stampa» riflettono la composizione scelta, mentre il conteggio vicino al titolo continua a indicare le pagine dello spartito.

La modalità a due pagine accorpa automaticamente pagine consecutive e mostra nel canvas l'anteprima del foglio risultante. Le due pagine occupano l'intero foglio dell'anteprima, a contatto e senza spaziatura interna. La pagina corrente è evidenziata da un contorno interno che non sottrae spazio alle pagine e non compare nella stampa.

### Spalla filtri

La spalla mostra:

- titolo «Parti da includere»;
- conteggio degli strumenti selezionati sul totale;
- pulsante di chiusura;
- selezione globale «Seleziona tutto»;
- una riga per strumento con nome e numero di pagine;
- voce «Senza strumento» per le parti prive di associazioni;
- righe nell'ordine delle parti della traccia (nell'album, delle tracce e poi delle loro parti): ogni strumento compare alla posizione della prima parte che lo contiene e «Senza strumento» alla posizione della prima parte senza strumenti;
- nota persistente che chiarisce l'aggiornamento automatico e l'effetto sulla stampa.

Ogni strumento compare una sola volta. Il numero mostrato sulla sua riga è la somma delle pagine delle parti associate. Se una parte è associata a più strumenti selezionati, le sue pagine vengono incluse una sola volta.

All'apertura iniziale tutti gli strumenti sono selezionati. «Seleziona tutto» è attivo soltanto quando lo sono tutte le righe; la selezione di una singola riga aggiorna immediatamente conteggi, pagine e stato globale.

### Apertura e chiusura dei filtri

- Da oltre 960 px la spalla è aperta al primo ingresso e occupa una colonna del workspace.
- Fino a 960 px la spalla è chiusa al primo ingresso e si apre sopra il contenuto con una maschera.
- «Filtri» è sempre raggiungibile nell'intestazione e apre la spalla.
- Il pulsante con la X, `Escape` e la maschera mobile chiudono la spalla.
- Chiudendo la spalla, il focus torna a «Filtri».
- Aprendo la spalla da «Filtri» o dallo stato vuoto, il focus passa al suo primo controllo utile.
- «Apri filtri» nello stato vuoto è visibile soltanto quando la spalla è chiusa.
- Una scelta esplicita di apertura o chiusura resta valida durante i successivi cambi di larghezza nella stessa visita.

La chiusura su desktop restituisce al canvas tutta la larghezza disponibile. Su mobile la maschera impedisce l'interazione con il contenuto sottostante finché la spalla è aperta.

## 6. Filtro e stati del contenuto

Il filtro opera sulle parti: una parte è inclusa quando non ha strumenti e la voce «Senza strumento» è selezionata, oppure quando possiede almeno uno strumento selezionato. Le pagine risultanti mantengono l'ordine della sorgente, che per la scaletta di un evento è per strumento.

Dopo ogni filtro:

- la pagina corrente resta invariata se ancora valida;
- se supera il nuovo totale viene limitata all'ultima pagina;
- se non restano pagine, il riferimento interno torna a 1 senza tentare di caricare un media inesistente.

### Stati visuali

| Stato | Presentazione | Azione |
| --- | --- | --- |
| Contenuto disponibile | Pagina corrente nel canvas, navigatore e comandi attivi. | Consulta, presenta o stampa. |
| Nessuna parte selezionata | Icona, titolo, causa esplicita e testo di supporto. | «Apri filtri» quando la spalla è chiusa. |
| Media in caricamento | Segnaposto con proporzione stabile, senza salto di layout. | Nessuna. |
| Media non disponibile | Segnaposto con numero pagina e messaggio recuperabile. | «Riprova». |
| Sorgente senza pagine | `/preview` avvisa della causa e riporta alla superficie precedente. | Nessuna. |
| Stato assente | `/preview` avvisa che i dati non sopravvivono al ricaricamento e torna alla home. | Ripetere il comando dalla traccia o dall'album. |
| Caricamento album fallito | Nessuna anteprima parziale; riepilogo d'errore «Anteprima non disponibile» e avviso persistente sulla pagina sorgente. | «Riprova» sull'avviso, con la stessa sorgente e la stessa selezione. |

## 7. Navigazione, zoom e presentazione

### Navigazione

Quando esiste almeno una pagina, la barra mostra «Pagina x di n», un campo numerico e i pulsanti precedente e successivo. I pulsanti sono disabilitati ai rispettivi estremi. Un valore digitato viene limitato all'intervallo da 1 a n.

Il cambio pagina aggiorna il testo alternativo e porta la nuova pagina nella porzione visibile del canvas. Il navigatore resta distinto dai controlli di zoom.

### Zoom

- Valore iniziale: 100 per cento.
- Passo: 10 punti percentuali.
- Minimo: 60 per cento.
- Massimo: 140 per cento.
- «Adatta» ripristina il 100 per cento.

Lo zoom modifica soltanto il canvas e non la dimensione stampata. Il valore corrente è sempre visibile; i comandi non applicabili sono disabilitati.

### Presentazione

«Presentazione» apre una galleria a schermo intero delle sole pagine incluse. La galleria parte dalla pagina corrente dell'anteprima, consente navigazione avanti e indietro e si chiude con pulsante esplicito o `Escape`. Chiudendola, la pagina corrente resta sincronizzata con l'ultima pagina mostrata.

## 8. Stampa

«Stampa n fogli» invoca il dialogo di stampa del browser. Il documento stampato contiene esclusivamente le pagine risultanti dal filtro, nello stesso ordine dell'anteprima.

Nell'anteprima l'utente sceglie:

- una pagina per foglio, valore predefinito compatibile con il comportamento precedente;
- due pagine per foglio, con accorpamento automatico delle pagine consecutive;
- il formato marcia, proposto per la scaletta di un evento: due pagine di 18 × 13 cm a grandezza reale, una sopra l'altra su un A4 verticale, con una linea di taglio tratteggiata attorno a ogni pagina. Una pagina di un altro rapporto tra i lati si riduce per entrare nel riquadro, e accanto al numero di fogli l'anteprima indica quante sono («1 pagina non in formato marcia, ridotta in stampa»).

Nell'anteprima 2-up Taurus usa il rapporto medio delle immagini per mostrare una composizione coerente per l'intero lavoro: pagine prevalentemente verticali sono rappresentate affiancate, mentre pagine prevalentemente orizzontali sono rappresentate sovrapposte. Questa rappresentazione non imposta l'orientamento del dispositivo. Nel documento stampabile la disposizione segue l'orientamento scelto nel dialogo: due righe in verticale e due colonne in orizzontale.

Una pagina finale senza compagna mantiene la stessa griglia dei fogli precedenti, occupa il primo slot e lascia vuoto il secondo. Con orientamento verticale la pagina resta quindi nella metà superiore e quella inferiore resta bianca; con orientamento orizzontale occupa la metà sinistra e quella destra resta bianca.

L'accorpamento preserva l'intera immagine e non ritaglia automaticamente margini bianchi interni. Formato carta e orientamento effettivi dipendono dalle scelte effettuate nel dialogo di stampa. Un futuro ritaglio basato sull'area di contenuto richiede un'opzione distinta e un'anteprima esplicita.

Regole di composizione:

- uno o due slot per foglio secondo la scelta dell'utente; in modalità 2-up il secondo slot dell'ultimo foglio dispari resta esplicitamente vuoto;
- larghezza e altezza proporzionali, senza deformazione;
- interruzione pagina dopo ogni foglio tranne l'ultimo;
- esclusione di intestazione, navigazione, filtri, maschere e componenti applicativi;
- rimozione dal layout, tramite `display: none`, della superficie interattiva non stampabile;
- azzeramento di altezza minima, margini e spaziature della shell durante la stampa;
- foglio stampabile dimensionato sull'area della viewport di stampa, senza misure A4/A3 applicative;
- nessuna dipendenza dallo zoom del canvas;
- sfondo neutro e nessuna ombra decorativa;
- nessuna pagina vuota iniziale o finale introdotta dal layout.

Taurus non imposta il formato carta né l'orientamento del dispositivo, tranne che nel formato marcia: lì il foglio chiede un A4 verticale senza margini con una pagina con nome (`@page march`), e un browser che non la supporta lascia la scelta al dialogo, dove va indicato l'A4 verticale. Il foglio composto occupa l'area di pagina fornita dal browser; in modalità 2-up le pagine vengono sovrapposte quando nel dialogo è selezionato l'orientamento verticale e affiancate quando è selezionato quello orizzontale. Il dialogo del browser resta autorevole anche per margini fisici e scala finale. Poiché l'accorpamento è già eseguito da Taurus, nel dialogo del browser «Pagine per foglio» deve restare impostato a 1 per evitare un secondo accorpamento.

## 9. Responsive

| Viewport | Comportamento |
| --- | --- |
| Oltre 960 px | Workspace a due colonne; spalla aperta inizialmente e richiudibile; canvas elastico. |
| Da 641 a 960 px | Workspace a colonna singola; spalla overlay chiusa inizialmente; maschera alla sua apertura. |
| Fino a 640 px | Come sopra; testi secondari ridotti, azioni compatte e pulsanti essenziali ancora riconoscibili. |

Il ridimensionamento non deve troncare il canvas, rendere irraggiungibili i comandi o lasciare la maschera visibile dopo la chiusura. La spalla mobile non supera la viewport e conserva uno spazio laterale che renda percepibile il contesto sottostante.

## 10. Accessibilità

- La pagina usa un solo `h1`; lo stato vuoto usa un `h2`.
- La spalla è un landmark con nome programmatico «Parti da includere».
- «Filtri» e «Apri filtri» espongono `aria-controls` e lo stato `aria-expanded` coerente con la spalla realmente visibile.
- La spalla chiusa non contiene elementi raggiungibili dal focus.
- Pulsanti a sola icona possiedono nome accessibile, tooltip quando utile e area attiva minima di 44 × 44 px.
- Apertura, chiusura e passaggio del focus funzionano da tastiera; `Escape` chiude prima la presentazione o la spalla attiva.
- La maschera mobile non sostituisce il pulsante di chiusura ed è identificata come «Chiudi filtri».
- Il cambio del numero di pagine incluse è annunciato tramite una regione `aria-live="polite"` senza interrompere la lettura.
- Ogni immagine usa «Pagina x di n» come minimo; quando disponibile include anche sorgente o parte.
- Focus, stato attivo e disabilitazione non dipendono dal solo colore e rispettano il contrasto del tema.
- Le transizioni rispettano `prefers-reduced-motion`.

## 11. Decisioni tecniche

### Componenti frontend

| Elemento | Responsabilità |
| --- | --- |
| `PrinterService` | Prepara titolo, sorgente e parti; risolve le tracce dell'album; naviga verso `/preview`; libera lo stato all'uscita; su errore non apre un'anteprima parziale, espone lo stato d'errore alla pagina sorgente e ripete il comando su «Riprova». |
| `PreviewComponent` | Deriva strumenti e media, governa filtri, focus, pagina, zoom, presentazione e stampa; tiene lo stato di caricamento ed errore di ogni pagina; senza pagine avvisa della causa e riporta alla superficie precedente. |
| `MediaService` | Costruisce gli stream autenticati e ne risolve il contenuto; il componente lo usa direttamente per distinguere caricamento, esito e nuovo tentativo di una singola pagina. |
| `MediaPlaceholderComponent` | Segnaposto condiviso con proporzione stabile per pagina in caricamento e pagina non disponibile, con azione «Riprova». |
| PrimeNG Checkbox | Selezione binaria globale e per strumento. |
| PrimeNG Galleria | Presentazione a schermo intero. |
| CSS di stampa | Rimuove la shell dal flusso, adatta i fogli all'area fornita dal browser e separa la superficie interattiva dalle pagine stampabili. |

Il componente usa `ChangeDetectionStrategy.OnPush`. Lo stato di apertura della spalla deve avere una fonte coerente anche al primo rendering responsive; la soluzione può usare un breakpoint osservabile oppure uno stato iniziale neutro, purché DOM, attributi ARIA e resa visuale non divergano. L'implementazione risolve il valore una sola volta all'ingresso interrogando il breakpoint dei 960 px, così che `aria-expanded` descriva sempre la spalla realmente visibile.

`SecurePipe` resta il modo predefinito per gli stream autenticati nelle superfici senza stato di errore dedicato e continua a essere usato altrove nel client.

### API e dati

La funzionalità riusa gli stream media esistenti e le letture delle tracce necessarie all'album. Non introduce endpoint dedicati. Il client non concatena byte, non genera file autorevoli e non memorizza URL con credenziali.

### Compatibilità

- Gli ingressi esistenti da elenco/dettaglio Tracce e Album restano invariati.
- L'ordine dei DTO esistenti resta autorevole.
- Le pagine prodotte dall'editor immagini sono normali media e appaiono senza fallback dedicati.
- Browser che non supportano le transizioni usano comunque apertura e chiusura immediate.
- La stampa dipende dalle API standard `window.print` e `@media print`.

## 12. Sicurezza, privacy e osservabilità

- Ogni stream resta protetto dal backend e non viene trasformato in URL pubblico.
- La route non accetta dal client autorizzazioni, tenant o percorsi filesystem.
- Le pagine non vengono inviate a servizi esterni per anteprima o stampa.
- La cache segue le regole dello stream media esistente; la preview non aggiunge persistenza offline.
- Eventuali metriche registrano soltanto sorgente generica, numero di pagine, apertura presentazione, avvio stampa ed esito tecnico di caricamento.
- La telemetria non registra nomi di tracce, album, strumenti, file o identificativi media.
- Gli errori distinguono caricamento della sorgente e caricamento di una pagina senza mostrare dettagli tecnici o URL interni.

## 13. Strategia di test

| Livello | Copertura minima |
| --- | --- |
| Unità | Aggregazione traccia/album, ordine, deduplicazione delle parti multi-strumento, «Senza strumento», selezione globale, raggruppamento 1-up/2-up, ultimo slot vuoto, orientamento dell'anteprima, limiti pagina e zoom, pulizia dello stato, ripetizione del comando dopo un errore dell'album, avviso e uscita quando non ci sono pagine. |
| Componente | Apertura e chiusura da tutti i comandi, classi responsive, maschera, stato vuoto, anteprima del foglio, conteggio fogli, attributi ARIA, focus, `Escape`, azioni disabilitate e sincronizzazione della presentazione. |
| Integrazione frontend | Stream autenticati, errore di una traccia album, errore media e ritorno sicuro dopo refresh diretto. |
| End to end | Ingressi da traccia e album, filtro, stampa intercettata, presentazione, tastiera, viewport desktop/tablet/mobile e ruoli consentiti. |
| Visuale | Tema chiaro/scuro, pagina verticale/orizzontale, nomi lunghi, 1 e molte pagine, spalla aperta/chiusa e anteprima senza selezioni. |
| Stampa | Ordine, numero di fogli, assenza di UI, nessun foglio aggiuntivo, ultimo slot dispari vuoto, adattamento alla carta scelta nel browser e indipendenza dallo zoom. |

I livelli di unità e componente sono automatizzati in `preview.component.spec.ts` e `printer.service.spec.ts` ed eseguiti dalla verifica di modulo. I livelli end to end, visuale e di stampa restano collaudi manuali: il modulo `taurus-fe` non ospita un runner end to end e la stampa reale dipende dal dialogo del browser.

La verifica minima del modulo esegue:

```text
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

## 14. Criteri di accettazione

1. L'anteprima si apre da traccia, album e selezione di tracce mantenendo titolo, contesto e ordine.
2. Tutte le parti sono incluse al primo ingresso e il conteggio usa singolare e plurale corretti.
3. Il filtro per strumento aggiorna immediatamente anteprima, presentazione e stampa senza duplicare parti multi-strumento.
4. Le parti senza strumenti sono controllabili tramite «Senza strumento» e le righe del filtro seguono l'ordine delle parti della traccia, non l'identificativo degli strumenti.
5. «Seleziona tutto» riflette sempre lo stato reale delle righe.
6. Da oltre 960 px la spalla parte aperta; fino a 960 px parte chiusa e si comporta come overlay.
7. «Filtri», X, maschera, «Apri filtri» ed `Escape` producono sempre l'esito dichiarato.
8. Chiudere e riaprire la spalla aggiorna larghezza del canvas, focus e attributi ARIA senza lasciare controlli invisibili raggiungibili.
9. «Apri filtri» appare soltanto quando la spalla è chiusa e apre effettivamente il pannello.
10. Quando il filtro produce zero pagine, lo stato vuoto spiega la causa e presentazione/stampa sono disabilitate.
11. Navigatore e campo numerico non possono portare fuori dall'intervallo valido.
12. Lo zoom resta tra 60 e 140 per cento, «Adatta» torna a 100 e la stampa non ne è influenzata.
13. La scelta una/due pagine aggiorna anteprima, composizione, conteggio e testo del pulsante senza cambiare l'ordine.
14. In modalità 2-up l'anteprima propone una composizione coerente con il rapporto delle immagini; in stampa la griglia segue l'orientamento scelto nel browser.
15. Formato carta e orientamento sono scelti esclusivamente nel dialogo del browser; il foglio composto si adatta alla relativa area di stampa senza imporre un formato applicativo.
16. Con un totale dispari in modalità 2-up, l'ultima pagina resta integra nel primo slot e il secondo slot resta vuoto sul medesimo foglio.
17. La presentazione contiene le sole pagine incluse, parte dalla pagina corrente e mantiene la sincronizzazione alla chiusura.
18. La stampa contiene tutti i media una sola volta, senza UI né fogli vuoti aggiuntivi.
19. Un media in caricamento o errore mantiene stabile il layout e offre un esito comprensibile.
20. Un errore durante la preparazione di un album non apre silenziosamente un documento parziale e la pagina sorgente offre «Riprova» con la stessa selezione.
21. Un refresh o accesso diretto senza stato avvisa della causa, torna in sicurezza alla superficie precedente e non genera errori non gestiti.
22. Tutti i ruoli ammessi vedono soltanto media già autorizzati e gli stream rispettano l'isolamento tenant.
23. Il flusso completo è utilizzabile con tastiera e i pulsanti a sola icona hanno area attiva minima di 44 × 44 px.
24. Test di componente, integrazione e viewport coprono le regressioni della spalla filtri e dell'impaginazione.

## 15. Decisioni adottate

| Decisione | Esito |
| --- | --- |
| Breakpoint della spalla | 960 px. |
| Stato iniziale desktop/mobile | Aperta su desktop, chiusa su tablet e mobile. |
| Persistenza filtri | Limitata alla singola visita; nessun salvataggio utente. |
| Presentazione | Apertura sulla pagina corrente e sincronizzazione bidirezionale. |
| Refresh diretto | Avviso all'utente e ritorno alla home, senza ricostruzione implicita. |
| Stampa | Fogli 1-up/2-up composti dal frontend e affidati al browser; formato e orientamento scelti soltanto nel dialogo di sistema; nessuna generazione PDF server-side. |
