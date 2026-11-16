import { LayoutPage } from '../../score-editor/score-layout';
import { PagedNotation } from './paged-notation';

const svg = (ids: readonly string[]): string => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">${ids.map((id) => `<g class="measure" id="${id}"></g>`).join('')}</svg>`;
const page = (ids: string[]): LayoutPage => ({ svg: svg(ids), width: 1000, height: 500, measureIds: ids, systemIds: [] });
/** Pagina con i sistemi indicati, ognuno con le sue battute. */
const systemsSvg = (rows: readonly string[][]): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">${rows.map((row) => `<g class="system">${row.map((id) => `<g class="measure" id="${id}"></g>`).join('')}</g>`).join('')}</svg>`;
const systemsPage = (rows: string[][]): LayoutPage => ({ svg: systemsSvg(rows), width: 1000, height: 500, measureIds: rows.flat(), systemIds: rows.map((row) => row[0]) });
const frame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));

async function settle(frames = 8): Promise<void> {
    for (let index = 0; index < frames; index++) await frame();
}

describe('PagedNotation', () => {
    let pane: HTMLElement;
    let container: HTMLElement;
    /** Battute del documento, nell'ordine, con gli `id` di un altro rigo. */
    let order: string[];
    let otherRow: Map<string, number>;
    let draw: jasmine.Spy<(from: number, to: number, systems: readonly number[] | null) => Promise<string[]>>;
    let drawn: jasmine.Spy<() => void>;
    let pager: PagedNotation;

    const pageElement = (index: number): HTMLElement => container.children[index] as HTMLElement;
    const drawnRanges = (): number[][] => draw.calls.allArgs().map(([from, to]) => [from, to]);

    beforeEach(() => {
        pane = document.createElement('div');
        pane.style.cssText = 'position: fixed; top: 0; left: 0; width: 500px; height: 300px; overflow: auto';
        container = document.createElement('div');
        pane.append(container);
        document.body.append(pane);
        order = Array.from({ length: 40 }, (_, index) => `m${index}`);
        otherRow = new Map();
        draw = jasmine.createSpy('draw').and.callFake(async (from: number, to: number) => [svg(order.slice(from, to + 1))]);
        drawn = jasmine.createSpy('drawn');
        pager = new PagedNotation(container, { draw, positions: () => new Map([...order.map((id, index): [string, number] => [id, index]), ...otherRow]), drawn });
    });

    afterEach(() => {
        pager.destroy();
        pane.remove();
    });

    it('draws the page of the focus at once and the provisional pages near the view one at a time', async () => {
        expect(pager.empty).toBeTrue();
        pager.provisional(40, 4, 200);
        expect(pager.empty).toBeFalse();
        expect(container.children.length).toBe(10);
        expect(pageElement(9).style.height).toBe('200px');

        await pager.refresh(21);
        expect(drawnRanges()).toContain([20, 23]);
        expect(pageElement(5).innerHTML).toContain('id="m21"');
        expect(drawn).toHaveBeenCalled();

        await settle();
        expect(drawnRanges()).toContain([0, 3]);
        expect(drawnRanges()).not.toContain([36, 39]);

        pane.scrollTop = pane.scrollHeight;
        await settle();
        expect(drawnRanges()).toContain([36, 39]);
    });

    it('shows the pages of the full layout near the view and the others when needed', async () => {
        const width = container.clientWidth;
        pager.layout(Array.from({ length: 6 }, (_, index) => page([`m${2 * index}`, `m${2 * index + 1}`])));

        expect(drawn).toHaveBeenCalledTimes(1);
        expect(pageElement(0).innerHTML).toContain('id="m0"');
        expect(pageElement(5).innerHTML).toBe('');
        // Il riquadro ha l'altezza della pagina alla larghezza dello spartito.
        expect(pageElement(5).style.height).toBe(`${Math.round((500 * width) / 1000)}px`);

        expect(pager.ensure(10)).toBeTrue();
        expect(pageElement(5).innerHTML).toContain('id="m10"');
        await settle(2);
        expect(draw).not.toHaveBeenCalled();
    });

    it('keeps the systems of the drawing while the page has the same measures', async () => {
        // Il nuovo disegno ha un sistema per battuta.
        draw.and.callFake(async (from: number, to: number) => [systemsSvg(order.slice(from, to + 1).map((id) => [id]))]);
        pager.layout([
            systemsPage([
                ['m0', 'm1'],
                ['m2', 'm3']
            ]),
            systemsPage([['m4', 'm5']])
        ]);

        pager.invalidate(new Set(['m1']));
        await pager.refresh(1);
        expect(draw).toHaveBeenCalledWith(0, 3, [0, 2]);

        // La pagina ricorda i sistemi del nuovo disegno.
        pager.invalidate(new Set(['m2']));
        await pager.refresh(2);
        expect(draw).toHaveBeenCalledWith(0, 3, [0, 1, 2, 3]);

        // Con una battuta nuova nella pagina, o senza la battuta che apre un sistema, Verovio va a capo dove serve.
        order.splice(2, 0, 'x');
        pager.invalidate(new Set(['x']));
        await pager.refresh(2);
        expect(draw).toHaveBeenCalledWith(0, 4, null);
        order.splice(order.indexOf('m4'), 1);
        pager.invalidate(new Set(['m4']));
        await pager.refresh(5);
        expect(draw).toHaveBeenCalledWith(5, 5, null);
    });

    it('redraws only the changed pages, also for measures of another row or new measures', async () => {
        pager.layout(Array.from({ length: 6 }, (_, index) => page([`m${2 * index}`, `m${2 * index + 1}`])));
        // Un'altra riga della partitura ha le sue battute: Verovio disegna l'`id` di una sola.
        otherRow.set('r2-m4', 4);

        pager.invalidate(new Set(['r2-m4']));
        await pager.refresh(4);
        expect(drawnRanges()).toEqual([[4, 5]]);

        // Una battuta nuova va con la pagina che la precede, che si allunga fino a lei.
        order.splice(2, 0, 'new');
        pager.invalidate(new Set(['new']));
        await pager.refresh(2);
        expect(drawnRanges()).toEqual([
            [4, 5],
            [0, 2]
        ]);
        expect(pageElement(0).innerHTML).toContain('id="new"');

        // Una battuta in fondo va con l'ultima pagina.
        order.push('last');
        pager.invalidate(new Set(['last']));
        await pager.refresh(order.length - 1);
        expect(draw.calls.mostRecent().args).toEqual([11, 41, null]);
    });

    it('draws a stale page when asked, telling when it is ready', async () => {
        pager.layout(Array.from({ length: 6 }, (_, index) => page([`m${2 * index}`, `m${2 * index + 1}`])));
        drawn.calls.reset();
        pager.invalidate(null);

        expect(pager.ensure(10)).toBeFalse();
        await settle(1);
        expect(drawnRanges()).toContain([10, 11]);
        expect(drawn).toHaveBeenCalled();
        expect(pager.ensure(10)).toBeTrue();
    });

    it('keeps a page that does not draw for the next change, without trying again at every frame', async () => {
        draw.and.rejectWith(new Error('Spartito non leggibile'));
        pager.provisional(8, 4, 200);
        await pager.refresh(0);
        await settle();
        expect(drawnRanges()).toEqual([
            [0, 3],
            [4, 7]
        ]);
        expect(pager.ensure(0)).toBeTrue();

        draw.and.callFake(async (from: number, to: number) => [svg(order.slice(from, to + 1))]);
        pager.invalidate(new Set(['m1']));
        await pager.refresh(1);
        expect(pageElement(0).innerHTML).toContain('id="m1"');
    });

    it('drops an excerpt that ends after the full layout has arrived', async () => {
        let finish: (pages: string[]) => void = () => undefined;
        draw.and.returnValue(new Promise((resolve) => (finish = resolve)));
        pager.provisional(4, 4, 200);
        expect(draw).toHaveBeenCalledTimes(1);

        pager.layout([page(['m0', 'm1', 'm2', 'm3'])]);
        finish([svg(['old'])]);
        await settle(2);

        expect(container.innerHTML).not.toContain('id="old"');
        expect(pageElement(0).innerHTML).toContain('id="m3"');
    });

    it('empties the notation and stops following the scrolling when destroyed', async () => {
        pager.provisional(40, 4, 200);
        await settle();
        draw.calls.reset();

        pager.destroy();
        expect(container.children.length).toBe(0);
        expect(pager.empty).toBeTrue();
        pane.dispatchEvent(new Event('scroll'));
        await settle(2);
        expect(draw).not.toHaveBeenCalled();
    });
});
