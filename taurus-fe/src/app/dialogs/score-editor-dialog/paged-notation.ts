import { LayoutPage } from '../../score-editor/score-layout';

/** Ciò che serve alle pagine dall'editor. */
export interface PagedNotationSource {
    /**
     * Le battute da `from` a `to`, comprese, disegnate con un estratto: le pagine SVG. Con `systems`, le posizioni delle
     * battute che aprono un sistema, l'estratto va a capo solo lì.
     */
    draw(from: number, to: number, systems: readonly number[] | null): Promise<string[]>;
    /** Posizione corrente di ogni battuta, per `id`. */
    positions(): Map<string, number>;
    /** Una pagina è stata disegnata o inserita: l'editor rimette selezione, evidenziazioni e cursore. */
    drawn(): void;
}

interface NotationPage {
    element: HTMLElement;
    /** SVG del disegno completo, inserito quando la pagina si avvicina alla vista. */
    svg: string | null;
    /** `id` delle battute disegnate nella pagina, nell'ordine. */
    measureIds: string[];
    /** `id` delle battute che aprono i sistemi della pagina. */
    systemIds: string[];
    /** Battute di una pagina provvisoria, prima del disegno completo. */
    range: [number, number] | null;
    /** Il disegno non corrisponde più al documento e va rifatto con un estratto. */
    stale: boolean;
    /** L'ultimo estratto non si è disegnato: si riprova dopo la prossima modifica della pagina. */
    failed: boolean;
    /** Il disegno è nella pagina. */
    shown: boolean;
}

interface PageEntry {
    svg: string | null;
    measureIds: string[];
    systemIds: string[];
    range: [number, number] | null;
    stale: boolean;
    height: number;
}

/**
 * Lo spartito diviso in pagine: le pagine vicine alla vista hanno il loro SVG, le altre sono riquadri della stessa altezza,
 * riempiti quando ci si avvicinano. Dopo una modifica la pagina della battuta modificata si ridisegna subito con un
 * estratto, le altre pagine cambiate quando sono vicine alla vista, finché non arriva il nuovo disegno completo.
 */
export class PagedNotation {
    private pages: NotationPage[] = [];
    private frame?: number;
    private redrawing = false;
    private readonly onScroll = () => this.scheduleVisible();

    constructor(
        private readonly container: HTMLElement,
        private readonly source: PagedNotationSource
    ) {
        // Lo spartito scorre nel suo riquadro, o con la pagina sul telefono: vale qualsiasi scorrimento.
        document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    }

    get empty(): boolean {
        return !this.pages.length;
    }

    /** Pagine provvisorie di `size` battute, alte `height` pixel finché non si disegnano, prima del disegno completo. */
    provisional(measureCount: number, size: number, height: number): void {
        const entries: PageEntry[] = [];
        for (let from = 0; from < measureCount; from += size) entries.push({ svg: null, measureIds: [], systemIds: [], range: [from, Math.min(measureCount, from + size) - 1], stale: true, height });
        this.replace(entries);
    }

    /** Il disegno completo, con le pagine alla larghezza del contenitore. */
    layout(pages: readonly LayoutPage[]): void {
        const width = this.container.clientWidth;
        this.replace(pages.map((page) => ({ svg: page.svg, measureIds: page.measureIds, systemIds: page.systemIds, range: null, stale: false, height: width && page.width ? (page.height * width) / page.width : page.height })));
    }

    /**
     * Segna da ridisegnare le pagine con le battute indicate; tutte con `null`. Una battuta che non è disegnata, come quella
     * di un altro rigo della partitura o una battuta nuova, segna la pagina che ora contiene la sua posizione.
     */
    invalidate(measures: ReadonlySet<string> | null): void {
        const missing = new Set(measures);
        for (const page of this.pages) {
            const changed = !measures || !!page.range || page.measureIds.some((id) => measures.has(id));
            for (const id of page.measureIds) missing.delete(id);
            if (!changed) continue;
            page.stale = true;
            page.failed = false;
        }
        if (!missing.size) return;
        const positions = this.source.positions();
        const ranges = this.ranges();
        for (const id of missing) {
            const position = positions.get(id);
            const index = position === undefined ? -1 : this.pageOf(position, ranges);
            if (index < 0) continue;
            this.pages[index].stale = true;
            this.pages[index].failed = false;
        }
    }

