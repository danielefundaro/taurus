import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { finalize, first } from 'rxjs';
import { StateLabelsMap } from '../../../../constants';
import { ImportsModule } from '../../../../imports';
import { Albums, AlbumsCriteria, EventPreparationProgramEntry, EventPreparationScore, EventPreparationScoreFile, EventPreparationView, SheetsMusic, Tracks, TracksCriteria } from '../../../../module';
import { StringFilter } from '../../../../module/criteria/filter';
import { AlbumsService, ConfirmService, EventPreparationService, MediaService, PrinterService, ToastService, TracksService, withHandledErrors } from '../../../../service';
import { programFromAlbum } from '../event-program';
import { formatDuration, isVersionConflict, MAX_PREPARATION_ROWS, VERSION_CONFLICT } from './preparation-labels';

/** A row of the draft: `key` stays the same while the row moves, so the template keeps its state. */
export type ProgramRow = EventPreparationProgramEntry & { key: number };

const TRACK_PAGE_SIZE = 20;

/**
 * The program of the occurrence, an independent unit of the page. Rows are reordered by dragging or, from the
 * keyboard, with the buttons beside each row; the same track may appear more than once, for example as an encore.
 */
@Component({
    selector: 'app-preparation-program',
    imports: [ImportsModule, CdkDropList, CdkDrag, CdkDragHandle],
    templateUrl: './preparation-program.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './preparation-program.component.scss'
})
export class PreparationProgramComponent implements OnChanges {
    @Input({ required: true }) eventId!: number;
    @Input() entries: EventPreparationProgramEntry[] = [];
    /** The `programVersion` read with the view, sent back with the save. */
    @Input() version = 0;
    /** Administrators and archivists compose the program; the others read it. */
    @Input() editable = false;
    /** The personal view lists only the parts of the reader's instruments. */
    @Input() personal = false;
    /** The name of the event, the title of the printed program. */
    @Input() eventName = '';
    @Output() readonly saved = new EventEmitter<EventPreparationView>();
    @Output() readonly dirtyChange = new EventEmitter<boolean>();
    @Output() readonly conflict = new EventEmitter<void>();

    protected rows: ProgramRow[] = [];
    protected dirty = false;
    protected saving = false;
    protected announcement = '';
    protected readonly expanded = new Set<number>();
    protected readonly maxRows = MAX_PREPARATION_ROWS;
    protected readonly formatDuration = formatDuration;

    protected selectedTrack?: Tracks;
    protected trackSuggestions: Tracks[] = [];
    protected trackTotal = 0;
    private trackQuery = '';
    private trackPage = 0;

    protected selectedAlbum?: Albums;
    protected albumSuggestions: Albums[] = [];

    private nextKey = 1;

    constructor(
        private readonly eventPreparationService: EventPreparationService,
        private readonly tracksService: TracksService,
        private readonly albumsService: AlbumsService,
        private readonly mediaService: MediaService,
        private readonly confirmService: ConfirmService,
        private readonly toastService: ToastService,
        private readonly printerService: PrinterService
    ) {}

    ngOnChanges(changes: SimpleChanges): void {
        // A reload caused by another unit never discards the program being composed here.
        if (changes['entries'] && !this.dirty) {
            this.rows = (this.entries ?? []).map((entry) => this.row(entry));
            this.expanded.clear();
        }
    }

    protected get full(): boolean {
        return this.rows.length >= this.maxRows;
    }

    /** Pages of the saved program that the print would include, each track once. */
    protected get printablePages(): number {
        return this.printableEntries().reduce((total, entry) => total + entry.scores.reduce((pages, score) => pages + score.files.length, 0), 0);
    }

    protected get printHint(): string {
        if (this.dirty) return 'Salva il programma prima di stamparlo';
        if (!this.printablePages) return this.personal ? 'Nessuno spartito pronto per i tuoi strumenti' : 'Nessuna parte con pagine da stampare';
        return 'Le parti di tutti i brani per strumento, in ordine di scaletta e nel formato marcia';
    }

