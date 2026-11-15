import { Location } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { CheckboxChangeEvent } from 'primeng/checkbox';
import { Subscription } from 'rxjs';
import { ImportsModule } from '../../imports';
import { SheetsMusic } from '../../module';
import { unengravedLabel } from '../../score-editor/score-engraving';
import { MediaService, PrinterService, ScorePlaybackService, ToastService } from '../../service';

type PrintSheetOrientation = 'portrait' | 'landscape';

type MediaPageStatus = 'loading' | 'ready' | 'error';

interface PrintPageDimensions {
    width: number;
    height: number;
}

interface MediaPage {
    status: MediaPageStatus;
    source: SafeUrl | null;
}

type PrintSheet = Array<string | null>;

/** Una o due pagine per foglio, oppure il formato marcia: due pagine di 18 × 13 cm su un A4 verticale. */
type PrintLayout = 1 | 2 | 'march';

/** Rapporto tra i lati del formato marcia, 18 × 13 cm in orizzontale. */
const MARCH_RATIO = 180 / 130;

// Oltre 960 px la spalla parte aperta; fino a 960 px parte chiusa e si comporta come overlay.
const DESKTOP_VIEWPORT = '(min-width: 961px)';

@Component({
    selector: 'app-preview',
    imports: [ImportsModule],
    templateUrl: './preview.component.html',
    styleUrl: './preview.component.scss',
    providers: [MediaService],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreviewComponent implements OnInit, OnDestroy {
    protected mediaStreams: string[];
    protected instruments: { [key: string]: string };
    /** Chiavi degli strumenti nell'ordine delle parti della traccia, cioè dei loro primi spartiti. */
    protected instrumentKeys: string[] = [];
    protected selectedInstruments: { [key: string]: boolean };
    protected selectAll: boolean;
    protected displayGalleria: boolean = false;
    protected presentationIndex: number = 0;
    // Risolto una sola volta all'ingresso: una scelta esplicita resta poi valida per tutta la visita.
    protected filtersOpen: boolean = true;
    protected currentPage: number = 1;
    protected zoom: number = 100;
    protected printPagesPerSheet: 1 | 2 = 1;
    /** Le pagine si stampano a 18 × 13 cm, due per foglio A4 verticale, con la linea di taglio. */
    protected marchFormat = false;
    protected previewTitle: string;
    protected previewSource: string;
    protected readonly responsiveOptions = [
        { breakpoint: '1024px', numVisible: 5 },
        { breakpoint: '960px', numVisible: 4 },
        { breakpoint: '768px', numVisible: 3 }
    ];

    @ViewChild('filtersToggle') private filtersToggle?: ElementRef<HTMLElement>;
    @ViewChild('filtersPanel') private filtersPanel?: ElementRef<HTMLElement>;

    private readonly printPageDimensions = new Map<string, PrintPageDimensions>();
    private readonly mediaPages = new Map<string, MediaPage>();
    private readonly mediaIndices = new Map<string, number>();
    private readonly objectUrls: string[] = [];
    private readonly subscriptions = new Subscription();

    constructor(
        private readonly printerService: PrinterService,
        private readonly mediaService: MediaService,
        private readonly router: Router,
        private readonly location: Location,
        private readonly sanitizer: DomSanitizer,
        private readonly changeDetector: ChangeDetectorRef,
        private readonly toastService: ToastService,
        private readonly playbackService: ScorePlaybackService
    ) {
        this.mediaStreams = [];
        this.instruments = {};
        this.selectedInstruments = {};
        this.selectAll = true;
        this.previewTitle = 'Spartiti selezionati';
        this.previewSource = 'Traccia';
    }

    ngOnInit() {
        this.filtersOpen = this.isDesktopViewport();
        this.previewTitle = this.printerService.previewTitle;
        this.previewSource = this.printerService.previewSource;

        this.printerService.scores.forEach((score) => {
            score.media?.forEach((media) => {
                const mediaStream = this.mediaService.stream(media.index);
                this.mediaIndices.set(mediaStream, media.index);
                this.mediaStreams.push(mediaStream);
            });

            if (!score.instruments?.length) {
                this.addInstrument('null', 'Senza strumento');
            }

            score.instruments?.forEach((instrument) => this.addInstrument(String(instrument.index), instrument.name!));
        });

        this.selectedInstruments = this.getInstrumentIndices(true);

        // La scaletta di un evento si stampa per strumento, nel formato marcia.
        if (this.printerService.byInstrument) {
            this.mediaStreams = this.filterMedia();
            this.printLayout = 'march';
        }

        if (this.mediaStreams.length === 0) {
            this.leaveWithoutPages();
            return;
        }

        this.loadMediaPages();
    }

    ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
        this.objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
        this.objectUrls.length = 0;
        this.mediaPages.clear();
        this.printerService.clear();
    }

    @HostListener('document:keydown.escape')
    protected onEscapeKey(): void {
        if (this.displayGalleria) {
            this.closePresentation();
            return;
        }

        if (this.filtersOpen) this.closeFilters();
    }

    protected selectAllChange(event: CheckboxChangeEvent): void {
        this.selectedInstruments = this.getInstrumentIndices(event.checked);
        this.refreshMediaStreams();
    }

    protected selectedInstrumentChange(): void {
        this.selectAll = Object.keys(this.instruments).every((key) => this.selectedInstruments[key]);
        this.refreshMediaStreams();
    }

    protected print(): void {
        window.print();
    }

    protected get printLayout(): PrintLayout {
        return this.marchFormat ? 'march' : this.printPagesPerSheet;
    }

    protected set printLayout(layout: PrintLayout) {
        this.marchFormat = layout === 'march';
        this.printPagesPerSheet = layout === 1 ? 1 : 2;
    }

    /** Pagine caricate con un altro formato: nel formato marcia si riducono per entrare nel riquadro di 18 × 13 cm. */
    protected get nonMarchPageCount(): number {
        return this.mediaStreams.filter((mediaStream) => {
            const page = this.printPageDimensions.get(mediaStream);
            return page !== undefined && Math.abs(page.width / page.height / MARCH_RATIO - 1) > 0.01;
        }).length;
    }

    protected get nonMarchPageLabel(): string {
        const count = this.nonMarchPageCount;
        return count === 1 ? '1 pagina non in formato marcia, ridotta in stampa' : `${count} pagine non in formato marcia, ridotte in stampa`;
    }

    /** Parti selezionate scritte e non ancora impaginate: restano fuori da anteprima e stampa. */
    protected get unengravedCount(): number {
        return this.printerService.scores.filter((score) => this.printerService.isUnengraved(score) && this.isSelected(score)).length;
    }

    protected get unengravedSummary(): string {
        return unengravedLabel(this.unengravedCount);
    }

    protected openGalleria(): void {
        this.presentationIndex = Math.max(0, this.currentPage - 1);
        this.displayGalleria = true;
    }

    protected presentationIndexChange(index: number): void {
        this.presentationIndex = index;
    }

    protected presentationVisibleChange(visible: boolean): void {
        if (visible) {
            this.displayGalleria = true;
            return;
        }

        this.closePresentation();
    }

    protected goBack(): void {
        this.location.back();
    }

    protected openFilters(): void {
        this.filtersOpen = true;
        this.moveFocusTo(() => this.firstFilterControl());
    }

    protected closeFilters(): void {
        this.filtersOpen = false;
        this.moveFocusTo(() => this.filtersToggle?.nativeElement ?? null);
    }

    protected previousPage(): void {
        this.currentPage = Math.max(1, this.currentPage - 1);
    }

    protected nextPage(): void {
        this.currentPage = Math.min(this.mediaStreams.length, this.currentPage + 1);
    }

    protected pageChange(event: Event): void {
        const value = Number((event.target as HTMLInputElement).value);
        this.currentPage = Math.min(this.mediaStreams.length, Math.max(1, value || 1));
    }

    protected zoomOut(): void {
        this.zoom = Math.max(60, this.zoom - 10);
    }

    protected zoomIn(): void {
        this.zoom = Math.min(140, this.zoom + 10);
    }

    protected fitPage(): void {
        this.zoom = 100;
    }

    protected mediaStatus(mediaStream: string): MediaPageStatus {
        return this.mediaPages.get(mediaStream)?.status ?? 'loading';
    }

    protected mediaSource(mediaStream: string): SafeUrl | null {
        return this.mediaPages.get(mediaStream)?.source ?? null;
    }

    protected retryMediaPage(mediaStream: string): void {
        this.loadMediaPage(mediaStream);
    }

    protected mediaPageFailed(mediaStream: string): void {
        this.mediaPages.set(mediaStream, { status: 'error', source: null });
        this.changeDetector.markForCheck();
    }

    protected printImageLoaded(mediaStream: string, event: Event): void {
        const image = event.target as HTMLImageElement;
        if (!image.naturalWidth || !image.naturalHeight) return;

        this.printPageDimensions.set(mediaStream, {
            width: image.naturalWidth,
            height: image.naturalHeight
        });
    }

    protected get printOrientation(): PrintSheetOrientation {
        const dimensions = this.mediaStreams.map((mediaStream) => this.printPageDimensions.get(mediaStream)).filter((value): value is PrintPageDimensions => value !== undefined);

        if (dimensions.length === 0 || this.marchFormat) return 'portrait';

        const averageAspectRatio = dimensions.reduce((total, page) => total + page.width / page.height, 0) / dimensions.length;
        if (this.printPagesPerSheet === 2) return averageAspectRatio > 1 ? 'portrait' : 'landscape';

        return averageAspectRatio > 1 ? 'landscape' : 'portrait';
    }

    protected get currentMediaStream(): string | undefined {
        return this.mediaStreams[this.currentPage - 1];
    }

    protected get printSheets(): PrintSheet[] {
        const sheets: PrintSheet[] = [];
        for (let index = 0; index < this.mediaStreams.length; index += this.printPagesPerSheet) {
            const sheet: PrintSheet = this.mediaStreams.slice(index, index + this.printPagesPerSheet);
            if (this.printPagesPerSheet === 2 && sheet.length === 1) sheet.push(null);
            sheets.push(sheet);
        }
        return sheets;
    }

    protected get printSheetCount(): number {
        return Math.ceil(this.mediaStreams.length / this.printPagesPerSheet);
    }

    protected get currentPrintSheet(): PrintSheet {
        return this.printSheets[Math.floor((this.currentPage - 1) / this.printPagesPerSheet)] ?? [];
    }

    protected get currentPrintSheetStartPage(): number {
        return Math.floor((this.currentPage - 1) / this.printPagesPerSheet) * this.printPagesPerSheet + 1;
    }

    protected get selectedInstrumentCount(): number {
        return Object.values(this.selectedInstruments).filter(Boolean).length;
    }

    protected get instrumentCount(): number {
        return Object.keys(this.instruments).length;
    }

    protected get includedPagesAnnouncement(): string {
        const pages = this.mediaStreams.length;

        return `${pages} ${pages === 1 ? 'pagina inclusa' : 'pagine incluse'} nell'anteprima.`;
    }

    protected instrumentPageCount(instrumentIndex: string): number {
        return this.printerService.scores
            .filter((score) => (instrumentIndex === 'null' ? !score.instruments?.length : score.instruments?.some((instrument) => instrument.index.toString() === instrumentIndex)))
            .reduce((total, score) => total + (score.media?.length || 0), 0);
    }

    private closePresentation(): void {
        this.displayGalleria = false;

        if (this.mediaStreams.length) {
            this.currentPage = Math.min(this.mediaStreams.length, Math.max(1, this.presentationIndex + 1));
        }
    }

    /**
     * Senza pagine la route non ha nulla da mostrare: l'utente viene avvisato della causa e riportato
     * alla superficie da cui è arrivato, invece di trovarsi su una pagina vuota o alla home senza spiegazione.
     */
    private leaveWithoutPages(): void {
        const unengraved = this.printerService.scores.filter((score) => this.printerService.isUnengraved(score)).length;
        if (this.printerService.scores.length === 0) {
            this.toastService.warn('Anteprima non disponibile', 'L’anteprima non conserva i dati dopo un ricaricamento: ripeti il comando dalla traccia, dall’album o dalla scaletta dell’evento.');
        } else if (unengraved) {
            const title = unengraved === 1 ? 'Parte scritta non ancora impaginata' : 'Parti scritte non ancora impaginate';
            const subject = unengraved === 1 ? 'La parte non ha' : 'Le parti non hanno';
            this.toastService.warn(
                title,
                this.playbackService.canManage
                    ? `${subject} ancora pagine: impaginale con «Impagina» nella scheda Ascolto o nel Workspace Parti della traccia per vederle in anteprima e stamparle.`
                    : `${subject} ancora pagine: si leggono e si ascoltano nella scheda Ascolto della traccia, e si stampano quando l’archivio le impagina.`
            );
        } else {
            this.toastService.warn('Nessuna pagina da mostrare', 'La sorgente selezionata non contiene pagine da consultare o stampare.');
        }

        this.returnToPreviousSurface();
    }

    /** Un accesso diretto non ha una superficie precedente nell'applicazione: in quel caso l'uscita è la home. */
    private returnToPreviousSurface(): void {
        const navigation = this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation();

        if (navigation?.previousNavigation) {
            this.location.back();
            return;
        }

        this.router.navigate(['/']);
    }

    private isDesktopViewport(): boolean {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;

        return window.matchMedia(DESKTOP_VIEWPORT).matches;
    }

    private moveFocusTo(resolve: () => HTMLElement | null): void {
        setTimeout(() => resolve()?.focus());
    }

    private firstFilterControl(): HTMLElement | null {
        const panel = this.filtersPanel?.nativeElement;
        if (!panel) return null;

        return panel.querySelector<HTMLElement>('.select-all-row input') ?? panel.querySelector<HTMLElement>('button, input');
    }

    private loadMediaPages(): void {
        this.mediaStreams.filter((mediaStream) => !this.mediaPages.has(mediaStream)).forEach((mediaStream) => this.loadMediaPage(mediaStream));
    }

    private loadMediaPage(mediaStream: string): void {
        const mediaIndex = this.mediaIndices.get(mediaStream);
        if (mediaIndex === undefined) return;

        this.mediaPages.set(mediaStream, { status: 'loading', source: null });

        this.subscriptions.add(
            this.mediaService.streamImage(mediaIndex).subscribe({
                next: (blob) => {
                    const objectUrl = URL.createObjectURL(blob);
                    this.objectUrls.push(objectUrl);
                    this.mediaPages.set(mediaStream, { status: 'ready', source: this.sanitizer.bypassSecurityTrustUrl(objectUrl) });
                    this.changeDetector.markForCheck();
                },
                error: () => {
                    this.mediaPages.set(mediaStream, { status: 'error', source: null });
                    this.changeDetector.markForCheck();
                }
            })
        );
    }

    private addInstrument(key: string, name: string): void {
        if (!(key in this.instruments)) this.instrumentKeys.push(key);
        this.instruments[key] = name;
    }

    private getInstrumentIndices(value: boolean): { [key: string]: boolean } {
        const instr: { [key: string]: boolean } = {};
        Object.keys(this.instruments).forEach((key) => (instr[key] = value));

        return instr;
    }

    private filterMedia(): string[] {
        return this.ordered(this.printerService.scores.filter((score) => this.isSelected(score))).flatMap((score) => {
            return (score.media ?? []).map((media) => this.mediaService.stream(media.index));
        });
    }

    /**
     * Nella scaletta di un evento le parti seguono gli strumenti, nell'ordine dei filtri, e per ognuno l'ordine dei
     * brani: una parte con più strumenti si stampa una volta, sotto il primo strumento scelto.
     */
    private ordered(scores: SheetsMusic[]): SheetsMusic[] {
        if (!this.printerService.byInstrument) return scores;

        const group = (score: SheetsMusic): number => {
            const keys = score.instruments?.length ? score.instruments.map((instrument) => String(instrument.index)).filter((key) => this.selectedInstruments[key]) : ['null'];
            return Math.min(...keys.map((key) => this.instrumentKeys.indexOf(key)));
        };

        return scores
            .map((score, index) => ({ score, index, group: group(score) }))
            .sort((first, second) => first.group - second.group || first.index - second.index)
            .map(({ score }) => score);
    }

    /** La parte è tra quelle scelte nei filtri, per uno dei suoi strumenti o tra quelle senza strumento. */
    private isSelected(score: SheetsMusic): boolean {
        if (!score.instruments?.length) return !!this.selectedInstruments['null'];
        return score.instruments.some((instrument) => this.selectedInstruments[instrument.index]);
    }

    private refreshMediaStreams(): void {
        this.mediaStreams = this.filterMedia();
        this.currentPage = Math.min(Math.max(this.currentPage, 1), Math.max(this.mediaStreams.length, 1));
        this.loadMediaPages();
    }
}
