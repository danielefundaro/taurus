import cases from './compare-cases.json';
import { ScoreVersionOrigin } from '../module';
import { engineVersion, recognitionEngine, reviewCounts, ReviewedVersion, share } from './recognition-review';

const version = (id: number, origin: ScoreVersionOrigin, parentVersionId?: number): ReviewedVersion => ({ id, origin, parentVersionId });

describe('recognition-review', () => {
    for (const shared of cases.cases) {
        it(`counts the shared case "${shared.name}" like python -m accuracy compare`, () => {
            const counts = reviewCounts(shared.candidate, cases.reference);
            const kinds = (kind: string) => shared.expected.differences.filter((difference) => difference.kind === kind).length;
            expect(counts).toEqual({
                referenceMeasures: shared.expected.referenceMeasures,
                engineMeasures: shared.expected.candidateMeasures,
                correctMeasures: shared.expected.correctMeasures,
                pitchMeasures: kinds('pitch'),
                rhythmMeasures: kinds('rhythm'),
                tieMeasures: kinds('tie'),
                missingMeasures: kinds('missing'),
                extraMeasures: kinds('extra'),
                referenceMarks: shared.expected.referenceMarks,
                foundMarks: shared.expected.foundMarks
            });
            const matched = counts.correctMeasures + counts.pitchMeasures + counts.rhythmMeasures + counts.tieMeasures;
            expect(matched + counts.missingMeasures).toBe(counts.referenceMeasures);
            expect(matched + counts.extraMeasures).toBe(counts.engineMeasures);
        });
    }

    it('names the engines of the recognized versions', () => {
        expect(recognitionEngine('OMR_AUDIVERIS')).toBe('AUDIVERIS');
        expect(recognitionEngine('OMR_HOMR')).toBe('HOMR');
        expect(recognitionEngine('CORRECTION')).toBeNull();
    });

    it('climbs the corrections up to the version of the engine', () => {
        const recognized = version(1, 'OMR_HOMR');
        const versions = [recognized, version(2, 'CORRECTION', 1), version(3, 'WRITING', 2), version(4, 'UPLOAD_MUSICXML')];
        expect(engineVersion(versions, versions[2])).toBe(recognized);
        expect(engineVersion(versions, recognized)).toBe(recognized);
        expect(engineVersion(versions, versions[3])).toBeNull();
    });

    it('stops at the first engine and tells a missing version from a chain without engine', () => {
        const versions = [version(1, 'OMR_AUDIVERIS'), version(2, 'OMR_HOMR', 1), version(3, 'CORRECTION', 2)];
        expect(engineVersion(versions, versions[2])?.id).toBe(2);
        expect(engineVersion([version(5, 'CORRECTION', 4)], version(5, 'CORRECTION', 4))).toBeUndefined();
        const loop = [version(6, 'CORRECTION', 7), version(7, 'CORRECTION', 6)];
        expect(engineVersion(loop, loop[0])).toBeNull();
    });

    it('rounds the shares and has none without a total', () => {
        expect(share(1, 3)).toBe(33);
        expect(share(2, 3)).toBe(67);
        expect(share(0, 0)).toBeNull();
    });
});
