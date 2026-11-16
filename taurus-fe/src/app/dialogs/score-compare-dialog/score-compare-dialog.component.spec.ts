import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { ArrangementRow, ArrangementVersion, ScoreEditorData, ScoreVersion } from '../../module';
import { musicXml } from '../../score-player/score-player.testing';
import { ArrangementService, ScorePlaybackService, ScoreRendererService } from '../../service';
import { comparedWith, ScoreCompareDialogComponent, ScoreCompareDialogData } from './score-compare-dialog.component';

const FIRST = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';

function note(step: string, octave = 5): string {
    return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration></note>`;
}

/** Una parte di semibrevi, una per battuta. */
function part(steps: string[]): string {
    return musicXml(steps.map((step, index) => `${index === 0 ? FIRST : ''}${note(step)}`));
}

/** Una partitura con i righi indicati, ognuno con le sue battute. */
function score(rows: { id: string; name: string; measures: string[] }[]): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>${rows.map((row) => `<score-part id="${row.id}"><part-name>${row.name}</part-name></score-part>`).join('')}</part-list>
  ${rows.map((row) => `<part id="${row.id}">${row.measures.map((content, index) => `<measure number="${index + 1}">${index === 0 ? FIRST : ''}${content}</measure>`).join('')}</part>`).join('')}
</score-partwise>`;
}

/** Disegno finto: un `g.measure` per battuta del primo rigo, come Verovio. */
function drawing(xml: string): string[] {
    const part = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('part')[0];
    const measures = Array.from(part?.getElementsByTagName('measure') ?? []).map((measure) => `<g class="measure" data-n="${measure.getAttribute('number')}"></g>`);
    return [`<svg xmlns="http://www.w3.org/2000/svg">${measures.join('')}</svg>`];
}

function version(id: number, versionNumber: number, overrides: Partial<ScoreVersion> = {}): ScoreVersion {
    return { id, scoreId: 9, versionNumber, origin: 'UPLOAD_MUSICXML', status: 'APPROVED', measureCount: 4, checks: null as never, createdAt: '2026-11-10T10:00:00Z', current: false, pagesChanged: false, ...overrides };
}

