# Guida introduttiva per ruolo

La funzionalità accompagna l'utente al primo ingresso in Taurus con un percorso visivo breve, costruito sul ruolo scelto all'accesso e sulle funzionalità attive nel tenant. Si appoggia al [Catalogo delle funzionalità del tenant](tenant-feature-flags-spec.md), rispetta lo [Standard di layout Taurus](taurus-layout-standard.md) e usa le chiavi dello [Standard degli errori applicativi](application-errors-standard.md).

Non va confusa con due elementi già presenti:

- l'[Onboarding guidato e importazione iniziale del tenant](tenant-onboarding-import-spec.md), voce di menu **Configurazione iniziale**, che carica dati in massa;
- la modalità **Primo accesso** descritta in [PostgreSQL schema per tenant](postgres-tenant-schemas.md), in cui il super amministratore crea il primo tenant su un ambiente vuoto.

Per evitare ambiguità l'interfaccia chiama la nuova funzionalità **Guida**, il codice usa il prefisso `guided-tour` e i testi non usano le parole «onboarding», «wizard» o «primo accesso».

## Stato del documento

ID catalogo: `guided-tour`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

## Contesto

Oggi un utente che entra per la prima volta riceve l'e-mail di impostazione della password, sceglie tenant e ruolo nella schermata Keycloak quando ne ha più di uno, accetta i documenti legali e arriva sulla dashboard. Da quel momento nessun elemento spiega cosa può fare con il ruolo scelto, dove si trovano le funzioni e quali dipendono dalle funzionalità del tenant.

Fatti del codice che condizionano la progettazione:

| Fatto | Fonte | Conseguenza |
| --- | --- | --- |
| Una persona può avere più tenant e più ruoli per tenant; ne sceglie una coppia a ogni accesso | `TenantRoleSelectorAuthenticator`, claim `tenant` e `role` | la guida dipende dal ruolo della sessione, non dalla sola persona |
| La sessione ha un solo ruolo effettivo | `KeycloakService.currentUserRole` | nessuna unione di ruoli nella stessa sessione |
| Menu, rotte e widget dipendono da ruolo e flag del tenant | `MenuComponent`, `app.routes.ts`, `tenantFeatureGuard` | ogni tappa dichiara ruoli e funzionalità richieste |
| Non esiste un indicatore di primo accesso | nessuna colonna `first_login` o simile | lo stato della guida è un dato nuovo |
| `localStorage` viene svuotato alla chiusura della finestra e le chiavi non includono utente o tenant | `AppComponent.unloadHandler`, `LocalStorageService` | lo stato non può vivere nel browser |
| Le preferenze personali sono per utente e per schema tenant | `preferences`, `notification_profile` | la guida segue lo stesso perimetro, in tabelle tipizzate come le specifiche recenti |
| Su schermi fino a 991 px il menu laterale è a scomparsa e le azioni della topbar sono raccolte nel pulsante a tre punti | `LayoutService.isDesktop`, `topbar.component.html` | le evidenziazioni devono avere un'alternativa su mobile |
| PrimeNG 19.0.10 offre `p-popover` ancorabile a un elemento, `p-stepper` e la direttiva `pFocusTrap`, ma non un componente tour | `node_modules/primeng` | la guida si costruisce con componenti esistenti, senza nuove dipendenze |
## Obiettivo

Permettere a ogni utente di capire in circa due minuti cosa può fare con il proprio ruolo, dove si trova ogni funzione e come tornare alla guida, senza leggere manuali e senza essere interrotto più del necessario.

La prima versione deve:

- avviare automaticamente la guida al primo ingresso con un ruolo;
- mostrare soltanto le tappe pertinenti al ruolo della sessione e alle funzionalità attive del tenant;
- evidenziare graficamente gli elementi dell'interfaccia di cui parla, con un'alternativa centrata quando l'elemento non è visibile;
- permettere di interrompere, riprendere, saltare e ricominciare la guida;
- permettere a ogni utente di disattivare e riattivare l'avvio automatico;
- restare disponibile su richiesta in ogni momento;
- funzionare su desktop e mobile, da tastiera e con lettore di schermo;
- non aggiungere peso al caricamento iniziale dell'applicazione.

## Decisioni principali

| Aspetto | Decisione proposta |
| --- | --- |
| Nome nell'interfaccia | **Guida** |
| Unità di stato | persona e ruolo, separatamente in ogni tenant |
| Persistenza | due tabelle tipizzate nello schema del tenant |
| Avvio automatico | interruttore unico per persona nel tenant, attivo per default |
| Avvio manuale | sempre disponibile dal pulsante di aiuto della topbar, anche con avvio automatico disattivato |
| Momento dell'avvio | solo sulla dashboard, dopo accettazione dei documenti legali e caricamento delle funzionalità del tenant |
| Struttura | una scheda di benvenuto e da 5 a 10 tappe per ruolo |
| Presentazione | scheda ancorata all'elemento evidenziato, oppure scheda centrata |
| Interazione con la pagina | la guida mostra e non agisce: durante una tappa la pagina non riceve clic |
| Contenuti | catalogo statico nel frontend, in italiano, con identificativi stabili |
| Dipendenze | nessuna nuova libreria; componenti PrimeNG e Tailwind già presenti |
| Caricamento | componente e catalogo caricati in modo differito, solo quando servono |
| Utenti esistenti al rilascio | invito discreto sulla dashboard invece dell'avvio automatico |
| Modalità bootstrap | esclusa: resta l'avviso «Primo accesso» già presente nella pagina Tenant |
| Flag del tenant | nessun nuovo flag; un interruttore applicativo di emergenza |
| Lingua | solo italiano, catalogo predisposto per altre lingue |

## Ambito della prima versione

### Compreso

- percorso principale per i sette ruoli: Super amministratore, Amministratore, Direttivo, Tesoriere, Archivista, Utente, Utente esterno;
- filtro delle tappe per ruolo e per funzionalità del tenant;
- scheda di benvenuto con nome, organizzazione e ruolo;
- evidenziazione degli elementi con ripiego sulla scheda centrata;
- navigazione automatica verso la pagina di una tappa;
- comandi Avanti, Indietro, Salta la guida, Chiudi e Fine;
- ripresa dall'ultima tappa vista;
- interruttore personale di avvio automatico e comando per ricominciare;
- pulsante di aiuto nella topbar;
- sezione **Guida** nella pagina profilo;
- invito una tantum agli utenti esistenti al rilascio;
- API, migrazione, test e criteri di accettazione.

### Fuori ambito

- guide di pagina su richiesta, previste nella fase 2;
- segnalazione delle novità dopo un rilascio, prevista nella fase 3;
- tappe che chiedono di compiere un'azione reale, per esempio indicare una disponibilità;
- video, animazioni complesse, immagini o illustrazioni dedicate;
- testi modificabili da amministratori o tenant;
- obbligo di completare la guida prima di usare Taurus;
- statistiche individuali sull'uso della guida;
- avvio della guida da parte di un amministratore per conto di un altro utente;
- guida nella modalità bootstrap, nella pagina pubblica di firma e nelle pagine fuori dal layout.

## Terminologia

- **Guida**: l'insieme di benvenuto e tappe per il ruolo della sessione.
- **Tappa**: un passo della guida con titolo, testo breve, eventuale pagina di destinazione ed eventuale elemento da evidenziare.
- **Ancora**: identificativo stabile assegnato a un elemento dell'interfaccia che una tappa può evidenziare.
- **Scheda ancorata**: presentazione accanto all'elemento evidenziato, con il resto della pagina oscurato.
- **Scheda centrata**: presentazione al centro dello schermo, senza evidenziazione.
- **Avvio automatico**: apertura della guida senza richiesta dell'utente.
- **Proposta automatica**: ogni volta che la guida si apre da sola per un ruolo non ancora concluso.
- **Invito**: banner sulla dashboard che propone la guida agli utenti già presenti al rilascio.

## Esperienza utente

### Sequenza del primo ingresso

```text
E-mail di impostazione password
    -> login Keycloak
    -> scelta tenant e ruolo (solo se più di uno)
    -> accettazione documenti legali (se richiesta)
    -> dashboard
    -> scheda di benvenuto della Guida
```

La guida non parte su altre pagine. Un utente che entra da un collegamento diretto, per esempio da una notifica push, da un'e-mail o dalla scansione di un codice QR, arriva a destinazione senza interruzioni; la guida viene proposta alla prima visita successiva della dashboard.

### Scheda di benvenuto

```text
┌──────────────────────────────────────────────┐
│                  (icona ruolo)               │
│          Benvenuto in Taurus, Maria          │
│                                              │
│  Sei in Banda Musicale Santa Cecilia come    │
│  Utente. In circa due minuti ti mostriamo    │
│  cosa puoi fare.                             │
│                                              │
│        [ Inizia la guida ]   Più tardi       │
│                                              │
│  Non avviare più la guida automaticamente    │
└──────────────────────────────────────────────┘
```

- **Inizia la guida** passa alla prima tappa.
- **Più tardi** chiude la scheda per la sessione corrente; la guida sarà riproposta al prossimo accesso.
- **Non avviare più la guida automaticamente** spegne l'interruttore personale; un toast conferma e indica dove riattivarlo.

L'organizzazione è il nome del tenant mostrato nella topbar. Per i ruoli diversi dal Super amministratore i testi dicono «organizzazione», mai «tenant».

### Tappa con evidenziazione

```text
 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 ░┌────────────┐░░┌────────────────────────────────┐
 ░│ Calendario │◄─┤ Eventi e disponibilità       × │
 ░└────────────┘░░│                                │
 ░░░░░░░░░░░░░░░░░│ Nel calendario trovi concerti  │
 ░░░░░░░░░░░░░░░░░│ e prove. Apri un evento e      │
 ░░░░░░░░░░░░░░░░░│ indica se ci sarai.            │
 ░░░░░░░░░░░░░░░░░│ • Riceverai un promemoria      │
 ░░░░░░░░░░░░░░░░░│                                │
 ░░░░░░░░░░░░░░░░░│ ● ● ● ○ ○ ○ ○ ○        3 di 8  │
 ░░░░░░░░░░░░░░░░░│ Salta la guida  Indietro Avanti│
 ░░░░░░░░░░░░░░░░░└────────────────────────────────┘
```

La pagina viene oscurata con un velo semitrasparente che lascia libero un riquadro attorno all'elemento evidenziato. La scheda si posiziona accanto al riquadro, preferendo destra, sotto, sopra e sinistra in quest'ordine; se non c'è spazio sufficiente diventa centrata.

### Composizione della scheda

| Zona | Contenuto | Limite |
| --- | --- | --- |
| Intestazione | icona PrimeIcons della tappa e titolo | titolo entro 40 caratteri |
| Corpo | una o due frasi | entro 180 caratteri |
| Punti | dettagli che dipendono dalle funzionalità del tenant | massimo 3, entro 60 caratteri ciascuno |
| Avanzamento | pallini e testo «3 di 7» | sempre visibile |
| Piede | **Salta la guida** come testo a sinistra; **Indietro** secondario e **Avanti** primario a destra | all'ultima tappa **Avanti** diventa **Fine** |
| Chiusura | icona di chiusura nell'intestazione | equivale a una pausa |

La scheda è larga al massimo 22rem, usa i token di colore PrimeNG per tema chiaro e scuro, non contiene immagini e non usa animazioni oltre a una dissolvenza di 150 ms, disattivata con `prefers-reduced-motion`.

### Comandi e loro effetto

