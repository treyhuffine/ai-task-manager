# Independent finance app

The owner approved separating finance from Ri on October 6, 2026. This supersedes the first-party Home database and Ri frontend architecture in the earlier specification. Finance owns its server, database, migrations, private attachments, UI, MCP tools and background work. Ri now supplies generic, scoped connector and host operations through its opt-in local-app adapter. Finance remains independent and imports only the public app kit.

Real bank linking, receipt mailbox access, monitoring and publication require separate account setup. Development and verification use synthetic data.

- [x] Independent package, configuration, server and database
- [x] Exact calculations, budgets, scenarios, revisions and undo
- [x] Receipts, partial refunds, recurring terms and correction persistence
- [x] Persistent declarative renderer and standard MCP Apps resource
- [x] Authenticated MCP tools and account-scoped client grants
- [x] Standalone UI, onboarding, manual/CSV import, export and private evidence
- [x] Connector broker contract, explicit unavailable state and contract tests
- [x] Durable sync work, retries, source revocation and event intake
- [x] Isolated subscription extraction and adversarial verification
- [x] Local follow-up outbox, backups, restore review and deletion
- [x] Synthetic agent-composed views, browser/restart verification, tests and build
- [x] Remove first-party finance wiring from Ri, preserve migration history

Live account qualification remains outside this build. The managed integration is qualified separately below.


Verified on October 6, 2026:

- 60 standalone tests pass, with clean type checking, lint and production build.
- The macOS process probes deny unrelated file reads, shell execution, direct network access and unapproved proxy destinations. Unsupported harnesses fail closed.
- A real isolated Claude subscription call extracted the fictional hostile receipt as 1,999 USD minor units. The profile has no tools, ambient MCP or general filesystem access.
- Three synthetic questions produced novel saved definitions: six-month dining/subscriptions, the two refund gaps, and a dining scenario with a slider. Each definition was revised by the agent and persisted without changing frontend code. The date-aware history view records April 6 through October 7, separately from the adopted budget period.
- A real standalone conversation saves and replays its answer while leaving the adopted plan unchanged. Responses carry an as-of time. Revoked evidence access, stale views and changed budgets reject in-flight replies.
- Browser checks pass at desktop and 390-pixel widths, including cookie isolation, slider callbacks, one budget revision per apply, undo, no mutation on reload, and reopening generated views after server restart.
- HTTP and stdio MCP clients read the advertised renderer resource and lose access after key revocation. An official MCP Apps AppBridge host forwarded a scenario callback successfully.
- The static custom-artifact experiment preserves the independent 24-dollar deduction and changes the settlement gap from 16 dollars to zero as the fictional credit slider moves from 80 to 96 dollars. Declarative composition expressed all three tested workflows. Keep the custom-code extension optional. A general generated-code hosting runtime is not implemented.
- Backups restore into an empty folder and block financial access until explicit review. The live deletion path and retention disclosures are covered by domain tests. Previous backups and exports are not silently deleted.
- Ri's finance-specific schema, routes, UI, tools and jobs have been peeled out. Its applied migrations 0009 through 0013 remain immutable. Forward migration 0014 retires the tables and its regression test preserves core task rowids and FTS references. Ri's type check and 47 related tests pass. Production was not restarted.

Qualification limits: broker and provider tests use synthetic replies. No real bank, card or mailbox was connected, and no ongoing real monitoring was started. Protected task delivery and public ChatGPT distribution remain later work. The managed Ri broker and iframe qualification are recorded below. Only the macOS Claude subscription extraction profile is currently qualified. No public URL or tunnel has been created.

## Managed Ri qualification, October 7, 2026

Source is now maintained in Ri's `apps/finances` workspace. The initial implementation was qualified in separate worktrees before consolidation. See [the shared development guide](../../../docs/finances-development.md). Production and the original checkouts remain untouched.

- [x] Relocatable `ri-finance` package, private management IPC, authenticated loopback MCP, actual Node/native ABI checks
- [x] Independent packed public kit dependency, generated actions/contract and two bundled workflows
- [x] Empty native setup, manual/CSV records, native file selection/download, saved views and account scopes
- [x] Explicit scenario adoption/apply/undo, retained conflicting edits and read-only reopen
- [x] Short-lived owner/chat/background principals, distinct host grants, in-flight revocation and no persisted process credentials
- [x] Worker catch-up without an open view, durable history cursors, lease generation and reconnect after revocation
- [x] Source changes preserve records, failed activation preserves stopped snapshots, clean package export/import and restore review
- [x] Existing Ri chat/Apps navigation retains input, scoped selected context and stale/forged/cross-chat rejection

The Finance suite passes 64 tests across nine files. The official reference AppBridge browser test passes separately. Ri's actual packaged-service integration and native browser flows pass, including a source rebuild, grant review after archive, CSV and budget scenario callbacks. The shared containment fixture passes Chromium 151 and Electron 44.4.5. Whole-Home backup and hard parent termination are exercised on disposable Homes with synthetic records. See Ri's `docs/local-apps-progress.md` for commands, evidence and core-removal checks.

Managed Gmail exposes only its five fully implemented fixture-qualified receipt modes. Outlook, bank operations and connection release are not advertised until complete and separately qualified. Local source deletion does not globally disconnect a host account. All provider replies used here are synthetic. No live bank/card/mailbox, public webhook relay, publisher release or additional OS target is claimed. The restricted macOS Claude extraction profile retains its fail-closed/manual-review behavior.
