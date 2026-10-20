/**
 * A living reference of the UI kit: Travel, Job Search and People screens
 * plus every state and form control, filled with fictional records. It runs
 * on an in-memory client, so it needs no host. The kit's browser test renders
 * it at several widths and themes. Apps can render it in development to check
 * their own styles beside the kit.
 */
import { useMemo, useState, type ReactNode } from "react";
import { createMemoryClient, RiAppProvider, useRiApp, type MemoryClient } from "./app.js";
import { useAnnounce } from "./announce.js";
import { Button, ButtonRow } from "./button.js";
import { AvatarLabel, DataTable, KeyValueList, SourceLine, Timeline, Avatar, type DataTableSort } from "./data-display.js";
import { Dialog } from "./dialog.js";
import { EmptyState, ErrorState, LoadingState, Notice, StatusLabel, type Tone } from "./feedback.js";
import { Checkbox, DateInput, Field, MoneyInput, RadioGroup, Select, TextArea, TextInput, type MoneyValue } from "./forms.js";
import { formatMoney, plural } from "./format.js";
import { useQuery, useMutation } from "./hooks.js";
import { AppFrame } from "./layout.js";
import { Menu } from "./menu.js";
import { AppShell, FilterChips, SearchField, SectionPanel, SectionTabs, SegmentedControl, Toolbar } from "./navigation.js";
import { SourcesScreen, type SourceAccount, type SourceImport, type SourceShare } from "./sources-screen.js";
import { Inspector, SplitView } from "./split-view.js";
import { AskRiButton, ConflictNotice, FollowUpDialog, ReviewCompare, ShareScopeChooser } from "./workflow.js";

export type GalleryPage = "travel" | "jobs" | "people" | "states" | "forms";
export interface UiGalleryProps {
  client?: MemoryClient;
  initialPage?: GalleryPage;
  /** Open a dialog on load: the follow-up preview or the correction form. */
  initialDialog?: "followup" | "correct" | null;
  /** Start with a record open. Defaults to true. */
  detailOpen?: boolean;
  /** The first section tab on the page, such as "sources". */
  initialTab?: string;
}

const ZONE = "Europe/Lisbon";
const NOW = new Date("2026-10-15T09:20:00Z");

interface Booking { id: string; title: string; kind: string; provider: string; dates: string; day: string; time: string; status: "Confirmed" | "Planned" | "Canceled" | "Needs review"; source: string; observed: string; reference: string; facts: [string, string][]; address: string }
const BOOKINGS: Booking[] = [
  { id: "flight", title: "Arrive in Lisbon", kind: "Flight", provider: "Flight RA 204", dates: "Nov 9 to 10", day: "2026-11-10", time: "08:40", status: "Confirmed", source: "flight confirmation email", observed: "2026-10-12", reference: "RA-7416", facts: [["Departure", "Nov 9, 17:55 MST, Denver"], ["Arrival", "Nov 10, 08:40 WET, Lisbon"], ["Confirmation", "RA-7416"]], address: "Lisbon Airport, Portugal" },
  { id: "hotel", title: "Riverside House", kind: "Stay", provider: "Check in, 4 nights", dates: "Nov 10 to 14", day: "2026-11-10", time: "15:00", status: "Confirmed", source: "hotel confirmation email", observed: "2026-10-14", reference: "RH-4821", facts: [["Check-in", "Nov 10, 15:00 WET"], ["Check-out", "Nov 14, 11:00 WET"], ["Confirmation", "RH-4821"]], address: "Rua da Prata 80, Lisbon" },
  { id: "dinner", title: "Dinner at Mesa", kind: "Reservation", provider: "Table for one", dates: "Nov 10", day: "2026-11-10", time: "19:00", status: "Confirmed", source: "restaurant confirmation email", observed: "2026-10-14", reference: "MS-1834", facts: [["Time", "Nov 10, 19:00 WET"], ["Party", "One person"], ["Confirmation", "MS-1834"]], address: "Rua dos Fanqueiros 12, Lisbon" },
  { id: "train", title: "Train to Sintra", kind: "Train", provider: "CP regional", dates: "Nov 12", day: "2026-11-12", time: "09:10", status: "Planned", source: "your note", observed: "2026-10-13", reference: "Not provided", facts: [["Departure", "Nov 12, 09:10 WET, Rossio"], ["Ticket", "Not booked"]], address: "Rossio Station, Lisbon" },
  { id: "transfer", title: "Airport transfer", kind: "Car", provider: "City Cars", dates: "Nov 14", day: "2026-11-14", time: "08:30", status: "Canceled", source: "cancellation email", observed: "2026-10-11", reference: "CC-2290", facts: [["Pickup", "Nov 14, 08:30 WET"], ["Status", "Canceled by provider"]], address: "Rua da Prata 80, Lisbon" },
];
// Ordinary states stay neutral. Color is kept for a cancellation or something to review.
const STATUS_TONE: Record<Booking["status"], Tone> = { Confirmed: "neutral", Planned: "neutral", Canceled: "danger", "Needs review": "warning" };
const DAYS = [["2026-11-09", "Mon 9"], ["2026-11-10", "Tue 10"], ["2026-11-11", "Wed 11"], ["2026-11-12", "Thu 12"], ["2026-11-13", "Fri 13"], ["2026-11-14", "Sat 14"]] as const;

