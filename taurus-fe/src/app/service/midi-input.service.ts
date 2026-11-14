import { Injectable, OnDestroy, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Tastiera MIDI collegata al computer. */
export interface MidiDevice {
    id: string;
    name: string;
}

/** Nota suonata: il tasto (60 è il Do4) e se completa l'accordo della nota precedente. */
export interface PlayedNote {
    key: number;
    chord: boolean;
}

/** `denied`: il browser non ha concesso il permesso; `failed`: Web MIDI non risponde. */
export type MidiStatus = 'idle' | 'connecting' | 'ready' | 'denied' | 'failed';

export const DEFAULT_CHORD_THRESHOLD = 80;
export const MIN_CHORD_THRESHOLD = 30;
export const MAX_CHORD_THRESHOLD = 200;

const STORAGE_KEY = 'taurus.midiKeyboard';

interface SavedChoice {
    deviceId: string | null;
    threshold: number;
}

/**
 * Riunisce in accordi le note suonate: una nota entra nell'accordo se arriva entro la soglia dalla prima nota del gruppo
 * mentre la prima è ancora premuta. La prima nota non aspetta la soglia, e il legato, che preme la nota seguente prima
 * di lasciare la precedente, non forma accordi perché le note distano più della soglia.
 */
export class ChordGrouper {
    private readonly held = new Set<number>();
    private group: { first: number; start: number } | null = null;

    /** Registra la pressione del tasto all'istante indicato, in millisecondi; `true` se la nota completa un accordo. */
    press(key: number, time: number, threshold: number): boolean {
        const group = this.group;
        const chord = !!group && key !== group.first && time - group.start <= threshold && this.held.has(group.first);
        this.held.add(key);
        if (!chord) this.group = { first: key, start: time };
        return chord;
    }

    release(key: number): void {
        this.held.delete(key);
    }

    reset(): void {
        this.held.clear();
        this.group = null;
    }
}

/**
 * Tastiera MIDI della scrittura, con Web MIDI: chiede il permesso la prima volta, elenca le tastiere collegate, anche
 * quelle collegate dopo, usa quella scelta e la ricorda nel browser con la soglia dell'accordo. Legge solo Note On e Note
 * Off di qualsiasi canale: un Note On con intensità 0 vale come rilascio; intensità, pedale e controlli sono ignorati e
 * i messaggi di sistema (sysex) non si chiedono.
 */
@Injectable({ providedIn: 'root' })
export class MidiInputService implements OnDestroy {
    /** Il browser supporta Web MIDI: non Safari né iPad, dove il comando non compare. */
    readonly supported: boolean;
    readonly status = signal<MidiStatus>('idle');
    readonly devices = signal<MidiDevice[]>([]);
    /** Tastiera in uso: quella scelta, se collegata, altrimenti la prima collegata. */
    readonly deviceId = signal<string | null>(null);
    readonly threshold = signal(DEFAULT_CHORD_THRESHOLD);

    private readonly notes = new Subject<PlayedNote>();
    /** Note suonate sulla tastiera in uso, già riunite in accordi. */
    readonly played: Observable<PlayedNote> = this.notes.asObservable();

    private access: MIDIAccess | null = null;
    private input: MIDIInput | null = null;
    /** Tastiera scelta l'ultima volta, anche se ora non è collegata. */
    private preferred: string | null;
    private readonly grouper = new ChordGrouper();
    private readonly onMessage = (event: Event) => this.receive((event as MIDIMessageEvent).data, event.timeStamp);
    private readonly onStateChange = () => this.refresh();

    constructor() {
        this.supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
        const saved = readChoice();
        this.preferred = saved.deviceId;
        this.threshold.set(saved.threshold);
    }

    /** Chiede al browser l'accesso ai dispositivi MIDI, senza sysex, ed elenca le tastiere collegate. */
    async connect(): Promise<void> {
        if (this.access) {
            this.refresh();
            return;
        }
        if (!this.supported) {
            this.status.set('failed');
            return;
        }
        this.status.set('connecting');
        try {
            this.access = await navigator.requestMIDIAccess({ sysex: false });
        } catch (error) {
            const name = error instanceof DOMException ? error.name : '';
            this.status.set(name === 'SecurityError' || name === 'NotAllowedError' ? 'denied' : 'failed');
            return;
        }
        this.access.addEventListener('statechange', this.onStateChange);
        this.status.set('ready');
        this.refresh();
    }

    /** Usa la tastiera indicata e la ricorda nel browser. */
    select(id: string): void {
        this.preferred = id;
        this.save();
        this.refresh();
    }

    /** Soglia dell'accordo in millisecondi, tra 30 e 200, ricordata nel browser. */
    setThreshold(value: number): void {
        const threshold = Number.isFinite(value) ? Math.round(Math.min(MAX_CHORD_THRESHOLD, Math.max(MIN_CHORD_THRESHOLD, value))) : DEFAULT_CHORD_THRESHOLD;
        this.threshold.set(threshold);
        this.save();
    }

    /** Legge un messaggio MIDI arrivato all'istante indicato, in millisecondi. */
    receive(data: Uint8Array | null, time: number): void {
        if (!data || data.length < 3) return;
        const kind = data[0] & 0xf0;
        const key = data[1] & 0x7f;
        const velocity = data[2] & 0x7f;
        if (kind === 0x90 && velocity > 0) {
            const chord = this.grouper.press(key, time, this.threshold());
            this.notes.next({ key, chord });
        } else if (kind === 0x80 || kind === 0x90) {
            this.grouper.release(key);
        }
    }

    ngOnDestroy(): void {
        this.detach();
        this.access?.removeEventListener('statechange', this.onStateChange);
        this.notes.complete();
    }

    /** Elenco delle tastiere collegate e tastiera in uso, dopo un collegamento, una scelta o un cambio dei dispositivi. */
    private refresh(): void {
        const access = this.access;
        if (!access) return;
        const inputs = Array.from(access.inputs.values()).filter((input) => input.state !== 'disconnected');
        this.devices.set(inputs.map((input, index) => ({ id: input.id, name: input.name?.trim() || input.manufacturer?.trim() || `Tastiera MIDI ${index + 1}` })));
        const target = inputs.find((input) => input.id === this.preferred) ?? inputs.find((input) => input.id === this.input?.id) ?? inputs[0] ?? null;
        if (target?.id !== this.input?.id) this.attach(target);
        this.deviceId.set(target?.id ?? null);
    }

    private attach(input: MIDIInput | null): void {
        this.detach();
        this.grouper.reset();
        this.input = input;
        if (!input) return;
        input.addEventListener('midimessage', this.onMessage);
        // Con addEventListener la porta non si apre da sola.
        void input.open().catch(() => this.status.set('failed'));
    }

    private detach(): void {
        this.input?.removeEventListener('midimessage', this.onMessage);
        this.input = null;
    }

    private save(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ deviceId: this.preferred, threshold: this.threshold() } satisfies SavedChoice));
        } catch {
            // Senza memoria del browser la scelta vale finché la pagina resta aperta.
        }
    }
}

function readChoice(): SavedChoice {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SavedChoice> | null;
        const threshold = typeof saved?.threshold === 'number' && saved.threshold >= MIN_CHORD_THRESHOLD && saved.threshold <= MAX_CHORD_THRESHOLD ? Math.round(saved.threshold) : DEFAULT_CHORD_THRESHOLD;
        return { deviceId: typeof saved?.deviceId === 'string' ? saved.deviceId : null, threshold };
    } catch {
        return { deviceId: null, threshold: DEFAULT_CHORD_THRESHOLD };
    }
}
