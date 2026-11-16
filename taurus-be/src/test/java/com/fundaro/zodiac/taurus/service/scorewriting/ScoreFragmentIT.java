package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.IntegrationTest;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentCategory;
import com.fundaro.zodiac.taurus.domain.scorewriting.ScoreFragmentKind;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaNameResolver;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaProvisioningService;
import com.fundaro.zodiac.taurus.multitenancy.TenantTransactionExecutor;
import com.fundaro.zodiac.taurus.security.AuthoritiesConstants;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.FragmentRequestDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.FragmentUpdateDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.PercussionVoiceDTO;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ScoreFragmentDtos.ScoreFragmentDTO;
import com.fundaro.zodiac.taurus.test.DockerRequirement;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.Timeout;
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

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/**
 * The fragment library on real tenant schemas: the migration, the name unique regardless of case among the fragments
 * not removed, the version of the changes, the checks of the content and the isolation between tenants.
 */
@IntegrationTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestPropertySource(
    properties = {
        "application.score-playback.enabled=true",
        "application.score-writing.enabled=true",
        "spring.liquibase.contexts=test",
        "spring.datasource.hikari.maximum-pool-size=4",
        "spring.datasource.hikari.minimum-idle=1",
        "spring.security.oauth2.client.registration.oidc.client-id=test",
        "spring.security.oauth2.client.registration.oidc.client-secret=test",
    }
)
// The two tenant schemas are prepared once, in @BeforeAll, which has its own limit.
@Timeout(value = 2, unit = TimeUnit.MINUTES)
class ScoreFragmentIT {

    private static final String SIGNAL = score(
        "<measure number=\"1\"><attributes><divisions>1</divisions><key><fifths>-2</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time>"
            + "<clef><sign>G</sign><line>2</line></clef></attributes>"
            + "<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure>"
            + "<measure number=\"2\"><note><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure>"
    );
    private static final String ROLL = score(
        "<measure number=\"1\"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes>"
            + "<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>2</duration><voice>1</voice><type>half</type></note>"
            + "<backup><duration>2</duration></backup>"
            + "<note><unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched><duration>2</duration><voice>2</voice><type>half</type></note></measure>"
    );

    @MockitoBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @Autowired
    private TenantSchemaProvisioningService provisioningService;

    @Autowired
    private TenantSchemaNameResolver schemaNameResolver;

    @Autowired
    private TenantTransactionExecutor transactionExecutor;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ScoreFragmentService fragmentService;

    private final String bandA = "score-fragment-a-" + UUID.randomUUID();
    private final String bandB = "score-fragment-b-" + UUID.randomUUID();
    private Long tenantA;
    private Long tenantB;

    @BeforeAll
    void provisionTenants() {
        DockerRequirement.required();
        tenantA = register(bandA);
        tenantB = register(bandB);
    }

    @AfterEach
    void clearFragments() {
        for (String tenant : List.of(bandA, bandB)) jdbcTemplate.update("DELETE FROM " + schema(tenant) + ".score_fragment");
    }

    @AfterAll
    @Timeout(value = 2, unit = TimeUnit.MINUTES)
    void dropTenants() {
        for (String tenant : List.of(bandA, bandB)) {
            try {
                provisioningService.dropSchema(tenant);
            } finally {
                transactionExecutor.execute(TenantSchemaNameResolver.DEFAULT_SCHEMA, () -> {
                    jdbcTemplate.update("UPDATE public.tenant_schema_registry SET tenant_id = NULL WHERE tenant_code = ?", tenant);
                    jdbcTemplate.update("DELETE FROM public.tenant WHERE code = ?", tenant);
                });
            }
        }
    }

