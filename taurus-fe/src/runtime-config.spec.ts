import { environment } from './environments/environment';
import { loadRuntimeConfig, LOCAL_CONFIG_URL } from './runtime-config';

describe('loadRuntimeConfig', () => {
    const compiled = {
        production: environment.production,
        baseUrl: environment.baseUrl,
        vapidPublicKey: environment.vapidPublicKey,
        primeuiLicense: environment.primeuiLicense,
        keycloak: { ...environment.keycloak }
    };

    const serve = (body: unknown, ok = true, status = 200) => spyOn(window, 'fetch').and.resolveTo({ ok, status, json: () => Promise.resolve(body) } as Response);

    /** Risposte diverse per `config.json` e per il file locale; `undefined` è un file che manca. */
    const serveFiles = (served: unknown, local?: unknown) =>
        spyOn(window, 'fetch').and.callFake((url: RequestInfo | URL) => {
            const body = String(url) === LOCAL_CONFIG_URL ? local : served;
            return Promise.resolve({ ok: body !== undefined, status: body === undefined ? 404 : 200, json: () => Promise.resolve(body) } as Response);
        });

    afterEach(() => {
        environment.production = compiled.production;
        environment.baseUrl = compiled.baseUrl;
        environment.vapidPublicKey = compiled.vapidPublicKey;
        environment.primeuiLicense = compiled.primeuiLicense;
        environment.keycloak.baseurl = compiled.keycloak.baseurl;
        environment.keycloak.realm = compiled.keycloak.realm;
        environment.keycloak.clientId = compiled.keycloak.clientId;
    });

    it('applies the served values to the environment', async () => {
        serve({
            baseUrl: 'https://taurus.example.org/api',
            vapidPublicKey: 'chiave-servita',
            primeuiLicense: 'licenza-servita',
            keycloak: { baseurl: 'https://auth.example.org', realm: 'banda', clientId: 'web_app' }
        });

        await loadRuntimeConfig();

        expect(environment.baseUrl).toBe('https://taurus.example.org/api');
        expect(environment.vapidPublicKey).toBe('chiave-servita');
        expect(environment.primeuiLicense).toBe('licenza-servita');
        expect(environment.keycloak.baseurl).toBe('https://auth.example.org');
        expect(environment.keycloak.realm).toBe('banda');
    });

    it('keeps the compiled value of every key the file does not declare', async () => {
        serve({ baseUrl: 'https://taurus.example.org/api' });

        await loadRuntimeConfig();

        expect(environment.baseUrl).toBe('https://taurus.example.org/api');
        expect(environment.keycloak.realm).toBe(compiled.keycloak.realm);
        expect(environment.keycloak.clientId).toBe(compiled.keycloak.clientId);
        expect(environment.primeuiLicense).toBe(compiled.primeuiLicense);
    });

    // Un deploy a una sola origine configura `/auth`: Keycloak concatena quel valore e lo usa nelle
    // redirezioni, quindi deve arrivare assoluto.
    it('resolves a relative Keycloak address on the current origin', async () => {
        serve({ keycloak: { baseurl: '/auth' } });

        await loadRuntimeConfig();

        expect(environment.keycloak.baseurl).toBe(`${window.location.origin}/auth`);
    });

    it('keeps the compiled values when the file is missing', async () => {
        serve(null, false, 404);

        await loadRuntimeConfig();

        expect(environment.baseUrl).toBe(compiled.baseUrl);
        expect(environment.keycloak.realm).toBe(compiled.keycloak.realm);
    });

    it('keeps the compiled values when the file is not readable', async () => {
        spyOn(window, 'fetch').and.rejectWith(new TypeError('rete non disponibile'));

        await loadRuntimeConfig();

        expect(environment.baseUrl).toBe(compiled.baseUrl);
        expect(environment.keycloak.clientId).toBe(compiled.keycloak.clientId);
    });

    // La chiave della PrimeUI License di chi sviluppa sta in un file escluso da git e dall'immagine.
    it('lets the local file of the development machine override the served values', async () => {
        serveFiles({ baseUrl: 'https://taurus.example.org/api', primeuiLicense: 'licenza-servita' }, { primeuiLicense: 'licenza-locale' });

        await loadRuntimeConfig();

        expect(environment.baseUrl).toBe('https://taurus.example.org/api');
        expect(environment.primeuiLicense).toBe('licenza-locale');
    });

    it('does not ask for the local file in production', async () => {
        environment.production = true;
        const fetch = serveFiles({ primeuiLicense: 'licenza-servita' }, { primeuiLicense: 'licenza-locale' });

        await loadRuntimeConfig();

        expect(fetch.calls.allArgs().map(([url]) => url)).toEqual(['assets/config.json']);
        expect(environment.primeuiLicense).toBe('licenza-servita');
    });

    it('starts without warnings when the local file is missing, and warns when it is not JSON', async () => {
        const warn = spyOn(console, 'warn');
        const fetch = serveFiles({ baseUrl: 'https://taurus.example.org/api' });

        await loadRuntimeConfig();

        expect(environment.baseUrl).toBe('https://taurus.example.org/api');
        expect(warn).not.toHaveBeenCalled();

        fetch.and.callFake((url: RequestInfo | URL) => Promise.resolve({ ok: true, status: 200, json: () => (String(url) === LOCAL_CONFIG_URL ? Promise.reject(new SyntaxError('virgola di troppo')) : Promise.resolve({})) } as Response));
        await loadRuntimeConfig();

        expect(warn).toHaveBeenCalledOnceWith(jasmine.stringContaining(LOCAL_CONFIG_URL), jasmine.any(SyntaxError));
    });
});
