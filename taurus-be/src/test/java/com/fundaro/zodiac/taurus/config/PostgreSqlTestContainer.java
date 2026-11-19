package com.fundaro.zodiac.taurus.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testcontainers.containers.JdbcDatabaseContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.containers.output.Slf4jLogConsumer;

import java.util.Map;

public class PostgreSqlTestContainer implements SqlTestContainer {

    private static final Logger LOG = LoggerFactory.getLogger(PostgreSqlTestContainer.class);

    private PostgreSQLContainer postgreSQLContainer;

    @Override
    public void destroy() {
        if (null != postgreSQLContainer && postgreSQLContainer.isRunning()) {
            postgreSQLContainer.stop();
        }
    }

    @Override
    public void afterPropertiesSet() {
        if (null == postgreSQLContainer) {
            postgreSQLContainer = new PostgreSQLContainer("postgres:18.7")
                .withDatabaseName("taurus")
                .withTmpFs(Map.of("/testtmpfs", "rw"))
                // Spring tiene in cache un contesto per ogni configurazione di test, fino a 8
                // (spring.properties dei test): i loro pool arrivano a 80 connessioni, vicino al
                // max_connections di default (100), e con quelle dei test e di Liquibase gli ultimi
                // contesti non riuscirebbero ad avviarsi.
                .withCommand("postgres", "-c", "max_connections=400")
                .withLogConsumer(new Slf4jLogConsumer(LOG))
                .withReuse(true);
        }
        if (!postgreSQLContainer.isRunning()) {
            postgreSQLContainer.start();
        }
    }

    @Override
    public JdbcDatabaseContainer<?> getTestContainer() {
        return postgreSQLContainer;
    }
}
