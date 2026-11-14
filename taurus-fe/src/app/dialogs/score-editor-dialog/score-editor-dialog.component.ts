import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { Popover } from 'primeng/popover';
import { DrumPad, PianoKeyboardComponent } from '../../components/piano-keyboard/piano-keyboard.component';
import { ImportsModule } from '../../imports';
import { ErrorReport, MeasureBox, PlaybackSound, ScoreCorrection, ScoreDraft, ScoreEditorData, ScoreVersion } from '../../module';
import { EditHistory } from '../../score-editor/edit-history';
import { excerpt } from '../../score-editor/excerpt';
import { Alteration, ALTERATIONS, CLEF_OPTIONS, fraction, KEY_OPTIONS, NOTE_TYPES, NoteType, Step, STEP_NAMES, STEPS, toNumber } from '../../score-editor/notation-rules';
import { EditError, ScoreDocument, ScoreDocumentChecks } from '../../score-editor/score-document';
import * as edits from '../../score-editor/score-edits';
import * as input from '../../score-editor/score-input';
import * as notation from '../../score-editor/score-notation';
import * as passages from '../../score-editor/score-passage';
import * as writing from '../../score-editor/score-writing';
import { parseMusicXml } from '../../score-player/musicxml-score';
import { buildPlayback } from '../../score-player/playback-builder';
import { originLabel } from '../../score-player/playback-labels';
import { partSound, secondsAt } from '../../score-player/timeline';
import {
    ApiErrorService,
    ConfirmService,
    DraftState,
    LocalDraftCopy,
    MAX_CHORD_THRESHOLD,
    MediaService,
    MidiInputService,
    MIN_CHORD_THRESHOLD,
    PartDraftKeeper,
    PlayedNote,
    PartEditLock,
    ScoreAudioService,
    ScoreClipboardService,
    ScoreDraftService,
    ScoreEditLockService,
    ScorePlaybackService,
    ScoreRendererService,
    withErrorSummary,
    withHandledErrors
} from '../../service';

export interface ScoreEditorDialogData {
    trackId: number;
    scoreId: number;
    /** Versione da correggere, o da cui parte la scrittura; `null` per una parte scritta che non ha ancora versioni. */
    versionId: number | null;
    partLabel: string;
    /** Suono della parte, per ascoltare le battute durante la correzione. */
    sound: PlaybackSound;
    /** `writing` apre l'editor di scrittura, con le bozze e la modalità di inserimento; in assenza, la correzione. */
    mode?: 'correction' | 'writing';
    /** Scrittura: riprende la bozza senza chiedere, perché l'archivista ha scelto «Riprendi la bozza». */
    resume?: boolean;
    /** Scrittura: contenuto iniziale di una parte senza versioni né bozza, preparato con le impostazioni della parte. */
    initialContent?: string;
}

type EditorStatus = 'loading' | 'choosing' | 'ready' | 'error';

/** Da dove parte la scrittura: la versione, la bozza sul server, la copia nel browser o una parte nuova. */
type WritingSource = 'version' | 'draft' | 'local' | 'new';

/** Scelta all'apertura della scrittura, quando c'è una bozza o una copia nel browser da riprendere. */
interface ResumeChoice {
    kind: 'draft' | 'local';
    heading: string;
    detail: string;
    /** Sul server c'è qualcosa di più recente: riprendendo lo si sostituisce. */
    warning: string | null;
    resumeLabel: string;
    discardLabel: string;
}

interface CursorBox {
    left: number;
    top: number;
    height: number;
}

interface PageHighlight {
    left: number;
    top: number;
    width: number;
    height: number;
    approximate: boolean;
}

/** Dimensione dello spartito nell'editor, più grande che nel lettore per selezionare comodamente le note. */
const EDITOR_SCALE = 50;

/** Durata della nota suonata sulla tastiera MIDI o sul pianoforte a schermo, in secondi. */
const AUDITION_SECONDS = 0.6;

/**
 * Ultime note suonate: la prima del gruppo, a cui si aggiungono le note dell'accordo, e quelle di cui `+`, `-` e `=`
 * correggono la grafia. Nelle percussioni, posizione e voci già scritte dal gruppo.
 */
interface PlayedGroup {
    anchorId: string;
    ids: string[];
    voices: number[];
    drumAt: writing.WritingCursor | null;
}

const OUTDATED = 'scoreWriting.draftOutdated';

function timeOf(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** «14 novembre alle 10:32». */
function momentOf(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} alle ${timeOf(value)}`;
}

function draftChoice(draft: ScoreDraft, version: ScoreVersion): ResumeChoice {
    const author = draft.savedBy ? ` di ${draft.savedBy}` : '';
    return {
        kind: 'draft',
        heading: 'Bozza non salvata',
        detail: `C'è una bozza${author}, salvata il ${momentOf(draft.savedAt)}: puoi riprenderla o scartarla e ripartire dalla versione ${version.versionNumber}.`,
        warning: draft.outdated ? "Dopo l'inizio della scrittura è stata salvata un'altra versione della parte: salvando, la bozza la sostituirà." : null,
        resumeLabel: 'Riprendi la bozza',
        discardLabel: `Scarta e apri la versione ${version.versionNumber}`
    };
}

