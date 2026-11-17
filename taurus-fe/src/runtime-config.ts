import { environment } from './environments/environment';

/**
 * Configurazione letta all'avvio da `assets/config.json`, prima che l'applicazione parta.
 *
 * Gli indirizzi dell'API e di Keycloak non possono essere fissati nel bundle: il file compilato
 * viene costruito una volta e servito a browser che stanno fuori dalla rete del deploy, dove
 * `http://backend:8080` non esiste. Il container scrive questo file dalle variabili d'ambiente
 * dell'host (`docker-entrypoint.sh`), quindi la stessa immagine serve ambienti diversi senza
 * ricostruirla.
 *
 * Quello che il file non dichiara resta al valore compilato in `environment`: in sviluppo non serve
 * nessun file, e un deploy che dimentica una chiave usa il valore predefinito invece di partire a
 * metà.
 *
 * In sviluppo vale sopra di esso `assets/config.local.json`, se c'è: la configurazione della propria
 * macchina, per esempio la chiave della PrimeUI License, esclusa da git e dall'immagine.
 */
export interface RuntimeConfig {
    baseUrl?: string;
    vapidPublicKey?: string;
    /** Chiave della PrimeUI License, passata a `providePrimeNG`. */
    primeuiLicense?: string;
    keycloak?: {
        baseurl?: string;
        realm?: string;
        clientId?: string;
    };
}

const CONFIG_URL = 'assets/config.json';
/** Configurazione della macchina di sviluppo, facoltativa: la build di produzione non la chiede. */
export const LOCAL_CONFIG_URL = 'assets/config.local.json';

/** Sovrascrive `environment` con i valori serviti, se ci sono. Non solleva mai: il bundle ha i suoi. */
export const loadRuntimeConfig = async (): Promise<void> => {
    apply(await read(CONFIG_URL));
    if (!environment.production) apply(await read(LOCAL_CONFIG_URL, true));

    // Keycloak costruisce gli indirizzi dei suoi endpoint concatenando `url` e li usa anche nelle
    // redirezioni del browser: un percorso relativo va reso assoluto sull'origine corrente.
    environment.keycloak.baseurl = absolute(environment.keycloak.baseurl);
};

const apply = (config: RuntimeConfig | null): void => {
    if (!config) return;
    if (config.baseUrl) environment.baseUrl = config.baseUrl;
    if (config.vapidPublicKey) environment.vapidPublicKey = config.vapidPublicKey;
    if (config.primeuiLicense) environment.primeuiLicense = config.primeuiLicense;
    if (config.keycloak?.baseurl) environment.keycloak.baseurl = config.keycloak.baseurl;
    if (config.keycloak?.realm) environment.keycloak.realm = config.keycloak.realm;
    if (config.keycloak?.clientId) environment.keycloak.clientId = config.keycloak.clientId;
};

const absolute = (url: string): string => (url.startsWith('/') ? new URL(url, window.location.origin).toString().replace(/\/$/, '') : url);

/** Legge un file di configurazione; di uno facoltativo l'assenza non si segnala, un contenuto non valido sì. */
const read = async (url: string, optional = false): Promise<RuntimeConfig | null> => {
    let response: Response;
    try {
        // `no-store`: il file cambia a ogni deploy e deve valere subito, anche con il bundle in cache.
        response = await fetch(url, { cache: 'no-store' });
    } catch (error) {
        // Un file assente o non leggibile non deve impedire l'avvio: senza fallback l'applicazione
        // resterebbe bianca anche quando i valori compilati basterebbero.
        if (!optional) console.warn('Configurazione a runtime non leggibile: valgono i valori compilati.', error);
        return null;
    }
    if (!response.ok) {
        if (!optional) console.warn(`Configurazione a runtime non disponibile (HTTP ${response.status}): valgono i valori compilati.`);
        return null;
    }

    try {
        const config = (await response.json()) as RuntimeConfig;
        return config && typeof config === 'object' ? config : null;
    } catch (error) {
        console.warn(`Configurazione a runtime non leggibile in ${url}: se ne ignorano i valori.`, error);
        return null;
    }
};
