package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJob;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.MediaRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEngravingJobRepository;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.scoreplayback.ScorePlaybackSupport;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrClient;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrDtos.EngravingResponse;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Runs an engraving job: takes it, reads the version, waits for the music service outside any transaction, then stores
 * the pages and the PDF with the job. The pages wait there until the archivist assigns them, or go at once to a part
 * without pages when the job asks so; a newer engraving of the same part releases the pages never assigned. A job is
 * taken by one worker only; a result that arrives after the job was handed to another attempt is discarded.
 */
@Service
public class ScoreEngravingWorker {

    static final String SYSTEM = "system";
    static final String VERSION_NOT_FOUND = "versionNotFound";
    static final String INTERRUPTED = "interrupted";
    static final String UNEXPECTED = "unexpected";
    static final String ENGINE_FAILED = "engineFailed";
    static final String DONE = "done";

    private static final Logger log = LoggerFactory.getLogger(ScoreEngravingWorker.class);

    private final ScoreEngravingJobRepository jobRepository;
    private final ScoreVersionRepository versionRepository;
    private final TracksRepository tracksRepository;
    private final MediaRepository mediaRepository;
    private final MediaService mediaService;
    private final OmrClient omrClient;
    private final ScoreEngravingFiles files;
    private final ScoreWritingMetrics metrics;
    private final TenantTransactionExecutor transactions;

    public ScoreEngravingWorker(
        ScoreEngravingJobRepository jobRepository,
        ScoreVersionRepository versionRepository,
        TracksRepository tracksRepository,
        MediaRepository mediaRepository,
        MediaService mediaService,
        OmrClient omrClient,
        ScoreEngravingFiles files,
        ScoreWritingMetrics metrics,
        TenantTransactionExecutor transactions
    ) {
        this.jobRepository = jobRepository;
        this.versionRepository = versionRepository;
        this.tracksRepository = tracksRepository;
        this.mediaRepository = mediaRepository;
        this.mediaService = mediaService;
        this.omrClient = omrClient;
        this.files = files;
        this.metrics = metrics;
        this.transactions = transactions;
    }

    /** The version read when the job was taken, and the attempt that took it; {@code score} is null without a version. */
    private record Input(int attempt, String fileName, String mimeType, byte[] score, String options) {}

    /** What the service returned, decoded. */
    private record Output(String version, long durationMillis, List<byte[]> pages, byte[] pdf) {}

    public void run(String tenant, Long jobId) {
        boolean claimed = transactions.execute(tenant, () -> jobRepository.claim(jobId, ZonedDateTime.now(), SYSTEM) == 1);
        if (!claimed) {
            log.debug("Engraving job {} already taken or finished", jobId);
            return;
        }
        Input input;
        try {
            input = transactions.execute(tenant, () -> input(tenant, jobId));
        } catch (RuntimeException exception) {
            log.error("Version of engraving job {} not readable", jobId, exception);
            fail(tenant, jobId, null, UNEXPECTED);
            return;
        }
        if (input.score() == null) {
            fail(tenant, jobId, input.attempt(), VERSION_NOT_FOUND);
            return;
        }
        long started = System.nanoTime();
        Output output;
        try {
            output = decode(omrClient.engrave(input.fileName(), input.mimeType(), input.score(), input.options()));
        } catch (OmrException exception) {
            log.warn("Engraving job {} refused: {}", jobId, exception.getCode());
            fail(tenant, jobId, input.attempt(), exception.getCode());
            return;
        } catch (IllegalArgumentException exception) {
            log.warn("Engraving job {} returned an unusable result: {}", jobId, exception.getMessage());
            fail(tenant, jobId, input.attempt(), ENGINE_FAILED);
            return;
        } catch (RuntimeException exception) {
            log.error("Engraving job {} failed unexpectedly", jobId, exception);
            fail(tenant, jobId, input.attempt(), UNEXPECTED);
            return;
        }
        Duration elapsed = Duration.ofNanos(System.nanoTime() - started);
        try {
            boolean done = transactions.execute(tenant, () -> complete(tenant, jobId, input.attempt(), output));
            if (done) metrics.engravingDuration(elapsed);
        } catch (RuntimeException exception) {
            log.error("Pages of engraving job {} not stored", jobId, exception);
            fail(tenant, jobId, input.attempt(), UNEXPECTED);
        }
    }

    /** Ends an active job with an error; must run in a tenant transaction. */
    void markFailed(ScoreEngravingJob job, String code) {
        job.setStatus(ScoreEngravingJobStatus.FAILED);
        job.setErrorCode(code);
        job.setFinishedAt(ZonedDateTime.now());
        job.touchAudit(SYSTEM);
        metrics.engraving(code);
    }

    private void fail(String tenant, Long jobId, Integer attempt, String code) {
        transactions.execute(tenant, () -> {
            ScoreEngravingJob job = current(jobId, attempt);
            if (job != null) markFailed(job, code);
        });
    }

