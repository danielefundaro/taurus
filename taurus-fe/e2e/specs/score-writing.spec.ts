import { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { environmentMissing, expect, signIn, test } from '../fixtures/session';

/**
 * La scrittura della musica con un browser vero, su desktop e tablet: una parte nuova scritta da
 * tastiera o con il pianoforte a schermo, salvata e approvata; la bozza ripresa dopo la chiusura
 * dell'editor; la sola lettura di chi apre la parte mentre un altro la scrive.
 *
 * Le prove lavorano sulla traccia indicata in `E2E_SCORE_WRITING_TRACK_ID`, del primo tenant con
 * l'ascolto e la scrittura attivi, e si saltano senza. Ogni prova crea una parte `e2e-scrittura-…` e alla
 * fine la rimuove dalla traccia con «Salva traccia»: la parte è eliminata in modo logico, quindi la
 * base dati conserva lei e le sue versioni. Sotto 768 pixel la prova si salta, perché la scrittura è
 * pensata per schermi da tablet in su; la tastiera MIDI vera resta nelle verifiche a mano del
 * runbook, perché nessun browser automatico ne ha una.
 */
test.describe('scrittura della musica', () => {
    test.skip(environmentMissing(), 'Servono due tenant di prova: vedi e2e/README.md');

    const trackId = process.env['E2E_SCORE_WRITING_TRACK_ID'];
    test.skip(!trackId, 'Serve una traccia con ascolto e scrittura attivi in E2E_SCORE_WRITING_TRACK_ID');

    /** Parti create dalla prova in corso, da togliere dalla traccia alla fine. */
    let created: string[] = [];

    test.beforeEach(({ page }) => {
        created = [];
        test.skip((page.viewportSize()?.width ?? 0) < 768, 'La scrittura si prova su desktop e tablet');
    });

    test.afterEach(async ({ page }) => {
        if (created.length) await removeParts(page, trackId!, created);
    });

    test('una parte nuova si scrive, si salva e si approva', async ({ page, environment }) => {
        const [first] = environment;
        test.skip(!first.users.archivist, 'Serve un archivista del primo tenant');

        await signIn(page, first.users.archivist!, 'archivist');
        const name = await createPart(page, trackId!, (part) => created.push(part));

        await writeFourNotes(page);
        await expect(insertionStatus(page)).toContainText('Battuta 2');
        await expect(notes(page)).toHaveCount(4);

        // L'ultima nota si annulla e si ripristina: con i tasti sul desktop, con i pulsanti sul tablet.
        if (touch()) await press(page.getByRole('button', { name: /annulla l'ultima modifica/i }));
        else await page.keyboard.press('ControlOrMeta+z');
        await expect(notes(page)).toHaveCount(3);
        if (touch()) await press(page.getByRole('button', { name: /ripristina la modifica annullata/i }));
        else await page.keyboard.press('ControlOrMeta+y');
        await expect(notes(page)).toHaveCount(4);

        await page.getByRole('button', { name: /salva e approva/i }).click();
        await expect(editorHeading(page)).toHaveCount(0);
        const row = partRow(page, name);
        await expect(row.getByText('Approvata')).toBeVisible();
        await expect(row.getByText(/versione 1 · \d+ battute/)).toBeVisible();
    });

    test('chiuso l’editor, la bozza si riprende con le note scritte', async ({ page, environment }) => {
        const [first] = environment;
        test.skip(!first.users.archivist, 'Serve un archivista del primo tenant');

        await signIn(page, first.users.archivist!, 'archivist');
        const name = await createPart(page, trackId!, (part) => created.push(part));
        await writeFourNotes(page);
        await draftSaved(page);

        // Chiudendo, la bozza salvata resta sul server: la parte la propone al posto di «Scrivi».
        await page.getByRole('button', { name: /torna alla traccia/i }).click();
        await expect(editorHeading(page)).toHaveCount(0);
        const row = partRow(page, name);
        await row.getByRole('button', { name: /riprendi la bozza/i }).click();

        await expect(editorHeading(page)).toBeVisible();
        await expect(page.getByText(draftState).first()).toBeVisible();
        await expect(notes(page)).toHaveCount(4);

        // Chiudere libera il blocco prima che la prova rimuova la parte.
        await page.getByRole('button', { name: /torna alla traccia/i }).click();
        await expect(editorHeading(page)).toHaveCount(0);
    });

    test('chi apre la parte mentre un altro la scrive la legge soltanto', async ({ page, browser, environment }) => {
        const [first] = environment;
        test.skip(!first.users.archivist || !first.users.admin, 'Servono un archivista e un amministratore del primo tenant');

        await signIn(page, first.users.archivist!, 'archivist');
        const name = await createPart(page, trackId!, (part) => created.push(part));
        await writeFourNotes(page);
        await draftSaved(page);

        const context = await freshContext(browser);
        try {
            const other = await context.newPage();
            await signIn(other, first.users.admin!, 'admin');
            await openPlayback(other, trackId!);
            await partRow(other, name)
                .getByRole('button', { name: /riprendi la bozza/i })
                .click();

            // Il blocco è di chi scrive: l'altro vede la bozza, ma non può scrivere né salvare.
            await expect(editorHeading(other)).toBeVisible();
            await expect(other.getByText('Sola lettura', { exact: true })).toBeVisible();
            await expect(other.getByRole('button', { name: /prendi il controllo/i })).toBeVisible();
            await expect(other.getByText(/la bozza è di chi sta scrivendo/i)).toBeVisible();
            await expect(notes(other)).toHaveCount(4);
            await expect(other.getByRole('button', { name: /^\W*salva$/i })).toBeDisabled();
            await expect(other.getByRole('button', { name: /modalità di inserimento/i })).toBeDisabled();
        } finally {
            await context.close();
        }

        // Chi scrive non si accorge di nulla e continua a tenere il blocco.
        await expect(page.getByText('Sola lettura', { exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: /torna alla traccia/i }).click();
        await expect(editorHeading(page)).toHaveCount(0);
    });
});

/** Una scheda senza sessione, con le opzioni del profilo in uso. */
const freshContext = (browser: Browser): Promise<BrowserContext> => {
    const { baseURL, locale, timezoneId, ignoreHTTPSErrors, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } = test.info().project.use;
    return browser.newContext({ baseURL, locale, timezoneId, ignoreHTTPSErrors, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
};

const touch = (): boolean => !!test.info().project.use.hasTouch;

/** Clic con il mouse sul desktop, tocco sul tablet. */
const press = (target: Locator): Promise<void> => (touch() ? target.tap() : target.click());

const openPlayback = async (page: Page, trackId: string): Promise<void> => {
    await page.goto(`/tracks/${trackId}?tab=playback`);
    await expect(page.getByRole('button', { name: /ascolta la partitura/i })).toBeVisible();
};

/** Riga della parte nella scheda Ascolto. */
const partRow = (page: Page, name: string): Locator => page.locator('.rounded-lg.border').filter({ has: page.locator('strong', { hasText: name }) });

const editorHeading = (page: Page): Locator => page.getByRole('heading', { level: 2, name: /^scrittura · /i });

/** Note disegnate da Verovio nella pagina dello spartito: pause e battute vuote non contano. */
const notes = (page: Page): Locator => page.locator('.score-editor__notation svg g.note');

const insertionStatus = (page: Page): Locator => page.getByRole('status').filter({ hasText: /^\W*inserimento · /i });

/**
 * Crea in fondo alla traccia una parte in 4/4, con chiave, armatura e battute proposte dal dialogo, e aspetta l'editor di
 * scrittura pronto. La parte nasce con la sua prima bozza, che l'editor apre da solo.
 */
const createPart = async (page: Page, trackId: string, remember: (name: string) => void): Promise<string> => {
    const name = `e2e-scrittura-${test.info().project.name}-${Date.now()}`;
    await openPlayback(page, trackId);
    await page.getByRole('button', { name: /nuova parte scritta/i }).click();
    await page.getByLabel('Nome della parte').fill(name);
    await page.getByRole('button', { name: /crea e scrivi/i }).click();
    remember(name);

    await expect(page.getByRole('heading', { level: 2, name: `Scrittura · ${name}` })).toBeVisible();
    await expect(page.getByText(draftState).first()).toBeVisible();
    await expect(page.locator('.score-editor__notation svg').first()).toBeVisible();
    return name;
};

/** Stato della bozza quando non ci sono modifiche in attesa. */
const draftState = /bozza salvata alle|le modifiche si salvano da sole come bozza/i;

/** Aspetta che la bozza contenga le ultime modifiche: l'editor la salva tre secondi dopo l'ultima. */
const draftSaved = async (page: Page): Promise<void> => {
    await expect(page.getByText(/modifiche in attesa di essere salvate|salvataggio della bozza/i)).toHaveCount(0);
    await expect(page.getByText(/bozza salvata alle/i)).toBeVisible();
};

/**
 * Quattro semiminime in modalità di inserimento: sul desktop con N e le lettere, sul tablet con il
 * pulsante della modalità e i tasti del pianoforte a schermo, che lì si apre da solo.
 */
const writeFourNotes = async (page: Page): Promise<void> => {
    if (!touch()) {
        await page.keyboard.press('n');
        await expect(insertionStatus(page)).toContainText('Battuta 1');
        for (const key of ['c', 'd', 'e', 'f']) await page.keyboard.press(key);
        await expect(notes(page)).toHaveCount(4);
        return;
    }
    await press(page.getByRole('button', { name: /modalità di inserimento/i }));
    await expect(insertionStatus(page)).toContainText('Battuta 1');
    const piano = page.getByRole('group', { name: 'Pianoforte a schermo' });
    if (!(await piano.isVisible())) await press(page.getByRole('button', { name: 'Pianoforte a schermo' }));
    for (const key of ['Do4', 'Re4', 'Mi4', 'Fa4']) await press(piano.getByRole('button', { name: key, exact: true }));
    await expect(notes(page)).toHaveCount(4);
};

/** Toglie dalla traccia le parti create dalla prova, dal workspace delle parti. */
const removeParts = async (page: Page, trackId: string, names: string[]): Promise<void> => {
    await page.goto(`/tracks/${trackId}?tab=parts`);
    const list = page.getByRole('listbox', { name: /parti della traccia/i });
    await expect(list).toBeVisible();
    for (const name of names) {
        const option = list.getByRole('option', { name: new RegExp(`^${name},`) });
        if (!(await option.count())) continue;
        await option.click();
        await page.getByRole('button', { name: /elimina parte/i }).click();
        await page
            .getByRole('alertdialog')
            .filter({ hasText: name })
            .getByRole('button', { name: /rimuovi/i })
            .click();
    }
    const save = page.getByRole('button', { name: /salva traccia/i });
    if (!(await save.isEnabled())) return;
    await save.click();
    await expect(page.getByText(/tutte le modifiche salvate/i)).toBeVisible();
};
