package com.fundaro.zodiac.taurus.service.ensemble;

import com.fundaro.zodiac.taurus.IntegrationTest;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaNameResolver;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.InstrumentsService;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleInstrumentDTO;
import com.fundaro.zodiac.taurus.service.dto.EnsembleDtos.EnsembleUpdateDTO;
import com.fundaro.zodiac.taurus.service.dto.InstrumentsDTO;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The ensemble is stored as positions without gaps, kept by the deleted instruments and by the edits of an instrument. */
@IntegrationTest
@TestPropertySource(
    properties = {
        "spring.liquibase.contexts=test",
        "spring.datasource.hikari.maximum-pool-size=4",
        "spring.datasource.hikari.minimum-idle=1",
        "spring.security.oauth2.client.registration.oidc.client-id=test",
        "spring.security.oauth2.client.registration.oidc.client-secret=test",
    }
)
class InstrumentEnsembleIT {

    @MockitoBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    private final String tenantCode = "instrument-ensemble-it-" + UUID.randomUUID();

    @Autowired
    private TenantSchemaProvisioningService provisioningService;

    @Autowired
    private TenantSchemaNameResolver schemaNameResolver;

    @Autowired
    private TenantTransactionExecutor transactionExecutor;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private InstrumentEnsembleService ensembleService;

    @Autowired
    private InstrumentsService instrumentsService;

    @BeforeEach
    void provisionTenant() {
        provisioningService.provision(tenantCode);
    }

    @AfterEach
    void dropTenant() {
        provisioningService.dropSchema(tenantCode);
    }

    @Test
    void theEnsembleKeepsItsPositionsThroughEditsAndDeletions() {
        List<EnsembleInstrumentDTO> reference = transactionExecutor.execute(tenantCode, () -> ensembleService.reference());
        assertThat(reference).hasSize(43).allSatisfy(instrument -> assertThat(instrument.ensemblePosition()).isNull());
        assertThat(reference.getFirst().name()).isEqualTo("Ottavino");
        assertThat(reference.getLast().name()).isEqualTo("Piatti");
        Long flute = id(reference, "Flauto 1°");
        Long trumpet = id(reference, "Tromba 1°");
        Long tuba = id(reference, "Basso 1°");

        save(List.of(flute, trumpet, tuba), List.of());
        assertThat(ensemble()).containsExactly(flute, trumpet, tuba);
        assertThat(positions()).containsExactly(1, 2, 3);

        InstrumentsDTO edit = transactionExecutor.execute(tenantCode, () -> instrumentsService.findOne(trumpet, archivist()).orElseThrow());
        assertThat(edit.getEnsemblePosition()).isEqualTo(2);
        edit.setEnsemblePosition(9);
        edit.setDescription("In Sib");
        transactionExecutor.execute(tenantCode, () -> instrumentsService.update(trumpet, edit, archivist()));
        assertThat(positions()).containsExactly(1, 2, 3);

        assertThatThrownBy(() -> save(List.of(tuba), List.of(flute, tuba)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("version.conflict"));

        transactionExecutor.execute(tenantCode, () -> instrumentsService.delete(trumpet, archivist()));
        assertThat(ensemble()).containsExactly(flute, tuba);
        assertThat(positions()).containsExactly(1, 2);

        save(List.of(tuba, flute), List.of(flute, tuba));
        assertThat(ensemble()).containsExactly(tuba, flute);
        assertThatThrownBy(() -> save(List.of(tuba, trumpet), List.of(tuba, flute)))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("instrument.ensemble.invalid"));

        save(List.of(), List.of(tuba, flute));
        assertThat(ensemble()).isEmpty();
    }

    @Test
    void theSchemaRefusesRepeatedPositionsAndDeletedInstrumentsInTheEnsemble() {
        List<EnsembleInstrumentDTO> reference = transactionExecutor.execute(tenantCode, () -> ensembleService.reference());
        Long flute = id(reference, "Flauto 1°");
        Long oboe = id(reference, "Oboe");
        save(List.of(flute), List.of());

        assertThatThrownBy(() -> transactionExecutor.execute(tenantCode, () -> {
            jdbcTemplate.update("UPDATE " + schema() + ".instrument SET ensemble_position = 1 WHERE id = ?", oboe);
        })).hasStackTraceContaining("uq_instrument_ensemble_position");
        assertThatThrownBy(() -> jdbcTemplate.update("UPDATE " + schema() + ".instrument SET deleted = TRUE WHERE id = ?", flute))
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasStackTraceContaining("ck_instrument_ensemble_position");
        assertThatThrownBy(() -> jdbcTemplate.update("UPDATE " + schema() + ".instrument SET ensemble_position = 0 WHERE id = ?", oboe))
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasStackTraceContaining("ck_instrument_ensemble_position");

        // The uniqueness is checked at the commit: two instruments can swap their positions one at a time.
        transactionExecutor.execute(tenantCode, () -> {
            jdbcTemplate.update("UPDATE " + schema() + ".instrument SET ensemble_position = 1 WHERE id = ?", oboe);
            jdbcTemplate.update("UPDATE " + schema() + ".instrument SET ensemble_position = 2 WHERE id = ?", flute);
        });
        assertThat(ensemble()).containsExactly(oboe, flute);
    }

    private void save(List<Long> instrumentIds, List<Long> previous) {
        transactionExecutor.execute(tenantCode, () -> ensembleService.save(new EnsembleUpdateDTO(instrumentIds, previous)));
    }

    private List<Long> ensemble() {
        return transactionExecutor.execute(tenantCode, () -> ensembleService.ensemble().stream().map(EnsembleInstrumentDTO::id).toList());
    }

    private List<Integer> positions() {
        return transactionExecutor.execute(tenantCode, () -> ensembleService.ensemble().stream().map(EnsembleInstrumentDTO::ensemblePosition).toList());
    }

    private static Long id(List<EnsembleInstrumentDTO> instruments, String name) {
        return instruments.stream().filter(instrument -> instrument.name().equals(name)).findFirst().orElseThrow().id();
    }

    private String schema() {
        return '"' + schemaNameResolver.resolve(tenantCode).replace("\"", "\"\"") + '"';
    }

    private JwtAuthenticationToken archivist() {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("ensemble-archivist").claim("tenant", tenantCode)
            .issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(AuthoritiesConstants.ARCHIVIST)));
    }
}
