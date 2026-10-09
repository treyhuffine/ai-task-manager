# Local apps modularity and open-source distribution

October 7, 2026. Architecture decision for [local apps](local-apps.md), with mechanics in [the implementation contract](local-apps-implementation.md). This specifies the agreed package boundary. The workspace library and independent packed consumer are implemented and qualified. No external repository has been created. See [verification evidence](local-apps-progress.md).

## Shared source checkout

October 8 refinement: the owner wants to iterate on Ri and Finances in one worktree. Finance source is maintained at `apps/finances` as an explicit pnpm workspace package. It keeps its own service, database, migrations and public app contract. Workspace development uses public app-kit exports, and portable packaging exports a self-contained consumer with an independent lockfile and SDK tarball. Ri still imports no Finance business code. See [Finances development](finances-development.md).

## Decision and priorities

Pending connected-app refinement: factor the browser protocol and containment primitives into `packages/mcp-apps-host`, shared by the local app-kit adapter and Ri's connected-MCP adapter. Preserve the existing app-kit browser export as a compatibility re-export. This neutral library has no Ri account/database or local runtime/builder imports. Removing the local-app experiment must leave connected views usable. The [connected-app contract](app-connector-mentions-spec.md#9-connected-mcp-apps-and-a-common-view-host) specifies the boundary and separate qualification. This is an internal workspace extraction, not a new daemon or external repository, and the existing qualification below does not claim it is complete.

Ri owns the complete experience of creating, using and changing an app. Build the reusable engine as an explicit workspace package, `packages/app-kit`, with a small native Ri adapter. Qualify that package with a minimal second host. Extract it into a separate open-source repository when the boundary is proven and external reuse has a concrete consumer. A separate consumer application is not a prerequisite for either extraction or plugin sharing.

The priorities, in order, are:

1. Make Ri's experience excellent, including setup, everyday use, contextual chat, updates, recovery and removal.
2. Keep app packages, tools, workflow skills and browser views portable where the relevant standards fit.
3. Make the engine independently reusable and open source without forking it for Ri.
4. Consider a standalone builder if people outside Ri have a workflow that a CLI, their coding agent and a small preview host do not serve well.

Repository, process, protocol and product boundaries are separate decisions. A library maintained elsewhere can still run inside Ri's Home and present native Ri controls. An app backend remains a separate supervised process regardless of where the supervisor source is maintained. Strong security needs enforcement at execution boundaries, independently of either repository arrangement.

## Alternatives and impact on Ri

| Shape | Ri experience and control | Cost and decision |
| --- | --- | --- |
| Everything implemented directly in Ri | Immediate access to every internal service, but portability can be lost through incidental imports | Avoid hidden coupling. Start with an explicit package boundary even in the same repository. |
| Reusable package embedded by Ri | Ri retains native navigation, chat, approvals, account setup, lifecycle and updates. The engine provides mechanisms behind typed interfaces | Recommended. Additional interface and conformance work, without another consumer-facing service. |
| Independent builder app embedded wholesale in an iframe or opened externally | Requires duplicate navigation, chat, account setup and session coordination, or a large remote-control API to recover them | Do not make this the Ri integration. It adds friction and can split the experience. Guest app views still use their existing isolated frames. |
| Separately running engine daemon | Can serve several clients, but adds authentication, discovery, version negotiation, ownership and failure recovery | Only if a measured runtime/security need warrants it. A source-repository split alone is not such a need. |

Extracting the recommended package should lose no planned Ri functionality. That is an acceptance criterion, not an automatic consequence of drawing an interface. The tradeoff is more explicit contracts and release coordination. Ri must be able to add host capabilities and ship a pinned version without waiting for a generic standalone UI to expose them.

## Ownership boundary

| Reusable app kit owns | Ri adapter and native UI own |
| --- | --- |
| Portable manifest parsing, contract schemas and artifact validation | App library, Apps rail, URLs, native builder and conversation panel |
| App SDK, templates, lockfile build adapters and package export mechanics | Chat sessions, harness choice, conversation history and builder instructions |
| Process lifecycle, invocation transport and execution-driver interface | Authoritative actors, grants, connection bindings and approval decisions |
| Framework-neutral view controller, message validation and context envelope | Pairing a view with a chat, selecting context for a turn, focus and unsent input |
| App-owned data-directory lifecycle and quiesce/snapshot primitives | Home path resolution, registry persistence, whole-Home backups and restore policy |
| Scoped host-capability calls and bounded lifecycle/change events | Connector execution, OAuth/account setup, task/note actions and existing scheduler |
| Standard MCP projection and conformance fixtures | Which external clients may connect and what they may read or change |