    /** Ridisegna subito la pagina della battuta `focus`, se è da rifare, e più tardi le altre pagine da rifare vicine alla vista. */
    async refresh(focus: number | null): Promise<void> {
        const ranges = this.ranges();
        const index = focus === null ? -1 : this.pageOf(focus, ranges);
        if (index >= 0 && this.pages[index].stale && !this.pages[index].failed) await this.redraw(index, ranges[index]);
        this.scheduleVisible();
    }

    /**
     * La pagina della battuta è disegnata, per selezionarla e mostrarla: `true` se lo è già o lo diventa subito, `false`
     * se si sta disegnando con un estratto, e alla fine lo dirà `drawn`.
     */
    ensure(position: number): boolean {
        const ranges = this.ranges();
        const index = this.pageOf(position, ranges);
        if (index < 0) return true;
        const page = this.pages[index];
        if (page.failed) return true;
        if (page.stale) {
            void this.redraw(index, ranges[index]);
            return false;
        }
        if (!page.shown && page.svg) this.show(page);
        return true;
    }

    /** Toglie le pagine e smette di seguire lo scorrimento. */
    destroy(): void {
        document.removeEventListener('scroll', this.onScroll, { capture: true });
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        this.pages = [];
        this.container.replaceChildren();
    }

    // Funzioni interne

    private replace(entries: readonly PageEntry[]): void {
        const pane = this.container.parentElement;
        const scrollTop = pane?.scrollTop ?? 0;
        const elements = entries.map(() => document.createElement('div'));
        this.pages = entries.map((entry, index) => {
            const element = elements[index];
            element.className = 'score-editor__page';
            element.style.height = `${Math.max(1, Math.round(entry.height))}px`;
            return { element, svg: entry.svg, measureIds: entry.measureIds, systemIds: entry.systemIds, range: entry.range, stale: entry.stale, failed: false, shown: false };
        });
        this.container.replaceChildren(...elements);
        if (pane) pane.scrollTop = scrollTop;
        this.showVisible();
    }

    /** Battute di ogni pagina, dalle posizioni attuali delle sue battute: dopo una modifica possono essersi spostate. */
    private ranges(): ([number, number] | null)[] {
        const positions = this.source.positions();
        return this.pages.map((page) => {
            if (!page.measureIds.length) return page.range;
            let from = Number.MAX_SAFE_INTEGER;
            let to = -1;
            for (const id of page.measureIds) {
                const position = positions.get(id);
                if (position === undefined) continue;
                from = Math.min(from, position);
                to = Math.max(to, position);
            }
            return to >= 0 ? [from, to] : null;
        });
    }

    /**
     * La pagina della battuta. Una battuta nuova tra due pagine va con la pagina che la precede, o con la prima se le
     * precede tutte, e la pagina si allunga fino a lei e va ridisegnata.
     */
    private pageOf(position: number, ranges: ([number, number] | null)[]): number {
        const index = ranges.findIndex((range) => !!range && position >= range[0] && position <= range[1]);
        if (index >= 0) return index;
        let before = -1;
        ranges.forEach((range, current) => {
            if (range && range[1] < position && (before < 0 || range[1] > ranges[before]![1])) before = current;
        });
        const target = before >= 0 ? before : ranges.findIndex((range) => !!range);
        if (target < 0) return -1;
        const range = ranges[target]!;
        ranges[target] = [Math.min(range[0], position), Math.max(range[1], position)];
        this.pages[target].stale = true;
        return target;
    }

