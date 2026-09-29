/**
 * Bringing a retired home's chats into the home that stays (docs/homes-spec.md
 * §10.2, P5.1): "Import selected unique records through invariant-preserving
 * operations, with explicit identity/link mapping and provenance."
 *
 * What comes over, as Trey chose for the laptop (docs/homes-build.md, P5.1):
 *
 * - **Every chat a person started**, with its messages, the work it belongs
 *   to (its execution), its attachments, its terminal-history ledger and its
 *   preview. Chats a schedule started are left out, and so are empty chats
 *   attached to a task or note this home doesn't have.
 * - **The agents they're in.** An agent this home already has, by name, is
 *   the same agent: its chats join it. One it doesn't have is created, with
 *   the same id.
 * - **Where they ran.** Every imported chat and its work are placed on the
 *   computer the old home ran on (an execution placement, `adopted`), and
 *   each agent's folder there is recorded (§4.1). The work's folders and the
 *   native transcripts stay on that computer, so continuing one runs there,
 *   and this home never looks for them on its own disk.
 *
 * Ids are kept, so a chat is the same chat in both homes, and nothing already
 * here is changed: a record whose id is here is skipped, which makes a second
 * run a no-op. Tasks, notes, areas, schedules and the persona files stay
 * behind. A main chat for an agent that already has one here comes over
 * archived, so it never replaces the current one. Imported chats come over
 * read, so they don't fill Unread.
 *
 * The source is only read (a data root or a `home-backup.ts backup` of one).
 * The destination is this process's own root: run it through `pnpm iso` with
 * the destination home stopped. Every row is written in one transaction,
 * attachments are copied before it and removed again if it fails, and a
 * manifest of what came from where is written to `.archive/imports/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { uuidv7 } from 'uuidv7';
import { getAppRoot, getAttachmentsDir } from '@/lib/config/paths';
import { getDb, getRawDb } from '@/lib/db';
import { createComputer, getAgentSetup, getHome, listComputers, setAgentFolder } from '@/lib/db/queries';
import { withSourceDatabase } from './source-db';

export class HomeImportError extends Error {}

export interface HomeImportOptions {
  /** The home being brought in: a data root, or a backup of one. */
  sourceRoot: string;
  /** The computer that home ran on. Its chats and their work belong to it here. */
  computerName: string;
  /**
   * Source agent id to this home's agent id, where matching by name is wrong,
   * or to `new` to bring it over as its own agent.
   */
  agentMap?: Record<string, string>;
}

export interface AgentImport {
  sourceId: string;
  name: string;
  /** Its folder on that computer. */
  folder: string | null;
  status: string;
  /** `same`: this home has it by id. `matched`: by name. `created`: it comes over. */
  action: 'same' | 'matched' | 'created';
  destId: string;
  destName: string;
  chats: number;
}

export interface HomeImportPlan {
  sourceRoot: string;
  computer: { name: string; id: string | null; created: boolean };
  agents: AgentImport[];
  chats: {
    import: number;
    alreadyHere: number;
    scheduled: number;
    emptyDetached: number;
    /** Main chats that come over archived, because this home has its own. */
    mainChatsArchived: number;
  };
  executions: { import: number; alreadyHere: number };
  events: number;
  ledgers: number;
  previews: number;
  attachments: { copy: number; alreadyHere: number; missing: string[] };
  /** Agents whose folder on that computer is already recorded here, and differs. */
  foldersKept: Array<{ agent: string; recorded: string; theirs: string }>;
  /** Anything that stops the import. */
  problems: string[];
}

export interface HomeImportResult extends HomeImportPlan {
  importId: string;
  manifestPath: string;
}

type Row = Record<string, unknown>;

/** Tables copied row for row, in the order their links need. */
const TABLES = ['workspaces', 'executions', 'chat_sessions', 'chat_events', 'external_session_imports', 'preview_targets'] as const;
type CopiedTable = (typeof TABLES)[number];

const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** The same agent on both sides: its name, compared loosely (as `compare.ts` does). */
const nameKey = (v: unknown) => text(v).toLowerCase().replace(/\s+/g, ' ').trim();

/** What the import would do, without writing anything. */
export function planHomeImport(options: HomeImportOptions): HomeImportPlan {
  return run(options, false) as HomeImportPlan;
}

/** Import, as `planHomeImport` describes. Refuses when the plan has problems. */
export function applyHomeImport(options: HomeImportOptions): HomeImportResult {
  return run(options, true) as HomeImportResult;
}

