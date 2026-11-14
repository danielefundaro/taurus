package com.fundaro.zodiac.taurus.config;

import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.multitenancy.TenantProvisioningStatus;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import com.fundaro.zodiac.taurus.service.dto.TenantFeatureCapabilityDTO;
import com.fundaro.zodiac.taurus.service.dto.TenantFeaturesDTO;
import com.fundaro.zodiac.taurus.web.rest.TenantFeaturesResource;
import com.fundaro.zodiac.taurus.web.rest.errors.SecurityProblemSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tech.jhipster.config.JHipsterProperties;

import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Le funzionalità del tenant corrente servono a ogni ruolo per comporre menu e pagine, mentre ciò che ogni modulo
 * potrebbe offrire è amministrazione dei tenant e resta al super admin. La regola HTTP di
 * {@link SecurityConfiguration} e l'{@code @PreAuthorize} della risorsa dicono la stessa cosa e si verificano insieme.
 */
@WebMvcTest(controllers = TenantFeaturesResource.class)
@Import({SecurityConfiguration.class, SecurityProblemSupport.class, TenantFeaturesResource.class})
@EnableConfigurationProperties(JHipsterProperties.class)
@TestPropertySource(properties = "spring.security.oauth2.client.provider.oidc.issuer-uri=https://issuer.example")
class TenantFeaturesSecurityConfigurationTest {

    private static final String CAPABILITIES = "/api/tenant-features/capabilities";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TenantFeatureService tenantFeatureService;

    @MockitoBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private TenantProvisioningStatus tenantProvisioningStatus;

    @BeforeEach
    void answerWithTheFeatures() {
        when(tenantFeatureService.current()).thenReturn(
            new TenantFeaturesDTO("banda", "Banda", 1L, true, false, false, false, false, false, false, false, false, false, false, true, false, false)
        );
        when(tenantFeatureService.capabilities()).thenReturn(
            Map.of(TenantFeature.FINANCE, new TenantFeatureCapabilityDTO(true, null, List.of()))
        );
    }

    @Test
    void anAnonymousRequestIsRefused() throws Exception {
        mockMvc.perform(get("/api/tenant-features/current")).andExpect(status().isUnauthorized());
        mockMvc.perform(get(CAPABILITIES)).andExpect(status().isUnauthorized());
        verify(tenantFeatureService, never()).capabilities();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("everyRole")
    void everyRoleReadsTheFeaturesOfItsTenant(String authority) throws Exception {
        mockMvc
            .perform(get("/api/tenant-features/current").with(user("someone").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.financeEnabled").value(true));
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("capabilities")
    void onlyTheSuperAdminReadsTheCapabilities(String authority, int expectedStatus) throws Exception {
        mockMvc
            .perform(get(CAPABILITIES).with(user("someone").authorities(new SimpleGrantedAuthority(authority))))
            .andExpect(status().is(expectedStatus));
    }

    @Test
    void aRefusedRoleNeverReachesTheService() throws Exception {
        mockMvc
            .perform(get(CAPABILITIES).with(user("someone").authorities(new SimpleGrantedAuthority(AuthoritiesConstants.ADMIN))))
            .andExpect(status().isForbidden());
        verify(tenantFeatureService, never()).capabilities();

        mockMvc
            .perform(get(CAPABILITIES).with(user("someone").authorities(new SimpleGrantedAuthority(AuthoritiesConstants.SUPER_ADMIN))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.FINANCE.available").value(true));
    }

    private static Stream<String> everyRole() {
        return Stream.of(
            AuthoritiesConstants.SUPER_ADMIN,
            AuthoritiesConstants.ADMIN,
            AuthoritiesConstants.TREASURER,
            AuthoritiesConstants.ARCHIVIST,
            AuthoritiesConstants.USER,
            AuthoritiesConstants.USER_EXTERNAL
        );
    }

    private static Stream<Arguments> capabilities() {
        return Stream.of(
            Arguments.of(AuthoritiesConstants.SUPER_ADMIN, 200),
            Arguments.of(AuthoritiesConstants.ADMIN, 403),
            Arguments.of(AuthoritiesConstants.TREASURER, 403),
            Arguments.of(AuthoritiesConstants.ARCHIVIST, 403),
            Arguments.of(AuthoritiesConstants.USER, 403),
            Arguments.of(AuthoritiesConstants.USER_EXTERNAL, 403)
        );
    }
}