    protected get hasMoreTracks(): boolean {
        return this.trackSuggestions.length < this.trackTotal;
    }

    protected trackStateLabel(state?: string): string {
        if (!state) return '';
        return StateLabelsMap.find((value) => value.code === state)?.name ?? 'Stato non disponibile';
    }

    protected scoreState(score: EventPreparationScore): { label: string; severity: 'success' | 'warn' | 'secondary' } {
        if (score.ready) return { label: 'Pronto', severity: 'success' };
        if (score.unengraved) return { label: 'Da impaginare', severity: 'warn' };
        return score.needsReview ? { label: 'In revisione', severity: 'warn' } : { label: 'Non pronto', severity: 'secondary' };
    }

    /**
     * The saved program in the preview: the parts of every track, each track once even when it returns as an encore,
     * by instrument and in the order of the program. The parts to engrave are counted, not printed.
     */
    protected printProgram(): void {
        if (this.dirty || !this.printablePages) return;

        const scores: SheetsMusic[] = [];
        const unengraved: number[] = [];
        this.printableEntries().forEach((entry) =>
            entry.scores.forEach((score) => {
                scores.push({
                    id: score.id,
                    description: score.description,
                    instruments: score.instruments.map((name, index) => ({ index: score.instrumentIds[index], name })),
                    media: score.files.map((file) => ({ index: file.mediaId, name: file.fileName }))
                });
                if (score.unengraved) unengraved.push(score.id);
            })
        );
        this.printerService.previewProgram(this.eventName, scores, unengraved);
    }

    protected searchTracks(event: AutoCompleteCompleteEvent): void {
        this.trackQuery = event.query.trim();
        this.trackPage = 0;
        this.loadTracks(false);
    }

    /** The next page of the same search, appended to the suggestions. */
    protected loadMoreTracks(): void {
        if (!this.hasMoreTracks) return;
        this.trackPage++;
        this.loadTracks(true);
    }

    protected addTrack(): void {
        const track = this.selectedTrack;
        if (!track?.id || this.full) return;
        this.rows = [...this.rows, this.row({ id: 0, trackId: track.id, trackName: track.name ?? '', trackState: track.state ?? '', trackAvailable: true, encore: false, order: this.rows.length, scores: [] })];
        this.selectedTrack = undefined;
        this.changed(`${track.name} aggiunta in posizione ${this.rows.length}.`);
    }

    protected searchAlbums(event: AutoCompleteCompleteEvent): void {
        const criteria = new AlbumsCriteria();
        criteria.page = 0;
        criteria.size = 25;
        criteria.sort = ['name,asc'];
        const query = event.query.trim();
        if (query) {
            criteria.name = new StringFilter();
            criteria.name.contains = query;
        }
        this.albumsService
            .getAll(criteria)
            .pipe(first())
            .subscribe((page) => (this.albumSuggestions = page.content));
    }

    protected connectAlbum(): void {
        const album = this.selectedAlbum;
        if (!album?.tracks?.length) {
            this.toastService.warn('Album vuoto', 'Aggiungi almeno una traccia all’album prima di collegarlo all’evento.');
            return;
        }
        if (album.tracks.length > this.maxRows) {
            this.toastService.warn('Album troppo lungo', `Il programma può contenere al massimo ${this.maxRows} brani.`);
            return;
        }
        this.rows = programFromAlbum(album, this.rows).map((entry) => this.row(entry));
        this.selectedAlbum = undefined;
        this.changed(`Programma sostituito con le ${this.rows.length} tracce di ${album.name}.`);
    }

    protected drop(event: CdkDragDrop<ProgramRow[]>): void {
        if (event.previousIndex === event.currentIndex) return;
        this.move(event.previousIndex, event.currentIndex);
    }

    /** Keyboard alternative to dragging. */
    protected moveBy(index: number, offset: number): void {
        const target = index + offset;
        if (target < 0 || target >= this.rows.length) return;
        this.move(index, target);
    }

