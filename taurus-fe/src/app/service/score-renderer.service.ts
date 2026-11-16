import { Injectable } from '@angular/core';
import { MAX_ENGRAVED_PAGES, numberPage, pageSections, prepareMei, ResolvedOptions, verovioOptions } from '../score-editor/score-engraving';
import { ScoreLayoutClient } from '../score-editor/score-layout-client';

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
    getMEI(options?: Record<string, unknown>): string;
    select(selection: Record<string, unknown>): boolean;
    redoLayout(options?: Record<string, unknown>): void;
}

/** Anteprima di un'impaginazione: le pagine SVG in ordine, fino al massimo consentito. */
export interface EngravingPreview {
    pages: string[];
    /** La parte supera le pagine massime: il servizio musicale rifiuterebbe l'impaginazione. */
    tooManyPages: boolean;
}

/** Come disegnare lo spartito nel lettore e negli editor. */
export interface DrawingOptions {
    /** Le righe vanno a capo anche dove la parte ha un'interruzione di riga o di pagina, come nella scrittura. */
    encodedBreaks?: boolean;
    /** Una partitura nasconde i righi che in una riga hanno solo pause, come una partitura stampata. */
    condense?: boolean;
    /** Restano i nomi dei righi di una partitura. */
    partNames?: boolean;
}

/** Altezza di una pagina quando lo spartito scorre tutto in una pagina sola, in unità di Verovio. */
const SCROLL_PAGE_HEIGHT = 60000;

/**
 * Opzioni di Verovio per disegnare lo spartito largo `width` pixel con la dimensione `scale` in percentuale; con
 * `pageHeight`, in pixel, lo spartito si divide in pagine di quell'altezza, con almeno un sistema per pagina.
 */
