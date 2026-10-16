/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * One trip: itinerary by local date with a day rail, a dense bookings table,
 * saved ideas, and an overview of coverage, calendar conflicts and Ri
 * follow-ups. Selecting a booking opens its inspector beside the itinerary
 * at wide widths and as its own screen with Back when narrower.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell, AskRiButton, Button, ButtonRow, Checkbox, ConflictNotice, DataTable, DateInput, Dialog, EmptyState, ErrorState, FollowUpDialog, InlineError, KeyValueList, LoadingState, Menu,
  Notice, SearchField, SectionPanel, SectionTabs, SegmentedControl, SplitView, StatusLabel, TextArea, TextInput, Toolbar, useAnnounce, useAppLayout, useMutation, useQuery, useRiApp,
} from "@ri/app-kit/ui";
import { formatDate } from "@ri/app-kit/time";
import { useNav } from "./app.js";
import { BookingInspector } from "./inspector.js";
import { IdeasTab } from "./ideas.js";
import { StateNotice } from "./trips.js";
import type { Booking, CalendarState, Day, FollowUp, FollowUpResult, Gap, Item, Route, StatusFilter, Trip, TripDetail, TripTab, Write } from "./types.js";
import { dayChip, dayPrompt, errorText, gapPrompt, plural, STATUS_LABELS, STATUS_TONES, timeLabel, travelersLine, tripPrompt, uuid, cleanError, cleanly } from "./util.js";

type TripRoute = Extract<Route, { section: "trip" }>;

export function TripScreen() {
  const app = useRiApp();
  const { route: anyRoute, navigate, addBooking, data, setRevisions } = useNav();
  const layout = useAppLayout();
  const route = anyRoute as TripRoute;
  const detail = useQuery<TripDetail>("get_trip", { id: route.tripId });
  const [editing, setEditing] = useState(false);
  const [followUp, setFollowUp] = useState<{ title: string; dueAt: string | null } | null>(null);
  const update = (patch: Partial<TripRoute>) => navigate({ ...route, ...patch });
  const trip = detail.data?.trip;

  useEffect(() => {
    if (!detail.data) return;
    const selected = route.selected ? detail.data.bookings.find((booking) => booking.id === route.selected) : null;
    setRevisions({ [detail.data.trip.id]: detail.data.trip.revision, ...(selected ? { [selected.id]: selected.revision } : {}) });
  }, [detail.data, route.selected]);

  if (detail.error && !detail.data)
    return (
      <AppShell eyebrow="Travel" title="Trip unavailable">
        <Button variant="quiet" className="tr-back" onClick={() => navigate({ section: "trips" })}>Back to all trips</Button>
        <ErrorState message={cleanError(detail.error)} onRetry={() => void detail.reload()} />
      </AppShell>
    );
  if (!detail.data || !trip)
    return (
      <AppShell eyebrow="Travel" title="Trip">
        <LoadingState label="Loading trip" />
      </AppShell>
    );
  const review = detail.data.review;
  const firstReview = review[0];
  const notice = review.length ? (
    <Notice
      title={review.length === 1 ? "One item needs a look." : `${review.length} items need a look.`}
      action={<Button size="sm" onClick={() => navigate({ section: "review", tripId: trip.id })}>{firstReview.kind === "change" ? "Review change" : "Open Review"}</Button>}
    >
      {firstReview.reason}
    </Notice>
  ) : <StateNotice />;
  const contextLine = [trip.dateLabel, travelersLine(trip.travelers), trip.projection === "partial" ? "Shown through the records shared with this chat" : null].filter(Boolean).join(" · ");
  const narrow = layout !== "wide";
  // On a narrow detail screen the booking comes first. The notice returns with Back.
  const showNotice = !(narrow && route.selected);

  return (
    <AppShell
      eyebrow={
        <span className="tr-crumb">
          <span>Travel</span>
          <span className="tr-crumb__sep" aria-hidden="true">/</span>
          <button type="button" className="tr-crumb__link" aria-label="Back to all trips" onClick={() => navigate({ section: "trips" })}>Trips</button>
        </span>
      }
      title={trip.title}
      context={<>{contextLine}{!narrow && <><br /><span className="ri-small">{detail.data.localContext}</span></>}</>}
      secondaryActions={<AskRiButton prompt={tripPrompt(trip.title)} />}
      primaryAction={data.owner ? <Button variant="primary" onClick={() => addBooking(trip.id)}>Add booking</Button> : undefined}
      tabs={
        <div className="ri-stack ri-stack--tight">
          <div className="tr-tabs-row">
            <SectionTabs
              label="Trip sections"
              panelId="trip-panel"
              value={route.tab}
              onChange={(id) => update({ tab: id as TripTab, selected: null })}
              items={[{ id: "itinerary", label: "Itinerary" }, { id: "bookings", label: "Bookings", badge: trip.bookingCount + trip.canceledCount || undefined }, { id: "ideas", label: "Ideas", badge: detail.data.ideaCount || undefined }]}
            />
            {review.length > 0 && !narrow && <Button variant="link" size="sm" className="tr-review-link" onClick={() => navigate({ section: "review", tripId: trip.id })}>{plural(review.length, "item to review", "items to review")}</Button>}
          </div>
        </div>
      }
      notice={showNotice ? notice : undefined}
    >
      <SectionPanel panelId="trip-panel" value={route.tab}>
        {route.tab === "itinerary" ? (
          <ItineraryTab detail={detail.data} route={route} update={update} onEditTrip={() => setEditing(true)} onFollowUp={(title, dueAt) => setFollowUp({ title, dueAt })} />
        ) : route.tab === "bookings" ? (
          <BookingsTab detail={detail.data} route={route} update={update} />
        ) : (
          <IdeasTab trip={trip} selected={route.selected} onSelect={(id) => update({ selected: id })} />
        )}
      </SectionPanel>
      <EditTripDialog open={editing} trip={trip} onClose={() => setEditing(false)} />
      <TripFollowUp trip={trip} request={followUp} onClose={() => setFollowUp(null)} />
      {detail.refreshing && <span className="ri-sr-only" role="status">Updating trip</span>}
      {app.error && <InlineError>{cleanError(app.error)}</InlineError>}
    </AppShell>
  );
}

