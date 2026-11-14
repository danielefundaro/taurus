import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MultiSelectModule } from 'primeng/multiselect';
import { firstValueFrom } from 'rxjs';
import { ImportsModule } from '../../imports';
import { InstrumentsCriteria, PartPlayback, TrackPlayback } from '../../module';
import { concertFifths, DEFAULT_MEASURES, MAX_MEASURES, newPartXml, NewPartSetup, proposedClef, readReferencePart, setupErrors, writtenFifths } from '../../score-editor/new-part';
import { CLEF_OPTIONS, KEY_OPTIONS } from '../../score-editor/notation-rules';
import { partLabel } from '../../score-player/playback-labels';
import { InstrumentsService, ScoreDraftService, ScorePlaybackService, withErrorSummary } from '../../service';

export interface NewPartDialogData {
    trackId: number;
    playback: TrackPlayback;
    /** Parte senza versioni né bozza da scrivere: le impostazioni preparano il contenuto iniziale, senza creare una parte. */
    part?: PartPlayback;
}

/** Parte creata in fondo alla traccia, con la prima bozza; oppure contenuto iniziale della parte esistente. */
export type NewPartDialogResult = { kind: 'created'; scoreId: number; trackVersion: number } | { kind: 'prepared'; content: string };

/** Strumento della scelta: nome per la chiave, trasposizioni per l'armatura scritta. */
interface SetupInstrument {
    id: number;
    name: string;
    transpositionSemitones?: number | null;
    bassClefTranspositionSemitones?: number | null;
    percussionKey?: number | null;
}

/** Parte della traccia da cui si propongono armatura, metro, tempo e battute. */
interface Reference {
    label: string;
    /** Tonalità d'orchestra della parte. */
    concertFifths: number;
}

const BEAT_TYPES = [1, 2, 4, 8, 16, 32].map((value) => ({ label: String(value), value }));

/**
 * Impostazioni di una parte scritta da zero: strumenti, chiave, armatura, metro, tempo, battute e levare, proposti dagli
 * strumenti e dalla parte di riferimento della traccia. Crea la parte in fondo alla traccia con la sua prima bozza oppure,
 * per una parte che non ha ancora note, prepara il contenuto da cui parte l'editor.
 */