    @Test
    void savesListsAndReadsTheFragments() {
        ScoreFragmentDTO roll = in(bandA, () -> fragmentService.create(
            new FragmentRequestDTO("Rullo di apertura", ScoreFragmentCategory.ROLL, " Per le processioni ", ScoreFragmentKind.PERCUSSION, ROLL,
                List.of(new PercussionVoiceDTO(2, 36), new PercussionVoiceDTO(1, 38))),
            archivist(bandA)
        ));
        ScoreFragmentDTO signal = in(bandA, () -> fragmentService.create(
            new FragmentRequestDTO("Attenti", ScoreFragmentCategory.SIGNAL, null, ScoreFragmentKind.PITCHED, SIGNAL, null), archivist(bandA)
        ));

        assertThat(roll.note()).isEqualTo("Per le processioni");
        assertThat(roll.percussionKeys()).containsExactly(new PercussionVoiceDTO(1, 38), new PercussionVoiceDTO(2, 36));
        assertThat(in(bandA, () -> fragmentService.list())).extracting(ScoreFragmentDTO::name, ScoreFragmentDTO::kind, ScoreFragmentDTO::measureCount)
            .containsExactly(
                tuple("Attenti", ScoreFragmentKind.PITCHED, 2),
                tuple("Rullo di apertura", ScoreFragmentKind.PERCUSSION, 1)
            );
        assertThat(in(bandA, () -> fragmentService.list()).get(1).percussionKeys()).containsExactly(new PercussionVoiceDTO(1, 38), new PercussionVoiceDTO(2, 36));
        String content = new String(in(bandA, () -> fragmentService.content(signal.id())), StandardCharsets.UTF_8);
        assertThat(content).contains("<alter>-1</alter>").contains("<fifths>-2</fifths>");
        assertThat(jdbcTemplate.queryForObject("SELECT insert_by FROM " + schema(bandA) + ".score_fragment WHERE id = ?", String.class, signal.id())).isEqualTo("mario");
    }

    @Test
    void keepsTheNameUniqueRegardlessOfCaseAmongTheFragmentsNotRemoved() {
        ScoreFragmentDTO first = in(bandA, () -> fragmentService.create(pitched("Squilli"), archivist(bandA)));
        ScoreFragmentDTO other = in(bandA, () -> fragmentService.create(pitched("Ritirata"), archivist(bandA)));

        assertThatThrownBy(() -> in(bandA, () -> fragmentService.create(pitched(" SQUILLI "), archivist(bandA))))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentNameExists"));
        assertThatThrownBy(() -> in(bandA, () -> fragmentService.update(
            other.id(), new FragmentUpdateDTO("squilli", ScoreFragmentCategory.SIGNAL, null, other.entityVersion()), archivist(bandA)
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentNameExists"));
        assertThatThrownBy(() -> jdbcTemplate.update(
            "INSERT INTO " + schema(bandA) + ".score_fragment (name, category, kind, content, measure_count, insert_date, insert_by, edit_date, edit_by) "
                + "VALUES ('sQuIlLi', 'OTHER', 'PITCHED', '\\x00', 1, now(), 'x', now(), 'x')"
        )).isInstanceOf(DataIntegrityViolationException.class);

        // A removed fragment leaves its name free; the parts where it was inserted keep their copy.
        in(bandA, () -> {
            fragmentService.delete(first.id(), archivist(bandA));
            return null;
        });
        assertThat(in(bandA, () -> fragmentService.create(pitched("squilli"), archivist(bandA))).name()).isEqualTo("squilli");
        assertThatThrownBy(() -> in(bandA, () -> fragmentService.content(first.id())))
            .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentNotFound"));
    }

    @Test
    void changesNameCategoryAndNoteOfTheVersionRead() {
        ScoreFragmentDTO saved = in(bandA, () -> fragmentService.create(pitched("Introduzione"), archivist(bandA)));

        ScoreFragmentDTO changed = in(bandA, () -> fragmentService.update(
            saved.id(), new FragmentUpdateDTO(" Introduzione breve ", ScoreFragmentCategory.INTRODUCTION, "Per la Settimana Santa", saved.entityVersion()), archivist(bandA)
        ));

        assertThat(changed.name()).isEqualTo("Introduzione breve");
        assertThat(changed.category()).isEqualTo(ScoreFragmentCategory.INTRODUCTION);
        assertThat(changed.note()).isEqualTo("Per la Settimana Santa");
        assertThat(changed.entityVersion()).isGreaterThan(saved.entityVersion());
        assertThat(changed.measureCount()).isEqualTo(2);
        assertThatThrownBy(() -> in(bandA, () -> fragmentService.update(
            saved.id(), new FragmentUpdateDTO("Introduzione", ScoreFragmentCategory.OTHER, null, saved.entityVersion()), archivist(bandA)
        ))).isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("version.conflict"));
    }

    @Test
    void refusesInvalidContentsWithoutSavingThem() {
        String twoParts = SIGNAL.replace("</part-list>", "<score-part id=\"P2\"><part-name>Altro</part-name></score-part></part-list>")
            .replace("</score-partwise>", "<part id=\"P2\"></part></score-partwise>");
        assertReason(() -> fragmentService.create(new FragmentRequestDTO("Due parti", ScoreFragmentCategory.OTHER, null, ScoreFragmentKind.PITCHED, twoParts, null), archivist(bandA)), "severalParts");
        assertReason(() -> fragmentService.create(new FragmentRequestDTO("Rotto", ScoreFragmentCategory.OTHER, null, ScoreFragmentKind.PITCHED, "<score-partwise>", null), archivist(bandA)), "malformed");
        assertReason(() -> fragmentService.create(new FragmentRequestDTO("Senza suoni", ScoreFragmentCategory.ROLL, null, ScoreFragmentKind.PERCUSSION, ROLL, List.of(new PercussionVoiceDTO(1, 38))), archivist(bandA)), "percussionSounds");
        StringBuilder measures = new StringBuilder();
        for (int index = 3; index <= 65; index++) measures.append("<measure number=\"").append(index).append("\"><note><rest measure=\"yes\"/><duration>2</duration><voice>1</voice></note></measure>");
        assertReason(() -> fragmentService.create(new FragmentRequestDTO("Lungo", ScoreFragmentCategory.MARCH, null, ScoreFragmentKind.PITCHED, SIGNAL.replace("</part>", measures + "</part>"), null), archivist(bandA)), "tooManyMeasures");

        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + schema(bandA) + ".score_fragment", Long.class)).isZero();
    }

