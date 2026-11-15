import { PlaybackInstrument } from '../module';
import {
    addRow,
    alignParts,
    annotateRows,
    byEnsembleOrder,
    clearRows,
    combineParts,
    concertInstrument,
    concertPartXml,
    concertSemitones,
    convertNotation,
    copyRows,
    displayedXml,
    emptyRow,
    ensembleRows,
    extractedParts,
    isConcertScore,
    isPercussionRow,
    isStructureDirection,
    MAX_ROWS,
    measurePosition,
    newArrangementXml,
    onEveryRow,
    pasteRows,
    playbackRows,
    removeRow,
    rowChecks,
    rowClefSign,
    rowInstrumentIds,
    rowName,
    rowRangeInstrument,
    rowRequests,
    rowSetup,
    rowSound,
    rowTransposition,
    rowXml,
    setConcertKey,
    setConcertScore,
    staffRows,
    unconfiguredInstrument
} from './score-arrangement';
import { EditError, ScoreDocument } from './score-document';

const FLUTE: PlaybackInstrument = { id: 1, name: 'Flauto', transpositionSemitones: 0, soundProgram: 73, configured: true };
const CLARINET: PlaybackInstrument = { id: 2, name: 'Clarinetto', transpositionSemitones: -2, soundProgram: 71, configured: true };
const TENOR_SAX: PlaybackInstrument = { id: 3, name: 'Sax tenore', transpositionSemitones: -14, soundProgram: 66, configured: true };
const EUPHONIUM: PlaybackInstrument = { id: 4, name: 'Euphonium', transpositionSemitones: -14, bassClefTranspositionSemitones: 0, configured: true };
const SNARE: PlaybackInstrument = { id: 5, name: 'Rullante', percussionKey: 38, configured: true };
const BASS_DRUM: PlaybackInstrument = { id: 6, name: 'Grancassa', percussionKey: 36, configured: true };
const TUBA: PlaybackInstrument = { id: 7, name: 'Tuba', transpositionSemitones: 0, configured: true };
const UNCONFIGURED: PlaybackInstrument = { id: 8, name: 'Corno', configured: false };

const TREBLE = '<clef><sign>G</sign><line>2</line></clef>';
const BASS = '<clef><sign>F</sign><line>4</line></clef>';
const attributes = (fifths: number, clef = TREBLE, extra = ''): string => `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time>${extra}${clef}</attributes>`;
const half = (step: string, octave: number, alter = 0): string => `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>`;
const REST = '<note><rest measure="yes"/><duration>2</duration><voice>1</voice></note>';
const REHEARSAL = '<direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>';
const REPEAT = '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>';
const measure = (number: string, body: string): string => `<measure number="${number}">${body}</measure>`;

