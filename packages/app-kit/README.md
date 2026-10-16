# Ri app kit

Versioned library exports for contracts, backend SDK, supervision, browser views, build adapters and qualification fixtures. The browser export does not import Node. All runtime state belongs to the host-created engine instance. HostServices supplies authority and storage, never ambient Ri imports.

The native driver runs owner-trusted code. It is not a hostile-code sandbox. Dependencies and builds use the same trust profile. Unsupported profiles and service targets fail before code execution.

Run `pnpm build`, `pnpm typecheck` and `pnpm test` in this package. Qualified targets and evidence are recorded in the Ri implementation documentation.

Host lifecycle tests can use `createOfflineAppTemplate` and `buildOfflineAppFixture` from the testing export. They share the production template and invoke the real compiler against this checkout's installed SDK, React and Zod, then validate and run the bundled artifact. These fixtures do not download dependencies or exercise the build-owner wrapper. Production template creation still packs the SDK and resolves a lockfile, and production builds still install frozen dependencies through the owned runner. Installer and build-parent termination checks belong at that kit boundary, rather than making every host approval or backup test depend on registry availability.

Managed MCP services expose a bounded private `status` summary: readiness, worker started/running and last-run times, pending setup, and at most 100 summarized jobs. `AppEngine.serviceStatus` reads an existing owned transport without starting a stopped service, validates the public summary schema, and rejects a changed process generation. It carries no records, endpoint or credentials. Ri displays it in native app settings.

An optional `ui.access` declaration names an account-selection path and a human callback with `actorId` input and `scopeRef` output. Ri opens that path as the human owner with the chosen host actor in `query.hostActor`. The app binds that actor in its opener scope, renders its own account/permission choices, and returns an opaque reference. Native Ri controls hold the reference and save it only when the human confirms the host grant. No copying of actor IDs or sign-in credentials is required. A guest cannot replace the opener's bound actor.

## Data, sources and time

Node-side helpers for apps that keep records in the host data directory. They start no timers and run inside the caller's transactions.

- `@ri/app-kit/data`: forward-only `migrate` with immutable checksums, opaque list cursors (`encodeCursor`, `decodeCursor`, `pageOf`, `listInputShape`), typed save or conflict results (`writeResultSchema`), `createSettings`, `createScopeStore` with `allows`, `allowsAll` and `scopeFingerprint`, a fair bounded `createJobQueue`, digest-addressed `createBlobStore`, `redact` and `boundText`. A scope store resolves the owner and previews to everything, a schedule to its granted accounts, and a chat or agent to the scope its current grant selected, checking actor, operation, revocation and instance on every call.
- `@ri/app-kit/sources`: `gmailSyncStep` and `calendarSyncStep` read one provider page per call with a body and time budget, alternate current changes with backfill, and recover an expired history or sync token with a bounded rescan. `createAccountStore` remembers per-account setup and checkpoints, and `createMailIndex` makes repeated delivery idempotent. Message parsing covers MIME text and HTML, attachments, calendar invitations, bulk and no-reply signals and RFC 5322 address lists, normalizing only the domain.
- `@ri/app-kit/time`: zone-aware dates with the Intl database only, including DST gap and repeated-hour detection, zone labels and date ranges written without dashes.

Packages that declare `runtime.access: "ri-access-v1"` receive `invocation.access` (`actorId`, `scopeRef`, granted `accounts`) on every call and name the account in `capability(name, input, { binding, account })`.

## UI kit

`@ri/app-kit/ui` is the shared React 19 kit for included app views (Travel, Job Search, People). It is browser only, has no dependencies beyond React, and works inside the opaque, network-free view sandbox: styles are one inline `<style>` element, icons are inline SVG, and nothing touches storage, cookies or the network. It matches the neutral Finances palette in light and dark. Color appears only for a real warning, failure or completed state, always beside text or a shape.

