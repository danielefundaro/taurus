import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DialogService, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { first, firstValueFrom } from 'rxjs';
import { ImportsModule } from '../../imports';
import { ArrangementRow, PartPlayback, TrackPlayback } from '../../module';
import { isConcertScore, rowName, rowSound, rowXml } from '../../score-editor/score-arrangement';
import { ScoreDocument } from '../../score-editor/score-document';
import { fileName, midiFile, saveFile } from '../../score-player/midi-download';
import { BuiltPlayback, buildPlayback, PlaybackChannel, PlaybackPartInput } from '../../score-player/playback-builder';
import { parseMusicXml, parseMusicXmlParts, ScorePart } from '../../score-player/musicxml-score';
import { measureElements } from '../../score-player/notation';
import { partSound, quartersAt, secondsAt, segmentIndexAt } from '../../score-player/timeline';
import { ArrangementService, ScoreAudioService, ScorePlaybackService, ScoreRendererService, ToastService } from '../../service';
import { checksSummary, partLabel } from '../../score-player/playback-labels';
import { ScoreReportDialogComponent, ScoreReportDialogData } from '../score-report-dialog/score-report-dialog.component';

export interface ScorePlayerDialogData {
    trackId: number;
    playback: TrackPlayback;
    /** `part`: una sola parte; `score`: tutte le parti disponibili con il mixer; `arrangement`: i righi della partitura. */
    mode: 'part' | 'score' | 'arrangement';
    scoreId?: number;
    /** `arrangement`: la versione della partitura da ascoltare e i suoi righi, con gli strumenti. */
    arrangement?: { versionId: number; rows: readonly ArrangementRow[] };
}

interface MixerRow {
    part: PartPlayback;
    label: string;
    volume: number;
    muted: boolean;
    solo: boolean;
}

type PlayerStatus = 'loading' | 'ready' | 'error';

/** Larghezza a cui il mixer va sopra lo spartito, come nel foglio di stile. */
const PHONE_QUERY = '(max-width: 768px)';

@Component({
    selector: 'app-score-player-dialog',
    standalone: true,
    imports: [ImportsModule],
    templateUrl: './score-player-dialog.component.html',
    styleUrl: './score-player-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [DialogService]
})
export class ScorePlayerDialogComponent implements OnInit, OnDestroy {
    /** Contenitore dello spartito: è dentro un blocco condizionale e compare solo dopo il primo aggiornamento della vista. */
    @ViewChild('notation') private notation?: ElementRef<HTMLElement>;

    protected readonly data: ScorePlayerDialogData;
    protected readonly label = partLabel;
    protected status: PlayerStatus = 'loading';
    protected loadingMessage = 'Caricamento dello spartito…';
    protected errorMessage = '';
    protected rows: MixerRow[] = [];
    protected unavailable: PartPlayback[] = [];
    protected notationParts: PartPlayback[] = [];
    protected notationScoreId: number | null = null;
    protected notationLoading = false;
    /** Le parti hanno un numero di battute diverso: le più corte tacciono nelle battute mancanti. */
    protected lengthsDiffer = false;
    /** Sul telefono le righe del mixer partono chiuse, così lo spartito resta visibile; le scorciatoie restano sempre. */
    protected partsOpen = typeof matchMedia !== 'function' || !matchMedia(PHONE_QUERY).matches;

    protected withRepeats = true;
    protected readonly repeatOptions = [
        { label: 'Con ritornelli', value: true },
        { label: 'Senza ritornelli', value: false }
    ];
    protected countIn = false;
    protected metronome = false;
    protected tempo = 100;
    protected loopEnabled = false;
    protected loopFrom: number | null = null;
    protected loopTo: number | null = null;

    protected playing = false;
    protected positionSeconds = 0;
    protected durationSeconds = 0;
    protected currentMeasure = '';

