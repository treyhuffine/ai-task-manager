# One app kit for Ri and standalone apps

**Direction agreed November 10, 2026.** Trey wants the open-source app kit to be the default way apps are built in Ri, and to remain its own separate project that runs without Ri. Apps must be able to use Ri's integrations. The mechanics below are proposed until each phase's checks pass. This document is meant to be shared between the two repositories, so every agent working on either one builds toward the same thing.

Where this document conflicts with these, this document is current:

- Ri: [local-apps.md](local-apps.md) (the builder and app model), [local-apps-modularity.md](local-apps-modularity.md) (extracting `packages/app-kit` into an open-source repository), [local-apps-implementation.md](local-apps-implementation.md) §8 (builder templates).
- The kit: `SPEC.md` "Independence and host adapters", "Connectors for app code and agents" and "Ri installation and chat context", and `docs/architecture.md` "Optional hosts and connectors". The kit keeps its own product decisions for standalone use. This document adds what hosting in Ri and reaching Ri's integrations require.

## Names

The kit's public names are not settled. Use the kit's placeholders in documents and its `identity.ts` constants in code. Never write the working names into Ri's source.

| Placeholder | Meaning | Today's working value |
| --- | --- | --- |
| `{{PRODUCT_NAME}}` | The kit's display name | App Builder |
| `{{CORE_PACKAGE_NAME}}` | The core package | `@app-builder/core` |
| `{{CLI_NAME}}` | The command | `app-builder` |
| `{{CONNECTOR_CONTRACT_NAME}}` | The connector contract | `app-builder-connectors` |

The repository is currently `github.com/dynamismlabs/mcp-app-builder`.

Terms used here:

- **The kit**: that repository. Its core package, starter, reference apps and build skill.
- **Ri's current app kit**: `packages/app-kit` in Ri (`@ri/app-kit`). It has two halves. The *host half* (runtime supervision, the view host, contract validation, the MCP service transport) stays as Ri's hosting layer. The *authoring half* (the app SDK, templates and `@ri/app-kit/ui`) is what the kit replaces.
- **Hosted**: a kit app that Ri starts, supervises and shows.
- **Standalone**: a kit app running on its own, on a laptop, a Mac service, Docker or Cloudflare.

Ri reads the kit's names from the kit itself (its `identity.ts`, its core `package.json` and `bin`). The one Ri-side constant is the folder Ri keeps the kit in, `modules/kit`, which stays the same when the kit is renamed.

## The decision

1. **One way to build apps.** New apps in Ri are kit apps. Ri's builder creates them with the kit's `create` and guides the agent with the kit's build skill. There is no second app SDK to keep in sync.
2. **Ri is a host, not a framework.** The same app folder runs hosted in Ri or standalone. A personal app in Ri needs no accounts or sign-in. Ri can also publish it to its own address when the owner wants that.
3. **Ri's integrations reach kit apps through one connector interface,** spoken over MCP in both modes, with Ri's grants, approvals and revocation applied to every call.
4. **Ri's current app kit is frozen for authoring.** Existing apps keep running on it. New app-facing features go into the kit. Included apps move over once the kit covers what they use.

### Why

Ri's current app kit and the kit already share the same core idea. An action is defined once with a name, description, Zod input and output, who may call it, what it changes and whether a retry is safe. A button and an agent call the same action, and both kits generate a `contract.json` from the definitions. Both keep app-owned SQLite with append-only, checksummed migrations and data outside the source. Both use MCP Apps for views and an `AGENTS.md` per app. Two frameworks for the same idea would drift, and a build skill written for one would contradict a builder built on the other.

They differ where the kit is broader. It runs outside Ri, has its own sign-in and sharing, lets Claude and ChatGPT connect directly over OAuth, serves a real website with offline capture on a phone, deploys to Cloudflare, and ships security fixes to every customized app through a package upgrade. Ri's current app kit is stronger in exactly one area, Ri's own services: integrations, Ri actions, schedules, per-chat grants and approvals. Those are host services, so they belong in Ri's host layer and reach apps through an interface the kit defines.

## Goals

- A person asks Ri for an app and gets a kit app that works in Ri with no setup, accounts or ports.
- The same app can leave Ri (its own address, Cloudflare) or arrive in Ri (import an existing kit app) without a rewrite.
- App code calls Ri's integrations the same way in both modes.
- Agents building apps in Ri and outside Ri read the same build skill and conventions.
- The kit stays independent. It has no runtime dependency on Ri, and Ri-specific protocol identifiers live in one kit module.

