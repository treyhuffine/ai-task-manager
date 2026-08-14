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
 * with an extra call (Asana looks up a workspace gid first).
 *
 * Notion is deliberately absent: `notion.search` returns arbitrary pages, not
 * task-shaped rows, so including it would pad the list with things you can't
 * act on. Breadth is only useful while every row is a real task.
 */
import { getConnectorRuntime, getConnectorOwnerId } from './runtime';
import {
  jiraPriority,
  linearPriority,
  sortTasks,
  todoistPriority,
} from '@/lib/executions/task-rank';

export interface ConnectorTaskItem {
  /** `${toolkitId}:${externalId}` — stable key for the launcher's chip ids. */
  key: string;
  toolkitId: string;
  providerLabel: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  /** ISO due date, normalized across providers. Drives the launcher's ordering. */
  due: string | null;
  /** Provider priority mapped onto 0..1 (1 = most urgent), or null. */
  priority: number | null;
}

export interface ConnectorTaskResult {
  items: ConnectorTaskItem[];
  /**
   * Every connected task provider, whether or not it returned rows.
   *
   * The launcher renders one scope chip per entry, so this has to be
   * independent of the result set: a provider that matches nothing for the
   * current query must still show its chip, or the filter row would flicker
   * in and out as the user types and "my Todoist is missing" would be
   * indistinguishable from "no Todoist task matched".
   *
   * `truncated` says this provider had more rows than `limitPerProvider`, so
   * the launcher can offer to page deeper. It's measured on the raw fetch, not
   * on what survived the query filter: a search matching 3 of 25 fetched rows
   * still has rows upstream we never looked at.
   */
  sources: { toolkitId: string; providerLabel: string; truncated: boolean }[];
  /**
   * Every provider we know how to read tasks from, connected or not. Lets the
   * launcher name what's still connectable ("Connect Jira, Asana") instead of
   * showing a bare "+" the user has to click to discover anything.
   */
  supported: { toolkitId: string; providerLabel: string }[];
  /** Providers that are connected but failed to read, so the UI can say so. */
  failures: { toolkitId: string; providerLabel: string; error: string }[];
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
   * real providers need real shapes: Asana can't list tasks without first
   * resolving a workspace gid, and Jira needs a JQL string synthesized rather
   * than passed through. Anything expressible as "some calls, then rows" fits.
   *
   * `limit` is how many rows the caller intends to keep. Providers with a
   * page-size parameter must pass it through, or paging past the first page
   * would ask for more rows and get the same ones back.
   */
  fetch: (run: RunAction, query: string, limit: number) => Promise<TaskRow[]>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

const TASK_SOURCES: TaskSource[] = [
  {
    toolkitId: 'todoist',
    providerId: 'todoist',
    label: 'Todoist',
    // Todoist's `filter` is its own query DSL, not a substring match, so we
    // pull the active list and let the caller filter rather than mistranslate.
    fetch: async (run) => {
      const raw = await run<{ tasks?: unknown[] }>('todoist.list_tasks', {});
      return (raw.tasks ?? [])
        .map((r) => r as Record<string, unknown>)
        .filter((t) => t.is_completed !== true)
        .map((t) => {
          const due = t.due as Record<string, unknown> | undefined;
          return {
            externalId: String(t.id ?? ''),
            title: str(t.content) ?? 'Untitled task',
            // `due.string` is Todoist's human phrasing ("every Monday");
            // `due.date` is the sortable one.
            subtitle: str(due?.string as string),
            body: str(t.description),
            due: str(due?.date as string),
            priority: todoistPriority(t.priority),
          };
        })
        .filter((t) => !!t.externalId);
    },
  },
  {
    toolkitId: 'linear',
    providerId: 'linear',
    label: 'Linear',
    fetch: async (run, query, limit) => {
      const raw = await run<{ issues?: unknown[] }>(
        'linear.list_issues',
        query ? { first: limit, query } : { first: limit },
      );
      return (raw.issues ?? [])
        .map((r) => r as Record<string, unknown>)
        .map((i) => ({
          externalId: String(i.id ?? ''),
          title: [str(i.identifier), str(i.title) ?? 'Untitled issue'].filter(Boolean).join(' '),
          subtitle:
            [
              str((i.state as Record<string, unknown> | undefined)?.name as string),
              str((i.assignee as Record<string, unknown> | undefined)?.name as string),
            ]
              .filter(Boolean)
              .join(' · ') || null,
          body: null,
          due: str(i.dueDate),
          priority: linearPriority(i.priority),
        }))
        .filter((i) => !!i.externalId);
    },
  },
  {
    toolkitId: 'jira',
    providerId: 'jira',
    label: 'Jira',
    // JQL is required, but "my open issues" is a well-defined default — no
    // reason to make the user hand-write a query to see their own work.
    fetch: async (run, query, limit) => {
      const escaped = query.replace(/["\\]/g, '');
      const jql = [
        'assignee = currentUser()',
        'statusCategory != Done',
        escaped ? `text ~ "${escaped}"` : null,
      ]
        .filter(Boolean)
        .join(' AND ') + ' ORDER BY updated DESC';
      const raw = await run<{ issues?: unknown[] }>('jira.search_issues', {
        jql,
        maxResults: limit,
      });
      return (raw.issues ?? [])
        .map((r) => r as Record<string, unknown>)
        .map((i) => ({
          externalId: String(i.id ?? i.key ?? ''),
          title: [str(i.key), str(i.summary) ?? 'Untitled issue'].filter(Boolean).join(' '),
          subtitle: str(i.status),
          body: null,
          due: str(i.dueDate),
          priority: jiraPriority(i.priority),
        }))
        .filter((i) => !!i.externalId);
    },
  },
  {
    toolkitId: 'asana',
    providerId: 'asana',
    label: 'Asana',
    // `list_tasks` rejects an assignee without a workspace, so resolve one
    // first. Most accounts have exactly one; we take the first deterministically
    // rather than guessing across several.
    fetch: async (run, _query, limit) => {
      const ws = await run<{ workspaces?: unknown[] }>('asana.list_workspaces', {});
      const first = (ws.workspaces ?? [])[0] as Record<string, unknown> | undefined;
      const gid = first ? str(first.gid) : null;
      if (!gid) return [];
      const raw = await run<{ tasks?: unknown[] }>('asana.list_tasks', {
        assignee: 'me',
        workspace: gid,
        limit,
      });
      return (raw.tasks ?? [])
        .map((r) => r as Record<string, unknown>)
        .filter((t) => t.completed !== true)
        .map((t) => ({
          externalId: String(t.gid ?? ''),
          title: str(t.name) ?? 'Untitled task',
          subtitle: null,
          body: str(t.notes),
          due: str(t.due_on) ?? str(t.due_at),
          // Asana has no priority field in the core task resource.
          priority: null,
        }))
        .filter((t) => !!t.externalId);
    },
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
 * Failures are per-provider and non-fatal: one dead connection shouldn't blank
 * the whole group, so the caller gets whatever succeeded plus a note about what
 * didn't. An `auth_required` / `approval_required` outcome is reported the same
 * way rather than thrown, since neither is actionable from the launcher.
 */
export async function listConnectorTasks(
  query: string,
  opts: { limitPerProvider?: number; now?: Date } = {},
): Promise<ConnectorTaskResult> {
  const limit = opts.limitPerProvider ?? 25;
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
  const connected = new Set(connections.map((c) => c.providerId));
  const active = TASK_SOURCES.filter((s) => connected.has(s.providerId));
  if (active.length === 0) return { items: [], sources: [], supported: SUPPORTED_TASK_SOURCES, failures: [] };

  const items: ConnectorTaskItem[] = [];
  const failures: ConnectorTaskResult['failures'] = [];
  const truncatedBy = new Map<string, boolean>();

  type Settled =
    | { source: TaskSource; ok: true; rows: TaskRow[] }
    | { source: TaskSource; ok: false; error: string };

  const settled: Settled[] = await Promise.all(
    active.map(async (source): Promise<Settled> => {
      const run: RunAction = async (actionId, input) => {
        const outcome = await runtime.runAction(actionId, input, {
          ownerId,
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
        return { source, ok: true, rows: await source.fetch(run, query, limit) };
      } catch (err) {
        return { source, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  for (const entry of settled) {
    if (!entry.ok) {
      failures.push({
        toolkitId: entry.source.toolkitId,
        providerLabel: entry.source.label,
        error: entry.error,
      });
      continue;
    }
    // Before filtering: the provider's page size is what bounds this, and a
    // narrow query shrinking the result set says nothing about what's upstream.
    truncatedBy.set(entry.source.toolkitId, entry.rows.length >= limit);
    const matched = q
      ? entry.rows.filter(
          (r) =>
            r.title.toLowerCase().includes(q) || (r.body ?? '').toLowerCase().includes(q),
        )
      : entry.rows;
    // Rank BEFORE truncating, or the per-provider limit would silently drop
    // the most urgent items just because the provider returned them last.
    for (const r of sortTasks(matched, now).slice(0, limit)) {
      items.push({
        key: `${entry.source.toolkitId}:${r.externalId}`,
        toolkitId: entry.source.toolkitId,
        providerLabel: entry.source.label,
        title: r.title,
        subtitle: r.subtitle,
        body: r.body,
        due: r.due ?? null,
        priority: r.priority ?? null,
      });
    }
  }

  return {
    items,
    sources: active.map((s) => ({
      toolkitId: s.toolkitId,
      providerLabel: s.label,
      truncated: truncatedBy.get(s.toolkitId) ?? false,
    })),
    supported: SUPPORTED_TASK_SOURCES,
    failures,
  };
}
