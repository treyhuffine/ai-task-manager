# Task-picker expansion and account isolation

Checked September 28, 2026. The four requested connectors already expose vendor-hosted tools to agents. Adding them to the deterministic task picker requires their concrete task read contracts, independently of agent tool discovery.

## Implemented

The existing Todoist and Jira consumers now read every connected account separately. Every canonical action call has an explicit `RunActionOptions.connectionId`. This includes Jira site discovery and all subsequent pages. Account selection is transport metadata and is never injected into an upstream tool's arguments.

Items, sources and failures include `sourceKey`, `connectionId`, `accountId` and `accountLabel`. Keys always contain the connection, including for a single account. For example, `todoist:<encoded-connection-id>:<task-id>` and `jira:<encoded-connection-id>:<cloud-id>:<issue-id>`. Renaming an account does not change its keys, and identical task IDs across accounts cannot collide. Jira issue IDs remain site-qualified as well.

The launcher groups each account separately and keeps one provider filter. Each account retains its own error and pagination state. Selecting tasks preserves the original body, source URL and account routing metadata in the initial prompt. Selecting the same task twice deduplicates it, while selecting identically named tasks in two accounts keeps both.

Only active accounts make upstream reads. Accounts requiring sign-in retain a visible reconnect failure. A failed account does not erase another account's results. A late Todoist page failure now retains earlier pages, matching Jira's partial-result behavior. Read limits are clamped to 1–200 per account, request page sizes stay at most 100, and the existing 20-page bounds remain. Jira's 20-site bound remains. Completed Todoist tasks and Jira completed status categories are excluded. Existing search, due-date and priority ranking remain.

Todoist task URLs use the format asserted by the [official CLI's URL tests](https://github.com/Doist/todoist-cli/blob/main/src/lib/urls.test.ts). This is necessary because the [official MCP task output schema](https://github.com/Doist/todoist-mcp/blob/main/src/utils/output-schemas.ts) omits URLs. Jira URLs combine the authorized HTTPS site URL with its issue key using the documented `/browse/<key>` format. Invalid, non-HTTPS and credential-bearing site URLs are not propagated. [Atlassian URL example](https://developer.atlassian.com/server/jira/platform/creating-a-custom-release-notes-template-containing-release-comments/)

## Four pending consumers: exact evidence gaps

No fabricated schemas, native fallback calls or compatibility actions were added. These four providers are not advertised as supported task-picker sources yet. Their agent tools remain available through live MCP discovery.

| Provider | Primary evidence checked | Confirmed | Missing before a typed consumer can be implemented |
|---|---|---|---|
| ClickUp | [Supported tools](https://developer.clickup.com/docs/mcp-tools), [official documentation index](https://developer.clickup.com/llms.txt) | Workspace search, task detail, hierarchy navigation and task management exist | The public tool guide gives display names and prose examples, without exact search arguments, task response nesting, status representation, cursor contract or empty-result shape |
| Trello | [Official repository](https://github.com/atlassian/trello-mcp-server), [official usage skill](https://github.com/atlassian/trello-mcp-server/blob/main/skills/trello-use/SKILL.md) | Canonical `trelloRead*`/`trelloSearch` tools, action dispatch, workspace ARIs, separate Inbox, `cursor` input and `pageInfo.endCursor`/`nextCursor` pagination | Complete board/card/search argument schemas, exact card collection envelopes, task title/body/URL/due/completed fields and a captured completed-card example. The official repository contains documentation and the usage skill, without server implementation or JSON schemas |
| TickTick | [Official MCP help article](https://help.ticktick.com/articles/7438129581631995904) | `list_projects`, `get_project_with_undone_tasks`, `search_task`, `filter_tasks`, `get_task_by_id` and time-based task reads | Exact tool arguments, response envelopes, priority scale, completion representation and pagination or explicit exhaustive-list guarantees. The article's embedded `__NEXT_DATA__` contains the full available-tools table but no input/output schemas |
| Wrike | [Available tools](https://developers.wrike.com/docs/available-tools-on-wrike-mcp), [official documentation index](https://developers.wrike.com/llms.txt) | `search_items`, `get_users`, `get_item_details`, `search_spaces`, `get_items_children`, with assignee/status/date/importance filtering | Exact filter argument names and enum meanings, task-vs-project discrimination, response nesting, completed-status representation, date/importance fields and pagination contract |

Anonymous `tools/list` requests on September 28 reached the configured endpoints without any account credentials. ClickUp, Trello and TickTick returned HTTP 401, requiring authentication. Wrike returned a Cloudflare HTTP 403 before tool discovery. This establishes that anonymous discovery did not supply the missing schemas. It does not establish that authenticated discovery will fail. A metadata-only check of the current configuration through `getConfigDir()` found no saved entries for these four providers, so there was no existing account available for authenticated discovery.

Third-party directories quote richer inputs for some providers, but they were not adopted as official contracts. A REST schema is also not evidence that an MCP server emits the same JSON. The existing Jira assumptions and their narrower evidence remain documented in [atlassian-task-picker.md](./atlassian-task-picker.md).

## Opt-in contract capture

The capture command uses one already connected built-in account and its current token. It does not register OAuth clients, open a sign-in flow or refresh credentials. No account capture was executed during this work.

```sh
pnpm tsx scripts/capture-task-picker-contract.ts --server <existing-server-id> --output /tmp/task-picker-tools.json
```

By default the command performs `tools/list` only. The new, mode-0600 output contains provider ID, timestamp, capability fingerprint and actual advertised tool definitions. It omits connection/account metadata and credentials. Tool schemas can themselves contain account-specific enum values, so inspect them before sharing or committing a capture.

If definitions omit output schemas, review the advertised input schema, create an argument JSON file, and explicitly request one read:

```sh
pnpm tsx scripts/capture-task-picker-contract.ts --server <existing-server-id> --output /tmp/task-picker-sample.json --read <allowlisted-tool> --input /tmp/task-picker-arguments.json
```

The tool must be in the provider's bounded task-read allowlist, currently advertised by the selected account, explicitly annotated read-only and not annotated destructive. The command passes operator-supplied arguments unchanged. It refuses to overwrite an output file and stops if the selected account configuration changes. A sample capture contains private task data by design, so it belongs outside the repository until sanitized.

Qualification for each pending consumer requires the actual input schema, structured output schema or sanitized responses covering a task, empty results, completed exclusion, dates/priority, source URL and a second page where supported. Then implement the adapter against that evidence and test pagination, search, account isolation and partial failures. Do not mark these four consumers complete merely because the hosted connector is connectable.

## Validation

Six focused suites pass, with 124 tests. They cover account fanout, connection pinning across discovery and paging, colliding IDs, independent failures and truncation, invalid source URLs, completed-task exclusion, partial pages, provider filtering and composed prompt context. Capture tests verify that default discovery does not call a task tool and that samples require an explicit, advertised, allowlisted read. Tests use local fixtures and do not prove live upstream compatibility. The capture command's `--help` path was executed without accessing account state. Changed files pass lint. The full app typecheck retains its 115 baseline diagnostics, with none in the changed picker, capture or launcher files.
