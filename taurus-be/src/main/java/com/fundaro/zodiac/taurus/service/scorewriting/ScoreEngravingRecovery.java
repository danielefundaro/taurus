package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.config.ApplicationProperties.EngravingJobProperties;
import com.fundaro.zodiac.taurus.config.ApplicationProperties.OmrProperties;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJob;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJobStatus;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaRegistry;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEngravingJobRepository;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.ZonedDateTime;
import java.util.HashSet;
import java.util.Set;

/**
 * Keeps the engraving jobs moving when a worker stops or a message is lost. A job running for longer than
 * {@code stale-after} is queued again, until it has been tried {@code max-attempts} times; a job queued for longer than
 * {@code stale-after} is published again. Duplicated messages are harmless: only one worker can take a job.
 */
@Component
public class ScoreEngravingRecovery {

    private static final Logger log = LoggerFactory.getLogger(ScoreEngravingRecovery.class);

    private final OmrProperties service;
    private final EngravingJobProperties properties;
    private final ScoreEngravingJobRepository jobRepository;
    private final ScoreEngravingQueue queue;
    private final ScoreEngravingWorker worker;
    private final TenantSchemaRegistry tenantSchemaRegistry;
    private final TenantFeatureService tenantFeatureService;
    private final TenantTransactionExecutor transactions;

    public ScoreEngravingRecovery(
        ApplicationProperties properties,
        ScoreEngravingJobRepository jobRepository,
        ScoreEngravingQueue queue,
        ScoreEngravingWorker worker,
        TenantSchemaRegistry tenantSchemaRegistry,
        TenantFeatureService tenantFeatureService,
        TenantTransactionExecutor transactions
    ) {
        this.service = properties.getOmr();
        this.properties = properties.getScoreWriting().getEngraving();
        this.jobRepository = jobRepository;
        this.queue = queue;
        this.worker = worker;
        this.tenantSchemaRegistry = tenantSchemaRegistry;
        this.tenantFeatureService = tenantFeatureService;
        this.transactions = transactions;
    }

    @Scheduled(fixedDelayString = "${application.score-writing.engraving.recovery-delay:PT1M}", initialDelayString = "PT1M")
    public void recoverAllTenants() {
        if (!service.isConfigured() || !properties.isRecoveryEnabled()) return;
        ZonedDateTime now = ZonedDateTime.now();
        for (String tenant : tenantSchemaRegistry.findActiveTenantCodes()) {
            if (!tenantFeatureService.isEnabledForTenant(tenant, TenantFeature.SCORE_WRITING)) continue;
            try {
                recover(tenant, now);
            } catch (RuntimeException exception) {
                log.warn("Engraving jobs of tenant {} not recovered: {}", tenant, exception.getMessage());
            }
        }
    }

    /** Recovers the jobs of one tenant as of {@code now}. */
    public void recover(String tenant, ZonedDateTime now) {
        ZonedDateTime limit = now.minus(properties.getStaleAfter());
        transactions.execute(tenant, () -> {
            Set<Long> requeued = new HashSet<>();
            for (ScoreEngravingJob job : jobRepository.findAllByStatusAndStartedAtBeforeAndDeletedFalse(ScoreEngravingJobStatus.RUNNING, limit)) {
                if (job.getAttempts() >= properties.getMaxAttempts()) {
                    log.warn("Engraving job {} interrupted {} times: failed", job.getId(), job.getAttempts());
                    worker.markFailed(job, ScoreEngravingWorker.INTERRUPTED);
                } else {
                    log.warn("Engraving job {} interrupted: queued again", job.getId());
                    job.setStatus(ScoreEngravingJobStatus.QUEUED);
                    job.setStartedAt(null);
                    job.touchAudit(ScoreEngravingWorker.SYSTEM);
                    queue.publishAfterCommit(tenant, job.getId());
                    requeued.add(job.getId());
                }
            }
            for (ScoreEngravingJob job : jobRepository.findAllByStatusAndEditDateBeforeAndDeletedFalse(ScoreEngravingJobStatus.QUEUED, limit)) {
                if (requeued.contains(job.getId())) continue;
                log.info("Engraving job {} still queued: published again", job.getId());
                job.touchAudit(ScoreEngravingWorker.SYSTEM);
                queue.publishAfterCommit(tenant, job.getId());
            }
        });
    }
}
