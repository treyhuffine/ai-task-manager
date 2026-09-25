# One Ri: build specification

**Status:** build contract. Updated 2026-09-24.

**Product promise:** Open Ri anywhere and return to the same work. Use the computer that fits the work without managing separate Ri lives.

This document defines the personal multi-computer experience and the initial team product. It includes the behavior, technical contracts, implementation sequence, and acceptance criteria. Earlier homes, team, and takeover plans are not additional requirements. Unchecked tasks describe work to implement, not shipped capabilities.

Implementation and dogfooding run in a dedicated Git worktree against isolated development instances. The running production Ri used to do this work must remain untouched. Section 10.4 defines the isolation requirements.

## 1. The experience

Start with a laptop and a phone. The laptop runs Ri and holds the person's data. Pair the phone once and use it to capture thoughts, review work, and answer agents. Someone who never adds another computer still has a complete product.

Later, deliberately move the home to a Mini or server for always-on availability, and connect the laptop as a worker. Ri and work running on the Mini remain available while the laptop is closed. Merely adding a Mini worker to a laptop-hosted home does not provide this availability. Opening the same execution on the laptop or phone shows its conversation and results. To work against local tools and files, start locally or explicitly continue the execution here.

An agent remains the same agent on both computers. Its folders do not have to match. The app remembers the association and prepares the correct environment.

Joining a team adds shared tasks and notes. It does not give the team access to personal conversations, files, or execution controls. A teammate can use the team product without installing Ri locally, connecting AI, or creating a personal home.

The UI centers on the work:

- Tasks, notes, agents, executions, and the deck keep their identities across screens.
- Location is a small property of an execution, not a global Local/Remote mode.
- A reply goes to the execution the person is viewing.
- Setup appears when someone first uses a project on a computer.
- Routine use after setup requires no copied command, transcript, folder path, or instance URL.
- Failures preserve work and offer a specific next action.
- The existing deck remains available across screens without a separate deck redesign in this build.

## 2. The model

### 2.1 Three separate concerns

| Concern | Meaning |
| --- | --- |
| Ownership | Personal work belongs to a personal home. Shared work belongs to a team space |
| Execution environment | A particular computer, working directory, tools, credentials, and connected folders |
| Viewing surface | The browser, phone, or desktop surface displaying Ri |

Changing the viewing surface never changes the execution environment. Changing the execution environment is an explicit operation that preserves the work's identity and history.

### 2.2 One personal home

A home is the authority for personal tasks, notes, agent definitions, executions, Ri conversations, and schedules. It is initially on the laptop. It can later move to another computer without creating a new personal identity.

There is one designated home. It does not switch when a computer sleeps, wakes, or disconnects. Home relocation is the deliberate migration in section 10.3, not a routine execution action or automatic election. Starting an execution on another computer does not move the home.

A home has a stable ID independent of its address. Changing a URL must not create another home.

A connected computer talks to that home. It can also run a worker for local execution. It does not create an independent personal database. Durable delivery journals and bounded caches are allowed, but are never independent authorities for personal records.

A computer's execution worker connects to one home in this release. A personal home can connect to several team spaces.

The home runs its own execution code in-process through the same execution contract. It does not need a second daemon just to talk to itself.

### 2.3 Authority

| Information | Authority |
| --- | --- |
| Personal tasks, notes, agent purpose/instructions, executions, Ri conversation history | Home |
| Shared tasks, notes, assignments, published output, membership | Owning team space |
| Private planning and context attached to shared work | Personal home |
| Agent-to-folder associations and connected-folder paths on a computer | Local project configuration on that computer |
| Setup availability and reported paths shown in the UI | Home's observed index of worker reports |
| Working files, toolchains, local environment, native harness resume files | Executing computer |
| USER.md, SOUL.md, and personal MEMORY.md | Personal home |
| Schedule evaluation and main personal orchestration | Personal home |

The home can index a local setup without owning its configuration. There is one editable authority for each value.

### 2.4 Release boundaries

Build shared identity and conversation access, local execution, deliberate Git-based continuation, and team tasks/notes.

Do not build personal database replication, continuous filesystem sync, automatic execution failover, an arbitrary remote shell service, universal transcript portability, or a laptop mesh. Non-Git work can run on its configured computer but does not transfer through Ri in this release.

Team execution infrastructure, offline collaborative editing, granular per-item permissions, and automatic comment-driven orchestration are outside this build.

## 3. UI and user journeys

### 3.1 First run and connection

First run offers Start using Ri and Connect to existing Ri. It does not ask the person to choose a database topology.

Starting creates one home. Connecting saves that home's ID, address, and a scoped credential. A connected installation must fail with a useful connection state rather than silently create a new home.

Pair a phone through the existing QR/link flow. Explain once that a laptop-hosted Ri must be awake and reachable for phone access. No Ri cloud account is required. An optional remote-access provider may require its own login.

Reuse the existing remote-base-URL settings, reachability checks, Beamd connection, and QR/token pairing. Prefer an already configured reachable HTTPS address. If none is configured, offer the existing Beamd flow or an owner-supplied HTTPS address. Local-only use needs neither. Do not introduce another tunnel service, identity service, or certificate-pinning system. Existing local TLS support does not itself provide a reachable, browser-trusted LAN or public address.

Viewing access and local execution enrollment are separate. A browser login does not turn its computer into a worker. Enabling local execution requires a local enrollment action and home authorization.

Extend the existing device-pairing surface for enrollment: an authenticated owner creates a short-lived, single-use worker enrollment grant, the locally approved companion redeems it, and the home issues that worker's scoped credential. A viewing credential is not silently promoted to worker authority. The companion then establishes an authenticated association with its local browser for This Mac and local opening actions. If a loopback bridge is used, require a per-device proof and an exact allowed-origin check. Do not use hostname heuristics as authentication or add a second account/login flow.

A small desktop companion supplies worker installation, start at login, reconnect, Open Ri, local folder selection, editor opening, and Stop local execution. Keep the main UI in the browser. A full Electron shell is not required. CLI installation is acceptable for the first internal dogfood, not the finished public personal journey.

### 3.2 Navigation

Keep the primary navigation about the deck, tasks, notes, and agents. Show team context through a space selector and source labels. An aggregate view is All. Personal means private personal work.

Opening a team on the phone must not navigate the laptop away from its execution. Filters, panels, scroll, and focus belong to the viewing surface. Task state and review state belong to the shared work.

An agent appears once in the rail regardless of how many computers have its folder. Setup lists the available computers and gaps.

Hide agent/execution controls on a team that has no execution capability.

### 3.3 Starting and replying

For a new execution:

1. Use the agent's saved default computer.
2. Initially use the home when a usable setup exists there. Otherwise use the first setup the person explicitly enables.
3. Show a quiet Run on control when there is a choice. With one computer, show its name without requiring another selection.
4. A one-off selection affects that execution. Offer Make this the default in the same menu as an explicit action, not an automatic side effect.
5. If the selected computer is unavailable or unprepared, explain the problem. Do not silently substitute another computer.

For an existing execution, replies, interruptions, permission answers, file views, and execution actions route to its owner. Merely opening it never changes that owner.

Use stable names such as MacBook and Mac Mini. This Mac is a secondary convenience label only when the viewing client is authenticated to the local companion. Hostname, localhost, IP address, and tunnel URL do not establish physical identity.

Keep the computer visible on the execution, including on the phone. Most replies require no thought about it.

### 3.4 Bringing work here

Provide two distinct actions in the execution's location menu:

| Action | Result |
| --- | --- |
| Open code here | Fetch a published Git commit into a local review checkout and open the editor. The running execution stays where it is |
| Continue here | Stop the source, transfer a checkpoint, prepare the local environment, and continue the same Ri execution here |

