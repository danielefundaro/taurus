import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { NewArrangementDialogComponent } from '../../../../dialogs/new-arrangement-dialog/new-arrangement-dialog.component';
import { ScoreEditorDialogComponent } from '../../../../dialogs/score-editor-dialog/score-editor-dialog.component';
import { Arrangement, ArrangementVersion } from '../../../../module';
import { ArrangementService, ConfirmService, ScorePlaybackService, ToastService } from '../../../../service';
import { ScoreArrangementPanelComponent } from './score-arrangement-panel.component';

const VERSION: ArrangementVersion = { id: 21, versionNumber: 2, status: 'UNVERIFIED', concertPitch: false, measureCount: 48, checks: [], createdAt: '2026-11-15T09:00:00Z', current: true };
const CLARINET = { id: 2, name: 'Clarinetto', configured: true };
const SNARE = { id: 5, name: 'Rullante', percussionKey: 38, configured: true };
const BASS_DRUM = { id: 6, name: 'Grancassa', percussionKey: 36, configured: true };

function arrangement(overrides: Partial<Arrangement> = {}): Arrangement {
    return {
        id: 3,
        trackId: 5,
        currentVersion: VERSION,
        rows: [
            { id: 'P1', name: 'Clarinetto', instruments: [CLARINET], scoreId: 9, status: 'UP_TO_DATE' },
            { id: 'P2', name: 'Percussioni', instruments: [SNARE, BASS_DRUM], scoreId: null, status: 'NEW' },
            { id: 'P3', name: null, instruments: [CLARINET], scoreId: 10, status: 'PART_DELETED' }
        ],
        draft: null,
        editing: null,
        ...overrides
    };
}

