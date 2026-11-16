import { LayoutRequest, LayoutResponse } from './score-layout';
import { ScoreLayoutClient } from './score-layout-client';

/** Web Worker simulato: tiene le richieste ricevute e risponde quando lo dice il test. */
class FakeWorker extends EventTarget {
    readonly requests: LayoutRequest[] = [];
    terminated = false;
    refuse = false;

    postMessage(request: LayoutRequest): void {
        if (this.refuse) throw new Error('chiuso');
        this.requests.push(request);
    }

    terminate(): void {
        this.terminated = true;
    }

    answer(response: LayoutResponse): void {
        this.dispatchEvent(new MessageEvent('message', { data: response }));
    }

    fail(): void {
        this.dispatchEvent(new Event('error', { cancelable: true }));
    }
}

const page = (id: string) => ({ svg: `<svg id="${id}"/>`, width: 100, height: 50, measureIds: [id], systemIds: [id] });

describe('ScoreLayoutClient', () => {
    let workers: FakeWorker[];
    let client: ScoreLayoutClient;

    beforeEach(() => {
        workers = [];
        client = new ScoreLayoutClient(() => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker as unknown as Worker;
        });
    });

    it('sends one request at a time and keeps only the last one waiting', async () => {
        const first = client.layout({ pageWidth: 1 }, 'a');
        const second = client.layout({ pageWidth: 2 }, 'b');
        const third = client.layout({ pageWidth: 3 }, 'c');

        expect(workers.length).toBe(1);
        const worker = workers[0];
        expect(worker.requests.map((request) => request.data)).toEqual(['a']);
        // La richiesta sostituita termina subito, quella in corso quando risponde: ce n'è una più recente.
        expect(await second).toBeNull();
        worker.answer({ id: worker.requests[0].id, pages: [page('m1')] });
        expect(await first).toBeNull();

        expect(worker.requests.map((request) => request.data)).toEqual(['a', 'c']);
        worker.answer({ id: worker.requests[1].id, pages: [page('m2')] });
        expect((await third)?.map((item) => item.measureIds)).toEqual([['m2']]);
    });

    it('ignores answers to other requests and rejects a document Verovio does not read', async () => {
        const result = client.layout({}, 'a');
        const worker = workers[0];
        worker.answer({ id: 99, pages: [] });
        worker.answer({ id: worker.requests[0].id, error: true });

        await expectAsync(result).toBeRejectedWithError('Spartito non leggibile');
        // Il Web Worker resta lo stesso per la richiesta successiva.
        void client.layout({}, 'b');
        expect(workers.length).toBe(1);
    });

    it('rejects the waiting requests when the worker stops and starts a new one next time', async () => {
        const running = client.layout({}, 'a');
        const queued = client.layout({}, 'b');
        workers[0].fail();

        await expectAsync(running).toBeRejectedWithError('Impaginazione non disponibile');
        await expectAsync(queued).toBeRejectedWithError('Impaginazione non disponibile');
        expect(workers[0].terminated).toBeTrue();

        void client.layout({}, 'c');
        expect(workers.length).toBe(2);
        expect(workers[1].requests.map((request) => request.data)).toEqual(['c']);
    });

    it('rejects a request the worker cannot receive', async () => {
        void client.layout({}, 'a').catch(() => null);
        workers[0].answer({ id: workers[0].requests[0].id, pages: [] });
        workers[0].refuse = true;

        await expectAsync(client.layout({}, 'b')).toBeRejectedWithError('chiuso');
    });

    it('ends the requests and closes the worker when terminated', async () => {
        const running = client.layout({}, 'a');
        const queued = client.layout({}, 'b');

        client.terminate();

        expect(await running).toBeNull();
        expect(await queued).toBeNull();
        expect(workers[0].terminated).toBeTrue();
        void client.layout({}, 'c');
        expect(workers.length).toBe(2);
    });
});
