package com.fundaro.zodiac.taurus.multitenancy;

import static org.assertj.core.api.Assertions.assertThat;
import com.fundaro.zodiac.taurus.test.DockerRequirement;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import javax.sql.DataSource;

import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.boot.liquibase.autoconfigure.LiquibaseProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;

class TenantSchemaProvisioningServiceIT {

    private static DataSource dataSource;
    private static TenantSchemaNameResolver schemaNameResolver;
    private static TenantSchemaProvisioningService provisioningService;
    private static PostgreSQLContainer postgres;

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

        schemaNameResolver = new TenantSchemaNameResolver();
        provisioningService = new TenantSchemaProvisioningService(dataSource, new LiquibaseProperties(), schemaNameResolver);
    }

    @AfterAll
    static void stopDatabase() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void provisionsRelationalTenantSchemaIdempotently() throws Exception {
        String tenantCode = "Acme'; DROP SCHEMA public; --";
        long tenantId = insertTenant(tenantCode);

        provisioningService.provision(tenantCode);
        provisioningService.linkTenant(tenantId, tenantCode);
        provisioningService.provision(tenantCode);
        provisioningService.migrateExistingSchema(tenantCode);

        String schemaName = schemaNameResolver.resolve(tenantCode);
        assertThat(queryBoolean("SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = ?)", schemaName)).isTrue();
        assertThat(queryLong("SELECT COUNT(*) FROM " + quote(schemaName) + ".preferences")).isZero();
        assertThat(queryString("SELECT status FROM public.tenant_schema_registry WHERE tenant_code = ?", tenantCode)).isEqualTo("ACTIVE");
        assertThat(queryBoolean("SELECT to_regclass(?) IS NOT NULL", schemaName + ".inventory_item")).isTrue();
        assertThat(queryBoolean("SELECT to_regclass(?) IS NOT NULL", schemaName + ".inventory_qr_rotation")).isTrue();
        assertThat(queryBoolean("SELECT to_regclass(?) IS NOT NULL", schemaName + ".inventory_issue_report")).isTrue();
        assertThat(queryBoolean("SELECT to_regclass(?) IS NOT NULL", schemaName + ".inventory_issue_photo")).isTrue();
        assertThat(queryBoolean(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = 'inventory_item' AND column_name = 'qr_public_id' AND is_nullable = 'NO')",
            schemaName
        )).isTrue();
        assertThat(queryBoolean(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND column_name = 'tenant_code')",
            schemaName
        )).isFalse();
    }

    @Test
    void reportsOnlyActiveSchemasAsActive() {
        TenantSchemaRegistry registry = new TenantSchemaRegistry(new JdbcTemplate(dataSource));
        String tenantCode = "registry-status";

        assertThat(registry.isActive(tenantCode)).isFalse();
        provisioningService.provision(tenantCode);
        assertThat(registry.isActive(tenantCode)).isTrue();
        provisioningService.dropSchema(tenantCode);
        assertThat(registry.isActive(tenantCode)).isFalse();
    }

    private static long insertTenant(String tenantCode) throws Exception {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
            "INSERT INTO public.tenant(deleted, name, code, active) VALUES (false, 'Test', ?, true) RETURNING id"
        )) {
            statement.setString(1, tenantCode);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                return resultSet.getLong(1);
            }
        }
    }

    private static boolean queryBoolean(String sql, String parameter) throws Exception {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, parameter);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                return resultSet.getBoolean(1);
            }
        }
    }

    private static long queryLong(String sql) throws Exception {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                return resultSet.getLong(1);
            }
        }
    }

    private static String queryString(String sql, String parameter) throws Exception {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, parameter);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                return resultSet.getString(1);
            }
        }
    }

    private static String quote(String identifier) {
        return '"' + identifier.replace("\"", "\"\"") + '"';
    }
}
