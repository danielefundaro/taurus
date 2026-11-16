import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { PlaybackInstrument, PlaybackSound, ScoreFragment } from '../../module';
import { pitchOf } from '../../score-editor/score-document';
import { fragmentNotation, PreparedFragment } from '../../score-editor/score-fragments';
import { ConfirmService, ScoreAudioService, ScoreFragmentService, ScoreRendererService } from '../../service';
import { ScoreFragmentDialogComponent } from '../score-fragment-dialog/score-fragment-dialog.component';
import { openFragmentsDialog, ScoreFragmentsDialogComponent, ScoreFragmentsDialogData, ScoreFragmentsDialogResult } from './score-fragments-dialog.component';

const ALTO_SAX: PlaybackInstrument = { id: 2, name: 'Sax contralto', transpositionSemitones: -9, configured: true, lowestWrittenPitch: 58, highestWrittenPitch: 89 };
const SAX_SOUND: PlaybackSound = { transpositionSemitones: -9, percussionKeys: [], configured: true, conflicting: false };

const SIGNAL: ScoreFragment = { id: 1, name: 'Squillo', category: 'SIGNAL', note: 'Prima della sfilata', kind: 'PITCHED', measureCount: 1, percussionKeys: [], entityVersion: 0 };
const MARCH: ScoreFragment = { id: 2, name: 'Marcia breve', category: 'MARCH', kind: 'PITCHED', measureCount: 1, percussionKeys: [], entityVersion: 0 };
const ROLL: ScoreFragment = { id: 3, name: 'Rullo', category: 'ROLL', kind: 'PERCUSSION', measureCount: 1, percussionKeys: [{ voice: 1, key: 38 }], entityVersion: 0 };

