package com.fundaro.zodiac.taurus.service.impl;

import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.criteria.TracksCriteria;
import com.fundaro.zodiac.taurus.domain.enumeration.UploadFileStatusEnum;
import com.fundaro.zodiac.taurus.domain.instrumentsuggestion.SheetMusicInstrumentSuggestion;
import com.fundaro.zodiac.taurus.rabbitmq.Sender;
import com.fundaro.zodiac.taurus.rabbitmq.UploadFilesPackage;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.MediaRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.instrumentsuggestion.SheetMusicInstrumentSuggestionRepository;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.QueueUploadFilesService;
import com.fundaro.zodiac.taurus.service.upload.UploadJobMetrics;
import com.fundaro.zodiac.taurus.service.TracksService;
import com.fundaro.zodiac.taurus.service.dto.ChildrenEntitiesDTO;
import com.fundaro.zodiac.taurus.service.dto.QueueUploadFilesDTO;
import com.fundaro.zodiac.taurus.service.dto.SheetsMusicDTO;
import com.fundaro.zodiac.taurus.service.dto.TracksDTO;
import com.fundaro.zodiac.taurus.service.instrumentsuggestion.InstrumentSuggestionDraft;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreWritingCleanup;
import com.fundaro.zodiac.taurus.service.mapper.TracksMapper;
import com.fundaro.zodiac.taurus.utils.Converter;
import com.fundaro.zodiac.taurus.utils.pdf.PdfAnnotations;
import com.fundaro.zodiac.taurus.utils.pdf.PdfPageTransform;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.apache.commons.io.FilenameUtils;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

