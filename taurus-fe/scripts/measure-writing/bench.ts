/**
 * Misure dell'editor di scrittura nel browser, con il codice dell'editor: apertura, tasto, impaginazione completa e
 * confronto tra versioni. `run.mjs` le impacchetta con esbuild e le esegue nel Chrome di Playwright.
 */
import { MeasureHistory } from '../../src/app/score-editor/edit-history';
import { combineParts, rowChecks } from '../../src/app/score-editor/score-arrangement';
import { openScore } from '../../src/app/score-editor/score-edits';
import { ScoreLayoutClient } from '../../src/app/score-editor/score-layout-client';
import { drawingExcerpt, drawingXml, measurePositions } from '../../src/app/score-editor/score-pages';
import { compareMeasures, readRows } from '../../src/app/score-player/score-compare';
import { drawingOptions, ScoreRendererService } from '../../src/app/service/score-renderer.service';

/** Larghezza degli spartiti e scala dell'editor, come nella finestra di scrittura. */
const WIDTH = 1000;
const EDITOR_SCALE = 50;
const PAGE_HEIGHT = 800;
/** Larghezza di ciascuno dei due spartiti affiancati del confronto. */
const COMPARE_WIDTH = 600;

const now = () => performance.now();
const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const elapsed = async <T>(action: () => T | Promise<T>): Promise<[T, number]> => {
    const start = now();
    const result = await action();

    return [result, now() - start];
};

/** Una parte del corpus allungata a `count` battute ripetendone il corpo, senza ritornelli né interruzioni. */
function extend(xml: string, count: number): string {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const part = document.querySelector('part')!;

    for (const barline of Array.from(document.querySelectorAll('barline'))) if (barline.querySelector('repeat, ending')) barline.remove();
    for (const print of Array.from(document.querySelectorAll('print'))) print.remove();
    const body = Array.from(part.children)
        .filter((item) => item.tagName === 'measure')
        .slice(1);
    let index = 0;

    while (part.children.length < count) {
        const copy = body[index++ % body.length].cloneNode(true) as Element;

        for (const attributes of Array.from(copy.querySelectorAll('attributes'))) attributes.remove();
        part.append(copy);
    }

    while (part.children.length > count) part.lastElementChild!.remove();
    Array.from(part.children).forEach((measure, position) => {
        measure.setAttribute('number', String(position + 1));
        measure.removeAttribute('id');
        measure.removeAttribute('implicit');
    });

    return new XMLSerializer().serializeToString(document);
}

async function corpus(name: string, measures: number): Promise<string> {
    return extend(await (await fetch(`/corpus/${name}.musicxml`)).text(), measures);
}

/** Parte di flauto, o partitura con il 40% di righi di flauto e il resto di tuba. */
async function build(rows: number, measures: number): Promise<string> {
    const flute = await corpus('flauto', measures);

    if (rows === 1) return flute;
    const tuba = await corpus('tuba', measures);

    return combineParts(
        Array.from({ length: rows }, (_, row) => ({ xml: row < Math.round(rows * 0.4) ? flute : tuba, name: `Rigo ${row + 1}` })),
        false
    );
}

/** Verovio caricato e già usato una volta, perché il suo avvio non entri nelle misure. */
async function warmRenderer(): Promise<ScoreRendererService> {
    const renderer = new ScoreRendererService();

    await renderer.renderPrepared(await build(1, 4), WIDTH, EDITOR_SCALE, {});

    return renderer;
}

/**
 * Apertura, impaginazione completa nel Web Worker e tasti di una parte o di una partitura. Ogni tasto cambia l'altezza
 * di una nota in una battuta diversa e ridisegna la pagina della battuta, come il disegno per pagine dell'editor.
 */
