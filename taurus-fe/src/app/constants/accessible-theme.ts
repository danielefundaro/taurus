/**
 * Il tema accessibile: gli scostamenti dai preset di PrimeNG che portano il contrasto del testo sopra
 * il 4,5:1 che WCAG 2.1 AA chiede per il testo normale.
 *
 * Dalla 3 di `@primeuix/themes` un token vale per i due modi insieme, nella forma CSS
 * `light-dark(chiaro, scuro)`, invece di stare in `colorScheme.light` e `colorScheme.dark`. Uno
 * scostamento scritto solo per il modo chiaro sostituirebbe il token intero, e il modo scuro
 * prenderebbe le tinte del chiaro: per questo gli scostamenti qui si costruiscono dal preset scelto,
 * cambiando la metà chiara e lasciando quella scura del preset.
 */

/** Un preset di `@primeuix/themes`, nelle sole parti che il tema accessibile legge. */
export type ThemePreset = {
    semantic?: Record<string, any>;
    components?: Record<string, any>;
};

/** Le due metà di un token `light-dark(chiaro, scuro)`; un valore uguale nei due modi le ha uguali. */
export function lightDarkParts(value: string): [string, string] {
    const match = /^\s*light-dark\((.*)\)\s*$/s.exec(value);
    if (!match) return [value, value];
    let depth = 0;
    for (let index = 0; index < match[1].length; index++) {
        const char = match[1][index];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && depth === 0) return [match[1].slice(0, index).trim(), match[1].slice(index + 1).trim()];
    }
    return [value, value];
}

/** Il token con la metà chiara `light` e la metà scura del valore del preset, se il preset ne ha uno. */
export function withLight(light: string, presetValue: unknown): string {
    const dark = typeof presetValue === 'string' ? lightDarkParts(presetValue)[1] : light;
    return `light-dark(${light}, ${dark})`;
}

/**
 * Le tinte chiare del colore primario e del testo attenuato.
 *
 * Aura usa la tinta 500 della tavolozza come colore primario: con il testo bianco sopra, e come
 * testo su fondo bianco, si ferma a 2,53:1. La tinta 700 arriva almeno a 4,9:1 per tutte le
 * tavolozze offerte dal configuratore, e le tinte 800 e 900 restano più scure per il passaggio del
 * puntatore e per l'attivazione. Il testo attenuato passa da surface.500 a surface.600, perché sul
 * fondo delle pagine (surface.100) la tinta 500 si ferma a 4,34:1.
 *
 * La modalità scura non è toccata: lì il testo chiaro sta su fondo scuro e i rapporti sono già
 * sopra la soglia. Il gate di accessibilità della suite end to end misura questi rapporti.
 */
export const ACCESSIBLE_LIGHT_SCHEME = {
    primary: {
        color: '{primary.700}',
        contrastColor: '#ffffff',
        hoverColor: '{primary.800}',
        activeColor: '{primary.900}'
    },
    text: {
        mutedColor: '{surface.600}',
        hoverMutedColor: '{surface.700}'
    }
};

/** Gli scostamenti semantici del preset: primario e testo attenuato, con le metà scure del preset. */
export function accessibleSemantic(preset: ThemePreset) {
    const primary = preset.semantic?.['primary'] ?? {};
    const text = preset.semantic?.['text'] ?? {};
    const light = ACCESSIBLE_LIGHT_SCHEME;
    return {
        primary: {
            color: withLight(light.primary.color, primary.color),
            contrastColor: withLight(light.primary.contrastColor, primary.contrastColor),
            hoverColor: withLight(light.primary.hoverColor, primary.hoverColor),
            activeColor: withLight(light.primary.activeColor, primary.activeColor)
        },
        text: {
            mutedColor: withLight(light.text.mutedColor, text.mutedColor),
            hoverMutedColor: withLight(light.text.hoverMutedColor, text.hoverMutedColor)
        }
    };
}

/** Le severità dei pulsanti che il tema accessibile scurisce. */
export type ButtonSeverity = 'secondary' | 'success' | 'info' | 'warn' | 'help' | 'danger';