describe('ScoreArrangementPanelComponent', () => {
    let service: jasmine.SpyObj<ArrangementService>;
    let playbackService: { playback: jasmine.Spy };
    let dialogs: { open: jasmine.Spy };
    let closes: Subject<unknown>[];
    let confirm: jasmine.SpyObj<ConfirmService>;
    let toast: jasmine.SpyObj<ToastService>;
    let component: any;

    /** Chiude l'ultimo dialogo aperto con il risultato indicato. */
    const close = (result?: unknown): void => {
        const onClose = closes[closes.length - 1];
        onClose.next(result);
        onClose.complete();
    };
    const opened = (index = dialogs.open.calls.count() - 1) => ({ component: dialogs.open.calls.argsFor(index)[0], options: dialogs.open.calls.argsFor(index)[1] });
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    beforeEach(async () => {
        service = jasmine.createSpyObj('ArrangementService', ['arrangement', 'discardDraft', 'versions', 'approve', 'file', 'delete']);
        service.arrangement.and.resolveTo(arrangement());
        service.discardDraft.and.resolveTo();
        service.versions.and.resolveTo([VERSION, { ...VERSION, id: 20, versionNumber: 1, status: 'APPROVED', current: false }]);
        service.approve.and.resolveTo({ ...VERSION, status: 'APPROVED' });
        service.file.and.resolveTo(new Blob(['mxl']));
        service.delete.and.resolveTo();
        playbackService = { playback: jasmine.createSpy('playback').and.returnValue(of({ trackId: 5, version: 2, parts: [], recognitionAvailable: false })) };
        closes = [];
        dialogs = {
            open: jasmine.createSpy('open').and.callFake(() => {
                const onClose = new Subject<unknown>();
                closes.push(onClose);
                return { onClose };
            })
        };
        confirm = jasmine.createSpyObj('ConfirmService', ['confirmDestructive']);
        confirm.confirmDestructive.and.callFake((request) => request.accept());
        toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
        component = new ScoreArrangementPanelComponent(service, playbackService as never, dialogs as never, confirm, toast, { markForCheck: () => undefined } as never);
        component.trackId = 5;
        component.ngOnChanges({ trackId: {} });
        await settle();
    });

    it('loads the score of the track and tells when it cannot', async () => {
        expect(service.arrangement).toHaveBeenCalledWith(5);
        expect(component.arrangement.id).toBe(3);
        expect(component.loading).toBeFalse();

        service.arrangement.and.rejectWith(new Error('offline'));
        component.ngOnChanges({ trackId: {} });
        await settle();
        expect(component.failed).toBeTrue();
        component.ngOnChanges({});
        expect(service.arrangement).toHaveBeenCalledTimes(2);
    });

    it('describes the draft, who is writing and the instruments of the rows', () => {
        const savedAt = new Date(2026, 10, 15, 10, 32).toISOString();
        expect(component.draftLabel({ savedBy: 'Mario Rossi', savedAt, outdated: false })).toBe('Bozza non salvata di Mario Rossi, 15/11/2026 10:32');
        expect(component.draftLabel({ savedBy: null, savedAt: 'non una data', outdated: false })).toBe('Bozza non salvata');
        expect(component.editingLabel({ ownerName: 'Mario Rossi', since: savedAt, expiresAt: savedAt, mine: false })).toBe('In modifica da Mario Rossi dalle 10:32');
        expect(component.instrumentsLabel(component.arrangement.rows[1])).toBe('Rullante, Grancassa');
        expect(component.moment(null)).toBe('');

        expect(component.editedElsewhere).toBeFalse();
        component.arrangement = arrangement({ editing: { ownerName: 'Mario Rossi', since: savedAt, expiresAt: savedAt, mine: false } });
        expect(component.editedElsewhere).toBeTrue();
        component.arrangement = arrangement({ editing: { ownerName: 'Io', since: savedAt, expiresAt: savedAt, mine: true } });
        expect(component.editedElsewhere).toBeFalse();
    });

    it('creates a score from the dialog and opens it at once in the editor, on its draft', async () => {
        component.arrangement = null;
        await component.create();

        expect(playbackService.playback).toHaveBeenCalledWith(5);
        expect(opened().component).toBe(NewArrangementDialogComponent);
        expect(opened().options.data).toEqual({ trackId: 5, playback: jasmine.objectContaining({ trackId: 5 }) });
        const created = arrangement({ currentVersion: null, rows: [{ id: 'P1', name: 'Flauto', instruments: [CLARINET], status: 'NEW' }] });
        close({ arrangement: created });

        expect(component.arrangement).toBe(created);
        expect(opened().component).toBe(ScoreEditorDialogComponent);
        expect(opened().options.data).toEqual(jasmine.objectContaining({ trackId: 5, scoreId: 0, versionId: null, mode: 'writing', resume: true, arrangement: { version: null, rows: [{ id: 'P1', name: 'Flauto', instruments: [CLARINET] }] } }));
    });

    it('does not open the dialog twice, nor without the parts of the track', async () => {
        component.opening = true;
        await component.create();
        expect(playbackService.playback).not.toHaveBeenCalled();

        component.opening = false;
        playbackService.playback.and.returnValue(throwError(() => new Error('offline')));
        await component.create();
        expect(dialogs.open).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Partitura non disponibile', jasmine.any(String));
        expect(component.opening).toBeFalse();

        playbackService.playback.and.returnValue(of({ trackId: 5, version: 2, parts: [], recognitionAvailable: false }));
        await component.create();
        close(undefined);
        expect(dialogs.open).toHaveBeenCalledTimes(1);
    });

    it('opens the current version in the editor and reloads the score when it closes', async () => {
        component.write();
        expect(opened().component).toBe(ScoreEditorDialogComponent);
        expect(opened().options.data).toEqual(jasmine.objectContaining({ versionId: 21, resume: false, partLabel: 'Partitura', arrangement: jasmine.objectContaining({ version: VERSION }) }));
        expect(opened().options.data.arrangement.rows.length).toBe(3);

        close();
        await settle();
        expect(toast.success).not.toHaveBeenCalled();
        expect(service.arrangement).toHaveBeenCalledTimes(2);

        component.write(true);
        close({ ...VERSION, id: 22, versionNumber: 3 });
        expect(toast.success).toHaveBeenCalledWith('Partitura salvata', 'La versione 3 è ora quella corrente.');

        component.arrangement = null;
        component.write();
        expect(dialogs.open).toHaveBeenCalledTimes(2);
    });

    it('discards the draft after a confirmation', async () => {
        component.discardDraft();
        expect(confirm.confirmDestructive).not.toHaveBeenCalled();

        component.arrangement = arrangement({ draft: { savedBy: 'Mario Rossi', savedAt: '2026-11-15T09:30:00Z', outdated: false } });
        component.discardDraft();
        await settle();
        expect(confirm.confirmDestructive).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Scartare la bozza?', actionLabel: 'Scarta la bozza' }));
        expect(service.discardDraft).toHaveBeenCalledWith(5);
        expect(toast.success).toHaveBeenCalledWith('Bozza scartata', jasmine.any(String));

        service.discardDraft.and.rejectWith(new Error('locked'));
        component.arrangement = arrangement({ draft: { savedBy: null, savedAt: '2026-11-15T09:30:00Z', outdated: false } });
        const loads = service.arrangement.calls.count();
        component.discardDraft();
        await settle();
        expect(service.arrangement.calls.count()).toBe(loads + 1);
    });

    it('lists, approves and downloads the versions', async () => {
        await component.toggleVersions();
        expect(component.versions.length).toBe(2);
        await component.toggleVersions();
        expect(component.versions).toBeNull();

        await component.approve(VERSION);
        expect(service.approve).toHaveBeenCalledWith(5, 21, jasmine.anything());
        expect(toast.success).toHaveBeenCalledWith('Versione approvata', 'La versione 2 della partitura è approvata.');
        expect(component.versions.length).toBe(2);

        service.approve.and.rejectWith(new Error('outdated'));
        await component.approve(VERSION);
        expect(toast.success).toHaveBeenCalledTimes(1);

        service.versions.and.rejectWith(new Error('offline'));
        component.versions = null;
        await component.toggleVersions();
        expect(component.versions).toBeNull();

        const click = spyOn(HTMLAnchorElement.prototype, 'click');
        spyOn(URL, 'createObjectURL').and.returnValue('blob:partitura');
        spyOn(URL, 'revokeObjectURL');
        await component.download(VERSION);
        expect(service.file).toHaveBeenCalledWith(5, 21);
        expect(click).toHaveBeenCalled();
        expect((click.calls.mostRecent().object as HTMLAnchorElement).download).toBe('partitura-versione-2.mxl');

        service.file.and.rejectWith(new Error('offline'));
        await component.download(VERSION);
        expect(toast.error).toHaveBeenCalledWith('File non scaricato', 'Riprovare più tardi.');
    });

    it('deletes the score after a confirmation', async () => {
        component.remove();
        await settle();
        expect(confirm.confirmDestructive).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Eliminare la partitura?', actionLabel: 'Elimina la partitura' }));
        expect(service.delete).toHaveBeenCalledWith(5, undefined, jasmine.anything());
        expect(toast.success).toHaveBeenCalledWith('Partitura eliminata', 'Le parti della traccia restano.');

        service.delete.and.rejectWith(new Error('locked'));
        component.remove();
        await settle();
        expect(toast.success).toHaveBeenCalledTimes(1);

        component.arrangement = null;
        component.remove();
        expect(confirm.confirmDestructive).toHaveBeenCalledTimes(2);
    });
});

