import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { PartPlayback, TrackPlayback } from '../../module';
import { InstrumentsService, ScoreDraftService, ScorePlaybackService } from '../../service';
import { DerivePartDialogComponent, DerivePartDialogData } from './derive-part-dialog.component';

function note(step: string, octave: number): string {
    return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
}

/** Parte di clarinetto in 4/4: Do, Re, Mi, Fa nella quinta ottava, poi una battuta con un cambio di armatura. */
function source(firstKey = 0, secondKey = 0): string {
    return (
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinetto 1°</part-name></score-part></part-list><part id="P1">' +
        `<measure number="1"><attributes><divisions>1</divisions><key><fifths>${firstKey}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
        `${note('C', 5)}${note('D', 5)}${note('E', 5)}${note('F', 5)}</measure>` +
        `<measure number="2"><attributes><key><fifths>${secondKey}</fifths></key></attributes>${note('C', 5)}${note('C', 5)}${note('C', 5)}${note('C', 5)}</measure>` +
        '</part></score-partwise>'
    );
}

const INSTRUMENTS = [
    { id: 14, name: 'Clarinetto 1°', transpositionSemitones: -2, lowestWrittenPitch: 52, highestWrittenPitch: 96 },
    { id: 21, name: 'Sax contralto', transpositionSemitones: -9, lowestWrittenPitch: 58, highestWrittenPitch: 89 },
    { id: 22, name: 'Tuba', transpositionSemitones: 0, bassClefTranspositionSemitones: 0, lowestWrittenPitch: 26, highestWrittenPitch: 65 },
    { id: 23, name: 'Rullante', percussionKey: 38 },
    { id: 24, name: 'Oboe' },
    { id: 25, name: 'Flicorno soprano', transpositionSemitones: -2 }
];

function clarinet(): PartPlayback {
    return {
        scoreId: 9,
        order: 1,
        description: 'Clarinetto 1°',
        instruments: [{ id: 14, name: 'Clarinetto 1°', transpositionSemitones: -2, configured: true }],
        ownPart: true,
        sound: { transpositionSemitones: -2, percussionKeys: [], configured: true, conflicting: false },
        availability: 'AVAILABLE',
        version: { id: 7, versionNumber: 3, status: 'APPROVED', origin: 'WRITING', measureCount: 2, checks: null as never, pagesChanged: false },
        hasPages: false,
        openReports: 0
    };
}

describe('DerivePartDialogComponent', () => {
    let fixture: ComponentFixture<DerivePartDialogComponent>;
    let dialogRef: jasmine.SpyObj<DynamicDialogRef>;
    let playbackService: jasmine.SpyObj<ScorePlaybackService>;
    let drafts: jasmine.SpyObj<ScoreDraftService>;
    let instruments: jasmine.SpyObj<InstrumentsService>;
    let config: { data: DerivePartDialogData };

    const playback = (parts: PartPlayback[]): TrackPlayback => ({ trackId: 5, trackName: 'Marcia', version: 4, tempoBpm: 96, parts, recognitionAvailable: false });

    beforeEach(async () => {
        dialogRef = jasmine.createSpyObj('DynamicDialogRef', ['close']);
        playbackService = jasmine.createSpyObj('ScorePlaybackService', ['playbackFile']);
        playbackService.playbackFile.and.returnValue(of(source()));
        drafts = jasmine.createSpyObj('ScoreDraftService', ['derivePart']);
        drafts.derivePart.and.resolveTo({ scoreId: 12, trackVersion: 5 });
        instruments = jasmine.createSpyObj('InstrumentsService', ['getAll']);
        instruments.getAll.and.returnValues(of({ content: INSTRUMENTS.slice(0, 3), totalElements: INSTRUMENTS.length }) as never, of({ content: INSTRUMENTS.slice(3), totalElements: INSTRUMENTS.length }) as never);
        const part = clarinet();
        config = { data: { trackId: 5, playback: playback([part]), part } };
        await TestBed.configureTestingModule({
            imports: [DerivePartDialogComponent],
            providers: [
                ConfirmationService,
                provideRouter([]),
                { provide: DynamicDialogConfig, useValue: config },
                { provide: DynamicDialogRef, useValue: dialogRef },
                { provide: ScorePlaybackService, useValue: playbackService },
                { provide: ScoreDraftService, useValue: drafts },
                { provide: InstrumentsService, useValue: instruments }
            ]
        }).compileComponents();
    });

    async function open(): Promise<Dialog> {
        fixture = TestBed.createComponent(DerivePartDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.componentInstance as unknown as Dialog;
    }

    /** Ridisegna il dialogo, che aggiorna la vista solo quando cambia qualcosa. */
    function refresh(): void {
        fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
        fixture.detectChanges();
    }

    function choose(dialog: Dialog, instrumentId: number): void {
        dialog.instrumentId = instrumentId;
        dialog.changedInstrument();
        refresh();
    }

    it('offers the pitched instruments of the association but the one of the part, the unconfigured ones disabled', async () => {
        const dialog = await open();

        expect(playbackService.playbackFile).toHaveBeenCalledWith(5, 9);
        expect(instruments.getAll).toHaveBeenCalledTimes(2);
        expect(dialog.heading).toBe('Ricava una parte da Clarinetto 1°');
        expect(dialog.subtitle).toContain('versione 3');
        expect(dialog.instruments.map((instrument) => [instrument.id, instrument.label, instrument.disabled])).toEqual([
            [21, 'Sax contralto', false],
            [22, 'Tuba', false],
            [24, 'Oboe (da configurare)', true],
            [25, 'Flicorno soprano', false]
        ]);
        expect(dialog.errors).toEqual(['Scegli lo strumento.']);
        await dialog.save();
        expect(drafts.derivePart).not.toHaveBeenCalled();
    });

    it('derives the alto sax part a perfect fifth up and creates it with the transposed draft', async () => {
        const dialog = await open();
        choose(dialog, 21);

        expect(dialog.description).toBe('Sax contralto');
        expect(dialog.clef).toBe('G2');
        expect(dialog.octave).toBe(0);
        expect(dialog.keyLabel).toBe('Armatura: 1 diesis (Sol maggiore)');
        expect(dialog.rangeText).toBe('Si♭3–Fa6');
        expect(dialog.octaves.map((option) => option.value)).toEqual([-2, -1, 0, 1, 2]);
        expect(dialog.octaves.find((option) => option.value === 0)!.label).toBe("Stesso suono dell'originale · Quinta giusta sopra · tutte le note nell'estensione");
        expect(dialog.octaves.find((option) => option.value === 1)!.label).toBe("Un'ottava sopra · Quinta giusta e un'ottava sopra · 8 note fuori estensione");
        expect(dialog.octaves.find((option) => option.value === -1)!.label).toBe("Un'ottava sotto · Quarta giusta sotto · tutte le note nell'estensione");
        expect(fixture.nativeElement.textContent).toContain("Tutte le note sono nell'estensione di Sax contralto (Si♭3–Fa6)");

        dialog.octave = 1;
        dialog.changedOctave();
        refresh();
        expect(fixture.nativeElement.textContent).toContain('nelle battute 1, 2');
        dialog.octave = 0;
        dialog.changedOctave();

        await dialog.save();
        const [trackId, scoreId, request] = drafts.derivePart.calls.mostRecent().args;
        expect([trackId, scoreId]).toEqual([5, 9]);
        expect(request).toEqual(jasmine.objectContaining({ versionId: 7, instrumentId: 21, description: 'Sax contralto', trackVersion: 4 }));
        const document = new DOMParser().parseFromString(request.content, 'application/xml');
        expect(document.querySelector('part-name')?.textContent).toBe('Sax contralto');
        expect(Array.from(document.querySelectorAll('fifths')).map((item) => item.textContent)).toEqual(['1', '1']);
        expect(
            Array.from(document.querySelectorAll('pitch'))
                .slice(0, 4)
                .map((pitch) => `${pitch.querySelector('step')?.textContent}${pitch.querySelector('octave')?.textContent}`)
        ).toEqual(['G5', 'A5', 'B5', 'C6']);
        expect(dialogRef.close).toHaveBeenCalledWith({ scoreId: 12, trackVersion: 5 });
    });

    it('proposes the bass clef for the tuba and the octave inside its range', async () => {
        const dialog = await open();
        choose(dialog, 22);

        expect(dialog.clef).toBe('F4');
        expect(dialog.octave).toBe(-1);
        expect(dialog.chosen?.label).toBe("Seconda maggiore e un'ottava sotto");
        expect(dialog.keyLabel).toBe('Armatura: 2 bemolli (Si♭ maggiore)');

        // Nome e chiave scelti a mano restano quando cambia lo strumento.
        dialog.description = 'Basso 1°';
        dialog.changedDescription();
        dialog.clef = 'G2';
        dialog.changedClef();
        dialog.octave = -2;
        dialog.changedOctave();
        choose(dialog, 21);
        expect([dialog.description, dialog.clef]).toEqual(['Basso 1°', 'G2']);
        // L'ottava si propone di nuovo per lo strumento nuovo.
        expect(dialog.octave).toBe(0);
    });

    it('says when the instrument has no range and opens it to configure', async () => {
        const dialog = await open();
        const router = TestBed.inject(Router);
        spyOn(router, 'navigate').and.resolveTo(true);
        choose(dialog, 25);

        expect(dialog.rangeText).toBeNull();
        expect(dialog.octave).toBe(0);
        expect(dialog.octaves.find((option) => option.value === 0)!.label).toBe("Stesso suono dell'originale · Unisono");
        expect(fixture.nativeElement.textContent).toContain("non ha l'estensione configurata");

        dialog.configure();
        expect(dialogRef.close).toHaveBeenCalledWith();
        expect(router.navigate).toHaveBeenCalledWith(['/instruments', 25]);
    });

    it('does not create the part when no spelling of the interval works', async () => {
        playbackService.playbackFile.and.returnValue(of(source(7, -7)));
        const dialog = await open();
        choose(dialog, 21);

        expect(dialog.errors[0]).toContain('troppe alterazioni');
        expect(fixture.nativeElement.textContent).toContain('Parte non ricavabile');
        await dialog.save();
        expect(drafts.derivePart).not.toHaveBeenCalled();
    });

    it('stays open when the source cannot be read or the part is not created', async () => {
        drafts.derivePart.and.rejectWith(new Error('version.conflict'));
        const dialog = await open();
        choose(dialog, 21);
        await dialog.save();
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(dialog.saving).toBeFalse();

        playbackService.playbackFile.and.returnValue(throwError(() => new Error('offline')));
        instruments.getAll.and.returnValue(of({ content: INSTRUMENTS, totalElements: INSTRUMENTS.length }) as never);
        const unreadable = await open();
        expect(unreadable.loadError).toBeTrue();
        expect(unreadable.errors).toEqual(['La versione della parte non si legge.']);
        expect(fixture.nativeElement.textContent).toContain('Parte non leggibile');
    });
});

interface Dialog {
    loading: boolean;
    loadError: boolean;
    saving: boolean;
    heading: string;
    subtitle: string;
    instruments: { id: number; label: string; disabled: boolean }[];
    instrumentId: number | null;
    description: string;
    clef: string;
    octave: number;
    octaves: { value: number; label: string }[];
    chosen: { label: string } | null;
    keyLabel: string;
    rangeText: string | null;
    errors: string[];
    changedInstrument(): void;
    changedDescription(): void;
    changedClef(): void;
    changedOctave(): void;
    configure(): void;
    save(): Promise<void>;
}