## Not in scope

- A public marketplace, hostile-code isolation, or running other people's apps. The trust profile stays owner-trusted native code ([local-apps-modularity.md](local-apps-modularity.md#security-boundaries)).
- Changing how Ri hosts connected MCP services ([connected-mcp-apps.md](connected-mcp-apps.md)). A published kit app is just another connected MCP server to Ri.
- Two live copies of one app's data. Each data directory has one owning server, as both kits already require.

## How the modes compare

| | Hosted in Ri (default) | Standalone, personal | Standalone, shared or public |
| --- | --- | --- | --- |
| Who starts it | Ri, on first use or a schedule | `{{CLI_NAME}} serve`, or its installed service | The service, Docker or Cloudflare |
| Users | None. Ri vouches for each caller | The local owner, no account | The app's own accounts, sharing roles and invitations |
| Who may call it | Holders of a Ri-issued pass only | Requests on this computer, with Host and Origin checks | Signed-in users and OAuth-connected assistants |
| Screen | The app's MCP view inside Ri | The app's website on loopback | The app's website and MCP view |
| Phone | Through Ri's remote address, behind Ri's sign-in | Not reachable | Its own address, with offline capture |
| Data | The instance data directory under Ri's home | `~/.local/share/<app-id>` or `APP_DATA_DIR` | The same, or D1 and R2 on Cloudflare |
| Ri integrations | Ri's pass, given at startup | OAuth to the owner's Ri | OAuth to the owner's Ri |
| Outside assistants | Through Ri, under Ri's grants | Local MCP, or the stdio bridge | OAuth directly to the app |

## 1. Hosted mode

### What already exists

Ri already hosts a server app this way. Finances runs with `runtime.protocol: "mcp-http-v1"` in its `plugin.json` (`packages/app-kit/src/runtime.ts`, `packages/app-kit/src/mcp-service.ts`):

1. Ri spawns the package's `entry` through its owned runner with a private IPC channel, `cwd` at the package and a cache-scoped environment.
2. Ri sends `initialize` with `version: 1`, `instanceId`, `dataDir`, `cacheDir`, `packageDigest`, `contractDigest`, `contract`, the integration `bindings`, a `broker` `{ url, credential }`, a `generation` and an assigned loopback `port`.
3. The app binds `127.0.0.1:<port>` and replies `{ version: 1, contractDigest, endpoint: "http://127.0.0.1:<port>/mcp" }`. Ri refuses any other endpoint.
4. Ri qualifies the service. Its tool count, every tool's input and output schema, and its resources must match the installed contract and manifest exactly.
5. For each call, Ri asks the app over IPC for `authorizePrincipal` with `actorId`, `role` (`owner-ui`, `agent` or `background`), `scopeRef`, `ticket` and `expiresAt`. The app returns a short-lived `credential`. Ri calls the MCP tool with `Authorization: Bearer <credential>` and, for a scoped caller, `x-app-invocation-ticket`. When the call ends, Ri sends `revokePrincipal`.
6. A tool error can carry a typed code in `_meta["com.ri/errorCode"]`. Otherwise Ri shows a generic failure.

The kit's apps already serve standard MCP and MCP Apps on a loopback port. On November 10, Reading Log 0.2.0 answered on `127.0.0.1:4310/mcp` without sign-in, listed `list_books`, `save_book` and `update_book` with `_meta.ui.resourceUri`, served `ui://reading-log/main` as `text/html;profile=mcp-app`, and saved a record through MCP.

### Kit changes

- **A hosted start entry** in the core's Node export. It implements the handshake above as *host protocol 1*. On `initialize` it opens the normal Node platform with the given `dataDir`, takes the data lock, serves on the given port and replies with the endpoint. It answers `authorizePrincipal` and `revokePrincipal`. The Ri-specific identifiers (`mcp-http-v1`, `com.ri/errorCode`, the ticket header) live only in this module.
- **Pass-only access when hosted.** Loopback owner mode trusts any program on the computer. Hosted mode turns that off. Every request needs a live pass from the host, and sign-in, account and OAuth routes are disabled. A pass maps to the stable local owner viewer (`local-owner`) with an audience from its role: `owner-ui` is `user`, `agent` is `agent`, and `background` is `schedule`. Using `local-owner` means the existing first-account adoption works when the app later leaves Ri and turns sign-in on.
- **No native install step.** Ri installs app dependencies with `--ignore-scripts` (`packages/app-kit/src/build.ts`), so a native addon never gets its binary. The core's Node platform opens SQLite with `better-sqlite3`, which needs one. Add a `node:sqlite` driver behind the core's existing async Drizzle proxy and use it when hosted. Ri runs apps on its pinned Node 26.5, where `node:sqlite` needs no addon, and Ri's current app kit already relies on it. Whether standalone Node also switches is the kit's call, after the populated-data tests pass on both drivers.
- **Typed errors.** Map the core's errors (`TRPCError` codes, `CredentialReconnectRequired`) to Ri's error codes in the hosted module.
- **Richer action metadata**, so the mapping to Ri's contract is one to one instead of lossy. This also helps standalone hosts:

| Field | Kit today | Kit after | Ri contract |
| --- | --- | --- | --- |
| `audience` | `user`, `agent` | adds `schedule` | `user`, `agent`, `schedule` |
| `effect` | `read`, `write`, `delete` | `read`, `app_write`, `external_write` (delete is an `app_write`) | same |
| `retry` | `safe`, `unsafe` | `read_safe`, `idempotent`, `never_automatic` | same |
| `examples` | none | at least one synthetic input and output per action | required |
| `visibility` | none | `app`, `model` or `both`, default `both` | same |
| `timeoutMs` | none | optional, host default | required (the adapter fills the default) |

  Examples double as preview fixtures and test data. The handler signature stays `(ctx, input)`, since that's the kit's API and only Ri's adapter reads the contract.
- **Screen entrypoints.** Tools that open a screen declare `_meta["openai/ui"].entrypoints` (OpenAI's MCP extensions), so Ri's connected-app host, ChatGPT and other hosts list the screen. Hosted, the adapter copies them into `plugin.json` `ui.entrypoints`.
- **A view that works in Ri's sandbox.** Ri shows a view in an opaque frame with no network access and no browser storage. The kit's `dist/mcp.html` is already one inline file. It must get all data through tool calls, photos through `read_photo`, and must still save without IndexedDB, with the outbox sending immediately when storage is unavailable.
- **Optional entity descriptors and a view context schema**, mapped to Ri's contract `entities` and `contexts`, so records can be `@` mentioned and a view's selection reaches the chat. `client.select` already publishes bounded selection context.
- **Use-time workflow skills.** An app may ship `skills/<name>/SKILL.md` for using the app in chat (not for building it). The adapter lists them as contract `workflows`.

### Ri changes

- **The kit, pinned.** Ri carries the kit as a git submodule at `modules/kit`, pinned to a tested commit, until the core is published. Then Ri pins the package version instead. An installed Ri release carries the packed core and starter. Packing runs from a staged copy without workspace dev dependencies, as `packAppKit` already does for Ri's current app kit.
- **A package adapter** (in `src/lib/local-apps/`, behind the existing feature flag). From a kit app's `dist/contract.json` and built output it writes the Ri `plugin.json` (`runtime.kind: "node"`, `protocol: "mcp-http-v1"`, `mcpPath: "/mcp"`, `entry` set to the hosted entry, `start: "on-demand"`, `ui.resources` from `dist/mcp.html`, entrypoints, integration requests) and Ri's `contract.json`. It generates the contract from the same definitions the server advertises, so qualification passes by construction.
- **A build adapter** `kit-v1` beside `ri-esbuild-v1` and `next-standalone-v1`. It installs the frozen lockfile and runs the kit's build through Ri's owned runner and bundled toolchain.
- **One pnpm.** Ri builds apps with its bundled pnpm (12.14.0 today, see `packages/app-kit/src/build.ts`). The kit's starter declares the same major, so a hosted build and a standalone build resolve the same lockfile.
- **Nothing else in the host path changes.** Grants, approvals, the Apps library and rail, ⌘K, Ask Ri, the conversation panel, backups and removal all work through the existing instance model.

## 2. Building apps in Ri

- **New app** runs the kit's `create` from `modules/kit` into the draft directory. The result is an ordinary kit app with its own lockfile, a vendored core tarball, an `AGENTS.md` and the build skill at `.agents/skills/<build skill>`.
- **The skill travels with the app.** The kit's `create` also writes a relative link at `.claude/skills/<build skill>`, so Claude Code finds the skill as well as Codex. The builder chat already runs in the draft folder, so every harness discovers it without Ri naming it.
- **Ri's builder brief keeps only host facts.** Those are the draft path, that the preview has its own data and fixture integrations, `build_app_draft` to build and validate, that the owner activates with Use app, and never activating, granting itself access, reading Ri credentials or editing Ri source. It no longer describes how to write an app. The skill does that (`src/lib/local-apps/brief.ts`).
- **Preview** runs the hosted entry against a draft data directory with the existing fixture principal. Integration calls return fixtures.
- **Use app** and **Change app** keep the existing activation flow: a validated digest, permission review, a stopped-data snapshot before a migrating update, and the activation journal.
- **Core upgrades are explicit.** Each app pins its own core version. Upgrading is a builder action that bumps the dependency and lockfile and runs the app's tests, which is the kit's stated upgrade path. Ri's pinned kit version only decides what new apps start from.
- **Import** accepts an existing kit app folder. Ri builds it, hosts it and restores its data into the instance directory with the kit's restore.

## 3. Ri's integrations in kit apps

### One interface, two credentials

The kit adds an optional connector module, so app code makes one call in either mode:

```ts
const accounts = await ctx.connectors.accounts("gmail");
const found = await ctx.connectors.call("gmail.search_messages", { query: "receipt" }, { account: accounts[0].id });
```

(The method names are a sketch. The kit settles them under `{{CONNECTOR_CONTRACT_NAME}}`.)

The module is an MCP client of Ri. Only the credential changes:

- **Hosted:** Ri gives the app a process credential at startup, and Ri's call into the app carries the invocation ticket. A call made while serving that request carries both, so it runs under the intersection of the app's grant and the caller's grant. A chat that may only read cannot make the app send. Background work uses the app's background grant.
- **Standalone:** the owner connects the app to their Ri once, the way ChatGPT connects today ([mcp-oauth.md](mcp-oauth.md)). Ri's consent page names the app and lets the owner pick which accounts and actions it gets. Ri issues a token for that app installation, which the app stores with the core's encrypted `putCredential`. A missing or revoked token raises the kit's reconnect state. Ri must have a remote address for an app outside the computer to reach it, as ChatGPT also requires.

Credentials stay on the app's backend. They are never in a view, loader data, tool results or exports. Ri never hands provider tokens to an app.

### What Ri serves

Ri already projects its integration engine as MCP tools at `/api/integrations/mcp`, over the same gated `runAction` every caller uses (scope, approval, redaction, audit). Today it serves harness sessions. Extend it to app callers instead of growing another API:

- Accept an app process credential (plus ticket) for hosted apps, and an OAuth token with an app-connectors scope for standalone apps.
- Filter the tool list to the app's grant, intersected with the caller's grant when a ticket is present. Recheck grant revision and package digest on every call, as the current broker does.
- Include Ri's own app actions (`RI_APP_ACTIONS` in `src/lib/local-apps/ri-capabilities.ts`: tasks, notes, `ai_text`, `extract_text`, `read_web_page`) as tools under the same grant.
- A write that needs approval pauses the way app writes already do. The approval shows on the app's page and as the amber count on the Apps row. A chat-initiated call shows the card in that chat.
- Revoking an app, an account or a grant stops the next call in both modes.

The bespoke HTTP broker (`/api/local-apps/broker/v1`, which carries only `gmail.messages.read` today) stays for Finances until Finances moves.

## 4. Publishing and moving

- **Hosted is the default and needs no deploy.** A phone opens the app wherever Ri opens, through Ri's remote address and Ri's sign-in ([remote-access.md](remote-access.md)).
- **Give it its own address.** From the app's page, Ri runs the kit's own commands in the app folder. That's an installed always-on service on the Mac with `APP_URL` and sign-in on, or `deploy cloudflare`. The kit refuses to listen on the network without sign-in, and Ri keeps that rule. Cloudflare needs the owner's own one-time Cloudflare sign-in. Ri doesn't store that credential in the app.
- **Moving is a data move, not a copy.** Ri stops the hosted instance, takes the kit's whole-app backup, restores it at the destination and stops supervising. The first account adopts the `local-owner` records. Ri then connects to the published app as a connected MCP server and shows it in Apps as before. The old instance is archived read-only and never writes again.
- **Coming back** is the same move in reverse, through Import.

## 5. Ri's current app kit and the included apps

- **Freeze the authoring half.** Don't add app-facing features to `@ri/app-kit/sdk`, its templates or `@ri/app-kit/ui`. Put them in the kit. Fixes and hosting work continue.
- **The host half stays in Ri.** That's runtime supervision, the view host, contract and manifest validation, the MCP service transport, grants, schedules, backups and removal. The plan in [local-apps-modularity.md](local-apps-modularity.md) to extract all of `packages/app-kit` into an open-source repository is replaced. The kit is the open-source project.
- **Move what apps rely on into the kit as optional modules:** the Gmail and Calendar sync steps, account store and mail index (`@ri/app-kit/sources`), zone-aware time (`@ri/app-kit/time`), the scope store, job queue and blob store (`@ri/app-kit/data`), and the shared UI kit where the kit's starter lacks it.
- **Then move the included apps,** each with its records preserved: Bookmarks, Travel, Job Search and People first. Finances moves last, since it is a Next.js service with its own Plaid flow.

## Build order and checks

Each phase lands in both repositories and is checked on a disposable Ri home ([environments.md](environments.md)), never production.

| Phase | Done when |
| --- | --- |
| 1. Hosted, personal | From a plain request, New app in Ri produces a kit app. Claude Code and Codex builder chats both find the build skill. The preview runs with separate data. Use app installs it. The view opens in Apps, the rail, ⌘K and beside a chat. Selecting a record reaches the chat, and an agent's write refreshes the view. Data survives a Home restart. A local request without Ri's pass is refused. Disabling the app stops its process. The same folder still runs standalone with `pnpm dev` and its own data directory. |
| 2. Integrations, hosted | A hosted app reads Gmail from a granted account. A chat with a narrower grant can't make it read more. A write pauses for approval. Revoking stops the next call. The preview gets fixtures, never live accounts. |
| 3. Publish | Ri moves a populated hosted app to an always-on Mac service and to Cloudflare. Record IDs and file bytes match. Ri no longer owns the old copy, and Ri shows the published app as a connected app. |
| 4. Integrations, standalone | A Cloudflare app connects to the owner's Ri over OAuth, gets only the chosen accounts and actions, and calls Gmail. Revoking in Ri stops it. With Ri unreachable, the app shows a retry state and keeps its checkpoint. |
| 5. Included apps | Each moved app keeps its records and passes its existing tests on the kit. Ri's current app kit then has no authoring users. |

## Who changes what

| Phase | The kit | Ri |
| --- | --- | --- |
| 1 | Hosted entry, pass-only access, `node:sqlite` driver, typed errors, richer action metadata, entrypoints, sandbox-safe view, `.claude/skills` link, pnpm major | `modules/kit`, package adapter, `kit-v1` build adapter, New app through `create`, slimmer builder brief |
| 2 | Connector module with the hosted credential | App callers on `/api/integrations/mcp`, grant intersection, Ri actions as tools |
| 3 | Nothing new beyond existing serve, deploy and recovery | Publish and move flows on the app page, archive the hosted copy |
| 4 | Connector module with OAuth to Ri and reconnect state | App-connectors OAuth scope and consent, per-app revocation |
| 5 | Sources, time, data and UI modules | Move each included app, retire the authoring half |

## Rules for agents on either side

- Read this document before changing how apps are built, hosted or connected. If a change contradicts it, update this document first, in the same change.
- Don't add app-facing features to Ri's current app kit. Add them to the kit.
- Don't write the kit's names in Ri's source. Read them from the kit.
- Kit code never imports Ri. Ri protocol identifiers live only in the kit's hosted module.
- One owning server per app data directory. Never start a second writer to inspect data. Use the app's actions or a stopped snapshot.
- Apps reach outside services only through the connector module. Never store or return provider tokens.
- Keep the contract mapping in §1 one to one. A new field on either side needs its counterpart or an explicit default here.

## Open questions

1. Public names for the kit (its placeholders above).
2. Whether a hosted app's full website should also be reachable through Ri, for example by proxying `/apps/<slug>/` to its pages, or only its MCP view. Proposed: MCP view only in phase 1, decided again after phase 3.
3. Whether the hosted entry stays in the kit's core or becomes a small separate package, so standalone apps don't carry host-protocol code. Proposed: in the core, since hosted access has to be tested against the core's auth.

## Evidence so far

- November 10, 2026: Reading Log 0.2.0 built and served from a clean clone with a throwaway data directory. Tools, view resource and a write over MCP worked without sign-in as described in §1. Its tools carried no `_meta["openai/ui"].entrypoints`.
- Ri's handshake, qualification, broker limits, `--ignore-scripts` installs and integrations MCP were read from the code cited above on the same day. The kit's core depends on `better-sqlite3` 12.11.1 at runtime.
- Not yet tested: a kit view rendering inside Ri's sandbox, the outbox without IndexedDB, and any of the phase checks.