function localChoice(local: LocalDraftCopy, draft: ScoreDraft | null, version: ScoreVersion | null): ResumeChoice {
    const from = timeOf(local.changedFrom);
    const to = timeOf(local.changedAt);
    const day = new Date(local.changedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    const span = from === to ? `alle ${to}` : `dalle ${from} alle ${to}`;
    let warning: string | null = null;
    if (draft && draft.entityVersion !== local.entityVersion) {
        warning = `Sul server c'è una bozza più recente${draft.savedBy ? ` di ${draft.savedBy}` : ''}, salvata il ${momentOf(draft.savedAt)}: riprendendo queste modifiche la sostituisci.`;
    } else if (version && local.baseVersionId !== version.id) {
        warning = "Dopo queste modifiche è stata salvata un'altra versione della parte: salvando, le modifiche la sostituiranno.";
    }
    return {
        kind: 'local',
        heading: 'Modifiche rimaste in questo browser',
        detail: `Le modifiche fatte il ${day} ${span} non sono arrivate al server.`,
        warning,
        resumeLabel: warning ? 'Riprendi e sostituisci' : 'Riprendi le modifiche',
        discardLabel: 'Scarta le modifiche'
    };
}

function capitalized(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Nome di file dal nome della parte, senza caratteri non ammessi. */
function fileName(label: string): string {
    return (
        label
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'parte'
    );
}

/**
 * Editor di correzione di una versione e di scrittura di una parte: spartito disegnato da Verovio a sinistra, pagina
 * originale a destra con la battuta selezionata evidenziata. Le modifiche agiscono sul MusicXML e producono, al
 * salvataggio, una nuova versione. La scrittura aggiunge la modalità di inserimento, con cursore e voci, tiene le battute
 * sempre complete e salva da sola una bozza.
 */
@Component({
    selector: 'app-score-editor-dialog',
    standalone: true,
    imports: [ImportsModule, PianoKeyboardComponent],
    templateUrl: './score-editor-dialog.component.html',
    styleUrl: './score-editor-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScoreEditorDialogComponent implements OnInit, OnDestroy {
    /** Contenitore dello spartito: esiste solo quando l'editor è pronto. */
    @ViewChild('notation') private notation?: ElementRef<HTMLElement>;
    @ViewChild('pageViewer') private pageViewer?: ElementRef<HTMLElement>;

    protected readonly data: ScoreEditorDialogData;
    /** Blocco della parte: un solo autore alla volta, anche fra correzione e scrittura. */
    protected readonly lock: PartEditLock;
    protected readonly noteTypes = [...NOTE_TYPES];
    protected readonly alterations = ALTERATIONS;
    protected readonly clefs = [...CLEF_OPTIONS];
    protected readonly keys = [...KEY_OPTIONS];
    protected readonly steps = STEPS.map((step) => ({ step, label: STEP_NAMES[step] }));
    protected readonly dynamics = edits.DYNAMICS;
    protected readonly articulations = edits.ARTICULATIONS;
    protected readonly marks = edits.STRUCTURE_MARKS;
    protected readonly tuplets = edits.TUPLETS;
    protected readonly beatTypes = [1, 2, 4, 8, 16, 32].map((value) => ({ label: String(value), value }));
    protected readonly endingOptions = [
        { label: 'Nessuna', value: null },
        { label: '1ª volta', value: '1' },
        { label: '2ª volta', value: '2' },
        { label: '3ª volta', value: '3' }
    ];
    protected readonly zoomOptions = [
        { label: '100%', value: 100 },
        { label: '150%', value: 150 },
        { label: '200%', value: 200 }
    ];
    protected readonly originLabel = originLabel;
    /** Voci del cursore; nelle percussioni con strumenti ciascuna porta il nome del suo strumento. */
    protected readonly voices: { label: string; value: number }[];
    /** Suoni di batteria degli strumenti della parte, in ordine di voce; vuoto per le parti intonate. */
    protected readonly drumKeys: number[];
    /** Pulsanti del pianoforte a schermo per le percussioni con strumenti, uno per strumento. */
    protected readonly drumPads: DrumPad[];
    protected readonly minThreshold = MIN_CHORD_THRESHOLD;
    protected readonly maxThreshold = MAX_CHORD_THRESHOLD;
    protected readonly intervals = [...passages.INTERVALS];
    protected readonly directions: { label: string; value: 1 | -1 }[] = [
        { label: 'Su', value: 1 },
        { label: 'Giù', value: -1 }
    ];
    protected readonly transposeScopes: { label: string; value: 'passage' | 'part' }[] = [
        { label: 'Selezione', value: 'passage' },
        { label: 'Tutta la parte', value: 'part' }
    ];
    protected readonly wedges = notation.WEDGES;
    protected readonly graceKinds = notation.GRACE_KINDS;
    protected readonly expressionTexts = notation.EXPRESSION_TEXTS;
    protected readonly tempoTexts = edits.TEMPO_TEXTS;
    protected readonly breakOptions: { label: string; value: notation.BreakKind | null }[] = [
        { label: 'Continua', value: null },
        { label: 'Nuova riga', value: 'system' },
        { label: 'Nuova pagina', value: 'page' }
    ];
    /** Editor di scrittura: bozze, modalità di inserimento e battute sempre complete. */
    protected readonly writingMode: boolean;

    protected status: EditorStatus = 'loading';
    protected errorMessage = '';
    protected editor?: ScoreEditorData;
    protected rendering = false;
    protected saving = false;
    protected dirty = false;
    protected message: string | null = null;
    /** Esito di un'azione che non modifica la parte, per esempio una copia. */
    protected info: string | null = null;
    protected activeTool = 'note';

    protected selectedId: string | null = null;
    /** Battuta selezionata quando non contiene note da selezionare. */
    private emptyMeasureId: string | null = null;
    /** Ultima battuta dell'intervallo da ascoltare, scelta con Maiusc+clic. */
    protected rangeEnd: number | null = null;
    /** Scrittura: estremo mobile del passaggio selezionato, scelto con Maiusc; l'altro estremo è la nota selezionata. */
    protected rangeFocusId: string | null = null;
    /** Scrittura: passaggio dalla nota selezionata all'estremo mobile, con battute e voci che copre. */
    protected passage: passages.Passage | null = null;
    private passageText = '';
    protected note: edits.NoteInfo | null = null;
    protected measure: edits.MeasureInfo | null = null;
    protected checks: ScoreDocumentChecks = { wrongDuration: [], empty: [] };
    protected reports: ErrorReport[] = [];

    protected timeBeats = 4;
    protected timeBeatType = 4;
    protected tempo: number | null = null;
    /** Testo dell'indicazione di tempo, per esempio «Allegro». */
    protected tempoText = '';
    /** Battute da aggiungere, o durata della pausa di più battute. */
    protected measureCount = 1;
    /** Testo di espressione da scrivere prima della nota selezionata. */
    protected expressionText = '';
    /** Lettera di prova della battuta, o quella proposta. */
    protected rehearsalText = '';
    /** Scrittura: battute per riga da proporre a tutta la parte. */
    protected breaksEvery = 4;

    protected pageIndex = 0;
    protected zoom = 100;
    protected pageUrl: string | null = null;
    protected pageLoading = false;
    protected highlight: PageHighlight | null = null;

    protected playing = false;
    protected preparingAudio = false;

    /** Scrittura: pianoforte a schermo, mostrato da solo sui tablet. */
    protected showPiano = false;
    /** Ultime note suonate sulla tastiera MIDI o sul pianoforte a schermo. */
    private played: PlayedGroup | null = null;
    private midiSubscription?: Subscription;

    /** Scrittura: modalità di inserimento, con il cursore al posto della selezione. */
    protected inserting = false;
    protected cursor: writing.WritingCursor = writing.startCursor();
    /** Figura delle note scritte al cursore. */
    protected figure: writing.WritingFigure = { type: 'quarter', dots: 0 };
    protected transposeInterval = 'M2';
    protected transposeDirection: 1 | -1 = 1;
    protected transposeScope: 'passage' | 'part' = 'passage';
    protected cursorBox: CursorBox | null = null;
    /** Bozza o copia nel browser da riprendere, prima di aprire lo spartito. */
    protected choice: ResumeChoice | null = null;
    /** Bozza della scrittura, finché l'editor possiede il blocco. */
    protected keeper: PartDraftKeeper | null = null;
    private source: WritingSource = 'version';
    /** Versione da cui parte la scrittura, inviata al salvataggio; `null` per una parte senza versioni. */
    private baseVersionId: number | null = null;
    private serverDraft: ScoreDraft | null = null;
    private localCopy: LocalDraftCopy | null = null;

    private score?: ScoreDocument;
    private initialSnapshot = '';
    private history = new EditHistory();
    private readonly pageUrls = new Map<number, string>();
    private renderToken = 0;
    private renderFrame?: number;
    private stopTimer?: number;

    constructor(
        config: DynamicDialogConfig<ScoreEditorDialogData>,
        private readonly dialogRef: DynamicDialogRef<ScoreEditorDialogComponent>,
        private readonly playbackService: ScorePlaybackService,
        private readonly mediaService: MediaService,
        private readonly renderer: ScoreRendererService,
        private readonly audio: ScoreAudioService,
        private readonly confirmService: ConfirmService,
        private readonly changeDetector: ChangeDetectorRef,
        lockService: ScoreEditLockService,
        private readonly draftService: ScoreDraftService,
        private readonly apiErrors: ApiErrorService,
        protected readonly clipboard: ScoreClipboardService,
        protected readonly midi: MidiInputService
    ) {
        this.data = config.data!;
        this.writingMode = this.data.mode === 'writing';
        this.lock = lockService.forPart(this.data.trackId, this.data.scoreId);
        const keys = this.data.sound?.percussionKeys ?? [];
        this.drumKeys = [...keys];
        this.voices = writing.VOICES.map((voice) => ({ label: keys.length ? `${voice} · ${input.drumSound(input.voiceDrum(keys, voice)!).name}` : String(voice), value: voice }));
        this.drumPads = keys.slice(0, writing.VOICES.length).map((key, index) => ({ key, label: capitalized(input.drumSound(key).name), hint: `Voce ${index + 1}` }));
        this.showPiano = this.writingMode && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    }

    async ngOnInit(): Promise<void> {
        const { trackId, scoreId, versionId } = this.data;
        try {
            const [editor, reports] = await Promise.all([
                versionId === null ? Promise.resolve(undefined) : firstValueFrom(this.playbackService.editor(trackId, scoreId, versionId)),
                firstValueFrom(this.playbackService.errorReports(trackId)).catch(() => [] as ErrorReport[]),
                // Senza il blocco l'editor si apre in sola lettura: lo stato del blocco dice perché.
                this.lock.acquire()
            ]);
            this.editor = editor;
            this.reports = reports.filter((report) => report.scoreId === scoreId && report.status === 'OPEN');
            if (this.writingMode) this.midiSubscription = this.midi.played.subscribe((note) => this.onMidiNote(note));
            if (this.writingMode) await this.prepareWriting();
            else if (editor) await this.open(editor.musicXml);
            else throw new EditError('Scegli una versione da correggere');
        } catch (error) {
            this.failed(error);
        }
        this.changeDetector.markForCheck();
    }

    ngOnDestroy(): void {
        // Le ultime modifiche partono subito; la copia nel browser resta finché il server non le accetta.
        // Il blocco si rilascia dopo l'ultimo salvataggio, che senza blocco sarebbe rifiutato.
        const keeper = this.keeper;
        const lock = this.lock;
        if (keeper?.dirty) {
            void keeper.flush().finally(() => {
                keeper.stop();
                lock.release();
            });
        } else {
            keeper?.stop();
            lock.release();
        }
        this.stop();
        this.midiSubscription?.unsubscribe();
        if (this.renderFrame !== undefined) cancelAnimationFrame(this.renderFrame);
        for (const url of this.pageUrls.values()) URL.revokeObjectURL(url);
    }

    protected get canUndo(): boolean {
        return this.history.canUndo && !this.readOnly;
    }

    protected get canRedo(): boolean {
        return this.history.canRedo && !this.readOnly;
    }

    /** Un altro autore possiede il blocco, o non si è potuto prendere: si consulta senza modificare. */
    protected get readOnly(): boolean {
        return this.lock.state().status !== 'held';
    }

    /** Avviso della sola lettura, con l'azione che la risolve; `null` mentre il blocco è di questa finestra. */
    protected get lockNotice(): { heading: string; detail: string; action: string } | null {
        const { status, message } = this.lock.state();
        if (status === 'locked') return { heading: 'Sola lettura', detail: message ?? '', action: 'Prendi il controllo' };
        if (status === 'lost') return { heading: 'Un altro ha preso il controllo', detail: `${message ?? ''}: le modifiche non salvate restano qui finché non riprendi il controllo`, action: 'Riprendi il controllo' };
        if (status === 'unavailable') return { heading: 'Sola lettura', detail: message ?? '', action: 'Riprova' };
        return null;
    }

    /** Si può salvare: ci sono modifiche, oppure la scrittura parte da una bozza o da una parte nuova. */
    protected get canSave(): boolean {
        if (!this.score || this.saving || this.readOnly) return false;
        return this.dirty || (this.writingMode && this.source !== 'version');
    }

    /** Stato della bozza, sotto il titolo dell'editor di scrittura. */
    protected get draftLabel(): string {
        const state: DraftState | undefined = this.keeper?.state();
        if (!state) return this.readOnly ? 'Sola lettura: la bozza è di chi sta scrivendo' : 'Le modifiche si salvano da sole come bozza';
        switch (state.status) {
            case 'pending':
                return 'Modifiche in attesa di essere salvate nella bozza';
            case 'saving':
                return 'Salvataggio della bozza…';
            case 'offline':
            case 'failed':
                return state.message ?? 'Bozza non salvata';
            case 'rejected':
            case 'conflict':
                return 'Bozza non salvata';
            default:
                return state.savedAt ? `Bozza salvata alle ${timeOf(state.savedAt)}` : 'Le modifiche si salvano da sole come bozza';
        }
    }

    /** La bozza ripresa parte da una versione che non è più quella corrente della parte. */
    protected get outdatedWarning(): string | null {
        if (!this.writingMode || this.readOnly) return null;
        const current = this.editor?.version.current ? this.editor.version.id : null;
        if (this.source === 'version' || this.source === 'new' || this.baseVersionId === current) return null;
        return "Dopo l'inizio della scrittura è stata salvata un'altra versione della parte: salvando, la bozza la sostituirà.";
    }

    /** Stato della modalità di inserimento: posizione del cursore, strumento della voce nelle percussioni e figura. */
    protected get insertionLabel(): string {
        if (!this.score) return '';
        const drum = input.voiceDrum(this.drumKeys, this.cursor.voice);
        const instrument = drum === null ? '' : ` · ${input.drumSound(drum).name}`;
        return `Inserimento · ${writing.cursorLabel(this.score, this.cursor)}${instrument} · ${writing.figureLabel(this.figure)}`;
    }

    /** Tasti della tastiera MIDI che scrivono in una parte di percussione con più strumenti. */
    protected get midiDrumHint(): string | null {
        if (this.drumKeys.length < 2 || this.midi.status() !== 'ready' || !this.midi.deviceId()) return null;
        return `Tasti MIDI: ${input.drumKeysLabel(this.drumKeys)}`;
    }

    /** Prima ottava del pianoforte a schermo, dalla chiave: Do4 in chiave di violino, Do2 in chiave di basso. */
    protected get pianoOctave(): number {
        if (!this.score) return 4;
        const index = this.inserting ? this.cursor.measureIndex : (this.measure?.index ?? 0);
        const sign = this.score.stateAt(Math.min(index, this.score.measures().length - 1)).clef.sign;
        return sign === 'F' ? 2 : sign === 'C' ? 3 : 4;
    }

    /** Avviso della bozza rifiutata o cambiata altrove, con le azioni possibili. */
    protected get draftNotice(): DraftState | null {
        const state = this.keeper?.state();
        return state && (state.status === 'rejected' || state.status === 'conflict') ? state : null;
    }

    protected get pages(): number[] {
        return this.editor?.pages ?? [];
    }

    protected get hasLayout(): boolean {
        return !!this.editor?.layout?.length;
    }

    /** Battute da ascoltare: quella selezionata, l'intervallo scelto o le battute del passaggio. */
    protected get listenLabel(): string {
        const range = this.listenRange;
        if (!range) return 'Ascolta';
        const numbers = this.measureNumbers(range);
        return numbers[0] === numbers[1] ? `Ascolta battuta ${numbers[0]}` : `Ascolta battute ${numbers[0]}–${numbers[1]}`;
    }

    protected get selectionLabel(): string {
        if (this.passage) return this.passageText;
        if (this.measure?.empty) return `Battuta ${this.measure.number} · vuota`;
        if (!this.note || !this.measure) return 'Seleziona una nota sullo spartito';
        return `Battuta ${this.measure.number} · ${edits.noteLabel(this.note)}`;
    }

    protected get emptyMeasures(): { index: number; number: string }[] {
        const measures = this.score?.measures() ?? [];
        return this.checks.empty.map((index) => ({ index, number: measures[index]?.getAttribute('number') ?? String(index + 1) }));
    }

    protected get wrongMeasures(): { index: number; number: string }[] {
        const measures = this.score?.measures() ?? [];
        return this.checks.wrongDuration.map((index) => ({ index, number: measures[index]?.getAttribute('number') ?? String(index + 1) }));
    }

    @HostListener('document:keydown', ['$event'])
    protected onKey(event: KeyboardEvent): void {
        if (this.status !== 'ready' || this.saving) return;
        const target = event.target as HTMLElement | null;
        const key = event.key;
        if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || target.closest('.p-select, .p-select-overlay, .p-inputnumber, .p-confirmdialog'))) return;
        // Pulsanti e schede restano utilizzabili da tastiera con Invio, spazio e frecce.
        if (target?.closest('[role="tab"]') && key.startsWith('Arrow')) return;
        if (target?.closest('button, [role="tab"]') && (key === ' ' || key === 'Enter')) return;
        const command = event.ctrlKey || event.metaKey;
        let handled = true;
        if (command && key.toLowerCase() === 'z' && !event.shiftKey) this.undo();
        else if (command && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && event.shiftKey))) this.redo();
        else if (this.writingMode && this.writingKey(event)) handled = true;
        else if (key === 'ArrowUp' || key === 'ArrowDown') this.move((key === 'ArrowUp' ? 1 : -1) * (command ? 7 : 1));
        else if (command || event.altKey) handled = false;
        else if (key === 'ArrowLeft' || key === 'ArrowRight') this.selectAdjacent(key === 'ArrowLeft' ? -1 : 1);
        else if (/^[a-g]$/i.test(key)) this.letter(key.toUpperCase() as Step);
        else if (NOTE_TYPES.some((option) => option.key === key)) this.setType(NOTE_TYPES.find((option) => option.key === key)!.type);
        else if (key === '.') this.toggleDots();
        else if (key === '0') this.toggleRest();
        else if (key === '+') this.alteration('sharp');
        else if (key === '-') this.alteration('flat');
        else if (key === '=') this.alteration('natural');
        else if (key === 'Delete' || key === 'Backspace') this.remove();
        else if (!this.writingMode && (key === 'Insert' || key === 'i')) this.insert('after');
        else if (key === 't') this.tie();
        else if (key === 's') this.slur();
        else if (key === '<' || key === '>') this.wedge(key === '<' ? 'crescendo' : 'diminuendo');
        else if (key === ' ') void this.togglePlay();
        else if (key === 'Escape' && (this.rangeEnd !== null || this.rangeFocusId !== null)) this.clearRange();
        else handled = false;
        if (handled) {
            event.preventDefault();
            this.changeDetector.markForCheck();
        }
    }

    // Selezione

    protected onNotationClick(event: MouseEvent): void {
        if (!this.score) return;
        let target = event.target as Element | null;
        let noteId: string | null = null;
        let measureIndex: number | null = null;
        while (target && target !== this.notationHost) {
            const id = target.getAttribute('id');
            const found = id && target.tagName.toLowerCase() === 'g' ? this.score.find(id) : null;
            if (found?.tagName === 'note' && !noteId) noteId = id;
            if (found?.tagName === 'measure') {
                measureIndex = this.score.measureIndex(found);
                break;
            }
            target = target.parentElement;
        }
        if (measureIndex === null) {
            // Gli spazi vuoti tra le note non appartengono ad alcun elemento disegnato: vale la battuta che contiene il punto.
            target = this.measureAt(event.clientX, event.clientY);
            const found = target ? this.score.find(target.getAttribute('id') ?? '') : null;
            measureIndex = found?.tagName === 'measure' ? this.score.measureIndex(found) : null;
        }
        if (measureIndex === null || !target) return;
        // Le teste delle note sono piccole: un clic accanto a una nota sceglie la nota più vicina della battuta.
        const id = noteId ?? this.nearestNote(target, event.clientX, event.clientY) ?? edits.firstNoteOf(this.score, measureIndex);
        if (event.shiftKey && this.writingMode && this.selectedId && id) {
            // Nella scrittura Maiusc+clic sceglie un passaggio dalla nota selezionata, da copiare, ripetere o trasporre.
            this.setRangeFocus(id);
            return;
        }
        if (event.shiftKey && this.measure) {
            this.rangeEnd = measureIndex;
            this.decorate(false);
            this.changeDetector.markForCheck();
            return;
        }
        this.rangeEnd = null;
        if (this.inserting) this.cursor = id ? writing.cursorAt(this.score, id) : writing.clampCursor(this.score, { ...this.cursor, measureIndex, offset: fraction(0) });
        if (id) this.select(id);
        else this.selectEmptyMeasure(measureIndex);
    }

    protected selectMeasure(index: number): void {
        if (!this.score) return;
        this.rangeEnd = null;
        const id = edits.firstNoteOf(this.score, index);
        if (id) this.select(id);
        else this.selectEmptyMeasure(index);
    }

    /** Seleziona la battuta indicata in una segnalazione. */
    protected showReport(report: ErrorReport): void {
        if (!this.score || !report.measureNumber) return;
        const index = this.score.measures().findIndex((measure) => measure.getAttribute('number') === report.measureNumber);
        if (index >= 0) this.selectMeasure(index);
    }

    // Nota

    protected setType(type: NoteType): void {
        if (this.inserting) this.setFigure(type);
        else this.noteChange((score, id) => (this.writingMode ? writing.setWrittenDuration(score, id, { type, dots: 0 }) : edits.setNoteType(score, id, type)));
    }

    protected toggleDots(): void {
        if (this.inserting) this.cycleFigureDots();
        else this.noteChange((score, id) => (this.writingMode ? writing.cycleWrittenDots(score, id) : edits.cycleDots(score, id)));
    }

    protected toggleRest(): void {
        if (this.inserting) this.writeRest();
        else this.noteChange((score, id) => edits.toggleRest(score, id));
    }

    /** Diesis, bemolle e bequadro; sulle ultime note suonate correggono la grafia, senza cambiarne il suono. */
    protected alteration(value: Alteration): void {
        const spelling: input.Spelling | null = value === 'sharp' || value === 'flat' || value === 'natural' ? value : null;
        if (spelling && this.played && this.selectedId && this.played.ids.includes(this.selectedId) && !this.played.drumAt) {
            this.noteChange((score, id) => input.respellNote(score, id, spelling), true);
            return;
        }
        this.noteChange((score, id) => edits.setAlteration(score, id, value));
    }

    /** Su o giù di un grado, o di un'ottava con ±7; un passaggio si sposta tutto. */
    protected move(steps: number): void {
        const passage = this.passage;
        if (passage) {
            this.apply((score) => (Math.abs(steps) === 7 ? passages.transposePassage(score, passage, passages.OCTAVE, steps > 0 ? 1 : -1) : passages.shiftPassage(score, passage, steps)));
            return;
        }
        this.noteChange((score, id) => edits.moveStep(score, id, steps));
    }

    protected letter(step: Step): void {
        if (this.inserting) this.writeStep(step);
        else this.noteChange((score, id) => edits.setPitchLetter(score, id, step));
    }

    /** Correzione: copia della nota prima o dopo di lei. Nella scrittura le note si inseriscono al cursore. */
    protected insert(where: 'before' | 'after'): void {
        if (this.writingMode) return;
        this.noteChange((score, id) => edits.insertNote(score, id, where));
    }

    protected addToChord(): void {
        this.noteChange((score, id) => edits.addChordNote(score, id));
    }

    /**
     * Correzione: elimina la nota. Scrittura: la nota, o il passaggio selezionato, diventa una pausa, e una voce fatta solo
     * di pause sparisce.
     */
    protected remove(): void {
        const passage = this.passage;
        if (passage) {
            this.apply((score) => this.clearPassage(score, passage));
            return;
        }
        this.noteChange((score, id) => {
            if (!this.writingMode) return edits.deleteNote(score, id);
            // Durante l'inserimento il cursore torna dove iniziava la nota cancellata, per riscriverla.
            if (this.inserting) this.cursor = writing.cursorAt(score, id);
            return writing.clearWrittenNote(score, id);
        });
    }

    protected tie(): void {
        if (this.inserting) this.writeTied();
        else this.noteChange((score, id) => edits.toggleTie(score, id));
    }

    protected tuplet(actual: number): void {
        if (this.inserting) this.writeTuplet(actual);
        else this.noteChange((score, id) => (this.writingMode ? writing.toggleWrittenTuplet(score, id, actual) : edits.toggleTuplet(score, id, actual)));
    }

    protected dynamic(value: edits.Dynamic | null): void {
        this.noteChange((score, id) => edits.setDynamic(score, id, value));
    }

    protected articulation(value: edits.Articulation): void {
        this.noteChange((score, id) => edits.toggleArticulation(score, id, value));
    }

    /** Legatura di portamento sul passaggio selezionato o dalla nota alla seguente; se c'è già si toglie (S). */
    protected slur(): void {
        this.notationChange((score, target) => notation.toggleSlur(score, target));
    }

    /** Forcella sul passaggio selezionato o dalla nota all'elemento seguente (< e >). */
    protected wedge(kind: notation.WedgeKind): void {
        this.notationChange((score, target) => notation.toggleWedge(score, target, kind));
    }

    protected removeSpanners(): void {
        this.notationChange((score, target) => notation.removeSpanners(score, target));
    }

    protected fermata(): void {
        this.noteChange((score, id) => notation.toggleFermata(score, id));
    }

    /** Abbellimento prima della nota, da selezionare per cambiarne l'altezza; su un abbellimento ne cambia il tipo. */
    protected grace(kind: notation.GraceKind): void {
        this.noteChange((score, id) => notation.setGraceNote(score, id, kind));
    }

    protected applyExpression(value: string | null): void {
        this.noteChange((score, id) => notation.setExpression(score, id, value));
    }

    // Battuta e struttura

    protected applyTime(): void {
        this.measureChange((score, index) => {
            edits.setTime(score, index, this.timeBeats, this.timeBeatType);
            // Nella scrittura le battute restano complete anche con il nuovo metro.
            if (this.writingMode) writing.completeMeasures(score, index);
        });
    }

    protected applyKey(fifths: number): void {
        this.measureChange((score, index) => edits.setKey(score, index, fifths));
    }

    protected applyClef(value: string): void {
        this.measureChange((score, index) => edits.setClef(score, index, value));
    }

    protected insertMeasure(where: 'before' | 'after'): void {
        this.measureChange((score, index) => edits.firstNoteOf(score, edits.insertMeasure(score, index, where)));
    }

    protected deleteMeasure(): void {
        this.measureChange((score, index) => {
            edits.deleteMeasure(score, index);
            return edits.firstNoteOf(score, Math.min(index, score.measures().length - 1));
        });
    }

    /** Aggiunge il numero di battute indicato dopo quella selezionata, ognuna con una pausa di battuta. */
    protected addMeasures(): void {
        this.measureChange((score, index) => edits.firstNoteOf(score, edits.insertMeasures(score, index, this.measureCount)));
    }

    /** Una battuta vuota riceve una pausa di battuta: da lì si inseriscono le note come nelle altre battute. */
    protected fillMeasure(): void {
        this.measureChange((score, index) => edits.fillEmptyMeasure(score, index));
    }

    /** La battuta selezionata diventa una pausa del numero di battute indicato; se contiene note, prima si chiede. */
    protected applyMultiRest(): void {
        const measure = this.measure;
        if (!measure) {
            this.measureChange(() => undefined);
            return;
        }
        const count = this.measureCount;
        const change = (): void =>
            this.measureChange((score, index) => {
                edits.setMultiRest(score, index, count);
                return edits.firstNoteOf(score, index);
            });
        if (!measure.hasNotes) {
            change();
            return;
        }
        this.confirmService.confirmReversible({
            title: 'Pausa di più battute',
            consequence: `La battuta ${measure.number} diventa una pausa ${count === 1 ? 'di battuta' : `di ${count} battute`}: le sue note andranno perse. Potrai annullare l’operazione prima del salvataggio.`,
            actionLabel: 'Trasforma in pausa',
            key: 'score-editor-discard',
            accept: change
        });
    }

    protected repeat(direction: 'forward' | 'backward'): void {
        this.measureChange((score, index) => edits.toggleRepeat(score, index, direction));
    }

    protected applyEnding(value: string | null): void {
        this.measureChange((score, index) => edits.setEnding(score, index, value));
    }

    protected mark(value: edits.StructureMark): void {
        this.measureChange((score, index) => edits.toggleMark(score, index, value));
    }

    /** Indicazione di tempo della battuta, con il testo scritto; `null` la toglie. */
    protected applyTempo(value: number | null): void {
        const words = value === null ? null : this.tempoText;
        this.measureChange((score, index) => edits.setTempo(score, index, value, words));
    }

    protected applyRehearsal(value: string | null): void {
        this.measureChange((score, index) => notation.setRehearsal(score, index, value));
    }

    /** Lettera di prova con il numero della battuta, come numero di riferimento. */
    protected rehearsalNumber(): void {
        this.measureChange((score, index) => notation.setRehearsal(score, index, score.measure(index).getAttribute('number') || String(index + 1)));
    }

    protected applyBreak(kind: notation.BreakKind | null): void {
        this.measureChange((score, index) => notation.setBreak(score, index, kind));
    }

    /** Interruzioni di riga ogni tante battute in tutta la parte; `null` le toglie. */
    protected applyBreaksEvery(count: number | null): void {
        const applied = this.apply((score) => notation.setBreaksEvery(score, count));
        if (applied) {
            this.info = count === null ? 'Interruzioni di riga tolte da tutta la parte' : `Una riga nuova ogni ${count} ${count === 1 ? 'battuta' : 'battute'}`;
            this.changeDetector.markForCheck();
        }
    }

    // Scrittura al cursore

    /** Entra o esce dalla modalità di inserimento; il cursore parte dalla nota selezionata. */
    protected toggleInsertion(): void {
        if (!this.writingMode || !this.score) return;
        if (!this.inserting && this.readOnly) {
            this.message = "L'editor è in sola lettura: prendi il controllo per scrivere la parte";
            this.changeDetector.markForCheck();
            return;
        }
        this.inserting = !this.inserting;
        if (this.inserting) {
            const index = this.measure?.index ?? 0;
            this.cursor = this.selectedId ? writing.cursorAt(this.score, this.selectedId) : writing.clampCursor(this.score, { ...this.cursor, measureIndex: index, offset: fraction(0) });
        }
        this.message = null;
        this.placeCursor();
        this.changeDetector.markForCheck();
    }

    protected setFigure(type: NoteType): void {
        this.figure = { type, dots: 0 };
        this.changeDetector.markForCheck();
    }

    /** Punti della figura: nessuno, uno, due. */
    protected cycleFigureDots(): void {
        this.figure = { ...this.figure, dots: (this.figure.dots + 1) % 3 };
        this.changeDetector.markForCheck();
    }

    protected setVoice(voice: number): void {
        if (!this.score) return;
        this.cursor = writing.clampCursor(this.score, { ...this.cursor, voice });
        this.placeCursor();
        this.changeDetector.markForCheck();
    }

    /** Sposta il cursore di un elemento della voce e seleziona quello che inizia lì. */
    protected moveCursor(delta: 1 | -1): void {
        if (!this.score) return;
        this.cursor = writing.moveCursor(this.score, this.cursor, delta);
        const id = writing.noteAtCursor(this.score, this.cursor);
        if (id) this.select(id);
        else this.placeCursor();
        this.changeDetector.markForCheck();
    }

    /** Nota al cursore; nelle percussioni con strumenti il suono dello strumento della voce, nella sua posizione. */
    protected writeStep(step: Step): void {
        const drum = input.voiceDrum(this.drumKeys, this.cursor.voice);
        if (drum !== null) this.write((score) => input.writeDrum(score, this.cursor, this.figure, drum));
        else this.write((score) => writing.writeNote(score, this.cursor, this.figure, step));
    }

    protected writeRest(): void {
        this.write((score) => writing.writeRest(score, this.cursor, this.figure));
    }

    /** Nota legata alla precedente, della stessa altezza. */
    protected writeTied(): void {
        this.write((score) => writing.writeTied(score, this.cursor, this.figure));
    }

    /** Gruppo irregolare al cursore, della durata della figura: le note seguenti lo riempiono. */
    protected writeTuplet(actual: number): void {
        this.write((score) => {
            const result = writing.writeTuplet(score, this.cursor, this.figure, actual);
            this.figure = result.figure;
            return result;
        });
    }

    /** Aggiunge alla nota selezionata, e alle note legate a lei, la nota indicata sopra. */
    protected chordPitch(step: Step): void {
        this.noteChange((score, id) => writing.addChordPitch(score, id, step));
    }

    // Tastiera MIDI e pianoforte a schermo

    /** Pannello della tastiera MIDI: la prima volta chiede al browser il permesso di usare i dispositivi MIDI. */
    protected toggleMidi(event: Event, panel: Popover): void {
        panel.toggle(event);
        if (this.midi.status() === 'idle') void this.midi.connect();
        void this.prepareAudio();
    }

    protected togglePiano(): void {
        this.showPiano = !this.showPiano;
        if (this.showPiano) void this.prepareAudio();
        this.changeDetector.markForCheck();
    }

    /**
     * Nota suonata sulla tastiera MIDI o sul pianoforte a schermo: si sente subito e si scrive al cursore con la figura
     * corrente; fuori dall'inserimento sostituisce l'altezza della nota selezionata. Le note dell'accordo si aggiungono a
     * quella del gruppo, in un solo passo di «Annulla».
     */
    protected playKey(key: number, chord = false): void {
        if (!this.score || this.status !== 'ready' || this.saving) return;
        if (this.isDrumPart()) {
            this.playDrum(key, chord);
            this.changeDetector.markForCheck();
            return;
        }
        void this.audition(key);
        const group = chord ? this.played : null;
        if (group) {
            this.apply(
                (score) => {
                    const id = input.addChordKey(score, group.anchorId, key);
                    if (!group.ids.includes(id)) group.ids.push(id);
                    return id;
                },
                { merge: true }
            );
            return;
        }
        let written: string | null = null;
        if (this.inserting) {
            this.apply((score) => {
                const result = input.writeKey(score, this.cursor, this.figure, key);
                this.cursor = result.cursor;
                this.rangeFocusId = null;
                written = result.noteId;
                return written;
            });
        } else if (this.selectedId) {
            const id = this.selectedId;
            this.rangeFocusId = null;
            if (this.apply((score) => input.setNoteKey(score, id, key))) written = id;
        } else {
            this.message = 'Seleziona prima una nota sullo spartito, o entra nella modalità di inserimento (N)';
            this.changeDetector.markForCheck();
        }
        const done = written as string | null;
        this.played = done ? { anchorId: done, ids: [done], voices: [], drumAt: null } : null;
    }

    protected setMidiThreshold(value: number | null): void {
        if (value !== null) this.midi.setThreshold(value);
    }

    private onMidiNote(note: PlayedNote): void {
        this.playKey(note.key, note.chord);
        this.changeDetector.markForCheck();
    }

    /** Parte di percussione: con strumenti, o in chiave di percussione dove scrive il cursore o la selezione. */
    private isDrumPart(): boolean {
        if (this.drumKeys.length) return true;
        const score = this.score;
        if (!score) return false;
        const index = this.inserting ? this.cursor.measureIndex : (this.measure?.index ?? 0);
        return score.stateAt(Math.min(index, score.measures().length - 1)).clef.sign === 'percussion';
    }

    /**
     * Percussioni: con un solo strumento qualsiasi tasto scrive il suo suono, con più strumenti il tasto di uno di loro
     * scrive nella sua voce e gli altri tasti sono ignorati. Fuori dall'inserimento il suono si ascolta soltanto.
     */
    private playDrum(key: number, chord: boolean): void {
        const voice = input.drumVoice(this.drumKeys, key, this.cursor.voice);
        if (voice === null) {
            this.message = `Tasto senza strumento nella parte. ${this.midiDrumHint ?? `Tasti degli strumenti: ${input.drumKeysLabel(this.drumKeys)}`}`;
            return;
        }
        const sound = input.voiceDrum(this.drumKeys, voice) ?? key;
        void this.audition(sound, true);
        if (!this.inserting) return;
        const group = chord ? this.played : null;
        if (group) {
            // Colpi insieme di strumenti diversi: ciascuno nella sua voce, alla posizione della prima nota del gruppo.
            const at = group.drumAt;
            if (!at || group.voices.includes(voice)) return;
            group.voices.push(voice);
            this.apply((score) => input.writeDrum(score, { ...at, voice }, this.figure, sound).noteId, { merge: true });
            return;
        }
        let written: { id: string; at: writing.WritingCursor } | null = null;
        this.apply((score) => {
            const result = input.writeDrum(score, { ...this.cursor, voice }, this.figure, sound);
            written = { id: result.noteId, at: writing.cursorAt(score, result.noteId) };
            this.cursor = result.cursor;
            this.rangeFocusId = null;
            return result.noteId;
        });
        const done = written as { id: string; at: writing.WritingCursor } | null;
        this.played = done ? { anchorId: done.id, ids: [done.id], voices: [voice], drumAt: done.at } : null;
    }

    /** Suona la nota con il suono della parte, trasposto come nel lettore. */
    private async audition(key: number, drum = false): Promise<void> {
        try {
            if (drum) {
                await this.audio.preview([{ key, at: 0, duration: AUDITION_SECONDS }], null, 0, true);
                return;
            }
            const index = this.inserting ? this.cursor.measureIndex : (this.measure?.index ?? 0);
            const clef = this.score?.stateAt(Math.min(index, this.score.measures().length - 1)).clef.sign ?? 'G';
            const sound = partSound(this.data.sound, clef);
            const sounding = Math.min(127, Math.max(0, key + sound.transposition));
            await this.audio.preview([{ key: sounding, at: 0, duration: AUDITION_SECONDS }], sound.program, sound.bank, false);
        } catch {
            // Senza sintetizzatore la nota si scrive lo stesso.
        }
    }

    /** Carica il sintetizzatore prima della prima nota suonata, che altrimenti arriverebbe in ritardo. */
    private async prepareAudio(): Promise<void> {
        try {
            await this.audio.ready();
        } catch {
            // L'ascolto resta non disponibile; la scrittura continua.
        }
    }

    // Passaggio

    /** Seleziona tutta la parte, dalla prima all'ultima battuta, con tutte le voci. */
    protected selectWholePart(): void {
        if (!this.score) return;
        try {
            const result = passages.wholePart(this.score);
            this.select(result.anchorId, result.focusId);
        } catch (error) {
            this.message = error instanceof EditError ? error.message : 'Selezione non riuscita';
            this.changeDetector.markForCheck();
        }
    }

    /** Toglie il passaggio, o l'intervallo da ascoltare: resta selezionata la nota di partenza. */
    protected clearRange(): void {
        this.rangeEnd = null;
        this.rangeFocusId = null;
        this.refreshSelection();
        this.decorate(false);
        this.changeDetector.markForCheck();
    }

    /** Allarga o restringe il passaggio di un elemento della voce della nota selezionata (Maiusc+frecce). */
    protected extendRange(delta: 1 | -1): void {
        if (!this.score || !this.selectedId) return;
        this.setRangeFocus(passages.extendPassage(this.score, this.selectedId, this.rangeFocusId, delta));
        this.notationHost?.querySelector(`[id="${this.rangeFocusId ?? this.selectedId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /** Copia negli appunti il passaggio o la nota selezionata: si incolla anche in un'altra parte. Vale anche in sola lettura. */
    protected copy(): void {
        const passage = this.currentPassage();
        if (!passage || !this.score) return;
        try {
            const clip = passages.copyPassage(this.score, passage);
            this.clipboard.copy(clip);
            this.message = null;
            this.info = `Copiato: ${clip.label}`;
        } catch (error) {
            this.message = error instanceof EditError ? error.message : 'Copia non riuscita';
        }
        this.changeDetector.markForCheck();
    }

    /** Copia il passaggio o la nota selezionata e la trasforma in pause. */
    protected cut(): void {
        const passage = this.currentPassage();
        if (!passage || !this.score) return;
        let clip: passages.ScoreClip;
        try {
            clip = passages.copyPassage(this.score, passage);
        } catch (error) {
            this.message = error instanceof EditError ? error.message : 'Copia non riuscita';
            this.changeDetector.markForCheck();
            return;
        }
        if (!this.apply((score) => this.clearPassage(score, passage))) return;
        this.clipboard.copy(clip);
        this.info = `Tagliato: ${clip.label}`;
        this.changeDetector.markForCheck();
    }

    /**
     * Incolla gli appunti al cursore durante l'inserimento, altrimenti dall'inizio della selezione, al posto di ciò che
     * c'è: il passaggio incollato resta selezionato.
     */
    protected paste(): void {
        const clip = this.clipboard.clip();
        if (!clip) {
            this.message = 'Gli appunti sono vuoti: copia prima una nota o un passaggio';
            this.changeDetector.markForCheck();
            return;
        }
        const target = this.pasteTarget();
        if (!target) {
            this.message = 'Seleziona prima dove incollare sullo spartito';
            this.changeDetector.markForCheck();
            return;
        }
        this.passageChange((score) => passages.pastePassage(score, clip, target));
    }

    /** Ripete il passaggio o la nota selezionata subito dopo di lei (R). */
    protected repeatSelection(): void {
        const passage = this.currentPassage();
        if (passage) this.passageChange((score) => passages.repeatPassage(score, passage));
    }

    /** Traspone il passaggio selezionato, o la nota, oppure tutta la parte con le sue armature. */
    protected transpose(): void {
        const interval = this.intervals.find((option) => option.value === this.transposeInterval) ?? this.intervals[0];
        const direction = this.transposeDirection;
        if (this.transposeScope === 'part') {
            this.apply((score) => passages.transposePassage(score, null, interval, direction));
            return;
        }
        const passage = this.currentPassage();
        if (passage) this.apply((score) => passages.transposePassage(score, passage, interval, direction));
    }

    // Bozza della scrittura

    /** Riprende la bozza o la copia nel browser proposta all'apertura. */
    protected async resumeChoice(): Promise<void> {
        const choice = this.choice;
        if (!choice) return;
        try {
            await this.startWriting(choice.kind === 'local' ? 'local' : 'draft');
        } catch (error) {
            this.failed(error);
        }
        this.changeDetector.markForCheck();
    }

    /** Scarta la bozza o la copia nel browser proposta, e passa a ciò che resta da riprendere. */
    protected async discardChoice(): Promise<void> {
        const choice = this.choice;
        if (!choice) return;
        const { trackId, scoreId } = this.data;
        const local = choice.kind === 'local';
        const confirmed = await new Promise<boolean>((resolve) =>
            this.confirmService.confirmDestructive({
                title: local ? 'Scartare le modifiche?' : 'Scartare la bozza?',
                consequence: local ? 'Le modifiche rimaste in questo browser andranno perse.' : 'La bozza andrà persa per tutti: non si potrà recuperare.',
                actionLabel: local ? 'Scarta le modifiche' : 'Scarta la bozza',
                key: 'score-editor-discard',
                accept: () => resolve(true),
                reject: () => resolve(false)
            })
        );
        if (!confirmed || this.choice !== choice) return;
        try {
            if (local) {
                await this.draftService.forgetLocalCopy(trackId, scoreId);
                this.localCopy = null;
            } else {
                await this.draftService.discard(trackId, scoreId, this.lock.session);
                this.serverDraft = null;
            }
            this.choice = null;
            await this.decide();
        } catch (error) {
            this.failed(error);
        }
        this.changeDetector.markForCheck();
    }

    /** Scarica come MusicXML le modifiche rifiutate dal server, da ricaricare con il caricamento delle versioni. */
    protected downloadCopy(): void {
        const content = this.keeper?.content() ?? this.score?.cleanXml();
        if (!content) return;
        const url = URL.createObjectURL(new Blob([content], { type: 'application/vnd.recordare.musicxml+xml' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${fileName(this.data.partLabel)}.musicxml`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url));
    }

    /** Chiude l'editor tenendo la copia nel browser: sarà proposta alla prossima apertura della parte. */
    protected keepCopy(): void {
        this.keeper?.stop();
        this.dialogRef.close();
    }

    protected discardCopy(): void {
        this.confirmService.confirmDestructive({
            title: 'Scartare le modifiche?',
            consequence: 'Le modifiche rimaste in questo browser andranno perse e l’editor si chiuderà.',
            actionLabel: 'Scarta le modifiche',
            key: 'score-editor-discard',
            accept: () => void this.keeper?.forget().then(() => this.dialogRef.close())
        });
    }

    /** Dopo un conflitto: le modifiche di questa finestra sostituiscono la bozza salvata altrove. */
    protected async keepMine(): Promise<void> {
        try {
            await this.keeper?.overwrite();
        } catch {
            this.message = 'Bozza non salvata: riprovare più tardi';
        }
        this.changeDetector.markForCheck();
    }

    /** Dopo un conflitto: si riparte dalla bozza salvata altrove; senza bozza si tengono le proprie modifiche. */
    protected async loadOther(): Promise<void> {
        const keeper = this.keeper;
        if (!keeper) return;
        try {
            const draft = await this.draftService.draft(this.data.trackId, this.data.scoreId);
            if (!draft) {
                this.message = 'La bozza non c’è più: è stata salvata o scartata altrove. Le tue modifiche diventano la nuova bozza.';
                await keeper.overwrite();
            } else {
                await keeper.reset(draft);
                this.serverDraft = draft;
                this.source = 'draft';
                this.baseVersionId = draft.baseVersionId;
                await this.open(draft.content);
            }
        } catch (error) {
            this.failed(error);
        }
        this.changeDetector.markForCheck();
    }

    // Cronologia

    protected undo(): void {
        if (!this.score) return;
        const previous = this.history.undo(this.score.snapshot());
        if (previous !== null) this.restore(previous);
    }

    protected redo(): void {
        if (!this.score) return;
        const next = this.history.redo(this.score.snapshot());
        if (next !== null) this.restore(next);
    }

    // Ascolto

    protected async togglePlay(): Promise<void> {
        if (this.playing) {
            this.stop();
            return;
        }
        if (!this.score || !this.measure || this.preparingAudio) return;
        this.preparingAudio = true;
        this.changeDetector.markForCheck();
        try {
            const part = parseMusicXml(this.score.cleanXml());
            const [from, to] = this.listenRange ?? [this.measure.index, this.measure.index];
            const passage = excerpt(part, from, to);
            const built = buildPlayback([{ key: 'part', name: this.data.partLabel, part: passage, sound: partSound(this.data.sound, part.clefSign) }], passage, {
                withRepeats: false,
                tempoBpm: null,
                countIn: false
            });
            await this.audio.ready();
            await this.audio.load(built.midi);
            this.audio.setChannel(built.metronome, 0, true);
            await this.audio.play();
            this.playing = true;
            this.stopTimer = window.setTimeout(() => this.stop(), secondsAt(built.totalQuarters, built.tempo) * 1000 + 300);
        } catch {
            this.message = 'Ascolto non disponibile: riprovare più tardi';
        } finally {
            this.preparingAudio = false;
            this.changeDetector.markForCheck();
        }
    }

    // Pagine

    protected async showPage(index: number): Promise<void> {
        const pages = this.pages;
        if (!pages.length) return;
        this.pageIndex = Math.max(0, Math.min(pages.length - 1, index));
        const mediaId = pages[this.pageIndex];
        let url = this.pageUrls.get(mediaId);
        if (!url) {
            this.pageLoading = true;
            this.changeDetector.markForCheck();
            try {
                url = URL.createObjectURL(await firstValueFrom(this.mediaService.streamImage(mediaId)));
                this.pageUrls.set(mediaId, url);
            } catch {
                url = undefined;
            } finally {
                this.pageLoading = false;
            }
        }
        this.pageUrl = url ?? null;
        this.changeDetector.markForCheck();
        this.scrollToHighlight();
    }

    // Salvataggio

    protected async save(approve: boolean): Promise<void> {
        const score = this.score;
        if (!score || !this.canSave || (!this.writingMode && !this.editor)) return;
        this.stop();
        this.saving = true;
        this.changeDetector.markForCheck();
        const keeper = this.keeper;
        try {
            // La bozza non si salva mentre si salva la versione, che la elimina.
            await keeper?.hold();
            const correction: ScoreCorrection = this.writingMode
                ? { parentVersionId: this.baseVersionId, content: score.cleanXml(), approve, origin: 'WRITING', editSession: this.lock.session }
                : { parentVersionId: this.editor!.version.id, content: score.cleanXml(), approve, measureSources: score.measureSources(), origin: 'CORRECTION', editSession: this.lock.session };
            const version = await this.submit(correction);
            if (!version) {
                keeper?.resume();
                return;
            }
            this.dirty = false;
            await keeper?.completed();
            this.dialogRef.close(version);
        } finally {
            this.saving = false;
            this.changeDetector.markForCheck();
        }
    }

    /** Prende il blocco: dopo una conferma se lo possiede un altro, che passa in sola lettura. */
    protected resolveLock(): void {
        const status = this.lock.state().status;
        if (status === 'unavailable') {
            void this.retakeLock(false);
            return;
        }
        this.confirmService.confirmReversible({
            title: 'Prendere il controllo?',
            consequence: 'Chi sta modificando la parte passa in sola lettura e non potrà salvare le modifiche non ancora salvate.',
            actionLabel: 'Prendi il controllo',
            key: 'score-editor-discard',
            accept: () => void this.retakeLock(true)
        });
    }

    protected async close(): Promise<void> {
        if (this.saving) return;
        if (this.keeper) {
            // Nella scrittura le modifiche restano nella bozza: chiudendo si salvano subito.
            const keeper = this.keeper;
            const saved = !keeper.dirty || (await keeper.flush());
            if (saved || keeper.state().status === 'rejected') {
                this.dialogRef.close();
                return;
            }
            this.confirmService.confirmDiscard({
                title: 'Bozza non salvata sul server',
                consequence: 'Le ultime modifiche restano in questo browser: riaprendo l’editor sulla stessa parte potrai riprenderle.',
                actionLabel: 'Esci',
                key: 'score-editor-discard',
                accept: () => this.dialogRef.close()
            });
            return;
        }
        if (!this.dirty) {
            this.dialogRef.close();
            return;
        }
        this.confirmService.confirmDiscard({
            title: 'Uscire senza salvare?',
            consequence: 'Le correzioni non salvate andranno perse.',
            actionLabel: 'Esci senza salvare',
            key: 'score-editor-discard',
            accept: () => this.dialogRef.close()
        });
    }

    // Funzioni interne

    /** Apre il contenuto nell'editor e lo disegna. */
    private async open(xml: string): Promise<void> {
        this.score = edits.openScore(xml);
        this.initialSnapshot = this.score.snapshot();
        this.history = new EditHistory();
        this.dirty = false;
        this.checks = this.score.checks();
        this.selectedId = this.score.notes()[0]?.getAttribute('id') ?? null;
        this.emptyMeasureId = null;
        this.rangeEnd = null;
        this.rangeFocusId = null;
        this.cursor = writing.clampCursor(this.score, writing.startCursor());
        this.choice = null;
        this.status = 'ready';
        // Il contenitore dello spartito compare con lo stato «pronto»: la vista va aggiornata prima di disegnare.
        this.changeDetector.detectChanges();
        this.refreshSelection();
        await this.render();
    }

    private failed(error: unknown): void {
        if (!(error instanceof EditError)) console.error(error);
        this.status = 'error';
        this.choice = null;
        const fallback = this.writingMode ? "Impossibile aprire la parte nell'editor: riprovare più tardi" : "Impossibile aprire la versione nell'editor: riprovare più tardi";
        this.errorMessage = error instanceof EditError ? error.message : fallback;
    }

    /** Scrittura: sceglie da dove partire tra copia nel browser, bozza, versione e parte nuova. */
    private async prepareWriting(): Promise<void> {
        const { trackId, scoreId } = this.data;
        const [draft, local] = await Promise.all([this.draftService.draft(trackId, scoreId), this.lock.held ? this.draftService.localCopy(trackId, scoreId) : Promise.resolve(null)]);
        this.serverDraft = draft;
        this.localCopy = local;
        if (!this.lock.held) {
            // In sola lettura si vede ciò che sta scrivendo chi ha il blocco, se c'è, altrimenti la versione.
            const content = draft?.content ?? this.editor?.musicXml;
            if (!content) throw new EditError('La parte non ha ancora note scritte da mostrare');
            this.source = draft ? 'draft' : 'version';
            await this.open(content);
            return;
        }
        if (local && draft && local.content === draft.content) {
            // Il server ha già le modifiche della copia.
            await this.draftService.forgetLocalCopy(trackId, scoreId);
            this.localCopy = null;
        }
        await this.decide();
    }

    /** Prima la copia nel browser, poi la bozza; senza nulla da riprendere la versione o la parte nuova. */
    private async decide(): Promise<void> {
        const local = this.localCopy;
        const draft = this.serverDraft;
        const version = this.editor?.version ?? null;
        if (local) return this.propose(localChoice(local, draft, version));
        if (draft && version && !this.data.resume) return this.propose(draftChoice(draft, version));
        if (draft) return this.startWriting('draft');
        if (version) return this.startWriting('version');
        if (this.data.initialContent) return this.startWriting('new');
        throw new EditError('La parte non ha versioni né una bozza da scrivere');
    }

    private propose(choice: ResumeChoice): void {
        this.choice = choice;
        this.status = 'choosing';
        this.changeDetector.markForCheck();
    }

    private async startWriting(source: WritingSource): Promise<void> {
        const draft = this.serverDraft;
        const local = this.localCopy;
        const content = source === 'local' ? local!.content : source === 'draft' ? draft!.content : source === 'new' ? this.data.initialContent! : this.editor!.musicXml;
        this.source = source;
        this.baseVersionId = source === 'local' ? local!.baseVersionId : source === 'draft' ? draft!.baseVersionId : (this.editor?.version.id ?? null);
        this.keeper?.stop();
        this.keeper = this.draftService.keeper(this.data.trackId, this.data.scoreId, {
            lock: this.lock,
            content: () => this.score?.cleanXml() ?? content,
            baseVersionId: this.baseVersionId,
            entityVersion: draft?.entityVersion ?? null,
            savedAt: source === 'draft' ? draft!.savedAt : null
        });
        await this.open(content);
        // La copia nel browser e la parte nuova non sono ancora sul server.
        if (source === 'local' || source === 'new') this.keeper.changed();
    }

    /** Invia la versione; nella scrittura chiede conferma se nel frattempo ne è stata salvata un'altra. `null` se non salvata. */
    private async submit(correction: ScoreCorrection): Promise<ScoreVersion | null> {
        const summary = withErrorSummary(this.writingMode ? 'Versione non salvata' : 'Correzione non salvata');
        const context = this.writingMode ? withHandledErrors([OUTDATED], summary) : summary;
        try {
            return await firstValueFrom(this.playbackService.correct(this.data.trackId, this.data.scoreId, correction, context));
        } catch (error) {
            if (this.writingMode && !correction.confirmOutdated && error instanceof HttpErrorResponse && this.apiErrors.resolve(error).key === OUTDATED) {
                const confirmed = await this.ask({
                    title: 'Sostituire la versione salvata?',
                    consequence: "Dopo l'inizio della scrittura è stata salvata un'altra versione della parte: la versione scritta diventerà quella corrente al suo posto.",
                    actionLabel: 'Salva comunque'
                });
                return confirmed ? this.submit({ ...correction, confirmOutdated: true }) : null;
            }
            // Chi ha perso il controllo passa in sola lettura: l'avviso del salvataggio dice chi lo ha preso.
            this.lock.refused(error);
            return null;
        }
    }

    private ask(request: { title: string; consequence: string; actionLabel: string }): Promise<boolean> {
        return new Promise((resolve) => this.confirmService.confirmReversible({ ...request, key: 'score-editor-discard', accept: () => resolve(true), reject: () => resolve(false) }));
    }

    /** Scrittura al cursore: il cursore passa dopo ciò che è stato scritto, che resta selezionato. */
    private write(change: (score: ScoreDocument) => writing.WriteResult): void {
        if (!this.inserting) return;
        this.apply((score) => {
            const result = change(score);
            this.cursor = result.cursor;
            this.rangeFocusId = null;
            return result.noteId;
        });
    }

    /**
     * Tasti della scrittura: N per la modalità di inserimento, la selezione e gli appunti del passaggio e, durante
     * l'inserimento, note, accordi, voci e gruppi.
     */
    private writingKey(event: KeyboardEvent): boolean {
        const key = event.key;
        const command = event.ctrlKey || event.metaKey;
        if (!command && !event.altKey && key.toLowerCase() === 'n') {
            this.toggleInsertion();
            return true;
        }
        if (command && !event.altKey && !event.shiftKey) {
            const letter = key.toLowerCase();
            const actions: Record<string, () => void> = { a: () => this.selectWholePart(), c: () => this.copy(), x: () => this.cut(), v: () => this.paste() };
            // Senza nulla da copiare resta la copia del browser, per esempio del testo della pagina.
            if (actions[letter] && (letter !== 'c' || this.selectedId)) {
                actions[letter]();
                return true;
            }
        }
        if (!command && !event.altKey && !event.shiftKey && key.toLowerCase() === 'r') {
            this.repeatSelection();
            return true;
        }
        if (event.shiftKey && !command && !event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
            this.extendRange(key === 'ArrowLeft' ? -1 : 1);
            return true;
        }
        if (!this.inserting) return false;
        // Ctrl+1–9 sono riservati dal browser: le voci usano Ctrl+Alt, i gruppi irregolari Alt.
        const digit = Number(/^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1] ?? NaN);
        if (command && event.altKey && digit >= 1 && digit <= 4) {
            this.setVoice(digit);
            return true;
        }
        if (event.altKey && !command && this.tuplets.some((option) => option.actual === digit)) {
            this.writeTuplet(digit);
            return true;
        }
        if (command || event.altKey) return false;
        if (key === 'Escape') {
            this.toggleInsertion();
            return true;
        }
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            this.moveCursor(key === 'ArrowLeft' ? -1 : 1);
            return true;
        }
        if (/^[a-g]$/i.test(key)) {
            const step = key.toUpperCase() as Step;
            if (event.shiftKey) this.chordPitch(step);
            else this.writeStep(step);
            return true;
        }
        // Figure, punto, pausa, legatura, alterazioni e altezza seguono la modalità nei tasti comuni.
        return false;
    }

    /** Cursore dell'inserimento: una barra prima dell'elemento che inizia al cursore, o alla fine della battuta. */
    private placeCursor(): void {
        const host = this.notationHost;
        const pane = host?.parentElement;
        const score = this.score;
        if (!this.inserting || !score || !host || !pane) {
            this.cursorBox = null;
            return;
        }
        const measures = score.measures();
        const drawnMeasure = this.drawnMeasure(measures, this.cursor.measureIndex);
        const measure = measures[this.cursor.measureIndex];
        if (!drawnMeasure || !measure) {
            this.cursorBox = null;
            this.changeDetector.markForCheck();
            return;
        }
        const position = toNumber(this.cursor.offset) * score.stateAt(this.cursor.measureIndex).divisions;
        const following = score
            .events(measure)
            .filter((event) => event.duration > 0 && event.start >= position - 1e-6)
            .sort((left, right) => left.start - right.start || Number(left.voice !== String(this.cursor.voice)) - Number(right.voice !== String(this.cursor.voice)));
        const next = following.find((event) => event.voice === String(this.cursor.voice)) ?? following[0];
        const drawnNote = next ? host.querySelector(`[id="${next.notes[0].getAttribute('id')}"]`) : null;
        const paneBox = pane.getBoundingClientRect();
        const measureBox = drawnMeasure.getBoundingClientRect();
        const x = drawnNote ? drawnNote.getBoundingClientRect().left - 4 : measureBox.right - 6;
        this.cursorBox = { left: x - paneBox.left + pane.scrollLeft, top: measureBox.top - paneBox.top + pane.scrollTop, height: measureBox.height };
        this.changeDetector.markForCheck();
    }

    private noteChange(change: (score: ScoreDocument, id: string) => string | null | void, keepPlayed = false): void {
        if (!this.selectedId) {
            this.message = this.measure?.empty ? 'La battuta è vuota: aggiungi una pausa per inserire le note' : 'Seleziona prima una nota sullo spartito';
            this.changeDetector.markForCheck();
            return;
        }
        const id = this.selectedId;
        // Le modifiche di una nota valgono per la nota selezionata: il passaggio si toglie.
        this.rangeFocusId = null;
        this.apply((score) => change(score, id), { keepPlayed });
    }

    /** Il passaggio selezionato o, senza passaggio, la nota selezionata. */
    private currentPassage(): passages.Passage | null {
        if (this.passage) return this.passage;
        if (!this.score || !this.selectedId) {
            this.message = 'Seleziona prima una nota o un passaggio sullo spartito';
            this.changeDetector.markForCheck();
            return null;
        }
        try {
            return passages.passageBetween(this.score, this.selectedId, this.selectedId);
        } catch (error) {
            this.message = error instanceof EditError ? error.message : 'Selezione non valida';
            this.changeDetector.markForCheck();
            return null;
        }
    }

    /** Dove incollare: al cursore durante l'inserimento, altrimenti all'inizio della selezione o della battuta selezionata. */
    private pasteTarget(): writing.WritingCursor | null {
        if (!this.score) return null;
        if (this.inserting) return this.cursor;
        if (this.passage) return { ...this.passage.from, voice: this.passage.voice };
        if (this.selectedId) return writing.cursorAt(this.score, this.selectedId);
        return this.measure ? { measureIndex: this.measure.index, voice: 1, offset: fraction(0) } : null;
    }

    /** Cancella il passaggio: durante l'inserimento il cursore torna al suo inizio, per riscriverlo. */
    private clearPassage(score: ScoreDocument, passage: passages.Passage): string | null {
        const selected = passages.clearPassage(score, passage);
        this.rangeFocusId = null;
        if (this.inserting) this.cursor = { ...passage.from, voice: passage.wholeMeasures ? this.cursor.voice : passage.voice };
        return selected;
    }

    /** Modifica che dà un passaggio da selezionare e, durante l'inserimento, il cursore dopo di lui. */
    private passageChange(change: (score: ScoreDocument) => passages.PassageResult): void {
        this.apply((score) => {
            const result = change(score);
            if (this.inserting && result.cursor) this.cursor = result.cursor;
            this.rangeFocusId = result.anchorId && result.focusId !== result.anchorId ? result.focusId : null;
            return result.anchorId;
        });
    }

    /** Sceglie l'estremo mobile del passaggio; sulla nota selezionata il passaggio si toglie. */
    private setRangeFocus(id: string): void {
        this.rangeEnd = null;
        this.rangeFocusId = id === this.selectedId ? null : id;
        this.message = null;
        this.info = null;
        this.refreshSelection();
        this.decorate(false);
        this.changeDetector.markForCheck();
    }

    /** Modifica di un segno sulla nota selezionata o, se c'è, sul passaggio, che resta selezionato. */
    private notationChange(change: (score: ScoreDocument, target: notation.NotationTarget) => string | null | void): void {
        if (!this.selectedId) {
            this.message = 'Seleziona prima una nota o un passaggio sullo spartito';
            this.changeDetector.markForCheck();
            return;
        }
        const id = this.selectedId;
        const passage = this.passage;
        this.apply((score) => change(score, { noteId: id, passage: passage ? { notes: passages.passageNotes(score, passage), voice: String(passage.voice) } : null }));
    }

    private measureChange(change: (score: ScoreDocument, index: number) => string | null | void): void {
        if (!this.measure) {
            this.message = 'Seleziona prima una battuta sullo spartito';
            this.changeDetector.markForCheck();
            return;
        }
        const index = this.measure.index;
        this.apply((score) => change(score, index));
    }

    private async retakeLock(takeOver: boolean): Promise<void> {
        const acquired = await this.lock.acquire(takeOver);
        if (acquired && this.writingMode) {
            try {
                // Con il blocco ripreso le modifiche rifiutate ripartono verso il server; se chi aveva il blocco ha salvato
                // una bozza, è un conflitto e decide l'autore. Senza bozza in corso la scrittura riparte da ciò che c'è.
                if (this.keeper?.state().status === 'rejected') await this.keeper.retry();
                else if (!this.keeper) await this.prepareWriting();
            } catch (error) {
                this.failed(error);
            }
        }
        this.changeDetector.markForCheck();
    }

    /** Esegue una modifica; se non riesce ripristina il documento e ne mostra il motivo. Restituisce se è riuscita. */
    /**
     * Applica la modifica, che diventa un passo della cronologia. `merge` la unisce al passo precedente, come le note di un
     * accordo suonato; `keepPlayed` conserva le ultime note suonate, per correggerne ancora la grafia.
     */
    private apply(change: (score: ScoreDocument) => string | null | void, options: { merge?: boolean; keepPlayed?: boolean } = {}): boolean {
        if (!options.merge && !options.keepPlayed) this.played = null;
        if (!this.score || this.saving) return false;
        if (this.readOnly) {
            this.message = "L'editor è in sola lettura: prendi il controllo per modificare la parte";
            this.changeDetector.markForCheck();
            return false;
        }
        this.stop();
        this.info = null;
        const before = this.score.snapshot();
        let applied = false;
        try {
            const selected = change(this.score);
            // Nella scrittura legature di portamento e forcelle hanno sempre inizio e fine: gli estremi rimasti soli si tolgono.
            if (this.writingMode) notation.balanceSpanners(this.score);
            if (!options.merge || !this.history.canUndo) this.history.record(before);
            if (typeof selected === 'string') {
                this.selectedId = selected;
                this.emptyMeasureId = null;
            }
            this.message = null;
            this.keeper?.changed();
            applied = true;
        } catch (error) {
            this.score = ScoreDocument.restore(before, this.score.prefix);
            this.message = error instanceof EditError ? error.message : 'Modifica non riuscita';
            if (!(error instanceof EditError)) console.error(error);
        }
        this.afterChange();
        return applied;
    }

    private restore(snapshot: string): void {
        if (!this.score || this.readOnly) return;
        this.played = null;
        this.stop();
        this.score = ScoreDocument.restore(snapshot, this.score.prefix);
        this.message = null;
        this.keeper?.changed();
        this.afterChange();
    }

    private afterChange(): void {
        const score = this.score!;
        this.dirty = score.snapshot() !== this.initialSnapshot;
        this.checks = score.checks();
        const selectionExists = this.selectedId ? !!score.find(this.selectedId) : !this.emptyMeasureId || !!score.find(this.emptyMeasureId);
        if (!selectionExists) {
            // La nota o la battuta selezionata non esiste più, per esempio dopo «Annulla»: si resta sulla stessa battuta.
            const index = Math.min(this.measure?.index ?? 0, score.measures().length - 1);
            this.selectedId = edits.firstNoteOf(score, index);
            this.emptyMeasureId = this.selectedId ? null : (score.measure(index).getAttribute('id') ?? null);
        }
        if (this.rangeEnd !== null && this.rangeEnd >= score.measures().length) this.rangeEnd = null;
        if (!selectionExists || (this.rangeFocusId && !score.find(this.rangeFocusId))) this.rangeFocusId = null;
        if (this.writingMode) this.cursor = writing.clampCursor(score, this.cursor);
        this.refreshSelection();
        this.changeDetector.markForCheck();
        this.scheduleRender();
    }

    /**
     * Ridisegna al fotogramma successivo: le modifiche che arrivano prima, come un tasto tenuto premuto, si disegnano una
     * volta sola. Il disegno di Verovio blocca la pagina per circa 0,2 secondi su una parte di 300 battute.
     */
    private scheduleRender(): void {
        if (this.renderFrame !== undefined) return;
        this.renderFrame = requestAnimationFrame(() => {
            this.renderFrame = undefined;
            void this.render();
        });
    }

    /** Seleziona la nota indicata e, con `focusId`, il passaggio fino a lei. */
    private select(id: string | null, focusId: string | null = null): void {
        this.selectedId = id;
        this.emptyMeasureId = null;
        this.rangeFocusId = id && focusId !== id ? focusId : null;
        this.message = null;
        this.info = null;
        this.refreshSelection();
        this.decorate(true);
        this.changeDetector.markForCheck();
    }

    private selectEmptyMeasure(index: number): void {
        this.selectedId = null;
        this.emptyMeasureId = this.score?.measure(index).getAttribute('id') ?? null;
        this.rangeFocusId = null;
        this.message = null;
        this.info = null;
        this.refreshSelection();
        this.decorate(true);
        this.changeDetector.markForCheck();
    }

    private selectAdjacent(delta: number): void {
        if (!this.score || !this.selectedId) return;
        const next = edits.adjacentNote(this.score, this.selectedId, delta);
        if (next) {
            this.rangeEnd = null;
            this.select(next);
        }
    }

    private refreshSelection(): void {
        this.refreshPassage();
        const emptyMeasure = !this.selectedId && this.emptyMeasureId ? this.score?.find(this.emptyMeasureId) : null;
        if (!this.score || (!emptyMeasure && (!this.selectedId || !this.score.find(this.selectedId)))) {
            this.note = null;
            this.measure = null;
            this.highlight = null;
            return;
        }
        this.note = emptyMeasure ? null : edits.noteInfo(this.score, this.selectedId!);
        this.measure = edits.measureInfo(this.score, emptyMeasure ? this.score.measureIndex(emptyMeasure) : this.note!.measureIndex);
        this.timeBeats = this.measure.beats;
        this.timeBeatType = this.measure.beatType;
        this.tempo = this.measure.tempo;
        this.tempoText = this.measure.tempoText ?? '';
        this.rehearsalText = this.measure.rehearsal ?? notation.nextRehearsal(this.score, this.measure.index);
        this.expressionText = this.note?.expression ?? '';
        // Su una pausa di più battute il numero mostra la sua durata, da correggere; altrimenti resta l'ultimo scritto.
        if (this.measure.multiRest > 1) this.measureCount = this.measure.multiRest;
        this.updatePage();
    }

    private refreshPassage(): void {
        const score = this.score;
        this.passage = null;
        if (!this.writingMode || !score || !this.selectedId || !this.rangeFocusId || !score.find(this.selectedId) || !score.find(this.rangeFocusId)) return;
        try {
            this.passage = passages.passageBetween(score, this.selectedId, this.rangeFocusId);
            this.passageText = passages.passageLabel(score, this.passage);
        } catch {
            this.passage = null;
        }
    }

    /** Prima e ultima battuta da ascoltare: le battute del passaggio, l'intervallo scelto o la battuta selezionata. */
    private get listenRange(): [number, number] | null {
        if (!this.measure) return null;
        if (this.passage) return [this.passage.from.measureIndex, this.passage.to.measureIndex];
        const end = this.rangeEnd ?? this.measure.index;
        return [Math.min(this.measure.index, end), Math.max(this.measure.index, end)];
    }

    private async render(): Promise<void> {
        const host = this.notationHost;
        if (!this.score || !host) return;
        const token = ++this.renderToken;
        const scrollTop = host.parentElement?.scrollTop ?? 0;
        this.rendering = true;
        this.changeDetector.markForCheck();
        try {
            // La scrittura mostra le interruzioni di riga e di pagina della parte; la correzione segue la larghezza.
            const pages = await this.renderer.render(this.score.snapshot(), host.clientWidth || 900, EDITOR_SCALE, { encodedBreaks: this.writingMode });
            if (token !== this.renderToken) return;
            // L'SVG è generato da Verovio a partire dal MusicXML: i testi sono codificati e non contiene script.
            host.innerHTML = pages.join('');
            if (host.parentElement) host.parentElement.scrollTop = scrollTop;
            this.decorate(true);
        } catch {
            if (token === this.renderToken) this.message = 'Impossibile disegnare lo spartito dopo questa modifica: annullala';
        } finally {
            if (token === this.renderToken) {
                this.rendering = false;
                this.changeDetector.markForCheck();
            }
        }
    }

    /**
     * Evidenzia sullo spartito la nota selezionata, la sua battuta, il passaggio o l'intervallo da ascoltare e le battute da
     * verificare.
     */
    private decorate(scroll: boolean): void {
        const host = this.notationHost;
        if (!this.score || !host) return;
        for (const className of ['is-selected', 'is-current-measure', 'is-in-range', 'is-in-passage', 'is-wrong']) {
            for (const item of Array.from(host.querySelectorAll(`.${className}`))) item.classList.remove(className);
        }
        const measures = this.score.measures();
        for (const index of this.checks.wrongDuration) this.drawnMeasure(measures, index)?.classList.add('is-wrong');
        const range = this.listenRange;
        if (this.measure && range) {
            for (let index = range[0]; index <= range[1]; index++) this.drawnMeasure(measures, index)?.classList.add(index === this.measure.index ? 'is-current-measure' : 'is-in-range');
        }
        if (this.passage) {
            for (const note of passages.passageNotes(this.score, this.passage)) host.querySelector(`[id="${note.getAttribute('id')}"]`)?.classList.add('is-in-passage');
        }
        const selected = this.selectedId ? host.querySelector(`[id="${this.selectedId}"]`) : null;
        selected?.classList.add('is-selected');
        if (scroll) (selected ?? (this.measure ? this.drawnMeasure(measures, this.measure.index) : null))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        this.placeCursor();
    }

    /** Battuta disegnata; le battute di una pausa di più battute usano quella che apre il gruppo. */
    private drawnMeasure(measures: Element[], index: number): Element | null {
        const host = this.notationHost;
        if (!host) return null;
        for (let current = index; current >= 0; current--) {
            const id = measures[current]?.getAttribute('id');
            const drawn = id ? host.querySelector(`[id="${id}"]`) : null;
            if (drawn) return drawn;
        }
        return null;
    }

    /** Battuta disegnata che contiene il punto indicato, in coordinate della finestra. */
    private measureAt(x: number, y: number): Element | null {
        const measures = Array.from(this.notationHost?.querySelectorAll('g.measure') ?? []);
        return (
            measures.find((measure) => {
                const box = measure.getBoundingClientRect();
                return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
            }) ?? null
        );
    }

    /** Nota o pausa disegnata nella battuta più vicina al punto indicato, in coordinate della finestra. */
    private nearestNote(drawnMeasure: Element, x: number, y: number): string | null {
        let best: { id: string; distance: number } | null = null;
        for (const item of Array.from(drawnMeasure.querySelectorAll('g[id]'))) {
            const id = item.getAttribute('id')!;
            if (this.score?.find(id)?.tagName !== 'note') continue;
            const box = item.getBoundingClientRect();
            const distance = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
            if (!best || distance < best.distance) best = { id, distance };
        }
        return best?.id ?? null;
    }

    private get notationHost(): HTMLElement | null {
        return this.notation?.nativeElement ?? null;
    }

    private measureNumbers(indexes: number[]): string[] {
        const measures = this.score?.measures() ?? [];
        return indexes.map((index) => measures[index]?.getAttribute('number') ?? String(index + 1));
    }

    /** Mostra la pagina della battuta selezionata con il suo riquadro, se la posizione è nota. */
    private updatePage(): void {
        const box = this.measure ? this.boxesFor(this.measure.index)[0] : undefined;
        if (!box) {
            this.highlight = null;
            if (!this.pageUrl && this.pages.length) void this.showPage(this.pageIndex);
            return;
        }
        const margin = box.approximate ? { x: box.width * 0.5, y: box.height * 0.25 } : { x: 0.005, y: 0.005 };
        const left = Math.max(0, box.x - margin.x);
        const top = Math.max(0, box.y - margin.y);
        this.highlight = {
            left: left * 100,
            top: top * 100,
            width: (Math.min(1, box.x + box.width + margin.x) - left) * 100,
            height: (Math.min(1, box.y + box.height + margin.y) - top) * 100,
            approximate: box.approximate
        };
        if (box.page - 1 !== this.pageIndex || !this.pageUrl) void this.showPage(box.page - 1);
        else this.scrollToHighlight();
    }

    private boxesFor(measureIndex: number): MeasureBox[] {
        const source = this.score?.measureSources()[measureIndex];
        if (source === null || source === undefined) return [];
        return (this.editor?.layout ?? []).filter((box) => box.measure === source + 1);
    }

    private scrollToHighlight(): void {
        window.setTimeout(() => this.pageViewer?.nativeElement.querySelector('.score-editor__box')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    }

    private stop(): void {
        if (this.stopTimer !== undefined) window.clearTimeout(this.stopTimer);
        this.stopTimer = undefined;
        if (this.playing) this.audio.pause();
        this.playing = false;
        this.changeDetector.markForCheck();
    }
}
