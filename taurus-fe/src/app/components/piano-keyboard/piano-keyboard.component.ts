import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { keyLabel } from '../../score-editor/score-input';

/** Strumento di una parte di percussione, suonato con un pulsante al posto dei tasti. */
export interface DrumPad {
    key: number;
    label: string;
    hint: string;
}

interface PianoKey {
    key: number;
    label: string;
    /** Tasti bianchi alla sua sinistra: il tasto nero sta sul loro bordo destro. */
    slot: number;
}

const OCTAVES = 2;
const MIN_OCTAVE = 0;
const MAX_OCTAVE = 7;
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_OFFSETS: readonly [number, number][] = [
    [1, 1],
    [3, 2],
    [6, 4],
    [8, 5],
    [10, 6]
];

/**
 * Pianoforte a schermo della scrittura, per tablet e per chi non usa le scorciatoie: due ottave da spostare, e un tocco
 * suona il tasto. Nelle parti di percussione con strumenti mostra un pulsante per strumento.
 */
@Component({
    selector: 'app-piano-keyboard',
    standalone: true,
    imports: [ButtonModule],
    templateUrl: './piano-keyboard.component.html',
    styleUrl: './piano-keyboard.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PianoKeyboardComponent {
    /** Pulsanti degli strumenti, per le parti di percussione; vuoto per il pianoforte. */
    @Input() pads: DrumPad[] = [];
    @Input() disabled = false;
    @Output() readonly play = new EventEmitter<number>();

    protected octave = 4;
    protected whiteKeys: PianoKey[] = [];
    protected blackKeys: PianoKey[] = [];
    protected readonly minOctave = MIN_OCTAVE;
    protected readonly maxOctave = MAX_OCTAVE;

    constructor() {
        this.build();
    }

    /** Prima ottava mostrata: il Do di quell'ottava è il primo tasto (4 per il Do4 centrale). */
    @Input() set startOctave(value: number) {
        this.octave = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, Math.round(value)));
        this.build();
    }

    protected get rangeLabel(): string {
        return `${keyLabel(this.firstKey)}–${keyLabel(this.firstKey + OCTAVES * 12)}`;
    }

    protected shift(delta: number): void {
        this.startOctave = this.octave + delta;
    }

    protected press(key: number): void {
        if (!this.disabled) this.play.emit(key);
    }

    private get firstKey(): number {
        return (this.octave + 1) * 12;
    }

    private build(): void {
        const first = this.firstKey;
        this.whiteKeys = [];
        this.blackKeys = [];
        for (let octave = 0; octave < OCTAVES; octave++) {
            const base = first + octave * 12;
            for (const [index, offset] of WHITE_OFFSETS.entries()) this.whiteKeys.push({ key: base + offset, label: keyLabel(base + offset), slot: octave * 7 + index });
            for (const [offset, slot] of BLACK_OFFSETS) this.blackKeys.push({ key: base + offset, label: keyLabel(base + offset), slot: octave * 7 + slot });
        }
        // Il Do dell'ottava seguente chiude la tastiera.
        const last = first + OCTAVES * 12;
        this.whiteKeys.push({ key: last, label: keyLabel(last), slot: OCTAVES * 7 });
    }
}