    /**
     * Posizioni delle battute che aprono i sistemi della pagina, se ha ancora tutte e sole le battute del suo disegno: il
     * nuovo disegno tiene gli stessi sistemi, che Verovio non deve ricalcolare. Con battute aggiunte, o tolte all'inizio di
     * un sistema, `null`: l'estratto va a capo dove serve.
     */
    private systemStarts(page: NotationPage, range: [number, number]): number[] | null {
        if (!page.systemIds.length) return null;
        const positions = this.source.positions();
        const drawn = new Set<number>();
        for (const id of page.measureIds) {
            const position = positions.get(id);
            if (position !== undefined) drawn.add(position);
        }
        if (drawn.size !== range[1] - range[0] + 1) return null;
        const starts: number[] = [];
        for (const id of page.systemIds) {
            const position = positions.get(id);
            if (position === undefined) return null;
            starts.push(position);
        }
        return starts;
    }

    private async redraw(index: number, range: [number, number] | null): Promise<void> {
        const page = this.pages[index];
        page.stale = false;
        let svgs: string[] = [];
        if (range) {
            try {
                svgs = await this.source.draw(range[0], range[1], this.systemStarts(page, range));
            } catch {
                // L'estratto non si disegna: la pagina resta da rifare, dopo la prossima modifica o con il disegno completo.
                page.stale = true;
                page.failed = true;
                return;
            }
        }
        // Nel frattempo è arrivato il disegno completo; se la pagina è cambiata di nuovo resta da rifare, ma più recente.
        if (this.pages[index] !== page) return;
        // L'SVG è generato da Verovio a partire dal MusicXML: i testi sono codificati e non contiene script.
        page.element.innerHTML = svgs.join('');
        page.element.style.height = '';
        page.svg = null;
        page.measureIds = Array.from(page.element.querySelectorAll('g.measure'), (measure) => measure.getAttribute('id') ?? '').filter((id) => id);
        page.systemIds = Array.from(page.element.querySelectorAll('g.system'), (system) => system.querySelector('g.measure')?.getAttribute('id') ?? '').filter((id) => id);
        page.range = page.measureIds.length ? null : range;
        page.shown = true;
        this.source.drawn();
    }

    private show(page: NotationPage): void {
        page.element.innerHTML = page.svg ?? '';
        page.element.style.height = '';
        page.shown = true;
    }

    private scheduleVisible(): void {
        if (this.frame !== undefined) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            this.showVisible();
        });
    }

    /** Inserisce le pagine vicine alla vista e ridisegna, una per fotogramma, quelle da rifare. */
    private showVisible(): void {
        let inserted = false;
        for (const page of this.visiblePages()) {
            if (!page.stale && !page.shown && page.svg) {
                this.show(page);
                inserted = true;
            }
        }
        if (inserted) this.source.drawn();
        void this.redrawVisible();
    }

    private async redrawVisible(): Promise<void> {
        if (this.redrawing) return;
        this.redrawing = true;
        try {
            for (;;) {
                const page = this.visiblePages().find((candidate) => candidate.stale && !candidate.failed);
                if (!page) return;
                const index = this.pages.indexOf(page);
                await this.redraw(index, this.ranges()[index]);
                // Tra un estratto e l'altro la pagina risponde ai tasti.
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
        } finally {
            this.redrawing = false;
        }
    }

    /** Pagine entro una schermata dalla parte visibile dello spartito. */
    private visiblePages(): NotationPage[] {
        const pane = this.container.parentElement ?? this.container;
        const box = pane.getBoundingClientRect();
        const top = Math.max(box.top, 0);
        const bottom = Math.min(box.bottom, window.innerHeight);
        const margin = Math.max(bottom - top, 200);
        return this.pages.filter((page) => {
            const rect = page.element.getBoundingClientRect();
            return rect.bottom >= top - margin && rect.top <= bottom + margin;
        });
    }
}
