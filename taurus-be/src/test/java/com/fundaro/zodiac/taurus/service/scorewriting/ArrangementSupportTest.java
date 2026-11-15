package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.domain.scoreplayback.ScoreVersion;
import com.fundaro.zodiac.taurus.domain.scorewriting.TrackArrangement;
import com.fundaro.zodiac.taurus.service.dto.scorewriting.ArrangementDtos.ArrangementRowStatus;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ArrangementSupportTest {

    @Test
    void theStateOfARowComparesItsPartWithTheLatestExtraction() {
        TrackArrangement arrangement = new TrackArrangement();
        arrangement.setCurrentVersionId(30L);
        ScoreVersion extracted = version(1L, 2, 30L);

        assertThat(ArrangementSupport.status(null, version(2L, 1, null), arrangement)).isEqualTo(ArrangementRowStatus.TO_EXTRACT);
        assertThat(ArrangementSupport.status(extracted, extracted, arrangement)).isEqualTo(ArrangementRowStatus.UP_TO_DATE);
        assertThat(ArrangementSupport.status(extracted, version(3L, 3, null), arrangement)).isEqualTo(ArrangementRowStatus.MODIFIED);
        // An older version made current again, or no current version: the part has to be extracted again.
        assertThat(ArrangementSupport.status(extracted, version(4L, 1, null), arrangement)).isEqualTo(ArrangementRowStatus.TO_EXTRACT);
        assertThat(ArrangementSupport.status(extracted, null, arrangement)).isEqualTo(ArrangementRowStatus.TO_EXTRACT);

        arrangement.setCurrentVersionId(31L);
        assertThat(ArrangementSupport.status(extracted, extracted, arrangement)).isEqualTo(ArrangementRowStatus.TO_EXTRACT);
    }

    private static ScoreVersion version(Long id, int number, Long arrangementVersionId) {
        ScoreVersion version = new ScoreVersion();
        version.setId(id);
        version.setVersionNumber(number);
        version.setArrangementVersionId(arrangementVersionId);
        return version;
    }
}