const ACCOUNTS: SourceAccount[] = [
  { id: "gmail-personal", label: "Personal Gmail", detail: "alex@example.test", kind: "mail", granted: true, automatic: true, status: "importing", coverage: { from: "2026-07-17", to: "2026-10-15", partial: true }, historyDays: 90, lastSuccessAt: "2026-10-15T08:12:00Z", pending: 12, failed: 1 },
  { id: "gmail-work", label: "Work Gmail", detail: "alex@fieldwork.example", kind: "mail", granted: true, automatic: false, status: "reconnect", coverage: { from: "2026-09-15", to: "2026-10-09", partial: false }, historyDays: 30, lastSuccessAt: "2026-10-09T16:40:00Z", error: "Google asked you to sign in again. Records imported before October 9 are still here." },
  { id: "calendar", label: "Personal calendar", kind: "calendar", granted: true, automatic: false, status: "paused", coverage: { from: "2026-10-01", to: "2026-12-31", partial: false }, historyDays: 90, lastSuccessAt: "2026-10-14T18:05:00Z" },
];
const IMPORTS: SourceImport[] = [
  { id: "file-hotel", name: "Riverside House confirmation.pdf", kind: "PDF", importedAt: "2026-10-14T10:02:00Z", records: 1, status: "complete" },
  { id: "file-notes", name: "Lisbon ideas.txt", kind: "Text", importedAt: "2026-10-13T19:44:00Z", records: 3, status: "partial" },
];
const SHARES: SourceShare[] = [{ id: "share-1", label: "Trip planning chat", actor: "Claude chat", sources: ["Personal Gmail", "Lisbon trip"], createdAt: "2026-10-14T09:00:00Z" }];

interface Opportunity { id: string; company: string; role: string; location: string; stage: string; next: string; activity: string }
const STAGES = ["Saved", "Applied", "Interviewing", "Offer", "Closed"];
const OPPORTUNITIES: Opportunity[] = [
  { id: "fieldwork", company: "Fieldwork", role: "Product lead", location: "Remote, US", stage: "Saved", next: "Review role requirements", activity: "Oct 14" },
  { id: "atlas", company: "Atlas Studio", role: "Senior product designer", location: "Denver, hybrid", stage: "Saved", next: "Compare with Northstar", activity: "Oct 13" },
  { id: "lumen", company: "Lumen", role: "Staff designer", location: "Remote, US", stage: "Applied", next: "Follow up Oct 19", activity: "Oct 12" },
  { id: "northstar", company: "Northstar", role: "Product designer", location: "Denver, hybrid", stage: "Interviewing", next: "Interview Fri 16, 10:00 MDT", activity: "Oct 14" },
  { id: "cedar", company: "Cedar", role: "Design lead", location: "Remote, US", stage: "Offer", next: "Review terms by Oct 21", activity: "Oct 15" },
];

interface Person { id: string; name: string; company: string; last: string; next: string; pinned: boolean }
const PEOPLE: Person[] = [
  { id: "maya", name: "Maya Chen", company: "Northstar, design lead", last: "2026-10-12", next: "Meeting tomorrow, 10:00", pinned: true },
  { id: "jordan", name: "Jordan Bell", company: "Fieldwork, founder", last: "2026-10-11", next: "Send proposal by Oct 16", pinned: true },
  { id: "alex", name: "Alex Rivera", company: "Independent", last: "2026-10-06", next: "Catch-up Oct 20", pinned: false },
  { id: "priya", name: "Priya Shah", company: "Fieldwork, operations", last: "2026-09-28", next: "No next action", pinned: false },
];

/** The memory client behind the gallery. Its first `create_follow_up` fails so retries can be seen. */
export function createGalleryClient(): MemoryClient {
  let followUpAttempts = 0;
  return createMemoryClient({
    data: { trip: "lisbon" },
    handlers: {
      list_bookings: () => ({ items: BOOKINGS }),
      list_opportunities: () => ({ items: OPPORTUNITIES }),
      change_stage: (input) => ({ id: input.id, stage: input.stage }),
      create_follow_up: (input) => {
        followUpAttempts++;
        // The first attempt fails so "Try again" demonstrates invocation ID reuse.
        if (followUpAttempts === 1) throw new Error("Ri is busy right now. Try again.");
        return { taskId: "task-1", title: input.title, dueAt: input.dueAt ?? null };
      },
      save_correction: () => ({ revision: 4 }),
      pause_source: () => ({ ok: true }),
    },
  });
}