```tsx
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RiAppProvider, AppShell, SectionTabs, SectionPanel, Button, AskRiButton, DataTable, LoadingState, ErrorState, useQuery } from "@ri/app-kit/ui";

interface Trip { id: string; title: string; dates: string }
const sections = [{ id: "trips", label: "Trips" }, { id: "sources", label: "Sources" }];

function TravelView() {
  const [tab, setTab] = useState("trips");
  const trips = useQuery<{ items: Trip[] }>("list_trips", { limit: 50 });
  return (
    <AppShell
      eyebrow="Travel"
      title="Your trips"
      context="Upcoming and past trips"
      primaryAction={<Button variant="primary">Add booking</Button>}
      secondaryActions={<AskRiButton prompt="What is still missing for my next trip?" />}
      tabs={<SectionTabs label="Travel sections" panelId="travel-panel" value={tab} onChange={setTab} items={sections} />}
    >
      <SectionPanel panelId="travel-panel" value={tab}>
        {trips.error ? <ErrorState message={trips.error} onRetry={trips.reload} />
          : !trips.data ? <LoadingState label="Loading trips" />
          : <DataTable caption="Trips" rows={trips.data.items} rowKey="id" columns={[{ key: "title", label: "Trip" }, { key: "dates", label: "Dates" }]} />}
      </SectionPanel>
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(<RiAppProvider><TravelView /></RiAppProvider>);
```

### Connection and data

`RiAppProvider` calls `connectApp()` once, installs the styles and provides `useRiApp()`, `useQuery()`, `useMutation()` and `useAnnounce()`. Pass `client={createMemoryClient({ data, handlers })}` to render without a host in tests, galleries and fixtures. The memory client records `calls`, `contexts`, `links` and `downloads`, and `emitResult()` simulates a host refresh.

| `useRiApp()` member | What it does |
| --- | --- |
| `data`, `revision` | The latest opener result. `revision` counts changed refreshes after the initial result, so queries refetch when records change. Identical refreshes are ignored. |
| `theme`, `connected`, `error` | Host theme (also set on `document.documentElement.dataset.theme`), connection state and the last connection or context error. |
| `call(action, input, { invocationId })` | Calls a granted action. |
| `context(state)` | Model context for Ri chat. Coalesced: only the latest state, about 150 ms after changes settle, at most 10 a second, identical states skipped. Keep it to IDs, filters and revisions. States over 8,000 bytes are skipped with a console warning. |
| `ask(prompt)` | Stages editable text in Ri's native composer through `/__host/chat?prompt=`. Trimmed to 2,000 characters. Never sends, never grants access. |
| `openSources()`, `manageAccess()` | Opens `/__host/sources` and `/__host/manage-access`. |
| `setLocation(path)` | Remembers the view location (tab, day, selection, filters) in the host URL through `/__host/location?to=`, with replace semantics. Debounced 300 ms, latest wins. |
| `openExternal(url)`, `openDirections(address)` | HTTPS links only, opened by the host after confirmation. Directions open Google Maps outside the view. |
| `selectFile()`, `download({ name, mimeType, text \| base64 })` | Native host file selection and download. |

`useQuery(action, input, { enabled })` returns `{ data, error, loading, refreshing, reload }`. It refetches when `revision` changes or the input's content changes (key order does not matter), keeps the previous data while reloading so lists never flash, and ignores responses that arrive out of order.

`useMutation(action)` returns `{ run, pending, error, reset, invocationId }`. Each logical submit gets an invocation ID that is kept after a failure, so "Try again" repeats the same write and the app deduplicates it. A new ID starts after success or `reset()`. A second `run` while one is in flight returns the same promise. `run` rejects on failure, and `error` holds the message.

### Components