/**
 * Le tinte chiare dei pulsanti, per lo stesso motivo. Le varianti «outlined» e «text» scrivono
 * l'etichetta direttamente sul fondo della pagina con la tinta 500 della propria tavolozza, che si
 * ferma fra 2,3:1 e 4,34:1; la tinta 700 passa per tutte, e «secondary» usa surface.600, la stessa
 * che il pulsante pieno adotta già. I pulsanti pieni delle stesse severità sono in
 * `FILLED_BUTTON_PALETTES`.
 */
export const ACCESSIBLE_BUTTON_LIGHT: Record<ButtonSeverity, string> = {
    secondary: '{surface.600}',
    success: '{green.700}',
    info: '{sky.700}',
    warn: '{orange.700}',
    help: '{purple.700}',
    danger: '{red.700}'
};

/** Le severità dei pulsanti pieni che il tema accessibile scurisce. */
export type FilledButtonSeverity = 'success' | 'info' | 'warn' | 'help' | 'danger';

/** Le tavolozze con cui i preset colorano i pulsanti pieni delle severità. */
export const FILLED_BUTTON_PALETTES: Record<FilledButtonSeverity, string> = {
    success: 'green',
    info: 'sky',
    warn: 'orange',
    help: 'purple',
    danger: 'red'
};

/**
 * Le tinte chiare dei pulsanti pieni delle severità. I preset scrivono l'etichetta in bianco sul fondo
 * alla tinta 500 della tavolozza (600 in Nora), e quasi tutte restano sotto 4,5:1, fino a 2,3:1; la tinta 700 arriva
 * almeno a 5:1 per tutte, e le tinte 800 e 900 restano più scure per il passaggio del puntatore e per
 * l'attivazione, come per il colore primario. Valgono per ogni pulsante pieno dell'applicazione,
 * compresa l'azione delle conferme di eliminazione.
 */
export const ACCESSIBLE_FILLED_BUTTON_SHADES = {
    background: 700,
    hoverBackground: 800,
    activeBackground: 900,
    borderColor: 700,
    hoverBorderColor: 800,
    activeBorderColor: 900
} as const;

export type FilledButtonTokens = Record<keyof typeof ACCESSIBLE_FILLED_BUTTON_SHADES, string>;

/** Le severità piene dei badge che il tema accessibile scurisce. */
export type BadgeSeverity = 'success' | 'info' | 'warn' | 'danger';

/**
 * Il fondo chiaro dei badge pieni. I preset scrivono il numero in bianco, in grassetto a 10 pixel, sul
 * fondo alla tinta 500 della tavolozza (600 in Nora), e si fermano fra 2,2:1 e 4,1:1; la tinta 700
 * arriva almeno a 4,5:1 per tutte. A differenza dei pulsanti pieni, i badge sono pochi e piccoli, come
 * il contatore delle notifiche: scurirli non cambia l'aspetto dell'applicazione.
 */
export const ACCESSIBLE_BADGE_LIGHT: Record<BadgeSeverity, string> = {
    success: '{green.700}',
    info: '{sky.700}',
    warn: '{orange.700}',
    danger: '{red.700}'
};

/** Le tavolozze con cui Aura e Lara colorano le severità di p-message e p-toast. */
export const SEVERITY_PALETTES = { info: 'blue', success: 'green', warn: 'yellow', error: 'red' } as const;

export type MessageSeverity = keyof typeof SEVERITY_PALETTES;

/**
 * Le tinte del testo delle severità di p-message e p-toast, in modalità chiara e scura.
 *
 * In modalità chiara Aura e Lara scrivono il testo con la tinta 600 della tavolozza su un fondo alla
 * tinta 50: warn si ferma a 2,84:1, success a 3,16:1 ed error a 4,45:1. La tinta 700 basta a info,
 * success ed error, che arrivano almeno a 4,58:1. Il giallo è la tavolozza più chiara: alla tinta 700
 * le varianti «outlined» e «simple», che scrivono sul fondo della pagina (surface.100), si fermano a
 * 4,49:1, e warn scende alla tinta 800. In modalità scura il testo è alla tinta 500 sopra la stessa
 * tinta al 16%: sul fondo delle card (surface.900) info ed error si fermano a 3,96:1 e 3,99:1, mentre
 * la tinta 400 arriva almeno a 5,43:1 per tutte. accessible-theme.spec.ts misura questi rapporti sui
 * token del preset installato.
 */