async function editor(rows: number, measures: number, keystrokes: number) {
    const arrangement = rows > 1;
    const host = document.getElementById('host')!;

    host.style.width = `${WIDTH}px`;
    const renderer = await warmRenderer();
    const xml = await build(rows, measures);
    const source = { partNames: arrangement, pageBreaksAsSystems: true };
    const drawing = { encodedBreaks: true, condense: arrangement, partNames: arrangement };
    const instruments = Array.from({ length: rows }, () => ({ instruments: [] }));

    // Apertura: documento, cronologia, controlli del rigo attivo e prima pagina provvisoria; dopo la prima pagina la
    // cronologia legge il documento e si controllano i righi.
    const [score, documentTime] = await elapsed(() => openScore(xml));
    const [history, historyTime] = await elapsed(() => new MeasureHistory(score, { deferred: true }));
    const [, checksTime] = await elapsed(() => score.checks());
    const provisional = Math.max(4, Math.round(40 / rows));
    const [, firstPage] = await elapsed(async () => {
        host.innerHTML = (await renderer.renderPrepared(drawingExcerpt(score, 0, provisional - 1, source), WIDTH, EDITOR_SCALE, drawing)).join('');
        host.getBoundingClientRect();
    });
    let checks: ReturnType<typeof rowChecks> = [];
    const [, deferred] = await elapsed(() => {
        history.prepare();
        if (arrangement) checks = rowChecks(score, instruments);
    });
    const open = { document: documentTime, history: historyTime, checks: checksTime, firstPage, total: documentTime + historyTime + checksTime + firstPage, deferred };

    // Impaginazione completa: MusicXML preparato nel thread principale, Verovio nel Web Worker.
    const client = new ScoreLayoutClient(() => new Worker('/layout-worker.js', { type: 'module' }));
    const options = drawingOptions(WIDTH, EDITOR_SCALE, { ...drawing, pageHeight: PAGE_HEIGHT });
    const [full, prepare] = await elapsed(() => drawingXml(score, source));
    const [pages, worker] = await elapsed(async () => (await client.layout(options, full))!);
    const layout = { prepare, worker, pages: pages.length };

    client.terminate();
    // Nel disegno per pagine solo le pagine vicine alla vista hanno il loro SVG.
    host.innerHTML = pages
        .slice(0, 3)
        .map((page) => `<div>${page.svg}</div>`)
        .join('');

    const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const names = ['checkpoint', 'edit', 'record', 'modified', 'checks', 'positions', 'excerpt', 'draw', 'insert', 'total'] as const;
    const samples = Object.fromEntries(names.map((name) => [name, [] as number[]])) as Record<(typeof names)[number], number[]>;
    const targets = [Math.floor(measures / 3), Math.floor(measures / 2), Math.floor((2 * measures) / 3), 5, measures - 3];

    for (let key = 0; key < keystrokes; key++) {
        const target = targets[key % targets.length];
        const start = now();
        const [before, checkpoint] = await elapsed(() => history.checkpoint(score));
        const [, edit] = await elapsed(() => {
            const part = score.parts()[(key * 7) % rows];
            const measure = Array.from(part.children).filter((item) => item.tagName === 'measure')[target];
            const step = measure.querySelector('pitch > step');

            if (step) step.textContent = steps[key % steps.length];
        });
        const [, record] = await elapsed(() => history.record(score, before, false));
        const [modified, modifiedTime] = await elapsed(() => history.modified(score));
        const [, checksStep] = await elapsed(() => {
            score.checks();
            const change = history.lastChange;

            if (arrangement) checks = rowChecks(score, instruments, change ? { checks, changed: change.rows } : undefined);
        });
        // La pagina ha le stesse battute: l'estratto tiene i sistemi del disegno, come nel disegno per pagine.
        const [page, positions] = await elapsed(() => {
            const position = measurePositions(score);
            const found = pages.find((candidate) => candidate.measureIds.some((id) => position.get(id) === target)) ?? pages[0];
            const at = (ids: readonly string[]) => ids.map((id) => position.get(id)).filter((value): value is number => value !== undefined);
            const drawn = at(found.measureIds);

            return { from: Math.min(...drawn), to: Math.max(...drawn), systems: new Set(at(found.systemIds)) };
        });
        const [excerptXml, excerpt] = await elapsed(() => drawingExcerpt(score, page.from, page.to, { ...source, systems: page.systems }));
        const [svgs, draw] = await elapsed(() => renderer.renderPrepared(excerptXml, WIDTH, EDITOR_SCALE, { ...drawing, encodedSystems: true }));
        const [, insert] = await elapsed(() => {
            (host.firstElementChild as HTMLElement).outerHTML = `<div>${svgs.join('')}</div>`;
            host.getBoundingClientRect();
        });

        if (!modified) throw new Error('Il tasto non ha cambiato il documento');
        const values = { checkpoint, edit, record, modified: modifiedTime, checks: checksStep, positions, excerpt, draw, insert, total: now() - start };

        for (const name of names) samples[name].push(values[name]);
    }

    const keystroke = Object.fromEntries(names.map((name) => [name, median(samples[name])]));

    return { open, layout, keystroke, keystrokeMax: Math.max(...samples.total) };
}

/**
 * Confronto di due versioni di una parte, come nel dialogo: lettura delle battute e confronto, poi le due versioni
 * disegnate affiancate. La seconda versione ha note cambiate, una battuta tolta e una aggiunta.
 */
async function compare(measures: number) {
    const renderer = await warmRenderer();
    const older = await corpus('flauto', measures);
    const document = new DOMParser().parseFromString(older, 'application/xml');
    const part = document.querySelector('part')!;
    const all = Array.from(part.children).filter((item) => item.tagName === 'measure');

    for (const [index, measure] of all.entries()) {
        const step = index % 25 === 7 ? measure.querySelector('pitch > step') : null;

        if (step) step.textContent = step.textContent === 'C' ? 'D' : 'C';
    }

    all[Math.floor(measures / 2)].remove();
    part.append(all[3].cloneNode(true));
    const newer = new XMLSerializer().serializeToString(document);

    const [[before, after], read] = await elapsed(() => [readRows(older), readRows(newer)]);
    const [comparison, match] = await elapsed(() => compareMeasures(after[0].measures, before[0].measures));
    const calc = read + match;
    const [, draw] = await elapsed(async () => {
        for (const [index, xml] of [older, newer].entries()) {
            const host = window.document.getElementById(index ? 'right' : 'left')!;

            host.style.width = `${COMPARE_WIDTH}px`;
            host.innerHTML = (await renderer.render(xml, COMPARE_WIDTH)).join('');
            host.querySelectorAll('g.measure');
        }
    });

    return { read, match, calc, draw, dialog: calc + draw, differences: comparison.differences.length };
}

(window as unknown as { measure: unknown }).measure = { editor, compare };
