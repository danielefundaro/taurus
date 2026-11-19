package com.fundaro.zodiac.taurus.multitenancy;

import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.boot.liquibase.autoconfigure.LiquibaseProperties;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.fundaro.zodiac.taurus.test.DockerRequirement;

/**
 * Applies the electronic signature migration on PostgreSQL and checks the constraints the services rely on: a single
 * chain head, consistent acts and evidence rows that only lose their personal data.
 */
class InventoryElectronicSignatureMigrationIT {

    private static final String AUDIT = "false, now(), 'test', now(), 'test'";

    private static DataSource dataSource;
    private static PostgreSQLContainer postgres;
    private static String schema;
    private static String tenantSchema;

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

        String tenantCode = "signature-it";
        TenantSchemaNameResolver resolver = new TenantSchemaNameResolver();
        TenantSchemaProvisioningService provisioning = new TenantSchemaProvisioningService(dataSource, new LiquibaseProperties(), resolver);
        long tenantId;
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
            "INSERT INTO public.tenant(deleted, name, code, active) VALUES (false, 'Test', ?, true) RETURNING id"
        )) {
            statement.setString(1, tenantCode);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                tenantId = resultSet.getLong(1);
            }
        }
        provisioning.provision(tenantCode);
        provisioning.linkTenant(tenantId, tenantCode);
        tenantSchema = resolver.resolve(tenantCode);
        schema = '"' + tenantSchema + '"';
    }

    @AfterAll
    static void stopDatabase() {
        if (postgres != null) postgres.stop();
    }

    @Test
    void createsTheSignatureTablesAndTheChainHead() throws Exception {
        for (String table : new String[] {
            "signature_act", "signature_document", "signature_act_signer", "signature_challenge", "signature_evidence", "signature_chain_head"
        }) {
            assertThat(query("SELECT to_regclass('" + schema + "." + table + "') IS NOT NULL")).isEqualTo("t");
        }
        assertThat(columnExists("inventory_assignment_decision", "signature_evidence_id")).isTrue();
        assertThat(query("SELECT column_default FROM information_schema.columns WHERE table_schema = '" + tenantSchema
            + "' AND table_name = 'inventory_loan_settings' AND column_name = 'electronic_signature_enabled'")).isEqualTo("false");
        assertThat(query("SELECT last_sequence || ',' || last_hash FROM " + schema + ".signature_chain_head")).isEqualTo("0," + "0".repeat(64));
        assertThatThrownBy(() -> execute("INSERT INTO " + schema + ".signature_chain_head (last_sequence, last_hash, entity_version, deleted, "
            + "insert_date, insert_by, edit_date, edit_by) VALUES (0, '" + "0".repeat(64) + "', 0, " + AUDIT + ")")).isInstanceOf(SQLException.class);
    }

    @Test
    void requiresTheOriginOfEveryActAndOneDocumentPerRole() throws Exception {
        long sheet = insertSheet(1);
        assertThatThrownBy(() -> insertAct("ASSIGNMENT_ACKNOWLEDGMENT", null)).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertAct("LOAN_SHEET_ISSUE", null)).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertAct("UNKNOWN", sheet)).isInstanceOf(SQLException.class);
        long act = insertAct("LOAN_SHEET_ISSUE", sheet);

        insertDocument(act, "MAIN");
        assertThatThrownBy(() -> insertDocument(act, "MAIN")).isInstanceOf(SQLException.class);
        assertThatCode(() -> insertDocument(act, "CLAUSES")).doesNotThrowAnyException();
        assertThatThrownBy(() -> insertDocument(act, "OTHER")).isInstanceOf(SQLException.class);
    }

    @Test
    void letsTheEvidenceLoseOnlyItsPersonalDataOnce() throws Exception {
        long act = insertAct("LOAN_SHEET_ISSUE", insertSheet(2));
        long document = insertDocument(act, "MAIN");
        long signer = insertReturningId("INSERT INTO " + schema + ".signature_act_signer (act_id, signer_role, required, user_keycloak_id, "
            + "display_name, status, entity_version, deleted, insert_date, insert_by, edit_date, edit_by) VALUES (" + act
            + ", 'HOLDER', true, 'user-1', 'Mario Rossi', 'SIGNED', 0, " + AUDIT + ") RETURNING id");
        long evidence = insertReturningId("INSERT INTO " + schema + ".signature_evidence (sequence, act_id, document_id, signer_id, purpose, "
            + "method, document_hash, declaration_hash, signed_at, declaration_text, signer_name, signer_keycloak_id, destination_email, "
            + "ip_address, user_agent, session_id, personal_data_hash, previous_hash, evidence_hash, deleted, insert_date, insert_by, edit_date, "
            + "edit_by) VALUES (100, " + act + ", " + document + ", " + signer + ", 'ACCEPTANCE', 'EMAIL_OTP', '" + "a".repeat(64) + "', '"
            + "b".repeat(64) + "', now(), 'Accetto', 'Mario Rossi', 'user-1', 'mario@example.org', '192.0.2.1', 'Mozilla', 'sid', '"
            + "c".repeat(64) + "', '" + "0".repeat(64) + "', '" + "d".repeat(64) + "', " + AUDIT + ") RETURNING id");
        String table = schema + ".signature_evidence";

        assertThatThrownBy(() -> execute("UPDATE " + table + " SET document_hash = '" + "e".repeat(64) + "' WHERE id = " + evidence))
            .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> execute("UPDATE " + table + " SET signer_name = 'Altro' WHERE id = " + evidence)).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> execute("DELETE FROM " + table + " WHERE id = " + evidence)).isInstanceOf(SQLException.class);

        String purge = "UPDATE " + table + " SET declaration_text = NULL, signer_name = NULL, signer_keycloak_id = NULL, destination_email = NULL, "
            + "ip_address = NULL, user_agent = NULL, session_id = NULL, purged_at = now(), edit_by = 'gdpr', edit_date = now() WHERE id = " + evidence;
        assertThatCode(() -> execute(purge)).doesNotThrowAnyException();
        assertThat(query("SELECT evidence_hash || ',' || (signer_name IS NULL) FROM " + table + " WHERE id = " + evidence)).isEqualTo("d".repeat(64) + ",true");
        assertThatThrownBy(() -> execute(purge)).isInstanceOf(SQLException.class);
    }

    @Test
    void keepsTheLinksOfTheParentsInTheTenantAndTheirRouteInThePublicRegistry() throws Exception {
        assertThat(query("SELECT to_regclass('" + schema + ".signature_link') IS NOT NULL")).isEqualTo("t");
        assertThat(query("SELECT to_regclass('public.signature_link_registry') IS NOT NULL")).isEqualTo("t");
        assertThat(columnExists("signature_challenge", "link_id")).isTrue();
        long act = insertAct("LOAN_SHEET_ISSUE", insertSheet(3));
        long signer = insertReturningId("INSERT INTO " + schema + ".signature_act_signer (act_id, signer_role, required, display_name, email, "
            + "status, entity_version, deleted, insert_date, insert_by, edit_date, edit_by) VALUES (" + act
            + ", 'HOLDER', true, 'Giulia Bianchi', 'genitore@example.org', 'PENDING', 0, " + AUDIT + ") RETURNING id");
        long link = insertReturningId("INSERT INTO " + schema + ".signature_link (signer_id, token_fingerprint, expires_at, entity_version, deleted, "
            + "insert_date, insert_by, edit_date, edit_by) VALUES (" + signer + ", 'abcd1234', now() + interval '7 days', 0, " + AUDIT + ") RETURNING id");
        String challenge = "INSERT INTO " + schema + ".signature_challenge (purpose, method, user_keycloak_id, link_id, items_json, items_hash, "
            + "expires_at, status, entity_version, deleted, insert_date, insert_by, edit_date, edit_by) VALUES ('ACCEPTANCE', 'EMAIL_OTP', %s, %s, '[]', '"
            + "a".repeat(64) + "', now(), 'OPEN', 0, " + AUDIT + ")";

        assertThatCode(() -> execute(challenge.formatted("NULL", link))).doesNotThrowAnyException();
        assertThatThrownBy(() -> execute(challenge.formatted("NULL", "NULL"))).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> execute(challenge.formatted("NULL", link + 1000))).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> execute("INSERT INTO public.signature_link_registry (token_digest, tenant_id, link_id, expires_at) VALUES ('"
            + "e".repeat(64) + "', -1, " + link + ", now())")).isInstanceOf(SQLException.class);
    }

    private static long insertSheet(int sequence) throws SQLException {
        long template = insertReturningId("INSERT INTO " + schema + ".inventory_loan_template (version_number, origin, default_label, file_name, "
            + "content, content_hash, deleted, insert_date, insert_by, edit_date, edit_by) VALUES (" + (100 + sequence)
            + ", 'CUSTOM', NULL, 'modello.html', '<html></html>', '" + String.valueOf(sequence).repeat(64) + "', " + AUDIT + ") RETURNING id");
        return insertReturningId("INSERT INTO " + schema + ".inventory_loan_sheet (sheet_year, sheet_sequence, sheet_number, status, user_index, "
            + "user_keycloak_id, member_name, member_last_name, holder_role, issued_on, template_id, template_hash, min_months, max_months, "
            + "renewal_max_months, total_max_months, entity_version, deleted, insert_date, insert_by, edit_date, edit_by) VALUES (2026, "
            + (500 + sequence) + ", '2026/" + (500 + sequence) + "', 'CANCELLED', " + (900 + sequence) + ", 'member', 'Mario', 'Rossi', 'MEMBER', "
            + "current_date, " + template + ", '" + "a".repeat(64) + "', 12, 24, 24, 36, 0, " + AUDIT + ") RETURNING id");
    }

    private static long insertAct(String type, Long sheet) throws SQLException {
        return insertReturningId("INSERT INTO " + schema + ".signature_act (act_type, status, sheet_id, entity_version, deleted, insert_date, "
            + "insert_by, edit_date, edit_by) VALUES ('" + type + "', 'AWAITING_SIGNATURES', " + sheet + ", 0, " + AUDIT + ") RETURNING id");
    }

    private static long insertDocument(long act, String role) throws SQLException {
        return insertReturningId("INSERT INTO " + schema + ".signature_document (act_id, role, frozen_hash, deleted, insert_date, insert_by, "
            + "edit_date, edit_by) VALUES (" + act + ", '" + role + "', '" + "f".repeat(64) + "', " + AUDIT + ") RETURNING id");
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

    private static boolean columnExists(String table, String column) throws SQLException {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?)"
        )) {
            statement.setString(1, tenantSchema);
            statement.setString(2, table);
            statement.setString(3, column);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                return resultSet.getBoolean(1);
            }
        }
    }
}