/** Do, Re, Mi, Fa in suoni reali, in Do maggiore e 4/4. */
const CONCERT =
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Frammento</part-name></score-part></part-list><part id="P1">' +
    '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
    ['C', 'D', 'E', 'F'].map((step) => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`).join('') +
    '</measure></part></score-partwise>';

interface Library {
    fragments: ScoreFragment[];
    query: string;
    category: string | null;
    visible: ScoreFragment[];
    selected: ScoreFragment | null;
    prepared: PreparedFragment | null;
    prepareError: string | null;
    blocker: string | null;
    octave: number | null;
    octaves: { value: number; label: string }[];
    atEnd: boolean;
    canInsert: boolean;
    playing: boolean;
    subtitle: string;
    select(fragment: ScoreFragment): void;
    changedOctave(octave: number): void;
    changedPosition(): void;
    togglePlay(): Promise<void>;
    edit(fragment: ScoreFragment): void;
    remove(fragment: ScoreFragment): void;
    insert(): void;
    close(): void;
}

describe('ScoreFragmentsDialogComponent', () => {
    let fixture: ComponentFixture<ScoreFragmentsDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let service: jasmine.SpyObj<ScoreFragmentService>;
    let renderer: jasmine.SpyObj<ScoreRendererService>;
    let audio: jasmine.SpyObj<ScoreAudioService>;
    let confirm: jasmine.SpyObj<ConfirmService>;

    const data = (overrides: Partial<ScoreFragmentsDialogData> = {}): ScoreFragmentsDialogData => ({
        notation: fragmentNotation([ALTO_SAX], SAX_SOUND),
        clef: 'G2',
        endClef: 'G2',
        measureNumber: '5',
        sound: SAX_SOUND,
        arrangement: false,
        ...overrides
    });

    const setup = async (config: ScoreFragmentsDialogData = data()): Promise<Library> => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        service = jasmine.createSpyObj('ScoreFragmentService', ['list', 'content', 'delete']);
        service.list.and.resolveTo([MARCH, ROLL, SIGNAL]);
        service.content.and.resolveTo(CONCERT);
        service.delete.and.resolveTo();
        renderer = jasmine.createSpyObj('ScoreRendererService', ['render']);
        renderer.render.and.resolveTo(['<svg class="preview"></svg>']);
        audio = jasmine.createSpyObj('ScoreAudioService', ['ready', 'load', 'play', 'pause', 'setChannel']);
        audio.ready.and.resolveTo(undefined as never);
        audio.load.and.resolveTo();
        audio.play.and.resolveTo();
        confirm = jasmine.createSpyObj('ConfirmService', ['confirmDestructive', 'confirmDiscard']);
        await TestBed.configureTestingModule({
            imports: [ScoreFragmentsDialogComponent],
            providers: [
                ConfirmationService,
                { provide: DynamicDialogConfig, useValue: { data: config } },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScoreFragmentService, useValue: service },
                { provide: ScoreRendererService, useValue: renderer },
                { provide: ScoreAudioService, useValue: audio },
                { provide: ConfirmService, useValue: confirm }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ScoreFragmentsDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.componentInstance as unknown as Library;
    };

    const settle = async (): Promise<void> => {
        await fixture.whenStable();
        fixture.detectChanges();
    };

    const written = (library: Library): string[] =>
        library
            .prepared!.score.notes()
            .map((note) => pitchOf(note)!)
            .map((pitch) => `${pitch.step}${pitch.alter > 0 ? '#' : ''}${pitch.octave}`);

    it('searches the library by name and note and filters it by category', async () => {
        const library = await setup();
        expect(library.subtitle).toContain('prima della battuta 5 o in fondo');
        expect(library.visible.map((fragment) => fragment.name)).toEqual(['Marcia breve', 'Rullo', 'Squillo']);
        library.query = 'sfilata';
        expect(library.visible).toEqual([SIGNAL]);
        library.query = '';
        library.category = 'ROLL';
        expect(library.visible).toEqual([ROLL]);
        library.query = 'squillo';
        fixture.detectChanges();
        expect(library.visible).toEqual([]);
        expect(fixture.nativeElement.textContent).toContain('Nessun frammento con questa ricerca.');
    });

    it('prepares a concert fragment for the alto sax with the proposed octave, shows it and inserts it before the measure or at the end', async () => {
        const library = await setup();
        library.select(SIGNAL);
        await settle();

        expect(service.content).toHaveBeenCalledOnceWith(1);
        expect(library.octave).toBe(0);
        expect(written(library)).toEqual(['A5', 'B5', 'C#6', 'D6']);
        expect(library.octaves.map((option) => option.value)).toContain(-1);
        expect(library.octaves.find((option) => option.value === 0)?.label).toContain("Stesso suono del frammento · Sesta maggiore sopra · tutte le note nell'estensione");
        expect(renderer.render).toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('.score-fragments__notation svg.preview')).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Armatura iniziale per la parte');

        library.changedOctave(-1);
        await settle();
        expect(written(library)).toEqual(['A4', 'B4', 'C#5', 'D5']);
        // Il contenuto si legge una volta sola.
        expect(service.content).toHaveBeenCalledTimes(1);

        library.atEnd = true;
        library.changedPosition();
        expect(library.canInsert).toBeTrue();
        library.insert();
        const result = dialogRef.close.calls.mostRecent().args[0] as ScoreFragmentsDialogResult;
        expect(result.fragment).toEqual(SIGNAL);
        expect(result.atEnd).toBeTrue();
        expect(result.prepared.octave).toBe(-1);
    });

    it('prepares the fragment again in the clef at the end of the part', async () => {
        const library = await setup(data({ endClef: 'F4' }));
        library.select(SIGNAL);
        await settle();
        expect(library.prepared!.score.document.querySelector('clef sign')?.textContent).toBe('G');
        library.atEnd = true;
        library.changedPosition();
        await settle();
        expect(library.prepared!.score.document.querySelector('clef sign')?.textContent).toBe('F');
    });

    it('says which sounds a drum fragment needs and does not insert it', async () => {
        const library = await setup(data({ notation: fragmentNotation([{ id: 5, name: 'Gran cassa', percussionKey: 36, configured: true }], { percussionKeys: [36], configured: true, conflicting: false }) }));
        library.select(ROLL);
        await settle();

        expect(library.blocker).toBe('Mancano nella parte il suono tamburo');
        expect(service.content).not.toHaveBeenCalled();
        expect(library.canInsert).toBeFalse();
        expect(fixture.nativeElement.textContent).toContain('Il frammento non entra qui');
        library.insert();
        expect(dialogRef.close).not.toHaveBeenCalled();

        // Un frammento intonato in una parte di percussione non entra.
        library.select(SIGNAL);
        await settle();
        expect(library.blocker).toBe('Un frammento intonato entra solo in una parte intonata');
    });

    it('shows why the fragment cannot be written for the part', async () => {
        const library = await setup();
        service.content.and.resolveTo('<not-musicxml');
        library.select(MARCH);
        await settle();
        expect(library.prepareError).toBeTruthy();
        expect(library.canInsert).toBeFalse();
    });

    it('goes at the end without a selected measure', async () => {
        const library = await setup(data({ measureNumber: null, arrangement: true }));
        expect(library.atEnd).toBeTrue();
        expect(library.subtitle).toContain('in tutti i righi');
        expect(library.subtitle).toContain(', in fondo.');
    });

    it('listens to the fragment as it will be written and stops', async () => {
        const library = await setup();
        library.select(SIGNAL);
        await settle();
        await library.togglePlay();

        expect(audio.load).toHaveBeenCalled();
        expect(audio.play).toHaveBeenCalled();
        expect(library.playing).toBeTrue();
        await library.togglePlay();
        expect(audio.pause).toHaveBeenCalled();
        expect(library.playing).toBeFalse();
        library.close();
        expect(dialogRef.close).toHaveBeenCalledWith();
    });

    it('changes a fragment and deletes another after the confirmation', async () => {
        const library = await setup();
        const dialogs = fixture.debugElement.injector.get(DialogService);
        const onClose = new Subject<ScoreFragment | undefined>();
        const open = spyOn(dialogs, 'open').and.returnValue({ onClose } as never);
        library.select(SIGNAL);
        await settle();

        library.edit(SIGNAL);
        expect(open.calls.mostRecent().args[0]).toBe(ScoreFragmentDialogComponent);
        expect(open.calls.mostRecent().args[1]?.data).toEqual({ fragment: SIGNAL });
        // Esc chiude il dialogo sopra la biblioteca, non la biblioteca.
        library.close();
        expect(dialogRef.close).not.toHaveBeenCalled();
        onClose.next({ ...SIGNAL, name: 'Attenti', entityVersion: 1 });
        expect(library.fragments.map((fragment) => fragment.name)).toEqual(['Attenti', 'Marcia breve', 'Rullo']);
        expect(library.selected?.name).toBe('Attenti');

        library.remove(library.selected!);
        expect(confirm.confirmDestructive).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Eliminare il frammento?', actionLabel: 'Elimina' }));
        library.close();
        expect(dialogRef.close).not.toHaveBeenCalled();
        confirm.confirmDestructive.calls.mostRecent().args[0].accept();
        await settle();

        expect(service.delete).toHaveBeenCalledWith(1, jasmine.anything());
        expect(library.fragments.map((fragment) => fragment.name)).toEqual(['Marcia breve', 'Rullo']);
        expect(library.selected).toBeNull();
        expect(library.prepared).toBeNull();
    });

    it('keeps a fragment that could not be deleted', async () => {
        const library = await setup();
        service.delete.and.rejectWith(new Error('rifiutato'));
        library.remove(ROLL);
        confirm.confirmDestructive.calls.mostRecent().args[0].accept();
        await settle();
        expect(library.fragments).toContain(ROLL);

        // Rinunciando all'eliminazione la biblioteca torna a chiudersi con Esc.
        library.remove(ROLL);
        confirm.confirmDestructive.calls.mostRecent().args[0].reject!();
        library.close();
        expect(dialogRef.close).toHaveBeenCalledWith();
    });

    it('opens as a dialog and returns the choice', () => {
        const onClose = new Subject<ScoreFragmentsDialogResult | undefined>();
        const dialogs = jasmine.createSpyObj<DialogService>('DialogService', ['open']);
        dialogs.open.and.returnValue({ onClose } as never);
        const results: (ScoreFragmentsDialogResult | undefined)[] = [];
        openFragmentsDialog(dialogs, data()).subscribe((result) => results.push(result));
        onClose.next(undefined);

        expect(dialogs.open.calls.mostRecent().args[0]).toBe(ScoreFragmentsDialogComponent);
        expect(results).toEqual([undefined]);
    });

    it('says when the library is empty or cannot be read', async () => {
        const library = await setup();
        library.fragments = [];
        fixture.componentRef.changeDetectorRef.markForCheck();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Nessun frammento');

        service.list.and.rejectWith(new Error('rete'));
        await (fixture.componentInstance as unknown as { ngOnInit(): Promise<void> }).ngOnInit();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Biblioteca non leggibile');
    });
});
