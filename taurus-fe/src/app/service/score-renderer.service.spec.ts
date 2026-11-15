import { resolveOptions } from '../score-editor/score-engraving';
import { forDisplay, ScoreRendererService, withoutPartNames } from './score-renderer.service';

const MEI_NS = 'http://www.music-encoding.org/ns/mei';

/** Toolkit Verovio simulato: ogni documento caricato si disegna nel numero di pagine indicato. */
class FakeToolkit {
    readonly loaded: string[] = [];
    readonly selections: Array<Record<string, unknown>> = [];
    options: Record<string, unknown> = {};
    accept = true;
    pagesPerLayout: number[] = [];
    private layout = 0;

    constructor(private readonly mei: string) {}

    setOptions(options: Record<string, unknown>): void {
        this.options = options;
    }

    loadData(data: string): boolean {
        this.loaded.push(data);
        return this.accept;
    }

    getMEI(): string {
        return this.mei;
    }

    select(selection: Record<string, unknown>): boolean {
        this.selections.push(selection);
        return true;
    }

    redoLayout(): void {
        this.layout++;
    }

    getPageCount(): number {
        return this.pagesPerLayout[this.loaded.length === 2 ? 0 : this.layout] ?? 1;
    }

    renderToSVG(page: number): string {
        return `<svg width="2100px" height="2970px"><g data-layout="${this.layout}" data-page="${page}"/></svg>`;
    }
}

function mei(sections: number): string {
    const measures = Array.from({ length: sections }, (_, index) => `${index ? '<pb/>' : ''}<measure xml:id="m${index + 1}"/>`).join('');
    return `<mei xmlns="${MEI_NS}" xmlns:xml="http://www.w3.org/XML/1998/namespace"><music><body><mdiv><score><scoreDef/><section>${measures}</section></score></mdiv></body></music></mei>`;
}

function engraver(toolkit: FakeToolkit): ScoreRendererService {
    const service = new ScoreRendererService();
    spyOn(service as unknown as { engraving: () => Promise<FakeToolkit> }, 'engraving').and.resolveTo(toolkit);
    return service;
}

describe('ScoreRendererService.engrave', () => {
    it('lays out the first section with the header and the others as selections, numbering from the second page', async () => {
        const toolkit = new FakeToolkit(mei(3));
        toolkit.pagesPerLayout = [2, 1, 1];
        const options = resolveOptions({ header: { title: 'Marcia' } });

        const preview = await engraver(toolkit).engrave('<score-partwise/>', options);

        expect(toolkit.options['pageWidth']).toBe(2100);
        // MusicXML, prima sezione tagliata con l'intestazione, parte intera per le selezioni.
        expect(toolkit.loaded.length).toBe(3);
        expect(toolkit.loaded[1]).toContain('pgHead');
        expect(toolkit.loaded[1]).not.toContain('m2');
        expect(toolkit.loaded[2]).not.toContain('pgHead');
        expect(toolkit.selections).toEqual([
            { start: 'm2', end: 'm2' },
            { start: 'm3', end: 'm3' }
        ]);
        expect(preview.tooManyPages).toBeFalse();
        expect(preview.pages.length).toBe(4);
        expect(preview.pages[0]).not.toContain('pageNumber');
        expect(preview.pages[3]).toContain('>4</text>');
    });

    it('stops at the maximum number of pages and leaves the numbers out when not requested', async () => {
        const toolkit = new FakeToolkit(mei(2));
        toolkit.pagesPerLayout = [20, 20];

        const preview = await engraver(toolkit).engrave('<score-partwise/>', resolveOptions({ pageNumbers: false }));

        expect(preview.tooManyPages).toBeTrue();
        expect(preview.pages.length).toBe(20);
        expect(preview.pages.some((page) => page.includes('pageNumber'))).toBeFalse();
    });

    it('lays out a part without page breaks in one go and refuses an unreadable one', async () => {
        const toolkit = new FakeToolkit(mei(1));
        const preview = await engraver(toolkit).engrave('<score-partwise/>', resolveOptions({}));
        expect(toolkit.loaded.length).toBe(2);
        expect(toolkit.selections).toEqual([]);
        expect(preview.pages.length).toBe(1);

        const refused = new FakeToolkit(mei(1));
        refused.accept = false;
        await expectAsync(engraver(refused).engrave('<score-partwise/>', resolveOptions({}))).toBeRejectedWithError('Spartito non leggibile');
    });
});

describe('ScoreRendererService.render', () => {
    function renderer(toolkit: FakeToolkit): ScoreRendererService {
        const service = new ScoreRendererService();
        spyOn(service as unknown as { ready: () => Promise<FakeToolkit> }, 'ready').and.resolveTo(toolkit);
        return service;
    }
    const score = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flauto</part-name></score-part></part-list><part id="P1"><measure number="1"/></part></score-partwise>`;

    it('condenses the empty rows of a score and keeps their names', async () => {
        const toolkit = new FakeToolkit(mei(1));

        const pages = await renderer(toolkit).render(score, 1000, 50, { condense: true, partNames: true });

        expect(pages.length).toBe(1);
        expect(toolkit.options['condense']).toBe('auto');
        expect(toolkit.options['condenseFirstPage']).toBeTrue();
        expect(toolkit.loaded[0]).toContain('<part-name>Flauto</part-name>');
    });

    it('resets the compression and drops the names for a single part', async () => {
        const toolkit = new FakeToolkit(mei(1));

        await renderer(toolkit).render(score, 1000);

        expect(toolkit.options['condense']).toBe('none');
        expect(toolkit.options['condenseFirstPage']).toBeFalse();
        expect(toolkit.loaded[0]).not.toContain('Flauto');
    });
});

describe('withoutPartNames', () => {
    it('drops the names written beside the staves and keeps the notes and their ids', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flicorno tenore in Sib</part-name><part-name-display><display-text>Flic. ten.</display-text></part-name-display><part-abbreviation>Flic.</part-abbreviation></score-part></part-list><part id="P1"><measure number="1" id="te1-m1"><note id="te1-n1"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

        const result = new DOMParser().parseFromString(withoutPartNames(xml), 'application/xml');

        expect(result.querySelector('part-name')?.textContent).toBe('');
        expect(result.querySelector('part-abbreviation')?.textContent).toBe('');
        expect(result.querySelector('part-name-display')).toBeNull();
        expect(result.querySelector('note')?.getAttribute('id')).toBe('te1-n1');
        expect(result.querySelector('measure')?.getAttribute('id')).toBe('te1-m1');
    });

    it('leaves an unreadable document to Verovio', () => {
        expect(withoutPartNames('<score-partwise>')).toBe('<score-partwise>');
    });

    it('shows page breaks as line breaks when the written breaks are drawn', () => {
        const xml = `<score-partwise version="4.0"><part id="P1"><measure number="1"/><measure number="2"><print new-page="yes"/></measure><measure number="3"><print new-system="yes"/></measure></part></score-partwise>`;
        const prints = (value: string): string[] => Array.from(new DOMParser().parseFromString(value, 'application/xml').querySelectorAll('print')).map((print) => new XMLSerializer().serializeToString(print));

        expect(prints(forDisplay(xml, true))).toEqual(['<print new-system="yes"/>', '<print new-system="yes"/>']);
        expect(prints(forDisplay(xml, false))).toEqual(['<print new-page="yes"/>', '<print new-system="yes"/>']);
    });
});
