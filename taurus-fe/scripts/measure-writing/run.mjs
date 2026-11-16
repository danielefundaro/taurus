/**
 * Misure ripetibili dell'editor di scrittura: `npm run measure:writing`.
 *
 * Impacchetta `bench.ts` con il codice dell'editor, lo serve con Verovio e il corpus del servizio musicale ed esegue le
 * misure nel Chrome di Playwright, anche con il processore rallentato attraverso il protocollo di Chrome. Stampa la
 * tabella della specifica (sezione Prestazioni); con `--json=<file>` salva anche i valori completi.
 *
 * Opzioni: `--case=part,score10,score30,compare` (predefinite tutte), `--rate=1,4` (rallentamenti del processore),
 * `--keys=15` (tasti per misura), `--repeat=3` (esecuzioni di ogni misura, di cui si riporta la mediana di ogni valore),
 * `--browser=chrome|chromium` (Chrome installato o il Chromium di Playwright).
 *
 * I tempi dipendono dal computer e dal suo carico, soprattutto con il processore rallentato: si confrontano solo misure
 * fatte di seguito sullo stesso computer, con le altre applicazioni chiuse.
 */
import { chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '../..');
const verovio = join(frontend, 'node_modules/verovio/dist');
const corpus = resolve(frontend, '../taurus-omr/accuracy/corpus');

const CASES = {
    part: { title: 'Parte di 300 battute', run: (keys) => ['editor', 1, 300, keys] },
    score10: { title: 'Partitura di 10 righi e 150 battute', run: (keys) => ['editor', 10, 150, keys] },
    score30: { title: 'Partitura di 30 righi e 150 battute', run: (keys) => ['editor', 30, 150, keys] },
    compare: { title: 'Confronto di due versioni di 300 battute', run: () => ['compare', 300] }
};

const options = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
        const [name, value = ''] = argument.replace(/^--/, '').split('=');

        return [name, value];
    })
);
const cases = (options.case || Object.keys(CASES).join(',')).split(',');
const rates = (options.rate || '1,4').split(',').map(Number);
const keys = Number(options.keys || 15);
const repeat = Number(options.repeat || 3);

for (const name of cases) if (!CASES[name]) throw new Error(`Misura sconosciuta: ${name}. Valori ammessi: ${Object.keys(CASES).join(', ')}`);
if (rates.some((rate) => !(rate >= 1))) throw new Error('Il rallentamento del processore va da 1 in su');
if (!(repeat >= 1 && keys >= 1)) throw new Error('Tasti ed esecuzioni vanno da 1 in su');

/** Mediana di ogni valore numerico di più esecuzioni della stessa misura, con la stessa forma. */
function medianOf(runs) {
    const [first] = runs;

    if (typeof first === 'number') return [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    if (first && typeof first === 'object') return Object.fromEntries(Object.keys(first).map((key) => [key, medianOf(runs.map((run) => run[key]))]));

    return first;
}

/** esbuild è quello del builder di Angular, già tra le dipendenze del frontend. */
async function bundle(outdir) {
    const angularBuild = createRequire(import.meta.url).resolve('@angular/build/package.json');
    const { build } = createRequire(angularBuild)('esbuild');

    await build({
        entryPoints: { bench: join(here, 'bench.ts'), 'layout-worker': join(here, 'layout-worker.ts') },
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        outdir,
        tsconfig: join(frontend, 'tsconfig.json'),
        logLevel: 'warning'
    });
}

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Misure della scrittura</title></head><body><div id="host"></div><div id="left"></div><div id="right"></div><script type="module" src="/bench.js"></script></body></html>';
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.musicxml': 'application/xml', '.html': 'text/html' };

function serve(outdir) {
    const roots = [
        ['/assets/verovio/', verovio],
        ['/corpus/', corpus],
        ['/', outdir]
    ];
    const server = createServer((request, response) => {
        const url = decodeURIComponent((request.url ?? '/').split('?')[0]);

        if (url === '/') {
            response.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE);

            return;
        }

        const [prefix, root] = roots.find(([start]) => url.startsWith(start));
        const file = resolve(root, url.slice(prefix.length));

        if (!file.startsWith(root + sep)) {
            response.writeHead(404).end();

            return;
        }

        try {
            const body = readFileSync(file);

            response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
        } catch {
            response.writeHead(404).end();
        }
    });

    return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

async function launch() {
    if (options.browser !== 'chromium') {
        try {
            return await chromium.launch({ channel: 'chrome', headless: true });
        } catch (error) {
            if (options.browser === 'chrome') throw error;
            console.warn('Chrome non trovato: si usa il Chromium di Playwright (npx playwright install chromium).');
        }
    }

    return chromium.launch({ headless: true });
}

/**
 * Una misura in un browser nuovo: il rallentamento del processore vale per il processo della pagina, che Chrome riusa
 * per la pagina successiva dello stesso sito, e due rallentamenti di fila si moltiplicano.
 */
async function measure(origin, call, rate) {
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    try {
        await page.goto(origin);
        await page.waitForFunction(() => 'measure' in window);
        if (rate > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });

        return { version: browser.version(), result: await page.evaluate(([name, ...args]) => window.measure[name](...args), call) };
    } catch (error) {
        throw new Error(`${call.join(' ')} con rallentamento ${rate}: ${errors.join('; ') || error.message}`);
    } finally {
        await browser.close();
    }
}