/** Every kit component with fictional data, inside its own provider and frame. */
export function UiGallery({ client, initialPage = "travel", initialDialog = null, detailOpen = true, initialTab }: UiGalleryProps) {
  const memory = useMemo(() => client ?? createGalleryClient(), [client]);
  const [page, setPage] = useState<GalleryPage>(initialPage);
  return (
    <RiAppProvider client={memory} initialTheme="light">
      <AppFrame>
        <nav className="ri-gallery-nav" aria-label="Gallery pages" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1rem", alignItems: "center", padding: "0.625rem 1rem", borderBottom: "1px solid var(--ri-border)", background: "var(--ri-surface)", fontSize: "0.75rem" }}>
          <span className="ri-muted">Kit gallery · Fictional records</span>
          {(["travel", "jobs", "people", "states", "forms"] as const).map((id) => (
            <Button key={id} variant="link" size="sm" aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)} style={{ fontWeight: page === id ? 650 : 400 }}>
              {{ travel: "Travel", jobs: "Job Search", people: "People", states: "States", forms: "Forms" }[id]}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              const root = document.documentElement;
              root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
            }}
          >
            Switch theme
          </Button>
        </nav>
        {page === "travel" && <TravelPage initialDialog={initialDialog} detailOpen={detailOpen} initialTab={initialTab} />}
        {page === "jobs" && <JobsPage detailOpen={detailOpen} initialTab={initialTab} />}
        {page === "people" && <PeoplePage detailOpen={detailOpen} initialDialog={initialDialog} initialTab={initialTab} />}
        {page === "states" && <StatesPage />}
        {page === "forms" && <FormsPage />}
      </AppFrame>
    </RiAppProvider>
  );
}

