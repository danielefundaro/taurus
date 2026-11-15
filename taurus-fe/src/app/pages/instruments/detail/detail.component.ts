import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SelectItem } from 'primeng/api';
import { delay, finalize, first } from 'rxjs';
import { ImportsModule } from '../../../imports';
import { DetailPageBase } from '../../_shared/detail-page.base';
import { ChildrenEntities, InstrumentPlaybackSuggestion, Instruments } from '../../../module';
import { keyLabel } from '../../../score-editor/score-input';
import { DRUM_SOUNDS, GENERAL_MIDI_FAMILIES } from '../../../score-player/general-midi';
import { ConfirmService, InstrumentsService, ScoreAudioService, ScorePlaybackService, TenantFeatureService, ToastService } from '../../../service';

const SCALE = [0, 2, 4, 5, 7, 9, 11, 12];

@Component({
    selector: 'app-instrument-detail',
    imports: [ImportsModule],
    templateUrl: './detail.component.html',
    styleUrl: './detail.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
    providers: [InstrumentsService]
})
export class DetailComponent extends DetailPageBase implements OnInit {
    public sortOptions!: SelectItem[];
    public totalRecords: number = 0;
    public instrument: Instruments = new Instruments();
    public cols: string[];
    public selectedTracks: ChildrenEntities[];

    protected readonly soundGroups = GENERAL_MIDI_FAMILIES.map((family) => ({ label: family.label, items: family.sounds.map((sound) => ({ label: `${sound.program} · ${sound.name}`, value: sound.program })) }));
    protected readonly drumOptions = DRUM_SOUNDS.map((sound) => ({ label: `${sound.program} · ${sound.name}`, value: sound.program }));
    /** Note scritte per l'estensione, con il nome: «Mi3». */
    protected readonly pitchOptions = Array.from({ length: 128 }, (_, key) => ({ label: keyLabel(key), value: key }));
    protected readonly kindOptions = [
        { label: 'Strumento intonato', value: false },
        { label: 'Percussione', value: true }
    ];
    protected percussion = false;
    /** La proposta calcolata dal nome è nei campi ma non ancora salvata. */
    protected proposal: InstrumentPlaybackSuggestion | null = null;
    protected noProposal = false;
    protected previewing = false;
    private nameTimer?: number;

    constructor(
        private readonly instrumentsService: InstrumentsService,
        private readonly toastService: ToastService,
        private readonly routeService: ActivatedRoute,
        private readonly router: Router,
        private readonly confirmService: ConfirmService,
        private readonly tenantFeatureService: TenantFeatureService,
        private readonly playbackService: ScorePlaybackService,
        private readonly audio: ScoreAudioService
    ) {
        super();
        this.cols = ['Codice', 'Ordine', 'Nome'];
        this.selectedTracks = [];
    }

    ngOnInit() {
        this.routeService.params.pipe(first()).subscribe((params) => {
            this.loadElement(params['id']);
        });
    }

    protected get scorePlaybackEnabled(): boolean {
        return this.tenantFeatureService.scorePlaybackEnabled();
    }

    protected get configured(): boolean {
        const instrument = this.instrument;
        return instrument.percussionKey !== null && instrument.percussionKey !== undefined
            ? true
            : instrument.soundProgram !== null && instrument.soundProgram !== undefined && instrument.transpositionSemitones !== null && instrument.transpositionSemitones !== undefined;
    }

    /** Errore dell'estensione: le due note vanno scelte insieme, la grave non sopra l'acuta. */
    protected get rangeError(): string | undefined {
        const lowest = this.instrument.lowestWrittenPitch ?? null;
        const highest = this.instrument.highestWrittenPitch ?? null;
        if ((lowest === null) !== (highest === null)) return 'Scegli entrambe le note, o nessuna.';
        if (lowest !== null && highest !== null && lowest > highest) return 'La nota più grave non può essere più acuta della nota più acuta.';
        return undefined;
    }

    public confirmDelete(): void {
        this.confirmService.confirmDestructive({
            title: 'Elimina strumento',
            consequence: 'Lo strumento verrà eliminato definitivamente.',
            actionLabel: 'Elimina',
            accept: () => {
                this.instrumentsService
                    .delete(this.instrument.id)
                    .pipe(first())
                    .subscribe({
                        next: () => {
                            this.isDirty = false;
                            this.toastService.success('Strumento eliminato', 'Lo strumento non è più visibile.');
                            this.router.navigate(['/instruments']);
                        }
                    });
            }
        });
    }