/** The day the itinerary opens on: today during the trip, the first planned day otherwise. */
function defaultDay(detail: TripDetail, today: string): string {
  const inTrip = detail.days.filter((day) => day.inTrip);
  if (inTrip.some((day) => day.date === today)) return today;
  const upcoming = detail.days.find((day) => day.date >= today && day.items.length);
  return upcoming?.date ?? detail.days.find((day) => day.items.length)?.date ?? detail.days[0]?.date ?? "all";
}

function ItineraryTab({ detail, route, update, onEditTrip, onFollowUp }: { detail: TripDetail; route: TripRoute; update(patch: Partial<TripRoute>): void; onEditTrip(): void; onFollowUp(title: string, dueAt: string | null): void }) {
  const { data } = useNav();
  const layout = useAppLayout();
  const day = route.day && (route.day === "all" || detail.days.some((item) => item.date === route.day)) ? route.day : defaultDay(detail, data.today);
  const selected = route.selected ? detail.bookings.find((booking) => booking.id === route.selected) ?? null : null;
  const days = day === "all" ? detail.days : detail.days.filter((item) => item.date === day);
  const gaps = detail.coverage.gaps;
  if (!detail.days.length)
    return (
      <EmptyState title="No booking recorded for this trip yet" action={data.owner ? <Button variant="primary" onClick={() => update({ tab: "ideas" })}>Browse ideas</Button> : undefined}>
        {detail.trip.ideaCount ? "Only ideas are saved so far. Nothing is confirmed until a booking is recorded." : "Add a booking, or save ideas while you plan. Ideas never count as confirmed."}
      </EmptyState>
    );
  const overview = <TripOverview detail={detail} onEditTrip={onEditTrip} onFollowUp={onFollowUp} onSelectDay={(date) => update({ day: date, selected: null })} />;
  return (
    <SplitView
      detailOpen={Boolean(selected)}
      onBack={() => update({ selected: null })}
      backLabel="Back to itinerary"
      detailLabel={selected?.title}
      detail={selected ? <BookingInspector bookingId={selected.id} tripTitle={detail.trip.title} onClose={() => update({ selected: null })} /> : null}
      emptyDetail={overview}
      list={
        <div className="ri-stack ri-stack--loose">
          <DayRail days={detail.days} value={day} onChange={(value) => update({ day: value })} today={data.today} />
          <div className="tr-itinerary" aria-live="polite">
            {days.map((item) => (
              <DayBlock key={item.date} day={item} trip={detail.trip} gaps={gaps.filter((gap) => item.gapKeys.includes(gap.key))} selectedBooking={route.selected} onSelect={(id) => update({ selected: id })} onIdeas={() => update({ tab: "ideas", selected: null })} />
            ))}
          </div>
          {layout !== "wide" && !selected && overview}
        </div>
      }
    />
  );
}

