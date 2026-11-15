package com.fundaro.zodiac.taurus.service.eventpreparation;

import static com.fundaro.zodiac.taurus.service.dto.eventpreparation.EventPreparationDtos.*;

import com.fundaro.zodiac.taurus.domain.CalendarEventAvailability;
import com.fundaro.zodiac.taurus.domain.CalendarEvents;
import com.fundaro.zodiac.taurus.domain.Tracks;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventMaterial;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventPreparation;
import com.fundaro.zodiac.taurus.domain.eventpreparation.CalendarEventProgramEntry;
import com.fundaro.zodiac.taurus.domain.finance.FinancialMovement;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryAssignment;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryAssignmentStatus;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryCondition;
import com.fundaro.zodiac.taurus.domain.inventory.InventoryItem;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.MaterialRow;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.Score;
import com.fundaro.zodiac.taurus.service.impl.FinanceService;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.*;

/**
 * Derives phase, checks, issues and percentage from a snapshot. It reads nothing else and saves nothing: the same
 * snapshot always gives the same evaluation at the same instant.
 */
final class EventPreparationEvaluator {
    /** The order of the areas in the list of issues, after the severity. */
    static final List<String> AREAS = List.of("EVENT", "PROGRAM", "SCORES", "AVAILABILITY", "MATERIALS", "BUDGET", "PRESENCE", "FINANCE");
    private static final Set<InventoryAssignmentStatus> ACTIVE_ASSIGNMENTS = EnumSet.of(InventoryAssignmentStatus.ACTIVE, InventoryAssignmentStatus.PARTIALLY_RETURNED);
    private static final Set<InventoryCondition> UNUSABLE = EnumSet.of(InventoryCondition.TO_REPAIR, InventoryCondition.OUT_OF_SERVICE);
    /** Problems of a material that block at once; the others block from the deadline of the materials. */
    private static final Set<String> IMMEDIATE_PROBLEMS = Set.of("ASSIGNMENT_MISSING", "ASSIGNMENT_INACTIVE", "ASSIGNMENT_ITEM_MISMATCH", "ITEM_NOT_USABLE", "UNSAFE_ISSUE");
    private static final Map<String, String> MATERIAL_PROBLEMS = Map.of(
        "ASSIGNMENT_MISSING", "nessuna assegnazione collegata",
        "ASSIGNMENT_INACTIVE", "assegnazione non più attiva",
        "ASSIGNMENT_ITEM_MISMATCH", "assegnazione di un altro oggetto",
        "QUANTITY_INSUFFICIENT", "quantità residua insufficiente",
        "ITEM_NOT_USABLE", "oggetto da riparare o fuori servizio",
        "UNSAFE_ISSUE", "guasto non sicuro aperto",
        "CONFIRMATION_MISSING", "preparazione da confermare",
        "CONFIRMATION_OBSOLETE", "conferma non più valida"
    );

    /** Who reads the evaluation: it decides which anchors and routes an issue offers. */
    enum Reader {ADMIN, ARCHIVIST, TREASURER, DASHBOARD}

    record Result(Evaluation evaluation, Map<Long, MaterialState> materials) {
    }

    /** The state of a material row; {@code problems} are codes, in the order of the checks. */
    record MaterialState(boolean ready, boolean confirmed, boolean confirmationObsolete, List<String> problems) {
        boolean immediate() {
            return problems.stream().anyMatch(IMMEDIATE_PROBLEMS::contains);
        }
    }

    private final Instant now;
    private String area = "LOAD";

    EventPreparationEvaluator(Instant now) {
        this.now = now;
    }

    /** The area being evaluated, for the log of a failed evaluation. */
    String area() {
        return area;
    }

