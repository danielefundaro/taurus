import { ChordGrouper, DEFAULT_CHORD_THRESHOLD, MidiInputService, PlayedNote } from './midi-input.service';

const STORAGE_KEY = 'taurus.midiKeyboard';

/** Tastiera MIDI simulata: invia i messaggi come un dispositivo collegato. */
class FakeInput extends EventTarget {
    opened = 0;

    constructor(
        readonly id: string,
        readonly name: string,
        public state: 'connected' | 'disconnected' = 'connected',
        readonly manufacturer = ''
    ) {
        super();
    }

    open(): Promise<this> {
        this.opened++;
        return Promise.resolve(this);
    }

    send(...bytes: number[]): void {
        this.dispatchEvent(Object.assign(new Event('midimessage'), { data: new Uint8Array(bytes) }));
    }
}

class FakeAccess extends EventTarget {
    readonly inputs = new Map<string, FakeInput>();

    plug(input: FakeInput): void {
        this.inputs.set(input.id, input);
        this.dispatchEvent(new Event('statechange'));
    }

    unplug(id: string): void {
        this.inputs.get(id)!.state = 'disconnected';
        this.dispatchEvent(new Event('statechange'));
    }
}

describe('ChordGrouper', () => {
    it('joins the notes that arrive within the threshold while the first is still held', () => {
        const grouper = new ChordGrouper();

        expect(grouper.press(60, 0, 80)).toBeFalse();
        expect(grouper.press(64, 30, 80)).toBeTrue();
        expect(grouper.press(67, 80, 80)).toBeTrue();
        // Oltre la soglia inizia un nuovo gruppo, anche con le note dell'accordo ancora premute.
        expect(grouper.press(72, 81, 80)).toBeFalse();
    });

    it('does not turn legato playing or a released first note into chords', () => {
        const grouper = new ChordGrouper();

        grouper.press(60, 0, 80);
        // Legato: la nota seguente arriva prima del rilascio, ma dopo la soglia.
        expect(grouper.press(62, 150, 80)).toBeFalse();
        grouper.release(60);
        grouper.release(62);

        grouper.press(64, 300, 80);
        grouper.release(64);
        expect(grouper.press(65, 320, 80)).toBeFalse();
        grouper.reset();
        expect(grouper.press(67, 330, 80)).toBeFalse();
    });
});