function run(options: HomeImportOptions, apply: boolean): HomeImportPlan | HomeImportResult {
  const sourceRoot = path.resolve(options.sourceRoot);
  const destRoot = path.resolve(getAppRoot());
  const sourceDb = path.join(sourceRoot, 'data.db');
  if (!fs.existsSync(sourceDb)) throw new HomeImportError(`${sourceRoot} has no data.db. Give a data root, or a backup of one.`);
  if (sourceRoot === destRoot) throw new HomeImportError('A home can not import itself.');
  const computerName = options.computerName.trim();
  if (!computerName) throw new HomeImportError('Name the computer that home ran on.');

  getDb();
  const dest = getRawDb();
  const home = getHome();
  if (!home) throw new HomeImportError("This home has no identity yet. Start it once so it's set up, then import.");

  return withSourceDatabase(sourceDb, (src) => {
    const plan = buildPlan(src, dest, { ...options, sourceRoot, computerName }, home.hostComputerId);
    if (!apply) return plan.summary;
    if (plan.summary.problems.length > 0) throw new HomeImportError(`Nothing was imported: ${plan.summary.problems.join(' ')}`);
    return applyPlan(src, dest, plan, sourceRoot);
  });
}

// ─── The plan ────────────────────────────────────────────────

interface BuiltPlan {
  summary: HomeImportPlan;
  computerId: string | null;
  /** Source agent id to this home's. */
  agentIds: Map<string, string>;
  createdAgents: Row[];
  chatIds: string[];
  archivedMainChats: Set<string>;
  executionIds: string[];
  ledgerIds: string[];
  previewIds: string[];
  attachmentFiles: Array<{ name: string; from: string }>;
  /** Folders on that computer to record: this home's agent id to its folder there. */
  folders: Map<string, string>;
  columns: Record<CopiedTable, string[]>;
  areaIds: Map<string, string | null>;
  /** Every chat id that will exist once imported, for links between chats. */
  knownChats: (id: string) => boolean;
}