- Layout and navigation: `AppFrame` and `useAppLayout()`, `AppShell` (eyebrow, one `h1` title, context line, `secondaryActions`, one `primaryAction`, `tabs`, `notice`), `SectionTabs` and `SectionPanel`, `SplitView` and `Inspector`, `Toolbar`, `SearchField`, `SegmentedControl`, `FilterChips`.
- Content: `Button` and `ButtonRow`, `StatusLabel`, `Notice`, `EmptyState`, `LoadingState`, `ErrorState`, `InlineError`, `KeyValueList`, `DataTable`, `Timeline`, `SourceLine`, `Avatar`, `AvatarLabel`, `Menu`.
- Forms and dialogs: `Dialog`, `Field` and `useField()`, `TextInput`, `TextArea`, `Select`, `Checkbox`, `RadioGroup`, `DateInput` (local `YYYY-MM-DD`), `MoneyInput` (emits integer minor units and an ISO currency).
- Ri workflows: `AskRiButton`, `FollowUpDialog`, `ConflictNotice`, `ReviewCompare`, `SourcesScreen`, `ShareScopeChooser`, `LiveRegion` and `useAnnounce()`.
- Formatting: `formatDate`, `formatDateRange`, `formatInstant`, `relativeDay` (from the time export), `formatMoney(minor, currency)`, `parseMoneyInput`, `plural(count, one, many)` ("3 bookings").
- Reference: `UiGallery` (`initialPage`, `initialTab`, `initialDialog`, `detailOpen`) renders every component with fictional Travel, Job Search and People records on `createGalleryClient()`, a memory client.

`SourcesScreen` keeps three things visibly separate: an account connected to Ri, access granted to this app, and automatic updates for it. Pass only the accounts the host reports for the app. It shows history range, coverage and partial coverage, last successful update, pending and failed counts, and separates Pause updates, Disconnect (in Ri through Manage access, keeps records) and Delete imported data (confirmed in a dialog). `ShareScopeChooser` selects nothing by default. `FollowUpDialog` previews one Ri task and says that nothing is sent. Drive its `onCreate` with `useMutation` so a retry reuses the invocation ID.

### Responsive and accessibility rules

- Layout follows the app container, never the viewport: narrow below 700 px (one content column), medium from 700 px, wide from 1,150 px. `.ri-app` is an inline-size container, and `useAppLayout()` exposes the measured layout. Views must work in a 360 px companion frame, at 390 px and at 200% text zoom without horizontal page scrolling.
- `SplitView` shows list and inspector side by side only at wide widths. Otherwise an open record becomes a dedicated screen with a Back button that names its destination. The list stays mounted, so filters, scroll and selection survive, and focus returns to the row. Never three columns. The caller owns selection and filters.
- `DataTable` renders stacked row cards in narrow containers. Rows are keyboard selectable (arrow keys, Home, End, Enter, Space). Use `Menu` as the keyboard alternative to drag and drop, such as "Move to stage".
- Every control has a label, focus is always visible, information is never hover only, and `Dialog` traps focus, closes on Escape and restores focus. Use `useAnnounce()` for results such as "Saved" or "Moved to Applied".
- Copy has no em or long dashes and avoids semicolons. No sparkle or magic icons. Classes are prefixed `ri-`, and tokens are `--ri-*` custom properties on `:root` and `:root[data-theme="dark"]`. Add app CSS with `installStyles(extraCss)`.

`test/ui.test.tsx` covers server-rendered semantics, copy rules, money and layout logic, and the hooks on a memory client. `test/ui-gallery.test.ts` renders `UiGallery` in StrictMode under the view CSP in an installed Chromium (Chrome, Brave or Playwright's Chrome for Testing) at 1280, 760, 390 and 360 px in light and dark. It checks page overflow, console errors and external requests, keyboard order and focus rings, tab keys, dialog focus trap and Escape, menu keys, narrow detail screens with Back, table row keys, the Delete imported data confirmation, and the real MCP Apps bridge (chat draft, sources, manage access, location, coalesced context, invocation ID reuse, refresh revisions). Screenshots go to `artifacts/ui-gallery/`. Rebuild with `node scripts/build.mjs` before running them, since the tests import the built `@ri/app-kit/ui`.
