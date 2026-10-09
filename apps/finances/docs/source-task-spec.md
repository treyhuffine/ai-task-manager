# Finances plugin: budgeting, spending, receipts, refunds and subscriptions

Specification for review, October 6, 2026. This task is the source of truth for scope. Writing this spec does not authorize implementation, connecting accounts or starting monitoring.

## 1. Outcome and product principles

Build a personal finance app inside Ri as an optional plugin with an embedded MCP Apps iframe and agent-accessible tools. Connect the owner's banks, credit cards and receipt mailboxes. Help them plan spending, understand what remains in their budget, find subscriptions, and ensure promised refunds actually arrive.

Budgeting is a core first-release feature, alongside transaction and receipt reconciliation. The experience should reduce ongoing maintenance: propose a useful starting budget, remember corrections, keep records current, and surface a small number of actionable findings.

The UI must adapt to what the user asks. We do not need to prebuild every dashboard or analysis screen. Build a dependable host and rendering foundation, then let the agent compose interactive views from validated data at runtime. Financial records and calculations remain stable across different views.

Planning assumptions, pending owner confirmation before account setup: U.S. personal accounts, USD as the initial base currency, personal Home deployment first, and ongoing email monitoring. Public rollout is not a prerequisite for this personal release, while account isolation and connector boundaries must support later distribution. The earlier phrase about “tomorrow my emails” is interpreted as monitoring email, not a reminder for tomorrow. Institution/issuer names and receipt mailbox providers are still needed. No real financial accounts or mailbox contents have been inspected for this spec.

## 2. User workflows

The user can:

- Connect bank/card accounts and receipt mailboxes, see exactly what synced, and repair an expired connection.
- Say “Help me make a budget” and receive an editable proposal grounded in income, recurring obligations, recent spending and their goals.
- See budget versus actual spending, pending commitments, remaining room and an explained end-of-period forecast.
- Ask “Can I spend another $300 this month?” and inspect the assumptions, upcoming obligations and incomplete data behind the answer.
- Ask “Show dining and subscriptions over the last six months” and get a custom interactive view without a new app deployment.
- Ask “What if I lower dining by $150 and cancel these two subscriptions?” and compare a scenario with the current plan before applying changes.
- Open a purchase and follow its receipt, charges, return deadline, refund promise and actual credits in one timeline.
- Investigate unexplained deductions, missing refunds, duplicate charges, upcoming renewals and charges after cancellation.
- Create a linked Ri task for a follow-up, with the relevant evidence and a deduplicated issue reference.

## 3. Connections and onboarding

### Banks and cards

Use Plaid Transactions as the initial data source, through an independently authorized Ri connection. A ChatGPT finance connection is not an API credential Ri can reuse. Verify each institution's product coverage and available accounts rather than promising universal support.

The personal setup requires a Plaid developer account, eligible Trial or paid production access, sealed client credentials, and Plaid Link for institution authentication and account selection. Bank credentials and MFA stay in the provider's flow. Add reconnect/update mode and disconnection from the start.

Plaid's current eligible U.S./Canada Trial permits up to 10 Items, each representing an institution connection that may contain several accounts. Removed Items do not replenish the allocation. Check eligibility, product entitlements and terms at signup. Confirm paid pricing before upgrading. [Plaid Trial](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan).

