import { Location } from '@angular/common';
import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SheetsMusic } from '../../module';
import { MediaService, PrinterService, ScorePlaybackService, ToastService } from '../../service';
import { PreviewComponent } from './preview.component';

const TRANSPARENT_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const imageBlob = (): Blob => new Blob([Uint8Array.from(atob(TRANSPARENT_PIXEL), (character) => character.charCodeAt(0))], { type: 'image/png' });

/** Chi legge le parti senza gestirle; `MANAGER` le gestisce e le può impaginare. */
const MEMBER = { canManage: false } as unknown as ScorePlaybackService;
const MANAGER = { canManage: true } as unknown as ScorePlaybackService;

const scores: SheetsMusic[] = [
    { instruments: [{ index: 7, name: 'Flauto' }], media: [{ index: 11 }, { index: 12 }] },
    { instruments: [], media: [{ index: 13 }] }
];

describe('PreviewComponent', () => {
    let component: PreviewComponent;

    beforeEach(() => {
        component = new PreviewComponent(
            { scores: [], previewTitle: 'Titolo', previewSource: 'Traccia', clear: () => undefined } as unknown as PrinterService,
            { stream: (id: number) => `/media/${id}`, streamImage: () => of(imageBlob()) } as unknown as MediaService,
            { navigate: () => Promise.resolve(true), currentNavigation: () => null, lastSuccessfulNavigation: () => null } as unknown as Router,
            { back: () => undefined } as Location,
            { bypassSecurityTrustUrl: (url: string) => url } as unknown as DomSanitizer,
            { markForCheck: () => undefined } as ChangeDetectorRef,
            { warn: () => undefined } as unknown as ToastService,
            MEMBER
        );
    });

    afterEach(() => component.ngOnDestroy());

    it('lists the instruments of the filter in the order of the track parts', () => {
        const ordered = new PreviewComponent(
            {
                scores: [
                    { instruments: [{ index: 30, name: 'Ottavino' }], media: [{ index: 1 }] },
                    { instruments: [{ index: 4, name: 'Flauto' }], media: [{ index: 2 }] },
                    { instruments: [], media: [{ index: 3 }] },
                    { instruments: [{ index: 12, name: 'Clarinetto' }, { index: 4, name: 'Flauto' }], media: [{ index: 4 }] }
                ],
                previewTitle: 'Titolo',
                previewSource: 'Traccia',
                clear: () => undefined
            } as unknown as PrinterService,
            { stream: (id: number) => `/media/${id}`, streamImage: () => of(imageBlob()) } as unknown as MediaService,
            { navigate: () => Promise.resolve(true) } as unknown as Router,
            { back: () => undefined } as Location,
            { bypassSecurityTrustUrl: (url: string) => url } as unknown as DomSanitizer,
            { markForCheck: () => undefined } as ChangeDetectorRef,
            { warn: () => undefined } as unknown as ToastService,
            MEMBER
        );
        ordered.ngOnInit();

        const state = ordered as unknown as { instrumentKeys: string[]; instruments: { [key: string]: string } };
        expect(state.instrumentKeys.map((key) => state.instruments[key])).toEqual(['Ottavino', 'Flauto', 'Senza strumento', 'Clarinetto']);
        ordered.ngOnDestroy();
    });

    it('warns and returns to the home when the preview is opened without state', () => {
        const navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
        const back = jasmine.createSpy('back');
        const warn = jasmine.createSpy('warn');
        const orphan = new PreviewComponent(
            { scores: [], previewTitle: 'Spartiti selezionati', previewSource: 'Traccia', clear: () => undefined } as unknown as PrinterService,
            { stream: (id: number) => `/media/${id}`, streamImage: () => of(imageBlob()) } as unknown as MediaService,
            { navigate, currentNavigation: () => null, lastSuccessfulNavigation: () => null } as unknown as Router,
            { back } as unknown as Location,
            { bypassSecurityTrustUrl: (url: string) => url } as unknown as DomSanitizer,
            { markForCheck: () => undefined } as ChangeDetectorRef,
            { warn } as unknown as ToastService,
            MEMBER
        );

        orphan.ngOnInit();

        expect(warn).toHaveBeenCalledWith('Anteprima non disponibile', jasmine.any(String));
        expect(navigate).toHaveBeenCalledWith(['/']);
        expect(back).not.toHaveBeenCalled();
        orphan.ngOnDestroy();
    });

    it('warns and goes back to the source when it has no pages', () => {
        const navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
        const back = jasmine.createSpy('back');
        const warn = jasmine.createSpy('warn');
        const withoutPages = new PreviewComponent(
            {
                scores: [{ instruments: [{ index: 7, name: 'Flauto' }], media: [] }],
                previewTitle: 'Marcia sinfonica',
                previewSource: 'Traccia',
                clear: () => undefined
            } as unknown as PrinterService,
            { stream: (id: number) => `/media/${id}`, streamImage: () => of(imageBlob()) } as unknown as MediaService,
            { navigate, currentNavigation: () => ({ previousNavigation: {} }), lastSuccessfulNavigation: () => null } as unknown as Router,
            { back } as unknown as Location,
            { bypassSecurityTrustUrl: (url: string) => url } as unknown as DomSanitizer,
            { markForCheck: () => undefined } as ChangeDetectorRef,
            { warn } as unknown as ToastService,
            MEMBER
        );

        withoutPages.ngOnInit();

        expect(warn).toHaveBeenCalledWith('Nessuna pagina da mostrare', jasmine.any(String));
        expect(back).toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        withoutPages.ngOnDestroy();
    });

    it('tells the written parts not yet engraved apart when the source has no pages', () => {
        const open = (playback: ScorePlaybackService, written: SheetsMusic[]) => {
            const warn = jasmine.createSpy('warn');
            const preview = new PreviewComponent(
                { scores: written, previewTitle: 'Marcia', previewSource: 'Traccia', clear: () => undefined } as unknown as PrinterService,
                { stream: (id: number) => `/media/${id}`, streamImage: () => of(imageBlob()) } as unknown as MediaService,
                { navigate: () => Promise.resolve(true), currentNavigation: () => ({ previousNavigation: {} }), lastSuccessfulNavigation: () => null } as unknown as Router,
                { back: () => undefined } as unknown as Location,
                { bypassSecurityTrustUrl: (url: string) => url } as unknown as DomSanitizer,
                { markForCheck: () => undefined } as ChangeDetectorRef,
                { warn } as unknown as ToastService,
                playback
            );
            preview.ngOnInit();
            preview.ngOnDestroy();
            return warn.calls.mostRecent().args as string[];
        };
        const written = (id: number): SheetsMusic => ({ id, instruments: [{ index: id, name: 'Tuba' }], media: [], currentScoreVersionId: id * 10 });

        const [title, detail] = open(MANAGER, [written(1)]);
        expect(title).toBe('Parte scritta non ancora impaginata');
        expect(detail).toContain('«Impagina»');
        const [plural, memberDetail] = open(MEMBER, [written(1), written(2)]);
        expect(plural).toBe('Parti scritte non ancora impaginate');
        expect(memberDetail).toContain('scheda Ascolto');
        expect(open(MEMBER, [{ id: 3, instruments: [], media: [] }])[0]).toBe('Nessuna pagina da mostrare');
    });

    it('counts the selected written parts to engrave, which stay out of the print', () => {
        const preview = new PreviewComponent(
            {
                scores: [
                    { id: 1, instruments: [{ index: 7, name: 'Flauto' }], media: [{ index: 11 }] },
                    { id: 2, instruments: [{ index: 8, name: 'Tuba' }], media: [], currentScoreVersionId: 20 },
                    { id: 3, instruments: [], media: [], currentScoreVersionId: 30 }
                ],
                previewTitle: 'Marcia',
                previewSource: 'Traccia',
                clear: () => undefined
            } as unknown as PrinterService,
            { stream: (id: number) => `/media/${id}`, streamImage: () => of(imageBlob()) } as unknown as MediaService,
            { navigate: () => Promise.resolve(true) } as unknown as Router,
            { back: () => undefined } as Location,
            { bypassSecurityTrustUrl: (url: string) => url } as unknown as DomSanitizer,
            { markForCheck: () => undefined } as ChangeDetectorRef,
            { warn: () => undefined } as unknown as ToastService,
            MEMBER
        );
        preview.ngOnInit();
        const state = preview as unknown as { mediaStreams: string[]; unengravedCount: number; unengravedSummary: string; selectedInstruments: Record<string, boolean>; selectedInstrumentChange(): void };

        expect(state.mediaStreams).toEqual(['/media/11']);
        expect(state.unengravedSummary).toBe('2 parti da impaginare non stampate');
        state.selectedInstruments['8'] = false;
        state.selectedInstrumentChange();
        expect(state.unengravedSummary).toBe('1 parte da impaginare non stampata');
        state.selectedInstruments['null'] = false;
        state.selectedInstrumentChange();
        expect(state.unengravedCount).toBe(0);
        preview.ngOnDestroy();
    });

    it('groups consecutive pages into two-up print sheets', () => {
        component['mediaStreams'] = ['/media/1', '/media/2', '/media/3'];
        component['printPagesPerSheet'] = 2;

        expect(component['printSheets']).toEqual([
            ['/media/1', '/media/2'],
            ['/media/3', null]
        ]);
        expect(component['printSheetCount']).toBe(2);
    });

    it('keeps one media per sheet in the default layout', () => {
        component['mediaStreams'] = ['/media/1', '/media/2'];

        expect(component['printSheets']).toEqual([['/media/1'], ['/media/2']]);
        expect(component['printSheetCount']).toBe(2);
    });

    it('uses one consistent orientation for every two-up sheet', () => {
        component['mediaStreams'] = ['/media/landscape-1', '/media/landscape-2', '/media/landscape-3'];
        component['printPagesPerSheet'] = 2;
        component['printPageDimensions'].set('/media/landscape-1', { width: 1400, height: 1000 });
        component['printPageDimensions'].set('/media/landscape-2', { width: 1400, height: 1000 });
        component['printPageDimensions'].set('/media/landscape-3', { width: 1400, height: 1000 });

        expect(component['printOrientation']).toBe('portrait');
        expect(component['printSheets'][1]).toEqual(['/media/landscape-3', null]);
    });

    it('places portrait pages side by side in two-up mode', () => {
        component['mediaStreams'] = ['/media/portrait-1', '/media/portrait-2'];
        component['printPagesPerSheet'] = 2;
        component['printPageDimensions'].set('/media/portrait-1', { width: 1000, height: 1400 });
        component['printPageDimensions'].set('/media/portrait-2', { width: 1000, height: 1400 });

        expect(component['printOrientation']).toBe('landscape');
    });

    it('opens and closes the filter sidebar explicitly', () => {
        component['openFilters']();
        expect(component['filtersOpen']).toBeTrue();

        component['closeFilters']();
        expect(component['filtersOpen']).toBeFalse();
    });

    it('delegates paper format and printing to the browser', () => {
        const print = spyOn(window, 'print');

        component['print']();

        expect(print).toHaveBeenCalled();
    });

    it('starts with the sidebar open above the responsive breakpoint', () => {
        spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);

        component.ngOnInit();

        expect(component['filtersOpen']).toBeTrue();
    });

    it('starts with the sidebar closed up to the responsive breakpoint', () => {
        spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);

        component.ngOnInit();

        expect(component['filtersOpen']).toBeFalse();
    });
});

