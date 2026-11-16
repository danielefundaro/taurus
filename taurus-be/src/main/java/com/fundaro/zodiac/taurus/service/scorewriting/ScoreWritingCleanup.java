package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaRegistry;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreDraftRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEditLockRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEngravingJobRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.ZonedDateTime;
import java.util.Collection;
import java.util.List;

/**
 * Nightly removal of the expired edit locks, with the names of their authors, of the drafts of parts and scores that no
 * longer exist, and of the engraved pages and PDFs nobody will use: pages never assigned after the retention, and the files of
 * parts that no longer exist. Runs for every active tenant, also when the features are off, so that nothing outlives its
 * part.
 */
@Component
public class ScoreWritingCleanup {

    private static final Logger log = LoggerFactory.getLogger(ScoreWritingCleanup.class);
    private static final String SYSTEM = "system";

    private final ScoreEditLockRepository lockRepository;
    private final ScoreDraftRepository draftRepository;
    private final ScoreEngravingJobRepository engravingRepository;
    private final ScoreEngravingFiles engravingFiles;
    private final ApplicationProperties properties;
    private final TenantSchemaRegistry tenantSchemaRegistry;
    private final TenantTransactionExecutor transactions;

    public ScoreWritingCleanup(
        ScoreEditLockRepository lockRepository,
        ScoreDraftRepository draftRepository,
        ScoreEngravingJobRepository engravingRepository,
        ScoreEngravingFiles engravingFiles,
        ApplicationProperties properties,
        TenantSchemaRegistry tenantSchemaRegistry,
        TenantTransactionExecutor transactions
    ) {
        this.lockRepository = lockRepository;
        this.draftRepository = draftRepository;
        this.engravingRepository = engravingRepository;
        this.engravingFiles = engravingFiles;
        this.properties = properties;
        this.tenantSchemaRegistry = tenantSchemaRegistry;
        this.transactions = transactions;
    }

    @Scheduled(cron = "${application.score-playback.cleanup-cron:0 15 4 * * *}")
    public void cleanupAllTenants() {
        for (String tenant : tenantSchemaRegistry.findActiveTenantCodes()) {
            try {
                Removed removed = cleanup(tenant);
                if (removed.locks() + removed.drafts() + removed.engravedFiles() > 0) {
                    log.info(
                        "Removed {} expired edit locks, {} orphan drafts and {} unused engraved files of tenant {}",
                        removed.locks(),
                        removed.drafts(),
                        removed.engravedFiles(),
                        tenant
                    );
                }
            } catch (RuntimeException exception) {
                log.warn("Edit locks, drafts and engraved files of tenant {} not cleaned: {}", tenant, exception.getMessage());
            }
        }
    }

    /** Removes the drafts and the edit locks of parts removed from their track, in the current tenant transaction. */
    public void forgetParts(Collection<Long> partIds) {
        if (partIds.isEmpty()) return;
        draftRepository.deleteAllByTargets(ScoreEditTarget.PART, partIds);
        lockRepository.deleteAllByTargets(ScoreEditTarget.PART, partIds);
    }

    /** Removes the expired locks, the orphan drafts and the unused engraved files of one tenant. */
    public Removed cleanup(String tenant) {
        return transactions.execute(tenant, () -> {
            ZonedDateTime now = ZonedDateTime.now();
            int locks = lockRepository.deleteExpired(now);
            int drafts = draftRepository.deleteOrphanPartDrafts() + draftRepository.deleteOrphanArrangementDrafts();
            List<Long> releasable = engravingRepository.findReleasableIds(now.minus(properties.getScoreWriting().getEngraving().getUnappliedRetention()));
            int engravedFiles = releasable.isEmpty() ? 0 : engravingFiles.release(engravingRepository.findAllById(releasable), tenant, SYSTEM);
            return new Removed(locks, drafts, engravedFiles);
        });
    }

    /** What a cleanup removed: locks, drafts, and the engraved pages and PDFs released. */
    public record Removed(int locks, int drafts, int engravedFiles) {}
}
