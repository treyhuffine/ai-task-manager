# Running the local apps trial

The experiment defaults off. Set `RI_LOCAL_APPS=1` on the Home process before it starts. Browser input cannot enable it. Set `RI_CHAT_SOURCES=1` separately to enable exact `@` references to apps and connected accounts. That shared feature also works when local apps are off. Use a disposable Home first, with the qualified macOS arm64 Node 26.5.0 runtime, ABI 147.

```sh
pnpm install --frozen-lockfile
RI_CHAT_SOURCES=1 pnpm apps:dev --home /absolute/path/to/disposable-home --port 42251
```

Open the pairing URL printed by that disposable server. Apps appears above Task Board in the rail. Click it to open the library, or hover to see your apps in its flyout (docs/rail.md). Open Apps, then New app. Describe the desired behavior in the builder chat, build its preview, try it with synthetic records, and use the validated app. It then opens from its row in the flyout. A preview has its own data. Change app stages a separate copy and preserves installed records when activated. View output shows bounded build/runtime diagnostics. Settings shows a managed service’s worker health, setup needs and bounded job summary. Reopen view recovers an expired controller after an authorized access change.

The app header's Ask Ri opens its app-use chat beside the app. In any other chat, the composer's app button (next to Attach) opens an app beside the conversation without replacing it or its composer. Chat access grants selected actions to that chat. For Finances, native Chat access opens its account chooser for the current chat. Select accounts and read, evidence, write or sync permissions, then save the host grant. Native controls bind the app-issued reference automatically. The reference grants no access by itself. Finances read, evidence, write and sync permissions remain separate.

## Included catalog artifacts

Opening the catalog or its fictional demo executes no app and connects no account. Preview app creates a separate preview. Continue setup reopens that saved preview, including after a restart. Use app activates the reviewed package and its catalog entry then shows Added. Releases include Finances and a small tracker only when the artifacts have been staged.

Source for Finances lives in `apps/finances` in this checkout. It uses the shared public SDK during development. Its portable build exports the SDK, pins independent dependencies and qualifies the app without workspace links. From the repository root:

```sh
pnpm apps:catalog
```

`apps:catalog` builds the current Finances source and stages it with the tracker. `apps:dev` does this automatically before starting the Home. A changed installed package offers Review update in the native library. That opens a separate preview based on the new catalog artifact. Use app explicitly activates it, preserves the installed instance and records, and requires renewed grant review. Customized app source is preserved in the previous package during activation. The existing user-facing URL and tool names remain compatible.

See [the shared development guide](finances-development.md) for source ownership, commits, commands and portable dependency resolution.

The catalog is staged under `release/local-apps/catalog`, independent of a Home. Desktop packaging explicitly includes it with `node desktop/package.mjs --with-local-apps`. That release still needs the normal desktop packaging inputs and checks. The normal desktop package without the option carries no catalog artifacts. App source code, schema and UI stay in the Finances package.

Finances starts empty. Enable it, create a manual account and choose/paste a CSV file. Save an Activity view. A budget proposal creates its maintained saved views, while adoption is a separate explicit action. Open budget view lets you stage a scenario, apply it with the current revision and undo it. Reload, Back and reopen only read data. Downloads and file selections are mediated by native Ri controls with declared MIME/size limits.

Gmail receipt reads are fixture-qualified for profile, listing, message, history and attachment modes. Live Gmail setup is a separate authorized qualification. Missing Outlook/Plaid operations stay unavailable. Manual records continue to work without connectors. A receipt query is a relevance filter and does not narrow mailbox permission. Removing a local Finances source stops that source. Revoke its host binding in Ri app settings to remove host permission without globally disconnecting an account used elsewhere.

## Lifecycle and records

App records live in `<app-root>/apps/<instance-id>/data`. Editable previews live separately under `app-drafts`. IDs survive package changes and slug changes. Metadata, grants, schedules and panel bindings are stored in a strict versioned file under the Home's config directory. No core task/note schema migration is added.

Archive revokes grants, panels, credentials and jobs, stops owned processes, and preserves source/records. Remove app and records is a separate destructive control after archive. A failed activation preserves the previous package and stopped data snapshot, disables the instance and offers repair. Do not run old code over a possibly migrated database yourself.

A package export contains reusable source, artifacts, documentation and workflows. It carries no app records, connector credentials, grants or private chats. Whole-Home backup uses a stopped snapshot of enabled apps and resumes them afterward. If quiescence or ownership verification fails, the backup reports incomplete app data. Restore leaves app grants revoked, jobs disabled and panels removed pending explicit review.

To disable the trial, stop its Home, then restart that same Home without `RI_LOCAL_APPS=1`. App metadata and records remain untouched. App APIs/tools are unavailable, no app workers or scheduler participant start, and tasks, notes and chats still work. Deliberately created Ri records and external effects are retained.

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
```

The browser scripts default to port 42251. Set `RI_LOCAL_APPS_BROWSER_URL` for another loopback fixture server. The Finance/chat scripts expect staged catalog artifacts and synthetic Finance records. `local-apps-home-smoke.ts` deliberately hard-kills only its verified disposable fixture server during an owned build. `local-apps-disabled-smoke.ts` compares against that script's offline backup. Never run those against a real Home.

From `apps/finances`, `pnpm test`, `pnpm typecheck`, and `FINANCE_KIT_FIXTURE=/absolute/path/to/release/local-app pnpm exec vitest run src/lib/local-app/reference.browser.test.ts` qualify the standalone package and official reference bridge. `local-apps-maintenance-smoke.ts` exercises a fresh builder against source/docs without its creation transcript. Live workflow and bounded-AI smoke scripts require the separately qualified restricted Claude subscription profile. No model API key is used.

[Verification results and limits](local-apps-progress.md) records what actually passed. [The implementation contract](local-apps-implementation.md) remains the protocol and lifecycle reference.