On a laptop-owned execution, Continue on Mac Mini uses the same transfer operation for the prepared home computer. Complete that action before closing the laptop. Sleep does not move its work, and a sleeping source cannot complete a transfer. A future sleep reminder is not a prerequisite for this flow.

When local execution is not installed, the action leads to companion setup. When the project is not set up, offer Use existing folder and Clone repository. Attach the result to the existing agent, not a new agent.

A phone can follow, reply to, interrupt, and answer an execution on any connected personal computer. It does not offer Open code here or claim to execute code.

### 3.5 Connection and delivery states

| Situation | What to show | Recovery |
| --- | --- | --- |
| Home unavailable | Cannot reach your Ri on MacBook | Retry or connection details. Retain the unsent draft |
| Worker unavailable, home reachable | Waiting for MacBook. Your message is saved | Cancel before delivery or wait |
| Worker lost contact during a turn | MacBook disconnected. Last heard from… | Show last received output. Do not label it stopped |
| Project/reference missing | Choose the Ri / Agentex folder on this Mac | Relink the relevant folder |
| Setup command failed | Setup failed on MacBook | Show its output and Retry setup |
| Delivery acknowledgement uncertain | Message delivery could not be confirmed | Reconcile before offering an explicit retry |
| Reviewing an older commit | Reviewing commit … | Refresh when a newer published commit is available |
| Transfer failed | Could not continue on MacBook | Explain the failed stage and show the safe resume/retry action |
| Team unavailable | Acme could not be reached | Show the last update and retain the draft |

Use Asleep only when the computer explicitly reported sleep. A timeout means unavailable, not asleep.

Saving at the home is not delivery to the harness. Keep saved, waiting, delivered, failed, and uncertain states distinct.

### 3.6 The deck

Keep the name Deck and the current completion, daily generation, and refresh behavior. The existing morning trigger and first-open daily generation continue to run only at the designated home, subject to their existing settings. This build changes where the deck is served from, not its product semantics. A fluid-palette redesign is potential future work in section 12.4.

## 4. Agent identity and local folders

### 4.1 Local files own machine-specific paths

Use a gitignored .ri.local.json in the selected source folder. It contains that computer's association to a home and agent, plus its connected-folder mappings. The containing directory is the source folder, so its absolute path is not repeated inside the file.

One source folder is associated with one home in this release. Development and production use separate source checkouts or worktrees. The local association file is separate from any committed .ri/skills content, which can travel with the repository.

The home owns the agent's name, purpose, standing instructions, reference definitions, and connector scope. The local file supplies physical paths. The worker reports the resolved setup to the home for display and dispatch validation.

This is the storage decision for the build. Do not implement competing database-owned path editing or a second configuration profile system.

Example on the laptop, in ~/dynamism/ri/.ri.local.json:

~~~json
{
  "version": 1,
  "homeId": "<home-id>",
  "agents": {
    "<ri-agent-id>": {
      "references": {
        "agentex": "../agentex"
      }
    }
  }
}
~~~

On the Mini, in ~/ai-task-manager/.ri.local.json, the same association uses:

~~~json
{
  "version": 1,
  "homeId": "<home-id>",
  "agents": {
    "<ri-agent-id>": {
      "references": {
        "agentex": "../code/agentex"
      }
    }
  }
}
~~~

The result is one agent with two setups:

| Computer | Source folder | Agentex |
| --- | --- | --- |
| MacBook | ~/dynamism/ri | ~/dynamism/agentex |
| Mac Mini | ~/ai-task-manager | ~/code/agentex |

A project can host several agent identities in the agents map. There is one registered source setup per agent per computer in this release. Review checkouts and execution worktrees are derived locations, not additional source setups.

Reference values have three forms: a path string, an object containing agentId to use that agent's registered source folder on the same computer, or null to explicitly omit that reference on this computer. The agentId form preserves existing references to other agents when their folders move. It resolves only to a source setup, never whichever execution happens to be active.

### 4.2 Setup lifecycle

- The local companion or CLI selects a source folder and attaches an existing agent ID or creates a new agent explicitly.
- Suggest registered folders and, when the user enables local history discovery, folders already present in that computer's harness history. This is a bounded list read, not a filesystem scan or automatic transcript upload.
- Matching Git remotes can suggest an agent. They never merge identities or grant access automatically.
- Write the local file atomically. Ensure Git ignores it, using local exclusion when the repository does not already ignore it. Never commit local paths or credentials as part of setup.
- A copied file is not enrollment. The worker accepts its home association only after the computer has been enrolled and that source setup enabled locally.
- Credentials, worker identity, and the list of registered configuration locations live in the worker's private application configuration. That list locates the files, not a second set of folder mappings.
- The home stores device-qualified registration, health, and last-observed setup revision. It cannot edit a disconnected computer's paths optimistically.
- UI edits go through the worker to the file, then update the observed index. Use revision checks so a UI edit cannot overwrite a newer manual file edit.
- Validate the current file and folder existence before start and transfer. Do not execute against an old home cache when the local file changed.
- Pin the resolved environment to the execution placement. Configuration edits apply to a new start or explicit refresh, not by silently changing the cwd or references underneath a running turn.
- A renamed source folder is relinked by selecting its new location. Preserve the home/agent association. Do not scan the whole disk.
- Missing, malformed, duplicate, or wrong-home associations produce a setup error with a relink/edit action.

If a local file is deleted, including by git clean -fdx, offer Restore setup from the last observed report. First verify the current computer/home/agent association and paths, show what will be restored, and require confirmation. Never overwrite an existing file or silently execute from the cached report. The confirmed write restores the local authority, not a second editable configuration. For a non-Git folder, keep the same local file without implying that Git protects or ignores it.

Existing global and per-agent reference aliases retain their scope and descriptions in the home. Each computer's effective physical mappings are materialized in its source configurations. Editing a global reference path applies to the selected computer's affected local files through its worker, with per-file revision checks and visible partial failure. It does not change other computers' paths or make the database another path authority. Preserve existing alias shadowing rules. Alias renames must update the affected mappings explicitly rather than guessing from a similar name.

A missing or unconfigured reference blocks that setup until relinked or explicitly omitted with null. An omitted mapping does not grant a substitute path or change shared agent identity. The agent's environment must state which expected references were omitted. Resolve agentId references from the worker's local registration index without a home-only cwd fallback. References to missing setups block in the same way.

### 4.3 Resolution and real dependencies

Relative reference paths resolve from the source directory containing .ri.local.json. Absolute paths remain local to that computer. Never resolve a sibling reference from a generated worktree's directory.

Prepare a resolved environment manifest for each execution: source folder, actual execution cwd, connected folders, Git checkpoint, and available capabilities. Deliver it through session instructions and a readable local runtime file outside the source repository. A local harness does not need to query a remote database to discover its own effective paths.

Do not copy .ri.local.json into derived execution/review worktrees or treat a generated manifest as editable setup authority.

Do not rewrite old transcript text to substitute new paths.

Preserve the repository's actual internal layout when creating a worktree, including an agent's subdirectory within a monorepo. Build dependencies inside the repository continue to use ordinary project paths. Explicit reference mappings identify their configured folders and are not silently retargeted to another worktree.

A connection to Agentex for reading context does not install it, update it, or satisfy a package dependency on it. Reuse project setup scripts, Git configuration, and environment files. Do not infer or recreate arbitrary dependency graphs.

Use the destination computer's own local files-to-copy rules and source files when preparing its worktree. Never copy source-machine secrets during transfer. Keep portable project setup/start/teardown commands in the existing agent recipe, preferably invoking repository scripts. Do not add per-machine command override profiles in this release.

