import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { ScoreFragment } from '../../module';
import { ScoreFragmentService } from '../../service';
import { openFragmentDialog, ScoreFragmentDialogComponent, ScoreFragmentDialogData } from './score-fragment-dialog.component';

const SAVED: ScoreFragment = { id: 3, name: 'Squillo', category: 'SIGNAL', note: 'Prima della sfilata', kind: 'PITCHED', measureCount: 2, percussionKeys: [], entityVersion: 1 };

interface Form {
    name: string;
    category: string | null;
    note: string;
    errors: string[];
    nameError: string | undefined;
    dirty: boolean;
    changed(): void;
    cancel(): void;
    save(): Promise<void>;
}

describe('ScoreFragmentDialogComponent', () => {
    let fixture: ComponentFixture<ScoreFragmentDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let service: jasmine.SpyObj<ScoreFragmentService>;

    const setup = async (data: ScoreFragmentDialogData): Promise<Form> => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        service = jasmine.createSpyObj('ScoreFragmentService', ['create', 'update']);
        await TestBed.configureTestingModule({
            imports: [ScoreFragmentDialogComponent],
            providers: [ConfirmationService, { provide: DynamicDialogConfig, useValue: { data } }, { provide: DynamicDialogRef, useValue: dialogRef }, { provide: ScoreFragmentService, useValue: service }]
        }).compileComponents();
        fixture = TestBed.createComponent(ScoreFragmentDialogComponent);
        fixture.detectChanges();
        return fixture.componentInstance as unknown as Form;
    };

    it('saves the selected measures with name, category and note, after checking them', async () => {
        const form = await setup({ content: { kind: 'PITCHED', xml: '<score-partwise/>', measureCount: 2, percussionKeys: [] } });
        expect(fixture.nativeElement.textContent).toContain('Salva come frammento');
        expect(fixture.nativeElement.textContent).toContain('2 battute in suoni reali');
        expect(form.errors).toEqual(['Il nome è obbligatorio.', 'Scegli la categoria.']);

        form.name = '  Squillo ';
        form.category = 'SIGNAL';
        form.note = ' Prima della sfilata ';
        form.changed();
        service.create.and.resolveTo(SAVED);
        await form.save();

        expect(form.dirty).toBeTrue();
        expect(service.create).toHaveBeenCalledWith({ name: 'Squillo', category: 'SIGNAL', note: 'Prima della sfilata', kind: 'PITCHED', content: '<score-partwise/>', percussionKeys: [] }, jasmine.anything());
        expect(dialogRef.close).toHaveBeenCalledWith(SAVED);
    });

    it('shows a repeated name under the field and keeps the dialog open', async () => {
        const form = await setup({ content: { kind: 'PERCUSSION', xml: '<score-partwise/>', measureCount: 1, percussionKeys: [{ voice: 1, key: 38 }] } });
        expect(fixture.nativeElement.textContent).toContain('1 battuta di percussione');
        form.name = 'Rullo';
        form.category = 'ROLL';
        service.create.and.rejectWith(new HttpErrorResponse({ status: 409, error: { message: 'error.scoreWriting.fragmentNameExists' } }));
        await form.save();
        fixture.detectChanges();

        expect(service.create.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ note: null, kind: 'PERCUSSION', percussionKeys: [{ voice: 1, key: 38 }] }));
        expect(form.nameError).toBe('Un altro frammento ha già questo nome.');
        expect(fixture.nativeElement.textContent).toContain('Un altro frammento ha già questo nome.');
        expect(dialogRef.close).not.toHaveBeenCalled();
        // Un altro nome si può salvare, anche lo stesso con maiuscole diverse no.
        form.name = 'RULLO';
        expect(form.errors.length).toBe(1);
        form.name = 'Rullo lungo';
        expect(form.errors).toEqual([]);

        service.create.and.rejectWith(new HttpErrorResponse({ status: 422, error: { message: 'error.scoreWriting.fragmentInvalid', args: { reason: 'structure' } } }));
        await form.save();
        expect(form.nameError).toBeUndefined();
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('changes name, category and note of a saved fragment with the version read', async () => {
        const form = await setup({ fragment: SAVED });
        expect(fixture.nativeElement.textContent).toContain('Modifica il frammento');
        expect(form.name).toBe('Squillo');
        expect(form.category).toBe('SIGNAL');
        form.category = 'INTRODUCTION';
        form.note = '';
        service.update.and.resolveTo({ ...SAVED, category: 'INTRODUCTION', note: null, entityVersion: 2 });
        await form.save();

        expect(service.update).toHaveBeenCalledWith(3, { name: 'Squillo', category: 'INTRODUCTION', note: null, entityVersion: 1 }, jasmine.anything());
        expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ entityVersion: 2 }));
        form.cancel();
        expect(dialogRef.close).toHaveBeenCalledWith();
    });

    it('opens as a dialog and returns the saved fragment', () => {
        const onClose = new Subject<ScoreFragment | undefined>();
        const dialogs = jasmine.createSpyObj<DialogService>('DialogService', ['open']);
        dialogs.open.and.returnValue({ onClose } as never);
        const results: (ScoreFragment | undefined)[] = [];
        openFragmentDialog(dialogs, { fragment: SAVED }).subscribe((result) => results.push(result));
        onClose.next(SAVED);

        expect(dialogs.open.calls.mostRecent().args[0]).toBe(ScoreFragmentDialogComponent);
        expect(results).toEqual([SAVED]);
    });
});
