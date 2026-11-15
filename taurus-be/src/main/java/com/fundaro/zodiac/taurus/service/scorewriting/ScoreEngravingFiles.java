package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreEngravingJob;
import com.fundaro.zodiac.taurus.repository.scorewriting.ScoreEngravingJobRepository;
import com.fundaro.zodiac.taurus.service.MediaService;
import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * Names and releases the files of the engravings. A released job keeps its row, for the history of the part, but no
 * longer refers to its pages or its PDF; the files go once nothing else refers to them, as the pages replaced on a
 * part.
 */
@Component
public class ScoreEngravingFiles {

    /** Media category of the engraved pages and PDFs, the same of the pages of the parts. */
    static final String CATEGORY = "scores";

    private static final int NAME_LENGTH = 60;

    private final ScoreEngravingJobRepository jobRepository;
    private final MediaService mediaService;

    public ScoreEngravingFiles(ScoreEngravingJobRepository jobRepository, MediaService mediaService) {
        this.jobRepository = jobRepository;
        this.mediaService = mediaService;
    }

    /** Releases the pages not yet assigned and the PDF of the jobs; must run in a tenant transaction. */
    public int release(Collection<ScoreEngravingJob> jobs, String tenant, String actor) {
        return release(jobs, tenant, actor, true);
    }

    /** Releases only the PDF of the jobs, whose pages went to a part that has newer pages now. */
    public int releasePdfs(Collection<ScoreEngravingJob> jobs, String tenant, String actor) {
        return release(jobs, tenant, actor, false);
    }

    private int release(Collection<ScoreEngravingJob> jobs, String tenant, String actor, boolean pages) {
        List<Long> files = new ArrayList<>();
        for (ScoreEngravingJob job : jobs) {
            if (pages) {
                files.addAll(job.getPageMediaIds());
                job.getPageMediaIds().clear();
            }
            if (job.getPdfMediaAssetId() != null) {
                files.add(job.getPdfMediaAssetId());
                job.setPdfMediaAssetId(null);
            }
            job.touchAudit(actor);
        }
        if (files.isEmpty()) return 0;
        // The references go first: a file is removed only once nothing refers to it.
        jobRepository.flush();
        files.forEach(id -> mediaService.deleteIfUnreferenced(id, tenant, actor));
        return files.size();
    }

    /** File name of a page, from the description of the part, from 1. */
    static String pageName(String description, int page) {
        return base(description) + "-pagina-" + page + ".png";
    }

    static String pdfName(String description) {
        return base(description) + ".pdf";
    }

    /** The description in plain lower-case letters and digits, as the stored file names allow. */
    private static String base(String description) {
        String plain = Normalizer.normalize(description == null ? "" : description, Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", "-")
            .replaceAll("^-+|-+$", "");
        if (plain.length() > NAME_LENGTH) plain = plain.substring(0, NAME_LENGTH).replaceAll("-+$", "");
        return plain.isEmpty() ? "parte" : plain;
    }
}