describe('ScoreArrangementPanelComponent view', () => {
    let service: jasmine.SpyObj<ArrangementService>;

    async function render(value: Arrangement | null, { phone = false, trackDirty = false } = {}): Promise<HTMLElement> {
        service = jasmine.createSpyObj('ArrangementService', ['arrangement']);
        service.arrangement.and.resolveTo(value);
        spyOn(window, 'matchMedia').and.callFake(
            (query: string) =>
                ({ matches: phone && query === '(max-width: 768px)', media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) as unknown as MediaQueryList
        );
        await TestBed.configureTestingModule({
            imports: [ScoreArrangementPanelComponent],
            providers: [
                { provide: ArrangementService, useValue: service },
                { provide: ScorePlaybackService, useValue: {} },
                { provide: ConfirmService, useValue: {} },
                { provide: ToastService, useValue: {} }
            ]
        }).compileComponents();
        const fixture = TestBed.createComponent(ScoreArrangementPanelComponent);
        fixture.componentRef.setInput('trackId', 5);
        fixture.componentRef.setInput('trackDirty', trackDirty);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    const buttons = (host: HTMLElement): string[] => Array.from(host.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '');

    it('offers a new score, once the track is saved', async () => {
        const host = await render(null, { trackDirty: true });
        expect(host.textContent).toContain('Nessuna partitura');
        const create = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Nuova partitura'));
        expect(create?.disabled).toBeTrue();
    });

    it('shows the version, the draft, who is writing and the state of every row', async () => {
        const since = new Date(2026, 10, 15, 10, 32).toISOString();
        const host = await render(arrangement({ draft: { savedBy: 'Mario Rossi', savedAt: since, outdated: false }, editing: { ownerName: 'Anna Bianchi', since, expiresAt: since, mine: false } }));

        expect(host.textContent).toContain('versione 2 · trasposta · 48 battute');
        expect(host.textContent).toContain('Non verificata');
        expect(host.textContent).toContain('Bozza non salvata di Mario Rossi');
        expect(host.textContent).toContain('In modifica da Anna Bianchi dalle 10:32');
        expect(host.textContent).toContain('Righi 3');
        expect(Array.from(host.querySelectorAll('li p-tag')).map((tag) => tag.textContent?.trim())).toEqual(['Aggiornata', 'Nuova', 'Parte eliminata']);
        expect(host.textContent).toContain('Rullante, Grancassa');
        expect(buttons(host)).toEqual(jasmine.arrayContaining(['Riprendi la bozza', 'Scarta la bozza', 'Versioni', 'Elimina la partitura']));
        expect(buttons(host)).not.toContain('Scrivi');
    });

    it('shows only the state on a phone', async () => {
        const host = await render(arrangement({ currentVersion: null }), { phone: true });
        expect(host.textContent).toContain('Mai salvata');
        expect(host.textContent).toContain('Scrittura da computer o tablet');
        expect(buttons(host)).toEqual([]);
    });
});
