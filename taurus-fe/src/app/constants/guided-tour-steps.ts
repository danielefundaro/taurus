import { GuidedTourStep, GuidedTourStepDefinition, TenantFeature } from '../module';
import { composeSteps } from './guided-tour-compose';
import { RoleEnums } from './role.enums';

// Kept out of `constants/index.ts`: the catalog belongs to the deferred chunk of the guided tour, not to the
// initial bundle. Texts and paths follow docs/guided-tour-spec.md.

/**
 * Raised when a step is added or changes meaning: it is saved with the progress of each role. 2: the page guides; 3: the
 * legal document detail; 4: the payouts tab of the finance page; 5: the ensemble tab of the instruments page; 6: the
 * score tab of the track detail.
 */
export const GUIDED_TOUR_CATALOG_REVISION = 6;

/** No path may exceed it, welcome included. */
export const GUIDED_TOUR_MAX_STEPS = 10;

export const GUIDED_TOUR_WELCOME = 'common.welcome';

const ALL_ROLES = [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL];

export const GUIDED_TOUR_ROLE_ICONS: Partial<Record<RoleEnums, string>> = {
    [RoleEnums.SUPER_ADMIN]: 'pi pi-shield',
    [RoleEnums.ADMIN]: 'pi pi-cog',
    [RoleEnums.BOARD]: 'pi pi-briefcase',
    [RoleEnums.TREASURER]: 'pi pi-wallet',
    [RoleEnums.ARCHIVIST]: 'pi pi-book',
    [RoleEnums.USER]: 'pi pi-user',
    [RoleEnums.USER_EXTERNAL]: 'pi pi-user'
};

