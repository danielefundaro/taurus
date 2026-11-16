package com.fundaro.zodiac.taurus.web.rest;

import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.domain.Tenants;
import com.fundaro.zodiac.taurus.multitenancy.TenantContext;
import com.fundaro.zodiac.taurus.repository.TenantsRepository;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreFragmentService;
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

/** The fragment library belongs to the writing editor: every endpoint needs the writing, and so the playback. */
class ScoreFragmentResourceFeatureTest {

    private final TenantsRepository repository = mock(TenantsRepository.class);
    private final ApplicationProperties properties = new ApplicationProperties();
    private final TenantFeatureInterceptor interceptor = new TenantFeatureInterceptor(new TenantFeatureService(repository, properties));
    private final ScoreFragmentResource resource = new ScoreFragmentResource(mock(ScoreFragmentService.class));

    @Test
    void everyEndpointNeedsTheWriting() {
        properties.getScorePlayback().setEnabled(true);
        properties.getScoreWriting().setEnabled(true);
        List.of(tenant("A", true, false), tenant("B", true, true), tenant("C", false, true))
            .forEach(tenant -> when(repository.findByCodeAndDeletedFalse(tenant.getCode())).thenReturn(Optional.of(tenant)));
        List<Method> endpoints = Arrays.stream(ScoreFragmentResource.class.getDeclaredMethods())
            .filter(method -> AnnotatedElementUtils.hasAnnotation(method, RequestMapping.class))
            .toList();
        assertThat(endpoints).extracting(Method::getName)
            .containsExactlyInAnyOrder("fragments", "createFragment", "fragmentContent", "updateFragment", "deleteFragment");

        for (Method endpoint : endpoints) {
            HandlerMethod handler = new HandlerMethod(resource, endpoint);
            TenantContext.run("B", () -> assertThat(preHandle(handler)).as(endpoint.getName()).isTrue());
            for (String code : List.of("A", "C")) {
                TenantContext.run(code, () -> assertThatThrownBy(() -> preHandle(handler))
                    .as(endpoint.getName())
                    .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                        assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                        assertThat(error.getErrorKey()).isEqualTo("tenantFeature.scoreWriting.disabled");
                    }));
            }
        }
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