@Service
@Transactional
public class TracksServiceImpl extends CommonOpenSearchServiceImpl<Tracks, TracksDTO, TracksCriteria, TracksMapper, TracksRepository>
    implements TracksService {

    private final QueueUploadFilesService queueUploadFilesService;
    private final MediaRepository mediaRepository;
    private final InstrumentsRepository instrumentsRepository;
    private final Sender sender;
    private final ImageTransformationService imageTransformationService;
    private final UploadJobMetrics uploadJobMetrics;
    private final SheetMusicInstrumentSuggestionRepository suggestionRepository;
    private final ScoreWritingCleanup scoreWritingCleanup;
    private final ObjectMapper annotationsMapper = JsonMapper.builderWithJackson2Defaults().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();

    public TracksServiceImpl(
        TracksRepository repository,
        TracksMapper mapper,
        QueueUploadFilesService queueUploadFilesService,
        MediaRepository mediaRepository,
        InstrumentsRepository instrumentsRepository,
        Sender sender,
        ImageTransformationService imageTransformationService,
        UploadJobMetrics uploadJobMetrics,
        SheetMusicInstrumentSuggestionRepository suggestionRepository,
        ScoreWritingCleanup scoreWritingCleanup
    ) {
        super(repository, mapper, TracksService.class, Tracks.class);
        this.queueUploadFilesService = queueUploadFilesService;
        this.mediaRepository = mediaRepository;
        this.instrumentsRepository = instrumentsRepository;
        this.sender = sender;
        this.imageTransformationService = imageTransformationService;
        this.uploadJobMetrics = uploadJobMetrics;
        this.suggestionRepository = suggestionRepository;
        this.scoreWritingCleanup = scoreWritingCleanup;
    }

    @Override
    public TracksDTO save(TracksDTO dto, AbstractAuthenticationToken token) {
        finalizeOrders(dto);
        Tracks entity = getMapper().toEntity(dto);
        entity.setScores(resolveScores(dto, List.of()));
        saveEntity(entity, token, true);
        getRepository().flush();
        return getMapper().toDto(entity);
    }

    @Override
    public TracksDTO update(Long id, TracksDTO dto, AbstractAuthenticationToken token) {
        finalizeOrders(dto);
        Tracks entity = getRepository().findByIdAndDeletedFalse(id)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Entity not found", getEntityName(), "id.notFound"));
        if (dto.getVersion() != null && !dto.getVersion().equals(entity.getEntityVersion())) {
            throw new RequestAlertException(HttpStatus.CONFLICT, "Track was modified by another request", getEntityName(), "version.conflict");
        }
        if (!entity.getScores().isEmpty()) {
            // @OrderColumn updates retained rows before Hibernate deletes removed rows. Move the
            // current positions out of the final range first so the partial unique index cannot
            // observe a transient duplicate while the collection is being rebuilt.
            getRepository().moveActiveScoreOrdersToTemporaryRange(id);
        }
        getMapper().partialUpdate(entity, dto);
        List<SheetsMusic> resolvedScores = resolveScores(dto, entity.getScores());
        deleteSuggestionsOfRemovedScores(entity.getScores(), resolvedScores, token);
        entity.getScores().clear();
        entity.getScores().addAll(resolvedScores);
        saveEntity(entity, token, false);
        getRepository().flush();
        restoreScoreOrders(entity);
        return getMapper().toDto(entity);
    }

    @Override
    public TracksDTO partialUpdate(Long id, TracksDTO dto, AbstractAuthenticationToken token) {
        return update(id, dto, token);
    }

    @Override
    public TracksDTO appendScores(Long id, List<SheetsMusicDTO> scores, AbstractAuthenticationToken token) {
        Tracks entity = getRepository().findByIdForUpdate(id)
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Entity not found", getEntityName(), "id.notFound"));
        if (scores == null || scores.isEmpty()) {
            return getMapper().toDto(entity);
        }

        // By position in the list of the track: the save merges the track and replaces each new part with its managed copy.
        List<Map.Entry<Integer, List<InstrumentSuggestionDraft>>> suggestions = new ArrayList<>();
        for (SheetsMusicDTO score : scores) {
            if (score.getId() != null) {
                throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Generated score cannot already have an ID", getEntityName(), "id.exists");
            }
            normalizeOrder(score.getMedia());
            normalizeOrder(score.getInstruments());
            SheetsMusic created = resolveScore(score, new HashMap<>());
            entity.getScores().add(created);
            if (score.getInstrumentSuggestions() != null && !score.getInstrumentSuggestions().isEmpty()) {
                suggestions.add(Map.entry(entity.getScores().size() - 1, score.getInstrumentSuggestions()));
            }
        }

        saveEntity(entity, token, false);
        getRepository().flush();
        // The parts have their ids only now: the names to add are saved in the same transaction.
        String actor = SecurityUtils.getUserIdFromAuthentication(token);
        for (Map.Entry<Integer, List<InstrumentSuggestionDraft>> part : suggestions) {
            Long sheetMusicId = entity.getScores().get(part.getKey()).getId();
            part.getValue().forEach(draft -> suggestionRepository.save(suggestion(sheetMusicId, draft, actor)));
        }
        return getMapper().toDto(entity);
    }

    @Override
    protected Specification<Tracks> buildSpecification(TracksCriteria criteria) {
        return super.buildSpecification(criteria).and((root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (criteria == null) return cb.conjunction();
            addStringFilter(predicates, cb, root.get("subName"), criteria.getSubName());
            addStringFilter(predicates, cb, root.get("composer"), criteria.getComposer());
            addStringFilter(predicates, cb, root.get("arranger"), criteria.getArranger());
            addStringFilter(predicates, cb, root.get("tempo"), criteria.getTempo());
            addStringFilter(predicates, cb, root.get("tone"), criteria.getTone());
            addFilter(predicates, cb, root.get("state"), criteria.getState());
            if (criteria.getType() != null) {
                query.distinct(true);
                addStringFilter(predicates, cb, root.join("type"), criteria.getType());
            }
            if (criteria.getInstrumentId() != null || criteria.getMediaId() != null) {
                query.distinct(true);
                var score = root.join("scores");
                if (criteria.getInstrumentId() != null) {
                    addFilter(predicates, cb, score.join("instruments").get("id"), criteria.getInstrumentId());
                }
                if (criteria.getMediaId() != null) {
                    addFilter(predicates, cb, score.join("media").get("id"), criteria.getMediaId());
                }
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        });
    }

    @Override
    public QueueUploadFilesDTO uploadFile(Long id, MultipartFile file, String annotations, AbstractAuthenticationToken token) {
        if (file == null || file.isEmpty()) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "File is empty", getEntityName(), "track.file.empty");
        }
        validateAnnotations(annotations);
        QueueUploadFilesDTO upload = new QueueUploadFilesDTO();
        upload.setMultipartFile(file);
        upload.setType(getEntityName());
        upload.setDescription(annotations);
        if (id == null) {
            TracksDTO track = new TracksDTO();
            track.setName(FilenameUtils.removeExtension(file.getOriginalFilename()));
            id = save(track, token).getId();
        } else if (findOne(id, token).isEmpty()) {
            throw new RequestAlertException(HttpStatus.NOT_FOUND, "Entity not found", getEntityName(), "id.notFound");
        }
        upload.setTrackId(id);
        QueueUploadFilesDTO queued = queueUploadFilesService.saveStream(upload, token);
        try {
            byte[] message = Converter.objectToBytes(new UploadFilesPackage(queued.getId(), token));
            sendAfterCommit(queued.getId(), message, token);
        } catch (Exception exception) {
            uploadJobMetrics.recordFailure(UploadJobMetrics.FailureReason.PUBLISH_FAILED);
            throw new RequestAlertException(HttpStatus.INTERNAL_SERVER_ERROR, "Unable to queue the uploaded file", getEntityName(), "track.queue.failed");
        }
        uploadJobMetrics.record(UploadJobMetrics.Operation.QUEUED);
        return queued;
    }

    /**
     * Le annotazioni arrivano come JSON dal dialogo: un errore va detto subito, perché scoprirlo nel
     * worker significa un job in ERROR quando l'utente ha già chiuso l'upload. Il worker continua a
     * validarle per i job accodati prima di questo controllo e per le annotazioni legacy.
     */
    private void validateAnnotations(String annotations) {
        if (annotations == null || annotations.isBlank()) return;
        PdfAnnotations parsed;
        try {
            parsed = annotationsMapper.readValue(annotations, PdfAnnotations.class);
        } catch (Exception exception) {
            throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Annotations are not readable", getEntityName(), "track.annotations.invalid");
        }
        if (parsed == null || parsed.getPageTransforms() == null) return;
        for (PdfPageTransform transform : parsed.getPageTransforms()) {
            imageTransformationService.validate(transform.toRecipe());
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<QueueUploadFilesDTO> findUploadJobs(Long id, AbstractAuthenticationToken token) {
        if (findOne(id, token).isEmpty()) {
            throw new RequestAlertException(HttpStatus.NOT_FOUND, "Entity not found", getEntityName(), "id.notFound");
        }
        return queueUploadFilesService.findByTrackId(id);
    }

    @Override
    public QueueUploadFilesDTO retryUploadJob(Long id, Long jobId, AbstractAuthenticationToken token) {
        if (findOne(id, token).isEmpty()) {
            throw new RequestAlertException(HttpStatus.NOT_FOUND, "Entity not found", getEntityName(), "id.notFound");
        }
        QueueUploadFilesDTO job = queueUploadFilesService.findOne(jobId, token)
            .filter(value -> id.equals(value.getTrackId()))
            .orElseThrow(() -> new RequestAlertException(HttpStatus.NOT_FOUND, "Upload job not found", getEntityName(), "track.upload.notFound"));
        if (job.getStatus() != UploadFileStatusEnum.ERROR) {
            uploadJobMetrics.recordFailure(UploadJobMetrics.FailureReason.NOT_RETRYABLE);
            throw new RequestAlertException(HttpStatus.CONFLICT, "Only failed upload jobs can be retried", getEntityName(), "track.upload.notRetryable");
        }
        if (!queueUploadFilesService.transitionStatus(jobId, UploadFileStatusEnum.ERROR, UploadFileStatusEnum.TO_PROCESS, token)) {
            uploadJobMetrics.recordFailure(UploadJobMetrics.FailureReason.STATE_CHANGED);
            throw new RequestAlertException(HttpStatus.CONFLICT, "Upload job state changed", getEntityName(), "track.upload.versionConflict");
        }
        try {
            sendAfterCommit(jobId, Converter.objectToBytes(new UploadFilesPackage(jobId, token)), token);
        } catch (Exception exception) {
            queueUploadFilesService.transitionStatus(jobId, UploadFileStatusEnum.TO_PROCESS, UploadFileStatusEnum.ERROR, token);
            uploadJobMetrics.recordFailure(UploadJobMetrics.FailureReason.PUBLISH_FAILED);
            throw new RequestAlertException(HttpStatus.INTERNAL_SERVER_ERROR, "Unable to queue the uploaded file", getEntityName(), "track.queue.failed");
        }
        uploadJobMetrics.record(UploadJobMetrics.Operation.RETRIED);
        return queueUploadFilesService.findOne(jobId, token).orElseThrow();
    }

    private void sendAfterCommit(Long jobId, byte[] message, AbstractAuthenticationToken token) {
        if (
            !TransactionSynchronizationManager.isActualTransactionActive() ||
                !TransactionSynchronizationManager.isSynchronizationActive()
        ) {
            sender.send(message);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    sender.send(message);
                } catch (RuntimeException exception) {
                    getLogger().error("Unable to publish the committed upload job {}", jobId, exception);
                    uploadJobMetrics.recordFailure(UploadJobMetrics.FailureReason.PUBLISH_FAILED);
                    try {
                        queueUploadFilesService.markUnpublished(jobId, token);
                    } catch (RuntimeException markFailure) {
                        getLogger().error("Unable to fail the unpublished upload job {}", jobId, markFailure);
                    }
                }
            }
        });
    }

    private List<SheetsMusic> resolveScores(TracksDTO dto, List<SheetsMusic> existingScores) {
        if (dto.getScores() == null) return new ArrayList<>();
        Map<Long, SheetsMusic> existingById = new HashMap<>();
        existingScores.forEach(score -> existingById.put(score.getId(), score));
        return dto.getScores().stream()
            .sorted(Comparator.comparing(score -> score.getOrder() == null ? Long.MAX_VALUE : score.getOrder()))
            .map(score -> resolveScore(score, existingById))
            .collect(Collectors.toCollection(ArrayList::new));
    }

    private SheetsMusic resolveScore(SheetsMusicDTO dto, Map<Long, SheetsMusic> existingById) {
        SheetsMusic score;
        if (dto.getId() == null) {
            score = new SheetsMusic();
        } else {
            score = existingById.remove(dto.getId());
            if (score == null) {
                throw new RequestAlertException(HttpStatus.BAD_REQUEST, "Score does not belong to track", getEntityName(), "track.score.notFound");
            }
        }
        score.setDescription(dto.getDescription());
        score.setNeedsReview(Boolean.TRUE.equals(dto.getNeedsReview()));
        score.setMedia(dto.getMedia() == null ? new ArrayList<>() : dto.getMedia().stream()
            .sorted(Comparator.comparing(this::orderOf))
            .map(ref -> mediaRepository.getReferenceById(ref.getIndex()))
            .collect(Collectors.toCollection(ArrayList::new)));
        score.setInstruments(dto.getInstruments() == null ? new ArrayList<>() : dto.getInstruments().stream()
            .sorted(Comparator.comparing(this::orderOf))
            .map(ref -> instrumentsRepository.getReferenceById(ref.getIndex()))
            .collect(Collectors.toCollection(ArrayList::new)));
        return score;
    }

    private static SheetMusicInstrumentSuggestion suggestion(Long sheetMusicId, InstrumentSuggestionDraft draft, String actor) {
        SheetMusicInstrumentSuggestion suggestion = new SheetMusicInstrumentSuggestion();
        suggestion.setSheetMusicId(sheetMusicId);
        suggestion.setReadText(draft.readText());
        suggestion.setProposedName(draft.proposedName());
        suggestion.setNormalizedName(draft.normalizedName());
        suggestion.setCatalogKeyword(draft.catalogKeyword());
        suggestion.setSource(draft.source());
        suggestion.initializeAudit(actor);
        return suggestion;
    }

    /** The names to add go with the parts the track no longer has, merged parts included. */
    private void deleteSuggestionsOfRemovedScores(List<SheetsMusic> existing, List<SheetsMusic> kept, AbstractAuthenticationToken token) {
        Set<Long> keptIds = kept.stream().map(SheetsMusic::getId).filter(Objects::nonNull).collect(Collectors.toSet());
        List<Long> removed = existing.stream().map(SheetsMusic::getId).filter(id -> id != null && !keptIds.contains(id)).toList();
        if (removed.isEmpty()) return;
        suggestionRepository.deleteBySheetMusicIds(removed, SecurityUtils.getUserIdFromAuthentication(token), ZonedDateTime.now());
        // Drafts and edit locks have no foreign key: they go with their part.
        scoreWritingCleanup.forgetParts(removed);
    }

    private Long orderOf(ChildrenEntitiesDTO ref) {
        return ref.getOrder() == null ? Long.MAX_VALUE : ref.getOrder();
    }

    private void restoreScoreOrders(Tracks track) {
        for (int index = 0; index < track.getScores().size(); index++) {
            SheetsMusic score = track.getScores().get(index);
            if (score.getId() == null || getRepository().restoreActiveScoreOrder(track.getId(), score.getId(), index) != 1) {
                throw new IllegalStateException("Unable to persist score order for track " + track.getId());
            }
        }
    }

    private void finalizeOrders(TracksDTO dto) {
        if (dto.getScores() == null) return;
        AtomicLong scoreOrder = new AtomicLong();
        dto.getScores().stream().sorted(Comparator.comparing(score -> score.getOrder() == null ? Long.MAX_VALUE : score.getOrder()))
            .forEach(score -> {
                score.setOrder(scoreOrder.incrementAndGet());
                normalizeOrder(score.getMedia());
                normalizeOrder(score.getInstruments());
            });
    }

    private void normalizeOrder(java.util.Set<ChildrenEntitiesDTO> refs) {
        if (refs == null) return;
        AtomicLong order = new AtomicLong();
        refs.stream().sorted(Comparator.comparing(this::orderOf)).forEach(ref -> ref.setOrder(order.incrementAndGet()));
    }
}
