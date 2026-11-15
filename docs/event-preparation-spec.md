# Preparazione operativa dell'evento

La funzionalità estende il dettaglio calendario esistente e coordina catalogo musicale, spartiti, disponibilità, presenze, inventario e gestione economica. Le regole economiche rimangono quelle di [Gestione economica tenant](financial-management-spec.md), le assegnazioni materiali quelle di [Gestione inventario tenant](inventory-management-spec.md) e la visibilità delle occorrenze quelle di [Eventi ricorrenti del calendario](recurring-calendar-events-spec.md).

## Stato del documento

ID catalogo: `event-preparation`.
Lo stato corrente è pubblicato nel [Catalogo funzionalità](features.md).

## Obiettivo

Trasformare la pagina dell'evento in una cabina di regia unica, capace di rispondere in modo immediato a queste domande:

- l'evento è pianificato e pubblicato correttamente?
- il programma musicale è definito?
- gli spartiti necessari sono disponibili e visibili ai musicisti corretti?
- le disponibilità raccolte sono sufficienti?
- strumenti e materiali necessari sono assegnati e pronti?
- preventivo e consuntivo economico sono aggiornati?
- dopo l'evento, presenze e posizione economica sono stati verificati?

La sezione **Preparazione operativa** mostra un esito sintetico come **Evento pronto**, **Da verificare** oppure **Preparazione incompleta**, con percentuale e verifiche completate. Ogni criticità ha un messaggio che indica cosa completare.

## Principio fondamentale: nessuno stato “pronto” manuale

Taurus non salva un booleano `ready` e non permette di dichiarare conclusa una criticità lasciando incoerente il dato di dominio.

Lo stato è una proiezione calcolata di:

- dati e visibilità dell'evento;
- programma musicale collegato;
- stato di tracce, spartiti e media;
- risposte di disponibilità;
- materiale pianificato e relative assegnazioni inventario;
- preventivo, movimenti e riconciliazione economica;
- conferma del registro presenze.

Sono persistite soltanto le decisioni che il sistema non può dedurre, per esempio se il programma sia richiesto per quell'evento, il numero minimo di partecipanti, la conferma intenzionale di un preventivo pari a zero o l'avvenuta verifica delle presenze.

Questa distinzione evita una checklist parallela che possa risultare “completa” mentre mancano spartiti, risposte o materiale.

## Relazione con lo stato dell'evento

`calendar_event.state` conserva il significato attuale:

- `DRAFT`: visibilità amministrativa;
- `COMPLETE`: evento completo visibile agli utenti interni autorizzati;
- `PUBLIC`: evento visibile anche agli utenti esterni.

Questi valori non diventano stati di lavorazione. Un evento `PUBLIC` può non essere pronto; un evento `DRAFT` può avere programma e materiali completi ma non essere ancora pubblicato.

## Ambito della prima versione

La prima versione comprende:

1. configurazione delle verifiche applicabili all'evento;
2. programma musicale ordinato, con riuso delle tracce esistenti;
3. controllo di disponibilità e visibilità degli spartiti;
4. riepilogo disponibilità e soglia minima di partecipanti;
5. pianificazione del materiale tramite oggetti e assegnazioni inventario esistenti;
6. conferma di preparazione del materiale;
7. preventivo, consuntivo e conferme esplicite per i casi a zero;
8. conferma del registro presenze dopo l'evento;
9. stato derivato, percentuale di completezza e criticità azionabili;
10. viste differenziate per ruolo nello stesso percorso frontend;
11. supporto alle singole occorrenze di serie ricorrenti;
12. notifiche mirate e integrazione con la dashboard operativa.

## Fuori scope

- inviti nominali o convocazioni per evento;
- assegnazione di parti musicali a una specifica persona;
- turni, ruoli di palco, trasporti o pernottamenti;
- prenotazione di quantità inventario non ancora assegnate;
- gestione di fornitori, acquisti o noleggi;
- creazione automatica di movimenti economici;
- modifica massiva della preparazione di tutte le occorrenze di una serie;
- congelamento legale o contabile dell'evento;
- chat, commenti liberi o checklist manuali generiche;
- generazione di un dossier PDF o ZIP dell'evento;
- sincronizzazione offline.

## Profili di preparazione

Alla prima configurazione un admin o super admin sceglie un profilo, che propone valori iniziali modificabili:

| Profilo | Luogo | Programma | Spartiti | Disponibilità | Materiali | Preventivo | Presenze | Chiusura economica |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `PERFORMANCE` | sì | sì | sì | sì | decisione esplicita | sì | sì | sì |
| `REHEARSAL` | decisione esplicita | sì | sì | sì | decisione esplicita | no | facoltativa | no |
| `OTHER` | decisione esplicita | no | no | decisione esplicita | no | no | no | no |

“Decisione esplicita” significa che l'amministratore deve scegliere se l'area è richiesta: il profilo non propone alcun valore (luogo e materiali per `REHEARSAL`, materiali per `PERFORMANCE`, luogo e disponibilità per `OTHER`), la scelta compare come “Scelta richiesta” con un bordo arancione e il salvataggio resta disattivato finché ogni area non è decisa. Anche il backend rifiuta un requisito assente con `400 eventPreparation.requirement.required`. “Facoltativa” è proposta come non richiesta e resta modificabile. Le aree di un modulo disattivato (materiali senza Inventario, preventivo e chiusura economica senza Economia) sono proposte come non richieste e bloccate, con il motivo accanto alla scelta.

Dopo la creazione del piano, ogni requisito può essere modificato singolarmente. Il profilo resta informativo e, cambiato su un piano salvato, non sovrascrive le personalizzazioni.

Vincoli:

- spartiti richiesti implica programma richiesto;
- materiali richiesti implica almeno una riga materiale prima di poter risultare pronto;
- disponibilità richiesta implica `minimumAvailableParticipants >= 1`;
- la scadenza risposte è espressa in minuti prima dell'inizio, da 0 a 43.200;
- la scadenza preparazione materiali è espressa nello stesso modo;
- presenze e chiusura economica sono verifiche successive all'evento e non riducono la prontezza precedente all'inizio.

## Fasi temporali derivate

| Fase | Regola | Indicatore principale |
| --- | --- | --- |
| `PREPARATION` | istante corrente precedente a `startDate` | prontezza operativa |
| `IN_PROGRESS` | tra `startDate` ed `endDate` | evento in corso e criticità residue |
| `FOLLOW_UP` | successivo a `endDate` | chiusura presenze, materiali ed economia |

`endDate` è già obbligatoria nel modello persistente. Un dato storico corrotto o non valutabile produce `UNKNOWN`: il sistema non inventa una durata convenzionale.

Eventi cancellati logicamente o occorrenze escluse non espongono la preparazione. La timezone è quella già risolta per l'evento e il tenant; tutti i confronti temporali avvengono backend-side.

## Stati derivati

### Prima dell'evento

| Stato | Significato |
| --- | --- |
| `NOT_CONFIGURED` | il piano di preparazione non esiste |
| `BLOCKED` | almeno una verifica obbligatoria bloccante non è soddisfatta |
| `ATTENTION` | nessun blocco, ma esistono avvisi operativi |
| `READY` | tutte le verifiche obbligatorie sono soddisfatte e non ci sono avvisi |
| `UNKNOWN` | la fase non è calcolabile perché mancano le date dell'evento |

### Dopo l'evento

| Stato | Significato |
| --- | --- |
| `TO_CLOSE` | almeno una verifica successiva richiesta è aperta |
| `CLOSED_WITH_WARNINGS` | tutte le verifiche richieste sono soddisfatte, ma restano avvisi non bloccanti |
| `CLOSED` | tutte le verifiche successive applicabili sono soddisfatte e non restano avvisi |
| `NOT_REQUIRED` | il piano non richiede verifiche successive |
| `UNKNOWN` | la fase non è calcolabile perché mancano le date dell'evento |

Lo stato non viene persistito. Qualunque cambiamento ai dati autorevoli si riflette alla lettura successiva.

## Percentuale di completezza

La percentuale è calcolata soltanto sulle verifiche applicabili:

```text
completionPercent = round(verifiche superate / verifiche applicabili × 100)
```

Ogni verifica pesa uno. La percentuale è un aiuto di navigazione, non sostituisce la severità: un evento al 90% con un singolo blocco critico resta `BLOCKED`.

Una sezione complessa non produce artificialmente decine di punti. Le verifiche di primo livello sono:

1. dati e visibilità;
2. programma;
3. spartiti;
4. disponibilità;
5. materiali;
6. preventivo;
7. presenze, solo in `FOLLOW_UP`;
8. chiusura economica, solo in `FOLLOW_UP`.

Le anomalie di dettaglio sono elencate sotto la relativa verifica ma non alterano il denominatore.

## Modello delle criticità

Ogni criticità restituita dal backend (`Issue`) contiene:

```json
{
  "code": "SCORE_NOT_READY",
  "area": "SCORES",
  "severity": "BLOCKER",
  "message": "Completa gli spartiti e i relativi file",
  "action": "#preparation-program",
  "relatedId": 12,
  "details": [
    {
      "relatedId": 12,
      "label": "2. Marcia trionfale",
      "reason": "NO_READY_SCORE",
      "message": "Nessuno spartito pronto: 1 in revisione",
      "action": "/tracks/12"
    }
  ],
  "detailCount": 1
}
```

Valori di severità:

- `BLOCKER`: impedisce `READY` o `CLOSED`;
- `WARNING`: produce `ATTENTION` o `CLOSED_WITH_WARNINGS` ma non blocca operazioni;
- `INFO`: indicazione di contesto, che non cambia stato né percentuale.

Ogni verifica non superata produce una sola criticità per area, con il dettaglio delle righe che la causano. I codici delle verifiche sono `EVENT_DATA`, `PROGRAM_MISSING`, `SCORE_NOT_READY`, `AVAILABILITY_INCOMPLETE`, `MATERIAL_NOT_READY`, `BUDGET_NOT_CONFIRMED`, `PRESENCE_NOT_CONFIRMED` e `FINANCE_NOT_CLOSED`. Gli avvisi `PROGRAM_TOO_LONG`, `SCORE_ALTERNATIVE_IN_REVIEW` e `MOVEMENTS_UNRECONCILED` e l'informazione `INSTRUMENT_NOT_COVERED` non contano nel denominatore.

