import { TestBed } from '@angular/core/testing';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { ArrangementRow, PartPlayback, TrackPlayback } from '../../module';
import { ArrangementService, ScoreAudioService, ScorePlaybackService, ScoreRendererService, ToastService } from '../../service';
import { musicXml, readMidi } from '../../score-player/score-player.testing';
import { ScorePlayerDialogComponent, ScorePlayerDialogData } from './score-player-dialog.component';

const XML = musicXml(['<attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>']);

/** Partitura trasposta di due righi: clarinetto in Si♭ e tuba. */
const SCORE = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinetto</part-name></score-part><score-part id="P2"><part-name>Tuba</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice></note></measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice></note></measure></part></score-partwise>`;
const ROWS: ArrangementRow[] = [
    { id: 'P1', name: 'Clarinetto', instruments: [{ id: 10, name: 'Clarinetto', transpositionSemitones: -2, soundProgram: 71, configured: true }] },
    { id: 'P2', name: 'Tuba', instruments: [{ id: 11, name: 'Tuba', transpositionSemitones: 0, soundProgram: 58, configured: true }] }
];
const partNames = (xml: string): string[] => Array.from(new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('part-name'), (name) => name.textContent ?? '');

function part(scoreId: number, overrides: Partial<PartPlayback> = {}): PartPlayback {
    return {
        scoreId,
        order: scoreId,
        description: `Parte ${scoreId}`,
        instruments: [],
        ownPart: false,
        sound: { soundProgram: 71, soundBank: 0, transpositionSemitones: -2, percussionKeys: [], configured: true, conflicting: false },
        availability: 'AVAILABLE',
        hasPages: true,
        openReports: 0,
        version: { id: scoreId, versionNumber: 1, status: 'UNVERIFIED', origin: 'UPLOAD_MUSICXML', measureCount: 1, checks: null as never, pagesChanged: false },
        ...overrides
    };
}

describe('ScorePlayerDialogComponent', () => {
    it('plays every available part but shows the notation only of the parts of the user', async () => {
        const { component, playbackService, renderer } = setup('score', [part(1), part(2, { ownPart: true }), part(3, { availability: 'NOT_AVAILABLE', version: null })]);

        await component.ngOnInit();

        expect(component.status).toBe('ready');
        expect(component.rows.map((row: { part: PartPlayback }) => row.part.scoreId)).toEqual([1, 2]);
        expect(component.unavailable.map((item: PartPlayback) => item.scoreId)).toEqual([3]);
        expect(component.notationParts.map((item: PartPlayback) => item.scoreId)).toEqual([2]);
        expect(component.notationScoreId).toBe(2);
        expect(playbackService.playbackFile.calls.allArgs()).toEqual([
            [5, 1],
            [5, 2]
        ]);
        expect(renderer.render).toHaveBeenCalledOnceWith(XML, jasmine.any(Number));
    });

    it('mutes the other parts with «Solo le mie parti» and the own parts with «Tutto tranne le mie»', async () => {
        const { component, audio } = setup('score', [part(1), part(2, { ownPart: true })]);
        await component.ngOnInit();
        const own = component.rows[1];

        audio.setChannel.calls.reset();
        component.listen('mine');
        expect(mutedByPart(audio.setChannel.calls.allArgs())).toEqual([true, false, true]);
        expect(component.rows.map((row: { muted: boolean }) => row.muted)).toEqual([true, false]);

        component.listen('others');
        expect(component.rows.map((row: { muted: boolean }) => row.muted)).toEqual([false, true]);

        own.solo = true;
        component.listen('all');
        expect(component.rows.map((row: { muted: boolean; solo: boolean }) => row.muted || row.solo)).toEqual([false, false]);
    });

    it('follows the first approved part and warns when the parts have different lengths', async () => {
        const approved = { id: 2, versionNumber: 1, status: 'APPROVED' as const, origin: 'UPLOAD_MUSICXML' as const, measureCount: 2, checks: null as never, pagesChanged: false };
        const { component, playbackService } = setup('score', [part(1), part(2, { version: approved })]);
        const longer = musicXml(['<attributes><divisions>1</divisions></attributes>', '<note><rest/><duration>4</duration></note>']);
        playbackService.playbackFile.and.callFake((_trackId: number, scoreId: number) => of(scoreId === 2 ? longer : XML));

        await component.ngOnInit();

        expect(component.lengthsDiffer).toBeTrue();
        expect(component.reference.measures.length).toBe(2);
        component.data.playback.referenceScoreId = 1;
        expect(component.reference.measures.length).toBe(1);
    });

    it('scales the playback rate to the chosen tempo', async () => {
        const { component, audio } = setup('part', [part(1), part(2)], 2);
        await component.ngOnInit();

        expect(component.rows.length).toBe(1);
        expect(component.tempo).toBe(100);
        component.changeTempo(150);
        expect(audio.playbackRate).toBe(1.5);
        component.changeTempo(500);
        expect(component.tempo).toBe(300);
    });

    it('reports an error on the part shown, proposing the measure being played', async () => {
        const { component, dialogService, toast } = setup('score', [part(1), part(2, { ownPart: true })]);
        await component.ngOnInit();
        component.currentMeasure = '1';

        component.reportError();

        const data = dialogService.open.calls.mostRecent().args[1].data;
        expect(data.scoreId).toBe(2);
        expect(data.measureNumber).toBe('1');
        expect(data.parts.map((item: { scoreId: number; measures: string[] }) => [item.scoreId, item.measures])).toEqual([
            [1, ['1']],
            [2, ['1']]
        ]);
        expect(toast.success).toHaveBeenCalledWith('Segnalazione inviata', jasmine.any(String));
    });

    it('plays every row of a score with the sound of its instrument, showing one row at a time', async () => {
        const { component, playbackService, arrangementService, renderer, audio } = setup('arrangement', []);
        arrangementService.content.and.resolveTo(SCORE);

        await component.ngOnInit();

        expect(component.status).toBe('ready');
        expect(arrangementService.content).toHaveBeenCalledWith(5, 21);
        expect(playbackService.playbackFile).not.toHaveBeenCalled();
        expect(component.rows.map((row: { label: string }) => row.label)).toEqual(['Clarinetto', 'Tuba']);
        expect(component.rows.map((row: { part: PartPlayback }) => row.part.sound.transpositionSemitones)).toEqual([-2, 0]);
        expect(component.reference.measures.length).toBe(1);
        expect(audio.load).toHaveBeenCalledTimes(1);
        // Lo spartito mostrato è un rigo alla volta.
        expect(partNames(renderer.render.calls.mostRecent().args[0])).toEqual(['Clarinetto']);
        await component.changeNotation(component.notationParts[1].scoreId);
        expect(partNames(renderer.render.calls.mostRecent().args[0])).toEqual(['Tuba']);
        await component.changeNotation(component.notationParts[1].scoreId);
        expect(renderer.render).toHaveBeenCalledTimes(3);

        const failing = setup('arrangement', []);
        failing.arrangementService.content.and.rejectWith(new Error('offline'));
        await failing.component.ngOnInit();
        expect(failing.component.status).toBe('error');
    });

    it('explains when the part cannot be played yet or the files cannot be loaded', async () => {
        const unavailable = setup('part', [part(1, { availability: 'NOT_AVAILABLE', version: null })], 1);
        await unavailable.component.ngOnInit();
        expect(unavailable.component.status).toBe('error');
        expect(unavailable.component.errorMessage).toBe('Ascolto non ancora disponibile');
        expect(unavailable.playbackService.playbackFile).not.toHaveBeenCalled();

        const failing = setup('score', [part(1)]);
        failing.playbackService.playbackFile.and.returnValue(throwError(() => new Error('offline')));
        await failing.component.ngOnInit();
        expect(failing.component.status).toBe('error');
        expect(failing.component.errorMessage).toContain("Impossibile preparare l'ascolto");
    });
});

describe('ScorePlayerDialogComponent in the page', () => {
    async function create(mode: 'part' | 'score') {
        const playback: TrackPlayback = { trackId: 5, trackName: 'Marcia', version: 3, parts: [part(1, { ownPart: true }), part(2)], recognitionAvailable: false };
        const renderer = { render: jasmine.createSpy().and.resolveTo(['<svg><g class="measure" data-n="1"></g></svg>']) };
        const audio = {
            ready: jasmine.createSpy().and.resolveTo(),
            load: jasmine.createSpy().and.resolveTo(),
            play: jasmine.createSpy().and.resolveTo(),
            pause: jasmine.createSpy(),
            setChannel: jasmine.createSpy(),
            currentTime: 0,
            playbackRate: 1
        };
        await TestBed.configureTestingModule({
            imports: [ScorePlayerDialogComponent],
            providers: [
                { provide: DynamicDialogConfig, useValue: { data: { trackId: 5, playback, mode, scoreId: 1 } satisfies ScorePlayerDialogData } },
                { provide: ScorePlaybackService, useValue: { playbackFile: () => of(XML) } },
                { provide: ScoreAudioService, useValue: audio },
                { provide: ScoreRendererService, useValue: renderer },
                { provide: ArrangementService, useValue: {} },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success']) }
            ]
        }).compileComponents();
        const fixture = TestBed.createComponent(ScorePlayerDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return { fixture, renderer };
    }

    it('lets the managers download in MIDI the parts they hear, at the chosen tempo, without metronome', async () => {
        const { component, playbackService, toast } = setup('score', [part(1), part(2, { ownPart: true })]);
        await component.ngOnInit();
        const click = spyOn(HTMLAnchorElement.prototype, 'click');
        const blobs: Blob[] = [];
        const createObjectURL = spyOn(URL, 'createObjectURL').and.callFake((blob: Blob | MediaSource) => {
            blobs.push(blob as Blob);
            return 'blob:midi';
        });
        spyOn(URL, 'revokeObjectURL');

        expect(component.canDownload).toBeFalse();
        playbackService.canManage = true;
        expect(component.canDownload).toBeTrue();

        component.changeTempo(120);
        component.listen('mine');
        component.downloadMidi();
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect((click.calls.mostRecent().object as HTMLAnchorElement).download).toBe('Marcia.mid');
        const tracks = readMidi(new Uint8Array(await blobs[0].arrayBuffer())).tracks;
        // Tempo e la sola parte che si sente: niente metronomo.
        expect(tracks.length).toBe(2);
        const tempo = tracks[0].find((event) => event.data[0] === 0x51)!.data;
        expect(Math.round(60_000_000 / ((tempo[1] << 16) | (tempo[2] << 8) | tempo[3]))).toBe(120);

        component.rows.forEach((row: { muted: boolean }) => (row.muted = true));
        component.downloadMidi();
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(toast.warn).toHaveBeenCalledWith('MIDI non scaricato', jasmine.any(String));

        const single = setup('part', [part(1), part(2)], 2);
        single.playbackService.canManage = true;
        await single.component.ngOnInit();
        single.component.downloadMidi();
        expect((click.calls.mostRecent().object as HTMLAnchorElement).download).toBe('Marcia - Parte 2.mid');
    });

    it('starts with the parts of the mixer closed on a phone, behind a toggle', async () => {
        spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
        const { fixture } = await create('score');
        const parts = () => fixture.nativeElement.querySelector('#playerParts') as HTMLElement;
        const toggle = fixture.nativeElement.querySelector('.score-player__parts-toggle') as HTMLButtonElement;

        expect(parts().classList).toContain('score-player__parts--closed');
        expect(parts().querySelectorAll('.score-player__row').length).toBe(2);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain('Mostra le parti (2)');

        toggle.click();
        fixture.detectChanges();

        expect(parts().classList).not.toContain('score-player__parts--closed');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('draws the notation once the player is ready', async () => {
        const { fixture, renderer } = await create('part');

        expect((fixture.componentInstance as unknown as { status: string }).status).toBe('ready');
        expect(renderer.render).toHaveBeenCalledTimes(1);
        expect(fixture.nativeElement.querySelector('.score-player__notation svg')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.score-player__parts-toggle')).toBeNull();
    });
});

/** Per ogni chiamata a `setChannel`, se il canale è silenziato: prima le parti, poi il metronomo. */
function mutedByPart(calls: readonly unknown[][]): boolean[] {
    return calls.map((args) => args[2] as boolean);
}

function setup(mode: ScorePlayerDialogData['mode'], parts: PartPlayback[], scoreId?: number) {
    const playback: TrackPlayback = { trackId: 5, trackName: 'Marcia', version: 3, parts, recognitionAvailable: false };
    const data: ScorePlayerDialogData = { trackId: 5, playback, mode, scoreId, arrangement: mode === 'arrangement' ? { versionId: 21, rows: ROWS } : undefined };
    const arrangementService = { content: jasmine.createSpy('content') };
    const playbackService = { playbackFile: jasmine.createSpy().and.returnValue(of(XML)), canManage: false };
    const audio = {
        ready: jasmine.createSpy().and.resolveTo(),
        load: jasmine.createSpy().and.resolveTo(),
        play: jasmine.createSpy().and.resolveTo(),
        pause: jasmine.createSpy(),
        setChannel: jasmine.createSpy(),
        currentTime: 0,
        playbackRate: 1
    };
    const renderer = { render: jasmine.createSpy().and.resolveTo(['<svg></svg>']) };
    const zone = { run: (callback: () => void) => callback(), runOutsideAngular: (callback: () => void) => callback() };
    const changeDetector = { markForCheck: jasmine.createSpy() };
    const dialogService = { open: jasmine.createSpy().and.returnValue({ onClose: of(true) }) };
    const toast = jasmine.createSpyObj('ToastService', ['success', 'warn']);
    const component: any = new ScorePlayerDialogComponent({ data } as never, playbackService as never, audio as never, renderer as never, zone as never, changeDetector as never, dialogService as never, toast, arrangementService as never);
    component.notation = { nativeElement: document.createElement('div') };
    return { component, playbackService, arrangementService, audio, renderer, dialogService, toast };
}
