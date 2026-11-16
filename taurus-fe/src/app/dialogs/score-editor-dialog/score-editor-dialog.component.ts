import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { Popover } from 'primeng/popover';
import { DrumPad, PianoKeyboardComponent } from '../../components/piano-keyboard/piano-keyboard.component';
import { ImportsModule } from '../../imports';
import {
    ArrangementDraft,
    ArrangementRow,
    ArrangementVersion,
    ArrangementVersionRequest,
    ErrorReport,
    InstrumentsCriteria,
    MeasureBox,
    PlaybackInstrument,
    PlaybackSound,
    ScoreCorrection,
    ScoreDraft,
    ScoreEditorData,
    ScoreVersion
} from '../../module';
import { DocumentChange, DocumentHistory, MeasureHistory, SnapshotHistory } from '../../score-editor/edit-history';
import { excerpt } from '../../score-editor/excerpt';
import { concertFifths, proposedClef, writtenFifths } from '../../score-editor/new-part';
import * as arrangements from '../../score-editor/score-arrangement';
import { Alteration, ALTERATIONS, CLEF_OPTIONS, fraction, KEY_OPTIONS, NOTE_TYPES, NoteType, Step, STEP_NAMES, STEPS, toNumber } from '../../score-editor/notation-rules';
import { RangeInstrument, rangeLabel, RangeWarning, rangeWarnings, writtenRange } from '../../score-editor/score-derivation';
import { EditError, ScoreDocument, ScoreDocumentChecks } from '../../score-editor/score-document';
import * as edits from '../../score-editor/score-edits';
import * as input from '../../score-editor/score-input';
import * as notation from '../../score-editor/score-notation';
import * as passages from '../../score-editor/score-passage';
import { ScoreLayoutClient } from '../../score-editor/score-layout-client';
import { DrawingSource, drawingExcerpt, drawingXml, measurePositions } from '../../score-editor/score-pages';
import * as writing from '../../score-editor/score-writing';
import { parseMusicXml } from '../../score-player/musicxml-score';
import { buildPlayback, BuiltPlayback, PlaybackPartInput } from '../../score-player/playback-builder';
import { originLabel } from '../../score-player/playback-labels';
import { partSound, secondsAt } from '../../score-player/timeline';
import {
    ApiErrorService,
    ArrangementService,
    ConfirmService,
    DraftState,
    InstrumentsService,
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
    DrawingOptions,
    drawingOptions,
    ScoreRendererService,
    withErrorSummary,
    withHandledErrors
} from '../../service';
import { PagedNotation } from './paged-notation';

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
    /** Scrittura: il servizio musicale impagina le parti, e la barra superiore offre «Impagina». */
    engravable?: boolean;
    /** Strumento di una parte con un solo strumento, per segnalare le note fuori dalla sua estensione. */
    range?: EditorRange | null;
    /** Correzione: la battuta da selezionare all'apertura, da 0, come quella di una differenza del confronto. */
    measureIndex?: number | null;
    /**
     * Scrittura della partitura della traccia: tutti i righi, con il blocco, la bozza e le versioni della partitura. Le
     * modifiche della struttura valgono per tutti i righi, le altre per il rigo attivo.
     */
    arrangement?: ArrangementEditorTarget | null;
}

/** Partitura aperta nell'editor di scrittura. */
export interface ArrangementEditorTarget {
    /** Versione corrente della partitura, da cui parte la scrittura; `null` prima del primo salvataggio. */
    version: ArrangementVersion | null;
    /** Righi della versione corrente, con i loro strumenti. */
    rows: ArrangementRow[];
}

/** Estensione dello strumento della parte, con il nome per i controlli. */
export interface EditorRange {
    instrumentName: string;
    instrument: RangeInstrument;
}

/** L'editor si è chiuso per impaginare la versione aperta, senza modifiche. */
export interface ScoreEditorEngraveRequest {
    engraveVersionId: number;
}

/** Esito dell'editor: la versione salvata della parte o della partitura, la richiesta di impaginare o niente. */
export type ScoreEditorDialogResult = ScoreVersion | ArrangementVersion | ScoreEditorEngraveRequest | undefined;

export function isEngraveRequest(result: ScoreEditorDialogResult): result is ScoreEditorEngraveRequest {
    return !!result && 'engraveVersionId' in result;
}

type EditorStatus = 'loading' | 'choosing' | 'ready' | 'error';

/** Versione da cui parte la scrittura, della parte o della partitura. */
interface BaseVersion {
    id: number;
    versionNumber: number;
    current: boolean;
}

/** Strumenti di un rigo, per `id` della parte. */
interface RowAssignment {
    id: string;
    instrumentIds: number[];
}

/** Un rigo della partitura nel pannello dei righi. */
interface RowView {
    index: number;
    id: string;
    name: string;
    instruments: string;
    hidden: boolean;
    active: boolean;
    /** Suona più forte degli altri righi nell'ascolto. */
    highlighted: boolean;
}

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

/**
 * Battute per righi mostrati oltre le quali lo spartito si disegna per pagine: sotto, disegnarlo tutto costa quanto
 * l'estratto di una pagina.
 */
const PAGED_MEASURES = 100;
/** Attesa dopo l'ultima modifica prima di impaginare di nuovo tutto lo spartito nel Web Worker, in millisecondi. */
const LAYOUT_DELAY = 400;
/** Altezza minima di una pagina del disegno per pagine, in pixel. */
const MIN_PAGE_HEIGHT = 400;
const DRAWING_ERROR = 'Impossibile disegnare lo spartito dopo questa modifica: annullala';

/** Durata della nota suonata sulla tastiera MIDI o sul pianoforte a schermo, in secondi. */
const AUDITION_SECONDS = 0.6;

/** Partitura: volume degli altri righi mentre uno è in evidenza nell'ascolto. */
const BACKGROUND_GAIN = 0.35;

/** Partitura: le due notazioni, nella barra superiore. */
const NOTATIONS = [
    { label: 'Trasposta', value: false, tooltip: 'Converte tutta la partitura nella notazione trasposta, come le parti' },
    { label: 'Suoni reali', value: true, tooltip: 'Converte tutta la partitura in suoni reali: ogni rigo si traspone per il suo strumento' }
] as const;

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

function draftChoice(draft: ScoreDraft, version: BaseVersion, subject: string): ResumeChoice {
    const author = draft.savedBy ? ` di ${draft.savedBy}` : '';
    return {
        kind: 'draft',
        heading: 'Bozza non salvata',
        detail: `C'è una bozza${author}, salvata il ${momentOf(draft.savedAt)}: puoi riprenderla o scartarla e ripartire dalla versione ${version.versionNumber}.`,
        warning: draft.outdated ? `Dopo l'inizio della scrittura è stata salvata un'altra versione della ${subject}: salvando, la bozza la sostituirà.` : null,
        resumeLabel: 'Riprendi la bozza',
        discardLabel: `Scarta e apri la versione ${version.versionNumber}`
    };
}