Ogni dettaglio (`IssueDetail`) indica la riga con un'etichetta leggibile (posizione e nome del brano, numero d'inventario e nome dell'oggetto), un motivo stabile (`reason`), un messaggio e, se il ruolo può agire, un collegamento proprio; `relatedId` della criticità vale l'identificativo della riga quando il dettaglio è uno solo. Le criticità sono ordinate per severità (`BLOCKER`, `WARNING`, `INFO`), poi per area nell'ordine delle verifiche e infine per codice; la risposta ne contiene al più 20 e al più 20 dettagli ciascuna, mentre `issueCount` e `detailCount` riportano i totali, così la pagina può dire quante ne restano fuori.

Il catalogo dei codici è stabile; il messaggio è presentazione localizzata e non deve essere interpretato dal frontend. `action` dipende dal ruolo che legge la valutazione ed è assente quando quel ruolo non può agire:

| Area | Admin e super admin | Archivista | Tesoriere |
| --- | --- | --- | --- |
| dati evento | `#event-data` | — | — |
| programma e spartiti | `#preparation-program`; dettaglio `/tracks/{id}` | come admin | — |
| disponibilità | `#availability` | — | — |
| materiali | `#preparation-materials`; dettaglio `/inventory/items/{id}` | — | — |
| preventivo | `#preparation-confirmations` | — | come admin |
| presenze | `#presence` | — | — |
| chiusura economica | `#preparation-finance` | — | come admin |
| movimenti non riconciliati | `/finance?section=movements&reconciled=false&eventId={id}` | — | come admin |

Le ancore portano alla sezione della stessa pagina e vi spostano il focus; i percorsi aprono il dettaglio della traccia, dell'oggetto o l'elenco dei movimenti dell'evento. La dashboard riceve le criticità senza collegamenti, perché porta all'elenco del calendario.

## Regole di valutazione

### Dati e visibilità

Verifiche sempre applicabili:

- nome non vuoto;
- `startDate` presente;
- `endDate` successiva a `startDate`, quando presente;
- luogo presente se `locationRequired`;
- stato diverso da `DRAFT` per poter risultare `READY`.

Un evento `DRAFT` produce `WARNING` quando mancano più di sette giorni e `BLOCKER` negli ultimi sette giorni. Date invalide o mancanti sono sempre bloccanti.

### Programma musicale

Se richiesto:

- deve esistere almeno una voce attiva;
- l'ordine deve essere continuo e univoco;
- ogni riferimento deve appartenere al tenant e puntare a una traccia non cancellata;
- una traccia `DRAFT` è bloccante;
- per un evento `PUBLIC`, una traccia non `PUBLIC` è bloccante perché l'utente esterno non potrebbe consultarla;
- per un evento `COMPLETE`, sono ammesse tracce `COMPLETE` o `PUBLIC`;
- la somma delle durate pianificate, quando tutte presenti, produce un avviso se supera la durata dell'evento;
- la stessa traccia può comparire più volte, per esempio come bis, e ogni occorrenza mantiene ordine e note proprie.

### Spartiti

Se richiesti, il programma deve contenere almeno una voce e ogni voce deve avere almeno uno spartito pronto. Uno spartito è pronto quando:

1. ha `needsReview = false`;
2. ha almeno uno strumento associato;
3. ha almeno un `media_asset` in stato `READY`.

Media `MIGRATION_PENDING`, `PROCESSING`, `FAILED`, `INVALID` o `DELETED` non soddisfano la verifica. Anche la visibilità della traccia deve essere compatibile con quella dell'evento.

`SCORE_NOT_READY` compare quando almeno una voce non ha nessuno spartito pronto, o quando in un evento `PUBLIC` la traccia non è `PUBLIC`; il dettaglio dice quanti spartiti sono in revisione, senza strumenti, da impaginare o senza file pronti. Una parte è da impaginare quando ha una versione corrente e nessuna pagina, per esempio una parte scritta nell'[editor](music-writing-editor-spec.md#parti-da-impaginare) e non ancora impaginata; una parte con le pagine ancora in elaborazione resta tra quelle senza file pronti. Uno spartito senza strumenti o in revisione non blocca se la traccia ha un'alternativa pronta, ma non conta come pronto: le alternative ancora in revisione producono l'avviso `SCORE_ALTERNATIVE_IN_REVIEW`, con una riga per parte.

`INSTRUMENT_NOT_COVERED` (`INFO`) è una stima, non un organico: per ogni strumento dei partecipanti attesi che hanno risposto “disponibile”, conta i brani con parti pronte che non hanno una parte pronta per quello strumento. Il dettaglio riporta soltanto conteggi (“3 brani su 8 senza una parte pronta · 2 disponibili”), mai chi suona cosa, e la criticità non cambia stato né percentuale.

### Disponibilità

Il pubblico atteso usa la stessa regola deterministica della dashboard operativa finché non esisteranno inviti espliciti:

- evento `COMPLETE`: utenti attivi con ruolo partecipante interno;
- evento `PUBLIC`: utenti attivi interni ed esterni;
- un admin o archivista è incluso soltanto se possiede anche un ruolo partecipante;
- `DRAFT` non ha un pubblico atteso valutabile.

Se la disponibilità è richiesta:

- la verifica produce un'unica criticità `AVAILABILITY_INCOMPLETE`;
- `availableCount` deve raggiungere `minimumAvailableParticipants`;
- prima della scadenza, soglia non raggiunta e risposte mancanti sono `WARNING`;
- dalla scadenza, soglia non raggiunta è `BLOCKER`;
- dalla scadenza, almeno una risposta mancante è `BLOCKER`;
- indisponibilità esplicite non sono criticità autonome, ma concorrono ai conteggi;
- utenti disattivati non appartengono al pubblico atteso;
- la disponibilità dell'utente corrente continua a essere un'operazione immediata separata dal salvataggio pagina.

La scadenza predefinita proposta dai profili è 1.440 minuti prima dell'inizio. Può essere modificata dall'amministratore.

### Materiali

Se richiesti:

- deve esistere almeno una riga materiale;
- ogni riga deve riferirsi a un oggetto inventario attivo;
- `requiredQuantity` deve essere maggiore di zero;
- prima di risultare pronta, la riga deve essere collegata a un'assegnazione inventario attiva o parzialmente riconsegnata;
- l'assegnazione deve riferirsi allo stesso oggetto;
- la quantità residua assegnata deve essere almeno pari a quella richiesta;
- l'oggetto non deve essere `TO_REPAIR` o `OUT_OF_SERVICE`;
- l'oggetto non deve avere un guasto `UNSAFE` aperto o preso in carico; la verifica vale quando il tenant ha la funzionalità `INVENTORY_QR`, che porta le segnalazioni dei guasti;
- la preparazione materiale deve essere confermata sullo snapshot corrente.

Una conferma materiale salva l'hash di item, assegnazione, quantità residua, stato dell'assegnazione, condizione dell'oggetto e quantità richiesta. Se uno di questi dati cambia, la conferma non è più corrente e la riga torna da verificare con il motivo “conferma non più valida”.

Tutte le righe non pronte confluiscono nell'unica criticità `MATERIAL_NOT_READY`, con una riga di dettaglio per materiale che elenca i problemi (`ASSIGNMENT_MISSING`, `ASSIGNMENT_INACTIVE`, `ASSIGNMENT_ITEM_MISMATCH`, `QUANTITY_INSUFFICIENT`, `ITEM_NOT_USABLE`, `UNSAFE_ISSUE`, `CONFIRMATION_MISSING`, `CONFIRMATION_OBSOLETE`). Un'assegnazione mancante, non più attiva o di un altro oggetto, un oggetto non utilizzabile e un guasto non sicuro rendono la criticità `BLOCKER` subito, perché non si risolvono con il tempo; quantità insufficiente e conferma mancante o superata sono `WARNING` prima della scadenza materiali e `BLOCKER` dopo. La scadenza predefinita proposta è 180 minuti prima dell'evento.

La prima versione non riserva stock libero. Un materiale senza assegnazione può essere pianificato, ma non risulta pronto: l'amministratore deve creare una normale assegnazione inventario e collegarla. In questo modo quantità, responsabilità, riconsegne e prese visione rimangono governate dall'inventario senza una seconda contabilità di magazzino.

### Preventivo

Se richiesto, il preventivo deve essere confermato da admin, super admin o tesoriere.

La conferma salva un hash di:

- compenso previsto;
- descrizione e importo delle voci di costo, nel loro ordine;
- valuta, `EUR` in questa versione: il preventivo dell'evento non ne ha una propria e usa quella della gestione economica.

Qualunque modifica successiva invalida la conferma. Un preventivo interamente a zero è valido soltanto se confermato esplicitamente; l'assenza di valori non può essere interpretata automaticamente come “nessun costo previsto”.

La mancata conferma è bloccante per `READY`. La conferma non rende immutabile il preventivo e non limita i permessi economici esistenti.

### Presenze dopo l'evento

Se richieste, le presenze sono complete quando admin o super admin confermano il registro corrente.

La conferma salva un hash di utenti presenti, orari di arrivo e note, nel loro ordine. Qualunque modifica successiva invalida la conferma. È possibile confermare esplicitamente un registro con zero presenze.

Il salvataggio delle presenze e la conferma restano due operazioni distinte. La conferma non viene inclusa nel salvataggio generale dell'evento e rispetta le unità di modifica indipendenti definite dallo standard di layout.

### Chiusura economica dopo l'evento

Se richiesta, la verifica è soddisfatta quando:

- lo stato economico dell'evento calcolato dalla gestione economica è `SETTLED`: incassi pari al compenso previsto e spese pari alla somma dei costi; oppure
- non sono presenti movimenti e un utente economico autorizzato conferma esplicitamente “nessun movimento previsto”.

