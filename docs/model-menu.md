# Combined model menu

The chat composer, new-chat launcher and scheduled-run pickers use one control
for model, reasoning effort and model variants. Its button shows the model and effort together.
Search matches model labels, exact IDs and harness names across the supported
catalog, including models inside collapsed sections. Arrow keys and Enter select
a result. Closing the menu clears its search and collapses the provider sections.

The main list contains saved visible models from connected harnesses. Pins
come first within their harness. Unavailable models cannot be selected.
Each provider has its own More models expander for additional supported models.
Picking one adds it to the saved visible list before selecting it, preserving the
provider's configured default model, variant and effort. Unavailable models are
excluded from these additional choices. If the provider's whole supported list
is already visible, its All models expander says so.

Manage models opens Settings > Models, where the existing Visible models
checklist controls the compact list. This uses the existing saved allowlist,
with no additional preference or usage-history query. Connecting a harness and
pinning an exact model ID also live in Settings.

Picking another harness in an existing chat still asks to start a new chat.
The confirmation preserves the destination harness's remembered reasoning
effort, checked against the selected model. Picking in a new-chat draft needs
no confirmation. Changes to a running chat remain disabled during its turn.

## Speed

Agentex 0.0.48 supplies the selected model's native service tiers. Normal sends
`default`, Fast sends `priority` on Codex or `fast` on Claude, and Ultrafast is
shown only when that model advertises it. Future catalog tier IDs retain their
provider labels. Missing speed metadata offers no speed control. An unavailable
tier is disabled with the provider's reason. Unknown account entitlement stays
unknown and does not disable an advertised choice.

New chats explicitly select Normal when the model offers it. A paid catalog
default never enables a faster tier automatically. Existing chats with a NULL
selection retain the native setting and show Provider default until the person
makes a choice. Saved schedules use the same Provider default label for NULL,
while new drafts and server-created schedules initialize Normal explicitly.
The `create_trigger` action resolves omitted or NULL speed for a new schedule,
including API and agent callers. It never selects an advertised paid default.
An omitted schedule model follows the first runnable live catalog model on
each fire. Dispatch resolves model, effort and saved speed together, then
carries that catalog snapshot through first-execution and later-chat creation.
It does not substitute a bundled model when creating the execution. If catalog
changes make the saved speed unavailable for the selected model, the fire is
recorded as failed before creating a chat or starting inference. It never
switches models to obtain a faster tier. Explicit model selections stay explicit.
Unrelated updates and dispatch preserve existing NULL schedules. Changing speed saves it with the
chat, closes its cached harness session on its owning device and resumes the
same native conversation on the next message. A remote recycle is a durable
barrier: earlier queued turns and background work finish before the handle
closes, and later sends wait for it. Permission answers, interruption and stop
controls remain usable during that wait. An explicit close cancels earlier
sends still waiting behind the barrier rather than restarting the chat.
Controls for a sibling chat with an existing live session in the same execution also pass
the barrier. Its follow-up messages keep their queue position, and controls
for a chat that has not started remain behind its initial send.
The worker journals its acquired native identity, so queued specs that still
name NULL resume the same conversation, including after restart and journal
compaction. Each remote send also checks its selection against the live
handle, protecting against an older prepared send arriving after a recycle.
Worker recovery queues prior commands before admitting new ones but keeps
reading the stream for controls. Worker shutdown leaves unsent work journaled
for recovery and never releases it into a new process during teardown. Changes
are refused during an active turn. A model switch keeps a compatible speed or
resets to Normal, without selecting a different paid tier. Trigger and heartbeat
model changes apply the same rule, including direct API and agent actions.

The launcher remembers explicit choices per harness. Chat creation, provider
switches, the main and focused chats, scheduled runs and the heartbeat carry the
selection through the same model controls. Make default and Settings save speed
with the deliberate global or harness default. Changing one chat never changes
those defaults. Background one-shot model policies remain independent.

The `delegate_work` action accepts `service_tier`, saves it with the durable
assignment and forwards it to execution creation. A retry keeps the original
speed and rejects changed intent, like the other launch options.

A missing heartbeat seed initializes Normal from the scheduled model catalog,
using the same resolver as new schedules. Reading or enabling an existing
heartbeat preserves its saved NULL. Manual and automatic AI reviews save the
resolved speed in their immutable reviewer assignment and copy it into the
review chat. Matching global or harness defaults may supply an explicitly
chosen faster tier. A different model initializes its own Normal, and missing
speed metadata stays NULL. Retrying a saved review keeps its assigned speed
even if defaults change. Legacy assignments without a speed retain their
native behavior. Completed review evidence can be reused across speed choices
because reuse performs no new inference.

