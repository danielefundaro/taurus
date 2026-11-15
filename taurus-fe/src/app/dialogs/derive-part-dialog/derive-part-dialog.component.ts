import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { firstValueFrom } from 'rxjs';
import { ImportsModule } from '../../imports';
import { InstrumentsCriteria, PartPlayback, TrackPlayback } from '../../module';
import { proposedClef } from '../../score-editor/new-part';
import { CLEF_OPTIONS } from '../../score-editor/notation-rules';
import { ScoreDocument } from '../../score-editor/score-document';
import { clefTransposition, DerivationOctave, DerivationPlan, derivedPartXml, fifthsLabel, initialClef, planDerivation, rangeLabel } from '../../score-editor/score-derivation';
import { openScore } from '../../score-editor/score-edits';
import { partLabel } from '../../score-player/playback-labels';
import { InstrumentsService, ScoreDraftService, ScorePlaybackService, withErrorSummary } from '../../service';

export interface DerivePartDialogData {
    trackId: number;
    playback: TrackPlayback;
    /** Parte di origine, con la versione ascoltata e un solo strumento intonato. */
    part: PartPlayback;
}

/** Parte ricavata, aggiunta in fondo alla traccia con la sua prima bozza. */
export interface DerivePartDialogResult {
    scoreId: number;
    trackVersion: number;
}

/** Strumento di destinazione: intonato, diverso da quello della parte; senza trasposizione resta da configurare. */
interface TargetInstrument {
    id: number;
    name: string;
    transpositionSemitones?: number | null;
    bassClefTranspositionSemitones?: number | null;
    lowestWrittenPitch?: number | null;
    highestWrittenPitch?: number | null;
    disabled: boolean;
    label: string;
}

const OCTAVE_NAMES: Readonly<Record<number, string>> = { [-2]: 'Due ottave sotto', [-1]: "Un'ottava sotto", 0: "Stesso suono dell'originale", 1: "Un'ottava sopra", 2: 'Due ottave sopra' };

/**
 * Parte ricavata da un'altra per uno strumento diverso: l'intervallo che mantiene il suono, l'ottava con meno note fuori
 * dall'estensione dello strumento, la chiave e il nome. La versione ascoltata si traspone nel browser e diventa la prima
 * bozza della parte nuova, che si apre nell'editor di scrittura.
 */