    private readonly scores = new Map<number, ScorePart>();
    private readonly xml = new Map<number, string>();
    /** MusicXML della partitura: lo spartito di un rigo si ricava quando si mostra. */
    private arrangementXml?: string;
    private built?: BuiltPlayback;
    private channels = new Map<string, PlaybackChannel>();
    private measures: (Element | undefined)[] = [];
    private highlighted?: Element;
    private frame?: number;
    private lastSegment = -2;
    private lastRefresh = 0;

    constructor(
        config: DynamicDialogConfig<ScorePlayerDialogData>,
        private readonly playbackService: ScorePlaybackService,
        private readonly audio: ScoreAudioService,
        private readonly renderer: ScoreRendererService,
        private readonly zone: NgZone,
        private readonly changeDetector: ChangeDetectorRef,
        private readonly dialogService: DialogService,
        private readonly toastService: ToastService,
        private readonly arrangementService: ArrangementService
    ) {
        this.data = config.data!;
    }

    async ngOnInit(): Promise<void> {
        if (this.data.mode === 'arrangement') {
            await this.prepare(() => this.loadArrangement());
            return;
        }
        const parts = this.data.playback.parts;
        const selected = this.data.mode === 'part' ? parts.filter((part) => part.scoreId === this.data.scoreId) : parts;
        const available = selected.filter((part) => part.availability === 'AVAILABLE');
        this.unavailable = selected.filter((part) => part.availability !== 'AVAILABLE');
        this.rows = available.map((part) => ({ part, label: partLabel(part), volume: 80, muted: false, solo: false }));
        this.notationParts = available.filter((part) => part.ownPart);
        this.notationScoreId = this.notationParts[0]?.scoreId ?? null;
        if (!available.length) {
            this.fail('Ascolto non ancora disponibile');
            return;
        }
        await this.prepare(async () => {
            const files = await Promise.all(available.map((part) => firstValueFrom(this.playbackService.playbackFile(this.data.trackId, part.scoreId))));
            available.forEach((part, index) => {
                this.xml.set(part.scoreId, files[index]);
                this.scores.set(part.scoreId, parseMusicXml(files[index]));
            });
        });
    }

    /** Legge gli spartiti con `load`, poi prepara suoni, disegno e ascolto. */
    private async prepare(load: () => Promise<void>): Promise<void> {
        try {
            await load();
            this.lengthsDiffer = new Set(Array.from(this.scores.values()).map((score) => score.measures.length)).size > 1;
            // Sul telefono il primo scaricamento del SoundFont dipende dalla rete: il testo ne indica la dimensione.
            this.loadingMessage = 'Caricamento dei suoni: la prima volta si scaricano circa 40 MB…';
            this.changeDetector.markForCheck();
            await Promise.all([this.audio.ready(), this.renderNotation()]);
            await this.rebuild();
            this.status = 'ready';
        } catch (error) {
            console.error(error);
            this.fail("Impossibile preparare l'ascolto: riprovare più tardi");
        }
        this.changeDetector.markForCheck();
    }

    /**
     * Partitura: un rigo per riga del mixer, con il suono del suo strumento nella notazione della partitura; lo spartito
     * mostrato è quello di un rigo alla volta.
     */
    private async loadArrangement(): Promise<void> {
        const { versionId, rows } = this.data.arrangement!;
        const xml = await this.arrangementService.content(this.data.trackId, versionId);
        const score = ScoreDocument.open(xml);
        const concertPitch = isConcertScore(score);
        const parts = parseMusicXmlParts(xml);
        const playbacks = parts.map((_, index): PartPlayback => {
            const instruments = [...(rows[index]?.instruments ?? [])];
            return { scoreId: -(index + 1), order: index + 1, description: rowName(score, index), instruments, ownPart: false, sound: rowSound(instruments, concertPitch), availability: 'AVAILABLE', hasPages: false, openReports: 0 };
        });
        playbacks.forEach((part, index) => this.scores.set(part.scoreId, parts[index]));
        this.arrangementXml = xml;
        this.rows = playbacks.map((part) => ({ part, label: partLabel(part), volume: 80, muted: false, solo: false }));
        this.notationParts = playbacks;
        this.notationScoreId = playbacks[0]?.scoreId ?? null;
        if (!playbacks.length) throw new Error('Partitura senza righi');
    }

