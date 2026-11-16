import { Component, OnInit, ChangeDetectionStrategy, ViewChild } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { SelectItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { delay, finalize, first, forkJoin } from 'rxjs';
import { AddInstrumentsDialogComponent } from '../../dialogs/add-instruments-dialog/add-instruments-dialog.component';
import { HasUnsavedChanges } from '../../guard/unsaved-changes.guard';
import { ImportsModule } from '../../imports';
import { Instruments, InstrumentsCriteria, Page } from '../../module';
import { BooleanFilter, StringFilter } from '../../module/criteria/filter';
import { ConfirmService, InstrumentsService, ListLayout, ListLayoutService, TenantFeatureService, ToastService } from '../../service';
import { ListPageBase } from '../_shared/list-page.base';
import { EnsembleComponent } from './ensemble/ensemble.component';

/** Le schede della pagina: `?tab=ensemble` apre direttamente l'organico. */
export type InstrumentsTab = 'list' | 'ensemble';

@Component({
    selector: 'app-instruments',
    imports: [RouterModule, ImportsModule, EnsembleComponent],
    templateUrl: './instruments.component.html',
    styleUrl: './instruments.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
    providers: [InstrumentsService, DialogService]
})
export class InstrumentsComponent extends ListPageBase implements OnInit, HasUnsavedChanges {
    protected sortOptions!: SelectItem[];
    protected layout: ListLayout = 'list';
    protected instruments: Instruments[];
    protected selectedInstruments: Instruments[] = [];
    /** Mostra solo gli strumenti senza suono e trasposizione per l'ascolto. */
    protected onlyUnconfigured = false;
    /** La scheda Organico si costruisce la prima volta che si apre e poi resta, con le sue modifiche. */
    protected ensembleOpened = false;
    private currentTab: InstrumentsTab = 'list';

    @ViewChild(EnsembleComponent) private ensemble?: EnsembleComponent;

    constructor(
        private readonly instrumentsService: InstrumentsService,
        private readonly toastService: ToastService,
        private readonly dialogService: DialogService,
        private readonly confirmService: ConfirmService,
        private readonly listLayoutService: ListLayoutService,
        private readonly tenantFeatureService: TenantFeatureService,
        private readonly route: ActivatedRoute
    ) {
        super();
        this.instruments = [];
    }

    ngOnInit() {
        this.initializeListState('instruments');
        this.sortOptions = [
            { label: 'Nome A-Z', value: 'name' },
            { label: 'Nome Z-A', value: '!name' }
        ];
        this.listLayoutService.observe('instruments', (value) => (this.layout = value));
        if (this.route.snapshot.queryParamMap.get('tab') === 'ensemble') this.activeTab = 'ensemble';
    }

    /** Le modifiche non salvate dell'organico: la guardia chiede conferma prima di lasciare la pagina. */
    get isDirty(): boolean {
        return this.ensemble?.isDirty ?? false;
    }

    get dirtyUnitLabels(): string[] {
        return this.isDirty ? ['organico'] : [];
    }

    protected get activeTab(): InstrumentsTab {
        return this.currentTab;
    }

    protected set activeTab(tab: InstrumentsTab) {
        this.currentTab = tab;
        if (tab === 'ensemble') this.ensembleOpened = true;
    }

    protected get scorePlaybackEnabled(): boolean {
        return this.tenantFeatureService.scorePlaybackEnabled();
    }

    protected onUnconfiguredChange(): void {
        this.dataViewLazyLoadEvent = { ...this.dataViewLazyLoadEvent, first: 0 };
        this.loadElements(this.searchTerm);
    }

    protected onLayoutChange(value: ListLayout): void {
        this.layout = value;
        this.listLayoutService.set('instruments', value);
    }

    protected addNew(): void {
        const dynamicDialogRef = this.dialogService.open(AddInstrumentsDialogComponent, {
            header: 'Aggiungi strumento',
            closable: false,
            showHeader: false,
            draggable: true,
            resizable: true,
            modal: true,
            width: '40rem',
            breakpoints: { '767px': 'calc(100vw - 2rem)' }
        });

        dynamicDialogRef?.onClose.pipe(first()).subscribe((result: Instruments) => {
            if (result) {
                this.instrumentsService
                    .create(result)
                    .pipe(delay(1000), first())
                    .subscribe({
                        next: (instrument: Instruments) => {
                            this.toastService.success('Strumento aggiunto', 'Il nuovo strumento è ora disponibile nell’elenco.');
                            this.loadElements(this.searchTerm);
                        }
                    });
            }
        });
    }

    protected deleteElement(instrument: Instruments): void {
        this.confirmService.confirmDestructive({
            title: 'Elimina strumento',
            consequence: 'Lo strumento verrà eliminato definitivamente.',
            actionLabel: 'Elimina',
            accept: () => {
                this.instrumentsService
                    .delete(instrument.id)
                    .pipe(delay(1000), first())
                    .subscribe({
                        next: (value: any) => {
                            this.toastService.success('Strumento eliminato', 'Lo strumento non è più visibile nell’elenco.');
                            this.loadElements(this.searchTerm);
                        }
                    });
            }
        });
    }

    protected isSelected(item: Instruments): boolean {
        return this.selectedInstruments.some((s) => s.id === item.id);
    }

    protected isAllSelected(items: Instruments[]): boolean {
        return items.length > 0 && items.every((item) => this.isSelected(item));
    }

    protected toggleSelection(item: Instruments): void {
        if (this.isSelected(item)) {
            this.selectedInstruments = this.selectedInstruments.filter((s) => s.id !== item.id);
        } else {
            this.selectedInstruments = [...this.selectedInstruments, item];
        }
    }

    protected toggleSelectAll(items: Instruments[]): void {
        if (this.isAllSelected(items)) {
            this.selectedInstruments = this.selectedInstruments.filter((s) => !items.some((item) => item.id === s.id));
        } else {
            const notYetSelected = items.filter((item) => !this.isSelected(item));
            this.selectedInstruments = [...this.selectedInstruments, ...notYetSelected];
        }
    }

    protected deleteSelectedElements(): void {
        const count = this.selectedInstruments.length;
        this.confirmService.confirmDestructive({
            title: 'Elimina strumenti selezionati',
            consequence: `I ${count} strumenti selezionati verranno eliminati definitivamente.`,
            actionLabel: 'Elimina',
            accept: () => {
                forkJoin(this.selectedInstruments.map((item) => this.instrumentsService.delete(item.id)))
                    .pipe(delay(1000), first())
                    .subscribe({
                        next: () => {
                            this.selectedInstruments = [];
                            this.toastService.success('Strumenti eliminati', `${count} strumenti non sono più visibili nell’elenco.`);
                            this.loadElements(this.searchTerm);
                        }
                    });
            }
        });
    }

    protected loadElements(search?: string) {
        this.selectedInstruments = [];
        this.loading = true;
        const instrumentsCriteria: InstrumentsCriteria = new InstrumentsCriteria();
        instrumentsCriteria.page = this.pageIndex;
        instrumentsCriteria.size = this.pageSize;
        instrumentsCriteria.sort = this.sortCriteria;

        if (search) {
            instrumentsCriteria.name = new StringFilter();
            instrumentsCriteria.name.contains = search;
        }
        if (this.onlyUnconfigured && this.scorePlaybackEnabled) {
            instrumentsCriteria.playbackConfigured = new BooleanFilter();
            instrumentsCriteria.playbackConfigured.equals = false;
        }

        this.instrumentsService
            .getAll(instrumentsCriteria)
            .pipe(
                first(),
                finalize(() => (this.loading = false))
            )
            .subscribe({
                next: (value: Page<Instruments>) => {
                    this.instruments = value.content;
                    this.totalRecords = value.totalElements;
                }
            });
    }
}
