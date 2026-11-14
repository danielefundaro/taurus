import { Injectable } from '@angular/core';

/**
 * Pacchetto Verovio servito tra gli asset: resta fuori dal bundle, così il service worker lo scarica e lo mette in cache
 * solo al primo uso del lettore invece di precaricarlo per tutti gli utenti.
 */
const VEROVIO_URL = 'assets/verovio/verovio-toolkit-wasm.js';

/** Parte del toolkit Verovio usata dal lettore. */
interface VerovioToolkit {
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page?: number, xmlDeclaration?: boolean): string;
}

/** Oggetto globale `verovio` definito dal pacchetto. */
interface VerovioGlobal {
    module: { onRuntimeInitialized?: () => void };
    toolkit: new () => VerovioToolkit;
}

/**
 * Disegno dello spartito con Verovio (LGPL-3.0), caricato al primo uso. Verovio conserva gli `id` di battute e note del
 * MusicXML negli elementi disegnati: l'editor di correzione li usa per riconoscere ciò che si seleziona.
 */
@Injectable({ providedIn: 'root' })
export class ScoreRendererService {
    private toolkit?: Promise<VerovioToolkit>;

    /**
     * Pagine SVG della parte, adattate alla larghezza indicata in pixel; `scale` è la dimensione in percentuale. Con
     * `encodedBreaks` le righe vanno a capo anche dove la parte ha un'interruzione di riga o di pagina, come nella
     * scrittura; altrimenti seguono solo la larghezza.
     */
    async render(musicXml: string, width: number, scale = 40, options: { encodedBreaks?: boolean } = {}): Promise<string[]> {
        const toolkit = await this.ready();
        toolkit.setOptions({
            pageWidth: Math.max(600, Math.round((width * 100) / scale)),
            pageHeight: 60000,
            scale,
            adjustPageHeight: true,
            // Con «smart» e soglia 0 Verovio rispetta tutte le interruzioni di riga e va a capo anche dove la riga è piena.
            ...(options.encodedBreaks ? { breaks: 'smart', breaksSmartSb: 0 } : { breaks: 'auto' }),
            header: 'none',
            footer: 'none',
            svgViewBox: true,
            svgAdditionalAttribute: ['measure@n']
        });
        if (!toolkit.loadData(forDisplay(musicXml, !!options.encodedBreaks))) throw new Error('Spartito non leggibile');
        const pages: string[] = [];
        for (let page = 1; page <= toolkit.getPageCount(); page++) pages.push(toolkit.renderToSVG(page));
        return pages;
    }

    private ready(): Promise<VerovioToolkit> {
        this.toolkit ??= this.load().catch((error) => {
            this.toolkit = undefined;
            throw error;
        });
        return this.toolkit;
    }

    /** Carica lo script di Verovio e attende l'avvio del suo modulo WebAssembly. */
    private load(): Promise<VerovioToolkit> {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = VEROVIO_URL;
            script.async = true;
            script.onload = () => {
                const verovio = (window as unknown as { verovio?: VerovioGlobal }).verovio;
                if (!verovio) {
                    reject(new Error('Verovio non disponibile'));
                    return;
                }
                verovio.module.onRuntimeInitialized = () => resolve(new verovio.toolkit());
            };
            script.onerror = () => {
                script.remove();
                reject(new Error('Verovio non disponibile'));
            };
            document.head.appendChild(script);
        });
    }
}

/**
 * Il MusicXML senza i nomi della parte, che Verovio scrive a sinistra di ogni rigo: lettore ed editor mostrano una parte
 * alla volta e ne riportano già il nome nel titolo, mentre sul telefono il nome occuperebbe metà della larghezza.
 */
export function withoutPartNames(musicXml: string): string {
    return forDisplay(musicXml, false);
}

/**
 * Il MusicXML da disegnare: senza i nomi della parte e, con `pageBreaksAsSystems`, con le interruzioni di pagina mostrate
 * come interruzioni di riga, perché lo spartito scorre in una sola pagina.
 */
export function forDisplay(musicXml: string, pageBreaksAsSystems: boolean): string {
    const document = new DOMParser().parseFromString(musicXml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length > 0) return musicXml;
    for (const name of ['part-name', 'part-abbreviation']) {
        for (const element of Array.from(document.getElementsByTagName(name))) element.textContent = '';
    }
    for (const name of ['part-name-display', 'part-abbreviation-display']) {
        for (const element of Array.from(document.getElementsByTagName(name))) element.remove();
    }
    if (pageBreaksAsSystems) {
        for (const print of Array.from(document.getElementsByTagName('print'))) {
            if (print.getAttribute('new-page') !== 'yes') continue;
            print.removeAttribute('new-page');
            print.setAttribute('new-system', 'yes');
        }
    }
    return new XMLSerializer().serializeToString(document);
}
