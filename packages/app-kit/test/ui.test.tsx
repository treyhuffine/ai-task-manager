import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { parseHTML } from "linkedom";
import {
  UI_KIT_VERSION, baseStyles, installStyles, layoutForWidth, formatMoney, parseMoneyInput, minorToDecimal, currencyDigits, plural, initialsFor,
  chatIntentUrl, locationIntentUrl, assertHttpsUrl, directionsUrl, downloadContents, createCoalescer, HOST_PATHS,
  RiAppProvider, useRiApp, useQuery, useMutation, useAnnounce, createMemoryClient,
  AppShell, SectionTabs, SectionPanel, SegmentedControl, FilterChips, SearchField, Toolbar, SplitView, Inspector,
  Button, ButtonRow, StatusLabel, Notice, EmptyState, LoadingState, ErrorState, KeyValueList, DataTable, Timeline, SourceLine, Avatar, Menu,
  Dialog, Field, TextInput, TextArea, Select, Checkbox, RadioGroup, DateInput, MoneyInput,
  AskRiButton, FollowUpDialog, ConflictNotice, ReviewCompare, SourcesScreen, ShareScopeChooser, UiGallery,
  formatDate, formatDateRange, formatInstant, relativeDay,
  type SourceAccount, type MemoryClient, type RiApp, type QueryResult, type MutationResult,
} from "@ri/app-kit/ui";

/** Server-render an element and parse it for semantic assertions. */
function render(element: ReactElement) {
  const html = renderToString(element);
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return { html, document, text: (document.body.textContent ?? "").replace(/\s+/g, " ").trim() };
}
const DASHES = /[\u2012\u2013\u2014\u2015\u2E3A\u2E3B]/;
const noop = () => undefined;