| Comando | Effetto sullo stato del ruolo | Effetto sull'avvio automatico |
| --- | --- | --- |
| Inizia la guida | `IN_PROGRESS` | nessuno |
| Avanti, Indietro | aggiorna ultima tappa e tappe viste | nessuno |
| Chiudi o `Esc` | resta `IN_PROGRESS`, conserva l'ultima tappa | conta come proposta automatica se la guida era partita da sola |
| Più tardi | invariato | rinvio per la sola sessione corrente |
| Salta la guida | `SKIPPED` | resta acceso per gli altri ruoli |
| Fine | `COMPLETED` | nessuno |
| Non avviare più la guida automaticamente | invariato | spento per tutti i ruoli nel tenant corrente |
| Ricomincia la guida, dal profilo | stato del ruolo azzerato | invariato |

**Salta la guida** non chiede conferma: è reversibile dal pulsante di aiuto. Il toast di esito dice «Guida chiusa. Puoi riaprirla dal pulsante ? in alto».

### Mobile

Sotto i 992 px:

- le tappe sul menu evidenziano il pulsante che apre il menu;
- le tappe sulle azioni della topbar evidenziano il pulsante a tre punti;
- le tappe con una pagina di destinazione evidenziano l'intestazione della pagina;
- se nessuna ancora candidata è visibile, la tappa usa la scheda centrata;
- la scheda occupa la larghezza disponibile meno 1rem per lato e si posiziona sotto o sopra l'elemento.

### Accessibilità

- La scheda ha `role="dialog"`, `aria-modal="true"`, `aria-labelledby` sul titolo e `aria-describedby` sul corpo.
- Il fuoco entra sul comando primario, resta nella scheda con `pFocusTrap` e torna all'elemento che lo aveva prima dell'apertura.
- `Esc` equivale a **Chiudi**.
- Una regione `aria-live="polite"` annuncia «Passo 3 di 7: Eventi e disponibilità».
- Ogni testo è comprensibile senza vedere l'evidenziazione: indica dove si trova l'elemento, per esempio «nel menu a sinistra, voce Calendario».
- Con zoom al 200% o altezza inferiore a 480 px la scheda è sempre centrata e scorrevole.

## Contenuti per ruolo

### Regole di composizione

Ogni tappa del catalogo dichiara:

| Campo | Significato |
| --- | --- |
| `id` | identificativo stabile, formato `{area}.{oggetto}` in camelCase |
| `roles` | ruoli a cui si applica |
| `requires` | funzionalità del tenant tutte necessarie; tappa esclusa se una manca. La guida non mostra né cita le sezioni non attive |
| `route` | pagina da aprire prima di mostrare la tappa, facoltativa |
| `anchors` | ancore candidate in ordine di preferenza, facoltative |
| `mobileAnchors` | ancore candidate sotto i 992 px, quando diverse: una tappa di pagina punta all'intestazione |
| `icon` | icona PrimeIcons |
| `title`, `body` | testi, con varianti per ruolo quando servono |
| `points` | punti facoltativi, ciascuno con le proprie `requires` |
| `introducedIn` | revisione del catalogo che ha introdotto la tappa |

La guida di un ruolo è l'elenco ordinato delle tappe applicabili. Benvenuto e tappa finale sono sempre presenti. Il limite è di 10 tappe incluso il benvenuto; l'obiettivo è da 6 a 8. Le funzioni secondarie degli amministratori sono raccolte in una sola tappa e approfondite dalle guide di pagina della fase 2.

### Tappe comuni

| ID | Titolo | Pagina e ancora | Testo e punti |
| --- | --- | --- | --- |
| `common.welcome` | Benvenuto in Taurus | scheda centrata | nome, organizzazione, ruolo e durata stimata |
| `common.navigation` | Il menu | `layout.menu`; su mobile `layout.menuButton` | «Dal menu raggiungi le sezioni del tuo ruolo: vedi solo ciò che puoi usare.» |
| `common.notifications` | Le notifiche | `/`, `dashboard.notifications` | «Qui arrivano le notifiche: aprile per andare al dettaglio o segnale come lette.» Punti: «Rimandale con le azioni di posticipo», sempre; «Scegli cosa ricevere dal profilo» e «Attiva le notifiche su questo dispositivo» con `NOTIFICATION_PREFERENCES`, da cui dipendono preferenze e registrazione push |
| `common.profile` | Il tuo profilo | `topbar.profile`; su mobile `topbar.more` | «Nel profilo aggiorni i tuoi dati, la password e la verifica in due passaggi.» Punto per Utente e Utente esterno con `EXTERNAL_CALENDAR_FEED`: «Collega Taurus al calendario del telefono» |
| `common.help` | Quando ti serve | `topbar.help` | «Riapri la guida quando vuoi da qui. Se preferisci che non parta da sola, disattivala dal profilo.» |

### Utente

| Ordine | ID | Pagina e ancora | Condizioni | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1 | `common.welcome` | — | — | — |
| 2 | `common.navigation` | — | — | — |
| 3 | `calendar.availability` | `/calendar`, `calendar.header` | `CALENDAR` | «Nel calendario trovi concerti e prove. Apri un evento e indica se ci sarai: chi organizza vede subito la risposta.» Punti: «Nel dettaglio trovi luogo, orario e scaletta»; «Riceverai un promemoria prima dell'inizio» con `WEB_PUSH_REMINDERS` |
| 4 | `catalog.tracks` | `/tracks`, `tracks.header` | — | «In Tracce trovi il repertorio con gli spartiti dei tuoi strumenti; in Album i brani sono raccolti per programma.» Punto: «Ascolta le parti mentre leggi» con `SCORE_PLAYBACK` |
| 5 | `inventory.mine` | `/inventory`, `inventory.header` | `INVENTORY` | «Qui trovi strumenti e materiali che ti sono stati affidati: prendine visione o avvia la riconsegna.» Punti: «Scarica i fogli di affidamento» con `INVENTORY_LOAN_SHEET`; «Firma gli atti quando ti viene chiesto» con `INVENTORY_SIGNATURE`; «Inquadra il QR dell'oggetto per segnalare un guasto» con `INVENTORY_QR` |
| 6 | `common.notifications` | — | — | — |
| 7 | `common.profile` | — | — | — |
| 8 | `common.help` | — | — | — |

### Utente esterno

Stesse tappe dell'Utente, con varianti di testo che non promettono ciò che il ruolo non vede:

- `calendar.availability`: «Nel calendario trovi gli eventi pubblici a cui puoi partecipare…»;
- `catalog.tracks`: «In Tracce trovi i brani pubblici con gli spartiti dei tuoi strumenti…».

### Archivista

| Ordine | ID | Pagina e ancora | Condizioni | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1–2 | benvenuto e menu | — | — | — |
| 3 | `catalog.manage` | `/tracks`, `tracks.create` | — | «Crea album e tracce e carica gli spartiti in PDF, associando ogni parte al suo strumento.» |
| 4 | `catalog.instruments` | `/instruments`, `instruments.header` | — | «L'elenco degli strumenti dell'organizzazione serve ad abbinare parti e musicisti.» |
| 5 | `calendar.program` | `/calendar`, `calendar.header` | `CALENDAR` | «Apri un evento e collega un album: le sue tracce diventano la scaletta. Puoi indicare anche la tua disponibilità.» Punto: «Nel riepilogo vedi cosa manca a programma e spartiti» con `EVENT_PREPARATION` |
| 6 | `inventory.mine` | come per l'Utente | `INVENTORY` | come per l'Utente |
| 7–9 | notifiche, profilo, aiuto | — | — | — |

### Tesoriere

| Ordine | ID | Pagina e ancora | Condizioni | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1–2 | benvenuto e menu | — | — | — |
| 3 | `finance.overview` | `/finance`, `finance.summary` | `FINANCE` | «In Economia trovi conti, saldi e movimenti dell'organizzazione.» |
| 4 | `finance.movements` | `/finance`, `finance.create` | `FINANCE` | «Registra entrate, uscite e trasferimenti, allega le ricevute e segna i movimenti riconciliati.» |
| 5 | `finance.events` | scheda centrata | `FINANCE`, `CALENDAR` | «Le notifiche economiche ti portano al dettaglio dell'evento, dove gestisci preventivo e consuntivo.» |
| 6–8 | notifiche, profilo, aiuto | — | — | — |

Senza `FINANCE` il percorso del Tesoriere si riduce a benvenuto, menu, notifiche, profilo e aiuto.

### Amministratore

| Ordine | ID | Pagina e ancora | Condizioni | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1–2 | benvenuto e menu | — | — | — |
| 3 | `admin.users` | `/users`, `users.create` | — | «Aggiungi i membri dell'organizzazione e assegna il ruolo: riceveranno un'e-mail per impostare la password.» |
| 4 | `admin.calendar` | `/calendar`, `calendar.create` | `CALENDAR` | «Crea prove e concerti, anche ricorrenti, e segui chi ha risposto.» Punti: «Controlla materiali, programma e costi nella preparazione» con `EVENT_PREPARATION`; «Conferma le presenze dopo l'evento» |
| 5 | `admin.inventory` | `/inventory`, `inventory.create` | `INVENTORY` | «Registra strumenti e materiali, affidali ai membri e segui riconsegne e scadenze.» Punti: «Stampa le etichette con il QR» con `INVENTORY_QR`; «Prepara il modello del foglio di affidamento» con `INVENTORY_LOAN_SHEET` |
| 6 | `finance.overview` | come per il Tesoriere | `FINANCE` | variante: «…e prepari preventivi e consuntivi degli eventi.» |
| 7 | `admin.tools` | `layout.menu.admin`; su mobile `layout.menuButton` | — | «Nel menu trovi anche gli strumenti di amministrazione.» Punti: «Configurazione iniziale: importa dati da un file» con `ONBOARDING_IMPORT`; «Consegne notifiche: controlla quelle non arrivate»; «Feed calendario: pubblica il calendario» con `EXTERNAL_CALENDAR_FEED` |
| 8–10 | notifiche, profilo, aiuto | — | — | — |

Album, tracce e strumenti, disponibili anche all'Amministratore, sono lasciati alle guide di pagina per rispettare il limite di 10 tappe.

### Direttivo

Il [Ruolo direttivo](board-role-spec.md) gestisce l'associazione come l'Amministratore: utenti, calendario ed eventi, inventario, economia e catalogo. Non vede Configurazione iniziale, Consegne notifiche e Feed calendario, quindi il suo percorso non ha la tappa `admin.tools`.

| Ordine | ID | Pagina e ancora | Condizioni | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1–2 | benvenuto e menu | — | — | — |
| 3 | `admin.users` | come per l'Amministratore | — | variante: «Aggiungi i membri dell'organizzazione e assegna il ruolo: riceveranno un'e-mail per impostare la password. Solo l'Amministratore gestisce gli amministratori.» |
| 4 | `admin.calendar` | come per l'Amministratore | `CALENDAR` | come per l'Amministratore |
| 5 | `admin.inventory` | come per l'Amministratore | `INVENTORY` | come per l'Amministratore |
| 6 | `finance.overview` | come per il Tesoriere | `FINANCE` | variante dell'Amministratore |
| 7–9 | notifiche, profilo, aiuto | — | — | — |

Come per l'Amministratore, album, tracce e strumenti sono lasciati alle guide di pagina.

### Super amministratore

| Ordine | ID | Pagina e ancora | Condizioni | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1–2 | benvenuto e menu | — | — | — |
| 3 | `superAdmin.tenants` | `/tenants`, `tenants.header` | — | «Crea e gestisci i tenant e scegli quali funzionalità attivare per ciascuno.» |
| 4 | `superAdmin.legalDocuments` | `/legal-documents`, `legalDocuments.header` | — | «Pubblica privacy e condizioni d'uso: gli utenti le accettano al primo ingresso e a ogni nuova versione.» |
| 5 | `admin.users` | come per l'Amministratore | — | — |
| 6 | `admin.tools` | come per l'Amministratore | — | — |
| 7–9 | notifiche, profilo, aiuto | — | — | — |

