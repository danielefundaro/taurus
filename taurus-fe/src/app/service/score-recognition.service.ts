import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PendingReviews, RecognitionReport, RecognitionReviewRequest, ScoreVersion } from '../module';
import { engineVersion, recognitionEngine, reviewCounts } from '../score-player/recognition-review';
import { withHandledErrors } from './api-error-context';
import { ScorePlaybackService } from './score-playback.service';

/** Ciò che chi approva conosce già: versioni della parte e MusicXML, per non chiederli di nuovo al server. */
export interface KnownVersions {
    versions?: readonly ScoreVersion[];
    /** `versions` contiene tutte le versioni della parte. */
    complete?: boolean;
    /** MusicXML delle versioni, per identificativo. */
    contents?: ReadonlyMap<number, string>;
}

/**
 * Qualità del riconoscimento. All'approvazione di una parte che discende da una versione di un motore, il browser
 * confronta le due versioni e invia solo i conteggi: lo spartito resta nel tenant. La raccolta segue l'approvazione,
 * non la ritarda e, se non riesce, non mostra errori: la versione resta tra le approvazioni da raccogliere.
 */
@Injectable({ providedIn: 'root' })
export class ScoreRecognitionService {
    private readonly baseUrl = `${environment.baseUrl}/score-recognition`;
    /** La raccolta non disturba chi approva: i suoi errori non mostrano messaggi. */
    private readonly silent = withHandledErrors(['*']);

    constructor(
        private readonly http: HttpClient,
        private readonly playbackService: ScorePlaybackService
    ) {}

    /** Riepilogo delle versioni riconosciute dal giorno `from` (`yyyy-MM-dd`), o di tutte. */
    report(from: string | null): Observable<RecognitionReport> {
        const params = from ? new HttpParams().set('from', from) : undefined;
        return this.http.get<RecognitionReport>(`${this.baseUrl}/report`, { params });
    }

    /** Le ultime approvazioni da raccogliere, al più `limit`, e quante sono. */
    pending(limit: number): Observable<PendingReviews> {
        return this.http.get<PendingReviews>(`${this.baseUrl}/pending`, { params: new HttpParams().set('limit', limit) });
    }

    /** Invia i conteggi di un'approvazione; gli errori non mostrano messaggi. */
    saveReview(trackId: number, scoreId: number, versionId: number, review: RecognitionReviewRequest): Observable<void> {
        return this.http.put<void>(`${environment.baseUrl}/tracks/${trackId}/scores/${scoreId}/score-versions/${versionId}/recognition-review`, review, { context: this.silent });
    }

    /**
     * Confronta la versione approvata con quella del motore da cui discende, se c'è, e ne invia i conteggi.
     *
     * @returns `true` se ha inviato i conteggi, `false` se la versione non viene da un motore o la raccolta non è riuscita
     */
    async collect(trackId: number, scoreId: number, approved: ScoreVersion, known: KnownVersions = {}): Promise<boolean> {
        try {
            let engine = engineVersion([approved, ...(known.versions ?? [])], approved);
            if (engine === undefined && !known.complete) {
                const versions = await firstValueFrom(this.playbackService.versions(trackId, scoreId));
                engine = engineVersion([approved, ...versions], approved);
            }
            if (!engine || !recognitionEngine(engine.origin)) return false;
            const [engineXml, approvedXml] = await Promise.all([this.content(trackId, scoreId, engine.id, known), this.content(trackId, scoreId, approved.id, known)]);
            await this.send(trackId, scoreId, approved.id, engine.id, engineXml, approvedXml);
            return true;
        } catch {
            return false;
        }
    }

    /** Confronta e invia i conteggi di un'approvazione già nota, come quelle da raccogliere. */
    async send(trackId: number, scoreId: number, approvedId: number, engineVersionId: number, engineXml: string, approvedXml: string): Promise<void> {
        const counts = reviewCounts(engineXml, approvedXml);
        await firstValueFrom(this.saveReview(trackId, scoreId, approvedId, { engineVersionId, ...counts }));
    }

    /** MusicXML di una versione, letto come nell'editor di correzione. */
    async content(trackId: number, scoreId: number, versionId: number, known: KnownVersions = {}): Promise<string> {
        return known.contents?.get(versionId) ?? (await firstValueFrom(this.playbackService.editor(trackId, scoreId, versionId))).musicXml;
    }
}
