import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MultiSelectModule } from 'primeng/multiselect';
import { firstValueFrom } from 'rxjs';
import { ImportsModule } from '../../imports';
import { Arrangement, ArrangementRowRequest, InstrumentsCriteria, PartPlayback, TrackPlayback } from '../../module';
import { concertFifths, DEFAULT_MEASURES, MAX_MEASURES, readReferencePart, setupErrors } from '../../score-editor/new-part';
import { KEY_OPTIONS } from '../../score-editor/notation-rules';
import { alignParts, byEnsembleOrder, combineParts, concertPartXml, ensembleRows, isPercussionRow, MAX_ROWS, newArrangementXml, PlannedRow, rowSetup, rowTransposition, RowInstrument } from '../../score-editor/score-arrangement';
import { EditError } from '../../score-editor/score-document';
import { partLabel } from '../../score-player/playback-labels';
import { ArrangementService, InstrumentsService, ScorePlaybackService, withErrorSummary } from '../../service';

export interface NewArrangementDialogData {
    trackId: number;
    playback: TrackPlayback;
}

/** Partitura creata, con la prima bozza da aprire nell'editor. */
export interface NewArrangementDialogResult {
    arrangement: Arrangement;
}

type Source = 'ensemble' | 'parts';

/** Strumento del catalogo, con il posto nell'organico. */
interface CatalogInstrument extends RowInstrument {
    ensemblePosition?: number | null;
}

/** Una parte della traccia con note, da cui fare un rigo. */
interface PartChoice {
    part: PartPlayback;
    label: string;
    selected: boolean;
    /** Strumenti tra cui scegliere quello del rigo; vuoto se il rigo prende gli strumenti della parte. */
    options: RowInstrument[];
    /** Strumento scelto tra le opzioni. */
    instrumentId: number | null;
    /** Chiave iniziale della parte, per la trasposizione in chiave di basso. */
    clefSign: string;
    /** Differenze dalla parte di riferimento, che l'allineamento corregge. */
    changes: string[];
}

const BEAT_TYPES = [1, 2, 4, 8, 16, 32].map((value) => ({ label: String(value), value }));

/**
 * Partitura nuova della traccia: dall'organico, con un rigo di pause per strumento e le percussioni insieme, oppure dalle
 * parti della traccia, allineate alla parte di riferimento. Si scrive trasposta o in suoni reali. Crea la partitura con la
 * prima bozza, che si apre nell'editor.
 */
