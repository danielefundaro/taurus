import Aura from '@primeuix/themes/aura-compat';
import Lara from '@primeuix/themes/lara-compat';
import Nora from '@primeuix/themes/nora-compat';
import {
    ACCESSIBLE_BADGE_LIGHT,
    ACCESSIBLE_BUTTON_LIGHT,
    ACCESSIBLE_LIGHT_SCHEME,
    ACCESSIBLE_MESSAGE,
    ACCESSIBLE_TOAST,
    accessibleComponents,
    accessibleSemantic,
    BadgeSeverity,
    ButtonSeverity,
    FILLED_BUTTON_PALETTES,
    FilledButtonSeverity,
    lightDarkParts,
    MessageSeverity,
    SEVERITY_PALETTES,
    withLight
} from './accessible-theme';

type Rgb = [number, number, number];
type Scheme = 'light' | 'dark';

/** La metà di un token `light-dark(chiaro, scuro)` che vale nel modo dato. */
const half = (value: string, scheme: Scheme): string => lightDarkParts(value)[scheme === 'light' ? 0 : 1];

/** Il colore di un token del preset nel modo dato: primitivo (`{yellow.700}`), semantico (`{surface.900}`) o esadecimale. */
function resolver(preset: any, scheme: Scheme): (token: string) => Rgb {
    const resolve = (token: string): Rgb => {
        const value = half(token, scheme).trim();
        const reference = /^\{(\w+)\.(\w+)\}$/.exec(value);
        if (!reference) return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) as Rgb;
        const [, palette, shade] = reference;
        const semantic = preset.semantic[palette];
        return resolve(semantic?.[shade] ?? preset.primitive[palette][shade]);
    };
    return resolve;
}

/** Il fondo che si vede: la tinta di `color-mix(in srgb, {tinta}, transparent N%)` sopra la superficie. */
function layer(background: string, ground: Rgb, resolve: (token: string) => Rgb, scheme: Scheme): Rgb {
    const value = half(background, scheme);
    const mix = /color-mix\(in srgb,\s*(\{[\w.]+\}),\s*transparent (\d+)%\)/.exec(value);
    if (!mix) return resolve(value);
    const weight = 1 - Number(mix[2]) / 100;
    const tint = resolve(mix[1]);
    return tint.map((channel, index) => Math.round(channel * weight + ground[index] * (1 - weight))) as Rgb;
}