    Result evaluate(PreparationSnapshot snapshot, Set<String> areas, Reader reader, List<String> excludedAreas) {
        CalendarEventPreparation plan = snapshot.preparation();
        Phase phase = phase(snapshot.event(), now);
        Checks before = new Checks();
        Checks after = new Checks();
        Map<Long, MaterialState> materials = materialStates(snapshot);
        if (areas.contains("EVENT")) eventData(snapshot, reader, before);
        if (areas.contains("PROGRAM")) program(snapshot, reader, before);
        if (areas.contains("SCORES") && plan.isScoresRequired()) scores(snapshot, reader, before);
        if (areas.contains("AVAILABILITY") && plan.isAvailabilityRequired()) availability(snapshot, reader, before);
        if (areas.contains("MATERIALS") && plan.isMaterialsRequired()) materials(snapshot, materials, reader, before);
        if (areas.contains("BUDGET") && plan.isBudgetRequired()) budget(snapshot, reader, before);
        if (phase == Phase.FOLLOW_UP && areas.contains("PRESENCE") && plan.isPresenceClosureRequired()) presence(snapshot, reader, after);
        if (phase == Phase.FOLLOW_UP && areas.contains("FINANCE") && plan.isFinancialClosureRequired()) finance(snapshot, reader, after);
        area = "STATUS";

        PreparationStatus preparationStatus = phase == Phase.UNKNOWN ? PreparationStatus.UNKNOWN
            : before.count(Severity.BLOCKER) > 0 ? PreparationStatus.BLOCKED
            : before.count(Severity.WARNING) > 0 ? PreparationStatus.ATTENTION
            : PreparationStatus.READY;
        ClosureStatus closureStatus = phase == Phase.UNKNOWN ? ClosureStatus.UNKNOWN
            : phase != Phase.FOLLOW_UP || after.applicable == 0 ? ClosureStatus.NOT_REQUIRED
            : after.count(Severity.BLOCKER) > 0 ? ClosureStatus.TO_CLOSE
            : after.count(Severity.WARNING) > 0 ? ClosureStatus.CLOSED_WITH_WARNINGS
            : ClosureStatus.CLOSED;
        List<Issue> issues = new ArrayList<>(before.issues);
        issues.addAll(after.issues);
        issues.sort(Comparator.comparing(Issue::severity).thenComparing(issue -> AREAS.indexOf(issue.area())).thenComparing(Issue::code));
        int applicable = before.applicable + after.applicable;
        int passed = before.passed + after.passed;
        Evaluation evaluation = new Evaluation(
            ZonedDateTime.ofInstant(now, ZoneId.systemDefault()),
            phase,
            preparationStatus,
            closureStatus,
            applicable == 0 ? 100 : Math.round(passed * 100f / applicable),
            passed,
            applicable,
            count(issues, Severity.BLOCKER),
            count(issues, Severity.WARNING),
            count(issues, Severity.INFO),
            List.copyOf(issues.subList(0, Math.min(MAX_ISSUES, issues.size()))),
            issues.size(),
            List.copyOf(excludedAreas)
        );
        return new Result(evaluation, materials);
    }

    static Phase phase(CalendarEvents event, Instant now) {
        if (event.getStartDate() == null || event.getEndDate() == null) return Phase.UNKNOWN;
        return now.isBefore(event.getStartDate().toInstant()) ? Phase.PREPARATION : now.isAfter(event.getEndDate().toInstant()) ? Phase.FOLLOW_UP : Phase.IN_PROGRESS;
    }

    static Evaluation notConfigured(CalendarEvents event, Instant now) {
        return new Evaluation(ZonedDateTime.ofInstant(now, ZoneId.systemDefault()), phase(event, now), PreparationStatus.NOT_CONFIGURED, ClosureStatus.NOT_REQUIRED,
            0, 0, 0, 0, 0, 0, List.of(), 0, List.of());
    }

