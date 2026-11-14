/**
 * Esegue i test con la copertura e fa fallire il comando se scende sotto la baseline.
 *
 * Il builder Angular genera la propria configurazione di Karma e non espone una soglia: qui si
 * legge il riepilogo che stampa e si confronta con i valori sotto. La baseline va alzata quando la
 * copertura sale, mai abbassata senza annotarlo nel Runbook di test.
 */
import { spawn } from 'node:child_process';

/** Baseline misurata sul ramo principale, in punti percentuali. */
const minimum = {
    statements: 71,
    branches: 62,
    lines: 73
};

const argv = process.argv.slice(2);
// `shell: true` serve su Windows, dove l'eseguibile di npx è uno script .cmd.
const test = spawn('npx ng test --watch=false --browsers=ChromeHeadless --code-coverage ' + argv.join(' '), {
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true
});

let output = '';
test.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
});

test.on('close', (code) => {
    if (code !== 0) process.exit(code ?? 1);

    const measured = {};
    for (const name of Object.keys(minimum)) {
        const found = new RegExp(`${name}\\s*:\\s*([0-9.]+)%`, 'i').exec(output);
        if (!found) {
            console.error(`Copertura non misurabile: il riepilogo non riporta "${name}".`);
            process.exit(1);
        }
        measured[name] = Number(found[1]);
    }

    const below = Object.entries(minimum).filter(([name, value]) => measured[name] < value);
    if (below.length > 0) {
        console.error('\nCopertura sotto la baseline:');
        below.forEach(([name, value]) => console.error(`- ${name}: ${measured[name]}% invece di almeno ${value}%`));
        process.exit(1);
    }

    const summary = Object.entries(measured)
        .map(([name, value]) => `${name} ${value}%`)
        .join(', ');
    console.log(`\nCopertura sopra la baseline: ${summary}.`);
});
