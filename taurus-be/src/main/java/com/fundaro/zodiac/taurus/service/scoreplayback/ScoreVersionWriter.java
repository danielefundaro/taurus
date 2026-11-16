package com.fundaro.zodiac.taurus.service.scoreplayback;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionOrigin;
import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersionStatus;
import com.fundaro.zodiac.taurus.repository.scoreplayback.ScoreVersionRepository;
import com.fundaro.zodiac.taurus.service.dto.MediaDTO;
import com.fundaro.zodiac.taurus.service.scoreplayback.MusicXmlInspector.ScoreChecks;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;

import java.time.ZonedDateTime;
import java.util.Objects;

/**
 * Creates the versions of a part, whatever their origin: checks, compressed file, next version number. The caller decides
 * whether the new version becomes the current one.
 */
@Component
public class ScoreVersionWriter {

    public static final String MEDIA_CATEGORY = "score-versions";

    private final ScorePlaybackSupport support;
    private final ScoreVersionRepository versionRepository;
    private final ObjectMapper objectMapper;

    public ScoreVersionWriter(ScorePlaybackSupport support, ScoreVersionRepository versionRepository, ObjectMapper objectMapper) {
        this.support = support;
        this.versionRepository = versionRepository;
        this.objectMapper = objectMapper;
    }

    /** Stores the compressed file of a new version: for a user request or for a background task. */
    @FunctionalInterface
    public interface MediaStore {
        MediaDTO store(byte[] content, String fileName);
    }

    /**
     * A version to create.
     *
     * @param document         MusicXML with the single part of the version
     * @param fileName         name of the stored file, without extension
     * @param pagesFingerprint pages of the part the version was produced from
     * @param parentVersionId  version a correction starts from
     * @param layout           position of the measures on the pages, stored as JSON; {@code null} when unknown
     * @param arrangementVersionId version of the score of the track a version extracted from it comes from
     */
    public record NewVersion(
        SheetsMusic part,
        Document document,
        ScoreVersionOrigin origin,
        String fileName,
        String sourceFileName,
        String sourcePartName,
        String pagesFingerprint,
        Long recognitionJobId,
        Long parentVersionId,
        Object layout,
        boolean approved,
        String actor,
        Long arrangementVersionId
    ) {
        /** A version that does not come from the score of the track. */
        public NewVersion(
            SheetsMusic part,
            Document document,
            ScoreVersionOrigin origin,
            String fileName,
            String sourceFileName,
            String sourcePartName,
            String pagesFingerprint,
            Long recognitionJobId,
            Long parentVersionId,
            Object layout,
            boolean approved,
            String actor
        ) {
            this(part, document, origin, fileName, sourceFileName, sourcePartName, pagesFingerprint, recognitionJobId, parentVersionId, layout, approved, actor, null);
        }
    }

    /** A created version with the checks computed on its content. */
    public record Written(ScoreVersion version, ScoreChecks checks) {}

    /**
     * @throws MusicXmlDocuments.MusicXmlException when the document cannot be inspected
     */
    public Written write(NewVersion request, MediaStore mediaStore) {
        ScoreChecks checks = MusicXmlInspector.inspect(request.document());
        byte[] compressed = MusicXmlDocuments.toCompressed(request.document());
        MediaDTO media = mediaStore.store(compressed, baseName(request.fileName()) + ".mxl");

        ScoreVersion version = new ScoreVersion();
        version.initializeAudit(request.actor());
        version.setSheetMusicId(request.part().getId());
        version.setVersionNumber(versionRepository.findMaxVersionNumber(request.part().getId()) + 1);
        version.setOrigin(request.origin());
        version.setStatus(ScoreVersionStatus.UNVERIFIED);
        if (request.approved()) approve(version, request.actor());
        version.setMediaAssetId(media.getId());
        version.setPagesFingerprint(request.pagesFingerprint());
        version.setRecognitionJobId(request.recognitionJobId());
        version.setParentVersionId(request.parentVersionId());
        version.setArrangementVersionId(request.arrangementVersionId());
        version.setSourceFileName(truncate(request.sourceFileName()));
        version.setSourcePartName(truncate(request.sourcePartName()));
        version.setMeasureCount(checks.measureCount());
        version.setChecksJson(support.checksJson(checks));
        version.setLayoutJson(json(request.layout()));
        try {
            versionRepository.saveAndFlush(version);
        } catch (DataIntegrityViolationException exception) {
            // Two versions of the same part took the same number at the same time: the later one is refused.
            throw new RequestAlertException(HttpStatus.CONFLICT, "Another version of the part was saved at the same time", ScorePlaybackSupport.ENTITY, "scorePlayback.version.conflict");
        }
        return new Written(version, checks);
    }

    public static void approve(ScoreVersion version, String actor) {
        version.setStatus(ScoreVersionStatus.APPROVED);
        version.setApprovedBy(actor);
        version.setApprovedAt(ZonedDateTime.now());
    }

    private String json(Object layout) {
        if (layout == null) return null;
        try {
            return objectMapper.writeValueAsString(layout);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to serialize the measure positions", exception);
        }
    }

    static String baseName(String fileName) {
        String name = Objects.requireNonNullElse(fileName, "score");
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        return base.isBlank() ? "score" : base;
    }

    private static String truncate(String value) {
        if (value == null) return null;
        return value.length() <= 255 ? value : value.substring(0, 255);
    }
}