### Variazioni delle funzionalità

Le funzionalità sono valutate quando la guida si apre, con i valori già caricati da `TenantFeatureService`. Se un flag cambia mentre la guida è aperta, la composizione resta quella dell'apertura; il conteggio si aggiorna alla riapertura. Una tappa vista resta vista anche se la funzionalità viene poi disattivata.

## Disattivazione e riattivazione

La proposta separa due concetti, così ogni scelta ha un effetto prevedibile:

1. **Avvio automatico**, personale e valido per tutti i ruoli della persona nel tenant corrente.
2. **Stato del ruolo**, cioè a che punto è la guida del ruolo corrente in quel tenant.

Entrambi appartengono al tenant: in un'altra organizzazione la persona ritrova la guida con l'impostazione e lo stato di quell'organizzazione, che può avere funzionalità diverse.

### Dove si disattiva

- dalla scheda di benvenuto, con **Non avviare più la guida automaticamente**;
- dal profilo, sezione **Guida**, con l'interruttore **Avvia la guida automaticamente**.

### Dove si riattiva

- dal profilo, con lo stesso interruttore;
- implicitamente mai: nessuna azione di sistema riaccende l'avvio automatico.

Riattivato l'interruttore, la guida si riapre da sola alla visita successiva della dashboard se il ruolo corrente non è `COMPLETED` o `SKIPPED`. Per vederla subito il profilo offre **Apri la guida**.

### Avvio manuale sempre disponibile

Il pulsante di aiuto nella topbar, con icona `pi-question-circle` e tooltip «Aiuto», apre un piccolo menu:

- **Guida introduttiva**: riprende dall'ultima tappa se il ruolo è `IN_PROGRESS`, altrimenti riparte dall'inizio;
- **Guida di questa pagina**, dalla fase 2, solo sulle pagine che ne hanno una per la sessione;
- **Novità**, dalla fase 3, solo quando ce ne sono;
- **Assistenza e segnalazioni**, quando la relativa funzionalità sarà implementata.

Il pulsante resta visibile anche sotto i 992 px, accanto ai comandi del tema, perché è l'unico modo per ritrovare la guida.

### Sezione Guida del profilo

```text
Guida
Ti mostra cosa puoi fare con il tuo ruolo.

Avvia la guida automaticamente              [ ●  ]
Stato per il ruolo Utente: completata il 24/10/2026

[ Apri la guida ]   [ Ricomincia la guida ]
```

- L'interruttore si salva subito, come il consenso push del dispositivo, e non entra nel comando **Salva preferenze** delle notifiche.
- **Ricomincia la guida** azzera lo stato del solo ruolo corrente, senza conferma, e mostra un toast.
- Lo stato mostrato riguarda il ruolo della sessione; gli altri ruoli della persona non sono elencati.

## Regole di avvio automatico

La guida si apre da sola quando sono vere tutte le condizioni:

1. il tenant della sessione è provisionato;
2. la rotta corrente è la dashboard;
3. le funzionalità del tenant sono caricate;
4. l'interruttore personale è acceso;
5. il ruolo corrente non ha stato, oppure è `IN_PROGRESS` con meno di 3 proposte automatiche;
6. la persona non ha un invito in sospeso;
7. la guida non è stata rinviata con **Più tardi** nella sessione corrente;
8. nessun dialogo, conferma o strumento a schermo intero è aperto;
9. l'interruttore applicativo `application.guided-tour.enabled` è attivo.

Dopo 3 proposte automatiche chiuse senza concludere, la guida smette di aprirsi da sola per quel ruolo e il pulsante di aiuto mostra un punto informativo finché l'utente non la apre. Il rinvio **Più tardi** vive in `sessionStorage` con chiave che include utente, tenant e ruolo; non serve conservarlo oltre la sessione.

L'apertura attende 600 ms dopo il primo rendering della dashboard, per non sovrapporsi al caricamento dei widget.

### Utenti esistenti al rilascio

Una migrazione crea, in ogni schema tenant, il profilo della guida per ogni utente non cancellato di `app_user` con `legacy_invitation = true`. Per queste persone, finché il ruolo corrente non ha stato, la dashboard mostra un banner inline invece della scheda di benvenuto:

```text
ⓘ  Novità: una guida ti mostra in due minuti cosa puoi fare come Archivista.
   [ Inizia la guida ]   No, grazie
```

**Inizia la guida** apre la guida dal benvenuto; **No, grazie** porta il ruolo a `SKIPPED`. L'invito segue le stesse condizioni dell'avvio automatico, esclusa la 6: con l'interruttore spento non compare. Le persone aggiunte al tenant dopo il rilascio, o prive di una riga `app_user` nel tenant come può accadere al Super amministratore, ricevono la normale scheda di benvenuto.

## Modello dati

Le tabelle vivono nello schema del tenant, come `notification_profile`: lo stato di una persona è separato per ogni organizzazione e segue il ciclo di vita del tenant. Contengono soltanto interruttore, stato e ID delle tappe.

### `guided_tour_profile`

| Campo | Tipo indicativo | Regola |
| --- | --- | --- |
| `id` | `BIGINT` | PK |
| `user_keycloak_id` | `VARCHAR(255)` | subject Keycloak obbligatorio, univoco |
| `user_id` | `BIGINT` | FK facoltativa a `app_user`, assente per un Super amministratore senza profilo nel tenant |
| `auto_start_enabled` | `BOOLEAN` | default `true` |
| `legacy_invitation` | `BOOLEAN` | default `false`; `true` solo dalla migrazione |
| audit/versione | campi standard tenant | include lock ottimistico |

Il profilo si cerca per subject, come `notification_profile`, perché un Super amministratore può non avere una riga `app_user` nel tenant.

### `guided_tour_progress`

| Campo | Tipo indicativo | Regola |
| --- | --- | --- |
| `id` | `BIGINT` | PK |
| `profile_id` | `BIGINT` | FK con `ON DELETE CASCADE` |
| `role` | `VARCHAR(32)` | valore di `RoleEnum`, vincolato da un `CHECK` |
| `status` | `VARCHAR(16)` | `IN_PROGRESS`, `COMPLETED`, `SKIPPED` |
| `seen_steps` | `JSONB` | array di ID tappa, massimo 100 elementi |
| `last_step_id` | `VARCHAR(64)` | facoltativo |
| `auto_proposals` | `SMALLINT` | da 0 a 3 |
| `catalog_revision` | `INTEGER` | revisione del catalogo all'ultima decisione |
| `started_at`, `completed_at` | `TIMESTAMPTZ` | `completed_at` solo per `COMPLETED` |
| audit/versione | campi standard tenant | include lock ottimistico |

Vincolo univoco `(profile_id, role)`. L'assenza della riga equivale allo stato «mai iniziata». `JSONB` segue la mappatura già usata da `OnboardingImportRow` con `@JdbcTypeCode(SqlTypes.JSON)`.

### Migrazione

Un changelog incluso in `tenant-master.xml`:

1. crea le due tabelle e i vincoli;
2. inserisce un profilo con `legacy_invitation = true` per ogni riga di `app_user` con `deleted = false`, copiando `keycloak_id` e `id`;
3. non crea righe di avanzamento.

La migrazione non richiede dati Keycloak e non duplica profili già esistenti. `TenantSchemaMigrationRunner` la applica a ogni schema `ACTIVE` all'avvio; un tenant creato dopo il rilascio la riceve durante il provisioning, quando non ha ancora utenti, quindi i suoi membri ricevono la normale scheda di benvenuto. Lo stesso vale per gli utenti caricati in seguito dalla **Configurazione iniziale**.

## API

Tutti gli endpoint richiedono autenticazione, ricavano persona e ruolo dal token e lavorano nello schema del tenant della sessione. Il client non invia mai utente, ruolo o tenant. Con un tenant non provisionato rispondono `tenant.notProvisioned`, come le altre API dello schema tenant; il frontend non li chiama in modalità bootstrap.

```http
GET    /api/guided-tour
PUT    /api/guided-tour/settings
PUT    /api/guided-tour/progress
DELETE /api/guided-tour/progress
```

`GET` restituisce sempre un aggregato completo e non scrive nel database:

```json
{
  "enabled": true,
  "settings": {
    "autoStartEnabled": true,
    "legacyInvitation": false,
    "version": 2
  },
  "role": "ROLE_USER",
  "progress": {
    "status": "IN_PROGRESS",
    "seenSteps": ["common.welcome", "common.navigation", "calendar.availability"],
    "lastStepId": "calendar.availability",
    "autoProposals": 1,
    "catalogRevision": 1,
    "startedAt": "2026-11-03T18:30:00+01:00",
    "completedAt": null,
    "version": 4
  }
}
```

`progress` è `null` quando il ruolo non ha stato; `settings.version` è `null` finché il profilo non è materializzato. `enabled` riporta l'interruttore applicativo.

`startedAt` e `completedAt` servono alla sezione del profilo. `startedAt` si imposta quando lo stato diventa `IN_PROGRESS`, anche quando si riapre una guida conclusa, e resta vuoto per un ruolo saltato senza averla iniziata; `completedAt` si imposta quando lo stato diventa `COMPLETED` e si azzera negli altri stati.

`PUT /settings` riceve `autoStartEnabled` e `version`; materializza il profilo alla prima scrittura. Spegnere o accendere l'interruttore non modifica `legacyInvitation`.

`PUT /progress` riceve `status`, `seenSteps`, `lastStepId`, `autoProposals`, `catalogRevision` e `version`; crea o aggiorna la riga del ruolo del token e, se serve, materializza il profilo. Qualunque scrittura dell'avanzamento azzera di fatto l'invito per quel ruolo, perché la riga esiste.

`DELETE /progress` elimina la riga del ruolo del token: è il comando **Ricomincia la guida**.

Le tre scritture restituiscono l'aggregato aggiornato, nello stesso formato di `GET`. Gli ID delle tappe viste ripetuti si salvano una volta sola, nell'ordine della prima comparsa.

### Validazione ed errori

| Chiave proposta | HTTP | Quando |
| --- | --- | --- |
| `validation` | 400 | stato sconosciuto, ID tappa fuori formato, `autoProposals` fuori da 0–3 |
| `guidedTour.step.limit` | 400 | più di 100 tappe viste |
| `guidedTour.versionConflict` | 409 | `version` non coincide con quella salvata |
| `guidedTour.disabled` | 404 | interruttore applicativo spento, per le scritture |
| `auth.forbidden` | 403 | token senza ruolo riconosciuto |

Il servizio valida i campi dell'avanzamento: anche uno stato sconosciuto o un campo mancante rispondono `validation`, non un errore di lettura del corpo. Due scritture concorrenti che creano lo stesso profilo o lo stesso avanzamento, o che aggiornano la stessa versione, rispondono `guidedTour.versionConflict`.

Il formato degli ID è `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$`, massimo 64 caratteri. Il backend non conosce il catalogo: valida il formato, non l'esistenza della tappa, così un rilascio frontend non richiede un rilascio backend. Le nuove chiavi e l'area `guidedTour` entrano nello standard degli errori e in `api-error-messages.ts` insieme all'implementazione, perché `check-error-catalog.mjs` respinge chiavi documentate ma non ancora lanciate.

## Frontend

### Componenti