export function drawingOptions(width: number, scale: number, options: DrawingOptions & { pageHeight?: number } = {}): Record<string, unknown> {
    return {
        pageWidth: Math.max(600, Math.round((width * 100) / scale)),
        pageHeight: options.pageHeight ? Math.round((options.pageHeight * 100) / scale) : SCROLL_PAGE_HEIGHT,
        scale,
        adjustPageHeight: true,
        // Con «smart» e soglia 0 Verovio rispetta tutte le interruzioni di riga e va a capo anche dove la riga è piena.
        ...(options.encodedBreaks ? { breaks: 'smart', breaksSmartSb: 0 } : { breaks: 'auto' }),
        // Le opzioni restano nel toolkit: la compressione si imposta sempre, anche per le parti singole.
        condense: options.condense ? 'auto' : 'none',
        condenseFirstPage: !!options.condense,
        header: 'none',
        footer: 'none',
        svgViewBox: true,
        svgAdditionalAttribute: ['measure@n', 'staff@n']
    };
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
    private verovio?: Promise<VerovioGlobal>;
    private toolkit?: Promise<VerovioToolkit>;
    /** Toolkit dell'impaginazione, separato perché le sue opzioni non passino al lettore e all'editor. */
    private engraver?: Promise<VerovioToolkit>;

    /**
     * Pagine SVG della parte, adattate alla larghezza indicata in pixel; `scale` è la dimensione in percentuale. Con
     * `encodedBreaks` le righe vanno a capo anche dove la parte ha un'interruzione di riga o di pagina, come nella
     * scrittura; altrimenti seguono solo la larghezza. Con `condense` una partitura nasconde i righi che in una riga hanno
     * solo pause, come una partitura stampata; con `partNames` restano i nomi dei righi.
     */
    async render(musicXml: string, width: number, scale = 40, options: DrawingOptions = {}): Promise<string[]> {
        return this.renderPrepared(forDisplay(musicXml, !!options.encodedBreaks, !!options.partNames), width, scale, options);
    }

    /**
     * Pagine SVG di un MusicXML già preparato per il disegno, con i nomi e le interruzioni da mostrare, come gli estratti
     * del disegno per pagine dell'editor.
     */
    async renderPrepared(musicXml: string, width: number, scale: number, options: DrawingOptions = {}): Promise<string[]> {
        const toolkit = await this.ready();
        toolkit.setOptions(drawingOptions(width, scale, options));
        if (!toolkit.loadData(musicXml)) throw new Error('Spartito non leggibile');
        const pages: string[] = [];
        for (let page = 1; page <= toolkit.getPageCount(); page++) pages.push(toolkit.renderToSVG(page));
        return pages;
    }

    /**
     * Un Web Worker con un suo Verovio, che impagina in background tutta la parte o la partitura: va chiuso con
     * `terminate` quando non serve più, perché tiene la sua memoria.
     */
    layoutWorker(): ScoreLayoutClient {
        return new ScoreLayoutClient(() => new Worker(new URL('../score-editor/score-layout.worker', import.meta.url), { type: 'module' }));
    }

    /**
     * Pagine della parte come le impagina il servizio musicale, con le stesse opzioni: la prima sezione con
     * l'intestazione, le altre tra un'interruzione di pagina e la successiva, e i numeri dalla seconda pagina.
     */
    async engrave(musicXml: string, options: ResolvedOptions): Promise<EngravingPreview> {
        const toolkit = await this.engraving();
        toolkit.setOptions(verovioOptions(options));
        if (!toolkit.loadData(musicXml)) throw new Error('Spartito non leggibile');
        const mei = new DOMParser().parseFromString(toolkit.getMEI(), 'application/xml');
        if (mei.getElementsByTagName('parsererror').length > 0) throw new Error('Spartito non leggibile');
        const sections = pageSections(mei);
        const pages: string[] = [];
        const load = (document: string) => {
            if (!toolkit.loadData(document)) throw new Error('Spartito non leggibile');
        };
        load(prepareMei(mei, options, true, sections.length > 1 ? sections[0][1] : undefined));
        let fits = this.collect(toolkit, pages);
        if (fits && sections.length > 1) {
            load(prepareMei(mei, options, false));
            for (const [start, end] of sections.slice(1)) {
                toolkit.select({ start, end });
                toolkit.redoLayout();
                fits = this.collect(toolkit, pages);
                if (!fits) break;
            }
        }
        return { pages: options.pageNumbers ? pages.map((page, index) => numberPage(page, index + 1, options)) : pages, tooManyPages: !fits };
    }

    /** Aggiunge le pagine disegnate dal toolkit; `false` quando supererebbero il massimo. */
    private collect(toolkit: VerovioToolkit, pages: string[]): boolean {
        const count = toolkit.getPageCount();
        if (pages.length + count > MAX_ENGRAVED_PAGES) return false;
        for (let page = 1; page <= count; page++) pages.push(toolkit.renderToSVG(page));
        return true;
    }

    private ready(): Promise<VerovioToolkit> {
        this.toolkit ??= this.create().catch((error) => {
            this.toolkit = undefined;
            throw error;
        });
        return this.toolkit;
    }

    private engraving(): Promise<VerovioToolkit> {
        this.engraver ??= this.create().catch((error) => {
            this.engraver = undefined;
            throw error;
        });
        return this.engraver;
    }

    private async create(): Promise<VerovioToolkit> {
        this.verovio ??= this.load().catch((error) => {
            this.verovio = undefined;
            throw error;
        });
        const verovio = await this.verovio;
        return new verovio.toolkit();
    }

    /** Carica lo script di Verovio e attende l'avvio del suo modulo WebAssembly. */
    private load(): Promise<VerovioGlobal> {
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
                verovio.module.onRuntimeInitialized = () => resolve(verovio);
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
 * Il MusicXML da disegnare: senza i nomi della parte, tranne che con `partNames` per i righi di una partitura, e, con
 * `pageBreaksAsSystems`, con le interruzioni di pagina mostrate come interruzioni di riga, perché lo spartito scorre in
 * una sola pagina.
 */
export function forDisplay(musicXml: string, pageBreaksAsSystems: boolean, partNames = false): string {
    const document = new DOMParser().parseFromString(musicXml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length > 0) return musicXml;
    if (!partNames) {
        for (const name of ['part-name', 'part-abbreviation']) {
            for (const element of Array.from(document.getElementsByTagName(name))) element.textContent = '';
        }
        for (const name of ['part-name-display', 'part-abbreviation-display']) {
            for (const element of Array.from(document.getElementsByTagName(name))) element.remove();
        }
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
