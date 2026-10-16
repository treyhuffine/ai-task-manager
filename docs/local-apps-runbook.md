# Running local apps

Apps are enabled by default on the Home. Normal startup needs no environment flag. Set `RI_LOCAL_APPS=0` before starting the Home to disable the feature. Browser input cannot change it. Set `RI_CHAT_SOURCES=1` separately to enable exact `@` references to apps and connected accounts. That shared feature also works when local apps are off. Use disposable Homes for qualification, with the qualified macOS arm64 Node 26.5.0 runtime, ABI 147.

Normal startup after pulling and building:

```sh
pnpm cli:dev start
```

For an isolated development Home:

```sh
pnpm install --frozen-lockfile
RI_CHAT_SOURCES=1 pnpm apps:dev --home /absolute/path/to/disposable-home --port 42251
```

Open the pairing URL printed by that disposable server. Apps appears above Task Board in the rail. Click it to open the library, or hover to see your apps in its flyout (docs/rail.md). Open Apps, then New app. Describe the desired behavior in the builder chat, build its preview, try it with synthetic records, and use the validated app. It then opens from its row in the flyout. A preview has its own data. Change app stages a separate copy and preserves installed records when activated. View output shows bounded build/runtime diagnostics. Settings shows a managed service’s worker health, setup needs and bounded job summary. Reopen view recovers an expired controller after an authorized access change.

The app header's Ask Ri opens its app-use chat beside the app. In any other chat, the composer's app button (next to Attach) opens an app beside the conversation without replacing it or its composer. Chat access grants selected actions to that chat. For Finances, native Chat access opens its account chooser for the current chat. Select accounts and read, evidence, write or sync permissions, then save the host grant. Native controls bind the app-issued reference automatically. The reference grants no access by itself. Finances read, evidence, write and sync permissions remain separate.

## Included catalog artifacts

Opening the catalog or its fictional demo executes no app and connects no account. Preview app creates a separate preview. Continue setup reopens that saved preview, including after a restart. Use app activates the reviewed package and its catalog entry then shows Added. Normal builds stage the included catalog, and development starts prepare missing or damaged artifacts. Finances is included on its qualified macOS arm64 Node 26.5.0 runtime, ABI 147. Other platforms include the portable tracker.

Source for Finances lives in `apps/finances` in this checkout. It uses the shared public SDK during development. Its portable build exports the SDK, pins independent dependencies and qualifies the app without workspace links. From the repository root:

```sh
pnpm apps:catalog
```

`apps:catalog` builds the current Finances source and stages it with the tracker. `apps:dev` does this automatically before starting the Home. A changed installed package offers Review update in the native library. That opens a separate preview based on the new catalog artifact. Use app explicitly activates it, preserves the installed instance and records, and requires renewed grant review. Customized app source is preserved in the previous package during activation. The existing user-facing URL and tool names remain compatible.

See [the shared development guide](finances-development.md) for source ownership, commits, commands and portable dependency resolution.

The catalog is staged under `release/local-apps/catalog`, independent of a Home. Desktop and headless runtime packaging build and include it by default. The earlier `--with-local-apps` option is no longer needed. A release still needs the normal desktop packaging inputs and checks. App source code, schema and UI stay in the Finances package.

If an already running source Home has an empty library after a merge, run `pnpm apps:catalog`, then reopen Apps. The catalog is read on request, so no Home restart or installation is needed to list the apps. This stages reusable packages only. Preview and Use app remain explicit. `pnpm apps:catalog --if-missing --compatible` reuses verified staged archives and builds only missing packages qualified for the current runtime.

Listing the catalog and starting an app are separate checks. A catalog can be
visible while the Home's launcher cannot start a preview. If both included apps
fail with empty app output, inspect the Home server's error for a missing SDK
module. Next can assign `/ROOT/...` virtual filenames to bundled workspace code.
The SDK resolves its runner, validation worker and pinned tools from the real
installed package, falling back to the host's working directory when that
virtual filename cannot resolve modules. A launcher code fix requires rebuilding
and restarting the Home server. Refreshing a viewer alone picks up catalog data,
not new server code. Test the fix on a disposable Home before the owner restarts
production. Reopen view clears the failed-start limit for an installed app or a
preview, and shows Retry when repeated starts have been blocked.

Finances starts empty. Add a manual account, then choose or paste a CSV file from Accounts and preview it before importing. Transactions provides search, filters, corrections, export and Save month view. Budget lets you create and review a proposal, explicitly adopt it, preview adjustments, apply them against the current revision and undo the last change. Saved specialist views remain available from Overview. Ask about your finances opens the native Ri conversation with an editable draft and never sends automatically. Reload, Back and reopen only read data. Downloads and file selections are mediated by native Ri controls with declared MIME/size limits.

Gmail receipt reads are fixture-qualified for profile, listing, message, history and attachment modes. Live Gmail setup is a separate authorized qualification. Missing Outlook/Plaid operations stay unavailable. Manual records continue to work without connectors. A receipt query is a relevance filter and does not narrow mailbox permission. Removing a local Finances source stops that source. Revoke its host binding in Ri app settings to remove host permission without globally disconnecting an account used elsewhere.

