import { HttpContext } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { EnsembleInstrument, Instruments, InstrumentsCriteria } from '../module';
import { CommonOpenSearchService } from './common-open-search.service';

@Injectable({
    providedIn: 'root'
})
export class InstrumentsService extends CommonOpenSearchService<Instruments, InstrumentsCriteria> {
    override resourceName(): string {
        return "instruments";
    }

    /** Gli strumenti dell'organico della banda, nel loro ordine; vuoto senza organico. */
    public ensemble(context?: HttpContext): Observable<EnsembleInstrument[]> {
        return this.http.get<EnsembleInstrument[]>(`${this.baseUrl}/${this.resourceName()}/ensemble`, { context });
    }

    /** Tutti gli strumenti nell'ordine di riferimento, con la famiglia e la posizione attuale. */
    public ensembleReference(context?: HttpContext): Observable<EnsembleInstrument[]> {
        return this.http.get<EnsembleInstrument[]>(`${this.baseUrl}/${this.resourceName()}/ensemble/reference`, { context });
    }

    /** Sostituisce l'organico: `previousInstrumentIds` è l'organico letto, per riconoscere una modifica concorrente. */
    public saveEnsemble(instrumentIds: number[], previousInstrumentIds: number[], context?: HttpContext): Observable<EnsembleInstrument[]> {
        return this.http.put<EnsembleInstrument[]>(
            `${this.baseUrl}/${this.resourceName()}/ensemble`,
            { instrumentIds, previousInstrumentIds },
            { context }
        );
    }
}
