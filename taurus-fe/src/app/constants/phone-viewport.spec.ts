import { isPhoneViewport, PHONE_QUERY } from './phone-viewport';

describe('isPhoneViewport', () => {
    it('is true only when the phone width matches', () => {
        const media = spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
        expect(isPhoneViewport()).toBeTrue();
        expect(media).toHaveBeenCalledWith(PHONE_QUERY);

        media.and.returnValue({ matches: false } as MediaQueryList);
        expect(isPhoneViewport()).toBeFalse();
    });
});
