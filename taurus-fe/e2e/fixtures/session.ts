import { expect, Page, test as base } from '@playwright/test';

/**
 * I ruoli coperti dalla suite. Ogni ruolo è un utente diverso dell'ambiente di prova, con le
 * credenziali lette dall'ambiente: nel repository non vive nessuna credenziale.
 */
export type Role = 'superAdmin' | 'admin' | 'board' | 'archivist' | 'user' | 'external' | 'treasurer';

/** Un tenant dell'ambiente di prova: la suite ne usa due per verificare che non si vedano fra loro. */
export interface Tenant {
    code: string;
    users: Partial<Record<Role, Credentials>>;
}

export interface Credentials {
    username: string;
    password: string;
    /** Codice del tenant della prova: lo sceglie chi, come un super amministratore, è iscritto a più tenant. */
    tenant?: string;
}

/** I valori dei ruoli nella scelta di Keycloak. */
const KEYCLOAK_ROLES: Record<Role, string> = {
    superAdmin: 'ROLE_SUPER_ADMIN',
    admin: 'ROLE_ADMIN',
    board: 'ROLE_BOARD',
    archivist: 'ROLE_ARCHIVIST',
    user: 'ROLE_USER',
    external: 'ROLE_USER_EXTERNAL',
    treasurer: 'ROLE_TREASURER'
};

const credentials = (tenant: string, role: Role): Credentials | undefined => {
    const prefix = `E2E_${tenant.toUpperCase()}_${role.toUpperCase()}`;
    const username = process.env[`${prefix}_USERNAME`];
    const password = process.env[`${prefix}_PASSWORD`];

    return username && password ? { username, password } : undefined;
};

/** I due tenant della suite, descritti dalle variabili d'ambiente. */
export const tenants = (): Tenant[] =>
    ['first', 'second']
        .map((slot) => ({ slot, code: process.env[`E2E_${slot.toUpperCase()}_TENANT`] }))
        .filter((entry): entry is { slot: string; code: string } => !!entry.code)
        .map(({ slot, code }) => ({
            code,
            users: Object.fromEntries(
                (['superAdmin', 'admin', 'board', 'archivist', 'user', 'external', 'treasurer'] as Role[])
                    .map((role) => [role, credentials(slot, role)])
                    .filter(([, value]) => !!value)
                    .map(([role, value]) => [role, { ...value, tenant: code }])
            )
        }));

/** Il menu principale dell'applicazione: le prove ne leggono le voci, che dipendono dal ruolo. */
export const mainMenu = (page: Page) => page.getByRole('navigation', { name: /menu principale/i });

/** Le funzionalità del tenant lette dall'applicazione, per pagina. */
const featuresByPage = new WeakMap<Page, Record<string, unknown>>();
const trackedPages = new WeakSet<Page>();

/**
 * Registra le funzionalità del tenant che l'applicazione legge all'avvio. Va chiamata prima dell'accesso:
 * `signIn` e `enterCredentials` lo fanno da sé.
 */
export const trackFeatures = (page: Page): void => {
    if (trackedPages.has(page)) return;
    trackedPages.add(page);
    page.on('response', async (response) => {
        if (!response.ok() || !new URL(response.url()).pathname.endsWith('/api/tenant-features/current')) return;
        try {
            featuresByPage.set(page, (await response.json()) as Record<string, unknown>);
        } catch {
            // La pagina si è chiusa prima di leggere la risposta.
        }
    });
};

/**
 * Vero se la funzionalità è attiva nel tenant dell'utente entrato, per esempio `inventoryQrEnabled`. Con la
 * funzionalità spenta la guardia del router riporta alla dashboard senza chiamare il server: la prova va saltata,
 * perché la risposta che aspetterebbe non arriva.
 */
export const featureEnabled = async (page: Page, flag: `${string}Enabled`): Promise<boolean> => {
    await expect.poll(() => featuresByPage.has(page), { message: "Funzionalità del tenant non lette dall'applicazione" }).toBe(true);
    return featuresByPage.get(page)?.[flag] === true;
};

/**
 * Compila la pagina di accesso di Keycloak e, quando l'utente ha più ruoli nel tenant, sceglie il
 * ruolo. Non aspetta l'applicazione: serve anche a chi deve fermarsi prima del menu, per esempio
 * sulla pagina di accettazione dei documenti legali.
 */
export const enterCredentials = async (page: Page, user: Credentials, role?: Role): Promise<void> => {
    trackFeatures(page);
    await page.goto('/');

    const username = page.getByLabel(/username|nome utente|utente/i).first();
    await expect(username).toBeVisible();
    await username.fill(user.username);
    await page
        .getByLabel(/password/i)
        .first()
        .fill(user.password);
    await page.getByRole('button', { name: /sign in|accedi|entra/i }).click();
    await chooseTenant(page, user, role);

    // La scelta del ruolo compare soltanto per gli utenti che ne hanno più di uno nel tenant.
    const roleChoice = page.getByRole('button', { name: roleLabel(role) });
    if (role && (await roleChoice.count()) > 0) await roleChoice.first().click();
};