## Travel, Job Search and People

Their source lives in `apps/travel`, `apps/job-search` and `apps/people`, built with the shared kit. `pnpm --filter ri-<app> test`, `typecheck` and `package` work from the repository root. `package` writes to `release/local-apps/dev-catalog`, never the live catalog that a running Home reads. Release staging (`pnpm apps:catalog`, `pnpm build`) builds all three into the catalog.

To qualify them natively, copy the dev-catalog artifacts with the Finances and tracker artifacts into a private folder and start a disposable Home with `RI_LOCAL_APPS_CATALOG_DIR` pointing at it. The header of `scripts/local-apps-included-browser-smoke.ts` has the exact commands. The smoke installs each app from Discover, opens its native Sources dialog, writes through an app action, checks the remembered section across a reload, stages an Ask Ri question without sending, and checks the phone layout.

Connect email in any of the three opens the app's Sources dialog. It shows which Ri accounts are connected, which are granted to the app and which update automatically (one five-minute schedule per app), plus the Ri capabilities the app may use. Connect and Reconnect go to Ri's own account settings. Gmail and Calendar sync are fixture-qualified only.

## Lifecycle and records

App records live in `<app-root>/apps/<instance-id>/data`. Editable previews live separately under `app-drafts`. IDs survive package changes and slug changes. Metadata, grants, schedules and panel bindings are stored in a strict versioned file under the Home's config directory. No core task/note schema migration is added.

Archive revokes grants, panels, credentials and jobs, stops owned processes, and preserves source/records. Remove app and records is a separate destructive control after archive. A failed activation preserves the previous package and stopped data snapshot, disables the instance and offers repair. Do not run old code over a possibly migrated database yourself.

A package export contains reusable source, artifacts, documentation and workflows. It carries no app records, connector credentials, grants or private chats. Whole-Home backup uses a stopped snapshot of enabled apps and resumes them afterward. If quiescence or ownership verification fails, the backup reports incomplete app data. Restore leaves app grants revoked, jobs disabled and panels removed pending explicit review.

To disable Apps, stop the Home, then restart that same Home with `RI_LOCAL_APPS=0`. App metadata and records remain untouched. App APIs/tools are unavailable, no app workers or scheduler participant start, and tasks, notes and chats still work. Deliberately created Ri records and external effects are retained.

## Qualification commands

Use only synthetic records and disposable Homes:

```sh
pnpm test:local-apps
pnpm ts
pnpm --filter @ri/app-kit typecheck
pnpm exec tsx desktop/local-apps-smoke.ts
RI_FINANCE_FIXTURE=apps/finances/release/ri-finance-0.1.0.tar.gz pnpm exec vitest run src/lib/local-apps/finance.test.ts
pnpm iso /absolute/path/to/disposable-home -- env RI_LOCAL_APPS=1 pnpm exec tsx scripts/local-apps-browser-smoke.ts
pnpm iso /absolute/path/to/disposable-home -- env RI_LOCAL_APPS=1 pnpm exec tsx scripts/local-apps-finance-browser-smoke.ts
pnpm iso /absolute/path/to/disposable-home -- env RI_LOCAL_APPS=1 pnpm exec tsx scripts/local-apps-chat-browser-smoke.ts
pnpm iso /absolute/path/to/disposable-home -- env RI_LOCAL_APPS_BROWSER_URL=http://127.0.0.1:42261 pnpm exec tsx scripts/local-apps-catalog-browser-smoke.ts
pnpm iso /absolute/path/to/disposable-home -- env RI_LOCAL_APPS_BROWSER_URL=http://127.0.0.1:42261 pnpm exec tsx scripts/local-apps-start-browser-smoke.ts
```

The browser scripts default to port 42251, except the catalog and prebuilt startup checks, which default to 42261. Set `RI_LOCAL_APPS_BROWSER_URL` for another loopback fixture server. The catalog check clicks Apps, opens both fictional demos, reloads and verifies that browsing creates no installations or grants. The startup check opens and activates both prebuilts, checks tracker preview/data separation, reloads and opens each app from a second authenticated viewer. The Finance/chat scripts expect staged catalog artifacts and synthetic Finance records. `local-apps-home-smoke.ts` deliberately hard-kills only its verified disposable fixture server during an owned build. `local-apps-disabled-smoke.ts` compares against that script's offline backup. Never run those against a real Home.

From `apps/finances`, `pnpm test`, `pnpm typecheck`, and `FINANCE_KIT_FIXTURE=/absolute/path/to/release/local-app pnpm exec vitest run src/lib/local-app/reference.browser.test.ts` qualify the standalone package and official reference bridge. `local-apps-maintenance-smoke.ts` exercises a fresh builder against source/docs without its creation transcript. Live workflow and bounded-AI smoke scripts require the separately qualified restricted Claude subscription profile. No model API key is used.

[Verification results and limits](local-apps-progress.md) records what actually passed. [The implementation contract](local-apps-implementation.md) remains the protocol and lifecycle reference.
