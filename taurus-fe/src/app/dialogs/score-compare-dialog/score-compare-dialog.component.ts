import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { firstValueFrom, Observable, of } from 'rxjs';
import { ImportsModule } from '../../imports';
import { ArrangementRow, ScoreVersionOrigin, ScoreVersionStatus } from '../../module';
import { rowSound, rowXml } from '../../score-editor/score-arrangement';
import { measureElements } from '../../score-player/notation';
import { originLabel } from '../../score-player/playback-labels';
import { CompareRow, CompareSound, compareMeasures, differenceText, MeasureComparison, MeasureDifference, readRows } from '../../score-player/score-compare';
import { ArrangementService, ScorePlaybackService, ScoreRendererService } from '../../service';

/** Una versione di una parte o della partitura, come la restituiscono i due elenchi delle versioni. */
export interface ComparedVersion {
    id: number;
    versionNumber: number;
    status: ScoreVersionStatus;
    /** Origine di una versione di una parte. */
    origin?: ScoreVersionOrigin;
    /** Una versione della partitura scritta in suoni reali. */
    concertPitch?: boolean;
    parentVersionId?: number | null;
    createdAt: string;
}

export interface ScoreCompareDialogData {
    trackId: number;
    /** Parte di cui si confrontano le versioni; assente per la partitura della traccia. */
    scoreId?: number | null;
    /** Nome della parte, o «Partitura», nel titolo. */
    subject: string;
    /** La versione da cui parte il confronto: «Con» cambia l'altra. */
    versionId: number;
    /** L'altra versione all'apertura; senza, quella da cui deriva o la precedente (`comparedWith`). */
    withId?: number | null;
    /** Senza `withId`: l'altra versione è la più recente con questa origine, come l'ultima estratta dalla partitura. */
    withOrigin?: ScoreVersionOrigin | null;
    /** Parte: suono e trasposizione, per confrontare le note come si ascoltano. */
    sound?: CompareSound | null;
    /** Partitura: i righi con i loro strumenti, per la trasposizione di ciascuno. */
    rows?: readonly ArrangementRow[] | null;
    /** «Correggi» apre l'editor di correzione sulla versione di destra, alla battuta della differenza scelta. */
    correctable?: boolean;
}

/** «Correggi»: la versione da aprire nell'editor di correzione e la battuta da selezionare, da 0. */
export interface ScoreCompareDialogResult {
    correctVersionId: number;
    measureIndex: number;
}

/** Un rigo confrontato: nella parte l'unico, nella partitura uno per `id` di parte delle due versioni. */
interface ComparedRow {
    id: string;
    name: string;
    older: { index: number; row: CompareRow } | null;
    newer: { index: number; row: CompareRow } | null;
    /** Confronto della versione più vecchia con la più recente, che fa da riferimento; `null` se il rigo è in una sola versione. */
    comparison: MeasureComparison | null;
}

/**
 * La versione con cui si confronta all'apertura: quella da cui la versione deriva, come la versione corretta da una
 * correzione; altrimenti la precedente, e per la prima versione la successiva.
 */
export function comparedWith<T extends ComparedVersion>(versions: readonly T[], version: T): T | null {
    const others = versions.filter((item) => item.id !== version.id);
    const parent = others.find((item) => item.id === version.parentVersionId);
    if (parent) return parent;
    const previous = others.filter((item) => item.versionNumber < version.versionNumber).sort((first, second) => second.versionNumber - first.versionNumber);
    return previous[0] ?? [...others].sort((first, second) => first.versionNumber - second.versionNumber)[0] ?? null;
}

/** Apre il confronto a schermo intero; emette la versione e la battuta da correggere, o `undefined` se si chiude. */
export function openCompareDialog(dialogService: DialogService, data: ScoreCompareDialogData): Observable<ScoreCompareDialogResult | undefined> {
    const ref = dialogService.open(ScoreCompareDialogComponent, {
        showHeader: false,
        width: '100vw',
        height: '100vh',
        modal: true,
        focusOnShow: false,
        data,
        style: { 'max-height': '100vh', 'border-radius': '0' },
        contentStyle: { padding: '0', overflow: 'hidden', height: '100vh' }
    });
    return ref?.onClose ?? of(undefined);
}

/**
 * Confronto di due versioni di una parte, o della partitura rigo per rigo, con le battute che si ascoltano diverse
 * evidenziate nei due spartiti affiancati, la più vecchia a sinistra. Il confronto non cambia nulla.
 */