const LIGHT_SHADES: Record<MessageSeverity, number> = { info: 700, success: 700, warn: 800, error: 700 };
const DARK_SHADES: Record<MessageSeverity, number> = { info: 400, success: 400, warn: 400, error: 400 };

/** Il colore del testo di una severità nei due modi. */
export function severityTextColor(severity: MessageSeverity): string {
    const palette = SEVERITY_PALETTES[severity];
    return `light-dark({${palette}.${LIGHT_SHADES[severity]}}, {${palette}.${DARK_SHADES[severity]}})`;
}

/** Il token di ogni severità, costruito sul colore del testo. */
function bySeverity<T>(token: (color: string) => T): Record<MessageSeverity, T> {
    const entries = (Object.keys(SEVERITY_PALETTES) as MessageSeverity[]).map((severity) => [severity, token(severityTextColor(severity))]);
    return Object.fromEntries(entries) as Record<MessageSeverity, T>;
}

/** Scostamenti di p-message: il testo pieno e quello delle varianti «outlined» e «simple». */
export const ACCESSIBLE_MESSAGE = bySeverity((color) => ({ color, outlined: { color }, simple: { color } }));

/** Scostamenti di p-toast, che usa per il titolo le stesse tinte e gli stessi fondi di p-message. */
export const ACCESSIBLE_TOAST = bySeverity((color) => ({ color }));

type ButtonVariant = Record<ButtonSeverity, { color: string }>;

export type AccessibleComponents = {
    button: { root: Record<FilledButtonSeverity, FilledButtonTokens>; outlined: ButtonVariant; text: ButtonVariant };
    badge: Record<BadgeSeverity, { background: string }>;
    message?: typeof ACCESSIBLE_MESSAGE;
    toast?: typeof ACCESSIBLE_TOAST;
};

/** I fondi dei badge pieni, con le metà scure del preset. */
function accessibleBadge(preset: ThemePreset): AccessibleComponents['badge'] {
    const badge = preset.components?.['badge'] ?? {};
    const entries = (Object.keys(ACCESSIBLE_BADGE_LIGHT) as BadgeSeverity[]).map((severity) => [severity, { background: withLight(ACCESSIBLE_BADGE_LIGHT[severity], badge[severity]?.background) }]);
    return Object.fromEntries(entries) as AccessibleComponents['badge'];
}

/** I pulsanti pieni delle severità e le varianti «outlined» e «text», con le metà scure del preset. */
function accessibleButton(preset: ThemePreset): AccessibleComponents['button'] {
    const button = preset.components?.['button'] ?? {};
    const variant = (name: 'outlined' | 'text'): ButtonVariant => {
        const entries = (Object.keys(ACCESSIBLE_BUTTON_LIGHT) as ButtonSeverity[]).map((severity) => [severity, { color: withLight(ACCESSIBLE_BUTTON_LIGHT[severity], button[name]?.[severity]?.color) }]);
        return Object.fromEntries(entries) as ButtonVariant;
    };
    const filled = (severity: FilledButtonSeverity): FilledButtonTokens => {
        const tokens = Object.entries(ACCESSIBLE_FILLED_BUTTON_SHADES).map(([token, shade]) => [token, withLight(`{${FILLED_BUTTON_PALETTES[severity]}.${shade}}`, button['root']?.[severity]?.[token])]);
        return Object.fromEntries(tokens) as FilledButtonTokens;
    };
    const root = Object.fromEntries((Object.keys(FILLED_BUTTON_PALETTES) as FilledButtonSeverity[]).map((severity) => [severity, filled(severity)]));
    return { root: root as AccessibleComponents['button']['root'], outlined: variant('outlined'), text: variant('text') };
}

/**
 * Gli scostamenti dei componenti per il preset scelto. Nora dà a messaggi e toast un fondo pieno con
 * il testo chiaro, e le tinte scure qui sopra lo renderebbero illeggibile: tiene i propri.
 */
export function accessibleComponents(name: string | undefined, preset: ThemePreset): AccessibleComponents {
    const button = accessibleButton(preset);
    const badge = accessibleBadge(preset);
    if (name === 'Nora') return { button, badge };
    return { button, badge, message: ACCESSIBLE_MESSAGE, toast: ACCESSIBLE_TOAST };
}