    ngOnDestroy(): void {
        this.stopFrames();
        this.audio.pause();
    }

    @HostListener('document:keydown.space', ['$event'])
    protected onSpace(event: Event): void {
        const target = event.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
        event.preventDefault();
        void this.togglePlay();
    }

    /** Parte che guida ritornelli e salti: quella scelta per la traccia, altrimenti la prima approvata o la prima disponibile. */
    protected get reference(): ScorePart | undefined {
        const referenceId = this.data.playback.referenceScoreId;
        const automatic = this.rows.find((row) => row.part.version?.status === 'APPROVED') ?? this.rows[0];
        return (referenceId !== null && referenceId !== undefined ? this.scores.get(referenceId) : undefined) ?? this.scores.get(automatic?.part.scoreId);
    }

    /** Chi gestisce la traccia scarica in MIDI ciò che si ascolta; soci ed esterni ascoltano soltanto. */
    protected get canDownload(): boolean {
        return this.playbackService.canManage;
    }

    /**
     * Salva in MIDI ciò che si ascolta: le parti che si sentono, con il tempo scelto e con o senza ritornelli, senza
     * metronomo né battuta di attacco.
     */
    protected downloadMidi(): void {
        const reference = this.reference;
        if (this.status !== 'ready' || !reference) return;
        const soloing = this.rows.some((row) => row.solo);
        const audible = this.rows.filter((row) => !row.muted && (!soloing || row.solo));
        if (!audible.length) {
            this.toastService.warn('MIDI non scaricato', 'Tutte le parti sono silenziate: attivane almeno una.');
            return;
        }
        const track = this.data.playback.trackName ?? '';
        const name = this.data.mode === 'part' ? [track, audible[0].label].filter(Boolean).join(' - ') : track;
        saveFile(midiFile(this.inputs(audible), reference, this.withRepeats, this.tempo), `${fileName(name, 'traccia')}.mid`);
    }

    protected get notationPart(): PartPlayback | undefined {
        return this.notationParts.find((part) => part.scoreId === this.notationScoreId);
    }

    protected get notationWarning(): string | null {
        const part = this.notationPart;
        return part?.version ? checksSummary(part) : null;
    }

    protected get ownScoreIds(): number[] {
        return this.rows.filter((row) => row.part.ownPart).map((row) => row.part.scoreId);
    }

    protected async togglePlay(): Promise<void> {
        if (this.status !== 'ready') return;
        if (this.playing) {
            this.audio.pause();
            this.playing = false;
            this.stopFrames();
        } else {
            if (this.durationSeconds && this.audio.currentTime >= this.durationSeconds - 0.05) this.audio.currentTime = this.loopStartSeconds() ?? 0;
            await this.audio.play();
            this.playing = true;
            this.startFrames();
        }
        this.changeDetector.markForCheck();
    }

    protected rewind(): void {
        this.audio.currentTime = this.loopStartSeconds() ?? 0;
        this.refreshPosition(true);
    }

    protected seek(seconds: number): void {
        this.audio.currentTime = seconds;
        this.refreshPosition(true);
    }

    protected changeTempo(value: number | null): void {
        if (!value || !this.built) return;
        this.tempo = Math.min(300, Math.max(20, value));
        this.audio.playbackRate = this.tempo / this.built.initialTempo;
    }

    protected async changeStructure(): Promise<void> {
        const wasPlaying = this.playing;
        if (wasPlaying) await this.togglePlay();
        await this.rebuild();
        this.changeDetector.markForCheck();
    }

    protected toggleMetronome(): void {
        this.applyMixer();
    }

