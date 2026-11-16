import { PlaybackInstrument, PlaybackSound, ScoreFragment } from '../module';
import { child, children, text } from './musicxml-dom';
import { EditError, pitchOf, ScoreDocument, voiceOf } from './score-document';
import { openScore } from './score-edits';
import * as fragments from './score-fragments';

const CLARINET: PlaybackInstrument = { id: 1, name: 'Clarinetto 1°', transpositionSemitones: -2, configured: true, lowestWrittenPitch: 52, highestWrittenPitch: 91 };
const ALTO_SAX: PlaybackInstrument = { id: 2, name: 'Sax contralto', transpositionSemitones: -9, configured: true, lowestWrittenPitch: 58, highestWrittenPitch: 89 };
const TENOR_SAX: PlaybackInstrument = { id: 3, name: 'Sax tenore', transpositionSemitones: -14, configured: true, lowestWrittenPitch: 58, highestWrittenPitch: 89 };
const SNARE: PlaybackInstrument = { id: 4, name: 'Tamburo', percussionKey: 38, configured: true };
const BASS_DRUM: PlaybackInstrument = { id: 5, name: 'Gran cassa', percussionKey: 36, configured: true };

function sound(instrument: PlaybackInstrument): PlaybackSound {
    return { transpositionSemitones: instrument.transpositionSemitones, percussionKeys: [], configured: true, conflicting: false };
}

function drums(keys: number[]): PlaybackSound {
    return { percussionKeys: keys, configured: true, conflicting: false };
}

function note(step: string, octave: number, alter = 0, type = 'quarter', duration = 1): string {
    return `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type></note>`;
}

function drum(step: string, octave: number, voice: number): string {
    return `<note><unpitched><display-step>${step}</display-step><display-octave>${octave}</display-octave></unpitched><duration>2</duration><voice>${voice}</voice><type>half</type></note>`;
}

function rest(duration: number): string {
    return `<note><rest measure="yes"/><duration>${duration}</duration><voice>1</voice></note>`;
}

function attributes(fifths: number, beats = 4, clef = '<clef><sign>G</sign><line>2</line></clef>'): string {
    return `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time>${clef}</attributes>`;
}

function part(measures: string[], parts = 1): ScoreDocument {
    const body = measures.map((content, index) => `<measure number="${index + 1}">${content}</measure>`).join('');
    const ids = Array.from({ length: parts }, (_, index) => `P${index + 1}`);
    return openScore(
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>' +
            ids.map((id) => `<score-part id="${id}"><part-name>${id}</part-name></score-part>`).join('') +
            '</part-list>' +
            ids.map((id) => `<part id="${id}">${body}</part>`).join('') +
            '</score-partwise>'
    );
}

function pitches(score: ScoreDocument, from: number, to: number): string[] {
    return score
        .measures()
        .slice(from, to + 1)
        .flatMap((measure) => children(measure, 'note'))
        .map((item) => {
            const pitch = pitchOf(item);
            if (!pitch) return 'rest';
            return `${pitch.step}${pitch.alter > 0 ? '#'.repeat(pitch.alter) : 'b'.repeat(-pitch.alter)}${pitch.octave}`;
        });
}

function times(score: ScoreDocument): string[] {
    return score.measureStates().map((state) => `${state.beats}/${state.beatType}`);
}

function stored(content: fragments.FragmentContent, id = 1): ScoreFragment {
    return { id, name: 'Frammento', category: 'SIGNAL', kind: content.kind, measureCount: content.measureCount, percussionKeys: content.percussionKeys, entityVersion: 0 };
}

/** Parte di clarinetto: 4/4 in Do, poi due battute in 3/4 e in Sol tra ritornelli con una lettera di prova, poi di nuovo 4/4. */
function clarinetPart(): ScoreDocument {
    return part([
        attributes(0) + note('C', 5) + note('D', 5) + note('E', 5) + note('F', 5),
        '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>' +
            '<attributes><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
            '<direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>' +
            '<direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type></direction>' +
            note('D', 5) +
            note('E', 5) +
            note('F', 5, 1),
        note('G', 5) + note('A', 5) + note('B', 4) + '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>',
        '<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' + note('C', 5, 0, 'whole', 4)
    ]);
}

