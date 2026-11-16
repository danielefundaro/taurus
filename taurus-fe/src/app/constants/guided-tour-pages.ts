import { GuidedTourPageDefinition, GuidedTourStep, GuidedTourText, TenantFeature } from '../module';
import { composeSteps } from './guided-tour-compose';
import { RoleEnums } from './role.enums';

// The page guides of docs/guided-tour-spec.md, section «Guide di pagina». Kept out of `constants/index.ts`: this
// catalog is a chunk of its own, loaded by the help menu the first time it opens.

/** No page guide may exceed it. */
export const GUIDED_TOUR_PAGE_MAX_STEPS = 10;

const { SUPER_ADMIN, ADMIN, BOARD, TREASURER, ARCHIVIST, USER, USER_EXTERNAL } = RoleEnums;
const ALL = [SUPER_ADMIN, ADMIN, BOARD, TREASURER, ARCHIVIST, USER, USER_EXTERNAL];
/** Everyone but the treasurer, who has no catalog, inventory or availability. */
const NOT_TREASURER = [SUPER_ADMIN, ADMIN, BOARD, ARCHIVIST, USER, USER_EXTERNAL];
/** The roles of `isTenantManager`. */
const MANAGERS = [SUPER_ADMIN, ADMIN, BOARD];
const CATALOG = [...MANAGERS, ARCHIVIST];
const ADMINISTRATORS = [SUPER_ADMIN, ADMIN];

/** The same text for some roles, the default for the others. */
function variant(text: string, roles: RoleEnums[], others: string): GuidedTourText {
    return { default: others, ...Object.fromEntries(roles.map((role) => [role, text])) };
}

