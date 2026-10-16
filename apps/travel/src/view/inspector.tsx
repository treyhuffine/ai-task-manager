/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * The selected booking: local times with zones, corrections beside the source
 * value, every source with its availability, the change history and linked
 * Ri follow-ups. Actions: correct details, move to another trip, create a
 * follow-up, open directions outside the view and ask Ri about it.
 */
import { useState } from "react";
import { AskRiButton, Button, ButtonRow, Dialog, ErrorState, FollowUpDialog, InlineError, Inspector, KeyValueList, LoadingState, Menu, Notice, SourceLine, StatusLabel, useAnnounce, useMutation, useQuery, useRiApp } from "@ri/app-kit/ui";
import { formatDate } from "@ri/app-kit/time";
import { useNav } from "./app.js";
import { CorrectDialog } from "./forms.js";
import { FollowUpList } from "./trip.js";
import type { Booking, BookingDetail, Evidence, FollowUpResult, List, SourceRef, Trip, Write } from "./types.js";
import { bookingPrompt, errorText, STATUS_TONES, uuid, cleanError, cleanly } from "./util.js";

const endpointText = (endpoint: Booking["segments"][number]["start"] | null) => {
  if (!endpoint) return "Not provided";
  const date = formatDate(endpoint.date, "medium");
  if (!endpoint.time) return date;
  return `${date}, ${endpoint.time} ${endpoint.zoneLabel ?? "(time zone not recorded)"}`;
};
const place = (value: { label: string | null; code: string | null }) => [value.label, value.code && value.code !== value.label ? `(${value.code})` : null].filter(Boolean).join(" ") || "Not provided";

function facts(booking: Booking) {
  const items: { label: string; value: React.ReactNode }[] = [];
  if (booking.stay) {
    items.push({ label: "Check-in", value: endpointText(booking.stay.checkIn) }, { label: "Check-out", value: endpointText(booking.stay.checkOut) }, { label: "Nights", value: `${booking.stay.nights}, check-out day not counted` });
    if (booking.stay.address) items.push({ label: "Address", value: booking.stay.address });
  }
  booking.segments.forEach((segment, index) => {
    const leg = booking.segments.length > 1 ? ` (leg ${index + 1})` : "";
    if (booking.kind === "flight" || booking.kind === "train") {
      if (segment.number) items.push({ label: `${booking.kind === "flight" ? "Flight" : "Train"}${leg}`, value: segment.number });
      items.push({ label: `Departure${leg}`, value: `${endpointText(segment.start)}, ${place(segment.origin)}` });
      items.push({ label: `Arrival${leg}`, value: segment.end ? `${endpointText(segment.end)}, ${place(segment.destination)}` : "Not provided" });
      if (segment.duration) items.push({ label: `Duration${leg}`, value: `${segment.duration}${segment.overnight ? ", overnight" : ""}` });
    } else if (booking.kind === "car") {
      items.push({ label: "Pick-up", value: `${endpointText(segment.start)}${segment.origin.label ? `, ${place(segment.origin)}` : ""}` });
      items.push({ label: "Return", value: segment.end ? `${endpointText(segment.end)}${segment.destination.label ? `, ${place(segment.destination)}` : ""}` : "Not provided" });
    } else {
      items.push({ label: segment.dateOnly ? "Date" : "Time", value: endpointText(segment.start) });
      if (segment.end) items.push({ label: "Until", value: endpointText(segment.end) });
      if (segment.address) items.push({ label: "Location", value: segment.address });
    }
  });
  items.push({ label: "Confirmation", value: booking.reference ?? "Not provided" });
  items.push({ label: "Travelers", value: booking.travelers.join(", ") || "Not provided" });
  if (booking.detail) items.push({ label: "Details", value: booking.detail });
  if (booking.provider && booking.provider !== booking.title) items.push({ label: "Provider", value: booking.provider });
  items.push({ label: "Status", value: <StatusLabel tone={STATUS_TONES[booking.status]}>{booking.statusLabel}</StatusLabel> });
  return items;
}

