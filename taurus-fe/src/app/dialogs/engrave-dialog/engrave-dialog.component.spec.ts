import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { EngravingJob, EngravingTarget, ScoreEditorData } from '../../module';
import { ResolvedOptions } from '../../score-editor/score-engraving';
import { MediaService, ScorePlaybackService, ScoreRendererService, ToastService } from '../../service';
import { EngraveDialogComponent, EngraveDialogData, ENGRAVING_POLL_MS, openEngraveDialog, PREVIEW_DELAY_MS } from './engrave-dialog.component';

/** Parte protetta del dialogo usata dalle prove. */
interface Dialog {
    step: 'loading' | 'options' | 'running' | 'done';
    options: ResolvedOptions;
    job: EngravingJob | null;
    failure: string | null;
    previewPages: number;
    previewError: string | null;
    tooManyPages: boolean;
    thumbnails: string[];
    invalidCount: number;
    heading: string;
    subtitle: string;
    statusLabel: string;
    pageCountLabel: string;
    previewStatus: string;
    changed(): void;
    changedFormat(): void;
    generate(): Promise<void>;
    apply(target: EngravingTarget): Promise<void>;
    again(): void;
    downloadPdf(): void;
    cancel(): void;
}

const EDITOR: ScoreEditorData = { version: { id: 70, versionNumber: 3 } as never, musicXml: '<score-partwise/>', pages: [], layout: null };

function job(overrides: Partial<EngravingJob> = {}): EngravingJob {
    return { id: 100, scoreId: 9, versionId: 70, status: 'QUEUED', attempts: 0, options: {}, pages: [], pdf: false, requestedAt: '2026-11-14T10:00:00Z', ...overrides };
}

