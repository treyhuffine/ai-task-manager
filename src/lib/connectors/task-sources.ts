/**
 * Read tasks out of connected task-management providers.
 *
 * The launcher needs a *synchronous, typed* read ("show me my Todoist tasks so
 * I can attach one"), which is a different caller than the agent tool path in
 * `getConnectorTools`. That path projects toolkits into an AI SDK `ToolSet` for
 * a model to call. Here we skip the model entirely and drive `runtime.runAction`
 * directly with `caller: { type: 'app' }` — a first-class engine entry point.
 *
 * This is safe without an approval prompt because every action below is
 * non-mutating, and the host ApprovalPolicy (`approval.ts`) lets non-mutating
 * actions run freely. Nothing here can write to a user's account.
 *
 * Adding a provider is one entry in TASK_SOURCES. The bar is that "my open
 * tasks" must be answerable with **no input from the user** — a launcher that
 * demands a JQL string before it shows you anything has failed at its job.
 * Required parameters are fine as long as a sensible default exists (Jira gets
 * `assignee = currentUser() AND statusCategory != Done`) or can be resolved
 * with an extra call (Atlassian exposes the user's authorized sites).
 *
 * Hosted connectors are included only when their published tool and structured
 * output contracts support deterministic task reads. Agent tool discovery is
 * independent of this picker.
 */
import { getConnectorRuntime, getConnectorOwnerId } from './runtime';
import {
  jiraPriority,
  sortTasks,
  todoistPriority,
} from '@/lib/executions/task-rank';

export interface ConnectorTaskIdentity {
  /** Provider and connection, independent of the provider's account label. */
  sourceKey: string;
  toolkitId: string;
  providerLabel: string;
  connectionId: string;
  accountId: string;
  accountLabel: string;
}

export interface ConnectorTaskItem extends ConnectorTaskIdentity {
  /** Connection-qualified identity, even when only one account is connected. */
  key: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  /** ISO due date, normalized across providers. Drives the launcher's ordering. */
  due: string | null;
  /** Provider priority mapped onto 0..1 (1 = most urgent), or null. */
  priority: number | null;
  /** A provider URL from its documented link format, when available. */
  sourceUrl: string | null;
}

export interface ConnectorTaskResult {
  items: ConnectorTaskItem[];
  /**
   * Every connected task-provider account, whether or not it returned rows.
   *
   * The launcher renders one scope chip per entry, so this has to be
   * independent of the result set: a provider that matches nothing for the
   * current query must still show its chip, or the filter row would flicker
   * in and out as the user types and "my Todoist is missing" would be
   * indistinguishable from "no Todoist task matched".
   *
   * `truncated` says this provider has more rows to fetch or display, so the
   * launcher can offer to page deeper. Prefer an explicit upstream cursor,
   * with a full-page heuristic for providers that expose no pagination state.
   * It's measured before the local query filter: a search matching 3 of 25
   * fetched rows may still have rows upstream we never looked at.
   */
  sources: (ConnectorTaskIdentity & { truncated: boolean })[];
  /**
   * Every provider we know how to read tasks from, connected or not. Lets the
   * launcher name what's still connectable ("Connect Todoist, Jira") instead of
   * showing a bare "+" the user has to click to discover anything.
   */
  supported: { toolkitId: string; providerLabel: string }[];
  /** Providers that are connected but failed to read, so the UI can say so. */
  failures: (ConnectorTaskIdentity & { error: string })[];
}

/** One provider row before it's stamped with its toolkit/provider identity. */
interface TaskRow {
  externalId: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  due?: string | null;
  /** Already normalized to 0..1 by the adapter — see `task-rank` helpers. */
  priority?: number | null;
  sourceUrl?: string | null;
}

/** Runs one connector action, throwing a readable message on any failure. */
type RunAction = <O = unknown>(actionId: string, input: unknown) => Promise<O>;

interface TaskSource {
  toolkitId: string;
  providerId: string;
  label: string;
  /**
   * Pull task rows for this provider.
   *
   * A closure rather than a single `{actionId, input, map}` triple because
   * real providers need real shapes: Jira first discovers authorized sites and
   * needs a JQL string synthesized rather than passed through. Anything
   * expressible as "some calls, then rows" fits.
   *
   * `limit` is how many rows the caller intends to keep. Providers with a
   * page-size parameter must pass it through, or paging past the first page
   * would ask for more rows and get the same ones back.
   */
  fetch: (run: RunAction, query: string, limit: number) => Promise<TaskRow[] | TaskPage>;
}

