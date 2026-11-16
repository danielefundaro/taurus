import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ScoreFragment, ScoreFragmentRequest, ScoreFragmentUpdate } from '../module';

/** Biblioteca dei frammenti della scrittura, del tenant. */
@Injectable({ providedIn: 'root' })
export class ScoreFragmentService {
    private readonly baseUrl = `${environment.baseUrl}/score-fragments`;

    constructor(private readonly http: HttpClient) {}

    /** I frammenti della biblioteca, per nome, senza il contenuto. */
    list(): Promise<ScoreFragment[]> {
        return firstValueFrom(this.http.get<ScoreFragment[]>(this.baseUrl));
    }

    /** MusicXML del frammento. */
    content(id: number): Promise<string> {
        return firstValueFrom(this.http.get(`${this.baseUrl}/${id}/content`, { responseType: 'text' }));
    }

    create(request: ScoreFragmentRequest, context?: HttpContext): Promise<ScoreFragment> {
        return firstValueFrom(this.http.post<ScoreFragment>(this.baseUrl, request, { context }));
    }

    /** Cambia nome, categoria e nota; il contenuto resta quello salvato. */
    update(id: number, request: ScoreFragmentUpdate, context?: HttpContext): Promise<ScoreFragment> {
        return firstValueFrom(this.http.put<ScoreFragment>(`${this.baseUrl}/${id}`, request, { context }));
    }

    /** Toglie il frammento dalla biblioteca; le parti dove è stato inserito non cambiano. */
    delete(id: number, context?: HttpContext): Promise<void> {
        return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/${id}`, { context }));
    }
}