    @Test
    void keepsTheFragmentsInTheirTenant() {
        ScoreFragmentDTO saved = in(bandA, () -> fragmentService.create(pitched("Marcia d'ordinanza"), archivist(bandA)));

        assertThat(in(bandB, () -> fragmentService.list())).isEmpty();
        for (Supplier<Object> action : List.<Supplier<Object>>of(
            () -> fragmentService.content(saved.id()),
            () -> fragmentService.update(saved.id(), new FragmentUpdateDTO("Altro nome", ScoreFragmentCategory.MARCH, null, saved.entityVersion()), archivist(bandB)),
            () -> {
                fragmentService.delete(saved.id(), archivist(bandB));
                return null;
            }
        )) {
            assertThatThrownBy(() -> in(bandB, action))
                .isInstanceOfSatisfying(RequestAlertException.class, error -> assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentNotFound"));
        }
        // The same name is free in another tenant.
        assertThat(in(bandB, () -> fragmentService.create(pitched("Marcia d'ordinanza"), archivist(bandB))).name()).isEqualTo("Marcia d'ordinanza");
        assertThat(in(bandA, () -> fragmentService.list())).extracting(ScoreFragmentDTO::id).containsExactly(saved.id());
    }

    private void assertReason(Supplier<Object> action, String reason) {
        assertThatThrownBy(() -> in(bandA, action))
            .as(reason)
            .isInstanceOfSatisfying(RequestAlertException.class, error -> {
                assertThat(error.getErrorKey()).isEqualTo("scoreWriting.fragmentInvalid");
                assertThat(error.getArgs().values()).containsEntry("reason", reason);
            });
    }

    private static FragmentRequestDTO pitched(String name) {
        return new FragmentRequestDTO(name, ScoreFragmentCategory.SIGNAL, null, ScoreFragmentKind.PITCHED, SIGNAL, null);
    }

    private Long register(String code) {
        provisioningService.provision(code);
        Long id = transactionExecutor.execute(
            TenantSchemaNameResolver.DEFAULT_SCHEMA,
            () -> jdbcTemplate.queryForObject(
                "INSERT INTO public.tenant (deleted, name, code, active, score_playback_enabled, score_writing_enabled) "
                    + "VALUES (false, 'Banda musicale di prova', ?, true, true, true) RETURNING id",
                Long.class,
                code
            )
        );
        provisioningService.linkTenant(id, code);
        return id;
    }

    private <T> T in(String tenant, Supplier<T> action) {
        return transactionExecutor.execute(tenant, action);
    }

    private String schema(String tenant) {
        return '"' + schemaNameResolver.resolve(tenant).replace("\"", "\"\"") + '"';
    }

    private static JwtAuthenticationToken archivist(String tenant) {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("mario").claim("tenant", tenant)
            .claim("given_name", "Mario").claim("family_name", "Rossi").issuedAt(now).expiresAt(now.plusSeconds(300)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(AuthoritiesConstants.ARCHIVIST)));
    }

    private static String score(String measures) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><score-partwise version=\"4.0\"><part-list><score-part id=\"P1\"><part-name>Frammento</part-name></score-part></part-list>"
            + "<part id=\"P1\">" + measures + "</part></score-partwise>";
    }
}