The kit does not import `@/` modules, Next, Ri's Drizzle schema, Ri's credential storage, a global scheduler or a specific harness. Its browser exports do not import Node runtime modules. The Ri adapter creates one engine and stores it in `processState`, provides resolved paths and callbacks, and owns admission/shutdown. The kit keeps mutable state on that instance rather than module globals.

Use a small `HostServices` contract for resolved storage/metadata operations, authorized capability dispatch, activity events and the execution driver. A broker call is tied to a host-created invocation context. Guest payloads cannot nominate a different actor. Navigation, chat context and UI events carry references and typed data, not database handles, bearer credentials or arbitrary executable callbacks from an app.

Missing capabilities return a typed unsupported result. They never fall back to opening the Home database, reading credentials or calling a provider directly. A future standalone host supplies its own implementations and grants. The reusable kit does not acquire ambient authority merely because it runs outside Ri.

Ri's native wrappers control layout, styling, loading states and error recovery. Share the app view controller, not an entire foreign builder screen. The builder can share templates, validation and build operations while continuing to use Ri's existing chat implementation.

## How the pieces communicate

Ri installs and imports app-kit as a library. It runs inside the existing Home process. Calls between Ri and the kit use typed functions, callbacks and events, with explicit cancellation and disposal. There is no MCP connection, HTTP hop or independently running engine service between them.

| Boundary | Communication |
| --- | --- |
| Ri server adapter to app-kit runtime | Direct TypeScript library API and `HostServices` callbacks in the Home process |
| Ri browser UI to Home | Existing authenticated tRPC and event surfaces, through Ri-owned procedures |
| Ri browser wrapper to app-kit view controller | Direct browser-library API, without importing Node runtime code |
| View controller to guest HTML | Validated MCP Apps messages over the nested iframe bridge described in the implementation contract |
| Runtime to a generated Node backend | Private child-process IPC, `ri-ipc-v1` |
| Runtime to Finance | Authenticated loopback MCP for tools/resources, private IPC for bootstrap and lifecycle |
| Future external tool client to an app | An explicitly exposed and separately authorized MCP adapter, outside MVP distribution |

Use MCP where it enables tool/view interoperability. Moving source to a separate repository does not turn the internal library boundary into a protocol boundary or change Ri's native UX ownership.

## Folding the engine back into Ri

Keeping app-kit in a separate repository is reversible. If maintaining a dependency stops helping Ri, bring the exact tested engine source version into this repository, preserve its license/notices, and redirect the Ri adapter's imports to the local module. Update the build, asset-copy and runtime-entry resolution, then remove the external package dependency. The initial workspace-package arrangement already keeps the source here, so absorbing it further into Ri is the same kind of source-organization change.

Preserve the app-facing SDK and bundled build dependency, manifest/contract versions, IPC and MCP adapters, instance IDs, slugs, metadata formats and data paths. Existing app projects must still resolve the declared SDK without relying on Ri's private source layout. This change should require no app rewrite, data migration, reinstallation or grant reset. Any behavior or stored-format change is separate work, not an incidental consequence of moving source.

Re-run the same Ri acceptance flows and clean-machine app build/export/install fixtures against the absorbed implementation. This is the proof that native UX, installed apps, records, background work and permissions still behave the same. Retaining the adapter boundary is useful even when both sides are internal. A separate consumer app or engine daemon is never required to reverse the packaging decision.

## Package and host interoperability

