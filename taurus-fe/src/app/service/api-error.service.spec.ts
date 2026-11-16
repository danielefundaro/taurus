import { HTTP_INTERCEPTORS, HttpClient, HttpContext, HttpErrorResponse, HttpRequest, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { API_ERROR_MESSAGES, apiErrorMessage, loanDurationIssueMessage } from '../constants';
import { HttpInterceptorService } from '../interceptor/http-interceptor.service';
import { ApiErrorBody, TenantFeature, TenantFeatures } from '../module';
import { withErrorSummary, withHandledErrors } from './api-error-context';
import { ApiErrorService } from './api-error.service';
import { KeycloakService } from './keycloak.service';
import { TenantFeatureService } from './tenant-feature.service';
import { TenantStatusService } from './tenant-status.service';
import { ToastService } from './toast.service';

/** The reason phrase sent by the backend: it must never reach the user. */
const TITLE = 'Unprocessable Entity';

const response = (status: number, body: ApiErrorBody | null): HttpErrorResponse => new HttpErrorResponse({ status, statusText: TITLE, error: body === null ? null : { type: 'about:blank', title: TITLE, ...body } });
const request = (context: HttpContext = new HttpContext()): HttpRequest<unknown> => new HttpRequest('POST', '/api/test', null, { context });

describe('ApiErrorService', () => {
    let service: ApiErrorService;

    beforeEach(() => {
        service = TestBed.inject(ApiErrorService);
    });

    it('reports an unreachable server as a missing connection', () => {
        const resolved = service.resolve(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }), request(withErrorSummary('Assegnazione non riuscita')));

        expect(resolved.key).toBe('http.0');
        expect(resolved.summary).toBe('Connessione non disponibile');
        expect(resolved.detail).toBe('Il server non è raggiungibile: verificare la connessione e riprovare');
    });

    it('builds the message from the parameters and shows ISO dates as dd/MM/yyyy', () => {
        const resolved = service.resolve(
            response(422, {
                message: 'error.inventory.loanDuration.expirationOutOfRange',
                args: { minimum: '2026-11-10', maximum: '2027-11-10', minMonths: 1, maxMonths: 12, deliveredOn: '2026-10-10' },
                errorId: 'K7Q2M9XD4TPA'
            })
        );

        expect(resolved.key).toBe('inventory.loanDuration.expirationOutOfRange');
        expect(resolved.summary).toBe('Operazione non riuscita');
        expect(resolved.detail).toBe('La data di scadenza deve essere compresa tra il 10/11/2026 e il 10/11/2027, cioè tra 1 e 12 mesi dalla consegna del 10/10/2026');
        expect(resolved.errorId).toBe('K7Q2M9XD4TPA');
    });

    it('shows the generic text with the error code for a key missing from the catalog', () => {
        const warn = spyOn(console, 'warn');

        const resolved = service.resolve(response(409, { message: 'error.inventory.somethingNew', errorId: '3HF8W0QZ1CNE' }));

        expect(resolved.summary).toBe('Richiesta non riuscita');
        expect(resolved.detail).toBe("Non è stato possibile completare l'operazione. Codice errore: 3HF8W0QZ1CNE");
        expect(warn).toHaveBeenCalledWith(jasmine.stringContaining('inventory.somethingNew'));
    });

    it('adds the error code to server errors, with or without a catalog key', () => {
        const generationFailed = service.resolve(response(500, { message: 'error.finance.report.generationFailed', errorId: 'AAAABBBBCCCC' }), request(withErrorSummary('Rendiconto non generato')));
        const keycloak = service.resolve(response(502, { message: 'error.keycloak.user.createFailed', errorId: 'DDDDEEEEFFFF' }));
        const unexpected = service.resolve(response(500, { message: 'error.http.500', errorId: 'GGGGHHHHIIII' }));

        expect(generationFailed.summary).toBe('Rendiconto non generato');
        expect(generationFailed.detail).toBe('Impossibile generare il rendiconto: riprovare. Codice errore: AAAABBBBCCCC');
        expect(keycloak.detail).toBe("Impossibile creare l'utente nel servizio di accesso. Codice errore: DDDDEEEEFFFF");
        expect(unexpected.summary).toBe('Servizio temporaneamente non disponibile');
        expect(unexpected.detail).toBe('Si è verificato un problema sul server: riprovare tra qualche minuto. Codice errore: GGGGHHHHIIII');
    });

    it('keeps the error code out of the detail of a 4xx catalog error', () => {
        const resolved = service.resolve(response(409, { message: 'error.inventory.return.closed', errorId: 'JJJJKKKKLLLL' }));

        expect(resolved.detail).toBe('La procedura di riconsegna è già chiusa');
        expect(resolved.errorId).toBe('JJJJKKKKLLLL');
    });

    it('titles a concurrent modification «Dati modificati» and a rule conflict with the declared title', () => {
        const context = withErrorSummary('Assegnazione non riuscita');

        const concurrency = service.resolve(response(409, { message: 'error.version.conflict' }), request(context));
        const family = service.resolve(response(409, { message: 'error.inventory.issue.versionConflict' }), request(context));
        const dataLayer = service.resolve(response(409, { message: 'error.concurrencyFailure' }));
        const rule = service.resolve(response(409, { message: 'error.inventory.quantity.unavailable', args: { available: 2 } }), request(context));

        expect(concurrency.summary).toBe('Dati modificati');
        expect(concurrency.behavior).toBe('versionConflict');
        expect(family.summary).toBe('Dati modificati');
        expect(dataLayer.summary).toBe('Dati modificati');
        expect(rule.summary).toBe('Assegnazione non riuscita');
        expect(rule.detail).toBe('Quantità disponibile insufficiente: disponibili 2');
        expect(rule.behavior).toBeUndefined();
    });

    it('uses the title declared with ERROR_SUMMARY, «Operazione non riuscita» or «Elemento non trovato» otherwise', () => {
        expect(service.resolve(response(400, { message: 'error.finance.transfer.sameAccount' }), request(withErrorSummary('Trasferimento non salvato'))).summary).toBe('Trasferimento non salvato');
        expect(service.resolve(response(400, { message: 'error.finance.transfer.sameAccount' })).summary).toBe('Operazione non riuscita');
        expect(service.resolve(response(404, { message: 'error.finance.account.notFound' })).summary).toBe('Elemento non trovato');
        expect(service.resolve(response(404, { message: 'error.http.404' })).detail).toBe("L'elemento richiesto non esiste più o non è accessibile");
    });

    it('marks the keys declared in HANDLED_ERRORS, also through a prefix pattern', () => {
        const context = withHandledErrors(['inventory.loanDuration.*', 'inventory.loanSheet.expirationOutOfRange']);

        expect(service.resolve(response(422, { message: 'error.inventory.loanDuration.missingExpiration' }), request(context)).handled).toBeTrue();
        expect(service.resolve(response(422, { message: 'error.inventory.loanSheet.expirationOutOfRange', args: { sheetNumber: '2026/001' } }), request(context)).handled).toBeTrue();
        expect(service.resolve(response(409, { message: 'error.inventory.loanSheet.expirationLocked' }), request(context)).handled).toBeFalse();
    });

    it('returns the text of a handled key for the field, and nothing for other keys', () => {
        const keys = ['inventory.loanDuration.*', 'inventory.loanSheet.missingExpiration'];

        expect(service.handledMessage(response(422, { message: 'error.inventory.loanSheet.missingExpiration', args: { sheetNumber: '2026/004' } }), keys)).toBe(
            'La data di scadenza è obbligatoria per gli strumenti in comodato con scadenza (regole del foglio n. 2026/004)'
        );
        expect(service.handledMessage(response(409, { message: 'error.inventory.quantity.unavailable', args: { available: 1 } }), keys)).toBeUndefined();
    });

    it('never shows the title of the response', () => {
        const bodies: ApiErrorBody[] = [{ message: 'error.inventory.return.closed' }, { message: 'error.unknown.key' }, {}, { message: 'error.http.400' }];
        spyOn(console, 'warn');

        for (const body of bodies) {
            const resolved = service.resolve(response(422, body));
            expect(resolved.summary).not.toContain(TITLE);
            expect(resolved.detail).not.toContain(TITLE);
        }
        const textBody = service.resolve(new HttpErrorResponse({ status: 400, error: JSON.stringify({ title: 'Secret', message: 'error.validation' }) }));
        expect(textBody.detail).toBe('Alcuni dati non sono validi: controllare i campi evidenziati');
    });

    it('treats a 401 without a body as an expired session', () => {
        const resolved = service.resolve(response(401, null));

        expect(resolved.key).toBe('auth.unauthenticated');
        expect(resolved.behavior).toBe('renewSession');
    });

    it('lists the goods blocking the issue of a loan sheet', () => {
        const detail = service.resolve(
            response(422, {
                message: 'error.inventory.loanSheet.validation',
                args: {
                    issues: [
                        { assignmentId: 3, itemName: 'Clarinetto', inventoryNumber: 'INV-3', code: 'missingExpiration', args: {} },
                        { assignmentId: 4, itemName: 'Tromba', inventoryNumber: 'INV-4', code: 'expirationOutOfRange', args: { minimum: '2027-01-31', maximum: '2028-01-31', minMonths: 12, maxMonths: 24, deliveredOn: '2026-01-31' } }
                    ]
                }
            })
        ).detail;

        expect(detail).toBe(
            'Emissione non possibile: Clarinetto (INV-3): La data di scadenza è obbligatoria per gli strumenti in comodato con scadenza; ' +
                'Tromba (INV-4): La data di scadenza deve essere compresa tra il 31/01/2027 e il 31/01/2028, cioè tra 12 e 24 mesi dalla consegna del 31/01/2026'
        );
    });

    it('lists the blocking outcomes of the template with their lines and the declared title', () => {
        const resolved = service.resolve(
            response(422, {
                message: 'error.inventory.loanTemplate.invalid',
                args: {
                    issues: [
                        { code: 'syntax.unclosed', line: 4, args: { name: 'beni' } },
                        { code: 'unknownVariable', line: 9, args: { name: 'nome', list: 'beni' } },
                        { code: 'tooLargePdf', args: { maxMegabytes: 5 } }
                    ]
                }
            }),
            request(withErrorSummary('Anteprima non disponibile'))
        );

        expect(resolved.summary).toBe('Anteprima non disponibile');
        expect(resolved.detail).toBe('Riga 4: La sezione «beni» non è chiusa; ' + "Riga 9: Variabile sconosciuta «nome»: è un campo dell'elenco «beni» e va usato dentro la sua sezione; " + 'Il PDF generato con i dati di esempio supera 5 MB');
    });

    it('explains inconsistent duration rules and the allowed QR code sizes', () => {
        expect(service.resolve(response(422, { message: 'error.inventory.loanSettings.invalid', args: { problems: ['minAboveMax', 'renewalAboveTotal'] } })).detail).toBe(
            "Regole di durata incoerenti: la durata minima non può superare la durata massima; l'estensione di un rinnovo non può superare la durata complessiva massima"
        );
        expect(service.resolve(response(400, { message: 'error.inventory.qr.size.invalid', args: { sizes: [256, 512, 1024] } })).detail).toBe('La dimensione del QR code deve essere di 256, 512 o 1024 pixel');
    });

    it('explains the problems of a score and of an extraction', () => {
        expect(apiErrorMessage('scoreWriting.contentInvalid', { reason: 'tooManyRows', maxRows: 60 })).toBe('La partitura non può avere più di 60 righi');
        expect(apiErrorMessage('scoreWriting.contentInvalid', { reason: 'unevenMeasures', row: 'P2' })).toBe('Tutti i righi della partitura devono avere lo stesso numero di battute');
        expect(apiErrorMessage('scoreWriting.extractionInvalid', { reason: 'duplicateTarget' })).toBe('Due righi non possono andare nella stessa parte');
        expect(apiErrorMessage('scoreWriting.extractionInvalid', { reason: 'other' })).toBe('Estrazione non valida: riaprire il dialogo');
        expect(apiErrorMessage('scoreWriting.instrumentNotConfigured', { instrument: 'Clarinetto 1°' })).toBe('Clarinetto 1° non ha la trasposizione: configurarla per estrarne la parte');
    });

    it('builds the sheet rule messages from the duration messages', () => {
        const args = { minimum: '2027-01-31', maximum: '2028-01-31', minMonths: 12, maxMonths: 24, deliveredOn: '2026-01-31', sheetNumber: '2026/002' };

        for (const code of ['missingLoanType', 'precariousExpiration', 'missingExpiration', 'expirationOutOfRange']) {
            expect(apiErrorMessage(`inventory.loanSheet.${code}`, args)).toBe(`${apiErrorMessage(`inventory.loanDuration.${code}`, args)} (regole del foglio n. 2026/002)`);
        }
    });

    it('translates the issues returned as data by the template check and the sheet proposal', () => {
        expect(service.loanTemplateIssueMessage({ code: 'syntax.emptyTag', args: {} })).toBe('Tag vuoto «{{}}»');
        expect(service.loanTemplateIssueMessage({ code: 'syntax.mismatchedClose', args: { name: 'beni', openName: 'durata', openLine: 3 } })).toBe('La sezione «durata» aperta alla riga 3 è chiusa con «{{/beni}}»');
        expect(service.loanTemplateIssueMessage({ code: 'unescaped', args: { name: 'socio.nome' } })).toBe("L'inserimento senza escape non è ammesso: usare {{socio.nome}}");
        expect(service.loanTemplateIssueMessage({ code: 'unknownVariable', args: { name: 'x' } })).toBe('Variabile sconosciuta «x»');
        expect(service.loanTemplateIssueMessage({ code: 'renderFailed', args: {} })).toBe('Il PDF non può essere generato con i dati di esempio');
        expect(service.loanSheetIssueMessage({ code: 'precariousExpiration', args: {} })).toBe('Un bene in comodato precario non può avere una data di scadenza');
        expect(loanDurationIssueMessage({ code: 'missingLoanType' })).toBe("L'oggetto non ha il regime di comodato: indicarlo nella scheda dell'oggetto");
    });

    it('explains the fields rejected by validation', () => {
        const resolved = service.resolve(response(400, { message: 'error.validation', fieldErrors: [{ field: 'accessories', code: 'Size', args: { max: 500 } }] }));

        expect(resolved.detail).toBe('Alcuni dati non sono validi: controllare i campi evidenziati');
        expect(service.fieldErrorMessage(resolved.fieldErrors[0])).toBe('La lunghezza massima è 500');
        expect(service.fieldErrorMessage({ field: 'name', code: 'NotBlank' })).toBe('Campo obbligatorio');
        expect(service.fieldErrorMessage({ field: 'name', code: 'Unknown' })).toBe('Valore non valido');
    });

    it('reads a JSON error body received as a Blob', async () => {
        const blob = new Blob([JSON.stringify({ title: TITLE, status: 410, message: 'error.inventory.loanSheet.purged', errorId: 'MMMMNNNNOOOO' })], { type: 'application/problem+json' });

        const readable = await firstValueFrom(service.readBody(new HttpErrorResponse({ status: 410, error: blob })));

        expect(service.resolve(readable).detail).toBe('I dati personali del foglio sono stati rimossi: il PDF non è più disponibile');
    });

    it('writes every catalog message without a final period', () => {
        const fixed = Object.entries(API_ERROR_MESSAGES).filter(([, message]) => typeof message === 'string');

        expect(fixed.length).toBeGreaterThan(250);
        expect(fixed.filter(([, message]) => (message as string).trim().endsWith('.')).map(([key]) => key)).toEqual([]);
    });
});

