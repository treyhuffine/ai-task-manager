# Finances workspace refresh

October 15, 2026. Built from main `1a527860` in an isolated worktree, then integrated with the newer Apps library on main `626eb968`. Concurrent uncommitted work in the main checkout was preserved.

The managed home is the product surface. The old setup form is replaced by a responsive React MCP App with an overview, transaction workspace, budget planning and account management. Finance retains its independent service, exact arithmetic and scoped account access. Conversation uses Ri's existing chat.

## Experience and acceptance

- [x] Overview: a readable monthly picture with recorded income, net spending, cash flow, categories, recent activity and actionable attention items. Explain missing coverage and separate currencies. Do not label partial cash balances as net worth.
- [x] Transactions: scoped month/account/category/search filters, newest first, pagination, details, protected evidence, explicit corrections and manual entries. Amounts are normal currency inputs backed by exact minor units.
- [x] Accounts: readable source and freshness states, manual cash/card setup and balance updates, staged CSV preview/import, permitted mailbox setup and access management. No invented bank or credit-score connection.
- [x] Budget: current server calculation, category progress, previewed edits, explicit apply/adopt and undo, with checked revisions. Saved specialist views remain reachable.
- [x] Conversation: contextual questions open Ri's existing chat and stage editable text. Never automatically send, grant access or create a separate Finance chat engine. Selected records and filters are revalidated by Finance before sharing.
- [x] Empty, loading, error, dark, narrow companion and mobile states. Refresh preserves typed drafts and does not apply edits. Keyboard-operable controls and dialogs, meaningful chart alternatives.
- [x] Tests for arithmetic/coverage, scope isolation, effective corrections, pagination, CSV preview, stale budget revisions and protocol/browser interactions. Verify the packed app with the official bridge and run app types/tests/changed lint.

## Boundaries

There are no database schema changes or migrations in either Ri or Finance. New actions go through the existing generated contract. Queries remain bounded by selected accounts and dates. Finance owns every financial calculation. Ri receives only generic navigation/chat intents and authorized model context. Existing saved-view URIs and action names remain stable.

The workspace uses the standard MCP Apps `App` client and opaque, network-free view containment. Forms perform tool calls from validated user events, without adding the sandbox's `allow-forms` privilege. File selection and downloads use Ri's native controls.

`/__host/chat?prompt=...` is an optional Ri navigation intent, transported through standard `openLink`. Ri stages a bounded plain-text paragraph in the existing composer, preserves its text and attachment chips, and focuses it. It never submits or grants access. Outside Ri a host may decline the link. Finance does not contain another chat runtime.

Opening or hiding Ask Ri keeps the app mounted within its page. Ri's desktop/tablet/phone page replacements retain the chosen chat pane in browser-session UI state. The existing chat draft store retains typed text across those replacements. Budget edits and transaction drafts survive ordinary data refreshes. Closing a dialog or navigating away discards that dialog's unsubmitted edit.

Reference images guide hierarchy, calm styling and the connection between data and conversation. They are not evidence of available providers or permission to access personal accounts. Use synthetic records and disposable Homes for qualification. Health is design context, not part of this change.

The palette uses neutral white, gray and charcoal for surfaces, typography, controls, icons and category charts in both themes, including the older saved views and the standalone shell. Color is reserved for financial direction and meaningful status: positive amounts and recorded income, negative amounts and exceeded budgets, and warnings. General navigation and chat controls have no green tint.

## Verification

Qualified on macOS arm64, Node 26.5.0, ABI 147, with synthetic records and disposable Homes only:

- `pnpm finances:test`: 70 passed. Includes the real MCP AppBridge browser fixture, arithmetic, currencies, incomplete coverage, effective transaction search, pagination, forbidden selections, CSV preview/import, revision conflicts and budget apply/undo. An empty-budget browser regression covers a failure found during native qualification.
- `pnpm test:local-apps`: 28 SDK tests and 27 Ri platform tests passed. The optional packed Finance test is run separately with its artifact.
- Native chat-intent tests: 3 passed, covering targeting, delayed composers, literal text, bounds and expiration.
- Integration with the newer Apps library: 48 targeted platform, library, composer and process-state tests passed, including browser checks for source chips alongside app questions, exact chat targeting, reopening chat and pane retention. Ri typecheck passed and changed-surface lint reported only the two existing chat-editor warnings.
- Ri process-state checks: 4 passed. App pane state and pending composer suggestions remain client-only.
- Ri and Finance typechecks passed. Changed-surface lint has no errors. Two existing unused-variable warnings in the chat editor remain.
- The packed artifact passed the official reference MCP Apps bridge test. Desktop, 390 px phone, dark theme and budget-preview renders were visually checked.
- Native Finance browser smoke passed: catalog activation/update, retained records, exact balance entry, native file picker, CSV preview/import, transaction draft across refresh, filtered download, saved view/reopen, proposal/adopt, preview/apply/undo, native chat draft and desktop/tablet/phone pane switching. App questions produced no user-message events.

- `RI_FINANCE_FIXTURE=apps/finances/release/ri-finance-0.1.0.tar.gz pnpm exec vitest run src/lib/local-apps/finance.test.ts`: passed. Rebuilt the exported app with a real source change, retained account/view identities through activation, recovered from an invalid build, checked scope binding and revocation, exported a package without private records and imported it into a clean Home. The first attempt exhausted temporary disk space. After stopping the disposable dev server and removing its generated build output, the complete test passed.
- `local-apps-chat-browser-smoke.ts`: passed. Native account selection/binding, read-scoped saved view, selected record, full-screen navigation and Back, retained composer, close/reopen companion. No copied account credentials or harness sends.

Real account connections and provider sync are outside this qualification. Source setup shows only operations currently supported by Ri's connector broker. Health was not implemented. Production was not restarted and no personal records were opened or changed.

## Review and integration

The implementation preserves the Apps library's source-chip handoff alongside contextual Finance questions in the same composer. Library actions explicitly reopen app chat even after it was closed, while responsive remounts retain the chosen pane. The generated qualified archive is in `apps/finances/release/ri-finance-0.1.0.tar.gz`, and screenshots are in the ignored `apps/finances/artifacts` folder.

The disposable Ri browser server on port 42257 was stopped after qualification. To run the finished experience, use `pnpm apps:dev --home /absolute/path/to/disposable-home --port 42251` from the repository. Normal packaging stages the reviewed source, and installing a new version still uses Review update and Use app. Merely editing or merging source does not replace an installed app's package.
