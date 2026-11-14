import { SimpleChange } from '@angular/core';
import { SheetsMusic } from '../../../../module';
import { ConfirmService } from '../../../../service';
import { MediaThumbnailComponent } from '../media-thumbnail/media-thumbnail.component';
import { ScoreWorkspaceComponent } from './score-workspace.component';

describe('ScoreWorkspaceComponent', () => {
    it('returns to a clean draft after undoing the first operation', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, description: 'Clarinetto', media: [], instruments: [] }];
        const dirtyStates: boolean[] = [];
        component.dirtyChange.subscribe((dirty) => dirtyStates.push(dirty));
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['addScore']();
        component['undo']();

        expect(component['draftScores']).toEqual(initial);
        expect(dirtyStates).toEqual([false, true, false]);
    });

    it('keeps selected pages selected after moving them', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, media: [{ index: 10 }], instruments: [] },
            { id: 2, order: 2, media: [], instruments: [] }
        ];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });
        component['selectedMediaIds'] = new Set([10]);
        component['moveTargetIndex'] = 1;

        component['moveSelectedPages']();

        expect(component['selectedScoreIndex']).toBe(1);
        expect(component['selectedMediaIds'].has(10)).toBeTrue();
    });

    it('selects the visible parts and clears the whole selection through the shared selection bar contract', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, description: 'Clarinetto', media: [], instruments: [] },
            { id: 2, order: 2, description: 'Tromba', media: [], instruments: [] }
        ];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['toggleAllParts'](true);
        expect(component['allFilteredPartsSelected']).toBeTrue();

        component['filterQuery'] = 'Tromba';
        component['toggleAllParts'](false);
        expect(component['selectedPartKeys'].size).toBe(0);
    });

    it('clears the selected pages and the move target when all pages are deselected', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, media: [{ index: 10 }, { index: 11 }], instruments: [] },
            { id: 2, order: 2, media: [], instruments: [] }
        ];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['toggleAllPages'](true);
        component['moveTargetIndex'] = 1;
        expect(component['allPagesSelected']).toBeTrue();

        component['toggleAllPages'](false);

        expect(component['selectedMediaIds'].size).toBe(0);
        expect(component['moveTargetIndex']).toBeNull();
    });

    it('opens the focused page preview with Enter', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const thumbnail = jasmine.createSpyObj<MediaThumbnailComponent>('MediaThumbnailComponent', ['openPreview']);
        const event = {
            key: 'Enter',
            target: null,
            currentTarget: null,
            preventDefault: jasmine.createSpy('preventDefault')
        } as unknown as KeyboardEvent;

        component['onPageKeydown'](0, 10, thumbnail, event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(thumbnail.openPreview).toHaveBeenCalled();
    });

    it('moves page navigation to the requested page within bounds', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, media: [{ index: 10 }, { index: 11 }, { index: 12 }], instruments: [] }];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['navigateToPage'](8);

        expect(component['activePageIndex']).toBe(2);
    });

    it('clears the review flag of the selected part and restores it with undo', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, description: 'Ottavino', media: [], instruments: [], needsReview: true }];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['markReviewed']();
        expect(component['draftScores'][0].needsReview).toBeFalse();

        component['undo']();
        expect(component['draftScores'][0].needsReview).toBeTrue();
    });

    it('clears the review flag of the selected parts only', () => {
        const confirmService = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirmReversible']);
        confirmService.confirmReversible.and.callFake((request) => request.accept());
        const component = new ScoreWorkspaceComponent(confirmService);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, description: 'Ottavino', media: [], instruments: [], needsReview: true },
            { id: 2, order: 2, description: 'Tamburo', media: [], instruments: [], needsReview: true },
            { id: 3, order: 3, description: 'Gran cassa', media: [], instruments: [], needsReview: true }
        ];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });
        component['togglePart'](component['draftScores'][0]);
        component['togglePart'](component['draftScores'][1]);

        expect(component['selectedReviewCount']).toBe(2);
        component['confirmMarkSelectedReviewed']();

        expect(component['draftScores'].map((score) => score.needsReview)).toEqual([false, false, true]);
        expect(component['selectedReviewCount']).toBe(0);
    });

    it('keeps the review flag of a part shown in read only mode', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, description: 'Ottavino', media: [], instruments: [], needsReview: true }];
        component.readOnly = true;
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['markReviewed']();

        expect(component['draftScores'][0].needsReview).toBeTrue();
    });

    it('requests image editing only for a persisted page on a clean track', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, description: 'Clarinetto', media: [{ index: 10 }], instruments: [] }];
        const events: number[] = [];
        component.imageEdit.subscribe((event) => events.push(event.media.index));
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['editImage'](component['draftScores'][0], component['draftScores'][0].media![0], 0);
        component.trackDirty = true;
        component['editImage'](component['draftScores'][0], component['draftScores'][0].media![0], 0);

        expect(events).toEqual([10]);
    });
    it('moves the dragged pages into the part they are dropped on', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, media: [{ index: 10 }, { index: 11 }], instruments: [] },
            { id: 2, order: 2, media: [], instruments: [] }
        ];
        const events: string[] = [];
        component.uxEvent.subscribe((event) => events.push(event));
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['onPageDragStart'](0, 0, 10);
        component['onPartRowDrop'](1, dragEvent());

        expect(component['draftScores'][0].media?.map((media) => media.index)).toEqual([11]);
        expect(component['draftScores'][1].media?.map((media) => media.index)).toEqual([10]);
        expect(component['selectedScoreIndex']).toBe(1);
        expect(events).toEqual(['move']);
    });

    it('shows the insertion gap on the side of the card the pointer is on', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, media: [{ index: 10 }, { index: 11 }], instruments: [] }];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });
        component['onPageDragStart'](0, 0, 10);

        component['onPageDragOver'](1, cardDragEvent(120));
        expect(component['pageDropIndex']).toBe(1);

        component['onPageDragOver'](1, cardDragEvent(180));
        expect(component['pageDropIndex']).toBe(2);

        component['onPageDragEnd']();
        expect(component['pageDropIndex']).toBeUndefined();
    });

    it('marks the part under a dragged page as the drop target', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, media: [{ index: 10 }], instruments: [] },
            { id: 2, order: 2, media: [], instruments: [] }
        ];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['onPartRowDragOver'](1, dragEvent());
        expect(component['partDropIndex']).toBeUndefined();

        component['onPageDragStart'](0, 0, 10);
        component['onPartRowDragOver'](1, dragEvent());
        expect(component['partDropIndex']).toBe(1);

        component['onPartRowDragLeave'](1);
        expect(component['partDropIndex']).toBeUndefined();
    });

    it('walks the parts list with the arrows and selects a contiguous range with Shift', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, description: 'Clarinetto', media: [], instruments: [] },
            { id: 2, order: 2, description: 'Tromba', media: [], instruments: [] },
            { id: 3, order: 3, description: 'Flauto', media: [], instruments: [] }
        ];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['onPartKeydown'](0, keyboardEvent('ArrowDown'));
        expect(component['selectedScoreIndex']).toBe(1);
        expect(component['mobileDetail']).toBeFalse();

        component['onPartKeydown'](1, keyboardEvent('ArrowDown', { shiftKey: true }));

        expect(component['selectingParts']).toBeTrue();
        expect(component['selectedPartKeys'].size).toBe(2);
        expect(component['selectedScoreIndex']).toBe(2);
    });

    it('selects contiguous pages with Shift and the arrows', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, media: [{ index: 10 }, { index: 11 }, { index: 12 }], instruments: [] }];
        const thumbnail = jasmine.createSpyObj<MediaThumbnailComponent>('MediaThumbnailComponent', ['openPreview']);
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        component['onPageKeydown'](0, 10, thumbnail, keyboardEvent('ArrowRight', { shiftKey: true }));
        component['onPageKeydown'](1, 11, thumbnail, keyboardEvent('ArrowRight', { shiftKey: true }));

        expect([...component['selectedMediaIds']]).toEqual([10, 11, 12]);
        expect(thumbnail.openPreview).not.toHaveBeenCalled();
    });

    it('closes with Escape the page selection, then the part selection mode, then the mobile detail', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const initial: SheetsMusic[] = [{ id: 1, order: 1, media: [{ index: 10 }], instruments: [] }];
        component.scores = initial;
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });
        component['selectedMediaIds'] = new Set([10]);
        component['selectingParts'] = true;
        component['mobileDetail'] = true;

        component['onEscape'](keyboardEvent('Escape'));
        expect(component['selectedMediaIds'].size).toBe(0);
        expect(component['selectingParts']).toBeTrue();

        component['onEscape'](keyboardEvent('Escape'));
        expect(component['selectingParts']).toBeFalse();

        component['onEscape'](keyboardEvent('Escape'));
        expect(component['mobileDetail']).toBeFalse();
    });

    it('leaves Escape to the field that is being edited inline', () => {
        const component = new ScoreWorkspaceComponent(null!);
        component['selectedMediaIds'] = new Set([10]);
        component['beginInlineEdit']();

        const event = keyboardEvent('Escape');
        component['onEscape'](event);

        expect(component['selectedMediaIds'].size).toBe(1);
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('resizes the panels from the keyboard and restores them with Home', () => {
        const component = new ScoreWorkspaceComponent(null!);

        expect(component['gridColumns']).toBeNull();

        component['onDividerKeydown'](keyboardEvent('ArrowLeft'));
        expect(component['partsRatio']).toBe(32);
        expect(component['gridColumns']).toBe('minmax(0, 32%) auto minmax(0, 1fr)');

        for (let step = 0; step < 10; step++) component['onDividerKeydown'](keyboardEvent('ArrowLeft'));
        expect(component['partsRatio']).toBe(24);

        component['onDividerKeydown'](keyboardEvent('Home'));
        expect(component['gridColumns']).toBeNull();
    });

    it('keeps a draft that is ahead of the server as unsaved', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const server: SheetsMusic[] = [{ id: 1, order: 1, description: 'Clarinetto', media: [], instruments: [] }];
        const draft: SheetsMusic[] = [...server, { id: 2, order: 2, description: 'Flauto', media: [], instruments: [] }];
        const dirtyStates: boolean[] = [];
        component.dirtyChange.subscribe((dirty) => dirtyStates.push(dirty));
        component.scores = draft;
        component.baseline = server;

        component.ngOnChanges({ scores: new SimpleChange(undefined, draft, true) });

        expect(dirtyStates).toEqual([true]);
    });

    it('labels the saved parts without pages and asks to engrave them on a clean track', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const written: SheetsMusic = { id: 1, order: 1, description: 'Flicorno', media: [], instruments: [], currentScoreVersionId: 7 };
        const requests: unknown[] = [];
        component.engraveRequested.subscribe((request) => requests.push(request));

        expect(component['toEngrave'](written)).toBeTrue();
        expect(component['toEngrave']({ id: 2, media: [{ index: 3 }], currentScoreVersionId: 8 })).toBeFalse();
        expect(component['toEngrave']({ media: [], currentScoreVersionId: 8 })).toBeFalse();

        component['requestEngraving'](written);
        component.canEngrave = true;
        component.trackDirty = true;
        component['requestEngraving'](written);
        expect(requests).toEqual([]);

        component.trackDirty = false;
        component['requestEngraving'](written);
        component['requestEngraving']({ id: 2, media: [{ index: 3 }], currentScoreVersionId: 8 });
        expect(requests).toEqual([{ score: written, label: 'Flicorno' }]);
    });

    it('asks for a PDF from the add zone', () => {
        const component = new ScoreWorkspaceComponent(null!);
        let asked = 0;
        component.pdfRequested.subscribe(() => asked++);

        component['requestPdf']();

        expect(asked).toBe(1);
    });

    /**
     * Il gate di prestazioni della specifica: 200 parti e 1 000 pagine. Qui si misurano le
     * operazioni e il filtro, non il rendering, e si verifica che oltre la soglia l'elenco passi
     * allo scroller virtuale, che è quel che tiene il DOM limitato con raccolte simili.
     */
    it('keeps the operations on 200 parts and 1 000 pages within budget and virtualizes the list', () => {
        const component = new ScoreWorkspaceComponent(null!);
        const large: SheetsMusic[] = Array.from({ length: 200 }, (ignored, part) => ({
            id: part + 1,
            order: part + 1,
            description: `Parte ${part + 1}`,
            instruments: [{ index: part + 1, name: `Strumento ${part + 1}` }],
            media: Array.from({ length: 5 }, (ignoredPage, page) => ({ index: part * 5 + page + 1 }))
        }));
        component.scores = large;

        const started = performance.now();
        component.ngOnChanges({ scores: new SimpleChange(undefined, large, true) });
        component['selectedMediaIds'] = new Set([1, 2]);
        component['moveTargetIndex'] = 199;
        component['moveSelectedPages']();
        component['filterQuery'] = 'Parte 137';
        const filtered = component['filteredScores'];
        const elapsed = performance.now() - started;

        expect(component['draftScores']).toHaveSize(200);
        expect(component['draftScores'][199].media).toHaveSize(7);
        expect(filtered).toHaveSize(1);
        expect(elapsed).toBeLessThan(2_000);

        component['filterQuery'] = '';
        expect(component['virtualizedParts']).toBeTrue();
        expect(component['partRowSize']).toBe(88);
    });

    it('labels the parts with instruments to add and warns before merging them', () => {
        const confirmService = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirmReversible']);
        const component = new ScoreWorkspaceComponent(confirmService);
        const initial: SheetsMusic[] = [
            { id: 1, order: 1, description: 'Clarinetto basso', media: [], instruments: [] },
            { id: 2, order: 2, description: 'Fagotto', media: [], instruments: [] },
            { id: 3, order: 3, description: 'Tuba', media: [], instruments: [] }
        ];
        component.scores = initial;
        component.suggestionPartIds = [1];
        component.ngOnChanges({ scores: new SimpleChange(undefined, initial, true) });

        expect(component['hasOpenSuggestions'](component['draftScores'][0])).toBeTrue();
        expect(component['hasOpenSuggestions'](component['draftScores'][1])).toBeFalse();
        expect(component['hasOpenSuggestions']({ description: 'Nuova' })).toBeFalse();

        component['togglePart'](component['draftScores'][0]);
        component['togglePart'](component['draftScores'][1]);
        component['confirmMerge']();
        expect(confirmService.confirmReversible.calls.mostRecent().args[0].consequence).toContain('Alcune parti hanno strumenti da aggiungere');

        component['selectedPartKeys'] = new Set<string>();
        component['togglePart'](component['draftScores'][1]);
        component['togglePart'](component['draftScores'][2]);
        component['confirmMerge']();
        expect(confirmService.confirmReversible.calls.mostRecent().args[0].consequence).not.toContain('strumenti da aggiungere');
    });
});

function dragEvent(): DragEvent {
    return { preventDefault: jasmine.createSpy('preventDefault'), stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as DragEvent;
}

function cardDragEvent(clientX: number): DragEvent {
    return {
        clientX,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation'),
        currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 60 }) }
    } as unknown as DragEvent;
}

function keyboardEvent(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
        key,
        ctrlKey: false,
        shiftKey: false,
        target: null,
        currentTarget: null,
        ...modifiers,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation')
    } as unknown as KeyboardEvent;
}