export const GUIDED_TOUR_PAGES: readonly GuidedTourPageDefinition[] = [
    // Block A: the pages of every role.
    {
        pages: ['/profile'],
        steps: [
            {
                id: 'page.profile.personal',
                roles: ALL,
                anchors: ['profile.personal'],
                icon: 'pi pi-id-card',
                title: 'Informazioni personali',
                body: 'Aggiorna nome, cognome, data di nascita ed e-mail e salva con «Salva profilo» in alto. Il nome utente non si cambia.',
                introducedIn: 2
            },
            {
                id: 'page.profile.events',
                roles: ALL,
                requires: [TenantFeature.CALENDAR],
                anchors: ['profile.events'],
                icon: 'pi pi-calendar',
                title: 'Eventi a cui hai partecipato',
                body: 'Qui trovi gli eventi in cui sei stato segnato presente.',
                introducedIn: 2
            },
            {
                id: 'page.profile.calendarFeed',
                roles: [USER, USER_EXTERNAL],
                requires: [TenantFeature.EXTERNAL_CALENDAR_FEED],
                anchors: ['profile.calendarFeed'],
                icon: 'pi pi-link',
                title: 'Calendario esterno',
                body: 'Crea il collegamento e aggiungilo al calendario del telefono: concerti e prove compaiono da soli. Il link si vede una volta sola.',
                introducedIn: 2
            },
            {
                id: 'page.profile.notifications',
                roles: ALL,
                requires: [TenantFeature.NOTIFICATION_PREFERENCES],
                anchors: ['profile.notifications'],
                icon: 'pi pi-bell',
                title: 'Notifiche',
                body: 'Scegli quali notifiche ricevere e come, poi premi «Salva preferenze».',
                points: [{ text: 'Promemoria prima degli eventi', requires: [TenantFeature.WEB_PUSH_REMINDERS, TenantFeature.CALENDAR] }, { text: 'Riepilogo giornaliero e ore di silenzio' }, { text: 'Attiva le notifiche su questo dispositivo' }],
                introducedIn: 2
            },
            {
                id: 'page.profile.signature',
                roles: NOT_TREASURER,
                requires: [TenantFeature.INVENTORY_SIGNATURE],
                anchors: ['profile.signature'],
                icon: 'pi pi-pen-to-square',
                title: 'Firma elettronica',
                body: 'Scegli come confermare con un codice le firme dei fogli di affidamento e delle prese visione.',
                introducedIn: 2
            },
            {
                id: 'page.profile.guide',
                roles: ALL,
                anchors: ['profile.guide'],
                icon: 'pi pi-compass',
                title: 'Guida',
                body: "Accendi o spegni l'avvio automatico della guida, riaprila o ricominciala da capo.",
                introducedIn: 2
            },
            {
                id: 'page.profile.security',
                roles: ALL,
                anchors: ['profile.security'],
                icon: 'pi pi-lock',
                title: 'Sicurezza',
                body: "Cambia la password e attiva la verifica in due passaggi con un'app di autenticazione.",
                introducedIn: 2
            },
            {
                id: 'page.profile.account',
                roles: ALL,
                anchors: ['profile.dangerZone'],
                icon: 'pi pi-user-minus',
                title: 'Il tuo account',
                body: 'Qui disattivi il tuo account o chiedi la cancellazione definitiva dei tuoi dati. Entrambe le azioni chiedono conferma.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/'],
        steps: [
            {
                id: 'page.dashboard.todo',
                roles: ALL,
                anchors: ['dashboard.operations'],
                icon: 'pi pi-check-square',
                title: 'Da fare',
                body: "Da fare raccoglie le attività che chiedono la tua attenzione: apri una voce per andare dove serve. «Aggiorna» ricarica l'elenco.",
                introducedIn: 2
            },
            {
                id: 'page.dashboard.counters',
                roles: [SUPER_ADMIN, ADMIN, BOARD, ARCHIVIST, USER],
                anchors: ['dashboard.stats'],
                icon: 'pi pi-chart-bar',
                title: 'I contatori',
                body: {
                    default: "I contatori mostrano utenti, album e tracce dell'organizzazione: toccane uno per aprire l'elenco.",
                    [SUPER_ADMIN]: "I contatori mostrano i totali della piattaforma e dell'organizzazione: toccane uno per aprire l'elenco.",
                    [ARCHIVIST]: "Album e tracce disponibili: tocca un contatore per aprire l'elenco.",
                    [USER]: "Album e tracce disponibili: tocca un contatore per aprire l'elenco."
                },
                introducedIn: 2
            },
            {
                id: 'page.dashboard.inventory',
                roles: NOT_TREASURER,
                requires: [TenantFeature.INVENTORY],
                anchors: ['dashboard.inventory'],
                icon: 'pi pi-box',
                title: 'Inventario',
                body: variant('Il materiale che ti è affidato e le prese visione da confermare.', [ARCHIVIST, USER, USER_EXTERNAL], "Il riepilogo dell'inventario con le prese visione e le riconsegne in attesa."),
                introducedIn: 2
            },
            {
                id: 'page.dashboard.recents',
                roles: NOT_TREASURER,
                anchors: ['dashboard.recents'],
                icon: 'pi pi-file',
                title: 'Tracce recenti',
                body: 'Le tracce aggiunte o modificate di recente: aprine una per leggere le parti.',
                introducedIn: 2
            },
            {
                id: 'page.dashboard.events',
                roles: ALL,
                requires: [TenantFeature.CALENDAR],
                anchors: ['dashboard.events'],
                icon: 'pi pi-calendar',
                title: 'Prossimi eventi',
                body: 'I prossimi concerti e prove: apri un evento per vederne i dettagli.',
                introducedIn: 2
            },
            {
                id: 'page.dashboard.notifications',
                roles: ALL,
                anchors: ['dashboard.notifications'],
                icon: 'pi pi-bell',
                title: 'Notifiche',
                body: 'Filtra le notifiche, segnale come lette, rimandale o eliminale; aprine una per andare al dettaglio.',
                points: [{ text: 'Da una notifica puoi disattivarne la categoria', requires: [TenantFeature.NOTIFICATION_PREFERENCES] }],
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/calendar'],
        requires: [TenantFeature.CALENDAR],
        steps: [
            {
                id: 'page.calendar.create',
                roles: MANAGERS,
                anchors: ['calendar.create'],
                mobileAnchors: ['calendar.create', 'calendar.header'],
                icon: 'pi pi-calendar-plus',
                title: 'Nuovo evento',
                body: 'Crea una prova o un concerto; nel dettaglio scegli date, luogo e, se serve, la ricorrenza.',
                points: [{ text: 'In elenco selezioni più eventi per eliminarli insieme' }],
                introducedIn: 2
            },
            {
                id: 'page.calendar.views',
                roles: NOT_TREASURER,
                anchors: ['calendar.views'],
                icon: 'pi pi-th-large',
                title: 'Mese o elenco',
                body: "Passa dal mese all'elenco; nel mese usa le frecce e «Oggi» per spostarti.",
                introducedIn: 2
            },
            {
                id: 'page.calendar.open',
                roles: NOT_TREASURER,
                anchors: ['calendar.events'],
                icon: 'pi pi-calendar',
                title: 'Apri un evento',
                body: {
                    default: 'Apri un evento per vederne i dettagli e dire se ci sarai.',
                    [SUPER_ADMIN]: 'Apri un evento per modificarlo, vedere le risposte e segnare le presenze.',
                    [ADMIN]: 'Apri un evento per modificarlo, vedere le risposte e segnare le presenze.',
                    [BOARD]: 'Apri un evento per modificarlo, vedere le risposte e segnare le presenze.',
                    [USER_EXTERNAL]: 'Trovi gli eventi pubblici: aprine uno per vederne i dettagli e dire se ci sarai.'
                },
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/calendar/:id'],
        requires: [TenantFeature.CALENDAR],
        steps: [
            {
                id: 'page.event.data',
                roles: NOT_TREASURER,
                anchors: ['event.data'],
                icon: 'pi pi-calendar',
                title: 'Dati evento',
                body: variant("Date, luogo e compenso dell'evento: modifica e salva con «Salva evento» in alto.", MANAGERS, "Data, orario e luogo dell'evento."),
                points: [
                    { text: 'In una serie scegli se cambiare anche gli eventi successivi', roles: MANAGERS },
                    { text: 'Imposta il promemoria per chi partecipa', roles: MANAGERS, requires: [TenantFeature.WEB_PUSH_REMINDERS] }
                ],
                introducedIn: 2
            },
            {
                id: 'page.event.myAvailability',
                roles: NOT_TREASURER,
                anchors: ['event.myAvailability'],
                icon: 'pi pi-check-circle',
                title: 'La tua disponibilità',
                body: 'Rispondi «Sono disponibile» o «Non sono disponibile»: la risposta si registra subito e puoi annullarla.',
                points: [{ text: 'In una serie puoi rispondere anche per le date future' }, { text: 'Scegli quando ricevere il promemoria', requires: [TenantFeature.WEB_PUSH_REMINDERS] }],
                introducedIn: 2
            },
            {
                id: 'page.event.answers',
                roles: NOT_TREASURER,
                anchors: ['event.availability'],
                icon: 'pi pi-users',
                title: 'Chi ha risposto',
                body: 'Chi ha risposto: disponibili e non disponibili, aggiornati a ogni risposta.',
                introducedIn: 2
            },
            {
                id: 'page.event.preparation',
                roles: [...MANAGERS, ARCHIVIST, TREASURER],
                requires: [TenantFeature.EVENT_PREPARATION],
                anchors: ['event.preparation'],
                icon: 'pi pi-list-check',
                title: 'Preparazione',
                body: variant("Scegli cosa serve all'evento, come programma, materiali e preventivo, e segui nel riepilogo cosa manca.", MANAGERS, "Il riepilogo mostra cosa manca all'evento: programma, materiali, preventivo e chiusure."),
                introducedIn: 2
            },
            {
                id: 'page.event.program',
                roles: NOT_TREASURER,
                requires: [TenantFeature.EVENT_PREPARATION],
                anchors: ['event.program'],
                icon: 'pi pi-list',
                title: 'Programma',
                body: variant("La scaletta dell'evento, con i brani nell'ordine in cui si suonano.", [USER, USER_EXTERNAL], 'Collega un album o aggiungi i brani: diventano la scaletta che i musicisti vedono qui.'),
                introducedIn: 2
            },
            {
                id: 'page.event.materials',
                roles: MANAGERS,
                requires: [TenantFeature.EVENT_PREPARATION],
                anchors: ['event.materials'],
                icon: 'pi pi-box',
                title: 'Materiali',
                body: "Elenca gli oggetti dell'inventario che servono all'evento e salva: il riepilogo segnala quelli da risolvere.",
                introducedIn: 2
            },
            {
                id: 'page.event.economics',
                roles: [...MANAGERS, TREASURER],
                requires: [TenantFeature.FINANCE],
                anchors: ['event.costs', 'event.finance'],
                icon: 'pi pi-wallet',
                title: 'Costi e consuntivo',
                body: variant('Il consuntivo confronta i costi previsti con i movimenti: da qui li vedi o ne registri uno nuovo.', [TREASURER], "Prevedi i costi dell'evento; il consuntivo li confronta con i movimenti registrati in Economia."),
                points: [{ text: 'Conferma il preventivo quando la preparazione lo chiede', requires: [TenantFeature.EVENT_PREPARATION] }],
                introducedIn: 2
            },
            {
                id: 'page.event.presence',
                roles: MANAGERS,
                anchors: ['event.presence'],
                icon: 'pi pi-user-plus',
                title: 'Presenze',
                body: "Dopo l'evento segna chi c'era e premi «Salva presenze»: l'evento compare tra quelli a cui ciascuno ha partecipato.",
                points: [{ text: 'Chiudi le presenze quando la preparazione lo chiede', requires: [TenantFeature.EVENT_PREPARATION] }],
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/tracks'],
        steps: [
            {
                id: 'page.tracks.create',
                roles: CATALOG,
                anchors: ['tracks.create'],
                mobileAnchors: ['tracks.create', 'tracks.header'],
                icon: 'pi pi-upload',
                title: 'Nuova traccia',
                body: 'Crea una traccia o carica subito lo spartito in PDF: poi lo dividi in parti, una per strumento.',
                introducedIn: 2
            },
            {
                id: 'page.tracks.search',
                roles: NOT_TREASURER,
                anchors: ['tracks.toolbar'],
                icon: 'pi pi-search',
                title: 'Cerca',
                body: "Cerca un brano e passa dall'elenco alle schede con il pulsante della vista.",
                introducedIn: 2
            },
            {
                id: 'page.tracks.open',
                roles: NOT_TREASURER,
                anchors: ['tracks.list'],
                icon: 'pi pi-file',
                title: 'Apri un brano',
                body: variant("Trovi i brani pubblici: aprine uno per i dettagli, oppure usa l'anteprima per leggere e stampare le parti.", [USER_EXTERNAL], "Apri un brano per i dettagli, oppure usa l'anteprima per leggere e stampare le parti."),
                points: [{ text: 'Lo stato Pubblico lo mostra anche agli utenti esterni', roles: CATALOG }],
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/tracks/:id'],
        steps: [
            {
                id: 'page.track.preview',
                roles: NOT_TREASURER,
                anchors: ['track.preview'],
                icon: 'pi pi-eye',
                title: 'Anteprima',
                body: "L'anteprima mostra le parti a tutta pagina: scegli quali includere e stampale.",
                introducedIn: 2
            },
            {
                id: 'page.track.details',
                roles: NOT_TREASURER,
                anchors: ['track.tabDetails'],
                icon: 'pi pi-info-circle',
                title: 'Dettagli',
                body: variant('Nella scheda Dettagli trovi titolo, autori, tempo e tonalità del brano.', [USER, USER_EXTERNAL], 'Nella scheda Dettagli trovi titolo, autori, tempo, tonalità e stato: salva con «Salva traccia» in alto.'),
                introducedIn: 2
            },
            {
                id: 'page.track.parts',
                roles: NOT_TREASURER,
                anchors: ['track.tabParts'],
                icon: 'pi pi-clone',
                title: 'Parti',
                body: variant('Nella scheda Parti trovi le parti del brano e gli strumenti che le suonano.', [USER, USER_EXTERNAL], 'Nella scheda Parti ogni parte raccoglie pagine e strumenti: puoi dividerle, unirle e segnarle come verificate.'),
                points: [{ text: 'Applica gli strumenti proposti dai nomi delle parti', roles: CATALOG }],
                introducedIn: 2
            },
            {
                id: 'page.track.playback',
                roles: NOT_TREASURER,
                requires: [TenantFeature.SCORE_PLAYBACK],
                anchors: ['track.tabPlayback'],
                icon: 'pi pi-volume-up',
                title: 'Ascolto',
                body: variant('Nella scheda Ascolto senti la partitura o una sola parte mentre leggi.', [USER, USER_EXTERNAL], "Nella scheda Ascolto riconosci le note dalle pagine, ascolti le parti e correggi gli errori accanto all'originale."),
                introducedIn: 2
            },
            {
                id: 'page.track.arrangement',
                roles: CATALOG,
                requires: [TenantFeature.SCORE_PLAYBACK, TenantFeature.SCORE_WRITING],
                anchors: ['track.tabArrangement'],
                icon: 'pi pi-th-large',
                title: 'Partitura',
                body: "Nella scheda Partitura crei la partitura del brano dall'organico o dalle parti e scrivi tutti i righi insieme.",
                introducedIn: 6
            },
            {
                id: 'page.track.pdf',
                roles: CATALOG,
                anchors: ['track.tabPdf'],
                icon: 'pi pi-file-pdf',
                title: 'File PDF',
                body: 'Nella scheda File PDF carichi uno spartito e premi «Analizza PDF»: le pagine diventano parti da controllare.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/albums'],
        steps: [
            {
                id: 'page.albums.create',
                roles: CATALOG,
                anchors: ['albums.create'],
                icon: 'pi pi-book',
                title: 'Nuovo album',
                body: "Un album raccoglie i brani di un programma o di un concerto, nell'ordine in cui si suonano.",
                introducedIn: 2
            },
            {
                id: 'page.albums.open',
                roles: NOT_TREASURER,
                anchors: ['albums.toolbar'],
                icon: 'pi pi-search',
                title: 'Cerca e apri',
                body: "Cerca un album e aprilo per vedere i brani in ordine; l'anteprima mostra le parti di tutti i brani.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/albums/:id'],
        steps: [
            {
                id: 'page.album.data',
                roles: NOT_TREASURER,
                anchors: ['album.data'],
                icon: 'pi pi-book',
                title: 'Dati album',
                body: variant("Nome, data e descrizione dell'album.", [USER, USER_EXTERNAL], "Nome, data, stato e descrizione dell'album: salva con «Salva album» in alto."),
                introducedIn: 2
            },
            {
                id: 'page.album.tracks',
                roles: NOT_TREASURER,
                anchors: ['album.tracks'],
                icon: 'pi pi-list',
                title: 'Tracce',
                body: variant("I brani dell'album nell'ordine in cui si suonano: aprine uno per la tua parte.", [USER, USER_EXTERNAL], "Aggiungi tracce, trascinale per cambiare l'ordine e confermalo."),
                introducedIn: 2
            },
            {
                id: 'page.album.preview',
                roles: NOT_TREASURER,
                anchors: ['album.preview'],
                icon: 'pi pi-eye',
                title: 'Anteprima',
                body: "L'anteprima mostra in un'unica vista le parti di tutti i brani, da leggere o stampare.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/preview'],
        steps: [
            {
                id: 'page.preview.parts',
                roles: NOT_TREASURER,
                anchors: ['preview.parts', 'preview.filters'],
                icon: 'pi pi-filter',
                title: 'Parti da includere',
                body: 'Scegli le parti da includere, per esempio solo quella del tuo strumento; se il pannello è chiuso aprilo con «Filtri».',
                introducedIn: 2
            },
            {
                id: 'page.preview.pages',
                roles: NOT_TREASURER,
                anchors: ['preview.pages'],
                icon: 'pi pi-search-plus',
                title: 'Pagine e zoom',
                body: 'Scorri le pagine e ingrandisci o riduci lo spartito con i comandi in alto.',
                introducedIn: 2
            },
            {
                id: 'page.preview.print',
                roles: NOT_TREASURER,
                anchors: ['preview.print'],
                icon: 'pi pi-print',
                title: 'Stampa',
                body: 'Nelle impostazioni di stampa scegli quante pagine dello spartito mettere in ogni foglio.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/inventory'],
        requires: [TenantFeature.INVENTORY],
        steps: [
            {
                id: 'page.inventory.create',
                roles: MANAGERS,
                anchors: ['inventory.create'],
                mobileAnchors: ['inventory.create', 'inventory.header'],
                icon: 'pi pi-plus',
                title: 'Nuovo oggetto',
                body: 'Registra strumenti e materiali con numero inventariale, quantità e stato di conservazione.',
                points: [
                    { text: 'Genera le etichette con il QR', requires: [TenantFeature.INVENTORY_QR] },
                    { text: 'Prepara il modello del foglio di affidamento', requires: [TenantFeature.INVENTORY_LOAN_SHEET] }
                ],
                introducedIn: 2
            },
            {
                id: 'page.inventory.views',
                roles: MANAGERS,
                anchors: ['inventory.views'],
                icon: 'pi pi-arrow-right-arrow-left',
                title: 'Organizzazione o personale',
                body: "Passa dall'inventario dell'organizzazione al materiale affidato a te.",
                introducedIn: 2
            },
            {
                id: 'page.inventory.erasures',
                roles: MANAGERS,
                anchors: ['inventory.erasures'],
                icon: 'pi pi-user-minus',
                title: 'Cancellazioni in attesa',
                body: 'Chi ha chiesto la cancellazione dei dati deve prima riconsegnare: completa la cancellazione dopo la riconsegna.',
                introducedIn: 2
            },
            {
                id: 'page.inventory.items',
                roles: MANAGERS,
                anchors: ['inventory.items'],
                icon: 'pi pi-box',
                title: 'Oggetti',
                body: "Apri un oggetto per affidarlo, vedere consegne e fotografie; selezionane più d'uno per le azioni comuni.",
                introducedIn: 2
            },
            {
                id: 'page.inventory.scope',
                roles: NOT_TREASURER,
                anchors: ['inventory.scope'],
                icon: 'pi pi-history',
                title: 'In possesso o riconsegnato',
                body: 'Passa dal materiale che hai ora a quello già riconsegnato.',
                introducedIn: 2
            },
            {
                id: 'page.inventory.acts',
                roles: NOT_TREASURER,
                requires: [TenantFeature.INVENTORY_SIGNATURE],
                anchors: ['inventory.ownActs'],
                icon: 'pi pi-pen-to-square',
                title: 'Atti da firmare',
                body: 'Gli atti che ti chiedono una firma: aprili e conferma con il codice.',
                introducedIn: 2
            },
            {
                id: 'page.inventory.sheets',
                roles: NOT_TREASURER,
                requires: [TenantFeature.INVENTORY_LOAN_SHEET],
                anchors: ['inventory.ownSheets'],
                icon: 'pi pi-file',
                title: 'Fogli di affidamento',
                body: 'I tuoi fogli di affidamento, da scaricare quando servono.',
                introducedIn: 2
            },
            {
                id: 'page.inventory.assignments',
                roles: NOT_TREASURER,
                anchors: ['inventory.assignments'],
                icon: 'pi pi-box',
                title: 'Le tue consegne',
                body: 'Apri una consegna per prenderne visione, avviare la riconsegna o segnalare un guasto.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/inventory/assignments/:id'],
        requires: [TenantFeature.INVENTORY],
        steps: [
            {
                id: 'page.assignment.data',
                roles: NOT_TREASURER,
                anchors: ['assignment.data'],
                icon: 'pi pi-box',
                title: 'La consegna',
                body: 'Cosa ti è stato affidato, in che quantità e fino a quando.',
                introducedIn: 2
            },
            {
                id: 'page.assignment.decision',
                roles: NOT_TREASURER,
                anchors: ['assignment.decision'],
                icon: 'pi pi-check-square',
                title: 'Presa visione',
                body: 'Conferma di aver ricevuto il materiale o rifiutalo indicando il motivo.',
                points: [{ text: 'Confermi con un codice, come una firma', requires: [TenantFeature.INVENTORY_SIGNATURE] }],
                introducedIn: 2
            },
            {
                id: 'page.assignment.return',
                roles: NOT_TREASURER,
                anchors: ['assignment.return'],
                icon: 'pi pi-replay',
                title: 'Riconsegna',
                body: "Indica quantità e note e avvia la riconsegna: chi gestisce l'inventario la completa.",
                introducedIn: 2
            },
            {
                id: 'page.assignment.issues',
                roles: NOT_TREASURER,
                requires: [TenantFeature.INVENTORY_QR],
                anchors: ['assignment.reportIssue', 'assignment.issues'],
                icon: 'pi pi-exclamation-triangle',
                title: 'Guasti',
                body: "Segnala un guasto dell'oggetto: le segnalazioni aperte restano elencate in fondo alla pagina.",
                introducedIn: 2
            }
        ]
    },
    // Block B: the pages of management.
    {
        pages: ['/inventory/loan-template'],
        requires: [TenantFeature.INVENTORY, TenantFeature.INVENTORY_LOAN_SHEET],
        steps: [
            {
                id: 'page.loanTemplate.active',
                roles: MANAGERS,
                anchors: ['loanTemplate.active'],
                icon: 'pi pi-file',
                title: 'Modello in uso',
                body: "Il modello in uso: scaricalo, guardane l'anteprima o torna al predefinito.",
                introducedIn: 2
            },
            {
                id: 'page.loanTemplate.upload',
                roles: MANAGERS,
                anchors: ['loanTemplate.upload'],
                icon: 'pi pi-upload',
                title: 'Carica un modello',
                body: "Carica un modello HTML: Taurus lo controlla e lo attivi dopo aver visto l'anteprima.",
                introducedIn: 2
            },
            {
                id: 'page.loanTemplate.variables',
                roles: MANAGERS,
                anchors: ['loanTemplate.variables'],
                icon: 'pi pi-code',
                title: 'Variabili',
                body: 'Le variabili da usare nel modello, con il dato che ciascuna inserisce.',
                introducedIn: 2
            },
            {
                id: 'page.loanTemplate.rules',
                roles: MANAGERS,
                anchors: ['loanTemplate.rules'],
                icon: 'pi pi-clock',
                title: 'Durata del comodato',
                body: 'Durata minima e massima del comodato e dei rinnovi.',
                introducedIn: 2
            },
            {
                id: 'page.loanTemplate.signature',
                roles: MANAGERS,
                requires: [TenantFeature.INVENTORY_SIGNATURE],
                anchors: ['loanTemplate.signature'],
                icon: 'pi pi-pen-to-square',
                title: 'Firma elettronica',
                body: 'Controlla che la firma elettronica sia pronta per i fogli di affidamento.',
                introducedIn: 2
            },
            {
                id: 'page.loanTemplate.history',
                roles: MANAGERS,
                anchors: ['loanTemplate.history'],
                icon: 'pi pi-history',
                title: 'Storico',
                body: 'I modelli caricati in passato.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/inventory/:id', '/inventory/items/:id'],
        requires: [TenantFeature.INVENTORY],
        steps: [
            {
                id: 'page.inventoryItem.data',
                roles: MANAGERS,
                anchors: ['inventoryItem.data'],
                icon: 'pi pi-box',
                title: 'Dati oggetto',
                body: 'Numero inventariale, quantità, conservazione, valore e regime di comodato: salva con «Salva oggetto» in alto.',
                introducedIn: 2
            },
            {
                id: 'page.inventoryItem.qr',
                roles: MANAGERS,
                requires: [TenantFeature.INVENTORY_QR],
                anchors: ['inventoryItem.qr'],
                icon: 'pi pi-qrcode',
                title: 'Codice QR',
                body: "Stampa l'etichetta con il QR; se l'etichetta va persa, ruota il codice e ristampala.",
                introducedIn: 2
            },
            {
                id: 'page.inventoryItem.photos',
                roles: MANAGERS,
                anchors: ['inventoryItem.photos'],
                icon: 'pi pi-images',
                title: 'Fotografie',
                body: "Aggiungi le fotografie dell'oggetto e salvane l'ordine.",
                introducedIn: 2
            },
            {
                id: 'page.inventoryItem.assign',
                roles: MANAGERS,
                anchors: ['inventoryItem.assign'],
                icon: 'pi pi-user-plus',
                title: 'Affida',
                body: "Affida l'oggetto a un membro con quantità, accessori ed eventuale scadenza.",
                introducedIn: 2
            },
            {
                id: 'page.inventoryItem.history',
                roles: MANAGERS,
                anchors: ['inventoryItem.assignments'],
                icon: 'pi pi-history',
                title: 'Consegne e riconsegne',
                body: "Consegne e riconsegne dell'oggetto, con il foglio di affidamento quando c'è.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/inventory/scan/v1/:publicId'],
        requires: [TenantFeature.INVENTORY, TenantFeature.INVENTORY_QR],
        steps: [
            {
                id: 'page.scan.status',
                roles: NOT_TREASURER,
                anchors: ['scan.summary'],
                icon: 'pi pi-qrcode',
                title: "Stato dell'oggetto",
                body: variant("Lo stato dell'oggetto e gli avvisi: scadenze, prese visione da completare e guasti aperti.", MANAGERS, 'Le tue consegne di questo oggetto, con stato, scadenza e prese visione da completare.'),
                introducedIn: 2
            },
            {
                id: 'page.scan.actions',
                roles: NOT_TREASURER,
                anchors: ['scan.actions'],
                icon: 'pi pi-bolt',
                title: 'Azioni',
                body: variant('Le azioni che puoi fare da qui, come segnalare un guasto; «Apri scheda completa» porta al dettaglio.', MANAGERS, 'Apri la consegna per i dettagli, oppure segnala un guasto direttamente da qui.'),
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/finance'],
        requires: [TenantFeature.FINANCE],
        steps: [
            {
                id: 'page.finance.create',
                roles: [...MANAGERS, TREASURER],
                anchors: ['finance.create'],
                mobileAnchors: ['finance.create', 'finance.header'],
                icon: 'pi pi-plus-circle',
                title: 'Nuovo movimento',
                body: 'Registra un movimento o un trasferimento tra conti e allega la ricevuta.',
                introducedIn: 2
            },
            {
                id: 'page.finance.period',
                roles: [...MANAGERS, TREASURER],
                anchors: ['finance.period'],
                icon: 'pi pi-calendar',
                title: 'Periodo',
                body: 'Scegli il periodo e premi «Aggiorna»: riepilogo e saldi si ricalcolano.',
                introducedIn: 2
            },
            {
                id: 'page.finance.summary',
                roles: [...MANAGERS, TREASURER],
                anchors: ['finance.summary'],
                icon: 'pi pi-chart-line',
                title: 'Riepilogo',
                body: 'Saldi dei conti e risultato del periodo.',
                points: [{ text: 'Gli eventi aperti da chiudere economicamente', requires: [TenantFeature.CALENDAR] }],
                introducedIn: 2
            },
            {
                id: 'page.finance.movements',
                roles: [...MANAGERS, TREASURER],
                anchors: ['finance.tabMovements'],
                icon: 'pi pi-list',
                title: 'Movimenti',
                body: 'Nella scheda Movimenti filtri, esporti in CSV, XLSX o PDF e segni i movimenti riconciliati.',
                introducedIn: 2
            },
            {
                id: 'page.finance.accounts',
                roles: [...MANAGERS, TREASURER],
                anchors: ['finance.tabAccounts'],
                icon: 'pi pi-building-columns',
                title: 'Conti',
                body: "Nella scheda Conti trovi casse e conti correnti: aprine uno per l'estratto conto.",
                introducedIn: 2
            },
            {
                id: 'page.finance.categories',
                roles: [...MANAGERS, TREASURER],
                anchors: ['finance.tabCategories'],
                icon: 'pi pi-tags',
                title: 'Categorie',
                body: 'Nella scheda Categorie classifichi entrate e uscite per i rendiconti.',
                introducedIn: 2
            },
            {
                id: 'page.finance.events',
                roles: [...MANAGERS, TREASURER],
                requires: [TenantFeature.CALENDAR],
                anchors: ['finance.tabEvents'],
                icon: 'pi pi-calendar',
                title: 'Eventi',
                body: 'Nella scheda Eventi vedi per ogni evento costi previsti, incassi, spese e risultato.',
                introducedIn: 2
            },
            {
                id: 'page.finance.years',
                roles: [...MANAGERS, TREASURER],
                anchors: ['finance.tabYears'],
                icon: 'pi pi-book',
                title: 'Esercizi',
                body: "Nella scheda Esercizi trovi il riepilogo annuale, il riporto all'anno corrente e le segnalazioni da controllare.",
                introducedIn: 2
            },
            {
                id: 'page.finance.payouts',
                roles: [...MANAGERS, TREASURER],
                requires: [TenantFeature.EVENT_PAYOUTS],
                anchors: ['finance.tabPayouts'],
                icon: 'pi pi-users',
                title: 'Compensi',
                body: 'Nella scheda Compensi ripartisci il compenso di un evento fra i presenti, con fattori o pagamenti fissi, e liquidi a ogni socio le quote dovute.',
                points: [{ text: 'Prima fissa percentuale di cassa e passo in Parametri' }],
                introducedIn: 4
            }
        ]
    },
    {
        pages: ['/instruments'],
        steps: [
            {
                id: 'page.instruments.create',
                roles: CATALOG,
                anchors: ['instruments.create'],
                icon: 'pi pi-plus',
                title: 'Nuovo strumento',
                body: "Aggiungi gli strumenti dell'organizzazione: servono ad abbinare le parti degli spartiti ai musicisti.",
                introducedIn: 2
            },
            {
                id: 'page.instruments.playback',
                roles: CATALOG,
                requires: [TenantFeature.SCORE_PLAYBACK],
                anchors: ['instruments.unconfigured'],
                icon: 'pi pi-volume-up',
                title: 'Da configurare',
                body: "Mostra solo gli strumenti ancora da configurare per l'ascolto e aprili per scegliere il suono.",
                introducedIn: 2
            },
            {
                id: 'page.instruments.ensemble',
                roles: CATALOG,
                anchors: ['instruments.ensemble'],
                icon: 'pi pi-list',
                title: 'Organico',
                body: "Nella scheda Organico metti in ordine gli strumenti che suonano nella banda: l'anteprima e la stampa seguono lo stesso ordine.",
                points: [{ text: "Comincia da «Proponi l'ordine di riferimento»" }],
                introducedIn: 5
            }
        ]
    },
    {
        pages: ['/instruments/:id'],
        steps: [
            {
                id: 'page.instrument.data',
                roles: CATALOG,
                anchors: ['instrument.data'],
                icon: 'pi pi-sliders-h',
                title: 'Dati strumento',
                body: 'Nome e descrizione dello strumento: salva con «Salva strumento» in alto.',
                introducedIn: 2
            },
            {
                id: 'page.instrument.sound',
                roles: CATALOG,
                requires: [TenantFeature.SCORE_PLAYBACK],
                anchors: ['instrument.sound'],
                icon: 'pi pi-volume-up',
                title: 'Suono',
                body: "Scegli suono e trasposizione per l'ascolto: «Proponi dal nome» suggerisce un suono, «Prova» lo fa sentire.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/users'],
        steps: [
            {
                id: 'page.users.create',
                roles: MANAGERS,
                anchors: ['users.create'],
                mobileAnchors: ['users.create', 'users.header'],
                icon: 'pi pi-user-plus',
                title: 'Nuovo utente',
                body: variant(
                    "Aggiungi un membro e assegna il ruolo: riceverà un'e-mail per impostare la password. Solo l'Amministratore gestisce gli amministratori.",
                    [BOARD],
                    "Aggiungi un membro e assegna il ruolo: riceverà un'e-mail per impostare la password."
                ),
                introducedIn: 2
            },
            {
                id: 'page.users.search',
                roles: MANAGERS,
                anchors: ['users.toolbar'],
                icon: 'pi pi-search',
                title: 'Cerca',
                body: "Cerca un membro e passa dall'elenco alle schede.",
                introducedIn: 2
            },
            {
                id: 'page.users.actions',
                roles: MANAGERS,
                anchors: ['users.list'],
                icon: 'pi pi-users',
                title: 'Azioni',
                body: "Da ogni riga apri la scheda, rimandi l'e-mail di invito o elimini l'utente.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/users/:id'],
        steps: [
            {
                id: 'page.user.data',
                roles: MANAGERS,
                anchors: ['user.data'],
                icon: 'pi pi-id-card',
                title: 'Dati utente',
                body: "Dati, ruoli, stato dell'account e strumenti suonati: salva con «Salva utente» in alto.",
                points: [{ text: 'Gli strumenti abbinano il membro alle sue parti' }],
                introducedIn: 2
            },
            {
                id: 'page.user.invite',
                roles: MANAGERS,
                anchors: ['user.invite'],
                icon: 'pi pi-envelope',
                title: 'Invito',
                body: "Rimanda l'e-mail per impostare la password a chi non l'ha ricevuta o l'ha persa.",
                introducedIn: 2
            },
            {
                id: 'page.user.events',
                roles: MANAGERS,
                requires: [TenantFeature.CALENDAR],
                anchors: ['user.events'],
                icon: 'pi pi-calendar',
                title: 'Eventi',
                body: 'Gli eventi a cui il membro è stato segnato presente.',
                introducedIn: 2
            },
            {
                id: 'page.user.inventory',
                roles: MANAGERS,
                requires: [TenantFeature.INVENTORY],
                anchors: ['user.inventory'],
                icon: 'pi pi-box',
                title: 'Inventario',
                body: 'Il materiale affidato al membro.',
                points: [{ text: 'I suoi fogli di affidamento', requires: [TenantFeature.INVENTORY_LOAN_SHEET] }],
                introducedIn: 2
            },
            {
                id: 'page.user.account',
                roles: MANAGERS,
                anchors: ['user.dangerZone'],
                icon: 'pi pi-user-minus',
                title: 'Account',
                body: "Disattiva l'utente conservandone i dati, o cancellalo definitivamente con la cancellazione GDPR.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/onboarding', '/onboarding/imports/:id'],
        requires: [TenantFeature.ONBOARDING_IMPORT],
        steps: [
            {
                id: 'page.onboarding.summary',
                roles: ADMINISTRATORS,
                anchors: ['onboarding.summary'],
                icon: 'pi pi-chart-bar',
                title: 'Riepilogo',
                body: "Il riepilogo dell'organizzazione e dell'ultima importazione.",
                introducedIn: 2
            },
            {
                id: 'page.onboarding.template',
                roles: ADMINISTRATORS,
                anchors: ['onboarding.template'],
                icon: 'pi pi-download',
                title: 'Modello',
                body: 'Scarica il modello XLSX completo, o un CSV per una sola sezione, e compilalo.',
                introducedIn: 2
            },
            {
                id: 'page.onboarding.steps',
                roles: ADMINISTRATORS,
                anchors: ['onboarding.steps'],
                icon: 'pi pi-list-check',
                title: 'I passi',
                body: "Cinque passi: prepara, carica, controlla, conferma, esito. L'importazione aggiunge dati e non modifica né elimina quelli esistenti.",
                points: [{ text: 'Correggi gli errori segnalati e ricarica il file' }, { text: 'Il rapporto elenca righe ed esiti' }, { text: "Le persone importate ricevono l'e-mail per la password" }],
                introducedIn: 2
            },
            {
                id: 'page.onboarding.history',
                roles: ADMINISTRATORS,
                anchors: ['onboarding.history'],
                icon: 'pi pi-history',
                title: 'Importazioni precedenti',
                body: "Le importazioni precedenti: aprine una per rivederne l'esito.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/admin/notification-delivery'],
        steps: [
            {
                id: 'page.deliveries.filters',
                roles: ADMINISTRATORS,
                anchors: ['deliveries.toolbar'],
                icon: 'pi pi-filter',
                title: 'Filtri',
                body: 'Filtra le consegne per stato, origine, categoria o codice operazione.',
                introducedIn: 2
            },
            {
                id: 'page.deliveries.actions',
                roles: ADMINISTRATORS,
                anchors: ['deliveries.list'],
                icon: 'pi pi-refresh',
                title: 'Riprova o chiudi',
                body: 'Riprova una consegna non riuscita, oppure chiudila indicando il motivo se non serve più.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/admin/calendar-feeds'],
        requires: [TenantFeature.EXTERNAL_CALENDAR_FEED],
        steps: [
            {
                id: 'page.calendarFeeds.create',
                roles: ADMINISTRATORS,
                anchors: ['calendarFeed.create'],
                icon: 'pi pi-link',
                title: 'Nuovo feed',
                body: "Crea un feed condiviso, per esempio per il sito dell'associazione: il link si vede una volta sola, copialo subito.",
                introducedIn: 2
            },
            {
                id: 'page.calendarFeeds.list',
                roles: ADMINISTRATORS,
                anchors: ['calendarFeed.list'],
                icon: 'pi pi-list',
                title: 'Feed',
                body: 'Rigenera il link, revoca un feed o consultane la cronologia; in caso di incidente revoca anche i feed personali.',
                introducedIn: 2
            }
        ]
    },
    // Block C: the pages of the super administrator.
    {
        pages: ['/tenants'],
        steps: [
            {
                id: 'page.tenants.create',
                roles: [SUPER_ADMIN],
                anchors: ['tenants.create'],
                icon: 'pi pi-plus',
                title: 'Nuovo tenant',
                body: "Crea un tenant con i dati dell'organizzazione e le funzionalità da attivare.",
                introducedIn: 2
            },
            {
                id: 'page.tenants.list',
                roles: [SUPER_ADMIN],
                anchors: ['tenants.list'],
                icon: 'pi pi-building',
                title: 'Tenant',
                body: 'Codice, stato e scadenza di ogni tenant: aprilo per modificarlo.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/tenants/:id'],
        steps: [
            {
                id: 'page.tenant.data',
                roles: [SUPER_ADMIN],
                anchors: ['tenant.data'],
                icon: 'pi pi-building',
                title: 'Dati tenant',
                body: 'Anagrafica, numero massimo di utenti, scadenza, fuso orario e dominio del tenant.',
                introducedIn: 2
            },
            {
                id: 'page.tenant.configure',
                roles: [SUPER_ADMIN],
                anchors: ['tenant.configureData'],
                icon: 'pi pi-upload',
                title: 'Configura dati',
                body: 'Configura dati apre la Configurazione iniziale del tenant per importare i dati.',
                introducedIn: 2
            },
            {
                id: 'page.tenant.features',
                roles: [SUPER_ADMIN],
                anchors: ['tenant.features'],
                icon: 'pi pi-sliders-v',
                title: 'Funzionalità',
                body: "Accendi o spegni le funzionalità: quelle che dipendono da un'altra restano inefficaci finché quella è spenta.",
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/legal-documents'],
        steps: [
            {
                id: 'page.legalDocuments.create',
                roles: [SUPER_ADMIN],
                anchors: ['legalDocuments.create'],
                icon: 'pi pi-plus',
                title: 'Nuova versione',
                body: "Scrivi una nuova versione dei termini o dell'informativa: resta una bozza finché non la pubblichi, poi gli utenti la confermano al prossimo ingresso.",
                introducedIn: 2
            },
            {
                id: 'page.legalDocuments.versions',
                roles: [SUPER_ADMIN],
                anchors: ['legalDocuments.notice'],
                icon: 'pi pi-lock',
                title: 'Versioni immutabili',
                body: 'Dalla pubblicazione una versione non si modifica più. Per cambiare un testo crea una nuova versione a partire da quella in vigore.',
                introducedIn: 2
            }
        ]
    },
    {
        pages: ['/legal-documents/new', '/legal-documents/:id'],
        steps: [
            {
                id: 'page.legalDocument.text',
                roles: [SUPER_ADMIN],
                anchors: ['legalDocument.text'],
                icon: 'pi pi-file-edit',
                title: 'Testo e anteprima',
                body: "Scrivi il testo in Markdown: l'anteprima accanto lo mostra come lo vedranno gli utenti, nella pagina pubblica e in quella di accettazione.",
                introducedIn: 3
            },
            {
                id: 'page.legalDocument.publish',
                roles: [SUPER_ADMIN],
                anchors: ['legalDocument.publish'],
                icon: 'pi pi-send',
                title: 'Pubblicazione',
                body: 'Pubblica mette in vigore la versione al posto della precedente: da quel momento non si modifica più. Una versione in vigore si ritira, una ritirata si riattiva.',
                introducedIn: 3
            },
            {
                id: 'page.legalDocument.newVersion',
                roles: [SUPER_ADMIN],
                anchors: ['legalDocument.newVersion', 'legalDocument.publish'],
                icon: 'pi pi-copy',
                title: 'Nuova versione',
                body: 'Da una versione pubblicata, «Nuova versione da questa» apre una bozza con tipo, titolo e testo già compilati: cambia il testo e indica la nuova versione.',
                introducedIn: 3
            }
        ]
    }
];

/**
 * The guide of a path: segment by segment, a `:name` segment matches any value. Paths are tried in catalog order and
 * the literal ones come first, so `/inventory/loan-template` wins over `/inventory/:id`.
 */
export function matchGuidedTourPage(path: string): GuidedTourPageDefinition | undefined {
    const segments = segmentsOf(path);
    const matches = (pattern: string) => {
        const expected = segmentsOf(pattern);
        return expected.length === segments.length && expected.every((segment, index) => segment.startsWith(':') || segment === segments[index]);
    };
    const literal = GUIDED_TOUR_PAGES.find((page) => page.pages.some((pattern) => !pattern.includes(':') && matches(pattern)));
    return literal ?? GUIDED_TOUR_PAGES.find((page) => page.pages.some(matches));
}

/** The steps of the page for the role and the features: the guide later keeps those the page shows. */
export function composePageGuide(page: GuidedTourPageDefinition, role: RoleEnums, isEnabled: (feature: TenantFeature) => boolean): GuidedTourStep[] {
    if (!(page.requires ?? []).every(isEnabled)) return [];
    return composeSteps(page.steps, role, isEnabled);
}

function segmentsOf(path: string): string[] {
    return path.split(/[?#]/)[0].split('/').filter(Boolean);
}
