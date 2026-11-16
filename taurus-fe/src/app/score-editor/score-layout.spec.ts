import { layoutPage, layoutPages, LayoutToolkit, pageMeasureIds } from './score-layout';

/** Toolkit Verovio simulato: disegna le pagine indicate, ognuna con le sue battute. */
class FakeToolkit implements LayoutToolkit {
    options: Record<string, unknown> = {};
    loaded = '';
    accept = true;

    constructor(private readonly pages: string[][]) {}

    setOptions(options: Record<string, unknown>): void {
        this.options = options;
    }

    loadData(data: string): boolean {
        this.loaded = data;
        return this.accept;
    }

    getPageCount(): number {
        return this.pages.length;
    }

    renderToSVG(page = 1): string {
        const measures = this.pages[page - 1].map((id) => `<g id="${id}" class="measure"><g class="staff"/></g>`).join('');
        return `<svg viewBox="0 0 1000 ${400 * page}"><g class="page-margin">${measures}</g></svg>`;
    }
}

describe('score layout', () => {
    it('lays out every page with its size and its measures', () => {
        const toolkit = new FakeToolkit([['m1', 'm2'], ['m3']]);

        const response = layoutPages(toolkit, { id: 4, options: { pageWidth: 2000 }, data: '<score-partwise/>' });

        expect(toolkit.options).toEqual({ pageWidth: 2000 });
        expect(toolkit.loaded).toBe('<score-partwise/>');
        expect('pages' in response && response.pages.map((page) => [page.width, page.height, page.measureIds])).toEqual([
            [1000, 400, ['m1', 'm2']],
            [1000, 800, ['m3']]
        ]);
        expect(response.id).toBe(4);
    });

    it('answers with an error when Verovio does not read the document', () => {
        const toolkit = new FakeToolkit([['m1']]);
        toolkit.accept = false;

        expect(layoutPages(toolkit, { id: 2, options: {}, data: 'x' })).toEqual({ id: 2, error: true });
    });

    it('reads the measures in drawing order, with the class before or after the id', () => {
        const svg = '<svg><g class="measure" id="a"/><g class="measure-number" id="n"/><g id="b" data-n="2" class="measure is-wrong"><g class="note" id="c"/></g></svg>';

        expect(pageMeasureIds(svg)).toEqual(['a', 'b']);
        expect(layoutPage(svg)).toEqual({ svg, width: 0, height: 0, measureIds: ['a', 'b'] });
        expect(layoutPage('<svg viewBox="0,0, 640.5 , 300"/>').width).toBe(640.5);
    });
});
