import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of } from 'rxjs';
import { ImportsModule } from '../../imports';
import { ScoreFragment, ScoreFragmentCategory } from '../../module';
import { FRAGMENT_CATEGORIES, FRAGMENT_NAME_LENGTH, FRAGMENT_NOTE_LENGTH, FragmentContent } from '../../score-editor/score-fragments';
import { ApiErrorService, ScoreFragmentService, withErrorSummary, withHandledErrors } from '../../service';

/** Frammento nuovo dalle battute selezionate, o frammento della biblioteca di cui cambiare nome, categoria e nota. */
export type ScoreFragmentDialogData = { content: FragmentContent; fragment?: never } | { fragment: ScoreFragment; content?: never };

const NAME_EXISTS = 'scoreWriting.fragmentNameExists';

export function openFragmentDialog(dialogService: DialogService, data: ScoreFragmentDialogData): Observable<ScoreFragment | undefined> {
    const ref = dialogService.open(ScoreFragmentDialogComponent, { showHeader: false, width: 'min(36rem, 95vw)', modal: true, focusOnShow: false, data });
    return ref?.onClose ?? of(undefined);
}

/**
 * Salva le battute selezionate come frammento della biblioteca dell'associazione, con nome, categoria e nota, o cambia
 * questi dati di un frammento salvato. Il contenuto di un frammento salvato non cambia.
 */
@Component({
    selector: 'app-score-fragment-dialog',
    standalone: true,
    imports: [ImportsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './score-fragment-dialog.component.html'
})
export class ScoreFragmentDialogComponent {
    protected readonly data: ScoreFragmentDialogData;
    protected readonly categories = [...FRAGMENT_CATEGORIES];
    protected readonly nameLength = FRAGMENT_NAME_LENGTH;
    protected readonly noteLength = FRAGMENT_NOTE_LENGTH;

    protected name: string;
    protected category: ScoreFragmentCategory | null;
    protected note: string;
    protected saving = false;
    protected dirty = false;
    /** Il nome è già di un altro frammento, secondo il server. */
    protected takenName: string | null = null;

    constructor(
        private readonly dialogRef: DynamicDialogRef<ScoreFragmentDialogComponent>,
        private readonly fragmentService: ScoreFragmentService,
        private readonly apiErrors: ApiErrorService,
        private readonly changeDetector: ChangeDetectorRef,
        config: DynamicDialogConfig<ScoreFragmentDialogData>
    ) {
        this.data = config.data!;
        const fragment = this.data.fragment;
        this.name = fragment?.name ?? '';
        this.category = fragment?.category ?? null;
        this.note = fragment?.note ?? '';
    }

    protected get heading(): string {
        return this.data.content ? 'Salva come frammento' : 'Modifica il frammento';
    }

    protected get subtitle(): string {
        const content = this.data.content;
        if (!content) return 'Il contenuto resta quello salvato; le parti dove il frammento è stato inserito non cambiano.';
        const measures = content.measureCount === 1 ? '1 battuta' : `${content.measureCount} battute`;
        return content.kind === 'PITCHED'
            ? `${measures} in suoni reali, nella biblioteca dell'associazione: all'inserimento si traspongono per lo strumento della parte.`
            : `${measures} di percussione, nella biblioteca dell'associazione: si inseriscono nelle parti che hanno tutti i loro suoni.`;
    }

    protected get nameError(): string | undefined {
        const name = this.name.trim();
        if (!name) return 'Il nome è obbligatorio.';
        if (this.takenName !== null && name.toLowerCase() === this.takenName.toLowerCase()) return 'Un altro frammento ha già questo nome.';
        return undefined;
    }

    protected get errors(): string[] {
        return [this.nameError, this.category ? undefined : 'Scegli la categoria.'].filter((error): error is string => !!error);
    }

    protected changed(): void {
        this.dirty = true;
    }

    protected cancel(): void {
        this.dialogRef.close();
    }

    protected async save(): Promise<void> {
        const category = this.category;
        if (this.errors.length || this.saving || !category) return;
        const name = this.name.trim();
        const note = this.note.trim() || null;
        const context = withHandledErrors([NAME_EXISTS], withErrorSummary('Frammento non salvato'));
        this.saving = true;
        this.changeDetector.markForCheck();
        try {
            const content = this.data.content;
            const fragment = this.data.fragment;
            const saved = content
                ? await this.fragmentService.create({ name, category, note, kind: content.kind, content: content.xml, percussionKeys: content.percussionKeys }, context)
                : await this.fragmentService.update(fragment!.id, { name, category, note, entityVersion: fragment!.entityVersion }, context);
            this.dialogRef.close(saved);
        } catch (error) {
            // Il nome ripetuto si mostra sotto il campo; gli altri errori hanno già il loro avviso.
            if (error instanceof HttpErrorResponse && this.apiErrors.resolve(error).key === NAME_EXISTS) this.takenName = name;
        } finally {
            this.saving = false;
            this.changeDetector.markForCheck();
        }
    }
}
