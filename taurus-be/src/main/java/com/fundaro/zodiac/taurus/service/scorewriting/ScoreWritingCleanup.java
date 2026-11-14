package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEditTarget;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaRegistry;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreDraftRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEditLockRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.ZonedDateTime;
import java.util.Collection;

/**
 * Nightly removal of the expired edit locks, with the names of their authors, and of the drafts of parts that no longer
 * exist. Runs for every active tenant, also when the features are off, so that nothing outlives its part.
 */
@Component
public class ScoreWritingCleanup {

    private static final Logger log = LoggerFactory.getLogger(ScoreWritingCleanup.class);

    private final ScoreEditLockRepository lockRepository;
    private final ScoreDraftRepository draftRepository;
    private final TenantSchemaRegistry tenantSchemaRegistry;
    private final TenantTransactionExecutor transactions;

    public ScoreWritingCleanup(
        ScoreEditLockRepository lockRepository,
        ScoreDraftRepository draftRepository,
        TenantSchemaRegistry tenantSchemaRegistry,
        TenantTransactionExecutor transactions
    ) {
        this.lockRepository = lockRepository;
        this.draftRepository = draftRepository;
        this.tenantSchemaRegistry = tenantSchemaRegistry;
        this.transactions = transactions;
    }

    @Scheduled(cron = "${application.score-playback.cleanup-cron:0 15 4 * * *}")
    public void cleanupAllTenants() {
        for (String tenant : tenantSchemaRegistry.findActiveTenantCodes()) {
            try {
                Removed removed = cleanup(tenant);
                if (removed.locks() + removed.drafts() > 0) {
                    log.info("Removed {} expired edit locks and {} orphan drafts of tenant {}", removed.locks(), removed.drafts(), tenant);
                }
            } catch (RuntimeException exception) {
                log.warn("Edit locks and drafts of tenant {} not cleaned: {}", tenant, exception.getMessage());
            }
        }
    }

    /** Removes the drafts and the edit locks of parts removed from their track, in the current tenant transaction. */
    public void forgetParts(Collection<Long> partIds) {
        if (partIds.isEmpty()) return;
        draftRepository.deleteAllByTargets(ScoreEditTarget.PART, partIds);
        lockRepository.deleteAllByTargets(ScoreEditTarget.PART, partIds);
    }

    /** Removes the expired locks and the orphan drafts of one tenant. */
    public Removed cleanup(String tenant) {
        return transactions.execute(tenant, () -> {
            int locks = lockRepository.deleteExpired(ZonedDateTime.now());
            int drafts = draftRepository.deleteOrphanPartDrafts();
            return new Removed(locks, drafts);
        });
    }

    public record Removed(int locks, int drafts) {}
}
