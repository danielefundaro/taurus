import { LayoutPage, LayoutRequest, LayoutResponse } from './score-layout';

interface Waiting {
    request: LayoutRequest;
    resolve(pages: LayoutPage[] | null): void;
    reject(error: Error): void;
}

/**
 * Il Web Worker dell'impaginazione visto dal thread principale. Verovio non si interrompe durante il disegno, quindi il
 * Web Worker riceve una richiesta alla volta: mentre lavora resta in attesa solo l'ultima, e quelle che sostituisce
 * terminano con `null`, come quella in corso quando nel frattempo ne è arrivata una nuova.
 */
export class ScoreLayoutClient {
    private worker?: Worker;
    private counter = 0;
    private running: Waiting | null = null;
    private queued: Waiting | null = null;

    constructor(private readonly create: () => Worker) {}

    /** Pagine del MusicXML con le opzioni di Verovio; `null` se una richiesta più recente l'ha superata. */
    layout(options: Record<string, unknown>, data: string): Promise<LayoutPage[] | null> {
        return new Promise((resolve, reject) => {
            const waiting: Waiting = { request: { id: ++this.counter, options, data }, resolve, reject };
            if (this.running) {
                this.queued?.resolve(null);
                this.queued = waiting;
                return;
            }
            this.send(waiting);
        });
    }

    /** Chiude il Web Worker e la sua memoria; una richiesta successiva ne avvia un altro. */
    terminate(): void {
        this.worker?.terminate();
        this.worker = undefined;
        this.running?.resolve(null);
        this.queued?.resolve(null);
        this.running = null;
        this.queued = null;
    }

    private send(waiting: Waiting): void {
        this.running = waiting;
        try {
            this.start().postMessage(waiting.request);
        } catch (error) {
            this.fail(error instanceof Error ? error : new Error('Impaginazione non disponibile'));
        }
    }

    private start(): Worker {
        if (this.worker) return this.worker;
        const worker = this.create();
        worker.addEventListener('message', (event: MessageEvent<LayoutResponse>) => this.answered(event.data));
        worker.addEventListener('error', (event) => {
            event.preventDefault();
            this.fail(new Error('Impaginazione non disponibile'));
        });
        this.worker = worker;
        return worker;
    }

    private answered(response: LayoutResponse): void {
        const running = this.running;
        if (!running || running.request.id !== response.id) return;
        this.running = null;
        if ('error' in response) running.reject(new Error('Spartito non leggibile'));
        else running.resolve(this.queued ? null : response.pages);
        const next = this.queued;
        this.queued = null;
        if (next) this.send(next);
    }

    /** Il Web Worker non si avvia o si è fermato: le richieste falliscono, e la prossima ne avvia uno nuovo. */
    private fail(error: Error): void {
        this.worker?.terminate();
        this.worker = undefined;
        const waiting = [this.running, this.queued];
        this.running = null;
        this.queued = null;
        for (const item of waiting) item?.reject(error);
    }
}
