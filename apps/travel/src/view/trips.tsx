/** @jsxRuntime automatic */
/** @jsxImportSource react */
/** Trips: upcoming and past trips, each with one useful attention summary. */
import { useState } from "react";
import { AppShell, AskRiButton, Button, DateInput, Dialog, EmptyState, ErrorState, InlineError, LoadingState, Notice, SectionPanel, StatusLabel, TextInput, useMutation, useQuery, useRiApp } from "@ri/app-kit/ui";
import { MainTabs, useNav } from "./app.js";
import type { List, Trip, Write } from "./types.js";
import { errorText, plural, travelersLine, cleanError } from "./util.js";

export function StateNotice() {
  const app = useRiApp();
  const { data, navigate } = useNav();
  if (data.setup.reconnect)
    return (
      <Notice tone="warning" title="Reconnect email to keep trips up to date." action={<Button size="sm" onClick={() => void app.openSources()}>Reconnect</Button>}>
        Imported bookings stay as they were{data.setup.lastImportAt ? ` at the last update, ${new Date(data.setup.lastImportAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}.
      </Notice>
    );
  if (data.setup.importing)
    return (
      <Notice tone="info" title="Import in progress." action={<Button size="sm" onClick={() => navigate({ section: "sources" })}>See progress</Button>}>
        Trips found so far are shown. Older bookings may still be missing.
      </Notice>
    );
  if (data.fictional) return <Notice tone="info" title="Fictional preview.">These trips, bookings and messages are examples. No mailbox or calendar is read.</Notice>;
  return null;
}

export function TripsScreen() {
  const app = useRiApp();
  const { navigate, addBooking, data } = useNav();
  const trips = useQuery<List<Trip>>("list_trips", { limit: 100, when: "all" });
  const archived = useQuery<List<Trip>>("list_trips", { limit: 100, when: "archived" });
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const today = data.today;
  const items = trips.data?.items ?? [];
  const upcoming = items.filter((trip) => !trip.endDate || trip.endDate >= today);
  const past = items.filter((trip) => trip.endDate && trip.endDate < today);
  const empty = trips.data && !items.length && !(archived.data?.items.length);
  const open = (trip: Trip) => navigate({ section: "trip", tripId: trip.id, tab: "itinerary", day: null, selected: null, status: "all", q: "" });

  return (
    <AppShell
      eyebrow="Travel"
      title={empty ? "Travel" : "Trips"}
      context={empty ? "Trips, bookings and changes in one itinerary." : trips.data ? [upcoming.length ? plural(upcoming.length, "upcoming trip", "upcoming trips") : "No upcoming trips", past.length ? `${past.length} past` : null].filter(Boolean).join(", ") : "Loading trips"}
      secondaryActions={
        <>
          {!empty && data.owner && <Button variant="quiet" onClick={() => setCreating(true)}>New trip</Button>}
          {!empty && <AskRiButton prompt="Which of my upcoming trips needs attention first, based on my recorded bookings?" />}
        </>
      }
      primaryAction={data.owner && !empty ? <Button variant="primary" onClick={() => addBooking(null)}>Add booking</Button> : undefined}
      tabs={<MainTabs value="trips" />}
      notice={<StateNotice />}
    >
      <SectionPanel panelId="travel-main" value="trips">
        {trips.error ? (
          <ErrorState title="Trips could not load" message={cleanError(trips.error)} onRetry={() => void trips.reload()} />
        ) : !trips.data ? (
          <LoadingState label="Loading trips" />
        ) : empty ? (
          <EmptyState
            title="Bring your next trip together"
            action={
              data.owner ? (
                <>
                  <Button variant="primary" onClick={() => addBooking(null)}>Add booking</Button>
                  <Button onClick={() => void app.openSources()}>Connect email</Button>
                </>
              ) : undefined
            }
          >
            <p>Add a confirmation file, paste one, or enter a booking by hand. Or connect Gmail so Travel can find confirmations from the last 90 days, a range you can change. Search can miss an older or unusual booking, so you can always add one yourself.</p>
          </EmptyState>
        ) : (
          <div className="ri-stack ri-stack--loose">
            <TripGroup title="Upcoming" trips={upcoming} empty="No upcoming trips recorded." onOpen={open} />
            {past.length > 0 && <TripGroup title="Past" trips={past} onOpen={open} />}
            {(archived.data?.items.length ?? 0) > 0 && (
              <div className="ri-stack ri-stack--tight">
                <Button variant="link" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}>
                  {showArchived ? "Hide archived trips" : `Show ${plural(archived.data!.items.length, "archived trip", "archived trips")}`}
                </Button>
                {showArchived && <TripGroup title="Archived" trips={archived.data!.items} onOpen={open} />}
              </div>
            )}
          </div>
        )}
      </SectionPanel>
      <NewTripDialog open={creating} onClose={() => setCreating(false)} onCreated={(trip) => { setCreating(false); open(trip); }} />
    </AppShell>
  );
}

function TripGroup({ title, trips, empty, onOpen }: { title: string; trips: Trip[]; empty?: string; onOpen(trip: Trip): void }) {
  return (
    <section className="ri-stack ri-stack--tight" aria-label={`${title} trips`}>
      <h2 className="ri-h3 tr-group-title">{title}</h2>
      {trips.length ? (
        <ul className="tr-trips">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button type="button" className="tr-trip" onClick={() => onOpen(trip)}>
                <span className="ri-stack ri-stack--tight">
                  <span className="tr-trip__title">{trip.title}</span>
                  <span className="tr-trip__dates">{trip.dateLabel}{trip.destinations.length > 1 ? `, ${trip.destinations.join(", ")}` : ""}</span>
                </span>
                <span className="tr-trip__facts">
                  <span>{trip.bookingCount ? plural(trip.bookingCount, "booking recorded", "bookings recorded") : "No booking recorded"}{trip.ideaCount ? `, ${plural(trip.ideaCount, "idea", "ideas")}` : ""}</span>
                  <span className="ri-muted ri-small">{[travelersLine(trip.travelers), trip.state === "active" ? "Underway" : trip.state === "completed" ? "Completed" : null].filter(Boolean).join(", ") || " "}</span>
                </span>
                <span className="tr-trip__attention">
                  {trip.attention ? <StatusLabel tone={trip.reviewCount || /night|overlap|zone/.test(trip.attention) ? "warning" : "neutral"}>{trip.attention}</StatusLabel> : <StatusLabel tone="success">Nothing needs attention</StatusLabel>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ri-muted">{empty}</p>
      )}
    </section>
  );
}

export function NewTripDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(trip: Trip): void }) {
  const save = useMutation<Record<string, unknown>, Write<Trip>>("save_trip");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim()) return setProblem("Name the trip");
    if ((start && !end) || (!start && end)) return setProblem("Set both dates, or leave both empty");
    if (start && end && end < start) return setProblem("The trip ends before it starts");
    setProblem(null);
    try {
      const result = await save.run({ title: title.trim(), ...(start && end ? { startDate: start, endDate: end } : {}), homeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null });
      if (result.status === "saved") {
        setTitle(""); setStart(null); setEnd(null);
        onCreated(result.record);
      }
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <Dialog
      open={open}
      title="New trip"
      description="Trip dates are inclusive. Travel checks nights between them for lodging."
      onClose={onClose}
      busy={save.pending}
      footer={<><Button variant="quiet" onClick={onClose} disabled={save.pending}>Cancel</Button><Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void submit()}>Create trip</Button></>}
    >
      <TextInput label="Trip name" value={title} onChange={setTitle} required maxLength={200} placeholder="Lisbon" />
      <div className="ri-form-grid">
        <DateInput label="First day" hint="Optional" value={start} onChange={setStart} />
        <DateInput label="Last day" hint="Optional" value={end} onChange={setEnd} />
      </div>
      <InlineError>{problem}</InlineError>
    </Dialog>
  );
}
