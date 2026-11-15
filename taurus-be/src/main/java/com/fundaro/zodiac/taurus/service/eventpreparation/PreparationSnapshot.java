package com.fundaro.zodiac.taurus.service.eventpreparation;

import com.fundaro.zodiac.taurus.domain.CalendarEventAvailability;
import com.fundaro.zodiac.taurus.domain.CalendarEvents;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventMaterial;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventPreparation;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventProgramEntry;
import com.fundaro.zodiac.taurus.domain.finance.FinancialMovement;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Everything the evaluation of one event reads. {@link EventPreparationLoader} builds the snapshots of many events
 * with the same queries, so the single view and the dashboard evaluate the same data in the same way.
 */
record PreparationSnapshot(
    CalendarEvents event,
    CalendarEventPreparation preparation,
    List<CalendarEventProgramEntry> program,
    Map<Long, List<Score>> scoresByTrack,
    List<MaterialRow> materials,
    Map<String, CalendarEventAvailability.Availability> responses,
    Participants participants,
    List<FinancialMovement> movements,
    List<Presence> presences
) {
    List<Score> scores(Long trackId) {
        return scoresByTrack.getOrDefault(trackId, List.of());
    }

    /** A part of a track with its instruments, by id and name, and its ready files. */
    /** {@code unengraved}: a part with a version and without pages, written or derived and still to engrave. */
    record Score(Long id, String description, boolean needsReview, boolean unengraved, Map<Long, String> instruments, List<File> readyFiles) {
        boolean ready() {
            return !needsReview && !instruments.isEmpty() && !readyFiles.isEmpty();
        }
    }

    record File(Long mediaId, String fileName) {
    }

    record MaterialRow(CalendarEventMaterial row, boolean unsafeIssueOpen) {
    }

    record Presence(Long userId, Date arrivalTime, String note) {
    }

    /** Active users with a participant role, by Keycloak id, and the instruments they play. */
    record Participants(Set<String> internal, Set<String> external, Map<String, Map<Long, String>> instruments) {
        static final Participants NONE = new Participants(Set.of(), Set.of(), Map.of());

        /** The audience an event expects: internal participants when complete, external ones too when public. */
        Set<String> expected(StateEnum state) {
            if (state == StateEnum.PUBLIC)
                return Stream.concat(internal.stream(), external.stream()).collect(Collectors.toUnmodifiableSet());
            return state == StateEnum.COMPLETE ? internal : Set.of();
        }

        Map<Long, String> instrumentsOf(String keycloakId) {
            return instruments.getOrDefault(keycloakId, Map.of());
        }
    }
}