describe('HttpInterceptorService error handling', () => {
    const url = '/api/test';
    let http: HttpClient;
    let controller: HttpTestingController;
    let toast: jasmine.SpyObj<ToastService>;
    let router: jasmine.SpyObj<Router>;
    let keycloak: { isUserLoggedIn: boolean; token: string; refreshToken: jasmine.Spy; logout: jasmine.Spy };
    let tenantStatus: jasmine.SpyObj<TenantStatusService>;
    let tenantFeatures: jasmine.SpyObj<TenantFeatureService>;

    beforeEach(() => {
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn']);
        router = jasmine.createSpyObj<Router>('Router', ['navigate']);
        router.navigate.and.resolveTo(true);
        // La pagina aperta durante questi test è quella dedicata all'Inventario: l'albero delle route la dichiara.
        (router as unknown as { routerState: unknown }).routerState = {
            snapshot: { root: { data: {}, children: [{ data: { feature: TenantFeature.INVENTORY }, children: [] }] } }
        };
        keycloak = { isUserLoggedIn: true, token: 'access-token', refreshToken: jasmine.createSpy('refreshToken').and.returnValue('renewed-token'), logout: jasmine.createSpy('logout').and.resolveTo() };
        tenantStatus = jasmine.createSpyObj<TenantStatusService>('TenantStatusService', ['invalidate']);
        tenantFeatures = jasmine.createSpyObj<TenantFeatureService>('TenantFeatureService', ['refresh']);
        tenantFeatures.refresh.and.returnValue(of({} as TenantFeatures));

        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr(), withInterceptorsFromDi()),
                provideHttpClientTesting(),
                { provide: HTTP_INTERCEPTORS, useClass: HttpInterceptorService, multi: true },
                { provide: ToastService, useValue: toast },
                { provide: Router, useValue: router },
                { provide: KeycloakService, useValue: keycloak },
                { provide: TenantStatusService, useValue: tenantStatus },
                { provide: TenantFeatureService, useValue: tenantFeatures }
            ]
        });
        http = TestBed.inject(HttpClient);
        controller = TestBed.inject(HttpTestingController);
    });

    afterEach(() => controller.verify());

    /** Sends a request and settles with its error, once the interceptor has handled it. */
    function send(method: 'GET' | 'POST' | 'PUT', context?: HttpContext): { done: Promise<HttpErrorResponse | unknown> } {
        let resolveDone: (value: HttpErrorResponse | unknown) => void = () => undefined;
        const done = new Promise<HttpErrorResponse | unknown>((resolve) => (resolveDone = resolve));
        http.request(method, url, { context, body: method === 'GET' ? undefined : {} }).subscribe({ next: resolveDone, error: resolveDone });
        return { done };
    }

    function fail(status: number, body: ApiErrorBody | null): void {
        controller.expectOne(url).flush(body === null ? null : { type: 'about:blank', title: TITLE, status, ...body }, { status, statusText: TITLE });
    }

    it('renews the session on auth.unauthenticated and repeats the request without a toast', async () => {
        const { done } = send('GET');
        fail(401, { message: 'error.auth.unauthenticated' });

        const retry = controller.expectOne(url);
        expect(retry.request.headers.get('Authorization')).toBe('Bearer renewed-token');
        retry.flush({ ok: true });

        expect(await done).toEqual({ ok: true });
        expect(toast.error).not.toHaveBeenCalled();
        expect(keycloak.logout).not.toHaveBeenCalled();
    });

    it('ends the session when the renewed request is still unauthenticated', async () => {
        const { done } = send('GET');
        fail(401, { message: 'error.auth.unauthenticated' });
        fail(401, { message: 'error.auth.unauthenticated' });

        await done;
        expect(toast.error).toHaveBeenCalledOnceWith('Operazione non riuscita', 'Sessione scaduta: accedere di nuovo');
        expect(keycloak.logout).toHaveBeenCalled();
    });

    it('ends the session on auth.identity.missing without renewing the token', async () => {
        const { done } = send('GET');
        fail(401, { message: 'error.auth.identity.missing' });

        const error = (await done) as HttpErrorResponse;
        expect(error.status).toBe(401);
        expect(toast.error).toHaveBeenCalledOnceWith('Operazione non riuscita', 'Sessione non valida: accedere di nuovo');
        expect(keycloak.logout).toHaveBeenCalled();
        expect(keycloak.refreshToken).not.toHaveBeenCalled();
    });

    it('opens the forbidden page on auth.forbidden', async () => {
        const { done } = send('GET');
        fail(403, { message: 'error.auth.forbidden' });

        await done;
        expect(toast.error).toHaveBeenCalledOnceWith('Operazione non riuscita', 'Non si hanno i permessi necessari per questa operazione');
        expect(router.navigate).toHaveBeenCalledOnceWith(['forbidden']);
    });

    it('shows any other 403 in a toast without leaving the page', async () => {
        const { done } = send('POST', withErrorSummary('Salvataggio non riuscito'));
        fail(403, { message: 'error.auth.tenant.missing' });

        await done;
        expect(toast.error).toHaveBeenCalledOnceWith('Salvataggio non riuscito', "L'utente non è associato a un tenant attivo");
        expect(router.navigate).not.toHaveBeenCalled();
        expect(keycloak.logout).not.toHaveBeenCalled();
    });

    it('reloads the tenant features and leaves the page dedicated to the disabled feature', async () => {
        const { done } = send('GET');
        fail(403, { message: 'error.tenantFeature.inventory.disabled' });

        await done;
        expect(toast.error).toHaveBeenCalledOnceWith('Operazione non riuscita', 'La funzionalità Inventario non è disponibile per questo tenant');
        expect(tenantFeatures.refresh).toHaveBeenCalledWith(true);
        expect(router.navigate).toHaveBeenCalledOnceWith(['/']);
    });

    it('leads to the initial setup without a toast when the tenant is not provisioned', async () => {
        const { done } = send('GET');
        fail(409, { message: 'error.tenant.notProvisioned' });

        await done;
        expect(toast.error).not.toHaveBeenCalled();
        expect(tenantStatus.invalidate).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledOnceWith(['/']);
    });

    it('opens the notfound page for id.notFound on a GET and shows a toast on a save', async () => {
        const read = send('GET');
        fail(404, { message: 'error.id.notFound' });
        await read.done;
        expect(router.navigate).toHaveBeenCalledOnceWith(['notfound']);
        expect(toast.error).not.toHaveBeenCalled();

        const save = send('PUT');
        fail(404, { message: 'error.id.notFound' });
        await save.done;
        expect(toast.error).toHaveBeenCalledOnceWith('Elemento non trovato', "L'elemento richiesto non esiste più o non è accessibile");
        expect(router.navigate).toHaveBeenCalledTimes(1);
    });

    it('titles a concurrency conflict «Dati modificati» and a rule conflict with the declared title', async () => {
        const concurrency = send('PUT', withErrorSummary('Salvataggio non riuscito'));
        fail(409, { message: 'error.preferences.versionConflict' });
        await concurrency.done;
        expect(toast.error).toHaveBeenCalledWith('Dati modificati', "Le preferenze sono state modificate da un'altra richiesta: ricaricare la pagina");

        const rule = send('POST', withErrorSummary('Assegnazione non riuscita'));
        fail(409, { message: 'error.inventory.quantity.unavailable', args: { available: 3 } });
        await rule.done;
        expect(toast.error).toHaveBeenCalledWith('Assegnazione non riuscita', 'Quantità disponibile insufficiente: disponibili 3');
    });

    it('shows no toast for a key in HANDLED_ERRORS and still hands the error to the caller', async () => {
        const { done } = send('POST', withHandledErrors(['inventory.loanDuration.*'], withErrorSummary('Assegnazione non riuscita')));
        fail(422, { message: 'error.inventory.loanDuration.missingExpiration' });

        const error = (await done) as HttpErrorResponse;
        expect(error.status).toBe(422);
        expect(TestBed.inject(ApiErrorService).message(error)).toBe('La data di scadenza è obbligatoria per gli strumenti in comodato con scadenza');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('never puts the title of the response in the toast', async () => {
        spyOn(console, 'warn');
        const { done } = send('POST');
        fail(422, { message: 'error.inventory.notInTheCatalog', errorId: 'PPPPQQQQRRRR' });

        await done;
        const [summary, detail] = toast.error.calls.mostRecent().args;
        expect(summary).not.toContain(TITLE);
        expect(detail).not.toContain(TITLE);
        expect(detail).toContain('Codice errore: PPPPQQQQRRRR');
    });

    it('reads the key of an error returned to a blob request', async () => {
        let failure: unknown;
        const finished = new Promise<void>((resolve) =>
            http.get(url, { responseType: 'blob', context: withErrorSummary('Anteprima non disponibile') }).subscribe({
                error: (error) => {
                    failure = error;
                    resolve();
                }
            })
        );
        const body = { type: 'about:blank', title: TITLE, status: 422, message: 'error.inventory.loanTemplate.invalid', args: { issues: [{ code: 'delimiters', line: 2, args: {} }] } };
        controller.expectOne(url).flush(new Blob([JSON.stringify(body)], { type: 'application/problem+json' }), { status: 422, statusText: TITLE });

        await finished;
        expect(toast.error).toHaveBeenCalledOnceWith('Anteprima non disponibile', 'Riga 2: Il cambio dei delimitatori non è ammesso');
        expect((failure as HttpErrorResponse).error.message).toBe('error.inventory.loanTemplate.invalid');
    });

    it('reports a missing connection', async () => {
        const { done } = send('GET');
        controller.expectOne(url).error(new ProgressEvent('error'), { status: 0 });

        await done;
        expect(toast.error).toHaveBeenCalledOnceWith('Connessione non disponibile', 'Il server non è raggiungibile: verificare la connessione e riprovare');
    });
});
