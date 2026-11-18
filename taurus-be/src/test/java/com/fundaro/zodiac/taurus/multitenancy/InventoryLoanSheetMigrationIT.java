package com.fundaro.zodiac.taurus.multitenancy;

import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.boot.liquibase.autoconfigure.LiquibaseProperties;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
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
 * Applies the loan sheet migrations on PostgreSQL and checks the constraints the service relies on.
 */
class InventoryLoanSheetMigrationIT {

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

        String tenantCode = "loan-sheet-it";
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
        schema = '"' + resolver.resolve(tenantCode) + '"';
    }

    @AfterAll
    static void stopDatabase() {
        if (postgres != null) postgres.stop();
    }

    @Test
    void addsTenantContactsAndLoanColumns() throws Exception {
        assertThat(columnExists("public", "tenant", "phone")).isTrue();
        assertThat(columnExists("public", "tenant", "pec")).isTrue();
        String tenantSchema = schema.substring(1, schema.length() - 1);
        assertThat(columnExists(tenantSchema, "inventory_item", "loan_type")).isTrue();
        assertThat(columnExists(tenantSchema, "inventory_item", "serial_number")).isTrue();
        assertThat(columnExists(tenantSchema, "inventory_assignment", "loan_sheet_id")).isTrue();
        assertThat(columnExists(tenantSchema, "inventory_assignment", "agreed_unit_value")).isFalse();
        assertThat(columnExists(tenantSchema, "inventory_loan_sheet_line", "agreed_unit_value")).isTrue();
        // The export log of the removed inventory proforma is dropped.
        assertThat(query("SELECT to_regclass('" + tenantSchema + ".inventory_report_export')::text")).isNull();
        assertThat(query("SELECT column_default FROM information_schema.columns WHERE table_schema = '" + tenantSchema
            + "' AND table_name = 'inventory_return' AND column_name = 'reason'")).contains("STANDARD");
        for (String table : new String[] {
            "inventory_loan_template", "inventory_loan_settings", "inventory_loan_sheet", "inventory_loan_sheet_line",
            "inventory_loan_sheet_counter", "inventory_assignment_renewal", "inventory_loan_sheet_export"
        }) {
            assertThat(query("SELECT to_regclass('" + schema + "." + table + "') IS NOT NULL")).isEqualTo("t");
        }
    }

    @Test
    void keepsTemplateVersionsUniqueAndASingleSettingsRow() throws Exception {
        execute("DELETE FROM " + schema + ".inventory_loan_sheet");
        execute("DELETE FROM " + schema + ".inventory_loan_settings");
        execute("DELETE FROM " + schema + ".inventory_loan_template");
        insertTemplate("CUSTOM", 1, null, "a");

        assertThatThrownBy(() -> insertTemplate("CUSTOM", 1, null, "b")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertTemplate("CUSTOM", 2, null, "a")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertTemplate("CUSTOM", null, null, "c")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertTemplate("DEFAULT", null, null, "d")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertTemplate("DEFAULT", 3, "2026-10-09", "e")).isInstanceOf(SQLException.class);
        assertThatCode(() -> insertTemplate("DEFAULT", null, "2026-10-09", "a")).doesNotThrowAnyException();

        insertSettings(12, 24);
        assertThatThrownBy(() -> insertSettings(12, 24)).isInstanceOf(SQLException.class);
        execute("DELETE FROM " + schema + ".inventory_loan_settings");
        assertThatThrownBy(() -> insertSettings(24, 12)).isInstanceOf(SQLException.class);
    }

    @Test
    void allowsOneIssuedSheetPerMemberAndRequiresChargesDetails() throws Exception {
        execute("DELETE FROM " + schema + ".inventory_loan_sheet");
        execute("DELETE FROM " + schema + ".inventory_loan_settings");
        execute("DELETE FROM " + schema + ".inventory_loan_template");
        long template = insertTemplate("DEFAULT", null, "2026-10-09", "f");
        insertSheet(template, 1, "ISSUED", null, null, 12);

        assertThatThrownBy(() -> insertSheet(template, 2, "ISSUED", null, null, 12)).isInstanceOf(SQLException.class);
        assertThatCode(() -> insertSheet(template, 3, "CLOSED", "COMPLIANT", null, 12)).doesNotThrowAnyException();
        assertThatThrownBy(() -> insertSheet(template, 4, "CLOSED", "CHARGES", null, 12)).isInstanceOf(SQLException.class);
        assertThatCode(() -> insertSheet(template, 5, "CLOSED", "CHARGES", "45.00", 12)).doesNotThrowAnyException();
        assertThatThrownBy(() -> insertSheet(template, 5, "CANCELLED", null, null, 12)).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertSheet(template, 6, "CLOSED", "COMPLIANT", null, 30)).isInstanceOf(SQLException.class);
    }

    @Test
    void releasesTheProformaPdfsBeforeDroppingTheirExportLog() throws Exception {
        // Provisioning already dropped the export log: recreate it with data and replay the changeset on it.
        long template = insertTemplate("CUSTOM", 90, null, "r");
        long sheet = insertSheet(template, 90, "CANCELLED", null, null, 12);
        long proforma = insertMedia("inventory-reports/proforma.pdf", "c");
        long sharedWithSheet = insertMedia("inventory-reports/shared.pdf", "d");
        long unrelated = insertMedia("inventory-photos/photo.jpg", "e");
        try {
            execute("INSERT INTO " + schema + ".inventory_loan_sheet_export (sheet_id, media_asset_id, generated_by, generated_at, "
                + "deleted, insert_date, insert_by, edit_date, edit_by) VALUES (" + sheet + ", " + sharedWithSheet + ", 'test', now(), " + AUDIT + ")");
            execute("CREATE TABLE " + schema + ".inventory_report_export (id BIGSERIAL PRIMARY KEY, media_asset_id BIGINT REFERENCES "
                + schema + ".media_asset (id))");
            execute("INSERT INTO " + schema + ".inventory_report_export (media_asset_id) VALUES (" + proforma + "), (" + sharedWithSheet + ")");

            replayChangeset("config/liquibase/changelog/20261010000000_drop_inventory_report_export.xml");

            assertThat(mediaState(proforma)).isEqualTo("true,DELETED,system");
            assertThat(mediaState(sharedWithSheet)).isEqualTo("false,READY,test");
            assertThat(mediaState(unrelated)).isEqualTo("false,READY,test");
            assertThat(query("SELECT to_regclass('" + schema + ".inventory_report_export')::text")).isNull();
        } finally {
            execute("DROP TABLE IF EXISTS " + schema + ".inventory_report_export");
            execute("DELETE FROM " + schema + ".inventory_loan_sheet_export WHERE sheet_id = " + sheet);
            execute("DELETE FROM " + schema + ".inventory_loan_sheet WHERE id = " + sheet);
            execute("DELETE FROM " + schema + ".inventory_loan_template WHERE id = " + template);
        }
    }

    private static long insertMedia(String storageKey, String hashCharacter) throws SQLException {
        return insertReturningId(
            "INSERT INTO " + schema + ".media_asset (deleted, insert_by, insert_date, edit_by, edit_date, entity_version, name, storage_key, "
                + "original_filename, mime_type, file_extension, file_size, sha256, status) VALUES (false, 'test', now(), 'test', now(), 0, "
                + "'documento', '" + storageKey + "', 'documento.pdf', 'application/pdf', 'pdf', 10, '" + hashCharacter.repeat(64) + "', 'READY') "
                + "RETURNING id"
        );
    }

    private static String mediaState(long id) throws SQLException {
        return query("SELECT deleted::text || ',' || status || ',' || edit_by FROM " + schema + ".media_asset WHERE id = " + id);
    }

    /** Runs the SQL of a changeset on the tenant schema, as Liquibase does with the schema as default. */
    private static void replayChangeset(String resource) throws Exception {
        String xml;
        try (InputStream stream = InventoryLoanSheetMigrationIT.class.getClassLoader().getResourceAsStream(resource)) {
            xml = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
        String sql = xml.substring(xml.indexOf("<![CDATA[") + "<![CDATA[".length(), xml.indexOf("]]>"));
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("SET search_path TO " + schema);
            statement.execute(sql);
        }
    }

    private static long insertTemplate(String origin, Integer versionNumber, String defaultLabel, String hashCharacter) throws SQLException {
        return insertReturningId(
            "INSERT INTO " + schema + ".inventory_loan_template (version_number, origin, default_label, file_name, content, content_hash, "
                + "deleted, insert_date, insert_by, edit_date, edit_by) VALUES (" + versionNumber + ", '" + origin + "', "
                + (defaultLabel == null ? "NULL" : "'" + defaultLabel + "'") + ", 'modello.html', '<html></html>', '" + hashCharacter.repeat(64) + "', "
                + AUDIT + ") RETURNING id"
        );
    }

    private static void insertSettings(int minMonths, int maxMonths) throws SQLException {
        insertReturningId(
            "INSERT INTO " + schema + ".inventory_loan_settings (min_months, max_months, renewal_max_months, total_max_months, entity_version, "
                + "deleted, insert_date, insert_by, edit_date, edit_by) VALUES (" + minMonths + ", " + maxMonths + ", 24, 36, 0, " + AUDIT + ") RETURNING id"
        );
    }

    private static long insertSheet(long templateId, int sequence, String status, String outcome, String amount, int minMonths) throws SQLException {
        boolean closed = status.equals("CLOSED");
        return insertReturningId(
            "INSERT INTO " + schema + ".inventory_loan_sheet (sheet_year, sheet_sequence, sheet_number, status, user_index, user_keycloak_id, "
                + "member_name, member_last_name, holder_role, issued_on, template_id, template_hash, min_months, max_months, renewal_max_months, "
                + "total_max_months, closed_at, return_outcome, charge_amount, charge_due_date, entity_version, deleted, insert_date, insert_by, "
                + "edit_date, edit_by) VALUES (2026, " + sequence + ", '2026/" + sequence + "', '" + status + "', 42, 'member', 'Mario', 'Rossi', "
                + "'MEMBER', current_date, " + templateId + ", '" + "a".repeat(64) + "', " + minMonths + ", 24, 24, 36, "
                + (closed ? "now()" : "NULL") + ", " + (outcome == null ? "NULL" : "'" + outcome + "'") + ", "
                + (amount == null ? "NULL" : amount) + ", " + (amount == null ? "NULL" : "current_date") + ", 0, " + AUDIT + ") RETURNING id"
        );
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

    private static boolean columnExists(String tableSchema, String table, String column) throws SQLException {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?)"
        )) {
            statement.setString(1, tableSchema);
            statement.setString(2, table);
            statement.setString(3, column);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                return resultSet.getBoolean(1);
            }
        }
    }
}