Creation paths were checked across main chats, focused document and skill
chats, execution launches, sibling chats, scheduled runs, heartbeat and AI
reviews. Imported history retains its recorded native settings. Team discussion
chats do not run a personal harness and do not initialize a speed.

The server validates explicit speeds against the model catalog before saving
or dispatching. Session specs carry `serviceTier` to both local and connected
runners. Connected devices must explicitly report speed support, so an older
worker cannot ignore it. Agentex repeats native runtime, model, config and
routing validation before inference. The menu displays the configured choice,
which is not a promise of account access, effective processing speed or billing.
Native speed telemetry is excluded from transcript content.

Four nullable columns store these preferences in migration 0020. The migration
only adds columns, with no policy defaults or table rebuilds. Existing chat and
trigger rows retain their native behavior.

The gallery's Model, effort and speed example uses the same presentation
components. It has fictional capability sets for three speeds, Normal/Fast,
no speed support and pending support. Its visibility controls and selections
stay local to the example.

## Implementation and verification

- [x] One searchable menu in the chat composer, launcher and scheduled-run pickers
- [x] Existing model visibility settings and one Manage models destination
- [x] Independent provider expanders and search across additional supported models
- [x] Provider/model-aware effort and variant options
- [x] Controlled speed UI and interactive gallery states
- [x] Upgrade to Agentex 0.0.48 and carry live model speed metadata
- [x] Save speed with chats, launches, scheduled runs and deliberate defaults
- [x] Validate speed at server and local/remote runner boundaries
- [x] Connect Normal, Fast and Ultrafast in the live menu
- [x] Verify persistence, unsupported models, session recycling and browser behavior
- [x] Verify offline queued work, permission replies, interruption and close during recycling
- [x] Verify stale send snapshots, restart recovery and journal compaction
- [x] Verify server-created schedules select Normal and legacy schedules retain NULL
- [x] Verify sibling-chat permission answers, interruption and close during recycling
- [x] Verify fresh heartbeat creation and dispatch, concurrent seeding and legacy NULLs
- [x] Verify manual and automatic AI-review speed snapshots, retries and assignment guards
- [x] Resolve omitted schedule models from the same live catalog as speed validation
- [x] Verify workspace one-offs, first and later recurring fires, discovery changes and concurrent fires

Presentation lives in `src/components/chat-ui/model-menu/`. Saved visible
model reads are composed by `src/components/settings/visible-model-options.tsx`.
Chat switching stays in `src/components/executions/composer-provider-menu.tsx`.
Choosing another provider starts a fresh chat immediately when the current
transcript has loaded with no events and no send or turn is in flight. Chats
with history, or whose transcript is still loading, keep the confirmation.
Both paths preserve the selected model and the destination provider's settings.

Run `pnpm --filter @ri/app-kit build` before typechecking or building gallery
artifacts in a fresh worktree. Run `pnpm gallery:build`, then:

```sh
RI_MODEL_MENU_BROWSER_TEST=1 pnpm exec vitest run src/components/chat-ui/model-menu/model-menu.browser.test.ts --testTimeout=15000
```

The browser tests use a local fixture server and mocked harness reads. They
exercise the actual menu, keyboard search, effort changes, provider-switch
confirmation, remembered effort, visibility settings, provider expansion,
enabling a hidden model without changing defaults, save failures, running-state guards,
speed capability sets and phone-width collision handling. They never start a
harness or access a real home's data. Set `RI_REVIEW_CHROMIUM` to override the
Chromium executable and `RI_MODEL_MENU_SCREENSHOTS` to save review images.

Speed integration regressions: `pnpm exec vitest run src/lib/harness/service-tiers.test.ts src/lib/executor/speed.test.ts src/lib/executor/trigger-selection.test.ts src/lib/executor/devices.speed.test.ts`. The browser suite also covers live native tier IDs, unavailable choices and launcher persistence.

Review regressions include a home and worker in separate processes: Fast to Normal must finish earlier queued work, retire the remote handle before the next send, preserve the native conversation, and pass explicit Normal to the new handle. Permission replies, interruption, explicit close, stale preparation snapshots and received-command recovery exercise the actual worker loop. Command and journal tests cover teardown, close failure, placement fences, restart and compaction. Schedule creation tests run the resulting schedule through dispatch into the fake harness, alongside legacy NULL schedules. Scheduled model changes and the actual saved-schedule picker separately verify the difference between NULL and Normal.

Schedule selection regressions deliberately put a live provider model ahead
of a different bundled model. They verify manual and timed workspace fires,
first and subsequent cron/every fires, and orchestrator fires through the actual
dispatcher into the fake harness. Coverage includes explicit Ultrafast, newly
initialized Normal, legacy NULL, explicit models, provider-owned IDs outside
bundled naming conventions, changing catalog order, and simultaneous first
fires sharing one execution. These checks use disposable homes and no live
provider inference.