function buildPlan(
  src: Database.Database,
  dest: Database.Database,
  options: HomeImportOptions & { sourceRoot: string; computerName: string },
  hostComputerId: string,
): BuiltPlan {
  const problems: string[] = [];

  // Columns: a column this home requires that the source doesn't have stops
  // the import, rather than a row going in half-filled.
  const columns = {} as Record<CopiedTable, string[]>;
  for (const table of TABLES) {
    const srcCols = tableColumns(src, table);
    const destInfo = dest.prepare(`SELECT name, "notnull" AS required, dflt_value AS dflt, pk FROM pragma_table_info(?)`).all(table) as Row[];
    if (srcCols.size === 0) {
      if (table === 'external_session_imports' || table === 'preview_targets') {
        columns[table] = [];
        continue;
      }
      problems.push(`The source has no ${table} table.`);
      columns[table] = [];
      continue;
    }
    columns[table] = destInfo.map((c) => text(c.name)).filter((c) => srcCols.has(c));
    const missing = destInfo.filter((c) => Number(c.required) === 1 && c.dflt === null && Number(c.pk) === 0 && !srcCols.has(text(c.name)));
    for (const c of missing) problems.push(`This home needs ${table}.${text(c.name)}, which the source doesn't have.`);
  }

  // The computer the source ran on.
  const computer = listComputers().find((c) => nameKey(c.name) === nameKey(options.computerName)) ?? null;
  if (computer?.id === hostComputerId) {
    problems.push(`${computer.name} is this home's own computer. Name the computer the other home ran on.`);
  }

  // Agents: the same by id, else by name among this home's, else created.
  const destAgents = dest.prepare('SELECT id, name, status, cwd FROM workspaces').all() as Row[];
  const destById = new Map(destAgents.map((a) => [text(a.id), a]));
  const destByName = new Map<string, Row>();
  for (const a of [...destAgents].sort((x, y) => Number(text(y.status) === 'active') - Number(text(x.status) === 'active'))) {
    const key = nameKey(a.name);
    if (key && !destByName.has(key)) destByName.set(key, a);
  }
  const srcAgents = src.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC').all() as Row[];
  const agentIds = new Map<string, string>();
  const agents: AgentImport[] = [];
  const createdAgents: Row[] = [];
  for (const a of srcAgents) {
    const sourceId = text(a.id);
    const mapped = options.agentMap?.[sourceId];
    let target: Row | undefined;
    let action: AgentImport['action'];
    if (mapped === 'new') {
      if (destById.has(sourceId)) problems.push(`${text(a.name)} (${sourceId}) is already here, so it can't come over as a new agent.`);
      action = 'created';
    } else if (mapped) {
      target = destById.get(mapped);
      if (!target) problems.push(`The agent map sends ${text(a.name)} to ${mapped}, which this home doesn't have.`);
      action = 'matched';
    } else if (destById.has(sourceId)) {
      target = destById.get(sourceId);
      action = 'same';
    } else {
      target = destByName.get(nameKey(a.name));
      action = target ? 'matched' : 'created';
      // Active work never quietly joins an agent that was put away here.
      if (target && text(target.status) !== 'active' && text(a.status) === 'active') {
        problems.push(
          `${text(a.name)} (${sourceId}) is active on the other home, and the only agent named that here is archived (${text(target.id)}). ` +
            `Choose with --map ${sourceId}=<agent id>, or --map ${sourceId}=new to bring it over as its own agent.`,
        );
      }
    }
    const destId = target ? text(target.id) : sourceId;
    agentIds.set(sourceId, destId);
    if (action === 'created') createdAgents.push(a);
    agents.push({
      sourceId,
      name: text(a.name),
      folder: text(a.cwd) || null,
      status: text(a.status),
      action,
      destId,
      destName: target ? text(target.name) : text(a.name),
      chats: 0,
    });
  }

  // Areas for created agents: this home's area of the same name, else none.
  const destAreas = new Map((dest.prepare('SELECT id, name FROM areas').all() as Row[]).map((r) => [nameKey(r.name), text(r.id)]));
  const destAreaIds = new Set(destAreas.values());
  const srcAreaNames = new Map((src.prepare('SELECT id, name FROM areas').all() as Row[]).map((r) => [text(r.id), nameKey(r.name)]));
  const areaIds = new Map<string, string | null>();
  for (const a of createdAgents) {
    const area = text(a.area_id);
    if (!area) continue;
    areaIds.set(area, destAreaIds.has(area) ? area : (destAreas.get(srcAreaNames.get(area) ?? '') ?? null));
  }

  // Chats: every one a person started, not one a schedule did.
  const destChat = dest.prepare('SELECT 1 FROM chat_sessions WHERE id = ?');
  const destTask = dest.prepare('SELECT 1 FROM tasks WHERE id = ?');
  const destNote = dest.prepare('SELECT 1 FROM notes WHERE id = ?');
  const eventCount = src.prepare('SELECT count(*) AS n FROM chat_events WHERE session_id = ?');
  const destNative = dest.prepare('SELECT 1 FROM chat_sessions WHERE external_provider_type IS ? AND external_session_id = ?');
  const srcChats = src.prepare('SELECT * FROM chat_sessions ORDER BY created_at').all() as Row[];
  const chatIds: string[] = [];
  let alreadyHere = 0;
  let scheduled = 0;
  let emptyDetached = 0;
  const chatRows: Row[] = [];
  for (const c of srcChats) {
    const id = text(c.id);
    if (c.created_by_run_id) {
      scheduled++;
      continue;
    }
    if (destChat.get(id)) {
      alreadyHere++;
      continue;
    }
    if (text(c.type) === 'content') {
      const ref = text(c.surface_ref);
      const here = text(c.surface_kind) === 'note' ? destNote.get(ref) : text(c.surface_kind) === 'task' ? destTask.get(ref) : true;
      if (!here && Number((eventCount.get(id) as Row).n) === 0) {
        emptyDetached++;
        continue;
      }
    }
    if (c.external_session_id && destNative.get(text(c.external_provider_type), text(c.external_session_id))) {
      problems.push(`The chat ${id} continues a conversation (${text(c.external_session_id)}) that a chat here already has.`);
      continue;
    }
    if (c.workspace_id && !agentIds.has(text(c.workspace_id))) {
      problems.push(`The chat ${id} is in an agent the source doesn't have (${text(c.workspace_id)}).`);
      continue;
    }
    chatIds.push(id);
    chatRows.push(c);
  }
  const imported = new Set(chatIds);
  const knownChats = (id: string) => imported.has(id) || !!destChat.get(id);

  // Main chats: one that would become the current main chat of an agent (or
  // of the app) that already has one here comes over archived. With none
  // here, the most recent one stays active and the rest are archived.
  const archivedMainChats = new Set<string>();
  const destHasMain = dest.prepare(
    "SELECT 1 FROM chat_sessions WHERE type = 'orchestration' AND created_by_run_id IS NULL AND execution_id IS NULL AND status = 'active' AND workspace_id IS ?",
  );
  const mainsByScope = new Map<string, Row[]>();
  for (const c of chatRows) {
    if (text(c.type) !== 'orchestration' || c.execution_id || text(c.status) !== 'active') continue;
    const scope = c.workspace_id ? (agentIds.get(text(c.workspace_id)) ?? text(c.workspace_id)) : '';
    mainsByScope.set(scope, [...(mainsByScope.get(scope) ?? []), c]);
  }
  for (const [scope, mains] of mainsByScope) {
    const ordered = mains.sort((x, y) => text(y.last_activity_at ?? y.started_at).localeCompare(text(x.last_activity_at ?? x.started_at)));
    const keep = destHasMain.get(scope || null) ? 0 : 1;
    for (const c of ordered.slice(keep)) archivedMainChats.add(text(c.id));
  }

  // Their work, messages, ledgers, previews.
  const destExecution = dest.prepare('SELECT 1 FROM executions WHERE id = ?');
  const executionIds: string[] = [];
  let executionsHere = 0;
  const srcExecution = src.prepare('SELECT workspace_id FROM executions WHERE id = ?');
  // Work of a person's chats that's here already, whether or not its chat is.
  const personal = srcChats.filter((c) => !c.created_by_run_id && c.execution_id).map((c) => text(c.execution_id));
  const incoming = new Set(chatRows.map((c) => text(c.execution_id)).filter(Boolean));
  executionsHere = new Set(personal.filter((id) => !!destExecution.get(id))).size;
  for (const id of incoming) {
    if (destExecution.get(id)) continue;
    const e = srcExecution.get(id) as Row | undefined;
    if (!e) problems.push(`A chat names the execution ${id}, which the source doesn't have.`);
    else if (!agentIds.has(text(e.workspace_id))) problems.push(`The execution ${id} is in an agent the source doesn't have.`);
    else executionIds.push(id);
  }
  const executionSet = new Set(executionIds);
  let events = 0;
  const attachmentNames = new Set<string>();
  const eventAttachments = src.prepare("SELECT attachments FROM chat_events WHERE session_id = ? AND attachments IS NOT NULL AND attachments <> '[]'");
  for (const id of chatIds) {
    events += Number((eventCount.get(id) as Row).n);
    for (const r of eventAttachments.all(id) as Row[]) for (const name of attachmentNamesIn(r.attachments)) attachmentNames.add(name);
  }
  for (const a of createdAgents) for (const name of attachmentNamesIn(a.attachments)) attachmentNames.add(name);

  const ledgerIds = columns.external_session_imports.length
    ? (src.prepare('SELECT id, chat_session_id FROM external_session_imports').all() as Row[])
        .filter((r) => imported.has(text(r.chat_session_id)))
        .map((r) => text(r.id))
        .filter((id) => !dest.prepare('SELECT 1 FROM external_session_imports WHERE id = ?').get(id))
    : [];
  const previewIds = columns.preview_targets.length
    ? (src.prepare('SELECT id, execution_id FROM preview_targets').all() as Row[])
        .filter((r) => executionSet.has(text(r.execution_id)))
        .map((r) => text(r.id))
        .filter((id) => !dest.prepare('SELECT 1 FROM preview_targets WHERE id = ?').get(id))
    : [];

  // Attachments: from the source's attachments, or its archive of them.
  const attachmentsDir = getAttachmentsDir();
  const attachmentFiles: BuiltPlan['attachmentFiles'] = [];
  const missing: string[] = [];
  let attachmentsHere = 0;
  for (const name of [...attachmentNames].sort()) {
    if (fs.existsSync(path.join(attachmentsDir, name))) {
      attachmentsHere++;
      continue;
    }
    const from = [path.join(options.sourceRoot, 'attachments', name), path.join(options.sourceRoot, '.archive', 'attachments', name)].find((p) => fs.existsSync(p));
    if (from) attachmentFiles.push({ name, from });
    else missing.push(name);
  }

  // Each agent's folder on that computer, from the source's own record of it.
  const folders = new Map<string, string>();
  const foldersKept: HomeImportPlan['foldersKept'] = [];
  for (const a of agents) {
    if (!a.folder || folders.has(a.destId)) continue;
    const recorded = computer ? getAgentSetup(a.destId, computer.id) : null;
    if (recorded) {
      if (recorded.sourcePath !== path.resolve(a.folder)) foldersKept.push({ agent: a.destName, recorded: recorded.sourcePath, theirs: a.folder });
      continue;
    }
    folders.set(a.destId, a.folder);
  }

  for (const c of chatRows) {
    const agent = c.workspace_id ? agents.find((a) => a.sourceId === text(c.workspace_id)) : undefined;
    if (agent) agent.chats++;
  }

  return {
    summary: {
      sourceRoot: options.sourceRoot,
      computer: { name: computer?.name ?? options.computerName, id: computer?.id ?? null, created: !computer },
      agents,
      chats: { import: chatIds.length, alreadyHere, scheduled, emptyDetached, mainChatsArchived: archivedMainChats.size },
      executions: { import: executionIds.length, alreadyHere: executionsHere },
      events,
      ledgers: ledgerIds.length,
      previews: previewIds.length,
      attachments: { copy: attachmentFiles.length, alreadyHere: attachmentsHere, missing },
      foldersKept,
      problems,
    },
    computerId: computer?.id ?? null,
    agentIds,
    createdAgents,
    chatIds,
    archivedMainChats,
    executionIds,
    ledgerIds,
    previewIds,
    attachmentFiles,
    folders,
    columns,
    areaIds,
    knownChats,
  };
}

