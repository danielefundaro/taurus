import { Injectable, signal } from '@angular/core';
import { ScoreClip } from '../score-editor/score-passage';

/**
 * Appunti dell'editor di scrittura: l'ultimo passaggio copiato o tagliato, che si può incollare in un'altra parte o in
 * un altro brano finché la pagina resta aperta. Restano in memoria e non toccano gli appunti del sistema.
 */
@Injectable({ providedIn: 'root' })
export class ScoreClipboardService {
    private readonly current = signal<ScoreClip | null>(null);
    readonly clip = this.current.asReadonly();

    copy(clip: ScoreClip): void {
        this.current.set(clip);
    }

    clear(): void {
        this.current.set(null);
    }
}