/** Una parte singola con le battute indicate. */
function partXml(name: string, measures: string[], extraPartList = ''): string {
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>${name}</part-name>${extraPartList}</score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`;
}

/** Partitura di clarinetto, tuba e percussioni, due battute in 2/4. */
function scoreXml(): string {
    return combineParts(
        [
            { xml: partXml('Clarinetto', [measure('1', attributes(2) + REHEARSAL + half('D', 5)), measure('2', REST)]), name: 'Clarinetto' },
            { xml: partXml('Tuba', [measure('1', attributes(0, BASS) + half('C', 3)), measure('2', REST)]), name: 'Tuba' },
            { xml: partXml('Percussioni', [measure('1', attributes(0, '<clef><sign>percussion</sign></clef>') + REST), measure('2', REST)]), name: 'Percussioni' }
        ],
        false
    );
}

function openScore(): ScoreDocument {
    const score = ScoreDocument.open(scoreXml());
    annotateRows(score, [
        { id: 'P1', instrumentIds: [CLARINET.id] },
        { id: 'P2', instrumentIds: [TUBA.id] },
        { id: 'P3', instrumentIds: [SNARE.id, BASS_DRUM.id] }
    ]);
    return score;
}

const xmlDocument = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
const partNames = (xml: string): string[] => Array.from(xmlDocument(xml).querySelectorAll('score-part > part-name')).map((name) => name.textContent ?? '');
const steps = (score: ScoreDocument, index: number): string[] => Array.from(score.parts()[index].querySelectorAll('note')).map((note) => note.querySelector('step')?.textContent ?? 'rest');
const pitches = (score: ScoreDocument, index: number): string[] =>
    Array.from(score.parts()[index].querySelectorAll('note pitch')).map((pitch) => `${pitch.querySelector('step')?.textContent}${pitch.querySelector('alter')?.textContent ?? ''}${pitch.querySelector('octave')?.textContent}`);
const keys = (score: ScoreDocument): number[] => score.everyPart(() => score.measureStates()[0].fifths);
/** Righi della partitura di prova: clarinetto, tuba e percussioni. */
const ROWS = [{ instruments: [CLARINET] }, { instruments: [TUBA] }, { instruments: [SNARE, BASS_DRUM] }];

describe('score arrangement', () => {
    describe('rows and instruments', () => {
        it('tells percussion rows apart and gives the transposition of a row in its clef', () => {
            expect(isPercussionRow([SNARE, BASS_DRUM])).toBeTrue();
            expect(isPercussionRow([CLARINET])).toBeFalse();
            expect(rowTransposition([SNARE, BASS_DRUM], 'percussion')).toBe(0);
            expect(rowTransposition([], 'G')).toBe(0);
            expect(rowTransposition([CLARINET], 'G')).toBe(-2);
            expect(rowTransposition([EUPHONIUM], 'G')).toBe(-14);
            expect(rowTransposition([EUPHONIUM], 'F')).toBe(0);
            expect(rowTransposition([UNCONFIGURED], 'G')).toBeNull();
        });

        it('writes a transposed row in concert pitch without its octaves', () => {
            expect(concertSemitones(-14)).toBe(-2);
            expect(concertSemitones(-2)).toBe(-2);
            expect(concertSemitones(-12)).toBe(-0);
            expect(concertSemitones(9)).toBe(9);
            expect(concertSemitones(0)).toBe(0);
        });

        it('orders the rows by the ensemble, then the others as they come', () => {
            const items = [TUBA, UNCONFIGURED, FLUTE, SNARE, CLARINET];
            expect(byEnsembleOrder(items, [FLUTE.id, CLARINET.id, TUBA.id], (item) => [item.id]).map((item) => item.name)).toEqual(['Flauto', 'Clarinetto', 'Tuba', 'Corno', 'Rullante']);
            // Un rigo di più strumenti prende il posto del primo nell'organico.
            const rows = [{ ids: [TUBA.id] }, { ids: [SNARE.id, FLUTE.id] }];
            expect(byEnsembleOrder(rows, [FLUTE.id, TUBA.id], (row) => row.ids)).toEqual([rows[1], rows[0]]);
        });
    });

    describe('new score', () => {
        it('makes a row for every pitched instrument and one for all the percussion, where the first one is', () => {
            const rows = ensembleRows([FLUTE, SNARE, CLARINET, BASS_DRUM]);
            expect(rows.map((row) => row.name)).toEqual(['Flauto', 'Percussioni', 'Clarinetto']);
            expect(rows[1].instruments).toEqual([SNARE, BASS_DRUM]);
            expect(ensembleRows([SNARE, TUBA]).map((row) => row.name)).toEqual(['Rullante', 'Tuba']);
            expect(ensembleRows([])).toEqual([]);
        });

        it('proposes the clef and the written key of a new row', () => {
            expect(rowSetup({ name: 'Clarinetto', instruments: [CLARINET] }, 0, false)).toEqual({ setup: { name: 'Clarinetto', clef: 'G2', fifths: 2 }, unconfigured: false });
            expect(rowSetup({ name: 'Clarinetto', instruments: [CLARINET] }, 0, true).setup.fifths).toBe(0);
            expect(rowSetup({ name: 'Tuba', instruments: [TUBA] }, -1, false).setup).toEqual({ name: 'Tuba', clef: 'F4', fifths: -1 });
            expect(rowSetup({ name: 'Percussioni', instruments: [SNARE, BASS_DRUM] }, 3, false).setup).toEqual({ name: 'Percussioni', clef: 'percussion', fifths: 0 });
            expect(rowSetup({ name: 'Corno', instruments: [UNCONFIGURED] }, -2, false)).toEqual({ setup: { name: 'Corno', clef: 'G2', fifths: -2 }, unconfigured: true });
        });

        it('writes a score of rests with a part per row and the concert-pitch mark', () => {
            const xml = newArrangementXml({
                rows: [
                    { name: 'Flauto', clef: 'G2', fifths: 0 },
                    { name: 'Tuba', clef: 'F4', fifths: 0 }
                ],
                beats: 3,
                beatType: 4,
                tempo: 100,
                measures: 4,
                pickupBeats: 0,
                concertPitch: true
            });
            const document = xmlDocument(xml);
            expect(Array.from(document.querySelectorAll('part')).map((part) => [part.getAttribute('id'), part.querySelectorAll('measure').length])).toEqual([
                ['P1', 4],
                ['P2', 4]
            ]);
            expect(partNames(xml)).toEqual(['Flauto', 'Tuba']);
            expect(document.querySelector('defaults > concert-score')).not.toBeNull();
            const score = ScoreDocument.open(xml);
            expect(isConcertScore(score)).toBeTrue();
            expect(score.everyPart(() => score.checks().wrongDuration)).toEqual([[], []]);

            expect(() => newArrangementXml({ rows: [], beats: 4, beatType: 4, tempo: null, measures: 1, pickupBeats: 0, concertPitch: false })).toThrowError(EditError, 'Scegli almeno un rigo');
            const many = Array.from({ length: MAX_ROWS + 1 }, (_, index) => ({ name: `Rigo ${index}`, clef: 'G2', fifths: 0 }));
            expect(() => newArrangementXml({ rows: many, beats: 4, beatType: 4, tempo: null, measures: 1, pickupBeats: 0, concertPitch: false })).toThrowError(EditError, `La partitura ha al massimo ${MAX_ROWS} righi`);
        });

        it('combines parts without their MIDI instruments and transpositions', () => {
            const source = partXml(
                'Clarinetto',
                [
                    measure(
                        '1',
                        attributes(2, TREBLE, '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>') +
                            '<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><instrument id="P1-I1"/><voice>1</voice><type>half</type></note>'
                    )
                ],
                '<score-instrument id="P1-I1"><instrument-name>Clarinet</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>72</midi-program></midi-instrument>'
            );
            const xml = combineParts(
                [
                    { xml: source, name: 'Clarinetto 1°' },
                    { xml: source, name: ' ' }
                ],
                false
            );
            const document = xmlDocument(xml);
            expect(partNames(xml)).toEqual(['Clarinetto 1°', 'Rigo 2']);
            for (const name of ['transpose', 'score-instrument', 'midi-instrument', 'note > instrument', 'defaults']) expect(document.querySelector(name)).withContext(name).toBeNull();
            expect(Array.from(document.querySelectorAll('part')).map((part) => part.getAttribute('id'))).toEqual(['P1', 'P2']);

            expect(() => combineParts([], false)).toThrowError(EditError, 'Scegli almeno un rigo');
            expect(() => combineParts([{ xml: '<score-partwise/>', name: 'Vuota' }], false)).toThrowError(EditError, 'La parte «Vuota» non è leggibile');
        });

        it('aligns the parts to the reference one and says what changes', () => {
            const reference = partXml('Flauto', [measure('1', attributes(0) + REHEARSAL + half('C', 5)), measure('2', half('D', 5) + REPEAT), measure('3', REST)]);
            const shorter = partXml('Clarinetto', [
                measure('1', attributes(2) + half('D', 5)),
                measure('2', '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>E</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/></note>')
            ]);
            const longer = partXml('Tuba', [measure('1', attributes(0, BASS) + REHEARSAL + half('C', 3)), measure('2', half('D', 3) + REPEAT), measure('3', REST), measure('4', REST)]);

            const aligned = alignParts([reference, shorter, longer], 0);

            expect(aligned[0].changes).toEqual([]);
            expect(aligned[1].changes).toEqual([
                '1 battuta in meno, completata con pause',
                'Ritornelli diversi: si usano quelli della parte di riferimento',
                'Segni, salti, tempo o lettere di prova diversi: si usano quelli della parte di riferimento',
                'Metro diverso nelle battute 2 e 3'
            ]);
            expect(aligned[2].changes).toEqual(['1 battuta in più, tolta']);

            const clarinet = ScoreDocument.open(aligned[1].xml);
            expect(clarinet.measures().map((item) => item.getAttribute('number'))).toEqual(['1', '2', '3']);
            expect(clarinet.measureStates().map((state) => `${state.beats}/${state.beatType}`)).toEqual(['2/4', '2/4', '2/4']);
            expect(clarinet.measureStates()[0].fifths).toBe(2);
            expect(clarinet.measure(0).querySelector('rehearsal')?.textContent).toBe('A');
            expect(clarinet.measure(1).querySelector('barline repeat')?.getAttribute('direction')).toBe('backward');
            expect(clarinet.measure(2).querySelector('rest')).not.toBeNull();
            expect(ScoreDocument.open(aligned[2].xml).measures().length).toBe(3);

            const two = alignParts([shorter, reference], 0);
            expect(two[1].changes).toContain('1 battuta in più, tolta');
            expect(two[1].changes).toContain('Metro diverso nella battuta 2');
        });

        it('writes a transposed part in concert pitch, keeping its octave', () => {
            const clarinet = xmlDocument(concertPartXml(partXml('Clarinetto', [measure('1', attributes(2) + half('D', 5))]), -2, 'Clarinetto'));
            expect(clarinet.querySelector('step')?.textContent).toBe('C');
            expect(clarinet.querySelector('octave')?.textContent).toBe('5');
            expect(clarinet.querySelector('fifths')?.textContent).toBe('0');

            const sax = xmlDocument(concertPartXml(partXml('Sax tenore', [measure('1', attributes(2) + half('E', 5))]), -14, 'Sax tenore'));
            expect(sax.querySelector('step')?.textContent).toBe('D');
            expect(sax.querySelector('octave')?.textContent).toBe('5');

            const flute = partXml('Flauto', [measure('1', attributes(0) + half('C', 5))]);
            expect(concertPartXml(flute, 0, 'Flauto')).toBe(flute);
            expect(concertPartXml(flute, 12, 'Ottavino')).toBe(flute);
        });
    });

    describe('rows in the editor', () => {
        it('records the instruments of the rows on the document, and drops them from the saved file', () => {
            const score = openScore();
            expect(rowRequests(score)).toEqual([
                { id: 'P1', instrumentIds: [CLARINET.id] },
                { id: 'P2', instrumentIds: [TUBA.id] },
                { id: 'P3', instrumentIds: [SNARE.id, BASS_DRUM.id] }
            ]);
            expect(rowInstrumentIds(score, 2)).toEqual([SNARE.id, BASS_DRUM.id]);
            expect(rowInstrumentIds(score, 5)).toEqual([]);
            expect([0, 1, 2].map((index) => rowName(score, index))).toEqual(['Clarinetto', 'Tuba', 'Percussioni']);
            expect([0, 1, 2].map((index) => rowClefSign(score, index))).toEqual(['G', 'F', 'percussion']);
            expect(isConcertScore(score)).toBeFalse();
            expect(score.snapshot()).toContain('taurus-instruments');
            expect(score.cleanXml()).not.toContain('taurus-instruments');
        });

        it('adds a row of rests with the structure of the reference row and its own key', () => {
            const score = openScore();
            const id = addRow(score, { name: 'Sax tenore', instrumentIds: [TENOR_SAX.id], clef: 'G2', fifths: (reference) => reference + 2 }, 1);

            expect(id).toBe('P4');
            expect(score.partIndex).toBe(1);
            expect([0, 1, 2, 3].map((index) => rowName(score, index))).toEqual(['Clarinetto', 'Sax tenore', 'Tuba', 'Percussioni']);
            expect(rowRequests(score).map((row) => row.id)).toEqual(['P1', 'P4', 'P2', 'P3']);
            expect(rowInstrumentIds(score, 1)).toEqual([TENOR_SAX.id]);
            expect(score.measures().length).toBe(2);
            expect(score.measureStates()[0].fifths).toBe(4);
            expect(score.measure(0).querySelector('rehearsal')?.textContent).toBe('A');
            expect(score.checks().wrongDuration).toEqual([]);
            expect(emptyRow(score, 1)).toBeTrue();
            expect(emptyRow(score, 0)).toBeFalse();
            expect(measurePosition(score.measure(1))).toBe(1);

            const blank = addRow(score, { name: '  ', instrumentIds: [], clef: 'percussion', fifths: () => 0 }, 99, 1);
            expect(blank).toBe('P5');
            expect(rowName(score, 4)).toBe('Rigo 5');
            expect(rowClefSign(score, 4)).toBe('percussion');
        });

        it('refuses a row beyond the limit', () => {
            const score = openScore();
            for (let count = 3; count < MAX_ROWS; count++) addRow(score, { name: 'Rigo', instrumentIds: [], clef: 'G2', fifths: () => 0 }, count);
            expect(() => addRow(score, { name: 'Rigo', instrumentIds: [], clef: 'G2', fifths: () => 0 }, 0)).toThrowError(EditError, `La partitura ha al massimo ${MAX_ROWS} righi`);
        });

        it('removes a row and keeps one at least', () => {
            const score = openScore();
            score.selectPart(2);
            removeRow(score, 1);
            expect(score.parts().map((part) => part.getAttribute('id'))).toEqual(['P1', 'P3']);
            expect(score.partIndex).toBe(1);
            removeRow(score, 1);
            expect(score.partIndex).toBe(0);
            expect(() => removeRow(score, 0)).toThrowError(EditError, 'La partitura ha almeno un rigo');

            const other = openScore();
            expect(() => removeRow(other, 7)).toThrowError(EditError, 'Rigo non trovato');
            other.selectPart(0);
            removeRow(other, 0);
            expect(other.partIndex).toBe(0);
            expect(rowName(other, 0)).toBe('Tuba');
        });

        it('runs a change on every row and gives back the result of the active one', () => {
            const score = openScore();
            score.selectPart(1);
            expect(onEveryRow(score, () => score.partIndex * 10)).toBe(10);
            expect(score.partIndex).toBe(1);
        });

        it('gives the sound of a row and the file of a single row to listen to', () => {
            expect(rowSound([SNARE, BASS_DRUM])).toEqual({ percussionKeys: [38, 36], configured: true, conflicting: false });
            expect(rowSound([CLARINET])).toEqual(jasmine.objectContaining({ transpositionSemitones: -2, soundProgram: 71, percussionKeys: [], configured: true }));
            expect(rowSound([])).toEqual(jasmine.objectContaining({ transpositionSemitones: null, configured: false }));

            const single = rowXml(scoreXml(), 1);
            expect(partNames(single)).toEqual(['Tuba']);
            expect(xmlDocument(single).querySelectorAll('part').length).toBe(1);
        });

        it('maps the drawn staves to the shown rows', () => {
            const xml = combineParts(
                [
                    { xml: partXml('Pianoforte', [measure('1', attributes(0, '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>', '<staves>2</staves>') + REST)]), name: 'Pianoforte' },
                    { xml: partXml('Tuba', [measure('1', attributes(0, BASS) + REST)]), name: 'Tuba' }
                ],
                false
            );
            const score = ScoreDocument.open(xml);
            expect(staffRows(score, new Set())).toEqual([0, 0, 1]);
            expect(staffRows(score, new Set(['P1']))).toEqual([1]);
            expect(staffRows(score, new Set(['P1', 'P2']))).toEqual([0, 0, 1]);
        });

        it('writes the concert key of every row in the key of its instrument', () => {
            const score = openScore();
            const rows = [
                { id: 'P1', name: 'Clarinetto', instruments: [CLARINET] },
                { id: 'P2', name: 'Tuba', instruments: [TUBA] },
                { id: 'P3', name: 'Percussioni', instruments: [SNARE, BASS_DRUM] }
            ];
            setConcertKey(score, 0, -1, rows, false);
            expect(score.everyPart(() => score.measureStates()[0].fifths)).toEqual([1, -1, 0]);

            setConcertKey(score, 1, 2, rows, true);
            expect(score.everyPart(() => score.measureStates()[1].fifths)).toEqual([2, 2, 0]);

            const unconfigured = [{ id: 'P1', name: 'Corno', instruments: [UNCONFIGURED] }];
            expect(() => setConcertKey(score, 0, 0, unconfigured, false)).toThrowError(EditError, "Configura la trasposizione di Corno per scriverne l'armatura");
        });

        it('copies, pastes and clears whole measures of every row', () => {
            const score = openScore();
            const clip = copyRows(score, 0, 0);
            expect(clip.label).toBe('1 battuta di tutti i righi');
            expect(clip.clips.length).toBe(3);
            expect(copyRows(score, 1, 0).label).toBe('2 battute di tutti i righi');

            pasteRows(score, clip, 1);
            expect(steps(score, 0)).toEqual(['D', 'D']);
            expect(steps(score, 1)).toEqual(['C', 'C']);

            clearRows(score, 0, 1);
            expect(score.everyPart((index) => steps(score, index))).toEqual([
                ['rest', 'rest'],
                ['rest', 'rest'],
                ['rest', 'rest']
            ]);

            removeRow(score, 2);
            expect(() => pasteRows(score, clip, 0)).toThrowError(EditError, 'Le battute copiate hanno 3 righi: si incollano in una partitura con gli stessi righi');
        });

        it('draws the shown rows only, with the structure on the first one', () => {
            const score = openScore();
            const snapshot = score.snapshot();
            expect(partNames(displayedXml(snapshot, new Set(['P2'])))).toEqual(['Clarinetto', 'Percussioni']);

            const withoutFirst = xmlDocument(displayedXml(snapshot, new Set(['P1'])));
            expect(withoutFirst.querySelectorAll('part').length).toBe(2);
            expect(withoutFirst.querySelectorAll('rehearsal').length).toBe(0);

            addRow(score, { name: 'Flauto', instrumentIds: [FLUTE.id], clef: 'G2', fifths: () => 0 }, 3);
            const all = xmlDocument(displayedXml(score.snapshot(), new Set()));
            expect(Array.from(all.querySelectorAll('part')).map((part) => part.querySelectorAll('rehearsal').length)).toEqual([1, 0, 0, 0]);
            expect(displayedXml(snapshot, new Set(['P1', 'P2', 'P3']))).toBe(snapshot);
        });

        it('lists every row to listen to, each with the sound of its instrument', () => {
            const score = openScore();
            const inputs = playbackRows(score, ROWS, 0, 0);
            expect(inputs.map((item) => item.key)).toEqual(['P1', 'P2', 'P3']);
            expect(inputs.map((item) => item.name)).toEqual(['Clarinetto', 'Tuba', 'Percussioni']);
            expect(inputs[0].part.measures.length).toBe(1);
            expect(inputs.map((item) => item.sound.transposition)).toEqual([-2, 0, 0]);
            expect(inputs[2].sound.percussionKeys).toEqual([38, 36]);

            // In suoni reali il clarinetto si scrive come suona.
            convertNotation(score, ROWS, true);
            const concert = playbackRows(score, ROWS, 0, 1);
            expect(concert[0].sound.transposition).toBe(0);
            expect(concert[0].part.measures.length).toBe(2);
        });

        it('checks durations, empty measures and range of every row', () => {
            const clarinet = { ...CLARINET, lowestWrittenPitch: 52, highestWrittenPitch: 91 };
            const score = ScoreDocument.open(
                combineParts(
                    [
                        { xml: partXml('Clarinetto', [measure('1', attributes(2) + half('A', 6)), measure('2', half('D', 5) + half('E', 5))]), name: 'Clarinetto' },
                        { xml: partXml('Tuba', [measure('1', attributes(0, BASS) + half('C', 3)), measure('2', '')]), name: 'Tuba' }
                    ],
                    false
                )
            );
            const rows = [{ instruments: [clarinet] }, { instruments: [TUBA] }];
            const checks = rowChecks(score, rows);
            expect(checks.map((check) => check.name)).toEqual(['Clarinetto', 'Tuba']);
            expect(checks[0].wrongDuration).toEqual([{ index: 1, number: '2' }]);
            expect(checks[0].empty).toEqual([]);
            expect(checks[0].range).toBe('Mi3–Sol6');
            expect(checks[0].outOfRange.map((warning) => warning.measureNumber)).toEqual(['1']);
            expect(checks[1]).toEqual(jasmine.objectContaining({ wrongDuration: [], empty: [{ index: 1, number: '2' }], range: null, outOfRange: [] }));
            expect(score.partIndex).toBe(0);

            // In suoni reali l'estensione scritta scende con le note.
            setConcertScore(score, true);
            expect(rowChecks(score, rows)[0].range).toBe('Re3–Fa6');
        });

        it('recognizes the directions of the common structure', () => {
            const parse = (xml: string): Element => xmlDocument(xml).documentElement;
            expect(isStructureDirection(parse(REHEARSAL))).toBeTrue();
            expect(isStructureDirection(parse('<direction><direction-type><segno/></direction-type></direction>'))).toBeTrue();
            expect(isStructureDirection(parse('<direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction>'))).toBeTrue();
            expect(isStructureDirection(parse('<sound tempo="96"/>'))).toBeTrue();
            expect(isStructureDirection(parse('<sound dynamics="80"/>'))).toBeFalse();
            expect(isStructureDirection(parse('<direction><direction-type><dynamics><f/></dynamics></direction-type></direction>'))).toBeFalse();
            expect(isStructureDirection(parse('<note/>'))).toBeFalse();
        });
    });

    describe('notation', () => {
        it('marks the concert-pitch notation in the defaults, and removes the mark', () => {
            const score = openScore();
            const root = score.document.documentElement;
            setConcertScore(score, true);
            setConcertScore(score, true);
            expect(isConcertScore(score)).toBeTrue();
            expect(Array.from(root.children, (item) => item.tagName).slice(0, 2)).toEqual(['defaults', 'part-list']);
            expect(root.querySelectorAll('concert-score').length).toBe(1);
            setConcertScore(score, false);
            expect(isConcertScore(score)).toBeFalse();
            expect(root.querySelector('defaults')).toBeNull();

            const scaled = ScoreDocument.open(scoreXml().replace('<part-list>', '<work><work-title>Marcia</work-title></work><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling><page-layout/></defaults><part-list>'));
            setConcertScore(scaled, true);
            const defaults = scaled.document.documentElement.querySelector('defaults')!;
            expect(Array.from(defaults.children, (item) => item.tagName)).toEqual(['scaling', 'concert-score', 'page-layout']);
            setConcertScore(scaled, false);
            expect(Array.from(defaults.children, (item) => item.tagName)).toEqual(['scaling', 'page-layout']);

            const titled = ScoreDocument.open(scoreXml().replace('<part-list>', '<work><work-title>Marcia</work-title></work><part-list>'));
            setConcertScore(titled, true);
            expect(Array.from(titled.document.documentElement.children, (item) => item.tagName).slice(0, 3)).toEqual(['work', 'defaults', 'part-list']);
        });

        it('gives sound and written range of an instrument in a concert-pitch score', () => {
            expect(concertInstrument({ ...TENOR_SAX, lowestWrittenPitch: 58, highestWrittenPitch: 89 })).toEqual(jasmine.objectContaining({ transpositionSemitones: -12, lowestWrittenPitch: 56, highestWrittenPitch: 87 }));
            expect(concertInstrument(EUPHONIUM)).toEqual(jasmine.objectContaining({ transpositionSemitones: -12, bassClefTranspositionSemitones: 0, lowestWrittenPitch: undefined }));
            expect(concertInstrument(UNCONFIGURED).transpositionSemitones).toBeUndefined();
            expect(rowSound([TENOR_SAX], true).transpositionSemitones).toBe(-12);
            expect(rowSound([CLARINET], true).transpositionSemitones).toBe(0);
            expect(rowSound([SNARE], true).percussionKeys).toEqual([38]);

            expect(rowRangeInstrument([CLARINET], false)).toBe(CLARINET);
            expect(rowRangeInstrument([TENOR_SAX], true)?.transpositionSemitones).toBe(-12);
            expect(rowRangeInstrument([SNARE], false)).toBeNull();
            expect(rowRangeInstrument([CLARINET, FLUTE], false)).toBeNull();
        });

        it('converts the whole score to concert pitch and back', () => {
            const score = openScore();
            const original = score.cleanXml();
            expect(convertNotation(score, ROWS, true)).toEqual([]);
            expect(isConcertScore(score)).toBeTrue();
            expect(keys(score)).toEqual([0, 0, 0]);
            expect(pitches(score, 0)).toEqual(['C5']);
            // Tuba e percussioni non cambiano.
            expect(pitches(score, 1)).toEqual(['C3']);
            expect(convertNotation(score, ROWS, true)).toEqual([]);

            expect(convertNotation(score, ROWS, false)).toEqual([]);
            expect(isConcertScore(score)).toBeFalse();
            expect(keys(score)).toEqual([2, 0, 0]);
            expect(score.cleanXml()).toBe(original);
        });

        it('keeps the octaves of the transposition and uses the bass-clef one', () => {
            const score = ScoreDocument.open(
                combineParts(
                    [
                        { xml: partXml('Sax tenore', [measure('1', attributes(2) + half('E', 5))]), name: 'Sax tenore' },
                        { xml: partXml('Euphonium', [measure('1', attributes(0, BASS) + half('C', 3))]), name: 'Euphonium' }
                    ],
                    false
                )
            );
            convertNotation(score, [{ instruments: [TENOR_SAX] }, { instruments: [EUPHONIUM] }], true);
            expect(pitches(score, 0)).toEqual(['D5']);
            expect(pitches(score, 1)).toEqual(['C3']);
            expect(keys(score)).toEqual([0, 0]);
        });

        it('says which rows use the enharmonic interval', () => {
            const score = ScoreDocument.open(combineParts([{ xml: partXml('Clarinetto', [measure('1', attributes(6) + half('F', 5, 1))]), name: 'Clarinetto' }], true));
            // Fa♯ maggiore in suoni reali sarebbe Sol♯ maggiore per il clarinetto: si scrive in La♭ maggiore.
            expect(convertNotation(score, [{ instruments: [CLARINET] }], false)).toEqual(['Clarinetto']);
            expect(keys(score)).toEqual([-4]);
            expect(pitches(score, 0)).toEqual(['A-15']);
        });

        it('leaves the score unchanged when a row cannot be converted', () => {
            const score = openScore();
            const before = score.snapshot();
            const unconfigured = [{ instruments: [UNCONFIGURED] }, ROWS[1], ROWS[2]];
            expect(unconfiguredInstrument(score, unconfigured)).toBe(UNCONFIGURED);
            expect(unconfiguredInstrument(score, ROWS)).toBeNull();
            expect(() => convertNotation(score, unconfigured, true)).toThrowError(EditError, 'Configura la trasposizione di Corno per convertire la partitura');
            expect(score.snapshot()).toBe(before);

            const low = ScoreDocument.open(
                combineParts(
                    [
                        { xml: partXml('Tuba', [measure('1', attributes(0, BASS) + half('C', 3))]), name: 'Tuba' },
                        { xml: partXml('Clarinetto', [measure('1', attributes(0) + half('C', 0))]), name: 'Clarinetto' }
                    ],
                    false
                )
            );
            const lowBefore = low.snapshot();
            expect(() => convertNotation(low, [{ instruments: [TUBA] }, { instruments: [CLARINET] }], true)).toThrowError(EditError, 'Le note di Clarinetto uscirebbero dalle altezze scrivibili');
            expect(low.snapshot()).toBe(lowBefore);
        });
    });

    describe('extraction', () => {
        const writtenPitches = (xml: string): string[] =>
            Array.from(xmlDocument(xml).querySelectorAll('note pitch')).map((pitch) => `${pitch.querySelector('step')?.textContent}${pitch.querySelector('alter')?.textContent ?? ''}${pitch.querySelector('octave')?.textContent}`);
        const fifths = (xml: string): string | null | undefined => xmlDocument(xml).querySelector('key > fifths')?.textContent;

        it('extracts each row with its measures, the name of its part and the texts of the track, without the breaks of the score', () => {
            const score = ScoreDocument.open(scoreXml().replace('<part-list>', '<identification><creator type="composer">Ignoto</creator><encoding/></identification><part-list>'));
            score.everyPart(() => {
                const print = score.measure(1).insertBefore(score.document.createElement('print'), score.measure(1).firstChild);
                print.setAttribute('new-system', 'yes');
            });

            const [tuba, clarinet] = extractedParts(
                score.cleanXml(),
                [
                    { id: 'P2', instruments: [TUBA], partName: 'Basso in Do' },
                    { id: 'P1', instruments: [CLARINET], partName: 'Clarinetto 1°' }
                ],
                { title: 'Marcia reale', composer: 'G. Gabetti', arranger: '  ' }
            );

            const extracted = xmlDocument(tuba);
            expect(partNames(tuba)).toEqual(['Basso in Do']);
            expect(Array.from(extracted.querySelectorAll('part'), (part) => part.getAttribute('id'))).toEqual(['P2']);
            expect(Array.from(extracted.documentElement.children, (item) => item.tagName)).toEqual(['work', 'identification', 'part-list', 'part']);
            expect(extracted.querySelector('work > work-title')?.textContent).toBe('Marcia reale');
            expect(Array.from(extracted.querySelectorAll('identification > *'), (item) => `${item.tagName} ${item.getAttribute('type') ?? ''} ${item.textContent}`.trim())).toEqual(['creator composer G. Gabetti', 'encoding']);
            expect(extracted.querySelector('print')).toBeNull();
            expect(writtenPitches(tuba)).toEqual(['C3']);

            expect(partNames(clarinet)).toEqual(['Clarinetto 1°']);
            expect(xmlDocument(clarinet).querySelector('rehearsal')?.textContent).toBe('A');
            expect(fifths(clarinet)).toBe('2');
            expect(writtenPitches(clarinet)).toEqual(['D5']);

            // Senza testi della traccia restano quelli della partitura.
            const titled = scoreXml().replace('<part-list>', '<work><work-number>3</work-number><opus xlink:href="op.xml" xmlns:xlink="http://www.w3.org/1999/xlink"/></work><part-list>');
            const [kept] = extractedParts(titled, [{ id: 'P2', instruments: [TUBA], partName: 'Tuba' }], { title: 'Marcia' });
            expect(Array.from(xmlDocument(kept).querySelector('work')!.children, (item) => item.tagName)).toEqual(['work-number', 'work-title', 'opus']);
            const [untitled] = extractedParts(scoreXml(), [{ id: 'P2', instruments: [TUBA], partName: 'Tuba' }]);
            expect(xmlDocument(untitled).querySelector('work, identification')).toBeNull();
        });

        it('writes the rows of a concert-pitch score in the notation of their instrument', () => {
            const score = openScore();
            convertNotation(score, ROWS, true);
            const concert = score.cleanXml();

            const [clarinet, tuba, drums] = extractedParts(concert, [
                { id: 'P1', instruments: [CLARINET], partName: 'Clarinetto' },
                { id: 'P2', instruments: [TUBA], partName: 'Tuba' },
                { id: 'P3', instruments: [SNARE, BASS_DRUM], partName: 'Percussioni' }
            ]);

            expect([clarinet, tuba, drums].map((xml) => xml.includes('concert-score'))).toEqual([false, false, false]);
            expect(fifths(clarinet)).toBe('2');
            expect(writtenPitches(clarinet)).toEqual(['D5']);
            expect(writtenPitches(tuba)).toEqual(['C3']);
            expect(xmlDocument(drums).querySelector('clef > sign')?.textContent).toBe('percussion');
            expect(() => extractedParts(concert, [{ id: 'P1', instruments: [UNCONFIGURED], partName: 'Corno' }])).toThrowError(EditError, 'Configura la trasposizione di Corno per convertire la partitura');
            expect(() => extractedParts(concert, [{ id: 'P9', instruments: [TUBA], partName: 'Bombardino' }])).toThrowError(EditError, 'Il rigo Bombardino non è nella partitura');
        });
    });
});