// ─── Applying it ─────────────────────────────────────────────

function applyPlan(src: Database.Database, dest: Database.Database, plan: BuiltPlan, sourceRoot: string): HomeImportResult {
  const importId = uuidv7();
  const now = new Date().toISOString();

  // The computer first: its own record, outside the transaction, since
  // enrolling it later finds it by name.
  const computerId = plan.computerId ?? createComputer({ name: plan.summary.computer.name, platform: null, hostname: null }).id;

  // Attachments before the rows that name them, removed again if the rows fail.
  const attachmentsDir = getAttachmentsDir();
  fs.mkdirSync(attachmentsDir, { recursive: true });
  const copied: string[] = [];
  try {
    for (const file of plan.attachmentFiles) {
      const to = path.join(attachmentsDir, file.name);
      fs.copyFileSync(file.from, to, fs.constants.COPYFILE_EXCL);
      copied.push(to);
    }

    const insert = (table: CopiedTable) => {
      const cols = plan.columns[table];
      return dest.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
    };
    const pick = (table: CopiedTable, row: Row, overrides: Row = {}): Row => {
      const out: Row = {};
      for (const c of plan.columns[table]) out[c] = c in overrides ? overrides[c] : (row[c] ?? null);
      return out;
    };
    const hasColumn = (table: CopiedTable, column: string) => plan.columns[table].includes(column) || tableColumns(dest, table).has(column);

    dest.transaction(() => {
      // Links are checked at commit: work can name a chat that goes in after it.
      dest.pragma('defer_foreign_keys = ON');

      // Agents it doesn't have, with their own ids, and their own slug where
      // it's free (it names their branches and worktrees), else the next free
      // one, as creating an agent here does.
      const insertAgent = insert('workspaces');
      const slugTaken = dest.prepare('SELECT 1 FROM workspaces WHERE slug = ?');
      for (const a of plan.createdAgents) {
        const area = text(a.area_id);
        const base = text(a.slug) || 'workspace';
        let slug = base;
        for (let n = 2; slugTaken.get(slug); n++) slug = `${base}-${n}`;
        insertAgent.run(
          pick('workspaces', a, {
            ...(plan.columns.workspaces.includes('area_id') ? { area_id: area ? (plan.areaIds.get(area) ?? null) : null } : {}),
            ...(plan.columns.workspaces.includes('slug') ? { slug } : {}),
          }),
        );
        // New work in it runs where it lives.
        if (hasColumn('workspaces', 'default_computer_id')) {
          dest.prepare('UPDATE workspaces SET default_computer_id = ? WHERE id = ?').run(computerId, text(a.id));
        }
      }

      // The work, placed on that computer. The home's own path column stays
      // empty: the folder is there, not here.
      const insertExecution = insert('executions');
      const insertPlacement = dest.prepare(
        `INSERT INTO execution_placements (id, created_at, updated_at, execution_id, computer_id, generation, worktree_path, checkpoint_sha, start_reason, ended_at, end_reason)
         VALUES (@id, @now, @now, @executionId, @computerId, 1, @worktreePath, NULL, 'adopted', NULL, NULL)`,
      );
      const placementOf = new Map<string, string>();
      const executionRow = src.prepare('SELECT * FROM executions WHERE id = ?');
      for (const id of plan.executionIds) {
        const e = executionRow.get(id) as Row;
        const takeover = text(e.takeover_chat_session_id);
        insertExecution.run(
          pick('executions', e, {
            workspace_id: plan.agentIds.get(text(e.workspace_id)) ?? text(e.workspace_id),
            worktree_path: null,
            ...(plan.columns.executions.includes('takeover_chat_session_id') ? { takeover_chat_session_id: takeover && plan.knownChats(takeover) ? takeover : null } : {}),
          }),
        );
        const placementId = uuidv7();
        insertPlacement.run({ id: placementId, now, executionId: id, computerId, worktreePath: text(e.worktree_path) || null });
        placementOf.set(id, placementId);
      }

      // The chats: in their agent here, read, main chats archived where this
      // home has its own, and every chat that isn't part of work pinned to
      // that computer, where its native session is.
      const insertChat = insert('chat_sessions');
      const insertNative = dest.prepare(
        `INSERT INTO native_sessions (id, created_at, updated_at, chat_session_id, computer_id, placement_id, harness, native_session_id, started_at, ended_at, end_reason)
         VALUES (@id, @now, @now, @chatSessionId, @computerId, @placementId, @harness, @nativeSessionId, @startedAt, NULL, NULL)`,
      );
      const chatRow = src.prepare('SELECT * FROM chat_sessions WHERE id = ?');
      for (const id of plan.chatIds) {
        const c = chatRow.get(id) as Row;
        const executionId = text(c.execution_id) || null;
        const archive = plan.archivedMainChats.has(id);
        const lastSeen = [c.last_viewed_at, c.last_outcome_event_at, c.last_activity_at].map(text).filter(Boolean).sort().at(-1) ?? null;
        insertChat.run(
          pick('chat_sessions', c, {
            workspace_id: c.workspace_id ? (plan.agentIds.get(text(c.workspace_id)) ?? text(c.workspace_id)) : null,
            ...(archive ? { status: 'archived', archived_at: text(c.archived_at) || now } : {}),
            ...(plan.columns.chat_sessions.includes('last_viewed_at') ? { last_viewed_at: lastSeen } : {}),
            ...(plan.columns.chat_sessions.includes('unread_marker_at') ? { unread_marker_at: null } : {}),
          }),
        );
        if (!executionId && hasColumn('chat_sessions', 'computer_id')) {
          dest.prepare('UPDATE chat_sessions SET computer_id = ? WHERE id = ?').run(computerId, id);
        }
        const native = text(c.external_session_id);
        if (native) {
          insertNative.run({
            id: uuidv7(),
            now,
            chatSessionId: id,
            computerId,
            placementId: executionId ? (placementOf.get(executionId) ?? null) : null,
            harness: text(c.harness),
            nativeSessionId: native,
            startedAt: text(c.started_at) || text(c.created_at) || now,
          });
        }
      }

      // Messages, in their order: a chat reads by insertion order.
      const insertEvent = insert('chat_events');
      const events = src.prepare('SELECT * FROM chat_events WHERE session_id = ? ORDER BY rowid');
      const destEvent = dest.prepare('SELECT 1 FROM chat_events WHERE id = ?');
      for (const id of plan.chatIds) {
        for (const e of events.iterate(id) as Iterable<Row>) {
          if (destEvent.get(text(e.id))) continue;
          const sender = text(e.sender_session_id);
          insertEvent.run(
            pick('chat_events', e, plan.columns.chat_events.includes('sender_session_id') ? { sender_session_id: sender && plan.knownChats(sender) ? sender : null } : {}),
          );
        }
      }

      // Terminal-history ledgers, read from that computer from now on, never
      // from a path on it.
      if (plan.ledgerIds.length > 0) {
        const insertLedger = insert('external_session_imports');
        const ledgerRow = src.prepare('SELECT * FROM external_session_imports WHERE id = ?');
        for (const id of plan.ledgerIds) {
          const l = ledgerRow.get(id) as Row;
          insertLedger.run(pick('external_session_imports', l, { source_path: null }));
          if (hasColumn('external_session_imports', 'computer_id')) {
            dest.prepare('UPDATE external_session_imports SET computer_id = ? WHERE id = ?').run(computerId, id);
          }
        }
      }
      if (plan.previewIds.length > 0) {
        const insertPreview = insert('preview_targets');
        const previewRow = src.prepare('SELECT * FROM preview_targets WHERE id = ?');
        for (const id of plan.previewIds) insertPreview.run(pick('preview_targets', previewRow.get(id) as Row));
      }

      // Each agent's folder on that computer (§4.1), in the same transaction,
      // so an agent that lives only there never gets a folder here at boot.
      for (const [agentId, folder] of plan.folders) setAgentFolder(agentId, computerId, folder);

      const broken = dest.prepare('PRAGMA foreign_key_check').all() as Row[];
      if (broken.length > 0) {
        throw new HomeImportError(`The imported records would break ${broken.length} link(s), first in ${text(broken[0]!.table)}. Nothing was imported.`);
      }
    }).immediate();
  } catch (err) {
    for (const file of copied) fs.rmSync(file, { force: true });
    throw err;
  }

  // What came from where.
  const summary: HomeImportPlan = { ...plan.summary, computer: { ...plan.summary.computer, id: computerId } };
  const manifestDir = path.join(getAppRoot(), '.archive', 'imports');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${now.replace(/[:.]/g, '-')}-${importId}.json`);
  const manifest = {
    importId,
    importedAt: now,
    source: { root: sourceRoot },
    summary,
    agents: summary.agents.map((a) => ({ sourceId: a.sourceId, name: a.name, action: a.action, destId: a.destId, folder: a.folder })),
    chats: plan.chatIds,
    archivedMainChats: [...plan.archivedMainChats],
    executions: plan.executionIds,
    ledgers: plan.ledgerIds,
    previews: plan.previewIds,
    attachments: plan.attachmentFiles.map((f) => f.name),
  };
  fs.writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2));
  fs.renameSync(`${manifestPath}.tmp`, manifestPath);
  return { ...summary, importId, manifestPath };
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Row[]).map((r) => text(r.name)));
}

function attachmentNamesIn(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a) => (a && typeof a === 'object' ? text((a as Row).file_name ?? (a as Row).fileName) : ''))
      .filter((name) => name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..');
  } catch {
    return [];
  }
}

/** A plan as a person reads it. */
export function describeHomeImport(plan: HomeImportPlan, opts: { applied?: boolean } = {}): string {
  const lines: string[] = [];
  const verb = opts.applied ? 'Imported' : 'Would import';
  lines.push(`${verb} from ${plan.sourceRoot}, as work on ${plan.computer.name}${plan.computer.created ? ' (a new computer record here)' : ''}:`);
  lines.push(`  ${plan.chats.import} chats (${plan.chats.mainChatsArchived} main chats archived, since this home has its own), ${plan.executions.import} executions, ${plan.events} messages`);
  lines.push(`  ${plan.attachments.copy} attachments${plan.ledgers ? `, ${plan.ledgers} terminal-history ledgers` : ''}${plan.previews ? `, ${plan.previews} previews` : ''}`);
  lines.push(`Left out: ${plan.chats.scheduled} chats a schedule started, ${plan.chats.emptyDetached} empty chats on tasks or notes this home doesn't have.`);
  if (plan.chats.alreadyHere || plan.executions.alreadyHere) {
    lines.push(`Already here, unchanged: ${plan.chats.alreadyHere} chats, ${plan.executions.alreadyHere} executions.`);
  }
  lines.push('Agents:');
  for (const a of plan.agents) {
    const how = a.action === 'created' ? 'new here' : a.action === 'same' ? 'the same agent' : `joins ${a.destName} (${a.destId})`;
    lines.push(`  ${a.name} [${a.status}] ${a.sourceId}: ${how}, ${a.chats} chats${a.folder ? `, at ${a.folder} on ${plan.computer.name}` : ''}`);
  }
  for (const f of plan.foldersKept) lines.push(`  ${f.agent} keeps its folder on ${plan.computer.name}, ${f.recorded} (the other home had ${f.theirs}).`);
  if (plan.attachments.missing.length) lines.push(`Attachments named but not in the source (the chats keep their names): ${plan.attachments.missing.join(', ')}`);
  if (plan.problems.length) lines.push(`Problems, so nothing can be imported:\n  ${plan.problems.join('\n  ')}`);
  return lines.join('\n');
}
