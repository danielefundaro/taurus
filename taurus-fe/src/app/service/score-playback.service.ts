import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { RoleEnums } from '../constants';
import {
    EngravingApplied,
    EngravingJob,
    EngravingOptions,
    EngravingTarget,
    ErrorReport,
    ErrorReportRequest,
    InstrumentPlaybackSuggestion,
    MusicXmlPart,
    PartPlaybackSettings,
    RecognitionJob,
    ScoreCorrection,
    ScoreEditorData,
    ScoreVersion,
    TrackPlayback,
    TrackPlaybackSettings
} from '../module';
import { KeycloakService } from './keycloak.service';

/**
 * Ascolto e correzione delle parti. Le letture usano il percorso del ruolo corrente (come le tracce); caricamento,
 * versioni e impostazioni sono riservati ad archivisti e amministratori.
 */
@Injectable({ providedIn: 'root' })
export class ScorePlaybackService {
    private readonly baseUrl = environment.baseUrl;

    constructor(
        private readonly http: HttpClient,
        private readonly keycloakService: KeycloakService
    ) {}

    playback(trackId: number): Observable<TrackPlayback> {
        return this.http.get<TrackPlayback>(`${this.readBase(trackId)}/playback`);
    }

    /** MusicXML non compresso della versione ascoltata per la parte. */
    playbackFile(trackId: number, scoreId: number): Observable<string> {
        return this.http.get(`${this.readBase(trackId)}/scores/${scoreId}/playback-file`, { responseType: 'text' });
    }

    versions(trackId: number, scoreId: number): Observable<ScoreVersion[]> {
        return this.http.get<ScoreVersion[]>(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions`);
    }

    inspect(trackId: number, scoreId: number, file: File, context?: HttpContext): Observable<MusicXmlPart[]> {
        return this.http.post<MusicXmlPart[]>(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions/inspect`, this.formData(file), { context });
    }

    upload(trackId: number, scoreId: number, file: File, partId: string | null, approve: boolean, context?: HttpContext): Observable<ScoreVersion> {
        let params = new HttpParams().set('approve', approve);
        if (partId) params = params.set('partId', partId);
        return this.http.post<ScoreVersion>(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions`, this.formData(file), { params, context });
    }

    approve(trackId: number, scoreId: number, versionId: number): Observable<ScoreVersion> {
        return this.http.post<ScoreVersion>(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions/${versionId}/approve`, {});
    }

    makeCurrent(trackId: number, scoreId: number, versionId: number): Observable<ScoreVersion> {
        return this.http.post<ScoreVersion>(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions/${versionId}/current`, {});
    }

    versionFile(trackId: number, scoreId: number, versionId: number): Observable<Blob> {
        return this.http.get(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions/${versionId}/file`, { responseType: 'blob' });
    }

    updatePartSettings(trackId: number, scoreId: number, settings: PartPlaybackSettings): Observable<PartPlaybackSettings> {
        return this.http.put<PartPlaybackSettings>(`${this.manageBase(trackId)}/scores/${scoreId}/playback-settings`, settings);
    }

    updateTrackSettings(trackId: number, settings: TrackPlaybackSettings, context?: HttpContext): Observable<TrackPlaybackSettings> {
        return this.http.put<TrackPlaybackSettings>(`${this.manageBase(trackId)}/playback-settings`, settings, { context });
    }

    /** Avvia il riconoscimento di una parte. */
    recognize(trackId: number, scoreId: number, context?: HttpContext): Observable<RecognitionJob[]> {
        return this.http.post<RecognitionJob[]>(`${this.manageBase(trackId)}/scores/${scoreId}/recognitions`, {}, { context });
    }

    /** Avvia il riconoscimento di tutte le parti con pagine e senza un riconoscimento in corso. */
    recognizeAll(trackId: number, context?: HttpContext): Observable<RecognitionJob[]> {
        return this.http.post<RecognitionJob[]>(`${this.manageBase(trackId)}/recognitions`, {}, { context });
    }

    /** Ultimo riconoscimento di ogni parte. */
    recognitions(trackId: number): Observable<RecognitionJob[]> {
        return this.http.get<RecognitionJob[]>(`${this.manageBase(trackId)}/recognitions`);
    }

