import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PianoKeyboardComponent } from './piano-keyboard.component';

describe('PianoKeyboardComponent', () => {
    let fixture: ComponentFixture<PianoKeyboardComponent>;
    let played: number[];

    const keys = (selector: string): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll(selector));
    const labels = (selector: string): string[] => keys(selector).map((key) => key.getAttribute('aria-label') ?? '');

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [PianoKeyboardComponent] }).compileComponents();
        fixture = TestBed.createComponent(PianoKeyboardComponent);
        played = [];
        fixture.componentInstance.play.subscribe((key) => played.push(key));
        fixture.detectChanges();
    });

    it('shows two octaves from the middle C and plays the touched keys', () => {
        expect(keys('.piano__white').length).toBe(15);
        expect(labels('.piano__black').slice(0, 5)).toEqual(['Do♯4', 'Mi♭4', 'Fa♯4', 'Sol♯4', 'Si♭4']);
        expect(fixture.nativeElement.querySelector('.piano__range').textContent.trim()).toBe('Do4–Do6');
        expect(fixture.nativeElement.querySelector('.piano__name').textContent.trim()).toBe('Do4');

        keys('.piano__white')[2].click();
        keys('.piano__black')[0].click();
        expect(played).toEqual([64, 61]);
    });

    it('moves by octaves within the keyboard and starts from the octave it is given', () => {
        fixture.componentRef.setInput('startOctave', 2);
        fixture.detectChanges();
        expect(labels('.piano__white')[0]).toBe('Do2');

        (fixture.nativeElement.querySelector('.piano__bar p-button:first-child button') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(labels('.piano__white')[0]).toBe('Do1');

        fixture.componentRef.setInput('startOctave', 12);
        fixture.detectChanges();
        expect(labels('.piano__white')[0]).toBe('Do7');
        (fixture.nativeElement.querySelector('.piano__bar p-button:last-child button') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(labels('.piano__white')[0]).toBe('Do7');
    });

    it('shows one pad per instrument for percussion parts and plays nothing while disabled', () => {
        fixture.componentRef.setInput('pads', [
            { key: 36, label: 'Gran cassa', hint: 'Voce 1' },
            { key: 38, label: 'Tamburo', hint: 'Voce 2' }
        ]);
        fixture.detectChanges();
        expect(keys('.piano__white').length).toBe(0);
        expect(labels('.piano__pad')).toEqual(['Gran cassa, Voce 1', 'Tamburo, Voce 2']);

        keys('.piano__pad')[1].click();
        fixture.componentRef.setInput('disabled', true);
        fixture.detectChanges();
        keys('.piano__pad')[0].click();
        expect(played).toEqual([38]);
        (fixture.componentInstance as unknown as { press(key: number): void }).press(36);
        expect(played).toEqual([38]);
    });
});
