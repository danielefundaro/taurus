import { ScoreDocument } from './score-document';
import { drawingExcerpt, drawingXml, measurePositions } from './score-pages';

const ATTRIBUTES =
    '<attributes><divisions>2</divisions><key><fifths>-1</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>';
const note = (step: string): string => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>`;
const REHEARSAL = '<direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>';
const part = (id: string): string =>
    `<part id="${id}"><measure id="${id}-1" number="1">${ATTRIBUTES}${note('C')}</measure>` +
    `<measure id="${id}-2" number="2"><attributes><clef><sign>F</sign><line>4</line></clef></attributes>${REHEARSAL}${note('D')}</measure>` +
    `<measure id="${id}-3" number="3"><print new-page="yes"/>${note('E')}</measure></part>`;

/** Partitura di due righi e tre battute, con il nome lungo e l'abbreviazione del primo rigo. */
const XML =
    '<score-partwise version="4.0"><work><work-title>Marcia</work-title></work><part-list>' +
    '<score-part id="P1"><part-name>Clarinetto</part-name><part-name-display><display-text>Clarinetto in Si♭</display-text></part-name-display><part-abbreviation>Cl.</part-abbreviation></score-part>' +
    `<score-part id="P2"><part-name>Tuba</part-name></score-part></part-list>${part('P1')}${part('P2')}</score-partwise>`;

const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
const names = (document: Document): string[] => Array.from(document.querySelectorAll('score-part > part-name'), (name) => name.textContent ?? '');
const measureIds = (document: Document, partId: string): string[] => Array.from(document.querySelectorAll(`part[id="${partId}"] > measure`), (measure) => measure.getAttribute('id') ?? '');
const tags = (element: Element | null | undefined): string[] => Array.from(element?.children ?? [], (item) => item.tagName);

describe('score pages', () => {
    let score: ScoreDocument;

    beforeEach(() => {
        score = ScoreDocument.open(XML);
    });

    it('prepares the whole drawing from the open document, without the names of a single part', () => {
        const drawing = parse(drawingXml(score));

        expect(drawing.querySelector('work-title')?.textContent).toBe('Marcia');
        expect(names(drawing)).toEqual(['', '']);
        expect(drawing.querySelector('part-name-display')).toBeNull();
        expect(measureIds(drawing, 'P1')).toEqual(['P1-1', 'P1-2', 'P1-3']);
        expect(drawing.querySelector('print')?.getAttribute('new-page')).toBe('yes');
        // I segni della struttura comune restano solo sul primo rigo.
        expect(drawing.querySelectorAll('part[id="P1"] rehearsal').length).toBe(1);
        expect(drawing.querySelectorAll('part[id="P2"] rehearsal').length).toBe(0);
        // Il documento aperto non cambia.
        expect(score.document.querySelectorAll('rehearsal').length).toBe(2);
        expect(score.document.querySelector('part-name')?.textContent).toBe('Clarinetto');
    });

    it('keeps the names and draws page breaks as line breaks when asked', () => {
        const drawing = parse(drawingXml(score, { partNames: true, pageBreaksAsSystems: true }));

        expect(names(drawing)).toEqual(['Clarinetto', 'Tuba']);
        expect(drawing.querySelector('part-name-display')).not.toBeNull();
        const print = drawing.querySelector('print')!;
        expect(print.hasAttribute('new-page')).toBeFalse();
        expect(print.getAttribute('new-system')).toBe('yes');
    });

    it('starts an excerpt with the state in force, without the meter, and with the short names', () => {
        const drawing = parse(drawingExcerpt(score, 1, 1, { hidden: new Set(['P2']), partNames: true }));

        expect(names(drawing)).toEqual(['Cl.']);
        expect(drawing.querySelector('part-name-display')).toBeNull();
        expect(drawing.querySelectorAll('part').length).toBe(1);
        expect(measureIds(drawing, 'P1')).toEqual(['P1-2']);
        // La chiave della battuta resta la sua: si aggiungono divisioni, armatura e trasposizione.
        const measure = drawing.querySelector('measure')!;
        expect(tags(measure)).toEqual(['attributes', 'attributes', 'direction', 'note']);
        expect(tags(measure.children[0])).toEqual(['divisions', 'key', 'transpose']);
        expect(measure.querySelector('clef sign')?.textContent).toBe('F');
        expect(drawing.querySelector('time')).toBeNull();
        expect(drawing.querySelectorAll('rehearsal').length).toBe(1);
    });

    it('carries the last clef into an excerpt and puts the state after the layout', () => {
        const drawing = parse(drawingExcerpt(score, 2, 10, { pageBreaksAsSystems: true }));

        expect(measureIds(drawing, 'P2')).toEqual(['P2-3']);
        const measure = drawing.querySelector('part[id="P2"] > measure')!;
        expect(tags(measure)).toEqual(['print', 'attributes', 'note']);
        expect(tags(measure.children[1])).toEqual(['divisions', 'key', 'clef', 'transpose']);
        expect(measure.querySelector('clef sign')?.textContent).toBe('F');
        expect(measure.querySelector('print')?.getAttribute('new-system')).toBe('yes');
        // Senza nomi l'abbreviazione resta vuota anche negli estratti.
        expect(names(drawing)).toEqual(['', '']);
    });

    it('opens a system where asked, only on the first row shown and with the layout the measure already has', () => {
        const drawing = parse(drawingExcerpt(score, 0, 2, { hidden: new Set(['P1']), systems: new Set([0, 2]) }));

        const measures = Array.from(drawing.querySelectorAll('part[id="P2"] > measure'));
        expect(tags(measures[0])).toEqual(['print', 'attributes', 'note']);
        expect(measures[0].querySelector('print')?.getAttribute('new-system')).toBe('yes');
        expect(measures[1].querySelector('print')).toBeNull();
        // L'interruzione di pagina della battuta diventa l'interruzione di riga, senza un secondo `print`.
        expect(measures[2].querySelectorAll('print').length).toBe(1);
        expect(measures[2].querySelector('print')?.getAttribute('new-system')).toBe('yes');
        expect(measures[2].querySelector('print')?.hasAttribute('new-page')).toBeFalse();

        const both = parse(drawingExcerpt(score, 0, 1, { systems: new Set([1]) }));
        expect(both.querySelector('part[id="P1"] > measure:nth-of-type(2) > print')?.getAttribute('new-system')).toBe('yes');
        expect(both.querySelector('part[id="P2"] > measure:nth-of-type(2) > print')).toBeNull();
    });

    it('adds nothing at the start of the score', () => {
        const drawing = parse(drawingExcerpt(score, -3, 0));

        expect(measureIds(drawing, 'P1')).toEqual(['P1-1']);
        expect(drawing.querySelectorAll('part[id="P1"] attributes').length).toBe(1);
    });

    it('finds the position of every measure of every row', () => {
        const positions = measurePositions(score);

        expect(positions.get('P1-1')).toBe(0);
        expect(positions.get('P2-3')).toBe(2);
        expect(positions.size).toBe(6);
    });
});