@Component({
    selector: 'app-score-compare-dialog',
    standalone: true,
    imports: [ImportsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './score-compare-dialog.component.html',
    styleUrl: './score-compare-dialog.component.scss'
})
export class ScoreCompareDialogComponent implements OnInit {
    protected readonly data: ScoreCompareDialogData;
    protected readonly originLabel = originLabel;
    protected status: 'loading' | 'ready' | 'error' = 'loading';
    protected errorMessage = '';
    protected drawing = false;
    protected drawError: string | null = null;
    protected versions: ComparedVersion[] = [];
    protected otherId: number | null = null;
    protected older: ComparedVersion | null = null;
    protected newer: ComparedVersion | null = null;
    protected rows: ComparedRow[] = [];
    protected rowId: string | null = null;
    /** Testi delle differenze del rigo mostrato. */
    protected texts: string[] = [];
    /** Posizione della differenza scelta; -1 senza differenze. */
    protected current = -1;

    @ViewChild('left') private left?: ElementRef<HTMLElement>;
    @ViewChild('right') private right?: ElementRef<HTMLElement>;
    @ViewChild('list') private list?: ElementRef<HTMLElement>;
    private readonly contents = new Map<number, Promise<string>>();
    private olderXml = '';
    private newerXml = '';
    private leftMeasures: (Element | undefined)[] = [];
    private rightMeasures: (Element | undefined)[] = [];
    /** Ogni disegno ha il suo numero: un disegno superato da un altro rigo o da un'altra versione si scarta. */
    private drawRequest = 0;

    constructor(
        private readonly dialogRef: DynamicDialogRef<ScoreCompareDialogComponent>,
        private readonly playbackService: ScorePlaybackService,
        private readonly arrangementService: ArrangementService,
        private readonly renderer: ScoreRendererService,
        private readonly changeDetector: ChangeDetectorRef,
        config: DynamicDialogConfig<ScoreCompareDialogData>
    ) {
        this.data = config.data!;
    }

    /** Si confrontano le versioni della partitura. */
    protected get arrangement(): boolean {
        return this.data.scoreId === null || this.data.scoreId === undefined;
    }

    /** Le versioni da scegliere in «Con»: tutte tranne quella da cui parte il confronto. */
    protected get otherOptions(): { label: string; value: number }[] {
        return this.versions.filter((version) => version.id !== this.data.versionId).map((version) => ({ label: `Versione ${version.versionNumber}`, value: version.id }));
    }

    /** I righi da scegliere in «Rigo», con quante differenze hanno. */
    protected get rowOptions(): { label: string; value: string }[] {
        return this.rows.map((row) => ({ label: `${row.name} · ${this.rowState(row)}`, value: row.id }));
    }

    protected get row(): ComparedRow | null {
        return this.rows.find((row) => row.id === this.rowId) ?? null;
    }

    protected get differences(): readonly MeasureDifference[] {
        return this.row?.comparison?.differences ?? [];
    }

    /** Il rigo mostrato c'è in una sola delle due versioni: «solo nella versione 5». */
    protected get onlyIn(): ComparedVersion | null {
        const row = this.row;
        if (!row || row.comparison) return null;
        return row.newer ? this.newer : this.older;
    }

    ngOnInit(): void {
        void this.load();
    }

    protected kindLabel(difference: MeasureDifference): string {
        if (difference.kind === 'missing' || difference.kind === 'extra') return 'In una sola versione';
        return difference.kind === 'marks' ? 'Struttura' : 'Cambiata';
    }

    protected async changeOther(): Promise<void> {
        await this.compare();
    }

    protected async changeRow(): Promise<void> {
        this.showRow();
        await this.draw();
    }

    protected choose(index: number): void {
        if (index < 0 || index >= this.differences.length) return;
        this.current = index;
        this.decorate(true);
        this.list?.nativeElement.querySelector(`[data-difference="${index}"]`)?.scrollIntoView({ block: 'nearest' });
        this.changeDetector.markForCheck();
    }

    protected previous(): void {
        this.choose(this.current - 1);
    }

    protected next(): void {
        this.choose(this.current + 1);
    }

    /** `←` e `→` scorrono le differenze, se non si sta usando un campo. */
    @HostListener('document:keydown', ['$event'])
    protected onKey(event: KeyboardEvent): void {
        if (this.status !== 'ready' || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target;
        if (target instanceof Element && target.closest('input, textarea, select, [role="combobox"], [role="listbox"]')) return;
        if (event.key === 'ArrowLeft') this.previous();
        else if (event.key === 'ArrowRight') this.next();
        else return;
        event.preventDefault();
    }

    /** Apre l'editor di correzione sulla versione di destra, alla battuta della differenza scelta. */
    protected correct(): void {
        const newer = this.newer;
        if (!newer || !this.data.correctable) return;
        this.dialogRef.close({ correctVersionId: newer.id, measureIndex: this.measureIndex() } satisfies ScoreCompareDialogResult);
    }

    protected close(): void {
        this.dialogRef.close();
    }

    private async load(): Promise<void> {
        try {
            const { trackId, scoreId } = this.data;
            this.versions = this.arrangement ? await this.arrangementService.versions(trackId) : await firstValueFrom(this.playbackService.versions(trackId, scoreId!));
            const version = this.versions.find((item) => item.id === this.data.versionId);
            if (!version) throw new Error('Versione non trovata');
            const other = this.initialOther(version);
            if (!other) {
                this.fail("Non c'è un'altra versione da confrontare");
                return;
            }
            this.otherId = other.id;
            await this.compare();
        } catch {
            this.fail('Impossibile leggere le versioni da confrontare: riprovare più tardi');
        }
    }

    private initialOther(version: ComparedVersion): ComparedVersion | null {
        const others = this.versions.filter((item) => item.id !== version.id);
        if (this.data.withId !== null && this.data.withId !== undefined) return others.find((item) => item.id === this.data.withId) ?? null;
        if (this.data.withOrigin) return others.filter((item) => item.origin === this.data.withOrigin).sort((first, second) => second.versionNumber - first.versionNumber)[0] ?? null;
        return comparedWith(this.versions, version);
    }

    /** Legge le due versioni, ne confronta i righi e disegna il rigo con la prima differenza. */
    private async compare(): Promise<void> {
        const version = this.versions.find((item) => item.id === this.data.versionId);
        const other = this.versions.find((item) => item.id === this.otherId);
        if (!version || !other) return;
        const [older, newer] = version.versionNumber < other.versionNumber ? [version, other] : [other, version];
        this.status = 'loading';
        this.changeDetector.markForCheck();
        try {
            [this.olderXml, this.newerXml] = await Promise.all([this.content(older.id), this.content(newer.id)]);
            this.older = older;
            this.newer = newer;
            this.rows = this.compareRows(
                readRows(this.olderXml, (id) => this.sound(id, older)),
                readRows(this.newerXml, (id) => this.sound(id, newer))
            );
        } catch {
            this.fail('Impossibile leggere le versioni da confrontare: riprovare più tardi');
            return;
        }
        const keep = this.rows.find((row) => row.id === this.rowId);
        this.rowId = (keep ?? this.rows.find((row) => !row.comparison || row.comparison.differences.length) ?? this.rows[0])?.id ?? null;
        this.showRow();
        this.status = 'ready';
        // Gli spartiti compaiono con lo stato «pronto»: la vista va aggiornata prima di disegnare.
        this.changeDetector.detectChanges();
        await this.draw();
    }

    private compareRows(older: CompareRow[], newer: CompareRow[]): ComparedRow[] {
        const pair = (id: string, name: string, first: number, second: number): ComparedRow => {
            const before = first >= 0 ? { index: first, row: older[first] } : null;
            const after = second >= 0 ? { index: second, row: newer[second] } : null;
            return { id, name, older: before, newer: after, comparison: before && after ? compareMeasures(after.row.measures, before.row.measures) : null };
        };
        if (!this.arrangement) return newer.length && older.length ? [pair('part', this.data.subject, 0, 0)] : [];
        const rowName = (row: CompareRow) => this.data.rows?.find((item) => item.id === row.id)?.name || row.name || row.id;
        const rows = newer.map((row, index) =>
            pair(
                row.id,
                rowName(row),
                older.findIndex((item) => item.id === row.id),
                index
            )
        );
        older.forEach((row, index) => {
            if (!newer.some((item) => item.id === row.id)) rows.push(pair(row.id, rowName(row), index, -1));
        });
        return rows;
    }

    /** Suono del rigo nella versione: nella partitura quello dei suoi strumenti, in suoni reali o nella notazione trasposta. */
    private sound(id: string, version: ComparedVersion): CompareSound {
        if (!this.arrangement) return this.data.sound ?? {};
        return rowSound(this.data.rows?.find((row) => row.id === id)?.instruments ?? [], !!version.concertPitch);
    }

    private content(versionId: number): Promise<string> {
        let content = this.contents.get(versionId);
        if (!content) {
            content = this.arrangement ? this.arrangementService.content(this.data.trackId, versionId) : firstValueFrom(this.playbackService.editor(this.data.trackId, this.data.scoreId!, versionId)).then((editor) => editor.musicXml);
            content.catch(() => this.contents.delete(versionId));
            this.contents.set(versionId, content);
        }
        return content;
    }

    private showRow(): void {
        const labels = { reference: `versione ${this.newer?.versionNumber ?? ''}`, candidate: `versione ${this.older?.versionNumber ?? ''}` };
        this.texts = this.differences.map((difference) => differenceText(difference, labels));
        this.current = this.texts.length ? 0 : -1;
    }

    private rowState(row: ComparedRow): string {
        if (!row.comparison) return `solo nella versione ${(row.newer ? this.newer : this.older)?.versionNumber ?? ''}`;
        const count = row.comparison.differences.length;
        return count === 0 ? 'uguale' : count === 1 ? '1 differenza' : `${count} differenze`;
    }

    /** Disegna il rigo mostrato nelle due versioni; il lato in cui il rigo manca resta vuoto. */
    private async draw(): Promise<void> {
        const request = ++this.drawRequest;
        const row = this.row;
        this.drawing = true;
        this.drawError = null;
        this.leftMeasures = [];
        this.rightMeasures = [];
        this.changeDetector.markForCheck();
        try {
            this.leftMeasures = await this.drawSide(this.left?.nativeElement, this.olderXml, row?.older ?? null, request);
            this.rightMeasures = await this.drawSide(this.right?.nativeElement, this.newerXml, row?.newer ?? null, request);
            if (request !== this.drawRequest) return;
            this.decorate(true);
        } catch {
            if (request === this.drawRequest) this.drawError = 'Impossibile disegnare lo spartito di una delle due versioni';
        } finally {
            if (request === this.drawRequest) {
                this.drawing = false;
                this.changeDetector.markForCheck();
            }
        }
    }

    private async drawSide(host: HTMLElement | undefined, xml: string, side: { index: number; row: CompareRow } | null, request: number): Promise<(Element | undefined)[]> {
        if (!host) return [];
        host.innerHTML = '';
        if (!side) return [];
        const pages = await this.renderer.render(this.arrangement ? rowXml(xml, side.index) : xml, host.clientWidth || 600);
        if (request !== this.drawRequest) return [];
        // L'SVG è generato da Verovio a partire dal MusicXML: i testi sono codificati e non contiene script.
        host.innerHTML = pages.join('');
        return measureElements(side.row.measures, Array.from(host.querySelectorAll('g.measure')));
    }

    /** Evidenzia le battute diverse nei due spartiti e porta entrambi alla differenza scelta. */
    private decorate(scroll: boolean): void {
        for (const host of [this.left?.nativeElement, this.right?.nativeElement]) {
            for (const className of ['is-changed', 'is-only', 'is-current']) {
                for (const item of Array.from(host?.querySelectorAll(`.${className}`) ?? [])) item.classList.remove(className);
            }
        }
        for (const difference of this.differences) {
            if (difference.kind === 'missing') this.rightOf(difference)?.classList.add('is-only');
            else if (difference.kind === 'extra') this.leftOf(difference)?.classList.add('is-only');
            else {
                this.rightOf(difference)?.classList.add('is-changed');
                this.leftOf(difference)?.classList.add('is-changed');
            }
        }
        const chosen = this.differences[this.current];
        if (!chosen) return;
        const left = this.leftOf(chosen);
        const right = this.rightOf(chosen);
        left?.classList.add('is-current');
        right?.classList.add('is-current');
        if (!scroll) return;
        // La battuta di una sola versione porta l'altro spartito alla battuta vicina.
        (left ?? (chosen.reference ? this.leftMeasures[this.near(chosen.reference.index, this.leftMeasures.length)] : undefined))?.scrollIntoView({ block: 'center', inline: 'nearest' });
        (right ?? (chosen.after !== undefined ? this.rightMeasures[this.measureIndex()] : undefined))?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }

    private leftOf(difference: MeasureDifference): Element | undefined {
        return difference.candidate ? this.leftMeasures[difference.candidate.index] : undefined;
    }

    private rightOf(difference: MeasureDifference): Element | undefined {
        return difference.reference ? this.rightMeasures[difference.reference.index] : undefined;
    }

    /** La posizione più vicina a `index` tra `count` battute. */
    private near(index: number, count: number): number {
        return Math.max(0, Math.min(index, count - 1));
    }

    /** Battuta della versione di destra per la differenza scelta: per una battuta solo a sinistra, quella che la segue. */
    private measureIndex(): number {
        const chosen = this.differences[this.current];
        const count = this.row?.newer?.row.measures.length ?? 0;
        if (!chosen) return 0;
        const index = chosen.reference ? chosen.reference.index : chosen.after ? chosen.after.index + 1 : 0;
        return this.near(index, count);
    }

    private fail(message: string): void {
        this.status = 'error';
        this.errorMessage = message;
        this.changeDetector.markForCheck();
    }
}