Lo stato è lo stesso che la gestione economica mostra per l'evento (`FinanceService.economicStatus`), così le due pagine non possono dare esiti diversi; il dettaglio della criticità ne riporta il motivo (nessun preventivo, movimenti senza preventivo, preventivo senza movimenti, importi oltre il preventivo o ancora da incassare o pagare).

La seconda decisione salva un hash di preventivo e movimenti correnti e, facoltativamente, un motivo di al più 500 caratteri, mostrato accanto alla conferma (`400 eventPreparation.reason.tooLong` oltre il limite). Con movimenti presenti la conferma è rifiutata (`400 eventPreparation.movements.exists`). L'aggiunta di un movimento oppure la modifica del preventivo la invalida.

Ogni altra combinazione mantiene `TO_CLOSE`; un preventivo assente senza movimenti richiede la conferma esplicita.

La riconciliazione dei movimenti resta informativa secondo la specifica economica; movimenti non riconciliati generano il `WARNING` `MOVEMENTS_UNRECONCILED` e portano a `CLOSED_WITH_WARNINGS` quando la posizione è saldata.

## Programma musicale

### Modello dati

Tabella `calendar_event_program_entry`:

| Campo | Regola |
| --- | --- |
| `id` | chiave primaria |
| `event_id` | evento tenant, FK senza cancellazione a cascata |
| `track_id` | traccia tenant, FK |
| `display_order` | ordine univoco tra righe attive dell'evento |
| `planned_duration_seconds` | facoltativo, da 1 a 86.400 |
| `notes` | facoltative, massimo 2.000 caratteri |
| `encore` | booleano, falso per impostazione predefinita: la voce è un bis |
| `track_name_snapshot` | nome della traccia al momento del salvataggio |
| audit/versione | campi audit tenant, `deleted` ed `entity_version` |

Non esiste un vincolo univoco su `(event_id, track_id)`: una traccia può ricomparire, per esempio come bis, e la voce lo indica con `encore`. L'ordine usa un indice univoco parziale sulle righe non cancellate.

Il programma mostra nome e stato correnti del catalogo e conserva il nome con cui la traccia è stata salvata. Se la traccia viene rinominata, la voce riporta anche il nome salvato (`savedTrackName`); se viene cancellata logicamente, la voce resta leggibile con il nome salvato, `trackAvailable` vale falso, gli spartiti non sono più offerti e la verifica del programma segnala la traccia non più nel catalogo.

### Gestione

Admin, super admin e archivista possono:

- cercare le tracce con un selettore paginato (20 risultati per pagina, “Altri risultati” per proseguire), senza caricare il catalogo intero;
- collegare un album: le sue tracce, nel relativo ordine, sostituiscono la scaletta corrente, conservando bis e note delle voci che restano;
- duplicare una voce, per esempio per un bis, e rimuoverla;
- riordinare le voci trascinandole oppure, da tastiera, con i pulsanti “sposta prima/dopo” di ogni riga; ogni spostamento è annunciato agli screen reader;
- indicare bis, durata e note esecutive;
- salvare l'intero programma come unità atomica.

Il client invia, nell'ordine, ID traccia, bis, durata e note, insieme alla versione del programma letta (`programVersion`). Nome e stato della traccia sono riletti dal backend; una traccia inesistente o cancellata produce `400 eventPreparation.track.notFound`.

Il programma contiene al più 100 voci: la pagina disattiva l'aggiunta al limite e rifiuta un album più lungo, il backend risponde `400 eventPreparation.program.tooLarge`.

### Fruizione degli spartiti

Ogni voce del programma riporta gli spartiti della traccia: descrizione, strumenti con nome e identificativo, se lo spartito è pronto, in revisione o da impaginare e i file `READY` con identificativo e nome. Il DTO non contiene binari né URL: i file si scaricano tramite l'endpoint media autorizzato (`/api/media/{id}/stream`), che verifica di nuovo il lettore.

- Admin, super admin e archivista ricevono tutti gli spartiti di ogni voce, pronti o no, e li aprono dal programma.
- L'utente interno vede nel programma soltanto tracce `COMPLETE` o `PUBLIC` e, per ciascuna, soltanto gli spartiti pronti dei propri strumenti.
- L'utente esterno vede soltanto eventi e tracce `PUBLIC`, con la stessa regola sugli spartiti.
- Le voci di tracce cancellate non compaiono nelle viste personali.
- Il tesoriere non riceve il programma.

**Stampa la scaletta** apre l'anteprima di stampa con le pagine degli spartiti che la vista mostra a chi stampa, per strumento e nel formato marcia, come descritto nella [stampa della scaletta](music-writing-editor-spec.md#stampa-della-scaletta). Le pagine passano dallo stesso endpoint media.

Il pacchetto ZIP di tutti gli spartiti resta rinviato perché richiede limiti, autorizzazione file-per-file e gestione di documenti voluminosi.

## Materiali dell'evento

### Modello dati

Tabella `calendar_event_material`:

| Campo | Regola |
| --- | --- |
| `id` | chiave primaria |
| `event_id` | evento tenant |
| `inventory_item_id` | oggetto inventario tenant |
| `inventory_assignment_id` | assegnazione facoltativa finché la riga è pianificata |
| `required_quantity` | maggiore di zero |
| `notes` | facoltative, massimo 2.000 caratteri |
| `display_order` | ordine univoco tra righe attive |
| `confirmation_hash` | hash dello snapshot confermato, facoltativo |
| `confirmation_at/by` | data e autore della conferma corrente |
| audit/versione | `deleted`, campi audit ed `entity_version` |

Quando l'assegnazione è valorizzata, il responsabile deriva dall'assegnatario e non viene duplicato. Le foreign key non hanno cancellazione a cascata; le cancellazioni applicative restano logiche.

La stessa assegnazione può servire più eventi. Questa relazione non modifica quantità o scadenza e non equivale a una prenotazione esclusiva.

### Flusso

1. L'amministratore aggiunge un oggetto e la quantità richiesta.
2. Può collegare subito un'assegnazione dello stesso oggetto oppure lasciare la riga da assegnare.
3. L'assegnazione si crea o si corregge dalla pagina Inventario: ogni riga porta al dettaglio dell'oggetto (`/inventory/items/{id}`) e ne mostra numero d'inventario, assegnatario e quantità ancora in carico.
4. Dopo la verifica fisica, l'amministratore conferma la preparazione della riga.
5. Taurus salva l'hash dello snapshot corrente.
6. Variazioni a quantità, assegnazione, residuo o condizione rendono la conferma obsoleta: la riga mostra “Conferma non più valida” e il pulsante diventa “Conferma di nuovo”.

Ogni riga riporta i problemi che la tengono non pronta, con le stesse etichette della criticità. I materiali si salvano insieme, con la versione letta (`materialsVersion`), e sono al più 100 righe (`400 eventPreparation.materials.tooLarge`). Mentre l'amministratore modifica le righe, una ricarica causata da un'altra sezione aggiorna lo stato di conferma delle righe già salvate senza scartare le modifiche.

Non vengono create automaticamente assegnazioni o riconsegne. Questo preserva conferme, notifiche, foto e regole di concorrenza già presenti nell'inventario.

## Configurazione persistita

Tabella `calendar_event_preparation` in relazione uno-a-uno con `calendar_event`:

| Campo | Tipo/Regola |
| --- | --- |
| `id` | PK |
| `event_id` | FK all'evento, univoca |
| `profile` | `PERFORMANCE`, `REHEARSAL`, `OTHER` |
| `location_required` | booleano |
| `program_required` | booleano |
| `scores_required` | booleano |
| `availability_required` | booleano |
| `minimum_available_participants` | obbligatorio e positivo se richiesto |
| `availability_deadline_minutes` | 0–43.200 |
| `materials_required` | booleano |
| `materials_deadline_minutes` | 0–43.200 |
| `budget_required` | booleano |
| `presence_closure_required` | booleano |
| `financial_closure_required` | booleano |
| `budget_confirmation_hash/at/by` | conferma preventivo corrente |
| `presence_confirmation_hash/at/by` | conferma registro presenze corrente |
| `no_movements_confirmation_hash/at/by` | conferma economica a zero |
| `no_movements_confirmation_reason` | motivo facoltativo della conferma economica a zero, massimo 500 caratteri |
| `program_version` | versione del programma, per il controllo di concorrenza del suo salvataggio |
| `materials_version` | versione dei materiali, per il controllo di concorrenza del loro salvataggio |
| audit/versione | tenant audit e lock ottimistico della configurazione |

Gli hash sono SHA-256 di un JSON canonico (chiavi in ordine alfabetico, importi come stringhe decimali senza zeri finali, istanti ISO-8601) che dichiara l'area e la versione di schema, oggi `2`. Un cambio di schema rende obsolete tutte le conferme precedenti, così un dato attestato diverso non passa mai per quello vecchio: con il passaggio allo schema 2 le conferme date prima vanno ripetute. Gli hash non sono firme elettroniche e non attestano identità oltre all'audit autenticato già presente.

Il piano viene creato soltanto per eventi già persistiti. Un evento nuovo viene prima salvato; la pagina propone subito dopo la configurazione guidata.

## Eventi ricorrenti

Preparazione, programma, materiali e conferme appartengono alla singola occorrenza. Non fanno parte del template di serie perché disponibilità, organico, materiale, presenze e consuntivo possono cambiare per data.

Regole:

- configurare la preparazione non imposta `series_exception`;
- una modifica del template di serie non sovrascrive il piano dell'occorrenza;
- la cancellazione di un'occorrenza elimina logicamente o rende non accessibili i relativi dati di preparazione secondo le normali regole di audit;
- le nuove occorrenze non ereditano automaticamente il piano nella prima versione;
- copia verso occorrenze future e template di preparazione sono evoluzioni rinviate.

## Ruoli e autorizzazioni

