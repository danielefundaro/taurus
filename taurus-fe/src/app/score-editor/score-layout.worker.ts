/// <reference lib="webworker" />
import { LayoutRequest, LayoutResponse, LayoutToolkit, layoutPages } from './score-layout';

/**
 * Pacchetto Verovio tra gli asset, risolto dalla posizione del Web Worker: lo stesso file del thread principale, così il
 * service worker lo scarica una volta sola.
 */
const VEROVIO_URL = 'assets/verovio/verovio-toolkit-wasm.js';

interface VerovioGlobal {
    module: { onRuntimeInitialized?: () => void };
    toolkit: new () => LayoutToolkit;
}

let toolkit: Promise<LayoutToolkit> | undefined;

/** Il pacchetto è un modulo UMD: importato come modulo definisce `verovio` sull'oggetto globale. */
async function load(): Promise<LayoutToolkit> {
    await import(/* @vite-ignore */ new URL(VEROVIO_URL, self.location.href).href);
    const verovio = (globalThis as unknown as { verovio?: VerovioGlobal }).verovio;
    if (!verovio) throw new Error('Verovio non disponibile');
    await new Promise<void>((resolve) => {
        verovio.module.onRuntimeInitialized = () => resolve();
    });
    return new verovio.toolkit();
}

addEventListener('message', async (event: MessageEvent<LayoutRequest>) => {
    const request = event.data;
    let response: LayoutResponse;
    try {
        toolkit ??= load();
        response = layoutPages(await toolkit, request);
    } catch {
        toolkit = undefined;
        response = { id: request.id, error: true };
    }
    postMessage(response);
});
