package com.fundaro.zodiac.taurus.service.eventpreparation;

import com.fundaro.zodiac.taurus.domain.CalendarEventAvailability;
import com.fundaro.zodiac.taurus.domain.CalendarEvents;
import com.fundaro.zodiac.taurus.domain.enumeration.MediaAssetStatus;
import com.fundaro.zodiac.taurus.domain.enumeration.RoleEnum;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventMaterial;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventPreparation;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventProgramEntry;
import com.fundaro.zodiac.taurus.domain.finance.FinancialMovement;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryIssueSeverity;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryIssueStatus;
import com.fundaro.zodiac.taurus.repository.eventpreparation.EventMaterialRepository;
import com.fundaro.zodiac.taurus.repository.eventpreparation.EventPreparationRepository;
import com.fundaro.zodiac.taurus.repository.eventpreparation.EventProgramEntryRepository;
import com.fundaro.zodiac.taurus.repository.finance.FinancialMovementRepository;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.File;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.MaterialRow;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.Participants;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.Presence;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.Score;

import java.util.*;
import java.util.function.Function;

/**
 * Reads the snapshots of many events with a fixed number of queries — program, parts of the tracks, materials with
 * their open unsafe issues, answers, participants with their instruments, movements and presences — whatever the
 * number of events. A query runs only when an event of the request needs it.
 */
class EventPreparationLoader {
    private static final List<InventoryIssueStatus> OPEN_ISSUES = List.of(InventoryIssueStatus.OPEN, InventoryIssueStatus.ACKNOWLEDGED);
    private static final List<RoleEnum> PARTICIPANT_ROLES = List.of(RoleEnum.ROLE_USER, RoleEnum.ROLE_USER_EXTERNAL);

    private final EventPreparationRepository preparations;
    private final EventProgramEntryRepository programs;
    private final EventMaterialRepository materials;
    private final FinancialMovementRepository movements;

    EventPreparationLoader(EventPreparationRepository preparations, EventProgramEntryRepository programs, EventMaterialRepository materials,
                           FinancialMovementRepository movements) {
        this.preparations = preparations;
        this.programs = programs;
        this.materials = materials;
        this.movements = movements;
    }

    /** An event and its plan, absent while the preparation is not configured. */
    record Subject(CalendarEvents event, CalendarEventPreparation preparation) {
    }

    /** The areas the view evaluates, and whether an open unsafe issue blocks a material. */
    record Scope(Set<String> areas, boolean unsafeIssues) {
    }

    List<PreparationSnapshot> load(List<Subject> subjects, Scope scope) {
        if (subjects.isEmpty()) return List.of();
        List<Long> eventIds = subjects.stream().map(subject -> subject.event().getId()).toList();
        List<Long> planned = subjects.stream().filter(subject -> subject.preparation() != null).map(subject -> subject.event().getId()).toList();
        Set<String> areas = scope.areas();
        boolean readsProgram = areas.contains("PROGRAM") || areas.contains("SCORES");
        boolean readsAnswers = areas.contains("AVAILABILITY") || areas.contains("SCORES");

        Map<Long, List<CalendarEventProgramEntry>> program = readsProgram && !planned.isEmpty()
            ? group(programs.findCurrentByEventIds(planned), entry -> entry.getEvent().getId())
            : Map.of();
        Set<Long> trackIds = new LinkedHashSet<>();
        program.values().forEach(rows -> rows.forEach(entry -> trackIds.add(entry.getTrack().getId())));
        Map<Long, List<Score>> scores = readsProgram && !trackIds.isEmpty() ? scores(trackIds) : Map.of();
        Map<Long, List<MaterialRow>> materialRows = areas.contains("MATERIALS") && !planned.isEmpty() ? materials(planned, scope.unsafeIssues()) : Map.of();
        Map<Long, Map<String, CalendarEventAvailability.Availability>> responses = readsAnswers ? responses(eventIds) : Map.of();
        Participants participants = readsAnswers ? participants() : Participants.NONE;
        Map<Long, List<FinancialMovement>> movementRows = areas.contains("FINANCE") && !planned.isEmpty()
            ? group(movements.findAllByEvent_IdInAndDeletedFalseOrderByBookingDateAscIdAsc(planned), movement -> movement.getEvent().getId())
            : Map.of();
        Map<Long, List<Presence>> presences = areas.contains("PRESENCE") && !planned.isEmpty() ? presences(planned) : Map.of();

        return subjects.stream().map(subject -> {
            Long id = subject.event().getId();
            return new PreparationSnapshot(
                subject.event(),
                subject.preparation(),
                program.getOrDefault(id, List.of()),
                scores,
                materialRows.getOrDefault(id, List.of()),
                responses.getOrDefault(id, Map.of()),
                participants,
                movementRows.getOrDefault(id, List.of()),
                presences.getOrDefault(id, List.of())
            );
        }).toList();
    }

