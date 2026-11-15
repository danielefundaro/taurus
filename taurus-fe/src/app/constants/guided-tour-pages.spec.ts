import { GuidedTourText, TenantFeature } from '../module';
import { composePageGuide, GUIDED_TOUR_PAGE_MAX_STEPS, GUIDED_TOUR_PAGES, matchGuidedTourPage } from './guided-tour-pages';
import { textFor } from './guided-tour-compose';
import { GUIDED_TOUR_STEPS } from './guided-tour-steps';
import { RoleEnums } from './role.enums';

const ROLES = [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER, RoleEnums.ARCHIVIST, RoleEnums.USER, RoleEnums.USER_EXTERNAL];
const allOn = () => true;
const allOff = () => false;
const texts = (text: GuidedTourText): string[] => (typeof text === 'string' ? [text] : Object.values(text));
const ids = (path: string, role: RoleEnums, isEnabled: (feature: TenantFeature) => boolean = allOn) => {
    const page = matchGuidedTourPage(path);
    return page ? composePageGuide(page, role, isEnabled).map((step) => step.id) : [];
};

/** Steps per page in the order of ROLES, with all the features on and then all off: a change to the catalog shows here. */
const STEP_COUNTS: Record<string, [number[], number[]]> = {
    '/profile': [
        [7, 7, 7, 6, 7, 8, 8],
        [4, 4, 4, 4, 4, 4, 4]
    ],
    '/': [
        [6, 6, 6, 3, 6, 6, 5],
        [4, 4, 4, 2, 4, 4, 3]
    ],
    '/calendar': [
        [3, 3, 3, 0, 2, 2, 2],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/calendar/:id': [
        [8, 8, 8, 2, 5, 4, 4],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/tracks': [
        [3, 3, 3, 0, 3, 2, 2],
        [3, 3, 3, 0, 3, 2, 2]
    ],
    '/tracks/:id': [
        [6, 6, 6, 0, 6, 4, 4],
        [4, 4, 4, 0, 4, 3, 3]
    ],
    '/albums': [
        [2, 2, 2, 0, 2, 1, 1],
        [2, 2, 2, 0, 2, 1, 1]
    ],
    '/albums/:id': [
        [3, 3, 3, 0, 3, 3, 3],
        [3, 3, 3, 0, 3, 3, 3]
    ],
    '/preview': [
        [3, 3, 3, 0, 3, 3, 3],
        [3, 3, 3, 0, 3, 3, 3]
    ],
    '/inventory': [
        [8, 8, 8, 0, 4, 4, 4],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/inventory/assignments/:id': [
        [4, 4, 4, 0, 4, 4, 4],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/inventory/loan-template': [
        [6, 6, 6, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/inventory/:id': [
        [5, 5, 5, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/inventory/scan/v1/:publicId': [
        [2, 2, 2, 0, 2, 2, 2],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/finance': [
        [9, 9, 9, 9, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/instruments': [
        [3, 3, 3, 0, 3, 0, 0],
        [2, 2, 2, 0, 2, 0, 0]
    ],
    '/instruments/:id': [
        [2, 2, 2, 0, 2, 0, 0],
        [1, 1, 1, 0, 1, 0, 0]
    ],
    '/users': [
        [3, 3, 3, 0, 0, 0, 0],
        [3, 3, 3, 0, 0, 0, 0]
    ],
    '/users/:id': [
        [5, 5, 5, 0, 0, 0, 0],
        [3, 3, 3, 0, 0, 0, 0]
    ],
    '/onboarding': [
        [4, 4, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/admin/notification-delivery': [
        [2, 2, 0, 0, 0, 0, 0],
        [2, 2, 0, 0, 0, 0, 0]
    ],
    '/admin/calendar-feeds': [
        [2, 2, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
    ],
    '/tenants': [
        [2, 0, 0, 0, 0, 0, 0],
        [2, 0, 0, 0, 0, 0, 0]
    ],
    '/tenants/:id': [
        [3, 0, 0, 0, 0, 0, 0],
        [3, 0, 0, 0, 0, 0, 0]
    ],
    '/legal-documents': [
        [2, 0, 0, 0, 0, 0, 0],
        [2, 0, 0, 0, 0, 0, 0]
    ],
    '/legal-documents/new': [
        [3, 0, 0, 0, 0, 0, 0],
        [3, 0, 0, 0, 0, 0, 0]
    ]
};

describe('Page guides catalog', () => {
    it('matches the literal pages first, then those with parameters, ignoring query and fragment', () => {
        expect(matchGuidedTourPage('/')!.pages).toEqual(['/']);
        expect(matchGuidedTourPage('/profile?tab=2#top')!.pages).toEqual(['/profile']);
        expect(matchGuidedTourPage('/inventory/loan-template')!.pages).toEqual(['/inventory/loan-template']);
        expect(matchGuidedTourPage('/inventory/42')!.pages).toEqual(['/inventory/:id', '/inventory/items/:id']);
        expect(matchGuidedTourPage('/inventory/items/42')!.pages).toEqual(['/inventory/:id', '/inventory/items/:id']);
        expect(matchGuidedTourPage('/inventory/assignments/7')!.pages).toEqual(['/inventory/assignments/:id']);
        expect(matchGuidedTourPage('/onboarding/imports/3')!.pages).toEqual(['/onboarding', '/onboarding/imports/:id']);
        expect(matchGuidedTourPage('/legal-documents/new')!.pages).toEqual(['/legal-documents/new', '/legal-documents/:id']);
        expect(matchGuidedTourPage('/legal-documents/7')!.pages).toEqual(['/legal-documents/new', '/legal-documents/:id']);
        expect(matchGuidedTourPage('/calendar/12/edit')).toBeUndefined();
        expect(matchGuidedTourPage('/notfound')).toBeUndefined();
    });

    it('composes every page for the seven roles as expected', () => {
        expect(Object.keys(STEP_COUNTS)).toEqual(GUIDED_TOUR_PAGES.map((page) => page.pages[0]));
        for (const page of GUIDED_TOUR_PAGES) {
            const [on, off] = STEP_COUNTS[page.pages[0]];
            expect(ROLES.map((role) => composePageGuide(page, role, allOn).length))
                .withContext(`${page.pages[0]} on`)
                .toEqual(on);
            expect(ROLES.map((role) => composePageGuide(page, role, allOff).length))
                .withContext(`${page.pages[0]} off`)
                .toEqual(off);
        }
    });

    it('composes the profile of every role', () => {
        const common = ['page.profile.personal', 'page.profile.events'];
        const end = ['page.profile.notifications', 'page.profile.signature', 'page.profile.guide', 'page.profile.security', 'page.profile.account'];

        expect(ids('/profile', RoleEnums.USER)).toEqual([...common, 'page.profile.calendarFeed', ...end]);
        expect(ids('/profile', RoleEnums.ADMIN)).toEqual([...common, ...end]);
        expect(ids('/profile', RoleEnums.TREASURER)).toEqual([...common, 'page.profile.notifications', 'page.profile.guide', 'page.profile.security', 'page.profile.account']);
        expect(ids('/profile', RoleEnums.USER, allOff)).toEqual(['page.profile.personal', 'page.profile.guide', 'page.profile.security', 'page.profile.account']);
    });

    it('offers each page only to the roles that reach it', () => {
        for (const role of [RoleEnums.USER, RoleEnums.USER_EXTERNAL, RoleEnums.ARCHIVIST]) {
            expect(ids('/finance', role)).withContext(role).toEqual([]);
            expect(ids('/users', role)).withContext(role).toEqual([]);
        }
        for (const role of ROLES.filter((candidate) => candidate !== RoleEnums.SUPER_ADMIN)) {
            expect(ids('/tenants', role)).withContext(role).toEqual([]);
            expect(ids('/legal-documents', role)).withContext(role).toEqual([]);
        }
        expect(ids('/tracks', RoleEnums.TREASURER)).toEqual([]);
        expect(ids('/tenants', RoleEnums.SUPER_ADMIN)).toEqual(['page.tenants.create', 'page.tenants.list']);
        expect(ids('/finance', RoleEnums.TREASURER)).toContain('page.finance.movements');
    });

    it('gives nothing on a page whose section is off', () => {
        const allButInventory = (feature: TenantFeature) => feature !== TenantFeature.INVENTORY;

        for (const role of ROLES) {
            expect(ids('/inventory', role, allButInventory))
                .withContext(role)
                .toEqual([]);
            expect(ids('/calendar/1', role, (feature) => feature !== TenantFeature.CALENDAR))
                .withContext(role)
                .toEqual([]);
            expect(ids('/finance', role, allOff))
                .withContext(role)
                .toEqual([]);
        }
    });

    it('shows the payouts tab of the finance page only with the shares of the participants', () => {
        const withoutPayouts = (feature: TenantFeature) => feature !== TenantFeature.EVENT_PAYOUTS;

        for (const role of [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.TREASURER]) {
            expect(ids('/finance?tab=payouts', role).at(-1)).withContext(role).toBe('page.finance.payouts');
            expect(ids('/finance', role, withoutPayouts))
                .withContext(role)
                .not.toContain('page.finance.payouts');
            expect(ids('/finance', role, withoutPayouts))
                .withContext(role)
                .toContain('page.finance.years');
        }
    });

    it('never exceeds ten steps on a page', () => {
        for (const page of GUIDED_TOUR_PAGES) {
            for (const role of ROLES) {
                expect(composePageGuide(page, role, allOn).length)
                    .withContext(`${page.pages[0]} ${role}`)
                    .toBeLessThanOrEqual(GUIDED_TOUR_PAGE_MAX_STEPS);
            }
        }
    });

    it('keeps identifiers and texts within the limits of the card', () => {
        const steps = GUIDED_TOUR_PAGES.flatMap((page) => page.steps);
        const unique = new Set([...steps, ...GUIDED_TOUR_STEPS].map((step) => step.id));
        expect(unique.size).toBe(steps.length + GUIDED_TOUR_STEPS.length);

        for (const step of steps) {
            expect(step.id)
                .withContext(step.id)
                .toMatch(/^page\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
            expect(step.anchors?.length).withContext(step.id).toBeGreaterThan(0);
            expect(step.title.length).withContext(step.id).toBeLessThanOrEqual(40);
            texts(step.body).forEach((body) => expect(body.length).withContext(step.id).toBeLessThanOrEqual(180));
            expect((step.points ?? []).length)
                .withContext(step.id)
                .toBeLessThanOrEqual(3);
            (step.points ?? []).forEach((point) => expect(point.text.length).withContext(step.id).toBeLessThanOrEqual(60));
            expect(step.introducedIn).withContext(step.id).toBeGreaterThan(0);
        }
    });

    it('never says tenant to the roles of an organization', () => {
        for (const step of GUIDED_TOUR_PAGES.flatMap((page) => page.steps)) {
            for (const role of step.roles.filter((candidate) => candidate !== RoleEnums.SUPER_ADMIN)) {
                expect(`${step.title} ${textFor(step.body, role)}`.toLowerCase())
                    .withContext(`${step.id} ${role}`)
                    .not.toContain('tenant');
            }
        }
    });
});
