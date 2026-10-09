# Finances

A separate local app with its own server, SQLite database, private evidence folder, background worker and MCP Apps UI. Ri hosts its network-free views and scoped tools through the generic local-app service adapter. Its source lives in Ri's `apps/finances` workspace and consumes only public app-kit exports. The app does not import Ri domain code or open a Ri Home database.

The app includes editable monthly budgets, pending and posted spending, explained forecasts, card obligations, scenarios with undo, receipt matching, two independent refund gaps, recurring payments, manual records and CSV import/export. Views are saved declarative definitions. Their financial values come from server calculations. Reloading a view performs a read and never repeats an action.

## Develop with Ri

Source and changes are committed from the Ri repository root. See [the shared development guide](../../docs/finances-development.md).

```sh
# From the repository root
pnpm install --frozen-lockfile
pnpm finances:test
pnpm finances:typecheck
pnpm finances:package
pnpm apps:dev --home /absolute/path/to/disposable-home --port 42251
```

The standalone commands below run from `apps/finances`. Its portable package and data ownership remain independent.

## Run a fictional example

Requires Node 22 or newer and pnpm 10. The qualified subscription extraction profile currently requires macOS, the installed Claude subscription CLI and optional Homebrew Poppler for PDF invoices. Other harnesses fail closed and allow manual review.

```sh
pnpm install
FINANCE_ROOT=/private/tmp/finance-app-demo FINANCE_SYNTHETIC=1 pnpm seed
FINANCE_ROOT=/private/tmp/finance-app-demo FINANCE_SYNTHETIC=1 pnpm dev
```

Open `http://localhost:42301`. Retrieve this app's owner key in a separate terminal and enter it on the sign-in screen. Treat the key like a password.

```sh
FINANCE_ROOT=/private/tmp/finance-app-demo pnpm keys owner
```

On other operating systems, choose a folder underneath that system's temporary directory. Ordinary startup defaults to `~/.personal-finance`. Set `FINANCE_ROOT` consistently for the server and all CLI commands. Seeding requires explicit synthetic mode and refuses an ordinary data folder. The synthetic example is visibly labeled.

```sh
FINANCE_BUILD=1 pnpm build
FINANCE_ROOT=/private/tmp/finance-app-demo pnpm start
pnpm typecheck
pnpm lint
pnpm test
```

`FINANCE_BUILD=1` keeps build workers from starting runtime jobs or opening a data home. Runtime migrations verify immutable SHA-256 migration digests and foreign keys. New schema changes require a reviewed forward SQL file. `pnpm db:generate` writes a proposal under `drizzle/generated`, which is not automatically applied.

## MCP tools and embedded UI

Streamable HTTP is served at `/mcp`. Create an account-scoped client key in Accounts and settings, or use the CLI. Keys can grant `read`, `evidence`, `write` and `sync` independently. The CLI returns a secret once. Store it outside the repository.

```sh
FINANCE_ROOT=/private/tmp/finance-app-demo pnpm keys create 'My MCP client' read,evidence <comma-separated-account-ids>
FINANCE_ROOT=/private/tmp/finance-app-demo pnpm keys list
FINANCE_ROOT=/private/tmp/finance-app-demo pnpm keys revoke <client-id>
```

Configure the host with URL `http://localhost:42301/mcp` and an `Authorization: Bearer <client-key>` header. A remote host needs its own HTTPS reachability and credential setup. No tunnel is installed or started by this app. Set `FINANCE_PUBLIC_URL` when explicitly exposing it so host validation and provider callback URLs use the selected public origin.

For local stdio hosts, run `pnpm --silent mcp:stdio` from this repository with `FINANCE_ROOT` and `FINANCE_MCP_TOKEN` in the process environment. The startup hook builds its packaged renderer before opening the stdio transport. Stdout contains MCP protocol traffic only. An example configuration is in [mcp-client.example.json](mcp-client.example.json).

`finance_open_view` advertises the stable `ui://personal-finance/renderer-v1.html` resource before execution and returns a selected view and revision. The resource uses the official MCP Apps SDK. A standard SDK host is tested separately from the app's own sandboxed iframe. Ri and the official reference AppBridge are qualified with synthetic records. Public ChatGPT distribution remains a separate qualification.

Iframe callbacks and MCP tools use the same domain operations as the authenticated standalone UI. No token, private credential or host filesystem capability enters the iframe. Generated definitions accept only allowlisted datasets, metric bindings and actions. The optional custom HTML experiment is a static fictional artifact under `src/lib/finance/fixtures`. It has no independent write authority or general code-hosting runtime.

## Ri connector boundary