function DayRail({ days, value, onChange, today }: { days: Day[]; value: string; onChange(value: string): void; today: string }) {
  return (
    <div className="tr-days">
      <SegmentedControl
        label="Trip days"
        value={value}
        onChange={onChange}
        options={[
          { id: "all", label: <span className="tr-day__all">All<span className="ri-sr-only"> days</span></span> },
          ...days.map((day) => {
            const chip = dayChip(day.date);
            return {
              id: day.date,
              label: (
                <span className="ri-stack ri-stack--tight" style={{ gap: "0.125rem", justifyItems: "center" }}>
                  <span className="tr-day__weekday">{chip.weekday}</span>
                  <span className="tr-day__date">{chip.day}</span>
                  <span className="tr-day__mark">{day.date === today ? "Today" : day.gapKeys.length ? "Check" : chip.month}</span>
                </span>
              ),
            };
          }),
        ]}
      />
    </div>
  );
}

function DayBlock({ day, trip, gaps, selectedBooking, onSelect, onIdeas }: { day: Day; trip: Trip; gaps: Gap[]; selectedBooking: string | null; onSelect(id: string): void; onIdeas(): void }) {
  return (
    <section className="tr-dayblock" aria-label={day.label}>
      <div className="tr-dayhead">
        <h2 className="ri-h2">{day.label}</h2>
        {day.zoneLine && <p>{day.zoneLine}</p>}
        {!day.inTrip && <p>Outside the trip dates</p>}
      </div>
      {day.items.length > 0 && (
        <ol className="tr-entries" aria-label={`Entries on ${day.label}`}>
          {day.items.map((item) => <Entry key={item.id} item={item} selected={item.bookingId === selectedBooking} onSelect={() => onSelect(item.bookingId)} />)}
        </ol>
      )}
      {gaps.map((gap) => <GapCard key={gap.key} gap={gap} trip={trip} />)}
      {day.inTrip && !day.items.some((item) => item.time) && (
        <div className="tr-gap">
          <p>No timed plans recorded for {formatDate(day.date, "weekdayLong")}.</p>
          <ButtonRow>
            <Button size="sm" onClick={onIdeas}>Browse ideas</Button>
            <AskRiButton size="sm" variant="quiet" prompt={dayPrompt(day.date, trip.title)}>Plan this day</AskRiButton>
          </ButtonRow>
        </div>
      )}
    </section>
  );
}

function Entry({ item, selected, onSelect }: { item: Item; selected: boolean; onSelect(): void }) {
  const time = timeLabel(item);
  const canceled = item.status === "canceled";
  return (
    <li className="tr-entry">
      <span className="tr-entry__time">
        <strong>{time.time}</strong>
        {time.zone && <span>{time.zone}</span>}
      </span>
      <button type="button" className={`tr-card${canceled ? " tr-card--canceled" : ""}${item.role === "staying" ? " tr-card--quiet" : ""}`} aria-current={selected || undefined} onClick={onSelect}>
        <span className="tr-card__title">{item.title}</span>
        <span className="tr-card__subtitle">{item.subtitle}</span>
        {item.role !== "staying" && (
          <span className="tr-card__meta">
            <StatusLabel tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</StatusLabel>
            {item.needsReview && <StatusLabel tone="warning">Needs review</StatusLabel>}
            <span>{item.sourceAvailable ? item.sourceLabel : `Source unavailable, ${item.sourceLabel.toLowerCase()}`}</span>
            {item.context && <span>{item.context}</span>}
            {item.corrected && <span>Corrected by you</span>}
          </span>
        )}
        {item.notes.map((note) => <span key={note} className="tr-card__note">{note}</span>)}
      </button>
    </li>
  );
}

