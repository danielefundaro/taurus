import { HttpClient, HttpContext, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { DraftSaved, NewWrittenPart, ScoreDraft, WrittenPart } from '../module';
import { ApiErrorService } from './api-error.service';
import { withHandledErrors } from './api-error-context';
import { KeycloakService } from './keycloak.service';
import { PartEditLock } from './score-edit-lock.service';

/** La bozza si salva pochi secondi dopo l'ultima modifica... */
export const DRAFT_DELAY_MS = 3_000;
/** ...e comunque al più tardi 30 secondi dopo la prima modifica non salvata. */
export const DRAFT_MAX_WAIT_MS = 30_000;
/** Nuovo tentativo dopo un salvataggio troppo vicino al precedente. */
export const DRAFT_RETRY_MS = 2_000;
/** Senza rete si riprova al ritorno della connessione, e comunque dopo questo intervallo. */
export const DRAFT_OFFLINE_RETRY_MS = 30_000;
/** Ritardo della copia nel browser dopo una modifica. */
export const LOCAL_COPY_DELAY_MS = 500;

const LOCKED = 'scoreWriting.locked';
const CONFLICT = 'scoreWriting.draftConflict';
const TOO_FREQUENT = 'scoreWriting.draftTooFrequent';

/** Copia nel browser delle modifiche non ancora accettate dal server. */
export interface LocalDraftCopy {
    /** Tenant, utente, traccia e parte. */
    key: string;
    content: string;
    baseVersionId: number | null;
    /** Versione della bozza sul server da cui partono le modifiche; `null` se non c'era una bozza. */
    entityVersion: number | null;
    /** Prima e ultima modifica non salvata sul server, ISO 8601. */
    changedFrom: string;
    changedAt: string;
}

/**
 * Archivio delle copie nel browser. Vive solo nel browser in cui è stata fatta la copia; i suoi errori non fermano
 * l'editor, che continua a salvare sul server.
 */
@Injectable({ providedIn: 'root', useFactory: () => new IndexedDbDraftStore() })
export abstract class LocalDraftStore {
    abstract get(key: string): Promise<LocalDraftCopy | null>;
    abstract put(copy: LocalDraftCopy): Promise<void>;
    abstract delete(key: string): Promise<void>;
}

/** Copie nel database IndexedDB del browser; senza IndexedDB, per esempio in navigazione privata, non conserva nulla. */
export class IndexedDbDraftStore extends LocalDraftStore {
    private static readonly STORE = 'drafts';
    private database?: Promise<IDBDatabase | null>;

    constructor(private readonly name = 'taurus-score-drafts') {
        super();
    }

    async get(key: string): Promise<LocalDraftCopy | null> {
        const database = await this.open();
        if (!database) return null;
        try {
            const copy = await request<LocalDraftCopy | undefined>(database.transaction(IndexedDbDraftStore.STORE, 'readonly').objectStore(IndexedDbDraftStore.STORE).get(key));
            return copy ?? null;
        } catch {
            return null;
        }
    }

    async put(copy: LocalDraftCopy): Promise<void> {
        await this.write((store) => store.put(copy));
    }

    async delete(key: string): Promise<void> {
        await this.write((store) => store.delete(key));
    }

    /** Chiude il database, per esempio prima di eliminarlo nei test. */
    async close(): Promise<void> {
        (await this.open())?.close();
        this.database = undefined;
    }

    private async write(action: (store: IDBObjectStore) => IDBRequest): Promise<void> {
        const database = await this.open();
        if (!database) return;
        try {
            const transaction = database.transaction(IndexedDbDraftStore.STORE, 'readwrite');
            action(transaction.objectStore(IndexedDbDraftStore.STORE));
            await new Promise<void>((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        } catch {
            // Quota esaurita o database non disponibile: resta il salvataggio sul server.
        }
    }

    private open(): Promise<IDBDatabase | null> {
        this.database ??= new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') {
                resolve(null);
                return;
            }
            try {
                const opening = indexedDB.open(this.name, 1);
                opening.onupgradeneeded = () => opening.result.createObjectStore(IndexedDbDraftStore.STORE, { keyPath: 'key' });
                opening.onsuccess = () => resolve(opening.result);
                opening.onerror = () => resolve(null);
                opening.onblocked = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
        return this.database;
    }
}

/**
 * - `clean`: nessuna modifica dall'apertura o dall'ultimo salvataggio;
 * - `pending`: modifiche in attesa del salvataggio automatico;
 * - `saving`: salvataggio in corso;
 * - `saved`: il server ha tutte le modifiche;
 * - `offline`: il server non risponde: le modifiche restano nel browser e si riprova al ritorno della connessione;
 * - `rejected`: il server ha rifiutato la bozza perché un altro ha il blocco: la copia resta nel browser;
 * - `conflict`: la bozza sul server è cambiata altrove: l'autore sceglie se tenere le sue modifiche;
 * - `failed`: il server ha rifiutato il contenuto, per esempio perché troppo grande;
 * - `stopped`: la scrittura è finita, con una versione salvata, una bozza scartata o l'editor chiuso.
 */
export type DraftStatus = 'clean' | 'pending' | 'saving' | 'saved' | 'offline' | 'rejected' | 'conflict' | 'failed' | 'stopped';

export interface DraftState {
    status: DraftStatus;
    /** Ultimo salvataggio accettato dal server, ISO 8601. */
    savedAt: string | null;
    message: string | null;
}

/** Ciò che serve a una finestra dell'editor per tenere la bozza di una parte. */
export interface DraftKeeperOptions {
    lock: PartEditLock;
    /** MusicXML attuale dell'editor, letto a ogni salvataggio. */
    content: () => string;
    baseVersionId: number | null;
    /** Versione della bozza sul server da cui parte l'editor; `null` senza bozza. */
    entityVersion: number | null;
    savedAt?: string | null;
}

/**
 * Bozza di una parte per una finestra dell'editor di scrittura: si salva da sola poco dopo le modifiche, ne tiene una
 * copia nel browser finché il server non la accetta, e dice all'editor quando il server la rifiuta.
 */
export class PartDraftKeeper {
    private readonly current = signal<DraftState>({ status: 'clean', savedAt: null, message: null });
    readonly state = this.current.asReadonly();
    private baseVersionId: number | null;
    private version: number | null;
    private revision = 0;
    private savedRevision = 0;
    private firstUnsaved: number | null = null;
    private changedFrom: string | null = null;
    private changedAt: string | null = null;
    private timer?: ReturnType<typeof setTimeout>;
    private localTimer?: ReturnType<typeof setTimeout>;
    private inFlight: Promise<boolean> | null = null;
    private local: Promise<void> = Promise.resolve();
    private held = false;
    private readonly online = () => this.retryOffline();

    constructor(
        private readonly http: HttpClient,
        private readonly apiErrors: ApiErrorService,
        private readonly store: LocalDraftStore,
        private readonly url: string,
        readonly key: string,
        private readonly options: DraftKeeperOptions
    ) {
        this.baseVersionId = options.baseVersionId;
        this.version = options.entityVersion;
        this.current.set({ status: 'clean', savedAt: options.savedAt ?? null, message: null });
    }

    /** Ci sono modifiche che il server non ha. */
    get dirty(): boolean {
        return this.revision !== this.savedRevision;
    }

    /** Versione della bozza sul server, da inviare con il salvataggio successivo. */
    get entityVersion(): number | null {
        return this.version;
    }

    /** Una modifica dell'editor: la copia nel browser si aggiorna subito dopo, la bozza sul server pochi secondi dopo. */
    changed(): void {
        const status = this.current().status;
        if (status === 'stopped') return;
        this.revision++;
        const now = Date.now();
        this.firstUnsaved ??= now;
        this.changedFrom ??= new Date(now).toISOString();
        this.changedAt = new Date(now).toISOString();
        this.scheduleLocal();
        // Dopo un rifiuto o un conflitto decide l'autore; senza rete si aspetta la connessione.
        if (status === 'rejected' || status === 'conflict' || status === 'offline' || status === 'failed') return;
        if (status !== 'saving') this.current.update((state) => ({ ...state, status: 'pending', message: null }));
        if (!this.held) this.schedule(Math.min(DRAFT_DELAY_MS, Math.max(0, this.firstUnsaved + DRAFT_MAX_WAIT_MS - now)));
    }

    /** Salva subito, alla chiusura dell'editor. `true` se il server ha tutte le modifiche. */
    async flush(): Promise<boolean> {
        this.clearTimer();
        if (this.current().status === 'stopped') return !this.dirty;
        await this.writeLocalNow();
        if (this.current().status === 'rejected' || this.current().status === 'conflict') return false;
        return this.save();
    }

    /** Sospende i salvataggi automatici e attende quello in corso, prima di salvare una versione. */
    async hold(): Promise<void> {
        this.held = true;
        this.clearTimer();
        await this.writeLocalNow();
        if (this.inFlight) await this.inFlight;
    }

    /** Riprende i salvataggi automatici dopo `hold`, se la versione non si è potuta salvare. */
    resume(): void {
        this.held = false;
        if (this.dirty && this.current().status === 'pending') this.schedule(DRAFT_DELAY_MS);
    }

    /** La versione è stata salvata e il server ha eliminato la bozza: si elimina anche la copia nel browser. */
    async completed(): Promise<void> {
        this.stop();
        this.savedRevision = this.revision;
        await this.enqueueLocal(() => this.store.delete(this.key));
    }

    /** Scarta la bozza sul server e la copia nel browser. */
    async discard(): Promise<void> {
        this.stop();
        this.savedRevision = this.revision;
        const params = new HttpParams().set('session', this.options.lock.session);
        await this.enqueueLocal(() => this.store.delete(this.key));
        await firstValueFrom(this.http.delete<void>(this.url, { params }));
    }

    /** Scarta solo la copia nel browser, per esempio dopo un rifiuto: l'autore ha scelto **Scarta**. */
    async forget(): Promise<void> {
        this.stop();
        this.savedRevision = this.revision;
        await this.enqueueLocal(() => this.store.delete(this.key));
    }

    /** Dopo un conflitto, l'autore tiene le sue modifiche: sostituiscono la bozza attuale del server. */
    async overwrite(): Promise<boolean> {
        if (this.current().status === 'stopped') return false;
        const response = await firstValueFrom(this.http.get<ScoreDraft>(this.url, { observe: 'response' }));
        this.version = response.status === 204 || !response.body ? null : response.body.entityVersion;
        this.current.update((state) => ({ ...state, status: 'pending', message: null }));
        this.held = false;
        return this.save();
    }

    /**
     * Dopo un rifiuto, con il blocco ripreso: le modifiche ripartono verso il server con la versione nota della bozza.
     * Se nel frattempo chi aveva il blocco ha salvato la sua bozza, il server risponde con un conflitto e decide l'autore.
     */
    async retry(): Promise<boolean> {
        if (this.current().status === 'stopped') return false;
        this.current.update((state) => ({ ...state, status: 'pending', message: null }));
        this.held = false;
        return this.save();
    }

    /** Dopo un conflitto, l'autore riparte dalla bozza del server, che l'editor ha caricato. */
    async reset(draft: ScoreDraft | null): Promise<void> {
        this.clearTimer();
        this.version = draft?.entityVersion ?? null;
        this.baseVersionId = draft ? draft.baseVersionId : this.baseVersionId;
        this.savedRevision = this.revision;
        this.firstUnsaved = null;
        this.changedFrom = null;
        this.changedAt = null;
        this.held = false;
        this.current.set({ status: 'clean', savedAt: draft?.savedAt ?? null, message: null });
        await this.enqueueLocal(() => this.store.delete(this.key));
    }

    /** Ferma i salvataggi automatici; la copia nel browser resta. */
    stop(): void {
        this.clearTimer();
        if (this.localTimer !== undefined) clearTimeout(this.localTimer);
        this.localTimer = undefined;
        window.removeEventListener('online', this.online);
        this.current.update((state) => ({ ...state, status: 'stopped' }));
    }

    /** Copia nel browser come sarebbe ora, per scaricarla come MusicXML. */
    content(): string {
        return this.options.content();
    }

    private save(): Promise<boolean> {
        this.clearTimer();
        if (this.inFlight) return this.inFlight.then(() => (this.dirty && this.current().status === 'pending' ? this.save() : !this.dirty));
        if (!this.dirty) {
            if (this.current().status === 'pending') this.current.update((state) => ({ ...state, status: state.savedAt ? 'saved' : 'clean' }));
            return Promise.resolve(true);
        }
        const revision = this.revision;
        const body = { editSession: this.options.lock.session, content: this.options.content(), baseVersionId: this.baseVersionId, entityVersion: this.version };
        this.current.update((state) => ({ ...state, status: 'saving', message: null }));
        this.inFlight = firstValueFrom(this.http.put<DraftSaved>(this.url, body, { context: withHandledErrors(['*']) }))
            .then((saved) => {
                this.version = saved.entityVersion;
                this.savedRevision = revision;
                window.removeEventListener('online', this.online);
                if (this.current().status === 'stopped') return true;
                if (this.dirty) {
                    // Modifiche arrivate durante il salvataggio: il loro salvataggio è già in programma.
                    this.firstUnsaved = Date.now();
                    this.current.set({ status: 'pending', savedAt: saved.savedAt, message: null });
                    if (!this.held && this.timer === undefined) this.schedule(DRAFT_DELAY_MS);
                } else {
                    this.firstUnsaved = null;
                    this.changedFrom = null;
                    this.changedAt = null;
                    this.current.set({ status: 'saved', savedAt: saved.savedAt, message: null });
                    void this.enqueueLocal(() => (this.dirty ? Promise.resolve() : this.store.delete(this.key)));
                }
                return !this.dirty;
            })
            .catch((error: unknown) => {
                this.failed(error);
                return false;
            })
            .finally(() => (this.inFlight = null));
        return this.inFlight;
    }

    private failed(error: unknown): void {
        if (this.current().status === 'stopped') return;
        const response = error instanceof HttpErrorResponse ? error : null;
        // Il salvataggio troppo vicino al precedente non ha un messaggio: si riprova e basta.
        if (response?.status === 429 && response.error?.message === `error.${TOO_FREQUENT}`) {
            this.current.update((state) => ({ ...state, status: 'pending' }));
            if (!this.held) this.schedule(DRAFT_RETRY_MS);
            return;
        }
        const resolved = response ? this.apiErrors.resolve(response) : null;
        if (resolved?.key === LOCKED) {
            this.options.lock.refused(error);
            this.current.update((state) => ({ ...state, status: 'rejected', message: this.rejectedMessage(resolved.args) }));
        } else if (resolved?.key === CONFLICT) {
            this.current.update((state) => ({ ...state, status: 'conflict', message: resolved.detail }));
        } else if (!response || response.status === 0 || response.status >= 500) {
            this.current.update((state) => ({ ...state, status: 'offline', message: 'Bozza non salvata: il server non risponde. Le modifiche restano in questo browser.' }));
            window.addEventListener('online', this.online);
            this.schedule(DRAFT_OFFLINE_RETRY_MS);
        } else {
            this.current.update((state) => ({ ...state, status: 'failed', message: resolved?.detail ?? 'Bozza non salvata' }));
        }
    }

    private retryOffline(): void {
        if (this.current().status !== 'offline') return;
        window.removeEventListener('online', this.online);
        this.current.update((state) => ({ ...state, status: 'pending' }));
        if (!this.held) void this.save();
    }

    /** «Le modifiche dalle 10:32 alle 10:41 non sono state salvate: ora sta scrivendo Mario Rossi». */
    private rejectedMessage(args: Record<string, unknown>): string {
        const from = timeOfDay(this.changedFrom);
        const to = timeOfDay(this.changedAt);
        const when = !from ? 'Le modifiche' : from === to || !to ? `Le modifiche delle ${from}` : `Le modifiche dalle ${from} alle ${to}`;
        const owner = typeof args['ownerName'] === 'string' && args['ownerName'].trim() ? args['ownerName'].trim() : 'un altro utente';
        const who = args['sameUser'] === true ? "la parte è aperta in un'altra finestra" : `ora sta scrivendo ${owner}`;
        return `${when} non sono state salvate: ${who}`;
    }

    private schedule(delay: number): void {
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (this.current().status === 'offline') this.retryOffline();
            else void this.save();
        }, delay);
    }

    private clearTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private scheduleLocal(): void {
        if (this.localTimer !== undefined) clearTimeout(this.localTimer);
        this.localTimer = setTimeout(() => {
            this.localTimer = undefined;
            void this.writeLocal();
        }, LOCAL_COPY_DELAY_MS);
    }

    private async writeLocalNow(): Promise<void> {
        if (this.localTimer === undefined) return this.local;
        clearTimeout(this.localTimer);
        this.localTimer = undefined;
        return this.writeLocal();
    }

    private writeLocal(): Promise<void> {
        return this.enqueueLocal(() => {
            if (!this.dirty || !this.changedFrom || !this.changedAt) return Promise.resolve();
            return this.store.put({
                key: this.key,
                content: this.options.content(),
                baseVersionId: this.baseVersionId,
                entityVersion: this.version,
                changedFrom: this.changedFrom,
                changedAt: this.changedAt
            });
        });
    }

    /** Le operazioni sulla copia nel browser si eseguono in ordine: l'eliminazione non precede una scrittura. */
    private enqueueLocal(action: () => Promise<void>): Promise<void> {
        this.local = this.local.then(action).catch(() => undefined);
        return this.local;
    }
}

/** Bozze delle parti e parti scritte da zero, per l'editor di scrittura. */
@Injectable({ providedIn: 'root' })
export class ScoreDraftService {
    constructor(
        private readonly http: HttpClient,
        private readonly apiErrors: ApiErrorService,
        private readonly keycloak: KeycloakService,
        private readonly store: LocalDraftStore
    ) {}

    /** Bozza della parte, o `null` se non c'è. */
    draft(trackId: number, scoreId: number): Promise<ScoreDraft | null> {
        return firstValueFrom(this.http.get<ScoreDraft>(this.url(trackId, scoreId), { observe: 'response' }).pipe(map((response: HttpResponse<ScoreDraft>) => (response.status === 204 ? null : response.body))));
    }

    /**
     * Scarta la bozza: dall'elenco delle parti quando nessuno la sta scrivendo, oppure dall'editor che possiede il blocco,
     * indicato da `session`.
     */
    discard(trackId: number, scoreId: number, session?: string): Promise<void> {
        const params = session ? new HttpParams().set('session', session) : undefined;
        return firstValueFrom(this.http.delete<void>(this.url(trackId, scoreId), { params }));
    }

    /** Aggiunge in fondo alla traccia una parte scritta da zero, senza pagine, con la sua prima bozza. */
    createWrittenPart(trackId: number, part: NewWrittenPart, context?: HttpContext): Promise<WrittenPart> {
        return firstValueFrom(this.http.post<WrittenPart>(`${environment.baseUrl}/tracks/${trackId}/written-parts`, part, { context }));
    }

    /** Copia nel browser delle modifiche di questo utente alla parte, se c'è. */
    localCopy(trackId: number, scoreId: number): Promise<LocalDraftCopy | null> {
        return this.store.get(this.key(trackId, scoreId));
    }

    /** Elimina la copia nel browser, per esempio quando la parte non esiste più. */
    forgetLocalCopy(trackId: number, scoreId: number): Promise<void> {
        return this.store.delete(this.key(trackId, scoreId));
    }

    /** Bozza di una parte per una finestra dell'editor, che possiede il blocco. */
    keeper(trackId: number, scoreId: number, options: DraftKeeperOptions): PartDraftKeeper {
        return new PartDraftKeeper(this.http, this.apiErrors, this.store, this.url(trackId, scoreId), this.key(trackId, scoreId), options);
    }

    private url(trackId: number, scoreId: number): string {
        return `${environment.baseUrl}/tracks/${trackId}/scores/${scoreId}/score-draft`;
    }

    /** La copia è di un utente di un tenant: un altro utente dello stesso browser non la vede. */
    private key(trackId: number, scoreId: number): string {
        return [this.keycloak.currentUserTenantCode ?? '', this.keycloak.currentUserId ?? '', trackId, scoreId].join(':');
    }
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        operation.onsuccess = () => resolve(operation.result);
        operation.onerror = () => reject(operation.error);
    });
}

function timeOfDay(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