describe('score-fragments', () => {
    it('saves the selected measures of a clarinet in concert pitch, with time, key, dynamics and the repeats inside', () => {
        const score = clarinetPart();
        const content = fragments.fragmentContent(score, 2, 1, fragments.fragmentNotation([CLARINET], sound(CLARINET)));

        expect(content.kind).toBe('PITCHED');
        expect(content.measureCount).toBe(2);
        expect(content.percussionKeys).toEqual([]);
        const fragment = openScore(content.xml);
        // Il clarinetto in Si bemolle suona un tono sotto: Re diventa Do, Sol maggiore diventa Fa maggiore.
        expect(pitches(fragment, 0, 1)).toEqual(['C5', 'D5', 'E5', 'F5', 'G5', 'A4']);
        expect(fragment.measureStates().map((state) => state.fifths)).toEqual([-1, -1]);
        expect(times(fragment)).toEqual(['3/4', '3/4']);
        expect(fragment.document.getElementsByTagName('rehearsal').length).toBe(0);
        expect(fragment.document.getElementsByTagName('dynamics').length).toBe(1);
        expect(child(child(fragment.measure(0), 'barline'), 'repeat')?.getAttribute('direction')).toBe('forward');
        expect(child(child(fragment.measure(1), 'barline'), 'repeat')?.getAttribute('direction')).toBe('backward');
    });

    it('keeps only the repeats and the endings that open and close inside the measures', () => {
        const score = clarinetPart();
        const second = fragments.fragmentContent(score, 2, 3, fragments.fragmentNotation([CLARINET], sound(CLARINET)));
        expect(openScore(second.xml).document.getElementsByTagName('repeat').length).toBe(0);
        expect(times(openScore(second.xml))).toEqual(['3/4', '4/4']);

        // Il ritornello che torna all'inizio della parte riceve l'inizio esplicito.
        const fromStart = part([
            attributes(0) + note('C', 5, 0, 'whole', 4),
            '<barline location="left"><ending number="1" type="start"/></barline>' + note('D', 5, 0, 'whole', 4) + '<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline>',
            '<barline location="left"><ending number="2" type="start"/></barline>' + note('E', 5, 0, 'whole', 4) + '<barline location="right"><ending number="2" type="discontinue"/></barline>'
        ]);
        const repeated = openScore(fragments.fragmentContent(fromStart, 0, 2, fragments.fragmentNotation([ALTO_SAX], sound(ALTO_SAX))).xml);
        expect(
            repeated.measures().map((measure) =>
                children(measure, 'barline').map(
                    (barline) =>
                        `${barline.getAttribute('location')}:${children(barline)
                            .map((item) => item.tagName + (item.getAttribute('type') ?? item.getAttribute('direction') ?? ''))
                            .join(',')}`
                )
            )
        ).toEqual([['left:bar-style,repeatforward'], ['left:endingstart', 'right:bar-style,endingstop,repeatbackward'], ['left:endingstart', 'right:endingdiscontinue']]);
        // Senza la battuta d'inizio il ritornello resta fuori, mentre la prima volta, intera nella battuta, resta.
        const alone = openScore(fragments.fragmentContent(fromStart, 1, 1, fragments.fragmentNotation([ALTO_SAX], sound(ALTO_SAX))).xml);
        expect(alone.document.getElementsByTagName('repeat').length).toBe(0);
        expect(alone.document.getElementsByTagName('ending').length).toBe(2);
    });

    it('says why a part cannot save or receive fragments', () => {
        expect(fragments.fragmentNotation([CLARINET, ALTO_SAX], sound(CLARINET))).toEqual({ kind: 'blocked', reason: 'I frammenti si usano nelle parti di un solo strumento intonato' });
        expect(fragments.fragmentNotation([], sound(CLARINET))).toEqual(jasmine.objectContaining({ kind: 'blocked' }));
        expect(fragments.fragmentNotation([{ ...CLARINET, transpositionSemitones: null }], { ...sound(CLARINET), transpositionSemitones: null })).toEqual({
            kind: 'blocked',
            reason: 'Configura la trasposizione di Clarinetto 1° per usare i frammenti'
        });
        expect(fragments.fragmentNotation([SNARE], drums([]))).toEqual(jasmine.objectContaining({ kind: 'blocked' }));
        // In una partitura in suoni reali della trasposizione resta l'ottava, con l'estensione spostata.
        const concert = fragments.fragmentNotation([TENOR_SAX], { ...sound(TENOR_SAX), transpositionSemitones: -12 }, true);
        expect(concert).toEqual({ kind: 'PITCHED', name: 'Sax tenore', instrument: { transpositionSemitones: -12, bassClefTranspositionSemitones: null, lowestWrittenPitch: 56, highestWrittenPitch: 87 } });
        // Con una trasposizione scelta per la parte l'estensione dello strumento non vale.
        expect(fragments.fragmentNotation([ALTO_SAX], { ...sound(ALTO_SAX), transpositionSemitones: -2 })).toEqual(jasmine.objectContaining({ instrument: jasmine.objectContaining({ transpositionSemitones: -2, lowestWrittenPitch: null }) }));

        const score = clarinetPart();
        const notation = fragments.fragmentNotation([CLARINET], sound(CLARINET));
        expect(() => fragments.fragmentContent(score, 0, 0, { kind: 'blocked', reason: 'Motivo' })).toThrowError(EditError, 'Motivo');
        const rests = part([attributes(0) + rest(4), rest(4)]);
        expect(() => fragments.fragmentContent(rests, 0, 1, notation)).toThrowError(EditError, /solo pause/);
        const pickup = part([attributes(0) + note('C', 5), note('C', 5, 0, 'whole', 4)]);
        pickup.measure(0).setAttribute('implicit', 'yes');
        expect(() => fragments.fragmentContent(pickup, 0, 1, notation)).toThrowError(EditError, /levare/);
        const long = part([attributes(0) + note('C', 5, 0, 'whole', 4), ...Array.from({ length: 64 }, () => note('C', 5, 0, 'whole', 4))]);
        expect(() => fragments.fragmentContent(long, 0, 64, notation)).toThrowError(EditError, /al massimo 64 battute: ne hai selezionate 65/);
        expect(fragments.passageMeasures({ voice: 1, from: { measureIndex: 2, offset: { num: 0, den: 1 } }, to: { measureIndex: 5, offset: { num: 0, den: 1 } }, wholeMeasures: true })).toEqual([2, 4]);
    });

    it('inserts a concert fragment in an alto sax part with the proposed octave, its time and key, and the part back after it', () => {
        const content = fragments.fragmentContent(clarinetPart(), 1, 2, fragments.fragmentNotation([CLARINET], sound(CLARINET)));
        const sax = part([attributes(3) + note('E', 5, 0, 'whole', 4), note('F', 5, 1, 'whole', 4), note('A', 5, 0, 'whole', 4)]);
        const notation = fragments.fragmentNotation([ALTO_SAX], sound(ALTO_SAX));
        const clef = fragments.insertionClef(sax, 1);
        expect(clef).toBe('G2');

        const prepared = fragments.prepareFragment(content.xml, stored(content), notation, clef);
        // Il sax contralto suona una sesta maggiore sotto: Do in suoni reali si scrive La.
        expect(prepared.octave).toBe(0);
        expect(prepared.plan?.fifths).toBe(2);
        const lower = fragments.prepareFragment(content.xml, stored(content), notation, clef, -1);
        expect(lower.octave).toBe(-1);
        expect(pitches(lower.score, 0, 0)[0]).toBe('A4');

        const selected = fragments.insertFragment(sax, prepared, 1);

        expect(sax.measures().length).toBe(5);
        expect(pitches(sax, 0, 4)).toEqual(['E5', 'A5', 'B5', 'C#6', 'D6', 'E6', 'F#5', 'F#5', 'A5']);
        expect(selected).toBe(child(sax.measure(1), 'note')!.getAttribute('id'));
        expect(times(sax)).toEqual(['4/4', '3/4', '3/4', '4/4', '4/4']);
        expect(sax.measureStates().map((state) => state.fifths)).toEqual([3, 2, 2, 3, 3]);
        // La parte riprende con il suo metro e la sua armatura scritti una sola volta.
        expect(children(sax.measure(3), 'attributes').flatMap((attributes) => children(attributes).map((item) => item.tagName))).toEqual(['key', 'time']);
        expect(children(sax.measure(4), 'attributes').length).toBe(0);
        expect(sax.measure(1).querySelector('repeat')?.getAttribute('direction')).toBe('forward');
        expect(sax.measure(2).querySelector('repeat')?.getAttribute('direction')).toBe('backward');
        expect(sax.measures().map((measure) => measure.getAttribute('number'))).toEqual(['1', '2', '3', '4', '5']);
    });

    it('inserts at the end of the part and moves the final double bar after the fragment', () => {
        const content = fragments.fragmentContent(clarinetPart(), 0, 0, fragments.fragmentNotation([CLARINET], sound(CLARINET)));
        const sax = part([attributes(3) + note('E', 5, 0, 'whole', 4), note('F', 5, 1, 'whole', 4) + '<barline location="right"><bar-style>light-heavy</bar-style></barline>']);

        fragments.insertFragment(sax, fragments.prepareFragment(content.xml, stored(content), fragments.fragmentNotation([ALTO_SAX], sound(ALTO_SAX)), fragments.insertionClef(sax, null)), null);

        expect(sax.measures().length).toBe(3);
        expect(children(sax.measure(1), 'barline').length).toBe(0);
        expect(text(child(child(sax.measure(2), 'barline'), 'bar-style'))).toBe('light-heavy');
        // Il clarinetto scrive Do Re Mi Fa: in suoni reali Si bemolle maggiore, per il sax contralto Sol maggiore.
        expect(pitches(sax, 2, 2)).toEqual(['G5', 'A5', 'B5', 'C6']);
        expect(sax.measureStates().map((state) => state.fifths)).toEqual([3, 3, 1]);
    });

    it('saves a drum roll with the sound of each voice and inserts it only where all its sounds are', () => {
        const drumPart = part([attributes(0, 2, '<clef><sign>percussion</sign></clef>') + drum('C', 5, 1) + '<backup><duration>2</duration></backup>' + drum('F', 4, 2), rest(2)]);
        const content = fragments.fragmentContent(drumPart, 0, 1, fragments.fragmentNotation([SNARE, BASS_DRUM], drums([38, 36])));
        expect(content.kind).toBe('PERCUSSION');
        expect(content.percussionKeys).toEqual([
            { voice: 1, key: 38 },
            { voice: 2, key: 36 }
        ]);
        const fragment = stored(content);

        expect(fragments.fragmentBlocker(fragment, fragments.fragmentNotation([BASS_DRUM], drums([36])))).toBe('Mancano nella parte il suono tamburo');
        expect(fragments.fragmentBlocker(fragment, fragments.fragmentNotation([CLARINET], sound(CLARINET)))).toBe('Un frammento di percussione entra solo in una parte di percussione');
        expect(fragments.fragmentBlocker({ ...fragment, kind: 'PITCHED', percussionKeys: [] }, fragments.fragmentNotation([SNARE], drums([38])))).toBe('Un frammento intonato entra solo in una parte intonata');
        expect(() => fragments.prepareFragment(content.xml, fragment, fragments.fragmentNotation([BASS_DRUM], drums([36])), 'percussion')).toThrowError(EditError, /tamburo/);

        // Nella parte la gran cassa è la voce 1 e il tamburo la 2: il frammento passa nelle voci con gli stessi suoni.
        const target = part([attributes(0, 4, '<clef><sign>percussion</sign></clef>') + rest(4)]);
        const prepared = fragments.prepareFragment(content.xml, fragment, fragments.fragmentNotation([BASS_DRUM, SNARE], drums([36, 38])), fragments.insertionClef(target, 0));
        fragments.insertFragment(target, prepared, 0);

        expect(target.measures().length).toBe(3);
        expect(times(target)).toEqual(['2/4', '2/4', '4/4']);
        const sounds = children(target.measure(0), 'note')
            .filter((item) => child(item, 'unpitched'))
            .map((item) => `${text(child(child(item, 'unpitched'), 'display-step'))}${voiceOf(item)}`);
        expect(sounds.sort()).toEqual(['C2', 'F1']);
        expect(target.measure(0).querySelector('clef sign')?.textContent).toBe('percussion');
    });

    it('adds the measures to every row of a score and writes the fragment in the active row', () => {
        const content = fragments.fragmentContent(clarinetPart(), 1, 1, fragments.fragmentNotation([CLARINET], sound(CLARINET)));
        const score = part([attributes(0) + note('C', 5, 0, 'whole', 4), note('D', 5, 0, 'whole', 4)], 2);
        score.selectPart(1);

        const prepared = fragments.prepareFragment(content.xml, stored(content), fragments.fragmentNotation([ALTO_SAX], sound(ALTO_SAX)), fragments.insertionClef(score, 1));
        fragments.insertFragment(score, prepared, 1, true);

        expect(score.partIndex).toBe(1);
        expect(pitches(score, 1, 1)).toEqual(['A5', 'B5', 'C#6']);
        score.selectPart(0);
        expect(score.measures().length).toBe(3);
        expect(pitches(score, 0, 2)).toEqual(['C5', 'rest', 'D5']);
        expect(times(score)).toEqual(['4/4', '3/4', '4/4']);
        // Le armature restano quelle di ogni rigo: il frammento le cambia solo nel rigo attivo.
        expect(score.measureStates().map((state) => state.fifths)).toEqual([0, 0, 0]);
    });
});
