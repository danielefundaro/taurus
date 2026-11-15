package com.fundaro.zodiac.taurus.service.eventpreparation;

import static com.fundaro.zodiac.taurus.service.dto.eventpreparation.EventPreparationDtos.*;

import com.fundaro.zodiac.taurus.domain.*;
import com.fundaro.zodiac.taurus.domain.enumeration.RoleEnum;
import com.fundaro.zodiac.taurus.domain.enumeration.StateEnum;
import com.fundaro.zodiac.taurus.domain.enumeration.TenantFeature;
import com.fundaro.zodiac.taurus.domain.eventpreparation.*;
import com.fundaro.zodiac.taurus.domain.finance.FinancialMovement;
import com.fundaro.zodiac.taurus.domain.inventory.*;
import com.fundaro.zodiac.taurus.domain.notification.NotificationPreferencePolicy;
import com.fundaro.zodiac.taurus.domain.notification.NotificationSeverity;
import com.fundaro.zodiac.taurus.domain.notification.NotificationSource;
import com.fundaro.zodiac.taurus.repository.*;
import com.fundaro.zodiac.taurus.repository.eventpreparation.*;
import com.fundaro.zodiac.taurus.repository.finance.FinancialMovementRepository;
import com.fundaro.zodiac.taurus.repository.inventory.*;
import com.fundaro.zodiac.taurus.security.RoleGroups;
import com.fundaro.zodiac.taurus.security.SecurityUtils;
import com.fundaro.zodiac.taurus.service.TenantFeatureService;
import com.fundaro.zodiac.taurus.service.eventpreparation.EventPreparationEvaluator.MaterialState;
import com.fundaro.zodiac.taurus.service.eventpreparation.EventPreparationEvaluator.Reader;
import com.fundaro.zodiac.taurus.service.eventpreparation.EventPreparationEvaluator.Result;
import com.fundaro.zodiac.taurus.service.eventpreparation.EventPreparationLoader.Scope;
import com.fundaro.zodiac.taurus.service.eventpreparation.EventPreparationLoader.Subject;
import com.fundaro.zodiac.taurus.service.eventpreparation.PreparationSnapshot.Score;
import com.fundaro.zodiac.taurus.service.impl.NotificationOutboxPublisher;
import com.fundaro.zodiac.taurus.service.notification.NotificationAudience;
import com.fundaro.zodiac.taurus.service.notification.NotificationCommand;
import com.fundaro.zodiac.taurus.web.rest.errors.RequestAlertException;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class EventPreparationService {
    private static final Logger LOG = LoggerFactory.getLogger(EventPreparationService.class);
    private static final String ENTITY = "eventPreparation";
    private static final Set<String> ALL_AREAS = Set.of("EVENT", "PROGRAM", "SCORES", "AVAILABILITY", "MATERIALS", "BUDGET", "PRESENCE", "FINANCE");
    private static final Set<String> CATALOGUE_AREAS = Set.of("EVENT", "PROGRAM", "SCORES", "AVAILABILITY");
    private static final Set<String> PERSONAL_AREAS = Set.of("PROGRAM", "SCORES", "AVAILABILITY");
    private static final Set<String> FINANCE_AREAS = Set.of("BUDGET", "FINANCE");
    /** Items named in the message of a materials notification; the others are counted. */
    private static final int NOTIFIED_ITEMS = 5;

    private final CalendarEventsRepository events;
    private final EventPreparationRepository preparations;
    private final EventProgramEntryRepository programs;
    private final EventMaterialRepository materials;
    private final TracksRepository tracks;
    private final InventoryItemRepository inventoryItems;
    private final InventoryAssignmentRepository assignments;
    private final UsersRepository users;
    private final FinancialMovementRepository movements;
    private final EventPreparationLoader loader;
    private NotificationOutboxPublisher notificationPublisher;
    private TenantFeatureService tenantFeatures;
    private EventPreparationMetrics metrics;

    public EventPreparationService(
        CalendarEventsRepository events,
        EventPreparationRepository preparations,
        EventProgramEntryRepository programs,
        EventMaterialRepository materials,
        TracksRepository tracks,
        InventoryItemRepository inventoryItems,
        InventoryAssignmentRepository assignments,
        UsersRepository users,
        FinancialMovementRepository movements
    ) {
        this.events = events;
        this.preparations = preparations;
        this.programs = programs;
        this.materials = materials;
        this.tracks = tracks;
        this.inventoryItems = inventoryItems;
        this.assignments = assignments;
        this.users = users;
        this.movements = movements;
        this.loader = new EventPreparationLoader(preparations, programs, materials, movements);
    }

    @Autowired(required = false)
    void setNotificationPublisher(NotificationOutboxPublisher notificationPublisher) {
        this.notificationPublisher = notificationPublisher;
    }

    @Autowired(required = false)
    void setTenantFeatures(TenantFeatureService tenantFeatures) {
        this.tenantFeatures = tenantFeatures;
    }

    @Autowired(required = false)
    void setMetrics(EventPreparationMetrics metrics) {
        this.metrics = metrics;
    }

    @Transactional(readOnly = true)
    public View get(Long eventId) {
        return timed("admin", () -> {
            CalendarEvents event = event(eventId);
            CalendarEventPreparation plan = preparations.findByEvent_IdAndDeletedFalse(eventId).orElse(null);
            Set<String> areas = availableAreas(ALL_AREAS);
            PreparationSnapshot snapshot = load("admin", List.of(new Subject(event, plan)), areas).get(0);
            if (plan == null)
                return new View(null, EventPreparationEvaluator.notConfigured(event, Instant.now()), List.of(), null, EventPreparationEvaluator.availability(snapshot), List.of(), null, null);
            Result result = evaluate("admin", snapshot, areas, Reader.ADMIN, excludedAreas(plan, ALL_AREAS), true);
            boolean inventory = enabled(TenantFeature.INVENTORY);
            return new View(
                degrade(configuration(plan)),
                result.evaluation(),
                program(snapshot, entry -> true, part -> true),
                plan.getProgramVersion(),
                EventPreparationEvaluator.availability(snapshot),
                inventory ? materials(snapshot, result.materials()) : List.of(),
                inventory ? plan.getMaterialsVersion() : null,
                confirmations(snapshot, enabled(TenantFeature.FINANCE), true)
            );
        });
    }

    @Transactional(readOnly = true)
    public View getCatalogue(Long eventId) {
        return timed("catalogue", () -> {
            CalendarEvents event = event(eventId);
            CalendarEventPreparation plan = preparations.findByEvent_IdAndDeletedFalse(eventId).orElse(null);
            Set<String> areas = availableAreas(CATALOGUE_AREAS);
            PreparationSnapshot snapshot = load("catalogue", List.of(new Subject(event, plan)), areas).get(0);
            if (plan == null)
                return new View(null, EventPreparationEvaluator.notConfigured(event, Instant.now()), List.of(), null, EventPreparationEvaluator.availability(snapshot), List.of(), null, null);
            Result result = evaluate("catalogue", snapshot, areas, Reader.ARCHIVIST, List.of(), true);
            return new View(catalogueConfiguration(configuration(plan)), result.evaluation(), program(snapshot, entry -> true, part -> true), plan.getProgramVersion(),
                EventPreparationEvaluator.availability(snapshot), List.of(), null, null);
        });
    }

    @Transactional(readOnly = true)
    public View getPersonal(Long eventId, AbstractAuthenticationToken token, boolean external) {
        return timed("personal", () -> {
            CalendarEvents event = event(eventId);
            if (external ? event.getState() != StateEnum.PUBLIC : event.getState() == StateEnum.DRAFT) throw notFound();
            String userId = SecurityUtils.getUserIdFromAuthentication(token);
            users.findByKeycloakIdAndDeletedFalse(userId).orElseThrow(EventPreparationService::notFound);
            CalendarEventPreparation plan = preparations.findByEvent_IdAndDeletedFalse(eventId).orElse(null);
            PreparationSnapshot snapshot = load("personal", List.of(new Subject(event, plan)), availableAreas(PERSONAL_AREAS)).get(0);
            Set<Long> instruments = snapshot.participants().instrumentsOf(userId).keySet();
            // No evaluation: status, percentage and issues could reveal economic or material problems to the members.
            List<ProgramEntry> program = plan == null ? List.of() : program(snapshot,
                entry -> !Boolean.TRUE.equals(entry.getTrack().getDeleted())
                    && (external ? entry.getTrack().getState() == StateEnum.PUBLIC : entry.getTrack().getState() != StateEnum.DRAFT),
                part -> part.ready() && part.instruments().keySet().stream().anyMatch(instruments::contains));
            return new View(plan == null ? null : personalConfiguration(configuration(plan)), null, program, null, ownAvailability(snapshot, userId), List.of(), null, null);
        });
    }

    @Transactional(readOnly = true)
    public View getFinance(Long eventId) {
        return timed("finance", () -> {
            CalendarEvents event = event(eventId);
            CalendarEventPreparation plan = preparations.findByEvent_IdAndDeletedFalse(eventId).orElse(null);
            if (plan == null)
                return new View(null, EventPreparationEvaluator.notConfigured(event, Instant.now()), List.of(), null, emptyAvailability(), List.of(), null, null);
            Set<String> areas = availableAreas(FINANCE_AREAS);
            PreparationSnapshot snapshot = load("finance", List.of(new Subject(event, plan)), areas).get(0);
            Result result = evaluate("finance", snapshot, areas, Reader.TREASURER, List.of(), true);
            return new View(financeConfiguration(configuration(plan)), result.evaluation(), List.of(), null, emptyAvailability(), List.of(), null,
                confirmations(snapshot, enabled(TenantFeature.FINANCE), false));
        });
    }

    /** The evaluations behind the dashboard rows, read with a fixed number of queries for all the events. */
    @Transactional(readOnly = true)
    public List<DashboardEntry> dashboardEntries(ZonedDateTime from, ZonedDateTime to) {
        return timed("dashboard", () -> entries("dashboard", from, to, true));
    }

    /** The same evaluations for the deadline notifications, which do not count as evaluations shown to someone. */
    @Transactional(readOnly = true)
    public List<DashboardEntry> scheduledEntries(ZonedDateTime from, ZonedDateTime to) {
        return timed("scheduler", () -> entries("scheduler", from, to, false));
    }

    private List<DashboardEntry> entries(String view, ZonedDateTime from, ZonedDateTime to, boolean record) {
        List<CalendarEventPreparation> candidates = preparations.findDashboardCandidates(Date.from(from.toInstant()), Date.from(to.toInstant()));
        Set<String> areas = availableAreas(ALL_AREAS);
        List<PreparationSnapshot> snapshots = load(view, candidates.stream().map(plan -> new Subject(plan.getEvent(), plan)).toList(), areas);
        return snapshots.stream().map(snapshot -> {
            CalendarEvents current = snapshot.event();
            CalendarEventPreparation plan = snapshot.preparation();
            Result result = evaluate(view, snapshot, areas, Reader.DASHBOARD, List.of(), record);
            Evaluation evaluation = result.evaluation();
            List<ObsoleteConfirmation> obsolete = !plan.isMaterialsRequired() ? List.of() : snapshot.materials().stream()
                .filter(material -> result.materials().get(material.row().getId()).confirmationObsolete())
                .map(material -> new ObsoleteConfirmation(material.row().getId(), material.row().getItem().getName(), material.row().getConfirmationHash()))
                .toList();
            ZonedDateTime dueAt = ZonedDateTime.ofInstant(current.getStartDate().toInstant(), from.getZone());
            return new DashboardEntry(
                current.getId(),
                current.getName(),
                dueAt,
                ZonedDateTime.ofInstant(current.getEndDate().toInstant(), from.getZone()),
                plan.isAvailabilityRequired() ? dueAt.minusMinutes(plan.getAvailabilityDeadlineMinutes()) : null,
                evaluation.preparationStatus(),
                evaluation.closureStatus(),
                evaluation.blockerCount(),
                evaluation.warningCount(),
                evaluation.issues().stream().map(Issue::code).collect(Collectors.toUnmodifiableSet()),
                obsolete
            );
        }).toList();
    }

    public record DashboardEntry(
        Long eventId,
        String eventName,
        ZonedDateTime dueAt,
        ZonedDateTime endedAt,
        ZonedDateTime availabilityDeadline,
        PreparationStatus preparationStatus,
        ClosureStatus closureStatus,
        int blockerCount,
        int warningCount,
        Set<String> issueCodes,
        List<ObsoleteConfirmation> obsoleteMaterialConfirmations
    ) {
    }

    /** A material confirmation that no longer matches its row: the hash names the confirmation that became obsolete. */
    public record ObsoleteConfirmation(Long materialId, String itemName, String confirmationHash) {
    }

    public View configure(Long eventId, Configuration request, AbstractAuthenticationToken token) {
        return command("configuration", eventId, request == null ? null : request.version(), token, () -> {
            validate(request);
            CalendarEvents event = event(eventId);
            CalendarEventPreparation preparation = preparations.findByEvent_IdAndDeletedFalse(eventId).orElseGet(() -> {
                CalendarEventPreparation value = new CalendarEventPreparation();
                value.setEvent(event);
                value.initializeAudit(actor(token));
                return value;
            });
            if (preparation.getId() != null && preparation.getEntityVersion() != request.version())
                throw conflict("La configurazione è stata modificata");
            apply(preparation, request);
            preparation.touchAudit(actor(token));
            preparations.save(preparation);
            return get(eventId);
        });
    }

    public View replaceProgram(Long eventId, ProgramRequest request, AbstractAuthenticationToken token) {
        return command("program", eventId, request.version(), token, () -> {
            if (request.entries().size() > MAX_ROWS)
                throw invalid("Il programma può contenere al massimo " + MAX_ROWS + " voci", "eventPreparation.program.tooLarge");
            event(eventId);
            CalendarEventPreparation preparation = requiredPreparation(eventId);
            if (preparations.advanceProgramVersion(preparation.getId(), request.version()) == 0) throw conflict("Il programma è stato modificato");
            // The version update cleared the persistence context: what follows is read again.
            CalendarEvents event = event(eventId);
            Map<Long, Tracks> found = byId(tracks.findAllById(request.entries().stream().map(ProgramEntryRequest::trackId).collect(Collectors.toSet())),
                Tracks::getId, track -> !Boolean.TRUE.equals(track.getDeleted()));
            List<CalendarEventProgramEntry> added = new ArrayList<>();
            int order = 0;
            for (ProgramEntryRequest row : request.entries()) {
                Tracks track = found.get(row.trackId());
                if (track == null) throw rejected(eventId, "program", "track_not_found", "Traccia non trovata", "eventPreparation.track.notFound");
                CalendarEventProgramEntry entry = new CalendarEventProgramEntry();
                entry.setEvent(event);
                entry.setTrack(track);
                entry.setTrackNameSnapshot(track.getName());
                entry.setEncore(Boolean.TRUE.equals(row.encore()));
                entry.setDisplayOrder(order++);
                entry.setPlannedDurationSeconds(row.plannedDurationSeconds());
                entry.setNotes(trim(row.notes()));
                entry.initializeAudit(actor(token));
                added.add(entry);
            }
            List<CalendarEventProgramEntry> old = programs.findCurrent(eventId);
            old.forEach(value -> {
                value.setDeleted(true);
                value.touchAudit(actor(token));
            });
            programs.saveAll(old);
            programs.flush();
            programs.saveAll(added);
            notifyProgramChanged(event, added, token);
            return viewAfter(eventId, token, this::getCatalogue);
        });
    }

    public View replaceMaterials(Long eventId, MaterialsRequest request, AbstractAuthenticationToken token) {
        return command("materials", eventId, request.version(), token, () -> {
            if (request.materials().size() > MAX_ROWS)
                throw invalid("I materiali possono contenere al massimo " + MAX_ROWS + " righe", "eventPreparation.materials.tooLarge");
            event(eventId);
            CalendarEventPreparation preparation = requiredPreparation(eventId);
            if (preparations.advanceMaterialsVersion(preparation.getId(), request.version()) == 0) throw conflict("I materiali sono stati modificati");
            CalendarEvents event = event(eventId);
            Map<Long, InventoryItem> items = byId(inventoryItems.findAllById(request.materials().stream().map(MaterialRequest::itemId).collect(Collectors.toSet())),
                InventoryItem::getId, item -> !item.isDeleted());
            Map<Long, InventoryAssignment> linked = byId(assignments.findAllById(request.materials().stream().map(MaterialRequest::assignmentId).filter(Objects::nonNull).collect(Collectors.toSet())),
                InventoryAssignment::getId, assignment -> !assignment.isDeleted());
            List<CalendarEventMaterial> added = new ArrayList<>();
            int order = 0;
            for (MaterialRequest row : request.materials()) {
                InventoryItem item = items.get(row.itemId());
                if (item == null) throw rejected(eventId, "materials", "item_not_found", "Oggetto inventario non trovato", "eventPreparation.item.notFound");
                InventoryAssignment assignment = row.assignmentId() == null ? null : linked.get(row.assignmentId());
                if (row.assignmentId() != null && assignment == null)
                    throw rejected(eventId, "materials", "assignment_not_found", "Assegnazione non trovata", "eventPreparation.assignment.notFound");
                if (assignment != null && !assignment.getItem().getId().equals(item.getId()))
                    throw rejected(eventId, "materials", "assignment_item_mismatch", "L'assegnazione non appartiene all'oggetto selezionato", "eventPreparation.assignment.itemMismatch");
                CalendarEventMaterial material = new CalendarEventMaterial();
                material.setEvent(event);
                material.setItem(item);
                material.setAssignment(assignment);
                material.setRequiredQuantity(row.requiredQuantity());
                material.setDisplayOrder(order++);
                material.setNotes(trim(row.notes()));
                material.initializeAudit(actor(token));
                added.add(material);
            }
            List<CalendarEventMaterial> old = materials.findCurrent(eventId);
            old.forEach(value -> {
                value.setDeleted(true);
                value.touchAudit(actor(token));
            });
            materials.saveAll(old);
            materials.flush();
            materials.saveAll(added);
            notifyMaterialsChanged(event, added, token);
            return get(eventId);
        });
    }

    public View confirmMaterial(Long eventId, Long materialId, AbstractAuthenticationToken token) {
        return command("material_confirmation", eventId, null, token, () -> {
            CalendarEventMaterial material = materials.findCurrentById(eventId, materialId).orElseThrow(() -> invalid("Materiale non trovato", "eventPreparation.material.notFound"));
            material.setConfirmationHash(PreparationHashes.material(material));
            material.setConfirmationAt(ZonedDateTime.now());
            material.setConfirmationBy(actor(token));
            material.touchAudit(actor(token));
            materials.save(material);
            logConfirmation(eventId, "material", material.getConfirmationHash(), token);
            return get(eventId);
        });
    }

    public View confirmBudget(Long eventId, AbstractAuthenticationToken token) {
        return command("budget_confirmation", eventId, null, token, () -> {
            CalendarEvents event = event(eventId);
            CalendarEventPreparation preparation = requiredPreparation(eventId);
            preparation.setBudgetConfirmationHash(PreparationHashes.budget(event));
            preparation.setBudgetConfirmationAt(ZonedDateTime.now());
            preparation.setBudgetConfirmationBy(actor(token));
            preparation.touchAudit(actor(token));
            preparations.save(preparation);
            logConfirmation(eventId, "budget", preparation.getBudgetConfirmationHash(), token);
            return viewAfter(eventId, token, this::getFinance);
        });
    }

    public View confirmPresence(Long eventId, AbstractAuthenticationToken token) {
        return command("presence_confirmation", eventId, null, token, () -> {
            event(eventId);
            CalendarEventPreparation preparation = requiredPreparation(eventId);
            preparation.setPresenceConfirmationHash(PreparationHashes.presence(loader.presences(eventId)));
            preparation.setPresenceConfirmationAt(ZonedDateTime.now());
            preparation.setPresenceConfirmationBy(actor(token));
            preparation.touchAudit(actor(token));
            preparations.save(preparation);
            logConfirmation(eventId, "presence", preparation.getPresenceConfirmationHash(), token);
            return get(eventId);
        });
    }

    public View confirmNoMovements(Long eventId, String reason, AbstractAuthenticationToken token) {
        return command("no_movements_confirmation", eventId, null, token, () -> {
            CalendarEvents event = event(eventId);
            CalendarEventPreparation preparation = requiredPreparation(eventId);
            List<FinancialMovement> current = movements.findAllByEvent_IdAndDeletedFalseOrderByBookingDateAscIdAsc(eventId);
            if (!current.isEmpty()) throw invalid("Sono presenti movimenti economici", "eventPreparation.movements.exists");
            String cleanReason = trim(reason);
            if (cleanReason != null && cleanReason.length() > 500) throw invalid("La motivazione supera i 500 caratteri", "eventPreparation.reason.tooLong");
            preparation.setNoMovementsConfirmationHash(PreparationHashes.noMovements(event, current));
            preparation.setNoMovementsConfirmationAt(ZonedDateTime.now());
            preparation.setNoMovementsConfirmationBy(actor(token));
            preparation.setNoMovementsConfirmationReason(cleanReason);
            preparation.touchAudit(actor(token));
            preparations.save(preparation);
            logConfirmation(eventId, "no_movements", preparation.getNoMovementsConfirmationHash(), token);
            return viewAfter(eventId, token, this::getFinance);
        });
    }

    private List<PreparationSnapshot> load(String view, List<Subject> subjects, Set<String> areas) {
        try {
            return loader.load(subjects, new Scope(areas, enabled(TenantFeature.INVENTORY_QR)));
        } catch (RuntimeException exception) {
            LOG.error("event_preparation_evaluation_failed view={} events={} area=LOAD error={}", view, subjects.size(), exception.getClass().getName());
            throw exception;
        }
    }

    private Result evaluate(String view, PreparationSnapshot snapshot, Set<String> areas, Reader reader, List<String> excludedAreas, boolean record) {
        EventPreparationEvaluator evaluator = new EventPreparationEvaluator(Instant.now());
        try {
            Result result = evaluator.evaluate(snapshot, areas, reader, excludedAreas);
            if (record && metrics != null) metrics.evaluated(result.evaluation());
            return result;
        } catch (RuntimeException exception) {
            LOG.error("event_preparation_evaluation_failed view={} eventId={} area={} error={}", view, snapshot.event().getId(), evaluator.area(), exception.getClass().getName());
            throw exception;
        }
    }

    private <T> T timed(String view, Supplier<T> body) {
        long start = System.nanoTime();
        try {
            return body.get();
        } finally {
            if (metrics != null) metrics.duration(view, System.nanoTime() - start);
        }
    }

    private <T> T command(String area, Long eventId, Long version, AbstractAuthenticationToken token, Supplier<T> body) {
        String actorHash = PreparationHashes.shortHash(actor(token));
        try {
            T result = body.get();
            if (metrics != null) metrics.command(area, "success");
            LOG.info("event_preparation_command eventId={} area={} version={} outcome=success actorHash={}", eventId, area, version, actorHash);
            return result;
        } catch (RuntimeException exception) {
            String outcome = exception instanceof RequestAlertException alert ? outcome(alert) : "error";
            if (metrics != null) metrics.command(area, outcome);
            LOG.warn("event_preparation_command eventId={} area={} version={} outcome={} actorHash={}", eventId, area, version, outcome, actorHash);
            throw exception;
        }
    }

    /**
     * The view of whoever sent the command: an archivist saving the program or a treasurer confirming the budget reads
     * their own view, never the administrative one with the materials and the other areas.
     */
    private View viewAfter(Long eventId, AbstractAuthenticationToken token, Function<Long, View> roleView) {
        boolean administrator = token == null || RoleGroups.isTenantManager(token);
        return administrator ? get(eventId) : roleView.apply(eventId);
    }

    private static String outcome(RequestAlertException exception) {
        return switch (exception.getStatusCode().value()) {
            case 400 -> "invalid";
            case 404 -> "not_found";
            case 409 -> "conflict";
            default -> "error";
        };
    }

    private void logConfirmation(Long eventId, String area, String hash, AbstractAuthenticationToken token) {
        LOG.info("event_preparation_confirmation eventId={} area={} hash={} actorHash={}", eventId, area, hash.substring(0, 12), PreparationHashes.shortHash(actor(token)));
    }

    /** A reference the client sent that is not in this tenant or not coherent: the log names neither the id nor the resource. */
    private static RequestAlertException rejected(Long eventId, String area, String reason, String message, String key) {
        LOG.warn("event_preparation_reference_rejected eventId={} area={} reason={}", eventId, area, reason);
        return invalid(message, key);
    }

    private List<ProgramEntry> program(PreparationSnapshot snapshot, Predicate<CalendarEventProgramEntry> visible,
                                       Predicate<Score> shownPart) {
        return snapshot.program().stream().filter(visible).map(entry -> {
            Tracks track = entry.getTrack();
            boolean available = !Boolean.TRUE.equals(track.getDeleted());
            String saved = entry.getTrackNameSnapshot();
            List<ProgramScore> parts = !available ? List.of() : snapshot.scores(track.getId()).stream().filter(shownPart).map(part -> new ProgramScore(
                part.id(),
                part.description(),
                List.copyOf(part.instruments().values()),
                List.copyOf(part.instruments().keySet()),
                part.ready(),
                part.needsReview(),
                part.unengraved(),
                part.readyFiles().stream().map(file -> new ScoreFile(file.mediaId(), file.fileName())).toList()
            )).toList();
            return new ProgramEntry(entry.getId(), track.getId(), EventPreparationEvaluator.trackName(entry),
                available && saved != null && !saved.equals(track.getName()) ? saved : null, track.getState().name(), available, entry.isEncore(),
                entry.getDisplayOrder(), entry.getPlannedDurationSeconds(), entry.getNotes(), parts);
        }).toList();
    }

    private static List<Material> materials(PreparationSnapshot snapshot, Map<Long, MaterialState> states) {
        return snapshot.materials().stream().map(material -> {
            CalendarEventMaterial row = material.row();
            InventoryAssignment assignment = row.getAssignment();
            MaterialState state = states.get(row.getId());
            return new Material(row.getId(), row.getItem().getId(), row.getItem().getName(), row.getItem().getInventoryNumber(),
                assignment == null ? null : assignment.getId(),
                assignment == null ? null : assignment.getUserName() + " " + assignment.getUserLastName(),
                row.getRequiredQuantity(), assignment == null ? null : assignment.getOutstandingQuantity(), row.getItem().getConditionStatus().name(),
                material.unsafeIssueOpen(), state.confirmed(), state.confirmationObsolete(), state.ready(), state.problems(), row.getNotes());
        }).toList();
    }

    private static Confirmations confirmations(PreparationSnapshot snapshot, boolean finance, boolean presence) {
        CalendarEventPreparation plan = snapshot.preparation();
        return new Confirmations(
            finance ? plan.getBudgetConfirmationAt() : null,
            finance && EventPreparationEvaluator.budgetConfirmed(snapshot),
            presence ? plan.getPresenceConfirmationAt() : null,
            presence && EventPreparationEvaluator.presenceConfirmed(snapshot),
            finance ? plan.getNoMovementsConfirmationAt() : null,
            finance && EventPreparationEvaluator.noMovementsConfirmed(snapshot),
            finance ? plan.getNoMovementsConfirmationReason() : null
        );
    }

    private static Availability ownAvailability(PreparationSnapshot snapshot, String userId) {
        CalendarEventAvailability.Availability answer = snapshot.responses().get(userId);
        CalendarEvents event = snapshot.event();
        CalendarEventPreparation plan = snapshot.preparation();
        ZonedDateTime deadline = plan == null || event.getStartDate() == null ? null
            : ZonedDateTime.ofInstant(event.getStartDate().toInstant(), ZoneId.systemDefault()).minusMinutes(plan.getAvailabilityDeadlineMinutes());
        return new Availability(1, answer == CalendarEventAvailability.Availability.AVAILABLE ? 1 : 0, answer == CalendarEventAvailability.Availability.UNAVAILABLE ? 1 : 0,
            answer == null ? 1 : 0, null, deadline);
    }

    private static Availability emptyAvailability() {
        return new Availability(0, 0, 0, 0, null, null);
    }

    private Configuration configuration(CalendarEventPreparation p) {
        return new Configuration(p.getProfile(), p.isLocationRequired(), p.isProgramRequired(), p.isScoresRequired(), p.isAvailabilityRequired(), p.getMinimumAvailableParticipants(),
            p.getAvailabilityDeadlineMinutes(), p.isMaterialsRequired(), p.getMaterialsDeadlineMinutes(), p.isBudgetRequired(), p.isPresenceClosureRequired(),
            p.isFinancialClosureRequired(), p.getEntityVersion());
    }

    private static Configuration catalogueConfiguration(Configuration c) {
        return new Configuration(c.profile(), false, c.programRequired(), c.scoresRequired(), c.availabilityRequired(), c.minimumAvailableParticipants(),
            c.availabilityDeadlineMinutes(), false, 0, false, false, false, c.version());
    }

    private static Configuration personalConfiguration(Configuration c) {
        return new Configuration(c.profile(), false, c.programRequired(), c.scoresRequired(), c.availabilityRequired(), null, c.availabilityDeadlineMinutes(),
            false, 0, false, false, false, c.version());
    }

    private static Configuration financeConfiguration(Configuration c) {
        return new Configuration(c.profile(), false, false, false, false, null, 0, false, 0, c.budgetRequired(), false, c.financialClosureRequired(), c.version());
    }

    /** A requirement whose module is off for the tenant leaves the requirements: it is returned as not required. */
    private Configuration degrade(Configuration c) {
        boolean inventory = enabled(TenantFeature.INVENTORY);
        boolean finance = enabled(TenantFeature.FINANCE);
        if (inventory && finance) return c;
        return new Configuration(c.profile(), c.locationRequired(), c.programRequired(), c.scoresRequired(), c.availabilityRequired(), c.minimumAvailableParticipants(),
            c.availabilityDeadlineMinutes(), inventory && c.materialsRequired(), c.materialsDeadlineMinutes(), finance && c.budgetRequired(), c.presenceClosureRequired(),
            finance && c.financialClosureRequired(), c.version());
    }

    /** The areas the plan requires but the view does not evaluate because their module is off. */
    private List<String> excludedAreas(CalendarEventPreparation plan, Set<String> viewAreas) {
        List<String> result = new ArrayList<>();
        if (!enabled(TenantFeature.INVENTORY) && plan.isMaterialsRequired() && viewAreas.contains("MATERIALS")) result.add("MATERIALS");
        if (!enabled(TenantFeature.FINANCE) && plan.isBudgetRequired() && viewAreas.contains("BUDGET")) result.add("BUDGET");
        if (!enabled(TenantFeature.FINANCE) && plan.isFinancialClosureRequired() && viewAreas.contains("FINANCE")) result.add("FINANCE");
        return result;
    }

    private Set<String> availableAreas(Set<String> requestedAreas) {
        Set<String> areas = new HashSet<>(requestedAreas);
        if (!enabled(TenantFeature.INVENTORY)) areas.remove("MATERIALS");
        if (!enabled(TenantFeature.FINANCE)) {
            areas.remove("BUDGET");
            areas.remove("FINANCE");
        }
        return areas;
    }

    private boolean enabled(TenantFeature feature) {
        return tenantFeatures == null || tenantFeatures.isEnabled(feature);
    }

    private void apply(CalendarEventPreparation p, Configuration c) {
        p.setProfile(c.profile());
        p.setLocationRequired(c.locationRequired());
        p.setProgramRequired(c.programRequired());
        p.setScoresRequired(c.scoresRequired());
        p.setAvailabilityRequired(c.availabilityRequired());
        p.setMinimumAvailableParticipants(c.availabilityRequired() ? c.minimumAvailableParticipants() : null);
        p.setAvailabilityDeadlineMinutes(c.availabilityDeadlineMinutes());
        // A module that is off keeps the saved requirement: it comes back when the module is enabled again.
        if (enabled(TenantFeature.INVENTORY)) {
            p.setMaterialsRequired(c.materialsRequired());
            p.setMaterialsDeadlineMinutes(c.materialsDeadlineMinutes());
        }
        if (enabled(TenantFeature.FINANCE)) {
            p.setBudgetRequired(c.budgetRequired());
            p.setFinancialClosureRequired(c.financialClosureRequired());
        }
        p.setPresenceClosureRequired(c.presenceClosureRequired());
    }

    private static void validate(Configuration c) {
        if (c == null || c.profile() == null || Stream.of(c.locationRequired(), c.programRequired(), c.scoresRequired(), c.availabilityRequired(), c.materialsRequired(),
            c.budgetRequired(), c.presenceClosureRequired(), c.financialClosureRequired()).anyMatch(Objects::isNull))
            throw invalid("Indica per ogni area se è richiesta", "eventPreparation.requirement.required");
        if (c.scoresRequired() && !c.programRequired()) throw invalid("Gli spartiti richiedono il programma", "eventPreparation.program.required");
        if (c.availabilityRequired() && (c.minimumAvailableParticipants() == null || c.minimumAvailableParticipants() < 1))
            throw invalid("Indica il numero minimo di partecipanti", "eventPreparation.participants.required");
    }

    private CalendarEvents event(Long id) {
        CalendarEvents value = events.findByIdAndDeletedFalse(id).orElseThrow(EventPreparationService::notFound);
        if (Boolean.TRUE.equals(value.getSeriesExcluded())) throw notFound();
        return value;
    }

    private CalendarEventPreparation requiredPreparation(Long id) {
        return preparations.findByEvent_IdAndDeletedFalse(id).orElseThrow(() -> invalid("Configura prima la preparazione", "eventPreparation.notConfigured"));
    }

    private static <T> Map<Long, T> byId(List<T> values, Function<T, Long> id, Predicate<T> usable) {
        return values.stream().filter(usable).collect(Collectors.toMap(id, Function.identity(), (left, right) -> left));
    }

    private static String actor(AbstractAuthenticationToken token) {
        return token == null || token.getName() == null ? "system" : token.getName();
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static RequestAlertException invalid(String message, String key) {
        return new RequestAlertException(HttpStatus.BAD_REQUEST, message, ENTITY, key);
    }

    private static RequestAlertException conflict(String message) {
        return new RequestAlertException(HttpStatus.CONFLICT, message, ENTITY, "eventPreparation.versionConflict");
    }

    private static RequestAlertException notFound() {
        return new RequestAlertException(HttpStatus.NOT_FOUND, "Evento non trovato", ENTITY, "eventPreparation.event.notFound");
    }

    private void notifyProgramChanged(CalendarEvents event, List<CalendarEventProgramEntry> rows, AbstractAuthenticationToken token) {
        if (notificationPublisher == null || event.getStartDate() == null || !event.getStartDate().toInstant().isAfter(Instant.now()) || event.getState() == StateEnum.DRAFT)
            return;
        Set<NotificationAudience> audiences = event.getAvailabilities().stream()
            .filter(value -> value.getAvailability() == CalendarEventAvailability.Availability.AVAILABLE)
            .map(value -> NotificationAudience.user(value.getUser().getKeycloakId()))
            .collect(Collectors.toUnmodifiableSet());
        if (audiences.isEmpty()) return;
        enqueue(event, token, "PROGRAM_UPDATED", PreparationHashes.program(rows), "Programma evento aggiornato", "Il programma di “" + event.getName() + "” è stato aggiornato.", audiences);
    }

    /**
     * Administrators read every item and quantity; each assignee reads only the rows of their own assignments, so a
     * message never names material assigned to someone else.
     */
    private void notifyMaterialsChanged(CalendarEvents event, List<CalendarEventMaterial> rows, AbstractAuthenticationToken token) {
        if (notificationPublisher == null) return;
        String revision = PreparationHashes.materials(rows);
        String all = rows.isEmpty() ? "nessun materiale pianificato" : itemsLabel(rows);
        enqueue(event, token, "MATERIALS_UPDATED", revision + ":admins", "Materiali evento aggiornati", "Materiali di “" + event.getName() + "”: " + all + ".",
            Set.of(NotificationAudience.role(RoleEnum.ROLE_ADMIN), NotificationAudience.role(RoleEnum.ROLE_BOARD), NotificationAudience.role(RoleEnum.ROLE_SUPER_ADMIN)));
        Map<String, List<CalendarEventMaterial>> byAssignee = new LinkedHashMap<>();
        rows.stream().filter(row -> row.getAssignment() != null && row.getAssignment().getUserKeycloakId() != null)
            .forEach(row -> byAssignee.computeIfAbsent(row.getAssignment().getUserKeycloakId(), key -> new ArrayList<>()).add(row));
        byAssignee.forEach((assignee, own) -> enqueue(event, token, "MATERIALS_UPDATED", revision + ":user:" + assignee, "Materiali evento aggiornati",
            "Per “" + event.getName() + "” ti sono richiesti: " + itemsLabel(own) + ".", Set.of(NotificationAudience.user(assignee))));
    }

    private static String itemsLabel(List<CalendarEventMaterial> rows) {
        String named = rows.stream().limit(NOTIFIED_ITEMS).map(row -> row.getItem().getName() + " × " + row.getRequiredQuantity()).collect(Collectors.joining(", "));
        return rows.size() > NOTIFIED_ITEMS ? named + " e altri " + (rows.size() - NOTIFIED_ITEMS) : named;
    }

    private void enqueue(CalendarEvents event, AbstractAuthenticationToken token, String operation, String revision, String title, String message, Set<NotificationAudience> audiences) {
        String actor = actor(token);
        notificationPublisher.enqueue(new NotificationCommand(
            "event-preparation:" + event.getId() + ":" + operation + ":" + revision,
            NotificationSource.CALENDAR,
            "EVENT_PREPARATION",
            event.getId().toString(),
            operation,
            title,
            message,
            NotificationSeverity.INFO,
            NotificationPreferencePolicy.CONFIGURABLE,
            "/calendar/" + event.getId() + "#preparation",
            actor,
            actor,
            audiences,
            null
        ));
    }
}
