# Local apps and the built-in builder

October 8 clarification: this document describes the Ri-managed origin of apps. The [connected-app contract](app-connector-mentions-spec.md#9-connected-mcp-apps-and-a-common-view-host) adds externally connected MCP services with UI to the same Apps destination, source picker and view host. Local ownership is not a requirement for an app experience. Both origins use MCP Apps for views, with separately qualified capabilities and authority adapters. Connected apps retain their provider's storage/runtime and Ri's existing account connections. They do not require the builder, a local package or Finances. The older deferral of independently running service attachment does not exclude this defined connected-MCP slice.

Product direction and implementation handoff, October 7, 2026, updated October 8. The MVP is implemented in Ri and enabled by default. Start with [the handoff](local-apps-handoff.md), [verified evidence](local-apps-progress.md) and [the runbook](local-apps-runbook.md). This document preserves the product direction and future boundaries.

This records the owner's current direction and the design discussion that grew out of chat `01a11269-1dc0-77fd-a5f6-2fac63be12fb`. It supersedes the hosting-only scope and assumptions in [plugins-spec.md](plugins-spec.md) where they conflict. That earlier document and its evaluations remain useful research, not an independently authoritative backlog. This design can change as we learn. Future ideas below are not MVP acceptance requirements.

The [implementation contract](local-apps-implementation.md) settles package fields, metadata, transport, browser embedding, grants, scheduling, builder lifecycle, code ownership and the ordered verification checklist. It is authoritative for MVP mechanics. [Finance integration](local-apps-finance.md) defines the first included service app, its actual missing adapters and the path to a curated catalog. [Modularity and open-source distribution](local-apps-modularity.md) defines the reusable engine boundary and what must remain under Ri's control. Implementation status is tracked in the implementation contract, not inferred from this product narrative.

## Product promise

Describe something you wish existed. Ri helps you build it, use it, and change it as your life changes, all inside Ri.

The consumer experience is one app, an assistant, and the tools the person has made or added. Repositories, ports, package managers, database drivers, and server setup are implementation details. A person can ask for a kitchen renovation planner, a collection tracker, or a view of receipts from Gmail, try it beside the conversation, and keep using it.

Apps can also emerge from existing work. A useful interactive result can become a saved view through Keep this, then acquire records or a scheduled action when needed. A saved view does not need its own database. The goal is less maintenance and fewer decisions for the person, including the decision to build an app at all.

An app should be usable through both its interface and the assistant. A button, a chat request, and a scheduled invocation should reach the same defined action, with the authority appropriate to each caller. Apps should share enough visual conventions to feel at home while retaining freedom over their interface.

## Current decisions

| Concern | Direction |
| --- | --- |
| Execution location | Local, on the device running the Ri Home. No Cloudflare or other hosted execution dependency. |
| App storage | App-owned files inside its instance directory. SQLite and raw files are both valid. Ri does not impose a universal record database. |
| App backend | A supervised local Node process for small apps. A separate service adapter hosts Finance's existing server. Static apps need no backend process. |
| Frontend | A self-contained HTML bundle and the shared view bridge. Plain HTML, React, Vue, Svelte, or another toolchain producing supported artifacts can work. |
| Public navigation | A generic `/apps/[[...path]]` Ri page, resolving a locally unique slug and the rest of the path. |
| Shared tools | Selected Ri actions and connectors, including Gmail, through a scoped app caller and Ri's existing domain operations. |
| Schedules | Extend the existing local scheduler to invoke app actions. Do not introduce another cron system. |
| Builder | Chat, source, and an actual preview inside Ri, retaining the creation context for later changes. |
| App understanding | A machine-readable contract, bundled workflow skills, shared view/chat context, and concise human and maintainer documentation. |
| Dependencies | App-specific locked dependencies, built outside Ri's own dependency tree, against a small supported runtime/toolchain set. |
| MVP audience | Personal apps created or explicitly trusted by the owner. A process and directory alone are not a hostile-code sandbox. |
| Distribution | Portable Agent Plugins package with namespaced Ri runtime metadata, standard skills and MCP Apps views. Compatibility is qualified per host. A public marketplace and stronger execution isolation are later work. |
| Updates | Preserve data, validate a draft, and support an explicit replace/restart. Full rollback orchestration is outside MVP. |
| Code organization | An extractable app kit plus native Ri integration. Prove the boundary in Ri's workspace before a separate repository. A second consumer app is optional and outside MVP. |

These are working engineering choices, not claims about functionality already shipped.

## Navigation and everyday use

Use **Apps** as the primary navigation label. It names something a person can open and use. Plugin remains a useful term for a distributable extension package, but a person should not need to understand packaging to open Finance. Keep the existing Connectors and Skills names for those distinct capabilities.

**Revised 2026-10-08.** The first build put an Agents / Apps switch under the rail's Create and Search, with its own list in Apps mode. It made three stacked switchers (the mode, the Agents | Recent tabs, the Agents group label) and hid the work while in Apps mode. The rail now treats an app as a place, like the Board or the Calendar ([rail.md](rail.md)):

- An **Apps** row in the places, with a chevron. Resting on it or clicking it opens your apps beside the rail, in the wide rail and the collapsed strip alike, the way Agents opens in the strip: All apps (the library at `/apps`), each installed app by name with a lettered tile, then New app. An app whose action waits on an approval puts an amber count on the row.
- ⌘K has Open apps and one Open <app> per installed app. The phone's More view lists Apps.
- The library's header carries New app, with the other starting points and Import behind More. The command palette has Open apps. The phone's More view lists Apps.

The paragraphs below describe the earlier Apps-mode rail and are kept for the record. Where they conflict with the list above, the list wins.

Put a compact **Agents / Apps** switch directly below the Home row at the top of the power rail. These are persistent destinations, not an additional tab inside the current Agents/Recent list. Selecting Apps replaces the rail's contextual controls and list and opens the app library at `/apps`. Selecting Agents restores its existing list and last non-app view. Home, global attention indicators and Settings remain reachable. This uses Ri's current wide/collapsed rail rather than adding another permanent sidebar.

In Apps mode the rail contains, in order:

1. **Create app**, opening a builder conversation and preview.
2. **All apps**, returning to the library, with Browse and Import available there.
3. **Installed**, listing each active app once. Clicking Finance opens its actual interface, not an installation details page.
4. **Drafts**, only when there are drafts, returning to the retained builder conversation.
5. Quiet **Connectors** and **Skills** links to the existing management surfaces. They do not become duplicate app libraries or appear as launchable apps when they have no interface.

Keep the first installed list alphabetical. Drafts are most recently changed first. Do not add user-maintained folders, a second tagging system or marketplace categories to the rail. Saved Finance views are records within Finance and initially appear inside its interface, not as a growing nested tree in Ri's global rail. A later pin-to-rail feature can follow actual use.

The library shows installed apps first. With no apps, offer one Create app action and a few included starters, beginning with Finance. Browse opens the curated catalog. Import accepts a supported package. Package/runtime terminology and developer setup belong in details, not the main Add flow. The public marketplace can later occupy the same Browse destination.

An installed app opens in the main area with a small host header: app name, **Ask Ri**, **Change app**, and an overflow menu for access, activity, export and archive. Its interface gets the available space by default. Ask Ri opens the existing chat panel beside it, scoped to the selected app/view and its current permissions. Closing chat leaves the app usable. Errors such as a stopped service or missing access occupy this same surface with an actionable recovery, never a blank iframe. Loading a view must not initiate a new build.

The same app can open beside an existing conversation. A protected entity link, an explicit Open action on a tool result, or the existing chat's app picker opens its view without moving the person to a different conversation. MVP supports one app panel per chat. Changing panels preserves the chat and its unsent input. Apps declares global and conversation entrypoints against the same resources and actions. It does not create separate app installations, data stores or business logic for those surfaces. File viewers and composer entity search remain later entrypoints.

Shared context is required for both surfaces. When someone selects three Finance transactions, changes a filter or stages a scenario, their next question can refer to that exact state. Share a small, authorized structured snapshot with the current chat, rather than a screenshot or the entire app database. Unapplied edits are labeled as such. Context updates do not submit a chat message, run a model or grant permissions. An agent's successful write refreshes the relevant view while preserving compatible presentation state. Each tab and conversation has its own binding. The implementation contract specifies revisions, stale-state handling and the read-only context resolver.

**Create app** and **Change app** open the builder with chat beside a real preview. Source/logs are secondary. Create begins with a simple prompt such as "What would you like this app to help you do?" A starter can supply the first draft. Use this installs a new app or activates the reviewed change and moves the person into normal use. A draft stays available when they leave. Ordinary app chat does not silently become a source-editing session. Asking Finance for a different chart can update a saved view through Finance's tools, while Change app edits the package itself.

In a collapsed rail or on tablet, Agents and Apps remain separate labeled icon buttons near the top. Opening the Apps chooser uses the existing accessible flyout behavior, without permanently widening the page. All apps, an installed app or a draft then opens in the main area and closes the chooser. On a phone, expose Apps from the existing More destination and use a full-width chooser. Opening a deep `/apps/<slug>/...` link selects the corresponding Apps context on every layout.

The URL owns the current app/view/draft. Preserve each mode's list position and the previous non-app location as navigation state, not as a competing source of truth. Keep chat IDs and unsent input through mode changes. Back/Forward restores the matching rail and main view. Switching contexts does not stop a background job or discard a draft. Feature-off behavior restores today's rail without initializing app state.

This proposed navigation is separate from the current implemented rail described in [rail.md](rail.md). Verify expanded and collapsed entry, keyboard focus/Escape, direct links, Back/Forward, empty library, installing a starter, resuming a draft, opening Finance, optional chat, and return to an existing execution without lost input. Do not mark navigation complete from an Add button alone.

### Relevant OpenAI references

The official [Build plugins](https://learn.chatgpt.com/docs/build-plugins) guide describes creation through a conversation with Plugin Creator. [Package your plugin](https://developers.openai.com/plugins/build/plugins) covers packaging and creator-assisted scaffolding. [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui) describes the MCP Apps resource and iframe bridge. [Extensions](https://developers.openai.com/plugins/build/extensions) covers sidebar entrypoints, companion panels, deep links and settings. These are useful interaction and interoperability references, not a requirement to adopt OpenAI's hosting or reproduce its catalog. Ri's local runtime and navigation contract above remain authoritative for this implementation.

## Keep the experiment removable

The owner wants to build and use this feature, then remove it entirely if the experience is not worth keeping. Reversibility is an acceptance criterion for the initial trial. Begin inside Ri's repository with an explicit workspace package for the reusable engine and a small native host adapter. This keeps one checkout and release during the experiment while exercising the same dependency boundary that a separate open-source repository would use. Extraction is secondary to making Ri excellent, as defined in [the modularity decision](local-apps-modularity.md).

Proposed ownership:

| Owned surface | Responsibility |
| --- | --- |
| `packages/app-kit/` | Portable package/contract validation, app SDK, build templates, runtime supervision, framework-neutral view controller and conformance fixtures |
| `src/lib/local-apps/` | Ri instance registry, actor grants, chat/context and skill adapters, scheduler/backup integration and dispatch into existing Ri capabilities |
| `src/components/local-apps/` | Native library, builder, app shell, conversation panel, approvals and app-specific status |
| `src/app/apps/[[...path]]/` | Thin navigation entry into the subsystem |
| App-owned instance/draft directories | Source, generated dependencies, built assets, records, and bounded runtime output |
| A private local-apps metadata namespace under `getConfigDir()` | Trial instance registration, grants, and scheduling metadata, kept outside shareable app packages and the core Home database |

The implementation contract names the file store and code seams. Keep the import direction deliberate: the app subsystem calls a small Ri host interface, implemented with existing domain operations. Existing tasks and notes should not depend on app internals. The explicit connections into core code are navigation, tRPC/orchestrator registration, builder chat context, connector caller/approval attribution, scheduler dispatch, and Home service startup/shutdown. They are real changes, but can remain small and identifiable. Record them in the implementation notes as they land.

Apps default to enabled, with `RI_LOCAL_APPS=0` as an explicit Home-level opt-out. Disabled means no app process startup, no app schedule callbacks, no app metadata initialization, and unavailable app actions/routes. Hiding the navigation alone is insufficient. The flag does not reverse work already done by an app and is not a substitute for an isolated test Home.

### Separate the code trial from the data trial

Production currently runs from the primary checkout, so build in a dedicated Git worktree on a feature branch. Use that worktree's dependencies and build output. Launch it against a dedicated disposable Home on a free port through [the existing isolated launcher](../scripts/isolated.ts). It clears inherited Home/session overrides, validates resolved paths, rejects shared production/dev/test roots, avoids installing the machine-wide skill, and refuses an occupied port. Check its resolved paths before starting the test server. See [environments.md](environments.md).

Use synthetic app records and fixture connectors first. Builder chats and any test task/note handoffs may use existing tables in the disposable Home. Do not copy production connector credentials into it. A separately authorized live connector test can follow, with the understanding that actions on the external account persist independently of the test Home.

### Avoid core migrations for the removable trial

Keep new app-platform metadata in its own versioned namespace initially. Reuse existing chat storage in the disposable Home. Do not change core task/note tables, stored policy defaults, or existing entity representations for the experiment.

For the first scheduled app action, add a gated app-dispatch participant to the existing local scheduler tick, reusing its time calculations and relevant controls while app schedule state lives in the feature-owned metadata store. Do not introduce a second timer/cron system. The fuller shared trigger/run target described later is the intended integration after product validation, not a requirement to migrate the core schema merely to evaluate the app loop. If the implementation requires a core migration earlier, make that persistence decision explicit rather than quietly expanding the trial.

Any migration applied to a running Home remains immutable under the repository's migration rules, including a disposable Home. Turning off a feature does not turn off an already registered migration. Removing a landed schema feature requires a forward migration, not deleting its journal history. Avoiding core migrations in the initial trial is the cleanest way to keep abandonment inexpensive.

### Removal is something to verify

The trial must demonstrate disabling an app, stopping and reaping its owned processes, detaching schedule callbacks, and invalidating its broker authority. Record the files and shared test records created by the feature so cleanup has a bounded target. Stop app writers before exporting, archiving, or deleting data. Preserve records unless the owner explicitly requests their removal.

To abandon the whole unmerged experiment, stop its exact server/process tree, retain any wanted work, and remove its dedicated worktree and disposable Home when authorized. Production then has no feature code, data, or credentials to unwind. After integration into a shared checkout, removing the code means reverting the feature changes and its documented registration points, not simply deleting a folder.

Run a removal check: start the normal application with the feature disabled, exercise core tasks/notes/chat, and confirm no app processes, scheduled invocations, active app credentials, or required app metadata remain. Also verify the application builds after the feature changes are reverted in an isolated checkout. This tests architectural removability. It is separate from the future security claim that untrusted apps cannot escape their execution environment.

Removal cannot unsend email or undo other real external effects. A task or note deliberately created in a shared Home is ordinary user content, not disposable merely because an app made it. A disposable Home plus fixture connectors is what makes the complete initial experiment inexpensive to discard.

## The unit we build and install

An **app package** uses the portable Agent Plugins layout and contains shareable code, browser assets, a contract, optional workflow skills, documentation, and optional sample data. Its Ri runtime details live under a namespaced extension in `plugin.json`. An **installed instance** has its own stable ID, local slug, data directory, runtime state, account bindings, and grants. Keeping these separate allows the same package to be used by different people without sharing their data or credentials. A portable package is not a promise that every host can execute every included capability.

A **view** is an interface into an app. An **entity** is a record the app can identify and expose to Ri, regardless of how that record is stored. An **action** is a named operation with validated inputs and outputs. A **capability** is something Ri permits the app to use, such as reading messages from a chosen Gmail connection or creating a Ri task.

Proposed layout, resolved through the application's path helpers:

```text
<app-root>/apps/<instance-id>/
  package/
    plugin.json              portable identity plus namespaced Ri runtime metadata
    mcp.json                 optional, only for qualified MCP distribution targets
    contract.json            generated actions, schemas and entity descriptions
    skills/<workflow>/       optional SKILL.md and non-private supporting resources
    README.md                purpose, usage, example prompts and data behavior
    AGENTS.md                how to develop, verify and maintain this app
    src/                     editable source
    dist/                    built browser assets and optional server bundle
    package.json             when this package has JavaScript dependencies
    pnpm-lock.yaml           when dependency resolution is needed
  data/                      app-owned durable files, optionally SQLite
  cache/                     disposable runtime state
  logs/                      bounded diagnostics
```

Draft build directories live in a separate draft area and use separate test data. The implementation contract specifies their paths and the versioned metadata schema. Grants and connection bindings belong to Ri's private metadata, outside the shareable package. Runtime credentials are issued per process/invocation. Installed source and data must be included in the Home's preservation/export policy. Do not put the app only in a disposable execution worktree.

The filesystem layout is an ownership and lifecycle convention. It becomes a security boundary only when an execution sandbox enforces it. Never describe setting `cwd` as restricting filesystem access.

## Local execution and the shared path

Ri remains the single visible application and owns the external URL. A package registers a slug such as `kitchen`. The URL `/apps/kitchen/quotes/123` resolves the installed instance and its internal view path. A stable instance ID, not the editable slug, keys data, permissions, jobs, and entity references. Slug uniqueness is per Home. Package identity can become publisher-qualified for distribution later.

The catch-all page renders Ri's app shell and an isolated view. It does not import arbitrary generated source into the Next.js application or allow a package to override Ri routes. A nested view URL, refresh and Back must all work through the same generic host. The initial build bundles assets into one HTML resource, so no per-app public asset server is required.

The frontend-facing Ri management and action APIs use the existing tRPC conventions. The embedded view talks through a small framework-neutral bridge. Static resources, downloads, and any external protocol adapters can use dedicated HTTP routes. New procedures invoke domain operations, not another route handler.

For a backend, Ri starts the app with its pinned Node runtime, supplies its data/cache paths and a scoped broker connection, checks readiness, and records the owned process. Small apps use private child-process IPC supplied by the SDK, without inventing an HTTP server. The service adapter uses a private authenticated loopback MCP connection for Finance and other qualified service packages. The browser never connects directly to that port.

The supervisor lives in the Home's long-lived HTTP/Next server process, initialized after its Home ownership checks and shared across bundles through `processState`. The desktop controller does not own a second app registry. A closed browser does not stop the app. Ri stops only processes it owns. Give actions deadlines, retain bounded logs, surface a failed app locally, and bound repeated start attempts.

MVP simplicity: start a small backend on first use or a scheduled invocation and keep it until the Home stops or the app is disabled. A service with declared background work, such as Finance, can start with the Home while enabled. Idle eviction and shared process pools can follow measurement. A static app is only assets and a contract. App SQL or CPU work should not block Ri's synchronous core database/request thread.

### Scheduling is a separate responsibility

The earlier Dynamic Workers reference described executing application code on demand. It was not a cron replacement and is not a dependency of this local design.

Ri's existing scheduler decides when a user-scheduled app action runs. The removable trial adds a participant to its existing tick and keeps app schedules/invocations in feature metadata, without changing core trigger/run tables or launching an AI chat. Persist the instance, action, validated input, timezone, enabled state, and job authority. Reuse timing, active hours, maintenance and ownership. Fuller integration into shared run history can follow product validation.

The current scheduler advances a slot before dispatch. It is not an exactly-once delivery guarantee. MVP records success, failure, or an interrupted outcome and makes retry explicit for writes with uncertain effects. Do not automatically retry an external send merely because an HTTP response was lost. Individual actions can provide deduplication with a stable invocation ID.

App work continues while the Home is awake, even when its UI is closed. A sleeping or offline Home cannot execute jobs. The implementation contract defines one overdue dispatch per schedule on wake, without replaying every missed slot. Existing service apps may keep their own durable workers. Finance does, and Ri must not schedule the same sync twice. Stronger platform delivery guarantees and incoming public webhooks are later decisions.

## Storage belongs to the app

Ri provides a stable durable directory and its lifecycle. The app chooses SQLite, JSON, Markdown, images, or another supported file format. It owns its schema, indexes, migrations, and calculations. It can choose a database library supported by the runtime. It cannot assume its files live in Ri's repository or add its tables to Ri's core database.

The default template should use SQLite for relational records and normal files for larger content. Ri currently packages Node 26.5.0, which has `node:sqlite`. A local in-memory probe on October 7 confirmed that this exact runtime can open a database and query SQLite 3.53.3 without an app-installed native addon. The Node API is marked release candidate, so pin and qualify the adapter rather than assuming compatibility across arbitrary Node versions. This does not change Ri's own better-sqlite3 database implementation. [Node 26.5 SQLite documentation](https://nodejs.org/download/release/v26.5.0/docs/api/sqlite.html)

App-owned SQL is allowed in the app's own code. Ri routes and orchestrator handlers continue to use shared domain/query functions for Ri data. App files remain separate from the core Home database and its migration history.

SQLite backups must be consistent, including WAL state. For MVP, quiesce app actions and stop the app before copying its data, or use a declared consistent backup operation. Copying only an open `data.db` is not a complete backup policy. A simple stopped-app snapshot is enough initially. A general live backup service and point-in-time restore can follow.

Updates do not replace `data/`. Archiving an app stops its execution and preserves its data. Exporting a reusable package excludes live data, credentials, account identifiers, logs, and build-chat content by default. A personal backup that includes data is a separate operation.

### Shared entities without shared tables

Use Ri tasks and notes when those are the actual concepts. A kitchen quote can reference a real Ri task, and a plant record can link to a note. The app accesses those through allowed operations, rather than opening Ri's database.

An app exposes the meaningful entities it owns through descriptors and typed actions. A descriptor names a record type, stable identifier, title, supported read/list/search operations, and how to open it. Schemas describe the returned representation, not necessarily the physical storage layout. Pagination belongs in list/search contracts.

Entity references carry an installed instance ID, entity type, and record ID. Ri asks the authorized app adapter to resolve them. An app can store records in raw files and still expose useful entities. A viewer-only app can expose no owned entities at all.

This is enough for links and agent understanding in MVP. A universal graph, automatic cross-app joins, a global schema editor, and a generic record viewer are future possibilities. Agent access is checked when resolving records, not granted by possession of a link.

## Frontends and dependencies

The host contract is browser output: HTML, CSS, JavaScript, embedded assets, and a bridge. React is a convenient default template, not a requirement. Raw HTML and a compiled React bundle must both be test fixtures for the host. Other languages/frameworks can fit the same contract when their supported tooling produces a self-contained HTML resource.

The small-app runtime supports static browser bundles plus an optional Node backend. The separate service adapter initially qualifies Finance's Next server, with its MCP view embedded through the same host. This does not make arbitrary SSR websites embeddable. Native executables, Python environments, and other framework server adapters are future work.

Dependencies are resolved within the app's draft/package, using pnpm and a lockfile for JavaScript packages. Build to app-specific artifacts. Never install generated dependencies into Ri's root `package.json` or borrow Ri's `node_modules` as an undocumented runtime API. A shared package cache may save disk while each app keeps its own resolution.

Supply a known builder toolchain through Ri. The installed app should run without requiring the consumer to install developer tools. The initial backend dependency envelope is bundled JavaScript, the pinned Node built-ins, and explicitly qualified runtime adapters. Unknown native addons, installers, and OS services require additional support rather than silently modifying the host. Dependency installation and build scripts execute code and carry the same trust concerns as the finished app.

Use an optional Ri component kit and theme tokens for familiar controls. Keep a small plain-JavaScript bridge usable by every framework. Apps never receive the Electron bridge, Home bearer token, or direct access to the parent DOM.

### A URL namespace is not a browser sandbox

Generated HTML executes in an opaque-origin `srcdoc` iframe inside a fixed host-owned relay frame. Both use `sandbox="allow-scripts"`. Restrictive content policies deny guest networking and let the containing relay block guest navigation to network URLs. The implementation contract defines this restricted resource profile and its qualification tests. A different path does not isolate cookies or DOM authority, and a different port alone does not isolate cookies for the same hostname. The `/apps/...` URL is the parent shell's navigation, not permission to execute package HTML as Ri's authenticated page.

Resource loading, nested routes, message-source validation, mutation-origin checks, and the local/desktop/remote-viewer path must be verified as one small host slice. Reuse findings from the existing MCP Apps evaluations where they help, without inheriting their whole roadmap. Browser requests must not be able to elevate an app callback into a general authenticated Ri request.

Use the MCP Apps view message protocol for the shared host. A locally created app gets a simple bridge and IPC backend and does not need to implement an MCP server. Finance uses its existing MCP server through the service adapter. Broader MCP Apps resource compatibility remains separate from this network-free profile. [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)

## Access to Ri tools, including Gmail

This is a first-class part of the app contract. A receipt app requests particular Gmail operations and an account binding, then invokes Ri's existing connector engine. Ri retains provider credentials and applies the existing validation, consent, approval, redaction, and audit behavior.

The new piece is an authenticated **app-instance caller** and its allowed operations. An app does not inherit the authority of its builder chat or receive the Home's general local token. Ri supplies a scoped runtime credential or private broker channel, records the app identity on calls, and rechecks grants on every request. Connector access can be revoked without rebuilding the app.

For example:

1. A receipts app declares that it needs message search and read operations.
2. The person chooses an existing Gmail connection and grants the supported access.
3. Ri resolves the live connection and calls the existing `runAction` path.
4. The app stores selected receipt records in its own data folder.
5. Sending a follow-up email would require the separate send capability and the applicable approval policy.

The description shown to the user must match what Ri can enforce. A natural-language purpose such as "read receipts" is not a technical restriction to receipt messages. If the granted action can search a whole mailbox, explain that scope accurately unless the broker implements a narrower constraint.

For interactive agent use, the invocation is limited by the app's grants and the initiating actor's allowed scope. Scheduled actions use explicit app-job authority granted by the owner, not an expired chat credential. Build previews use fixture connectors by default and explicitly approved connections for live testing.

Ri's connector engine already has caller identity and account filters. Its current approval UI and grant matching are centered on chat sessions. App approvals need their own instance/invocation attribution and a visible return path. Simply passing `{ type: 'app' }` would leave different apps sharing the existing anonymous approval bucket. Extend the shared approval identity deliberately. A background job that needs an unanswered approval must surface that state rather than silently approve itself or hang forever.

The same broker principle applies to selected task/note operations and, when needed, bounded AI calls through Ri's subscription harness helper. Normal app actions run as code without an AI call. The SDK names APIs from the real supported registry rather than inventing connector action IDs.

## Self-documenting apps

Self-documentation belongs in MVP. It makes the app understandable to its user, discoverable to the assistant, maintainable by a fresh agent, and eventually distributable.

| Surface | What it says | Source of truth |
| --- | --- | --- |
| App summary | What it helps with and when to use it | Short authored package metadata |
| Action reference | Input/output schemas, effects, errors, examples, retry behavior | Generated from action registration |
| Entity reference | Record names, stable IDs, representations, read/search/open operations | Entity descriptors and their schemas |
| Requested access | Ri operations, connector/toolkit needs, runtime requirements | Validated package manifest |
| Granted access | Actual installed accounts and current grants | Ri's instance metadata, never package prose |
| Human guide | How to use it, example prompts, what it stores and does in the background | Concise `README.md` maintained with the app |
| Maintenance guide | Build/test commands, structure, storage format, invariants, migrations, known limits | `AGENTS.md` inside the package |
| Workflow skills | When to use the app, how to combine its tools, how to handle missing inputs and what a good result includes | Optional standard `skills/<name>/SKILL.md` resources shipped with the app |
| Current condition | Version, health, last job outcome, actionable failures | Runtime state, not static documentation |

Use one action definition to generate the runtime registry, contract schemas, agent tool descriptions, and technical reference. Do not maintain a second handwritten list of supposedly available tools. Where record definitions already exist, derive the exposed schema from them instead of making a second model that can drift.

Descriptions should explain semantics that types cannot: units, meaning of states, authoritative records, side effects, and what to do after an uncertain result. Marking an action read-only is useful metadata, but a claim written by an app is not proof of its behavior.

The builder updates the guides alongside implementation, validates that declared entrypoints/actions exist, and tests examples against fixtures. Contract and documentation ship with the same installed version. Static discovery reads the generated contract without executing arbitrary app startup code. The planned `describe_app` action returns the relevant slice for a selected app. The implementation contract defines the agent surface.

Normal chat context includes only short descriptions of available apps. Load detailed contracts or maintenance instructions when needed, subject to scope. A fresh agent should be able to operate the app from its contract and change it from its source and maintenance guide without requiring the entire creation transcript.

Workflow skills are distinct from API documentation and developer instructions. Finance can include monthly review and refund investigation workflows. Installing, updating or archiving the app changes the availability of those bundled skills in the same operation, without copying them into every global/project skill folder. Ri's existing skill manager remains the entrypoint for skill authoring, validation and session delivery. App-specific operations enforce permissions even if a skill suggests calling them. A workflow that existing skills and tools already satisfy does not need a new UI or background process merely to appear in Apps.

App documentation does not grant permissions, authorize external sends, override Ri's instructions, or assert that checks passed. Marketplace documentation and app content are untrusted input. Keep account bindings, user records, credentials, and private build conversations out of distributable documentation.

## MVP build experience

Reuse the existing chat-plus-artifact interaction, but make the right-hand side the running app preview. Source and logs are available when useful. Builder state must preserve the person's draft conversation and selected app when navigating.

1. The user describes a need. The assistant starts a draft and asks only consequential questions.
2. Ri supplies a supported template, scoped build directory, and test data. The assistant writes the app and its documentation.
3. The person tries it beside the chat. A plain preview can work without connector grants.
4. Build, contract validation, and a few meaningful behavior checks run. Requested access is explained in the language of the actual operations.
5. Use this registers the package, chooses a unique local slug, binds the allowed connections, and opens the installed app.
6. Change app reopens the builder against the app's actual current source. A successful build replaces the executable package and restarts that app while preserving its data directory.

The creation chat remains attached for continuity. It is additional context rather than the only specification. A small durable description of intended behavior lives in the package. No external Git repository is required to create or use an app.

MVP updates need a separate draft/build output and an activation point so a failed build does not overwrite the working package. Keep existing data, stop concurrent writers for schema changes, take a consistent snapshot before a destructive migration, and show a failed update honestly. We do not need automated rollback graphs, reversible migration generators, or live traffic switching to prove the product.

## Execution freedom and future isolated instances

An independent local process is already an app instance in the lifecycle sense. Strong isolation requires an OS sandbox, container, or VM boundary as well.

The initial local-process profile is explicitly for owner-trusted code. Sanitize the environment, issue only scoped broker credentials, constrain normal file/network access where supported, and contain crashes. Do not advertise this as safe execution of arbitrary marketplace code. Code running as the same OS user may still reach Home files or credentials outside the broker if no stronger sandbox prevents it. Node's permission system is documented as protection against mistakes in trusted code, not a malicious-code security boundary. [Node permission model](https://nodejs.org/download/release/v26.5.0/docs/api/permissions.html)

The reusable runtime has an explicit execution-driver boundary for stronger isolation. A repository split, an MCP transport, a worktree or a harness permission dialog does not supply that enforcement. Build/install execution and the app backend both need containment before an untrusted-code profile can be enabled. A package requiring unavailable isolation fails closed. The host may choose a stricter profile than requested but never silently downgrade it. See [modularity and security ownership](local-apps-modularity.md#security-boundaries).

This is an MVP scope boundary, not a claim that local code is harmless. AI-generated code, dependencies, and build scripts do not become trustworthy automatically. The first rollout must make the local-code trust model clear. General third-party installation is a separate release gate requiring containment and adversarial tests.

The later runtime contract can support an isolated service environment per app, including Python or a private Postgres service. The package would declare required services. Ri would provision and manage them through a qualified backend. An app would not install Docker on the host or receive the Docker socket. Persistent data volumes would stay separate from replaceable images.

Containers and VMs already provide the underlying technology. The product opportunity is making these environments automatic and understandable inside a consumer assistant. On macOS, Docker Desktop runs its Linux engine in a VM, so resource use, packaging, startup, updates, and host networking require real product work. A lightweight shared VM with separate app environments may eventually be more practical than a full VM per tiny app. This is a hypothesis to measure, not an MVP dependency. [Docker Desktop networking architecture](https://docs.docker.com/desktop/features/networking/)

## Marketplace direction

A marketplace distributes packages, templates, and optional app instructions. Installing a package creates a fresh local instance with its own data and grants. Downloading a package never means copying the author's connected accounts or inheriting their permissions. Apps continue to run locally.

Capture package identity, version, runtime compatibility, declared dependencies, requested capabilities, license, and source provenance in the format early. Personal packages can start with local identity. Global publisher identity, signing, review, discovery, payments, reputation, and automatic updates are later systems.

The distinctive distribution experience could be: install an app someone else made, then ask Ri to adapt it to your situation. Preserve the distinction between the published package and the person's customized copy. Merging upstream updates into local changes is future work. MVP can retain the customized source and avoid silently overwriting it.

Personal data should be excluded from screenshots, examples, and packages used for publication. Export/install on another local Home is enough to exercise the package boundary initially. A public marketplace launch must wait for a credible third-party execution, dependency, and permission model.

## MVP scope and proof

Build one end-to-end local loop with the following acceptance criteria. The checks below record the scoped MVP requirements. Completion is supported by the linked qualification evidence.

- [x] Register, list, open, stop, and archive an app instance with a stable ID and unique slug.
- [x] Route `/apps/<slug>/<remaining-path>` generically, including direct navigation, refresh, Back, and assets.
- [x] Render plain HTML and one compiled frontend through the same isolated host and bridge.
- [x] Run an optional backend under the pinned local runtime with readiness, ownership, bounded logs, and visible failure.
- [x] Persist app-owned SQLite or files across app, viewer, and Home restarts. Updating source preserves the data directory.
- [x] Expose validated actions and meaningful entity references to the UI and an authorized chat. Open the same view globally and beside an existing conversation.
- [x] Share the current selection, filters and staged changes with the correct chat, refresh after authorized agent writes, and reject stale/revoked/cross-chat context.
- [x] Let an app call selected Gmail operations on a chosen connection through the existing connector runtime. Prove denial and revocation as well as success. Use fixtures for automated tests and explicitly authorized accounts for any live test.
- [x] Ensure approval grants and account choices cannot be borrowed by another app or invocation.
- [x] Run one deterministic app action using the existing scheduler while the app view is closed. Show failures and paused approvals.
- [x] Create, preview, activate, and modify an app entirely from Ri, with source and documentation retained.
- [x] Validate the portable manifest, generated contract and bundled workflow skills. Demonstrate operation and maintenance from a fresh chat using the installed package, including requests that should not invoke it.
- [x] Build and exercise the app kit without Ri imports using a minimal fixture host. Preserve Ri's complete creation, access, contextual chat and update experience through that same public package boundary.
- [x] Build and run on the claimed supported local runtime without relying on the developer's global modules or tools.
- [x] Export a reusable package without live records or credentials, then install it as a fresh local instance.
- [x] Prove the removable trial: disabled startup does no app work, owned processes and grants are cleaned up, core workflows still work, and reverting the feature builds in an isolated checkout.

Use a generated receipts or household-project app to test local storage, a connector, entity references, and one schedule together. Add a tiny raw-HTML app to prevent a hidden React requirement. Finance is the first included service package in the implementation sequence, using its independent server/data/worker through the generic adapter. Its larger footprint must not dictate every small app's shape. See [the Finance integration contract](local-apps-finance.md) for its empty-home UI, principal setup and actual connector gaps.

Before broadening scope, a person should be able to keep real records, close Ri's viewer, reopen the app, ask for a modest change, and continue using the same records. Measure time to first useful result, successful repeat use, ability to make the second change, and how much maintenance falls back on the person.

## Ideas retained for later

These are recorded so they remain available without becoming prerequisites for the first working product.

- Strong OS/container/VM isolation for app code and build pipelines, qualified separately on each supported platform.
- Managed service bundles with Python, Postgres, native dependencies, resource quotas, and idle shutdown.
- Public marketplace, publisher verification, signed releases, curation, reviews, payments, and reporting.
- Rich app version history, automatic rollback where schemas permit it, migration rehearsals, and recovery tooling.
- Consistent live backups, selective restore, storage quotas, retention, and app-independent record inspection.
- More durable job delivery, carefully defined retries/catch-up, event subscriptions, and verified incoming webhooks.
- Search across authorized app entities, contextual app suggestions, and richer cross-app relationships.
- Turning a conversation result into a saved view and progressively adding persistence or actions.
- Shared-app collaboration, multiple instances of one package, import/export across Homes, and coordinated updates.
- Additional framework/language adapters, broader MCP Apps import/export, and independently running service attachment.
- Maintaining customized marketplace apps alongside upstream updates.
- A separate open-source app-kit repository, developer CLI/playground and host adapters, after Ri parity and extraction tests pass. A standalone consumer builder has its own product gate.
- Automated diagnosis and proposed repairs with user-visible changes and bounded execution.

All of these retain local execution as the current product assumption. Hosted execution is not part of this plan.

## Existing seams

The following were checked in this repository during the design pass. They are starting points, not evidence that apps are already implemented.

| Existing code | Useful seam and required extension |
| --- | --- |
| [Skill builder brief](../src/lib/skills/builder-brief.ts) and [skill lifecycle](skills.md) | Draft/build/try interaction and retained chats. App lifecycle needs its own implementation rather than routing arbitrary app changes through the skill manager. |
| [Connector runtime](../src/lib/integrations/runtime.ts) | Existing shared runtime and account access. Add scoped installed-app calls without duplicating provider implementations. |
| [Connector MCP route](../src/app/api/integrations/[transport]/route.ts) | Existing tool projection and runtime invocation pattern. Keep local-app transport independent of a mandatory MCP server. |
| [Connector approvals](../src/lib/integrations/approval.ts) | Current chat-bound grants and display. Add app/invocation identity and a usable approval surface. |
| [Connector caller types](../packages/integrations/src/core/types.ts) | `app` and `schedule` caller kinds already exist. App authorization and grant isolation still need implementation. |
| [Scheduler](../src/lib/scheduler/runner.ts) and [run dispatch](../src/lib/runs/dispatch.ts) | Reuse local timing and ownership. Add direct app-action dispatch rather than invoking a harness for ordinary code. |
| [Packaged runtime](../src/lib/service/runtime.ts) and [runtime version pin](../desktop/package-preflight.mjs) | Bundled Node and qualified platform versions. App supervision/build tooling are new work. |
| [Request-origin checks](../src/lib/auth/request-origin.ts) | Keep authenticated mutations protected while adding the iframe bridge and any app transport. |
| [Earlier host evaluation](plugins-evaluation-agent-views.md) | Concrete experiments with embedded apps. Reuse evidence and fixtures without adopting every prior milestone. |

The [implementation contract](local-apps-implementation.md) resolves the initial iframe/resource profile, supervisor owner, app-caller grants, build kit and ordered tests. Begin with its registry/static-host slice. Finance then proves the service boundary through the same app library and view host. No marketplace, container orchestration, or generalized storage engine is needed to begin.
