package com.fundaro.zodiac.taurus.multitenancy;

import com.fundaro.zodiac.taurus.test.DockerRequirement;
import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.boot.liquibase.autoconfigure.LiquibaseProperties;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Applies the guided tour migration on PostgreSQL: the invitation of the members already in the tenant and the
 * constraints the service relies on.
 */
class GuidedTourMigrationIT {

    private static final String CHANGELOG = "config/liquibase/changelog/20261103000000_guided_tour.xml";
    private static final String AUDIT = "false, now(), 'test', now(), 'test'";

    private static DataSource dataSource;
    private static PostgreSQLContainer postgres;
    private static String schema;

    @BeforeAll
    static void setUpDatabase() throws Exception {
        String jdbcUrl = System.getProperty("taurus.test.postgres.url");
        String username = System.getProperty("taurus.test.postgres.username", "taurus");
        String password = System.getProperty("taurus.test.postgres.password", "password");
        if (jdbcUrl == null) {
            DockerRequirement.required();
            postgres = new PostgreSQLContainer("postgres:18.7");
            postgres.start();
            jdbcUrl = postgres.getJdbcUrl();
            username = postgres.getUsername();
            password = postgres.getPassword();
        }
        PGSimpleDataSource postgresDataSource = new PGSimpleDataSource();
        postgresDataSource.setUrl(jdbcUrl);
        postgresDataSource.setUser(username);
        postgresDataSource.setPassword(password);
        dataSource = postgresDataSource;

        SpringLiquibase globalLiquibase = new SpringLiquibase();
        globalLiquibase.setDataSource(dataSource);
        globalLiquibase.setChangeLog("classpath:config/liquibase/master.xml");
        globalLiquibase.setDefaultSchema("public");
        globalLiquibase.setLiquibaseSchema("public");
        globalLiquibase.afterPropertiesSet();

        String tenantCode = "guided-tour-migration-it";
        TenantSchemaNameResolver resolver = new TenantSchemaNameResolver();
        new TenantSchemaProvisioningService(dataSource, new LiquibaseProperties(), resolver).provision(tenantCode);
        schema = '"' + resolver.resolve(tenantCode) + '"';
    }

    @AfterAll
    static void stopDatabase() {
        if (postgres != null) postgres.stop();
    }

    @BeforeEach
    void cleanTables() throws SQLException {
        execute("DELETE FROM " + schema + ".guided_tour_profile");
    }

    @Test
    void createsNoProfileInANewTenant() throws Exception {
        // The provisioning applied the whole migration on an empty schema.
        assertThat(query("SELECT count(*) FROM " + schema + ".guided_tour_profile")).isEqualTo("0");
        assertThat(query("SELECT to_regclass('" + schema + ".guided_tour_progress') IS NOT NULL")).isEqualTo("t");
    }

    @Test
    void invitesTheActiveMembersOnceAndSkipsTheDeletedOnes() throws Exception {
        long active = insertUser("migration-active", false);
        insertUser("migration-deleted", true);
        insertUser("migration-existing", false);
        execute("INSERT INTO " + schema + ".guided_tour_profile (user_keycloak_id, auto_start_enabled, legacy_invitation, deleted, "
            + "insert_date, insert_by, edit_date, edit_by) VALUES ('migration-existing', false, false, " + AUDIT + ")");

        replayChangeset("20261103000000-2-guided-tour-invitation");
        replayChangeset("20261103000000-2-guided-tour-invitation");

        assertThat(query("SELECT legacy_invitation::text || ',' || auto_start_enabled::text || ',' || user_id::text FROM " + schema
            + ".guided_tour_profile WHERE user_keycloak_id = 'migration-active'")).isEqualTo("true,true," + active);
        assertThat(query("SELECT count(*) FROM " + schema + ".guided_tour_profile WHERE user_keycloak_id = 'migration-deleted'")).isEqualTo("0");
        assertThat(query("SELECT count(*) || ',' || bool_or(legacy_invitation)::text FROM " + schema
            + ".guided_tour_profile WHERE user_keycloak_id = 'migration-existing'")).isEqualTo("1,false");
        assertThat(query("SELECT count(*) FROM " + schema + ".guided_tour_progress")).isEqualTo("0");
    }

    @Test
    void enforcesOneProfilePerSubjectAndOneProgressPerRole() throws Exception {
        long profile = insertProfile("constraint-subject");
        assertThatThrownBy(() -> insertProfile("constraint-subject")).isInstanceOf(SQLException.class);

        insertProgress(profile, "ROLE_USER", "IN_PROGRESS", 0, "'[]'", "NULL");
        assertThatThrownBy(() -> insertProgress(profile, "ROLE_USER", "SKIPPED", 0, "'[]'", "NULL")).isInstanceOf(SQLException.class);
        assertThatCode(() -> insertProgress(profile, "ROLE_ARCHIVIST", "SKIPPED", 0, "'[]'", "NULL")).doesNotThrowAnyException();
    }