describe('MidiInputService', () => {
    let access: FakeAccess;
    let piano: FakeInput;
    let request: jasmine.Spy;

    function service(): { midi: MidiInputService; played: PlayedNote[] } {
        const midi = new MidiInputService();
        const played: PlayedNote[] = [];
        midi.played.subscribe((note) => played.push(note));
        return { midi, played };
    }

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        access = new FakeAccess();
        piano = new FakeInput('piano', 'Digital Piano');
        access.inputs.set(piano.id, piano);
        access.inputs.set('pads', new FakeInput('pads', ' ', 'connected', 'Pad Maker'));
        request = spyOn(navigator, 'requestMIDIAccess').and.resolveTo(access as unknown as MIDIAccess);
    });

    afterEach(() => localStorage.removeItem(STORAGE_KEY));

    it('asks for MIDI access without sysex, lists the keyboards and writes the notes of the first one', async () => {
        const { midi, played } = service();
        expect(midi.supported).toBeTrue();
        expect(midi.status()).toBe('idle');

        await midi.connect();
        await midi.connect();

        expect(request).toHaveBeenCalledOnceWith({ sysex: false });
        expect(midi.status()).toBe('ready');
        expect(midi.devices()).toEqual([
            { id: 'piano', name: 'Digital Piano' },
            { id: 'pads', name: 'Pad Maker' }
        ]);
        expect(midi.deviceId()).toBe('piano');
        expect(piano.opened).toBe(1);

        piano.send(0x90, 60, 100);
        piano.send(0x99, 38, 90);
        piano.send(0xb0, 64, 127);
        piano.send(0x90, 60, 0);
        piano.send(0x80, 38, 0);
        piano.send(0xe0, 0);
        expect(played).toEqual([
            { key: 60, chord: false },
            { key: 38, chord: true }
        ]);
        midi.ngOnDestroy();
    });

    it('treats a Note On with velocity 0 as a release and ignores pedal, controllers and short messages', () => {
        const { midi, played } = service();

        midi.receive(new Uint8Array([0x90, 60, 64]), 0);
        midi.receive(new Uint8Array([0x90, 60, 0]), 10);
        midi.receive(new Uint8Array([0x90, 64, 64]), 20);
        midi.receive(new Uint8Array([0xb0, 64, 127]), 25);
        midi.receive(new Uint8Array([0x90, 67]), 26);
        midi.receive(null, 27);
        midi.receive(new Uint8Array([0x80, 64, 64]), 30);
        midi.receive(new Uint8Array([0x91, 67, 1]), 40);

        expect(played).toEqual([
            { key: 60, chord: false },
            { key: 64, chord: false },
            { key: 67, chord: false }
        ]);
    });

    it('remembers the chosen keyboard and the chord threshold in the browser', async () => {
        const first = service();
        await first.midi.connect();
        first.midi.select('pads');
        first.midi.setThreshold(120);
        expect(first.midi.deviceId()).toBe('pads');
        piano.send(0x90, 60, 100);
        expect(first.played).toEqual([]);
        first.midi.ngOnDestroy();

        const { midi, played } = service();
        expect(midi.threshold()).toBe(120);
        await midi.connect();
        expect(midi.deviceId()).toBe('pads');

        access.inputs.get('pads')!.send(0x90, 36, 100);
        midi.receive(new Uint8Array([0x90, 38, 100]), performance.now() + 1000);
        expect(played.map((note) => note.key)).toEqual([36, 38]);

        midi.setThreshold(500);
        expect(midi.threshold()).toBe(200);
        midi.setThreshold(10);
        expect(midi.threshold()).toBe(30);
        midi.setThreshold(Number.NaN);
        expect(midi.threshold()).toBe(DEFAULT_CHORD_THRESHOLD);
        midi.ngOnDestroy();
    });

    it('ignores a damaged saved choice', () => {
        localStorage.setItem(STORAGE_KEY, '{"deviceId": 3, "threshold": 900}');
        expect(service().midi.threshold()).toBe(DEFAULT_CHORD_THRESHOLD);
        localStorage.setItem(STORAGE_KEY, 'not json');
        expect(service().midi.threshold()).toBe(DEFAULT_CHORD_THRESHOLD);
    });

    it('lists keyboards plugged in later and moves to another one when the keyboard in use is unplugged', async () => {
        const { midi, played } = service();
        await midi.connect();

        const later = new FakeInput('later', 'USB Keyboard');
        access.plug(later);
        expect(midi.devices().map((device) => device.id)).toEqual(['piano', 'pads', 'later']);
        expect(midi.deviceId()).toBe('piano');

        access.unplug('piano');
        expect(midi.devices().map((device) => device.id)).toEqual(['pads', 'later']);
        expect(midi.deviceId()).toBe('pads');
        piano.send(0x90, 61, 80);
        expect(played).toEqual([]);

        midi.select('later');
        later.send(0x90, 72, 80);
        expect(played).toEqual([{ key: 72, chord: false }]);

        access.unplug('pads');
        access.unplug('later');
        expect(midi.devices()).toEqual([]);
        expect(midi.deviceId()).toBeNull();
        midi.ngOnDestroy();
    });

    it('reports a refused permission and a MIDI system that does not answer', async () => {
        request.and.rejectWith(new DOMException('Permission denied', 'SecurityError'));
        const denied = service().midi;
        await denied.connect();
        expect(denied.status()).toBe('denied');

        request.and.rejectWith(new DOMException('No MIDI', 'NotAllowedError'));
        const refused = service().midi;
        await refused.connect();
        expect(refused.status()).toBe('denied');

        request.and.rejectWith(new Error('broken'));
        const failed = service().midi;
        await failed.connect();
        expect(failed.status()).toBe('failed');

        request.and.resolveTo(access as unknown as MIDIAccess);
        await failed.connect();
        expect(failed.status()).toBe('ready');
    });
});
