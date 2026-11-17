export const environment = {
    production: false,
    baseUrl: "http://localhost:8080/api",
    // La chiave di PrimeUI non entra nel repository: in sviluppo va in `src/assets/config.local.json`.
    primeuiLicense: '',
    vapidPublicKey: 'BHEmW3uZIG2dS1KLCMqxvEnuA8lk_Tkf_gzVR9Qe7B5gsSRbrPKD903tCBiGCrVqVzfTG-zuiN6MnpN50sbAYfM',
    keycloak: {
        baseurl: "http://localhost:9080",
        realm: "taurus",
        clientId: "web_app",
    }
};