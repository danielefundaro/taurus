import { EngravingFormat, EngravingHeader, EngravingOptions, MeasureNumbers } from '../module';

/**
 * Impaginazione di una parte come la fa il servizio musicale (`taurus-omr/src/taurus_omr/engrave.py`), per l'anteprima
 * del browser: stesse dimensioni, stesse opzioni di Verovio, stessa intestazione scritta nell'MEI e stesse sezioni tra
 * le interruzioni di pagina. Verovio ha la stessa versione nel frontend e nel servizio, così le pagine coincidono.
 */

const MEI = 'http://www.music-encoding.org/ns/mei';
const XML = 'http://www.w3.org/XML/1998/namespace';
/** Altezza del rigo in unità di Verovio, metà della distanza tra due linee. */
const UNITS_PER_STAFF = 8;
/** Fascia lasciata libera sopra il margine inferiore per i numeri di pagina, in millimetri. */
const PAGE_NUMBER_STRIP = 6;
/** Numeri di pagina in decimi di millimetro, l'unità delle pagine SVG di Verovio: 3,5 mm, 1,5 mm sopra il margine. */
const PAGE_NUMBER_SIZE = 35;
const PAGE_NUMBER_BASELINE = 15;
/**
 * Parte salvata con una versione MusicXML e senza pagine, scritta o ricavata: si legge e si ascolta, ma non compare in
 * anteprima, in presentazione né in stampa finché non si impagina.
 */
export function unengravedPart(score: { id?: number; media?: readonly unknown[] | null; currentScoreVersionId?: number | null }): boolean {
    return score.id !== undefined && !score.media?.length && !!score.currentScoreVersionId;
}

/** «1 parte da impaginare non stampata», «2 parti da impaginare non stampate». */
export function unengravedLabel(count: number): string {
    return count === 1 ? '1 parte da impaginare non stampata' : `${count} parti da impaginare non stampate`;
}

/** Pagine massime di un'impaginazione, come nel servizio. */
export const MAX_ENGRAVED_PAGES = 30;
export const MIN_STAFF_SIZE = 4;
export const MAX_STAFF_SIZE = 9.6;
export const MIN_MARGIN = 3;
export const MAX_MARGIN = 30;
export const MAX_HEADER_LENGTH = 200;

/** Pagina in millimetri, con il rigo e i margini proposti. */
export interface PageFormat {
    label: string;
    width: number;
    height: number;
    staff: number;
    margin: number;
}

export const PAGE_FORMATS: Readonly<Record<EngravingFormat, PageFormat>> = {
    A4_PORTRAIT: { label: 'A4 verticale', width: 210, height: 297, staff: 7, margin: 12 },
    A4_LANDSCAPE: { label: 'A4 orizzontale', width: 297, height: 210, staff: 7, margin: 12 },
    // Il formato marcia della banda: 18 × 13 cm in orizzontale, tenuto dalla lira dello strumento.
    MARCH: { label: 'Formato marcia 18 × 13 cm', width: 180, height: 130, staff: 5.6, margin: 8 }
};

export const MEASURE_NUMBER_LABELS: Readonly<Record<MeasureNumbers, string>> = {
    SYSTEM: "All'inizio di ogni rigo",
    EVERY: 'Su ogni battuta',
    NONE: 'Nessuno'
};

/** Le opzioni con i valori proposti al posto di quelle lasciate vuote, come le legge il servizio. */
export interface ResolvedOptions {
    format: EngravingFormat;
    staffSize: number;
    margin: number;
    header: Required<{ [K in keyof EngravingHeader]: string }>;
    pageNumbers: boolean;
    measureNumbers: MeasureNumbers;
}

export function resolveOptions(options: EngravingOptions | null | undefined): ResolvedOptions {
    const format = options?.format ?? 'A4_PORTRAIT';
    const page = PAGE_FORMATS[format];
    const header = options?.header;
    return {
        format,
        staffSize: options?.staffSize ?? page.staff,
        margin: options?.margin ?? page.margin,
        header: {
            title: singleLine(header?.title),
            composer: singleLine(header?.composer),
            arranger: singleLine(header?.arranger),
            partName: singleLine(header?.partName)
        },
        pageNumbers: options?.pageNumbers ?? true,
        measureNumbers: options?.measureNumbers ?? 'SYSTEM'
    };
}