    /** Expected audience, answers among it, the minimum and the deadline of the answers. */
    static Availability availability(PreparationSnapshot snapshot) {
        CalendarEvents event = snapshot.event();
        CalendarEventPreparation plan = snapshot.preparation();
        Set<String> expected = snapshot.participants().expected(event.getState());
        int available = 0;
        int unavailable = 0;
        for (Map.Entry<String, CalendarEventAvailability.Availability> response : snapshot.responses().entrySet())
            if (expected.contains(response.getKey())) {
                if (response.getValue() == CalendarEventAvailability.Availability.AVAILABLE) available++;
                else unavailable++;
            }
        ZonedDateTime deadline = plan == null || event.getStartDate() == null ? null
            : ZonedDateTime.ofInstant(event.getStartDate().toInstant(), ZoneId.systemDefault()).minusMinutes(plan.getAvailabilityDeadlineMinutes());
        return new Availability(expected.size(), available, unavailable, Math.max(0, expected.size() - available - unavailable),
            plan == null ? null : plan.getMinimumAvailableParticipants(), deadline);
    }

    static MaterialState materialState(MaterialRow material) {
        CalendarEventMaterial row = material.row();
        InventoryAssignment assignment = row.getAssignment();
        InventoryItem item = row.getItem();
        List<String> problems = new ArrayList<>();
        if (assignment == null) problems.add("ASSIGNMENT_MISSING");
        else {
            if (!ACTIVE_ASSIGNMENTS.contains(assignment.getStatus())) problems.add("ASSIGNMENT_INACTIVE");
            if (!assignment.getItem().getId().equals(item.getId())) problems.add("ASSIGNMENT_ITEM_MISMATCH");
            else if (assignment.getOutstandingQuantity() < row.getRequiredQuantity()) problems.add("QUANTITY_INSUFFICIENT");
        }
        if (UNUSABLE.contains(item.getConditionStatus())) problems.add("ITEM_NOT_USABLE");
        if (material.unsafeIssueOpen()) problems.add("UNSAFE_ISSUE");
        boolean confirmed = row.getConfirmationHash() != null && row.getConfirmationHash().equals(PreparationHashes.material(row));
        boolean obsolete = row.getConfirmationHash() != null && !confirmed;
        if (!confirmed) problems.add(obsolete ? "CONFIRMATION_OBSOLETE" : "CONFIRMATION_MISSING");
        return new MaterialState(problems.isEmpty(), confirmed, obsolete, List.copyOf(problems));
    }

    static boolean budgetConfirmed(PreparationSnapshot snapshot) {
        return Objects.equals(snapshot.preparation().getBudgetConfirmationHash(), PreparationHashes.budget(snapshot.event()));
    }

    static boolean presenceConfirmed(PreparationSnapshot snapshot) {
        return Objects.equals(snapshot.preparation().getPresenceConfirmationHash(), PreparationHashes.presence(snapshot.presences()));
    }

    static boolean noMovementsConfirmed(PreparationSnapshot snapshot) {
        return snapshot.movements().isEmpty()
            && Objects.equals(snapshot.preparation().getNoMovementsConfirmationHash(), PreparationHashes.noMovements(snapshot.event(), snapshot.movements()));
    }

    /** The name shown for an entry: the saved one once the track has left the catalogue. */
    static String trackName(CalendarEventProgramEntry entry) {
        Tracks track = entry.getTrack();
        return Boolean.TRUE.equals(track.getDeleted()) && entry.getTrackNameSnapshot() != null ? entry.getTrackNameSnapshot() : track.getName();
    }

    private void eventData(PreparationSnapshot snapshot, Reader reader, Checks checks) {
        area = "EVENT";
        CalendarEvents event = snapshot.event();
        CalendarEventPreparation plan = snapshot.preparation();
        boolean named = event.getName() != null && !event.getName().isBlank();
        boolean dated = event.getStartDate() != null && event.getEndDate() != null && event.getEndDate().after(event.getStartDate());
        boolean located = !plan.isLocationRequired() || event.getLocation() != null && !event.getLocation().isBlank();
        boolean published = event.getState() != StateEnum.DRAFT;
        List<IssueDetail> details = new ArrayList<>();
        if (!named) details.add(new IssueDetail(null, "Nome", "NAME_MISSING", "Il nome dell’evento è vuoto", null));
        if (!dated) details.add(new IssueDetail(null, "Date", "DATES_INVALID", "Mancano le date o la fine non segue l’inizio", null));
        if (!located) details.add(new IssueDetail(null, "Luogo", "LOCATION_MISSING", "Il luogo è richiesto", null));
        if (!published) details.add(new IssueDetail(null, "Stato", "DRAFT", "L’evento è ancora in bozza", null));
        // A draft far from the start asks for attention; the last seven days, or any other gap, block.
        boolean distantDraft = named && dated && located && !published && event.getStartDate().toInstant().isAfter(now.plus(Duration.ofDays(7)));
        checks.check("EVENT_DATA", "EVENT", details.isEmpty(), distantDraft ? Severity.WARNING : Severity.BLOCKER,
            "Completa i dati e la visibilità dell’evento", reader == Reader.ADMIN ? "#event-data" : null, details);
    }