    protected applyMixer(): void {
        if (!this.built) return;
        const soloing = this.rows.some((row) => row.solo);
        for (const row of this.rows) {
            const channel = this.channels.get(String(row.part.scoreId));
            if (channel) this.audio.setChannel(channel, row.volume / 100, row.muted || (soloing && !row.solo));
        }
        this.audio.setChannel(this.built.metronome, 0.9, !this.metronome);
    }

    /** Scorciatoie del mixer: tutte le parti, solo le proprie, tutte tranne le proprie. */
    protected listen(selection: 'all' | 'mine' | 'others'): void {
        const own = new Set(this.ownScoreIds);
        for (const row of this.rows) {
            row.solo = false;
            row.muted = selection === 'mine' ? !own.has(row.part.scoreId) : selection === 'others' ? own.has(row.part.scoreId) : false;
        }
        this.applyMixer();
    }

    /** Segnala un errore sulla parte mostrata, proponendo la battuta in ascolto. */
    protected reportError(): void {
        if (this.status !== 'ready' || !this.rows.length) return;
        if (this.playing) void this.togglePlay();
        const data: ScoreReportDialogData = {
            trackId: this.data.trackId,
            parts: this.rows.map((row) => ({ scoreId: row.part.scoreId, label: row.label, measures: (this.scores.get(row.part.scoreId)?.measures ?? []).map((measure) => measure.number) })),
            scoreId: this.notationScoreId ?? this.data.scoreId ?? this.rows[0].part.scoreId,
            measureNumber: this.currentMeasure || null
        };
        const ref = this.dialogService.open(ScoreReportDialogComponent, { showHeader: false, width: 'min(36rem, 95vw)', modal: true, focusOnShow: false, data });
        ref?.onClose.pipe(first()).subscribe((sent: boolean | undefined) => {
            if (sent) this.toastService.success('Segnalazione inviata', 'Archivisti e amministratori la riceveranno e correggeranno la parte.');
        });
    }

    protected async changeNotation(scoreId: number): Promise<void> {
        this.notationScoreId = scoreId;
        await this.renderNotation();
        this.changeDetector.markForCheck();
    }

    protected formatTime(seconds: number): string {
        const value = Math.max(0, Math.floor(seconds));
        return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    }

    protected get measureNumbers(): { label: string; value: number }[] {
        return (this.reference?.measures ?? []).map((measure) => ({ label: measure.number, value: measure.index }));
    }

    private async rebuild(): Promise<void> {
        const reference = this.reference;
        if (!reference) return;
        this.built = buildPlayback(this.inputs(this.rows), reference, { withRepeats: this.withRepeats, tempoBpm: this.data.playback.tempoBpm ?? null, countIn: this.countIn });
        this.channels = new Map(this.built.channels.map((channel) => [channel.key, channel]));
        await this.audio.load(this.built.midi);
        this.tempo = Math.round(this.built.initialTempo);
        this.audio.playbackRate = 1;
        this.durationSeconds = secondsAt(this.built.totalQuarters, this.built.tempo);
        this.applyMixer();
        this.lastSegment = -2;
        this.refreshPosition(true);
    }

    private inputs(rows: MixerRow[]): PlaybackPartInput[] {
        return rows.map((row) => {
            const score = this.scores.get(row.part.scoreId)!;
            return { key: String(row.part.scoreId), name: row.label, part: score, sound: partSound(row.part.sound, score.clefSign) };
        });
    }

    private async renderNotation(): Promise<void> {
        if (!this.notation) this.changeDetector.detectChanges();
        const host = this.notation?.nativeElement;
        if (!host) return;
        const xml = this.notationScoreId !== null ? this.notationXml(this.notationScoreId) : undefined;
        this.measures = [];
        this.highlighted = undefined;
        if (!xml) {
            host.innerHTML = '';
            return;
        }
        this.notationLoading = true;
        this.changeDetector.markForCheck();
        try {
            const pages = await this.renderer.render(xml, host.clientWidth || 900);
            // L'SVG è generato da Verovio a partire dal MusicXML: i testi sono codificati e non contiene script.
            host.innerHTML = pages.join('');
            this.measures = measureElements(this.scores.get(this.notationScoreId!)?.measures ?? [], Array.from(host.querySelectorAll('g.measure')));
            this.lastSegment = -2;
            this.refreshPosition(true);
        } finally {
            this.notationLoading = false;
        }
    }

