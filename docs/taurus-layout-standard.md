# Taurus Layout Standard

## Stato del documento

ID catalogo: `taurus-layout-standard`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

## Obiettivo

Le superfici del frontend sono state scritte in tempi diversi e non condividono struttura, densità né comportamento. Questa specifica copre tre ambiti:

- **Pagine elenco**: un unico guscio di pagina e due composizioni del contenuto, riga in vista lista e card in vista griglia.
- **Pagine di dettaglio**: un unico guscio a quattro zone e una regola esplicita su quale pulsante salva cosa.
- **Modali e avvisi**: un unico guscio di dialogo, una conferma con tre gravità, e una sola scala per toast e banner.

A tutti e tre si applicano le regole trasversali che governano lingua, stati, gerarchia dei pulsanti e persistenza delle preferenze.

I tre ambiti condividono componenti: l'intestazione è la stessa fra elenco e dettaglio, e il campo di modulo è lo stesso dentro e fuori da un dialogo.

Una precisazione sul metodo. L'applicazione contiene oggi tre vocabolari di design paralleli: quello delle pagine elenco e dettaglio, copiato di file in file e il più diffuso; quello dei widget della dashboard; e quello della pagina `preview`. I due più recenti sono già vicini a quanto la specifica prescrive — `preview` implementa già l'intestazione qui definita per le pagine di dettaglio, e i widget della dashboard contengono già una riga di elenco, uno stato vuoto e un'intestazione di sezione. Il lavoro non è quindi progettare uno standard nuovo, ma promuovere a standard quello che le parti migliori già fanno ed estenderlo alle altre. È una differenza che conta, perché sposta il rischio: il modello è in produzione, non è un'ipotesi.

L'obiettivo non è uniformare l'estetica per gusto, ma rendere prevedibile la posizione di ogni comando: chi sa usare una pagina deve saperle usare tutte, e chi ha letto una conferma deve sapere cosa aspettarsi dalla successiva.

## Ambito

Nove pagine elenco sotto `taurus-fe/src/app/pages`:

`legal-documents`, `tenants`, `users`, `finance`, `inventory`, `albums`, `tracks`, `instruments`, `calendar-events`.

Nove pagine di dettaglio:

`instruments/detail`, `users/detail`, `tenants/detail`, `albums/detail`, `tracks/detail`, `calendar-events/detail`, `inventory/detail`, `inventory/assignment-detail`, `profile`.

Gli undici componenti sotto `taurus-fe/src/app/dialogs`, le sei `p-dialog` dichiarate inline in `finance` e `legal-documents`, e i tre canali di avviso: `ToastService`, `ConfirmationService` e i banner inline, ovunque compaiano, compresa `legal-acceptance`.

La dashboard non rientra fra le superfici da ridisegnare, ma i suoi sei widget rientrano nell'analisi: contengono già una versione propria di tre dei componenti condivisi da costruire, e vanno letti prima di scriverli.

Rientrano infine `notfound` e `forbidden`, non come ridisegno ma come correzione di una parte mai adattata dal template di partenza.

Elenchi e conteggi descrivono il censimento da cui è nata la specifica. Le superfici aggiunte in seguito, come i dialoghi di fogli di affidamento, firma elettronica e ascolto delle parti o le pagine di onboarding e amministrazione delle consegne, seguono le stesse regole.

## Pagine elenco: stato prima dell'adozione

Le pagine si dividono in tre famiglie tecniche che non condividono codice:

- sei `p-dataview` derivate dallo stesso copia-incolla: `albums`, `tracks`, `users`, `tenants`, `instruments`, `calendar-events`;
- due `p-table`: `legal-documents` e `finance`;
- `inventory`, la più evoluta, che diverge da entrambe.

| Pagina | Base | Intestazione | Viste | Selezione | Stato vuoto | Caricamento | Sintassi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `legal-documents` | `p-table` | sì | solo tabella | no | sì | sì | `@if` / `@for` |
| `tenants` | `p-dataview` | no | lista, griglia | solo lista | no | no | `*ngIf` / `*ngFor` |
| `users` | `p-dataview` | no | lista, griglia | solo lista | no | no | `*ngIf` / `*ngFor` |
| `finance` | `p-table`, 5 schede | sì | solo tabella | no | sì | sì | `@if` / `@for` |
| `inventory` | `p-dataview` | dentro la dataview | lista, griglia | no | sì | sì | `@if` / `@for` |
| `albums` | `p-dataview` | no | lista, griglia | solo lista | no | no | `*ngIf` / `*ngFor` |
| `tracks` | `p-dataview` | no | lista, griglia | solo lista | no | no | `*ngIf` / `*ngFor` |
| `instruments` | `p-dataview` | no | lista, griglia | solo lista | no | no | `*ngIf` / `*ngFor` |
| `calendar-events` | `p-dataview` più griglia custom | no | lista, calendario | solo lista | no | no | `*ngIf` / `*ngFor` |

### Criticità rilevate

**Gerarchia.** Sei pagine su nove non hanno alcun titolo: l'utente riconosce dove si trova solo dalla voce di menu evidenziata. Dove il titolo esiste è realizzato in tre modi diversi — `h1` in `finance`, `h2` dentro l'intestazione della dataview in `inventory`, blocco autonomo in `legal-documents`.

**Azioni.** L'azione primaria della pagina è collocata dentro la barra dei filtri, allineata a destra insieme a ricerca, ordinamento e cambio vista. In `tracks` due azioni di creazione, «Carica» e «Nuovo», sono affiancate senza gerarchia visiva.

**Densità.** Le righe usano `p-6` con titolo `text-2xl`: oltre 130 pixel per riga, e il titolo di una singola riga è grande quanto il titolo di una pagina. Un elenco di dieci elementi richiede due schermate.

**Spazio morto.** Cinque pagine su sei applicano `pt-12` sotto l'immagine della card, introducendo 3 rem di vuoto tra media e titolo. Le card risultano alte il doppio del necessario e disallineate tra loro sulla stessa riga, perché l'altezza dipende dalla lunghezza della descrizione.

**Selezione.** La selezione multipla esiste solo in vista lista. Passando alla griglia la funzionalità scompare senza segnalazione.

**Stati.** Con zero risultati la dataview mostra un riquadro vuoto senza spiegazione né via d'uscita: solo `inventory` definisce `<ng-template #empty>`. Durante il caricamento non c'è indicatore: solo `inventory` e `finance` espongono lo stato.

**Impaginazione.** `paginatorPosition` vale `'both'` quando la collezione ha più di un elemento, duplicando i controlli anche in testa all'elenco.

**Lingua.** Cinque pagine offrono ordinamenti etichettati «Name A-Z» e «Name Z-A» in un'interfaccia interamente italiana.

**Permessi.** In `albums` e `tracks` la stessa terna di ruoli è ripetuta su otto elementi per template, invece di essere applicata al gruppo che li contiene.

## Guscio comune di pagina

Ogni pagina elenco si compone sempre delle stesse zone, nello stesso ordine. Le zone contrassegnate come opzionali si omettono, non si spostano.

| Zona | Obbligatoria | Contenuto |
| --- | --- | --- |
| Intestazione | sì | Titolo, sottotitolo con il conteggio, azioni primarie |
| Contesto | no | Riepiloghi, avvisi, cambio ambito |
| Barra strumenti | sì | Ricerca, ordinamento, filtri; cambio vista in chiusura a destra |
| Barra di selezione | no | Azioni massive, visibile solo con selezione attiva |
| Contenuto | sì | Righe o card secondo la vista attiva |
| Impaginazione | sì | Solo in fondo, con riepilogo dei record |
| Stato vuoto | no | Icona dell'entità, causa, via d'uscita |

**Intestazione.** Il titolo è sempre un `h1` con classi `text-2xl font-semibold`. Il sottotitolo riporta il conteggio reale dei record restituiti dal backend. Le azioni che creano qualcosa — «Nuovo», «Carica», «Trasferimento» — vivono qui e solo qui, allineate a destra: al massimo una con severità `primary`, le altre `secondary`.

**Contesto.** Ospita ciò che oggi è disperso: le card di riepilogo di `finance`, l'avviso GDPR e il selettore «Inventario / I miei oggetti» di `inventory`, il banner informativo di `legal-documents`, la navigazione mensile di `calendar-events`.

**Barra strumenti.** Ordine invariabile: ricerca elastica, ordinamento, eventuali filtri specifici della pagina. Il selettore di vista è l'ultimo elemento della riga, allineato a destra, in ogni pagina.

**Barra di selezione.** Compare solo quando almeno un elemento è selezionato, su sfondo `primary-50`. Sostituisce l'attuale riga «Seleziona tutto» sempre visibile. Vale sia in vista lista sia in vista griglia.

**Impaginazione.** Sempre e solo in fondo, con `showCurrentPageReport` attivo e template italiano `Da {first} a {last} di {totalRecords} elementi`. `rowsPerPageOptions` vale `[12, 24, 48]`: multipli di 3 e 4, così l'ultima riga della griglia non resta spaiata su nessun breakpoint.

**Stato vuoto.** Icona dell'entità, causa esplicita, azione. Il testo distingue due casi: elenco vuoto perché non esiste ancora nulla, in cui l'azione è creare un elemento; elenco vuoto perché la ricerca non ha prodotto risultati, in cui l'azione è azzerare i filtri.

**Regola comune alle due viste.** Le azioni di riga e di card sono le stesse, nello stesso ordine: azione primaria con etichetta, poi le secondarie come sole icone, e l'eliminazione sempre per ultima con severità `danger`.

## Composizione A — vista lista

La lista serve a scorrere e confrontare. La riga si compone di cinque fasce a larghezza prevedibile, così nomi, valori e pulsanti restano incolonnati da un elemento all'altro e da una pagina all'altra.

```
[ selezione ] [ miniatura ] [ identità ................ ] [ metriche ] [ azioni ]
    17 px        56 px           elastica                    auto        auto
```

**Riga.** Padding verticale `py-3.5`, separatore `border-b`, altezza risultante di circa 88 pixel contro i 130 attuali.

**Selezione.** Casella binaria da 17 pixel, prima fascia della riga.

**Miniatura.** Quadrato di 56 pixel con `border-radius` di tema. Immagine reale dove esiste, come in `inventory`; in assenza, iniziali dell'entità tramite la pipe `initials`; per `calendar-events` il riquadro giorno/mese già in uso.

