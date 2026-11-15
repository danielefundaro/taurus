import { HttpClient, HttpContext, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { Arrangement, ArrangementDraft, ArrangementVersion, ArrangementVersionRequest, NewArrangement } from '../module';

/** Partitura di una traccia, per chi gestisce la traccia con la scrittura attiva: versioni, bozza e creazione. */
@Injectable({ providedIn: 'root' })
export class ArrangementService {
    constructor(private readonly http: HttpClient) {}

    /** Partitura della traccia, o `null` se non ce l'ha. */
    arrangement(trackId: number): Promise<Arrangement | null> {
        return firstValueFrom(this.http.get<Arrangement>(this.url(trackId), { observe: 'response' }).pipe(map((response: HttpResponse<Arrangement>) => (response.status === 204 ? null : response.body))));
    }

    /** Crea la partitura con i righi e la prima bozza. */
    create(trackId: number, arrangement: NewArrangement, context?: HttpContext): Promise<Arrangement> {
        return firstValueFrom(this.http.post<Arrangement>(this.url(trackId), arrangement, { context }));
    }

    /** Elimina la partitura; le parti restano, senza il collegamento ai righi. */
    delete(trackId: number, session?: string, context?: HttpContext): Promise<void> {
        const params = session ? new HttpParams().set('session', session) : undefined;
        return firstValueFrom(this.http.delete<void>(this.url(trackId), { params, context }));
    }

    versions(trackId: number): Promise<ArrangementVersion[]> {
        return firstValueFrom(this.http.get<ArrangementVersion[]>(`${this.url(trackId)}/versions`));
    }

    /** Salva una versione dall'editor che possiede il blocco; diventa quella corrente. */
    save(trackId: number, request: ArrangementVersionRequest, context?: HttpContext): Promise<ArrangementVersion> {
        return firstValueFrom(this.http.post<ArrangementVersion>(`${this.url(trackId)}/versions`, request, { context }));
    }

    /** MusicXML non compresso di una versione, per l'editor e l'ascolto. */
    content(trackId: number, versionId: number): Promise<string> {
        return firstValueFrom(this.http.get(`${this.url(trackId)}/versions/${versionId}/content`, { responseType: 'text' }));
    }

    /** MusicXML compresso di una versione, da scaricare per MuseScore. */
    file(trackId: number, versionId: number): Promise<Blob> {
        return firstValueFrom(this.http.get(`${this.url(trackId)}/versions/${versionId}/file`, { responseType: 'blob' }));
    }

    approve(trackId: number, versionId: number, context?: HttpContext): Promise<ArrangementVersion> {
        return firstValueFrom(this.http.post<ArrangementVersion>(`${this.url(trackId)}/versions/${versionId}/approve`, {}, { context }));
    }

    /** Bozza della partitura, o `null` se non c'è. */
    draft(trackId: number): Promise<ArrangementDraft | null> {
        return firstValueFrom(this.http.get<ArrangementDraft>(this.draftUrl(trackId), { observe: 'response' }).pipe(map((response: HttpResponse<ArrangementDraft>) => (response.status === 204 ? null : response.body))));
    }

    /** Scarta la bozza: dalla scheda Partitura quando nessuno la scrive, o dall'editor che possiede il blocco (`session`). */
    discardDraft(trackId: number, session?: string): Promise<void> {
        const params = session ? new HttpParams().set('session', session) : undefined;
        return firstValueFrom(this.http.delete<void>(this.draftUrl(trackId), { params }));
    }

    /** Indirizzo della bozza, per il salvataggio automatico dell'editor. */
    draftUrl(trackId: number): string {
        return `${this.url(trackId)}/draft`;
    }

    private url(trackId: number): string {
        return `${environment.baseUrl}/tracks/${trackId}/arrangement`;
    }
}