@Component({
    selector: 'app-new-arrangement-dialog',
    standalone: true,
    imports: [ImportsModule, MultiSelectModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './new-arrangement-dialog.component.html'
})
export class NewArrangementDialogComponent implements OnInit {
    protected readonly data: NewArrangementDialogData;
    protected readonly keys = [...KEY_OPTIONS];
    protected readonly beatTypes = BEAT_TYPES;
    protected readonly maxMeasures = MAX_MEASURES;
    protected readonly notations = [
        { label: 'Trasposta', value: false },
        { label: 'In suoni reali', value: true }
    ];

    protected source: Source = 'ensemble';
    protected sources: { label: string; value: Source }[] = [{ label: "Dall'organico", value: 'ensemble' }];
    protected catalog: CatalogInstrument[] = [];
    protected instrumentIds: number[] = [];
    protected concertKey = 0;
    protected beats = 4;
    protected beatType = 4;
    protected tempo: number | null = null;
    protected measures = DEFAULT_MEASURES;
    protected pickupBeats = 0;
    protected concertPitch = false;
    protected parts: PartChoice[] = [];
    protected referenceId: number | null = null;
    protected referenceOptions: { label: string; value: number }[] = [];
    /** Parti senza note, che non diventano righi. */
    protected partsWithoutNotes = 0;
    protected partsError: string | null = null;
    protected loading = true;
    protected saving = false;
    protected dirty = false;

    protected ensemble: number[] = [];
    private readonly contents = new Map<number, string>();

    constructor(
        private readonly dialogRef: DynamicDialogRef<NewArrangementDialogComponent>,
        private readonly arrangementService: ArrangementService,
        private readonly playbackService: ScorePlaybackService,
        private readonly instrumentsService: InstrumentsService,
        private readonly changeDetector: ChangeDetectorRef,
        private readonly router: Router,
        config: DynamicDialogConfig<NewArrangementDialogData>
    ) {
        this.data = config.data!;
        this.tempo = this.data.playback.tempoBpm ?? null;
    }

    async ngOnInit(): Promise<void> {
        const [catalog] = await Promise.all([this.loadInstruments(), this.loadParts()]);
        this.catalog = catalog;
        this.ensemble = catalog
            .filter((instrument) => instrument.ensemblePosition !== null && instrument.ensemblePosition !== undefined)
            .sort((first, second) => first.ensemblePosition! - second.ensemblePosition!)
            .map((instrument) => instrument.id);
        this.instrumentIds = [...this.ensemble];
        this.parts = byEnsembleOrder(this.parts, this.ensemble, (choice) => choice.part.instruments.map((instrument) => instrument.id));
        // Una parte senza strumenti sceglie quello del rigo dal catalogo.
        for (const choice of this.parts) if (!choice.part.instruments.length) choice.options = catalog;
        if (this.parts.length) this.sources = [...this.sources, { label: 'Dalle parti della traccia', value: 'parts' }];
        this.readReference();
        this.align();
        this.loading = false;
        this.changeDetector.markForCheck();
    }

    protected get subtitle(): string {
        return this.source === 'ensemble'
            ? "Un rigo di pause per ogni strumento, nell'ordine dell'organico; le percussioni stanno su un rigo solo."
            : "Un rigo per ogni parte scelta, nell'ordine dell'organico, con le battute e la struttura della parte di riferimento.";
    }

    /** Righi della partitura dall'organico. */
    protected get plannedRows(): PlannedRow<CatalogInstrument>[] {
        const selected = this.instrumentIds.map((id) => this.catalog.find((instrument) => instrument.id === id)).filter((instrument): instrument is CatalogInstrument => !!instrument);
        return ensembleRows(byEnsembleOrder(selected, this.ensemble, (instrument) => [instrument.id]));
    }

    protected get selectedParts(): PartChoice[] {
        return this.parts.filter((choice) => choice.selected);
    }

    protected get errors(): string[] {
        const errors: string[] = [];
        if (this.source === 'ensemble') {
            const rows = this.plannedRows;
            if (!rows.length) errors.push('Scegli almeno uno strumento.');
            if (rows.length > MAX_ROWS) errors.push(`La partitura ha al massimo ${MAX_ROWS} righi.`);
            errors.push(...setupErrors({ partName: '', clef: 'G2', fifths: this.concertKey, beats: this.beats, beatType: this.beatType, tempo: this.tempo, measures: this.measures, pickupBeats: this.pickupBeats }));
        } else {
            const selected = this.selectedParts;
            if (!selected.length) errors.push('Scegli almeno una parte.');
            if (selected.length > MAX_ROWS) errors.push(`La partitura ha al massimo ${MAX_ROWS} righi.`);
            if (selected.some((choice) => choice.options.length && choice.instrumentId === null)) errors.push('Scegli lo strumento di ogni parte.');
            if (selected.length && !selected.some((choice) => choice.part.scoreId === this.referenceId)) errors.push('Scegli la parte di riferimento tra quelle della partitura.');
            if (this.partsError) errors.push(this.partsError);
        }
        return errors;
    }

    protected error(text: string): string | undefined {
        return this.errors.find((message) => message.startsWith(text));
    }

    protected get pickupLabel(): string {
        return `Levare (in ${this.beatType === 4 ? 'semiminime' : this.beatType === 8 ? 'crome' : this.beatType === 2 ? 'minime' : `1/${this.beatType}`})`;
    }

    /** Strumenti senza trasposizione, scritti come strumenti in Do. */
    protected get unconfigured(): string[] {
        if (this.concertPitch) return [];
        if (this.source === 'ensemble') return this.plannedRows.filter((row) => rowSetup(row, this.concertKey, false).unconfigured).map((row) => row.name);
        return this.selectedParts.filter((choice) => rowTransposition(this.rowInstruments(choice), choice.clefSign) === null).map((choice) => choice.label);
    }

    protected changed(): void {
        this.dirty = true;
    }

    protected changedParts(): void {
        this.dirty = true;
        if (!this.selectedParts.some((choice) => choice.part.scoreId === this.referenceId)) this.referenceId = this.selectedParts[0]?.part.scoreId ?? null;
        this.align();
    }

    protected changedReference(): void {
        this.dirty = true;
        this.align();
    }

    protected cancel(): void {
        this.dialogRef.close();
    }

    /** Senza organico: chiude il dialogo e apre la scheda Organico degli strumenti. */
    protected openEnsemble(): void {
        this.dialogRef.close();
        void this.router.navigate(['/instruments'], { queryParams: { tab: 'ensemble' } });
    }

    protected async save(): Promise<void> {
        if (this.errors.length || this.saving) return;
        let request;
        try {
            request = this.source === 'ensemble' ? this.ensembleRequest() : this.partsRequest();
        } catch (error) {
            this.partsError = error instanceof EditError || error instanceof Error ? error.message : 'Partitura non creata';
            this.changeDetector.markForCheck();
            return;
        }
        this.saving = true;
        this.changeDetector.markForCheck();
        try {
            const arrangement = await this.arrangementService.create(this.data.trackId, request, withErrorSummary('Partitura non creata'));
            this.dialogRef.close({ arrangement } satisfies NewArrangementDialogResult);
        } catch {
            // L'avviso dell'errore è già mostrato; il dialogo resta aperto per riprovare.
        } finally {
            this.saving = false;
            this.changeDetector.markForCheck();
        }
    }

    private ensembleRequest(): { content: string; rows: ArrangementRowRequest[] } {
        const rows = this.plannedRows;
        const content = newArrangementXml({
            rows: rows.map((row) => rowSetup(row, this.concertKey, this.concertPitch).setup),
            beats: this.beats,
            beatType: this.beatType,
            tempo: this.tempo,
            measures: this.measures,
            pickupBeats: this.pickupBeats,
            concertPitch: this.concertPitch
        });
        return { content, rows: rows.map((row, index) => ({ id: `P${index + 1}`, instrumentIds: row.instruments.map((instrument) => instrument.id) })) };
    }

    private partsRequest(): { content: string; rows: ArrangementRowRequest[] } {
        const selected = this.selectedParts;
        const reference = selected.findIndex((choice) => choice.part.scoreId === this.referenceId);
        const aligned = alignParts(
            selected.map((choice) => this.contents.get(choice.part.scoreId)!),
            reference
        );
        const parts = selected.map((choice, index) => {
            const transposition = rowTransposition(this.rowInstruments(choice), choice.clefSign);
            const xml = this.concertPitch && transposition ? concertPartXml(aligned[index].xml, transposition, choice.label) : aligned[index].xml;
            return { xml, name: choice.label };
        });
        return {
            content: combineParts(parts, this.concertPitch),
            rows: selected.map((choice, index) => ({ id: `P${index + 1}`, instrumentIds: this.rowInstruments(choice).map((instrument) => instrument.id), scoreId: choice.part.scoreId }))
        };
    }

    /** Strumenti del rigo fatto dalla parte: quelli della parte, o quello scelto. */
    private rowInstruments(choice: PartChoice): RowInstrument[] {
        if (!choice.options.length) return choice.part.instruments;
        const chosen = choice.options.find((instrument) => instrument.id === choice.instrumentId);
        return chosen ? [chosen] : [];
    }

    /** Allinea le parti scelte alla parte di riferimento, per mostrare le differenze. */
    private align(): void {
        this.partsError = null;
        for (const choice of this.parts) choice.changes = [];
        const selected = this.selectedParts;
        const reference = selected.findIndex((choice) => choice.part.scoreId === this.referenceId);
        if (reference < 0) return;
        try {
            const aligned = alignParts(
                selected.map((choice) => this.contents.get(choice.part.scoreId)!),
                reference
            );
            selected.forEach((choice, index) => (choice.changes = aligned[index].changes));
        } catch (error) {
            this.partsError = error instanceof EditError ? `${error.message}.` : 'Una delle parti non è leggibile.';
        }
    }

    /** Metro, tempo, battute, levare e tonalità dalla parte di riferimento della traccia. */
    private readReference(): void {
        const choice = this.parts.find((candidate) => candidate.part.scoreId === this.referenceId);
        const xml = choice ? this.contents.get(choice.part.scoreId) : undefined;
        const reference = xml ? readReferencePart(xml) : null;
        if (!choice || !reference) return;
        const instruments = choice.part.instruments;
        const sound = choice.part.sound;
        const semitones = instruments.length === 1 ? ((reference.clefSign === 'F' ? (sound.bassClefTranspositionSemitones ?? sound.transpositionSemitones) : sound.transpositionSemitones) ?? 0) : 0;
        this.concertKey = concertFifths(reference.fifths, semitones);
        this.beats = reference.beats;
        this.beatType = reference.beatType;
        this.measures = Math.min(reference.measures, MAX_MEASURES);
        this.pickupBeats = reference.pickupBeats;
        this.tempo = this.data.playback.tempoBpm ?? reference.tempo;
    }

    /** Parti della traccia con note e il loro MusicXML; la parte di riferimento è quella della traccia o la prima approvata. */
    private async loadParts(): Promise<void> {
        const withNotes = this.data.playback.parts.filter((part) => part.version);
        this.partsWithoutNotes = this.data.playback.parts.length - withNotes.length;
        const loaded = await Promise.all(
            withNotes.map(async (part) => {
                try {
                    return { part, xml: await firstValueFrom(this.playbackService.playbackFile(this.data.trackId, part.scoreId)) };
                } catch {
                    return { part, xml: null };
                }
            })
        );
        const readable = loaded.filter((item): item is { part: PartPlayback; xml: string } => item.xml !== null);
        this.partsWithoutNotes += loaded.length - readable.length;
        for (const { part, xml } of readable) this.contents.set(part.scoreId, xml);
        this.parts = readable.map(({ part, xml }) => {
            // Un rigo intonato ha un solo strumento: una parte di più strumenti, non tutti a percussione, ne sceglie uno.
            const pitched = part.instruments.filter((instrument) => !isPercussionRow([instrument]));
            const choose = part.instruments.length > 1 && pitched.length > 0;
            return {
                part,
                label: partLabel(part),
                selected: true,
                options: choose ? part.instruments : [],
                instrumentId: choose ? pitched[0].id : null,
                clefSign: readReferencePart(xml)?.clefSign ?? 'G',
                changes: []
            };
        });
        const parts = readable.map(({ part }) => part);
        const reference = parts.find((part) => part.scoreId === this.data.playback.referenceScoreId) ?? parts.find((part) => part.version?.status === 'APPROVED') ?? parts[0];
        this.referenceId = reference?.scoreId ?? null;
        this.referenceOptions = this.parts.map((choice) => ({ label: choice.label, value: choice.part.scoreId }));
    }

    /** Tutti gli strumenti dell'associazione, pagina dopo pagina. */
    private async loadInstruments(): Promise<CatalogInstrument[]> {
        const criteria: InstrumentsCriteria = { page: 0, sort: ['name,asc'] };
        const instruments: CatalogInstrument[] = [];
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
