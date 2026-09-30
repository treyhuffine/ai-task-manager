# First migration compatibility review

Reviewed September 28, 2026 while implementing the [first connector batch](../connector-implementation.md). No accounts were authorized and no remote mutations were run. These findings initially revised the audit's migration order. The native connectors below remained registered at that point.

**Superseded decision:** The user subsequently waived backward compatibility for these four services. Their native adapters are now removed and the official hosted MCPs are used directly. The comparisons below describe the original compatibility review, not a current migration blocker. See [hosted replacements](hosted-replacements.md).

The initial review required preserving existing action names, accepted inputs, structured outputs, account pins and approval rules. The later user decision removed the tool compatibility requirement. Authentication and approval controls still apply, and app task pickers need their own typed adapters.

| Candidate | Existing contract | Verified gap or unresolved evidence | Decision |
| --- | --- | --- | --- |
| [Resend](https://raw.githubusercontent.com/resend/resend-mcp/main/src/tools/emails.ts) | `send_email` accepts HTML without text and string or array recipients. `get_email` returns structured ID, sender, recipients, subject and delivery status. | Published MCP source requires text and email-address arrays. Its lookup formats unescaped field values into prose and joins recipient arrays, so a parser cannot promise a lossless reconstruction. | Keep both native actions. Revisit with structured remote results and equivalent input support. |
| [Notion](https://developers.notion.com/guides/mcp/mcp-supported-tools) | Seven REST actions accept arbitrary page-property and block JSON, database filters/sorts, and expose a database cursor. | Hosted tools emphasize Markdown and different property/query formats. Documented rows mode returns `has_more` without a cursor. Plan-dependent filters and query allowances differ from the native surface. | Keep native. Require explicit coverage for blocks, properties, filters and pagination before migration. |
| [Linear](https://linear.app/changelog/2026-02-26-deeplink-to-ai-coding-tools) | Six actions, including separate create/update, plus the app's typed issue picker. | The official February 26 changelog combined remote create/update into `save_issue`. Names alone do not establish current arguments, output fields or task-picker compatibility. | Capture authorized current schemas and representative fixtures before implementing aliases and the task adapter. |
| [Calendly](https://developer.calendly.com/docs/mcp/supported-tools) | Five user, event-type, scheduled-event, event-detail and cancellation actions with REST resource/collection outputs. | Official tool descriptions cover these operation families, but exact live argument and result envelopes have not been verified. MCP uses a [distinct DCR flow](https://developer.calendly.com/docs/mcp/calendly-mcp-server). | Retain native until all five mappings, account identity and cancellation approvals pass. |


The reviewed local contracts were in the now-retired `resend/emails.ts`, `notion/toolkit.ts`, `linear/toolkit.ts`, and `calendly/index.ts` files under `packages/connectors/src/providers/`. F01 removed the shared OAuth/account-pin migration blocker. It did not prove tool-level parity, which is no longer required for these replacements.

QuickBooks is prioritized separately. Its official hosted developer MCP requires partner access, so this batch improves the native Accounting API instead. See [QuickBooks implementation and access evidence](quickbooks-implementation.md).
