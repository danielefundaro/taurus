package com.fundaro.zodiac.taurus.config;

import com.fundaro.zodiac.taurus.multitenancy.TenantProvisioningStatus;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import com.fundaro.zodiac.taurus.web.rest.errors.SecurityProblemSupport;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tech.jhipster.config.JHipsterProperties;

import java.util.stream.Stream;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
    controllers = {
        SecurityConfigurationTest.CancelAvailabilityController.class,
        SecurityConfigurationTest.ErrorReportController.class,
        SecurityConfigurationTest.InstrumentSuggestionController.class,
        SecurityConfigurationTest.RecognitionReportController.class,
    }
)
@Import({
    SecurityConfiguration.class,
    SecurityProblemSupport.class,
    SecurityConfigurationTest.CancelAvailabilityController.class,
    SecurityConfigurationTest.ErrorReportController.class,
    SecurityConfigurationTest.InstrumentSuggestionController.class,
    SecurityConfigurationTest.RecognitionReportController.class,
})
@EnableConfigurationProperties(JHipsterProperties.class)
@TestPropertySource(properties = "spring.security.oauth2.client.provider.oidc.issuer-uri=https://issuer.example")
class SecurityConfigurationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private TenantFeatureService tenantFeatureService;

    @MockitoBean
    private TenantProvisioningStatus tenantProvisioningStatus;

    @ParameterizedTest
    @MethodSource("allowedCancellationRequests")
    void allowsAvailabilityCancellationForTheMatchingRole(String authority, String path) throws Exception {
        mockMvc
            .perform(patch(path).with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isOk());
    }

    @Test
    void deniesAvailabilityCancellationForAnotherRole() throws Exception {
        mockMvc
            .perform(
                patch("/api/external/calendar-events/42/availability/cancel")
                    .with(user("member").authorities(new SimpleGrantedAuthority(AuthoritiesConstants.USER)))
            )
            .andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @MethodSource("allowedReminderRequests")
    void allowsThePersonalReminderForTheMatchingRole(String authority, String path) throws Exception {
        mockMvc
            .perform(patch(path).with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isOk());
    }

    @ParameterizedTest
    @MethodSource("deniedReminderRequests")
    void deniesThePersonalReminderForAnotherRole(String authority, String path) throws Exception {
        mockMvc
            .perform(patch(path).with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @MethodSource("allowedErrorReports")
    void allowsListenersToReportErrorsOnTheirOwnPaths(String authority, String path) throws Exception {
        mockMvc.perform(post(path).with(user("member").authorities(new SimpleGrantedAuthority(authority)))).andExpect(status().isOk());
    }

    @ParameterizedTest
    @MethodSource("deniedListenerWrites")
    void keepsTheOtherCatalogueWritesClosedToListeners(String authority, String path) throws Exception {
        mockMvc.perform(post(path).with(user("member").authorities(new SimpleGrantedAuthority(authority)))).andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @MethodSource("catalogueManagers")
    void letsTheCatalogueManagersReadAndApplyTheInstrumentsToAdd(String authority) throws Exception {
        mockMvc
            .perform(get("/api/tracks/4/instrument-suggestions").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isOk());
        mockMvc
            .perform(post("/api/tracks/4/instrument-suggestions/apply").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isOk());
    }

    @ParameterizedTest
    @MethodSource("otherRoles")
    void keepsTheInstrumentsToAddClosedToTheOtherRoles(String authority) throws Exception {
        mockMvc
            .perform(get("/api/tracks/4/instrument-suggestions").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isForbidden());
        mockMvc
            .perform(post("/api/tracks/4/instrument-suggestions/apply").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @MethodSource("catalogueManagers")
    void letsTheCatalogueManagersReadTheRecognitionQuality(String authority) throws Exception {
        mockMvc
            .perform(get("/api/score-recognition/report").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isOk());
        mockMvc
            .perform(get("/api/score-recognition/pending").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isOk());
    }

    @ParameterizedTest
    @MethodSource("otherRoles")
    void keepsTheRecognitionQualityClosedToTheOtherRoles(String authority) throws Exception {
        mockMvc
            .perform(get("/api/score-recognition/report").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isForbidden());
        mockMvc
            .perform(get("/api/score-recognition/pending").with(user("member").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isForbidden());
    }

    private static Stream<String> catalogueManagers() {
        return Stream.of(AuthoritiesConstants.SUPER_ADMIN, AuthoritiesConstants.ADMIN, AuthoritiesConstants.BOARD, AuthoritiesConstants.ARCHIVIST);
    }

    private static Stream<String> otherRoles() {
        return Stream.of(AuthoritiesConstants.USER, AuthoritiesConstants.USER_EXTERNAL, AuthoritiesConstants.TREASURER);
    }

    private static Stream<Arguments> allowedErrorReports() {
        return Stream.of(
            Arguments.of(AuthoritiesConstants.USER, "/api/user/tracks/4/scores/9/error-reports"),
            Arguments.of(AuthoritiesConstants.USER_EXTERNAL, "/api/external/tracks/4/scores/9/error-reports"),
            Arguments.of(AuthoritiesConstants.ARCHIVIST, "/api/tracks/4/scores/9/error-reports")
        );
    }

    private static Stream<Arguments> deniedListenerWrites() {
        return Stream.of(
            Arguments.of(AuthoritiesConstants.USER_EXTERNAL, "/api/user/tracks/4/scores/9/error-reports"),
            Arguments.of(AuthoritiesConstants.USER, "/api/external/tracks/4/scores/9/error-reports"),
            Arguments.of(AuthoritiesConstants.USER, "/api/user/tracks/4/scores/9/score-versions"),
            Arguments.of(AuthoritiesConstants.USER, "/api/tracks/4/scores/9/error-reports"),
            Arguments.of(AuthoritiesConstants.USER, "/api/tracks/4/error-reports/1/close")
        );
    }

    private static Stream<Arguments> allowedReminderRequests() {
        return Stream.of(
            Arguments.of(AuthoritiesConstants.ADMIN, "/api/calendar-events/42/reminder"),
            Arguments.of(AuthoritiesConstants.ARCHIVIST, "/api/calendar-events/42/reminder"),
            Arguments.of(AuthoritiesConstants.USER, "/api/user/calendar-events/42/reminder"),
            Arguments.of(AuthoritiesConstants.USER_EXTERNAL, "/api/external/calendar-events/42/reminder")
        );
    }

    private static Stream<Arguments> deniedReminderRequests() {
        return Stream.of(
            Arguments.of(AuthoritiesConstants.TREASURER, "/api/calendar-events/42/reminder"),
            Arguments.of(AuthoritiesConstants.USER_EXTERNAL, "/api/user/calendar-events/42/reminder"),
            Arguments.of(AuthoritiesConstants.USER, "/api/external/calendar-events/42/reminder")
        );
    }

    private static Stream<Arguments> allowedCancellationRequests() {
        return Stream.of(
            Arguments.of(AuthoritiesConstants.ADMIN, "/api/calendar-events/42/availability/cancel"),
            Arguments.of(AuthoritiesConstants.ADMIN, "/api/calendar-events/series/7/availability/cancel"),
            Arguments.of(AuthoritiesConstants.USER, "/api/user/calendar-events/42/availability/cancel"),
            Arguments.of(AuthoritiesConstants.USER, "/api/user/calendar-events/series/7/availability/cancel"),
            Arguments.of(AuthoritiesConstants.USER_EXTERNAL, "/api/external/calendar-events/42/availability/cancel"),
            Arguments.of(AuthoritiesConstants.USER_EXTERNAL, "/api/external/calendar-events/series/7/availability/cancel")
        );
    }

    @RestController
    static class CancelAvailabilityController {

        @PatchMapping({
            "/api/calendar-events/{id}/availability/cancel",
            "/api/calendar-events/series/{id}/availability/cancel",
            "/api/user/calendar-events/{id}/availability/cancel",
            "/api/user/calendar-events/series/{id}/availability/cancel",
            "/api/external/calendar-events/{id}/availability/cancel",
            "/api/external/calendar-events/series/{id}/availability/cancel",
        })
        void cancelAvailability() {
        }

        @PatchMapping({
            "/api/calendar-events/{id}/reminder",
            "/api/user/calendar-events/{id}/reminder",
            "/api/external/calendar-events/{id}/reminder",
        })
        void setReminder() {
        }
    }

    @RestController
    static class ErrorReportController {

        @PostMapping({
            "/api/tracks/{trackId}/scores/{scoreId}/error-reports",
            "/api/tracks/{trackId}/error-reports/{reportId}/close",
            "/api/user/tracks/{trackId}/scores/{scoreId}/error-reports",
            "/api/user/tracks/{trackId}/scores/{scoreId}/score-versions",
            "/api/external/tracks/{trackId}/scores/{scoreId}/error-reports",
        })
        void reportError() {
        }
    }

    @RestController
    static class RecognitionReportController {

        @GetMapping({ "/api/score-recognition/report", "/api/score-recognition/pending" })
        void report() {
        }
    }

    @RestController
    static class InstrumentSuggestionController {

        @GetMapping("/api/tracks/{trackId}/instrument-suggestions")
        void find() {
        }

        @PostMapping("/api/tracks/{trackId}/instrument-suggestions/apply")
        void apply() {
        }
    }
}