/** Every step in one order: the path of a role keeps the steps that apply to it, in this order. */
export const GUIDED_TOUR_STEPS: readonly GuidedTourStepDefinition[] = [
    {
        id: GUIDED_TOUR_WELCOME,
        roles: ALL_ROLES,
        icon: 'pi pi-sparkles',
        title: 'Benvenuto in Taurus',
        body: 'In circa due minuti ti mostriamo cosa puoi fare.',
        introducedIn: 1
    },
    {
        id: 'common.navigation',
        roles: ALL_ROLES,
        anchors: ['layout.menu', 'layout.menuButton'],
        icon: 'pi pi-bars',
        title: 'Il menu',
        body: 'Dal menu raggiungi le sezioni del tuo ruolo: vedi solo ciò che puoi usare.',
        introducedIn: 1
    },
    {
        id: 'superAdmin.tenants',
        roles: [RoleEnums.SUPER_ADMIN],
        route: '/tenants',
        anchors: ['tenants.header'],
        icon: 'pi pi-building',
        title: 'I tenant',
        body: 'Crea e gestisci i tenant e scegli quali funzionalità attivare per ciascuno.',
        introducedIn: 1
    },
    {
        id: 'superAdmin.legalDocuments',
        roles: [RoleEnums.SUPER_ADMIN],
        route: '/legal-documents',
        anchors: ['legalDocuments.header'],
        icon: 'pi pi-file-check',
        title: 'Documenti legali',
        body: "Pubblica privacy e condizioni d'uso: gli utenti le accettano al primo ingresso e a ogni nuova versione.",
        introducedIn: 1
    },
    {
        id: 'admin.users',
        roles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD],
        route: '/users',
        anchors: ['users.create', 'users.header'],
        mobileAnchors: ['users.header'],
        icon: 'pi pi-users',
        title: 'Utenti e ruoli',
        body: {
            default: "Aggiungi i membri dell'organizzazione e assegna il ruolo: riceveranno un'e-mail per impostare la password.",
            [RoleEnums.BOARD]: "Aggiungi i membri dell'organizzazione e assegna il ruolo: riceveranno un'e-mail per impostare la password. Solo l'Amministratore gestisce gli amministratori."
        },
        introducedIn: 1
    },
    {
        id: 'admin.calendar',
        roles: [RoleEnums.ADMIN, RoleEnums.BOARD],
        requires: [TenantFeature.CALENDAR],
        route: '/calendar',
        anchors: ['calendar.create', 'calendar.header'],
        mobileAnchors: ['calendar.header'],
        icon: 'pi pi-calendar-plus',
        title: 'Calendario ed eventi',
        body: 'Crea prove e concerti, anche ricorrenti, e segui chi ha risposto.',
        points: [{ text: 'Controlla materiali, programma e costi nella preparazione', requires: [TenantFeature.EVENT_PREPARATION] }, { text: "Conferma le presenze dopo l'evento" }],
        introducedIn: 1
    },
    {
        id: 'admin.inventory',
        roles: [RoleEnums.ADMIN, RoleEnums.BOARD],
        requires: [TenantFeature.INVENTORY],
        route: '/inventory',
        anchors: ['inventory.create', 'inventory.header'],
        mobileAnchors: ['inventory.header'],
        icon: 'pi pi-box',
        title: 'Inventario',
        body: 'Registra strumenti e materiali, affidali ai membri e segui riconsegne e scadenze.',
        points: [
            { text: 'Stampa le etichette con il QR', requires: [TenantFeature.INVENTORY_QR] },
            { text: 'Prepara il modello del foglio di affidamento', requires: [TenantFeature.INVENTORY_LOAN_SHEET] }
        ],
        introducedIn: 1
    },
    {
        id: 'calendar.availability',
        roles: [RoleEnums.USER, RoleEnums.USER_EXTERNAL],
        requires: [TenantFeature.CALENDAR],
        route: '/calendar',
        anchors: ['calendar.header'],
        icon: 'pi pi-calendar',
        title: 'Eventi e disponibilità',
        body: {
            default: 'Nel calendario trovi concerti e prove. Apri un evento e indica se ci sarai: chi organizza vede subito la risposta.',
            [RoleEnums.USER_EXTERNAL]: 'Nel calendario trovi gli eventi pubblici a cui puoi partecipare. Apri un evento e indica se ci sarai: chi organizza vede subito la risposta.'
        },
        points: [{ text: 'Nel dettaglio trovi luogo, orario e scaletta' }, { text: "Riceverai un promemoria prima dell'inizio", requires: [TenantFeature.WEB_PUSH_REMINDERS] }],
        introducedIn: 1
    },
    {
        id: 'catalog.tracks',
        roles: [RoleEnums.USER, RoleEnums.USER_EXTERNAL],
        route: '/tracks',
        anchors: ['tracks.header'],
        icon: 'pi pi-file',
        title: 'Tracce e album',
        body: {
            default: 'In Tracce trovi il repertorio con gli spartiti dei tuoi strumenti; in Album i brani sono raccolti per programma.',
            [RoleEnums.USER_EXTERNAL]: 'In Tracce trovi i brani pubblici con gli spartiti dei tuoi strumenti; in Album i brani sono raccolti per programma.'
        },
        points: [{ text: 'Ascolta le parti mentre leggi', requires: [TenantFeature.SCORE_PLAYBACK] }],
        introducedIn: 1
    },
    {
        id: 'catalog.manage',
        roles: [RoleEnums.ARCHIVIST],
        route: '/tracks',
        anchors: ['tracks.create', 'tracks.header'],
        mobileAnchors: ['tracks.header'],
        icon: 'pi pi-upload',
        title: 'Album e tracce',
        body: 'Crea album e tracce e carica gli spartiti in PDF, associando ogni parte al suo strumento.',
        introducedIn: 1
    },
    {
        id: 'catalog.instruments',
        roles: [RoleEnums.ARCHIVIST],
        route: '/instruments',
        anchors: ['instruments.header'],
        icon: 'pi pi-sliders-h',
        title: 'Strumenti',
        body: "L'elenco degli strumenti dell'organizzazione serve ad abbinare parti e musicisti.",
        introducedIn: 1
    },
    {
        id: 'calendar.program',
        roles: [RoleEnums.ARCHIVIST],
        requires: [TenantFeature.CALENDAR],
        route: '/calendar',
        anchors: ['calendar.header'],
        icon: 'pi pi-list',
        title: 'Programma degli eventi',
        body: 'Apri un evento e collega un album: le sue tracce diventano la scaletta. Puoi indicare anche la tua disponibilità.',
        points: [{ text: 'Nel riepilogo vedi cosa manca a programma e spartiti', requires: [TenantFeature.EVENT_PREPARATION] }],
        introducedIn: 1
    },
    {
        id: 'inventory.mine',
        roles: [RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL],
        requires: [TenantFeature.INVENTORY],
        route: '/inventory',
        anchors: ['inventory.header'],
        icon: 'pi pi-box',
        title: 'Il tuo inventario',
        body: 'Qui trovi strumenti e materiali che ti sono stati affidati: prendine visione o avvia la riconsegna.',
        points: [
            { text: 'Scarica i fogli di affidamento', requires: [TenantFeature.INVENTORY_LOAN_SHEET] },
            { text: 'Firma gli atti quando ti viene chiesto', requires: [TenantFeature.INVENTORY_SIGNATURE] },
            { text: "Inquadra il QR dell'oggetto per segnalare un guasto", requires: [TenantFeature.INVENTORY_QR] }
        ],
        introducedIn: 1
    },
    {
        id: 'finance.overview',
        roles: [RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER],
        requires: [TenantFeature.FINANCE],
        route: '/finance',
        // The summary appears with the data: waiting for it beats falling back to the header at once.
        anchors: ['finance.summary'],
        mobileAnchors: ['finance.header'],
        icon: 'pi pi-wallet',
        title: 'Economia',
        body: {
            default: "In Economia trovi conti, saldi e movimenti dell'organizzazione.",
            [RoleEnums.ADMIN]: "In Economia trovi conti, saldi e movimenti dell'organizzazione e prepari preventivi e consuntivi degli eventi.",
            [RoleEnums.BOARD]: "In Economia trovi conti, saldi e movimenti dell'organizzazione e prepari preventivi e consuntivi degli eventi."
        },
        introducedIn: 1
    },
    {
        id: 'finance.movements',
        roles: [RoleEnums.TREASURER],
        requires: [TenantFeature.FINANCE],
        route: '/finance',
        anchors: ['finance.create', 'finance.header'],
        mobileAnchors: ['finance.header'],
        icon: 'pi pi-plus-circle',
        title: 'Movimenti',
        body: 'Registra entrate, uscite e trasferimenti, allega le ricevute e segna i movimenti riconciliati.',
        introducedIn: 1
    },
    {
        id: 'finance.events',
        roles: [RoleEnums.TREASURER],
        requires: [TenantFeature.FINANCE, TenantFeature.CALENDAR],
        icon: 'pi pi-calendar',
        title: 'Economia degli eventi',
        body: "Le notifiche economiche ti portano al dettaglio dell'evento, dove gestisci preventivo e consuntivo.",
        introducedIn: 1
    },
    {
        id: 'admin.tools',
        roles: [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN],
        anchors: ['layout.menu.admin', 'layout.menuButton'],
        icon: 'pi pi-cog',
        title: 'Strumenti di amministrazione',
        body: 'Nel menu trovi anche gli strumenti di amministrazione.',
        points: [
            { text: 'Configurazione iniziale: importa dati da un file', requires: [TenantFeature.ONBOARDING_IMPORT] },
            { text: 'Consegne notifiche: controlla quelle non arrivate' },
            { text: 'Feed calendario: pubblica il calendario', requires: [TenantFeature.EXTERNAL_CALENDAR_FEED] }
        ],
        introducedIn: 1
    },
    {
        id: 'common.notifications',
        roles: ALL_ROLES,
        route: '/',
        anchors: ['dashboard.notifications'],
        icon: 'pi pi-bell',
        title: 'Le notifiche',
        body: 'Qui arrivano le notifiche: aprile per andare al dettaglio o segnale come lette.',
        points: [
            { text: 'Rimandale con le azioni di posticipo' },
            { text: 'Scegli cosa ricevere dal profilo', requires: [TenantFeature.NOTIFICATION_PREFERENCES] },
            { text: 'Attiva le notifiche su questo dispositivo', requires: [TenantFeature.NOTIFICATION_PREFERENCES] }
        ],
        introducedIn: 1
    },
    {
        id: 'common.profile',
        roles: ALL_ROLES,
        anchors: ['topbar.profile', 'topbar.more'],
        icon: 'pi pi-user',
        title: 'Il tuo profilo',
        body: 'Nel profilo aggiorni i tuoi dati, la password e la verifica in due passaggi.',
        points: [{ text: 'Collega Taurus al calendario del telefono', requires: [TenantFeature.EXTERNAL_CALENDAR_FEED], roles: [RoleEnums.USER, RoleEnums.USER_EXTERNAL] }],
        introducedIn: 1
    },
    {
        id: 'common.help',
        roles: ALL_ROLES,
        anchors: ['topbar.help'],
        icon: 'pi pi-question-circle',
        title: 'Quando ti serve',
        body: 'Riapri la guida quando vuoi da qui; in ogni pagina trovi anche la guida di quella pagina. Se preferisci che non parta da sola, disattivala dal profilo.',
        introducedIn: 1
    }
];

/** The path of the role with the features of the tenant: evaluated once, when the tour opens. Sections off are left out. */
export function composeGuidedTour(role: RoleEnums, isEnabled: (feature: TenantFeature) => boolean): GuidedTourStep[] {
    return composeSteps(GUIDED_TOUR_STEPS, role, isEnabled);
}