Projects that require an existing working layout can use the existing explicit live-execution mode. That mode must identify the source checkout it edits and preserve its existing confirmation. Continuation into another computer uses an isolated worktree. If that environment cannot run the project, stop with a setup error rather than silently use or overwrite the destination's main checkout.

## 5. Runtime and conversation contract

### 5.1 Minimum records and interfaces

Extend existing records rather than create a parallel execution product.

| Record | Required meaning |
| --- | --- |
| Home | Stable personal authority ID, separate from network address |
| Computer | Stable worker ID, enrolled home, credential/capability state, human name, last contact |
| Agent setup report | Agent ID plus computer ID, configuration location/revision, resolved source and references, availability |
| Execution placement | Execution and chat identity, owner computer, ownership generation, cwd, code checkpoint, native session ID and computer-qualified native path when exposed by the harness, start/end reason |
| Command | Stable command ID, actor, target, ownership generation, payload, delivery state |
| Worker event | Stable event identity, placement/generation, source sequence and revision where a provider part is cumulative |
| Space connection | Space ID, member credential, assigned-work cursor/freshness, external record identity |
| Private overlay | Personal fields associated with a shared task's space ID and task ID |

Preserve the existing Ri execution and conversation identities across placement changes. Record native-session binding history, rather than losing the old binding when a new harness session starts.

Use a small runner interface for start, send, stop, pending-input answers, preparation, and execution-scoped reads. Home bookkeeping, scheduling, and notification delivery stay outside the worker runner.

Reuse EventWriter, the existing executor/harness adapter, session credential machinery, shared queries, and session message route. The remote event writer must support both inserts and cumulative part replacement.

### 5.2 Connection

The worker opens an authenticated outbound SSE command connection to its home and sends acknowledgements, events, and artifacts over HTTP. Reconnect uses the durable delivery positions.

Use HTTPS for remote addresses. Local development can use loopback HTTP. No inbound laptop service exposed to the network and no laptop-to-laptop connection is required.

The home can send only defined operations against enrolled setups and owned executions. Do not add arbitrary-path filesystem or arbitrary shell endpoints. Starting an execution or a configured project script remains subject to that setup's execution authorization.

Protocol versions must be checked before dispatch. An incompatible worker shows Update Ri on MacBook rather than receiving a command it cannot interpret.

### 5.3 Message flow

1. The user or authorized personal agent submits a message to the home.
2. The home authenticates the actor, authorizes the target, and persists the message with a stable ID.
3. The home delivers the command to the execution's current placement.
4. The worker injects it through the harness adapter and records/returns the delivery acknowledgement.
5. Assistant output, tool events, results, questions, and pending-input requests flow back to the home.
6. The home persists them and updates every viewing surface.

This applies to local executions too. Both sent and received conversation events belong in the home's database. Native harness files remain on the executing computer.

Connected-device CLI actions use the home API and preserve the caller's signed session identity. They must not fall back to local database writes when the home is unavailable.

Independent terminal sessions remain read-only imports unless explicitly adopted through a supported control path. Reading a transcript does not establish control over the terminal that produced it.

### 5.4 Delivery, outages, and revocation

- Persist commands before sending and deduplicate by command ID.
- Persist worker events to a durable local journal before reporting them. Acknowledge contiguous positions and replay unacknowledged events.
- Apply cumulative provider parts by revision. A late replay cannot overwrite a newer part.
- A crash between harness delivery and acknowledgement is uncertain. Reconcile against available native history. If it cannot be resolved, show uncertainty and require an explicit retry rather than risking a duplicate turn.
- Cancel only commands that have not crossed the delivery boundary. An in-flight command may require stopping the execution instead.
- Bind pending-input answers to the exact request ID, chat, placement, and ownership generation. Reject stale answers.
- A home outage permits an already-dispatched turn to finish under its existing permissions while the worker journals output. No new turns or new remote approvals are accepted until home authority is revalidated.
- The local companion can always stop its local execution. A remote stop or revocation takes effect when received. Disconnection cannot guarantee immediate cancellation of an already-running process.
- The home never reassigns an execution because contact was lost. Unknown is not stopped.
- On reconnect, check revocation and ownership before processing queued commands. Revoked workers cannot resume control by replaying an old queue.
- All operations that can start or affect execution, including restart, archive, scheduled actions, commit/PR helpers, and agent main chats, use the same owner routing.

Upload attachments/artifacts that Ri promises to retain and store their metadata at the home. Materialize input attachments on the receiving computer. Do not send a home-only disk path as a worker input or present a worker-only path as a durable download.

### 5.5 Selected terminal history from connected computers

Include read-only import of selected laptop terminal chats in this release. Reuse the existing provider history discovery, parsing, and import behavior on the computer that owns the native files. The worker sends selected parsed history and later additions through the authenticated delivery path to the home.

Selection is explicit. Do not automatically upload all local history. Qualify discovery/import identity by computer, provider, and native session identity, and deduplicate repeated imports. Reconcile any known Ri-managed binding before creating another conversation. A native path always belongs to its source computer.

Show an imported chat's source computer and read-only state. Reading it on a phone does not enable sending into its terminal or move its native session. Unavailability retains the last imported history and its freshness. Do not edit native files/indexes, move transcripts, or make arbitrary local file paths downloadable. Preserve existing supported adoption on the home, without extending that authority implicitly to connected terminal sessions.

## 6. Trust without a permission platform

The initial security model has a personal owner, enrolled computers, authenticated sessions, and team owner/member roles. It does not introduce a custom policy language or folder-by-folder enterprise ACL system.

Enforce these boundaries in the server/action layer and again at worker dispatch:

- Browser viewing credentials do not grant local execution enrollment.
- A worker accepts only its registered home's commands for enabled setups and current placements.
- The actor is derived from credentials, never accepted as an arbitrary caller-supplied human/session ID.
- Agent messages keep their stored provenance and a sender label in the harness prompt. The label identifies the agent and does not imply the human just approved its instruction.
- A personal orchestrator can dispatch within its delegated authority. Agent-to-agent messaging cannot approve a human permission request or increase that authority.
- Team membership and incoming team content never authorize personal execution or access to private context.
- Revocation prevents new authorized operations. Credential material is never returned in ordinary device lists or stored in project configuration.

A folder mapping describes the environment. It is not a filesystem sandbox. Preserve existing harness permission modes and enforce the selected mode through the harness's supported controls. During local execution enrollment, clearly distinguish a sandboxed setup from trusted computer access. Do not promise folder confinement where the harness cannot enforce it.

Treat task bodies, comments, connector content, and other agents' messages as content with an identified source. Filtering dangerous phrases is not the enforcement mechanism.

Expose only execution-scoped file/diff views to remote clients. Keep local native-editor opening in the companion. Existing preview support must preserve authentication and browser-origin boundaries, and must never advertise a worker's localhost URL as reachable from a phone. A new terminal or preview tunneling platform is outside this build.

## 7. Persona, orchestration, and schedules

USER.md and SOUL.md are canonical user-owned files at the personal home. Seed them only when absent. Do not copy machine paths into persona or overwrite user edits during setup.

Trusted personal workers receive the relevant content through session instructions. Runtime materializations stay outside source repositories. A change applies to a new session or an explicit instruction refresh, not a silent mid-turn rewrite.

MEMORY.md remains authoritative at the home. A worker can submit a finding to the home orchestrator, which applies any memory update through the home-side file operation. Do not maintain writable memory replicas.

The main personal orchestrator, scheduler, AI heartbeat, and deck maintenance run on the home. The laptop may be that home. There is one scheduling authority.

An agent's main chat has a fixed computer, initially the home when that agent is set up there, otherwise its saved default computer. Its history stays visible while its computer is unavailable. It is not automatically cloned or relocated.

