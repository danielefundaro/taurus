import { forDisplay, withoutPartNames } from './score-renderer.service';

describe('withoutPartNames', () => {
    it('drops the names written beside the staves and keeps the notes and their ids', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flicorno tenore in Sib</part-name><part-name-display><display-text>Flic. ten.</display-text></part-name-display><part-abbreviation>Flic.</part-abbreviation></score-part></part-list><part id="P1"><measure number="1" id="te1-m1"><note id="te1-n1"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

        const result = new DOMParser().parseFromString(withoutPartNames(xml), 'application/xml');

        expect(result.querySelector('part-name')?.textContent).toBe('');
        expect(result.querySelector('part-abbreviation')?.textContent).toBe('');
        expect(result.querySelector('part-name-display')).toBeNull();
        expect(result.querySelector('note')?.getAttribute('id')).toBe('te1-n1');
        expect(result.querySelector('measure')?.getAttribute('id')).toBe('te1-m1');
    });

    it('leaves an unreadable document to Verovio', () => {
        expect(withoutPartNames('<score-partwise>')).toBe('<score-partwise>');
    });

    it('shows page breaks as line breaks when the written breaks are drawn', () => {
        const xml = `<score-partwise version="4.0"><part id="P1"><measure number="1"/><measure number="2"><print new-page="yes"/></measure><measure number="3"><print new-system="yes"/></measure></part></score-partwise>`;
        const prints = (value: string): string[] => Array.from(new DOMParser().parseFromString(value, 'application/xml').querySelectorAll('print')).map((print) => new XMLSerializer().serializeToString(print));

        expect(prints(forDisplay(xml, true))).toEqual(['<print new-system="yes"/>', '<print new-system="yes"/>']);
        expect(prints(forDisplay(xml, false))).toEqual(['<print new-page="yes"/>', '<print new-system="yes"/>']);
    });
});