    private Input input(String tenant, Long jobId) {
        ScoreEngravingJob job = jobRepository.findByIdAndDeletedFalse(jobId).orElseThrow();
        Optional<ScoreVersion> version = part(job)
            .flatMap(part -> versionRepository.findByIdAndSheetMusicIdAndDeletedFalse(job.getScoreVersionId(), part.getId()));
        if (version.isEmpty()) return new Input(job.getAttempts(), null, null, null, null);
        MediaService.MediaContent content = mediaService.getContent(version.orElseThrow().getMediaAssetId(), tenant);
        return new Input(job.getAttempts(), content.fileName(), content.mimeType(), content.bytes(), job.getOptionsJson());
    }

    /** Stores the pages and the PDF; returns whether the job is done, or {@code false} when another attempt has it. */
    private boolean complete(String tenant, Long jobId, int attempt, Output output) {
        ScoreEngravingJob job = current(jobId, attempt);
        if (job == null) return false;
        // As for an assignment by the archivist, the lock on the track serializes it with the saves of the track.
        Tracks locked = job.isAssignToEmptyPart() ? tracksRepository.findByIdForUpdate(job.getTrackId()).orElse(null) : null;
        Optional<SheetsMusic> found = part(job);
        if (found.isEmpty()) {
            markFailed(job, VERSION_NOT_FOUND);
            return false;
        }
        String description = found.orElseThrow().getDescription();
        List<Long> pages = new ArrayList<>();
        for (int index = 0; index < output.pages().size(); index++) {
            pages.add(mediaService.store(
                output.pages().get(index),
                ScoreEngravingFiles.pageName(description, index + 1),
                "image/png",
                ScoreEngravingFiles.CATEGORY,
                tenant,
                SYSTEM
            ).getId());
        }
        Long pdf = mediaService.store(output.pdf(), ScoreEngravingFiles.pdfName(description), "application/pdf", ScoreEngravingFiles.CATEGORY, tenant, SYSTEM).getId();

        job.setStatus(ScoreEngravingJobStatus.DONE);
        job.setErrorCode(null);
        job.setFinishedAt(ZonedDateTime.now());
        job.setEngineVersion(output.version());
        job.setDurationMillis(output.durationMillis());
        job.setPageCount(pages.size());
        job.setPdfMediaAssetId(pdf);
        job.getPageMediaIds().clear();
        job.getPageMediaIds().addAll(pages);
        job.touchAudit(SYSTEM);

        // The pages of an older engraving of the part, never assigned, are superseded by these ones.
        List<ScoreEngravingJob> superseded = jobRepository
            .findAllBySheetMusicIdAndStatusAndAppliedAtIsNullAndDeletedFalse(job.getSheetMusicId(), ScoreEngravingJobStatus.DONE)
            .stream()
            .filter(other -> !Objects.equals(other.getId(), job.getId()))
            .toList();
        files.release(superseded, tenant, SYSTEM);
        if (locked != null && found.orElseThrow().getMedia().isEmpty()) assign(locked, found.orElseThrow(), job);
        metrics.engraving(DONE);
        return true;
    }

    /** Gives the pages of the job to a part without pages, as the archivist would. */
    private void assign(Tracks track, SheetsMusic part, ScoreEngravingJob job) {
        job.getPageMediaIds().forEach(id -> part.getMedia().add(mediaRepository.getReferenceById(id)));
        part.setEngravedFromVersionId(job.getScoreVersionId());
        part.setEngravedPagesFingerprint(ScorePlaybackSupport.pagesFingerprint(part));
        track.setEditDate(new Date());
        tracksRepository.saveAndFlush(track);
        job.setAppliedAt(ZonedDateTime.now());
        job.setAppliedSheetMusicId(part.getId());
        job.getPageMediaIds().clear();
        metrics.engravingApplied("emptyPart");
    }

    /** The job, if it is still the active attempt that took it. */
    private ScoreEngravingJob current(Long jobId, Integer attempt) {
        ScoreEngravingJob job = jobRepository.findByIdAndDeletedFalse(jobId).orElse(null);
        if (job == null || !job.getStatus().isActive() || (attempt != null && job.getAttempts() != attempt)) {
            log.info("Engraving job {} was handed to another attempt: result discarded", jobId);
            return null;
        }
        return job;
    }

    private Optional<SheetsMusic> part(ScoreEngravingJob job) {
        return tracksRepository.findByIdAndDeletedFalse(job.getTrackId())
            .flatMap(track -> track.getScores().stream().filter(score -> Objects.equals(score.getId(), job.getSheetMusicId())).findFirst());
    }

    /** The pages and the PDF of the answer; an answer without them is not usable. */
    private static Output decode(EngravingResponse response) {
        if (response.pages() == null || response.pages().isEmpty() || response.pdf() == null) {
            throw new IllegalArgumentException("engraving without pages or PDF");
        }
        if (response.pageCount() != response.pages().size()) {
            throw new IllegalArgumentException("page count " + response.pageCount() + " for " + response.pages().size() + " pages");
        }
        return new Output(response.version(), response.durationMillis(), response.pageBytes(), response.pdfBytes());
    }
}
