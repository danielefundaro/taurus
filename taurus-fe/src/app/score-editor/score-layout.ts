/**
 * Disegno per pagine dell'editor: il Web Worker impagina con Verovio tutta la parte o la partitura e restituisce le pagine
 * SVG con le battute di ognuna, mentre l'editor ridisegna subito solo la pagina della modifica. Il modulo non usa il DOM,
 * perché gira anche nel Web Worker.
 */

/** Parte del toolkit Verovio usata dall'impaginazione. */
export interface LayoutToolkit {
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page?: number, xmlDeclaration?: boolean): string;
}

/** Richiesta al Web Worker: il MusicXML già preparato per il disegno e le opzioni di Verovio. */
export interface LayoutRequest {
    id: number;
    options: Record<string, unknown>;
    data: string;
}

/**
 * Pagina disegnata: l'SVG, la sua dimensione in pixel, gli `id` delle battute disegnate, nell'ordine, e quelli delle
 * battute che aprono un sistema.
 */
export interface LayoutPage {
    svg: string;
    width: number;
    height: number;
    measureIds: string[];
    systemIds: string[];
}

export type LayoutResponse = { id: number; pages: LayoutPage[] } | { id: number; error: true };

/** Impagina il MusicXML della richiesta e restituisce tutte le pagine; un documento illeggibile dà un errore. */
export function layoutPages(toolkit: LayoutToolkit, request: LayoutRequest): LayoutResponse {
    toolkit.setOptions(request.options);
    if (!toolkit.loadData(request.data)) return { id: request.id, error: true };
    const pages: LayoutPage[] = [];
    for (let page = 1; page <= toolkit.getPageCount(); page++) pages.push(layoutPage(toolkit.renderToSVG(page)));
    return { id: request.id, pages };
}

/** La pagina con la dimensione del suo `viewBox`, gli `id` delle battute che contiene e di quelle che aprono i sistemi. */
export function layoutPage(svg: string): LayoutPage {
    const box = /\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
    return { svg, width: box ? Number(box[1]) : 0, height: box ? Number(box[2]) : 0, ...pageMeasures(svg) };
}

/** `id` delle battute disegnate, nell'ordine: Verovio scrive un gruppo `class="measure"` per battuta e sistema. */
export function pageMeasureIds(svg: string): string[] {
    return pageMeasures(svg).measureIds;
}

/** `id` delle battute disegnate e di quelle che aprono un sistema, la prima di ogni gruppo `class="system"`. */
function pageMeasures(svg: string): { measureIds: string[]; systemIds: string[] } {
    const measureIds: string[] = [];
    const systemIds: string[] = [];
    let opening = false;
    for (const [tag] of svg.matchAll(/<g\b[^>]*>/g)) {
        if (/\bclass="system[\s"]/.test(tag)) {
            opening = true;
            continue;
        }
        if (!/\bclass="measure[\s"]/.test(tag)) continue;
        const id = /\bid="([^"]+)"/.exec(tag)?.[1];
        if (!id) continue;
        measureIds.push(id);
        if (opening) systemIds.push(id);
        opening = false;
    }
    return { measureIds, systemIds };
}
