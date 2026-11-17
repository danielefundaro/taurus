package com.fundaro.zodiac.taurus.config;

import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.security.RoleGroups;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.security.oauth2.AudienceValidator;
import com.fundaro.zodiac.taurus.web.rest.errors.SecurityProblemSupport;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUserAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.client.RestClient;
import tech.jhipster.config.JHipsterProperties;

import java.time.Duration;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import static org.springframework.security.config.Customizer.withDefaults;
import static org.springframework.security.oauth2.core.oidc.StandardClaimNames.PREFERRED_USERNAME;

// The HTTP rules of the filter chain are the first barrier. A @PreAuthorize on a resource method is checked after
// its rule, so it can only narrow access: keep the two aligned.
@Configuration
@EnableMethodSecurity
public class SecurityConfiguration {

    private final JHipsterProperties jHipsterProperties;

    @Value("${spring.security.oauth2.client.provider.oidc.issuer-uri}")
    private String issuerUri;

    private final ClientRegistrationRepository clientRegistrationRepository;

    private final SecurityProblemSupport problemSupport;

    // See https://github.com/jhipster/generator-jhipster/issues/18868
    // We don't use a distributed cache or the user selected cache implementation here on purpose
    private final Cache<String, Jwt> users = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofHours(1))
        .recordStats()
        .build();

    public SecurityConfiguration(
        ClientRegistrationRepository clientRegistrationRepository,
        JHipsterProperties jHipsterProperties,
        SecurityProblemSupport problemSupport
    ) {
        this.clientRegistrationRepository = clientRegistrationRepository;
        this.jHipsterProperties = jHipsterProperties;
        this.problemSupport = problemSupport;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        // API errors of the filter chain get the same body as the other errors; pages keep the login redirect.
        RequestMatcher api = PathPatternRequestMatcher.withDefaults().matcher("/api/**");
        http
            .cors(withDefaults())
            .csrf(csrf -> csrf.disable())
            .headers(headers ->
                headers
                    .contentSecurityPolicy(csp -> csp.policyDirectives(jHipsterProperties.getSecurity().getContentSecurityPolicy()))
                    .frameOptions(frameOptions -> frameOptions.deny())
                    .referrerPolicy(referrer ->
                        referrer.policy(org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)
                    )
                    .permissionsPolicyHeader(permissions ->
                        permissions.policy(
                            "camera=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), sync-xhr=()"
                        )
                    )
            )
            .authorizeHttpRequests(authz ->
                // prettier-ignore
                authz
                    // Public authentication metadata.
                    .requestMatchers(HttpMethod.GET, "/api/authenticate", "/api/auth-info").permitAll()
                    .requestMatchers(HttpMethod.GET, "/api/calendar-subscriptions/v1/*/calendar.ics").permitAll()
                    .requestMatchers(HttpMethod.HEAD, "/api/calendar-subscriptions/v1/*/calendar.ics").permitAll()
                    .requestMatchers("/api/calendar-subscriptions/**").denyAll()
                    // Public signature page of the parents without an account: the token of the link is the credential.
                    .requestMatchers(
                        HttpMethod.GET,
                        "/api/signature-links/v1/*",
                        "/api/signature-links/v1/*/documents/*",
                        "/api/signature-links/v1/*/attestation"
                    )
                    .permitAll()
                    .requestMatchers(HttpMethod.PUT, "/api/signature-links/v1/*/holder-data").permitAll()
                    .requestMatchers(
                        HttpMethod.POST,
                        "/api/signature-links/v1/*/documents/*/ciesign",
                        "/api/signature-links/v1/*/challenges",
                        "/api/signature-links/v1/*/challenges/*/resend",
                        "/api/signature-links/v1/*/challenges/*/confirm"
                    )
                    .permitAll()
                    .requestMatchers("/api/signature-links/**").denyAll()
                    // Published versions of the legal documents, read by anyone without login.
                    .requestMatchers(HttpMethod.GET, "/api/legal-documents/v1/*", "/api/legal-documents/v1/*/*").permitAll()
                    .requestMatchers("/api/legal-documents/**").denyAll()

                    // Endpoints available to every authenticated user.
                    .requestMatchers(HttpMethod.GET, "/api/account").authenticated()
                    .requestMatchers(HttpMethod.GET, "/api/dashboard/operations").authenticated()
                    .requestMatchers(HttpMethod.GET, "/api/dashboard/operations/calendar-events")
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers("/api/dashboard/**").denyAll()
                    .requestMatchers(HttpMethod.POST, "/api/logout").authenticated()
                    .requestMatchers(HttpMethod.GET, "/api/legal/status").authenticated()
                    .requestMatchers(HttpMethod.POST, "/api/legal/acceptances").authenticated()
                    .requestMatchers(HttpMethod.GET, "/api/users/me", "/api/users/me/calendar-events").authenticated()
                    .requestMatchers(HttpMethod.PATCH, "/api/users/me").authenticated()
                    .requestMatchers(HttpMethod.DELETE, "/api/users/me").authenticated()
                    .requestMatchers(HttpMethod.DELETE, "/api/users/me/gdpr").authenticated()
                    .requestMatchers(HttpMethod.GET, "/api/inventory-scan/v1/*").authenticated()
                    .requestMatchers("/api/calendar-feeds/**").authenticated()
                    .requestMatchers("/api/preferences/**", "/api/last-researches/**", "/api/notices/**", "/api/push-subscriptions/**")
                    .authenticated()
                    .requestMatchers(
                        HttpMethod.GET,
                        "/api/user/inventory/assignments/**",
                        "/api/user/inventory/photos/**",
                        "/api/user/inventory/return-photos/**",
                        "/api/user/inventory/issues/**",
                        "/api/user/inventory/issue-photos/**",
                        "/api/user/inventory/summary",
                        "/api/user/inventory/loan-sheets",
                        "/api/user/inventory/loan-sheets/{id}/pdf"
                    )
                    .authenticated()
                    .requestMatchers(
                        HttpMethod.POST,
                        "/api/user/inventory/assignments/{id}/decision",
                        "/api/user/inventory/assignments/{id}/returns",
                        "/api/user/inventory/assignments/{id}/issues",
                        "/api/user/inventory/issues/{id}/photos",
                        "/api/user/inventory/returns/{id}/photos"
                    )
                    .authenticated()
                    .requestMatchers("/api/user/inventory/**").denyAll()
                    // Electronic signature of the authenticated user.
                    .requestMatchers(
                        HttpMethod.GET,
                        "/api/user/signatures/methods",
                        "/api/user/signatures/acts",
                        "/api/user/signatures/acts/{id}",
                        "/api/user/signatures/acts/{id}/documents/{role}",
                        "/api/user/signatures/acts/{id}/attestation"
                    )
                    .authenticated()
                    .requestMatchers(HttpMethod.PUT, "/api/user/signatures/methods", "/api/user/signatures/acts/{id}/holder-data").authenticated()
                    .requestMatchers(
                        HttpMethod.POST,
                        "/api/user/signatures/acts/{id}/documents/{role}/ciesign",
                        "/api/user/signatures/challenges",
                        "/api/user/signatures/challenges/{id}/resend",
                        "/api/user/signatures/challenges/{id}/confirm"
                    )
                    .authenticated()
                    .requestMatchers("/api/user/signatures/**").denyAll()

                    // Tenant inventory administration. Personal inventory endpoints are matched above.
                    .requestMatchers("/api/inventory/**")
                    .hasAnyAuthority(RoleGroups.tenantManagers())

                    // Tenant finance management.
                    .requestMatchers("/api/finance/**")
                    .hasAnyAuthority(RoleGroups.financeManagers())

                    // Tenant initial configuration and additive imports.
                    .requestMatchers("/api/onboarding/**")
                    .hasAnyAuthority(RoleGroups.tenantAdmins())

                    // All users can get instruments information
                    .requestMatchers(HttpMethod.GET, "/api/instruments/**").authenticated()

                    // Legal document administration and tenant administration.
                    .requestMatchers(HttpMethod.DELETE, "/api/tenants/{id}/gdpr")
                    .hasAuthority(AuthoritiesConstants.SUPER_ADMIN)
                    .requestMatchers("/api/legal/documents/**", "/api/tenants/**")
                    .hasAuthority(AuthoritiesConstants.SUPER_ADMIN)
                    // What every module could offer is tenant administration; the features of the current tenant
                    // stay readable by every role.
                    .requestMatchers("/api/tenant-features/capabilities")
                    .hasAuthority(AuthoritiesConstants.SUPER_ADMIN)
                    // The quality of the recognition engines is a technical summary of the installation: the counts
                    // are still collected at every approval under /api/tracks.
                    .requestMatchers("/api/score-recognition/**")
                    .hasAuthority(AuthoritiesConstants.SUPER_ADMIN)
                    .requestMatchers("/api/legal/**").denyAll()

                    // User administration. Self-service endpoints are matched above.
                    .requestMatchers(HttpMethod.DELETE, "/api/users/{id}/gdpr")
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers("/api/users/**")
                    .hasAnyAuthority(RoleGroups.tenantManagers())

                    // Catalogue administration.
                    .requestMatchers("/api/albums/**", "/api/tracks/**", "/api/instruments/**", "/api/score-fragments/**")
                    .hasAnyAuthority(RoleGroups.catalogueManagers())

                    // Read-only catalogue APIs for standard and external users; listeners can report the errors they hear.
                    .requestMatchers(HttpMethod.GET, "/api/user/albums/**", "/api/user/tracks/**", "/api/user/media/**")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers(HttpMethod.POST, "/api/user/tracks/{trackId}/scores/{scoreId}/error-reports")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers("/api/user/albums/**", "/api/user/tracks/**", "/api/user/media/**").denyAll()
                    .requestMatchers(HttpMethod.GET, "/api/external/albums/**", "/api/external/tracks/**")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers(HttpMethod.POST, "/api/external/tracks/{trackId}/scores/{scoreId}/error-reports")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers("/api/external/albums/**", "/api/external/tracks/**").denyAll()

                    // Calendar event administration and personal availability. The preparation views are split here
                    // as in the method annotations of the resources: the administrative one carries materials and
                    // budget, the catalogue one only what an archivist edits.
                    .requestMatchers(HttpMethod.GET, "/api/calendar-events/{eventId}/preparation/catalogue")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers("/api/calendar-events/{eventId}/preparation", "/api/calendar-events/{eventId}/preparation/configuration")
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers(HttpMethod.PUT, "/api/calendar-events/{eventId}/preparation/program")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers(
                        HttpMethod.POST,
                        "/api/calendar-events/{eventId}/preparation/materials/{materialId}/confirm",
                        "/api/calendar-events/{eventId}/preparation/presence-confirmation"
                    )
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers(
                        HttpMethod.POST,
                        "/api/calendar-events/{eventId}/preparation/budget-confirmation",
                        "/api/calendar-events/{eventId}/preparation/no-movements-confirmation"
                    )
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers(HttpMethod.PATCH, "/api/calendar-events/{id}/availability")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers(HttpMethod.PATCH, "/api/calendar-events/{id}/availability/cancel")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers(HttpMethod.PATCH, "/api/calendar-events/series/{seriesId}/availability")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers(HttpMethod.PATCH, "/api/calendar-events/series/{seriesId}/availability/cancel")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers(HttpMethod.PATCH, "/api/calendar-events/{id}/reminder")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers(HttpMethod.GET, "/api/calendar-events/**")
                    .hasAnyAuthority(RoleGroups.tenantManagersAnd(AuthoritiesConstants.ARCHIVIST))
                    .requestMatchers(HttpMethod.POST, "/api/calendar-events")
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers(HttpMethod.PUT, "/api/calendar-events/**")
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers(HttpMethod.PATCH, "/api/calendar-events/**")
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers(HttpMethod.DELETE, "/api/calendar-events/**")
                    .hasAnyAuthority(RoleGroups.tenantManagers())
                    .requestMatchers("/api/calendar-events/**").denyAll()

                    .requestMatchers("/api/calendar-event-series/**")
                    .hasAnyAuthority(RoleGroups.tenantManagers())

                    .requestMatchers(HttpMethod.GET, "/api/user/calendar-events/**")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers(HttpMethod.PATCH, "/api/user/calendar-events/{id}/availability")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers(HttpMethod.PATCH, "/api/user/calendar-events/{id}/availability/cancel")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers(HttpMethod.PATCH, "/api/user/calendar-events/series/{seriesId}/availability")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers(HttpMethod.PATCH, "/api/user/calendar-events/series/{seriesId}/availability/cancel")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers(HttpMethod.PATCH, "/api/user/calendar-events/{id}/reminder")
                    .hasAuthority(AuthoritiesConstants.USER)
                    .requestMatchers("/api/user/calendar-events/**").denyAll()

                    .requestMatchers(HttpMethod.GET, "/api/external/calendar-events/**")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers(HttpMethod.PATCH, "/api/external/calendar-events/{id}/availability")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers(HttpMethod.PATCH, "/api/external/calendar-events/{id}/availability/cancel")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers(HttpMethod.PATCH, "/api/external/calendar-events/series/{seriesId}/availability")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers(HttpMethod.PATCH, "/api/external/calendar-events/series/{seriesId}/availability/cancel")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers(HttpMethod.PATCH, "/api/external/calendar-events/{id}/reminder")
                    .hasAuthority(AuthoritiesConstants.USER_EXTERNAL)
                    .requestMatchers("/api/external/calendar-events/**").denyAll()

                    // Media reads are used by every authenticated FE role; writes remain administrative.
                    .requestMatchers(HttpMethod.GET, "/api/media/**").authenticated()
                    .requestMatchers(HttpMethod.POST, "/api/media/**")
                    .hasAnyAuthority(RoleGroups.catalogueManagers())
                    .requestMatchers(HttpMethod.PUT, "/api/media/**")
                    .hasAnyAuthority(RoleGroups.catalogueManagers())
                    .requestMatchers(HttpMethod.PATCH, "/api/media/**")
                    .hasAnyAuthority(RoleGroups.catalogueManagers())
                    .requestMatchers(HttpMethod.DELETE, "/api/media/**")
                    .hasAnyAuthority(RoleGroups.catalogueManagers())
                    .requestMatchers("/api/media/**").denyAll()

                    .requestMatchers("/api/admin/**")
                    .hasAnyAuthority(RoleGroups.tenantAdmins())
                    .requestMatchers("/api/**").authenticated()
                    .requestMatchers("/services/**").authenticated()
                    .requestMatchers("/v3/api-docs/**")
                    .hasAnyAuthority(RoleGroups.tenantAdmins())
                    .requestMatchers("/management/health").permitAll()
                    .requestMatchers("/management/health/**").permitAll()
                    .requestMatchers("/management/info").permitAll()
                    .requestMatchers("/management/prometheus")
                    .hasAnyAuthority(RoleGroups.tenantAdmins())
                    .requestMatchers("/management/**")
                    .hasAnyAuthority(RoleGroups.tenantAdmins())

                    // Angular static resources and client-side route fallback. Must remain last.
                    .requestMatchers("/**").permitAll()
            )
            .oauth2Login(oauth2 -> oauth2.authorizationEndpoint(endpoint ->
                endpoint.authorizationRequestResolver(authorizationRequestResolver(this.clientRegistrationRepository))
            ))
            .oauth2Client(withDefaults())
            .exceptionHandling(exceptions ->
                exceptions
                    .defaultAuthenticationEntryPointFor(problemSupport, api)
                    .defaultAccessDeniedHandlerFor(problemSupport, api)
            )
            .oauth2ResourceServer(oauth2 ->
                oauth2
                    .authenticationEntryPoint(problemSupport)
                    .accessDeniedHandler(problemSupport)
                    .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter()))
            );

        return http.build();
    }

    private OAuth2AuthorizationRequestResolver authorizationRequestResolver(
        ClientRegistrationRepository clientRegistrationRepository
    ) {
        DefaultOAuth2AuthorizationRequestResolver authorizationRequestResolver = new DefaultOAuth2AuthorizationRequestResolver(
            clientRegistrationRepository,
            "/oauth2/authorization"
        );
        if (this.issuerUri.contains("auth0.com")) {
            authorizationRequestResolver.setAuthorizationRequestCustomizer(authorizationRequestCustomizer());
        }
        return authorizationRequestResolver;
    }

    private Consumer<OAuth2AuthorizationRequest.Builder> authorizationRequestCustomizer() {
        return customizer ->
            customizer.authorizationRequestUri(uriBuilder ->
                uriBuilder.queryParam("audience", jHipsterProperties.getSecurity().getOauth2().getAudience()).build()
            );
    }

    Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter() {
        JwtAuthenticationConverter jwtAuthenticationConverter = new JwtAuthenticationConverter();
        jwtAuthenticationConverter.setJwtGrantedAuthoritiesConverter(
            jwt -> SecurityUtils.extractAuthorityFromClaims(jwt.getClaims())
        );
        jwtAuthenticationConverter.setPrincipalClaimName(PREFERRED_USERNAME);
        return jwtAuthenticationConverter;
    }

    /**
     * Map authorities from "groups" or "roles" claim in ID Token.
     *
     * @return a {@link OAuth2UserService} that has the groups from the IdP.
     */
    @Bean
    public OAuth2UserService<OidcUserRequest, OidcUser> oidcUserService() {
        final OidcUserService delegate = new OidcUserService();

        return userRequest -> {
            OidcUser user = delegate.loadUser(userRequest);
            Set<GrantedAuthority> mappedAuthorities = new HashSet<>();

            user
                .getAuthorities()
                .forEach(authority -> {
                    if (authority instanceof OidcUserAuthority oidcUserAuthority) {
                        mappedAuthorities.addAll(
                            SecurityUtils.extractAuthorityFromClaims(oidcUserAuthority.getUserInfo().getClaims())
                        );
                    }
                });

            return new DefaultOidcUser(mappedAuthorities, user.getIdToken(), user.getUserInfo(), PREFERRED_USERNAME);
        };
    }

    @Bean
    public JwtDecoder jwtDecoder(ClientRegistrationRepository clientRegistrationRepository) {
        ClientRegistration clientRegistration = clientRegistrationRepository.findByRegistrationId("oidc");
        return createJwtDecoder(
            clientRegistration.getProviderDetails().getIssuerUri(),
            clientRegistration.getProviderDetails().getJwkSetUri(),
            clientRegistration.getProviderDetails().getUserInfoEndpoint().getUri()
        );
    }

    private JwtDecoder createJwtDecoder(String issuerUri, String jwkSetUri, String userInfoUri) {
        NimbusJwtDecoder jwtDecoder = NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
        OAuth2TokenValidator<Jwt> audienceValidator = new AudienceValidator(jHipsterProperties.getSecurity().getOauth2().getAudience());
        OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(issuerUri);
        OAuth2TokenValidator<Jwt> withAudience = new DelegatingOAuth2TokenValidator<>(withIssuer, audienceValidator);

        jwtDecoder.setJwtValidator(withAudience);

        return token -> {
            Jwt jwt = jwtDecoder.decode(token);
            return enrich(token, jwt, userInfoUri);
        };
    }

    private Jwt enrich(String token, Jwt jwt, String userInfoUri) {
        if (jwt.hasClaim("given_name") && jwt.hasClaim("family_name")) {
            return jwt;
        }
        Jwt cached = users.getIfPresent(jwt.getSubject());
        if (cached != null) {
            return cached;
        }
        Map<String, Object> userInfo = RestClient.create()
            .get()
            .uri(userInfoUri)
            .header("Authorization", "Bearer " + token)
            .retrieve()
            .body(new ParameterizedTypeReference<Map<String, Object>>() {
            });

        String username = userInfo.get("preferred_username").toString();
        if (userInfo.get("sub").toString().contains("|") && username.contains("@")) {
            userInfo.put("email", username);
        }
        if (userInfo.get("name") != null) {
            String[] name = userInfo.get("name").toString().split("\\s+");
            if (name.length > 0) {
                userInfo.put("given_name", name[0]);
                userInfo.put("family_name", String.join(" ", Arrays.copyOfRange(name, 1, name.length)));
            }
        }

        Jwt enriched = Jwt.withTokenValue(jwt.getTokenValue())
            .subject(jwt.getSubject())
            .audience(jwt.getAudience())
            .headers(headers -> headers.putAll(jwt.getHeaders()))
            .claims(claims -> claims.putAll(userInfo))
            .claims(claims -> claims.putAll(jwt.getClaims()))
            .build();

        users.put(jwt.getSubject(), enriched);
        return enriched;
    }
}
