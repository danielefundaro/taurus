import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { ScoreVersion } from '../../module';
import { ConfirmService, ScorePlaybackService, ScoreRecognitionService, ToastService } from '../../service';
import { ScoreCompareDialogComponent } from '../score-compare-dialog/score-compare-dialog.component';
import { ScoreVersionsDialogComponent, ScoreVersionsDialogData } from './score-versions-dialog.component';

describe('ScoreVersionsDialogComponent', () => {
    let fixture: ComponentFixture<ScoreVersionsDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let confirmService: jasmine.SpyObj<ConfirmService>;
    let playbackService: jasmine.SpyObj<ScorePlaybackService>;
    let toast: jasmine.SpyObj<ToastService>;
    let recognition: jasmine.SpyObj<ScoreRecognitionService>;
    let data: ScoreVersionsDialogData;
    const version: ScoreVersion = { id: 7, scoreId: 9, versionNumber: 2, origin: 'OMR_AUDIVERIS', status: 'UNVERIFIED', measureCount: 2, checks: null as never, createdAt: '2026-10-18T10:00:00Z', current: true, pagesChanged: false };

    beforeEach(async () => {
        data = {
            trackId: 4,
            scoreId: 9,
            partLabel: 'Clarinetto piccolo mib',
            settings: { transpositionOverride: null, soundProgramOverride: null, soundBankOverride: null },
            instrument: { id: 3, name: 'Clarinetto piccolo', transpositionSemitones: 3, soundBank: 0, soundProgram: 71, configured: true },
            sound: { transpositionSemitones: 3, soundProgram: 71, percussionKeys: [], configured: true, conflicting: false },
            tempoBpm: 96,
            engravedFromVersionId: null
        };
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        confirmService = jasmine.createSpyObj('ConfirmService', ['confirmDiscard']);
        // L'utente sceglie di restare nel dialogo.
        confirmService.confirmDiscard.and.callFake((request) => request.reject?.());
        playbackService = jasmine.createSpyObj('ScorePlaybackService', ['versions', 'updatePartSettings', 'versionFile', 'editor', 'engravingPdf', 'approve']);
        recognition = jasmine.createSpyObj('ScoreRecognitionService', ['collect']);
        recognition.collect.and.resolveTo(true);
        toast = jasmine.createSpyObj('ToastService', ['success', 'warn']);
        playbackService.versions.and.returnValue(of([version]));
        playbackService.updatePartSettings.and.callFake((_trackId, _scoreId, settings) => of(settings));

        await TestBed.configureTestingModule({
            imports: [ScoreVersionsDialogComponent],
            providers: [
                { provide: DynamicDialogConfig, useValue: { data } },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playbackService },
                { provide: ToastService, useValue: toast },
                { provide: ConfirmService, useValue: confirmService },
                { provide: ScoreRecognitionService, useValue: recognition }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ScoreVersionsDialogComponent);
        fixture.detectChanges();
    });

    const component = (): { transpositionOverride: number | null; soundDirty: boolean; saveSound(): void; correct(version: ScoreVersion): void } => fixture.componentInstance as never;
    const clickClose = (): void => fixture.nativeElement.querySelector('footer p-button button').click();

    it('compares a version and opens the editor at the measure chosen in the comparison', () => {
        expect(fixture.nativeElement.textContent).not.toContain('Confronta');
        const dialogs = fixture.debugElement.injector.get(DialogService);
        const onClose = new Subject<unknown>();
        const open = spyOn(dialogs, 'open').and.returnValue({ onClose } as never);

        (fixture.componentInstance as unknown as { compare(version: ScoreVersion): void }).compare(version);
        expect(open.calls.mostRecent().args[0]).toBe(ScoreCompareDialogComponent);
        expect(open.calls.mostRecent().args[1]?.data).toEqual({ trackId: 4, scoreId: 9, subject: 'Clarinetto piccolo mib', versionId: 7, sound: data.sound, correctable: true });
        onClose.next({ correctVersionId: 7, measureIndex: 5 });

        expect(dialogRef.close).toHaveBeenCalledWith({ changed: false, correctVersionId: 7, measureIndex: 5 });
    });

    it('collects the quality of the recognition after approving a version, not after approving it again', () => {
        const correction: ScoreVersion = { ...version, id: 8, versionNumber: 3, origin: 'CORRECTION', parentVersionId: 7 };
        const versions = [correction, version];
        playbackService.versions.and.returnValue(of(versions));
        (fixture.componentInstance as unknown as { ngOnInit(): void }).ngOnInit();
        const approved: ScoreVersion = { ...correction, status: 'APPROVED' };
        playbackService.approve.and.returnValue(of(approved));
        const approve = (target: ScoreVersion): void => (fixture.componentInstance as unknown as { approve(version: ScoreVersion): void }).approve(target);

        approve(correction);
        expect(playbackService.approve).toHaveBeenCalledWith(4, 9, 8);
        expect(recognition.collect).toHaveBeenCalledOnceWith(4, 9, approved, { versions, complete: true });
        expect(toast.success).toHaveBeenCalledWith('Versione approvata', jasmine.any(String));

        recognition.collect.calls.reset();
        approve(approved);
        expect(playbackService.approve).toHaveBeenCalledTimes(2);
        expect(recognition.collect).not.toHaveBeenCalled();
    });

    it('offers the comparison with more than one version', () => {
        playbackService.versions.and.returnValue(of([version, { ...version, id: 6, versionNumber: 1, current: false }]));
        (fixture.componentInstance as unknown as { ngOnInit(): void }).ngOnInit();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain('Confronta');
    });

    it('closes at once when the sound has no unsaved changes', () => {
        clickClose();
        expect(confirmService.confirmDiscard).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledWith({ changed: false });
    });

    it('shows in the empty fields the sound and transposition inherited from the instrument', () => {
        const element: HTMLElement = fixture.nativeElement;
        expect(element.textContent).toContain('trasposizione di Clarinetto piccolo');
        expect(element.querySelector<HTMLInputElement>('#partTransposition')?.placeholder).toBe('+3 dallo strumento');
        expect(element.querySelector<HTMLInputElement>('#partBank')?.placeholder).toBe('0 dallo strumento');
        expect(element.querySelector('p-select')?.textContent).toContain('Come lo strumento: Clarinet');
    });

    it('asks before closing or opening the editor with an unsaved sound, and not after saving it', () => {
        component().transpositionOverride = -2;
        fixture.detectChanges();
        expect(component().soundDirty).toBeTrue();

        clickClose();
        component().correct(version);
        expect(confirmService.confirmDiscard).toHaveBeenCalledTimes(2);
        expect(dialogRef.close).not.toHaveBeenCalled();

        component().saveSound();
        fixture.detectChanges();
        expect(component().soundDirty).toBeFalse();
        clickClose();
        expect(confirmService.confirmDiscard).toHaveBeenCalledTimes(2);
        expect(dialogRef.close).toHaveBeenCalledWith({ changed: true });
    });

    describe('downloads', () => {
        let click: jasmine.Spy;
        const downloads = (): {
            downloads: { label?: string; disabled?: boolean; command?: (event: unknown) => void }[];
            openDownloads(event: Event, menu: { toggle(event: Event): void }, version: ScoreVersion): void;
            downloadMidi(version: ScoreVersion): Promise<void>;
        } => fixture.componentInstance as never;
        const saved = (): string => (click.calls.mostRecent().object as HTMLAnchorElement).download;
        const run = (label: string): void => downloads().downloads.find((item) => item.label?.startsWith(label))!.command!({});
        const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

        beforeEach(() => {
            click = spyOn(HTMLAnchorElement.prototype, 'click');
        });

        it('offers MusicXML and MIDI, and the PDF only for the version the pages come from', () => {
            const menu = { toggle: jasmine.createSpy('toggle') };
            const event = new MouseEvent('click');
            downloads().openDownloads(event, menu, version);
            expect(menu.toggle).toHaveBeenCalledWith(event);
            expect(downloads().downloads.map((item) => item.label)).toEqual(['MusicXML per MuseScore (.mxl)', 'MIDI (.mid)']);

            data.engravedFromVersionId = 7;
            downloads().openDownloads(event, menu, version);
            expect(downloads().downloads.map((item) => item.label)).toEqual(['MusicXML per MuseScore (.mxl)', 'MIDI (.mid)', 'PDF delle pagine']);
            data.sound = undefined;
            downloads().openDownloads(event, menu, version);
            expect(downloads().downloads[1].disabled).toBeTrue();
        });

        it('saves the compressed MusicXML and the engraved PDF of the version', async () => {
            playbackService.versionFile.and.returnValue(of(new Blob(['mxl'])));
            playbackService.engravingPdf.and.returnValues(
                of(new Blob(['pdf'])),
                throwError(() => new Error('gone'))
            );
            data.engravedFromVersionId = 7;
            downloads().openDownloads(new MouseEvent('click'), { toggle: () => undefined }, version);

            run('MusicXML');
            expect(playbackService.versionFile).toHaveBeenCalledWith(4, 9, 7);
            expect(saved()).toBe('Clarinetto piccolo mib - versione 2.mxl');
            run('PDF');
            await settle();
            expect(playbackService.engravingPdf).toHaveBeenCalledWith(4, 9, 7);
            expect(saved()).toBe('Clarinetto piccolo mib - versione 2.pdf');
            run('PDF');
            await settle();
            expect(toast.warn).toHaveBeenCalledWith('PDF non scaricato', jasmine.any(String));
        });

        it('builds the MIDI of the version in the browser, and says when the version cannot be read', async () => {
            const xml =
                '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Cl</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note></measure></part></score-partwise>';
            playbackService.editor.and.returnValues(
                of({ version, musicXml: xml, pages: [], layout: null }),
                throwError(() => new Error('offline'))
            );

            await downloads().downloadMidi(version);
            expect(playbackService.editor).toHaveBeenCalledWith(4, 9, 7);
            expect(saved()).toBe('Clarinetto piccolo mib - versione 2.mid');

            await downloads().downloadMidi(version);
            expect(toast.warn).toHaveBeenCalledWith('MIDI non scaricato', jasmine.any(String));
            data.sound = undefined;
            await downloads().downloadMidi(version);
            expect(playbackService.editor).toHaveBeenCalledTimes(2);
        });
    });
});
