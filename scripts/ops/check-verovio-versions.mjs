#!/usr/bin/env node
// Controlla che Verovio abbia la stessa versione dovunque disegna uno spartito: nel frontend, che
// mostra l'anteprima dell'impaginazione e lo spartito di lettore ed editor, e nel servizio musicale
// (`taurus-omr`), che impagina le pagine e il PDF delle parti e disegna il corpus di accuratezza.
// Con versioni diverse l'anteprima del browser e le pagine generate potrebbero non coincidere: le
// versioni si aggiornano insieme, e questo controllo fallisce se divergono.
//
//   node scripts/ops/check-verovio-versions.mjs
//
// Esce 0 se tutte le versioni coincidono, 1 elencando dove si trovano le versioni diverse o mancanti.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(path) {
    return readFileSync(join(ROOT, path), 'utf8');
}

function npm() {
    const manifest = JSON.parse(read('taurus-fe/package.json'));
    const lock = JSON.parse(read('taurus-fe/package-lock.json'));
    return [
        ['taurus-fe/package.json', manifest.dependencies?.verovio],
        ['taurus-fe/package-lock.json', lock.packages?.['node_modules/verovio']?.version]
    ];
}

function pip(path) {
    const match = read(path).match(/^verovio==(\S+)\s*$/im);
    return [path, match?.[1]];
}

const found = [
    ...npm(),
    pip('taurus-omr/requirements.txt'),
    pip('taurus-omr/requirements-test.txt'),
    pip('taurus-omr/requirements-accuracy.txt')
];
const missing = found.filter(([, version]) => !version);
const versions = new Set(found.map(([, version]) => version).filter(Boolean));

if (missing.length > 0 || versions.size !== 1) {
    console.error('Verovio non ha la stessa versione in frontend e servizio musicale:');
    for (const [path, version] of found) console.error(`  ${path}: ${version ?? 'mancante'}`);
    process.exit(1);
}
console.log(`Verovio ${[...versions][0]} in ${found.length} file.`);