describe("pure logic", () => {
  it("exports a version and the public API", () => {
    expect(UI_KIT_VERSION).toBe(1);
    for (const value of [RiAppProvider, useRiApp, useQuery, useMutation, AppShell, SectionTabs, SplitView, DataTable, Dialog, MoneyInput, SourcesScreen, ShareScopeChooser, FollowUpDialog])
      expect(typeof value).toBe("function");
  });

  it("maps container widths to layouts at 700 and 1150 px", () => {
    expect(layoutForWidth(360)).toBe("narrow");
    expect(layoutForWidth(699)).toBe("narrow");
    expect(layoutForWidth(700)).toBe("medium");
    expect(layoutForWidth(1149)).toBe("medium");
    expect(layoutForWidth(1150)).toBe("wide");
    expect(layoutForWidth(1500)).toBe("wide");
  });

  it("formats integer minor units per currency without floats", () => {
    expect(formatMoney(800000, "USD")).toBe("$8,000.00");
    expect(formatMoney(800000, "usd", { display: "code" })).toBe("8,000.00 USD");
    expect(formatMoney(800000, "USD", { trimZeroCents: true })).toBe("$8,000");
    expect(formatMoney(1505, "EUR")).toBe("€15.05");
    expect(formatMoney(800000, "JPY")).toBe("¥800,000");
    expect(formatMoney(1234, "KWD", { display: "code" })).toBe("1.234 KWD");
    expect(formatMoney(-2550, "USD")).toBe("-$25.50");
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD")).toBe("$90,071,992,547,409.91");
    expect(minorToDecimal(5, "USD")).toBe("0.05");
    expect(minorToDecimal(5, "JPY")).toBe("5");
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
    expect(() => minorToDecimal(1.5, "USD")).toThrow();
  });

  it("parses typed money into minor units with string arithmetic", () => {
    expect(parseMoneyInput("1,250.5", "USD")).toEqual({ ok: true, minor: 125050 });
    expect(parseMoneyInput(" 1250.50 ", "USD")).toEqual({ ok: true, minor: 125050 });
    expect(parseMoneyInput("12.", "USD")).toEqual({ ok: true, minor: 1200 });
    expect(parseMoneyInput(".5", "USD")).toEqual({ ok: true, minor: 50 });
    expect(parseMoneyInput("0.1", "USD")).toEqual({ ok: true, minor: 10 });
    expect(parseMoneyInput("", "USD")).toEqual({ ok: true, minor: null });
    expect(parseMoneyInput("800000", "JPY")).toEqual({ ok: true, minor: 800000 });
    expect(parseMoneyInput("10.5", "JPY").ok).toBe(false);
    expect(parseMoneyInput("1.234", "USD").ok).toBe(false);
    expect(parseMoneyInput("1,25", "USD").ok).toBe(false);
    expect(parseMoneyInput("abc", "USD").ok).toBe(false);
    expect(parseMoneyInput("-5", "USD").ok).toBe(false);
    expect(parseMoneyInput("-5", "USD", { allowNegative: true })).toEqual({ ok: true, minor: -500 });
    expect(parseMoneyInput("99999999999999999", "USD")).toEqual({ ok: false, error: "This amount is too large" });
    const failure = parseMoneyInput("10.5", "JPY");
    expect(failure.ok ? "" : failure.error).toBe("JPY amounts have no decimal places");
  });

  it("formats counts, initials and dates without dashes", () => {
    expect(plural(1, "booking", "bookings")).toBe("1 booking");
    expect(plural(0, "booking", "bookings")).toBe("0 bookings");
    expect(plural(1200, "item", "items")).toBe("1,200 items");
    expect(initialsFor("Maya Chen")).toBe("MC");
    expect(initialsFor("  Prince ")).toBe("P");
    expect(initialsFor("ana maria de souza")).toBe("AS");
    expect(initialsFor("")).toBe("?");
    expect(formatDateRange("2026-11-09", "2026-11-14")).toBe("November 9 to 14, 2026");
    expect(formatDate("2026-11-10", "weekday")).toBe("Tue 10");
    expect(formatInstant("2026-11-10T08:40:00Z", "Europe/Lisbon", { zone: true })).toBe("Nov 10, 08:40 WET");
    expect(relativeDay("2026-10-16", "2026-10-15")).toBe("Tomorrow");
  });

  it("builds host intents that stage text, never send it", () => {
    expect(HOST_PATHS).toEqual({ chat: "/__host/chat", sources: "/__host/sources", manageAccess: "/__host/manage-access", location: "/__host/location" });
    expect(chatIntentUrl("What is missing?")).toBe("/__host/chat?prompt=What%20is%20missing%3F");
    const long = chatIntentUrl("x".repeat(2500));
    expect(decodeURIComponent(long.split("prompt=")[1])).toHaveLength(2000);
    // A surrogate pair at the cut is dropped whole rather than split.
    const emoji = chatIntentUrl("x".repeat(1999) + "😀 tail");
    expect(decodeURIComponent(emoji.split("prompt=")[1])).toBe("x".repeat(1999));
    expect(locationIntentUrl("/trips/lisbon?tab=bookings&day=2026-11-10")).toBe("/__host/location?to=%2Ftrips%2Flisbon%3Ftab%3Dbookings%26day%3D2026-11-10");
    expect(directionsUrl(" Rua da Prata 80, Lisbon ")).toBe("https://www.google.com/maps/search/?api=1&query=Rua%20da%20Prata%2080%2C%20Lisbon");
    expect(assertHttpsUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(() => assertHttpsUrl("http://example.com")).toThrow(/https/);
    expect(() => assertHttpsUrl("javascript:alert(1)")).toThrow();
    expect(() => assertHttpsUrl("https://user:pass@example.com")).toThrow();
    expect(() => assertHttpsUrl("not a url")).toThrow(/valid web address/);
    expect(downloadContents({ name: "../trips/Lisbon trip.ics", mimeType: "text/calendar", text: "BEGIN:VCALENDAR" })).toEqual([
      { type: "resource", resource: { uri: "file:///Lisbon%20trip.ics", mimeType: "text/calendar", text: "BEGIN:VCALENDAR" } },
    ]);
    expect(downloadContents({ name: "a.pdf", mimeType: "application/pdf", base64: "JVBERi0=" })[0].resource).toEqual({ uri: "file:///a.pdf", mimeType: "application/pdf", blob: "JVBERi0=" });
    expect(() => downloadContents({ name: "a", mimeType: "text/plain" })).toThrow();
    expect(() => downloadContents({ name: "a", mimeType: "text/plain", text: "x", base64: "eA==" })).toThrow();
  });

  it("coalesces context updates: latest only, quiet period, rate limit and dedupe", () => {
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      const coalescer = createCoalescer<unknown>((value) => sent.push(value), { delay: 150, maxWait: 1000, minInterval: 100 });
      for (let index = 0; index < 20; index++) {
        coalescer.push({ selected: [index] });
        vi.advanceTimersByTime(20);
      }
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(150);
      expect(sent).toEqual([{ selected: [19] }]);
      coalescer.push({ selected: [19] });
      vi.advanceTimersByTime(500);
      expect(sent).toHaveLength(1);
      // Constant change still flushes within maxWait, and never faster than 10 a second.
      for (let index = 0; index < 100; index++) {
        coalescer.push({ tick: index });
        vi.advanceTimersByTime(50);
      }
      expect(sent.length).toBeGreaterThanOrEqual(4);
      expect(sent.length).toBeLessThanOrEqual(1 + 5 * 10);
      coalescer.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ships prefixed, tokenized, container-responsive and accessible base styles", () => {
    const selectors = baseStyles.match(/(^|\n|\})\s*\.([a-z][\w-]*)/g) ?? [];
    expect(selectors.length).toBeGreaterThan(50);
    for (const selector of selectors) expect(selector.replace(/^[\s}\n]*\./, "")).toMatch(/^ri-/);
    for (const token of ["--ri-bg: #fafafa", "--ri-surface: #fff", "--ri-soft: #f3f3f3", "--ri-text: #202020", "--ri-border: #e5e5e5", "--ri-selected: #ededed", "--ri-button: #242424", "--ri-bg: #151515"])
      expect(baseStyles).toContain(token);
    expect(baseStyles).toContain(':root[data-theme="dark"]');
    expect(baseStyles).toContain("container: ri-app / inline-size");
    expect(baseStyles).toContain("@container ri-app (max-width: 699.98px)");
    expect(baseStyles).toContain("@container ri-app (max-width: 1149.98px)");
    expect(baseStyles).toContain(":focus-visible");
    expect(baseStyles).toContain("prefers-reduced-motion: reduce");
    expect(baseStyles).not.toMatch(/url\(|@import|https?:/);
  });
});