| Operazione | Super Admin | Admin | Tesoriere | Archivista | Utente | Utente esterno |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Vedere il riepilogo “Preparazione operativa” | sì | sì | solo economia | programma e catalogo | no | no |
| Configurare requisiti | sì | sì | no | no | no | no |
| Gestire programma | sì | sì | no | sì | no | no |
| Vedere tutti gli spartiti | sì | sì | no | sì | no | no |
| Vedere spartiti per i propri strumenti | se partecipante | se partecipante | no | se partecipante | sì | sì, su tracce `PUBLIC` |
| Vedere risposte nominative | sì | sì | no | no | no | no |
| Modificare la propria disponibilità | secondo ruolo partecipante | secondo ruolo partecipante | no | sì | sì | sì su evento `PUBLIC` |
| Gestire materiali | sì | sì | no | no | no | no |
| Gestire preventivo e consuntivo | sì | sì | sì | no | no | no |
| Gestire e confermare presenze | sì | sì | no | no | no | no |

Le righe sugli spartiti valgono anche per il programma della preparazione: admin, super admin e archivista ricevono tutti gli spartiti delle voci, utenti ed esterni soltanto quelli pronti dei propri strumenti, e il download passa comunque dalle regole di visibilità dell'endpoint media.

La sessione corrente continua a usare un solo ruolo effettivo. I dati restituiti dipendono dal ruolo nel token; la pagina non carica sezioni non autorizzate per poi nasconderle con CSS.

Il riepilogo **Preparazione operativa**, con percentuale di completamento, verifiche e criticità aggregate, non viene mostrato nelle sessioni `ROLE_USER` e `ROLE_USER_EXTERNAL`: le viste personali non contengono la valutazione (`evaluation` assente) e il frontend mostra la sezione solo quando la valutazione è presente. Restano separate e visibili, secondo lo stato e la visibilità dell'evento, le aree su cui il partecipante può consultare informazioni o intervenire direttamente: programma pubblicato in sola lettura, disponibilità personale e promemoria.

## API REST

### Vista amministrativa

```text
GET /api/calendar-events/{eventId}/preparation
PUT /api/calendar-events/{eventId}/preparation/configuration
PUT /api/calendar-events/{eventId}/preparation/program
PUT /api/calendar-events/{eventId}/preparation/materials
POST /api/calendar-events/{eventId}/preparation/materials/{materialId}/confirm
POST /api/calendar-events/{eventId}/preparation/budget-confirmation
POST /api/calendar-events/{eventId}/preparation/presence-confirmation
POST /api/calendar-events/{eventId}/preparation/no-movements-confirmation
```

La lettura completa e tutte le conferme esposte sotto `/api/calendar-events` sono riservate ad admin e super admin. Le conferme economiche sono disponibili anche al tesoriere tramite la vista economica `/api/finance/events` e richiedono il modulo finanza. Il `PUT` del programma è autorizzato anche per l'archivista tramite matcher esplicito posizionato prima della regola generale del calendario.

L'autorizzazione è data dalle regole HTTP di `SecurityConfiguration` e, dopo di esse, dalle annotazioni `@PreAuthorize` delle risorse, applicate dalla method security: le due restano allineate. La vista amministrativa (`GET .../preparation`) e la configurazione hanno un matcher riservato ad admin e super admin, e la vista archivista (`GET .../preparation/catalogue`) uno per admin, super admin e archivista, entrambi prima della regola generale del calendario che ammette l'archivista. `EventPreparationSecurityConfigurationTest` verifica che un archivista riceva `403` sulla vista amministrativa e sulla configurazione.

### Vista archivista

```text
GET /api/calendar-events/{eventId}/preparation/catalogue
PUT /api/calendar-events/{eventId}/preparation/program
```

La risposta contiene la configurazione ridotta, il programma, i conteggi aggregati delle disponibilità e una valutazione limitata a dati e visibilità, programma, spartiti e disponibilità. Non contiene nominativi, materiali assegnati o importi.

### Vista personale

```text
GET /api/user/calendar-events/{eventId}/preparation
GET /api/external/calendar-events/{eventId}/preparation
```

Le risposte applicano rispettivamente visibilità `COMPLETE/PUBLIC` e `PUBLIC`, anche alle tracce del programma, e contengono soltanto la propria disponibilità. Non contengono valutazione, spartiti, materiali, dati economici o altri utenti; la configurazione riporta solo profilo, requisiti di programma, spartiti e disponibilità e la scadenza delle risposte.

### Disponibilità personale

La risposta dell'utente per una singola occorrenza è un valore a tre stati:

- `AVAILABLE`: disponibile;
- `UNAVAILABLE`: non disponibile;
- assenza della risposta: nessuna disponibilità ancora espressa oppure risposta annullata.

Impostare nuovamente la disponibilità aggiorna la risposta esistente e la relativa data; non crea una seconda risposta per la stessa coppia evento/utente. L'annullamento rimuove la risposta corrente e riporta l'utente allo stato “nessuna risposta”. Entrambe sono operazioni immediate, indipendenti dagli altri salvataggi della pagina.

| Ambito e ruolo effettivo | Impostare disponibile/non disponibile | Annullare la risposta | Visibilità evento |
| --- | --- | --- | --- |
| `ROLE_SUPER_ADMIN`, `ROLE_ADMIN`, `ROLE_BOARD`, `ROLE_ARCHIVIST` | `PATCH /api/calendar-events/{id}/availability?available=true` oppure `available=false` | `PATCH /api/calendar-events/{id}/availability/cancel` | vista amministrativa consentita al ruolo |
| `ROLE_USER` | `PATCH /api/user/calendar-events/{id}/availability?available=true` oppure `available=false` | `PATCH /api/user/calendar-events/{id}/availability/cancel` | eventi `COMPLETE` e `PUBLIC` |
| `ROLE_USER_EXTERNAL` | `PATCH /api/external/calendar-events/{id}/availability?available=true` oppure `available=false` | `PATCH /api/external/calendar-events/{id}/availability/cancel` | solo eventi `PUBLIC` |

Il verbo dell'annullamento è `PATCH`, non `DELETE`: si tratta di una transizione del valore a tre stati e non della cancellazione logica dell'evento. I matcher Spring Security dichiarano esplicitamente sia l'endpoint di impostazione sia quello `/cancel` prima delle regole `denyAll` delle viste personali. Un ruolo valido per una vista non ottiene automaticamente accesso alle altre viste; ruolo insufficiente produce `403`, evento non visibile o appartenente a un altro tenant produce `404`.