function localChoice(local: LocalDraftCopy, draft: ScoreDraft | null, version: BaseVersion | null, subject: string): ResumeChoice {
    const from = timeOf(local.changedFrom);
    const to = timeOf(local.changedAt);
    const day = new Date(local.changedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    const span = from === to ? `alle ${to}` : `dalle ${from} alle ${to}`;
    let warning: string | null = null;
    if (draft && draft.entityVersion !== local.entityVersion) {
        warning = `Sul server c'è una bozza più recente${draft.savedBy ? ` di ${draft.savedBy}` : ''}, salvata il ${momentOf(draft.savedAt)}: riprendendo queste modifiche la sostituisci.`;
    } else if (version && local.baseVersionId !== version.id) {
        warning = `Dopo queste modifiche è stata salvata un'altra versione della ${subject}: salvando, le modifiche la sostituiranno.`;
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

/** Righi con i loro strumenti, da segnare sul documento. */
function assignments(rows: readonly ArrangementRow[]): RowAssignment[] {
    return rows.map((row) => ({ id: row.id, instrumentIds: row.instruments.map((instrument) => instrument.id) }));
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
    protected voices: { label: string; value: number }[] = [];
    /** Suoni di batteria degli strumenti della parte o del rigo, in ordine di voce; vuoto per le parti intonate. */
    protected drumKeys: number[] = [];
    /** Pulsanti del pianoforte a schermo per le percussioni con strumenti, uno per strumento. */
    protected drumPads: DrumPad[] = [];
    protected readonly minThreshold = MIN_CHORD_THRESHOLD;
    protected readonly maxThreshold = MAX_CHORD_THRESHOLD;
    protected readonly intervals = [...passages.INTERVALS];
    protected readonly directions: { label: string; value: 1 | -1 }[] = [
        { label: 'Su', value: 1 },
        { label: 'Giù', value: -1 }
    ];
    protected readonly transposeScopes: { label: string; value: 'passage' | 'part' }[];
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
    /** Ciò che si scrive, nei messaggi: «parte» o «partitura». */
    protected readonly subject: string;

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
    /** Battute con note fuori dall'estensione dello strumento, con la prima di ognuna. */
    protected rangeWarnings: RangeWarning[] = [];
    /** Estensione della parte nella sua chiave iniziale, «Si♭3–Fa6»; `null` se non è configurata. */
    protected rangeText: string | null = null;
    protected reports: ErrorReport[] = [];
    /** Estensione dello strumento della parte o del rigo attivo, con il nome per i controlli. */
    protected range: EditorRange | null;

    /** Partitura: righi del pannello, con quello attivo e quelli nascosti. */
    protected rowViews: RowView[] = [];
    /** Partitura: righi nascosti nel disegno, per `id` della parte. */
    protected hiddenRows = new Set<string>();
    /** Partitura: nelle righe dello spartito non si disegnano i righi che hanno solo pause. */
    protected condense = false;
    /** Partitura: battute copiate da tutti i righi. */
    protected rowsClip: arrangements.RowsClip | null = null;
    /** Partitura: strumento del rigo da aggiungere. */
    protected newRowInstrumentId: number | null = null;
    /** Partitura: strumenti dell'associazione, per i righi da aggiungere. */
    protected catalog: PlaybackInstrument[] = [];
    /** Partitura: rigo che nell'ascolto suona più forte degli altri, per `id` della parte. */
    protected highlightedRow: string | null = null;
    /** Partitura: controlli di tutti i righi. */
    protected rowCheckList: arrangements.RowCheck[] = [];
    /** Partitura: strumento senza trasposizione che ha bloccato la conversione, da configurare. */
    protected conversionBlock: { id: number; name: string } | null = null;
    protected readonly notations = NOTATIONS;
    /** Strumenti dei righi e del catalogo, per `id`. */
    private readonly instruments = new Map<number, PlaybackInstrument>();
    /** Suono della parte o del rigo attivo, per l'ascolto e le note suonate. */
    private sound: PlaybackSound;

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
    /** Ascolto in corso, per cambiare il volume dei righi mentre suona. */
    private playback: BuiltPlayback | null = null;

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
    /** Righi della bozza della partitura. */
    private serverRows: RowAssignment[] | null = null;
    private localCopy: LocalDraftCopy | null = null;
    /** MusicXML della versione corrente della partitura. */
    private versionXml: string | null = null;

    private score?: ScoreDocument;
    private initialSnapshot = '';
    private history: DocumentHistory = new SnapshotHistory();
    private readonly pageUrls = new Map<number, string>();
    private renderToken = 0;
    private renderFrame?: number;
    /** Disegno per pagine degli spartiti lunghi o con molti righi; `null` quando lo spartito si disegna intero. */
    private pager: PagedNotation | null = null;
    /** Larghezza, righi nascosti, compressione e interruzioni del disegno per pagine: se cambiano si ridisegna tutto. */
    private pagerKey = '';
    /** Battute cambiate dall'ultimo disegno per pagine; `null` se va ridisegnato tutto. */
    private drawChange: Set<string> | null = null;
    /** La pagina della selezione si sta disegnando: quando è pronta lo spartito scorre fino a lei. */
    private scrollPending = false;
    /** Posizioni delle battute e inizi delle pause di più battute, ricavati dal documento fino alla prossima modifica. */
    private measureCache: { positions?: Map<string, number>; restStarts?: number[] } = {};
    private layoutClient?: ScoreLayoutClient;
    private layoutTimer?: number;
    private layoutRevision = 0;
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
        protected readonly midi: MidiInputService,
        private readonly arrangementService: ArrangementService,
        private readonly instrumentsService: InstrumentsService
    ) {
        this.data = config.data!;
        const arrangement = this.data.arrangement;
        this.writingMode = this.data.mode === 'writing' || !!arrangement;
        this.subject = arrangement ? 'partitura' : 'parte';
        this.lock = arrangement ? lockService.forArrangement(this.data.trackId) : lockService.forPart(this.data.trackId, this.data.scoreId);
        this.transposeScopes = [
            { label: 'Selezione', value: 'passage' },
            { label: arrangement ? 'Tutto il rigo' : 'Tutta la parte', value: 'part' }
        ];
        for (const row of arrangement?.rows ?? []) for (const instrument of row.instruments) this.instruments.set(instrument.id, instrument);
        this.sound = this.data.sound;
        this.range = this.data.range ?? null;
        this.applySound();
        this.showPiano = this.writingMode && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    }

    async ngOnInit(): Promise<void> {
        const { trackId, scoreId, versionId } = this.data;
        const arrangement = this.data.arrangement;
        try {
            const [editor, reports, , versionXml] = await Promise.all([
                arrangement || versionId === null ? Promise.resolve(undefined) : firstValueFrom(this.playbackService.editor(trackId, scoreId, versionId)),
                arrangement ? Promise.resolve([] as ErrorReport[]) : firstValueFrom(this.playbackService.errorReports(trackId)).catch(() => [] as ErrorReport[]),
                // Senza il blocco l'editor si apre in sola lettura: lo stato del blocco dice perché.
                this.lock.acquire(),
                arrangement?.version ? this.arrangementService.content(trackId, arrangement.version.id) : Promise.resolve(null),
                arrangement ? this.loadCatalog() : Promise.resolve()
            ]);
            this.editor = editor;
            this.versionXml = versionXml;
            this.reports = reports.filter((report) => report.scoreId === scoreId && report.status === 'OPEN');
            if (this.writingMode) this.midiSubscription = this.midi.played.subscribe((note) => this.onMidiNote(note));
            if (this.writingMode) await this.prepareWriting();
            else if (editor) {
                await this.open(editor.musicXml);
                const measureIndex = this.data.measureIndex;
                if (measureIndex !== null && measureIndex !== undefined && measureIndex < (this.score?.measures().length ?? 0)) this.selectMeasure(measureIndex);
            } else throw new EditError('Scegli una versione da correggere');
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
        this.closePager();
        this.layoutClient?.terminate();
        this.history.dispose();
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

    /** Si impagina la versione aperta, quando la scrittura parte da essa e non ha modifiche. */
    protected get canEngrave(): boolean {
        return this.writingMode && !this.data.arrangement && this.status === 'ready' && this.source === 'version' && !this.dirty && !this.saving && this.baseVersionId !== null;
    }

    protected get engraveHint(): string {
        if (this.canEngrave) return 'Impagina la versione in pagine e PDF, per anteprima, presentazione e stampa';
        return this.baseVersionId === null || this.source !== 'version' || this.dirty ? 'Salva la versione prima di impaginarla' : '';
    }

    /** Chiude l'editor per impaginare la versione aperta; la bozza, se è cambiata, si salva prima. */
    protected async engrave(): Promise<void> {
        const versionId = this.baseVersionId;
        if (!this.canEngrave || versionId === null) return;
        if (this.keeper?.dirty) await this.keeper.flush();
        this.dialogRef.close({ engraveVersionId: versionId } satisfies ScoreEditorEngraveRequest);
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
        const version = this.baseVersion;
        const current = version?.current ? version.id : null;
        if (this.source === 'version' || this.source === 'new' || this.baseVersionId === current) return null;
        return `Dopo l'inizio della scrittura è stata salvata un'altra versione della ${this.subject}: salvando, la bozza la sostituirà.`;
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
        const row = this.data.arrangement ? `${this.rowViews.find((view) => view.active)?.name ?? 'Rigo'} · ` : '';
        if (this.passage) return `${row}${this.passageText}`;
        if (this.measure?.empty) return `${row}Battuta ${this.measure.number} · vuota`;
        if (!this.note || !this.measure) return 'Seleziona una nota sullo spartito';
        return `${row}Battuta ${this.measure.number} · ${edits.noteLabel(this.note)}`;
    }

    /** Partitura: tonalità in suoni reali del rigo attivo nella battuta selezionata; `null` per le percussioni. */
    protected get concertKey(): number | null {
        const score = this.score;
        if (!score || !this.measure) return null;
        const instruments = this.rowInstruments(score.partIndex);
        if (arrangements.isPercussionRow(instruments)) return null;
        if (arrangements.isConcertScore(score)) return this.measure.fifths;
        const transposition = arrangements.rowTransposition(instruments, score.stateAt(this.measure.index).clef.sign);
        return concertFifths(this.measure.fifths, transposition ?? 0);
    }

    /** Partitura: battute delle operazioni su tutti i righi, «battute 3–5». */
    protected get rowsRangeLabel(): string {
        const range = this.listenRange;
        if (!range) return 'seleziona una battuta';
        const [first, last] = this.measureNumbers(range);
        return first === last ? `battuta ${first}` : `battute ${first}–${last}`;
    }

    /** Partitura: si toglie un rigo quando ne resta almeno un altro. */
    protected get canRemoveRow(): boolean {
        return !this.readOnly && this.rowViews.length > 1;
    }

    /** Partitura: scritta in suoni reali. */
    protected get concertPitch(): boolean {
        return !!this.score && arrangements.isConcertScore(this.score);
    }

    /** Partitura: righi con battute di durata diversa dal metro, vuote o con note fuori estensione. */
    protected get rowIssues(): arrangements.RowCheck[] {
        return this.rowCheckList.filter((check) => check.wrongDuration.length || check.empty.length || check.outOfRange.length);
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
        else if (this.data.arrangement && event.altKey && !command && (key === 'ArrowUp' || key === 'ArrowDown')) this.moveRow(key === 'ArrowUp' ? -1 : 1);
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
        const score = this.score;
        if (!score) return;
        let target = event.target as Element | null;
        let noteId: string | null = null;
        let noteRow: number | null = null;
        let measureIndex: number | null = null;
        while (target && target !== this.notationHost) {
            const id = target.getAttribute('id');
            const found = id && target.tagName.toLowerCase() === 'g' ? this.findDrawn(id) : null;
            if (found?.tagName === 'note' && !noteId) {
                noteId = id;
                noteRow = score.partIndexOf(found);
            }
            if (found?.tagName === 'measure') {
                measureIndex = arrangements.measurePosition(found);
                break;
            }
            target = target.parentElement;
        }
        if (measureIndex === null) {
            // Gli spazi vuoti tra le note non appartengono ad alcun elemento disegnato: vale la battuta che contiene il punto.
            target = this.measureAt(event.clientX, event.clientY);
            const found = target ? this.findDrawn(target.getAttribute('id') ?? '') : null;
            measureIndex = found?.tagName === 'measure' ? arrangements.measurePosition(found) : null;
        }
        if (measureIndex === null || !target) return;
        // Nella partitura il clic sceglie il rigo della nota, o del pentagramma più vicino; con Maiusc il rigo non cambia.
        let area: Element = target;
        let otherRow = false;
        if (this.data.arrangement) {
            const staff = noteRow === null ? this.staffAt(target, event.clientY) : null;
            if (staff) area = staff.element;
            const row = noteRow ?? staff?.row ?? score.partIndex;
            otherRow = row >= 0 && row !== score.partIndex;
            if (otherRow && !event.shiftKey) {
                this.switchRow(row);
                otherRow = false;
            }
        }
        // Le teste delle note sono piccole: un clic accanto a una nota sceglie la nota più vicina della battuta.
        const id = otherRow ? null : (noteId ?? this.nearestNote(area, event.clientX, event.clientY) ?? edits.firstNoteOf(score, measureIndex));
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
        if (this.inserting) this.cursor = id ? writing.cursorAt(score, id) : writing.clampCursor(score, { ...this.cursor, measureIndex, offset: fraction(0) });
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

    /** Seleziona la prima nota fuori estensione della battuta. */
    protected selectOutOfRange(warning: RangeWarning): void {
        if (!this.score?.find(warning.noteId)) return;
        this.rangeEnd = null;
        this.select(warning.noteId);
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
        this.structureChange((score, index) => {
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
        this.structureChange((score, index) => edits.firstNoteOf(score, edits.insertMeasure(score, index, where)));
    }

    protected deleteMeasure(): void {
        this.structureChange((score, index) => {
            edits.deleteMeasure(score, index);
            return edits.firstNoteOf(score, Math.min(index, score.measures().length - 1));
        });
    }

    /** Aggiunge il numero di battute indicato dopo quella selezionata, ognuna con una pausa di battuta. */
    protected addMeasures(): void {
        this.structureChange((score, index) => edits.firstNoteOf(score, edits.insertMeasures(score, index, this.measureCount)));
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
        this.structureChange((score, index) => edits.toggleRepeat(score, index, direction));
    }

    protected applyEnding(value: string | null): void {
        this.structureChange((score, index) => edits.setEnding(score, index, value));
    }

    protected mark(value: edits.StructureMark): void {
        this.structureChange((score, index) => edits.toggleMark(score, index, value));
    }

    /** Indicazione di tempo della battuta, con il testo scritto; `null` la toglie. */
    protected applyTempo(value: number | null): void {
        const words = value === null ? null : this.tempoText;
        this.structureChange((score, index) => edits.setTempo(score, index, value, words));
    }

    protected applyRehearsal(value: string | null): void {
        this.structureChange((score, index) => notation.setRehearsal(score, index, value));
    }

    /** Lettera di prova con il numero della battuta, come numero di riferimento. */
    protected rehearsalNumber(): void {
        this.structureChange((score, index) => notation.setRehearsal(score, index, score.measure(index).getAttribute('number') || String(index + 1)));
    }

    protected applyBreak(kind: notation.BreakKind | null): void {
        this.structureChange((score, index) => notation.setBreak(score, index, kind));
    }

    /** Interruzioni di riga ogni tante battute in tutta la parte; `null` le toglie. */
    protected applyBreaksEvery(count: number | null): void {
        const applied = this.apply((score) => (this.data.arrangement ? arrangements.onEveryRow(score, () => notation.setBreaksEvery(score, count)) : notation.setBreaksEvery(score, count)));
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
            const sound = partSound(this.sound, clef);
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
                await this.forgetLocalCopy();
                this.localCopy = null;
            } else {
                if (this.data.arrangement) await this.arrangementService.discardDraft(trackId, this.lock.session);
                else await this.draftService.discard(trackId, scoreId, this.lock.session);
                this.serverDraft = null;
                this.serverRows = null;
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
            const arrangementDraft = this.data.arrangement ? await this.arrangementService.draft(this.data.trackId) : null;
            const draft = this.data.arrangement ? arrangementDraft : await this.draftService.draft(this.data.trackId, this.data.scoreId);
            if (!draft) {
                this.message = 'La bozza non c’è più: è stata salvata o scartata altrove. Le tue modifiche diventano la nuova bozza.';
                await keeper.overwrite();
            } else {
                await keeper.reset(draft);
                this.serverDraft = draft;
                this.serverRows = arrangementDraft ? this.rememberRows(arrangementDraft.rows) : null;
                this.source = 'draft';
                this.baseVersionId = draft.baseVersionId;
                await this.open(draft.content, this.serverRows);
            }
        } catch (error) {
            this.failed(error);
        }
        this.changeDetector.markForCheck();
    }

    // Cronologia

    protected undo(): void {
        if (!this.score || this.readOnly) return;
        const previous = this.history.undo(this.score);
        if (previous) this.restored(previous);
    }

    protected redo(): void {
        if (!this.score || this.readOnly) return;
        const next = this.history.redo(this.score);
        if (next) this.restored(next);
    }

    // Righi della partitura

    /** Rende attivo il rigo, sulla stessa battuta; un rigo nascosto torna visibile. */
    protected selectRow(index: number): void {
        const score = this.score;
        if (!score || !this.rowViews[index]) return;
        const measureIndex = this.inserting ? this.cursor.measureIndex : (this.measure?.index ?? 0);
        this.activateRow(index);
        const at = Math.min(measureIndex, score.measures().length - 1);
        if (this.inserting) this.cursor = writing.clampCursor(score, { ...this.cursor, measureIndex: at });
        const id = (this.inserting ? writing.noteAtCursor(score, this.cursor) : null) ?? edits.firstNoteOf(score, at);
        if (id) this.select(id);
        else this.selectEmptyMeasure(at);
    }

    /** Controlli della partitura: rende attivo il rigo e seleziona la battuta. */
    protected showRowMeasure(row: number, measureIndex: number): void {
        this.activateRow(row);
        this.selectMeasure(measureIndex);
    }

    /** Controlli della partitura: rende attivo il rigo e seleziona la prima nota fuori estensione della battuta. */
    protected showRowNote(row: number, warning: RangeWarning): void {
        this.activateRow(row);
        this.selectOutOfRange(warning);
    }

    /** Mette in evidenza il rigo nell'ascolto, o lo toglie; vale subito anche mentre suona. */
    protected toggleHighlight(view: RowView): void {
        this.highlightedRow = this.highlightedRow === view.id ? null : view.id;
        this.rowViews = this.rowViews.map((candidate) => ({ ...candidate, highlighted: candidate.id === this.highlightedRow }));
        this.applyGains();
        this.changeDetector.markForCheck();
    }

    /**
     * Converte tutta la partitura in suoni reali o trasposta, in un solo passo di Annulla. Uno strumento senza
     * trasposizione la blocca, con il collegamento alla sua configurazione.
     */
    protected convertNotation(concertPitch: boolean): void {
        const score = this.score;
        if (!score || !this.data.arrangement || concertPitch === arrangements.isConcertScore(score)) return;
        const rows = this.editorRows(score);
        const blocked = this.readOnly ? null : arrangements.unconfiguredInstrument(score, rows);
        if (blocked) {
            this.message = `Configura la trasposizione di ${blocked.name} per convertire la partitura`;
            this.info = null;
            this.conversionBlock = { id: blocked.id, name: blocked.name };
            this.changeDetector.markForCheck();
            return;
        }
        let enharmonic: string[] = [];
        const converted = this.apply((current) => {
            enharmonic = arrangements.convertNotation(current, rows, concertPitch);
        });
        if (!converted) return;
        const notation = concertPitch ? 'Partitura in suoni reali' : 'Partitura trasposta';
        this.info = enharmonic.length ? `${notation}; ${enharmonic.join(', ')} ${enharmonic.length === 1 ? 'usa' : 'usano'} l'intervallo enarmonico: tornando indietro la grafia può cambiare` : notation;
        this.changeDetector.markForCheck();
    }

    /** Rigo visibile precedente o seguente (Alt+↑ ↓). */
    protected moveRow(delta: 1 | -1): void {
        if (!this.score) return;
        let index = this.score.partIndex + delta;
        while (this.rowViews[index]?.hidden) index += delta;
        if (this.rowViews[index]) this.selectRow(index);
    }

    /** Nasconde o mostra il rigo nel disegno; nascondendo il rigo attivo diventa attivo il primo visibile. */
    protected toggleRow(view: RowView): void {
        if (!this.score) return;
        if (!view.hidden && this.rowViews.filter((candidate) => !candidate.hidden).length <= 1) {
            this.message = 'Almeno un rigo resta visibile';
            this.changeDetector.markForCheck();
            return;
        }
        if (view.hidden) this.hiddenRows.delete(view.id);
        else this.hiddenRows.add(view.id);
        this.refreshRows();
        if (view.active && !view.hidden) {
            const visible = this.rowViews.find((candidate) => !candidate.hidden);
            if (visible) this.selectRow(visible.index);
        }
        this.scheduleRender();
        this.changeDetector.markForCheck();
    }

    protected showAllRows(): void {
        this.hiddenRows.clear();
        this.refreshRows();
        this.scheduleRender();
        this.changeDetector.markForCheck();
    }

    protected toggleCondense(): void {
        this.condense = !this.condense;
        this.scheduleRender();
        this.changeDetector.markForCheck();
    }

    /** Aggiunge sotto il rigo attivo un rigo di pause per lo strumento scelto, con l'armatura trasposta per lui. */
    protected addRowBelow(): void {
        const score = this.score;
        const instrument = this.newRowInstrumentId === null ? undefined : this.instruments.get(this.newRowInstrumentId);
        if (!score || !instrument) return;
        const concertPitch = arrangements.isConcertScore(score);
        // Struttura e armatura del rigo nuovo vengono dal primo rigo intonato.
        const reference = Math.max(
            0,
            this.rowViews.findIndex((view) => !arrangements.isPercussionRow(this.rowInstruments(view.index)))
        );
        const referenceTransposition = arrangements.rowTransposition(this.rowInstruments(reference), arrangements.rowClefSign(score, reference)) ?? 0;
        const clef = proposedClef([instrument]);
        const percussion = arrangements.isPercussionRow([instrument]);
        const transposition = arrangements.rowTransposition([instrument], clef === 'F4' ? 'F' : 'G') ?? 0;
        const fifths = (referenceFifths: number): number => {
            if (percussion) return 0;
            if (concertPitch) return referenceFifths;
            return writtenFifths(concertFifths(referenceFifths, referenceTransposition), transposition);
        };
        const measureIndex = this.measure?.index ?? 0;
        const position = score.partIndex + 1;
        const added = this.apply((current) => {
            arrangements.addRow(current, { name: instrument.name, instrumentIds: [instrument.id], clef, fifths }, position, reference);
            return edits.firstNoteOf(current, Math.min(measureIndex, current.measures().length - 1));
        });
        if (added) {
            this.newRowInstrumentId = null;
            this.info = `Rigo aggiunto: ${instrument.name}`;
            this.changeDetector.markForCheck();
        }
    }

    /** Toglie il rigo attivo, dopo una conferma: l'operazione si annulla con «Annulla». */
    protected removeActiveRow(): void {
        const score = this.score;
        if (!score || !this.canRemoveRow) return;
        const index = score.partIndex;
        const name = this.rowViews[index]?.name ?? 'attivo';
        const measureIndex = this.measure?.index ?? 0;
        this.confirmService.confirmReversible({
            title: 'Togliere il rigo?',
            consequence: `Il rigo ${name} esce dalla partitura con le sue note. Potrai annullare l’operazione prima del salvataggio.`,
            actionLabel: 'Togli il rigo',
            key: 'score-editor-discard',
            accept: () =>
                void this.apply((current) => {
                    arrangements.removeRow(current, index);
                    return edits.firstNoteOf(current, Math.min(measureIndex, current.measures().length - 1));
                })
        });
    }

    /** Copia le battute selezionate di tutti i righi. Vale anche in sola lettura. */
    protected copyAllRows(): void {
        const score = this.score;
        const range = this.listenRange;
        if (!score || !range) return;
        try {
            this.rowsClip = arrangements.copyRows(score, range[0], range[1]);
            this.message = null;
            this.info = `Copiato: ${this.rowsClip.label}`;
        } catch (error) {
            this.message = error instanceof EditError ? error.message : 'Copia non riuscita';
        }
        this.changeDetector.markForCheck();
    }

    /** Incolla le battute copiate da tutti i righi dalla battuta selezionata, al posto di ciò che c'è. */
    protected pasteAllRows(): void {
        const clip = this.rowsClip;
        const index = this.listenRange?.[0];
        if (!clip || index === undefined) return;
        this.apply((score) => {
            arrangements.pasteRows(score, clip, index);
            return edits.firstNoteOf(score, index);
        });
    }

    /** Le battute selezionate di tutti i righi tornano pause di battuta. */
    protected clearAllRows(): void {
        const range = this.listenRange;
        if (!range) return;
        this.apply((score) => {
            arrangements.clearRows(score, range[0], range[1]);
            return edits.firstNoteOf(score, range[0]);
        });
    }

    /** Tonalità in suoni reali di tutti i righi dalla battuta selezionata: ogni rigo trasposto scrive la sua armatura. */
    protected applyConcertKey(fifths: number | null): void {
        if (fifths === null) return;
        this.measureChange((score, index) => arrangements.setConcertKey(score, index, fifths, this.editorRows(score), arrangements.isConcertScore(score)));
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
            const [from, to] = this.listenRange ?? [this.measure.index, this.measure.index];
            // Nella partitura suonano tutti i righi, ognuno con il suono del suo strumento.
            let inputs: PlaybackPartInput[];
            if (this.data.arrangement) {
                inputs = arrangements.playbackRows(this.score, this.editorRows(this.score), from, to);
            } else {
                const part = parseMusicXml(this.score.cleanXml());
                inputs = [{ key: 'part', name: this.data.partLabel, part: excerpt(part, from, to), sound: partSound(this.sound, part.clefSign) }];
            }
            const built = buildPlayback(inputs, inputs[0].part, { withRepeats: false, tempoBpm: null, countIn: false });
            await this.audio.ready();
            await this.audio.load(built.midi);
            this.audio.setChannel(built.metronome, 0, true);
            this.playback = built;
            this.applyGains();
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
            let version: ScoreVersion | ArrangementVersion | null;
            if (this.data.arrangement) {
                version = await this.submitArrangement({
                    editSession: this.lock.session,
                    content: score.cleanXml(),
                    rows: arrangements.rowRequests(score),
                    parentVersionId: this.baseVersionId,
                    approve,
                    confirmOutdated: false
                });
            } else {
                const correction: ScoreCorrection = this.writingMode
                    ? { parentVersionId: this.baseVersionId, content: score.cleanXml(), approve, origin: 'WRITING', editSession: this.lock.session }
                    : { parentVersionId: this.editor!.version.id, content: score.cleanXml(), approve, measureSources: score.measureSources(), origin: 'CORRECTION', editSession: this.lock.session };
                version = await this.submit(correction);
            }
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

    /** Apre il contenuto nell'editor e lo disegna; nella partitura segna sui righi i loro strumenti. */
    private async open(xml: string, rows: readonly RowAssignment[] | null = null): Promise<void> {
        this.score = edits.openScore(xml);
        if (this.data.arrangement) arrangements.annotateRows(this.score, rows ?? []);
        this.initialSnapshot = this.score.snapshot();
        // La partitura registra le battute cambiate, una parte le istantanee del documento.
        this.history.dispose();
        this.history = this.data.arrangement ? new MeasureHistory(this.score) : new SnapshotHistory();
        this.measureCache = {};
        // Il disegno per pagine riparte dal nuovo documento.
        this.closePager();
        this.dirty = false;
        this.checks = this.score.checks();
        this.refreshRows();
        this.refreshRowChecks();
        this.checkRange(this.score);
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
        const fallback = this.writingMode ? `Impossibile aprire la ${this.subject} nell'editor: riprovare più tardi` : "Impossibile aprire la versione nell'editor: riprovare più tardi";
        this.errorMessage = error instanceof EditError ? error.message : fallback;
    }

    /** Scrittura: sceglie da dove partire tra copia nel browser, bozza, versione e parte nuova. */
    private async prepareWriting(): Promise<void> {
        const { trackId, scoreId } = this.data;
        const arrangement = !!this.data.arrangement;
        const [draft, local] = await Promise.all([
            arrangement ? this.arrangementService.draft(trackId) : this.draftService.draft(trackId, scoreId),
            this.lock.held ? (arrangement ? this.draftService.arrangementLocalCopy(trackId) : this.draftService.localCopy(trackId, scoreId)) : Promise.resolve(null)
        ]);
        this.serverDraft = draft;
        this.serverRows = arrangement && draft ? this.rememberRows((draft as ArrangementDraft).rows ?? []) : null;
        this.localCopy = local;
        if (!this.lock.held) {
            // In sola lettura si vede ciò che sta scrivendo chi ha il blocco, se c'è, altrimenti la versione.
            const content = draft?.content ?? this.baseXml;
            if (!content) throw new EditError(`La ${this.subject} non ha ancora note scritte da mostrare`);
            this.source = draft ? 'draft' : 'version';
            await this.open(content, draft ? this.serverRows : this.versionRows);
            return;
        }
        if (local && draft && local.content === draft.content) {
            // Il server ha già le modifiche della copia.
            await this.forgetLocalCopy();
            this.localCopy = null;
        }
        await this.decide();
    }

    /** Prima la copia nel browser, poi la bozza; senza nulla da riprendere la versione o la parte nuova. */
    private async decide(): Promise<void> {
        const local = this.localCopy;
        const draft = this.serverDraft;
        const version = this.baseVersion;
        if (local) return this.propose(localChoice(local, draft, version, this.subject));
        if (draft && version && !this.data.resume) return this.propose(draftChoice(draft, version, this.subject));
        if (draft) return this.startWriting('draft');
        if (version) return this.startWriting('version');
        if (this.data.initialContent) return this.startWriting('new');
        throw new EditError(`La ${this.subject} non ha versioni né una bozza da scrivere`);
    }

    private propose(choice: ResumeChoice): void {
        this.choice = choice;
        this.status = 'choosing';
        this.changeDetector.markForCheck();
    }

    private async startWriting(source: WritingSource): Promise<void> {
        const draft = this.serverDraft;
        const local = this.localCopy;
        const content = source === 'local' ? local!.content : source === 'draft' ? draft!.content : source === 'new' ? this.data.initialContent! : this.baseXml!;
        const rows = source === 'local' ? (local!.rows ?? this.versionRows) : source === 'draft' ? this.serverRows : this.versionRows;
        this.source = source;
        this.baseVersionId = source === 'local' ? local!.baseVersionId : source === 'draft' ? draft!.baseVersionId : (this.baseVersion?.id ?? null);
        this.keeper?.stop();
        const options = {
            lock: this.lock,
            content: () => this.score?.cleanXml() ?? content,
            baseVersionId: this.baseVersionId,
            entityVersion: draft?.entityVersion ?? null,
            savedAt: source === 'draft' ? draft!.savedAt : null
        };
        this.keeper = this.data.arrangement
            ? this.draftService.arrangementKeeper(this.data.trackId, { ...options, rows: () => (this.score ? arrangements.rowRequests(this.score) : (rows ?? [])) })
            : this.draftService.keeper(this.data.trackId, this.data.scoreId, options);
        await this.open(content, rows);
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

    /** Invia la versione della partitura; chiede conferma se nel frattempo ne è stata salvata un'altra. `null` se non salvata. */
    private async submitArrangement(request: ArrangementVersionRequest): Promise<ArrangementVersion | null> {
        try {
            return await this.arrangementService.save(this.data.trackId, request, withHandledErrors([OUTDATED], withErrorSummary('Versione non salvata')));
        } catch (error) {
            if (!request.confirmOutdated && error instanceof HttpErrorResponse && this.apiErrors.resolve(error).key === OUTDATED) {
                const confirmed = await this.ask({
                    title: 'Sostituire la versione salvata?',
                    consequence: "Dopo l'inizio della scrittura è stata salvata un'altra versione della partitura: la versione scritta diventerà quella corrente al suo posto.",
                    actionLabel: 'Salva comunque'
                });
                return confirmed ? this.submitArrangement({ ...request, confirmOutdated: true }) : null;
            }
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
    private placeCursor(drawnMeasures = this.drawnMeasures()): void {
        const host = this.notationHost;
        const pane = host?.parentElement;
        const score = this.score;
        if (!this.inserting || !score || !host || !pane) {
            this.cursorBox = null;
            return;
        }
        // Nel disegno per pagine la pagina del cursore può non essere ancora disegnata: il cursore torna quando compare.
        this.pager?.ensure(this.cursor.measureIndex);
        const measures = score.measures();
        const drawnMeasure = drawnMeasures(this.cursor.measureIndex);
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
        // Nella partitura il cursore sta sul pentagramma del rigo attivo.
        const staffBox = (this.activeStaff(drawnMeasure) ?? drawnMeasure).getBoundingClientRect();
        const x = drawnNote ? drawnNote.getBoundingClientRect().left - 4 : measureBox.right - 6;
        this.cursorBox = { left: x - paneBox.left + pane.scrollLeft, top: staffBox.top - paneBox.top + pane.scrollTop, height: staffBox.height };
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

    /** Modifica della struttura della battuta selezionata: nella partitura vale per tutti i righi. */
    private structureChange(change: (score: ScoreDocument, index: number) => string | null | void): void {
        if (!this.data.arrangement) {
            this.measureChange(change);
            return;
        }
        this.measureChange((score, index) => arrangements.onEveryRow(score, () => change(score, index)));
    }

    /** Partitura: rende attivo il rigo, mostrandolo se è nascosto. */
    private activateRow(index: number): void {
        const score = this.score;
        const view = this.rowViews[index];
        if (!score || !view) return;
        if (view.hidden) {
            this.hiddenRows.delete(view.id);
            this.scheduleRender();
        }
        if (index !== score.partIndex) this.switchRow(index);
    }

    /** Partitura: il rigo in evidenza suona a volume pieno e gli altri più piano; senza rigo in evidenza, tutti uguali. */
    private applyGains(): void {
        const built = this.playback;
        if (!built || !this.data.arrangement) return;
        for (const channel of built.channels) this.audio.setChannel(channel, this.highlightedRow === null || channel.key === this.highlightedRow ? 1 : BACKGROUND_GAIN, false);
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
        this.conversionBlock = null;
        // Il documento di prima si ricompone solo se la modifica non riesce.
        const before = this.history.checkpoint(this.score);
        let applied = false;
        let changed: DocumentChange | null = null;
        try {
            const selected = change(this.score);
            // Nella scrittura legature di portamento e forcelle hanno sempre inizio e fine: gli estremi rimasti soli si tolgono.
            if (this.writingMode) notation.balanceSpanners(this.score);
            this.history.record(this.score, before, !!options.merge);
            changed = this.history.lastChange;
            this.noteDrawChange(changed);
            if (typeof selected === 'string') {
                this.selectedId = selected;
                this.emptyMeasureId = null;
            }
            this.message = null;
            this.keeper?.changed();
            applied = true;
        } catch (error) {
            // Il documento torna com'era, e com'è disegnato.
            this.score = ScoreDocument.restore(before(), this.score.prefix, this.score.partIndex);
            this.message = error instanceof EditError ? error.message : 'Modifica non riuscita';
            if (!(error instanceof EditError)) console.error(error);
        }
        this.afterChange(changed);
        return applied;
    }

    /** Il documento dopo «Annulla» o «Ripristina». */
    private restored(score: ScoreDocument): void {
        this.played = null;
        this.stop();
        this.score = score;
        this.message = null;
        this.keeper?.changed();
        this.noteDrawChange(this.history.lastChange);
        this.afterChange(this.history.lastChange);
    }

    /** Battute da ridisegnare nel disegno per pagine; con `null` tutte. */
    private noteDrawChange(change: DocumentChange | null): void {
        if (!change) this.drawChange = null;
        else if (this.drawChange) for (const id of change.measures) this.drawChange.add(id);
    }

    /** Note fuori estensione; l'estensione dipende dalla chiave iniziale, che si può cambiare, e si ricalcola a ogni modifica. */
    private checkRange(score: ScoreDocument): void {
        const range = this.range ? writtenRange(this.range.instrument, score.stateAt(0).clef.sign) : null;
        this.rangeText = range ? rangeLabel(range) : null;
        this.rangeWarnings = rangeWarnings(score, range);
    }

    /** Aggiorna controlli, selezione e disegno dopo una modifica; `change` dice quali righi sono cambiati, se si sa. */
    private afterChange(change: DocumentChange | null = null): void {
        const score = this.score!;
        this.measureCache = {};
        // La partitura confronta le battute registrate con quelle di apertura; la parte confronta le istantanee.
        this.dirty = this.history.modified(score) ?? score.snapshot() !== this.initialSnapshot;
        this.checks = score.checks();
        this.refreshRows();
        this.refreshRowChecks(change);
        this.checkRange(score);
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
        const score = this.score;
        if (!score || !host) return;
        const token = ++this.renderToken;
        if (score.measures().length * this.shownRowCount(score) > PAGED_MEASURES) {
            await this.renderPages(score, host, token);
            return;
        }
        this.closePager();
        const scrollTop = host.parentElement?.scrollTop ?? 0;
        this.rendering = true;
        this.changeDetector.markForCheck();
        try {
            const pages = await this.renderer.renderPrepared(drawingXml(score, this.drawingSource()), host.clientWidth || 900, EDITOR_SCALE, this.drawingFlags());
            if (token !== this.renderToken) return;
            // L'SVG è generato da Verovio a partire dal MusicXML: i testi sono codificati e non contiene script.
            host.innerHTML = pages.join('');
            if (host.parentElement) host.parentElement.scrollTop = scrollTop;
            this.decorate(true);
        } catch {
            if (token === this.renderToken) this.message = DRAWING_ERROR;
        } finally {
            if (token === this.renderToken) {
                this.rendering = false;
                this.changeDetector.markForCheck();
            }
        }
    }

    /**
     * Disegno per pagine: la pagina della battuta selezionata si ridisegna subito con un estratto, le altre pagine cambiate
     * quando si avvicinano alla vista, e il Web Worker impagina di nuovo tutto lo spartito poco dopo l'ultima modifica.
     */
    private async renderPages(score: ScoreDocument, host: HTMLElement, token: number): Promise<void> {
        const key = this.drawingKey(host.clientWidth || 900);
        const created = !this.pager;
        if (!this.pager) {
            host.replaceChildren();
            this.pager = new PagedNotation(host, { draw: (from, to) => this.drawExcerpt(from, to), positions: () => this.measurePositions(), drawn: () => this.pageDrawn() });
            // Prima dell'impaginazione completa le pagine sono gruppi di battute, all'incirca un sistema della partitura.
            this.pager.provisional(score.measures().length, Math.max(4, Math.round(40 / this.shownRowCount(score))), this.pageHeight(host));
        } else {
            this.pager.invalidate(key === this.pagerKey ? this.drawChange : null);
        }
        const restart = created || key !== this.pagerKey;
        this.pagerKey = key;
        this.drawChange = new Set();
        this.requestLayout(restart);
        if (created) {
            this.rendering = true;
            this.changeDetector.markForCheck();
        }
        try {
            await this.pager.refresh(this.inserting ? this.cursor.measureIndex : (this.measure?.index ?? 0));
            if (token === this.renderToken) this.decorate(true);
        } finally {
            if (created) {
                this.rendering = false;
                this.changeDetector.markForCheck();
            }
        }
    }

    /** Estratto di una pagina, disegnato subito nel thread principale. */
    private async drawExcerpt(from: number, to: number): Promise<string[]> {
        const score = this.score;
        const host = this.notationHost;
        if (!score || !host) return [];
        try {
            return await this.renderer.renderPrepared(drawingExcerpt(score, from, to, this.drawingSource()), host.clientWidth || 900, EDITOR_SCALE, this.drawingFlags());
        } catch (error) {
            this.message = DRAWING_ERROR;
            this.changeDetector.markForCheck();
            throw error;
        }
    }

    /** Una pagina è comparsa: tornano selezione, evidenziazioni e cursore, e lo scorrimento rimasto in attesa. */
    private pageDrawn(): void {
        const scroll = this.scrollPending;
        this.scrollPending = false;
        this.decorate(scroll);
    }

    /** Impagina di nuovo tutto lo spartito nel Web Worker: subito, o dopo l'ultima di una serie di modifiche. */
    private requestLayout(immediate: boolean): void {
        if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
        const revision = ++this.layoutRevision;
        this.layoutTimer = window.setTimeout(
            () => {
                this.layoutTimer = undefined;
                void this.layoutAll(revision);
            },
            immediate ? 0 : LAYOUT_DELAY
        );
    }

    /** L'impaginazione completa vale solo se nel frattempo non sono cambiati il documento e il modo di disegnarlo. */
    private async layoutAll(revision: number): Promise<void> {
        const score = this.score;
        const host = this.notationHost;
        const pager = this.pager;
        if (!score || !host || !pager || revision !== this.layoutRevision) return;
        const width = host.clientWidth || 900;
        const key = this.drawingKey(width);
        const options = drawingOptions(width, EDITOR_SCALE, { ...this.drawingFlags(), pageHeight: this.pageHeight(host) });
        this.layoutClient ??= this.renderer.layoutWorker();
        try {
            const pages = await this.layoutClient.layout(options, drawingXml(score, this.drawingSource()));
            if (!pages || revision !== this.layoutRevision || pager !== this.pager || key !== this.pagerKey) return;
            pager.layout(pages);
            this.decorate(false);
        } catch {
            // Senza l'impaginazione completa restano le pagine disegnate con gli estratti.
        }
    }

    private closePager(): void {
        if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
        this.layoutTimer = undefined;
        this.layoutRevision++;
        this.pager?.destroy();
        this.pager = null;
        this.pagerKey = '';
        this.drawChange = null;
        this.scrollPending = false;
    }

    /** La partitura senza i righi nascosti e con i nomi; la scrittura con le interruzioni di riga e di pagina della parte. */
    private drawingSource(): DrawingSource {
        const arrangement = !!this.data.arrangement;
        return { hidden: arrangement ? this.hiddenRows : undefined, partNames: arrangement, pageBreaksAsSystems: this.writingMode };
    }

    private drawingFlags(): DrawingOptions {
        const arrangement = !!this.data.arrangement;
        return { encodedBreaks: this.writingMode, condense: arrangement && this.condense, partNames: arrangement };
    }

    private drawingKey(width: number): string {
        return [width, [...this.hiddenRows].sort().join(','), this.condense, this.writingMode].join('|');
    }

    /** Righi disegnati: tutti se sono tutti nascosti. */
    private shownRowCount(score: ScoreDocument): number {
        const parts = score.parts();
        return parts.filter((part) => !this.hiddenRows.has(part.getAttribute('id') ?? '')).length || parts.length;
    }

    /** Una pagina è alta quanto la parte visibile dello spartito, che sul telefono scorre con la finestra. */
    private pageHeight(host: HTMLElement): number {
        return Math.max(MIN_PAGE_HEIGHT, Math.min(host.parentElement?.clientHeight ?? 0, window.innerHeight));
    }

    private measurePositions(): Map<string, number> {
        if (!this.score) return new Map();
        return (this.measureCache.positions ??= measurePositions(this.score));
    }

    /** Le pagine della selezione e del cursore sono disegnate; `false` se una si sta ancora disegnando. */
    private selectionDrawn(): boolean {
        const pager = this.pager;
        if (!pager) return true;
        const measure = this.measure ? pager.ensure(this.measure.index) : true;
        const cursor = this.inserting ? pager.ensure(this.cursor.measureIndex) : true;
        return measure && cursor;
    }

    /**
     * Evidenzia sullo spartito la nota selezionata, la sua battuta, il passaggio o l'intervallo da ascoltare e le battute da
     * verificare.
     */
    private decorate(scroll: boolean): void {
        const host = this.notationHost;
        if (!this.score || !host) return;
        // Nel disegno per pagine la selezione può stare in una pagina non ancora disegnata: si scorre quando compare.
        if (scroll && !this.selectionDrawn()) this.scrollPending = true;
        for (const className of ['is-selected', 'is-current-measure', 'is-in-range', 'is-in-passage', 'is-wrong']) {
            for (const item of Array.from(host.querySelectorAll(`.${className}`))) item.classList.remove(className);
        }
        const drawnMeasure = this.drawnMeasures();
        for (const index of this.checks.wrongDuration) drawnMeasure(index)?.classList.add('is-wrong');
        const range = this.listenRange;
        if (this.measure && range) {
            for (let index = range[0]; index <= range[1]; index++) drawnMeasure(index)?.classList.add(index === this.measure.index ? 'is-current-measure' : 'is-in-range');
        }
        if (this.passage) {
            for (const note of passages.passageNotes(this.score, this.passage)) host.querySelector(`[id="${note.getAttribute('id')}"]`)?.classList.add('is-in-passage');
        }
        const selected = this.selectedId ? host.querySelector(`[id="${this.selectedId}"]`) : null;
        selected?.classList.add('is-selected');
        if (scroll) (selected ?? (this.measure ? drawnMeasure(this.measure.index) : null))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        this.placeCursor(drawnMeasure);
    }

    /**
     * Battute disegnate per posizione. Nella partitura Verovio disegna una battuta per tutti i righi, con l'`id` di uno di
     * loro; le battute di una pausa di più battute usano quella che apre il gruppo.
     */
    private drawnMeasures(): (index: number) => Element | null {
        const host = this.notationHost;
        const score = this.score;
        if (!host || !score) return () => null;
        const drawn = new Map<string, Element>();
        for (const item of Array.from(host.querySelectorAll('g.measure'))) {
            const id = item.getAttribute('id');
            if (id && !drawn.has(id)) drawn.set(id, item);
        }
        const lists = [score.measures(), ...score.parts().map(measuresOf)];
        const at = (index: number) => {
            for (const list of lists) {
                const found = drawn.get(list[index]?.getAttribute('id') ?? '');
                if (found) return found;
            }
            return null;
        };
        return (index) => {
            const found = at(index);
            if (found) return found;
            const start = (this.measureCache.restStarts ??= multiRestStarts(score.parts().map(measuresOf)))[index];
            return start === undefined ? null : at(start);
        };
    }

    /** Partitura: pentagramma disegnato più vicino al punto, con la posizione del suo rigo. */
    private staffAt(drawnMeasure: Element, y: number): { element: Element; row: number } | null {
        const score = this.score;
        if (!score) return null;
        let best: { element: Element; distance: number } | null = null;
        for (const staff of Array.from(drawnMeasure.querySelectorAll('g.staff'))) {
            const box = staff.getBoundingClientRect();
            const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
            if (!best || distance < best.distance) best = { element: staff, distance };
        }
        if (!best) return null;
        const row = arrangements.staffRows(score, this.hiddenRows)[Number(best.element.getAttribute('data-n')) - 1];
        return row === undefined ? null : { element: best.element, row };
    }

    /** Partitura: pentagramma del rigo attivo nella battuta disegnata. */
    private activeStaff(drawnMeasure: Element): Element | null {
        const score = this.score;
        if (!score || !this.data.arrangement) return null;
        const number = arrangements.staffRows(score, this.hiddenRows).indexOf(score.partIndex) + 1;
        return number > 0 ? drawnMeasure.querySelector(`g.staff[data-n="${number}"]`) : null;
    }

    /** Elemento del documento con l'`id` di un elemento disegnato: nella partitura in qualsiasi rigo. */
    private findDrawn(id: string): Element | null {
        if (!this.score) return null;
        return this.data.arrangement ? this.score.findInScore(id) : this.score.find(id);
    }

    /** Partitura: rende attivo il rigo, con il suo suono, la sua estensione e i suoi controlli. */
    private switchRow(index: number): void {
        const score = this.score;
        if (!score) return;
        score.selectPart(index);
        this.rangeEnd = null;
        this.rangeFocusId = null;
        this.played = null;
        this.checks = score.checks();
        this.refreshRows();
        this.checkRange(score);
    }

    /** Partitura: righi del pannello, e suono ed estensione del rigo attivo. */
    private refreshRows(): void {
        const score = this.score;
        if (!this.data.arrangement || !score) return;
        const active = score.partIndex;
        const ids = new Set(score.parts().map((part) => part.getAttribute('id') ?? ''));
        for (const id of Array.from(this.hiddenRows)) if (!ids.has(id)) this.hiddenRows.delete(id);
        if (this.highlightedRow !== null && !ids.has(this.highlightedRow)) this.highlightedRow = null;
        this.rowViews = score.parts().map((part, index) => {
            const id = part.getAttribute('id') ?? '';
            return {
                index,
                id,
                name: arrangements.rowName(score, index),
                instruments: this.rowInstruments(index)
                    .map((instrument) => instrument.name)
                    .join(', '),
                hidden: this.hiddenRows.has(id),
                active: index === active,
                highlighted: id === this.highlightedRow
            };
        });
        // In suoni reali suono ed estensione seguono la notazione: della trasposizione restano le ottave.
        const concertPitch = arrangements.isConcertScore(score);
        const instruments = this.rowInstruments(active);
        this.sound = arrangements.rowSound(instruments, concertPitch);
        const pitched = arrangements.rowRangeInstrument(instruments, concertPitch);
        this.range = pitched ? { instrumentName: pitched.name, instrument: pitched } : null;
        this.applySound();
    }

    /** Partitura: controlli di tutti i righi, dopo ogni modifica; con `change` si ricontrollano solo i righi cambiati. */
    private refreshRowChecks(change: DocumentChange | null = null): void {
        const score = this.score;
        if (!this.data.arrangement || !score) return;
        this.rowCheckList = arrangements.rowChecks(score, this.editorRows(score), change ? { checks: this.rowCheckList, changed: change.rows } : undefined);
    }

    /** Voci, suoni di batteria e pulsanti a schermo dal suono della parte o del rigo attivo. */
    private applySound(): void {
        const keys = this.sound?.percussionKeys ?? [];
        this.drumKeys = [...keys];
        this.voices = writing.VOICES.map((voice) => ({ label: keys.length ? `${voice} · ${input.drumSound(input.voiceDrum(keys, voice)!).name}` : String(voice), value: voice }));
        this.drumPads = keys.slice(0, writing.VOICES.length).map((key, index) => ({ key, label: capitalized(input.drumSound(key).name), hint: `Voce ${index + 1}` }));
    }

    /** Strumenti del rigo, dai righi della partitura e dal catalogo. */
    private rowInstruments(index: number): PlaybackInstrument[] {
        if (!this.score) return [];
        return arrangements
            .rowInstrumentIds(this.score, index)
            .map((id) => this.instruments.get(id))
            .filter((instrument): instrument is PlaybackInstrument => !!instrument);
    }

    private editorRows(score: ScoreDocument): arrangements.EditorRow[] {
        return score.parts().map((part, index) => ({ id: part.getAttribute('id') ?? '', name: arrangements.rowName(score, index), instruments: this.rowInstruments(index) }));
    }

    /** Righi della bozza: gli strumenti si ricordano, le assegnazioni si segnano sul documento. */
    private rememberRows(rows: readonly ArrangementRow[]): RowAssignment[] {
        for (const row of rows) for (const instrument of row.instruments) this.instruments.set(instrument.id, instrument);
        return assignments(rows);
    }

    /** Righi della versione corrente della partitura. */
    private get versionRows(): RowAssignment[] | null {
        return this.data.arrangement ? assignments(this.data.arrangement.rows) : null;
    }

    /** MusicXML della versione da cui parte la scrittura. */
    private get baseXml(): string | undefined {
        return this.editor?.musicXml ?? this.versionXml ?? undefined;
    }

    /** Versione da cui parte la scrittura, della parte o della partitura. */
    private get baseVersion(): BaseVersion | null {
        return this.editor?.version ?? this.data.arrangement?.version ?? null;
    }

    private forgetLocalCopy(): Promise<void> {
        const { trackId, scoreId } = this.data;
        return this.data.arrangement ? this.draftService.forgetArrangementLocalCopy(trackId) : this.draftService.forgetLocalCopy(trackId, scoreId);
    }

    /** Strumenti dell'associazione, pagina dopo pagina, per i righi da aggiungere. */
    private async loadCatalog(): Promise<void> {
        const criteria: InstrumentsCriteria = { page: 0, sort: ['name,asc'] };
        try {
            for (;;) {
                const page = await firstValueFrom(this.instrumentsService.getAll(criteria));
                for (const item of page.content) {
                    if (item.id === undefined) continue;
                    const instrument: PlaybackInstrument = {
                        id: item.id,
                        name: item.name ?? '',
                        transpositionSemitones: item.transpositionSemitones,
                        bassClefTranspositionSemitones: item.bassClefTranspositionSemitones,
                        soundBank: item.soundBank,
                        soundProgram: item.soundProgram,
                        percussionKey: item.percussionKey,
                        configured: !!item.playbackConfigured,
                        lowestWrittenPitch: item.lowestWrittenPitch,
                        highestWrittenPitch: item.highestWrittenPitch
                    };
                    this.catalog = [...this.catalog, instrument];
                    if (!this.instruments.has(instrument.id)) this.instruments.set(instrument.id, instrument);
                }
                if (!page.content.length || this.catalog.length >= page.totalElements) return;
                criteria.page = (criteria.page ?? 0) + 1;
            }
        } catch {
            // Senza catalogo si scrive con i righi che ci sono.
        }
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
        this.playback = null;
        this.changeDetector.markForCheck();
    }
}

function measuresOf(part: Element): Element[] {
    return Array.from(part.children).filter((item) => item.tagName === 'measure');
}

/** Per ogni battuta dentro una pausa di più battute, la posizione della battuta che apre il gruppo. */
function multiRestStarts(lists: readonly Element[][]): number[] {
    const starts: number[] = [];
    for (const list of lists) {
        list.forEach((measure, index) => {
            for (let inner = index + 1; inner < index + edits.multiRestCount(measure); inner++) starts[inner] ??= index;
        });
    }
    return starts;
}