**Identità.** Titolo `text-base font-semibold`, non più `text-2xl`. Descrizione su una riga con ellissi. Sotto, al massimo tre tag più un contatore `+N`: identificativo, stato, classificazione.

**Metriche.** Colonna numerica allineata a destra con `tabular-nums`, etichetta minuscola sotto il valore. Si nasconde sotto il breakpoint `md`. Dove non esistono valori numerici la fascia ospita gli attributi secondari — email, sezione, compositore — oppure resta vuota mantenendo l'incolonnamento.

**Azioni.** Azione primaria con etichetta, secondarie come sole icone, eliminazione per ultima con severità `danger`.

**Evidenza di stato.** Gli stati particolari — album pubblico, traccia pubblica, elemento in scadenza — si marcano con una barra laterale di 3 pixel. Non si colora il fondo dell'intera riga, come oggi fanno `albums` e `tracks`.

## Composizione B — vista griglia

La griglia serve a riconoscere, non a confrontare: mostra meno campi della lista, ma li mostra tutti alla stessa altezza. Guscio, barra strumenti e impaginazione restano identici alla vista lista.

**Griglia.** `col-span-12 sm:col-span-6 lg:col-span-4 xl:col-span-3`. Oggi ci si ferma a `lg:col-span-4` e su monitor larghi le card si allargano a dismisura. Gap uniforme `gap-4`, senza `p-2` annidato dentro le colonne.

**Altezza.** Card in `flex flex-col h-full`, descrizione in `flex-1` con troncamento a due righe. Il piede resta ancorato in basso e tutte le card della riga chiudono alla stessa quota. Il `pt-12` viene rimosso.

**Media.** Fascia con proporzione 16:9 in testa alla card, bordo solo inferiore, senza riquadro dentro il riquadro. Immagine reale dove esiste; in assenza, iniziali o icona dell'entità su fondo `surface`.

**Selezione.** Casella in sovrimpressione in alto a sinistra sulla media: visibile all'hover e sempre visibile quando la selezione è attiva. Colma il divario odierno per cui in griglia non si può selezionare nulla.

**Corpo.** Ordine fisso: tag di stato, titolo `text-base font-semibold`, descrizione a due righe. I tag sono gli stessi della vista lista, così l'utente riconosce le stesse informazioni cambiando vista.

**Fascia metriche.** Da due a tre celle numeriche divise da separatori verticali, con le stesse etichette usate dalla colonna metriche della vista lista. Si omette dove non esistono valori numerici: la card resta valida senza.

**Piede.** Azione primaria a piena larghezza più le secondarie come sole icone, nello stesso ordine della riga lista. L'eliminazione è l'ultimo pulsante.

**Evidenza di stato.** Barra superiore di 3 pixel al posto del fondo colorato. All'hover, `border-color` primario e `translateY(-2px)`: la transizione già presente in `inventory`, estesa a tutte le pagine.

### Eccezioni

`calendar-events` ha come seconda vista una griglia di giorni, non di card: mantiene l'icona `pi-calendar` nel selettore e la propria griglia mensile, e adotta tutto il resto.

`finance` e `legal-documents` non hanno doppia vista: sono tabelle e tali restano. Ereditano guscio, intestazione, barra strumenti, stato vuoto e impaginazione.

## Regole trasversali delle pagine elenco

**Una sola sintassi di template.** Blocchi `@if` e `@for` ovunque, con `track` esplicito. Oggi sei pagine su nove usano ancora `*ngIf` e `*ngFor`, con `NgIf` e `NgFor` importati globalmente da `imports.ts`.

**Interfaccia interamente in italiano.** Etichette di ordinamento, placeholder, tooltip, riepiloghi di impaginazione e messaggi di stato vuoto. I testi interni dei componenti PrimeNG, come nomi di mesi e giorni del calendario, pulsanti «Oggi» e «Cancella» e messaggi senza risultati, arrivano dalla traduzione globale `PRIMENG_TRANSLATION_IT` registrata in `app.config.ts`, con la settimana che inizia di lunedì. Le etichette `Name A-Z` e `Name Z-A` di `albums`, `tracks`, `users`, `tenants` e `instruments` diventano `Nome A-Z` e `Nome Z-A`.

**Stato di caricamento sempre visibile.** `[loading]` legato sulla dataview e sulla tabella, con scheletri che riprendono la forma della vista attiva — righe o card — invece di uno spinner sovrapposto.

**Stato vuoto con una via d'uscita.** Come definito nel guscio comune, con testo differenziato tra elenco realmente vuoto e ricerca senza risultati.

**Il permesso governa il gruppo, non il singolo pulsante.** `*hasRoles` applicato al gruppo azioni e alla colonna azioni, non ripetuto su ogni pulsante.

**Densità coerente.** Riga `py-3.5`, card `p-4`, titolo di riga o card `text-base`. Il `text-2xl` resta riservato al titolo di pagina.

**Icone del selettore di vista.** `pi-bars` per la lista, `pi-th-large` per la griglia, `pi-calendar` per la vista calendario di `calendar-events`. Oggi la griglia usa `pi-table`, che rappresenta una tabella e non una griglia di card.

## Persistenza della vista scelta

La vista attiva è una preferenza dell'utente e si conserva sul database, con la stessa continuità già garantita al colore primario, al tema chiaro o scuro, al preset e alla modalità di menu.

### Modello

Nessuna nuova tabella e nessuna migrazione Liquibase. Si riusa la tabella `preferences`, che è già una struttura chiave/valore isolata per utente e per tenant grazie ai campi `user_id` e `tenant_code`, ed è già esposta dal backend tramite `PreferencesResource` su `/api/preferences`.

- Chiave: `listLayout.<pagina>`, dove `<pagina>` è il segmento di rotta — `listLayout.albums`, `listLayout.tracks`, `listLayout.users`, `listLayout.tenants`, `listLayout.instruments`, `listLayout.inventory`, `listLayout.calendar`.
- Valore: `list` oppure `grid`. Per `calendar-events` i valori ammessi restano `list` e `grid`, dove `grid` identifica la vista calendario, coerentemente con l'implementazione odierna.
- Valore predefinito in assenza di riga: `list`, per tutte le pagine.

La colonna `value` è un `varchar(255)`: una riga per pagina è ampiamente compatibile e mantiene il modello già usato da `LayoutService.saveConfig`, che scrive una riga per ogni chiave di configurazione.

Le pagine senza doppia vista — `finance` e `legal-documents` — non scrivono alcuna preferenza.

### Lettura all'avvio

L'idratazione delle preferenze dal backend esiste già. `AppComponent.ngOnInit` recupera tutte le preferenze dell'utente con una sola `getAll` e scrive ciascuna in `localStorage` tramite `LocalStorageService`; solo dopo applica alle signal di `LayoutService` le chiavi note, tramite uno `switch` esplicito su `preset`, `primary`, `menuMode`, `surface`, `darkTheme` e sugli stati del menu.

Quelle chiavi, come il preset che il configuratore della topbar riapplica quando nasce, di solito riscrivono valori che `layoutConfig` ha già. La signal confronta i valori nella forma in cui `saveConfig` li salva, con `null` uguale alla stringa vuota, e una configurazione uguale non notifica. Senza questo confronto ogni pagina partiva con la View Transition del cambio di tema, che per circa mezzo secondo copre il documento e ne intercetta i clic. Un cambio vero, come il passaggio al tema scuro, resta animato.