New scheduled executions run on the home. An action targeting an existing execution routes to that execution's computer. Unavailability produces a waiting/skipped/failed outcome according to the action, not a duplicate execution elsewhere. Device-specific cron configuration is excluded from this release.

Worker liveness signals and the AI heartbeat are separate mechanisms. Sleep of the home stops its availability and scheduling. Internet access on a laptop does not imply that its home is reachable.

Preserve the scheduler's existing overdue behavior: when the home next ticks, an overdue trigger is considered once and advanced, subject to its active-hours and dispatch rules. Do not replay every missed interval. Show Runs when MacBook is awake for a laptop-hosted schedule. This is an explanation of the existing scheduler, not a second scheduling system.

## 8. Reviewing locally and continuing elsewhere

### 8.1 Open code here

Git owns code versions and transfer. Ri coordinates existing commit/push/fetch/worktree operations and opens the result. There is no live filesystem copy, background capture of unfinished edits, or separate snapshot format.

Fetch the execution's latest published Git commit into a separate local review worktree using the target computer's setup, then open the editor. Do not check out over dirty or unrelated work.

Label the commit and its source computer. New source progress does not mutate the local checkout automatically. Refresh updates only a clean review worktree.

The active execution can keep running. Ri must not automatically publish review-checkout edits to its active branch. An external editor is not read-only, so detect local changes and preserve them. Offer Continue here or an ordinary independent Git branch when the person wants to edit.

If a review checkout already has edits, Continue here must explain that they are separate from the source execution. The person can keep that edited checkout and continue into a clean worktree, or resolve those edits before transferring. Never silently combine them with newer source work or imply they were included in the continuation. The normal local editing path is to choose Continue here before making changes.

If the execution has no published commit, offer the ordinary commit/push flow on the source or wait. To include newer uncommitted changes, first finish or explicitly pause the source execution, then commit and push through that same flow. Coordinate this with its existing Git operations and confirm that the harness and any owned background tasks have stopped editing the checkout. Never commit files while the agent is still changing them. Do not add a separate live-snapshot feature or temporary-index/custom-ref protocol in this release.

The execution's normal Files, Diff, and live Preview continue to refer to its owner. A local review surface is explicitly labeled. Opening a committed version locally is not execution transfer.

### 8.2 Continue here

Continuation preserves the Ri execution, its chat history, task links, and agent identity. It changes the computer, working directory, and native harness binding.

This is the later P4 capability, after ordinary multi-computer execution and messaging work. It does not copy a native transcript. The Ri conversation is already stored at the home, and the destination starts a fresh harness session with the handoff in section 8.3.

The first release transfers Git-backed work only. Both source and destination must be reachable, and the destination must already be enrolled.

The operation is:

1. Validate the destination's local configuration, harness, permissions, Git access, and project recipe.
2. Acquire a transfer lock for the current ownership generation. Hold new messages at the home.
3. Stop the source and confirm the harness and its owned tool processes have stopped.
4. Flush final events and record the acknowledged conversation checkpoint and source Git state.
5. Prepare a Git checkpoint. Include tracked changes. Surface untracked files for explicit inclusion and exclude ignored/local configuration and secrets. Publish through the configured remote without force-pushing.
6. Fetch on the destination and verify the exact commit. A matching branch name is insufficient.
7. Prepare an isolated target worktree, local files, connected folders, and setup scripts.
8. Create the handoff described below.
9. Atomically assign the next ownership generation to the destination. Old-generation commands are invalid.
10. Start the destination session, record the new native binding, append a continuation event, and deliver held messages once.

Show progress in one surface: Preparing, Saving work, Setting up MacBook, Continuing.

Stopping the source includes the execution's harness, its tracked background tasks, execution-owned setup/start processes, and its supervised preview. Reuse the executor's close/stop-task controls and the preview supervisor's process-group handling, and await confirmation. An interrupt request alone is not proof of a full stop. Do not stop unrelated services. If a relevant process cannot be confirmed stopped, fail the transfer safely. A destination preview starts only after its setup is ready.

If the source is unreachable, do not transfer. Offer to wait or return to its last received history. Recovering from a last-known checkpoint while the source might still run is outside this release.

### 8.3 Handoff and failure behavior

Start a fresh native harness session on the destination with:

- Goal and current task.
- Completed work and key decisions.
- Next action and unresolved questions.
- Exact Git checkpoint and relevant file changes.
- Links to the earlier Ri conversation and relevant tasks/notes.
- The destination's resolved environment and available tools.

Generate a concise summary through the existing harness helper when available. Always retain a deterministic handoff containing the known task, checkpoint, latest messages, and history links if summary generation fails.

The receiving agent can read prior conversation through authorized home actions. Record Continued on MacBook with a handoff summary once in the chat. Do not represent this as preserving the original native context window.

A failure before ownership changes leaves the source stopped and resumable. A failure after ownership changes leaves a single failed/stopped destination that can be retried. Never automatically resume both.

Retain the source checkout, native files on both computers, native binding history, and transfer record. Do not delete branches or source artifacts during success cleanup. A rejected push, divergent branch, failed script, dirty target, or missing reference stops at the relevant stage without stashing, resetting, force-pushing, or discarding files.

### 8.4 Native session transfer

Native harness-session transfer is not required or enabled by this build. The central history plus handoff is the supported continuation contract.

After actual use, test native transfer on two real computers if handoff quality is a material limitation. A future implementation must verify context, tools, cwd, permissions, provider settings, and version compatibility, with an explicit fallback. Historical single-machine tests are not acceptance evidence for that feature.

## 9. Teams without mandatory AI

### 9.1 Standalone team product

A team space uses the same application with a separate shared authority and member identities. Its first release includes tasks, notes, assignment, keyword search, attachments, activity attribution, invitations, and supported connector use.

Create a new space with its own data root. Do not turn an existing personal home into a team by flipping a flag over private data.

The space runs on a deliberately chosen host using the existing Ri server and remote-address setup. It can share a physical computer with a personal home, but uses its own root, process, free port, credentials, and configured address. Teammates connect to that address. This does not require a new hosting platform or make the space a replacement personal home.
A teammate can join in a browser or on a phone without a personal home, worker, repository, harness, or model subscription. The team UI has no personal deck and no empty agent/execution setup.

Initial roles are:

| Role | Authority |
| --- | --- |
| Owner | Membership, invitations, space settings, connector administration, and ordinary shared work |
| Member | Read shared content, create/edit tasks and notes, assign work, change task status, and use explicitly published connector features |

All published team records are visible to members in this release. Private per-item sharing and corporate device compliance are outside scope.

Use expiring invitations, member-bound credentials, and revocation. Checking permissions is required at every API/action/attachment boundary, not only navigation.

Preserve human/agent/system attribution for changes inside Ri, whether initiated locally or remotely. Team history identifies the responsible member and whether an agent acted, for example Trey changed this versus Trey's agent changed this. Extend existing version/lifecycle metadata with member identity and authenticated actor context. Do not expose private session contents or rely on a caller's unsupported claim to be human. This is for explaining task/note edits, status changes, and published actions. It does not alter Git authorship or add per-keystroke/code-edit surveillance.

### 9.2 AI and connectors

The initial team product runs without AI. Disable model-dependent onboarding, background model dispatch, embeddings, AI triage, and AI schedules at the execution boundary. An ambient API key must not override this setting. Keyword search and ordinary CRUD continue to work.

Team-hosted agents and execution are not part of this release. Personal agents may read and update authorized team records through membership-scoped actions. They still run under their personal home's authority.

Future team AI must be additive to existing space records. Do not expose an Enable AI control until a concrete team capability exists.