    protected duplicate(index: number): void {
        if (this.full) return;
        const copy = this.row({ ...this.rows[index], id: 0 });
        this.rows = [...this.rows.slice(0, index + 1), copy, ...this.rows.slice(index + 1)];
        this.renumber();
        this.changed(`${copy.trackName} duplicata in posizione ${index + 2}.`);
    }

    protected remove(index: number): void {
        const [removed] = this.rows.splice(index, 1);
        this.rows = [...this.rows];
        this.expanded.delete(removed.key);
        this.renumber();
        this.changed(`${removed.trackName} rimossa dal programma.`);
    }

    protected toggleScores(row: ProgramRow): void {
        if (this.expanded.has(row.key)) this.expanded.delete(row.key);
        else this.expanded.add(row.key);
    }

    /** The files go through the authorized media endpoint: the backend checks the reader again. */
    protected download(file: EventPreparationScoreFile): void {
        this.mediaService
            .streamImage(file.mediaId)
            .pipe(first())
            .subscribe((blob) => {
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = file.fileName || 'spartito';
                anchor.click();
                URL.revokeObjectURL(url);
            });
    }

    private printableEntries(): EventPreparationProgramEntry[] {
        const tracks = new Set<number>();
        return (this.entries ?? []).filter((entry) => {
            if (!entry.trackAvailable || tracks.has(entry.trackId)) return false;
            tracks.add(entry.trackId);
            return true;
        });
    }

    protected markDirty(): void {
        if (this.dirty) return;
        this.dirty = true;
        this.dirtyChange.emit(true);
    }

    protected save(): void {
        this.saving = true;
        const entries = this.rows.map((row) => ({ trackId: row.trackId, encore: row.encore, plannedDurationSeconds: row.plannedDurationSeconds ?? undefined, notes: row.notes || undefined }));
        this.eventPreparationService
            .replaceProgram(this.eventId, entries, this.version, withHandledErrors(VERSION_CONFLICT))
            .pipe(
                first(),
                finalize(() => (this.saving = false))
            )
            .subscribe({
                next: (view) => {
                    this.reset();
                    this.saved.emit(view);
                },
                error: (error) => {
                    if (!isVersionConflict(error)) return;
                    this.confirmService.confirmReversible({
                        title: 'Programma modificato da un’altra persona',
                        consequence: 'Ricarica la preparazione per vedere il programma aggiornato: le modifiche fatte qui al programma andranno perse.',
                        actionLabel: 'Ricarica',
                        accept: () => {
                            this.reset();
                            this.conflict.emit();
                        }
                    });
                }
            });
    }

    private loadTracks(append: boolean): void {
        const criteria = new TracksCriteria();
        criteria.page = this.trackPage;
        criteria.size = TRACK_PAGE_SIZE;
        criteria.sort = ['name,asc'];
        if (this.trackQuery) {
            criteria.name = new StringFilter();
            criteria.name.contains = this.trackQuery;
        }
        this.tracksService
            .getAll(criteria)
            .pipe(first())
            .subscribe((page) => {
                this.trackSuggestions = append ? [...this.trackSuggestions, ...page.content] : page.content;
                this.trackTotal = page.totalElements ?? page.content.length;
            });
    }

    private move(from: number, to: number): void {
        const rows = [...this.rows];
        moveItemInArray(rows, from, to);
        this.rows = rows;
        this.renumber();
        this.changed(`${rows[to].trackName} spostata in posizione ${to + 1} di ${rows.length}.`);
    }

    private renumber(): void {
        this.rows.forEach((row, order) => (row.order = order));
    }

    private changed(announcement: string): void {
        this.announcement = announcement;
        this.markDirty();
    }

    private row(entry: EventPreparationProgramEntry): ProgramRow {
        return { ...entry, scores: entry.scores ?? [], key: this.nextKey++ };
    }

    private reset(): void {
        this.dirty = false;
        this.dirtyChange.emit(false);
    }
}
