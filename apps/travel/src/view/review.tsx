/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Review: unassigned reservations, changes and cancellations to confirm,
 * possible duplicates and extracted details to check. Each item compares the
 * recorded and proposed values with its source before anything changes.
 */
import { useState } from "react";
import { AppShell, AskRiButton, Button, ButtonRow, EmptyState, ErrorState, InlineError, LoadingState, RadioGroup, ReviewCompare, SectionPanel, Select, SourceLine, StatusLabel, TextInput, useAnnounce, useMutation, useQuery } from "@ri/app-kit/ui";
import { MainTabs, useNav } from "./app.js";
import { BookingFields, draftFromForm, formFromDraft } from "./forms.js";
import { SourceDialog } from "./inspector.js";
import type { List, ReviewItem, ReviewWrite, SourceRef, Trip } from "./types.js";
import { errorText, plural, cleanError } from "./util.js";

export function ReviewScreen() {
  const { route, navigate, data } = useNav();
  const tripId = route.section === "review" ? route.tripId : null;
  const items = useQuery<List<ReviewItem>>("list_review_items", { limit: 100, state: "open", ...(tripId ? { tripId } : {}) });
  const trips = useQuery<List<Trip>>("list_trips", { limit: 100, when: "all" });
  const [source, setSource] = useState<SourceRef | null>(null);
  const tripTitle = tripId ? trips.data?.items.find((trip) => trip.id === tripId)?.title : null;
  const count = items.data?.items.length ?? 0;
  return (
    <AppShell
      eyebrow="Travel"
      title="Review"
      context={items.data ? (count ? `${plural(count, "item", "items")} to decide${tripTitle ? ` for ${tripTitle}` : ""}` : "Nothing waiting") : "Loading"}
      secondaryActions={tripId ? <Button variant="quiet" onClick={() => navigate({ section: "trip", tripId, tab: "itinerary", day: null, selected: null, status: "all", q: "" })}>Back to {tripTitle ?? "trip"}</Button> : undefined}
      tabs={<MainTabs value="review" />}
    >
      <SectionPanel panelId="travel-main" value="review">
        {tripId && <p className="ri-small ri-muted" style={{ marginBottom: "1rem" }}>Showing items for {tripTitle ?? "one trip"}. <Button variant="link" size="sm" onClick={() => navigate({ section: "review", tripId: null })}>Show all</Button></p>}
        {items.error && !items.data ? <ErrorState message={cleanError(items.error)} onRetry={() => void items.reload()} /> : !items.data ? <LoadingState label="Loading review" /> : !count ? (
          <EmptyState title="You are up to date" action={<Button onClick={() => navigate({ section: "trips" })}>Open trips</Button>}>
            New changes, cancellations and bookings that need a trip will appear here before anything changes.
          </EmptyState>
        ) : (
          <div className="tr-review-list">
            {items.data.items.map((item) => <ReviewCard key={item.id} item={item} trips={trips.data?.items ?? []} owner={data.owner} onSource={setSource} />)}
          </div>
        )}
      </SectionPanel>
      <SourceDialog source={source} onClose={() => setSource(null)} />
    </AppShell>
  );
}

function Evidence({ item, onSource }: { item: ReviewItem; onSource(ref: SourceRef): void }) {
  return (
    <div className="ri-stack ri-stack--tight">
      {item.evidence.map((ref) => <SourceLine key={ref.evidenceId} label={ref.sourceLabel} observedAt={ref.receivedAt ?? ref.observedAt} availability={ref.availability} onOpen={() => onSource(ref)} />)}
      {item.passages.length > 0 && (
        <details>
          <summary className="ri-small">Source passages</summary>
          <blockquote className="tr-quotes">{item.passages.map((passage) => <q key={passage}>{passage}</q>)}</blockquote>
        </details>
      )}
    </div>
  );
}

