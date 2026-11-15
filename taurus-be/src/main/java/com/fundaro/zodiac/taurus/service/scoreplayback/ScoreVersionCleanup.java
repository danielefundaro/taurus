package com.fundaro.zodiac.taurus.service.scoreplayback;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.ArrangementVersion;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaRegistry;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.repository.scorewriting.ArrangementVersionRepository;
import com.fundaro.zodiac.taurus.service.MediaService;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Nightly removal of old versions: for each part, the versions beyond the newest {@code kept-versions} are deleted unless
 * they are current, approved or the origin of a kept correction. The versions of the scores of the tracks follow the same
 * rule, and are kept while a version of a part extracted from them is. Their files are removed once nothing references
 * them.
 */
@Component
public class ScoreVersionCleanup {

    private static final Logger log = LoggerFactory.getLogger(ScoreVersionCleanup.class);
    private static final String SYSTEM = "system";

    private final ApplicationProperties properties;
    private final ScoreVersionRepository versionRepository;
    private final ArrangementVersionRepository arrangementVersionRepository;
    private final MediaService mediaService;
    private final TenantSchemaRegistry tenantSchemaRegistry;
    private final TenantFeatureService tenantFeatureService;
    private final TenantTransactionExecutor transactions;

    public ScoreVersionCleanup(
        ApplicationProperties properties,
        ScoreVersionRepository versionRepository,
        ArrangementVersionRepository arrangementVersionRepository,
        MediaService mediaService,
        TenantSchemaRegistry tenantSchemaRegistry,
        TenantFeatureService tenantFeatureService,
        TenantTransactionExecutor transactions
    ) {
        this.properties = properties;
        this.versionRepository = versionRepository;
        this.arrangementVersionRepository = arrangementVersionRepository;
        this.mediaService = mediaService;
        this.tenantSchemaRegistry = tenantSchemaRegistry;
        this.tenantFeatureService = tenantFeatureService;
        this.transactions = transactions;
    }

    @Scheduled(cron = "${application.score-playback.cleanup-cron:0 15 4 * * *}")
    public void cleanupAllTenants() {
        for (String tenant : tenantSchemaRegistry.findActiveTenantCodes()) {
            if (!tenantFeatureService.isEnabledForTenant(tenant, TenantFeature.SCORE_PLAYBACK)) continue;
            try {
                int removed = cleanup(tenant);
                if (removed > 0) log.info("Removed {} old score versions of tenant {}", removed, tenant);
            } catch (RuntimeException exception) {
                log.warn("Old score versions of tenant {} not removed: {}", tenant, exception.getMessage());
            }
        }
    }

    /** Removes the old versions of the parts and of the scores of one tenant and returns how many were removed. */
    public int cleanup(String tenant) {
        return transactions.execute(tenant, () -> {
            int kept = properties.getScorePlayback().getKeptVersions();
            // The parts first: a version of a score is kept while a version extracted from it is.
            List<ScoreVersion> removable = versionRepository.findAllById(versionRepository.findRemovableIds(kept));
            removable.forEach(version -> {
                version.setDeleted(true);
                version.touchAudit(SYSTEM);
            });
            versionRepository.saveAllAndFlush(removable);
            List<ArrangementVersion> removableScores = arrangementVersionRepository.findAllById(arrangementVersionRepository.findRemovableIds(kept));
            removableScores.forEach(version -> {
                version.setDeleted(true);
                version.touchAudit(SYSTEM);
            });
            arrangementVersionRepository.saveAllAndFlush(removableScores);
            removable.forEach(version -> mediaService.deleteIfUnreferenced(version.getMediaAssetId(), tenant, SYSTEM));
            removableScores.forEach(version -> mediaService.deleteIfUnreferenced(version.getMediaAssetId(), tenant, SYSTEM));
            return removable.size() + removableScores.size();
        });
    }
}