Run the first team pilot with shared tasks and notes before making connectors a requirement. Keep the bounded connector flow in the build, after that pilot. Reuse the current deterministic task-source connector adapter:

1. An owner connects a supported task provider for the space.
2. Members browse/search the published task-source list.
3. A member attaches a selected external task link and visible summary to a shared task.

The connection is explicitly for shared use. Credentials stay on the space host. Do not expose unrestricted connector actions to members. This feature does not implement bidirectional external-provider sync or promise a human UI for every connector toolkit.

### 9.3 Connect a personal home

A personal home connects to the space as a member. The space receives no credential for the personal home.

Cache the person's assigned shared tasks with source identity and freshness. Use the stable pair of space ID and external task ID, with a separate local identity where the current task model requires it. Do not merge by title.

Poll for changes and refresh on focus. A team task appears in the personal deck with its source label and can be handled through ordinary personal planning.

Edits to shared fields are online commands to the space. Use idempotency keys and revision checks. If a request conflicts, preserve the person's draft and show the source's current value. If the outcome is unknown, reconcile using the same command ID before retrying. Do not build an offline write outbox.

For shared task/note bodies, keep autosave and add an expected content revision to each write. Check it atomically in the shared query layer. Use a real revision value rather than a coarse timestamp. Serialize a client's pending body saves so its own earlier save cannot overwrite a newer one.

On conflict, stop that editor's automatic saves, preserve its local draft, and show that the shared version changed. Offer comparison and an explicit choice to use the shared version or apply the retained draft against the newly acknowledged revision. Never replace a focused editor with a server echo or retry the stale body silently. The same write check applies to human and agent edits, including the direct team UI. Reuse existing version history for comparison/recovery. Presence locks, live co-editing, and automatic text merging are not needed for this initial behavior.

Read/search team notes through the space's authorized API. AI is not the only route to team knowledge.

### 9.4 Private and shared fields

| Shared, owned by space | Private, owned by personal home |
| --- | --- |
| Title, body, assignment, status, hard deadline, published attachments and results | Area, ordering, energy/effort, snooze, reminders, private context, personal subtasks, linked private notes |
| A deliberately published summary or PR link | Raw execution conversation, persona, local paths, personal connector credentials |

The shared task's body must not absorb private triage context. Shared completion does not publish personal annotations or silently complete private subtasks.

Reassignment or deletion removes the shared obligation from the active projection while retaining private additions with a clear source state. Membership removal blocks new fetches/writes and clears shared-content caches. Preserve private material separately. Revocation cannot erase exports a member already made.

### 9.5 Personal execution and publication

Receiving an assignment never dispatches a personal execution by itself. The person or their explicitly authorized personal automation chooses the agent and computer.

Team text, connector results, and future comments are data. They cannot address a personal worker command endpoint or grant execution rights.

When the work is ready, Publish result selects the summary, PR link, or attachment to share and shows the audience. Changing shared task status is also an authorized space command. Do not automatically share the transcript or mark a team task done merely because a personal execution ended.

### 9.6 Discussions

Do not build a new comment notification/orchestration system in the initial release. Use existing execution chat for directed messages to an execution.

During the team pilot, record cases where a durable task/note discussion is needed independently of an execution. If that need is demonstrated, the next slice is one chronological thread with author, timestamp, audience, and explicit agent read access. Notifications and automatic agent turns require a separate decision after that thread is useful.

This preserves the distinction between discussing work and instructing a running agent.

## 10. Existing data, home relocation, and recovery

### 10.1 Preserve the current single-computer product

Keep existing workspace IDs, execution IDs, chat history, wire action names, and single-computer workflows.

Migrate the existing home computer into an enrolled execution computer. Materialize its source-folder associations and effective references into local files without changing selected folders, scripts, or agent identity. Keep compatibility fields only during the migration. Once migrated, path edits go through the file authority and update the observed database fields through the query layer.

Do not treat an old cwd as a path on every computer. Do not globally rewrite historical message text.

Use current schema-derived types, shared query functions, path helpers, safe migration runner, and repository default/timestamp rules. Preserve rowids, foreign-key links, search indexes, mirrors, and attachment derivation.

### 10.2 Consolidate the existing laptop and Mini

Before retiring either existing home:

1. Inventory personal records, attachments, agent identities, executions, native transcripts, schedules, and unpublished code on both.
2. Back up both consistently and verify restoration into isolated roots.
3. Select the authoritative home.
4. Import selected unique records through invariant-preserving operations, with explicit identity/link mapping and provenance.
5. Confirm the connected-worker workflow replaces the old local workflow.
6. Archive the retired root and retain recovery information.

Do not merge SQLite files or delete a source root as part of setup. Development and test roots remain independent.

### 10.3 Move a home later

Use a guided, stopped export/import. Live database replication is unnecessary.

Stop source writers and scheduling. Transfer the consistent database, attachments, persona/memory, required configuration, skills, and connector secret material through protected backup storage. Inventory native transcripts and unpublished code separately if they are not included.

Restore and verify the destination with the same home ID. Relink only paths belonging to the moved host. Leave other computers' local configurations alone. Verify harness authentication and local project setup separately from data restoration.

Retire the old host's home role before enabling the destination as the authority. Preserve a backup, but prevent both restored roots from running as the same authoritative home. The old host can then enroll as a worker.

Retirement writes a durable role marker checked at startup. Backup restoration opens in stopped recovery mode until that root is explicitly selected as the active home. These checks prevent accidental parallel startup through the supported migration and restore flows.

Keep the existing public address when practical. If it changes, guide clients and workers through address replacement without changing their work identity.

A rollback requires a verified restore procedure and accounting for writes since the backup. A code revert alone is not a data or execution rollback.

### 10.4 Build and dogfood without disturbing production

Use a dedicated feature branch and Git worktree for implementation. Run that worktree with pnpm dev against an explicitly isolated development root. Do not switch, rebuild, restart, or repoint the running production checkout, replace its installed CLI, or change its public address as part of this build.

A worktree isolates code, not data. Before booting or running any migration or mutating CLI action, verify the resolved database, configuration, work, and attachment paths through the existing path helpers. Set RI_ROOT to the chosen development root and check RI_DB_PATH, RI_CONFIG_DIR, and RI_WORK_DIR overrides as well. Use port 42241 only if free, otherwise choose a free PORT. Do not stop another instance to take its port.

Development homes and workers have their own identities, credentials, local associations, and remote addresses. Use separate project checkouts/worktrees and test Git remotes or deliberately selected feature branches. Do not enroll production workers, change production folder associations, push the production branch, or modify production harness transcripts and provider indexes. Harness testing uses fixtures or fresh development sessions and must not stop existing production sessions.

Begin real-work dogfooding as soon as the P2 flow works. Use new real tasks and selected copies of existing context in the development home. If restoring a production backup for rehearsal, use a separate copy, assign development authority and credentials, and disable inherited schedules, connectors, and other outward actions before its first normal boot. Automated tests use separate disposable roots from the manual dogfood instance.

Rehearse consolidation, migrations, retirement, and rollback on isolated copies. Keep the original homes intact. Passing the release gates prepares a later production cutover, but does not authorize one. Actual production migration or deployment requires a separate instruction after reviewing the development result and recovery procedure.

## 11. Implementation tasks

Build the phases in order. Each gate must demonstrate the stated behavior before the next dependent phase. Record test results and a short real-use observation beside completed tasks. Do not mark an unimplemented behavior complete because a design was written.

### P0. Recovery and implementation foundation