/** Il rapporto di contrasto WCAG 2.1 fra due colori. */
function contrast(first: Rgb, second: Rgb): number {
    const luminance = (rgb: Rgb) => {
        const [r, g, b] = rgb.map((value) => {
            const channel = value / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
}

describe('accessible theme', () => {
    const presets = { Aura, Lara } as Record<string, any>;
    const severities = Object.keys(SEVERITY_PALETTES) as MessageSeverity[];
    const buttonSeverities = Object.keys(ACCESSIBLE_BUTTON_LIGHT) as ButtonSeverity[];
    // Le superfici su cui stanno messaggi, toast e pulsanti: card e fondo della pagina.
    const surfaces: Record<Scheme, string[]> = { light: ['{surface.0}', '{surface.100}'], dark: ['{surface.900}', '{surface.950}'] };

    describe('light-dark tokens', () => {
        it('splits a token at its top-level comma, keeping nested functions whole', () => {
            expect(lightDarkParts('light-dark(color-mix(in srgb, {blue.50}, transparent 5%), {blue.500})')).toEqual(['color-mix(in srgb, {blue.50}, transparent 5%)', '{blue.500}']);
        });

        it('treats a value without light-dark as the same in both modes', () => {
            expect(lightDarkParts('#ffffff')).toEqual(['#ffffff', '#ffffff']);
        });

        it('replaces the light half and keeps the dark half of the preset', () => {
            expect(withLight('{primary.700}', 'light-dark({primary.500}, {primary.400})')).toBe('light-dark({primary.700}, {primary.400})');
            expect(withLight('#ffffff', '{surface.0}')).toBe('light-dark(#ffffff, {surface.0})');
            expect(withLight('{surface.600}', undefined)).toBe('light-dark({surface.600}, {surface.600})');
        });
    });

    for (const [name, preset] of Object.entries(presets)) {
        for (const scheme of ['light', 'dark'] as Scheme[]) {
            it(`keeps the ${scheme} message and toast text of ${name} at 4.5:1 or more`, () => {
                const resolve = resolver(preset, scheme);
                const overrides = accessibleComponents(name, preset);
                for (const component of ['message', 'toast'] as const) {
                    for (const severity of severities) {
                        const text = resolve(overrides[component]![severity].color);
                        const background = preset.components[component][severity].background;
                        for (const surface of surfaces[scheme]) {
                            const ground = resolve(surface);
                            expect(contrast(text, layer(background, ground, resolve, scheme)))
                                .withContext(`${component} ${severity} on ${surface}`)
                                .toBeGreaterThanOrEqual(4.5);
                        }
                    }
                }
            });

            it(`keeps the ${scheme} outlined and simple messages of ${name} at 4.5:1 or more`, () => {
                const resolve = resolver(preset, scheme);
                for (const severity of severities) {
                    const tokens = ACCESSIBLE_MESSAGE[severity];
                    for (const surface of surfaces[scheme]) {
                        for (const [variant, color] of [
                            ['outlined', tokens.outlined.color],
                            ['simple', tokens.simple.color]
                        ]) {
                            expect(contrast(resolve(color), resolve(surface)))
                                .withContext(`${variant} ${severity} on ${surface}`)
                                .toBeGreaterThanOrEqual(4.5);
                        }
                    }
                }
            });
        }

        it(`keeps the light outlined and text buttons of ${name} at 4.5:1 or more`, () => {
            const resolve = resolver(preset, 'light');
            const button = accessibleComponents(name, preset).button;
            for (const variant of ['outlined', 'text'] as const) {
                for (const severity of buttonSeverities) {
                    for (const surface of surfaces.light) {
                        expect(contrast(resolve(button[variant][severity].color), resolve(surface)))
                            .withContext(`${variant} ${severity} on ${surface}`)
                            .toBeGreaterThanOrEqual(4.5);
                    }
                }
            }
        });

        it(`keeps the light primary and muted text of ${name} at 4.5:1 or more`, () => {
            const resolve = resolver(preset, 'light');
            const semantic = accessibleSemantic(preset);
            expect(contrast(resolve(semantic.primary.contrastColor), resolve(semantic.primary.color)))
                .withContext('label on primary')
                .toBeGreaterThanOrEqual(4.5);
            for (const surface of surfaces.light) {
                expect(contrast(resolve(semantic.primary.color), resolve(surface)))
                    .withContext(`primary on ${surface}`)
                    .toBeGreaterThanOrEqual(4.5);
                expect(contrast(resolve(semantic.text.mutedColor), resolve(surface)))
                    .withContext(`muted text on ${surface}`)
                    .toBeGreaterThanOrEqual(4.5);
            }
        });
    }

    // L'etichetta dei pulsanti pieni è bianca su un fondo colorato in tutti i preset, Nora compreso.
    const filledSeverities = Object.keys(FILLED_BUTTON_PALETTES) as FilledButtonSeverity[];
    const filledStates = [
        ['color', 'background'],
        ['hoverColor', 'hoverBackground'],
        ['activeColor', 'activeBackground']
    ] as const;
    for (const [name, preset] of Object.entries({ Aura, Lara, Nora } as Record<string, any>)) {
        it(`keeps the light filled buttons of ${name} at 4.5:1 or more`, () => {
            const resolve = resolver(preset, 'light');
            const root = accessibleComponents(name, preset).button.root;
            for (const severity of filledSeverities) {
                for (const [label, background] of filledStates) {
                    expect(contrast(resolve(preset.components.button.root[severity][label]), resolve(root[severity][background])))
                        .withContext(`${severity} ${background}`)
                        .toBeGreaterThanOrEqual(4.5);
                }
                expect(half(root[severity].borderColor, 'light')).withContext(`${severity} border`).toBe(half(root[severity].background, 'light'));
            }
        });
    }

    // Il numero dei badge pieni è bianco su un fondo colorato in tutti i preset, Nora compreso.
    const badgeSeverities = Object.keys(ACCESSIBLE_BADGE_LIGHT) as BadgeSeverity[];
    for (const [name, preset] of Object.entries({ Aura, Lara, Nora } as Record<string, any>)) {
        it(`keeps the light filled badges of ${name} at 4.5:1 or more`, () => {
            const resolve = resolver(preset, 'light');
            const badge = accessibleComponents(name, preset).badge;
            for (const severity of badgeSeverities) {
                expect(contrast(resolve(preset.components.badge[severity].color), resolve(badge[severity].background)))
                    .withContext(`badge ${severity}`)
                    .toBeGreaterThanOrEqual(4.5);
            }
        });
    }

    // Con la 3 di @primeuix/themes uno scostamento solo chiaro sostituirebbe anche il modo scuro.
    for (const [name, preset] of Object.entries({ Aura, Lara, Nora } as Record<string, any>)) {
        it(`leaves the dark half of ${name} to the preset`, () => {
            const semantic = accessibleSemantic(preset);
            expect(half(semantic.primary.color, 'dark')).toBe(half(preset.semantic.primary.color, 'dark'));
            expect(half(semantic.primary.contrastColor, 'dark')).toBe(half(preset.semantic.primary.contrastColor, 'dark'));
            expect(half(semantic.text.mutedColor, 'dark')).toBe(half(preset.semantic.text.mutedColor, 'dark'));
            expect(half(semantic.text.hoverMutedColor, 'dark')).toBe(half(preset.semantic.text.hoverMutedColor, 'dark'));
            expect(half(semantic.primary.color, 'light')).toBe(ACCESSIBLE_LIGHT_SCHEME.primary.color);

            const button = accessibleComponents(name, preset).button;
            for (const variant of ['outlined', 'text'] as const) {
                for (const severity of buttonSeverities) {
                    expect(half(button[variant][severity].color, 'dark')).withContext(`${variant} ${severity}`).toBe(half(preset.components.button[variant][severity].color, 'dark'));
                }
            }
            for (const severity of filledSeverities) {
                for (const [token, value] of Object.entries(button.root[severity])) {
                    expect(half(value, 'dark')).withContext(`filled ${severity} ${token}`).toBe(half(preset.components.button.root[severity][token], 'dark'));
                }
            }
            const badge = accessibleComponents(name, preset).badge;
            for (const severity of badgeSeverities) {
                expect(half(badge[severity].background, 'dark')).withContext(`badge ${severity}`).toBe(half(preset.components.badge[severity].background, 'dark'));
            }
        });
    }

    it('leaves Nora the filled messages and toasts it draws with light text', () => {
        const overrides = accessibleComponents('Nora', Nora);
        expect(overrides.message).toBeUndefined();
        expect(overrides.toast).toBeUndefined();
        expect(overrides.button).toEqual(accessibleComponents('Nora', Nora).button);
    });

    it('applies the message and toast overrides to Aura, Lara and the default preset', () => {
        for (const [name, preset] of [
            ['Aura', Aura],
            ['Lara', Lara],
            [undefined, Aura]
        ] as const) {
            const overrides = accessibleComponents(name, preset);
            expect(overrides.message).withContext(String(name)).toBe(ACCESSIBLE_MESSAGE);
            expect(overrides.toast).withContext(String(name)).toBe(ACCESSIBLE_TOAST);
        }
    });
});
