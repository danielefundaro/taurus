import { hasHeader, numberPage, optionsProblem, pageSections, prepareMei, requestOptions, resolveOptions, responsivePage, singleLine, unengravedLabel, unengravedPart, verovioOptions } from './score-engraving';

const MEI_NS = 'http://www.music-encoding.org/ns/mei';

/** MEI come lo restituisce Verovio: un'interruzione prima della musica, tre battute e una nuova pagina dopo la seconda. */
const MEI = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="${MEI_NS}" xmlns:xml="http://www.w3.org/XML/1998/namespace"><music><body><mdiv><score>
<scoreDef><pgHead><rend>Titolo d'origine</rend></pgHead><pgFoot><rend>Piè di pagina</rend></pgFoot>
<staffGrp><label>Gruppo</label><staffDef n="1" lines="5"><label>Flicorno</label><labelAbbr>Flic.</labelAbbr></staffDef></staffGrp></scoreDef>
<section><pb xml:id="pb0"/><expansion xml:id="e1" plist="#s1"/>
<measure xml:id="m1" n="1"><staff n="1"><layer n="1"><note xml:id="n1"/></layer></staff></measure>
<measure xml:id="m2" n="2"><staff n="1"><layer n="1"><note xml:id="n2"><verse><label>Strofa</label></verse></note></layer></staff></measure>
<pb xml:id="pb1"/>
<measure xml:id="m3" n="3"><staff n="1"><layer n="1"><note xml:id="n3"/></layer></staff></measure>
</section></score></mdiv></body></music></mei>`;

function parse(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'application/xml');
}

function ids(document: Document, name: string): string[] {
    return Array.from(document.getElementsByTagNameNS(MEI_NS, name)).map((element) => element.getAttribute('xml:id') ?? '');
}

describe('score engraving', () => {
    const header = { title: 'Marcia reale', composer: 'G. Gabetti', arranger: 'M. Rossi', partName: 'Flicorno tenore' };

    it('fills the options left empty with the values proposed for the format', () => {
        expect(resolveOptions(null)).toEqual({ format: 'A4_PORTRAIT', staffSize: 7, margin: 12, header: { title: '', composer: '', arranger: '', partName: '' }, pageNumbers: true, measureNumbers: 'SYSTEM' });
        const march = resolveOptions({ format: 'MARCH', header: { title: '  Marcia\n reale ', composer: null }, pageNumbers: false, measureNumbers: 'EVERY' });
        expect([march.staffSize, march.margin, march.header.title, march.header.composer, march.pageNumbers, march.measureNumbers]).toEqual([5.6, 8, 'Marcia reale', '', false, 'EVERY']);
        expect(resolveOptions({ format: 'A4_LANDSCAPE', staffSize: 6, margin: 20 })).toEqual(jasmine.objectContaining({ staffSize: 6, margin: 20 }));
    });

    it('keeps the texts on one line without control characters', () => {
        expect(singleLine(' Banda\tdi\u0007 Roma \n')).toBe('Banda di Roma');
        expect(singleLine(undefined)).toBe('');
    });

    it('sets the page of Verovio in tenths of a millimetre, with the strip for the page numbers', () => {
        expect(verovioOptions(resolveOptions({}))).toEqual(
            jasmine.objectContaining({
                pageWidth: 2100,
                pageHeight: 2970,
                pageMarginTop: 120,
                pageMarginBottom: 180,
                pageMarginLeft: 120,
                pageMarginRight: 120,
                unit: 8.75,
                breaks: 'smart',
                breaksSmartSb: 0,
                header: 'encoded',
                footer: 'encoded',
                justifyVertically: true,
                mnumInterval: 0
            })
        );
        const march = verovioOptions(resolveOptions({ format: 'MARCH', pageNumbers: false, measureNumbers: 'EVERY' }));
        expect([march['pageWidth'], march['pageHeight'], march['pageMarginBottom'], march['unit'], march['mnumInterval']]).toEqual([1800, 1300, 80, 7, 1]);
    });

    it('splits the part at the page breaks, ignoring the one before the music', () => {
        expect(pageSections(parse(MEI))).toEqual([
            ['m1', 'm2'],
            ['m3', 'm3']
        ]);
    });

    it('replaces the names and the header of the part with those of the options', () => {
        const options = resolveOptions({ header, measureNumbers: 'NONE' });
        const mei = parse(prepareMei(parse(MEI), options, true));

        const heads = mei.getElementsByTagNameNS(MEI_NS, 'pgHead');
        expect(heads.length).toBe(1);
        expect(heads[0].getAttribute('func')).toBe('first');
        const rends = Array.from(heads[0].children);
        expect(rends.map((rend) => rend.getAttribute('halign'))).toEqual(['left', 'center', 'right']);
        expect(rends[0].textContent).toBe('Flicorno tenore');
        expect(rends[0].firstElementChild?.getAttribute('fontweight')).toBe('bold');
        expect(rends[1].textContent).toBe('Marcia reale');
        expect(rends[2].textContent).toBe('G. GabettiM. Rossi');
        expect(rends[2].getElementsByTagNameNS(MEI_NS, 'lb').length).toBe(1);
        expect(mei.getElementsByTagNameNS(MEI_NS, 'pgFoot').length).toBe(0);
        // Solo i nomi dei righi si tolgono: le etichette delle strofe restano.
        expect(Array.from(mei.getElementsByTagNameNS(MEI_NS, 'label')).map((label) => label.textContent)).toEqual(['Strofa']);
        expect(mei.getElementsByTagNameNS(MEI_NS, 'labelAbbr').length).toBe(0);
        expect(mei.getElementsByTagNameNS(MEI_NS, 'scoreDef')[0].getAttribute('mnum.visible')).toBe('false');
        expect(ids(mei, 'measure')).toEqual(['m1', 'm2', 'm3']);
        expect(ids(mei, 'expansion')).toEqual(['e1']);
    });

    it('cuts the first section after its last measure, without the expansions of the whole part', () => {
        const options = resolveOptions({ header: { title: 'Marcia' } });
        const first = parse(prepareMei(parse(MEI), options, true, 'm2'));
        expect(ids(first, 'measure')).toEqual(['m1', 'm2']);
        expect(ids(first, 'pb')).toEqual(['pb0']);
        expect(ids(first, 'expansion')).toEqual([]);
        expect(Array.from(first.getElementsByTagNameNS(MEI_NS, 'pgHead')[0].children).map((rend) => rend.getAttribute('halign'))).toEqual(['center']);

        const rest = parse(prepareMei(parse(MEI), options, false));
        expect(rest.getElementsByTagNameNS(MEI_NS, 'pgHead').length).toBe(0);
        expect(rest.getElementsByTagNameNS(MEI_NS, 'scoreDef')[0].hasAttribute('mnum.visible')).toBeFalse();
    });

    it('starts the music at the top without texts and refuses an MEI without a score definition', () => {
        const options = resolveOptions({});
        expect(hasHeader(options)).toBeFalse();
        expect(parse(prepareMei(parse(MEI), options, true)).getElementsByTagNameNS(MEI_NS, 'pgHead').length).toBe(0);
        expect(() => prepareMei(parse(`<mei xmlns="${MEI_NS}"><music/></mei>`), options, true)).toThrowError('Spartito non leggibile');
    });

    it('numbers the pages from the second, centred above the bottom margin', () => {
        const options = resolveOptions({});
        const page = '<svg width="2100px" height="2970px" version="1.1"><g/></svg>';

        expect(numberPage(page, 1, options)).toBe(page);
        const second = numberPage(page, 2, options);
        expect(second).toContain('<text x="1050" y="2835"');
        expect(second).toContain('font-size="35px"');
        expect(second.endsWith('>2</text></svg>')).toBeTrue();
        expect(numberPage('<svg viewBox="0 0 10 10"></svg>', 3, options)).toBe('<svg viewBox="0 0 10 10"></svg>');
    });

    it('fits a page to the width of its box', () => {
        expect(responsivePage('<svg class="definition-scale" width="2100px" height="2970px"><svg width="10px" height="10px"/></svg>')).toBe('<svg class="definition-scale" viewBox="0 0 2100 2970" width="100%"><svg width="10px" height="10px"/></svg>');
    });

    it('sends the options without the empty texts', () => {
        expect(requestOptions(resolveOptions({ format: 'MARCH', header: { title: ' Marcia ', composer: '', arranger: null, partName: 'Tuba' } }))).toEqual({
            format: 'MARCH',
            staffSize: 5.6,
            margin: 8,
            header: { title: 'Marcia', partName: 'Tuba' },
            pageNumbers: true,
            measureNumbers: 'SYSTEM'
        });
    });

    it('checks the ranges of the options and the length of the texts', () => {
        expect(optionsProblem(resolveOptions({}))).toBeNull();
        expect(optionsProblem(resolveOptions({ staffSize: 3.9 }))).toBe('La dimensione del rigo deve essere tra 4 e 9,6 mm');
        expect(optionsProblem({ ...resolveOptions({}), staffSize: NaN })).toBe('La dimensione del rigo deve essere tra 4 e 9,6 mm');
        expect(optionsProblem(resolveOptions({ margin: 31 }))).toBe('I margini devono essere tra 3 e 30 mm');
        expect(optionsProblem(resolveOptions({ header: { title: 'x'.repeat(201) } }))).toBe("I testi dell'intestazione non possono superare 200 caratteri");
    });

    it('recognizes the saved parts with a version and without pages', () => {
        expect(unengravedPart({ id: 1, media: [], currentScoreVersionId: 4 })).toBeTrue();
        expect(unengravedPart({ id: 1, currentScoreVersionId: 4 })).toBeTrue();
        expect(unengravedPart({ id: 1, media: [{}], currentScoreVersionId: 4 })).toBeFalse();
        expect(unengravedPart({ id: 1, media: [], currentScoreVersionId: null })).toBeFalse();
        expect(unengravedPart({ media: [], currentScoreVersionId: 4 })).toBeFalse();
        expect([unengravedLabel(1), unengravedLabel(2)]).toEqual(['1 parte da impaginare non stampata', '2 parti da impaginare non stampate']);
    });
});