| Elemento | Percorso proposto | Ruolo |
| --- | --- | --- |
| Catalogo | `src/app/constants/guided-tour-steps.ts` | tappe, testi, `GUIDED_TOUR_CATALOG_REVISION` |
| Modelli | `src/app/module/guided-tour.module.ts` | DTO e tipi della tappa |
| Servizio | `src/app/service/guided-tour.service.ts` | stato con signal, API, regole di avvio, composizione delle tappe |
| Ancora | `src/app/directive/tour-anchor.directive.ts` | `[appTourAnchor]="'calendar.header'"` scrive `data-tour-anchor` |
| Guida | `src/app/components/guided-tour/` | velo, riquadro, scheda, avanzamento |
| Invito | stesso componente, presentazione banner con `app-inline-alert` | utenti esistenti |
| Aiuto | `topbar.component` | pulsante e menu |
| Profilo | `profile.component` | sezione **Guida** con `app-detail-section` |

Il componente è montato una sola volta in `LayoutComponent` dentro `@defer (when guidedTour.active())`: catalogo e componente formano un chunk separato e non entrano nel bundle iniziale. Il servizio legge `GET /api/guided-tour` una volta, dopo che `TenantStatusService` conferma un tenant provisionato.

### Ancore

Le ancore sono identificativi stabili, non selettori CSS. Le voci del menu ricevono l'ancora tramite un campo aggiuntivo del modello, reso come attributo da `app-menu-item`; le altre pagine usano la direttiva. Un'ancora assente, nascosta o fuori schermo non è un errore: la tappa passa all'ancora candidata successiva e infine alla scheda centrata.

Prima di mostrare una tappa con `route`, il servizio naviga con il router, quindi attende l'ancora per al massimo 2 secondi. Se la navigazione viene annullata, per esempio da `canDeactivateUnsavedChanges`, la guida va in pausa sulla tappa corrente senza perdere l'avanzamento.

### Evidenziazione

Il riquadro è un elemento a posizione fissa allineato al `getBoundingClientRect()` dell'ancora, con un'ombra estesa che oscura il resto della pagina. Si riallinea con `ResizeObserver`, scroll e resize, limitati a un aggiornamento per frame. L'ancora viene portata in vista con `scrollIntoView({ block: 'center' })` prima di misurarla.

La scheda è un componente proprio, non `p-dialog`, perché `p-dialog` ammette solo posizioni fisse rispetto alla finestra. `p-popover` ancorato con `show(event, target)` è un'alternativa valutata, ma non gestisce il trattenimento del fuoco e chiude la scheda al clic esterno.

### Salvataggio

- Ogni cambio di tappa aggiorna lo stato locale e invia `PUT /progress` con un ritardo di 1 secondo, accorpando i passaggi rapidi.
- Chiusura, salto e fine inviano subito.
- Un `guidedTour.versionConflict` provoca una nuova lettura, l'unione delle tappe viste e un solo nuovo invio, senza messaggi all'utente: capita con due schede aperte.
- Un errore di rete non interrompe la guida e non mostra toast; il salvataggio viene ritentato alla tappa successiva.
- Se `GET` fallisce la guida non parte; il pulsante di aiuto ritenta la lettura quando viene usato.
- Solo i comandi del profilo seguono la normale gestione degli errori di `ApiErrorService`, perché sono azioni esplicite.

### Precisazioni dell'implementazione

- La dashboard propone la guida dal proprio `ngAfterViewInit`; il servizio attende i 600 ms e verifica le condizioni di avvio allo scadere.
- Il menu del pulsante di aiuto è un piccolo popup della topbar con ruolo `menu`, non `p-menu`, così il bundle iniziale non riceve un componente in più.
- Le ancore candidate si controllano ogni 100 ms per al massimo 2 secondi: vince la prima, in ordine di preferenza, con elementi visibili. Per questo `finance.overview` su desktop cita solo `finance.summary`, che compare con i dati, e non ricade subito sull'intestazione.
- Se un'ancora ha più elementi visibili, come le voci di amministrazione del menu, il riquadro li comprende tutti.
- **Indietro** compare dalla seconda tappa dopo il benvenuto; sul benvenuto `Esc` equivale a **Più tardi**.
- Il punto informativo del pulsante di aiuto scompare, per la sessione, quando la guida viene aperta a mano.
- Le richieste della guida non accendono l'indicatore di caricamento globale.

### Standard di layout

La guida è un sesto canale rispetto ai cinque della sezione «Quale canale, quando» dello [Standard di layout Taurus](taurus-layout-standard.md): bloccante ma sempre rinunciabile e senza dati da raccogliere. All'implementazione lo standard riceve una sezione dedicata con i limiti della scheda descritti sopra, così che il componente non diventi un'eccezione non documentata.

## Sicurezza e privacy

- Persona e ruolo derivano sempre dal token; nessun endpoint accetta un utente o un ruolo dal client.
- Lo stato di un tenant non influenza lo stesso account in un altro tenant.
- Le tabelle non contengono testi liberi o dati dei moduli: solo interruttore, stato e ID delle tappe.
- Gli ID delle tappe sono validati per formato e numero; non vengono mai interpretati come HTML o percorsi.
- I testi del catalogo sono statici; nome della persona e dell'organizzazione sono inseriti con l'interpolazione Angular, mai con `innerHTML`.
- La guida non rivela funzioni non autorizzate: una tappa per un ruolo diverso non viene composta, e le rotte restano comunque protette da `canActivateAuthRole` e `tenantFeatureGuard`.
- La cancellazione GDPR dell'utente nel tenant elimina profilo e avanzamento in `DataErasureService.eraseUserDataInCurrentTenant`, accanto a `notification_profile` e `preferences`; la riga di avanzamento segue il profilo con `ON DELETE CASCADE`.
- La cancellazione logica dell'utente non richiede una cascata: le righe restano fino alla cancellazione GDPR, come le altre preferenze personali.
- La cancellazione GDPR del tenant elimina le tabelle con lo schema.
- I log non contengono subject o ID tappa.

## Osservabilità

Contatori a bassa cardinalità, senza tenant né utente tra i tag:

- `taurus.guided_tour.decisions` con `role` e `outcome` tra `started`, `completed`, `skipped`, `restarted`, `auto_start_disabled`, `auto_start_enabled`;
- `taurus.guided_tour.invitations` con `outcome` tra `accepted` e `declined`.

Un invito si considera deciso alla prima scrittura dell'avanzamento di un ruolo per un profilo con `legacyInvitation`: `SKIPPED` conta come `declined`, ogni altro stato come `accepted`, anche quando la guida parte dal pulsante di aiuto invece che dal banner.

I contatori servono a capire se la guida viene completata o saltata per ruolo. Non esiste un tracciamento per tappa né per persona.

## Prestazioni e leggerezza

- Nessuna nuova dipendenza npm o Maven.
- Bundle iniziale: solo servizio e direttiva, entro 3 kB compressi.
- Chunk differito di catalogo e componente: entro 20 kB compressi.
- Una sola lettura all'avvio della sessione e scritture accorpate.
- Nessuna immagine: icone PrimeIcons già caricate.
- Il riallineamento del riquadro non deve causare più di un ricalcolo di layout per frame.

## Strategia di test

### Backend

- `GET` senza profilo né avanzamento: default completi, nessuna scrittura;
- persona e ruolo ricavati dal token, campi omologhi del body ignorati o rifiutati;
- stessa persona con due ruoli: avanzamenti distinti;
- stessa persona in due tenant con lo stesso ruolo: profili e avanzamenti separati e isolati tra gli schemi;
- Super amministratore senza riga `app_user`: profilo per subject con `user_id` nullo;
- validazione di stato, formato e numero delle tappe e di `autoProposals`;
- conflitto di versione su profilo e avanzamento;
- `DELETE /progress` limitato al ruolo del token;
- migrazione: profili `legacy_invitation` per gli utenti non cancellati, nessun profilo per quelli cancellati, nessun profilo in uno schema nuovo;
- tenant non provisionato: risposta `tenant.notProvisioned`;
- cancellazione GDPR dell'utente e del tenant;
- interruttore applicativo spento.

### Frontend

- composizione delle tappe per ognuno dei sette ruoli con tutti i flag accesi e tutti spenti, confrontata con un elenco atteso di ID;
- Tesoriere con e senza `FINANCE`;
- punti condizionati dai flag;
- regole di avvio: rotta, interruttore, stato, tre proposte, rinvio di sessione, dialogo aperto, invito;
- ripresa dall'ultima tappa;
- ancora mancante, nascosta o tardiva con ripiego sulla scheda centrata;
- navigazione annullata da modifiche non salvate;
- mobile sotto i 992 px con le ancore alternative;
- tastiera, trattenimento e ritorno del fuoco, `Esc`, annunci della regione live;
- `prefers-reduced-motion`, tema scuro, zoom al 200%;
- conflitto di versione con unione delle tappe viste;
- errore di `GET` che lascia l'applicazione utilizzabile;
- sezione del profilo: interruttore, apertura e ricomincio.

### Coerenza delle ancore

Uno script Node 22 senza dipendenze, `taurus-fe/scripts/check-tour-anchors.mjs`, confronta le ancore citate dal catalogo con quelle dichiarate nei template e nel modello del menu e fallisce se una manca. Viene eseguito nel job frontend di `verify.yml`. Protegge dalla deriva più probabile: una pagina rifatta che perde l'ancora della guida.

### Verifica manuale

- un giro completo per ruolo su desktop e su un telefono Android reale;
- rilettura dei testi di ogni ruolo da parte del responsabile del progetto prima del rilascio;
- verifica che nessuna tappa citi funzioni non visibili a quel ruolo.

## Criteri di accettazione

1. Al primo ingresso con un ruolo, dopo i documenti legali, la dashboard mostra la scheda di benvenuto.
2. La guida non si apre da sola su pagine diverse dalla dashboard.
3. Ogni ruolo vede soltanto tappe pertinenti al ruolo e alle funzionalità attive del tenant.
4. Nessuna guida supera 10 tappe, benvenuto compreso.
5. Ogni tappa evidenzia la propria ancora se visibile, altrimenti usa la scheda centrata senza errori.
6. Su schermi sotto i 992 px ogni tappa resta leggibile e utilizzabile.
7. Chiudere la guida conserva l'ultima tappa e la successiva apertura riprende da lì.
8. Dopo 3 proposte automatiche chiuse la guida non si apre più da sola per quel ruolo.
9. **Salta la guida** chiude la guida del solo ruolo corrente.
10. **Non avviare più la guida automaticamente** impedisce ogni avvio automatico per tutti i ruoli della persona nel tenant corrente.
11. L'interruttore del profilo riattiva l'avvio automatico.
12. Il pulsante di aiuto apre la guida in ogni momento, anche con avvio automatico spento.
13. **Ricomincia la guida** azzera solo lo stato del ruolo corrente.
14. Stato e interruttore della guida di un tenant non influenzano lo stesso account in un altro tenant.
15. Gli utenti esistenti al rilascio vedono un invito e non la guida automatica.
16. Persona e ruolo provengono sempre dal token.
17. Un errore delle API della guida non impedisce l'uso di Taurus.
18. La guida è utilizzabile da tastiera e con lettore di schermo.
19. Il bundle iniziale cresce al massimo di 3 kB compressi.
20. Lo script delle ancore fallisce se il catalogo cita un'ancora inesistente.
21. La cancellazione GDPR dell'utente o del tenant rimuove i dati della guida.

## Guide di pagina