describe('EngraveDialogComponent', () => {
    let fixture: ComponentFixture<EngraveDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let playback: jasmine.SpyObj<ScorePlaybackService>;
    let renderer: jasmine.SpyObj<ScoreRendererService>;
    let media: jasmine.SpyObj<MediaService>;
    let toast: jasmine.SpyObj<ToastService>;
    let config: { data: EngraveDialogData };

    beforeEach(async () => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        playback = jasmine.createSpyObj('ScorePlaybackService', ['editor', 'engraving', 'engrave', 'applyEngraving', 'engravingPdf']);
        playback.editor.and.returnValue(of(EDITOR));
        playback.engraving.and.returnValue(of(null));
        renderer = jasmine.createSpyObj('ScoreRendererService', ['engrave']);
        renderer.engrave.and.resolveTo({ pages: ['<svg width="2100px" height="2970px"></svg>', '<svg width="2100px" height="2970px"></svg>'], tooManyPages: false });
        media = jasmine.createSpyObj('MediaService', ['streamImage']);
        media.streamImage.and.returnValue(of(new Blob(['png'], { type: 'image/png' })));
        toast = jasmine.createSpyObj('ToastService', ['success', 'warn']);
        config = {
            data: {
                trackId: 5,
                scoreId: 9,
                versionId: 70,
                versionNumber: 3,
                partLabel: 'Flicorno tenore',
                header: { title: 'Marcia reale', composer: 'G. Gabetti', arranger: '', partName: 'Flicorno tenore' },
                hasPages: true,
                trackVersion: 3
            }
        };
        await TestBed.configureTestingModule({
            imports: [EngraveDialogComponent],
            providers: [
                ConfirmationService,
                { provide: DynamicDialogConfig, useValue: config },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playback },
                { provide: ScoreRendererService, useValue: renderer },
                { provide: MediaService, useValue: media },
                { provide: ToastService, useValue: toast }
            ]
        }).compileComponents();
    });

    function open(): Dialog {
        fixture = TestBed.createComponent(EngraveDialogComponent);
        fixture.detectChanges();
        flushMicrotasks();
        fixture.detectChanges();
        return fixture.componentInstance as unknown as Dialog;
    }

    function previewHost(): HTMLElement {
        return fixture.nativeElement.querySelector('.engrave-pages') as HTMLElement;
    }

    it('proposes the header of the track and draws the preview of the version', fakeAsync(() => {
        const dialog = open();

        expect(playback.editor).toHaveBeenCalledWith(5, 9, 70);
        expect(dialog.step).toBe('options');
        expect(dialog.heading).toBe('Impagina Flicorno tenore');
        expect(dialog.subtitle).toContain('Versione 3');
        expect(dialog.options.header).toEqual({ title: 'Marcia reale', composer: 'G. Gabetti', arranger: '', partName: 'Flicorno tenore' });
        expect([dialog.options.format, dialog.options.staffSize, dialog.options.margin]).toEqual(['A4_PORTRAIT', 7, 12]);

        tick(0);
        fixture.detectChanges();

        expect(renderer.engrave).toHaveBeenCalledWith('<score-partwise/>', dialog.options);
        expect(dialog.previewPages).toBe(2);
        expect(dialog.previewStatus).toBe('2 pagine');
        expect(dialog.invalidCount).toBe(0);
        expect(previewHost().querySelectorAll('.engrave-page').length).toBe(2);
        expect(previewHost().innerHTML).toContain('viewBox="0 0 2100 2970"');
        fixture.destroy();
    }));

    it('redraws the preview after the options settle and proposes the staff and margins of the format', fakeAsync(() => {
        const dialog = open();
        tick(0);
        renderer.engrave.calls.reset();

        dialog.options.format = 'MARCH';
        dialog.changedFormat();
        dialog.options.header.title = 'Marcia';
        dialog.changed();
        tick(PREVIEW_DELAY_MS - 1);
        expect(renderer.engrave).not.toHaveBeenCalled();
        tick(1);

        expect(renderer.engrave).toHaveBeenCalledTimes(1);
        expect([dialog.options.staffSize, dialog.options.margin]).toEqual([5.6, 8]);
        fixture.destroy();
    }));

    it('blocks the generation of invalid options and of a part over the maximum pages', fakeAsync(() => {
        const dialog = open();
        tick(0);

        dialog.options.staffSize = 3;
        dialog.changed();
        tick(PREVIEW_DELAY_MS);
        expect(dialog.invalidCount).toBe(1);
        void dialog.generate();
        flushMicrotasks();
        expect(playback.engrave).not.toHaveBeenCalled();

        renderer.engrave.and.resolveTo({ pages: ['<svg width="1px" height="1px"></svg>'], tooManyPages: true });
        dialog.options.staffSize = 7;
        dialog.changed();
        tick(PREVIEW_DELAY_MS);
        expect(dialog.tooManyPages).toBeTrue();
        expect(dialog.previewStatus).toBe('Più di 30 pagine');
        expect(dialog.invalidCount).toBe(1);
        fixture.destroy();
    }));

    it('starts the engraving, follows it and shows the generated pages', fakeAsync(() => {
        playback.engrave.and.returnValue(of(job()));
        const dialog = open();
        tick(0);

        void dialog.generate();
        flushMicrotasks();

        expect(playback.engrave).toHaveBeenCalledWith(
            5,
            9,
            70,
            { format: 'A4_PORTRAIT', staffSize: 7, margin: 12, header: { title: 'Marcia reale', composer: 'G. Gabetti', partName: 'Flicorno tenore' }, pageNumbers: true, measureNumbers: 'SYSTEM' },
            jasmine.anything()
        );
        expect(dialog.step).toBe('running');
        expect(dialog.statusLabel).toBe('Impaginazione in coda…');

        playback.engraving.and.returnValue(of(job({ status: 'RUNNING' })));
        tick(ENGRAVING_POLL_MS);
        expect(dialog.statusLabel).toBe('Impaginazione in corso…');

        playback.engraving.and.returnValue(of(job({ status: 'DONE', pages: [31, 32], pageCount: 2, pdf: true })));
        tick(ENGRAVING_POLL_MS);
        fixture.detectChanges();

        expect(dialog.step).toBe('done');
        expect(dialog.pageCountLabel).toBe('2 pagine generate');
        expect(media.streamImage.calls.allArgs()).toEqual([[31], [32]]);
        expect(dialog.thumbnails.every((url) => url.startsWith('blob:'))).toBeTrue();
        expect(fixture.nativeElement.textContent).toContain('Sostituisci le pagine');
        expect(fixture.nativeElement.textContent).toContain('Aggiungi in una parte nuova');
        fixture.destroy();
    }));

    it('keeps polling after a failed read and stops when the dialog closes', fakeAsync(() => {
        playback.engraving.and.returnValue(of(job({ status: 'RUNNING' })));
        const dialog = open();
        expect(dialog.step).toBe('running');

        playback.engraving.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
        tick(ENGRAVING_POLL_MS);
        expect(dialog.step).toBe('running');
        const calls = playback.engraving.calls.count();
        fixture.destroy();
        tick(ENGRAVING_POLL_MS * 2);
        expect(playback.engraving.calls.count()).toBe(calls);
    }));

    it('follows the engraving already running when another starts at the same time', fakeAsync(() => {
        playback.engrave.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
        const dialog = open();
        tick(0);
        playback.engraving.and.returnValue(of(job({ status: 'RUNNING' })));

        void dialog.generate();
        flushMicrotasks();

        expect(dialog.step).toBe('running');
        fixture.destroy();
    }));

    it('reproposes the options of the last engraving and explains why it failed', fakeAsync(() => {
        playback.engraving.and.returnValue(of(job({ status: 'FAILED', errorCode: 'tooManyPages', options: { format: 'MARCH', staffSize: 5, header: { title: 'Marcia' }, measureNumbers: 'EVERY' }, pdf: true })));
        const dialog = open();

        expect(dialog.step).toBe('options');
        expect(dialog.failure).toBe('Impaginazione non riuscita: la parte supera 30 pagine: riduci il rigo o i margini');
        expect([dialog.options.format, dialog.options.staffSize, dialog.options.margin, dialog.options.header.title, dialog.options.header.composer, dialog.options.measureNumbers]).toEqual(['MARCH', 5, 8, 'Marcia', '', 'EVERY']);
        fixture.destroy();
    }));

    it('assigns the pages to a new part and closes with the new track version', fakeAsync(() => {
        playback.engraving.and.returnValue(of(job({ status: 'DONE', pages: [31, 32], pdf: true })));
        playback.applyEngraving.and.returnValue(of({ scoreId: 12, trackVersion: 4 }));
        const dialog = open();

        void dialog.apply('NEW_PART');
        flushMicrotasks();

        expect(playback.applyEngraving).toHaveBeenCalledWith(5, 9, 70, 100, 'NEW_PART', 3, jasmine.anything());
        expect(toast.success).toHaveBeenCalledWith('Pagine assegnate', 'Le 2 pagine impaginate sono in una parte nuova, in fondo alla traccia.');
        expect(dialogRef.close).toHaveBeenCalledWith({ scoreId: 12, trackVersion: 4, target: 'NEW_PART' });
        fixture.destroy();
    }));

    it('adds the pages straight to a written part without pages and stays open when the assignment fails', fakeAsync(() => {
        config.data.hasPages = false;
        config.data.trackVersion = null;
        playback.engraving.and.returnValue(of(job({ status: 'DONE', pages: [31] })));
        playback.applyEngraving.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
        const dialog = open();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Aggiungi le pagine alla parte');
        expect(fixture.nativeElement.textContent).not.toContain('Sostituisci le pagine');

        void dialog.apply('REPLACE');
        flushMicrotasks();
        expect(playback.applyEngraving).toHaveBeenCalledWith(5, 9, 70, 100, 'REPLACE', null, jasmine.anything());
        expect(dialogRef.close).not.toHaveBeenCalled();

        playback.applyEngraving.and.returnValue(of({ scoreId: 9, trackVersion: 4 }));
        void dialog.apply('REPLACE');
        flushMicrotasks();
        expect(toast.success).toHaveBeenCalledWith('Pagine assegnate', 'La pagina impaginata è ora le pagine di Flicorno tenore.');
        fixture.destroy();
    }));

    it('goes back to the options to engrave again', fakeAsync(() => {
        playback.engraving.and.returnValue(of(job({ status: 'DONE', pages: [31] })));
        const dialog = open();
        expect(dialog.step).toBe('done');

        dialog.again();
        tick(0);

        expect(dialog.step).toBe('options');
        expect(renderer.engrave).toHaveBeenCalled();
        fixture.destroy();
    }));

    it('explains a preview that cannot be drawn and still lets the pages be generated', fakeAsync(() => {
        playback.editor.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
        let dialog = open();
        tick(0);
        expect(dialog.previewError).toContain('la versione non si legge');
        expect(renderer.engrave).not.toHaveBeenCalled();
        expect(dialog.invalidCount).toBe(0);
        fixture.destroy();

        playback.editor.and.returnValue(of(EDITOR));
        renderer.engrave.and.rejectWith(new Error('Spartito non leggibile'));
        dialog = open();
        tick(0);
        expect(dialog.previewError).toContain('Verovio non riesce a disegnare');
        expect(dialog.previewPages).toBe(0);
        fixture.destroy();
    }));

    it('downloads the PDF of the engraving, or explains that it is gone', fakeAsync(() => {
        const click = spyOn(HTMLAnchorElement.prototype, 'click');
        playback.engravingPdf.and.returnValue(of(new Blob(['%PDF'], { type: 'application/pdf' })));
        const dialog = open();

        dialog.downloadPdf();
        flushMicrotasks();
        expect(playback.engravingPdf).toHaveBeenCalledWith(5, 9, 70);
        expect(click).toHaveBeenCalledTimes(1);
        expect((click.calls.mostRecent().object as HTMLAnchorElement).download).toBe('Flicorno tenore - versione 3.pdf');

        playback.engravingPdf.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
        dialog.downloadPdf();
        flushMicrotasks();
        expect(toast.warn).toHaveBeenCalledWith('PDF non scaricato', jasmine.any(String));
        fixture.destroy();
    }));

    it('closes without a result when cancelled', fakeAsync(() => {
        const dialog = open();
        dialog.cancel();
        expect(dialogRef.close).toHaveBeenCalledWith();
        fixture.destroy();
    }));
});

