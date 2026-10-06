# Integration identifiers and product labels

`integration` / `integrations` is the permanent subsystem name in code. The UI
currently calls it **Connectors**, using `INTEGRATION_LABELS` in
`src/constants/integrations.ts`. Use that constant in UI copy, tool descriptions,
errors and messages an agent might relay. A product label change must not rename
the subsystem again. Technical identifiers appearing in prose keep their actual
spelling, such as the `integrations` MCP server or `integrationScopes` parameter.
Provider-owned menu labels and credential names use the provider's exact wording,
including Wrike's Apps & Integrations and Docusign's integration key.

Keep the engine's precise nouns: provider, toolkit, connection and auth config.
A connection is an authenticated account. A service can have several connections.
Device connections in `src/lib/connection/` belong to a separate subsystem.

## Renamed surfaces

| Surface | Name |
| --- | --- |
| Engine package | `@integrations/engine` in `packages/integrations` |
| App modules and components | `src/lib/integrations`, `src/components/integrations` |
| REST and OAuth routes | `/api/integrations/*` |
| tRPC router | `integrations` |
| MCP server and harness tools | `integrations`, `mcp__integrations__*` |
| Agent scope field | `integrationScopes` |
| Scope endpoint | `/api/workspaces/:id/integration-scopes` |
| Database scope column | `workspaces.integration_scopes` |
| Notification channel kind | `integration` |
| Approval notification event | `integration.approval_required` |
| Environment prefix | `INTEGRATIONS_*` |
| Account store | `<config-dir>/integrations` |
| Local request preference | `integrationRequestsEnabled` |

The pre-launch rename has no old package, API, MCP or environment aliases. Vendor
identifiers, URLs and captured discovery payloads remain as supplied by the
vendor. Historical database migrations remain immutable.

Values saved outside the code keep their old spelling, because renaming them
would orphan what was already saved. `?settings=connectors` in old links and
OAuth returns still opens Plugins through `SECTION_ALIASES` in
`src/components/settings/settings-sections.ts`. The setup checklist's "Connect
an app" item keeps the id `connectors`, which browsers store in
`ri.setup.dismissed`.

Shipped skills are Markdown and cannot import `INTEGRATION_LABELS`.
`skills/browser/SKILL.md` and `skills/orchestrator/SKILL.md` write the label
directly ("connector"), so update them by hand when the label changes.

## Existing local data

Boot calls `migrateIntegrationStorage` before reading local configuration. Every
store entry point and the request-setting accessor also run the conversion before
using a home for the first time. It atomically moves the former `connectors` folder,
including its encryption key, into `integrations`. It preserves account IDs and
sealed credentials, converts saved app callbacks and the request preference, and
preserves unknown configuration fields. Repeating the conversion is safe. If both
store folders exist, startup refuses to merge their keys or overwrite either one.

Migration `0006_integration_names` renames the scope column without rebuilding the
table. It also converts notification channel kinds, approval-event subscriptions
and queued delivery identifiers. Rowids and foreign-key links remain intact.
Apply it through the app's normal `runMigrations` path, including `pnpm db:migrate`.

## Provider OAuth registrations

Register the callback now displayed in Connectors setup in each provider's
developer console. The shared web callback is `<origin>/api/integrations/callback`.
Registered hosted MCP callbacks use
`<origin>/api/integrations/mcp-oauth/builtin_<providerId>`. Custom MCP servers use
`<origin>/api/integrations/mcp-oauth/<serverId>`.

Existing tokens keep their stored OAuth session metadata for refresh. A new
interactive sign-in uses the new callback. Dynamic clients are registered again
when their callback changes. Manually registered clients need the developer
console change before a new sign-in can complete. Desktop relay and loopback
callbacks are separate and retain their existing addresses.
