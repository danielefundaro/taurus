import AxeBuilder from '@axe-core/playwright';
import { Page, Response } from '@playwright/test';
import { environmentMissing, expect, expectNoHorizontalOverflow, featureEnabled, signIn, test, trackFeatures } from '../fixtures/session';

interface ScanResult {
    target: 'ADMIN_ITEM' | 'OWN_ASSIGNMENTS';
    name?: string;
    allowedActions: string[];
    assignments: Array<{ assignmentId: number; allowedActions: string[] }>;
}

/** Le azioni amministrative e il pulsante che ciascuna mostra nella scheda di scansione. */
const ADMIN_BUTTONS: Record<string, RegExp> = {
    ASSIGN: /^assegna$/i,
    RETURN: /gestisci riconsegna/i,
    ADD_ITEM_PHOTO: /aggiungi fotografia/i,
    REPORT_ISSUE: /segnala guasto/i,
    PRINT_LABEL: /stampa etichetta/i,
    ROTATE_CODE: /ruota codice/i
};

/** Un codice ben formato che nessun oggetto possiede: deve dare lo stesso esito di un codice ruotato o di un altro tenant. */
const UNKNOWN_CODE = '00000000-0000-4000-8000-000000000000';
const code = process.env['E2E_INVENTORY_QR_CODE'];
const otherTenantCode = process.env['E2E_SECOND_INVENTORY_QR_CODE'];

const scanResponse = (page: Page): Promise<Response> => page.waitForResponse((response) => new URL(response.url()).pathname.startsWith('/api/inventory-scan/v1/'));

/** La scansione richiede l'inventario e i QR attivi nel tenant: altrimenti la guardia del router riporta alla dashboard. */
const scanAvailable = async (page: Page): Promise<boolean> => (await featureEnabled(page, 'inventoryEnabled')) && (await featureEnabled(page, 'inventoryQrEnabled'));
const SCAN_OFF = 'Il tenant di prova non ha inventario e QR attivi';

/**
 * La scansione dei QR inventario: deep link autenticato, stesso stato «non disponibile» per ogni codice non visibile,
 * azioni guidate da `allowedActions` e pagina utilizzabile su smartphone. La rotazione non è provata qui perché
 * invaliderebbe le etichette stampate dell'ambiente: resta nelle verifiche fisiche della specifica.
 */
