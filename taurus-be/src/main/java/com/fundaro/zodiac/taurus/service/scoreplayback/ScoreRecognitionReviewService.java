package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.scoreplayback.RecognitionEngine;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreRecognitionReview;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreRecognitionReviewRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.TenantTimeZoneService;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.EngineSummaryDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.MonthSummaryDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.PendingReviewDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.PendingReviewsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.RecognitionCountsDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.RecognitionReportDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.RecognitionReviewRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scoreplayback.ScoreRecognitionDtos.ReviewedPartDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport.Viewer;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * Quality of the optical music recognition. When a part is approved, the browser compares the approved version with the
 * version of the engine it descends from and sends the counts, which are stored for that version of the engine: the
 * content of the score never leaves the tenant. The summary sums the reviews by engine and month and lists the parts the
 * archivists corrected the most; the pending approvals are those to collect from the approvals made before.
 */
@Service
@Transactional
public class ScoreRecognitionReviewService {

    /** Parts listed in the summary. */
    static final int MOST_CORRECTED = 20;
    static final int DEFAULT_PENDING = 100;
    static final int MAX_PENDING = 500;
    /** Versions climbed to find the version of the engine: far more than any chain of corrections. */
    private static final int MAX_CHAIN = 1000;
    private static final ZonedDateTime EVERYTHING = ZonedDateTime.of(1970, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    private final ScorePlaybackSupport support;
    private final ScoreVersionRepository versionRepository;
    private final ScoreRecognitionReviewRepository reviewRepository;
    private final TenantTimeZoneService timeZoneService;
    private final ScorePlaybackMetrics metrics;

    public ScoreRecognitionReviewService(
        ScorePlaybackSupport support,
        ScoreVersionRepository versionRepository,
        ScoreRecognitionReviewRepository reviewRepository,
        TenantTimeZoneService timeZoneService,
        ScorePlaybackMetrics metrics
    ) {
        this.support = support;
        this.versionRepository = versionRepository;
        this.reviewRepository = reviewRepository;
        this.timeZoneService = timeZoneService;
        this.metrics = metrics;
    }

    /** Counts that passed the checks. */
    private record Counts(
        int referenceMeasures,
        int engineMeasures,
        int correctMeasures,
        int pitchMeasures,
        int rhythmMeasures,
        int tieMeasures,
        int missingMeasures,
        int extraMeasures,
        int referenceMarks,
        int foundMarks
    ) {}

    /**
     * Stores the counts of the comparison between an approved version of the part and the version of the engine it
     * descends from, climbing the versions it derives from. For each version of an engine the latest approval counts: a
     * review of an approval older than the stored one changes nothing, and the metrics count only the first review.
     */
    public void record(Long trackId, Long scoreId, Long versionId, RecognitionReviewRequestDTO request, AbstractAuthenticationToken token) {
        SheetsMusic part = support.requirePart(support.requireTrack(trackId, Viewer.MANAGER), scoreId);
        ScoreVersion approved = versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(versionId, part.getId())
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Score version not found", ScorePlaybackSupport.ENTITY, "scorePlayback.version.notFound"));
        if (approved.getStatus() != ScoreVersionStatus.APPROVED || approved.getApprovedAt() == null) throw invalid("notApproved");
        if (request == null || request.engineVersionId() == null) throw invalid("notFromEngine");
        ScoreVersion engineVersion = engineVersion(approved).filter(version -> version.getId().equals(request.engineVersionId()))
            .orElseThrow(() -> invalid("notFromEngine"));
        RecognitionEngine engine = RecognitionEngine.of(engineVersion.getOrigin()).orElseThrow(() -> invalid("notFromEngine"));
        Counts counts = counts(request);

        Optional<ScoreRecognitionReview> stored = reviewRepository.findByEngineVersionId(engineVersion.getId());
        if (stored.filter(review -> review.getApprovedAt().isAfter(approved.getApprovedAt())).isPresent()) return;
        String actor = actor(token);
        ScoreRecognitionReview review = stored.orElseGet(() -> {
            ScoreRecognitionReview created = new ScoreRecognitionReview();
            created.initializeAudit(actor);
            created.setSheetMusicId(part.getId());
            created.setEngineVersionId(engineVersion.getId());
            created.setEngine(engine);
            created.setRecognizedAt(engineVersion.getInsertDate());
            return created;
        });
        review.touchAudit(actor);
        review.setApprovedVersionId(approved.getId());
        review.setApprovedAt(approved.getApprovedAt());
        review.setReferenceMeasures(counts.referenceMeasures());
        review.setEngineMeasures(counts.engineMeasures());
        review.setCorrectMeasures(counts.correctMeasures());
        review.setPitchMeasures(counts.pitchMeasures());
        review.setRhythmMeasures(counts.rhythmMeasures());
        review.setTieMeasures(counts.tieMeasures());
        review.setMissingMeasures(counts.missingMeasures());
        review.setExtraMeasures(counts.extraMeasures());
        review.setReferenceMarks(counts.referenceMarks());
        review.setFoundMarks(counts.foundMarks());
        try {
            reviewRepository.saveAndFlush(review);
        } catch (DataIntegrityViolationException exception) {
            // The same approval collected twice at the same time: the later request is refused, the first one counts.
            throw new RequestAlertException(HttpStatus.CONFLICT, "The review was saved by another request", ScorePlaybackSupport.ENTITY, "version.conflict");
        }
        if (stored.isEmpty()) {
            Map<String, Integer> measures = new LinkedHashMap<>();
            measures.put("correct", counts.correctMeasures());
            measures.put("pitch", counts.pitchMeasures());
            measures.put("rhythm", counts.rhythmMeasures());
            measures.put("tie", counts.tieMeasures());
            measures.put("missing", counts.missingMeasures());
            measures.put("extra", counts.extraMeasures());
            metrics.recognitionReview(engine.name(), measures, counts.foundMarks(), counts.referenceMarks() - counts.foundMarks());
        }
    }

    /**
     * Sums of the reviews of the versions recognized from the first day of {@code from} in the time zone of the tenant,
     * or of all of them, by engine and by month, and the parts the archivists corrected the most.
     */
    @Transactional(readOnly = true)
    public RecognitionReportDTO report(LocalDate from) {
        ZoneId zone = timeZoneService.currentZoneId();
        ZonedDateTime since = from == null ? EVERYTHING : from.atStartOfDay(zone);
        List<EngineSummaryDTO> engines = reviewRepository.sumByEngine(since).stream()
            .map(row -> new EngineSummaryDTO((RecognitionEngine) row[0], counts(row, 1)))
            .toList();
        List<MonthSummaryDTO> months = reviewRepository.sumByMonth(since, zone.getId()).stream()
            .map(row -> new MonthSummaryDTO((String) row[0], RecognitionEngine.valueOf((String) row[1]), counts(row, 2)))
            .toList();
        List<ReviewedPartDTO> parts = reviewRepository.findMostCorrected(since, MOST_CORRECTED).stream()
            .map(row -> new ReviewedPartDTO(
                number(row[0]),
                (String) row[1],
                number(row[2]),
                (String) row[3],
                RecognitionEngine.valueOf((String) row[4]),
                number(row[5]),
                number(row[6]).intValue(),
                number(row[7]),
                number(row[8]).intValue(),
                dateTime(row[9]),
                number(row[10]).intValue(),
                number(row[11]).intValue(),
                number(row[12]).intValue()
            ))
            .toList();
        return new RecognitionReportDTO(from, engines, months, parts);
    }

    /** The latest approvals to collect, at most {@code limit}, and how many there are. */
    @Transactional(readOnly = true)
    public PendingReviewsDTO pending(Integer limit) {
        int size = limit == null ? DEFAULT_PENDING : Math.clamp(limit, 1, MAX_PENDING);
        List<PendingReviewDTO> items = reviewRepository.findPending(size).stream()
            .map(row -> new PendingReviewDTO(
                number(row[0]),
                (String) row[1],
                number(row[2]),
                (String) row[3],
                RecognitionEngine.of(ScoreVersionOrigin.valueOf((String) row[4])).orElseThrow(),
                number(row[5]),
                number(row[6]).intValue(),
                number(row[7]),
                number(row[8]).intValue(),
                dateTime(row[9])
            ))
            .toList();
        return new PendingReviewsDTO(items.size() < size ? items.size() : reviewRepository.countPending(), items);
    }

    /**
     * The first version produced by an engine climbing from {@code version}, itself included, through the versions of
     * the same part it derives from. An approved version of an engine is compared with itself: all its measures are
     * correct.
     */
    Optional<ScoreVersion> engineVersion(ScoreVersion version) {
        ScoreVersion current = version;
        for (int step = 0; step < MAX_CHAIN && current != null; step++) {
            if (RecognitionEngine.of(current.getOrigin()).isPresent()) return Optional.of(current);
            Long parentId = current.getParentVersionId();
            current = parentId == null ? null : versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(parentId, version.getSheetMusicId()).orElse(null);
        }
        return Optional.empty();
    }

    /**
     * The counts, if consistent: every measure of the approved version is correct, of one kind or missing, every measure
     * of the engine correct, of one kind or extra, and the marks found are among those expected.
     */
    private static Counts counts(RecognitionReviewRequestDTO request) {
        List<Integer> values = Stream.of(
            request.referenceMeasures(),
            request.engineMeasures(),
            request.correctMeasures(),
            request.pitchMeasures(),
            request.rhythmMeasures(),
            request.tieMeasures(),
            request.missingMeasures(),
            request.extraMeasures(),
            request.referenceMarks(),
            request.foundMarks()
        ).toList();
        if (values.stream().anyMatch(value -> value == null || value < 0)) throw invalid("inconsistentCounts");
        Counts counts = new Counts(values.get(0), values.get(1), values.get(2), values.get(3), values.get(4), values.get(5), values.get(6), values.get(7), values.get(8), values.get(9));
        long matched = (long) counts.correctMeasures() + counts.pitchMeasures() + counts.rhythmMeasures() + counts.tieMeasures();
        boolean consistent = matched + counts.missingMeasures() == counts.referenceMeasures()
            && matched + counts.extraMeasures() == counts.engineMeasures()
            && counts.foundMarks() <= counts.referenceMarks();
        if (!consistent) throw invalid("inconsistentCounts");
        return counts;
    }

    private static RecognitionCountsDTO counts(Object[] row, int start) {
        return new RecognitionCountsDTO(
            number(row[start]),
            number(row[start + 1]),
            number(row[start + 2]),
            number(row[start + 3]),
            number(row[start + 4]),
            number(row[start + 5]),
            number(row[start + 6]),
            number(row[start + 7]),
            number(row[start + 8]),
            number(row[start + 9]),
            number(row[start + 10])
        );
    }

    private static Long number(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }

    private static ZonedDateTime dateTime(Object value) {
        return switch (value) {
            case ZonedDateTime zoned -> zoned;
            case OffsetDateTime offset -> offset.toZonedDateTime();
            case Instant instant -> instant.atZone(ZoneOffset.UTC);
            case Timestamp timestamp -> timestamp.toInstant().atZone(ZoneOffset.UTC);
            default -> throw new IllegalStateException("Unexpected date " + Objects.toString(value));
        };
    }

    private static RequestAlertException invalid(String reason) {
        return new RequestAlertException(HttpStatus.BAD_REQUEST, "Invalid recognition review", ScorePlaybackSupport.ENTITY, "scorePlayback.recognitionReviewInvalid")
            .with("reason", reason);
    }

    private static String actor(AbstractAuthenticationToken token) {
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        return actor == null || actor.isBlank() ? "system" : actor;
    }
}
