# Componenti di terze parti

Il frontend include nel bundle, e quindi nell'immagine pubblicata, le librerie JavaScript scaricate da npm durante la build, senza modifiche. Quasi tutte hanno licenze permissive (MIT, Apache-2.0, BSD, ISC). Qui sono annotate quelle con condizioni diverse.

| Componente | Versione | Licenza | Termini | Uso |
| --- | --- | --- | --- | --- |
| PrimeNG (`primeng`) | 22.1 | PrimeUI License; © 2026 PrimeTek Informatics | https://primeui.dev/licenses/community | componenti dell'interfaccia |
| Temi e stili PrimeUI (`@primeuix/themes`, `@primeuix/styles`, `@primeuix/styled`, `@primeuix/utils`, `@primeuix/motion`) | 3.1 i temi e gli stili, le altre come richieste da PrimeNG | PrimeUI License | come sopra | preset Aura, Lara e Nora, stili e animazioni dei componenti |
| PrimeIcons (`primeicons`, `@primeicons/angular`) | 8.0 | PrimeUI License | come sopra | icone |
| PrimeUI License Manager (`@primeui/license-manager`) | 1.1 | PrimeUI License | come sopra | verifica della chiave di licenza, offline |

## PrimeUI License

Dalla versione 22 PrimeNG e le librerie che lo accompagnano non sono più MIT: si usano con la PrimeUI License, nella Community License gratuita o in quella commerciale. La Community License vale per i singoli, gli studenti, gli enti senza scopo di lucro, i progetti open source non commerciali e le organizzazioni piccole (meno di un milione di dollari di ricavi annui, meno di cinque sviluppatori, meno di dieci dipendenti, meno di tre milioni di dollari di finanziamenti esterni). Si rinnova ogni anno confermando di averne ancora i requisiti.

- **Chiave.** Le librerie chiedono una chiave di licenza, verificata nel browser senza connessioni e senza telemetria. La chiave appartiene a chi installa Taurus e non è nel repository né nell'immagine: il container la legge da `TAURUS_PRIMEUI_LICENSE` e la scrive in `assets/config.json`; in sviluppo sta in `src/assets/config.local.json`, escluso da git e dall'immagine. Senza una chiave valida PrimeNG scrive un avviso in console e mostra un banner nell'angolo in basso a destra; l'applicazione funziona comunque.
- **Restrizioni.** I pacchetti sono distribuiti compilati. Non si possono decompilare, ridistribuire come libreria di componenti o strumento di sviluppo, né privare del controllo della licenza. Il repository di Taurus non li contiene: li scarica `npm ci`. L'immagine contiene solo il bundle dell'applicazione.
- **GPLv3.** Taurus è distribuito con la GPLv3 e un permesso aggiuntivo della sezione 7, in fondo a [`LICENSE`](../LICENSE), che consente di combinarlo con le librerie PrimeUI.

Il `Dockerfile` copia questo file nell'immagine, accanto all'applicazione. La scelta è del 2026-11-13 ed è registrata nella decisione 5 e nella sezione Licenze di `docs/platform-upgrade-spec.md`. A ogni versione maggiore di una dipendenza, la licenza si ricontrolla qui.
