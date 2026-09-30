# Jira task picker through Atlassian MCP

Checked September 28, 2026. No account authorization or live account tool call was performed.

## Contract evidence

The canonical provider and action namespace is `atlassian`. Jira remains a picker category named `jira`. The provider shares one authorization with Confluence, and does not expose copies of tools under the retired Jira or Confluence namespaces.

Atlassian lists `getAccessibleAtlassianResources` and `searchJiraIssuesUsingJql` as primary tools. The search permission group uses `search:jira:agent-interface`. Tool availability depends on authorization, scopes, application access and administrator policy. The full paginated catalog endpoint is `https://mcp.atlassian.com/v2/mcp?tools=all`. These docs name tools but do not publish their complete input or output JSON schemas. [Official supported tools](https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/)

The current official status-report skill calls search with `cloudId`, `jql` and `maxResults`, recommends 100-result pages, and directs clients to reuse `nextPageToken` for pagination. [Official v2 status-report skill](https://github.com/atlassian/atlassian-mcp-server/blob/main/skills/generate-status-report/SKILL.md)

Atlassian's pagination-fix reply publishes this structured response shape:

```json
{
  "issues": {
    "nodes": [],
    "pageInfo": { "hasNextPage": true, "endCursor": "next-page-token" }
  }
}
```

`endCursor` becomes the next request's `nextPageToken`. The follow-up specifies a final page with `hasNextPage: false` and `endCursor: null`. The reply deliberately removes `totalCount` because it had described page size rather than the full result count. The thread concerns the earlier MCP generation, so this is evidence for an accepted shape, not proof that every current v2 client receives it. [Published fix](https://github.com/atlassian/atlassian-mcp-server/issues/118#issuecomment-4619849236), [last-page clarification](https://github.com/atlassian/atlassian-mcp-server/issues/118#issuecomment-4627291316)

The current official sprint-dashboard skill documents field selection, `duedate` and priority data. It describes compact, evidence and full views and identifies `fields.customFields` for custom values. It does not publish a complete issue response schema. [Official v2 dashboard skill](https://github.com/atlassian/atlassian-mcp-server/blob/main/skills/jira-sprint-dashboard/SKILL.md)

Atlassian's accessible-resources REST documentation provides an array of `{ id, name, url, scopes, avatarUrl }` resources. `id` is the cloud ID. Different application containers can share an ID, and scopes identify their product. A grant can cover several sites. The picker accepts this exact array shape and filters Jira scopes before deduplicating IDs. Reuse of this shape by the MCP resource tool is an explicit inference and needs live acceptance. No REST call is made by the picker. [Official resource response and site-selection guidance](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/#4--check-site-access-for-the-app)

The other accepted search form is the documented enhanced JQL API JSON: `issues[]`, issue `id` and `key`, nested `fields`, and `nextPageToken`/`isLast`. The picker also tolerates flat named issue fields in an MCP nodes result. MCP passthrough of REST data and flattened fields remain explicit normalization assumptions, not verified account captures. [Official enhanced JQL response](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get)

## Implemented behavior

- Calls only `atlassian.getAccessibleAtlassianResources` and `atlassian.searchJiraIssuesUsingJql` through the connector runtime.
- Uses assigned-to-current-user, unfinished issues ordered by update time, retaining the optional text search. Jira search results are not filtered again by their preview text, because the server can match descriptions or comments that the preview does not contain.
- Queries every authorized Jira site, so a large first site cannot hide the others. Up to 20 sites and 20 pages per site bound work. Requests at most 100 rows per page, collecting up to the requested provider count from each site before ranking all returned rows together.
- Produces stable `jira:<encoded-connection-id>:<cloudId>:<issueId>` keys, including for single-site accounts. Duplicate issue IDs across sites and accounts remain distinct. Duplicate grants and repeated issue IDs within a site merge. Every discovery and search call is pinned to that account's connection.
- Preserves summary, status, due date and named priority ranking. Multiple-site subtitles identify the site. Unknown priority IDs remain unknown. Valid HTTPS site URLs and issue keys provide source links, and completed status categories are excluded.
- Prefers structured data. Only whole JSON text blocks are fallback data. Prose, malformed resources, unknown result envelopes, contradictory pagination and remote errors produce visible failures.
- Retains successfully read sites and pages with a named failure if another site or later page fails. Never reports the failed site as a complete empty read.
- No native action aliases, token access or direct REST requests.

## Verification and remaining acceptance

`task-sources.test.ts` uses hand-authored contract fixtures whose sources and inferences are identified above. It covers shared provider selection, canonical calls, multiple sites, scope filtering, site-qualified IDs, cursor paging, deduplication, JSON text fallback, priority/due ranking, partial failures, malformed data and work bounds. These are regression tests of the consumer, not proof of live vendor compatibility.

Before claiming live picker acceptance, connect a permitted Atlassian test account as this app and record sanitized v2 `tools/list` schemas plus resource and search responses. Verify the accessible-resources envelope, issue field nesting, due-date field visibility, empty results and a real second page. Repeat for a multi-site Jira/Confluence grant and a restricted grant. This must use our real client identity. If v2 emits a different envelope, add support only from captured or published evidence and retain explicit failure for unknown shapes.