Use root `plugin.json` for portable identity, `skills/` for standard workflows, and optional `mcp.json` for qualified MCP targets. Put Ri runtime/build/capability metadata under `extensions.com.ri`. This proposed Ri namespace is not an OpenAI extension. Do not duplicate identity/version in a separate `app.json`. The implementation contract pins the accepted manifest profile. [OpenAI package format](https://developers.openai.com/plugins/build/plugins)

Preserve MCP tools and MCP Apps resources at external boundaries. The small-app IPC protocol is an internal execution adapter, not a second public tool standard. A development MCP projection maps the same validated actions, schemas, tool visibility and UI resources onto a standard server. Service apps such as Finance retain their own MCP implementation. Conformance tests cover both paths. Ri-only host capabilities and UI context are negotiated rather than disguised as universally available behavior.

Portability has separate layers:

| Layer | What can be shared | What still needs host-specific work |
| --- | --- | --- |
| Source/package | Skills, source, assets, metadata and examples | Supported runtime, dependency/build profile and release packaging |
| Tools and UI | Standard MCP actions and MCP Apps views | Supported resource/CSP profile, context methods and entrypoints |
| Host services | Declared capability needs | Authentication, mailbox/account bindings, task APIs, scheduling and approvals |
| Distribution | Reusable export and catalog metadata | Marketplace requirements, publisher review, deployment and updates |

A Finance view and its calculation tools can be reusable. A Ri Gmail binding or `create_task` grant is not transferable to ChatGPT. Running the app without Ri requires an appropriate alternative capability provider or an explicit manual/offline mode. A plugin must not claim ChatGPT compatibility merely because its manifest is parseable or one HTML view renders.

OpenAI supports private MCP connections through Secure MCP Tunnel. That connection path is distinct from public plugin distribution, which currently requires a stable public HTTPS MCP endpoint. A local Ri package cannot become a public ChatGPT plugin by exporting a ZIP alone. A hosted deployment or other qualified publication adapter is additional work, outside Ri's local MVP. No endpoint, tunnel or credential is exposed automatically by installation or export. [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [remote plugin requirements](https://developers.openai.com/plugins/deploy/app-review)

If an external client later connects to an app managed by Ri, Ri remains the single process/data owner. The client uses an independently granted authenticated MCP endpoint. It cannot start a second writer against the same data directory or inherit the owner's chat authority. A standalone instance uses a separate data root. Package portability does not imply automatic live-data sharing.

## Security boundaries

The repository arrangement does not change the initial owner-trusted execution profile. The reusable runtime is a suitable place to implement and independently test containment, but reuse itself supplies no isolation guarantee.

The execution-driver interface separates trusted native execution from a future isolated profile. It accepts validated artifacts, explicit data/cache locations, resource/deadline limits and a narrowly authenticated broker channel. The host selects and checks the profile before any dependency install, build, preview or backend startup. Stronger-profile requirements fail closed on unsupported platforms. There is no automatic fallback to the native driver.

Qualification for untrusted code must cover builds and dependencies as well as the running backend: filesystem visibility, sibling-app/Home exclusion, network egress including loopback, environment/secrets, executable/child-process control, resource exhaustion, ownership and teardown. The browser guest boundary remains separately qualified. A contained app can still misuse a granted action, so host authorization and approval remain necessary outside the app's environment. Do not hand an app a Docker socket or root-level host helper.

Containers, OS sandboxes and VMs are candidates for that driver, not interchangeable guarantees. Platform choice and adversarial qualification remain a separate implementation decision before general third-party installation. The trusted-code prototype can proceed with clear limits. Public marketplace execution remains blocked until the stronger profile is demonstrated.

The read-only Agentex reference already supplies harness sessions and worktree/process-lifecycle primitives. Ri already depends on its agent/workspace packages. Reuse qualified operations where they fit rather than creating another harness library. A worktree and harness-specific permission options do not prove containment for arbitrary installed backend code. No Agentex modification is required by this documentation change.

## Extraction and release gates

Start with one workspace package and separate public exports for contracts, SDK, runtime, view controller, build tools and testing. A minimal fixture host can build/open/invoke a sample and supply a fake connector without loading Ri. This is a conformance harness, not a second product UI.

The initial package is consumed through its declared exports by Ri itself. Package tests build it without Ri path aliases or developer-global tools. The framework-neutral browser export and Node export are checked independently. The same tarball is exercised by the fixture host, so a workspace-only import cannot masquerade as portability.

Extraction into another repository follows these checks:

- Ri still completes create, preview, Use this, contextual chat, grant/revoke, schedule, update with existing records, backup and removal against the packaged dependency.
- The fixture host consumes that dependency without Ri imports and exercises raw HTML, a compiled UI, tools, context and unsupported-capability errors.
- Finances remains independently packaged from `apps/finances` and runs through the same public service adapter without Ri importing its business code.
- The engine, manifest, broker and stored metadata have explicit compatibility versions. Unsupported versions fail before data mutation.
- Ri pins an exact tested release and artifact. An engine update cannot silently migrate a Home or change an app's trust profile. Release tests include the supported prior metadata format.
- The dependency's open-source license, third-party notices, release ownership and reproducible build steps are recorded before publishing. No new license or public repository is selected by this design document.

If a separate developer offering becomes useful, start with a CLI for scaffolding, validation, building, fixture preview and export, plus instructions usable by existing coding agents. A small reference playground can prove another host. It need not reproduce Ri's chat history, account management or consumer navigation. A complete standalone builder should follow demonstrated demand and must not become a dependency of Ri's end-to-end experience.