describe('openEngraveDialog', () => {
    it('opens the dialog and passes on the assigned pages', () => {
        const closed = new Subject<unknown>();
        const dialogService = jasmine.createSpyObj<DialogService>('DialogService', ['open']);
        dialogService.open.and.returnValue({ onClose: closed } as never);
        const data = { trackId: 5, scoreId: 9, versionId: 70, partLabel: 'Tuba', header: {}, hasPages: false };
        const results: unknown[] = [];

        openEngraveDialog(dialogService, data).subscribe((result) => results.push(result));
        closed.next({ scoreId: 9, trackVersion: 4, target: 'REPLACE' });

        expect(dialogService.open).toHaveBeenCalledWith(EngraveDialogComponent, jasmine.objectContaining({ data, showHeader: false }));
        expect(results).toEqual([{ scoreId: 9, trackVersion: 4, target: 'REPLACE' }]);
    });

    it('emits nothing assigned when the dialog does not open', () => {
        const dialogService = jasmine.createSpyObj<DialogService>('DialogService', ['open']);
        dialogService.open.and.returnValue(null);
        const results: unknown[] = [];

        openEngraveDialog(dialogService, { trackId: 5, scoreId: 9, versionId: 70, partLabel: 'Tuba', header: {}, hasPages: false }).subscribe((result) => results.push(result));

        expect(results).toEqual([undefined]);
    });
});