- [x] P0.1 Create the implementation worktree and isolated dev setup from section 10.4. Verify every resolved data path, credential, address, and port before starting it. Inventory existing roots and rehearse backup/restore without changing production data. (7d46930) `pnpm iso` launcher with path, port, token, tunnel and global-skill checks. The dev home runs from this worktree on `~/ri-homes`, and `lsof` showed it holding only its own database. Mac Mini roots inventoried. Backup, verify, restore, development copy and app open rehearsed on production (16.6 s, 3.6 s, 11.5 s), production's root unchanged. The laptop's home is inventoried before P5.1. Details in [build notes](homes-build.md#p01-isolated-development-setup).
- [x] P0.2 Establish isolated home, worker, and Git fixtures for connection, retry, ownership, and migration tests. Test homes, stand-in computer roots, Git remotes with the §4.1 layouts, a fake harness driven through the real executor (turn, crash and resume, prompt, interrupt: 10 tests pass), and databases built at an older migration. Worker connection fixtures come with the protocol in P2.2. [Build notes](homes-build.md#p02-test-fixtures).
- [x] P0.3 Define the records and runner boundary from section 5.1 using existing schema/query/action conventions. [Build notes](homes-build.md#p03-records-and-the-runner-boundary): home and computer identity with a machine-local identity file, observed setups, execution placements and native session history, persisted commands, worker event positions, and a runner with no database that reports through one sink.
- [x] P0.4 Map every current execution control path to that boundary so there is no alternate route that assumes the UI host owns the execution. [Build notes](homes-build.md#p04-execution-entry-points), including eight existing paths that already assume the UI host owns the execution, each assigned to the phase that fixes it.

**Gate:** the isolated development instance runs from its own worktree without affecting production. A restorable baseline and an explicit inventory of execution entry points exist.

### P1. One home and local setup

- [x] P1.1 Add stable home and computer identity, separate from credentials and URLs. `home` and `computers` tables (migration 0002, new tables only), a machine-local `machine.json` that backups never carry, and `ensureHomeIdentity` at CLI start and server boot. A root whose data came from another computer, or a whole-folder copy on another Mac or in another folder, does no background work and answers 503 on every route but health and session until `ri home claim`. `GET /api/home` returns the stable id. Tests: first boot, restart, crash recovery, restored copy, wrong home, wrong host, claim, proxy 503. The dev home created its identity on restart.
- [x] P1.2 Add explicit connected installation mode. Prevent database initialization/fallback on connected computers. A folder is a home (database), connected (`connection.json` only) or fresh, and one with both is refused. `getDb()` refuses to create a database on a connected computer. The CLI refuses data commands on fresh and connected folders instead of making a new home. `ri` on a connected computer checks the address still answers for the same home with this computer's key and opens it, and `ri status` reports any role. Tests: roles, the `getDb` refusal, the connection record, the home client against a stand-in home (unauthorized, not active, wrong home, older home, unreachable, timeout), and the CLI guard. Live on the Mac Mini: a stand-in laptop folder connected to the dev home, and after `ri`, `ri status`, `ri agent` and `ri snapshot` it still holds only its connection record.
- [x] P1.3 Route supported connected-device CLI actions through the home API with session attribution. `POST /api/orchestrator/actions/:name` runs the registry as a remote call and returns the CLI envelope. The proxy forwards the validated key and strips forged copies, the actor comes from the signed session credential only, and path-taking actions refuse any caller that doesn't hold the home's own key. `ri agent` and the trigger commands route there on a connected computer, with no local fallback. Tests: the route (envelope, attribution to the calling chat, forged credential, path refusal), proxy header forwarding, and CLI dispatch against a stand-in home (credential sent, refusal passed through, unreachable, older home). Live: the stand-in laptop created a task on the dev home and wrote nothing locally.
- [x] P1.4 Implement .ri.local.json parsing, atomic/revision-checked writes, local registration, observed setup reports, relinking, and confirmed restoration of a deleted configuration. `src/lib/setups/`: strict parsing of the three reference forms, a sha256 revision, create-only and revision-checked atomic writes, `.git/info/exclude` when Git doesn't already ignore it, a per-computer registry of setup files, and a resolver that reports ready, missing folder, missing file, invalid, wrong home, missing reference, or duplicate. The home stores reports in `agent_setups` (migration 0003), keeping the last good references through a problem so restore can rebuild them. Connected computers register under their key and keep the same computer when re-paired. Registering doesn't let the home run work on that computer. `ri setup` (attach, ref, relink, restore with confirmation, detach) works on the home and on a connected computer. Tests: 32 for the library, including both §4.1 layouts, plus route tests. Live: one agent set up in the Mini and MacBook layouts on the dev home, a setup file restored after `git clean -fdx`, and a renamed folder relinked.
- [x] P1.5 Migrate the home computer's existing agent and reference paths without changing identities or source layout. `ri setup adopt` previews and, with `--yes`, writes each existing agent's folder and stored reference paths into that folder's setup file, then registers and reports it. Nothing else changes. Folder choices made on the home now go through setup files: creating an agent, changing its folder, and adding or changing a reference, which follows only mappings that still matched the old value. The home computer's reports keep `workspaces.cwd` as the observed value, so existing code keeps working while it moves to setups. `scripts/plan-adoption.ts` previews any root read-only. For production it plans 9 setup files, one per active agent, with no references, and it wrote nothing. Tests: planning, applying, never replacing a file, the app hooks, reference shadowing, and cwd following a relink. Live on the dev home: detach, then adopt.
- [x] P1.6 Reuse the current remote-address and QR pairing flows for first-run connection and phone access. Show honest home-unavailable states and the fixed home's availability requirements. `ri` in a fresh folder asks "Start using Ri here" or "Connect to your existing Ri". Without a terminal it starts a home and says how to connect instead. `ri connect` takes the pairing link from the Devices settings (asked for with hidden input when not given), requires HTTPS except on this computer or with `--insecure-http`, confirms the home by id, saves the connection and registers the computer. It can set aside a new, empty home in the folder, deleting nothing. `ri disconnect` undoes the connection. The web app shows "Cannot reach your Ri on <computer>" with Retry once `/api/health` also fails, keeps checking, and refreshes when the home answers. Failed messages stay with their retry. The pairing panel and the connect output explain that phones and other computers reach Ri through the home's computer while it's awake and reachable, and the welcome screen points people who already use Ri to `ri connect`. Tests: link parsing, the HTTPS rule, connecting against a stand-in home, setting aside an empty home, and the reachability store. Live: a fresh stand-in folder connected with a real pairing link. The banner was checked in the dev app with its requests failing: it appeared, and cleared when they recovered.
- [x] P1.7 Verify the two Ri/Agentex layouts from section 4 in isolated fixtures, including monorepo cwd, missing references, malformed/copied/deleted config, rename, and stale configuration reports. Production folders remain untouched. `src/lib/setups/layouts.acceptance.test.ts` runs one agent on both layouts through the real setup service and index. It covers each computer resolving its own folders with nothing committed, a monorepo subfolder, a reference missing on one computer only, a malformed file, a copied file ignored until registered, a file deleted by `git clean -fdx` and restored after confirmation, a renamed folder relinked, and a stale report replaced from the file with an edit against the stale revision refused (8 tests). The resolver and service suites add 32 more. Checked afterwards: none of production's 20 agent folders has a setup file, and production kept running on the same process.

An independent review of P0 and P1 at 46a2b02 found 11 issues (4 high, 7 medium). A re-check at 8ad4a01 confirmed eight closed, and found six further code cases and three protocol gaps. A targeted review at 1d76d11 found five more code cases in the path walker and folder moves, and three protocol gaps. All are fixed, with every reviewer probe kept as a regression test. See the [build notes](homes-build.md#review-of-p0-and-p1-46a2b02).

**Dogfood gate A:** capture and edit real tasks/notes from laptop and phone against one home. Attach both folder layouts to one Ri agent. No duplicate home or agent is created, and no recurring path selection is required.

Passed on 2026-09-25 with the real MacBook and iPhone against the dev home. There's one home, and the Ri agent is ready in both layouts. The MacBook is connected with no database of its own, and its folder and reference were each chosen once. See the [build notes](homes-build.md#dogfood-gate-a-the-real-laptop-and-phone).

### P2. Local execution with shared conversation

- [x] P2.1 Split machine execution from home persistence, scheduling, and notifications while keeping the in-process home runner working. `src/lib/runner/` runs harness sessions from a `SessionSpec` the home builds and reports through a sink, with no database, notification or realtime import (a test walks its import graph). The home sink writes events, publishes live state and finishes runs from each turn's result (`finishRun`), for manual and scheduled runs alike. `adapter.ts` keeps its API, so callers didn't change. The event seam covers every replay path, a quiet heartbeat closes its harness, and idle sessions close after 30 minutes. Tests: 12 through the real executor with the fake harness, plus the boundary. Live on the dev home: a real Claude turn resumed from a spec and finished its run, and a follow-up reused the same process. See the [build notes](homes-build.md#p21-the-runner-split).
- [x] P2.2 Extend pairing with worker enrollment grants, scoped credentials, and authenticated browser-companion association. Implement outbound SSE/HTTP delivery, version checks, and reconnect using the existing remote-address setup. An owner's key asks for a single-use enroll grant, the computer confirms locally and redeems it, and the home issues a separate worker key recorded in `worker_enrollments` (migration 0004, additive). A viewing key never gains worker authority. The proxy keeps worker keys to `/api/workers/me` and those routes to worker keys. The worker holds an event stream open (hello, requests, pings, revoked), sends heartbeats, reconnects with backoff, replaces a stale stream, and stops on revocation, another protocol (426, "Update Ri on MacBook") or another home. Requests are reads answered over HTTP, the first being a fresh harness report. "This Mac" links a browser through a grant the worker opens in it, with no loopback server. `ri worker enroll | run | status | open | disable | grant`. Tests: 17 over real HTTP through the real proxy and routes, plus the worker in the import boundary. Live on the dev home: the stand-in laptop enrolled, connected, answered a harness request with this Mac's real harnesses, and stopped when revoked, and a real browser linked itself. See the [build notes](homes-build.md#p22-enrollment-and-the-worker-connection).
- [ ] P2.3 Add the durable command/event journals, deduplication, cumulative event updates, and uncertain-delivery reconciliation.
- [ ] P2.4 Route start, send, stop, pending-input answers, and execution-scoped reads to the current placement.
- [ ] P2.5 Materialize input attachments and upload retained output/artifacts.
- [ ] P2.6 Enforce actor/target/ownership checks and preserve sender labels. Reject agent attempts to answer human permission requests.
- [ ] P2.7 Supply resolved local environment and home persona without writing managed instructions into source repositories. Route worker memory findings to home-side updates.
- [ ] P2.8 Test home outage, worker crash, reconnect, revocation, replay, stale approval, ambiguous acknowledgement, and continued output from an already-running disconnected turn.
- [ ] P2.9 Reuse local provider history discovery/parsing on connected computers to import explicitly selected terminal sessions read-only. Preserve computer-qualified identity and freshness, deduplicate known Ri bindings, and verify that unselected history stays local.

**Gate:** a laptop execution can be followed, messaged, interrupted, and answered from the phone through the home. Retry/reconnect does not silently duplicate a turn or lose acknowledged events.

### P3. The everyday personal UX

- [ ] P3.1 Implement saved agent defaults, quiet Run on controls with Make this the default, stable location labels, and one rail identity per agent.
- [ ] P3.2 Add saved/waiting/delivered/uncertain states and cancellation at the correct delivery boundary.
- [ ] P3.3 Keep per-screen navigation independent and execution controls tied to the owner.
- [ ] P3.4 Keep personal orchestration/scheduling on the home and pin agent main chats to their configured computer. Preserve the current overdue-trigger behavior and show when a laptop-hosted schedule can run.
- [ ] P3.5 Route existing diffs/files/previews safely. Provide local editor opening through the companion and truthful unavailable states.
- [ ] P3.6 Preserve existing deck completion, daily generation, morning-trigger settings, and refresh behavior. Verify that connected screens do not introduce a second scheduler or daily generation authority.
- [ ] P3.7 Exercise the full flow at phone and laptop widths, with keyboard, voice, and structured pending-input controls.

**Dogfood gate B:** use real work across laptop, Mini, and phone over several days in the isolated development setup. Start this use after P2 as soon as the basic flow is usable, then improve it through P3. Include both laptop-hosted and Mini-hosted development homes, without consolidating or replacing the actual homes. Fix repeated instance, location, setup, or delivery confusion before expanding the feature set.

### P4. Review and continue local work

- [ ] P4.1 Use published Git commits for review worktrees, local setup, checkpoint labels, refresh, and dirty-checkout protection. Do not capture unfinished files while the agent is editing them.
- [ ] P4.2 Implement the transfer lock, confirmed source stop including owned background tools and preview processes, final event checkpoint, ordinary Git commit/push, destination verification, and generation change. Reuse existing close/stop and preview supervision.
- [ ] P4.3 Implement fresh-session handoff, prior-history access, native-binding history, and a visible continuation event.
- [ ] P4.4 Preserve held messages, source artifacts, and recovery actions across every failure stage.
- [ ] P4.5 Route existing commit/PR/restart/archive helpers through ownership checks and retire only the takeover paths replaced by this flow.
- [ ] P4.6 Test unavailable source, push rejection, untracked work, divergent/stale branches, failed setup, changed references, and failure before/after ownership changes.

**Dogfood gate C:** review and continue real work in both directions. The person can tell whether they are viewing, reviewing a checkpoint, or continuing locally, while staying in the same Ri work record. Deliberately interrupt a transfer and recover without lost files or two active owners.

### P5. Existing-data adoption and personal release

- [ ] P5.1 Rehearse reconciliation of selected unique data from isolated copies of the existing two homes. Verify linked records, attachments, and unpublished work without modifying the originals.
- [ ] P5.2 Demonstrate the worker replacing the old local-home workflow in development, including verification and archival of the simulated retired root. Document the separate production cutover and recovery steps.
- [ ] P5.3 Implement and rehearse stopped home relocation with stable identity, path relinking, address changes, and prevention of dual writers.
- [ ] P5.4 Package the small companion with installation, start at login, reconnect/update handling, and local stop controls.
- [ ] P5.5 Verify that an unfamiliar person can pair a phone, connect a computer, select a project, and recover from disconnection without architectural coaching.
- [ ] P5.6 Rehearse rollback and document exactly which data and local artifacts are preserved.

**Gate:** the personal journey works without pasted commands after installation, preserves existing work, and supports moving from laptop-as-home to an always-on home.

### P6. A standalone team without AI

- [ ] P6.1 Add space/member identity, owner/member authorization, invitations, revocation, assignment, and actor-attributed history. Host the space with the existing server/address setup and an independent data root.
- [ ] P6.2 Build shared tasks, notes, keyword search, attachments, and first-run UI without a personal home or harness requirement.
- [ ] P6.3 Enforce AI-disabled behavior across automatic dispatch, embeddings, background jobs, and model setup. Keep execution/host-command routes unavailable to the team surface.
- [ ] P6.4 Add atomic content-revision checks to shared-body writes, ordered autosaves, retained drafts, and explicit conflict resolution in the direct team UI and agent actions. Reuse version history, without presence locks or live co-editing.
- [ ] P6.5 Test invitation expiry/reuse, removal, forged actors, attachment access, simultaneous edits, and zero model calls with an ambient API key present. Verify member and human/agent attribution for local and remote changes.

**Dogfood gate D:** a Family or small-team development space includes a non-AI participant doing real shared work from a phone. They do not encounter worker, harness, or workspace setup. Shared tasks and notes are useful before adding connectors.

- [ ] P6.6 After that pilot, expose the bounded non-AI task-source browsing/attachment flow with owner-managed credentials and member-scoped operations.
- [ ] P6.7 Verify connector administration boundaries, credential isolation, published-source access, and zero model calls in the connector flow.

### P7. Shared obligations inside personal Ri

- [ ] P7.1 Connect as a space member without granting access back into the personal home.
- [ ] P7.2 Implement assignment projections, stable source identity, freshness, private overlays, and reassignment/deletion handling.
- [ ] P7.3 Implement online shared-field commands with idempotency and the same content-revision checks, ordered autosaves, conflict comparison, and draft preservation as the direct team UI.
- [ ] P7.4 Include assigned work in the personal deck and provide ordinary human browsing/search of shared notes.
- [ ] P7.5 Implement deliberate result publication with audience selection and no implicit transcript sharing.
- [ ] P7.6 Test membership revocation, source outages, competing edits, unknown command outcomes, private subtasks, and incoming team content that requests personal execution.

**Gate:** handle a team assignment in personal Ri, publish its chosen result, and update shared status without leaking private context or granting the team personal-worker authority.

## 12. Dogfood decisions and release acceptance

### 12.1 Decisions after use

These questions do not block the build above. Each has a specified initial behavior. Change the contract only when the observed problem warrants it.

| Question | Build now | Evidence needed for a later change |
| --- | --- | --- |
| Do local files create more friction than they remove? | File-owned machine paths, home-owned work/identity | Repeated setup or repair problems using the real two-computer layout. Do not implement two authorities in advance |
| Does handoff lose important working context? | Fresh native session with history access | Real continuation failures attributable to lost context. Then run a genuine two-machine native-transfer experiment |
| Are task/note discussions needed? | Existing execution chat and shared task/note content | Concrete decisions or handoffs lost because no durable task/note thread exists |
| Must an orchestrator or cron run elsewhere? | One home scheduler/orchestrator, fixed agent main chats | A recurring useful job blocked by placement, not a hypothetical fleet use case |
| Is explicit default selection too much work? | One-off Run on does not change the saved default | Repeated intentional choices, weighed against unexpected dispatch after changing screens |
| Is home-unavailable access a substantial problem? | Retain drafts, show last received data where already available, no independent writes | Measured interruption during ordinary laptop/phone use before adding bounded offline support |
| Do local review and remote previews cover the loop? | Published Git versions, safe existing preview support, local editor opening | Repeated transfers whose only purpose is a missing review capability |

Do not turn these questions into speculative backlog checkboxes. Record the problem, the smallest change, and its acceptance case before extending scope.

### 12.2 Required verification

| Case | Passing result |
| --- | --- |
| Implementation and dogfood start | Separate worktree and verified dev paths, identities, credentials, ports, and project files. Production keeps running unchanged |
| Same work opened on another screen | Same identities/history, no execution move or forced navigation |
| Connected CLI creates/updates a task | One mutation at the intended home, no local database fallback |
| Different source/reference layouts | Correct local cwd and references, including generated worktrees |
| Local configuration edited while setup UI is open | Revision conflict handled without silently overwriting the file |
| Local configuration deleted | Confirmed restoration verifies current identity and paths, never silently runs from cached setup |
| Home or worker loses contact | Honest availability and delivery state, no automatic reassignment |
| Laptop-hosted home sleeps with a Mini worker connected | Home remains on the laptop and is shown unavailable. Connecting the Mini did not imply automatic relocation |
| Selected laptop terminal history is imported | Read-only, correctly attributed to that computer, deduplicated, with no upload of unselected sessions |
| Replayed command/event | No duplicate turn or stale cumulative update |
| Permission answer arrives after placement changes | Rejected as stale |
| Personal worker is revoked | New control is denied and stale queued authority cannot resume |
| Local review checkout has edits | Files retained and refresh/publish cannot overwrite them silently |
| Open code here while the source agent works | Fetches a published Git version without committing or copying its changing files |
| Continue here with owned background tools or a preview | Source processes are confirmed stopped before publication and ownership changes. Unrelated processes stay running |
| Transfer fails at any stage | One clear owner, preserved code/history, safe retry/resume |
| Persona changes at home | Applied on a new/explicitly refreshed personal session, no independent replica |
| No-AI team has no harness and an API key in its environment | CRUD/search works with zero model calls before connectors are added. The later connector slice meets the same no-AI requirement |
| Two clients or agents edit a shared body | Stale revision rejected, local draft retained, autosave paused, explicit resolution available in direct team and personal views |
| A member or their agent changes shared work | History identifies the member and human/agent actor on local and remote paths without publishing private session contents |
| Shared content contains instructions to run personal commands | No direct dispatch or authority expansion |
| Team completion or result publication | Only selected shared fields/output leave the personal home |
| Home moves to another computer | Same identity, one authority, other computers' paths remain local |

Run appropriate unit/integration tests with isolated roots, repositories, and fake workers. Run the repository typecheck, relevant runtime/harness checks, and touched-file lint as implementation lands. Packaging and routing changes also require the production build. Use real computers for the cross-machine acceptance journeys.

### 12.3 Product acceptance

Observe the person doing real work, not following an architecture walkthrough. Record repeated setup decisions, manual commands/context copying, time lost to Ri coordination, surprises about where a send runs, and whether failure recovery is understandable.

After initial setup:

- Capture, reply, review, and return without choosing an instance or reselecting a folder.
- Correctly predict where a new execution runs and where an existing reply goes.
- Bring code local and continue it without reconstructing the project by hand.
- Keep private work private while completing shared obligations.
- Use the existing deck workflow across screens without a new completion or refresh model to learn.
- Recover from ordinary sleep, disconnection, or setup failure using the displayed action.

The build is complete when the technical cases and these journeys pass. Additional infrastructure does not compensate for a confusing everyday experience.

### 12.4 Potential future iterations

These are possible responses to observed problems, not requirements or implementation tasks for this build.

| Idea | What it would change | When it could be worth building |
| --- | --- | --- |
| Offline checkpoint recovery | Start separate work from the last published Git version when the source computer cannot be reached | Repeated need to continue away from an unreachable laptop. A stale ownership generation can reject later Ri commands, but cannot stop that laptop's process, filesystem edits, or external Git pushes. Define safe divergent work before promising takeover |
| Native-session transfer | Move a harness's own resume files and internal context between computers, beyond Ri's already-shared conversation and fresh-session handoff | Demonstrated continuation failures caused by missing context, followed by a real two-computer compatibility experiment. Keep native session IDs, paths, and files now to support that experiment |
| Presence or editing locks | Show that someone is editing and optionally reserve a shared body temporarily | Revision conflicts occur often enough to disrupt actual team use. Add expiry and crash recovery only if the simpler conflict UI is insufficient |
| Certificate pinning | Have a worker remember a specific home certificate or key beyond normal HTTPS trust | A demonstrated local-network/self-hosting requirement that the existing reachable HTTPS setup cannot serve. It needs enrollment, rotation, and recovery design and does not by itself establish browser trust |
| Deck as a fluid work palette | Revisit naming, daily generation, carryover, completion, and refresh as one separate product decision | Dogfooding shows the current daily behavior creates unwanted commitment or repeated organization. Preserve current behavior in this build and evaluate the redesign separately |