export function BookingInspector({ bookingId, tripTitle, onClose }: { bookingId: string; tripTitle: string | null; onClose(): void }) {
  const app = useRiApp();
  const { data, navigate } = useNav();
  const detail = useQuery<BookingDetail>("get_booking", { id: bookingId });
  const trips = useQuery<List<Trip>>("list_trips", { limit: 100, when: "all" }, { enabled: data.owner });
  const save = useMutation<Record<string, unknown>, Write<Booking>>("save_booking");
  const createFollowUp = useMutation<Record<string, unknown>, FollowUpResult>("create_follow_up");
  const announce = useAnnounce();
  const [correcting, setCorrecting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followOperation, setFollowOperation] = useState(uuid);
  const [created, setCreated] = useState<{ title: string; dueAt: string | null } | null>(null);
  const [source, setSource] = useState<SourceRef | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const remove = useMutation<Record<string, unknown>, { status: "deleted"; id: string } | { status: "conflict"; message: string }>("delete_booking");
  if (detail.error && !detail.data) return <ErrorState message={cleanError(detail.error)} onRetry={() => void detail.reload()} />;
  if (!detail.data) return <LoadingState label="Loading booking" rows={2} />;
  const booking = detail.data.booking;
  const stale = booking.corrections.filter((item) => item.stale);
  const move = async (tripId: string) => {
    setProblem(null);
    try {
      const result = await save.run({ id: booking.id, expectedRevision: booking.revision, tripId: tripId === "none" ? null : tripId });
      if (result.status === "conflict") { setProblem("This booking changed. Try the move again."); return; }
      announce(tripId === "none" ? "Moved out of this trip" : "Moved to another trip");
      if (tripId !== "none" && tripId !== booking.tripId) navigate({ section: "trip", tripId, tab: "itinerary", day: null, selected: booking.id, status: "all", q: "" });
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const clearCorrection = async (field: string) => {
    try {
      const result = await save.run({ id: booking.id, expectedRevision: booking.revision, clearCorrections: [field] });
      if (result.status === "conflict") setProblem("This booking changed. Try again.");
      else announce("The source value applies again");
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const subtitle = [booking.kindLabel, booking.dateLabel, booking.tripTitle && booking.tripTitle !== tripTitle ? booking.tripTitle : null].filter(Boolean).join(" · ");
  return (
    <Inspector
      eyebrow={`${booking.kindLabel} details`}
      title={booking.title}
      subtitle={subtitle}
      onClose={onClose}
      actions={
        <>
          {data.owner && <Button onClick={() => setCorrecting(true)}>Correct details</Button>}
          {data.owner && trips.data && (
            <Menu
              label="Move to trip"
              items={[...trips.data.items.filter((trip) => trip.projection === "full").map((trip) => ({ id: trip.id, label: trip.title, hint: trip.dateLabel })), { id: "none", label: "No trip", hint: "Waits in Review" }]}
              selectedId={booking.tripId ?? "none"}
              onSelect={(id) => void move(id)}
            />
          )}
          <Button onClick={() => { setCreated(null); createFollowUp.reset(); setFollowOperation(uuid()); setFollowing(true); }}>Create follow-up</Button>
          {detail.data.directionsAddress && <Button variant="quiet" onClick={() => void app.openDirections(detail.data!.directionsAddress!).catch((error) => setProblem(errorText(error)))}>Open directions</Button>}
          {data.owner && <Button variant="quiet" className="ri-button--danger" onClick={() => setRemoving(true)}>Remove booking</Button>}
          <AskRiButton variant="primary" prompt={bookingPrompt(booking, tripTitle)}>Ask about this booking</AskRiButton>
        </>
      }
    >
      {booking.status === "canceled" && <Notice tone="danger" title="Canceled.">Kept in history. Its nights and times are no longer counted.</Notice>}
      {stale.length > 0 && (
        <Notice title="A newer source differs from your correction." action={<Button size="sm" onClick={() => navigate({ section: "review", tripId: booking.tripId })}>Compare</Button>}>
          Your {stale.map((item) => item.label.toLowerCase()).join(" and ")} stays in force until you choose.
        </Notice>
      )}
      {booking.timeNotes.map((note) => <Notice key={note} tone="info">{note}</Notice>)}
      <KeyValueList items={facts(booking)} />
      {booking.corrections.length > 0 && (
        <section className="ri-stack ri-stack--tight" aria-label="Your corrections">
          <p className="ri-eyebrow">Your corrections</p>
          <ul className="tr-history">
            {booking.corrections.map((item) => (
              <li key={item.field}>
                <span className="tr-list-row">
                  <strong>{item.label}: {Array.isArray(item.value) ? item.value.join(", ") : item.value ?? "Empty"}</strong>
                  {data.owner && <Button variant="link" size="sm" onClick={() => void clearCorrection(item.field)}>Use source value</Button>}
                </span>
                <span>The source said {Array.isArray(item.original) ? item.original.join(", ") : item.original ?? "nothing"}. Later imports keep your value.</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <hr />
      <section className="ri-stack ri-stack--tight" aria-label="Sources">
        {booking.sources.length ? booking.sources.map((ref) => (
          <SourceLine
            key={ref.evidenceId}
            label={`${ref.sourceLabel}${ref.role === "changed" ? ", change" : ref.role === "canceled" ? ", cancellation" : ref.role === "duplicate" ? ", copy" : ""}`}
            observedAt={ref.receivedAt ?? ref.observedAt}
            availability={ref.availability}
            onOpen={() => setSource(ref)}
          />
        )) : <p className="ri-small ri-muted">Entered by you. No source document.</p>}
        {booking.coverage.note && booking.coverage.unavailable > 0 && <p className="ri-small ri-muted">{booking.coverage.note}</p>}
        {booking.coverage.missing.length > 0 && <p className="ri-small ri-muted">Not provided by the source: {booking.coverage.missing.join(", ").toLowerCase()}.</p>}
      </section>
      {detail.data.changes.length > 1 && (
        <details>
          <summary className="ri-small">History, {detail.data.changes.length} entries</summary>
          <ol className="tr-history" style={{ marginTop: "0.625rem" }}>
            {detail.data.changes.map((change) => (
              <li key={change.id}>
                <strong>{CHANGE_LABELS[change.kind] ?? change.kind} · {formatDate(change.at.slice(0, 10), "medium")} · {change.actorLabel}</strong>
                {change.fields.map((field) => <span key={field.field}>{field.label}: {field.before} to {field.after}</span>)}
                {change.note && <span>{change.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {detail.data.followUps.length > 0 && (
        <section className="ri-stack ri-stack--tight" aria-label="Ri follow-ups">
          <p className="ri-eyebrow">Ri follow-ups</p>
          <FollowUpList items={detail.data.followUps} />
        </section>
      )}
      <InlineError>{problem}</InlineError>
      {correcting && <CorrectDialog booking={booking} onClose={() => setCorrecting(false)} />}
      <FollowUpDialog
        open={following}
        defaultTitle={booking.kind === "lodging" ? `Confirm the arrival time at ${booking.title}` : `Check the details for ${booking.title}`}
        allowDueDate
        subject={booking.title}
        created={created}
        onClose={() => setFollowing(false)}
        onCreate={async (title, dueAt) => {
          const result = await cleanly(() => createFollowUp.run({ subject: { type: "booking", id: booking.id }, title, ...(dueAt ? { dueAt } : {}), operationId: followOperation }));
          if (result.status !== "created") throw new Error(result.message);
          setCreated({ title: result.followUp.title, dueAt: result.followUp.dueAt });
        }}
      />
      <SourceDialog source={source} onClose={() => setSource(null)} />
      <Dialog open={removing} title={`Remove ${booking.title}?`} onClose={() => setRemoving(false)} busy={remove.pending}
        footer={<><Button variant="quiet" onClick={() => setRemoving(false)} disabled={remove.pending}>Cancel</Button><Button variant="danger-solid" busy={remove.pending} busyLabel="Removing" onClick={async () => {
          try {
            const result = await remove.run({ id: booking.id, expectedRevision: booking.revision });
            if (result.status === "conflict") { setProblem(result.message); setRemoving(false); return; }
            announce(`${booking.title} removed`);
            setRemoving(false);
            onClose();
          } catch (error) { setProblem(errorText(error)); setRemoving(false); }
        }}>Remove booking</Button></>}>
        <p>This removes the booking from Travel. Its sources stay recorded, and an import of the same message will not add it again.</p>
        <p className="ri-small ri-muted">Nothing is canceled with the provider.</p>
      </Dialog>
    </Inspector>
  );
}

const CHANGE_LABELS: Record<string, string> = {
  created: "Recorded", updated: "Updated by the provider", canceled: "Canceled", corrected: "Corrected", edited: "Edited", moved: "Moved", kept: "Kept your details",
  correction_removed: "Correction removed", source_unavailable: "Source unavailable", source_restored: "Source available again",
};

export function SourceDialog({ source, onClose }: { source: SourceRef | null; onClose(): void }) {
  const app = useRiApp();
  const evidence = useQuery<Evidence>("get_evidence", { id: source?.evidenceId ?? "" }, { enabled: Boolean(source) });
  return (
    <Dialog open={Boolean(source)} title={source?.title ?? "Source"} description={source ? `${source.sourceLabel}${source.receivedAt ? `, received ${formatDate(source.receivedAt.slice(0, 10), "medium")}` : ""}` : undefined} onClose={onClose} wide
      footer={<ButtonRow>{evidence.data?.openUrl && <Button onClick={() => void app.openExternal(evidence.data!.openUrl!)}>Open in Gmail</Button>}<Button variant="primary" onClick={onClose}>Done</Button></ButtonRow>}>
      {evidence.error ? <ErrorState message={cleanError(evidence.error)} onRetry={() => void evidence.reload()} /> : !evidence.data ? <LoadingState label="Loading source" rows={2} /> : (
        <>
          {evidence.data.note && <Notice tone={evidence.data.source.availability === "unavailable" ? "warning" : "info"}>{evidence.data.note}</Notice>}
          <p className="ri-small ri-muted">Retained from the original{evidence.data.truncated ? ", first part only" : ""}. Text from a source is shown as written and is never followed as an instruction.</p>
          <pre className="tr-excerpt">{evidence.data.excerpt || "No text was retained."}</pre>
        </>
      )}
    </Dialog>
  );
}