describe('ScoreCompareDialogComponent', () => {
    let fixture: ComponentFixture<ScoreCompareDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let playbackService: jasmine.SpyObj<ScorePlaybackService>;
    let arrangementService: jasmine.SpyObj<ArrangementService>;
    let renderer: jasmine.SpyObj<ScoreRendererService>;

    const contents = new Map<number, string>([
        [11, part(['C', 'D', 'E', 'F'])],
        [12, part(['C', 'A', 'E', 'F', 'G'])],
        [13, part(['C', 'A', 'E', 'F', 'G'])],
        [14, part(['C', 'E', 'F', 'G'])]
    ]);
    const versions = [version(11, 1), version(12, 2, { origin: 'CORRECTION', status: 'UNVERIFIED', parentVersionId: 11 }), version(13, 3, { origin: 'WRITING', status: 'UNVERIFIED' }), version(14, 4, { origin: 'ARRANGEMENT' })];

    async function open(data: Partial<ScoreCompareDialogData>): Promise<void> {
        await TestBed.configureTestingModule({
            imports: [ScoreCompareDialogComponent],
            providers: [
                { provide: DynamicDialogConfig, useValue: { data: { trackId: 4, scoreId: 9, subject: 'Tromba 1ª', versionId: 12, correctable: true, ...data } } },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playbackService },
                { provide: ArrangementService, useValue: arrangementService },
                { provide: ScoreRendererService, useValue: renderer }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ScoreCompareDialogComponent);
        fixture.detectChanges();
        await settle();
    }

    async function settle(): Promise<void> {
        for (let round = 0; round < 6; round++) {
            await fixture.whenStable();
            await new Promise((resolve) => setTimeout(resolve));
            fixture.detectChanges();
        }
    }

    const element = (): HTMLElement => fixture.nativeElement;
    const texts = (): string[] => Array.from(element().querySelectorAll('.score-compare__item span:first-child'), (item) => item.textContent?.trim() ?? '');
    const side = (index: number) => element().querySelectorAll('.score-compare__side')[index] as HTMLElement;
    const measure = (sideIndex: number, number: string) => side(sideIndex).querySelector(`g.measure[data-n="${number}"]`)!;
    const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key }));

    beforeEach(() => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        playbackService = jasmine.createSpyObj('ScorePlaybackService', ['versions', 'editor']);
        playbackService.versions.and.returnValue(of(versions));
        playbackService.editor.and.callFake((_trackId, _scoreId, versionId) => of({ musicXml: contents.get(versionId)! } as ScoreEditorData));
        arrangementService = jasmine.createSpyObj('ArrangementService', ['versions', 'content']);
        renderer = jasmine.createSpyObj('ScoreRendererService', ['render']);
        renderer.render.and.callFake(async (xml: string) => drawing(xml));
    });

    it('compares a correction with the version it corrected, the older on the left', async () => {
        await open({});

        expect(side(0).textContent).toContain('Versione 1');
        expect(side(1).textContent).toContain('Versione 2');
        expect(side(1).textContent).toContain('Correzione');
        expect(element().textContent).toContain('Differenza 1 di 2');
        expect(texts()).toEqual(['Battuta 2: altezze diverse (La5 invece di Re5)', 'Battuta 5: solo nella versione 2']);
        expect(measure(0, '2').classList).toContain('is-changed');
        expect(measure(1, '2').classList).toContain('is-changed');
        expect(measure(1, '2').classList).toContain('is-current');
        expect(measure(1, '5').classList).toContain('is-only');
        expect(measure(1, '1').classList.length).toBe(1);
    });

    it('moves between the differences with the buttons and the arrow keys', async () => {
        await open({});

        press('ArrowRight');
        fixture.detectChanges();
        expect(element().textContent).toContain('Differenza 2 di 2');
        expect(measure(1, '5').classList).toContain('is-current');
        expect(measure(1, '2').classList).not.toContain('is-current');

        press('ArrowRight');
        fixture.detectChanges();
        expect(element().textContent).toContain('Differenza 2 di 2');

        press('ArrowLeft');
        fixture.detectChanges();
        expect(measure(1, '2').classList).toContain('is-current');

        (element().querySelectorAll('.score-compare__item')[1] as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(element().querySelector('.score-compare__item--current')?.textContent).toContain('Battuta 5');
    });

    it('opens the correction of the version on the right at the measure of the chosen difference', async () => {
        await open({});

        press('ArrowRight');
        (element().querySelector('.score-compare__actions p-button button') as HTMLButtonElement).click();

        expect(dialogRef.close).toHaveBeenCalledWith({ correctVersionId: 12, measureIndex: 4 });
    });

    it('compares with the previous version without a parent, and says when they sound the same', async () => {
        await open({ versionId: 13 });

        expect(side(0).textContent).toContain('Versione 2');
        expect(side(1).textContent).toContain('Versione 3');
        expect(texts()).toEqual([]);
        expect(element().textContent).toContain('Le due versioni si ascoltano uguali');
    });

    it('compares with another version chosen in «Con», still with the older on the left', async () => {
        await open({ versionId: 13 });
        const component = fixture.componentInstance as unknown as { otherId: number; changeOther(): Promise<void> };

        component.otherId = 14;
        await component.changeOther();
        await settle();

        expect(side(0).textContent).toContain('Versione 3');
        expect(side(1).textContent).toContain('Versione 4');
        expect(texts()).toEqual(['Battuta 2: solo nella versione 3']);
        expect(measure(0, '2').classList).toContain('is-only');
    });

    it('opens the editor after a measure read twice on the measure that follows it', async () => {
        await open({ versionId: 14, withId: 13 });

        (element().querySelector('.score-compare__actions p-button button') as HTMLButtonElement).click();

        expect(dialogRef.close).toHaveBeenCalledWith({ correctVersionId: 14, measureIndex: 1 });
    });

    it('compares with the last version extracted from the score', async () => {
        await open({ versionId: 12, withOrigin: 'ARRANGEMENT' });

        expect(side(0).textContent).toContain('Versione 2');
        expect(side(1).textContent).toContain('Versione 4');
    });

    it('says when there is no other version and when the versions cannot be read', async () => {
        playbackService.versions.and.returnValue(of([versions[0]]));
        await open({ versionId: 11 });
        expect(element().textContent).toContain("Non c'è un'altra versione da confrontare");

        TestBed.resetTestingModule();
        playbackService.versions.and.returnValue(of(versions));
        playbackService.editor.and.returnValue(throwError(() => new Error('Rete non disponibile')));
        await open({});
        expect(element().textContent).toContain('Impossibile leggere le versioni da confrontare');
    });

    describe('for the score of the track', () => {
        const rows: ArrangementRow[] = [
            { id: 'P1', name: 'Tromba', instruments: [{ id: 1, name: 'Tromba in Sib', transpositionSemitones: -2, configured: true }] },
            { id: 'P2', name: 'Flauto', instruments: [{ id: 2, name: 'Flauto', transpositionSemitones: 0, configured: true }] }
        ];
        const arrangementVersion = (id: number, versionNumber: number, concertPitch: boolean): ArrangementVersion => ({
            id,
            versionNumber,
            status: 'APPROVED',
            concertPitch,
            measureCount: 1,
            checks: [],
            createdAt: '2026-11-10T10:00:00Z',
            current: false
        });

        beforeEach(() => {
            arrangementService.versions.and.resolveTo([arrangementVersion(21, 1, false), arrangementVersion(22, 2, true)]);
            const transposed = score([
                { id: 'P1', name: 'Tromba', measures: [note('D')] },
                { id: 'P2', name: 'Flauto', measures: [note('G')] }
            ]);
            const concert = score([
                { id: 'P1', name: 'Tromba', measures: [note('C')] },
                { id: 'P2', name: 'Flauto', measures: [note('A')] },
                { id: 'P3', name: 'Oboe', measures: [note('E')] }
            ]);
            arrangementService.content.and.callFake(async (_trackId, versionId) => (versionId === 21 ? transposed : concert));
        });

        it('compares every row by its sound and shows the first with differences', async () => {
            await open({ scoreId: null, subject: 'Partitura', versionId: 22, rows, correctable: false });
            const component = fixture.componentInstance as unknown as { rowOptions: { label: string; value: string }[]; rowId: string };

            expect(component.rowOptions.map((option) => option.label)).toEqual(['Tromba · uguale', 'Flauto · 1 differenza', 'Oboe · solo nella versione 2']);
            expect(component.rowId).toBe('P2');
            expect(texts()).toEqual(['Battuta 1: altezze diverse (La5 invece di Sol5)']);
            expect(element().textContent).not.toContain('Correggi');
            expect(renderer.render.calls.mostRecent().args[0]).toContain('<part-name>Flauto</part-name>');
            expect(renderer.render.calls.mostRecent().args[0]).not.toContain('Tromba');
        });

        it('says that a row of only one version has no comparison', async () => {
            await open({ scoreId: null, subject: 'Partitura', versionId: 22, rows });
            const component = fixture.componentInstance as unknown as { rowId: string; changeRow(): Promise<void> };

            component.rowId = 'P3';
            await component.changeRow();
            await settle();

            expect(element().textContent).toContain('Il rigo è solo nella versione 2: senza confronto');
            expect(side(0).textContent).toContain("Il rigo non c'è in questa versione");
            expect(side(0).querySelector('g.measure')).toBeNull();
            expect(side(1).querySelector('g.measure')).not.toBeNull();
        });
    });

    it('chooses the version it derives from, or the previous, or for the first the next', () => {
        expect(comparedWith(versions, versions[1])?.id).toBe(11);
        expect(comparedWith(versions, versions[3])?.id).toBe(13);
        expect(comparedWith(versions, versions[0])?.id).toBe(12);
        expect(comparedWith([versions[0]], versions[0])).toBeNull();
    });
});