    @Test
    void rejectsUnknownValuesAndInconsistentCompletion() throws Exception {
        long profile = insertProfile("checked-subject");

        assertThatThrownBy(() -> insertProgress(profile, "ROLE_GUEST", "IN_PROGRESS", 0, "'[]'", "NULL")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertProgress(profile, "ROLE_USER", "FINISHED", 0, "'[]'", "NULL")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertProgress(profile, "ROLE_USER", "IN_PROGRESS", 4, "'[]'", "NULL")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertProgress(profile, "ROLE_USER", "IN_PROGRESS", 0, "'{}'", "NULL")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertProgress(profile, "ROLE_USER", "IN_PROGRESS", 0,
            "(SELECT jsonb_agg('area.step' || g) FROM generate_series(1, 101) g)", "NULL")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertProgress(profile, "ROLE_USER", "COMPLETED", 0, "'[]'", "NULL")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertProgress(profile, "ROLE_USER", "SKIPPED", 0, "'[]'", "now()")).isInstanceOf(SQLException.class);
        assertThatCode(() -> insertProgress(profile, "ROLE_BOARD", "COMPLETED", 3,
            "(SELECT jsonb_agg('area.step' || g) FROM generate_series(1, 100) g)", "now()")).doesNotThrowAnyException();
    }

    @Test
    void removesTheProgressWithTheProfile() throws Exception {
        long profile = insertProfile("cascade-subject");
        insertProgress(profile, "ROLE_USER", "IN_PROGRESS", 1, "'[\"common.welcome\"]'", "NULL");

        execute("DELETE FROM " + schema + ".guided_tour_profile WHERE id = " + profile);

        assertThat(query("SELECT count(*) FROM " + schema + ".guided_tour_progress WHERE profile_id = " + profile)).isEqualTo("0");
    }

    private static long insertUser(String subject, boolean deleted) throws SQLException {
        long identity = insertReturningId("INSERT INTO public.user_identity (keycloak_id, created_at) VALUES ('" + subject
            + "', CURRENT_TIMESTAMP) ON CONFLICT (keycloak_id) DO UPDATE SET keycloak_id = EXCLUDED.keycloak_id RETURNING id");
        execute("DELETE FROM " + schema + ".app_user WHERE keycloak_id = '" + subject + "'");
        return insertReturningId("INSERT INTO " + schema + ".app_user (user_identity_id, keycloak_id, name, active, deleted) VALUES ("
            + identity + ", '" + subject + "', 'Socio', " + !deleted + ", " + deleted + ") RETURNING id");
    }

    private static long insertProfile(String subject) throws SQLException {
        return insertReturningId("INSERT INTO " + schema + ".guided_tour_profile (user_keycloak_id, deleted, insert_date, insert_by, "
            + "edit_date, edit_by) VALUES ('" + subject + "', " + AUDIT + ") RETURNING id");
    }

    private static void insertProgress(long profile, String role, String status, int proposals, String steps, String completedAt)
        throws SQLException {
        execute("INSERT INTO " + schema + ".guided_tour_progress (profile_id, role, status, seen_steps, auto_proposals, completed_at, "
            + "deleted, insert_date, insert_by, edit_date, edit_by) VALUES (" + profile + ", '" + role + "', '" + status + "', " + steps
            + ", " + proposals + ", " + completedAt + ", " + AUDIT + ")");
    }

    /** Runs the SQL of one changeset of the guided tour changelog on the tenant schema, as Liquibase does. */
    private static void replayChangeset(String id) throws Exception {
        String xml;
        try (InputStream stream = GuidedTourMigrationIT.class.getClassLoader().getResourceAsStream(CHANGELOG)) {
            xml = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
        String changeset = xml.substring(xml.indexOf("<changeSet id=\"" + id + "\""));
        String sql = changeset.substring(changeset.indexOf("<![CDATA[") + "<![CDATA[".length(), changeset.indexOf("]]>"));
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("SET search_path TO " + schema);
            statement.execute(sql);
        }
    }

    private static long insertReturningId(String sql) throws SQLException {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(sql)) {
            resultSet.next();
            return resultSet.getLong(1);
        }
    }

    private static void execute(String sql) throws SQLException {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static String query(String sql) throws SQLException {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(sql)) {
            resultSet.next();
            return resultSet.getString(1);
        }
    }
}
