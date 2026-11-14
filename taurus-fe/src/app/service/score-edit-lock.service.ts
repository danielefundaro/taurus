import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { EditLock } from '../module';
import { ApiErrorService } from './api-error.service';
import { withErrorSummary, withHandledErrors } from './api-error-context';

/** Rinnovo del blocco: il server lo fa scadere dopo due minuti senza rinnovi. */
export const EDIT_LOCK_RENEWAL_MS = 30_000;

const LOCKED = 'scoreWriting.locked';

/**
 * - `acquiring`: la richiesta del blocco è in corso;
 * - `held`: il blocco è di questa finestra, che può modificare e salvare;
 * - `locked`: un altro autore, o un'altra finestra, possiede il blocco: l'editor è in sola lettura;
 * - `lost`: un altro ha preso il controllo mentre questa finestra modificava;
 * - `unavailable`: il blocco non si è potuto prendere per un altro motivo, per esempio la rete;
 * - `released`: l'editor è stato chiuso.
 */
export type EditLockStatus = 'acquiring' | 'held' | 'locked' | 'lost' | 'unavailable' | 'released';

export interface EditLockState {
    status: EditLockStatus;
    /** Perché l'editor è in sola lettura, per esempio «In modifica da Mario Rossi dalle 10:32». */
    message: string | null;
}

/**
 * Blocco di una parte per una finestra dell'editor, di scrittura o di correzione: un solo autore alla volta. Il blocco
 * si prende all'apertura, si rinnova ogni 30 secondi e si rilascia alla chiusura; se il browser si chiude scade da solo.
 */
export class PartEditLock {
    /** Sessione della finestra, inviata con bozze e versioni: il server le accetta solo da chi possiede il blocco. */
    readonly session = newSession();
    private readonly current = signal<EditLockState>({ status: 'acquiring', message: null });
    readonly state = this.current.asReadonly();
    private timer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly http: HttpClient,
        private readonly apiErrors: ApiErrorService,
        private readonly url: string
    ) {}

    get held(): boolean {
        return this.current().status === 'held';
    }

    /**
     * Prende il blocco; con `takeOver` lo toglie a chi lo possiede, che passa in sola lettura. Restituisce `false` se il
     * blocco resta a un altro o non si è potuto prendere: lo stato dice perché.
     */
    async acquire(takeOver = false): Promise<boolean> {
        if (this.current().status === 'released') return false;
        const params = new HttpParams().set('takeOver', takeOver);
        const context = withHandledErrors([LOCKED], withErrorSummary(takeOver ? 'Controllo non preso' : 'Blocco non disponibile'));
        try {
            await firstValueFrom(this.http.post<EditLock>(this.url, { session: this.session }, { params, context }));
        } catch (error) {
            if (this.current().status === 'released') return false;
            const resolved = this.apiErrors.resolve(error as HttpErrorResponse);
            this.current.set({ status: resolved.key === LOCKED ? 'locked' : 'unavailable', message: resolved.detail });
            return false;
        }
        if (this.current().status === 'released') {
            this.delete();
            return false;
        }
        this.current.set({ status: 'held', message: null });
        this.schedule();
        return true;
    }

    /**
     * Registra un rifiuto del server per il blocco, per esempio al salvataggio: un altro ha preso il controllo. Restituisce
     * `true` se l'errore riguardava il blocco.
     */
    refused(error: unknown): boolean {
        if (!(error instanceof HttpErrorResponse)) return false;
        const resolved = this.apiErrors.resolve(error);
        if (resolved.key !== LOCKED) return false;
        this.lose(resolved.detail);
        return true;
    }

    /** Rilascia il blocco alla chiusura dell'editor. */
    release(): void {
        const held = this.held;
        this.stop();
        this.current.set({ status: 'released', message: null });
        if (held) this.delete();
    }

    private schedule(): void {
        this.stop();
        this.timer = setInterval(() => this.renew(), EDIT_LOCK_RENEWAL_MS);
    }

    private renew(): void {
        // Rinnovi in silenzio: un problema di rete passeggero non deve mostrare un avviso ogni 30 secondi.
        this.http.put<EditLock>(this.url, { session: this.session }, { context: withHandledErrors(['*']) }).subscribe({
            error: (error: HttpErrorResponse) => {
                if (!this.held) return;
                const resolved = this.apiErrors.resolve(error);
                if (resolved.key === LOCKED) this.lose(resolved.detail);
                // Con la rete assente o il server in difficoltà il blocco resta valido fino alla scadenza: si riprova.
                else if (error.status !== 0 && error.status < 500) this.lose(resolved.detail, 'unavailable');
            }
        });
    }

    private lose(message: string, status: EditLockStatus = 'lost'): void {
        if (this.current().status === 'released') return;
        this.stop();
        this.current.set({ status, message });
    }

    private delete(): void {
        const params = new HttpParams().set('session', this.session);
        this.http.delete<void>(this.url, { params, context: withHandledErrors(['*']) }).subscribe({ error: () => undefined });
    }

    private stop(): void {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
    }
}

/** Blocchi delle parti per gli editor di scrittura e di correzione. */
@Injectable({ providedIn: 'root' })
export class ScoreEditLockService {
    constructor(
        private readonly http: HttpClient,
        private readonly apiErrors: ApiErrorService
    ) {}

    /** Blocco di una parte per una finestra dell'editor: va preso con `acquire` e rilasciato con `release`. */
    forPart(trackId: number, scoreId: number): PartEditLock {
        return new PartEditLock(this.http, this.apiErrors, `${environment.baseUrl}/tracks/${trackId}/scores/${scoreId}/edit-lock`);
    }
}

/** Identificativo casuale della finestra, come lo accetta il server: da 8 a 64 lettere, cifre e trattini. */
function newSession(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
