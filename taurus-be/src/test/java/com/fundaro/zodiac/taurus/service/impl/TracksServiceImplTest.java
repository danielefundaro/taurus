package com.fundaro.zodiac.taurus.service.impl;

import com.fundaro.zodiac.taurus.domain.Media;
import com.fundaro.zodiac.taurus.domain.SheetsMusic;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.enumeration.UploadFileStatusEnum;
import com.fundaro.zodiac.taurus.rabbitmq.Sender;
import com.fundaro.zodiac.taurus.repository.InstrumentsRepository;
import com.fundaro.zodiac.taurus.repository.MediaRepository;
import com.fundaro.zodiac.taurus.repository.TracksRepository;
import com.fundaro.zodiac.taurus.repository.instrumentsuggestion.SheetMusicInstrumentSuggestionRepository;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreWritingCleanup;
import com.fundaro.zodiac.taurus.service.QueueUploadFilesService;
import com.fundaro.zodiac.taurus.service.upload.UploadJobMetrics;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import com.fundaro.zodiac.taurus.service.dto.ChildrenEntitiesDTO;
import com.fundaro.zodiac.taurus.service.dto.QueueUploadFilesDTO;
import com.fundaro.zodiac.taurus.service.dto.SheetsMusicDTO;
import com.fundaro.zodiac.taurus.service.dto.TracksDTO;
import com.fundaro.zodiac.taurus.service.mapper.TracksMapper;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TracksServiceImplTest {

    @AfterEach
    void clearTransactionSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    @Test
    void publishesUploadJobOnlyAfterCommit() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        Sender sender = mock(Sender.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            sender,
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        JwtAuthenticationToken token = authentication();
        MultipartFile file = mock(MultipartFile.class);
        Tracks track = new Tracks();
        track.setId(8L);
        TracksDTO trackDTO = new TracksDTO();
        trackDTO.setId(8L);
        QueueUploadFilesDTO queued = new QueueUploadFilesDTO();
        queued.setId(3L);

        when(file.isEmpty()).thenReturn(false);
        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(track));
        when(mapper.toDto(track)).thenReturn(trackDTO);
        when(queueUploadFilesService.saveStream(any(QueueUploadFilesDTO.class), same(token))).thenReturn(queued);
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);

        assertThat(service.uploadFile(8L, file, null, token)).isSameAs(queued);

        verifyNoInteractions(sender);
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        verify(sender).send(any(byte[].class));
    }

    @Test
    void failsTheCommittedUploadJobWhenItsMessageIsNotPublished() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        Sender sender = mock(Sender.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            sender,
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        JwtAuthenticationToken token = authentication();
        MultipartFile file = mock(MultipartFile.class);
        Tracks track = new Tracks();
        track.setId(8L);
        TracksDTO trackDTO = new TracksDTO();
        trackDTO.setId(8L);
        QueueUploadFilesDTO queued = new QueueUploadFilesDTO();
        queued.setId(3L);

        when(file.isEmpty()).thenReturn(false);
        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(track));
        when(mapper.toDto(track)).thenReturn(trackDTO);
        when(queueUploadFilesService.saveStream(any(QueueUploadFilesDTO.class), same(token))).thenReturn(queued);
        doThrow(new IllegalStateException("broker down")).when(sender).send(any(byte[].class));
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);

        service.uploadFile(8L, file, null, token);
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);

        verify(queueUploadFilesService).markUnpublished(3L, token);
    }

    @Test
    void requeuesAFailedUploadJob() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        Sender sender = mock(Sender.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            sender,
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        JwtAuthenticationToken token = authentication();
        Tracks track = new Tracks();
        track.setId(8L);
        TracksDTO trackDto = new TracksDTO();
        trackDto.setId(8L);
        QueueUploadFilesDTO failed = new QueueUploadFilesDTO();
        failed.setId(3L);
        failed.setTrackId(8L);
        failed.setStatus(UploadFileStatusEnum.ERROR);
        QueueUploadFilesDTO queued = new QueueUploadFilesDTO();
        queued.setId(3L);
        queued.setTrackId(8L);
        queued.setStatus(UploadFileStatusEnum.TO_PROCESS);

        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(track));
        when(mapper.toDto(track)).thenReturn(trackDto);
        when(queueUploadFilesService.findOne(3L, token)).thenReturn(Optional.of(failed), Optional.of(queued));
        when(queueUploadFilesService.transitionStatus(3L, UploadFileStatusEnum.ERROR, UploadFileStatusEnum.TO_PROCESS, token)).thenReturn(true);

        assertThat(service.retryUploadJob(8L, 3L, token)).isSameAs(queued);
        verify(sender).send(any(byte[].class));
    }

    /**
     * Un nuovo tentativo si chiede su un job in errore: su un job ancora in coda o già concluso la
     * richiesta è un doppio clic o una pagina vecchia, e accodarlo di nuovo rischierebbe parti
     * duplicate.
     */
    @Test
    void refusesToRequeueAJobThatIsNotInError() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        Sender sender = mock(Sender.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            sender,
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        JwtAuthenticationToken token = authentication();
        Tracks track = new Tracks();
        track.setId(8L);
        TracksDTO trackDto = new TracksDTO();
        trackDto.setId(8L);
        QueueUploadFilesDTO running = new QueueUploadFilesDTO();
        running.setId(3L);
        running.setTrackId(8L);
        running.setStatus(UploadFileStatusEnum.IN_PROGRESS);

        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(track));
        when(mapper.toDto(track)).thenReturn(trackDto);
        when(queueUploadFilesService.findOne(3L, token)).thenReturn(Optional.of(running));

        assertThatThrownBy(() -> service.retryUploadJob(8L, 3L, token))
            .isInstanceOf(RequestAlertException.class)
            .hasMessageContaining("Only failed upload jobs can be retried");
        verifyNoInteractions(sender);
        verify(queueUploadFilesService, never()).transitionStatus(anyLong(), any(), any(), any());
    }

    /**
     * Il job esiste ma appartiene a un'altra traccia, cioè tipicamente a un altro tenant: la
     * risposta è la stessa di un job inesistente, senza rivelare che quell'identificativo esiste.
     */
    @Test
    void hidesAJobThatBelongsToAnotherTrack() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        Sender sender = mock(Sender.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            sender,
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        JwtAuthenticationToken token = authentication();
        Tracks track = new Tracks();
        track.setId(8L);
        TracksDTO trackDto = new TracksDTO();
        trackDto.setId(8L);
        QueueUploadFilesDTO foreign = new QueueUploadFilesDTO();
        foreign.setId(3L);
        foreign.setTrackId(99L);
        foreign.setStatus(UploadFileStatusEnum.ERROR);

        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(track));
        when(mapper.toDto(track)).thenReturn(trackDto);
        when(queueUploadFilesService.findOne(3L, token)).thenReturn(Optional.of(foreign));

        assertThatThrownBy(() -> service.retryUploadJob(8L, 3L, token))
            .isInstanceOf(RequestAlertException.class)
            .hasMessageContaining("Upload job not found");
        verifyNoInteractions(sender);
    }

    @Test
    void defaultsMissingSheetMusicReviewFlagToFalse() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            mock(QueueUploadFilesService.class),
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        Tracks entity = new Tracks();
        TracksDTO request = new TracksDTO();
        SheetsMusicDTO sheet = new SheetsMusicDTO();
        sheet.setNeedsReview(null);
        request.setScores(Set.of(sheet));
        AtomicReference<Tracks> savedEntity = new AtomicReference<>();

        when(mapper.toEntity(request)).thenReturn(entity);
        when(repository.save(any(Tracks.class))).thenAnswer(invocation -> {
            Tracks saved = invocation.getArgument(0);
            savedEntity.set(saved);
            return saved;
        });
        when(mapper.toDto(any(Tracks.class))).thenReturn(new TracksDTO());

        service.save(request, authentication());

        assertThat(savedEntity.get().getScores()).hasSize(1);
        assertThat(savedEntity.get().getScores().get(0).getNeedsReview()).isFalse();
    }

    @Test
    void preservesExistingScoreIdentityAndAddsNewScores() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            mock(QueueUploadFilesService.class),
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        Tracks entity = new Tracks();
        entity.setId(8L);
        entity.setEntityVersion(3L);
        SheetsMusic existing = new SheetsMusic();
        existing.setId(21L);
        entity.getScores().add(existing);
        TracksDTO request = new TracksDTO();
        request.setId(8L);
        request.setVersion(3L);
        SheetsMusicDTO existingDto = new SheetsMusicDTO();
        existingDto.setId(21L);
        SheetsMusicDTO newDto = new SheetsMusicDTO();
        request.setScores(new java.util.LinkedHashSet<>(java.util.List.of(existingDto, newDto)));

        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(entity));
        when(repository.save(entity)).thenAnswer(invocation -> {
            entity.getScores().get(1).setId(22L);
            return entity;
        });
        when(repository.restoreActiveScoreOrder(anyLong(), anyLong(), anyInt())).thenReturn(1);
        when(mapper.toDto(entity)).thenReturn(new TracksDTO());
        service.update(8L, request, authentication());

        verify(repository).moveActiveScoreOrdersToTemporaryRange(8L);
        verify(repository).restoreActiveScoreOrder(8L, 21L, 0);
        verify(repository).restoreActiveScoreOrder(8L, 22L, 1);
        assertThat(entity.getScores()).hasSize(2);
        assertThat(entity.getScores().get(0)).isSameAs(existing);
        assertThat(entity.getScores().get(1).getId()).isEqualTo(22L);
    }

    @Test
    void appendsGeneratedScoresToTheLatestLockedTrack() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            mock(QueueUploadFilesService.class),
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        Tracks entity = new Tracks();
        entity.setId(8L);
        entity.setEntityVersion(7L);
        SheetsMusic existing = new SheetsMusic();
        existing.setId(21L);
        entity.getScores().add(existing);
        SheetsMusicDTO generated = new SheetsMusicDTO();
        generated.setMedia(Set.of());
        generated.setInstruments(Set.of());

        when(repository.findByIdForUpdate(8L)).thenReturn(Optional.of(entity));
        when(repository.save(entity)).thenAnswer(invocation -> {
            entity.getScores().get(1).setId(22L);
            return entity;
        });
        when(mapper.toDto(entity)).thenReturn(new TracksDTO());

        service.appendScores(8L, java.util.List.of(generated), authentication());

        verify(repository).findByIdForUpdate(8L);
        verify(repository, never()).moveActiveScoreOrdersToTemporaryRange(anyLong());
        assertThat(entity.getScores()).hasSize(2);
        assertThat(entity.getScores().get(0)).isSameAs(existing);
        assertThat(entity.getScores().get(1).getId()).isEqualTo(22L);
    }

    @Test
    void keepsResolvedScoreCollectionsMutableForHibernateMerge() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        MediaRepository mediaRepository = mock(MediaRepository.class);
        InstrumentsRepository instrumentsRepository = mock(InstrumentsRepository.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            mock(QueueUploadFilesService.class),
            mediaRepository,
            instrumentsRepository,
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        Tracks entity = new Tracks();
        entity.setId(8L);
        SheetsMusic existing = new SheetsMusic();
        existing.setId(21L);
        entity.getScores().add(existing);
        TracksDTO request = new TracksDTO();
        SheetsMusicDTO score = new SheetsMusicDTO();
        score.setId(21L);
        ChildrenEntitiesDTO media = new ChildrenEntitiesDTO();
        media.setIndex(58L);
        score.setMedia(Set.of(media));
        score.setInstruments(Set.of());
        request.setScores(Set.of(score));

        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(entity));
        when(repository.restoreActiveScoreOrder(anyLong(), anyLong(), anyInt())).thenReturn(1);
        when(mediaRepository.getReferenceById(58L)).thenReturn(mock(Media.class));
        when(repository.save(entity)).thenAnswer(invocation -> {
            Tracks saved = invocation.getArgument(0);
            saved.getScores().clear();
            existing.getMedia().clear();
            existing.getInstruments().clear();
            return saved;
        });
        when(mapper.toDto(entity)).thenReturn(new TracksDTO());

        service.update(8L, request, authentication());

        assertThat(entity.getScores()).isEmpty();
        assertThat(existing.getMedia()).isEmpty();
        assertThat(existing.getInstruments()).isEmpty();
    }

    @Test
    void rejectsAStaleTrackVersion() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mock(TracksMapper.class),
            mock(QueueUploadFilesService.class),
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        Tracks entity = new Tracks();
        entity.setId(8L);
        entity.setEntityVersion(4L);
        TracksDTO request = new TracksDTO();
        request.setVersion(3L);
        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(entity));

        assertThatThrownBy(() -> service.update(8L, request, authentication()))
            .isInstanceOf(com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException.class)
            .hasMessageContaining("modified by another request");
    }

    @Test
    void refusesAnUploadWhoseAnnotationsAreNotReadable() {
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        TracksServiceImpl service = new TracksServiceImpl(
            mock(TracksRepository.class),
            mock(TracksMapper.class),
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);

        assertThatThrownBy(() -> service.uploadFile(8L, file, "{\"excludedPages\": [1,", authentication()))
            .isInstanceOf(RequestAlertException.class)
            .hasMessageContaining("Annotations are not readable");

        verifyNoInteractions(queueUploadFilesService);
    }

    @Test
    void refusesAnUploadWhoseRecipeIsOutOfRange() {
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        TracksServiceImpl service = new TracksServiceImpl(
            mock(TracksRepository.class),
            mock(TracksMapper.class),
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        String annotations = "{\"pageTransforms\":[{\"page\":1,\"recipeVersion\":1,\"brightness\":500}]}";

        assertThatThrownBy(() -> service.uploadFile(8L, file, annotations, authentication()))
            .isInstanceOf(RequestAlertException.class)
            .hasMessageContaining("Invalid image adjustments");

        verifyNoInteractions(queueUploadFilesService);
    }

    @Test
    void acceptsLegacyAnnotationsWithoutRecipes() {
        TracksRepository repository = mock(TracksRepository.class);
        TracksMapper mapper = mock(TracksMapper.class);
        QueueUploadFilesService queueUploadFilesService = mock(QueueUploadFilesService.class);
        TracksServiceImpl service = new TracksServiceImpl(
            repository,
            mapper,
            queueUploadFilesService,
            mock(MediaRepository.class),
            mock(InstrumentsRepository.class),
            mock(Sender.class),
            new ImageTransformationService(),
            new UploadJobMetrics(new SimpleMeterRegistry()),
            mock(SheetMusicInstrumentSuggestionRepository.class),
            mock(ScoreWritingCleanup.class)
        );
        MultipartFile file = mock(MultipartFile.class);
        Tracks track = new Tracks();
        track.setId(8L);
        TracksDTO trackDTO = new TracksDTO();
        trackDTO.setId(8L);
        QueueUploadFilesDTO queued = new QueueUploadFilesDTO();
        queued.setId(3L);

        when(file.isEmpty()).thenReturn(false);
        when(repository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(track));
        when(mapper.toDto(track)).thenReturn(trackDTO);
        when(queueUploadFilesService.saveStream(any(QueueUploadFilesDTO.class), any())).thenReturn(queued);
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);

        assertThat(service.uploadFile(8L, file, "{\"excludedPages\":[2],\"cropRegions\":[]}", authentication())).isSameAs(queued);
    }

    private JwtAuthenticationToken authentication() {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token")
            .header("alg", "none")
            .subject("user-1")
            .claim("tenant", "BMCDG")
            .issuedAt(now)
            .expiresAt(now.plusSeconds(300))
            .build();
        return new JwtAuthenticationToken(jwt);
    }
}
