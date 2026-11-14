package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.Tenants;
import com.fundaro.zodiac.taurus.multitenancy.TenantContext;
import com.fundaro.zodiac.taurus.repository.TenantsRepository;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreDraftService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEditLockService;
import com.fundaro.zodiac.taurus.service.scorewriting.WrittenPartService;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.junit.jupiter.api.Test;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.method.HandlerMethod;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The edit lock serves the correction editor too and needs only score playback; drafts and written parts need the
 * writing editor, which in turn needs score playback and its installation.
 */
class ScoreWritingResourceFeatureTest {

    private final TenantsRepository repository = mock(TenantsRepository.class);
    private final ApplicationProperties properties = new ApplicationProperties();
    private final TenantFeatureInterceptor interceptor = new TenantFeatureInterceptor(new TenantFeatureService(repository, properties));
    private final ScoreWritingResource resource = new ScoreWritingResource(
        mock(ScoreEditLockService.class),
        mock(ScoreDraftService.class),
        mock(WrittenPartService.class)
    );

    @Test
    void theLockNeedsOnlyThePlaybackAndTheDraftsNeedTheWriting() {
        properties.getScorePlayback().setEnabled(true);
        properties.getScoreWriting().setEnabled(true);
        Tenants playbackOnly = tenant("A", true, false);
        Tenants writing = tenant("B", true, true);
        Tenants writingWithoutPlayback = tenant("C", false, true);
        List.of(playbackOnly, writing, writingWithoutPlayback)
            .forEach(tenant -> when(repository.findByCodeAndDeletedFalse(tenant.getCode())).thenReturn(Optional.of(tenant)));
        List<Method> endpoints = Arrays.stream(ScoreWritingResource.class.getDeclaredMethods())
            .filter(method -> AnnotatedElementUtils.hasAnnotation(method, RequestMapping.class))
            .toList();
        assertThat(endpoints).extracting(Method::getName)
            .containsExactlyInAnyOrder("acquireLock", "renewLock", "releaseLock", "draft", "saveDraft", "discardDraft", "createWrittenPart");

        for (Method endpoint : endpoints) {
            HandlerMethod handler = new HandlerMethod(resource, endpoint);
            boolean lock = endpoint.getName().endsWith("Lock");
            TenantContext.run("B", () -> assertThat(preHandle(handler)).as(endpoint.getName()).isTrue());
            TenantContext.run("C", () -> assertThatThrownBy(() -> preHandle(handler))
                .as(endpoint.getName())
                .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey())
                    .isEqualTo(lock ? "tenantFeature.scorePlayback.disabled" : "tenantFeature.scoreWriting.disabled")));
            if (lock) {
                TenantContext.run("A", () -> assertThat(preHandle(handler)).as(endpoint.getName()).isTrue());
            } else {
                TenantContext.run("A", () -> assertThatThrownBy(() -> preHandle(handler))
                    .as(endpoint.getName())
                    .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                        assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                        assertThat(error.getErrorKey()).isEqualTo("tenantFeature.scoreWriting.disabled");
                    }));
            }
        }
    }

    @Test
    void refusesTheDraftsUntilTheWritingIsInstalled() {
        properties.getScorePlayback().setEnabled(true);
        when(repository.findByCodeAndDeletedFalse("B")).thenReturn(Optional.of(tenant("B", true, true)));
        Method draft = Arrays.stream(ScoreWritingResource.class.getDeclaredMethods())
            .filter(method -> method.getName().equals("draft"))
            .findFirst()
            .orElseThrow();

        TenantContext.run("B", () -> assertThatThrownBy(() -> preHandle(new HandlerMethod(resource, draft)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("tenantFeature.scoreWriting.disabled")));
    }

    private boolean preHandle(HandlerMethod handler) {
        return interceptor.preHandle(new MockHttpServletRequest(), new MockHttpServletResponse(), handler);
    }

    private static Tenants tenant(String code, boolean playback, boolean writing) {
        Tenants tenant = new Tenants();
        tenant.setCode(code);
        tenant.setActive(true);
        tenant.setDeleted(false);
        tenant.setScorePlaybackEnabled(playback);
        tenant.setScoreWritingEnabled(writing);
        return tenant;
    }
}