Managed Ri mode uses the scoped version 1 local-app connector broker. Gmail profile, list, message, history and attachment modes are fixture-qualified. Managed Outlook and Plaid operations remain unavailable until separately implemented and qualified. Standalone account setup shows an unavailable state until a compatible broker is explicitly configured. Manual records and CSV import work independently. See [docs/connector-contract.md](docs/connector-contract.md) for the proposed contract and the later Ri work.

Plaid token exchange and provider credentials stay in the broker. Finance stores opaque connection references and sanitized records. Bank credentials and MFA remain in Plaid Link. Receipt ingestion requests read operations only. Read-only mailbox authorization is broader than application receipt filtering.

Verified Plaid webhooks enter `/api/webhooks/finance/plaid` on this server and queue durable work. Scheduled catch-up remains available when callbacks are missed. No webhook triggers an unrestricted Ri action. The worker runs while this app's server is running, including when its iframe is closed.

The proposed defaults are U.S. personal accounts and USD. Confirm institutions, mailbox providers, history limits, product coverage and Plaid access before connecting real accounts. No real account or mailbox was used during development.

## Managed local app

Finance is an optional independent package in Ri's local app catalog. Add it, try the separate preview, then choose Use app. `/apps/finance` opens empty setup. Enable finances, create a manual account and choose a CSV file. Downloads, file selection and access changes use native Ri controls. No port or owner key is copied into a guest view.

A budget proposal and adoption are separate actions. Open budget view to stage a dining limit, explicitly apply it or undo the last change. Polling retains staged edits. A concurrent budget change offers refresh while retaining the proposal. Reload, Back and reopen do not write. Saved views can open beside an existing Ri chat without replacing the conversation or its typed input.

Open Ri Chat access, choose account access, select Finance accounts and read, evidence, write or sync permissions, then save the host grant. Native controls bind the app-issued reference to the current caller without copying IDs or credentials. Every callback rechecks both host grants and Finance account authority. Native app settings show the service worker's condition, setup needs and bounded job summary. Source removal stops Finance's local source. Revoke the corresponding Ri binding to remove host access without globally disconnecting another app's account.

The packaged runtime is qualified for macOS arm64, Node 26.5.0, ABI 147. A mismatch is rejected before service execution or migrations. Builds and dependencies are trusted native code. Finance's managed runtime receives ephemeral credentials only in private IPC and never writes them into config. The worker continues with the view closed and stops with the owned service.

```sh
pnpm install --frozen-lockfile
pnpm package:local-app
```

Development links the shared workspace `@ri/app-kit`. Packaging exports the current public SDK and reviewed standalone dependency resolution into an isolated project, then builds it without workspace links. Packaging checks the actual Node target and installed native SQLite module, builds the standalone server with `FINANCE_BUILD=1`, and emits `release/ri-finance-0.1.0.tar.gz` plus `release/catalog-entry.json`. The package has no Home IDs, records, grants or connector keys. Ri source rebuilding uses the declared recipe and preserves records and workflow resources.

Archive, update and whole-Home backup stop writers before copying Finance data. Failed activation preserves the prior package and data snapshot for explicit repair. Restore requires new grant review. No live mailbox/bank qualification, public endpoint or marketplace execution is claimed.

## Privacy, backups and follow-ups

Records and attachments are private to this app. Restricted receipt extraction uses the user's subscription CLI, no tools or ambient MCP, a disposable work directory, an OS file/process boundary and an allowlisted model endpoint proxy. Real boundary probes run before extraction. Unsupported profiles do not fall back to an unrestricted harness. AI text is explanation or a proposal, never the owner of financial arithmetic.

Follow-ups are deduplicated local outbox entries with generic text and finance references. They do not create Ri tasks yet. The later Ri handoff must permission-check finance links and avoid copying receipts or transaction details into general task embeddings.

```sh
FINANCE_ROOT=<live-finance-folder> pnpm backup create <new-backup-folder>
# Stop the destination server first. The destination folder must be empty.
FINANCE_ROOT=<empty-restore-folder> pnpm backup restore <backup-folder>
```

Backups include the consistent SQLite snapshot, referenced evidence files and private configuration. Keep them protected. A restored home blocks financial access and jobs until the owner reviews it. Deleting live finance data removes its records, caches and private files. Backups, prior exports and previously shared copies remain under their existing retention and are disclosed separately. Broader cleanup is a separate action.

The implementation checklist and qualified boundaries are in [docs/implementation.md](docs/implementation.md). The original task specification is preserved for traceability in [docs/source-task-spec.md](docs/source-task-spec.md). The independent-app decision supersedes its first-party Ri storage and UI sections.