La lettura parte solo dopo `GET /api/tenant-status`. Se il tenant della sessione non ha ancora uno schema, come nella modalità bootstrap del primo accesso descritta nel [runbook operativo, §5.2](runbook-operativo.md#52-primo-accesso-su-ambiente-vuoto), le preferenze non vengono lette: `ListLayoutService` viene idratato con un elenco vuoto e tema e liste usano i valori predefiniti.

Poiché la scrittura in `localStorage` avviene per ogni preferenza restituita e non solo per quelle riconosciute dallo `switch`, le chiavi `listLayout.<pagina>` sono idratate automaticamente senza modificare `AppComponent`. Le pagine elenco leggono la propria vista in modo sincrono da `localStorage`, senza attendere alcuna chiamata e senza aggiungere casi allo `switch`.

Restano due aspetti da governare.

**La chiamata non blocca l'avvio.** L'idratazione è avviata in `ngOnInit` senza attesa: una pagina elenco raggiunta direttamente per URL può renderizzare prima che la risposta arrivi, leggere un `localStorage` ancora vuoto e ricadere sul valore predefinito. Va quindi o promossa a `APP_INITIALIZER`, o esposta come signal a cui le pagine elenco reagiscono per allinearsi al valore corretto appena disponibile. La seconda opzione è preferibile perché non ritarda il primo rendering.

**`localStorage` è una cache di sessione.** `AppComponent.unloadHandler` invoca `LocalStorageService.clear()` alla chiusura della finestra: la copia locale non sopravvive alla sessione. È esattamente il motivo per cui la riga su `preferences` è necessaria e non sostituibile con il solo `localStorage`.

In caso di errore o di risposta assente si procede con i valori predefiniti, senza bloccare l'avvio e senza notificare l'utente.

### Scrittura

Il cambio vista aggiorna immediatamente l'interfaccia e la copia in `localStorage`; la scrittura sul database è successiva e non attesa. Un errore di rete non annulla il cambio vista né produce una notifica: la preferenza resta valida per la sessione corrente e verrà riscritta al cambio successivo.

Si riusa il meccanismo di `LayoutService.saveConfig`, che crea la riga alla prima scrittura e la aggiorna quando il valore cambia. La logica va estratta in un servizio dedicato, così da non caricare `LayoutService` di responsabilità che non riguardano il tema.

Le scritture sul database attendono lo stato del tenant e partono solo se il tenant ha uno schema. In modalità bootstrap la preferenza resta nella sola copia locale, che l'uscita dall'app cancella. L'aggiornamento di una riga esistente parte solo se la preferenza in cache ha già un `id`: se la creazione non è riuscita, la preferenza resta locale per la sessione e non produce richieste verso `/api/preferences/undefined`.

## Applicazione alle pagine elenco

**Album.** Intestazione nuova. «Nuovo» spostato dalla barra strumenti all'intestazione. Riga compattata. Evidenza «pubblico» da fondo pieno a barra laterale. Card: rimozione del `pt-12` e del riquadro annidato, aggiunta della selezione e della fascia metriche con tracce, parti e anno. Migrazione a `@if` e `@for`. Etichette di ordinamento in italiano.

**Tracce.** Come Album. «Carica» e «Nuovo» entrambe nell'intestazione, con «Carica» come azione primaria. Compositore e arrangiatore passano nella fascia metriche: oggi sono impaginati in un blocco a destra che sfalsa l'altezza delle righe.

**Utenti.** Intestazione nuova. Fascia metriche con email e sezione. Tag strumento limitati a tre più `+N`: oggi un utente con otto strumenti manda la riga a capo. Selezione estesa alla vista griglia.

**Strumenti.** Intestazione nuova. Fascia metriche con il conteggio degli utenti assegnati. È la pagina più semplice e aderisce allo standard quasi senza aggiunte.

**Istanze.** Intestazione nuova. La scadenza passa da tag isolato a metrica con evidenza di stato — scaduta, in scadenza, attiva — sostituendo il tag calendario neutro odierno.

**Inventario.** È la pagina più vicina allo standard. Il titolo esce dall'intestazione della dataview e diventa intestazione di pagina. Il selettore «Inventario / I miei oggetti» e l'avviso GDPR scendono nella zona di contesto. I filtri della vista personale entrano nella barra strumenti. Si aggiunge la selezione multipla, oggi assente.

**Calendario.** Intestazione nuova. La riga lista adotta lo standard mantenendo il riquadro giorno/mese come miniatura. La navigazione mensile passa nella zona di contesto, visibile solo in vista calendario. Ricerca e ordinamento restano nascosti in vista calendario, come già oggi.

**Economia.** Intestazione e riepiloghi già conformi. I filtri passano allo stile della barra strumenti standard. Gli stili locali di `finance.component.scss` confluiscono nelle classi condivise. Si aggiungono `p-confirmdialog` e `p-scrolltop`, oggi mancanti.

**Documenti legali.** Intestazione già conforme, da portare al componente condiviso. Va aggiunta la ricerca, oggi assente. L'impaginazione va allineata a `[12, 24, 48]`.

## Modali e avvisi: stato prima dell'adozione

Undici componenti sotto `dialogs/`, più sei `p-dialog` dichiarati inline dentro le pagine. Quarantaquattro chiamate a `confirmationService.confirm`. Circa settanta chiamate a `ToastService`. Sei banner informativi, ciascuno disegnato con una tecnica diversa.

### Dialoghi

| Dialogo | Apertura | Dimensione | Struttura |
| --- | --- | --- | --- |
| `add-albums-dialog` | `DialogService` | 50vw con breakpoint | Sottotitolo, campi, piede dentro il corpo |
| `add-instruments-dialog` | `DialogService` | 50vw con breakpoint | Come sopra |
| `add-tracks-dialog` | `DialogService` | 50vw con breakpoint | Come sopra |
| `add-tenants-dialog` | `DialogService` | 50vw con breakpoint | Come sopra, griglia a tre colonne |
| `add-users-dialog` | `DialogService` | 50vw con breakpoint | Come sopra, righe flex disomogenee |
| `add-inventory-dialog` | `DialogService` | 50vw con breakpoint | Come sopra, asterischi dentro le etichette fluttuanti |
| `add-calendar-events-dialog` | `DialogService` | 50vw con breakpoint | Come sopra, con `input` nativi per radio e checkbox |
| `add-files-dialog` | `DialogService` | 50vw con breakpoint | Nessun piede: si affida ai pulsanti di `p-fileupload` |
| `include-tracks-dialog` | `DialogService` | 50vw con breakpoint | Tabella, piede distanziato con `mt-20` |
| `edit-score-dialog` | `DialogService` | 50vw con breakpoint | Campi, piede dentro il corpo |
| `pdf-manipulator-dialog` | `DialogService` | 90vw × 90vh | Strumento a piena finestra, 344 righe di SCSS proprio |
| Documento legale | `p-dialog` inline | 48rem con breakpoint | Usa `ng-template #footer` |
| Conto, Categoria, Movimento, Trasferimento, Preventivo | `p-dialog` inline | 38, 44 e 52rem, senza breakpoint | Usano `ng-template #footer`, etichette sopra il campo |

Criticità:

- **Due meccaniche.** I dialoghi di creazione usano `DialogService.open` con il piede disegnato a mano in fondo al corpo; quelli di `finance` e `legal-documents` usano `p-dialog` inline con `ng-template #footer`. Due contratti diversi per la stessa cosa.
- **Unità di misura incoerenti.** I dialoghi dinamici misurano `50vw`, quelli inline `38rem`, `44rem`, `48rem` e `52rem`. Su un monitor da 2560 pixel il primo diventa un modulo largo 1280 pixel con i campi tirati.
- **Breakpoint assenti.** Le cinque `p-dialog` di `finance` dichiarano solo `[style]="{ width: '38rem' }"`: sotto i 640 pixel il dialogo eccede la finestra. `legal-documents`, sulla stessa meccanica, i breakpoint li dichiara.
- **Tre modi di segnalare l'obbligatorietà.** `finance` usa l'etichetta sopra il campo con asterisco; `add-inventory-dialog` mette l'asterisco dentro l'etichetta fluttuante; gli altri non lo segnalano affatto.
- **Il pulsante disabilitato è l'unico messaggio di validazione.** Nessun dialogo dice perché non si può salvare. In `add-users-dialog` la condizione è quadrupla e l'utente vede solo un pulsante spento.
- **Sottotitolo inutile.** Sette dialoghi aprono con «Inserisci le informazioni.», che non aggiunge nulla a un titolo come «Aggiungi album» e occupa una riga più `mb-8`.
- **L'azione principale non ha il peso dell'azione principale.** In tutti gli undici dialoghi «Salva» è `[outlined]` e «Annulla» è `[text]`: nessuna delle due è piena.
- **Il piede scorre con il contenuto.** Nei dialoghi dinamici il piede è un `div` in fondo al corpo: su moduli lunghi «Salva» esce dalla vista.
- **Nessuna protezione dal doppio invio.** Nessun dialogo disabilita la conferma durante la chiamata.

### Conferme

Quarantaquattro chiamate ripetono ognuna le stesse otto proprietà. Il testo è quasi sempre coerente, ma la ripetizione ha già prodotto divergenze.

- **`severity: 'warning'` non esiste.** In `unsaved-changes.guard.ts` il pulsante di conferma dichiara `severity: 'warning'`; PrimeNG accetta `warn`. Il valore non corrisponde a nulla e il pulsante viene reso con lo stile primario predefinito. È l'avviso più delicato dell'applicazione ed è l'unico con il pulsante sbagliato.
- **Una conferma senza icona.** L'eliminazione di un allegato in `finance.component.ts` è l'unica delle quarantaquattro a omettere `icon`.
- **Due convenzioni sui titoli.** Convivono «Conferma eliminazione», che nomina l'atto in astratto, ed «Elimina movimento», «Archivia conto», «Elimina riconsegna», che nominano atto e oggetto.
- **La gravità non distingue i casi.** «Archivia conto» usa lo stesso `severity: 'danger'` di «Elimina definitivamente» su un movimento, benché l'archiviazione sia reversibile.

### Toast

`ToastService` espone quattro metodi con durate diverse: 2 secondi per successo e informazione, 3 per l'avvertimento, 5 per l'errore.

- **Due scuole sui titoli.** Quarantacinque chiamate si intitolano «Successo» o «Errore»; circa venticinque usano un titolo che dice cosa è accaduto — «Movimento salvato», «Riconsegna avviata», «Fotografia non valida». Il primo gruppo sposta l'informazione nel dettaglio e spreca il titolo.
- **Durata insufficiente.** Duemila millisecondi per un toast di successo con titolo e dettaglio su due righe sono al limite della leggibilità.
- **L'errore svanisce.** Dopo cinque secondi sparisce l'unica traccia di ciò che non ha funzionato.
- **Nessuna chiusura manuale.** I toast non espongono il pulsante di chiusura.
- **L'errore di rete è indistinto.** L'interceptor emette «Errore durante la richiesta» senza distinguere fra rete assente, sessione scaduta e conflitto: l'utente non sa se riprovare, ricaricare o rinunciare.

### Banner inline

`p-message`, il componente PrimeNG dedicato, non compare in nessun template e `MessageModule` non è in `imports.ts`. Al suo posto, sei implementazioni artigianali:

| Dove | Tecnica | Aspetto |
| --- | --- | --- |
| `legal-documents`, `.legal-information` | SCSS con `color-mix` su primary | Raggio 0.75rem, bordo pieno, icona primary |
| `inventory`, elenco | Tailwind `card border-l-4 border-amber-500` | Barra laterale ambra, nessuna icona |
| `inventory`, dettaglio | Tailwind `card border-l-4 border-primary` | Barra laterale primary, icona informativa |
| `dashboard`, widget inventario | Tailwind con varianti `dark:` esplicite | Fondo, bordo e testo gialli |
| `legal-acceptance`, `.error-message` | SCSS con esadecimali di riserva | `#b91c1c` su `#fef2f2`, nessuna variante scura |
| `preview`, `.selection-hint` | SCSS proprio | Icona più testo con parte in grassetto |

Criticità:

- **Colori fissi che ignorano il tema.** `legal-acceptance` scrive `var(--red-700, #b91c1c)` su `var(--red-50, #fef2f2)`. In tema scuro il fondo resta chiarissimo, ed è l'unica pagina che un utente non ancora autenticato vede.
- **Tre colori per lo stesso livello.** Ambra, giallo e primary indicano tutti «attenzione, guarda qui». Il colore non è ancora un'informazione.
- **`primary` usato come gravità.** Il colore del marchio non è un livello di gravità, ma in `legal-documents` e nel dettaglio inventario lo diventa.

## Quale canale, quando

Prima della forma va deciso il criterio. Ogni comunicazione ricade in uno di cinque casi, e il caso determina il canale.

| Canale | Natura | Quando |
| --- | --- | --- |
| Toast | Effimero | L'esito di un'azione appena compiuta dall'utente, andata come previsto. Non richiede risposta e non va riletta: il risultato è già visibile nella pagina. |
| Banner inline | Persistente | Una condizione della pagina, non di un'azione: un vincolo da conoscere prima di agire, un dato che manca, uno stato che spiega perché qualcosa non è disponibile. Resta finché resta la condizione. |
| Conferma | Bloccante, binaria | Un'azione distruttiva o difficile da annullare, esprimibile con una domanda a due risposte. Nessun campo da compilare: se serve un campo, è un dialogo. |
| Dialogo | Bloccante, con input | La raccolta di dati per un'operazione che l'utente ha scelto di compiere. Ha un'azione di conferma e una di rinuncia. |
| Errore di campo | Contestuale | La ragione per cui un valore non è accettabile, mostrata sotto il campo che lo contiene. |

Il corollario che comporta più modifiche: l'errore di validazione non è un toast e non è un pulsante disabilitato. Un toast se ne va, e il campo sbagliato resta.

La [guida introduttiva](guided-tour-spec.md) è un sesto canale, bloccante ma sempre rinunciabile e senza dati da raccogliere: ha regole proprie, in [La guida introduttiva](#la-guida-introduttiva).

## Il dialogo standard

Tre fasce fisse — intestazione, corpo scorrevole, piede ancorato — su un'unica meccanica. `DialogService.open` ovunque; le `p-dialog` inline di `finance` e `legal-documents` diventano componenti sotto `dialogs/`.

**Intestazione.** Titolo che nomina atto e oggetto — «Nuovo movimento», «Modifica album» — e una riga che dice cosa comporta l'operazione, soltanto se aggiunge qualcosa. La frase «Inserisci le informazioni.» viene rimossa da tutti e sette i dialoghi che la usano.

**Corpo.** Unica zona scorrevole, con `max-height` legata all'altezza della finestra. Griglia a due colonne che collassa a una sotto il breakpoint `md`.

**Etichette.** Etichetta sopra il campo, non `p-floatlabel`. L'etichetta fluttuante nasconde il nome del campo appena si scrive, e con l'asterisco al suo interno diventa illeggibile. L'obbligatorietà è un asterisco dopo l'etichetta, in colore di errore, con lo stesso significato in tutti i dialoghi.

**Errori di campo.** Messaggio sotto il campo e bordo in colore di errore, mostrati alla perdita di fuoco o al primo tentativo di salvataggio, mai mentre l'utente sta ancora scrivendo.

**Sezioni.** I moduli lunghi si dividono in gruppi con intestazione, come già fa il blocco ricorrenza di `add-calendar-events-dialog`: quel riquadro diventa il modello, non l'eccezione.

**Piede.** Ancorato, fuori dall'area scorrevole, con separatore e fondo `surface`. A destra la rinuncia come `text` e la conferma come pulsante pieno, non più `[outlined]`. A sinistra il conteggio dei campi da correggere, che sostituisce il pulsante spento come unica spiegazione.

**Dialoghi senza conferma.** Dove il piede non invia nulla, perché il dialogo mostra informazioni o applica ogni azione nel corpo, resta un solo pulsante pieno: la chiusura, nominata dall'etichetta della rinuncia. Due pulsanti con lo stesso testo non sono una scelta, e il pulsante di conferma prometterebbe un salvataggio che non esiste. In questi dialoghi la chiusura non interroga l'utente per la sola interazione con il corpo — i comandi del corpo hanno già avuto effetto — ma solo se il dialogo si dichiara `dirty`. Un dialogo senza conferma che ha nel corpo campi con un proprio salvataggio, come il suono della parte in «Versioni e suono», si dichiara `dirty` finché quei campi differiscono dai valori salvati, e chiede conferma anche prima delle azioni del corpo che lo chiudono.

**Valori ereditati.** Un campo che, lasciato vuoto, eredita il valore da un'altra entità mostra quel valore come segnaposto, con l'origine: «+3 dallo strumento», «Come lo strumento: Clarinet». Il campo resta vuoto, quindi l'eredità continua; il segnaposto dice soltanto che cosa si sta usando.

**Conferma.** L'etichetta nomina l'atto: «Salva movimento», «Aggiungi album», non «Salva» generico. Durante l'invio va in stato `[loading]` e resta disabilitata.

**Dimensioni.** Tre taglie in `rem`, mai in `vw`: 28rem per una conferma con un solo campo, 40rem per il modulo tipico, 56rem per tabelle e selezioni multiple. Fuori scala soltanto `pdf-manipulator-dialog`, che è uno strumento a piena finestra. I breakpoint sono sempre dichiarati.

**Uscita.** Con modifiche non salvate, la chiusura — pulsante, `Esc`, clic sulla maschera — apre la conferma «Modifiche non salvate», riusando il meccanismo già scritto in `unsaved-changes.guard.ts`, oggi attivo soltanto sulla navigazione fra rotte.

## La conferma standard

Una domanda, due risposte, nessun campo.

**Titolo.** Nomina atto e oggetto: «Elimina movimento», «Archivia conto», «Rimuovi traccia dall'album». Sparisce il generico «Conferma eliminazione».

**Messaggio.** Dichiara la conseguenza, non ripete la domanda. «Il movimento non sarà più visibile né incluso in saldi e rendiconti» invece di «Eliminare definitivamente questo movimento?». Dove l'oggetto ha un nome, il nome compare.

**Gravità.** Tre livelli, e il livello determina icona e pulsante.

| Livello | Casi | Icona | Pulsante di conferma |
| --- | --- | --- | --- |
| Distruttiva | Eliminazione di un record, rimozione di un allegato o di una fotografia | `error` | Pieno, `danger` |
| Reversibile | Archiviazione di un conto o di una categoria, rimozione di una traccia da un album | `warn` | `outlined` |
| Interruzione | Uscita con modifiche non salvate | `info` | `outlined` |

Il criterio che separa i primi due livelli è la recuperabilità dal punto di vista dell'utente, non il modo in cui il dato è trattato sul database. A livello dati nessuna operazione dell'applicazione cancella davvero: `CommonRepository.deleteByIdAndUserId` esegue `UPDATE ... SET deleted = TRUE`, e anche `FinanceService.deleteMovement` si limita a `setDeleted(true)`. La differenza è che l'archiviazione imposta `active = false` lasciando il record visibile in elenco con il proprio tag, ed è annullabile risalvando l'oggetto; mentre per i record con `deleted = true` non esiste in nessuna pagina un percorso per rivederli o ripristinarli.

Per questo il messaggio della conferma distruttiva descrive l'effetto osservabile — «non sarà più visibile» — e non afferma che il dato viene cancellato: sarebbe falso oggi, e resterebbe falso il giorno in cui venisse introdotto un cestino.

**Pulsanti.** La conferma nomina l'atto: «Elimina definitivamente», «Archivia», «Esci senza salvare». Il rifiuto è sempre `text` e dice cosa succede restando: «Annulla», oppure «Rimani» quando l'alternativa è andarsene. Il rifiuto è la scelta predefinita alla pressione di `Esc`.

**Invocazione.** Non più otto proprietà ripetute in quarantaquattro punti, ma tre metodi tipizzati su un servizio dedicato: `confirmDestructive`, `confirmReversible`, `confirmDiscard`. Ognuno riceve titolo, conseguenza ed etichetta dell'atto, e compone il resto. Le divergenze accidentali — l'icona mancante, la severità inesistente — diventano impossibili da introdurre.

## Toast e banner

Quattro gravità e due forme. Il toast è effimero e riguarda un'azione appena compiuta; il banner è persistente e riguarda una condizione della pagina. La scala cromatica è la stessa per entrambi, così il colore significa sempre la stessa cosa.

**Base tecnica.** I banner diventano `p-message`, con `MessageModule` aggiunto a `imports.ts`. Le sei implementazioni artigianali vengono eliminate.

**Scala cromatica.** Quattro gravità e nient'altro: `success`, `info`, `warn`, `error`. Sparisce l'uso di `primary` come colore di avviso e la coppia ambra/giallo per lo stesso livello.

**Titolo e dettaglio.** Il titolo dice cosa è accaduto, il dettaglio aggiunge il contesto. I titoli «Successo» ed «Errore» vengono sostituiti dall'esito: «Movimento salvato», «Album eliminato», «Salvataggio non riuscito».

**Durata.** `success` 3 secondi, `info` 4, `warn` 6. L'errore non scade: resta finché l'utente lo chiude, perché contiene l'unica traccia di ciò che non ha funzionato.

**Chiusura.** Ogni toast espone il pulsante di chiusura.

**Azione nel banner.** Un banner che segnala una condizione risolvibile porta l'azione che la risolve: «Vedi richieste», «Riprova». Oggi il banner GDPR descrive il problema e lascia l'utente a cercarne la soluzione altrove nella pagina.

**Errori di rete.** L'interceptor distingue i casi invece di emettere sempre «Errore durante la richiesta»: connessione assente, sessione scaduta, permesso negato, conflitto di versione, errore del server. Ogni caso ha il proprio testo e, dove ha senso, la propria azione. Il contratto delle risposte d'errore, i messaggi costruiti dal frontend a partire dalle chiavi e il catalogo delle chiavi sono nello [Standard degli errori applicativi](application-errors-standard.md).

**Accessibilità.** I banner di errore dichiarano `role="alert"`, quelli informativi `role="status"`, come già fa `legal-acceptance`, oggi unica pagina a farlo.

**Contrasto.** Il testo di banner e toast arriva almeno a 4,5:1 in entrambe le modalità. Aura e Lara lo scrivono con la tinta 600 della tavolozza in modalità chiara e con la 500 in modalità scura, e ne restano sotto `warn`, `success` ed `error` in chiaro, `info` ed `error` in scuro sul fondo delle card. Gli scostamenti stanno nei design token, in `ACCESSIBLE_MESSAGE` e `ACCESSIBLE_TOAST` di `app/constants/accessible-theme.ts`: tinta 700 in chiaro, 800 per `warn`, perché il giallo è la tavolozza più chiara, e tinta 400 in scuro. `accessible-theme.spec.ts` misura i rapporti sui token del preset installato, così un aggiornamento di PrimeNG che li riporta sotto soglia fa fallire i test. Il preset Nora, che dà ai messaggi un fondo pieno con il testo chiaro, tiene i propri colori. I pulsanti pieni delle severità `success`, `info`, `warn`, `help` e `danger` e i badge pieni hanno l'etichetta bianca su un fondo che i preset danno alla tinta 500, 600 in Nora, e quasi tutti restano sotto 4,5:1, fino a 2,2:1: in modalità chiara il fondo passa alla tinta 700, con 800 e 900 per puntatore e pressione dei pulsanti, e l'etichetta arriva almeno a 5:1 in tutti e tre i preset; la modalità scura resta quella del preset.

## Regole trasversali di modali e avvisi

**Una sola meccanica di dialogo.** `DialogService.open` ovunque, con il piede dichiarato dal guscio condiviso.

**Misure in rem, breakpoint sempre dichiarati.** Tre taglie: 28, 40 e 56rem.

**L'azione primaria dei dialoghi è un pulsante pieno.** Nelle conferme, invece, la gravità determina la resa: pieno `danger` per le azioni distruttive, `outlined` `warn` per quelle reversibili e `outlined` `info` per l'uscita con modifiche non salvate. La rinuncia è sempre `text`.

**La validazione si spiega.** Messaggio sotto il campo e conteggio dei campi da correggere nel piede. Il pulsante resta attivo e il tentativo di salvataggio rivela gli errori.

**Nessun invio doppio.** Il pulsante di conferma va in `[loading]` e si disabilita per tutta la durata della chiamata.

**Chiudere un modulo modificato chiede conferma.** Il meccanismo di `unsaved-changes.guard.ts` va esteso ai dialoghi, oltre che alle rotte.

**Il titolo dice l'esito, non la categoria.** Vale per toast, conferme e banner.

**Nessun colore fisso.** Ogni avviso prende i colori dai token di tema; gli esadecimali di riserva di `legal-acceptance` spariscono.

## La guida introduttiva

La guida mostra a ogni ruolo cosa può fare, una tappa alla volta. Non è un dialogo, perché non raccoglie dati, e non è una conferma, perché ogni comando è reversibile: per questo ha una scheda propria invece di `p-dialog`, che ammette solo posizioni fisse rispetto alla finestra.

**Una sola istanza.** `components/guided-tour/` è montato una volta in `LayoutComponent`, dentro `@defer (when guidedTour.active())`: componente e catalogo `constants/guided-tour-steps.ts` formano un chunk separato e non entrano nel bundle iniziale. Nessuna pagina apre la guida per conto proprio; la dashboard la propone, il pulsante di aiuto della topbar e il profilo la aprono.

**La scheda.** Larga al massimo 22rem; sotto i 992 px occupa la larghezza della finestra meno 1rem per lato e sta sopra o sotto l'elemento. Intestazione con icona PrimeIcons, titolo entro 40 caratteri e chiusura; corpo di una o due frasi entro 180 caratteri; al più tre punti entro 60 caratteri; pallini e «3 di 8» sempre visibili; nel piede **Salta la guida** come collegamento a sinistra, **Indietro** `outlined` secondario e **Avanti** pieno a destra, che all'ultima tappa diventa **Fine**. Il benvenuto è centrato, con **Inizia la guida** pieno e **Più tardi** `text`.

**Evidenziazione.** Un velo dai token di tema oscura la pagina e lascia libero un riquadro, con il contorno nel colore primario, attorno all'elemento. La scheda si mette a destra, sotto, sopra o a sinistra, in quest'ordine; se nessun lato ha spazio, o la finestra è alta meno di 480 px come con lo zoom al 200%, è centrata e scorrevole. Una sola misura per frame, qualunque cosa scorra o cambi dimensione.

**Ancore, non selettori.** Un elemento evidenziabile dichiara `appTourAnchor="area.oggetto"`; una voce del menu dichiara `tourAnchor` nel modello. Le ancore sono contratti con il catalogo: `npm run check:tour-anchors` fallisce se il catalogo ne cita una che nessun template dichiara. Chi rifà una pagina conserva le ancore della sua intestazione e del suo pulsante di creazione.

**Accessibilità.** `role="dialog"`, `aria-modal`, titolo e corpo collegati con `aria-labelledby` e `aria-describedby`, fuoco sul comando primario trattenuto da `pFocusTrap` e restituito alla chiusura, `Esc` come chiusura, regione `aria-live` che annuncia «Passo 3 di 8: titolo». I testi dicono dove si trova l'elemento, così valgono anche senza evidenziazione.

**Movimento e tema.** Solo una dissolvenza di 150 ms, assente con `prefers-reduced-motion`; colori, bordi e raggi dai token PrimeNG, quindi corretti in tema chiaro e scuro. Nessuna immagine.

**Silenziosa.** Gli errori delle letture e dei salvataggi della guida non producono toast né indicatori di caricamento; solo i comandi della sezione **Guida** del profilo, che sono azioni esplicite, seguono la gestione normale degli errori. L'invito degli utenti già presenti al rilascio è un banner `app-inline-alert` sopra la dashboard.

## Pagine di dettaglio: stato prima dell'adozione

A differenza degli elenchi, la struttura di base è condivisa: un `p-fluid` che contiene una o più `card`, l'ultima delle quali è la zona pericolosa. È dentro quella struttura che tutto diverge.

| Pagina | Titolo mostrato | Elemento | Ritorno all'elenco | Caricamento | Sezioni | Salvataggi indipendenti |
| --- | --- | --- | --- | --- | --- | --- |
| `instruments/detail` | «Strumento» | `span` | no | no | 1 | 1 |
| `users/detail` | «Utente» | `span` | no | no | 3 | 1 |
| `tenants/detail` | «Tenant» | `span` | no | no | 1 | 1 |
| `albums/detail` | «Album» | `span` | no | no | 2 | 1 |
| `tracks/detail` | «Traccia» | `span` | no | no | 3 | 1 |
| `calendar-events/detail` | «Evento» | `span` | no | no | 8 | 4 |
| `inventory/detail` | nome del record | `h2` | sì | sì | 4 | 3 |
| `inventory/assignment-detail` | nome dell'oggetto | `h2` | sì | sì | 5 | 2 |
| `profile` | nome e cognome | `h2` | no | no | 5 | 1 |

### Difetti

**Il salvataggio principale scarta le presenze.** In `calendar-events/detail` la proprietà `isDirty` è un getter composito, `_isDirtyForm || isDirtyPresence`. Il pulsante «Salva» dell'intestazione è legato a quel getter e si attiva quindi anche quando l'unica cosa modificata sono le presenze. Premendolo, `save()` aggiorna l'evento e invoca `loadElement()`, che ricarica il record dal server e azzera `isDirtyPresence`: le presenze modificate spariscono senza alcun avviso. La sezione ha un proprio pulsante «Salva presenze», ma nulla impedisce di premere prima quello sbagliato.

**Il ritmo verticale dipende dalla profondità del DOM.** La classe `.card` dichiara `margin-bottom: 2rem` con `&:last-child { margin-bottom: 0 }`. Se una card è figlia unica di un componente Angular, di una tab o di un altro wrapper, `:last-child` scatta anche quando visivamente segue un'altra card e il margine scompare. Spostare lo stesso margine su `:host`, mantenendo `:host(:last-child)`, riproduce il difetto un livello più in alto. I wrapper `<div class="flex mt-4">` aggiungono inoltre una seconda tecnica e portano il ritmo a 1 rem in alcune pagine e a 2 rem in altre.

**`p-confirmdialog key="guard"` è dichiarato due volte.** Una in `app.component.html`, valida per tutta l'applicazione, e una in `inventory/detail`. Due istanze contendono la stessa chiave.

### Criticità di layout

**Il titolo dice il tipo, non il record.** Sei pagine su nove scrivono «Strumento», «Utente», «Tenant», «Album», «Traccia», «Evento». Aperta una traccia, l'intestazione non dice quale traccia: il nome è sepolto nel primo campo del modulo, come un dato qualunque. Le tre che il nome lo mostrano lo fanno in tre modi diversi, con dimensioni e pesi tipografici differenti.

**Nessuna via di ritorno.** Solo `inventory/detail` e `assignment-detail` espongono il pulsante indietro. Nelle altre sette si torna all'elenco con il tasto del browser o ripassando dal menu, che però riparte dalla prima pagina dei risultati. Anche le due che il pulsante ce l'hanno perdono comunque pagina, ricerca e ordinamento.

**Titoli che non sono titoli.** Sei pagine usano `<span class="font-semibold text-xl">` come titolo di pagina; le sezioni oscillano fra `<span class="font-semibold text-lg">` e `<h3>`. Nessuna pagina di dettaglio ha un `h1`.

**Lo stato delle modifiche è un pallino da 8 pixel.** `<span class="w-2 h-2 rounded-full bg-amber-400" title="Modifiche non salvate">`, ripetuto identico in sette punti, con `*ngIf` in sei e `@if` in uno. Il testo vive soltanto nell'attributo `title`: non è annunciato come stato dalle tecnologie assistive, non compare su dispositivi touch, e senza il colore non resta nulla.

**Tre tecniche di spaziatura.** Wrapper `<div class="flex mt-4">`, `card mt-4`, e card sorella nuda, spesso nella stessa pagina.

**`p-confirmdialog` annidato nel modulo.** In sei pagine sta dentro la prima card, fra l'intestazione e i campi. È un overlay e la posizione nel DOM è ininfluente, ma segnala che il blocco è stato copiato senza rileggerlo.

**Nessuno stato di caricamento in sette pagine su nove.** Le altre istanziano un modello vuoto, disegnano il modulo e lo popolano quando la risposta arriva: per un istante la pagina sembra un record nuovo.

**Il salvataggio in due posizioni.** Otto pagine lo collocano in alto a destra nella prima card; `profile` lo mette in fondo alla card, sotto i campi.

**La zona pericolosa in due forme.** Sei pagine usano `<span class="danger-zone-label font-semibold text-sm">`; `profile` usa `<h3 class="text-lg text-red-500">` e omette il `mt-8` che le altre applicano.

**La stessa operazione con due gravità.** «Elimina strumento», «Elimina album», «Elimina traccia» ed «Elimina oggetto» usano `danger` delineato; «Elimina utente» ed «Elimina tenant» usano `warn` delineato, perché sotto hanno il `danger` pieno dell'eliminazione GDPR. Ma tutte e sei eseguono la stessa operazione, `deleted = true`.

## Il guscio della pagina di dettaglio

Le zone sono quattro e l'ordine è invariabile. Cambia soltanto quante sezioni stanno in mezzo: una per Strumento, otto per Evento.

| Zona | Obbligatoria | Contenuto |
| --- | --- | --- |
| Intestazione | sì | Ritorno all'elenco, tipo di entità, nome del record, stato delle modifiche, attributi identificativi, azioni della pagina |
| Identità | no | Le poche metriche che qualificano il record a colpo d'occhio |
| Sezioni | sì | Una o più card, ciascuna con intestazione, descrizione e azioni proprie |
| Zona pericolosa | no | Sempre ultima, sempre separata; solo operazioni che rimuovono il record o i suoi dati |

L'intestazione è lo stesso componente `page-header` delle pagine elenco: cambia soltanto che qui porta il pulsante indietro e che il titolo è il nome di un record invece del nome della pagina.

## La composizione del dettaglio

**Ritorno all'elenco.** Pulsante indietro in ogni pagina, che torna all'elenco conservandone lo stato — pagina, ricerca, ordinamento e vista — e non alla prima pagina dei risultati.

**Titolo.** `h1` con il nome del record. Il tipo di entità diventa un'etichetta sopra il titolo, che dice sempre in quale sezione ci si trova senza rubare il posto all'identità. Per un record nuovo il titolo è «Nuova traccia», «Nuovo oggetto», come già fa `inventory/detail`.

**Stato delle modifiche.** Etichetta con testo, non un pallino: «Modifiche non salvate» in gravità `warn`, accanto al titolo. Leggibile, annunciabile e comprensibile anche senza colore.

**Attributi identificativi.** Riga di metadati sotto il titolo: stato, conteggi, data e autore dell'ultima modifica. Sostituisce i dati identificativi oggi sepolti fra i campi del modulo.

**Azioni.** Il salvataggio è l'unica azione piena, sempre in fondo a destra; le altre sono `outlined`. L'etichetta nomina l'oggetto — «Salva traccia» — coerentemente con la regola già fissata per i dialoghi.

**Modulo principale.** Griglia a tre colonne che collassa a due sotto `lg` e a una sotto `md`. Etichette sopra il campo, non `p-floatlabel`, e asterisco di obbligatorietà: le stesse regole del dialogo standard, così un campo si comporta allo stesso modo dentro e fuori da un modale.

**Sezione.** Intestazione con titolo `h2`, conteggio dove ha senso, una riga che spiega la sezione, e a destra le azioni della sola sezione. La descrizione è il posto dove dichiarare che la sezione si salva per conto proprio.

**Spaziatura.** La distanza verticale appartiene al contenitore delle zone, non alle card. Il contenitore diretto delle sezioni usa `display: flex` o `display: grid`, direzione verticale e `gap: 2rem`; le card e gli host di `detail-section`, `danger-zone` e degli altri componenti di sezione non applicano margini esterni né regole `:last-child`. Spariscono i wrapper creati soltanto per spaziare e tutte le utility `mt-*` fra sezioni.

Una tab o un componente intermedio costituisce una zona del layout: deve essere figlio dello stesso contenitore della zona successiva. Il `gap` separa quindi correttamente anche una card contenuta in `p-tabs` dalla zona pericolosa esterna, senza dipendere dalla profondità del DOM.

```scss
.detail-page__zones {
    display: flex;
    flex-direction: column;
    gap: 2rem;
}
```

Non si corregge una singola adiacenza con selettori come `p-tabs + app-danger-zone`, margini locali o eccezioni per pagina: sono soluzioni dipendenti dalla struttura corrente e fanno riapparire il difetto quando viene introdotto un nuovo wrapper.

**Zona pericolosa.** Ultima card, bordo in colore di errore, etichetta «Zona pericolosa». Ogni riga dichiara in grassetto cosa succede e sotto la conseguenza, poi il pulsante. La gravità del pulsante segue la scala fissata per le conferme: la cancellazione logica è distruttiva perché l'utente non ha modo di annullarla, quindi gravità piena senza eccezioni, anche dove sotto compare l'eliminazione GDPR.

## Chi salva cosa

È il nodo che ha già prodotto una perdita di dati. Una pagina di dettaglio può avere più unità salvabili, e ciascuna deve dichiararsi.

**Unità di salvataggio.** Il modulo principale è un'unità. Ogni sezione che ha un proprio pulsante di salvataggio è un'altra unità: l'ordine delle fotografie, le presenze, una singola assegnazione. Non esistono unità implicite.

**Ambito del pulsante.** Un pulsante di salvataggio si abilita soltanto per la propria unità e ne azzera soltanto lo stato. Il «Salva» dell'intestazione salva il modulo principale e nient'altro, e resta spento se l'unica cosa modificata sta in un'altra sezione.

**Ricaricamento.** Un salvataggio che ricarica il record dal server scarta le modifiche pendenti delle altre unità. È vietato ricaricare mentre un'altra unità è modificata: o si aggiorna soltanto la parte salvata, o si chiede conferma prima.

**Stato di pagina.** L'etichetta nell'intestazione riflette la somma delle unità: se qualunque cosa è da salvare, lo dice. Ed è la stessa somma che alimenta la guardia di uscita, come già oggi.

**Uscita.** La guardia elenca cosa si sta per perdere — «modulo, presenze» — invece del generico «Ci sono modifiche non salvate».

La regola che chiude il difetto è la prima: il pulsante dell'intestazione si lega al solo stato del modulo principale, non al getter composito. Il getter composito resta, ma serve unicamente all'etichetta di stato e alla guardia di uscita.

**Come è stato chiuso.** Il pulsante «Salva evento» è legato a `isDirtyForm` e resta spento se l'unica cosa modificata sono le presenze. Non basta però: con modulo *e* presenze modificati il pulsante è acceso, e il ricaricamento che segue il salvataggio ricostruirebbe le righe delle presenze dalla risposta del server, scartando le modifiche pendenti. Per questo `buildPresenceRows` non ricostruisce nulla finché la sezione presenze è sporca, e `loadElement` non azzera più lo stato di quella sezione: un ricaricamento causato da un'altra unità non può toccarla. Salvando il modulo con presenze pendenti, un avviso dichiara che le presenze restano da salvare.

Le due classi base rendono la regola strutturale: `DetailPageBase` tiene il registro delle unità, espone `isDirtyForm` per il pulsante dell'intestazione e `isDirty` composito per l'etichetta di stato e la guardia, e `dirtyUnitLabels` per l'elenco che la guardia mostra all'uscita. `calendar-events/detail` registra «presenze», `inventory/detail` «ordine fotografie» e «assegnazioni».

## Regole trasversali delle pagine di dettaglio

**Il titolo è il nome del record.** Il tipo di entità sta nell'etichetta sopra. Un record nuovo si intitola «Nuovo» seguito dal nome dell'entità.

**Si torna sempre all'elenco, nello stato in cui era.** Pulsante indietro in ogni pagina di dettaglio, con pagina, ricerca, ordinamento e vista conservati.

**Intestazioni semantiche.** `h1` per il record, `h2` per le sezioni. Mai un `span` con classi tipografiche al posto di un titolo.

**Lo stato ha un testo.** Etichetta «Modifiche non salvate», non un pallino colorato con l'attributo `title`.

**Una sola tecnica di spaziatura.** Il contenitore delle zone usa `gap: 2rem`. Card e componenti di sezione non hanno margini esterni; sono vietati `:last-child`, wrapper di sola spaziatura, `mt-*` e selettori locali fra componenti adiacenti.

**Stato di caricamento sempre presente.** Scheletro con la forma della pagina, non un modulo vuoto che si riempie.

**Gli overlay si dichiarano una volta sola.** `p-confirmdialog` senza chiave nella pagina, quello con `key="guard"` soltanto in `app.component.html`, e mai dentro una card.

**La zona pericolosa ha una forma sola.** Stessa etichetta, stessa struttura per riga, gravità presa dalla scala delle conferme.

## La dashboard: un vocabolario parallelo

La dashboard non rientra fra le superfici da ridisegnare, ma va letta prima di costruire i componenti condivisi, perché ne contiene già una versione propria. È la parte scritta meglio dell'applicazione — blocchi `@if` e `@for`, elementi semantici, `aria-label`, stati vuoti, nomenclatura coerente — e proprio per questo è il riferimento più utile e il rischio di duplicazione più concreto.

Sei widget, 781 righe di SCSS locale, e nessuna riga condivisa con il resto dell'applicazione.

### Due vocabolari dentro la dashboard

Cinque widget su sei usano classi SCSS in stile BEM: `.stat-card`, `.widget-header`, `.widget-empty`, `.track-row`, `.event-row`, `.notice-row`. Il sesto, `inventory-widget`, usa utility Tailwind in linea per 143 righe di template, e riserva alle proprie otto classi SCSS soltanto la barra di avanzamento e i pallini di legenda.

### Duplicazione interna

Gli stili dei componenti Angular sono incapsulati, quindi le copie non entrano in conflitto: divergono e basta.

- `.widget-header` è definito tre volte, in `recents-widget`, `calendar-events-widget` e `notifications-widget`. Le dichiarazioni sono identiche a meno dei selettori discendenti — `strong` contro `> span > strong` — e di un `> span { min-width: 0 }` presente in una sola delle tre.
- `.widget-empty` è definito tre volte, identico salvo l'altezza minima: 9 rem in un caso, 12 rem negli altri due.
- Esistono tre implementazioni della stessa riga: `.track-row` con cinque classi, `.event-row` con cinque, `.notice-row` con undici. L'anatomia è la stessa in tutte e tre — un elemento visivo a sinistra, un blocco identità con titolo e sottotitolo, un marcatore di stato, una freccia di navigazione a destra.

### Corrispondenza con i componenti previsti

| Nella dashboard | Nella specifica |
| --- | --- |
| `.track-row`, `.event-row`, `.notice-row` | `components/list-row/` |
| `.widget-empty` | `components/empty-state/` |
| `.widget-header` | intestazione di `components/detail-section/` |
| `.event-row__date` | la miniatura giorno/mese prevista per le righe di `calendar-events` |

Le fasce di `.track-row` e `.event-row` coincidono con quelle definite per la vista lista: elemento visivo, identità, stato, azione. `.widget-empty` è invece una versione impoverita dello stato vuoto — ha icona e testo, ma non titolo, non causa e non azione.

### Difetti

**La dashboard non ha struttura di intestazioni.** La pagina non ha titolo, e cinque widget su sei usano `<strong>` per il proprio. L'unico `h1` dell'intera schermata è dentro `inventory-widget`, dove nomina il widget e non la pagina.

**`p-confirmdialog` dichiarato dentro un widget.** Sta in `notifications-widget`, che è un componente riutilizzabile: la dichiarazione dovrebbe stare nella pagina che lo ospita.

**Banner con colori scritti a mano.** I riquadri giallo e verde di `inventory-widget` usano utility Tailwind con varianti `dark:` esplicite, ed è una delle sei implementazioni artigianali già censite fra gli avvisi.

### Cosa ne consegue

I componenti condivisi non si progettano da zero: si estraggono da qui.

- `list-row` nasce dall'unione di `.track-row` ed `.event-row`, che coprono già il caso con miniatura a immagine e quello con riquadro giorno/mese.
- `empty-state` parte da `.widget-empty` e vi aggiunge titolo, causa e azione previsti dalla specifica; la dashboard adotta poi il componente completo.
- L'intestazione di `detail-section` parte da `.widget-header`, unificando le tre varianti nella più completa.

La dashboard resta fuori dal ridisegno, ma adotta i componenti che ha contribuito a definire, e `inventory-widget` viene riallineato agli altri cinque abbandonando le utility in linea. Le 781 righe di SCSS locale si riducono a quanto resta di specifico: la barra di avanzamento dell'inventario, la scala cromatica delle `stat-card` e le poche varianti di `notice-row`.

## Pagine di errore

`notfound` e `forbidden` sono rimaste al template Sakai di partenza e non sono mai state adattate.

- I testi sono in inglese in un'applicazione interamente italiana: «Not Found», «Requested resource is not available», «Access Denied», «You do not have the necessary permisions», «Go to Dashboard». L'ultima frase contiene anche un errore di battitura.
- Sono le uniche due pagine con SVG e gradienti dichiarati in linea nel template.
- `forbidden` carica l'illustrazione da `https://primefaces.org/cdn/templates/sakai/auth/asset-access.svg`. È una dipendenza di rete verso un dominio di terze parti dentro una pagina di errore: se il CDN non risponde, o se l'installazione è in rete chiusa, resta un riquadro vuoto proprio dove serve chiarezza.

Interventi applicati: testi tradotti («Pagina non trovata», «Permesso insufficiente»), immagine remota eliminata e guscio comune adottato limitatamente a titolo e azione di ritorno. Non è un ridisegno: è la correzione di una parte mai adattata.

## Componenti condivisi

Lo standard vale poco se resta copiato in nove template e undici dialoghi. I pezzi condivisi sono stati estratti prima di modificare le singole superfici e ogni superficie nuova li riusa.

### Pagine elenco

| Percorso | Responsabilità |
| --- | --- |
| `components/page-header/` | Intestazione di pagina. Ingressi `heading` e `subtitle`, proiezione di contenuto per le azioni. Sblocca da sola sei pagine su nove. |
| `components/list-toolbar/` | Barra strumenti. Ricerca con debounce, ordinamento, proiezione per i filtri specifici, selettore di vista. Uscite `searchChange`, `sortChange`, `layoutChange`. |
| `components/list-row/` | Guscio della riga lista con le cinque fasce fisse e proiezioni nominate per identità, metriche e azioni. Si estrae dall'unione di `.track-row` e `.event-row` della dashboard, che coprono già il caso con miniatura a immagine e quello con riquadro giorno/mese. |
| `components/entity-card/` | Guscio della card griglia con media, corpo, fascia metriche e piede, e le stesse proiezioni nominate della riga. |
| `components/empty-state/` | Stato vuoto. Ingressi `icon`, `heading`, `message`, azione opzionale, con la variante «nessun risultato di ricerca». Parte da `.widget-empty` della dashboard, oggi definito tre volte e privo di titolo, causa e azione. |
| `components/selection-bar/` | Selezione massiva. Racchiude la logica `isSelected`, `toggleSelectAll` e `deleteSelected` oggi duplicata identica in cinque componenti. Di norma compare solo con almeno un elemento selezionato; l'ingresso `alwaysVisible` la mantiene visibile dove la selezione si attiva con un comando esplicito, perché lì la casella Seleziona tutte deve restare raggiungibile anche a selezione vuota. |
| `service/list-layout.service.ts` | Lettura e scrittura della preferenza `listLayout.<pagina>` secondo quanto descritto sopra. |
| `pages/_shared/list-page.base.ts` | Classe base con `dataViewLazyLoadEvent`, `onLazyLoad`, `onSortChange`, `onGlobalFilter`, `totalRecords` e `loading`: oggi lo stesso codice compare, con piccole divergenze, in sette componenti. |
| `assets/layout/_list.scss` | Stili condivisi di densità, miniature, fasce metriche e hover delle card. Assorbe `inventory.component.scss` e le parti riutilizzabili di `finance.component.scss`. |

### Modali e avvisi

| Percorso | Responsabilità |
| --- | --- |
| `components/dialog-shell/` | Guscio del dialogo: intestazione, corpo scorrevole, piede ancorato. Ingressi `heading`, `subtitle`, `size`, `confirmLabel`, `cancelLabel`, `saving`, `invalidCount`, `dirty` e `dismissOnly` per i dialoghi senza conferma; uscite `confirm` e `cancel`, con l'intercettazione della chiusura sporca. |
| `components/form-field/` | Campo di modulo: etichetta sopra, asterisco di obbligatorietà, messaggio di errore sotto, stato di errore sul controllo. Sostituisce l'uso di `p-floatlabel` dentro i dialoghi. |
| `components/inline-alert/` | Banner. Involucro su `p-message` con gravità, titolo, dettaglio, azione opzionale e ruolo ARIA corretto. Sostituisce le sei implementazioni artigianali. |
| `components/guided-tour/` | Guida introduttiva: velo, riquadro, scheda ancorata o centrata e banner di invito. Montata una sola volta dal layout in un blocco `@defer`. |
| `directive/tour-anchor.directive.ts` | Ancora della guida: `appTourAnchor` scrive `data-tour-anchor`, controllato da `scripts/check-tour-anchors.mjs`. |
| `service/confirm.service.ts` | Conferme tipizzate: `confirmDestructive`, `confirmReversible`, `confirmDiscard`. Assorbe le quarantaquattro invocazioni e le loro otto proprietà ripetute, correggendo la severità inesistente e l'icona mancante. |
| `service/toast.service.ts` | Revisione: nuove durate, errore persistente, pulsante di chiusura. La firma `(title, message)` resta invariata, così la migrazione delle chiamate esistenti è meccanica. |
| `interceptor/http-interceptor.service.ts` | Mappatura da stato HTTP a messaggio e azione, al posto dell'unico «Errore durante la richiesta». |

### Pagine di dettaglio

| Percorso | Responsabilità |
| --- | --- |
| `components/page-header/` | Lo stesso componente delle pagine elenco, esteso con gli ingressi `backLink`, `kicker` e `state` e con la proiezione per la riga di metadati. Un solo componente per entrambi i gusci. |
| `components/form-field/` | Lo stesso componente dei dialoghi, riusato senza modifiche nei moduli di dettaglio, così un campo obbligatorio si comporta allo stesso modo dentro e fuori da un modale. |
| `components/detail-section/` | Sezione. Card con titolo `h2`, conteggio, descrizione e proiezione per le azioni di sezione. Ingresso `dirty` per dichiarare che la sezione è un'unità salvabile autonoma. Non applica margini esterni: la distanza dalle altre zone appartiene al contenitore di pagina. L'intestazione unifica le tre varianti di `.widget-header` della dashboard. |
| `components/danger-zone/` | Zona pericolosa. Accetta un elenco di operazioni, ognuna con titolo, conseguenza, etichetta e gravità. Non applica margini esterni ed è sempre l'ultima figlia del contenitore delle zone. Assorbe i nove blocchi oggi copiati. |
| `pages/_shared/detail-page.base.ts` | Classe base con il registro delle unità salvabili, `isDirty` composito derivato, `loading`, `saving`, e l'implementazione di `HasUnsavedChanges` che elenca alla guardia le unità modificate. |

## Ordine di migrazione

La migrazione è partita dai difetti che comportavano una perdita di dati o un comportamento errato, poi dai componenti a maggior copertura, infine dalle singole pagine, in quest'ordine:

1. Il salvataggio delle presenze in `calendar-events/detail`: è una perdita di dati e non aspetta il resto.
2. La doppia dichiarazione di `p-confirmdialog key="guard"`, la spaziatura delle card e l'immagine remota di `forbidden`: correzioni di poche righe ciascuna.
3. Traduzione di `notfound` e `forbidden`.
4. `confirm.service.ts` e revisione di `ToastService`.
5. `inline-alert`, con la sostituzione dei sei banner artigianali; `legal-acceptance` per primo, perché è l'unico visibile a utenti non ancora autenticati e oggi ignora il tema scuro.
6. Distinzione degli errori di rete nell'interceptor.
7. `dialog-shell` e `form-field`, con `add-instruments-dialog` come banco di prova, e a seguire gli altri dialoghi dinamici.
8. Le `p-dialog` inline di `finance`, che sono anche una riscrittura strutturale.
9. Allineamento della lettura delle preferenze all'avvio, prerequisito della persistenza della vista.
10. `list-row`, `empty-state` e l'intestazione di sezione, estratti dai widget della dashboard secondo quanto descritto sopra.
11. `page-header`, `list-toolbar` e `danger-zone`: `page-header` da solo sistema titolo, ritorno e stato in tutte e nove le pagine di dettaglio.
12. Strumento ed Elenco strumenti, come banco di prova: sono le due pagine più semplici e verificano entrambi i gusci a costo minimo.
13. Istanze, Utenti, Album, Tracce, elenco e dettaglio insieme.
14. Calendario e Inventario, che hanno zone di contesto proprie e il maggior numero di unità salvabili.
15. Profilo, che adotta il guscio di dettaglio senza avere un elenco.
16. Economia e Documenti legali, che adottano il solo guscio di elenco.
17. Adozione dei componenti condivisi nei widget della dashboard, con `inventory-widget` riallineato agli altri cinque.

## Scostamenti consapevoli

Due punti divergono dalla lettera della specifica, per ragioni che vale la pena mettere a verbale.

**La barra strumenti di `finance` resta il suo pannello di filtri.** `finance` non adotta `list-toolbar`: la zona barra strumenti è occupata dalla propria griglia di otto filtri con «Applica» e «Azzera», che il componente condiviso — una riga sola con ricerca, ordinamento e cambio vista — non può contenere senza peggiorare la pagina. La zona è al posto giusto e nell'ordine giusto; cambia soltanto il componente che la riempie. `legal-documents`, che ha la sola ricerca, adotta invece `list-toolbar` con il selettore di vista disattivato.

**La shell resta su `*ngIf` e `*ngFor`.** `topbar`, `menu`, `menu-item`, `configurator` e `loading-spinner` non sono stati migrati alla nuova sintassi: sono codice di piattaforma e il loro ridisegno è fuori scope. Ognuno importa da sé le direttive che usa, così `NgIf` e `NgFor` sono stati rimossi da `imports.ts` e non sono più disponibili globalmente: ogni superficie di contenuto è su `@if` e `@for`, `preview` compresa.

## Interventi applicati

### Collocazione degli stili di `preview`

Le 376 righe di `assets/layout/_preview.scss` sono state spostate in `preview.component.scss`. Erano nella cartella globale del layout pur descrivendo una sola pagina, e la loro portata globale produceva effetti indesiderati altrove.

Prima dello spostamento sono state verificate una per una le trentasei classi del foglio, per accertare che nessuna fosse usata fuori da `preview`. Tre risultavano condivise, ma solo una lo era davvero:

- `filter-action` era un falso positivo: `finance` usa `filter-actions`, al plurale, definita nel proprio foglio di stile.
- `sidebar-header` collideva di nome con `pdf-manipulator-dialog`, che possiede però una propria definizione annidata e vince per specificità. La regola globale era una perdita inerte dentro quel dialogo, e lo spostamento la elimina.
- `image-galleria` è realmente condivisa con `tracks/detail`, che definisce soltanto `min-height` e `max-height` e dipende dalla regola globale per `max-width` e `object-fit`. Non è stata spostata nel componente: è stata portata in `styles.scss`, dove risiedono gli stili effettivamente trasversali, con un commento che ne dichiara gli utilizzatori.

Un adattamento è stato necessario. Quattro regole dentro `@media (max-width: 640px)` colpiscono il DOM interno di PrimeNG — `.preview-actions .p-button` e `.p-button-label` — che non porta l'attributo di incapsulamento del componente. In un foglio globale funzionavano; incapsulate sarebbero smesse di applicarsi senza alcun errore, rompendo la barra azioni soltanto sotto i 640 pixel. Sono state racchiuse in `::ng-deep`, separandole dai gruppi di selettori in cui erano mescolate.

È il modello da seguire per ogni futura migrazione di stili dal layout globale ai componenti: verificare l'esclusività classe per classe, portare in `styles.scss` ciò che è davvero trasversale, e racchiudere in `::ng-deep` ciò che attraversa il confine di un componente PrimeNG.

### Budget sugli stili di componente

`angular.json` fissava per `anyComponentStyle` un avviso a 2 kB e un errore a 4 kB. Lo spostamento porta `preview.component.scss` a 6.35 kB e quindi oltre la soglia di errore: quelle righe prima non venivano conteggiate perché stavano in un foglio globale.

La soglia era però già superata prima di questo intervento, e da un componente non toccato: `pdf-manipulator-dialog.component.scss` pesa 6.34 kB. La compilazione di produzione era quindi già in errore su questo ramo, per la stessa ragione, e lo sarebbe rimasta anche annullando la migrazione.

`maximumError` è stato portato a **8 kB**, lasciando l'avviso a 2 kB. La soglia accoglie i due componenti-pagina legittimamente estesi con un margine, e l'avviso continua a segnalare tutto il resto: la compilazione oggi si chiude senza errori e riporta sette avvisi, che sono la lista dei fogli di stile su cui il lavoro di estrazione dei componenti condivisi avrà l'effetto maggiore.

| Foglio di stile | Peso alla stesura | Peso a migrazione completata |
| --- | --- | --- |
| `preview.component.scss` | 6.35 kB | 6.35 kB |
| `pdf-manipulator-dialog.component.scss` | 6.34 kB | 6.34 kB |
| `notification-widget.component.scss` | 3.82 kB | sotto soglia |
| `calendar-events-widget.component.scss` | 2.81 kB | sotto soglia |
| `recents-widget.component.scss` | 2.48 kB | sotto soglia |
| `finance.component.scss` | 2.17 kB | sotto soglia |

Tre dei sei sono widget della dashboard, e il loro peso è in buona parte la duplicazione descritta più sopra: l'adozione dei componenti condivisi li ha riportati sotto la soglia di avviso senza interventi dedicati. `finance.component.scss` è rientrato cedendo a `_list.scss` le card di riepilogo della zona Contesto, e `inventory.component.scss` è stato eliminato perché le sue quattro classi non hanno più utilizzatori. Restano fuori `preview` e `pdf-manipulator-dialog`, che sono componenti-pagina con esigenze proprie.

La compilazione di produzione si chiude oggi senza errori e con tre soli avvisi: quei due fogli di stile e il budget del bundle iniziale, che è una questione a sé e non riguarda questa specifica.

L'avviso a 2 kB va lasciato dov'è: è la misura che rende visibile il progresso.

### Il nome degli ingressi non può essere quello di un attributo HTML

`page-header`, `detail-section`, `empty-state`, `inline-alert` e `dialog-shell` esponevano tutti un ingresso chiamato `title`. È il nome più naturale per un titolo, ed è anche il nome di un attributo HTML globale: la collisione non è un dettaglio estetico.

Quando un componente riceve un attributo **statico** — `title="Tracce recenti"`, senza parentesi — Angular valorizza l'ingresso e lascia comunque l'attributo sull'elemento host nel DOM. Il browser ci trova un `title` vero e ci disegna sopra il proprio tooltip nativo. Sulla dashboard comparivano così tre riquadri che ripetevano, sotto il cursore, il titolo già stampato nell'intestazione appena sopra: «Tracce recenti», «Da fare», «Nessun evento in programma». Il difetto era diffuso su circa centotrentacinque punti dell'applicazione, uno per ogni uso in forma statica dei cinque componenti; la forma con binding, `[title]="..."`, non lo produceva, e questo spiega perché comparisse solo su alcune superfici.

L'ingresso è stato rinominato in `heading` su tutti e cinque i componenti, insieme a `titleId` di `detail-section`, che è diventato `headingId`. Sono state allineate anche le due classi che portavano il vecchio nome, `detail-section__title` e `page-header__title-row`. L'alternativa era conservare il nome e cancellare l'attributo con un host binding `[attr.title]="null"`: una riga per componente invece di sessantotto file. È stata scartata perché avrebbe lasciato in piedi la collisione, chiedendo a ogni modifica futura di ricordarsi della contromisura.

Due punti non erano raggiungibili con una ricerca testuale e li ha trovati il compilatore. In `dialog-shell.component.ts` il `title:` passato a `confirmDiscard` non era l'ingresso del componente ma una proprietà di `ConfirmRequest`, e non andava toccato. In `calendar-feeds.component.ts` il componente era dichiarato con un `template:` in linea anziché con un file `.html`, e sfuggiva quindi alla scansione dei template; nella stessa occasione template e stili sono stati portati in file esterni, come negli altri componenti.

Ne discende una regola per i componenti condivisi: **nessun ingresso può chiamarsi come un attributo HTML globale**. Oltre a `title` valgono almeno `id`, `class`, `style`, `lang`, `dir`, `role`, `hidden` e `slot`. Quando il nome naturale è occupato, si usa il sinonimo del concetto — `heading` per il titolo — e non una variante decorata del nome riservato.

## Fuori scope

- Modifiche al modello dati diverse dal riuso della tabella `preferences`.
- Ridisegno della dashboard e della disposizione dei suoi widget: la dashboard adotta i componenti condivisi ma conserva composizione e contenuti attuali.
- Ridisegno di `preview`, che già aderisce al modello e serve da riferimento. La collocazione dei suoi stili, unica questione che era rimasta aperta, è stata risolta.
- Ridisegno della shell — `topbar`, `sidebar`, `menu`, `footer` — che è codice di piattaforma e non condivide vocabolario con le pagine di contenuto.
- Ridisegno di `pdf-manipulator-dialog`, che è uno strumento a piena finestra e resta fuori dalla scala delle tre taglie.
- Introduzione di nuovi filtri o di nuovi criteri di ordinamento oltre alla traduzione di quelli esistenti.
- Introduzione di un cestino o di un percorso di ripristino per i record con `deleted = true`: la specifica ne prende atto per formulare i messaggi di conferma e per fissare la gravità della zona pericolosa, ma non lo richiede.
- Revisione della logica di dominio delle pagine di dettaglio: la specifica interviene sul salvataggio solo per delimitare l'ambito di ciascun pulsante, non per cambiare cosa ciascuna operazione scrive.
- Modifiche al backend, con l'unica eccezione della mappatura degli errori nell'interceptor, che è comunque lato client. La specifica non richiede nuovi endpoint né migrazioni Liquibase.

## Scostamenti noti

Punti in cui il codice diverge dalle regole di questa specifica, da correggere o da accogliere nella regola.

| Punto | Regola | Scostamento |
| --- | --- | --- |
| `taurus-fe/angular.json`, budget `anyComponentStyle` | [Budget sugli stili di componente](#budget-sugli-stili-di-componente): avviso a 2 kB, errore a 8 kB | l'avviso è a 7 kB dal commit «Align frontend and extend tenant features»: la compilazione non segnala più i fogli di stile tra 2 e 7 kB. `preview.component.scss` (7,99 kB) e `pdf-manipulator-dialog.component.scss` (7,72 kB) superano l'avviso e il primo è a circa 200 byte dalla soglia d'errore di 8 KiB |
| `image-editor-dialog`, `score-editor-dialog`, `score-player-dialog` | [Il dialogo standard](#il-dialogo-standard): guscio `dialog-shell` | non usano `dialog-shell`; come `pdf-manipulator-dialog`, escluso in [Fuori scope](#fuori-scope), sono strumenti a piena finestra (95, 100 e 96 vw): l'esclusione va estesa o i dialoghi allineati |
| `image-editor-dialog`, `pdf-manipulator-dialog` | [Toast e banner](#toast-e-banner): banner tramite `inline-alert` | usano `p-message` direttamente |