describe("server-rendered semantics", () => {
  it("renders the shell with one title, context, actions, tabs and a linked panel", () => {
    const { document, text } = render(
      <AppShell
        eyebrow="Travel"
        title="Lisbon"
        context="November 9 to 14, 2026"
        primaryAction={<Button variant="primary">Add booking</Button>}
        secondaryActions={<Button>Share</Button>}
        tabs={<SectionTabs label="Trip sections" panelId="trip" value="bookings" onChange={noop} items={[{ id: "itinerary", label: "Itinerary" }, { id: "bookings", label: "Bookings" }, { id: "review", label: "Review", badge: 1 }]} />}
        notice={<Notice title="One booking needs a look.">Your hotel sent a revised check-in time.</Notice>}
      >
        <SectionPanel panelId="trip" value="bookings">Panel</SectionPanel>
      </AppShell>,
    );
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("main h1")?.textContent).toBe("Lisbon");
    expect(document.querySelector(".ri-app")).not.toBeNull();
    expect(text).toContain("November 9 to 14, 2026");
    const tablist = document.querySelector('[role="tablist"]')!;
    expect(tablist.getAttribute("aria-label")).toBe("Trip sections");
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(tabs[1].getAttribute("aria-controls")).toBe("trip");
    const panel = document.querySelector('[role="tabpanel"]')!;
    expect(panel.id).toBe("trip");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1].id);
    expect(tabs[2].querySelector(".ri-tab__badge")?.textContent).toBe("1");
    expect([...document.querySelectorAll(".ri-shell__actions button")].map((button) => button.textContent)).toEqual(["Share", "Add booking"]);
  });

  it("labels toolbar controls: search, segmented choice and filter chips", () => {
    const { document } = render(
      <Toolbar end={<SearchField label="Find an opportunity" value="" onChange={noop} placeholder="Company or role" />}>
        <SegmentedControl label="Opportunity view" value="table" onChange={noop} options={[{ id: "board", label: "Board" }, { id: "table", label: "Table" }]} />
        <FilterChips label="Stages" value={["Applied"]} onChange={noop} items={[{ id: "Saved", label: "Saved", count: 2 }, { id: "Applied", label: "Applied", count: 1 }]} />
      </Toolbar>,
    );
    const input = document.querySelector('input[type="search"]')!;
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Find an opportunity");
    const group = document.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Opportunity view");
    expect([...group.querySelectorAll('[role="radio"]')].map((radio) => [radio.textContent, radio.getAttribute("aria-checked"), radio.getAttribute("tabindex")])).toEqual([["Board", "false", "-1"], ["Table", "true", "0"]]);
    const chips = document.querySelector('[role="group"][aria-label="Stages"]')!;
    expect([...chips.querySelectorAll("[aria-pressed]")].map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(chips.textContent).toContain("Clear filters");
  });

  it("keeps busy buttons focusable and announces their state", () => {
    const { document } = render(<ButtonRow label="Actions"><Button busy busyLabel="Saving">Save</Button><Button disabled>Off</Button><Button variant="link">Open</Button></ButtonRow>);
    const [busy, off, link] = [...document.querySelectorAll("button")];
    expect(busy.getAttribute("type")).toBe("button");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(busy.querySelector(".ri-sr-only")?.textContent).toBe(", Saving");
    // Disabled buttons stay discoverable by keyboard and announce their state.
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.hasAttribute("disabled")).toBe(false);
    expect(link.className).toContain("ri-button--link");
    expect(document.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Actions");
  });

  it("pairs every status color with a shape and text", () => {
    const { document } = render(
      <div>
        {(["neutral", "info", "success", "warning", "danger"] as const).map((tone) => <StatusLabel key={tone} tone={tone}>{tone}</StatusLabel>)}
        <Notice tone="danger" live title="Update failed">Try again later.</Notice>
        <Notice tone="success" live title="Saved" />
        <Notice title="Static" />
      </div>,
    );
    const labels = [...document.querySelectorAll(".ri-status")];
    expect(labels).toHaveLength(5);
    for (const label of labels) {
      expect(label.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(label.textContent).toBeTruthy();
    }
    const paths = labels.map((label) => label.querySelector("svg")!.innerHTML);
    expect(new Set(paths).size).toBe(5);
    const notices = [...document.querySelectorAll(".ri-notice")];
    expect(notices.map((notice) => notice.getAttribute("role"))).toEqual(["alert", "status", null]);
  });

  it("renders empty, loading and error states accessibly", () => {
    const { document } = render(
      <div>
        <EmptyState title="Bring your next trip together" action={<Button>Add booking</Button>}>Add a confirmation.</EmptyState>
        <EmptyState compact headingLevel={3} title="Nothing here" />
        <LoadingState label="Loading trips" rows={2} />
        <ErrorState message="Bookings could not load" onRetry={noop} />
      </div>,
    );
    expect(document.querySelector("h2")?.textContent).toBe("Bring your next trip together");
    expect(document.querySelector("h3")?.textContent).toBe("Nothing here");
    const loading = document.querySelector('[aria-busy="true"]')!;
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.textContent).toContain("Loading trips");
    expect(loading.querySelectorAll(".ri-skeleton")).toHaveLength(2);
    const error = document.querySelector('[role="alert"]')!;
    expect(error.textContent).toContain("Bookings could not load");
    expect(error.querySelector("button")?.textContent).toBe("Try again");
  });

  it("renders a semantic table with keyboard row selection and sortable headers", () => {
    const rows = [{ id: "a", name: "Maya Chen", last: "Oct 12" }, { id: "b", name: "Jordan Bell", last: "" }];
    const { document } = render(
      <DataTable caption="People" rows={rows} rowKey="id" selectedKey="b" onSelect={noop} sort={{ key: "last", direction: "descending" }} onSortChange={noop}
        columns={[{ key: "name", label: "Name", sortable: true }, { key: "last", label: "Last exchange", sortable: true }]} display="table" />,
    );
    expect(document.querySelector("caption")?.textContent).toBe("People");
    expect([...document.querySelectorAll('th[scope="col"]')].map((th) => [th.textContent, th.getAttribute("aria-sort")])).toEqual([["Name", "none"], ["Last exchange", "descending"]]);
    expect(document.querySelectorAll("thead button")).toHaveLength(2);
    expect([...document.querySelectorAll('th[scope="row"]')].map((th) => th.textContent)).toEqual(["Maya Chen", "Jordan Bell"]);
    const bodyRows = [...document.querySelectorAll("tbody tr")];
    expect(bodyRows.map((row) => row.getAttribute("tabindex"))).toEqual(["-1", "0"]);
    expect(bodyRows.map((row) => row.getAttribute("aria-current"))).toEqual([null, "true"]);
    expect(bodyRows[1].textContent).toContain("Not provided");
  });

  it("renders the same rows as stacked cards in narrow layouts", () => {
    const rows = [{ id: "a", name: "Maya Chen", company: "Northstar" }, { id: "b", name: "Jordan Bell", company: "Fieldwork" }];
    const { document } = render(
      <DataTable caption="People" rows={rows} rowKey="id" selectedKey="a" onSelect={noop} rowLabel={(row) => row.name} display="cards"
        columns={[{ key: "name", label: "Name" }, { key: "company", label: "Company" }]} />,
    );
    expect(document.querySelector("table")).toBeNull();
    const list = document.querySelector("ul.ri-row-cards")!;
    expect(document.getElementById(list.getAttribute("aria-labelledby")!)?.textContent).toBe("People");
    const buttons = [...list.querySelectorAll("li > button")];
    expect(buttons.map((button) => [button.getAttribute("aria-label"), button.getAttribute("aria-current")])).toEqual([["Maya Chen", "true"], ["Jordan Bell", null]]);
    expect(buttons[1].textContent).toContain("CompanyFieldwork");
  });

  it("renders a timeline as an ordered list with expandable source excerpts", () => {
    const { document } = render(
      <Timeline label="Timeline" items={[
        { id: "1", date: "2026-10-12", title: "Email conversation", meta: "Personal Gmail", excerpt: "Could you bring one example?" },
        { id: "2", date: "08:40", title: "Arrive in Lisbon" },
      ]} />,
    );
    const list = document.querySelector("ol")!;
    expect(list.getAttribute("aria-label")).toBe("Timeline");
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(list.querySelector("time")?.outerHTML).toMatch(/datetime="2026-10-12"/i);
    expect(list.querySelector("time")?.textContent).toBe("Oct 12");
    const toggle = list.querySelector("button[aria-expanded]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Show excerpt");
    expect(list.querySelector("blockquote")).toBeNull();
  });

  it("states provenance and unavailability of sources in words", () => {
    expect(render(<SourceLine label="confirmation email" observedAt="2026-10-14" onOpen={noop} />).text).toBe("Source: confirmation email · Observed Oct 14 Open source");
    const gone = render(<SourceLine label="confirmation email" observedAt="2026-10-14T08:00:00Z" zone="Europe/Lisbon" availability="unavailable" onOpen={noop} />);
    expect(gone.text).toBe("Source unavailable · confirmation email · Observed Oct 14");
    expect(gone.document.querySelector("button")).toBeNull();
  });

  it("uses neutral initials for avatars and a labelled key value list", () => {
    const { document } = render(<div><Avatar name="Maya Chen" /><Avatar name="Priya Shah" label /><KeyValueList label="Booking facts" items={[{ label: "Check-in", value: "Nov 10" }]} /></div>);
    const [decorative, labelled] = [...document.querySelectorAll(".ri-avatar")];
    expect(decorative.textContent).toBe("MC");
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    expect(labelled.getAttribute("role")).toBe("img");
    expect(labelled.getAttribute("aria-label")).toBe("Priya Shah");
    expect(document.querySelector("dl")?.getAttribute("aria-label")).toBe("Booking facts");
    expect(document.querySelector("dl > div > dt")?.textContent).toBe("Check-in");
  });

  it("renders a closed menu trigger and an open labelled dialog", () => {
    const menu = render(<Menu label="Move to stage" items={[{ id: "a", label: "Applied" }]} onSelect={noop} />);
    const trigger = menu.document.querySelector("button")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.document.querySelector('[role="menu"]')).toBeNull();

    expect(render(<Dialog open={false} title="Hidden" onClose={noop} />).html).toBe("");
    const { document } = render(<Dialog open title="Correct booking details" description="Keeps the original value." onClose={noop} footer={<Button>Save</Button>}><p>Body</p></Dialog>);
    const dialog = document.querySelector("dialog")!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Correct booking details");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Keeps the original value.");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.querySelector('button[aria-label="Close dialog"]')).not.toBeNull();
    expect(dialog.querySelector(".ri-dialog__foot")?.textContent).toBe("Save");
  });

  it("connects labels, hints, errors and required state to form controls", () => {
    const { document } = render(
      <div>
        <TextInput label="Company" value="" onChange={noop} hint="As written on the posting" error="Add the company name" required />
        <TextArea label="Notes" value="" onChange={noop} />
        <Select label="Trip" value="" onChange={noop} placeholder="Choose a trip" options={[{ value: "lisbon", label: "Lisbon" }]} />
        <DateInput label="Due date" value="2026-10-16" onChange={noop} />
        <Checkbox label="Pin this person" hint="Stays at the top" checked onChange={noop} />
        <RadioGroup label="History" value="90" onChange={noop} options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <MoneyInput label="Offer" value={{ amountMinor: 800000, currency: "USD" }} onChange={noop} />
        <Field label="Custom"><input className="ri-input" /></Field>
      </div>,
    );
    const company = document.querySelector("input.ri-input")!;
    const label = document.querySelector(`label[for="${company.id}"]`)!;
    expect(label.textContent).toBe("CompanyRequired");
    expect(company.getAttribute("aria-invalid")).toBe("true");
    expect(company.hasAttribute("required")).toBe(true);
    const described = company.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["Add the company name", "As written on the posting"]);
    expect(document.querySelector("textarea")?.id).toBeTruthy();
    expect(document.querySelector(`label[for="${document.querySelector("select")!.id}"]`)?.textContent).toBe("Trip");
    expect(document.querySelector('input[type="date"]')?.getAttribute("value")).toBe("2026-10-16");
    const checkbox = document.querySelector('input[type="checkbox"]')!;
    expect(document.getElementById(checkbox.getAttribute("aria-describedby")!)?.textContent).toBe("Stays at the top");
    expect(document.querySelector("fieldset > legend")?.textContent).toBe("History");
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    const money = document.querySelector(".ri-money")!;
    expect(money.querySelector("input")?.getAttribute("value")).toBe("8000.00");
    expect(money.querySelector("select")?.getAttribute("aria-label")).toBe("Currency");
  });

  it("renders split view and inspector with labelled detail", () => {
    const { document } = render(
      <SplitView detailOpen onBack={noop} backLabel="Back to bookings" detailLabel="Riverside House" list={<p>List</p>}
        detail={<Inspector title="Riverside House" eyebrow="Stay details" onClose={noop} actions={<Button>Correct details</Button>}><p>Facts</p></Inspector>} />,
    );
    const split = document.querySelector(".ri-split")!;
    expect(split.getAttribute("data-mode")).toBe("split");
    const article = document.querySelector("article.ri-inspector")!;
    expect(document.getElementById(article.getAttribute("aria-labelledby")!)?.textContent).toBe("Riverside House");
    expect(article.querySelector('button[aria-label="Close details"]')).not.toBeNull();
    expect(document.querySelector('section[aria-label="Riverside House"]')).not.toBeNull();
  });

  it("distinguishes Ri connection, app access and automatic updates on Sources", () => {
    const accounts: SourceAccount[] = [
      { id: "g", label: "Personal Gmail", kind: "mail", granted: true, automatic: true, status: "importing", coverage: { from: "2026-07-17", to: "2026-10-15", partial: true }, historyDays: 90, lastSuccessAt: "2026-10-15T08:12:00Z", pending: 12, failed: 1 },
      { id: "w", label: "Work Gmail", kind: "mail", granted: true, automatic: false, status: "reconnect", error: "Google asked you to sign in again." },
      { id: "c", label: "Personal calendar", kind: "calendar", granted: false, automatic: false, status: "not_started" },
    ];
    const { document, text } = render(
      <SourcesScreen accounts={accounts} imports={[{ id: "f", name: "hotel.pdf", kind: "PDF", importedAt: "2026-10-14T10:00:00Z", records: 1, status: "complete" }]}
        shares={[{ id: "s", label: "Trip planning chat", actor: "Claude chat", sources: ["Personal Gmail"], createdAt: "2026-10-14T09:00:00Z" }]}
        zone="Europe/Lisbon" now={new Date("2026-10-15T09:20:00Z")} onConnect={noop} onManageAccess={noop} onPause={noop} onResume={noop} onContinue={noop}
        onDeleteImported={noop} onChangeHistory={noop} onRevokeShare={noop} />,
    );
    expect(text).toContain("Only accounts granted to this app appear here. Other accounts connected to Ri stay private to Ri until you grant them with Manage access.");
    const cards = [...document.querySelectorAll("article.ri-account")];
    expect(cards).toHaveLength(3);
    const facts = (card: Element) => Object.fromEntries([...card.querySelectorAll(".ri-account__fact")].map((fact) => [fact.querySelector("dt")!.textContent, fact.querySelector("dd")!.textContent]));
    expect(facts(cards[0])).toEqual({
      Access: "Granted to this app",
      "Automatic updates": "On",
      History: "Last 90 days",
      Covers: "July 17 to October 15, 2026Partial",
      "Last successful update": "Today, 09:12",
      Waiting: "12 items to import1 item failed",
    });
    expect(facts(cards[1])["Automatic updates"]).toBe("Off");
    expect(facts(cards[2]).Access).toBe("Not granted to this app");
    const buttons = (card: Element) => [...card.querySelectorAll(".ri-account__actions button")].map((button) => button.textContent);
    expect(buttons(cards[0])).toEqual(["Pause updates", "Continue import", "Delete imported data"]);
    expect(buttons(cards[1])).toEqual(["Reconnect in Ri", "Resume updates", "Delete imported data"]);
    expect(buttons(cards[2])).toEqual(["Turn on updates", "Delete imported data"]);
    expect(cards[1].textContent).toContain("Google asked you to sign in again.");
    expect(cards[0].querySelector(".ri-account__actions select")).not.toBeNull();
    expect(text).toContain("Done in Ri with Manage access. It stops all reads from the account and keeps the records already imported.");
    expect(text).toContain("Removes what this app imported from an account or file");
    expect(text).toContain("Trip planning chat");
    expect(document.querySelector('button[aria-label="Delete imported data from hotel.pdf"]')).not.toBeNull();
    expect(render(<SourcesScreen accounts={[]} imports={[]} onConnect={noop} onManageAccess={noop} onPause={noop} onResume={noop} onContinue={noop} onDeleteImported={noop} />).text).toContain("No accounts granted to this app");
  });

  it("shares nothing by default in the scope chooser", () => {
    const { document, text } = render(<ShareScopeChooser actorLabel="Trip planning chat" sources={[{ id: "g", label: "Personal Gmail" }, { id: "t", label: "Lisbon trip" }]} operations={[{ id: "read", label: "Read records" }, { id: "write", label: "Change records" }]} onCreate={async () => undefined} />);
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
    expect(document.querySelectorAll("input[checked]")).toHaveLength(0);
    expect(text).toContain("Nothing is shared until you choose it.");
    expect(text).toContain("Trip planning chat has no access yet.");
    expect([...document.querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual(["Accounts and collections", "What it may do"]);
  });

  it("explains follow-ups, conflicts and review decisions in plain words", () => {
    const follow = render(<FollowUpDialog open defaultTitle="Check arrival details" allowDueDate onCreate={async () => undefined} onClose={noop} subject="Riverside House" />);
    expect(follow.text).toContain("Creates one task in Ri, linked to this record. Nothing is sent to anyone.");
    expect(follow.document.querySelector('input[type="date"]')).not.toBeNull();
    expect([...follow.document.querySelectorAll(".ri-dialog__foot button")].map((button) => button.textContent)).toEqual(["Cancel", "Create task"]);
    const done = render(<FollowUpDialog open defaultTitle="Check arrival details" allowDueDate={false} onCreate={async () => undefined} onClose={noop} created={{ title: "Check arrival details", dueAt: "2026-11-02" }} />);
    expect(done.text).toContain("Task created in Ri");
    expect(done.text).toContain("Due Nov 2, 2026");
    expect(render(<FollowUpDialog open defaultTitle="x" allowDueDate={false} onCreate={async () => undefined} onClose={noop} />).document.querySelector('input[type="date"]')).toBeNull();

    const conflict = render(<ConflictNotice fields={[{ label: "Check-in", mine: "14:00", current: "16:00" }]} onUseCurrent={noop} onKeepMine={noop} />);
    expect(conflict.document.querySelector('[role="alert"] h3')?.textContent).toBe("This record changed since you opened it");
    expect([...conflict.document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Field", "Your change", "Current value"]);
    expect([...conflict.document.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Keep my changes", "Use current values"]);

    const review = render(<ReviewCompare title="Check-in changed" reason="Your hotel sent an update." rows={[{ label: "Check-in", before: "15:00", after: "16:00" }, { label: "Check-out", before: "11:00", after: "11:00" }]} onAccept={noop} onEdit={noop} onDismiss={noop} />);
    expect([...review.document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Field", "Recorded", "Proposed"]);
    expect(review.document.querySelectorAll(".ri-compare__marker")).toHaveLength(1);
    expect([...review.document.querySelectorAll(".ri-button-row button")].map((button) => button.textContent)).toEqual(["Accept change", "Edit", "Dismiss"]);
    expect(review.text).toContain("Needs review");
  });

  it("labels the Ask Ri button by default", () => {
    const client = createMemoryClient();
    expect(render(<RiAppProvider client={client}><AskRiButton prompt="What is missing?" /></RiAppProvider>).document.querySelector("button")?.textContent).toBe("Ask Ri");
  });

  it("uses no em or en dashes and no semicolons in any default copy", () => {
    const pages = ["travel", "jobs", "people", "states", "forms"] as const;
    for (const page of pages)
      for (const dialog of [null, "followup", "correct"] as const) {
        const { text } = render(<UiGallery initialPage={page} initialDialog={dialog} />);
        expect(text, `${page} ${dialog}`).not.toMatch(DASHES);
        expect(text, `${page} ${dialog}`).not.toContain(";");
      }
    const sources = render(<SourcesScreen accounts={[{ id: "g", label: "Gmail", kind: "mail", granted: true, automatic: true, status: "error", error: "Failed", pending: 1, failed: 2 }]} imports={[]} shares={[]} onConnect={noop} onManageAccess={noop} onPause={noop} onResume={noop} onContinue={noop} onDeleteImported={noop} />);
    expect(sources.text).not.toMatch(DASHES);
    expect(sources.text).not.toContain(";");
    expect(baseStyles).not.toMatch(DASHES);
  });
});

describe("client hooks", () => {
  let createRoot: typeof import("react-dom/client").createRoot;
  const saved: Record<string, unknown> = {};
  beforeAll(async () => {
    const { window, document } = parseHTML('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
    for (const [key, value] of Object.entries({ window, document, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      saved[key] = (globalThis as Record<string, unknown>)[key];
      (globalThis as Record<string, unknown>)[key] = value;
    }
    ({ createRoot } = await import("react-dom/client"));
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) (globalThis as Record<string, unknown>)[key] = value;
  });

  async function mount(client: MemoryClient, element: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<RiAppProvider client={client}>{element}</RiAppProvider>);
    });
    return { container, unmount: () => act(async () => root.unmount()) };
  }
  const settle = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  it("installs one style element, once", () => {
    const first = installStyles();
    const second = installStyles(".app-extra { color: red }");
    installStyles(".app-extra { color: red }");
    expect(first).toBe(second);
    expect(document.querySelectorAll("style[data-ri-ui]")).toHaveLength(1);
    expect(first!.textContent!.match(/\.app-extra/g)).toHaveLength(1);
  });

  it("reuses the invocation ID after a failure and starts a new one after success or reset", async () => {
    let attempts = 0;
    const client = createMemoryClient({ handlers: { save: () => { if (++attempts === 1) throw new Error("Ri is busy"); return { ok: attempts }; } } });
    let api!: MutationResult<Record<string, unknown>, unknown>;
    const Probe = () => { api = useMutation("save"); return <p>{api.pending ? "pending" : api.error ?? "idle"}</p>; };
    const view = await mount(client, <Probe />);
    await act(async () => { await expect(api.run({ title: "A" })).rejects.toThrow("Ri is busy"); });
    expect(api.error).toBe("Ri is busy");
    expect(view.container.textContent).toContain("Ri is busy");
    const failedId = api.invocationId;
    expect(failedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await act(async () => { await expect(api.run({ title: "A" })).resolves.toEqual({ ok: 2 }); });
    expect(client.calls.map((call) => call.invocationId)).toEqual([failedId, failedId]);
    expect(api.invocationId).toBeNull();
    expect(api.error).toBeNull();
    await act(async () => { await api.run({ title: "B" }); });
    expect(client.calls[2].invocationId).not.toBe(failedId);
    // reset() abandons a failed logical write.
    attempts = 0;
    await act(async () => { await api.run({ title: "C" }).catch(() => undefined); });
    const abandoned = client.calls[3].invocationId;
    await act(async () => { api.reset(); });
    expect(api.error).toBeNull();
    await act(async () => { await api.run({ title: "C" }); });
    expect(client.calls[4].invocationId).not.toBe(abandoned);
    // A second run while one is in flight shares it instead of writing twice.
    const slow = createMemoryClient({ latency: 30, handlers: { save: () => ({ ok: true }) } });
    let slowApi!: MutationResult<Record<string, unknown>, unknown>;
    const SlowProbe = () => { slowApi = useMutation("save"); return null; };
    await mount(slow, <SlowProbe />);
    await act(async () => { await Promise.all([slowApi.run({}), slowApi.run({})]); });
    expect(slow.calls).toHaveLength(1);
    await view.unmount();
  });

  it("refetches on a changed opener result or input, keeps data while reloading and ignores stale responses", async () => {
    const pending: { input: Record<string, unknown>; resolve: (value: unknown) => void }[] = [];
    const client = createMemoryClient({ data: { first: true }, handlers: { list: (input) => new Promise((resolve) => pending.push({ input, resolve })) } });
    let query!: QueryResult<{ label: string }>;
    let app!: RiApp;
    let setInput!: (value: Record<string, unknown>) => void;
    const { useState } = await import("react");
    const Probe = () => {
      const [input, set] = useState<Record<string, unknown>>({ a: 1, b: 2 });
      setInput = set;
      app = useRiApp();
      query = useQuery<{ label: string }>("list", input);
      return <p>{query.data?.label ?? "none"}</p>;
    };
    await mount(client, <Probe />);
    expect(app.revision).toBe(0);
    expect(app.data).toEqual({ first: true });
    expect(query.loading).toBe(true);
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].resolve({ label: "one" }));
    expect(query.data).toEqual({ label: "one" });
    expect(query.loading).toBe(false);

    // The same values in another key order do not refetch.
    await act(async () => setInput({ b: 2, a: 1 }));
    expect(pending).toHaveLength(1);

    // An identical opener result does not refetch. A changed one does.
    await act(async () => client.emitResult({ first: true }));
    expect(pending).toHaveLength(1);
    await act(async () => client.emitResult({ second: true }));
    expect(app.revision).toBe(1);
    expect(pending).toHaveLength(2);
    expect(query.data).toEqual({ label: "one" });
    expect(query.refreshing).toBe(true);

    // A new input while the revision request is in flight wins, even if the older one resolves later.
    await act(async () => setInput({ a: 2 }));
    expect(pending).toHaveLength(3);
    await act(async () => pending[2].resolve({ label: "newest" }));
    await act(async () => pending[1].resolve({ label: "stale" }));
    expect(query.data).toEqual({ label: "newest" });
    expect(query.loading).toBe(false);
  });

  it("does not load while disabled and reports failures with the previous data kept", async () => {
    let fail = false;
    const client = createMemoryClient({ handlers: { list: () => { if (fail) throw new Error("Offline"); return { n: 1 }; } } });
    let query!: QueryResult<{ n: number }>;
    let enabled!: (value: boolean) => void;
    const { useState } = await import("react");
    const Probe = () => {
      const [on, set] = useState(false);
      enabled = set;
      query = useQuery<{ n: number }>("list", {}, { enabled: on });
      return null;
    };
    await mount(client, <Probe />);
    expect(client.calls).toHaveLength(0);
    expect(query.loading).toBe(false);
    await act(async () => enabled(true));
    expect(query.data).toEqual({ n: 1 });
    fail = true;
    await act(async () => { await query.reload(); });
    expect(query.error).toBe("Offline");
    expect(query.data).toEqual({ n: 1 });
  });

  it("stages chat drafts and host intents, coalesces context and debounces location", async () => {
    const client = createMemoryClient();
    let app!: RiApp;
    let announce!: ReturnType<typeof useAnnounce>;
    const Probe = () => { app = useRiApp(); announce = useAnnounce(); return null; };
    const view = await mount(client, <Probe />);
    await act(async () => {
      await app.ask("Prepare me for the Northstar interview.");
      await app.openSources();
      await app.manageAccess();
      await app.openExternal("https://example.com/posting");
      await app.openDirections("Rua da Prata 80, Lisbon");
      await app.download({ name: "trip.ics", mimeType: "text/calendar", text: "BEGIN:VCALENDAR" });
    });
    await expect(app.openExternal("http://example.com")).rejects.toThrow();
    expect(client.links).toEqual([
      "/__host/chat?prompt=Prepare%20me%20for%20the%20Northstar%20interview.",
      "/__host/sources",
      "/__host/manage-access",
      "https://example.com/posting",
      "https://www.google.com/maps/search/?api=1&query=Rua%20da%20Prata%2080%2C%20Lisbon",
    ]);
    expect(client.downloads).toEqual([[{ type: "resource", resource: { uri: "file:///trip.ics", mimeType: "text/calendar", text: "BEGIN:VCALENDAR" } }]]);
    expect(client.calls).toEqual([]);

    await act(async () => {
      for (let index = 0; index < 8; index++) app.context({ selected: [`trip-${index}`] });
      app.setLocation("/trips/lisbon?tab=itinerary");
      app.setLocation("/trips/lisbon?tab=bookings");
    });
    expect(client.contexts).toEqual([]);
    await settle(220);
    expect(client.contexts).toEqual([{ selected: ["trip-7"] }]);
    expect(client.links.filter((link) => link.startsWith("/__host/location"))).toEqual([]);
    await settle(200);
    expect(client.links.filter((link) => link.startsWith("/__host/location"))).toEqual(["/__host/location?to=%2Ftrips%2Flisbon%3Ftab%3Dbookings"]);
    // An oversized context is skipped with a warning instead of failing in the host.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await act(async () => app.context({ blob: "x".repeat(9000) }));
    await settle(220);
    expect(client.contexts).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    await act(async () => announce("Moved to Applied"));
    await settle(80);
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Moved to Applied");
    expect(view.container.querySelector(".ri-toast")?.textContent).toBe("Moved to Applied");
    await view.unmount();
  });

  it("tracks the theme pushed by the host", async () => {
    const client = createMemoryClient();
    let app!: RiApp;
    const Probe = () => { app = useRiApp(); return null; };
    await mount(client, <Probe />);
    expect(app.theme).toBe("light");
    await act(async () => client.setTheme("dark"));
    expect(app.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