@Component({
    selector: 'app-derive-part-dialog',
    standalone: true,
    imports: [ImportsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './derive-part-dialog.component.html'
})
export class DerivePartDialogComponent implements OnInit {
    protected readonly data: DerivePartDialogData;
    protected readonly clefs = CLEF_OPTIONS.filter((option) => option.value !== 'percussion');

    protected instruments: TargetInstrument[] = [];
    protected instrumentId: number | null = null;
    protected description = '';
    protected clef = 'G2';
    protected octave = 0;
    protected plan: DerivationPlan | null = null;
    protected loading = true;
    protected loadError = false;
    protected saving = false;
    protected dirty = false;

    private xml = '';
    private score: ScoreDocument | null = null;
    private sourceTransposition = 0;
    /** Nome, chiave e ottava scelti a mano non cambiano più con lo strumento. */
    private descriptionChosen = false;
    private clefChosen = false;
    private octaveChosen = false;

    constructor(
        private readonly dialogRef: DynamicDialogRef<DerivePartDialogComponent>,
        private readonly playbackService: ScorePlaybackService,
        private readonly draftService: ScoreDraftService,
        private readonly instrumentsService: InstrumentsService,
        private readonly changeDetector: ChangeDetectorRef,
        private readonly router: Router,
        config: DynamicDialogConfig<DerivePartDialogData>
    ) {
        this.data = config.data!;
    }

    async ngOnInit(): Promise<void> {
        const [instruments] = await Promise.all([this.loadInstruments(), this.loadSource()]);
        const source = this.data.part.instruments[0]?.id;
        this.instruments = instruments
            .filter((instrument) => instrument.id !== source && (instrument.percussionKey === null || instrument.percussionKey === undefined))
            .map((instrument) => {
                const disabled = instrument.transpositionSemitones === null || instrument.transpositionSemitones === undefined;
                return { ...instrument, disabled, label: disabled ? `${instrument.name} (da configurare)` : instrument.name };
            });
        this.loading = false;
        this.changeDetector.markForCheck();
    }

    protected get heading(): string {
        return `Ricava una parte da ${partLabel(this.data.part)}`;
    }

    protected get subtitle(): string {
        const version = this.data.part.version;
        return `Dalla versione ${version?.versionNumber ?? ''} ascoltata, trasposta per lo strumento scelto. La parte si aggiunge in fondo alla traccia e si apre nell'editor di scrittura.`;
    }

    protected get target(): TargetInstrument | null {
        return this.instruments.find((instrument) => instrument.id === this.instrumentId) ?? null;
    }

    /** Ottave possibili, con l'intervallo e le note fuori estensione. */
    protected get octaves(): { value: number; label: string }[] {
        return (this.plan?.octaves ?? []).filter((candidate) => candidate.possible).map((candidate) => ({ value: candidate.octave, label: this.octaveLabel(candidate) }));
    }

    protected get chosen(): DerivationOctave | null {
        return this.plan?.octaves.find((candidate) => candidate.octave === this.octave && candidate.possible) ?? null;
    }

    protected get keyLabel(): string {
        const fifths = this.plan?.fifths;
        return fifths === null || fifths === undefined ? 'La parte non ha armatura' : `Armatura: ${fifthsLabel(fifths)}`;
    }

    protected get rangeText(): string | null {
        const range = this.plan?.range;
        return range ? rangeLabel(range) : null;
    }

    /** Errori che impediscono di creare la parte. */
    protected get errors(): string[] {
        if (this.loading) return ['loading'];
        if (this.loadError) return ['La versione della parte non si legge.'];
        if (!this.target) return ['Scegli lo strumento.'];
        if (this.plan?.error) return [this.plan.error];
        if (!this.chosen) return ["Nessuna ottava dà note scrivibili: scegli un altro strumento o un'altra chiave."];
        return [];
    }

    protected changedInstrument(): void {
        this.dirty = true;
        const target = this.target;
        if (!this.descriptionChosen) this.description = target?.name ?? '';
        if (!this.clefChosen && target) this.clef = proposedClef([target]);
        this.octaveChosen = false;
        this.replan();
    }

    protected changedDescription(): void {
        this.dirty = true;
        this.descriptionChosen = true;
    }

    protected changedClef(): void {
        this.dirty = true;
        this.clefChosen = true;
        this.replan();
    }

    protected changedOctave(): void {
        this.dirty = true;
        this.octaveChosen = true;
    }

    protected cancel(): void {
        this.dialogRef.close();
    }

    /** Apre lo strumento di destinazione per configurarne l'estensione, chiudendo il dialogo. */
    protected configure(): void {
        const target = this.target;
        if (!target) return;
        this.dialogRef.close();
        void this.router.navigate(['/instruments', target.id]);
    }

    protected async save(): Promise<void> {
        const target = this.target;
        const version = this.data.part.version;
        if (this.errors.length || this.saving || !target || !version) return;
        const name = this.description.trim() || target.name;
        let content: string;
        try {
            content = derivedPartXml(this.xml, this.sourceTransposition, target, this.clef, this.octave, name);
        } catch (error) {
            this.plan = this.plan ? { ...this.plan, error: error instanceof Error ? error.message : String(error) } : this.plan;
            this.changeDetector.markForCheck();
            return;
        }
        this.saving = true;
        this.changeDetector.markForCheck();
        try {
            const created = await this.draftService.derivePart(
                this.data.trackId,
                this.data.part.scoreId,
                { versionId: version.id, instrumentId: target.id, description: this.description.trim() || null, content, trackVersion: this.data.playback.version },
                withErrorSummary('Parte non ricavata')
            );
            this.dialogRef.close({ scoreId: created.scoreId, trackVersion: created.trackVersion } satisfies DerivePartDialogResult);
        } catch {
            // L'avviso dell'errore è già mostrato; il dialogo resta aperto per riprovare.
        } finally {
            this.saving = false;
            this.changeDetector.markForCheck();
        }
    }

    private octaveLabel(candidate: DerivationOctave): string {
        const count = candidate.outOfRange;
        const outside = count === null ? '' : count === 0 ? " · tutte le note nell'estensione" : ` · ${count === 1 ? '1 nota' : `${count} note`} fuori estensione`;
        return `${OCTAVE_NAMES[candidate.octave]} · ${candidate.label}${outside}`;
    }

    private replan(): void {
        const target = this.target;
        this.plan = target && this.score && !target.disabled ? planDerivation(this.score, this.sourceTransposition, target, this.clef) : null;
        if (!this.plan) return;
        const possible = this.plan.octaves.some((candidate) => candidate.octave === this.octave && candidate.possible);
        if (!this.octaveChosen || !possible) this.octave = this.plan.proposed ?? 0;
    }

    /** Versione ascoltata della parte di origine e la sua trasposizione, sovrascrittura compresa, nella chiave iniziale. */
    private async loadSource(): Promise<void> {
        try {
            this.xml = await firstValueFrom(this.playbackService.playbackFile(this.data.trackId, this.data.part.scoreId));
            this.score = openScore(this.xml);
        } catch {
            this.loadError = true;
            return;
        }
        const clef = initialClef(this.score);
        const sign = CLEF_OPTIONS.find((option) => option.value === clef)?.clef.sign ?? 'G';
        this.sourceTransposition = clefTransposition(this.data.part.sound, sign) ?? 0;
    }

    /** Tutti gli strumenti dell'associazione, pagina dopo pagina. */
    private async loadInstruments(): Promise<(Omit<TargetInstrument, 'disabled' | 'label'> & { percussionKey?: number | null })[]> {
        const criteria: InstrumentsCriteria = { page: 0, sort: ['name,asc'] };
        const instruments: (Omit<TargetInstrument, 'disabled' | 'label'> & { percussionKey?: number | null })[] = [];
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