Le stesse operazioni applicate alle occorrenze future di una serie sono definite in [Eventi ricorrenti del calendario](recurring-calendar-events-spec.md#disponibilità-bulk). Gli effetti della risposta sui promemoria personali sono definiti in [Promemoria eventi tramite Web Push](web-push-reminders-spec.md#disponibilità-e-promemoria-personale).

### Vista economica

```text
GET /api/finance/events/{eventId}/preparation
POST /api/finance/events/{eventId}/budget-confirmation
POST /api/finance/events/{eventId}/no-movements-confirmation
```

È disponibile ad admin, super admin e tesoriere. Riusa il riepilogo economico esistente e non concede accesso alle API generiche di modifica evento.

### Ricerca per selettori

Programma e materiali usano endpoint paginati esistenti. Non caricano liste complete nel browser. Le query rispettano tenant, soft delete, stato e ruolo.

## Contratto della vista completa

Risposta esemplificativa abbreviata:

```json
{
  "configuration": {},
  "evaluation": {
    "evaluatedAt": "2026-10-08T10:00:00+02:00",
    "phase": "PREPARATION",
    "preparationStatus": "BLOCKED",
    "closureStatus": "NOT_REQUIRED",
    "completionPercent": 67,
    "passedChecks": 4,
    "applicableChecks": 6,
    "blockerCount": 1,
    "warningCount": 2,
    "infoCount": 1,
    "issues": [
      {
        "code": "SCORE_NOT_READY",
        "area": "SCORES",
        "severity": "BLOCKER",
        "details": [],
        "detailCount": 0
      }
    ],
    "issueCount": 4,
    "excludedAreas": []
  },
  "program": [],
  "programVersion": 3,
  "availability": {
    "expected": 45,
    "available": 30,
    "unavailable": 5,
    "missing": 10,
    "minimumRequired": 28,
    "deadline": "2026-10-09T20:30:00+02:00"
  },
  "materials": [],
  "materialsVersion": 1,
  "confirmations": {
    "budgetAt": "2026-10-01T18:00:00+02:00",
    "budgetCurrent": true,
    "presenceAt": null,
    "presenceCurrent": false,
    "noMovementsAt": null,
    "noMovementsCurrent": false,
    "noMovementsReason": null
  }
}
```

La vista (`View`) contiene `configuration`, `evaluation`, `program` con la sua versione, `availability`, `materials` con la loro versione e `confirmations`, cioè quando sono state date le conferme di preventivo, presenze e assenza di movimenti e se corrispondono ancora ai dati correnti. Le versioni compaiono soltanto nelle viste che possono salvare quella sezione; le conferme soltanto nella vista amministrativa (tutte) e in quella economica (preventivo e assenza di movimenti). Dati dell'evento, economia e presenze restano nelle API già esistenti del dettaglio evento.

Se il tenant non ha la funzionalità Inventario o Finanza, le relative aree escono dalla valutazione e i requisiti corrispondenti (materiali, preventivo, chiusura economica) vengono restituiti come non richiesti; i materiali sono una lista vuota. La valutazione non diventa `UNKNOWN`: quando il piano richiedeva una di quelle aree, `excludedAreas` la elenca e la pagina avvisa l'amministratore che l'area non è valutata finché il modulo resta disattivato. `UNKNOWN` resta riservato alle date dell'evento non valutabili.

L'endpoint usa `Cache-Control: no-store`. Non accetta tenant, ruolo, user ID o timezone dal client.

## Comandi e concorrenza

Ogni area è una propria unità di salvataggio:

- configurazione;
- programma;
- materiali;
- dati generali evento;
- presenze;
- preventivo;
- singola disponibilità personale.

Configurazione, programma e materiali hanno ciascuno la propria versione: `version` della configurazione, `programVersion` e `materialsVersion` della vista. Il salvataggio invia la versione letta; il backend la avanza in modo condizionale e, se nel frattempo un'altra richiesta l'ha cambiata, risponde `409 eventPreparation.versionConflict` senza toccare i dati. Le versioni sono indipendenti: salvare il programma non fa fallire il salvataggio dei materiali o della configurazione aperti in un'altra scheda.

Al conflitto la sezione chiede se ricaricare, avvisando che le modifiche fatte lì andranno perse: solo dopo la conferma la pagina rilegge la preparazione e annuncia “Preparazione ricaricata con i dati aggiornati”. Il salvataggio o la ricarica di una sezione non scartano le modifiche pendenti nelle altre, che restano elencate dalla guardia di uscita.

Il programma viene sostituito atomicamente in una transazione, dopo validazione di tutte le tracce. I materiali seguono la stessa regola. Una riga non valida fa fallire l'intero comando.

Le conferme leggono lo snapshot e calcolano l'hash nella transazione del comando; il client non invia l'hash da confermare.

## Architettura backend

### Aggregatore

```text
EventPreparationResource, UserEventPreparationResource,
ExternalEventPreparationResource, FinanceEventPreparationResource
          |
EventPreparationService
```

`EventPreparationService` espone viste e comandi e non salva stato derivato. Le viste per ruolo (`get`, `getCatalogue`, `getPersonal`, `getFinance`) e le valutazioni della dashboard e dello scheduler (`dashboardEntries`, `scheduledEntries`) leggono gli stessi snapshot con `EventPreparationLoader` e li valutano con `EventPreparationEvaluator`, costruendo lo stesso DTO `View` limitato per aree e campi. Una vista singola e la dashboard valutano quindi gli stessi dati nello stesso modo.

Non vengono eseguite chiamate HTTP interne tra moduli. Tutti i dati appartengono allo stesso schema tenant e vengono letti tramite repository. Lo stato economico usato dalla chiusura è quello di `FinanceService.economicStatus`, calcolato sui movimenti dell'evento letti nello snapshot.

### Componenti

- entità `CalendarEventPreparation`, `CalendarEventProgramEntry` e `CalendarEventMaterial`;
- repository `EventPreparationRepository`, `EventProgramEntryRepository` ed `EventMaterialRepository`;
- `EventPreparationLoader`, che legge gli snapshot di più eventi con un numero fisso di query (programma, parti delle tracce, materiali con i guasti non sicuri aperti, risposte, partecipanti con i loro strumenti, movimenti e presenze), eseguendo una query solo se un evento della richiesta ne ha bisogno;
- `PreparationSnapshot`, ciò che la valutazione di un evento legge;
- `EventPreparationEvaluator`, che dallo snapshot ricava fase, verifiche, criticità ordinate e limitate, percentuale e stato dei materiali, senza leggere né salvare altro;
- `PreparationHashes`, che calcola gli hash canonici delle conferme e delle revisioni di programma e materiali usate nelle chiavi delle notifiche;
- `EventPreparationService` per viste, comandi, log e notifiche dei salvataggi;
- `EventPreparationMetrics` per le metriche descritte in [Osservabilità](#osservabilità);
- `EventPreparationNotificationScheduler` per le notifiche a scadenza e le conferme materiali invalidate;
- DTO unico `View` in `EventPreparationDtos`, ridotto per ruolo dal servizio.

Le conferme non vengono invalidate da altri servizi: a ogni lettura il servizio ricalcola l'hash corrente e lo confronta con quello salvato.

### Errori

Errori di database, tenant o autorizzazione fanno fallire l'intera richiesta con RFC 7807; non vengono mascherati come zero criticità.

## Migrazione Liquibase

La migration tenant `20260905040000_event_preparation.xml` crea:

1. `calendar_event_preparation` con PK propria, FK univoca su evento e vincoli dei requisiti;
2. `calendar_event_program_entry` con indice univoco parziale sull'ordine attivo;
3. `calendar_event_material` con riferimenti a evento, item e assegnazione;
4. indici su evento, traccia, item, assegnazione e righe attive;
5. check constraint per durate, quantità, scadenze e coerenza minima dei flag;
6. campi audit e `entity_version` coerenti con le tabelle tenant;
7. inclusione nel `tenant-master.xml`.

Non viene effettuato backfill dei piani: gli eventi esistenti rimangono `NOT_CONFIGURED`. Non vengono creati programma, materiali o conferme deducendoli da descrizioni libere.

La migration tenant `20261027100000_event_preparation_closure.xml`, inclusa nel `tenant-master.xml`, aggiunge:

1. a `calendar_event_preparation` le colonne `program_version` e `materials_version` (bigint, non nulle, `0` per i piani esistenti) e `no_movements_confirmation_reason` (varchar 500, facoltativa);
2. a `calendar_event_program_entry` le colonne `encore` (booleano, non nullo, falso per le voci esistenti) e `track_name_snapshot` (varchar 255), valorizzata per le voci esistenti con il nome corrente della traccia.

Entrambi i changeset hanno il rollback che rimuove le colonne. Il passaggio degli hash allo schema 2 non richiede migrazione dei dati, ma rende obsolete le conferme di preventivo, presenze, assenza di movimenti e materiali date prima del rilascio: la pagina le mostra come “Dati cambiati dopo la conferma” (per i materiali “Conferma non più valida”) e vanno ripetute.

Le nuove tabelle non sono indicizzate in OpenSearch. Il dettaglio e la valutazione usano PostgreSQL; la ricerca di tracce continua a usare i meccanismi catalogo esistenti.

## Frontend Angular

### Struttura della pagina

La rotta canonica resta `/calendar/:id`, preservando link, dashboard e notifiche esistenti. L'unico `DetailComponent` compone le sezioni della preparazione con componenti dedicati in `pages/calendar-events/detail/preparation/`:

| Sezione e ancora | Componente | Ruoli |
| --- | --- | --- |
| Preparazione operativa (`#preparation`) | `app-preparation-summary` e, per admin e super admin, `app-preparation-configuration` | admin, super admin, archivista, tesoriere |
| Conferma del preventivo (`#preparation-confirmations`) | `app-preparation-confirmation` | admin, super admin, tesoriere |
| Programma (`#preparation-program`) | `app-preparation-program` | tutti tranne il tesoriere |
| Materiali (`#preparation-materials`) | `app-preparation-materials` | admin e super admin |
| Dati evento (`#event-data`) | sezione esistente | tutti tranne il tesoriere |
| Consuntivo economico (`#preparation-finance`) | sezione esistente con la conferma “nessun movimento” | admin, super admin, tesoriere |
| Utenti disponibili (`#availability`) | sezione esistente | tutti tranne il tesoriere |
| Gestisci presenze (`#presence`) | sezione esistente con la conferma del registro | admin e super admin |

Le ancore sono le stesse che il backend usa nelle azioni delle criticità; `preparation-labels.ts` raccoglie etichette, profili, ordinamento delle criticità e limiti condivisi dai componenti.

La pagina non viene trasformata in un unico form. Configurazione (“preparazione”), programma e materiali sono unità sporche distinte registrate tramite `DetailPageBase`: la guardia di uscita elenca quelle con modifiche e una ricarica causata da un'altra sezione non le scarta. Se la lettura della preparazione fallisce, la sezione mostra “Preparazione non disponibile” con l'azione “Riprova” e il resto della pagina resta utilizzabile. Salvataggi, conferme e ricariche sono annunciati in una live region `polite` della pagina.

Un collegamento con un frammento, per esempio da una notifica (`/calendar/{id}#preparation-materials`), sposta il focus sulla sezione dopo il primo caricamento.

### Sezione Preparazione operativa

La sezione è visibile ad admin, super admin, archivista e tesoriere quando la vista contiene la valutazione. Mostra:

- stato `Da configurare`, `Preparazione incompleta`, `Da verificare`, `Evento pronto` o `Valutazione non disponibile`;
- tag di fase `Preparazione`, `In corso` o `Chiusura`;
- una barra di avanzamento con percentuale e numero di verifiche completate, e i conteggi di blocchi, avvisi e informazioni;
- stato della chiusura successiva, se richiesta: `Da completare`, `Completata con verifiche`, `Completata` o `Stato non disponibile`;
- l'azione “Mostra criticità (N)”, aperta all'arrivo quando c'è almeno un blocco, che rivela l'elenco e vi sposta il focus;
- per l'amministratore, l'avviso “Aree escluse dalla valutazione” quando un modulo disattivato toglie un'area richiesta;
- conteggi rapidi di disponibilità, brani e materiali richiesti.

L'elenco delle criticità è semantico: un titolo per l'elenco e uno per ogni criticità, con severità come testo, area, dettagli delle righe (“e altri N” oltre i 20 mostrati) e il collegamento indicato dal backend per il ruolo. Un'ancora porta alla sezione della pagina e vi sposta il focus senza ricaricare; un percorso apre la traccia, l'oggetto o i movimenti non riconciliati dell'evento. Se le criticità sono più di 20, una nota dice quante non sono elencate.

La configurazione mostra profilo, requisiti come scelte “Richiesto/Non richiesto”, partecipanti minimi e scadenze di disponibilità e materiali. Un requisito non ancora deciso è segnato da “Scelta richiesta” e impedisce il salvataggio; i requisiti di un modulo disattivato e gli spartiti senza programma sono bloccati con il motivo.

### Programma

- elenco ordinato con posizione, nome della traccia collegato al suo dettaglio, stato, bis, durata e note;
- avviso per la traccia rinominata (con il nome salvato) o non più nel catalogo;
- selettore paginato delle tracce e collegamento di un album, con i limiti di 100 voci;
- riordinamento trascinando la maniglia o con i pulsanti “sposta prima/dopo”, duplicazione e rimozione, ognuno annunciato agli screen reader;
- espansione “Spartiti” di ogni voce con descrizione, strumenti, stato (“Pronto”, “Da impaginare”, “In revisione”, “Non pronto”) e download dei file pronti; una parte da impaginare ha “Impagina”, che apre la scheda Ascolto della traccia;
- salvataggio esplicito dell'intero programma con la versione letta;
- “Stampa la scaletta”, attiva sul programma salvato con almeno una pagina da stampare.

Utenti ed esterni vedono lo stesso elenco in sola lettura, con i soli spartiti pronti dei propri strumenti, e stampano la scaletta con quelli.

### Disponibilità

Admin e super admin vedono conteggi, soglia, scadenza e tabella nominativa già disponibile, con filtri per risposta. Gli altri utenti vedono soltanto la propria risposta e il proprio promemoria. Il tesoriere non vede le sezioni di disponibilità, indisponibilità e presenze.

L'archivista vede la propria risposta e conteggi aggregati necessari alla diagnostica spartiti; non riceve l'elenco nominativo dal nuovo endpoint.

### Materiali

La sezione amministrativa mostra per ogni riga l'oggetto con il collegamento al suo dettaglio, il numero d'inventario, la quantità richiesta, l'assegnatario con la quantità ancora in carico, la condizione, i problemi e lo stato della conferma. Le azioni sono:

- selettore oggetto;
- selettore assegnazione dell'oggetto;
- quantità e aggiunta della riga, fino a 100 righe;
- conferma della preparazione (“Conferma di nuovo” se superata) e rimozione della riga.

La pagina non replica modifica oggetto, presa visione o riconsegna.

### Economia

Admin, super admin e tesoriere vedono preventivo, incassato, pagato, residui, risultato e stato economico. I comandi riusano i dialoghi economici esistenti; “Movimenti dell'evento” apre l'elenco dei movimenti filtrato sull'evento (`/finance?section=movements&eventId={id}`).

Le conferme del preventivo e di “nessun movimento previsto” sono schede che dicono cosa attestano, quando sono state date e se i dati sono cambiati dopo; la seconda accetta un motivo facoltativo di al più 500 caratteri. Non bloccano future correzioni.

### Presenze

La griglia esistente rimane un'unità autonoma. Dopo il salvataggio, un secondo comando conferma il registro corrente: con presenze non salvate la conferma è disattivata (“Salva le presenze prima di confermare il registro”). Una modifica successiva mostra “Dati cambiati dopo la conferma”.

## Esperienza per ruolo

### Admin e super admin

Vedono l'intero stato di preparazione e possono intervenire su tutte le aree, salvo le normali separazioni tra salvataggi.

### Archivista

Usa la pagina come workspace musicale: programma, stato tracce e diagnostica spartiti. Non vede finanza, assegnatari inventario o nomi nelle disponibilità aggregate.

### Utente e utente esterno

Vedono informazioni evento consentite, programma pubblicato in sola lettura, disponibilità personale e promemoria. L'intera sezione **Preparazione operativa** è esclusa per `ROLE_USER` e `ROLE_USER_EXTERNAL`, compresi percentuale, stato aggregato e avvisi di preparazione: le viste personali non contengono la valutazione, che potrebbe rivelare indirettamente problemi economici o materiali. Dal programma scaricano gli spartiti pronti dei propri strumenti; gli altri si consultano dal catalogo, con le sue regole.

### Tesoriere

La rotta padre `calendar` ammette `ROLE_TREASURER`: il tesoriere apre il dettaglio `/calendar/:id`, per esempio dalle notifiche di chiusura economica, mentre l'elenco del calendario e la voce di menu restano esclusi. Il dettaglio carica soltanto intestazione minima, riepilogo limitato a preventivo e chiusura economica, conferme e sezione economica tramite `/api/finance/**`. Non può leggere o modificare programma, disponibilità, presenze, materiali o dati generali dell'evento, e la pagina non ne mostra nemmeno le sezioni vuote.

## Accessibilità

- stato e percentuale hanno testo, non dipendono dal colore;
- la progress bar espone nome, valore e significato accessibile;
- le criticità sono un elenco semantico con titoli correttamente gerarchizzati;
- le ancore aggiornano focus e URL fragment senza perdere modifiche;
- drag and drop dispone sempre di pulsanti alternativi;
- tabelle hanno intestazioni e descrizioni;
- salvataggi e conferme aggiornano una live region `polite`;
- errori bloccanti usano `role="alert"` soltanto dopo un'azione o un caricamento fallito;
- `prefers-reduced-motion` disabilita scorrimenti animati;
- la pagina resta usabile a 320 px senza scorrimento orizzontale globale.

## Notifiche

Le notifiche sono prodotte tramite l'outbox generalizzata e non dal frontend.

| Evento | Destinatari | Regola |
| --- | --- | --- |
| programma pubblicato o modificato | utenti disponibili autorizzati | una notifica per salvataggio, solo evento visibile e futuro |
| disponibilità confermata | admin e super admin | una notifica dopo l'aggiornamento riuscito |
| indisponibilità comunicata | admin e super admin | una notifica dopo l'aggiornamento riuscito |
| risposta di disponibilità annullata | admin e super admin | una notifica dopo l'annullamento riuscito |
| materiali salvati (`MATERIALS_UPDATED`) | assegnatari delle righe, admin e super admin | admin e super admin ricevono oggetti e quantità di tutte le righe; ogni assegnatario soltanto quelli delle proprie assegnazioni (“Per … ti sono richiesti: Leggio × 2”), al più 5 oggetti nominati e “e altri N” |
| conferma materiale invalidata (`MATERIAL_CONFIRMATION_INVALIDATED`) | admin e super admin | una volta per conferma superata, prima della fine dell'evento: nomina oggetto ed evento e invita a verificare di nuovo |
| disponibilità incompleta (`AVAILABILITY_THRESHOLD_MISSED`) | admin e super admin | una volta alla scadenza disponibilità, se `AVAILABILITY_INCOMPLETE` è ancora presente |
| presenze da confermare (`PRESENCE_FOLLOW_UP`) | admin e super admin | una volta dopo la fine, se richieste |
| chiusura economica aperta (`FINANCE_FOLLOW_UP`) | admin, super admin e tesoriere | una volta dopo la fine, se richiesta |

Le notifiche a scadenza e quelle delle conferme materiali invalidate sono prodotte da `EventPreparationNotificationScheduler` (cron `application.event-preparation.notification-cron`, default ogni minuto) sui soli tenant con la funzionalità, per eventi tra 30 giorni fa e i prossimi 31 giorni. Le notifiche del servizio e dello scheduler aprono `/calendar/{id}#preparation`, quella della conferma materiale `/calendar/{id}#preparation-materials`; la pagina porta il focus sulla sezione. La notifica sui materiali richiede anche il modulo Inventario.

Per evitare spam, il salvataggio atomico del programma genera un solo evento anche se contiene molti riordini. Anche ogni comando di disponibilità genera una sola notifica: il punto di pubblicazione intercetta esclusivamente il servizio core transazionale, non le facciate per utenti interni o esterni che lo delegano. In questo modo l'evento outbox viene registrato nella stessa transazione della modifica e non viene pubblicato una seconda volta fuori transazione. I promemoria a scadenza usano chiavi evento deterministiche composte da tipo, evento e istante di scadenza; la conferma materiale invalidata usa `event-preparation:{eventId}:MATERIAL_CONFIRMATION_INVALIDATED:{materialId}:{hash}`, con l'hash della conferma superata, così una nuova conferma seguita da un nuovo cambiamento produce una nuova notifica. L'outbox impedisce duplicazioni senza rendere persistito lo stato di prontezza autorevole.

I messaggi utente non contengono importi, risposte altrui o materiale assegnato ad altre persone.

## Integrazione con dashboard operativa

Per admin e super admin, con la funzionalità `EVENT_PREPARATION` attiva, il provider calendario aggiunge:

- `EVENT_PREPARATION_BLOCKED` (`DANGER`) per eventi non ancora iniziati, entro la finestra della dashboard (14 giorni), con stato `BLOCKED`;
- `EVENT_PREPARATION_ATTENTION` (`WARNING`) per eventi entro 7 giorni con stato `ATTENTION`;
- `EVENT_FOLLOW_UP_REQUIRED` (`WARNING`) per eventi terminati negli ultimi 30 giorni con chiusura `TO_CLOSE`.

La dashboard mostra conteggio eventi ed evento più vicino, senza il numero di risposte. I collegamenti sono `/calendar?attention=event-preparation` per le prime due righe e `/calendar?attention=event-follow-up` per il follow-up: l'elenco del calendario chiede a `GET /api/dashboard/operations/calendar-events` gli eventi che quelle righe contano e li pagina sul server, così elenco e conteggio coincidono. Non duplica tutte le criticità.

Le righe sulle disponibilità mancanti vengono deduplicate: un evento esce da `CALENDAR_RESPONSES_MISSING` solo quando una riga di preparazione lo conta già con la criticità `AVAILABILITY_INCOMPLETE`, cioè un blocco entro la finestra o un avviso entro 7 giorni. Un evento tra 7 e 14 giorni con il solo avviso sulle disponibilità resta quindi nelle risposte mancanti.

La dashboard valuta tutti gli eventi candidati con le stesse letture e la stessa valutazione della vista completa, ma con un numero fisso di query qualunque sia il numero di eventi: `EventPreparationLoader` legge programma, parti, materiali, risposte, partecipanti, movimenti e presenze di tutti gli eventi insieme. Il bilancio è separato da quello della [dashboard](operational-dashboard-spec.md#prestazioni): al più 12 query per le altre righe, misurate con la preparazione spenta, più al più 8 query fisse della preparazione. `EventPreparationIT` misura 8 query sia con 2 sia con 15 eventi, e la richiesta completa passa da 11 a 19 query.

## Sicurezza e privacy

### Isolamento tenant

- Ogni query usa il tenant derivato dal token e lo schema già selezionato; le nuove tabelle stanno nello schema del tenant e non hanno una colonna `tenant_code`.
- ID inviati dal client vengono verificati nel tenant prima di creare relazioni.
- Track, item e assignment di tenant diversi producono `404`, non dettagli di autorizzazione.
- Nessun dato preparazione viene aggiunto agli indici OpenSearch condividendo informazioni sensibili.

### Minimizzazione per ruolo

- utenti ed esterni non ricevono nomi o risposte di altri partecipanti;
- archivista riceve conteggi aggregati, non nominativi;
- tesoriere riceve soltanto dati evento minimi e dati economici;
- importi, movimenti e controparti non compaiono nei DTO musicali o personali;
- materiali amministrativi non sono esposti agli assegnatari salvo le normali informazioni della propria assegnazione;
- URL media e deep link sono costruiti da percorsi interni consentiti.

### Testo libero e log

Note esecutive e finalità del materiale sono testo non fidato: vengono validate, escaped e mai interpretate come HTML. Log e metriche non contengono note, descrizioni economiche, nomi utente o titoli dei file.

## Osservabilità

`EventPreparationMetrics` registra metriche Micrometer a cardinalità limitata, esposte da Prometheus con i nomi seguenti:

- `taurus_event_preparation_evaluation_total{status,closure,phase}`: ogni evento valutato in una vista, nella dashboard o, senza conteggio, nello scheduler;
- `taurus_event_preparation_evaluation_duration_seconds{view}`: durata di ogni vista (`admin`, `catalogue`, `personal`, `finance`, `dashboard`, `scheduler`);
- `taurus_event_preparation_issue_total{area,severity,code}`: le criticità elencate dalle valutazioni;
- `taurus_event_preparation_command_total{area,outcome}`: comandi con esito `success`, `conflict`, `invalid`, `not_found` o `error`;
- `taurus_event_preparation_confirmation_invalidated_total{area}`: conferme trovate superate per la prima volta, oggi quelle dei materiali notificate dallo scheduler.

I tag sono chiusi: `eventId`, tenant, user ID, track ID e item ID non sono tag metrici.

Log strutturati in formato chiave=valore:

- `event_preparation_evaluation_failed` con vista, event ID interno (o numero di eventi per la lettura), area e classe errore;
- `event_preparation_command` con event ID, area, versione, esito e `actorHash`;
- `event_preparation_confirmation` con event ID, area, hash troncato a 12 cifre e `actorHash`;
- `event_preparation_reference_rejected` per un riferimento di un altro tenant o incoerente, con event ID, area e motivo, senza identificativo né dati della risorsa estranea.

`actorHash` sono le prime 12 cifre esadecimali dello SHA-256 dell'utente: permette di correlare i comandi di una stessa persona senza scriverne l'identificativo nel log. Lo scheduler delle notifiche registra inoltre l'errore di elaborazione di un tenant.

## Prestazioni

Obiettivi:

- p95 della vista amministrativa sotto 700 ms con 100 voci di programma, 1.000 utenti e 100 materiali;
- p95 delle viste personali sotto 400 ms;
- nessun caricamento binario nel DTO;
- nessuna query per riga e, nella dashboard, nessuna query per evento.

`EventPreparationIT` li verifica su PostgreSQL con un evento di 100 brani, 1.000 utenti con uno strumento e la loro risposta e 100 materiali assegnati: il 2026-10-28 la vista amministrativa ha misurato un p95 di 81 ms e quella personale di 46 ms. È una misura su Testcontainers: non sostituisce una prova di carico su staging con dati reali, che lo script k6 del [runbook](runbook-test.md#171-performance) non copre ancora per questa vista.

Programma e materiali hanno al più 100 righe; la valutazione restituisce al più 20 criticità con al più 20 dettagli ciascuna, con i totali in `issueCount` e `detailCount`.

`EventPreparationLoader` legge con un numero fisso di query, indipendente da righe ed eventi:

- programma con le tracce di tutti gli eventi richiesti;
- parti delle tracce con strumenti e media `READY`;
- materiali con item, assegnazioni e guasti `UNSAFE` aperti;
- risposte di disponibilità e partecipanti attivi con i loro strumenti;
- movimenti degli eventi (`FinancialMovementRepository`);
- presenze, con hash calcolato su ordine deterministico.

Una query viene eseguita solo se un evento della richiesta ne ha bisogno: la vista economica, per esempio, non legge programma né materiali.

La prima versione non usa cache: le mutazioni attraversano domini diversi e una cache aumenterebbe il rischio di mostrare “pronto” su dati obsoleti. Ogni comando riuscito restituisce la vista ricalcolata, che la pagina mostra subito; dopo un conflitto o una lettura fallita la pagina rilegge la preparazione.

## Gestione errori

| Caso | Risposta/comportamento |
| --- | --- |
| evento non visibile o altro tenant | `404` |
| ruolo non autorizzato a un comando | `403` |
| versione di configurazione, programma o materiali superata | `409 eventPreparation.versionConflict`; la sezione chiede se ricaricare e scarta le proprie modifiche solo dopo la conferma |
| requisito senza scelta, oltre 100 righe, motivo oltre 500 caratteri | `400` con le chiavi `eventPreparation.requirement.required`, `program.tooLarge`, `materials.tooLarge`, `reason.tooLong` |
| traccia/item/assegnazione inesistente o incoerente | `400` senza dettagli cross-tenant |
| hash di conferma diventato obsoleto | verifica non superata, non errore di lettura |
| funzionalità Inventario o Finanza disabilitata | area esclusa dalla valutazione e requisito restituito come non richiesto |
| errore database o tenant routing | RFC 7807, nessuna risposta parziale ingannevole |
| salvataggio sezione fallito | modifiche locali conservate e messaggio con azione riprova |

## Test backend

I casi elencati sotto sono coperti da queste classi:

- `EventPreparationServiceTest`: valutazione, viste per ruolo, scelte esplicite, limiti, versioni, materiali e loro problemi, chiusura economica da `SETTLED`, motivo di “nessun movimento”, alternative in revisione, copertura strumentale, tracce rinominate o cancellate, notifiche dei salvataggi, metriche;
- `PreparationHashesTest`: JSON canonico con valuta e schema, importi con scale diverse, invalidazione per ogni valore attestato, conferme dello schema precedente non più valide, `actorHash`;
- `EventPreparationIT` su PostgreSQL: migrazione con i valori predefiniti, `409` sulle versioni senza toccare i dati, isolamento tra tenant, numero fisso di query della dashboard, obiettivi prestazionali;
- `EventPreparationSecurityConfigurationTest`: matrice ruolo/endpoint di tutte le viste e i comandi, `no-store`, validazione del motivo e dei salvataggi prima del servizio;
- `EventPreparationNotificationSchedulerTest`: notifiche a scadenza deterministiche e notifica della conferma materiale invalidata, una per hash superato e solo prima della fine dell'evento;
- `CalendarOperationProviderTest` e `OperationalDashboardIT`: righe della dashboard, deduplicazione per finestra, eventi del filtro del calendario e bilancio di query.

Le disponibilità e le loro notifiche sono coperte dai test del calendario indicati nel [runbook di test](runbook-test.md).

### Valutazione

- piano assente e stato `NOT_CONFIGURED`;
- separazione tra `state` evento e prontezza;
- calcolo di fase con e senza `endDate`;
- denominatore composto soltanto da verifiche applicabili;
- priorità blocker rispetto alla percentuale;
- limite e ordinamento deterministico delle criticità e dei dettagli;
- area richiesta con il modulo disattivato restituita come non richiesta ed elencata in `excludedAreas`, mai `UNKNOWN`;
- ogni requisito richiede una scelta esplicita;
- nessuno stato derivato salvato nel database.

### Programma e spartiti

- programma vuoto quando richiesto;
- duplicazione consentita della stessa traccia;
- ordine univoco e sostituzione atomica;
- traccia `DRAFT`, cancellata o con visibilità incompatibile;
- spartito assente, in revisione, senza strumento, da impaginare o senza media `READY`;
- alternativa in revisione con almeno uno spartito pronto;
- durata totale superiore alla durata evento;
- filtro spartiti per strumenti e ruolo;
- snapshot storico dopo rinomina o cancellazione logica della traccia;
- isolamento tenant.

### Disponibilità

- pubblico atteso per `COMPLETE` e `PUBLIC`;
- esclusione utenti inattivi;
- soglia prima e dopo la scadenza;
- risposte mancanti e indisponibilità;
- copertura strumentale soltanto informativa;
- nessun nominativo nei DTO archivista, utente o esterno.
- aggiornamento della risposta esistente senza duplicati;
- annullamento verso “nessuna risposta” per evento singolo e serie;
- autorizzazione degli endpoint `PATCH .../availability/cancel` per vista amministrativa, interna ed esterna;
- rifiuto con `403` quando il ruolo tenta di usare la vista di un altro pubblico;
- una sola notifica outbox per conferma, indisponibilità o annullamento, dentro la transazione del servizio core.

### Materiali

- riga pianificata senza assegnazione;
- coerenza item/assegnazione/responsabile;
- quantità residua insufficiente;
- condizione non utilizzabile;
- hash conferma valido e invalidato da ogni variazione rilevante;
- guasto `UNSAFE` quando la feature è disponibile;
- nessuna modifica automatica a quantità, assegnazioni o riconsegne;
- autorizzazione admin e isolamento tenant.

### Economia e presenze

- preventivo zero non confermato e confermato;
- invalidazione dopo modifica di compenso o costi;
- chiusura con `SETTLED`;
- conferma nessun movimento e invalidazione successiva;
- warning per movimenti non riconciliati senza blocco della chiusura;
- registro presenze vuoto confermabile;
- invalidazione dopo modifica delle presenze;
- tesoriere senza accesso ai dati operativi.

### Notifiche

- un solo evento outbox per salvataggio programma;
- destinatari filtrati per visibilità e tenant;
- deduplicazione soglie e follow-up;
- nessun importo o nominativo improprio nei payload;
- mancata consegna non annulla la modifica di dominio.

## Test frontend

I casi elencati sotto sono coperti dalle specifiche Karma accanto ai componenti:

- `event-preparation.service.spec.ts`: endpoint per ruolo, versioni nei corpi dei salvataggi, motivo di “nessun movimento” ripulito;
- `event-program.spec.ts`: programma creato da un album, con bis e spartiti delle voci che restano;
- `preparation/preparation-labels.spec.ts`: ordinamento delle criticità, scelte esplicite dei profili, moduli disattivati, ancore e percorsi, conflitto di versione;
- `preparation/preparation-summary.component.spec.ts`: stato, fase e barra di avanzamento, criticità con collegamenti e dettagli, “Mostra criticità” e focus, aree escluse, criticità non elencate;
- `preparation/preparation-configuration.component.spec.ts`: scelte esplicite, profilo su piano salvato, vincoli, moduli disattivati, ricarica senza perdita, salvataggio e conflitto;
- `preparation/preparation-confirmation.component.spec.ts`: conferma nuova, corrente e superata, API economica del tesoriere, attesa delle presenze non salvate, motivo con limite;
- `preparation/preparation-program.component.spec.ts`: selettore paginato, duplicazione, riordino con trascinamento e pulsanti, limite, album, salvataggio con bis e versione, conflitto, spartiti e download, parti da impaginare, stampa della scaletta, sola lettura;
- `preparation/preparation-materials.component.spec.ts`: numero d'inventario, quantità in carico, collegamento e problemi, assegnazione dell'oggetto scelto, limite, salvataggio con versione, conflitto;
- `detail.component.spec.ts`: sezioni e chiamate HTTP per ogni ruolo, guardia delle unità sporche attraverso una ricarica, live region, focus dal frammento, lettura fallita con “Riprova”;
- `finance.component.spec.ts`: movimenti non riconciliati dell'evento aperti dal collegamento della criticità.

Casi coperti:

- composizione delle sezioni per ogni ruolo;
- testata per tutti gli stati e fasi;
- percentuale, conteggi e ordinamento criticità;
- navigazione ad ancora e gestione focus;
- salvataggi indipendenti senza perdita di modifiche nelle altre sezioni;
- conflitto `409` e ricaricamento controllato;
- programma con aggiunta, duplicazione, riordino e rimozione;
- fallback accessibile al drag and drop;
- spartiti filtrati e download autorizzato;
- stampa della scaletta del programma salvato, con ogni brano una volta;
- soglia e scadenza disponibilità;
- materiali pianificati, collegati e confermati;
- conferma preventivo e presenze;
- vista economica isolata del tesoriere;
- assenza di dati non autorizzati anche nelle chiamate HTTP;
- layout mobile a 320 px e navigazione tastiera;
- guardia modifiche non salvate con elenco delle unità sporche.

## Test end-to-end

La suite Playwright `taurus-fe/e2e/specs/event-preparation.spec.ts`, descritta in `e2e/README.md`, verifica su un'istanza completa e su un evento indicato da `E2E_PREPARATION_EVENT_ID`: per l'amministratore `Cache-Control: no-store`, barra di avanzamento e criticità che portano alla sezione con il focus; per l'archivista la sola vista catalogo, il riordino da tastiera con l'annuncio e la guardia che elenca il programma; per il socio la vista personale in sola lettura; per il tesoriere le sole API economiche; per amministratore e socio l'analisi axe e il layout a 320 px. Le prove non salvano nulla.

I percorsi seguenti, che modificano i dati, restano un collaudo manuale su staging (`PREP-001`…`PREP-010` del [runbook di test](runbook-test.md#145-preparazione-evento)); isolamento tra tenant, conflitti e passaggi di stato sono comunque coperti dai test backend.

1. Admin crea un evento, configura profilo performance e vede le criticità iniziali.
2. Archivista compone il programma e corregge uno spartito non pronto.
3. Utente vede il programma e soltanto gli spartiti del proprio strumento, quindi registra disponibilità.
4. Utente esterno non vede un evento o una traccia non `PUBLIC`.
5. Admin raggiunge la soglia partecipanti, collega materiale assegnato e lo conferma.
6. Tesoriere conferma un preventivo, senza poter modificare dati evento.
7. L'evento passa a `READY` senza salvataggio manuale dello stato.
8. Una modifica allo spartito o all'assegnazione fa riapparire la criticità pertinente.
9. Dopo l'evento admin salva e conferma le presenze.
10. Tesoriere registra i movimenti fino a `SETTLED` e la chiusura passa a `CLOSED`.
11. Ogni tentativo con ID di un altro tenant fallisce senza rivelare dati.

## Migrazione e rilascio

La funzionalità richiede il flag globale `application.event-preparation.enabled` (default `false` in `application.yml`) e la funzionalità tenant `EVENT_PREPARATION`, che dipende dal Calendario (`CALENDAR`): con il calendario spento la preparazione è inefficace e lo scheduler salta il tenant (vedi [Funzionalità configurabili per tenant](tenant-feature-flags-spec.md#comportamento-del-calendario)). Le API dei materiali richiedono anche `INVENTORY`; le conferme economiche richiedono `FINANCE`.

Prima dell'abilitazione:

1. backup PostgreSQL;
2. applicazione Liquibase a tutti gli schemi tenant;
3. verifica vincoli e indici;
4. test dei DTO per ogni ruolo;
5. prova con evento `DRAFT`, `COMPLETE`, `PUBLIC` e ricorrente;
6. collaudo con dati economici e inventario reali di staging;
7. controllo prestazioni con volumi limite;
8. verifica notifiche, deep link e metriche;
9. smoke test mobile e accessibilità.

Gli eventi esistenti restano utilizzabili nella pagina attuale e mostrano un invito amministrativo non bloccante a configurare la preparazione. Utenti ed esterni non vedono `NOT_CONFIGURED` come errore.

Il rilascio della migration `20261027100000` e degli hash con schema 2 rende superate tutte le conferme date in precedenza: preventivo, presenze, assenza di movimenti e materiali tornano da confermare. Su un tenant che usa già la preparazione, avvisare gli amministratori prima del rilascio; gli eventi conclusi con le conferme ripetute tornano `CLOSED`, quelli futuri riprendono la prontezza alla nuova conferma. Al primo passaggio dello scheduler dopo il rilascio parte una notifica «Conferma materiale non più valida» per ogni materiale confermato degli eventi non ancora terminati dei prossimi 31 giorni: è l'effetto atteso del cambio di schema, non un guasto.

## Rollback

Disabilitare il flag globale o la funzionalità tenant ripristina il dettaglio evento senza workspace di preparazione. Programma, configurazione, materiali e conferme restano nelle nuove tabelle e non vengono eliminati.

Il rollback non modifica eventi, tracce, spartiti, assegnazioni, presenze o movimenti. Alla riattivazione, gli hash vengono rivalutati sui dati correnti e possono risultare obsoleti; Taurus non forza una vecchia conferma a tornare valida.

## Criteri di accettazione

1. `DRAFT`, `COMPLETE` e `PUBLIC` mantengono il significato di visibilità e non vengono riusati come stato operativo.
2. Prontezza e chiusura sono sempre derivate e non esiste un booleano manuale `ready`.
3. Ogni verifica non deducibile ha una configurazione o conferma esplicita e auditata.
4. La percentuale considera soltanto aree applicabili e non nasconde blocker.
5. Ogni criticità ha codice stabile, area, severità e azione autorizzata.
6. Il programma è ordinato, atomico, tenant-scoped e consente ripetizioni della stessa traccia.
7. Una traccia o uno spartito non visibile al pubblico dell'evento impedisce `READY`.
8. Solo media `READY` soddisfano il controllo spartiti.
9. Gli utenti ricevono soltanto spartiti compatibili con i propri strumenti.
10. La soglia disponibilità e le risposte mancanti cambiano severità alla scadenza configurata.
11. La copertura strumentale è presentata come euristica e non come assegnazione di organico.
12. I materiali riusano assegnazioni inventario e non introducono una seconda quantità di magazzino.
13. Una conferma materiale diventa obsoleta quando cambia lo snapshot rilevante.
14. Un materiale non assegnato o non utilizzabile impedisce `READY` quando richiesto.
15. Preventivo zero e registro presenze vuoto possono essere confermati intenzionalmente.
16. Modifiche successive invalidano conferme economiche o presenze senza impedire nuove correzioni.
17. `SETTLED` chiude automaticamente l'area economica; gli altri stati seguono le regole documentate.
18. Il tesoriere usa soltanto API economiche e non riceve programma, disponibilità, presenze o materiali.
19. Archivista, utente ed esterno ricevono DTO costruiti per allowlist senza dati nascosti lato client.
20. Programma e materiali di una serie appartengono all'occorrenza e non creano `series_exception`.
21. Ogni area mantiene salvataggio, dirty state e concorrenza indipendenti.
22. Nessuna query o relazione può attraversare il tenant corrente.
23. OpenSearch non diventa fonte autorevole della preparazione.
24. Il caricamento non esegue query per riga e rispetta gli obiettivi prestazionali.
25. La dashboard deduplica disponibilità e preparazione per lo stesso evento.
26. Le notifiche sono aggregate per comando e non espongono informazioni non autorizzate.
27. Un'area richiesta il cui modulo è disattivato per il tenant esce dai requisiti, restituita come non richiesta, ed è elencata in `excludedAreas` con un avviso all'amministratore: non produce `UNKNOWN` né un falso `READY` silenzioso. `UNKNOWN` resta riservato alle date dell'evento non valutabili.
28. La rotta `/calendar/:id` e i collegamenti esistenti restano validi.
29. La pagina è utilizzabile a 320 px, da tastiera e con screen reader.
30. Feature flag e rollback preservano tutti i dati applicativi e di preparazione.
31. Disponibilità, indisponibilità e annullamento sono transizioni autorizzate e transazionali; ogni comando riuscito genera una sola notifica amministrativa.

## Decisioni rinviate

- convocazioni nominali e organico per parte;
- copia del piano verso occorrenze future;
- template riutilizzabili di programma e preparazione;
- prenotazioni esclusive di stock libero;
- pacchetto ZIP/PDF dell'evento;
- logistica di trasporto, palco, divise e pernottamenti;
- workflow di approvazione del programma;
- firme o congelamento formale di presenze e consuntivo;
- sincronizzazione offline.

## Requisiti aperti

Nessuno.