function ReviewCard({ item, trips, owner, onSource }: { item: ReviewItem; trips: Trip[]; owner: boolean; onSource(ref: SourceRef): void }) {
  const decide = useMutation<Record<string, unknown>, ReviewWrite>("review_change");
  const announce = useAnnounce();
  const { navigate } = useNav();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const run = async (decision: string, extra: Record<string, unknown> = {}, which: "accept" | "dismiss" = "accept") => {
    setProblem(null);
    setBusy(which);
    try {
      const result = await decide.run({ id: item.id, expectedRevision: item.revision, decision, ...extra });
      if (result.status === "conflict") { setProblem(`${result.message} The list has been refreshed.`); return; }
      announce(result.message);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(null);
    }
  };
  if (!owner) return <article className="ri-card ri-review"><h3 className="ri-h3">{item.headline}</h3><p className="ri-review__reason">{item.reason}</p><p className="ri-small ri-muted">Only the owner can decide review items.</p></article>;

  if (item.kind === "change" || (item.kind === "cancellation" && item.bookingId)) {
    const conflict = item.correctionConflict;
    return (
      <div className="ri-stack ri-stack--tight">
        <ReviewCompare
          title={item.headline}
          reason={item.reason}
          rows={item.comparison.map((row) => ({ label: row.label, before: row.current, after: row.proposed }))}
          beforeLabel={conflict ? "Your saved value" : "Recorded"}
          afterLabel={item.kind === "cancellation" ? "Message says" : "New confirmation"}
          acceptLabel={item.kind === "cancellation" ? "Mark canceled" : conflict && item.comparison.length === 1 ? `Use ${item.comparison[0].proposed}` : "Use the new details"}
          busy={busy}
          evidence={<Evidence item={item} onSource={onSource} />}
          onAccept={() => run("accept")}
          onDismiss={() => run("keep", {}, "dismiss")}
          onEdit={item.bookingId && item.tripId ? () => navigate({ section: "trip", tripId: item.tripId!, tab: "itinerary", day: null, selected: item.bookingId, status: "all", q: "" }) : undefined}
        />
        <div className="tr-list-row">
          <p className="ri-small ri-muted">{item.kind === "cancellation" ? "Dismiss keeps the booking active and the message in its history." : "Dismiss keeps your current value. The newer source stays in the booking's history."}</p>
          <AskRiButton size="sm" variant="link" prompt={`Help me decide about this ${item.kind === "cancellation" ? "cancellation" : "change"} to ${item.bookingTitle ?? "a booking"}: ${item.comparison.map((row) => `${row.label.toLowerCase()} is ${row.current} now and ${row.proposed} in the newer message`).join(", ")}.`}>Ask Ri about this</AskRiButton>
        </div>
        <InlineError>{problem}</InlineError>
      </div>
    );
  }
  return (
    <article className="ri-card ri-review" aria-label={item.headline}>
      <div className="ri-review__head">
        <div>
          <h3 className="ri-h3">{item.headline}</h3>
          <p className="ri-review__reason">{item.reason}</p>
        </div>
        <StatusLabel tone="warning">{item.kindLabel}</StatusLabel>
      </div>
      {item.kind === "assign" && <AssignChoice item={item} trips={trips} busy={decide.pending} onDecide={run} />}
      {item.kind === "identity" && <IdentityChoice item={item} busy={decide.pending} onDecide={run} />}
      {(item.kind === "extraction" || item.kind === "unreadable") && <ExtractionChoice item={item} trips={trips} busy={decide.pending} onDecide={run} />}
      {item.kind === "cancellation" && !item.bookingId && (
        <ButtonRow>
          {item.candidates.length > 0 && item.candidates.map((candidate) => <Button key={candidate.id} onClick={() => void run("link", { bookingId: candidate.id })}>Cancel {candidate.title}</Button>)}
          <Button variant="primary" busy={busy === "dismiss"} onClick={() => void run("dismiss", {}, "dismiss")}>Nothing to change</Button>
        </ButtonRow>
      )}
      <Evidence item={item} onSource={onSource} />
      <InlineError>{problem}</InlineError>
    </article>
  );
}