function TravelPage({ initialDialog, detailOpen: initiallyOpen, initialTab }: { initialDialog: UiGalleryProps["initialDialog"]; detailOpen: boolean; initialTab?: string }) {
  const app = useRiApp();
  const announce = useAnnounce();
  const [tab, setTab] = useState(initialTab ?? "itinerary");
  const [day, setDay] = useState("2026-11-10");
  const [selected, setSelected] = useState<string | null>(initiallyOpen ? "hotel" : null);
  const [filters, setFilters] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DataTableSort>({ key: "dates", direction: "ascending" });
  const [followUp, setFollowUp] = useState(initialDialog === "followup");
  const [correct, setCorrect] = useState(initialDialog === "correct");
  const [reviewed, setReviewed] = useState(false);
  const bookings = useQuery<{ items: Booking[] }>("list_bookings", { trip: "lisbon" });
  const createFollowUp = useMutation<{ title: string; dueAt: string | null; subjectId: string }, { title: string; dueAt: string | null }>("create_follow_up");
  const [created, setCreated] = useState<{ title: string; dueAt?: string | null } | null>(null);
  const items = bookings.data?.items ?? [];
  const booking = items.find((item) => item.id === selected) ?? null;
  const dayItems = items.filter((item) => item.day === day && item.status !== "Canceled");
  const shown = items
    .filter((item) => !filters.length || filters.includes(item.status))
    .filter((item) => `${item.title} ${item.provider}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (sort.direction === "ascending" ? 1 : -1) * (sort.key === "title" ? a.title.localeCompare(b.title) : a.day.localeCompare(b.day) || a.time.localeCompare(b.time)));

  const inspector = booking && (
    <Inspector
      eyebrow={`${booking.kind} details`}
      title={booking.title}
      subtitle={`Lisbon · ${booking.dates}`}
      onClose={() => setSelected(null)}
      actions={
        <>
          <Button onClick={() => setCorrect(true)}>Correct details</Button>
          <Button onClick={() => { setCreated(null); createFollowUp.reset(); setFollowUp(true); }}>Create follow-up</Button>
          <Button variant="quiet" onClick={() => void app.openDirections(booking.address)}>Open directions</Button>
          <AskRiButton variant="primary" prompt={`Check ${booking.title} against my Lisbon trip. Are all of my nights covered?`}>Ask about this booking</AskRiButton>
        </>
      }
    >
      <KeyValueList items={[...booking.facts.map(([label, value]) => ({ label, value })), { label: "Status", value: <StatusLabel tone={STATUS_TONE[booking.status]}>{booking.status}</StatusLabel> }]} />
      <hr />
      <SourceLine label={booking.source} observedAt={booking.observed} onOpen={() => announce("Source opened in this preview")} />
    </Inspector>
  );

  const tabs = (
    <SectionTabs
      label="Trip sections"
      panelId="trip-panel"
      value={tab}
      onChange={(id) => {
        setTab(id);
        app.setLocation(`/trips/lisbon?tab=${id}`);
      }}
      items={[
        { id: "itinerary", label: "Itinerary" },
        { id: "bookings", label: "Bookings" },
        { id: "ideas", label: "Ideas" },
        { id: "review", label: "Review", badge: reviewed ? undefined : 1 },
        { id: "sources", label: "Sources" },
      ]}
    />
  );

  return (
    <AppShell
      eyebrow="Travel"
      title="Lisbon"
      context="November 9 to 14, 2026 · One traveler · Local times in Lisbon"
      secondaryActions={<AskRiButton prompt="Review my Lisbon itinerary. What is still missing, based on my recorded bookings?" />}
      primaryAction={<Button variant="primary">Add booking</Button>}
      tabs={tabs}
      notice={
        !reviewed && tab !== "review" ? (
          <Notice title="One booking needs a look." action={<Button size="sm" onClick={() => setTab("review")}>Review change</Button>}>
            Your hotel sent a revised check-in time.
          </Notice>
        ) : undefined
      }
    >
      <SectionPanel panelId="trip-panel" value={tab}>
        {bookings.loading && !bookings.data ? (
          <LoadingState label="Loading bookings" />
        ) : bookings.error ? (
          <ErrorState message={bookings.error} onRetry={() => void bookings.reload()} />
        ) : tab === "itinerary" ? (
          <SplitView
            detailOpen={Boolean(booking)}
            onBack={() => setSelected(null)}
            backLabel="Back to itinerary"
            detailLabel={booking?.title}
            detail={inspector}
            list={
              <div className="ri-stack ri-stack--loose">
                <SegmentedControl label="Trip days" value={day} onChange={setDay} options={DAYS.map(([id, label]) => ({ id, label }))} />
                <div className="ri-stack">
                  <div>
                    <h2 className="ri-h2">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"))}</h2>
                    <p className="ri-small ri-muted">{day === "2026-11-09" ? "Departure times in Denver MST" : "Local times in Lisbon WET"}</p>
                  </div>
                  {dayItems.length ? (
                    <Timeline
                      label="Itinerary"
                      variant="cards"
                      selectedId={selected}
                      onSelect={setSelected}
                      items={dayItems.map((item) => ({
                        id: item.id,
                        date: item.time,
                        title: item.title,
                        meta: <><StatusLabel tone={STATUS_TONE[item.status]}>{item.status}</StatusLabel><span>{item.provider}</span></>,
                      }))}
                    />
                  ) : (
                    <EmptyState compact headingLevel={3} title="No booking recorded for this day" action={<Button size="sm">Add an idea</Button>}>
                      Nights here are covered by Riverside House.
                    </EmptyState>
                  )}
                </div>
              </div>
            }
          />
        ) : tab === "bookings" ? (
          <SplitView
            detailOpen={Boolean(booking)}
            onBack={() => setSelected(null)}
            backLabel="Back to bookings"
            detailLabel={booking?.title}
            detail={inspector}
            list={
              <div className="ri-stack">
                <Toolbar end={<SearchField label="Find a booking" placeholder="Name or provider" value={search} onChange={setSearch} />}>
                  <FilterChips
                    label="Booking status"
                    value={filters}
                    onChange={setFilters}
                    items={(["Confirmed", "Planned", "Canceled", "Needs review"] as const).map((status) => ({ id: status, label: status, count: items.filter((item) => item.status === status).length }))}
                  />
                </Toolbar>
                <DataTable
                  caption="Recorded bookings"
                  captionHidden
                  rows={shown}
                  rowKey="id"
                  selectedKey={selected}
                  onSelect={(key) => setSelected(key)}
                  sort={sort}
                  onSortChange={setSort}
                  empty={<EmptyState compact headingLevel={3} title="No bookings match" action={<Button size="sm" onClick={() => { setFilters([]); setSearch(""); }}>Clear filters</Button>}>Try another status or search.</EmptyState>}
                  columns={[
                    { key: "title", label: "Booking", sortable: true },
                    { key: "kind", label: "Type" },
                    { key: "dates", label: "Dates", sortable: true },
                    { key: "status", label: "Status", render: (row) => <StatusLabel tone={STATUS_TONE[row.status]}>{row.status}</StatusLabel> },
                    { key: "reference", label: "Reference", hideInCards: true },
                  ]}
                />
              </div>
            }
          />
        ) : tab === "ideas" ? (
          <div className="ri-stack">
            <Notice tone="info" title="Ideas are not bookings.">Prices are what you saved. Unknown details say Not provided.</Notice>
            <DataTable
              caption="Saved ideas"
              rows={[
                { id: "belem", title: "A morning in Belém", price: formatMoney(1500, "EUR"), checkIn: "Not provided", saved: "Oct 13" },
                { id: "sintra", title: "A day in Sintra", price: formatMoney(3400, "EUR"), checkIn: "Not provided", saved: "Oct 13" },
                { id: "river", title: "Riverside dinner", price: "Not provided", checkIn: "Flexible timing", saved: "Oct 14" },
              ]}
              rowKey="id"
              columns={[{ key: "title", label: "Idea" }, { key: "price", label: "Known price", align: "end" }, { key: "checkIn", label: "Timing" }, { key: "saved", label: "Saved" }]}
            />
          </div>
        ) : tab === "review" ? (
          <div className="ri-stack ri-stack--loose">
            {reviewed ? (
              <EmptyState title="You are up to date" action={<Button onClick={() => setTab("itinerary")}>Open itinerary</Button>}>The revised check-in time is recorded with its source.</EmptyState>
            ) : (
              <ReviewCompare
                title="Riverside House check-in time changed"
                reason="Your hotel sent an updated confirmation on October 14."
                rows={[
                  { label: "Check-in", before: "Nov 10, 15:00 WET", after: "Nov 10, 16:00 WET" },
                  { label: "Check-out", before: "Nov 14, 11:00 WET", after: "Nov 14, 11:00 WET" },
                ]}
                evidence={<SourceLine label="updated hotel confirmation" observedAt="2026-10-14" onOpen={() => announce("Source opened in this preview")} />}
                onAccept={() => { setReviewed(true); announce("Change accepted"); }}
                onEdit={() => setCorrect(true)}
                onDismiss={() => { setReviewed(true); announce("Change dismissed"); }}
              />
            )}
            <ConflictNotice
              fields={[{ label: "Check-in", mine: "Nov 10, 14:00 WET", current: "Nov 10, 16:00 WET" }, { label: "Note", mine: "Early check-in requested", current: "Not provided" }]}
              onUseCurrent={() => announce("Current values kept")}
              onKeepMine={() => announce("Your changes saved")}
            />
          </div>
        ) : (
          <SourcesScreen
            accounts={ACCOUNTS}
            imports={IMPORTS}
            shares={SHARES}
            zone={ZONE}
            now={NOW}
            note="Travel looks for confirmations, changes and cancellations. Search finds likely bookings and may miss some."
            onConnect={() => app.openSources()}
            onManageAccess={() => app.manageAccess()}
            onPause={async () => { await app.call("pause_source", {}); }}
            onResume={() => undefined}
            onContinue={() => undefined}
            onDeleteImported={() => undefined}
            onChangeHistory={() => undefined}
            onRevokeShare={() => undefined}
          />
        )}
      </SectionPanel>
      <FollowUpDialog
        open={followUp}
        defaultTitle={`Check ${booking?.title ?? "Riverside House"} arrival details`}
        defaultDueDate="2026-11-02"
        allowDueDate
        subject={booking?.title ?? "Riverside House"}
        created={created}
        onClose={() => setFollowUp(false)}
        onCreate={async (title, dueAt) => {
          const result = await createFollowUp.run({ title, dueAt, subjectId: booking?.id ?? "hotel" });
          setCreated(result);
        }}
      />
      <CorrectionDialog open={correct} onClose={() => setCorrect(false)} />
    </AppShell>
  );
}

function CorrectionDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const announce = useAnnounce();
  const [checkIn, setCheckIn] = useState<string | null>("2026-11-10");
  const [time, setTime] = useState("15:00");
  const [price, setPrice] = useState<MoneyValue>({ amountMinor: 64000, currency: "EUR" });
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={open}
      title="Correct booking details"
      description="Your correction keeps the original value from the source. Future imports will not overwrite it."
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { announce("Correction saved"); onClose(); }}>Save correction</Button>
        </>
      }
    >
      <div className="ri-form-grid">
        <DateInput label="Check-in date" value={checkIn} onChange={setCheckIn} required />
        <TextInput label="Check-in time" value={time} onChange={setTime} hint="Local time in Lisbon" inputMode="numeric" />
      </div>
      <MoneyInput label="Total price" value={price} onChange={(value) => setPrice(value)} currencies={["EUR", "USD", "GBP"]} hint="As shown on the confirmation" />
      <TextArea label="Note" value={note} onChange={setNote} placeholder="Why this changed" />
      <SourceLine label="hotel confirmation email" observedAt="2026-10-14" />
    </Dialog>
  );
}

function JobsPage({ detailOpen, initialTab }: { detailOpen: boolean; initialTab?: string }) {
  const announce = useAnnounce();
  const [tab, setTab] = useState(initialTab ?? "opportunities");
  const [view, setView] = useState("table");
  const [search, setSearch] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(detailOpen ? "northstar" : null);
  const [records, setRecords] = useState(OPPORTUNITIES);
  const move = useMutation<{ id: string; stage: string }>("change_stage");
  const shown = records.filter((item) => (!stages.length || stages.includes(item.stage)) && `${item.company} ${item.role}`.toLowerCase().includes(search.toLowerCase()));
  const opportunity = records.find((item) => item.id === selected) ?? null;
  const columns = [
    { key: "company", label: "Company", render: (row: Opportunity) => <AvatarLabel name={row.company} detail={row.role} /> },
    { key: "stage", label: "Stage", render: (row: Opportunity) => <StatusLabel tone={row.stage === "Offer" ? "success" : "neutral"}>{row.stage}</StatusLabel> },
    { key: "next", label: "Next" },
    { key: "activity", label: "Last activity" },
  ];
  return (
    <AppShell
      eyebrow="Job Search"
      title="Your next move"
      context="Your opportunities, conversations and preparation in one place."
      secondaryActions={<AskRiButton prompt="Compare my saved roles using only the details I recorded." />}
      primaryAction={<Button variant="primary">Save a job</Button>}
      tabs={<SectionTabs label="Job Search sections" value={tab} onChange={setTab} items={[{ id: "today", label: "Today" }, { id: "opportunities", label: "Opportunities" }, { id: "materials", label: "Materials" }, { id: "sources", label: "Sources" }]} />}
      notice={<Notice tone="info" title="Northstar portfolio discussion is tomorrow at 10:00 MDT." action={<Button size="sm" variant="primary" onClick={() => setSelected("northstar")}>Open preparation</Button>}>Role saved · Résumé v3 submitted · Correspondence linked</Notice>}
    >
      <SplitView
        detailOpen={Boolean(opportunity)}
        onBack={() => setSelected(null)}
        backLabel="Back to opportunities"
        detailLabel={opportunity ? `${opportunity.company}, ${opportunity.role}` : undefined}
        list={
          <div className="ri-stack">
            <Toolbar end={<SearchField label="Find an opportunity" placeholder="Company or role" value={search} onChange={setSearch} />}>
              <SegmentedControl label="Opportunity view" value={view} onChange={setView} options={[{ id: "board", label: "Board" }, { id: "table", label: "Table" }]} />
            </Toolbar>
            <FilterChips label="Stages" value={stages} onChange={setStages} items={STAGES.map((stage) => ({ id: stage, label: stage, count: records.filter((item) => item.stage === stage).length }))} />
            {view === "table" ? (
              <DataTable caption="Opportunities" captionHidden rows={shown} rowKey="id" selectedKey={selected} onSelect={(key) => setSelected(key)} rowLabel={(row) => `${row.company}, ${row.role}, ${row.stage}`} columns={columns} stickyFirstColumn />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))", gap: "1rem", alignItems: "start" }}>
                {STAGES.slice(0, 4).map((stage) => (
                  <DataTable key={stage} display="cards" caption={`${stage} (${shown.filter((item) => item.stage === stage).length})`} rows={shown.filter((item) => item.stage === stage)} rowKey="id" selectedKey={selected} onSelect={(key) => setSelected(key)} columns={columns.filter((column) => column.key !== "stage")} empty={<p className="ri-small ri-muted">Nothing in {stage}</p>} />
                ))}
              </div>
            )}
          </div>
        }
        detail={
          opportunity && (
            <Inspector
              eyebrow={opportunity.company}
              title={opportunity.role}
              subtitle={`${opportunity.location} · ${opportunity.stage}`}
              onClose={() => setSelected(null)}
              actions={
                <>
                  <Menu
                    label="Move to stage"
                    selectedId={opportunity.stage}
                    items={STAGES.map((stage) => ({ id: stage, label: stage }))}
                    onSelect={async (stage) => {
                      await move.run({ id: opportunity.id, stage });
                      setRecords((list) => list.map((item) => (item.id === opportunity.id ? { ...item, stage } : item)));
                      announce(`Moved to ${stage}`);
                    }}
                  />
                  <AskRiButton variant="primary" prompt={`Prepare me for the ${opportunity.company} interview using the role, my submitted résumé and our correspondence.`}>Prepare with Ri</AskRiButton>
                </>
              }
            >
              <KeyValueList items={[{ label: "Next", value: opportunity.next }, { label: "Résumé", value: "v3 submitted Oct 9" }, { label: "Posting", value: "Saved Oct 2, original retained" }]} />
              <div className="ri-stack ri-stack--tight">
                <h3 className="ri-h3">Correspondence</h3>
                <Timeline
                  label="Correspondence"
                  items={[
                    { id: "c1", date: "2026-10-14", title: "Interview confirmed", meta: "Maya Chen · Personal Gmail", excerpt: "We look forward to discussing your portfolio on Friday, October 16 at 10:00 MDT. The conversation will take about 45 minutes.", tone: "success" },
                    { id: "c2", date: "2026-10-09", title: "Application received", meta: "Northstar careers · Personal Gmail", body: "Résumé v3 attached to the submission." },
                  ]}
                />
              </div>
              <SourceLine label="posting snapshot" observedAt="2026-10-02" onOpen={() => announce("Posting opened in this preview")} />
            </Inspector>
          )
        }
      />
    </AppShell>
  );
}

function PeoplePage({ detailOpen, initialDialog, initialTab }: { detailOpen: boolean; initialDialog: UiGalleryProps["initialDialog"]; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? "people");
  const [search, setSearch] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [sort, setSort] = useState<DataTableSort>({ key: "last", direction: "descending" });
  const [selected, setSelected] = useState<string | null>(detailOpen ? "maya" : null);
  const [followUp, setFollowUp] = useState(initialDialog === "followup");
  const rows = PEOPLE.filter((person) => (!chips.includes("pinned") || person.pinned) && person.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => (sort.direction === "ascending" ? 1 : -1) * (sort.key === "name" ? a.name.localeCompare(b.name) : a.last.localeCompare(b.last)));
  const person = PEOPLE.find((item) => item.id === selected) ?? null;
  return (
    <AppShell
      eyebrow="People"
      title="Pick up where you left off"
      context={`${plural(PEOPLE.length, "person", "people")} in this view · Updated 09:12 · 90 days covered`}
      secondaryActions={<AskRiButton prompt="Who have I not spoken with in a month, based on my recorded exchanges?" />}
      primaryAction={<Button variant="primary">Add person</Button>}
      tabs={<SectionTabs label="People sections" value={tab} onChange={setTab} items={[{ id: "today", label: "Today" }, { id: "people", label: "People" }, { id: "followups", label: "Follow-ups", badge: 2 }, { id: "companies", label: "Companies" }, { id: "sources", label: "Sources" }, { id: "add", label: "Add view" }]} />}
    >
      <SplitView
        detailOpen={Boolean(person)}
        onBack={() => setSelected(null)}
        backLabel="Back to people"
        detailLabel={person?.name}
        list={
          <div className="ri-stack">
            <Toolbar end={<SearchField label="Search people" hideLabel placeholder="Search people" value={search} onChange={setSearch} />}>
              <FilterChips label="Filters" value={chips} onChange={setChips} items={[{ id: "pinned", label: "Pinned" }, { id: "followup", label: "Has follow-up" }]} />
            </Toolbar>
            <DataTable
              caption="People"
              captionHidden
              rows={rows}
              rowKey="id"
              selectedKey={selected}
              onSelect={(key) => setSelected(key)}
              sort={sort}
              onSortChange={setSort}
              rowLabel={(row) => row.name}
              columns={[
                { key: "name", label: "Name", sortable: true, render: (row) => <AvatarLabel name={row.name} /> },
                { key: "company", label: "Company and role" },
                { key: "last", label: "Last exchange", sortable: true, render: (row) => <time dateTime={row.last}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(row.last + "T12:00:00Z"))}</time> },
                { key: "next", label: "Next action" },
              ]}
            />
          </div>
        }
        detail={
          person && (
            <Inspector
              eyebrow="Person"
              title={person.name}
              subtitle={`${person.company} · Role observed in October correspondence`}
              onClose={() => setSelected(null)}
              actions={
                <>
                  <Button>Add note</Button>
                  <Button onClick={() => setFollowUp(true)}>Follow up</Button>
                  <AskRiButton variant="primary" prompt={`Prepare me for my meeting with ${person.name}. Use permitted records and cite open commitments.`}>Prepare with Ri</AskRiButton>
                </>
              }
            >
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <Avatar name={person.name} size="lg" />
                <KeyValueList stacked items={[{ label: "Last direct exchange", value: "Oct 12" }, { label: "Next meeting", value: person.next }]} />
              </div>
              <div className="ri-card" style={{ padding: "1rem 1.125rem" }}>
                <div className="ri-stack ri-stack--tight">
                  <h3 className="ri-h3">Before you meet</h3>
                  <p>You discussed the team&apos;s hiring plans and the portfolio review format. {person.name.split(" ")[0]} asked to see an example of a complex product decision.</p>
                  <p className="ri-eyebrow" style={{ marginTop: "0.5rem" }}>Possible follow-up</p>
                  <p>You offered to introduce {person.name.split(" ")[0]} to a research lead.</p>
                  <p className="ri-small ri-muted">No confirming message found in the indexed history.</p>
                  <SourceLine label="email conversation" observedAt="2026-10-12" onOpen={() => undefined} openLabel="View evidence" />
                </div>
              </div>
              <Timeline
                label={`Timeline with ${person.name}`}
                items={[
                  { id: "t1", date: "2026-10-12", title: "Email conversation", meta: "Personal Gmail · 4 messages", body: "Portfolio format and team hiring plans.", excerpt: "Could you bring one example of a complex product decision? Something where the tradeoffs were not obvious." },
                  { id: "t2", date: "2026-10-08", title: "Meeting scheduled", meta: "Calendar event · Attendance not inferred", body: "Portfolio discussion" },
                  { id: "t3", date: "2026-09-29", title: "Your note", body: "Ask how the design and research teams work together." },
                  { id: "t4", date: "2026-09-02", title: "Imported contact", meta: <SourceLine label="LinkedIn export" availability="unavailable" observedAt="2026-09-02" /> },
                ]}
              />
            </Inspector>
          )
        }
      />
      <FollowUpDialog open={followUp} defaultTitle={`Introduce ${person?.name.split(" ")[0] ?? "Maya"} to a research lead`} allowDueDate={false} subject={person?.name} onClose={() => setFollowUp(false)} onCreate={async () => undefined} />
    </AppShell>
  );
}

function StatesPage() {
  const [loading, setLoading] = useState(true);
  return (
    <AppShell eyebrow="Kit gallery" title="States and content" context="Buttons, labels, notices and empty, loading and error states." primaryAction={<Button variant="primary">Primary action</Button>}>
      <div className="ri-stack ri-stack--loose">
        <GallerySection title="Buttons">
          <ButtonRow>
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="link">Link</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="danger-solid">Delete imported data</Button>
            <Button busy busyLabel="Saving">Saving</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
          </ButtonRow>
        </GallerySection>
        <GallerySection title="Status labels">
          <ButtonRow>
            <StatusLabel>Planned</StatusLabel>
            <StatusLabel tone="info">Importing</StatusLabel>
            <StatusLabel tone="success">Confirmed</StatusLabel>
            <StatusLabel tone="warning">Needs review</StatusLabel>
            <StatusLabel tone="danger">Canceled</StatusLabel>
          </ButtonRow>
        </GallerySection>
        <GallerySection title="Notices">
          <div className="ri-stack">
            <Notice title="One booking needs a look." action={<Button size="sm">Review change</Button>}>Your hotel sent a revised check-in time.</Notice>
            <Notice tone="danger" title="Work Gmail needs to reconnect.">Records imported before October 9 are still here.</Notice>
            <Notice tone="success" title="Import finished.">23 bookings found in the last 90 days.</Notice>
            <Notice tone="info" title="Coverage is partial.">Older messages are still importing.</Notice>
            <Notice tone="neutral" title="Nothing needs your attention." />
          </div>
        </GallerySection>
        <GallerySection title="Empty, loading and error">
          <div className="ri-stack">
            <div className="ri-card">
              <EmptyState title="Bring your next trip together" action={<><Button variant="primary">Add booking</Button><Button>Connect email</Button></>}>
                Add a confirmation, paste booking details or connect email. Ri keeps each source with the booking.
              </EmptyState>
            </div>
            <div className="ri-card">
              {loading ? <LoadingState label="Loading trips" rows={2} /> : <p>Loaded.</p>}
              <Button size="sm" variant="link" onClick={() => setLoading((value) => !value)}>{loading ? "Finish loading" : "Show loading again"}</Button>
            </div>
            <ErrorState title="Bookings could not load" message="The app did not respond in time. Your records are safe." onRetry={() => undefined} />
          </div>
        </GallerySection>
        <GallerySection title="Sources and people">
          <div className="ri-stack">
            <SourceLine label="confirmation email" observedAt="2026-10-14" onOpen={() => undefined} />
            <SourceLine label="confirmation email" observedAt="2026-10-14T08:00:00Z" availability="unavailable" />
            <ButtonRow>
              <Avatar name="Maya Chen" size="sm" />
              <Avatar name="Jordan Bell" />
              <Avatar name="Priya Shah" size="lg" label />
              <Avatar name="Fieldwork" />
            </ButtonRow>
            <KeyValueList items={[{ label: "Check-in", value: "Nov 10, 15:00 WET" }, { label: "Total", value: formatMoney(64000, "EUR") }, { label: "Deposit", value: formatMoney(800000, "JPY") }, { label: "Traveler", value: "Not provided" }]} />
          </div>
        </GallerySection>
      </div>
    </AppShell>
  );
}

function FormsPage() {
  const [title, setTitle] = useState("Prepare portfolio examples");
  const [notes, setNotes] = useState("");
  const [trip, setTrip] = useState("");
  const [pin, setPin] = useState(true);
  const [history, setHistory] = useState("90");
  const [date, setDate] = useState<string | null>("2026-10-16");
  const [money, setMoney] = useState<MoneyValue>({ amountMinor: 800000, currency: "USD" });
  const [moneyState, setMoneyState] = useState<string | null>(null);
  return (
    <AppShell eyebrow="Kit gallery" title="Forms and access" context="Labeled fields, hints, errors and the share chooser.">
      <div className="ri-stack ri-stack--loose">
        <GallerySection title="Fields">
          <div className="ri-form-grid">
            <TextInput label="Title" value={title} onChange={setTitle} required hint="Shown in Ri tasks" />
            <TextInput label="Company" value="" onChange={() => undefined} error="Add the company name" required />
            <Select label="Trip" value={trip} onChange={setTrip} placeholder="Choose a trip" options={[{ value: "lisbon", label: "Lisbon, Nov 9 to 14" }, { value: "tokyo", label: "Tokyo, Feb 2 to 9" }]} />
            <DateInput label="Due date" value={date} onChange={setDate} hint="Optional" />
            <MoneyInput label="Offer amount" value={money} onChange={(value, state) => { setMoney(value); setMoneyState(state.error); }} hint={moneyState ? undefined : `Stored as ${money.amountMinor ?? "nothing"} minor units of ${money.currency}`} />
            <Field label="Custom control" hint="Any control can use the field's ids">
              <input className="ri-input" defaultValue="Uses useField()" readOnly />
            </Field>
          </div>
          <TextArea label="Preparation notes" value={notes} onChange={setNotes} placeholder="Examples and questions to ask" />
          <Checkbox label="Pin this person" hint="Pinned people stay at the top of Today" checked={pin} onChange={setPin} />
          <RadioGroup label="History to import" value={history} onChange={setHistory} options={[{ value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days", hint: "Recommended" }, { value: "365", label: "Last 365 days", hint: "Takes longer. Older bookings may still be missing." }]} />
        </GallerySection>
        <GallerySection title="Share with a chat">
          <ShareScopeChooser
            actorLabel="Trip planning chat"
            sources={[{ id: "gmail", label: "Personal Gmail", description: "Bookings found in this account" }, { id: "lisbon", label: "Lisbon trip", description: "Manual items and notes in this trip" }]}
            operations={[{ id: "read", label: "Read records" }, { id: "write", label: "Change records", description: "Edits still use revision checks" }]}
            onCreate={async () => undefined}
          />
        </GallerySection>
      </div>
    </AppShell>
  );
}

function GallerySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ri-stack" aria-label={title}>
      <h2 className="ri-h2">{title}</h2>
      {children}
    </section>
  );
}