@Component({
    selector: 'app-new-part-dialog',
    standalone: true,
    imports: [ImportsModule, MultiSelectModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './new-part-dialog.component.html'
})
export class NewPartDialogComponent implements OnInit {
    protected readonly data: NewPartDialogData;
    protected readonly clefs = [...CLEF_OPTIONS];
    protected readonly keys = [...KEY_OPTIONS];
    protected readonly beatTypes = BEAT_TYPES;
    protected readonly maxMeasures = MAX_MEASURES;

    protected description = '';
    protected instrumentIds: number[] = [];
    protected instruments: SetupInstrument[] = [];
    protected clef = 'G2';
    protected fifths = 0;
    protected beats = 4;
    protected beatType = 4;
    protected tempo: number | null = null;
    protected measures = DEFAULT_MEASURES;
    protected pickupBeats = 0;
    protected reference: Reference | null = null;
    protected loading = true;
    protected saving = false;
    protected dirty = false;

    /** Chiave e armatura scelte a mano non cambiano più con gli strumenti. */
    private clefChosen = false;
    private keyChosen = false;

    constructor(
        private readonly dialogRef: DynamicDialogRef<NewPartDialogComponent>,
        private readonly playbackService: ScorePlaybackService,
        private readonly draftService: ScoreDraftService,
        private readonly instrumentsService: InstrumentsService,
        private readonly changeDetector: ChangeDetectorRef,
        config: DynamicDialogConfig<NewPartDialogData>
    ) {
        this.data = config.data!;
        this.tempo = this.data.playback.tempoBpm ?? null;
    }

    async ngOnInit(): Promise<void> {
        const part = this.data.part;
        const [instruments] = await Promise.all([part ? Promise.resolve(part.instruments) : this.loadInstruments(), this.loadReference()]);
        this.instruments = instruments;
        if (part) this.instrumentIds = part.instruments.map((instrument) => instrument.id);
        this.propose();
        this.loading = false;
        this.changeDetector.markForCheck();
    }

    protected get heading(): string {
        return this.data.part ? `Scrivi ${partLabel(this.data.part)}` : 'Nuova parte scritta';
    }

    protected get subtitle(): string {
        return this.data.part ? "La parte non ha ancora note: scegli come impostarla, poi la scrivi nell'editor." : "La parte si aggiunge in fondo alla traccia, senza pagine, e si apre nell'editor di scrittura.";
    }

    protected get errors(): string[] {
        return setupErrors(this.setup);
    }

    /** Errori del campo indicato, se la verifica li ha trovati. */
    protected error(text: string): string | undefined {
        return this.errors.find((message) => message.startsWith(text));
    }

    protected get pickupLabel(): string {
        return `Levare (in ${this.beatType === 4 ? 'semiminime' : this.beatType === 8 ? 'crome' : this.beatType === 2 ? 'minime' : `1/${this.beatType}`})`;
    }

    protected get keyHint(): string {
        if (!this.reference) return 'Armatura scritta sulla parte. Nessuna altra parte con note da cui proporla.';
        const transposed = this.selected.length === 1 && this.semitones !== 0;
        return `Proposta da «${this.reference.label}»${transposed ? ', trasportata per lo strumento' : ''}. È l'armatura scritta sulla parte.`;
    }

    protected changedInstruments(): void {
        this.dirty = true;
        this.propose();
    }

    protected changedClef(): void {
        this.dirty = true;
        this.clefChosen = true;
        // In chiave di basso alcuni strumenti trasportano diversamente.
        if (!this.keyChosen) this.fifths = this.proposedFifths();
    }

    protected changedKey(): void {
        this.dirty = true;
        this.keyChosen = true;
    }

    protected changed(): void {
        this.dirty = true;
    }

    protected cancel(): void {
        this.dialogRef.close();
    }

    protected async save(): Promise<void> {
        if (this.errors.length || this.saving) return;
        const content = newPartXml(this.setup);
        if (this.data.part) {
            this.dialogRef.close({ kind: 'prepared', content } satisfies NewPartDialogResult);
            return;
        }
        this.saving = true;
        this.changeDetector.markForCheck();
        try {
            const created = await this.draftService.createWrittenPart(
                this.data.trackId,
                { description: this.description.trim() || null, instrumentIds: this.instrumentIds, content, trackVersion: this.data.playback.version },
                withErrorSummary('Parte non creata')
            );
            this.dialogRef.close({ kind: 'created', scoreId: created.scoreId, trackVersion: created.trackVersion } satisfies NewPartDialogResult);
        } catch {
            // L'avviso dell'errore è già mostrato; il dialogo resta aperto per riprovare.
        } finally {
            this.saving = false;
            this.changeDetector.markForCheck();
        }
    }

    private get setup(): NewPartSetup {
        const names = this.selected.map((instrument) => instrument.name).join(', ');
        return {
            partName: this.description.trim() || (this.data.part ? partLabel(this.data.part) : names) || 'Parte',
            clef: this.clef,
            fifths: this.fifths,
            beats: this.beats,
            beatType: this.beatType,
            tempo: this.tempo,
            measures: this.measures,
            pickupBeats: this.pickupBeats
        };
    }

    private get selected(): SetupInstrument[] {
        return this.instrumentIds.map((id) => this.instruments.find((instrument) => instrument.id === id)).filter((instrument): instrument is SetupInstrument => !!instrument);
    }

    /** Trasposizione della parte nuova: solo con uno strumento, come per l'ascolto. */
    private get semitones(): number {
        const selected = this.selected;
        if (selected.length !== 1) return 0;
        const [instrument] = selected;
        return (this.clef === 'F4' ? (instrument.bassClefTranspositionSemitones ?? instrument.transpositionSemitones) : instrument.transpositionSemitones) ?? 0;
    }

    private propose(): void {
        if (!this.clefChosen) this.clef = proposedClef(this.selected);
        if (!this.keyChosen) this.fifths = this.proposedFifths();
    }

    private proposedFifths(): number {
        return this.reference ? writtenFifths(this.reference.concertFifths, this.semitones) : 0;
    }

    /** Parte di riferimento della traccia, altrimenti la prima con una versione: metro, tempo, battute e tonalità. */
    private async loadReference(): Promise<void> {
        const parts = this.data.playback.parts.filter((part) => part.version && part.scoreId !== this.data.part?.scoreId);
        const part = parts.find((candidate) => candidate.scoreId === this.data.playback.referenceScoreId) ?? parts.find((candidate) => candidate.version?.status === 'APPROVED') ?? parts[0];
        if (!part) return;
        let reference;
        try {
            reference = readReferencePart(await firstValueFrom(this.playbackService.playbackFile(this.data.trackId, part.scoreId)));
        } catch {
            return;
        }
        if (!reference) return;
        const sound = part.sound;
        // Come per l'ascolto, traspone solo una parte di un solo strumento.
        const semitones = part.instruments.length === 1 ? ((reference.clefSign === 'F' ? (sound.bassClefTranspositionSemitones ?? sound.transpositionSemitones) : sound.transpositionSemitones) ?? 0) : 0;
        this.reference = { label: partLabel(part), concertFifths: concertFifths(reference.fifths, semitones) };
        this.beats = reference.beats;
        this.beatType = reference.beatType;
        this.measures = Math.min(reference.measures, MAX_MEASURES);
        this.pickupBeats = reference.pickupBeats;
        this.tempo = this.data.playback.tempoBpm ?? reference.tempo;
    }

    /** Tutti gli strumenti dell'associazione, pagina dopo pagina. */
    private async loadInstruments(): Promise<SetupInstrument[]> {
        const criteria: InstrumentsCriteria = { page: 0, sort: ['name,asc'] };
        const instruments: SetupInstrument[] = [];
        try {
            for (;;) {
                const page = await firstValueFrom(this.instrumentsService.getAll(criteria));
                instruments.push(...page.content.filter((instrument) => instrument.id !== undefined).map((instrument) => ({ ...instrument, id: instrument.id!, name: instrument.name ?? '' })));
                if (!page.content.length || instruments.length >= page.totalElements) return instruments;
                criteria.page = (criteria.page ?? 0) + 1;
            }
        } catch {
            return instruments;
        }
    }
}