/** Il testo su una sola riga, senza caratteri di controllo e spazi ripetuti. */
export function singleLine(value: string | null | undefined): string {
    // eslint-disable-next-line no-control-regex
    return (value ?? '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
}

/** Opzioni di Verovio: le dimensioni della pagina sono in decimi di millimetro. */
export function verovioOptions(options: ResolvedOptions): Record<string, unknown> {
    const page = PAGE_FORMATS[options.format];
    const margin = Math.round(options.margin * 10);
    const bottom = Math.round((options.margin + (options.pageNumbers ? PAGE_NUMBER_STRIP : 0)) * 10);
    return {
        pageWidth: Math.round(page.width * 10),
        pageHeight: Math.round(page.height * 10),
        pageMarginTop: margin,
        pageMarginBottom: bottom,
        pageMarginLeft: margin,
        pageMarginRight: margin,
        unit: Math.round(((options.staffSize * 10) / UNITS_PER_STAFF) * 1000) / 1000,
        adjustPageHeight: false,
        // Come nella scrittura: ogni interruzione di riga resta, e una riga piena va a capo da sola.
        breaks: 'smart',
        breaksSmartSb: 0,
        header: 'encoded',
        footer: 'encoded',
        justifyVertically: true,
        mnumInterval: options.measureNumbers === 'EVERY' ? 1 : 0
    };
}

/** Prima e ultima battuta di ogni sezione tra due interruzioni di pagina; quella prima della musica non conta. */
export function pageSections(mei: Document): Array<[string, string]> {
    const sections: string[][] = [[]];
    for (const element of Array.from(mei.getElementsByTagNameNS(MEI, '*'))) {
        if (element.localName === 'pb' && sections[sections.length - 1].length) sections.push([]);
        else if (element.localName === 'measure') sections[sections.length - 1].push(xmlId(element));
    }
    return sections.filter((section) => section.length).map((section) => [section[0], section[section.length - 1]]);
}

/**
 * L'MEI da impaginare: senza i nomi della parte e l'intestazione d'origine, con quelli delle opzioni. Con `until` la
 * parte finisce a quella battuta e le ripetizioni dell'ascolto, che riguardano tutta la parte, si tolgono.
 */
export function prepareMei(mei: Document, options: ResolvedOptions, header: boolean, until?: string): string {
    const root = mei.cloneNode(true) as Document;
    if (until !== undefined) {
        cutAfter(root.documentElement, until);
        for (const expansion of Array.from(root.getElementsByTagNameNS(MEI, 'expansion'))) expansion.remove();
    }
    for (const element of Array.from(root.getElementsByTagNameNS(MEI, '*'))) {
        const parent = element.parentElement?.localName;
        if (element.localName === 'pgHead' || element.localName === 'pgFoot' || ((element.localName === 'label' || element.localName === 'labelAbbr') && (parent === 'staffDef' || parent === 'staffGrp'))) {
            element.remove();
        }
    }
    const scoreDef = root.getElementsByTagNameNS(MEI, 'scoreDef')[0];
    if (!scoreDef) throw new Error('Spartito non leggibile');
    if (options.measureNumbers === 'NONE') scoreDef.setAttribute('mnum.visible', 'false');
    if (header && hasHeader(options)) scoreDef.insertBefore(pageHead(root, options.header), scoreDef.firstChild);
    return new XMLSerializer().serializeToString(root);
}

export function hasHeader(options: ResolvedOptions): boolean {
    const { title, composer, arranger, partName } = options.header;
    return !!(title || composer || arranger || partName);
}

/** Intestazione della prima pagina: nome della parte a sinistra, titolo al centro, compositore e arrangiatore a destra. */
function pageHead(document: Document, header: ResolvedOptions['header']): Element {
    const head = document.createElementNS(MEI, 'pgHead');
    head.setAttribute('func', 'first');
    if (header.partName) text(head, 'left', header.partName, { fontweight: 'bold', fontsize: 'large' });
    if (header.title) text(head, 'center', header.title, { fontsize: 'x-large' });
    const credits = [header.composer, header.arranger].filter(Boolean);
    if (credits.length) {
        const rend = child(head, 'rend', { halign: 'right', valign: 'top' });
        rend.appendChild(document.createTextNode(credits[0]));
        for (const credit of credits.slice(1)) {
            child(rend, 'lb', {});
            rend.appendChild(document.createTextNode(credit));
        }
    }
    return head;
}

function text(head: Element, align: string, value: string, style: Record<string, string>): void {
    const rend = child(head, 'rend', { halign: align, valign: 'top' });
    child(rend, 'rend', style).textContent = value;
}

function child(parent: Element, name: string, attributes: Record<string, string>): Element {
    const element = parent.ownerDocument.createElementNS(MEI, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.appendChild(element);
    return element;
}

/** Toglie tutto ciò che segue la battuta `last` nell'ordine del documento; `true` quando la battuta è trovata. */
function cutAfter(element: Element, last: string): boolean {
    const children = Array.from(element.children);
    for (let index = 0; index < children.length; index++) {
        const candidate = children[index];
        if ((candidate.localName === 'measure' && xmlId(candidate) === last) || cutAfter(candidate, last)) {
            for (const following of children.slice(index + 1)) following.remove();
            return true;
        }
    }
    return false;
}

function xmlId(element: Element): string {
    return element.getAttributeNS(XML, 'id') || element.getAttribute('xml:id') || '';
}

/** La pagina con il suo numero al centro della fascia sopra il margine inferiore; la prima pagina non ne ha. */
export function numberPage(svg: string, number: number, options: ResolvedOptions): string {
    const size = /<svg [^>]*?width="([0-9.]+)px" height="([0-9.]+)px"/.exec(svg);
    if (number === 1 || !size) return svg;
    const width = Number(size[1]);
    const height = Number(size[2]);
    const y = height - options.margin * 10 - PAGE_NUMBER_BASELINE;
    const label = `<text x="${Math.round(width / 2)}" y="${Math.round(y)}" font-family="Times, serif" font-size="${PAGE_NUMBER_SIZE}px" text-anchor="middle" fill="black" class="pageNumber">${number}</text>`;
    const end = svg.lastIndexOf('</svg>');
    return svg.slice(0, end) + label + svg.slice(end);
}

/** La pagina adattata alla larghezza del riquadro che la contiene, con le proporzioni del formato. */
export function responsivePage(svg: string): string {
    return svg.replace(/<svg ([^>]*?)width="([0-9.]+)px" height="([0-9.]+)px"/, (_match, before: string, width: string, height: string) => `<svg ${before}viewBox="0 0 ${width} ${height}" width="100%"`);
}

/** Le opzioni da inviare al servizio: i testi vuoti restano fuori, come il backend li salva. */
export function requestOptions(options: ResolvedOptions): EngravingOptions {
    const header: EngravingHeader = {};
    for (const key of ['title', 'composer', 'arranger', 'partName'] as const) {
        const value = singleLine(options.header[key]);
        if (value) header[key] = value;
    }
    return {
        format: options.format,
        staffSize: options.staffSize,
        margin: options.margin,
        header,
        pageNumbers: options.pageNumbers,
        measureNumbers: options.measureNumbers
    };
}

/** Il primo problema delle opzioni, o `null` se sono valide. */
export function optionsProblem(options: ResolvedOptions): string | null {
    if (!(options.staffSize >= MIN_STAFF_SIZE && options.staffSize <= MAX_STAFF_SIZE)) return 'La dimensione del rigo deve essere tra 4 e 9,6 mm';
    if (!(options.margin >= MIN_MARGIN && options.margin <= MAX_MARGIN)) return 'I margini devono essere tra 3 e 30 mm';
    if (Object.values(options.header).some((value) => singleLine(value).length > MAX_HEADER_LENGTH)) return "I testi dell'intestazione non possono superare 200 caratteri";
    return null;
}