function GapCard({ gap, trip }: { gap: Gap; trip: Trip }) {
  const { data } = useNav();
  const dismiss = useMutation<Record<string, unknown>, unknown>("dismiss_gap");
  const announce = useAnnounce();
  return (
    <div className="tr-gap" role="note">
      <p><strong>{gap.kind === "night" ? "Check this night." : gap.kind === "overlap" ? "Times overlap." : "Time zone missing."}</strong> {gap.message}</p>
      {gap.kind === "night" && <p className="ri-small ri-muted">This is a prompt to check. Staying with friends or an overnight journey can be intentional.</p>}
      <ButtonRow>
        <AskRiButton size="sm" prompt={gapPrompt(gap, trip.title)}>Think this through</AskRiButton>
        {data.owner && trip.projection === "full" && (
          <Button size="sm" variant="quiet" busy={dismiss.pending} onClick={async () => {
            try {
              await dismiss.run({ tripId: trip.id, key: gap.key, fingerprint: gap.fingerprint });
              announce("Dismissed until the bookings around it change");
            } catch { /* The error shows below. */ }
          }}>Dismiss</Button>
        )}
      </ButtonRow>
      <InlineError>{cleanError(dismiss.error)}</InlineError>
    </div>
  );
}

function TripOverview({ detail, onEditTrip, onFollowUp, onSelectDay }: { detail: TripDetail; onEditTrip(): void; onFollowUp(title: string, dueAt: string | null): void; onSelectDay(date: string): void }) {
  const app = useRiApp();
  const { data, navigate } = useNav();
  const restore = useMutation<Record<string, unknown>, unknown>("dismiss_gap");
  const trip = detail.trip;
  const coverage = detail.coverage;
  const covered = coverage.nights.filter((night) => night.status === "covered").length;
  const announce = useAnnounce();
  const [exportError, setExportError] = useState<string | null>(null);
  const exportTrip = async (format: "csv" | "json") => {
    setExportError(null);
    try {
      const file = await app.call<{ fileName: string; mimeType: string; text: string }>("export_trip", { id: trip.id, format });
      await app.download({ name: file.fileName, mimeType: file.mimeType, text: file.text });
      announce("Export ready");
    } catch (error) {
      setExportError(errorText(error, "The export did not finish"));
    }
  };
  const dismissed = coverage.gaps.filter((gap) => gap.dismissed);
  return (
    <aside className="tr-overview" aria-label="Trip checks">
      <section aria-labelledby="tr-coverage">
        <p className="ri-eyebrow" id="tr-coverage">Coverage</p>
        <p>{coverage.summary}.</p>
        {coverage.checked && <p className="ri-small ri-muted">{covered} of {plural(coverage.nights.length, "night", "nights")} have a stay or an overnight journey recorded. Check-out dates are not counted as nights.</p>}
        {!coverage.checked && data.owner && trip.projection === "full" && <Button size="sm" onClick={onEditTrip}>Add trip dates</Button>}
        {coverage.gaps.filter((gap) => !gap.dismissed).length > 0 && (
          <ul>
            {coverage.gaps.filter((gap) => !gap.dismissed).map((gap) => (
              <li key={gap.key} className="tr-list-row">
                <span>{gap.message}</span>
                {gap.date && <Button variant="link" size="sm" onClick={() => onSelectDay(gap.date!)}>Show day</Button>}
              </li>
            ))}
          </ul>
        )}
        {dismissed.length > 0 && (
          <ul aria-label="Dismissed checks">
            {dismissed.map((gap) => (
              <li key={gap.key} className="tr-list-row">
                <span className="ri-muted">Dismissed: {gap.message}</span>
                {data.owner && <Button variant="link" size="sm" busy={restore.pending} onClick={() => void restore.run({ tripId: trip.id, key: gap.key, fingerprint: gap.fingerprint, restore: true }).catch(() => undefined)}>Show again</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <hr className="ri-divider" />
      <CalendarSection calendar={detail.calendar} onSources={() => (data.owner ? navigate({ section: "sources" }) : void app.openSources())} owner={data.owner} />
      <hr className="ri-divider" />
      <section aria-labelledby="tr-followups">
        <p className="ri-eyebrow" id="tr-followups">Ri follow-ups</p>
        {detail.followUps.length ? <FollowUpList items={detail.followUps} /> : <p className="ri-small ri-muted">No Ri tasks linked to this trip.</p>}
        <ButtonRow>
          <Button size="sm" onClick={() => onFollowUp(`Arrange the airport transfer in ${trip.title}`, null)}>Add travel task</Button>
        </ButtonRow>
      </section>
      <hr className="ri-divider" />
      <section aria-labelledby="tr-trip-facts">
        <p className="ri-eyebrow" id="tr-trip-facts">Trip</p>
        <KeyValueList
          items={[
            { label: "Dates", value: trip.startDate ? `${trip.dateLabel}${trip.datesSource === "derived" ? ", from bookings" : ""}` : "Not set" },
            { label: "Home time zone", value: trip.homeZone ?? "Not set" },
            { label: "Travelers", value: trip.travelers.join(", ") || "Not provided" },
            ...(trip.notes ? [{ label: "Notes", value: trip.notes }] : []),
          ]}
        />
        {data.owner && trip.projection === "full" && (
          <ButtonRow>
            <Button size="sm" variant="quiet" onClick={onEditTrip}>Edit trip</Button>
            <Menu label="Export" size="sm" variant="quiet" items={[{ id: "csv", label: "Itinerary as CSV" }, { id: "json", label: "Everything as JSON" }]} onSelect={(id) => void exportTrip(id as "csv" | "json")} />
          </ButtonRow>
        )}
        <InlineError>{exportError}</InlineError>
      </section>
    </aside>
  );
}

function CalendarSection({ calendar, onSources, owner }: { calendar: CalendarState; onSources(): void; owner: boolean }) {
  const RELATION: Record<string, string> = { during_trip: "While you are away", overlaps_booking: "Overlaps a booking", matches_booking: "Matches a booking" };
  return (
    <section aria-labelledby="tr-calendar">
      <p className="ri-eyebrow" id="tr-calendar">Calendar</p>
      <p className="ri-small">{calendar.message}</p>
      {calendar.events.length > 0 && (
        <ul>
          {calendar.events.map((event) => (
            <li key={event.id} className="ri-stack ri-stack--tight" style={{ gap: "0.125rem" }}>
              <span className="tr-list-row"><strong>{event.summary}</strong><StatusLabel tone={event.relation === "matches_booking" ? "neutral" : "warning"}>{RELATION[event.relation]}</StatusLabel></span>
              <span className="ri-small ri-muted">{event.when}. {event.note}</span>
              {event.relation !== "matches_booking" && <AskRiButton size="sm" variant="link" prompt={`My calendar has ${event.summary} on ${event.when} during this trip. Help me decide what to do about it.`}>Ask about this conflict</AskRiButton>}
            </li>
          ))}
        </ul>
      )}
      {(calendar.status === "not_connected" || calendar.status === "not_chosen") && owner && <ButtonRow><Button size="sm" onClick={onSources}>Choose calendars</Button></ButtonRow>}
    </section>
  );
}

export function FollowUpList({ items }: { items: FollowUp[] }) {
  const app = useRiApp();
  const { data } = useNav();
  const checked = useRef(new Set<string>());
  // Confirm once per view that each linked Ri task still exists. Stale checks only, never in a loop.
  useEffect(() => {
    if (!data.owner) return;
    const stale = items.filter((item) => item.taskId && !checked.current.has(item.id) && (!item.checkedAt || Date.parse(item.checkedAt) < Date.now() - 10 * 60_000));
    for (const item of stale.slice(0, 5)) {
      checked.current.add(item.id);
      void app.call("check_follow_up", { id: item.id }).catch(() => undefined);
    }
  }, [items.map((item) => item.id).join("|")]);
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} className="ri-stack ri-stack--tight" style={{ gap: "0.125rem" }}>
          <span className="tr-list-row">
            <span>{item.title}</span>
            <StatusLabel tone={item.state === "created" && item.availability !== "missing" ? "success" : item.state === "pending" ? "neutral" : "warning"}>
              {item.state === "created" ? (item.availability === "missing" ? "Task removed in Ri" : "Ri task") : item.state === "pending" ? "Waiting" : item.state === "needs_permission" ? "Needs permission" : "Not created"}
            </StatusLabel>
          </span>
          <span className="ri-small ri-muted">{item.dueAt ? `Due ${formatDate(item.dueAt.slice(0, 10), "medium")}` : "No due date"}{item.message ? `. ${item.message}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function TripFollowUp({ trip, request, onClose }: { trip: Trip; request: { title: string; dueAt: string | null } | null; onClose(): void }) {
  const app = useRiApp();
  const create = useMutation<Record<string, unknown>, FollowUpResult>("create_follow_up");
  const [operationId] = useState(uuid);
  const [created, setCreated] = useState<{ title: string; dueAt: string | null } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => { if (request) { setCreated(null); setBlocked(null); } }, [request]);
  return (
    <>
      <FollowUpDialog
        open={Boolean(request) && !blocked}
        defaultTitle={request?.title ?? ""}
        allowDueDate
        defaultDueDate={request?.dueAt ?? null}
        subject={`${trip.title}, ${trip.dateLabel}`}
        created={created}
        onClose={onClose}
        onCreate={async (title, dueAt) => {
          const result = await cleanly(() => create.run({ subject: { type: "trip", id: trip.id }, title, ...(dueAt ? { dueAt } : {}), operationId }));
          if (result.status === "needs_permission") { setBlocked(result.message); throw new Error(result.message); }
          if (result.status !== "created") throw new Error(result.message);
          setCreated({ title: result.followUp.title, dueAt: result.followUp.dueAt });
        }}
      />
      <Dialog open={Boolean(blocked)} title="Allow Ri tasks first" onClose={() => { setBlocked(null); onClose(); }} footer={<><Button variant="quiet" onClick={() => { setBlocked(null); onClose(); }}>Close</Button><Button variant="primary" onClick={() => void app.openSources()}>Open Sources</Button></>}>
        <p>{blocked}</p>
        <p className="ri-small ri-muted">Your task title is kept. Try again after allowing it, and the same task is used.</p>
      </Dialog>
    </>
  );
}

function EditTripDialog({ open, trip, onClose }: { open: boolean; trip: Trip; onClose(): void }) {
  const save = useMutation<Record<string, unknown>, Write<Trip>>("save_trip");
  const announce = useAnnounce();
  const [form, setForm] = useState(() => formOf(trip));
  const [base, setBase] = useState(trip.revision);
  const [conflict, setConflict] = useState<Trip | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A refresh while the dialog is open never resets what was typed.
  useEffect(() => { if (open) { setForm(formOf(trip)); setBase(trip.revision); setConflict(null); setProblem(null); } }, [open]);
  const submit = async (revision: number) => {
    if (!form.title.trim()) return setProblem("Name the trip");
    if (Boolean(form.start) !== Boolean(form.end)) return setProblem("Set both dates, or clear both");
    if (form.start && form.end && form.end < form.start) return setProblem("The trip ends before it starts");
    if (form.zone && !validZone(form.zone)) return setProblem("Use a time zone such as Europe/Lisbon or America/Denver");
    setProblem(null);
    try {
      const result = await save.run({ id: trip.id, expectedRevision: revision, title: form.title.trim(), startDate: form.start, endDate: form.end, homeZone: form.zone || null, travelers: form.travelers.split(",").map((name) => name.trim()).filter(Boolean), notes: form.notes || null, archived: form.archived });
      if (result.status === "conflict") { setConflict(result.current); return; }
      announce("Trip saved");
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <Dialog open={open} title="Edit trip" description="Dates are inclusive. Bookings keep their own dates and sources." onClose={onClose} busy={save.pending}
      footer={<><Button variant="quiet" onClick={onClose} disabled={save.pending}>Cancel</Button><Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void submit(base)}>Save trip</Button></>}>
      {conflict && (
        <ConflictNotice
          fields={[{ label: "Name", mine: form.title, current: conflict.title }, { label: "Dates", mine: form.start ? `${form.start} to ${form.end}` : "Not set", current: conflict.dateLabel }, { label: "Notes", mine: form.notes || "Not provided", current: conflict.notes ?? "Not provided" }]}
          busy={save.pending}
          onKeepMine={() => { const revision = conflict.revision; setBase(revision); setConflict(null); return submit(revision); }}
          onUseCurrent={() => { setForm(formOf(conflict)); setBase(conflict.revision); setConflict(null); }}
        />
      )}
      <TextInput label="Trip name" value={form.title} onChange={(title) => setForm({ ...form, title })} required maxLength={200} />
      <div className="ri-form-grid">
        <DateInput label="First day" value={form.start} onChange={(start) => setForm({ ...form, start })} />
        <DateInput label="Last day" value={form.end} onChange={(end) => setForm({ ...form, end })} />
      </div>
      <TextInput label="Home time zone" hint="Used for today and for checking your calendar, such as America/Denver" value={form.zone} onChange={(zone) => setForm({ ...form, zone })} />
      <TextInput label="Travelers" hint="Names as they appear on bookings, separated by commas" value={form.travelers} onChange={(travelers) => setForm({ ...form, travelers })} />
      <TextArea label="Notes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} maxLength={4000} />
      <Checkbox label="Archive this trip" hint="Archived trips leave the main list. Their records stay." checked={form.archived} onChange={(archived) => setForm({ ...form, archived })} />
      <InlineError>{problem ?? cleanError(save.error)}</InlineError>
    </Dialog>
  );
}
function formOf(trip: Trip) {
  return { title: trip.title, start: trip.startDate, end: trip.endDate, zone: trip.homeZone ?? "", travelers: trip.travelers.join(", "), notes: trip.notes ?? "", archived: trip.state === "archived" };
}
export function validZone(zone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return /\//.test(zone) || zone === "UTC"; } catch { return false; }
}

function BookingsTab({ detail, route, update }: { detail: TripDetail; route: TripRoute; update(patch: Partial<TripRoute>): void }) {
  const [search, setSearch] = useState(route.q);
  useEffect(() => { const timer = setTimeout(() => { if (search !== route.q) update({ q: search }); }, 300); return () => clearTimeout(timer); }, [search]);
  const query = search.trim().toLowerCase();
  const rows = useMemo(() => detail.bookings.filter((booking) => {
    if (route.status === "needs_review" ? !booking.openReviewIds.length : route.status !== "all" && booking.status !== route.status) return false;
    if (!query) return true;
    return [booking.title, booking.provider, booking.reference, booking.kindLabel, ...booking.travelers].filter(Boolean).join(" ").toLowerCase().includes(query);
  }), [detail.bookings, route.status, query]);
  const selected = route.selected ? detail.bookings.find((booking) => booking.id === route.selected) ?? null : null;
  const counts = (status: StatusFilter) => detail.bookings.filter((booking) => (status === "all" ? true : status === "needs_review" ? booking.openReviewIds.length > 0 : booking.status === status)).length;
  return (
    <SplitView
      detailOpen={Boolean(selected)}
      onBack={() => update({ selected: null })}
      backLabel="Back to bookings"
      detailLabel={selected?.title}
      detail={selected ? <BookingInspector bookingId={selected.id} tripTitle={detail.trip.title} onClose={() => update({ selected: null })} /> : null}
      list={
        <div className="ri-stack">
          <Toolbar end={<SearchField label="Find a booking" placeholder="Name, reference, traveler" value={search} onChange={setSearch} />}>
            <SegmentedControl
              label="Booking status"
              value={route.status}
              onChange={(id) => update({ status: id as StatusFilter, selected: null })}
              options={(["all", "confirmed", "planned", "canceled", "needs_review"] as const).map((id) => ({ id, label: `${{ all: "All", confirmed: "Confirmed", planned: "Planned", canceled: "Canceled", needs_review: "Needs review" }[id]} ${counts(id)}` }))}
            />
          </Toolbar>
          <DataTable<Booking>
            caption="Recorded bookings"
            captionHidden
            rows={rows}
            rowKey="id"
            selectedKey={route.selected}
            onSelect={(key) => update({ selected: key })}
            rowLabel={(row) => `${row.title}, ${row.statusLabel}, ${row.dateLabel}`}
            empty={<EmptyState compact headingLevel={3} title="No bookings match" action={<Button size="sm" onClick={() => { setSearch(""); update({ status: "all", q: "" }); }}>Clear filters</Button>}>Try another status or search.</EmptyState>}
            columns={[
              { key: "title", label: "Booking", render: (row) => <span className="ri-stack ri-stack--tight" style={{ gap: 0 }}><span>{row.title}</span><span className="ri-small ri-muted">{row.kindLabel}{row.provider && row.provider !== row.title ? `, ${row.provider}` : ""}</span></span> },
              { key: "dateLabel", label: "Dates" },
              { key: "travelers", label: "Traveler", render: (row) => row.travelers.join(", ") || "Not provided" },
              { key: "status", label: "Status", render: (row) => <span className="tr-inline"><StatusLabel tone={STATUS_TONES[row.status]}>{row.statusLabel}</StatusLabel>{row.openReviewIds.length > 0 && <StatusLabel tone="warning">Needs review</StatusLabel>}</span> },
              { key: "source", label: "Source", render: (row) => (row.sources.length ? `${row.coverage.unavailable ? "Source unavailable, " : ""}${row.sources.length > 1 ? plural(row.sources.length, "source", "sources") : row.sources[0].origin === "paste" ? "Pasted" : row.sources[0].origin === "file" ? "Uploaded file" : "Confirmation email"}` : "Entered by you") },
              { key: "reference", label: "Reference", hideInCards: true },
            ]}
          />
        </div>
      }
    />
  );
}
