import { ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { editLockMessage } from '../../constants';
import { ImportsModule } from '../../imports';
import { Arrangement, ArrangementRowState, ArrangementRowStatus, ExtractionResult, PartPlayback, TrackPlayback } from '../../module';
import { extractedParts, isPercussionRow, PartHeader } from '../../score-editor/score-arrangement';
import { EditError } from '../../score-editor/score-document';
import { partLabel } from '../../score-player/playback-labels';
import { ArrangementService, withErrorSummary } from '../../service';

export interface ExtractPartsDialogData {
    trackId: number;
    /** La partitura con la versione corrente, da cui si estrae, e i righi con lo stato della loro parte. */
    arrangement: Arrangement;
    /** Le parti della traccia, con strumenti, pagine, blocchi e la versione della traccia. */
    playback: TrackPlayback;
    /** Titolo, compositore e arrangiatore della traccia, scritti nelle parti. */
    header: PartHeader;
    /** Il servizio musicale impagina: al termine si offre «Impagina le parti». */
    canEngrave: boolean;
}

/** Una parte da impaginare dopo l'estrazione. */
export interface ExtractedPartToEngrave {
    scoreId: number;
    versionId: number;
    partLabel: string;
    hasPages: boolean;
}

/** Parti estratte e, con «Impagina le parti», quelle da impaginare. */
export interface ExtractPartsDialogResult {
    result: ExtractionResult;
    engrave: ExtractedPartToEngrave[] | null;
}

type Severity = 'success' | 'info' | 'warn' | 'danger' | 'secondary';

export const EXTRACTION_STATUS: Readonly<Record<ArrangementRowStatus, { label: string; severity: Severity }>> = {
    NEW: { label: 'Nuova', severity: 'secondary' },
    TO_EXTRACT: { label: 'Da estrarre', severity: 'info' },
    UP_TO_DATE: { label: 'Aggiornata', severity: 'success' },
    MODIFIED: { label: "Modificata dopo l'estrazione", severity: 'warn' },
    PART_DELETED: { label: 'Parte eliminata', severity: 'danger' }
};

/** Valore della scelta «Parte nuova»: le parti della traccia hanno `id` positivi. */
export const NEW_PART = 0;

/** Stati dei righi scelti all'apertura: quelli senza parte o con una partitura più recente dell'estrazione. */
const PRESELECTED: ReadonlySet<ArrangementRowStatus> = new Set(['NEW', 'TO_EXTRACT', 'PART_DELETED']);

interface TargetOption {
    /** Parte della traccia, o `NEW_PART` per una parte nuova. */
    value: number;
    label: string;
}

interface RowChoice {
    row: ArrangementRowState;
    name: string;
    instruments: string;
    targets: TargetOption[];
    /** Parte che riceve la versione, o `NEW_PART`. */
    target: number;
    selected: boolean;
    /** Perché il rigo non si può estrarre da questa partitura, indipendentemente dalla parte scelta. */
    rowBlocker: string | null;
}

interface ExtractedView extends ExtractedPartToEngrave {
    row: string;
    created: boolean;
}

/**
 * Estrazione delle parti dalla versione corrente della partitura: per ogni rigo la parte della traccia che riceve la
 * versione, proposta tra quelle con gli stessi strumenti, e lo stato della parte. Il MusicXML di ogni parte si costruisce
 * nel browser; al termine le parti estratte si possono impaginare.
 */
@Component({
    selector: 'app-extract-parts-dialog',
    standalone: true,
    imports: [ImportsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './extract-parts-dialog.component.html'
})
export class ExtractPartsDialogComponent {
    protected readonly data: ExtractPartsDialogData;
    protected readonly status = EXTRACTION_STATUS;
    protected readonly choices: RowChoice[];
    protected step: 'choose' | 'done' = 'choose';
    protected busy = false;
    protected dirty = false;
    /** Perché le parti non si sono potute costruire nel browser. */
    protected problem: string | null = null;
    protected extracted: ExtractedView[] = [];
    private result: ExtractionResult | null = null;

    constructor(
        private readonly dialogRef: DynamicDialogRef<ExtractPartsDialogComponent>,
        private readonly arrangementService: ArrangementService,
        private readonly changeDetector: ChangeDetectorRef,
        config: DynamicDialogConfig<ExtractPartsDialogData>
    ) {
        this.data = config.data!;
        this.choices = proposeTargets(this.data.arrangement, this.data.playback);
        // Una parte in modifica da qualcuno non riceve la versione finché il blocco non si libera.
        for (const choice of this.choices) if (this.blocker(choice)) choice.selected = false;
    }

    protected get version(): number {
        return this.data.arrangement.currentVersion?.versionNumber ?? 0;
    }

    protected get heading(): string {
        return this.step === 'done' ? 'Parti estratte' : 'Estrai le parti';
    }

    protected get subtitle(): string {
        if (this.step === 'done') return `Dalla versione ${this.version} della partitura`;
        const notation = this.data.arrangement.currentVersion?.concertPitch ? 'in suoni reali: ogni parte torna nella notazione del suo strumento' : 'trasposta';
        return `Versione ${this.version} della partitura, ${notation}`;
    }

    protected get selectedCount(): number {
        return this.choices.filter((choice) => choice.selected && !this.blocker(choice)).length;
    }

    /** Problemi della scelta che impediscono l'estrazione. */
    protected get errors(): string[] {
        if (this.step !== 'choose') return [];
        const chosen = this.choices.filter((choice) => choice.selected && !this.blocker(choice));
        if (!chosen.length) return ['Scegli almeno un rigo da estrarre.'];
        const targets = chosen.map((choice) => choice.target).filter((target) => target !== NEW_PART);
        if (new Set(targets).size !== targets.length) return ['La stessa parte è scelta per più righi: scegli una parte diversa o «Parte nuova».'];
        return [];
    }

    /** Perché il rigo non si può scegliere: lo strumento non configurato o la parte scelta in modifica; `null` se si può. */
    protected blocker(choice: RowChoice): string | null {
        if (choice.rowBlocker) return choice.rowBlocker;
        const part = this.part(choice.target);
        return part?.editing ? `${partLabel(part)}: ${editLockMessage(part.editing.ownerName, part.editing.since, false)}` : null;
    }

    protected changedTarget(choice: RowChoice): void {
        this.dirty = true;
        if (this.blocker(choice)) choice.selected = false;
    }

    protected changedSelection(): void {
        this.dirty = true;
    }

    protected cancel(): void {
        this.dialogRef.close(this.result ? ({ result: this.result, engrave: null } satisfies ExtractPartsDialogResult) : undefined);
    }

    /** Costruisce le parti dei righi scelti e le estrae in una sola richiesta. */
    protected async extract(): Promise<void> {
        const version = this.data.arrangement.currentVersion;
        if (this.errors.length || this.busy || !version) return;
        const chosen = this.choices.filter((choice) => choice.selected && !this.blocker(choice));
        this.busy = true;
        this.problem = null;
        this.changeDetector.markForCheck();
        try {
            let xml: string;
            try {
                xml = await this.arrangementService.content(this.data.trackId, version.id);
            } catch {
                this.problem = 'La partitura non si legge: riprova più tardi.';
                return;
            }
            let contents: string[];
            try {
                contents = extractedParts(
                    xml,
                    chosen.map((choice) => ({ id: choice.row.id, instruments: choice.row.instruments, partName: this.partName(choice) })),
                    this.data.header
                );
            } catch (error) {
                this.problem = error instanceof EditError ? `${error.message}: le parti non si estraggono.` : 'Le parti non si possono costruire dalla partitura.';
                return;
            }
            const result = await this.arrangementService.extract(
                this.data.trackId,
                version.id,
                {
                    trackVersion: this.data.playback.version ?? null,
                    rows: chosen.map((choice, index) => ({ row: choice.row.id, sheetMusicId: choice.target === NEW_PART ? null : choice.target, description: null, content: contents[index] }))
                },
                withErrorSummary('Parti non estratte')
            );
            this.result = result;
            this.extracted = result.parts.map((part) => {
                const choice = chosen.find((candidate) => candidate.row.id === part.row);
                return {
                    row: choice?.name ?? part.row,
                    partLabel: choice ? this.partName(choice) : part.row,
                    created: part.created,
                    scoreId: part.scoreId,
                    versionId: part.versionId,
                    hasPages: !part.created && !!this.part(part.scoreId)?.hasPages
                };
            });
            this.step = 'done';
            this.dirty = false;
        } catch {
            // L'avviso dell'errore è già mostrato; la scelta resta per riprovare.
        } finally {
            this.busy = false;
            this.changeDetector.markForCheck();
        }
    }

    /** Chiude il dialogo con le parti estratte da impaginare. */
    protected engrave(): void {
        if (!this.result) return;
        const engrave = this.extracted.map(({ scoreId, versionId, partLabel, hasPages }) => ({ scoreId, versionId, partLabel, hasPages }));
        this.dialogRef.close({ result: this.result, engrave } satisfies ExtractPartsDialogResult);
    }

    /** Nome della parte che riceve il rigo: quello della parte scelta, o del rigo per una parte nuova. */
    private partName(choice: RowChoice): string {
        const part = this.part(choice.target);
        return part ? partLabel(part) : choice.name;
    }

    private part(scoreId: number): PartPlayback | undefined {
        return this.data.playback.parts.find((part) => part.scoreId === scoreId);
    }
}

/**
 * Per ogni rigo le parti con gli stessi strumenti e quella proposta: la parte collegata al rigo, altrimenti l'unica con
 * gli stessi strumenti non collegata a un altro rigo e non già proposta, altrimenti una parte nuova.
 */
export function proposeTargets(arrangement: Arrangement, playback: TrackPlayback): RowChoice[] {
    const concertPitch = !!arrangement.currentVersion?.concertPitch;
    const linked = new Set(arrangement.rows.map((row) => row.scoreId).filter((id): id is number => id !== null && id !== undefined));
    const proposed = new Set<number>();
    return arrangement.rows.map((row) => {
        const ids = new Set(row.instruments.map((instrument) => instrument.id));
        const same = playback.parts.filter((part) => part.instruments.length === ids.size && part.instruments.every((instrument) => ids.has(instrument.id)));
        const own = row.scoreId !== null && row.scoreId !== undefined ? same.find((part) => part.scoreId === row.scoreId) : undefined;
        let target = own?.scoreId ?? NEW_PART;
        if (!own) {
            const free = same.filter((part) => !linked.has(part.scoreId) && !proposed.has(part.scoreId));
            if (free.length === 1) target = free[0].scoreId;
        }
        if (target !== NEW_PART) proposed.add(target);
        const instruments = row.instruments.map((instrument) => instrument.name).join(', ');
        const name = row.name?.trim() || instruments || row.id;
        const unconfigured = concertPitch && row.instruments.length === 1 && !isPercussionRow(row.instruments) && (row.instruments[0].transpositionSemitones ?? null) === null ? row.instruments[0] : null;
        const choice: RowChoice = {
            row,
            name,
            instruments,
            targets: [...same.map((part) => ({ value: part.scoreId, label: `${partLabel(part)}${part.hasPages ? '' : ' · senza pagine'}` })), { value: NEW_PART, label: 'Parte nuova' }],
            target,
            selected: PRESELECTED.has(row.status),
            rowBlocker: unconfigured ? `Configura la trasposizione di ${unconfigured.name} per estrarre il rigo da una partitura in suoni reali` : null
        };
        if (choice.rowBlocker) choice.selected = false;
        return choice;
    });
}
