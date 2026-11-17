/** Larghezza del telefono per la scrittura delle parti. */
export const PHONE_QUERY = '(max-width: 768px)';

/**
 * Vero sul telefono, letto quando il componente nasce. Sul telefono le azioni di scrittura non compaiono: le parti scritte
 * si consultano e si ascoltano, mentre si scrivono da un computer o da un tablet in orizzontale.
 */
export function isPhoneViewport(): boolean {
    return typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;
}