interface TaskPage {
  rows: TaskRow[];
  hasMore: boolean;
  /** Server search may match fields that are not returned in the preview. */
  queryApplied?: boolean;
  /** A multi-site provider can keep successful reads while identifying failures. */
  failures?: string[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** The official MCP server publishes structured data alongside a prose summary. */
function todoistPage(result: unknown): { tasks: unknown[]; nextCursor: string | null } {
  const envelope = record(result);
  if (!envelope) throw new Error('Todoist returned an invalid tool response');
  if (envelope.isError === true) throw new Error('Todoist could not read tasks');

  let data = envelope.structuredContent;
  if (data === undefined || data === null) {
    // MCP clients may serialize structured output as a JSON text block. Never
    // extract task-looking strings from the accompanying natural-language text.
    for (const content of Array.isArray(envelope.content) ? envelope.content : []) {
      const block = record(content);
      if (block?.type !== 'text' || typeof block.text !== 'string') continue;
      try {
        const parsed: unknown = JSON.parse(block.text);
        if (Array.isArray(record(parsed)?.tasks)) {
          data = parsed;
          break;
        }
      } catch {
        // A prose summary is expected, and is not the data contract.
      }
    }
  }
  const page = record(data);
  if (!page || !Array.isArray(page.tasks)) {
    throw new Error('Todoist returned no structured task data');
  }
  if ((page.nextCursor != null && typeof page.nextCursor !== 'string') ||
      (page.hasMore !== undefined && typeof page.hasMore !== 'boolean')) {
    throw new Error('Todoist returned invalid task pagination');
  }
  const nextCursor = str(page.nextCursor);
  // The official server treats "0" as the first page. Following it would
  // restart the list instead of advancing, just like a repeated cursor.
  if (nextCursor === '0' || (page.hasMore === true && !nextCursor) ||
      (page.hasMore === false && nextCursor)) {
    throw new Error('Todoist returned invalid task pagination');
  }
  return { tasks: page.tasks, nextCursor };
}

async function fetchTodoistTasks(run: RunAction, query: string, limit: number): Promise<TaskPage> {
  // Contract: github.com/Doist/todoist-mcp, find-tasks.ts / output-schemas.ts.
  // This is the canonical discovered tool. Normalization stays local to the
  // picker and does not create another exposed connector action or alias.
  // At least one filter is required. Explicit "all" preserves the picker's
  // existing coverage, including tasks assigned to other project members.
  const args = {
    filter: 'all',
    responsibleUserFiltering: 'all',
    ...(query.trim() ? { searchText: query.trim() } : {}),
    limit: Math.min(limit, 100),
  };
  const rows = new Map<string, TaskRow>();
  const cursors = new Set<string>();
  let cursor: string | null = null;

  try {
    // Normally 1-2 pages (the UI caps requests at 200). A bound also protects
    // against a server that advances cursors while returning no usable tasks.
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = todoistPage(await run('todoist.find-tasks', {
        ...args,
        ...(cursor ? { cursor } : {}),
      }));
      for (const value of page.tasks) {
        const task = record(value);
        const id = str(task?.id);
        if (!task || !id || task.checked === true || task.isDeleted === true || task.isUncompletable === true) continue;
        // Official MCP priorities are strings with p1 highest, the inverse of
        // the REST numeric scale used by our shared ranking helper.
        const priority = typeof task.priority === 'string' && /^p[1-4]$/.test(task.priority)
          ? todoistPriority(5 - Number(task.priority.slice(1)))
          : null;
        rows.set(id, {
          externalId: id,
          title: str(task.content) ?? 'Untitled task',
          subtitle: str(task.recurring) ?? str(task.dueDate),
          body: str(task.description),
          due: str(task.dueDate),
          priority,
          // Doist's official CLI URL tests document this ID-based web link.
          sourceUrl: `https://app.todoist.com/app/task/${encodeURIComponent(id)}`,
        });
      }
      if (page.nextCursor && cursors.has(page.nextCursor)) throw new Error('Todoist task pagination did not advance');
      if (rows.size >= limit || !page.nextCursor) {
        return { rows: [...rows.values()], hasMore: Boolean(page.nextCursor) || rows.size > limit };
      }
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error('Todoist task pagination exceeded the page limit');
  } catch (error) {
    // A late page failure must not erase tasks that were already read.
    if (!rows.size) throw error;
    return { rows: [...rows.values()], hasMore: true, failures: [error instanceof Error ? error.message : String(error)] };
  }
}

/** Accept data, never try to extract records from a natural-language summary. */
function atlassianData(result: unknown, matches: (value: unknown) => boolean): unknown {
  const envelope = record(result);
  if (!envelope || envelope.isError === true) throw new Error('Atlassian could not read Jira data');
  if (envelope.structuredContent != null) {
    if (matches(envelope.structuredContent)) return envelope.structuredContent;
    throw new Error('Atlassian returned unrecognized structured Jira data');
  }
  for (const value of Array.isArray(envelope.content) ? envelope.content : []) {
    const block = record(value);
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (matches(parsed)) return parsed;
    } catch {
      // Prose is not a machine-readable task response.
    }
  }
  throw new Error('Atlassian returned no structured Jira data');
}

interface JiraSite { id: string; name: string; url: string | null }

function webUrl(value: unknown): string | null {
  const input = str(value);
  if (!input) return null;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

function jiraSites(result: unknown): JiraSite[] {
  // The documented accessible-resources data contains one entry per site/app.
  // The same cloud ID can appear for Jira and Confluence with different scopes.
  const resources = atlassianData(result, Array.isArray) as unknown[];
  const sites = new Map<string, JiraSite>();
  for (const value of resources) {
    const resource = record(value);
    const id = str(resource?.id);
    if (!id || !Array.isArray(resource?.scopes) || resource.scopes.some((scope) => typeof scope !== 'string')) {
      throw new Error('Atlassian returned an unrecognized site resource');
    }
    if (!resource.scopes.some((scope: string) => /(^|:)jira([:-]|$)/.test(scope))) continue;
    sites.set(id, { id, name: str(resource.name) ?? str(resource.url) ?? id, url: webUrl(resource.url) });
  }
  if (sites.size > 20) throw new Error('Jira task discovery exceeded the site limit');
  return [...sites.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function jiraPage(result: unknown): { issues: unknown[]; nextPageToken: string | null } {
  const data = atlassianData(result, (value) => {
    const issues = record(value)?.issues;
    return Array.isArray(issues) || Array.isArray(record(issues)?.nodes);
  }) as Record<string, unknown>;
  const connection = record(data.issues);
  let issues: unknown[];
  let cursor: unknown;
  let hasMore: unknown;
  if (connection) {
    // Atlassian's published MCP pagination example, linked in the audit note.
    issues = connection.nodes as unknown[];
    const pageInfo = record(connection.pageInfo);
    cursor = pageInfo?.endCursor;
    hasMore = pageInfo?.hasNextPage;
    if (typeof hasMore !== 'boolean') throw new Error('Jira returned invalid task pagination');
    if (hasMore === false && typeof connection.remainingCount === 'number' && connection.remainingCount > 0) {
      throw new Error('Jira omitted the cursor for remaining tasks');
    }
  } else {
    // Some MCP clients receive the underlying Jira JSON in a text block.
    // This is the documented enhanced JQL response, not the retired REST adapter.
    issues = data.issues as unknown[];
    cursor = data.nextPageToken;
    if (data.isLast !== undefined && typeof data.isLast !== 'boolean') {
      throw new Error('Jira returned invalid task pagination');
    }
    hasMore = data.isLast === undefined ? Boolean(str(cursor)) : !data.isLast;
    if (data.isLast === undefined && cursor == null) throw new Error('Jira returned no task pagination');
  }
  const nextPageToken = str(cursor);
  if ((cursor != null && typeof cursor !== 'string') ||
      (hasMore === true && !nextPageToken) || (hasMore === false && nextPageToken)) {
    throw new Error('Jira returned invalid task pagination');
  }
  return { issues, nextPageToken };
}

async function fetchJiraTasks(run: RunAction, query: string, limit: number): Promise<TaskPage> {
  const sites = jiraSites(await run('atlassian.getAccessibleAtlassianResources', {}));
  const escaped = query.replace(/["\\\r\n]/g, '');
  const jql = [
    'assignee = currentUser()',
    'statusCategory != Done',
    escaped ? `text ~ "${escaped}"` : null,
  ].filter(Boolean).join(' AND ') + ' ORDER BY updated DESC';
  const rows: TaskRow[] = [];
  const failures: string[] = [];
  let hasMore = false;

  // Query every authorized Jira site, including when the first fills the limit.
  // Otherwise a large first site would permanently hide the remaining sites.
  for (const site of sites) {
    const siteRows = new Map<string, TaskRow>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    try {
      for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
        const page = jiraPage(await run('atlassian.searchJiraIssuesUsingJql', {
          cloudId: site.id,
          jql,
          fields: ['summary', 'status', 'priority', 'duedate'],
          maxResults: Math.min(limit, 100),
          ...(cursor ? { nextPageToken: cursor } : {}),
        }));
        for (const value of page.issues) {
          const issue = record(value);
          const id = str(issue?.id) ?? str(issue?.key);
          if (!issue || !id) throw new Error('Jira returned an invalid task');
          const fields = issue.fields === undefined ? issue : record(issue.fields);
          if (!fields) throw new Error('Jira returned invalid task fields');
          const status = str(record(fields.status)?.name) ?? str(fields.status);
          if (record(record(fields.status)?.statusCategory)?.key === 'done') continue;
          siteRows.set(id, {
            externalId: `${site.id}:${id}`,
            title: [str(issue.key), str(fields.summary) ?? 'Untitled issue'].filter(Boolean).join(' '),
            subtitle: [sites.length > 1 ? site.name : null, status].filter(Boolean).join(' · ') || null,
            body: str(fields.description),
            due: str(fields.duedate),
            priority: jiraPriority(record(fields.priority)?.name ?? fields.priority),
            sourceUrl: site.url && str(issue.key) ? `${site.url}/browse/${encodeURIComponent(str(issue.key)!)}` : null,
          });
        }
        if (page.nextPageToken && cursors.has(page.nextPageToken)) {
          throw new Error('Jira task pagination did not advance');
        }
        if (siteRows.size >= limit || !page.nextPageToken) {
          hasMore ||= Boolean(page.nextPageToken);
          break;
        }
        if (pageNumber === 19) throw new Error('Jira task pagination exceeded the page limit');
        cursors.add(page.nextPageToken);
        cursor = page.nextPageToken;
      }
    } catch (error) {
      hasMore = true;
      failures.push(`${site.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    rows.push(...siteRows.values());
  }
  return { rows, hasMore: hasMore || rows.length > limit, failures, queryApplied: true };
}

const TASK_SOURCES: TaskSource[] = [
  {
    toolkitId: 'todoist',
    providerId: 'todoist',
    label: 'Todoist',
    fetch: fetchTodoistTasks,
  },
  {
    toolkitId: 'jira',
    providerId: 'atlassian',
    label: 'Jira',
    fetch: fetchJiraTasks,
  },
];

/** Every provider the launcher can read tasks from, connected or not. */
export const SUPPORTED_TASK_SOURCES = TASK_SOURCES.map((s) => ({
  toolkitId: s.toolkitId,
  providerLabel: s.label,
}));

/**
 * Fan out across every *connected* task provider and return a flat list.
 *
 * Failures are per-account and non-fatal: one dead connection shouldn't blank
 * the whole group, so the caller gets whatever succeeded plus a note about what
 * didn't. An `auth_required` / `approval_required` outcome is reported the same
 * way rather than thrown, since neither is actionable from the launcher.
 */
export async function listConnectorTasks(
  query: string,
  opts: { limitPerProvider?: number; now?: Date } = {},
): Promise<ConnectorTaskResult> {
  const requestedLimit = opts.limitPerProvider ?? 25;
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 25;
  const q = query.trim().toLowerCase();
  const now = opts.now ?? new Date();

  let runtime;
  try {
    runtime = await getConnectorRuntime();
  } catch {
    // Connectors not configured on this host — an empty group, not an error.
    return { items: [], sources: [], supported: SUPPORTED_TASK_SOURCES, failures: [] };
  }

  const ownerId = getConnectorOwnerId();
  const connections = await runtime.listConnections({ ownerId });
  // Never rely on a provider's current default account. Every read, including
  // Jira's site discovery, is pinned to the connection represented by its group.
  const active = TASK_SOURCES.flatMap((source) => connections
    .filter((connection) => connection.providerId === source.providerId)
    .map((connection) => ({
      source,
      status: connection.status,
      identity: {
        sourceKey: `${source.toolkitId}:${encodeURIComponent(connection.id)}`,
        toolkitId: source.toolkitId,
        providerLabel: source.label,
        connectionId: connection.id,
        accountId: connection.accountId,
        accountLabel: str(connection.label) ?? str(connection.email) ?? connection.accountId,
      } satisfies ConnectorTaskIdentity,
    })));
  if (active.length === 0) return { items: [], sources: [], supported: SUPPORTED_TASK_SOURCES, failures: [] };

  const items: ConnectorTaskItem[] = [];
  const failures: ConnectorTaskResult['failures'] = [];
  const truncatedBy = new Map<string, boolean>();

  type Settled =
    | { identity: ConnectorTaskIdentity; ok: true; rows: TaskRow[]; hasMore: boolean; failures?: string[]; queryApplied?: boolean }
    | { identity: ConnectorTaskIdentity; ok: false; error: string };

  const settled: Settled[] = await Promise.all(
    active.map(async ({ source, identity, status }): Promise<Settled> => {
      if (status !== 'active') return { identity, ok: false, error: 'Reconnect this account in Settings' };
      const run: RunAction = async (actionId, input) => {
        const outcome = await runtime.runAction(actionId, input, {
          ownerId,
          connectionId: identity.connectionId,
          caller: { type: 'app' },
        });
        if (outcome.ok) return outcome.result as never;
        // `reason` alone is useless in the UI ("error"). The error variant
        // carries a real message; the auth/consent variants don't, so name
        // the condition instead of surfacing a bare reason code.
        throw new Error(
          outcome.reason === 'error'
            ? `${outcome.code}: ${outcome.message}`
            : outcome.reason === 'auth_required' || outcome.reason === 'auth_config_required'
              ? 'not connected'
              : outcome.reason === 'needs_consent'
                ? 'missing scopes'
                : outcome.reason,
        );
      };
      try {
        const fetched = await source.fetch(run, query, limit);
        const page = Array.isArray(fetched)
          ? { rows: fetched, hasMore: fetched.length >= limit }
          : fetched;
        return { identity, ok: true, ...page };
      } catch (err) {
        return { identity, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  for (const entry of settled) {
    if (!entry.ok) {
      failures.push({
        ...entry.identity,
        error: entry.error,
      });
      continue;
    }
    if (entry.failures?.length) {
      failures.push({
        ...entry.identity,
        error: entry.failures.join(' · '),
      });
    }
    // Before filtering: a narrow query shrinking the result set says nothing
    // about whether the provider has more rows upstream.
    truncatedBy.set(entry.identity.sourceKey, entry.hasMore);
    const matched = q && !entry.queryApplied
      ? entry.rows.filter(
          (r) =>
            r.title.toLowerCase().includes(q) || (r.body ?? '').toLowerCase().includes(q),
        )
      : entry.rows;
    // Rank BEFORE truncating, or the per-provider limit would silently drop
    // the most urgent items just because the provider returned them last.
    for (const r of sortTasks(matched, now).slice(0, limit)) {
      items.push({
        ...entry.identity,
        key: `${entry.identity.sourceKey}:${r.externalId}`,
        title: r.title,
        subtitle: r.subtitle,
        body: r.body,
        due: r.due ?? null,
        priority: r.priority ?? null,
        sourceUrl: r.sourceUrl ?? null,
      });
    }
  }

  return {
    items,
    sources: active.map(({ identity }) => ({
      ...identity,
      truncated: truncatedBy.get(identity.sourceKey) ?? false,
    })),
    supported: SUPPORTED_TASK_SOURCES,
    failures,
  };
}