    private void program(PreparationSnapshot snapshot, Reader reader, Checks checks) {
        area = "PROGRAM";
        List<CalendarEventProgramEntry> rows = snapshot.program();
        String action = musicAction(reader);
        if (snapshot.preparation().isProgramRequired()) {
            List<IssueDetail> details = new ArrayList<>();
            for (int i = 0; i < rows.size(); i++) {
                String reason = programProblem(snapshot.event(), rows.get(i), i);
                if (reason != null) details.add(trackDetail(rows.get(i), i, reason, programMessage(reason), reader));
            }
            checks.check("PROGRAM_MISSING", "PROGRAM", !rows.isEmpty() && details.isEmpty(), Severity.BLOCKER,
                rows.isEmpty() ? "Definisci il programma dell’evento" : "Correggi le voci del programma", action, details);
        }
        if (exceedsEventDuration(snapshot.event(), rows))
            checks.flag("PROGRAM_TOO_LONG", "PROGRAM", Severity.WARNING, "La durata pianificata supera quella dell’evento", action, List.of());
    }

    private void scores(PreparationSnapshot snapshot, Reader reader, Checks checks) {
        area = "SCORES";
        CalendarEvents event = snapshot.event();
        List<CalendarEventProgramEntry> rows = snapshot.program();
        String action = musicAction(reader);
        List<IssueDetail> missing = new ArrayList<>();
        List<IssueDetail> inReview = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            CalendarEventProgramEntry entry = rows.get(i);
            List<Score> parts = Boolean.TRUE.equals(entry.getTrack().getDeleted()) ? List.of() : snapshot.scores(entry.getTrack().getId());
            if (parts.stream().noneMatch(Score::ready)) missing.add(trackDetail(entry, i, "NO_READY_SCORE", noReadyScoreMessage(parts), reader));
            else if (event.getState() == StateEnum.PUBLIC && entry.getTrack().getState() != StateEnum.PUBLIC)
                missing.add(trackDetail(entry, i, "TRACK_NOT_PUBLIC", programMessage("TRACK_NOT_PUBLIC"), reader));
            else
                // An alternative part still in review does not block, since the track has a ready one, but it is not ready.
                for (Score part : parts)
                    if (part.needsReview())
                        inReview.add(new IssueDetail(entry.getTrack().getId(), (i + 1) + ". " + trackName(entry) + " · " + scoreLabel(part), "IN_REVIEW",
                            "Parte alternativa in revisione: non conta come pronta", trackAction(entry, reader)));
        }
        checks.check("SCORE_NOT_READY", "SCORES", !rows.isEmpty() && missing.isEmpty(), Severity.BLOCKER,
            rows.isEmpty() ? "Il programma è vuoto: non ci sono spartiti da verificare" : "Completa gli spartiti e i relativi file", action, missing);
        if (!inReview.isEmpty())
            checks.flag("SCORE_ALTERNATIVE_IN_REVIEW", "SCORES", Severity.WARNING, "Alcune parti alternative sono ancora in revisione", action, inReview);
        coverage(snapshot, checks, action);
    }

    /**
     * A heuristic, not a staffing: the instruments of the available participants for which a track that has ready
     * parts has none. Only counts reach the details, never who plays what.
     */
    private void coverage(PreparationSnapshot snapshot, Checks checks, String action) {
        Set<String> expected = snapshot.participants().expected(snapshot.event().getState());
        Map<Long, String> names = new HashMap<>();
        Map<Long, Integer> players = new HashMap<>();
        snapshot.responses().forEach((participant, answer) -> {
            if (answer != CalendarEventAvailability.Availability.AVAILABLE || !expected.contains(participant)) return;
            snapshot.participants().instrumentsOf(participant).forEach((id, name) -> {
                names.put(id, name);
                players.merge(id, 1, Integer::sum);
            });
        });
        List<List<Score>> playable = snapshot.program().stream()
            .filter(entry -> !Boolean.TRUE.equals(entry.getTrack().getDeleted()))
            .map(entry -> snapshot.scores(entry.getTrack().getId()))
            .filter(parts -> parts.stream().anyMatch(Score::ready))
            .toList();
        if (players.isEmpty() || playable.isEmpty()) return;
        List<IssueDetail> details = new ArrayList<>();
        players.keySet().stream().sorted(Comparator.comparing(id -> String.valueOf(names.get(id)))).forEach(instrument -> {
            long uncovered = playable.stream().filter(parts -> parts.stream().noneMatch(part -> part.ready() && part.instruments().containsKey(instrument))).count();
            if (uncovered > 0)
                details.add(new IssueDetail(instrument, names.get(instrument), "NOT_COVERED",
                    uncovered + " brani su " + playable.size() + " senza una parte pronta · " + players.get(instrument) + " disponibili", action));
        });
        if (!details.isEmpty())
            checks.flag("INSTRUMENT_NOT_COVERED", "SCORES", Severity.INFO, "Copertura strumentale stimata dalle disponibilità: verifica le parti mancanti", action, details);
    }

    private void availability(PreparationSnapshot snapshot, Reader reader, Checks checks) {
        area = "AVAILABILITY";
        Availability availability = availability(snapshot);
        int minimum = snapshot.preparation().getMinimumAvailableParticipants() == null ? 1 : snapshot.preparation().getMinimumAvailableParticipants();
        boolean expired = availability.deadline() != null && !now.isBefore(availability.deadline().toInstant());
        List<IssueDetail> details = new ArrayList<>();
        if (availability.available() < minimum)
            details.add(new IssueDetail(null, "Disponibili", "BELOW_MINIMUM", availability.available() + " su " + minimum + " richiesti", null));
        if (availability.missing() > 0)
            details.add(new IssueDetail(null, "Risposte mancanti", "RESPONSES_MISSING", availability.missing() + " partecipanti non hanno ancora risposto", null));
        checks.check("AVAILABILITY_INCOMPLETE", "AVAILABILITY", details.isEmpty(), expired ? Severity.BLOCKER : Severity.WARNING,
            "Raccogli le disponibilità richieste", reader == Reader.ADMIN ? "#availability" : null, details);
    }

    private void materials(PreparationSnapshot snapshot, Map<Long, MaterialState> states, Reader reader, Checks checks) {
        area = "MATERIALS";
        List<IssueDetail> details = new ArrayList<>();
        boolean immediate = false;
        for (MaterialRow material : snapshot.materials()) {
            MaterialState state = states.get(material.row().getId());
            if (state.ready()) continue;
            immediate |= state.immediate();
            InventoryItem item = material.row().getItem();
            details.add(new IssueDetail(material.row().getId(), item.getInventoryNumber() + " · " + item.getName(), state.problems().get(0),
                capitalize(String.join(", ", state.problems().stream().map(MATERIAL_PROBLEMS::get).toList())),
                reader == Reader.ADMIN ? "/inventory/items/" + item.getId() : null));
        }
        boolean expired = snapshot.event().getStartDate() != null
            && now.isAfter(snapshot.event().getStartDate().toInstant().minusSeconds(snapshot.preparation().getMaterialsDeadlineMinutes() * 60L));
        boolean empty = snapshot.materials().isEmpty();
        checks.check("MATERIAL_NOT_READY", "MATERIALS", !empty && details.isEmpty(), immediate || expired ? Severity.BLOCKER : Severity.WARNING,
            empty ? "Pianifica i materiali dell’evento" : "Assegna e conferma i materiali", reader == Reader.ADMIN ? "#preparation-materials" : null, details);
    }

    private void budget(PreparationSnapshot snapshot, Reader reader, Checks checks) {
        area = "BUDGET";
        boolean confirmed = budgetConfirmed(snapshot);
        List<IssueDetail> details = !confirmed && snapshot.preparation().getBudgetConfirmationHash() != null
            ? List.of(new IssueDetail(null, "Preventivo", "CONFIRMATION_OBSOLETE", "Compenso, costi o valuta sono cambiati dopo la conferma", null))
            : List.of();
        checks.check("BUDGET_NOT_CONFIRMED", "BUDGET", confirmed, Severity.BLOCKER, "Verifica e conferma il preventivo", economicAction(reader, "#preparation-confirmations"), details);
    }

    private void presence(PreparationSnapshot snapshot, Reader reader, Checks checks) {
        area = "PRESENCE";
        boolean confirmed = presenceConfirmed(snapshot);
        List<IssueDetail> details = !confirmed && snapshot.preparation().getPresenceConfirmationHash() != null
            ? List.of(new IssueDetail(null, "Registro presenze", "CONFIRMATION_OBSOLETE", "Il registro è cambiato dopo l’ultima conferma", null))
            : List.of();
        checks.check("PRESENCE_NOT_CONFIRMED", "PRESENCE", confirmed, Severity.BLOCKER, "Verifica il registro presenze", reader == Reader.ADMIN ? "#presence" : null, details);
    }

    private void finance(PreparationSnapshot snapshot, Reader reader, Checks checks) {
        area = "FINANCE";
        String status = FinanceService.economicStatus(snapshot.event(), snapshot.movements());
        boolean closed = "SETTLED".equals(status) || noMovementsConfirmed(snapshot);
        List<IssueDetail> details = closed ? List.of() : List.of(new IssueDetail(null, "Posizione economica", status, economicStatusMessage(status), null));
        checks.check("FINANCE_NOT_CLOSED", "FINANCE", closed, Severity.BLOCKER, "Chiudi la posizione economica", economicAction(reader, "#preparation-finance"), details);
        long unreconciled = snapshot.movements().stream().filter(movement -> !movement.isReconciled()).count();
        if (unreconciled > 0)
            checks.flag("MOVEMENTS_UNRECONCILED", "FINANCE", Severity.WARNING, unreconciled == 1 ? "Resta un movimento non riconciliato" : "Restano " + unreconciled + " movimenti non riconciliati",
                economicAction(reader, "/finance?section=movements&reconciled=false&eventId=" + snapshot.event().getId()), List.of());
    }

    private Map<Long, MaterialState> materialStates(PreparationSnapshot snapshot) {
        Map<Long, MaterialState> result = new HashMap<>();
        snapshot.materials().forEach(material -> result.put(material.row().getId(), materialState(material)));
        return result;
    }

    private static String programProblem(CalendarEvents event, CalendarEventProgramEntry entry, int index) {
        Tracks track = entry.getTrack();
        if (Boolean.TRUE.equals(track.getDeleted())) return "TRACK_DELETED";
        if (track.getState() == StateEnum.DRAFT) return "TRACK_DRAFT";
        if (event.getState() == StateEnum.PUBLIC && track.getState() != StateEnum.PUBLIC) return "TRACK_NOT_PUBLIC";
        if (entry.getDisplayOrder() != index) return "ORDER_INVALID";
        return null;
    }

    private static String programMessage(String reason) {
        return switch (reason) {
            case "TRACK_DELETED" -> "La traccia non è più nel catalogo";
            case "TRACK_DRAFT" -> "La traccia è ancora in bozza";
            case "TRACK_NOT_PUBLIC" -> "La traccia non è visibile agli utenti esterni di un evento pubblico";
            default -> "L’ordine della voce non è continuo";
        };
    }

    private static String noReadyScoreMessage(List<Score> parts) {
        if (parts.isEmpty()) return "La traccia non ha spartiti";
        long review = parts.stream().filter(Score::needsReview).count();
        long withoutInstruments = parts.stream().filter(part -> part.instruments().isEmpty()).count();
        long unengraved = parts.stream().filter(Score::unengraved).count();
        long withoutFiles = parts.stream().filter(part -> !part.unengraved() && part.readyFiles().isEmpty()).count();
        List<String> reasons = new ArrayList<>();
        if (review > 0) reasons.add(review + " in revisione");
        if (withoutInstruments > 0) reasons.add(withoutInstruments + " senza strumenti");
        if (unengraved > 0) reasons.add(unengraved + " da impaginare");
        if (withoutFiles > 0) reasons.add(withoutFiles + " senza file pronti");
        return "Nessuno spartito pronto: " + String.join(", ", reasons);
    }

    private static String economicStatusMessage(String status) {
        return switch (status) {
            case "NO_BUDGET" -> "Nessun preventivo e nessun movimento: conferma che non sono previsti movimenti";
            case "UNPLANNED_MOVEMENTS" -> "Movimenti registrati senza preventivo";
            case "NO_MOVEMENTS" -> "Preventivo senza movimenti registrati";
            case "OVERPAID_OR_OVERRUN" -> "Incassi o spese oltre il preventivo";
            default -> "Restano importi da incassare o da pagare";
        };
    }

    private static IssueDetail trackDetail(CalendarEventProgramEntry entry, int index, String reason, String message, Reader reader) {
        return new IssueDetail(entry.getTrack().getId(), (index + 1) + ". " + trackName(entry), reason, message, trackAction(entry, reader));
    }

    private static String trackAction(CalendarEventProgramEntry entry, Reader reader) {
        return musicAction(reader) == null || Boolean.TRUE.equals(entry.getTrack().getDeleted()) ? null : "/tracks/" + entry.getTrack().getId();
    }

    private static String musicAction(Reader reader) {
        return reader == Reader.ADMIN || reader == Reader.ARCHIVIST ? "#preparation-program" : null;
    }

    private static String economicAction(Reader reader, String action) {
        return reader == Reader.ADMIN || reader == Reader.TREASURER ? action : null;
    }

    private static String scoreLabel(Score part) {
        return part.description() == null || part.description().isBlank() ? "parte senza descrizione" : part.description();
    }

    private static boolean exceedsEventDuration(CalendarEvents event, List<CalendarEventProgramEntry> rows) {
        if (event.getStartDate() == null || event.getEndDate() == null || rows.isEmpty() || rows.stream().anyMatch(row -> row.getPlannedDurationSeconds() == null))
            return false;
        long planned = rows.stream().mapToLong(CalendarEventProgramEntry::getPlannedDurationSeconds).sum();
        return planned > Duration.between(event.getStartDate().toInstant(), event.getEndDate().toInstant()).toSeconds();
    }

    private static String capitalize(String value) {
        return value.isEmpty() ? value : Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private static int count(List<Issue> issues, Severity severity) {
        return (int) issues.stream().filter(issue -> issue.severity() == severity).count();
    }

    /** The checks of one phase: {@code check} counts in the percentage, {@code flag} only lists an issue. */
    private static final class Checks {
        private int applicable;
        private int passed;
        private final List<Issue> issues = new ArrayList<>();

        void check(String code, String area, boolean success, Severity severity, String message, String action, List<IssueDetail> details) {
            applicable++;
            if (success) passed++;
            else flag(code, area, severity, message, action, details);
        }

        void flag(String code, String area, Severity severity, String message, String action, List<IssueDetail> details) {
            Long relatedId = details.size() == 1 ? details.get(0).relatedId() : null;
            issues.add(new Issue(code, area, severity, message, action, relatedId,
                List.copyOf(details.subList(0, Math.min(MAX_ISSUE_DETAILS, details.size()))), details.size()));
        }

        int count(Severity severity) {
            return (int) issues.stream().filter(issue -> issue.severity() == severity).count();
        }
    }
}
