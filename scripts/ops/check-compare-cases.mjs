#!/usr/bin/env node
// Controlla che il frontend e il servizio musicale confrontino le battute con la stessa regola: il
// confronto tra versioni del browser (`taurus-fe/src/app/score-player/score-compare.ts`) e lo
// strumento di accuratezza dei motori (`taurus-omr/accuracy/compare.py`) si provano sugli stessi
// casi, scritti da `python -m accuracy cases` in `taurus-omr/tests/compare_cases.json` e copiati in
// `taurus-fe/src/app/score-player/compare-cases.json`. Una regola cambiata in un solo modulo cambia
// i casi di uno solo: questo controllo fallisce se le due copie divergono.
//
//   node scripts/ops/check-compare-cases.mjs
//
// Esce 0 se le copie coincidono, a meno dei ritorni a capo, 1 altrimenti.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICE = 'taurus-omr/tests/compare_cases.json';
const FRONTEND = 'taurus-fe/src/app/score-player/compare-cases.json';

function read(path) {
    return readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
}

const service = read(SERVICE);
if (service !== read(FRONTEND)) {
    console.error(`I casi del confronto per battute sono diversi in ${FRONTEND} e ${SERVICE}:`);
    console.error(`  dopo un cambio della regola scrivi i casi con \`python -m accuracy cases\` in taurus-omr e copiali nel frontend.`);
    process.exit(1);
}
console.log(`Casi del confronto per battute uguali nei due moduli: ${JSON.parse(service).cases.length} casi.`);