Request up to 24 months of transaction history where available to find annual renewals. Mark actual history limits and freshness. Plaid updates are periodic, not guaranteed real time. Request Transactions first. Include qualification of Plaid Liabilities for supported credit cards in the proposed first release so budgeting can use provider-reported statement balances, minimum payments and due dates. Use explicitly labeled manual entry when fields or institutions are unsupported. Check product entitlement and costs before enabling it, and do not block transaction linking when Liabilities is unavailable. Its optional Recurring Transactions product can enrich our detection but is not a prerequisite. [Plaid Transactions](https://plaid.com/docs/transactions/), [Link](https://plaid.com/docs/link/).

Provide CSV import and manual records for unsupported accounts, with duplicate detection and source labels. Explicitly record excluded accounts so incomplete coverage does not look like zero spending or extra available cash.

Liabilities fields require their own source date and freshness. Missing values are unknown, never zero. A statement balance, current balance, minimum payment and chosen payment amount have different meanings. Do not assume autopay is enabled or that the owner intends to pay only the minimum. Avoid double-counting the liability and its eventual payment. Plaid documents these card fields and approximately daily Liabilities refreshes. [Plaid Liabilities](https://plaid.com/docs/liabilities/).

### Email and merchant evidence

Use Ri's existing Google/Gmail and Microsoft/Outlook connection infrastructure. Reuse a suitable authorized connection when present. A connection in ChatGPT or Codex does not establish a Ri connection.

Request read access for ingestion. Gmail's read-only scope is broad mailbox access: receipt filtering is application behavior, not a provider-enforced restriction. Do not request sending or deleting mail for this feature. Support selected mailboxes, bounded initial history, merchant/order search, HTML-only messages and relevant invoice attachments. Persist stable message IDs and deduplicate forwarded copies.

Extract orders, items, amounts, currency, masked payment hints, dates, return deadlines, promised refund amounts/destinations, renewal terms and cancellation evidence. Use a supplied invoice/order page or explicit user-assisted merchant lookup when email lacks essential details. Do not assume a seller API supplies complete consumer Amazon order history.

For public distribution, verify the OAuth approval requirements separately from a personal deployment. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

## 4. Budgeting

### Setup and maintenance

Default to a monthly plan in the user's timezone and base currency. Let the user choose a different start day. Keep categories few and editable. Propose limits from available history while separating unusual one-time spending and explaining history gaps. Never assume historical spending is what the user wants to spend.

The initial proposal includes expected take-home income, fixed obligations, flexible category targets, subscription commitments, planned irregular expenses and savings goals. Support manual figures and irregular income with explicit conservative assumptions. The user can adopt or revise the proposal through chat or direct controls.

Store budget periods, category allocations, income assumptions, goals, reserves and revisions as durable records. Future forecast changes must not silently rewrite an adopted plan. Explicitly requested changes may save directly, with a visible diff and undo. Suggested changes remain a proposal until adopted.

Support optional category rollover with a clearly selected policy: none, positive balance only, or positive and negative balance. Snapshot the policy per period. Allocate monthly reserves toward annual expenses and goals without counting those allocations as actual purchases or income. Record corrections and category rules so the user does not repeatedly fix the same merchant.

### Calculations and presentation

Show these separately: plan, posted actuals, pending amounts, known upcoming commitments, remaining allocation and forecast. Every number drills down to source records and includes coverage and an “as of” time. Summaries must not add overlapping commitments twice.

For a category, the basic remaining allocation is its adopted limit plus applicable rollover minus net posted spending. Show pending spending separately and show the additional reduction it would cause. Forecast remaining obligations and variable spending with a disclosed method, excluding obligations already posted or pending.

Transfer and card-payment movements do not count as additional purchase spending. Card payments still matter in a cash-flow view. Interest and fees are spending. Purchases paid with credit count when incurred. Available credit is not available cash. A cash-availability calculation must reconcile outstanding card commitments with upcoming payments without subtracting both twice.

Default posted refunds to a reduction in the original purchase category in the refund's posting period, with a link back to the purchase. Do not silently rewrite a closed month's actuals. Offer a clearly labeled purchase-period analysis separately. A promised refund is expected money, not spendable money. A store-credit refund is not cash.

Distinguish unallocated budget from an estimated amount available to spend. A cash estimate must account for liquid balances, obligations, earmarked reserves, expected income assumptions and source freshness. If required data is missing, show a partial estimate or “Not enough information” rather than a confident affordability claim. Multi-currency totals require an explicit conversion rate/date or separate totals.

### Interactive scenarios

Support changes to category limits, income assumptions, goal contributions and recurring costs in an isolated scenario. Recalculate deterministically and compare against the adopted plan. Sliders change the scenario immediately. “Apply to budget” records one versioned mutation with undo. Simulating a cancelled subscription does not cancel a real service.

Provide timely, deduplicated alerts for projected overspending, known bill pressure, goal shortfalls and material price changes. Thresholds are user-adjustable. Prefer a useful digest over a notification for every transaction.

## 5. Spending, subscriptions, returns and refunds

Preserve exact amounts in currency minor units, source transaction IDs, posting/authorization dates, pending state, merchant evidence and human corrections. Handle modified and removed transactions, pending-to-posted replacements, duplicate imports and transfers between owned accounts.

Detect monthly, annual and variable recurring bills using transaction patterns plus email terms. Distinguish confirmed subscriptions from suspected recurring payments. Show cadence, estimated next charge, annualized cost, price changes, trial deadlines and cancellation evidence. Do not infer that a service is unused from spending data alone.

Represent purchases at order and item level. Support split shipments/charges, multiple refunds, partial quantities, tax/discount/shipping allocations, exchanges, mixed payment methods, gift cards, instant-refund reversals and later recharges. Matching uses multiple signals and confidence, with ambiguous cases available for review. Human match decisions survive later sync and extraction.

Track two independent gaps:

1. Purchase/item allocation versus merchant refund promise: is there an unexplained deduction?
2. Merchant refund promise versus posted settlement: did the promised money arrive at the stated destination?

Synthetic example: a $120 returned item, $96 refund promise and $96 credit means settlement is complete with a $24 deduction to explain. If only $80 arrives, there is a further $16 settlement gap. Do not merge the two findings or automatically label either fraud.

No blanket Amazon “20% after 30 days” rule was verified. Capture the actual order's terms, deadline and refund breakdown, with a source and date. Inferred terms must be labeled. Track the relevant event dates, including delivery, return request, dispatch and refund promise. Do not treat a removed pending charge as a refund or an email promise as proof of a bank credit.

## 6. Plugin UI and on-demand generation

### What MCP supplies

MCP Apps associates a tool with an HTML resource and provides a host bridge for the sandboxed iframe. It does not automatically generate the UI. A resource can be served by our backend, and a stable renderer can receive new structured results without a new frontend deployment. [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview).

Our design inference is that Ri can support both agent-composed views and generated code artifacts on top of this protocol. Neither requires us to hand-design every financial question in advance. They do require a built host, permissions, persistence, data operations and a rendering contract.

### Recommended first release: stable shell, agent-composed views

Build a small shell for opening the plugin, account setup, navigation, loading/errors, accessibility and evidence inspection. Provide starting views for Budget, Needs attention, Activity, Subscriptions and Accounts. These are defaults, not a closed catalog of allowed screens.

Build a generic renderer with a versioned, validated view schema covering layouts, metric cards, charts, tables, timelines, filters, comparisons, sliders and approved action controls. The agent generates the layout and data references based on the question and tool results. It can rearrange the view, change comparisons, add a scenario control and save a useful view, without editing Ri's app code or redeploying it.

The schema must be declarative. Do not accept arbitrary JavaScript expressions, SQL, tool names or network URLs as data bindings. Bind components to authorized datasets, server-calculated metrics, typed scenario parameters and allowlisted actions. Values labeled as actual balances, spend or budget totals must come from those results, not model-authored numbers. Label projections and assumptions separately.

Suggested flow:

1. Resolve the user's question and account/date scope through existing finance tools.
2. Compute the requested financial results on the server and return bounded data plus provenance.
3. The agent proposes a view definition referring to those results.
4. Validate the view, record its version and render it inside the existing plugin iframe.
5. Filters and scenarios call typed operations, then refresh the view. The agent receives only selected, bounded context.
6. Save, reopen or revise the view by ID. Reload renders recorded state or performs an explicit read refresh. It never repeats a prior mutation.

Use a declared, stable MCP UI resource for the renderer. Pass the selected view ID and revision in the tool result. Do not rely on inventing a resource URI only after a tool runs, because a host may preload the advertised resource. Separate data tools from render tools, as the official guidance recommends. [OpenAI UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

### Fully generated HTML/JavaScript

Technically possible: the agent writes a custom artifact and Ri hosts it inside a separately isolated frame. This is an optional second rendering mode when the standard components cannot express a useful interaction. It is not required for the first release's on-demand views, and is not an already working capability.

Such a mode needs immutable/versioned artifacts, restricted dependency builds, no runtime package installation, rendering checks, bounded execution, a strict network policy and no credentials or host DOM access. Static validation is not a security boundary. Generated code must have no independent financial write authority. Any proposed budget change goes through the same trusted operation and visible change semantics as other views. Critical totals and actions remain inspectable in trusted UI.

Include an early synthetic-data experiment to compare declarative composition with one custom generated artifact, then record whether the extra flexibility is needed. Do not make all normal finance workflows depend on repeatedly generating code. Preserve this extension point without building a general code-hosting platform as a prerequisite.

### Persistence and interaction

Persist view definitions, revisions, query/filter scopes, scenario assumptions, origin chat and relevant dataset version/as-of references. Saving a view saves its definition, not a permanently authorized copy of every source record. Reopening rechecks permissions. Handle missing or revoked sources visibly. Label saved snapshots separately from live views.

Bind agent changes to the selected view/revision. Reject or reconcile stale changes after a manual edit, and preserve the last valid view on generation failure. View-local filters do not change stored financial records. Expanding or refreshing a view must not resubmit an external action. Support undo, keyboard use, narrow screens and explicit loading/empty/incomplete states.

Keep plugin access to selected accounts and operations. An iframe receives no Plaid tokens, email tokens, Home bearer credentials or desktop IPC. Link banks through a host-controlled setup flow that can leave the iframe for institution OAuth. The protocol alone does not establish portability to every host, so qualify Ri first and test other hosts separately.

## 7. Backend and data model

Use a dedicated finance domain with namespaced tables in the Home SQLite database for the initial first-party plugin. Reuse Ri's migrations, backup, query layer and types derived from its Drizzle schema. The UI is a separate plugin bundle. Plugin enable/disable governs exposed capabilities and background jobs. This is not a new arbitrary backend-package installer.

Required domain records: bank Items and accounts with sealed credential references, normalized transactions and overrides, receipt/order/item evidence, allocations linking evidence to charges/credits, return/refund cases, recurring-payment streams, budgets/periods/allocations/goals/reserves, scenarios, view definitions/revisions, attention items and durable sync/work state. Exact table boundaries follow implementation review, not duplicated frontend types.

Use the existing connector runtime for account binding, grants, approval, redaction and revocation. The current Plaid adapter defaults to Sandbox and offers four low-level reads with item tokens as action inputs. Add production selection, Link, server-side token exchange, account-bound secret resolution, incremental sync and reconnect/removal. Do not pass access tokens through model tool arguments or UI data.

Expose reusable finance operations for account status, filtered transactions, budget calculation and edits, scenario calculation, purchase evidence, refund cases, recurring payments, findings and view creation/opening. Use stable snake_case public names when finalized. UI callbacks and agent tools must share the same server operations and authorization. Internal JSON calls use Ri's typed tRPC infrastructure. REST remains appropriate for provider callbacks/webhooks and MCP transport.

Apply writes with idempotency, revision/conflict checks and audit history. Queries must be indexed and bounded. Preserve source changes separately from human overrides. Do not compute financial totals in a model, iframe-generated code or general chat event scans.

AI extraction, summaries and view composition use the user's subscription harness through Ri's existing helpers. Deterministic code owns arithmetic, matching constraints, transaction lifecycle and saved-budget mutations. Persist extraction provenance and confidence. Do not introduce a direct model API-key requirement for background finance work.

## 8. Sync, privacy and follow-up

Maintain durable per-connection cursors, retry backoff and catch-up after downtime. Verify and deduplicate webhooks. Support scheduled outbound catch-up so a missed callback does not lose data. Sync continues when the iframe is closed, while the Home service is running. Show stale status when the service or provider is unavailable.

Use Plaid's added/modified/removed sync batches, complete pagination before atomically saving a batch and cursor, and restart from the initial batch cursor on mutation-during-pagination errors. For Gmail, handle expired history with a resync. [Plaid sync](https://plaid.com/docs/transactions/sync-migration/), [Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync).

Treat email and imported documents as untrusted evidence. Extraction cannot send mail, follow arbitrary links, change permissions or invoke finance mutations. Enforce this in the runtime, not solely through prompts.

Add a qualified finance-extraction profile to the existing subscription-harness path. A trusted ingestion step supplies only selected text or parsed attachments and receives schema-validated output. The extraction process has no connector/MCP access, no Ri session credential or session CLI authority, no arbitrary shell or browser tools, and no access to the Home database, credential stores, unrelated files or ambient project instructions. Use an isolated temporary working area, a minimal environment/configuration and only the authentication/runtime access required by the selected harness. Enforce tool, filesystem and outbound-access restrictions at the actual harness/process boundary. An empty tool array, a different cwd or a denylist of a few tool names alone does not establish isolation.

Qualify each supported harness explicitly with adversarial tool/file/network tests. If the selected harness cannot enforce the required profile, return an unsupported-extraction state and allow deterministic import/manual review. Do not silently switch engines, run with broader permissions, or introduce a direct model API-key fallback. The current one-shot helper defaults to the Home as cwd and can skip permission checks on calls without attached MCP, so it must not be treated as sufficient proof of finance extraction isolation. Process only relevant excerpts. Local-first storage does not mean local-only inference: the selected harness provider receives the evidence needed for its work. Do not automatically send financial records into general embeddings, unrelated chats or the daily deck.

Use Ri's attachment system and explicit source references. Finance evidence retrieval must recheck finance/account permissions, including attachment bytes, previews and saved views. A bearer link or ordinary Home-wide attachment authorization alone must not bypass those restrictions. Preserve shared attachments still referenced elsewhere.

Deletion and retention policy proposed for scope approval:

- Disconnect stops jobs and removes/revokes provider access where supported, with a clear choice to retain or delete imported live history. Disabling the plugin stops jobs without deleting history.
- Name the destructive action precisely: Delete live finance data. It covers selected normalized records, source evidence, derived results, private attachment copies no longer referenced elsewhere, cached views and queued work. Invalidate access and open-view state, and prevent a queued job from recreating deleted records. Retain only minimal non-sensitive audit information necessary to record the operation.
- Existing Home backups follow the Home's configured retention. Ordinary finance deletion must not silently remove whole Home backups containing unrelated data. Show that backups may retain recoverable copies, and explain this before deletion. On restore, require review before finance exposure/sync resumes and disclose that older deleted records can return. Do not claim secure erasure of all copies.
- Existing text or exports deliberately shared into chats, tasks, files or external services are separate copies. Provide a discoverable list of copies created by the plugin where references were recorded, explain the limit of that inventory, and offer separately scoped cleanup where supported. Never silently rewrite unrelated chats/tasks or claim to erase downloads, screenshots, provider-held data or unknown copies.
- A broader purge of backups or shared copies is a separate destructive operation with a concrete preview of its effects and explicit owner authorization. Full cross-system erasure is not a v1 prerequisite. No actual deletion or retention change is authorized by this spec.

The owner can revise this proposed policy before release. Implementation must test and document the exact implemented behavior, including backup retention, rather than leave deletion as an unspecified control.

Produce one durable finding per issue, update it when evidence changes, and resolve it when appropriate. Default to an in-app queue and digest. Optional automatic Ri task creation is a user preference with a stable dedupe key. Both manual and automatic task handoff use a generic title/body, an appropriate follow-up deadline and an opaque protected finance reference. Do not copy receipts, transaction amounts, account/card identifiers, merchant-sensitive details or finance attachments into ordinary task fields. Ri's embedding builder includes task title, description, outcome, body and user context, so moving evidence to another normal task field would not solve the privacy issue. Evidence is resolved on demand through an authorized finance operation. General search, embeddings, deck generation, link previews and unrelated agents must not automatically dereference it. Deliberately sharing selected details into a chat is a separate explicit user action with visible disclosure of the destination. This first release does not send claims, cancel services, initiate disputes, pay bills or move money.

## 9. Reuse and dependencies

Coordinate the production host work with the existing Ri Plugin UI task:

[[task:01a0f91f-f818-78ab-9d75-77901a407b06]]

Repository foundations to recheck at implementation:

- `packages/integrations/src/providers/plaid/`: existing low-level adapter.
- Google Gmail and Microsoft mail toolkits: existing read/auth primitives.
- `src/lib/integrations/runtime.ts`: account, permission, credential and call lifecycle.
- `packages/integrations/src/mcp/client.ts`: resource reads and result metadata support now present.
- `docs/plugins-evaluation-agent-views.md`: working public iframe experiments and controlled account tests, but temporary sessions and a separately run host.
- `docs/plugins-spec.md`: broader host proposal. Its October 2 inventory is historical and some gaps have since been addressed.
- `src/lib/harness/one-shot.ts`: background AI access.

The remaining host slice includes durable launch/reopen, result capture and correlation, packaged sandbox hosting, revocation and remote/mobile qualification. This is substantive release work and a release dependency of the finance plugin. Track its deliverables and acceptance in this task or the linked Plugin UI task, with a clear owner, so neither task assumes the other already delivers it. Finance fixtures and backend work can proceed independently once implementation is approved, but a temporary demo host does not satisfy the shipped plugin requirement. Do not claim that today's evaluation completes those requirements. No changes to the read-only agentex reference are assumed.

## 10. Delivery and acceptance

1. **Qualify setup and rendering.** Confirm institution/mailbox coverage, personal Plaid eligibility and actual plan costs. Use synthetic data to prove a runtime-generated budget/comparison view and evaluate one custom artifact. Record the production host boundary.
2. **Build reliable account data.** Implement credentials, Link/reconnect, durable sync, imports and exports. Verify source counts/totals and restart/retry behavior before trusting derived findings.
3. **Build budgeting and financial evidence.** Deliver editable/adopted budgets, scenarios, receipt matching, returns/refunds, subscription monitoring and durable corrections.
4. **Deliver the persistent plugin.** Add default views, agent-composed views, contextual chat, saved-view reopening and trusted mutation controls through the production host slice.
5. **Complete continuous monitoring.** Add attention lifecycle, digest/task handoff, privacy/retention controls and real-account qualification after authorization.

Release acceptance:

- Budget totals match a deterministic fixture and source transactions. Proposed changes do not silently alter the adopted plan. Undo and revisions work.
- Pending/posting, transfer/card-payment exclusion, cross-period refunds, rollover, irregular income, annual reserves, multiple currencies and stale sources have explicit tested outcomes.
- A scenario changing dining by $150 and two subscription assumptions recalculates without changing the adopted budget or cancelling services. Applying once records exactly one intended change.
- The agent can create and revise at least three novel views without deployment: category trends, a refund timeline and a budget scenario comparison. Financial values remain traceable to server results.
- Invalid bindings, arbitrary code in declarative layouts, unauthorized tool calls, cross-account access and stale view edits are rejected. A failed generation keeps the last valid view usable.
- Views and scenarios reopen after browser reload and service restart. Rendering and replay never repeat mutations. Connection revocation takes effect in open and saved views.
- Sync survives pagination interruption, repeated webhook delivery, expired mail history and reconnect without losing transactions or duplicating records/alerts.
- Matching handles same-amount ambiguity, split charges/refunds, mixed card/gift-card refunds, deductions, settlement gaps and refund reversals with source evidence.
- Recurring detection covers annual renewals, price changes, trials and charges after cancellation. It distinguishes suspected from confirmed subscriptions.
- HTML-only receipts, attachments and malicious receipt text are tested. For every qualified extraction harness, attempts to invoke tools, access an unrelated file, read credentials or contact an unauthorized endpoint fail at the runtime boundary. Unqualified harnesses report extraction unavailable without broadening permissions.
- A finance follow-up task's stored fields, generated embedding text, generic previews and deck context contain no receipt or transaction details. Opening its protected reference requires current finance authorization. Revoked access also blocks attachment retrieval and saved-view reopening.
- Card statement fields are checked against fixtures/source evidence, with separate timestamps and explicit missing-data behavior. Minimums, chosen payment amounts, statement/current balances and posted payments are not conflated or double-counted.
- Backups, restore, export, deletion, plugin disable and worker catch-up are verified with synthetic data. Live deletion leaves unrelated Home backups and shared attachments intact, invalidates pending work/caches, and accurately reports retained copies. Restore requires the defined review before finance access resumes. Broader cleanup is previewed and separately authorized. Test on the dev Home, never by restarting or resetting production.
- Remote and narrow-screen UI, keyboard interaction and evidence drill-down are verified. No dependency on the browser's own localhost for a remote Home.

## 11. ChatGPT comparison and open decisions

ChatGPT's Finances product is a benchmark for setup, spending and subscription views. Its documented Plaid flow does not establish a public reusable finance-data API or persistent email-to-refund reconciliation. After user-authorized setup, compare one bank, one card, a known subscription and a known refund, and record coverage and result quality. No such live comparison has been performed. [ChatGPT Finances](https://help.openai.com/en/articles/20001222-finances-in-chatgpt).

Still needed: bank/issuer names, receipt mailboxes, any existing Plaid developer plan and whether rollout beyond the owner's Home is an immediate requirement. These source details are needed for live qualification, not for drafting the design or building synthetic-data foundations after scope approval. Category amounts, savings goals and notification thresholds can be collected during onboarding rather than blocking engineering planning.

Recommended decisions for review: budgeting belongs in the first release, runtime-composed UI is part of that release, a small trusted renderer/host foundation is prebuilt, and arbitrary generated code is an optional isolated extension. Investments, credit reports, tax preparation and execution of financial actions remain separate scope. Implementation starts only after the owner approves the scope.