    /** Lo spartito della parte, o del rigo della partitura, ricavato la prima volta che si mostra. */
    private notationXml(scoreId: number): string | undefined {
        const known = this.xml.get(scoreId);
        if (known !== undefined || !this.arrangementXml || scoreId >= 0) return known;
        const xml = rowXml(this.arrangementXml, -scoreId - 1);
        this.xml.set(scoreId, xml);
        return xml;
    }

    private startFrames(): void {
        this.stopFrames();
        this.zone.runOutsideAngular(() => {
            const tick = () => {
                this.refreshPosition(false);
                if (this.playing) this.frame = requestAnimationFrame(tick);
            };
            this.frame = requestAnimationFrame(tick);
        });
    }

    private stopFrames(): void {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
    }

    private refreshPosition(force: boolean): void {
        if (!this.built) return;
        let seconds = this.audio.currentTime;
        const loopEnd = this.loopEndSeconds();
        if (this.playing && loopEnd !== null && seconds >= loopEnd) {
            seconds = this.loopStartSeconds() ?? 0;
            this.audio.currentTime = seconds;
        }
        if (this.playing && seconds >= this.durationSeconds) {
            this.zone.run(() => {
                this.audio.pause();
                this.playing = false;
                this.stopFrames();
                this.changeDetector.markForCheck();
            });
        }
        const quarters = quartersAt(seconds, this.built.tempo);
        const segmentIndex = segmentIndexAt(quarters, this.built.segments, this.built.countIn);
        if (segmentIndex !== this.lastSegment) {
            this.lastSegment = segmentIndex;
            this.highlight(segmentIndex);
        }
        const now = performance.now();
        if (force || now - this.lastRefresh > 250) {
            this.lastRefresh = now;
            this.zone.run(() => {
                this.positionSeconds = seconds;
                const segment = segmentIndex >= 0 ? this.built!.segments[segmentIndex] : undefined;
                this.currentMeasure = segment ? (this.reference?.measures[segment.measureIndex]?.number ?? '') : '';
                this.changeDetector.markForCheck();
            });
        }
    }

    private highlight(segmentIndex: number): void {
        this.highlighted?.classList.remove('is-current');
        this.highlighted = undefined;
        if (segmentIndex < 0 || !this.built) return;
        const element = this.measures[this.built.segments[segmentIndex].measureIndex];
        if (!element) return;
        element.classList.add('is-current');
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        this.highlighted = element;
    }

    private loopStartSeconds(): number | null {
        if (!this.loopEnabled || this.loopFrom === null || !this.built) return null;
        const segment = this.built.segments.find((value) => value.measureIndex === this.loopFrom);
        return segment ? secondsAt(this.built.countIn + segment.start, this.built.tempo) : null;
    }

    private loopEndSeconds(): number | null {
        if (!this.loopEnabled || this.loopTo === null || !this.built) return null;
        const start = this.loopStartSeconds();
        const segments = this.built.segments;
        const from = this.loopFrom === null ? 0 : segments.findIndex((value) => value.measureIndex === this.loopFrom);
        const segment = segments.slice(Math.max(0, from)).find((value) => value.measureIndex === this.loopTo);
        if (!segment || start === null) return null;
        const end = secondsAt(this.built.countIn + segment.start + segment.length, this.built.tempo);
        return end > start ? end : null;
    }

    private fail(message: string): void {
        this.status = 'error';
        this.errorMessage = message;
        this.changeDetector.markForCheck();
    }
}
