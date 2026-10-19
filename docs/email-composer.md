# Email in chat

When someone asks to draft or send an email, the harness calls `create_email_draft`.
A composer appears directly in the transcript with a sending account, To, optional
Cc and Bcc, subject, and a plain-text message. Both the human and the AI can fill it
in. The human sends from the card through a connected native Gmail or Outlook account.
No connected account is required to draft. The account picker links to Connectors
when an account needs connecting.

This is a local draft, not a draft synchronized into the provider mailbox. File
attachments, rich HTML, and reply threading are outside this composer. Existing
provider tools retain their separate capabilities and normal approval policy.

## Draft tools

All four actions are generated from `src/lib/orchestrator/email-actions.ts` and
are available through the CLI and orchestrator MCP:

| Action | Input | Result |
| --- | --- | --- |
| `create_email_draft` | Stable `request_id`, optional `connectionId`, `to`, `cc`, `bcc`, `subject`, `body` | `{ id, sessionId, draft }` |
| `get_email_draft` | `id` | Latest draft and revision, including human edits |
| `update_email_draft` | `id`, `expected_revision`, partial `patch` | Updated draft |
| `list_email_accounts` | None | Live Gmail/Outlook accounts in this agent's authorized account scope |

Recipients are comma-separated bare email addresses. Incomplete fields can be
saved while typing. Sending requires valid addresses, a recipient, a subject, a
message and a live sending account. Header fields reject line breaks.

Identity always comes from the signed chat credential. A tool cannot create,
read or edit another chat's draft by supplying a session id. Execution chats get
a narrow email MCP at `/api/orchestrator/email/mcp` when their harness supports
strict MCP isolation, plus CLI guidance. Main and content chats use their existing
orchestrator tools. Background result reviewers receive no email tools.

CLI operations forward to `/api/email/action` in the running Home so changes
broadcast immediately. That signed protocol supports drafting operations only.
Internal UI reads and mutations use the typed `email` tRPC router.

## Persistence and concurrent edits

A draft is the versioned JSON content of an `email_draft` chat event. Its type is
`StoredEmailDraft` in the Drizzle schema, exported as `EmailDraft` from `src/db/types.ts`.
There is no new table or migration. The existing session/external-event unique
index makes creation retry-safe. Reusing a request id for different initial
content fails. Replaying the same creation returns the draft with its current edits.

Every change uses an exact event lookup and a content compare-and-swap. A successful
change advances the draft revision and the event's `partRevision`, so existing
transcript caches replace the card instead of dropping its update. No operation
scans or sorts a session's chat history.

The editor saves immediately and coalesces edits arriving during a save. Only
acknowledged fields leave its local overlay. A concurrent AI or human edit causes
a revision conflict. The human can inspect saved values, explicitly keep their
edits, or use the saved draft. Unsaved input has a tab-local recovery copy in
`sessionStorage`. Recovery does not automatically overwrite newer saved input.
If another viewer sends while local changes are unsaved, the sent card shows the
actual sent message and retains those unsent edits separately.

Save mutations carry `carriesInput`. An acknowledged send runs on the Home even
if the viewer leaves. `email.update` remains admitted during a service drain,
while sending does not.

## Sending

`email.send` is an owner-viewer procedure. It accepts only the draft identity and
the exact reviewed revision. Agents, session tokens, workers and background
reviewers cannot use this procedure. There is no email-draft send action in the
agent registry.

The service claims the revision as `sending` synchronously before awaiting account
discovery or provider work. It rechecks the account and calls the existing
integration engine with an explicit connection id and allowed connection set.
Gmail uses `gmail.send_email`. Outlook uses `outlook_mail.send_mail`, including
`bccRecipients`. Credentials remain inside the existing engine, which still
enforces account access, scopes, consent, redaction and audit.

The owner already authorized the exact message by clicking Send. The approval
policy therefore admits only the host-stamped `app:email-composer` caller for
those two send actions. Ordinary harness calls keep their existing approval gate.
An agent or guest cannot select this caller identity in tool input.

Successful sends become `sent`. Repeating that request returns its receipt and
never sends again. Known pre-dispatch or provider rejections leave an editable
draft with an error. A failure that may have crossed the wire becomes `uncertain`.
Missing Gmail receipts also remain uncertain. Neither an uncertain send nor a
crash-time `sending` claim can be blindly retried after restart. The UI reads for
confirmation and asks the human to check Sent mail if confirmation is unavailable.
This favors avoiding duplicate email over automatic retries without provider
idempotency guarantees.

## Verification

```sh
pnpm exec vitest run src/lib/email/email.test.ts src/hooks/use-email-draft.test.ts
pnpm --filter @integrations/engine test
pnpm exec tsx scripts/email-composer-browser-smoke.ts
pnpm ts
```

The tests cover persistence, request idempotency, partial edits, revision
conflicts, live transcript revisions, account scope, recipient validation,
both provider mappings, send claims, uncertain delivery, the viewer authorization
boundary, typed-input retention and AI edits during typing. The browser fixture
uses the real composer and tRPC client with fake APIs. It checks desktop and phone
layouts, Cc/Bcc, account selection, conflict resolution and lost-send recovery.
It sends no real email and does not open a Home. Screenshots go to
`.work/email-composer`.