    public save(): void {
        this.saving = true;
        this.instrumentsService
            .update(this.instrument.id, this.instrument)
            .pipe(
                delay(1000),
                first(),
                finalize(() => (this.saving = false))
            )
            .subscribe({
                next: (instrument: Instruments) => {
                    this.isDirty = false;
                    this.proposal = null;
                    this.toastService.success('Strumento aggiornato', 'Le modifiche sono state salvate.');
                    this.loadElement(instrument.id);
                }
            });
    }

    protected onNameChange(): void {
        this.isDirty = true;
        if (!this.scorePlaybackEnabled || (this.configured && !this.proposal)) return;
        window.clearTimeout(this.nameTimer);
        this.nameTimer = window.setTimeout(() => this.propose(), 600);
    }

    protected onKindChange(percussion: boolean): void {
        this.percussion = percussion;
        if (percussion) {
            this.instrument.soundBank = null;
            this.instrument.soundProgram = null;
            this.instrument.transpositionSemitones = null;
            this.instrument.bassClefTranspositionSemitones = null;
            this.instrument.lowestWrittenPitch = null;
            this.instrument.highestWrittenPitch = null;
        } else {
            this.instrument.percussionKey = null;
        }
        this.markPlaybackDirty();
    }

    protected onSoundChange(program: number | null): void {
        this.instrument.soundProgram = program;
        this.instrument.soundBank = program === null ? null : (this.instrument.soundBank ?? 0);
        this.markPlaybackDirty();
    }

    protected markPlaybackDirty(): void {
        this.isDirty = true;
    }

    /** Precompila suono e trasposizione con la proposta calcolata dal nome, da verificare prima di salvare. */
    protected propose(): void {
        const name = this.instrument.name?.trim();
        if (!name) return;
        this.playbackService
            .instrumentSuggestion(name)
            .pipe(first())
            .subscribe((suggestion) => {
                this.noProposal = !suggestion;
                if (!suggestion) return;
                this.proposal = suggestion;
                this.percussion = suggestion.percussionKey !== null && suggestion.percussionKey !== undefined;
                this.instrument.transpositionSemitones = suggestion.transposition ?? null;
                this.instrument.bassClefTranspositionSemitones = suggestion.bassClefTransposition ?? null;
                this.instrument.soundBank = suggestion.soundBank ?? null;
                this.instrument.soundProgram = suggestion.soundProgram ?? null;
                this.instrument.percussionKey = suggestion.percussionKey ?? null;
                this.instrument.lowestWrittenPitch = suggestion.lowestWrittenPitch ?? null;
                this.instrument.highestWrittenPitch = suggestion.highestWrittenPitch ?? null;
                this.isDirty = true;
            });
    }

    /** Scala di un'ottava scritta in Do, trasposta come le parti dello strumento, oppure quattro colpi di batteria. */
    protected async preview(): Promise<void> {
        this.previewing = true;
        try {
            if (this.percussion) {
                const key = this.instrument.percussionKey ?? 38;
                await this.audio.preview(
                    [0, 0.5, 1, 1.5].map((at) => ({ key, at, duration: 0.3 })),
                    null,
                    0,
                    true
                );
            } else {
                const base = 60 + (this.instrument.transpositionSemitones ?? 0);
                await this.audio.preview(
                    SCALE.map((step, index) => ({ key: base + step, at: index * 0.4, duration: 0.38 })),
                    this.instrument.soundProgram ?? 0,
                    this.instrument.soundBank ?? 0,
                    false
                );
            }
        } catch {
            this.toastService.error('Prova non disponibile', 'Impossibile caricare i suoni: riprovare più tardi.');
        } finally {
            window.setTimeout(() => (this.previewing = false), 3000);
        }
    }

    private loadElement(id: number | string) {
        this.loading = true;
        this.instrumentsService
            .getById(Number(id))
            .pipe(
                first(),
                finalize(() => (this.loading = false))
            )
            .subscribe({
                next: (instrument: Instruments) => {
                    this.instrument = instrument;
                    this.percussion = instrument.percussionKey !== null && instrument.percussionKey !== undefined;
                    this.isDirty = false;
                    this.proposal = null;
                    this.noProposal = false;
                    if (this.scorePlaybackEnabled && !instrument.playbackConfigured) this.propose();
                }
            });
    }
}