    /** The presences of one event in the order of the register, as a presence confirmation attests them. */
    List<Presence> presences(Long eventId) {
        return presences(List.of(eventId)).getOrDefault(eventId, List.of());
    }

    private Map<Long, List<Score>> scores(Collection<Long> trackIds) {
        Map<Long, Map<Long, ScoreBuilder>> byTrack = new LinkedHashMap<>();
        for (Object[] row : preparations.findScores(trackIds, MediaAssetStatus.READY)) {
            ScoreBuilder score = byTrack.computeIfAbsent((Long) row[0], key -> new LinkedHashMap<>())
                .computeIfAbsent((Long) row[1], key -> new ScoreBuilder((Long) row[1], (String) row[2], Boolean.TRUE.equals(row[3]),
                    row[8] != null && ((Number) row[9]).intValue() == 0));
            if (row[4] != null) score.instruments.putIfAbsent((Long) row[4], (String) row[5]);
            if (row[6] != null) score.files.putIfAbsent((Long) row[6], new File((Long) row[6], (String) row[7]));
        }
        Map<Long, List<Score>> result = new HashMap<>();
        byTrack.forEach((trackId, parts) -> result.put(trackId, parts.values().stream().map(ScoreBuilder::build).toList()));
        return result;
    }

    private Map<Long, List<MaterialRow>> materials(Collection<Long> eventIds, boolean unsafeIssues) {
        Map<Long, List<MaterialRow>> result = new LinkedHashMap<>();
        for (Object[] row : materials.findCurrentByEventIds(eventIds, InventoryIssueSeverity.UNSAFE, OPEN_ISSUES)) {
            CalendarEventMaterial material = (CalendarEventMaterial) row[0];
            boolean unsafe = unsafeIssues && ((Number) row[1]).longValue() > 0;
            result.computeIfAbsent(material.getEvent().getId(), key -> new ArrayList<>()).add(new MaterialRow(material, unsafe));
        }
        return result;
    }

    private Map<Long, Map<String, CalendarEventAvailability.Availability>> responses(Collection<Long> eventIds) {
        Map<Long, Map<String, CalendarEventAvailability.Availability>> result = new HashMap<>();
        for (Object[] row : preparations.findResponses(eventIds))
            if (row[1] != null)
                result.computeIfAbsent((Long) row[0], key -> new HashMap<>()).put((String) row[1], (CalendarEventAvailability.Availability) row[2]);
        return result;
    }

    private Participants participants() {
        Set<String> internal = new HashSet<>();
        Set<String> external = new HashSet<>();
        Map<String, Map<Long, String>> instruments = new HashMap<>();
        for (Object[] row : preparations.findParticipants(PARTICIPANT_ROLES)) {
            String keycloakId = (String) row[0];
            (row[1] == RoleEnum.ROLE_USER_EXTERNAL ? external : internal).add(keycloakId);
            if (row[2] != null) instruments.computeIfAbsent(keycloakId, key -> new TreeMap<>()).putIfAbsent((Long) row[2], (String) row[3]);
        }
        return new Participants(internal, external, instruments);
    }

    private Map<Long, List<Presence>> presences(Collection<Long> eventIds) {
        Map<Long, List<Presence>> result = new HashMap<>();
        for (Object[] row : preparations.findPresences(eventIds))
            result.computeIfAbsent((Long) row[0], key -> new ArrayList<>()).add(new Presence((Long) row[1], (Date) row[2], (String) row[3]));
        return result;
    }

    private static <T> Map<Long, List<T>> group(List<T> rows, Function<T, Long> eventId) {
        Map<Long, List<T>> result = new LinkedHashMap<>();
        rows.forEach(row -> result.computeIfAbsent(eventId.apply(row), key -> new ArrayList<>()).add(row));
        return result;
    }

    private static final class ScoreBuilder {
        private final Long id;
        private final String description;
        private final boolean needsReview;
        private final boolean unengraved;
        private final Map<Long, String> instruments = new LinkedHashMap<>();
        private final Map<Long, File> files = new LinkedHashMap<>();

        private ScoreBuilder(Long id, String description, boolean needsReview, boolean unengraved) {
            this.id = id;
            this.description = description;
            this.needsReview = needsReview;
            this.unengraved = unengraved;
        }

        private Score build() {
            return new Score(id, description, needsReview, unengraved, Collections.unmodifiableMap(instruments), List.copyOf(files.values()));
        }
    }
}