describe('PreviewComponent template', () => {
    let fixture: ComponentFixture<PreviewComponent>;
    let component: PreviewComponent;
    let streamImage: jasmine.Spy;

    beforeEach(async () => {
        streamImage = jasmine.createSpy('streamImage').and.callFake(() => of(imageBlob()));

        await TestBed.configureTestingModule({
            imports: [PreviewComponent],
            providers: [
                provideRouter([]),
                { provide: Location, useValue: { back: () => undefined } },
                { provide: PrinterService, useValue: { scores, previewTitle: 'Marcia sinfonica', previewSource: 'Traccia', clear: () => undefined } },
                { provide: ToastService, useValue: { warn: () => undefined } },
                { provide: ScorePlaybackService, useValue: MEMBER }
            ]
        })
            .overrideComponent(PreviewComponent, {
                set: { providers: [{ provide: MediaService, useValue: { stream: (id: number) => `/media/${id}`, streamImage } }] }
            })
            .compileComponents();

        fixture = TestBed.createComponent(PreviewComponent);
        component = fixture.componentInstance;
        spyOn(component as unknown as { isDesktopViewport: () => boolean }, 'isDesktopViewport').and.returnValue(true);
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    const query = <T extends HTMLElement>(selector: string): T => fixture.nativeElement.querySelector(selector);

    const click = (selector: string): void => {
        query(selector).click();
        fixture.detectChanges();
    };

    // Le modifiche applicate direttamente allo stato non passano da un evento: la view OnPush va marcata.
    const render = (): void => {
        fixture.componentRef.changeDetectorRef.markForCheck();
        fixture.detectChanges();
    };

    it('keeps aria-expanded aligned with the sidebar that is really visible', () => {
        expect(query('.filter-action').getAttribute('aria-expanded')).toBe('true');

        click('.close-filters');

        expect(query('.filter-action').getAttribute('aria-expanded')).toBe('false');

        click('.filter-action');

        expect(query('.filter-action').getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps the closed sidebar out of the focus order', () => {
        click('.close-filters');

        expect(getComputedStyle(query('.preview-sidebar')).visibility).toBe('hidden');
    });

    it('returns the focus to the header command when the sidebar closes', fakeAsync(() => {
        click('.close-filters');
        tick();

        expect(document.activeElement).toBe(query('.filter-action'));
    }));

    it('moves the focus to the first useful control when the sidebar opens', fakeAsync(() => {
        click('.close-filters');
        tick();

        click('.filter-action');
        tick();

        expect(document.activeElement).toBe(query('#selectAll'));
    }));

    it('closes the presentation before the sidebar when Escape is pressed', fakeAsync(() => {
        component['openGalleria']();
        render();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();

        expect(component['displayGalleria']).toBeFalse();
        expect(component['filtersOpen']).toBeTrue();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();
        tick();

        expect(component['filtersOpen']).toBeFalse();
        expect(query('.filter-action').getAttribute('aria-expanded')).toBe('false');
    }));

    it('opens the presentation on the current page and keeps it synchronised on close', () => {
        component['currentPage'] = 3;

        component['openGalleria']();
        expect(component['presentationIndex']).toBe(2);

        component['presentationIndexChange'](0);
        component['presentationVisibleChange'](false);
        render();

        expect(component['displayGalleria']).toBeFalse();
        expect(component['currentPage']).toBe(1);
    });

    it('announces the number of included pages in a polite live region', () => {
        expect(query('[aria-live="polite"]').textContent?.trim()).toBe("3 pagine incluse nell'anteprima.");
    });

    it('shows a recoverable placeholder for a page that cannot be loaded', () => {
        streamImage.and.returnValue(throwError(() => new Error('stream non disponibile')));

        component['retryMediaPage']('/media/11');
        render();

        const placeholder = query('.media-placeholder--error');
        expect(placeholder).not.toBeNull();
        expect(placeholder.textContent).toContain('Pagina 1 non disponibile');

        streamImage.and.callFake(() => of(imageBlob()));
        placeholder.querySelector('button')!.click();
        fixture.detectChanges();

        expect(query('.media-placeholder--error')).toBeNull();
        expect(query('.preview-image')).not.toBeNull();
    });

    it('leaves the other pages usable when a single page fails', () => {
        streamImage.and.returnValue(throwError(() => new Error('stream non disponibile')));
        component['retryMediaPage']('/media/11');
        render();

        click('[aria-label="Pagina successiva"]');

        expect(query('.media-placeholder--error')).toBeNull();
        expect(query('.preview-image')).not.toBeNull();
    });
});