/**
 * Entra nell'applicazione con un utente dell'ambiente di prova. Il percorso attraversa la pagina
 * di accesso di Keycloak e, quando l'utente ha più ruoli nel tenant, la scelta del ruolo.
 */
export const signIn = async (page: Page, user: Credentials, role?: Role): Promise<void> => {
    await enterCredentials(page, user, role);

    // Il landmark del menu: l'host <app-topbar> non ha un box proprio, perché la barra è a posizione fissa.
    await expect(mainMenu(page)).toBeVisible();

    // La navigazione iniziale del router finisce dopo il menu: un clic anticipato verrebbe annullato.
    await page.waitForLoadState('networkidle');
};

/**
 * Chi è iscritto a più tenant, come un super amministratore, sceglie in Keycloak il tenant della prova e, se lì ha più
 * ruoli, il ruolo; chi ne ha uno solo passa oltre.
 */
const chooseTenant = async (page: Page, user: Credentials, role?: Role): Promise<void> => {
    await page.waitForLoadState('domcontentloaded');
    const tenantChoice = page.getByRole('combobox', { name: /seleziona il tenant/i });
    if (!user.tenant || !(await tenantChoice.count())) return;
    await tenantChoice.selectOption(user.tenant);
    const roleChoice = page.getByRole('combobox', { name: /seleziona il ruolo/i });
    if (role && (await roleChoice.isVisible())) await roleChoice.selectOption(KEYCLOAK_ROLES[role]);
    await page.getByRole('button', { name: /invia/i }).click();
};

/** Vero quando il menu laterale sta fuori dallo schermo e va aperto prima di usarlo. */
const narrow = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 992;

/**
 * Entra in una sezione dal menu principale. Su schermo stretto il menu va aperto, e la maschera
 * che lo accompagna intercetta ogni clic finché la navigazione non lo richiude.
 */
export const openNavigation = async (page: Page): Promise<void> => {
    if (!narrow(page)) return;
    // Se il menu è già aperto, la sua maschera copre la topbar e un altro clic lo richiuderebbe.
    if (await page.locator('.layout-wrapper.layout-mobile-active').count()) return;
    await page.getByRole('button', { name: /apri menu/i }).click();
};

export const goToSection = async (page: Page, name: RegExp): Promise<void> => {
    await openNavigation(page);
    await mainMenu(page).getByRole('link', { name }).click();
    if (narrow(page)) await expect(page.locator('.layout-mask')).toBeHidden();
};

/**
 * Verifica che la pagina non scorra in orizzontale. La misura si ripete perché il layout anima il
 * margine del contenitore principale per 0,2 secondi dopo un cambio di viewport: letta subito, la
 * pagina sembra sporgere di quanto resta all'animazione.
 */
export const expectNoHorizontalOverflow = async (page: Page, width: number): Promise<void> => {
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
            message: `Scorrimento orizzontale a ${width} pixel`
        })
        .toBeLessThanOrEqual(0);
};

export const signOut = async (page: Page): Promise<void> => {
    // Fuori dalla modalità di primo accesso l'uscita sta nel profilo, non nella topbar.
    const actions = page.getByRole('button', { name: /apri azioni utente/i });
    if (await actions.isVisible()) await actions.click();
    await page.getByRole('button', { name: /^profilo$/i }).click();
    await page.waitForURL('**/profile');
    // Nome non ancorato: l'icona dei pulsanti PrimeNG è contenuto generato e finisce nel nome accessibile.
    await page.getByRole('button', { name: /logout/i }).click();

    // L'uscita chiede conferma in un dialogo prima di chiudere la sessione.
    await page.getByRole('alertdialog').getByRole('button', { name: /esci/i }).click();

    // L'uscita passa da Keycloak: la sessione è chiusa quando torna la pagina di accesso.
    await expect(page.getByLabel(/username|nome utente|utente/i).first()).toBeVisible();
};

const roleLabel = (role?: Role): RegExp => {
    switch (role) {
        case 'superAdmin':
            return /super ?amministratore/i;
        case 'admin':
            return /amministratore/i;
        case 'board':
            return /direttivo/i;
        case 'archivist':
            return /archivista/i;
        case 'treasurer':
            return /tesoriere/i;
        case 'external':
            return /esterno/i;
        default:
            return /utente/i;
    }
};

/** I tenant configurati, a disposizione delle prove. */
export const test = base.extend<{ environment: Tenant[] }>({
    environment: async ({}, use) => {
        await use(tenants());
    }
});

/** Vero quando l'ambiente non è configurato: la suite si salta invece di fallire. */
export const environmentMissing = (): boolean => tenants().length < 2;

export { expect };