test.describe('scansione QR inventario', () => {
    test.skip(environmentMissing(), 'Servono due tenant di prova: vedi e2e/README.md');

    test('senza sessione il deep link passa dal login e poi torna alla scansione', async ({ page, environment }) => {
        const [first] = environment;
        test.skip(!first.users.user, 'Serve un utente del primo tenant');

        trackFeatures(page);
        await page.goto(`/inventory/scan/v1/${UNKNOWN_CODE}`);
        const username = page.getByLabel(/username|nome utente|utente/i).first();
        await expect(username).toBeVisible();
        await expect(page.getByText(/codice non disponibile/i)).toHaveCount(0);
        await username.fill(first.users.user!.username);
        await page
            .getByLabel(/password/i)
            .first()
            .fill(first.users.user!.password);
        await page.getByRole('button', { name: /sign in|accedi|entra/i }).click();
        test.skip(!(await scanAvailable(page)), SCAN_OFF);

        await expect(page).toHaveURL(new RegExp(`/inventory/scan/v1/${UNKNOWN_CODE}`));
        await expect(page.getByRole('heading', { level: 1, name: 'Codice non disponibile' })).toBeFocused();
    });

    for (const role of ['admin', 'user'] as const) {
        test(`un codice sconosciuto o di un altro tenant non rivela nulla al profilo ${role}`, async ({ page, environment }) => {
            const [first] = environment;
            test.skip(!first.users[role], `Serve un utente ${role} del primo tenant`);
            await signIn(page, first.users[role]!, role);
            test.skip(!(await scanAvailable(page)), SCAN_OFF);

            for (const value of [UNKNOWN_CODE, otherTenantCode].filter((entry): entry is string => !!entry)) {
                const response = scanResponse(page);
                await page.goto(`/inventory/scan/v1/${value}`);
                expect((await response).status()).toBe(404);
                await expect(page.getByRole('heading', { level: 1, name: 'Codice non disponibile' })).toBeVisible();
                await expect(page.getByRole('button', { name: /apri scheda completa|apri consegna/i })).toHaveCount(0);
            }
        });
    }

    test('un amministratore vede la scheda dell’oggetto con le sole azioni ammesse', async ({ page, environment }) => {
        const [first] = environment;
        test.skip(!first.users.admin || !code, 'Servono un amministratore e E2E_INVENTORY_QR_CODE');
        await signIn(page, first.users.admin!, 'admin');
        test.skip(!(await scanAvailable(page)), SCAN_OFF);

        const response = scanResponse(page);
        await page.goto(`/inventory/scan/v1/${code}`);
        const received = await response;
        expect(received.headers()['cache-control'] ?? '').toContain('no-store');
        const result = (await received.json()) as ScanResult;
        expect(result.target).toBe('ADMIN_ITEM');

        await expect(page.getByRole('heading', { level: 1, name: result.name })).toBeFocused();
        for (const [action, label] of Object.entries(ADMIN_BUTTONS)) {
            const button = page.getByRole('button', { name: label }).or(page.getByText(label));
            if (result.allowedActions.includes(action)) await expect(button.first()).toBeVisible();
            else await expect(button).toHaveCount(0);
        }

        const assign = page.getByRole('button', { name: ADMIN_BUTTONS['ASSIGN'] });
        if ((await assign.count()) > 0) {
            await assign.click();
            await expect(page).toHaveURL(/\/inventory\/items\/\d+#assegna$/);
            await expect(page.locator('#assegna')).toBeFocused();
        }
    });

    test('un socio raggiunge la propria consegna o l’elenco delle consegne', async ({ page, environment }) => {
        const [first] = environment;
        test.skip(!first.users.user || !code, 'Servono un utente e E2E_INVENTORY_QR_CODE');
        await signIn(page, first.users.user!, 'user');
        test.skip(!(await scanAvailable(page)), SCAN_OFF);

        const response = scanResponse(page);
        await page.goto(`/inventory/scan/v1/${code}`);
        const received = await response;
        test.skip(received.status() === 404, 'L’utente di prova non ha consegne dell’oggetto');
        const result = (await received.json()) as ScanResult;

        if (result.assignments.length === 1) {
            await expect(page).toHaveURL(new RegExp(`/inventory/assignments/${result.assignments[0].assignmentId}$`));
        } else {
            await expect(page.getByRole('heading', { level: 1, name: 'Le tue consegne' })).toBeVisible();
            await expect(page.getByRole('button', { name: /apri consegna/i })).toHaveCount(result.assignments.length);
        }
    });

    test('la scheda di scansione è accessibile e non scorre in orizzontale a 320 pixel', async ({ page, environment }) => {
        const [first] = environment;
        test.skip(!first.users.admin || !code, 'Servono un amministratore e E2E_INVENTORY_QR_CODE');
        await page.setViewportSize({ width: 320, height: 720 });
        await signIn(page, first.users.admin!, 'admin');
        test.skip(!(await scanAvailable(page)), SCAN_OFF);

        await page.goto(`/inventory/scan/v1/${code}`);
        await expect(page.getByRole('button', { name: /apri scheda completa/i })).toBeVisible();

        await expectNoHorizontalOverflow(page, 320);
        for (const button of await page.locator('app-inventory-scan .scan-actions .p-button').all()) {
            expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
        const audit = await new AxeBuilder({ page }).include('app-inventory-scan').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(audit.violations).toEqual([]);
    });
});
