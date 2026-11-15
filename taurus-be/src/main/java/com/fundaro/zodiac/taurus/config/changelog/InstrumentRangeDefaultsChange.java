package com.fundaro.zodiac.taurus.config.changelog;

import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester;
import com.fundaro.zodiac.taurus.service.scoreplayback.InstrumentPlaybackSuggester.Suggestion;
import liquibase.change.custom.CustomTaskChange;
import liquibase.database.Database;
import liquibase.database.jvm.JdbcConnection;
import liquibase.exception.CustomChangeException;
import liquibase.exception.ValidationErrors;
import liquibase.resource.ResourceAccessor;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Fills the written range of the instruments of a tenant schema with the one of the reference catalogue. Runs once per
 * schema, for existing tenants and for new ones after the instrument seed, and only touches pitched instruments without a
 * range whose transposition is the one of the catalogue: with another transposition the range would refer to a different
 * notation. Values set by the tenant are never overwritten.
 */
public class InstrumentRangeDefaultsChange implements CustomTaskChange {

    private int updated;

    @Override
    public void execute(Database database) throws CustomChangeException {
        String table = database.escapeTableName(null, database.getDefaultSchemaName(), "instrument");
        Connection connection = ((JdbcConnection) database.getConnection()).getUnderlyingConnection();
        try (
            PreparedStatement select = connection.prepareStatement(
                "SELECT id, name, transposition_semitones FROM " + table +
                    " WHERE deleted = FALSE AND lowest_written_pitch IS NULL AND highest_written_pitch IS NULL" +
                    " AND percussion_key IS NULL AND transposition_semitones IS NOT NULL"
            );
            PreparedStatement update = connection.prepareStatement(
                "UPDATE " + table +
                    " SET lowest_written_pitch = ?, highest_written_pitch = ?, edit_by = 'system', edit_date = CURRENT_TIMESTAMP" +
                    " WHERE id = ?"
            );
            ResultSet rows = select.executeQuery()
        ) {
            while (rows.next()) {
                Integer transposition = rows.getInt("transposition_semitones");
                Suggestion value = InstrumentPlaybackSuggester.suggest(rows.getString("name")).orElse(null);
                if (value == null || !value.rangeAppliesTo(transposition)) continue;
                update.setInt(1, value.lowestWrittenPitch());
                update.setInt(2, value.highestWrittenPitch());
                update.setLong(3, rows.getLong("id"));
                update.addBatch();
                updated++;
            }
            if (updated > 0) update.executeBatch();
        } catch (SQLException exception) {
            throw new CustomChangeException("Could not fill the written range of the instruments", exception);
        }
    }

    @Override
    public String getConfirmationMessage() {
        return "Written range proposed for " + updated + " instruments";
    }

    @Override
    public void setUp() {}

    @Override
    public void setFileOpener(ResourceAccessor resourceAccessor) {}

    @Override
    public ValidationErrors validate(Database database) {
        return new ValidationErrors();
    }
}
