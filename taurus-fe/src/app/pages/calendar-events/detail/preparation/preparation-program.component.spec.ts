import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { RoleEnums } from '../../../../constants';
import { Albums, EventPreparationProgramEntry, EventPreparationView, Page, Tracks } from '../../../../module';
import { AlbumsService, ConfirmService, EventPreparationService, KeycloakService, MediaService, PrinterService, ToastService, TracksService } from '../../../../service';
import { PreparationProgramComponent, ProgramRow } from './preparation-program.component';

const entry = (trackId: number, overrides: Partial<EventPreparationProgramEntry> = {}): EventPreparationProgramEntry => ({
    id: trackId * 10,
    trackId,
    trackName: `Brano ${trackId}`,
    trackState: 'PUBLIC',
    trackAvailable: true,
    encore: false,
    order: trackId - 1,
    scores: [],
    ...overrides
});

const page = <T>(content: T[], totalElements = content.length) => ({ content, totalElements }) as unknown as Page<T>;

describe('PreparationProgramComponent', () => {
    let fixture: ComponentFixture<PreparationProgramComponent>;
    let component: PreparationProgramComponent;
    let service: jasmine.SpyObj<EventPreparationService>;
    let tracks: jasmine.SpyObj<TracksService>;
    let albums: jasmine.SpyObj<AlbumsService>;
    let media: jasmine.SpyObj<MediaService>;
    let confirm: jasmine.SpyObj<ConfirmService>;
    let toast: jasmine.SpyObj<ToastService>;
    let dirty: boolean[];

    beforeEach(async () => {
        service = jasmine.createSpyObj<EventPreparationService>('EventPreparationService', ['replaceProgram']);
        tracks = jasmine.createSpyObj<TracksService>('TracksService', ['getAll']);
        albums = jasmine.createSpyObj<AlbumsService>('AlbumsService', ['getAll']);
        media = jasmine.createSpyObj<MediaService>('MediaService', ['streamImage']);
        confirm = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirmReversible']);
        toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'warn', 'info', 'error']);
        await TestBed.configureTestingModule({
            imports: [PreparationProgramComponent],
            providers: [
                provideRouter([]),
                { provide: EventPreparationService, useValue: service },
                { provide: TracksService, useValue: tracks },
                { provide: AlbumsService, useValue: albums },
                { provide: MediaService, useValue: media },
                { provide: ConfirmService, useValue: confirm },
                { provide: ToastService, useValue: toast },
                { provide: KeycloakService, useValue: { currentUserRole: RoleEnums.ADMIN } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(PreparationProgramComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('eventId', 42);
        fixture.componentRef.setInput('version', 5);
        dirty = [];
        component.dirtyChange.subscribe((value) => dirty.push(value));
    });

    const state = () => component as unknown as Record<string, any>;
    const names = () => (state()['rows'] as ProgramRow[]).map((row) => row.trackName);

    function render(entries: EventPreparationProgramEntry[], editable = true, personal = false): HTMLElement {
        fixture.componentRef.setInput('entries', entries);
        fixture.componentRef.setInput('editable', editable);
        fixture.componentRef.setInput('personal', personal);
        fixture.detectChanges();
        return fixture.nativeElement;
    }

    it('adds single tracks found page by page', () => {
        tracks.getAll.and.returnValues(of(page([{ id: 7, name: 'Marcia', state: 'PUBLIC' } as Tracks], 2)), of(page([{ id: 8, name: 'Valzer' } as Tracks], 2)));
        render([entry(1)]);

        state()['searchTracks']({ query: ' mar ' });
        expect(tracks.getAll.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ page: 0, size: 20, sort: ['name,asc'] }));
        expect(tracks.getAll.calls.mostRecent().args[0]!.name!.contains).toBe('mar');
        expect(state()['hasMoreTracks']).toBeTrue();
        state()['loadMoreTracks']();
        expect(tracks.getAll.calls.mostRecent().args[0]!.page).toBe(1);
        expect(state()['trackSuggestions'].length).toBe(2);
        expect(state()['hasMoreTracks']).toBeFalse();

        state()['selectedTrack'] = state()['trackSuggestions'][0];
        state()['addTrack']();

        expect(names()).toEqual(['Brano 1', 'Marcia']);
        expect(state()['announcement']).toBe('Marcia aggiunta in posizione 2.');
        expect(dirty).toEqual([true]);
    });

    it('duplicates, reorders by buttons or by dragging, and removes rows', () => {
        render([entry(1), entry(2), entry(3)]);

        state()['duplicate'](0);
        expect(names()).toEqual(['Brano 1', 'Brano 1', 'Brano 2', 'Brano 3']);
        expect(state()['rows'][1].id).toBe(0);

        state()['moveBy'](3, -1);
        expect(names()).toEqual(['Brano 1', 'Brano 1', 'Brano 3', 'Brano 2']);
        expect(state()['announcement']).toBe('Brano 3 spostata in posizione 3 di 4.');
        state()['moveBy'](0, -1);
        expect(names()).toEqual(['Brano 1', 'Brano 1', 'Brano 3', 'Brano 2']);

        state()['drop']({ previousIndex: 3, currentIndex: 0 } as CdkDragDrop<ProgramRow[]>);
        expect(names()).toEqual(['Brano 2', 'Brano 1', 'Brano 1', 'Brano 3']);
        expect((state()['rows'] as ProgramRow[]).map((row) => row.order)).toEqual([0, 1, 2, 3]);

        state()['remove'](1);
        expect(names()).toEqual(['Brano 2', 'Brano 1', 'Brano 3']);
        expect(dirty).toEqual([true]);
    });

    it('offers buttons beside every row as the keyboard alternative to dragging', () => {
        const element = render([entry(1), entry(2)]);

        const labels = Array.from(element.querySelectorAll('li [aria-label], li button[aria-label]')).map((value) => value.getAttribute('aria-label'));
        expect(labels).toContain('Sposta dopo Brano 1');
        expect(labels).toContain('Sposta prima Brano 2');
        expect(labels).toContain('Duplica Brano 1');
        expect(element.querySelector('[cdkDragHandle], .preparation-program__handle')!.getAttribute('aria-hidden')).toBe('true');
    });

    it('stops at one hundred rows', () => {
        render(Array.from({ length: 100 }, (_, index) => entry(index + 1)));
        state()['selectedTrack'] = { id: 999, name: 'Extra' } as Tracks;

        state()['addTrack']();
        state()['duplicate'](0);

        expect(state()['rows'].length).toBe(100);
        expect(fixture.nativeElement.textContent).toContain('limite di 100 brani');
    });

    it('replaces the program with an album, unless it is empty or too long', () => {
        render([entry(1, { plannedDurationSeconds: 120 })]);

        state()['selectedAlbum'] = { name: 'Vuoto', tracks: [] } as unknown as Albums;
        state()['connectAlbum']();
        expect(toast.warn).toHaveBeenCalledWith('Album vuoto', jasmine.any(String));

        state()['selectedAlbum'] = { name: 'Lungo', tracks: Array.from({ length: 101 }, (_, index) => ({ index, name: `T${index}` })) } as unknown as Albums;
        state()['connectAlbum']();
        expect(toast.warn).toHaveBeenCalledWith('Album troppo lungo', jasmine.any(String));

        state()['selectedAlbum'] = {
            name: 'Concerto',
            tracks: [
                { index: 2, name: 'Brano 2', order: 1 },
                { index: 1, name: 'Brano 1', order: 2 }
            ]
        } as unknown as Albums;
        state()['connectAlbum']();
        expect(names()).toEqual(['Brano 2', 'Brano 1']);
        expect(state()['rows'][1].plannedDurationSeconds).toBe(120);
    });

    it('saves the rows with encore and version, then hands the view to the page', () => {
        const view = { program: [] } as unknown as EventPreparationView;
        service.replaceProgram.and.returnValue(of(view));
        const emitted: EventPreparationView[] = [];
        component.saved.subscribe((value) => emitted.push(value));
        render([entry(1, { notes: 'Attacco piano', plannedDurationSeconds: 200 }), entry(2)]);
        state()['rows'][1].encore = true;
        state()['markDirty']();

        state()['save']();

        expect(service.replaceProgram).toHaveBeenCalledWith(
            42,
            [
                { trackId: 1, encore: false, plannedDurationSeconds: 200, notes: 'Attacco piano' },
                { trackId: 2, encore: true, plannedDurationSeconds: undefined, notes: undefined }
            ],
            5,
            jasmine.anything()
        );
        expect(emitted).toEqual([view]);
        expect(dirty).toEqual([true, false]);
    });

    it('keeps the draft through a reload of another unit and drops it only after accepting a conflict', () => {
        service.replaceProgram.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
        let conflicts = 0;
        component.conflict.subscribe(() => conflicts++);
        render([entry(1)]);
        state()['duplicate'](0);

        fixture.componentRef.setInput('entries', [entry(3)]);
        fixture.detectChanges();
        expect(names()).toEqual(['Brano 1', 'Brano 1']);

        state()['save']();
        expect(conflicts).toBe(0);
        confirm.confirmReversible.calls.mostRecent().args[0].accept();
        expect(conflicts).toBe(1);

        fixture.componentRef.setInput('entries', [entry(3)]);
        fixture.detectChanges();
        expect(names()).toEqual(['Brano 3']);
    });

    it('expands the parts of a track and downloads their files through the authorized media endpoint', () => {
        media.streamImage.and.returnValue(of(new Blob(['pdf'])));
        spyOn(URL, 'createObjectURL').and.returnValue('blob:spartito');
        spyOn(URL, 'revokeObjectURL');
        const click = spyOn(HTMLAnchorElement.prototype, 'click');
        const element = render([
            entry(1, {
                scores: [
                    { id: 4, description: 'Tromba 1', instruments: ['Tromba'], instrumentIds: [3], ready: true, needsReview: false, unengraved: false, files: [{ mediaId: 99, fileName: 'tromba.pdf' }] },
                    { id: 5, description: 'Tromba 2', instruments: [], instrumentIds: [], ready: false, needsReview: true, unengraved: false, files: [] }
                ]
            })
        ]);
        const toggle = element.querySelector('button[aria-controls]') as HTMLButtonElement;
        const panel = element.querySelector(`#${toggle.getAttribute('aria-controls')}`) as HTMLElement;
        expect(panel.hidden).toBeTrue();

        toggle.click();
        fixture.detectChanges();

        expect(panel.hidden).toBeFalse();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(panel.textContent).toContain('Pronto');
        expect(panel.textContent).toContain('In revisione');
        expect(panel.textContent).toContain('Nessuno strumento indicato');
        state()['download']({ mediaId: 99, fileName: 'tromba.pdf' });
        expect(media.streamImage).toHaveBeenCalledWith(99);
        expect(click).toHaveBeenCalled();
    });

    it('marks the written parts to engrave and leads the managers to the listening tab of the track', () => {
        const scores = [{ id: 6, description: 'Flicorno', instruments: ['Flicorno'], instrumentIds: [8], ready: false, needsReview: false, unengraved: true, files: [] }];
        let element = render([entry(1, { scores })]);
        (element.querySelector('button[aria-controls]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(element.textContent).toContain('Da impaginare');
        const link = element.querySelector('a[aria-label^="Impagina"]') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('/tracks/1?tab=playback');

        element = render([entry(1, { scores })], false, true);
        expect(element.querySelector('a[aria-label^="Impagina"]')).toBeNull();
    });

    it('prints the saved program by instrument, each track once, counting the parts to engrave', () => {
        const printer = TestBed.inject(PrinterService);
        const preview = spyOn(printer, 'previewProgram');
        const trumpet = { id: 4, description: 'Tromba', instruments: ['Tromba', 'Cornetta'], instrumentIds: [3, 9], ready: true, needsReview: false, unengraved: false, files: [{ mediaId: 99, fileName: 'tromba-1.png' }] };
        const written = { id: 6, description: 'Flicorno', instruments: ['Flicorno'], instrumentIds: [8], ready: false, needsReview: false, unengraved: true, files: [] };
        fixture.componentRef.setInput('eventName', 'Sfilata di primavera');
        const element = render([entry(1, { scores: [trumpet, written] }), entry(2, { trackAvailable: false }), entry(1, { id: 30, encore: true, scores: [trumpet] })]);

        expect(state()['printablePages']).toBe(1);
        state()['printProgram']();

        expect(preview).toHaveBeenCalledOnceWith(
            'Sfilata di primavera',
            [
                {
                    id: 4,
                    description: 'Tromba',
                    instruments: [
                        { index: 3, name: 'Tromba' },
                        { index: 9, name: 'Cornetta' }
                    ],
                    media: [{ index: 99, name: 'tromba-1.png' }]
                },
                { id: 6, description: 'Flicorno', instruments: [{ index: 8, name: 'Flicorno' }], media: [] }
            ],
            [6]
        );

        // A program being composed prints only once saved.
        state()['markDirty']();
        fixture.detectChanges();
        expect(state()['printHint']).toBe('Salva il programma prima di stamparlo');
        state()['printProgram']();
        expect(preview).toHaveBeenCalledTimes(1);
        expect(element.textContent).toContain('Stampa la scaletta');
    });

    it('explains why a program without pages cannot be printed', () => {
        render([entry(1)], false, true);
        expect(state()['printablePages']).toBe(0);
        expect(state()['printHint']).toBe('Nessuno spartito pronto per i tuoi strumenti');

        render([entry(1)], true, false);
        expect(state()['printHint']).toBe('Nessuna parte con pagine da stampare');

        render([entry(1, { scores: [{ id: 4, instruments: [], instrumentIds: [], ready: true, needsReview: false, unengraved: false, files: [{ mediaId: 99, fileName: 'p.png' }] }] })]);
        expect(state()['printHint']).toBe('Le parti di tutti i brani per strumento, in ordine di scaletta e nel formato marcia');
    });

    it('reads the program without editing tools and explains missing parts and tracks', () => {
        const element = render([entry(1, { encore: true, plannedDurationSeconds: 185, notes: 'Finale' }), entry(2, { trackAvailable: false, savedTrackName: 'Vecchio titolo', trackName: 'Vecchio titolo' })], false, true);

        expect(element.querySelector('p-autocomplete')).toBeNull();
        expect(element.querySelector('[aria-label^="Sposta"]')).toBeNull();
        expect(element.textContent).toContain('Bis');
        expect(element.textContent).toContain('Durata 3:05');
        expect(element.textContent).toContain('La traccia non è più disponibile nel catalogo');
        expect(element.textContent).toContain('Salvata nel programma come «Vecchio titolo»');
        expect(element.textContent).toContain('Nessuno spartito pronto per i tuoi strumenti.');
        expect(element.querySelectorAll('a[href^="/tracks/"]').length).toBe(1);
    });
});