    /** MusicXML, pagine e posizioni delle battute di una versione, per l'editor di correzione. */
    editor(trackId: number, scoreId: number, versionId: number): Observable<ScoreEditorData> {
        return this.http.get<ScoreEditorData>(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions/${versionId}/editor`);
    }

    /** Salva una correzione come nuova versione della parte, che diventa quella ascoltata. */
    correct(trackId: number, scoreId: number, correction: ScoreCorrection, context?: HttpContext): Observable<ScoreVersion> {
        return this.http.post<ScoreVersion>(`${this.manageBase(trackId)}/scores/${scoreId}/score-versions`, correction, { context });
    }

    /** Avvia l'impaginazione di una versione in pagine e PDF. */
    /** Avvia l'impaginazione; con `assign` le pagine vanno alla parte al termine, se la parte non ha pagine. */
    engrave(trackId: number, scoreId: number, versionId: number, options: EngravingOptions, context?: HttpContext, assign = false): Observable<EngravingJob> {
        const params = assign ? new HttpParams().set('assign', 'true') : undefined;
        return this.http.post<EngravingJob>(this.engravings(trackId, scoreId, versionId), options, { context, params });
    }

    /** Ultima impaginazione della versione; `null` se non ce ne sono. */
    engraving(trackId: number, scoreId: number, versionId: number): Observable<EngravingJob | null> {
        return this.http.get<EngravingJob | null>(this.engravings(trackId, scoreId, versionId));
    }

    /** Assegna le pagine di un'impaginazione terminata, al posto di quelle della parte o in una parte nuova. */
    applyEngraving(trackId: number, scoreId: number, versionId: number, jobId: number, target: EngravingTarget, trackVersion: number | null, context?: HttpContext): Observable<EngravingApplied> {
        return this.http.post<EngravingApplied>(`${this.engravings(trackId, scoreId, versionId)}/${jobId}/apply`, { target, trackVersion }, { context });
    }

    /** PDF dell'ultima impaginazione della versione. */
    engravingPdf(trackId: number, scoreId: number, versionId: number): Observable<Blob> {
        return this.http.get(`${this.engravings(trackId, scoreId, versionId)}/pdf`, { responseType: 'blob' });
    }

    /** Segnala un errore sentito nella versione ascoltata per la parte. */
    reportError(trackId: number, scoreId: number, report: ErrorReportRequest, context?: HttpContext): Observable<void> {
        return this.http.post<void>(`${this.readBase(trackId)}/scores/${scoreId}/error-reports`, report, { context });
    }

    /** Segnalazioni della traccia: prima le aperte, poi le chiuse più recenti. */
    errorReports(trackId: number): Observable<ErrorReport[]> {
        return this.http.get<ErrorReport[]>(`${this.manageBase(trackId)}/error-reports`);
    }

    closeErrorReport(trackId: number, reportId: number, context?: HttpContext): Observable<ErrorReport> {
        return this.http.post<ErrorReport>(`${this.manageBase(trackId)}/error-reports/${reportId}/close`, {}, { context });
    }

    /** Proposta dal nome dello strumento; `null` se il nome non corrisponde al catalogo di riferimento. */
    instrumentSuggestion(name: string): Observable<InstrumentPlaybackSuggestion | null> {
        return this.http.get<InstrumentPlaybackSuggestion | null>(`${this.baseUrl}/instruments/playback-suggestion`, { params: new HttpParams().set('name', name) });
    }

    get canManage(): boolean {
        return [RoleEnums.SUPER_ADMIN, RoleEnums.ADMIN, RoleEnums.BOARD, RoleEnums.ARCHIVIST].includes(this.keycloakService.currentUserRole);
    }

    private readBase(trackId: number): string {
        const role = this.keycloakService.currentUserRole;
        if (role === RoleEnums.USER_EXTERNAL) return `${this.baseUrl}/external/tracks/${trackId}`;
        if (role === RoleEnums.USER) return `${this.baseUrl}/user/tracks/${trackId}`;
        return this.manageBase(trackId);
    }

    private engravings(trackId: number, scoreId: number, versionId: number): string {
        return `${this.manageBase(trackId)}/scores/${scoreId}/score-versions/${versionId}/engravings`;
    }

    private manageBase(trackId: number): string {
        return `${this.baseUrl}/tracks/${trackId}`;
    }

    private formData(file: File): FormData {
        const data = new FormData();
        data.append('file', file);
        return data;
    }
}