const seconds = (value) => (value === undefined ? '—' : `${(value / 1000).toFixed(value < 995 ? 2 : 1).replace('.', ',')} s`);

function table(results) {
    const editorRows = [
        ['Apertura fino alla prima pagina', (r) => r.open.total],
        ['di cui lettura del documento', (r) => r.open.document],
        ['di cui cronologia', (r) => r.open.history],
        ['di cui controlli', (r) => r.open.checks],
        ['di cui prima pagina', (r) => r.open.firstPage],
        ['Cronologia e controlli dei righi, dopo la prima pagina', (r) => r.open.deferred],
        ['Tasto → nota disegnata, mediana', (r) => r.keystroke.total],
        ['di cui disegno della pagina', (r) => r.keystroke.draw],
        ['di cui inserimento della pagina', (r) => r.keystroke.insert],
        ['di cui controlli', (r) => r.keystroke.checks],
        ['Tasto più lento', (r) => r.keystrokeMax],
        ['Impaginazione completa nel Web Worker', (r) => r.layout.prepare + r.layout.worker]
    ];
    const compareRows = [
        ['Calcolo del confronto', (r) => r.calc],
        ['di cui lettura delle due versioni', (r) => r.read],
        ['di cui confronto delle battute', (r) => r.match],
        ['Dialogo con i due disegni', (r) => r.dialog],
        ['di cui i due disegni', (r) => r.draw]
    ];
    const lines = [];
    const cell = (name, read) =>
        rates
            .map((rate, index) => {
                const result = results[name]?.[rate];
                const text = result ? seconds(read(result)) : '—';

                return index === 0 ? text : `(${text})`;
            })
            .join(' ');
    const editors = cases.filter((name) => name !== 'compare');

    if (editors.length) {
        lines.push(`| Misura | ${editors.map((name) => CASES[name].title).join(' | ')} |`, `| --- |${editors.map(() => ' --- |').join('')}`);
        for (const [label, read] of editorRows) lines.push(`| ${label} | ${editors.map((name) => cell(name, read)).join(' | ')} |`);
        lines.push(`| Pagine dell'impaginazione completa | ${editors.map((name) => results[name]?.[rates[0]]?.layout.pages ?? '—').join(' | ')} |`);
    }

    if (cases.includes('compare')) {
        if (lines.length) lines.push('');
        lines.push(`| Misura | ${CASES.compare.title} |`, '| --- | --- |');
        for (const [label, read] of compareRows) lines.push(`| ${label} | ${cell('compare', read)} |`);
    }

    return lines.join('\n');
}

const outdir = mkdtempSync(join(tmpdir(), 'taurus-measure-'));
let server;

try {
    await bundle(outdir);
    server = await serve(outdir);
    const origin = `http://127.0.0.1:${server.address().port}/`;
    const results = {};
    let version = '';

    for (const name of cases) {
        for (const rate of rates) {
            const runs = [];

            for (let run = 1; run <= repeat; run++) {
                process.stderr.write(`${CASES[name].title}, ${rate > 1 ? `processore rallentato ${rate} volte` : 'processore normale'}, esecuzione ${run} di ${repeat}…\n`);
                const measured = await measure(origin, CASES[name].run(keys), rate);

                version = measured.version;
                runs.push(measured.result);
            }

            (results[name] ??= {})[rate] = medianOf(runs);
        }
    }

    const slowed = rates.length > 1 ? `; tra parentesi il processore rallentato ${rates.slice(1).join(' e ')} volte` : rates[0] > 1 ? `; processore rallentato ${rates[0]} volte` : '';

    console.log(`Browser ${version}, mediana di ${repeat} esecuzioni e di ${keys} tasti${slowed}.\n`);
    console.log(table(results));
    if (options.json) writeFileSync(options.json, JSON.stringify({ browser: version, keys, repeat, rates, results }, null, 2));
} finally {
    server?.close();
    rmSync(outdir, { recursive: true, force: true });
}