Progetto della fase 2, approvato il 2026-11-05: le scelte sono riportate in [Decisioni approvate](#decisioni-approvate), punti da 15 a 19.

La guida introduttiva resta breve e invariata, entro 10 tappe. I dettagli di ogni pagina passano a una guida propria, aperta su richiesta dalla pagina stessa. Così ogni ruolo trova, per ogni pagina che può aprire, una spiegazione delle sezioni e delle azioni che vede, senza allungare il primo ingresso.

### Principi

| Aspetto | Decisione |
| --- | --- |
| Apertura | solo dalla voce **Guida di questa pagina** del pulsante di aiuto; mai automatica |
| Disponibilità | la voce compare solo sulle pagine che hanno almeno una tappa per il ruolo e le funzionalità della sessione |
| Ambito | la guida resta sulla pagina: le tappe non hanno `route` e non navigano |
| Composizione | ruolo, funzionalità del tenant ed elementi presenti sulla pagina, valutati all'apertura |
| Lunghezza | al massimo 10 tappe per pagina, senza scheda di benvenuto |
| Scheda | la stessa della guida introduttiva, con gli stessi limiti di titolo, corpo e punti |
| Stato | nessun salvataggio: né tappe viste né esito |
| Backend | nessuna modifica: niente API, tabelle, migrazioni o chiavi di errore nuove |

### Composizione e presenza degli elementi

Una tappa di pagina entra nella guida quando:

1. il ruolo della sessione è tra i suoi `roles`;
2. tutte le funzionalità di `requires` sono attive;
3. almeno una delle sue ancore è presente e visibile sulla pagina al momento dell'apertura.

La terza condizione è nuova rispetto alla guida introduttiva, dove un'ancora mancante porta alla scheda centrata. Una pagina mostra sezioni diverse secondo i dati: la preparazione di un evento compare solo se configurata, le cancellazioni GDPR in attesa solo se ce ne sono, l'inventario cambia tra la vista dell'organizzazione e quella personale. Una scheda centrata che descrive una sezione assente confonderebbe; la tappa viene quindi lasciata fuori, e la guida parla solo di ciò che si vede.

All'apertura la guida attende al massimo 2 secondi che compaia almeno un'ancora delle sue tappe, per le pagine ancora in caricamento. Se non ne compare nessuna, un toast informativo dice «La guida di questa pagina non è disponibile in questo momento». La composizione resta quella dell'apertura anche se poi la pagina cambia.

Gli elementi nascosti dentro schede non attive o passi chiusi non sono visibili. Per le pagine con schede, come il dettaglio di una traccia o Economia, le tappe puntano all'intestazione della scheda, che è sempre visibile, e il testo dice dove si trova.

### Comandi

| Comando | Effetto |
| --- | --- |
| **Avanti**, **Indietro** | tappa successiva o precedente; **Indietro** dalla seconda tappa |
| **Fine** | all'ultima tappa chiude la guida |
| **Chiudi**, icona di chiusura o `Esc` | chiude la guida |

Il piede della scheda mostra **Chiudi** a sinistra al posto di **Salta la guida**. Nessun comando scrive sul server. Il toast di chiusura non compare: la guida si riapre dallo stesso menu.

Se la pagina cambia mentre la guida è aperta, per esempio con il tasto Indietro del browser, la guida si chiude. Guida introduttiva e guida di pagina non sono mai aperte insieme: mentre una è aperta, il menu di aiuto non avvia l'altra.

### Stato e novità

Le guide di pagina non salvano nulla. Le ragioni:

- sono consultazioni volontarie, da ripetere quando serve, senza un esito da ricordare;
- registrare le tappe viste farebbe crescere `seen_steps` oltre il limite di 100 per gli amministratori, che hanno molte pagine;
- senza scritture il backend resta com'è e la guida non aggiunge dati personali.

Ogni tappa ha comunque `introducedIn`, che vale 2 per le tappe di questa fase, così la [fase 3](#fase-3--novità) potrà segnalare le tappe nuove di una pagina dopo un rilascio. `GUIDED_TOUR_CATALOG_REVISION` passa a 2 con il rilascio della fase 2, a 3 con le tappe del dettaglio dei documenti legali e a 4 con la tappa Compensi della guida di Economia a 5 con la tappa Organico della guida degli strumenti e a 6 con la tappa Partitura della guida della traccia: sale a ogni tappa aggiunta o che cambia significato.

### Catalogo, ancore e caricamento

| Elemento | Percorso proposto | Ruolo |
| --- | --- | --- |
| Catalogo delle pagine | `src/app/constants/guided-tour-pages.ts` | pagine, tappe e testi |
| Modelli | `src/app/module/guided-tour.module.ts` | `GuidedTourPageDefinition` con `page` e `steps` |
| Servizio | `src/app/service/guided-tour.service.ts` | riconoscimento della pagina, composizione, apertura |
| Aiuto | `topbar.component` | voce **Guida di questa pagina** |

- `page` è il percorso della rotta con i parametri, per esempio `/calendar/:id`. Il servizio lo confronta con l'URL corrente segmento per segmento, ignorando parametri di query e frammento.
- Gli ID delle tappe seguono il formato `page.{pagina}.{oggetto}` e sono unici insieme a quelli della guida introduttiva.
- Le nuove ancore usano la direttiva esistente e il formato `{pagina}.{oggetto}`; `check-tour-anchors.mjs` controlla anche il catalogo delle pagine.
- Il catalogo delle pagine forma un chunk proprio, caricato con un import dinamico alla prima apertura del menu di aiuto: serve a sapere se la pagina corrente ha una guida. Mentre il chunk arriva, la voce resta nascosta.
- Limiti di peso: bundle iniziale al massimo 1 kB compresso in più rispetto alla fase 1; chunk del catalogo delle pagine entro 20 kB compressi; chunk della guida introduttiva invariato.

### Collegamento con la guida introduttiva

Il testo di `common.help` diventa: «Riapri la guida quando vuoi da qui; in ogni pagina trovi anche la guida di quella pagina. Se preferisci che non parta da sola, disattivala dal profilo.» Le tappe introduttive non cambiano.

### Contenuti per pagina

Sigle dei ruoli: SA Super amministratore, AD Amministratore, DI Direttivo, TE Tesoriere, AR Archivista, UT Utente, UE Utente esterno. **Gestori** indica SA, AD e DI, cioè i ruoli di `isTenantManager`; **Catalogo** indica i gestori e AR.

La colonna «Ruoli» elenca i ruoli della tappa, sempre dentro quelli ammessi dalla rotta. Le funzionalità della rotta, indicate accanto al titolo della pagina, valgono per tutte le sue tappe. Le ancore sono nuove salvo quelle già usate dalla fase 1, segnate con *.

Le varianti di testo seguono le regole della fase 1: chi non può fare un'azione non la legge.

#### Profilo — `/profile`, tutti i ruoli

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.profile.personal` | tutti | — | `profile.personal` | «Aggiorna nome, cognome, data di nascita ed e-mail e salva con «Salva profilo» in alto. Il nome utente non si cambia.» |
| 2 | `page.profile.events` | tutti | `CALENDAR` | `profile.events` | «Qui trovi gli eventi in cui sei stato segnato presente.» |
| 3 | `page.profile.calendarFeed` | UT, UE | `EXTERNAL_CALENDAR_FEED` | `profile.calendarFeed` | «Crea il collegamento e aggiungilo al calendario del telefono: concerti e prove compaiono da soli. Il link si vede una volta sola.» |
| 4 | `page.profile.notifications` | tutti | `NOTIFICATION_PREFERENCES` | `profile.notifications` | «Scegli quali notifiche ricevere e come, poi premi «Salva preferenze».» Punti: «Promemoria prima degli eventi» con `WEB_PUSH_REMINDERS` e `CALENDAR`; «Riepilogo giornaliero e ore di silenzio»; «Attiva le notifiche su questo dispositivo» |
| 5 | `page.profile.signature` | tutti tranne TE | `INVENTORY_SIGNATURE` | `profile.signature` | «Scegli come confermare con un codice le firme dei fogli di affidamento e delle prese visione.» |
| 6 | `page.profile.guide` | tutti | — | `profile.guide` | «Accendi o spegni l'avvio automatico della guida, riaprila o ricominciala da capo.» |
| 7 | `page.profile.security` | tutti | — | `profile.security` | «Cambia la password e attiva la verifica in due passaggi con un'app di autenticazione.» |
| 8 | `page.profile.account` | tutti | — | `profile.dangerZone` | «Qui disattivi il tuo account o chiedi la cancellazione definitiva dei tuoi dati. Entrambe le azioni chiedono conferma.» |

Le sezioni Notifiche e Guida esistono solo con la relativa funzionalità o con l'interruttore applicativo acceso: la condizione di presenza le esclude da sola.

#### Dashboard — `/`, tutti i ruoli

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.dashboard.todo` | tutti | — | `dashboard.operations` | «Da fare raccoglie le attività che chiedono la tua attenzione: apri una voce per andare dove serve. «Aggiorna» ricarica l'elenco.» |
| 2 | `page.dashboard.counters` | SA, AD, DI, AR, UT | — | `dashboard.stats` | Gestori: «I contatori mostrano utenti, album e tracce dell'organizzazione: toccane uno per aprire l'elenco.» Variante SA: «I contatori mostrano i totali della piattaforma e dell'organizzazione: toccane uno per aprire l'elenco.» Variante AR e UT: «Album e tracce disponibili: tocca un contatore per aprire l'elenco.» |
| 3 | `page.dashboard.inventory` | tutti tranne TE | `INVENTORY` | `dashboard.inventory` | Gestori: «Il riepilogo dell'inventario con le prese visione e le riconsegne in attesa.» Variante AR, UT, UE: «Il materiale che ti è affidato e le prese visione da confermare.» |
| 4 | `page.dashboard.recents` | tutti tranne TE | — | `dashboard.recents` | «Le tracce aggiunte o modificate di recente: aprine una per leggere le parti.» |
| 5 | `page.dashboard.events` | tutti | `CALENDAR` | `dashboard.events` | «I prossimi concerti e prove: apri un evento per vederne i dettagli.» |
| 6 | `page.dashboard.notifications` | tutti | — | `dashboard.notifications`* | «Filtra le notifiche, segnale come lette, rimandale o eliminale; aprine una per andare al dettaglio.» Punto: «Da una notifica puoi disattivarne la categoria» con `NOTIFICATION_PREFERENCES` |

#### Calendario — `/calendar`, SA, AD, DI, AR, UT, UE; `CALENDAR`

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.calendar.create` | Gestori | — | `calendar.create`* | «Crea una prova o un concerto; nel dettaglio scegli date, luogo e, se serve, la ricorrenza.» Punto: «In elenco selezioni più eventi per eliminarli insieme» |
| 2 | `page.calendar.views` | tutti | — | `calendar.views` | «Passa dal mese all'elenco; nel mese usa le frecce e «Oggi» per spostarti.» |
| 3 | `page.calendar.open` | tutti | — | `calendar.events` | «Apri un evento per vederne i dettagli e dire se ci sarai.» Variante gestori: «…per modificarlo, vedere le risposte e segnare le presenze.» Variante UE: «Trovi gli eventi pubblici: aprine uno…» |

#### Dettaglio evento — `/calendar/:id`, tutti i ruoli; `CALENDAR`

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.event.data` | tutti tranne TE | — | `event.data` | Gestori: «Date, luogo e compenso dell'evento: modifica e salva con «Salva evento» in alto.» Variante AR, UT, UE: «Data, orario e luogo dell'evento.» Punti per i gestori: «In una serie scegli se cambiare anche gli eventi successivi»; «Imposta il promemoria per chi partecipa» con `WEB_PUSH_REMINDERS` |
| 2 | `page.event.myAvailability` | tutti tranne TE | — | `event.myAvailability` | «Rispondi «Sono disponibile» o «Non sono disponibile»: la risposta si registra subito e puoi annullarla.» Punti: «In una serie puoi rispondere anche per le date future»; «Scegli quando ricevere il promemoria» con `WEB_PUSH_REMINDERS` |
| 3 | `page.event.answers` | tutti tranne TE | — | `event.availability` | «Chi ha risposto: disponibili e non disponibili, aggiornati a ogni risposta.» |
| 4 | `page.event.preparation` | Gestori, AR, TE | `EVENT_PREPARATION` | `event.preparation` | Gestori: «Scegli cosa serve all'evento, come programma, materiali e preventivo, e segui nel riepilogo cosa manca.» Variante AR e TE: «Il riepilogo mostra cosa manca all'evento: programma, materiali, preventivo e chiusure.» |
| 5 | `page.event.program` | tutti tranne TE | `EVENT_PREPARATION` | `event.program` | Gestori e AR: «Collega un album o aggiungi i brani: diventano la scaletta che i musicisti vedono qui.» Variante UT e UE: «La scaletta dell'evento, con i brani nell'ordine in cui si suonano.» |
| 6 | `page.event.materials` | Gestori | `EVENT_PREPARATION` | `event.materials` | «Elenca gli oggetti dell'inventario che servono all'evento e salva: il riepilogo segnala quelli da risolvere.» |
| 7 | `page.event.economics` | Gestori, TE | `FINANCE` | `event.costs`, `event.finance` | Gestori: «Prevedi i costi dell'evento; il consuntivo li confronta con i movimenti registrati in Economia.» Variante TE: «Il consuntivo confronta i costi previsti con i movimenti: da qui li vedi o ne registri uno nuovo.» Punto: «Conferma il preventivo quando la preparazione lo chiede» con `EVENT_PREPARATION` |
| 8 | `page.event.presence` | Gestori | — | `event.presence` | «Dopo l'evento segna chi c'era e premi «Salva presenze»: l'evento compare tra quelli a cui ciascuno ha partecipato.» Punto: «Chiudi le presenze quando la preparazione lo chiede» con `EVENT_PREPARATION` |

Il Tesoriere apre solo il dettaglio, dalle notifiche economiche: la sua guida ha al massimo preparazione e consuntivo.

#### Tracce — `/tracks`, SA, AD, DI, AR, UT, UE

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.tracks.create` | Catalogo | — | `tracks.create`* | «Crea una traccia o carica subito lo spartito in PDF: poi lo dividi in parti, una per strumento.» |
| 2 | `page.tracks.search` | tutti | — | `tracks.toolbar` | «Cerca un brano e passa dall'elenco alle schede con il pulsante della vista.» |
| 3 | `page.tracks.open` | tutti | — | `tracks.list` | «Apri un brano per i dettagli, oppure usa l'anteprima per leggere e stampare le parti.» Variante UE: «Trovi i brani pubblici: aprine uno…». Punto per Catalogo: «Lo stato Pubblico lo mostra anche agli utenti esterni» |

#### Dettaglio traccia — `/tracks/:id`, SA, AD, DI, AR, UT, UE

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.track.preview` | tutti | — | `track.preview` | «L'anteprima mostra le parti a tutta pagina: scegli quali includere e stampale.» |
| 2 | `page.track.details` | tutti | — | `track.tabDetails` | Catalogo: «Nella scheda Dettagli trovi titolo, autori, tempo, tonalità e stato: salva con «Salva traccia» in alto.» Variante UT e UE: «Nella scheda Dettagli trovi titolo, autori, tempo e tonalità del brano.» |
| 3 | `page.track.parts` | tutti | — | `track.tabParts` | Catalogo: «Nella scheda Parti ogni parte raccoglie pagine e strumenti: puoi dividerle, unirle e segnarle come verificate.» Variante UT e UE: «Nella scheda Parti trovi le parti del brano e gli strumenti che le suonano.» Punto per Catalogo: «Applica gli strumenti proposti dai nomi delle parti» |
| 4 | `page.track.playback` | tutti | `SCORE_PLAYBACK` | `track.tabPlayback` | Catalogo: «Nella scheda Ascolto riconosci le note dalle pagine, ascolti le parti e correggi gli errori accanto all'originale.» Variante UT e UE: «Nella scheda Ascolto senti la partitura o una sola parte mentre leggi.» |
| 5 | `page.track.arrangement` | Catalogo | `SCORE_PLAYBACK`, `SCORE_WRITING` | `track.tabArrangement` | «Nella scheda Partitura crei la partitura del brano dall'organico o dalle parti e scrivi tutti i righi insieme.» |
| 6 | `page.track.pdf` | Catalogo | — | `track.tabPdf` | «Nella scheda File PDF carichi uno spartito e premi «Analizza PDF»: le pagine diventano parti da controllare.» |

La tappa 5 è stata aggiunta il 2026-11-15 con la revisione 6 del catalogo (`introducedIn: 6`), insieme alla scheda della [partitura](music-writing-editor-spec.md#partitura-e-arrangiamento).

#### Album — `/albums`, SA, AD, DI, AR, UT, UE

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.albums.create` | Catalogo | — | `albums.create` | «Un album raccoglie i brani di un programma o di un concerto, nell'ordine in cui si suonano.» |
| 2 | `page.albums.open` | tutti | — | `albums.toolbar` | «Cerca un album e aprilo per vedere i brani in ordine; l'anteprima mostra le parti di tutti i brani.» |

#### Dettaglio album — `/albums/:id`, SA, AD, DI, AR, UT, UE

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.album.data` | tutti | — | `album.data` | Catalogo: «Nome, data, stato e descrizione dell'album: salva con «Salva album» in alto.» Variante UT e UE: «Nome, data e descrizione dell'album.» |
| 2 | `page.album.tracks` | tutti | — | `album.tracks` | Catalogo: «Aggiungi tracce, trascinale per cambiare l'ordine e confermalo.» Variante UT e UE: «I brani dell'album nell'ordine in cui si suonano: aprine uno per la tua parte.» |
| 3 | `page.album.preview` | tutti | — | `album.preview` | «L'anteprima mostra in un'unica vista le parti di tutti i brani, da leggere o stampare.» |

#### Anteprima spartiti — `/preview`, SA, AD, DI, AR, UT, UE

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.preview.parts` | tutti | — | `preview.parts` | «Scegli le parti da includere, per esempio solo quella del tuo strumento.» |
| 2 | `page.preview.pages` | tutti | — | `preview.pages` | «Scorri le pagine e ingrandisci o riduci lo spartito con i comandi in alto.» |
| 3 | `page.preview.print` | tutti | — | `preview.print` | «Nelle impostazioni di stampa scegli quante pagine dello spartito mettere in ogni foglio.» |

#### Strumenti — `/instruments` e `/instruments/:id`, Catalogo

| Pagina | Ordine | ID | Condizioni | Ancora | Testo |
| --- | ---: | --- | --- | --- | --- |
| elenco | 1 | `page.instruments.create` | — | `instruments.create` | «Aggiungi gli strumenti dell'organizzazione: servono ad abbinare le parti degli spartiti ai musicisti.» |
| elenco | 2 | `page.instruments.playback` | `SCORE_PLAYBACK` | `instruments.unconfigured` | «Mostra solo gli strumenti ancora da configurare per l'ascolto e aprili per scegliere il suono.» |
| elenco | 3 | `page.instruments.ensemble` | — | `instruments.ensemble` | «Nella scheda Organico metti in ordine gli strumenti che suonano nella banda: l'anteprima e la stampa seguono lo stesso ordine.» Punto: «Comincia da «Proponi l'ordine di riferimento»» |
| dettaglio | 1 | `page.instrument.data` | — | `instrument.data` | «Nome e descrizione dello strumento: salva con «Salva strumento» in alto.» |
| dettaglio | 2 | `page.instrument.sound` | `SCORE_PLAYBACK` | `instrument.sound` | «Scegli suono e trasposizione per l'ascolto: «Proponi dal nome» suggerisce un suono, «Prova» lo fa sentire.» |

La tappa 3 dell'elenco è stata aggiunta il 2026-11-15 con la revisione 5 del catalogo (`introducedIn: 5`), insieme alla scheda dell'[organico della banda](music-writing-editor-spec.md#organico-della-banda). L'ancora è l'intestazione della scheda, visibile anche con l'elenco aperto; la tappa del filtro «Da configurare» si salta se è aperta la scheda Organico, perché la sua ancora non è visibile.

#### Inventario — `/inventory`, tutti tranne TE; `INVENTORY`

La pagina ha due viste: quella dell'organizzazione, solo per i gestori, e quella personale, l'unica per AR, UT e UE. La condizione di presenza sceglie le tappe della vista aperta.

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.inventory.create` | Gestori | — | `inventory.create`* | «Registra strumenti e materiali con numero inventariale, quantità e stato di conservazione.» Punti: «Genera le etichette con il QR» con `INVENTORY_QR`; «Prepara il modello del foglio di affidamento» con `INVENTORY_LOAN_SHEET` |
| 2 | `page.inventory.views` | Gestori | — | `inventory.views` | «Passa dall'inventario dell'organizzazione al materiale affidato a te.» |
| 3 | `page.inventory.erasures` | Gestori | — | `inventory.erasures` | «Chi ha chiesto la cancellazione dei dati deve prima riconsegnare: completa la cancellazione dopo la riconsegna.» |
| 4 | `page.inventory.items` | Gestori | — | `inventory.items` | «Apri un oggetto per affidarlo, vedere consegne e fotografie; selezionane più d'uno per le azioni comuni.» |
| 5 | `page.inventory.scope` | tutti | — | `inventory.scope` | «Passa dal materiale che hai ora a quello già riconsegnato.» |
| 6 | `page.inventory.acts` | tutti | `INVENTORY_SIGNATURE` | `inventory.ownActs` | «Gli atti che ti chiedono una firma: aprili e conferma con il codice.» |
| 7 | `page.inventory.sheets` | tutti | `INVENTORY_LOAN_SHEET` | `inventory.ownSheets` | «I tuoi fogli di affidamento, da scaricare quando servono.» |
| 8 | `page.inventory.assignments` | tutti | — | `inventory.assignments` | «Apri una consegna per prenderne visione, avviare la riconsegna o segnalare un guasto.» |

#### Consegna — `/inventory/assignments/:id`, tutti tranne TE; `INVENTORY`

| Ordine | ID | Ruoli | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- | --- |
| 1 | `page.assignment.data` | tutti | — | `assignment.data` | «Cosa ti è stato affidato, in che quantità e fino a quando.» |
| 2 | `page.assignment.decision` | tutti | — | `assignment.decision` | «Conferma di aver ricevuto il materiale o rifiutalo indicando il motivo.» Punto: «Confermi con un codice, come una firma» con `INVENTORY_SIGNATURE` |
| 3 | `page.assignment.return` | tutti | — | `assignment.return` | «Indica quantità e note e avvia la riconsegna: chi gestisce l'inventario la completa.» |
| 4 | `page.assignment.issues` | tutti | `INVENTORY_QR` | `assignment.reportIssue` | «Segnala un guasto dell'oggetto: le segnalazioni aperte restano elencate in fondo alla pagina.» |

#### Oggetto dell'inventario — `/inventory/:id` e `/inventory/items/:id`, Gestori; `INVENTORY`

| Ordine | ID | Condizioni | Ancora | Testo |
| ---: | --- | --- | --- | --- |
| 1 | `page.inventoryItem.data` | — | `inventoryItem.data` | «Numero inventariale, quantità, conservazione, valore e regime di comodato: salva con «Salva oggetto» in alto.» |
| 2 | `page.inventoryItem.qr` | `INVENTORY_QR` | `inventoryItem.qr` | «Stampa l'etichetta con il QR; se l'etichetta va persa, ruota il codice e ristampala.» |
| 3 | `page.inventoryItem.photos` | — | `inventoryItem.photos` | «Aggiungi le fotografie dell'oggetto e salvane l'ordine.» |
| 4 | `page.inventoryItem.assign` | — | `inventoryItem.assign` | «Affida l'oggetto a un membro con quantità, accessori ed eventuale scadenza.» |
| 5 | `page.inventoryItem.history` | — | `inventoryItem.assignments` | «Consegne e riconsegne dell'oggetto, con il foglio di affidamento quando c'è.» |

#### Modello del foglio di affidamento — `/inventory/loan-template`, Gestori; `INVENTORY_LOAN_SHEET`

| Ordine | ID | Condizioni | Ancora | Testo |
| ---: | --- | --- | --- | --- |
| 1 | `page.loanTemplate.active` | — | `loanTemplate.active` | «Il modello in uso: scaricalo, guardane l'anteprima o torna al predefinito.» |
| 2 | `page.loanTemplate.upload` | — | `loanTemplate.upload` | «Carica un modello HTML: Taurus lo controlla e lo attivi dopo aver visto l'anteprima.» |
| 3 | `page.loanTemplate.variables` | — | `loanTemplate.variables` | «Le variabili da usare nel modello, con il dato che ciascuna inserisce.» |
| 4 | `page.loanTemplate.rules` | — | `loanTemplate.rules` | «Durata minima e massima del comodato e dei rinnovi.» |
| 5 | `page.loanTemplate.signature` | `INVENTORY_SIGNATURE` | `loanTemplate.signature` | «Controlla che la firma elettronica sia pronta per i fogli di affidamento.» |
| 6 | `page.loanTemplate.history` | — | `loanTemplate.history` | «I modelli caricati in passato.» |

#### Scansione del QR — `/inventory/scan/v1/:publicId`, tutti tranne TE; `INVENTORY`

| Ordine | ID | Condizioni | Ancora | Testo |
| ---: | --- | --- | --- | --- |
| 1 | `page.scan.status` | `INVENTORY_QR` | `scan.summary` | «Lo stato dell'oggetto e gli avvisi: scadenze, prese visione da completare e guasti aperti.» |
| 2 | `page.scan.actions` | `INVENTORY_QR` | `scan.actions` | «Le azioni che puoi fare da qui, come segnalare un guasto; «Apri scheda completa» porta al dettaglio.» |

#### Economia — `/finance`, Gestori e TE; `FINANCE`

| Ordine | ID | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1 | `page.finance.create` | — | `finance.create`* | «Registra un movimento o un trasferimento tra conti e allega la ricevuta.» |
| 2 | `page.finance.period` | — | `finance.period` | «Scegli il periodo e premi «Aggiorna»: riepilogo e saldi si ricalcolano.» |
| 3 | `page.finance.summary` | — | `finance.summary`* | «Saldi dei conti e risultato del periodo.» Punto: «Gli eventi aperti da chiudere economicamente» con `CALENDAR` |
| 4 | `page.finance.movements` | — | `finance.tabMovements` | «Nella scheda Movimenti filtri, esporti in CSV, XLSX o PDF e segni i movimenti riconciliati.» |
| 5 | `page.finance.accounts` | — | `finance.tabAccounts` | «Nella scheda Conti trovi casse e conti correnti: aprine uno per l'estratto conto.» |
| 6 | `page.finance.categories` | — | `finance.tabCategories` | «Nella scheda Categorie classifichi entrate e uscite per i rendiconti.» |
| 7 | `page.finance.events` | `CALENDAR` | `finance.tabEvents` | «Nella scheda Eventi vedi per ogni evento costi previsti, incassi, spese e risultato.» |
| 8 | `page.finance.years` | — | `finance.tabYears` | «Nella scheda Esercizi trovi il riepilogo annuale, il riporto all'anno corrente e le segnalazioni da controllare.» |
| 9 | `page.finance.payouts` | `EVENT_PAYOUTS` | `finance.tabPayouts` | «Nella scheda Compensi ripartisci il compenso di un evento fra i presenti, con fattori o pagamenti fissi, e liquidi a ogni socio le quote dovute.» Punto: «Prima fissa percentuale di cassa e passo in Parametri» |

La tappa 9 è stata aggiunta il 2026-11-13 con la revisione 4 del catalogo (`introducedIn: 4`), insieme alla scheda della [Ripartizione dei compensi ai presenti](event-payout-shares-spec.md). `EVENT_PAYOUTS` è lo stato effettivo, che include già Economia e Calendario: senza la funzionalità la scheda non c'è e la tappa non viene composta.

#### Utenti — `/users` e `/users/:id`, Gestori

| Pagina | Ordine | ID | Condizioni | Ancora | Testo e punti |
| --- | ---: | --- | --- | --- | --- |
| elenco | 1 | `page.users.create` | — | `users.create`* | «Aggiungi un membro e assegna il ruolo: riceverà un'e-mail per impostare la password.» Variante DI: «… Solo l'Amministratore gestisce gli amministratori.» |
| elenco | 2 | `page.users.search` | — | `users.toolbar` | «Cerca un membro e passa dall'elenco alle schede.» |
| elenco | 3 | `page.users.actions` | — | `users.list` | «Da ogni riga apri la scheda, rimandi l'e-mail di invito o elimini l'utente.» |
| dettaglio | 1 | `page.user.data` | — | `user.data` | «Dati, ruoli, stato dell'account e strumenti suonati: salva con «Salva utente» in alto.» Punto: «Gli strumenti abbinano il membro alle sue parti» |
| dettaglio | 2 | `page.user.invite` | — | `user.invite` | «Rimanda l'e-mail per impostare la password a chi non l'ha ricevuta o l'ha persa.» |
| dettaglio | 3 | `page.user.events` | `CALENDAR` | `user.events` | «Gli eventi a cui il membro è stato segnato presente.» |
| dettaglio | 4 | `page.user.inventory` | `INVENTORY` | `user.inventory` | «Il materiale affidato al membro.» Punto: «I suoi fogli di affidamento» con `INVENTORY_LOAN_SHEET` |
| dettaglio | 5 | `page.user.account` | — | `user.dangerZone` | «Disattiva l'utente conservandone i dati, o cancellalo definitivamente con la cancellazione GDPR.» |

#### Configurazione iniziale — `/onboarding`, SA e AD; `ONBOARDING_IMPORT`

| Ordine | ID | Condizioni | Ancora | Testo e punti |
| ---: | --- | --- | --- | --- |
| 1 | `page.onboarding.summary` | — | `onboarding.summary` | «Il riepilogo dell'organizzazione e dell'ultima importazione.» |
| 2 | `page.onboarding.template` | — | `onboarding.template` | «Scarica il modello XLSX completo, o un CSV per una sola sezione, e compilalo.» |
| 3 | `page.onboarding.steps` | — | `onboarding.steps` | «Cinque passi: prepara, carica, controlla, conferma, esito. L'importazione aggiunge dati e non modifica né elimina quelli esistenti.» Punti: «Correggi gli errori segnalati e ricarica il file»; «Il rapporto elenca righe ed esiti»; «Le persone importate ricevono l'e-mail per la password» |
| 4 | `page.onboarding.history` | — | `onboarding.history` | «Le importazioni precedenti: aprine una per rivederne l'esito.» |

#### Consegne notifiche — `/admin/notification-delivery`, SA e AD

| Ordine | ID | Condizioni | Ancora | Testo |
| ---: | --- | --- | --- | --- |
| 1 | `page.deliveries.filters` | — | `deliveries.toolbar` | «Filtra le consegne per stato, origine, categoria o codice operazione.» |
| 2 | `page.deliveries.actions` | — | `deliveries.list` | «Riprova una consegna non riuscita, oppure chiudila indicando il motivo se non serve più.» |

#### Feed calendario — `/admin/calendar-feeds`, SA e AD; `EXTERNAL_CALENDAR_FEED`

| Ordine | ID | Condizioni | Ancora | Testo |
| ---: | --- | --- | --- | --- |
| 1 | `page.calendarFeeds.create` | — | `calendarFeeds.create` | «Crea un feed condiviso, per esempio per il sito dell'associazione: il link si vede una volta sola, copialo subito.» |
| 2 | `page.calendarFeeds.list` | — | `calendarFeeds.list` | «Rigenera il link, revoca un feed o consultane la cronologia; in caso di incidente revoca anche i feed personali.» |

#### Tenant e documenti legali — Super amministratore

| Pagina | Ordine | ID | Ancora | Testo |
| --- | ---: | --- | --- | --- |
| `/tenants` | 1 | `page.tenants.create` | `tenants.create` | «Crea un tenant con i dati dell'organizzazione e le funzionalità da attivare.» |
| `/tenants` | 2 | `page.tenants.list` | `tenants.list` | «Codice, stato e scadenza di ogni tenant: aprilo per modificarlo.» |
| `/tenants/:id` | 1 | `page.tenant.data` | `tenant.data` | «Anagrafica, numero massimo di utenti, scadenza, fuso orario e dominio del tenant.» |
| `/tenants/:id` | 2 | `page.tenant.configure` | `tenant.configureData` | «Configura dati apre la Configurazione iniziale del tenant per importare i dati.» |
| `/tenants/:id` | 3 | `page.tenant.features` | `tenant.features` | «Accendi o spegni le funzionalità: quelle che dipendono da un'altra restano inefficaci finché quella è spenta.» |
| `/legal-documents` | 1 | `page.legalDocuments.create` | `legalDocuments.create` | «Pubblica una nuova versione di privacy o condizioni d'uso: gli utenti la accettano al prossimo ingresso.» |
| `/legal-documents` | 2 | `page.legalDocuments.versions` | `legalDocuments.notice` | «Le versioni pubblicate non si modificano: per cambiare un testo pubblicane una nuova.» |

### Pagine senza guida

Restano senza guida le pagine fuori dal layout (accettazione dei documenti legali, firma pubblica, pagine di errore) e il reindirizzamento `/calendar/uid/:uid`, che porta al dettaglio dell'evento. Sulle pagine senza tappe per la sessione la voce **Guida di questa pagina** non compare.

### Test della fase 2

Frontend:

- composizione di ogni pagina per ognuno dei sette ruoli, con tutte le funzionalità accese e tutte spente, confrontata con un elenco atteso di ID;
- esclusione delle tappe con ancore assenti o nascoste, con le due viste dell'inventario come caso di prova;
- attesa di 2 secondi della prima ancora e toast quando non ne compare nessuna;
- riconoscimento della pagina dall'URL, con parametri di percorso e di query;
- nessuna richiesta HTTP all'apertura, alla navigazione e alla chiusura di una guida di pagina;
- chiusura della guida al cambio di pagina;
- guida introduttiva e guida di pagina mai aperte insieme;
- voce del menu assente sulle pagine senza tappe e finché il chunk del catalogo non è arrivato;
- al massimo 10 tappe per pagina; limiti dei testi, formato e unicità degli ID insieme alla guida introduttiva;
- nessun testo per i ruoli di un'organizzazione con la parola «tenant»;
- `check-tour-anchors.mjs` esteso al catalogo delle pagine.

Verifica manuale:

- ogni pagina per ogni ruolo che può aprirla, su desktop e su un telefono, con le funzionalità accese e spente;
- rilettura dei testi da parte del responsabile del progetto;
- misura del bundle iniziale e del nuovo chunk.

### Criteri di accettazione della fase 2

1. La voce **Guida di questa pagina** compare solo sulle pagine con almeno una tappa per il ruolo e le funzionalità della sessione.
2. Una guida di pagina non si apre mai da sola e non cambia pagina.
3. Ogni tappa riguarda un elemento presente e visibile sulla pagina all'apertura.
4. Nessuna guida di pagina supera 10 tappe.
5. Nessuna tappa cita funzioni che il ruolo non può usare o funzionalità spente.
6. Le guide di pagina non chiamano il backend.
7. Il bundle iniziale cresce al massimo di 1 kB compresso rispetto alla fase 1, e il chunk del catalogo delle pagine resta entro 20 kB compressi.
8. Lo script delle ancore fallisce se il catalogo delle pagine cita un'ancora inesistente.
9. Le guide di pagina sono utilizzabili da tastiera, con lettore di schermo e sotto i 992 px, come la guida introduttiva.

### Blocchi di rilascio

La fase 2 si rilascia in tre blocchi, ciascuno con i propri test, controllo delle ancore e verifica manuale:

1. **Blocco A, pagine di tutti i ruoli**: profilo, dashboard, calendario e dettaglio evento, tracce e dettaglio, album e dettaglio, anteprima, inventario personale e consegna.
2. **Blocco B, pagine di gestione**: utenti, economia, oggetti, modello del foglio e scansione dell'inventario, strumenti, configurazione iniziale, consegne notifiche e feed calendario.
3. **Blocco C, pagine del Super amministratore**: tenant e documenti legali.

Il nuovo testo di `common.help` e il passaggio di `GUIDED_TOUR_CATALOG_REVISION` a 2 entrano con il blocco A.

### Precisazioni dell'implementazione della fase 2

Al 2026-11-05 i tre blocchi sono implementati insieme; la verifica manuale resta da eseguire blocco per blocco.

- `GuidedTourPageDefinition` ha `pages`, un elenco di percorsi, al posto di `page`: il dettaglio di un oggetto dell'inventario risponde a `/inventory/:id` e `/inventory/items/:id`, la configurazione iniziale a `/onboarding` e `/onboarding/imports/:id`. Ha anche `requires`, per lasciare senza guida le pagine di una sezione spenta.
- Nel riconoscimento dell'URL vincono i percorsi senza parametri, così `/inventory/loan-template` non diventa il dettaglio di un oggetto.
- La composizione delle tappe è in `guided-tour-compose.ts`, condiviso dai due cataloghi senza portare la guida introduttiva nel chunk delle pagine.
- Un elemento è visibile quando ha larghezza e altezza, cade almeno in parte nella larghezza della finestra e non ha `visibility: hidden`. Per questo le ancore stanno su elementi a blocco: dove l'elemento era in linea, come la firma del profilo o l'avviso dei documenti legali, l'ancora è su un `div` che lo contiene.
- L'inventario usa un'ancora calcolata, `inventory.assignments` nella vista personale e `inventory.items` in quella dell'organizzazione; lo script delle ancore legge i letterali delle espressioni `[appTourAnchor]`.
- La tappa delle parti dell'anteprima cita anche il pulsante **Filtri**, che resta visibile quando il pannello delle parti è chiuso, e il testo dice di aprirlo.
- La tappa dei guasti di una consegna cita anche il pulsante **Segnala un guasto**, visibile quando l'elenco dei guasti è vuoto.
- Le tappe della scansione di un oggetto hanno un testo per chi non gestisce l'inventario, che vede solo le proprie consegne.
- Le ancore del feed calendario sono nel componente condiviso `calendar-feed-panel`, usato dal profilo e dalla pagina dei feed degli amministratori.
- Con l'interruttore applicativo spento anche la voce **Guida di questa pagina** scompare.
- Il componente di sovrapposizione è lo stesso della guida introduttiva: per la guida di pagina salta il benvenuto, non salva e mostra **Indietro** dalla seconda tappa.
- Pesi misurati il 2026-11-05 rispetto a `5b1540d`: bundle iniziale +0,38 kB stimati in trasferimento (limite 1 kB); chunk del catalogo delle pagine 7,8 kB compressi (limite 20 kB); chunk della guida introduttiva da 7,46 a 7,61 kB compressi, per la logica della guida di pagina nel componente condiviso.

## Piano di rilascio

### Fase 1 — Guida introduttiva

- tabelle, migrazione con invito, API e interruttore applicativo;
- servizio, catalogo, direttiva, componente e pulsante di aiuto;
- tappe dei sette ruoli e sezione del profilo;
- script delle ancore, test e aggiornamento dello standard di layout e del catalogo errori.

### Fase 2 — Guide di pagina

Descritta in [Guide di pagina](#guide-di-pagina):

- tappe con ambito di pagina, aperte solo da **Guida di questa pagina**, senza stato salvato e senza modifiche al backend;
- una guida per ogni pagina del layout che un ruolo può aprire, compresi profilo, configurazione iniziale, economia, inventario e strumenti;
- approfondimento delle funzioni escluse dal percorso principale dell'Amministratore, del Direttivo e del Super amministratore;
- rilascio in tre blocchi, descritti in [Blocchi di rilascio](#blocchi-di-rilascio).

### Fase 3 — Novità

- dopo un rilascio, punto informativo sul pulsante di aiuto e voce **Novità** con le sole tappe nuove;
- sono novità le tappe applicabili non viste con `introducedIn` maggiore della `catalogRevision` registrata; per un ruolo `COMPLETED` anche le tappe diventate applicabili per una funzionalità attivata dopo;
- mai un'apertura automatica della guida completa.

## Evoluzioni successive

- tappe pratiche che si completano quando l'utente svolge davvero l'azione, per esempio la prima disponibilità;
- lista «Primi passi» sulla dashboard per gli amministratori di un tenant appena creato;
- guida per la modalità bootstrap del Super amministratore;
- testi in altre lingue;
- interruttore del tenant per gli amministratori, se richiesto dalle associazioni.

## Criticità

| Criticità | Rischio | Mitigazione proposta |
| --- | --- | --- |
| Nomi già usati | «Onboarding guidato», «Configurazione iniziale» e «Primo accesso» indicano già altro | nome **Guida**, prefisso `guided-tour`, vocabolario dei testi vincolato |
| Ruolo scelto all'accesso | una persona con più ruoli vedrebbe guide sbagliate o ripetute | stato per persona e ruolo, ruolo letto dal token |
| Persona in più tenant | con lo stato per tenant la guida si ripete in ogni organizzazione, Super amministratore incluso | scelta accettata per l'isolamento tra tenant: **Salta la guida** e l'interruttore la chiudono con un clic, e il ripasso mostra le funzionalità proprie di quell'organizzazione |
| Nessun indicatore di primo accesso | al rilascio tutti gli utenti esistenti riceverebbero la guida automatica | profilo con invito creato dalla migrazione |
| Stato nel browser non affidabile | `localStorage` svuotato alla chiusura e senza separazione per utente | backend come fonte; `sessionStorage` solo per il rinvio di sessione |
| Ancore fragili | rotte lazy, menu per ruolo e flag, contenuti asincroni e layout mobile | identificativi stabili, candidate multiple, attesa limitata, scheda centrata, script di controllo |
| Testi che invecchiano | una pagina cambia e la guida descrive un'interfaccia che non esiste più | catalogo accanto al codice, script delle ancore, voce nel template di pull request |
| Tesoriere senza Economia | il ruolo non ha quasi nulla da usare e la guida sarebbe vuota | la guida mostra solo le sezioni attive: restano le tappe comuni |
| Percorsi lunghi per gli amministratori | troppe tappe rendono la guida pesante e verrebbe saltata | limite di 10, tappa unica per gli strumenti, guide di pagina in fase 2 |
| Interferenze con il flusso esistente | documenti legali, collegamenti diretti, dialoghi, modifiche non salvate, aggiornamento dell'applicazione | avvio solo sulla dashboard, condizioni di avvio, pausa su navigazione annullata, ripresa dall'ultima tappa || Nuovo canale di interfaccia | lo standard di layout ne prevede cinque | sezione dedicata nello standard all'implementazione |
| Accessibilità dell'evidenziazione | l'oscuramento non dice nulla a chi usa un lettore di schermo | testi autosufficienti, dialogo accessibile, annunci |
| Utente esterno | testi pensati per l'Utente prometterebbero eventi e brani non visibili | varianti di testo per ruolo e verifica manuale |
| Telefoni modesti | molti musicisti usano Taurus da telefono | nessuna libreria, chunk differito, un ricalcolo per frame |
| Due schede aperte | salvataggi concorrenti dello stesso avanzamento | lock ottimistico e unione delle tappe viste |
| Molte guide di pagina da mantenere | oltre cento tappe che invecchiano con le pagine | tappe brevi e legate a un'ancora, condizione di presenza, script delle ancore, rilascio a blocchi |
| Sezioni che dipendono dai dati | una guida di pagina descriverebbe sezioni che l'utente non vede | tappe escluse quando le loro ancore non sono visibili all'apertura |

## Decisioni approvate

Decisioni prese il 2026-10-24 sui punti aperti della bozza:

1. **Perimetro dello stato.** Per tenant: profilo e avanzamento vivono nello schema del tenant, per persona e ruolo.
2. **Utenti esistenti al rilascio.** Invito discreto sulla dashboard, una sola volta per ruolo, al posto dell'avvio automatico.
3. **Proposte automatiche.** Al massimo 3 per ruolo, poi solo il punto informativo sul pulsante di aiuto.
4. **Interruttore.** Unico per persona nel tenant; la rinuncia per singolo ruolo resta **Salta la guida**.
5. **Controllo dell'amministratore.** Nessun flag del tenant nella prima versione; solo l'interruttore applicativo `application.guided-tour.enabled`.
6. **Guide di pagina.** Fase 2.
7. **Novità.** Fase 3.
8. **Testi.** La rilettura dei testi di ogni ruolo è a cura del responsabile del progetto, prima del rilascio.
9. **Modalità bootstrap.** Esclusa; restano l'avviso «Primo accesso» della pagina Tenant e il runbook.
10. **Metriche.** Soli contatori aggregati per ruolo ed esito.
11. **Pulsante di aiuto.** Uno solo nella topbar, con un menu.
12. **Tappe.** Solo descrittive nella prima versione.
13. **Lingua.** Solo italiano.

Decisione presa il 2026-11-04, dopo l'introduzione del [Ruolo direttivo](board-role-spec.md):

14. **Direttivo.** `ROLE_BOARD` è previsto e gestito come gli altri ruoli: ha un proprio percorso, stato e avanzamento separati e lo stesso filtro per funzionalità del tenant.

Decisioni prese il 2026-11-05 sulle [guide di pagina](#guide-di-pagina) della fase 2:

15. **Stato delle guide di pagina.** Nessun salvataggio: né pagine viste né esito, e nessuna modifica al backend.
16. **Lunghezza.** Al massimo 10 tappe per pagina, senza scheda di benvenuto, come il limite della guida introduttiva.
17. **Presenza degli elementi.** Le tappe senza ancore visibili all'apertura sono escluse, non mostrate al centro dello schermo.
18. **Rilascio.** In tre blocchi: pagine di tutti i ruoli, pagine di gestione, pagine del Super amministratore.
19. **Collegamento.** Il testo di `common.help` cita la guida di pagina; la guida introduttiva non riceve tappe nuove.

## Alternative scartate

- **Stato globale nello schema `public`.** Avrebbe evitato di ripetere la guida a chi appartiene a più organizzazioni, ma avrebbe introdotto dati personali fuori dagli schemi tenant e una cancellazione GDPR legata all'ultima appartenenza attiva. Prevale l'isolamento per tenant, coerente con preferenze e notifiche.
- **Libreria di tour esterna.** Avrebbe aggiunto una dipendenza per funzioni già coperte da PrimeNG e da poche decine di righe di posizionamento.
- **Chiavi libere in `preferences`.** Senza tipi, vincoli e versione, e contrarie alla scelta di tabelle tipizzate fatta per le preferenze di notifica.
- **Guida obbligatoria.** Rallenterebbe chi conosce già Taurus senza garantire che venga letta.
- **Pagine viste salvate.** Avrebbe richiesto un'estensione delle API e un limite proprio oltre i 100 ID di `seen_steps`, per guide che si consultano quando servono e non hanno un esito da ricordare.
- **Tappe centrate per le sezioni assenti.** Avrebbero descritto parti della pagina che l'utente non vede, come una preparazione non configurata o la vista dell'inventario non aperta.