function AssignChoice({ item, trips, busy, onDecide }: { item: ReviewItem; trips: Trip[]; busy: boolean; onDecide(decision: string, extra?: Record<string, unknown>, which?: "accept" | "dismiss"): Promise<void> }) {
  const options = [...item.candidates.filter((candidate) => candidate.type === "trip").map((candidate) => ({ value: candidate.id, label: `${candidate.title}, ${candidate.detail}` })), ...trips.filter((trip) => trip.projection === "full" && !item.candidates.some((candidate) => candidate.id === trip.id)).map((trip) => ({ value: trip.id, label: `${trip.title}, ${trip.dateLabel}` }))];
  const [trip, setTrip] = useState(options[0]?.value ?? "");
  const [title, setTitle] = useState("");
  return (
    <div className="ri-stack">
      {item.bookingTitle && <p className="ri-small">Booking: <strong>{item.bookingTitle}</strong></p>}
      {options.length > 0 && (
        <div className="tr-inline">
          <Select label="Add to trip" value={trip} onChange={setTrip} options={options} />
          <Button variant="primary" busy={busy} onClick={() => void onDecide("assign", { tripId: trip })}>Add to trip</Button>
        </div>
      )}
      <div className="tr-inline">
        <TextInput label="Or start a new trip" hint="Optional name" value={title} onChange={setTitle} maxLength={200} />
        <Button busy={busy} onClick={() => void onDecide("new_trip", title.trim() ? { newTripTitle: title.trim() } : {})}>Start new trip</Button>
      </div>
      <ButtonRow><Button variant="quiet" onClick={() => void onDecide("dismiss", {}, "dismiss")}>Leave unassigned</Button></ButtonRow>
    </div>
  );
}

function IdentityChoice({ item, busy, onDecide }: { item: ReviewItem; busy: boolean; onDecide(decision: string, extra?: Record<string, unknown>, which?: "accept" | "dismiss"): Promise<void> }) {
  const [choice, setChoice] = useState(item.candidates[0]?.id ?? "");
  return (
    <div className="ri-stack">
      <RadioGroup label="Which booking does this message describe?" value={choice} onChange={setChoice} options={item.candidates.map((candidate) => ({ value: candidate.id, label: candidate.title, hint: candidate.detail }))} />
      <ButtonRow>
        <Button variant="primary" busy={busy} disabled={!choice} onClick={() => void onDecide("link", { bookingId: choice })}>Apply to this booking</Button>
        <Button onClick={() => void onDecide("separate")}>Keep as a separate booking</Button>
        <Button variant="quiet" onClick={() => void onDecide("dismiss", {}, "dismiss")}>Dismiss</Button>
      </ButtonRow>
      <AskRiButton size="sm" variant="link" prompt={`Help me decide which booking this message belongs to: ${item.reason}`}>Ask Ri to help decide</AskRiButton>
    </div>
  );
}

function ExtractionChoice({ item, trips, busy, onDecide }: { item: ReviewItem; trips: Trip[]; busy: boolean; onDecide(decision: string, extra?: Record<string, unknown>, which?: "accept" | "dismiss"): Promise<void> }) {
  // The form keeps what is typed even when the list refreshes underneath it.
  const [form, setForm] = useState(() => formFromDraft(item.draft, item.prefill));
  const [trip, setTrip] = useState("auto");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    const check = draftFromForm(form);
    if (check.problem) return setProblem(check.problem);
    setProblem(null);
    await onDecide("accept", { draft: check.draft, ...(trip === "auto" ? {} : { tripId: trip }) });
  };
  return (
    <div className="ri-stack">
      {item.missing.length > 0 && <p className="ri-small ri-muted">Not found in the source: {item.missing.map((field) => field.replace(/^segments\.\d+\./, "").replace(/^stay\./, "")).join(", ")}.</p>}
      <BookingFields form={form} onChange={setForm} />
      <Select label="Trip" value={trip} onChange={setTrip} options={[{ value: "auto", label: "Choose automatically" }, ...trips.filter((item) => item.projection === "full").map((item) => ({ value: item.id, label: `${item.title}, ${item.dateLabel}` }))]} />
      <ButtonRow>
        <Button variant="primary" busy={busy} onClick={() => void submit()}>Add booking</Button>
        <Button variant="quiet" onClick={() => void onDecide("dismiss", {}, "dismiss")}>Dismiss</Button>
      </ButtonRow>
      <InlineError>{problem}</InlineError>
    </div>
  );
}
