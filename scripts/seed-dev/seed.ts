#!/usr/bin/env tsx
/**
 * `pnpm dev:seed`: fill the dev home with the synthetic dataset, a believable
 * but obviously fictional person (Maya Okafor: coffee roastery, a birding app
 * built with agents, marathon training, an old house). Every surface has
 * something in every state: tasks across the lifecycle with deadlines and
 * recurrences, notes with links and attachments, captures in each triage
 * state, agents with real git projects, executions with transcripts and
 * branch work, the main chat, focused chats, a week of decks, and triggers
 * with run history. Dates are relative to now, so a reseed always looks
 * current. See docs/environments.md.
 *
 * Content goes through `queries.ts`, so the markdown mirror, attachment
 * manifests, link index and chat outcomes are kept the way the app keeps
 * them. The seed then backdates bookkeeping columns (created, status-changed,
 * completed) that the query layer stamps with "now", since a seed is the one
 * writer that needs history.
 *
 * It refuses to run against the production home. Run it on an empty dev home
 * (`pnpm dev:reseed` wipes and reseeds) since it doesn't dedupe.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pc from 'picocolors';

import { APP_ROOT_ENV, getAppRoot, getDevAppRoot, getProductionAppRoot } from '../../src/lib/config/paths';
import type { Attachment } from '../../src/db/types';
import { SEED_FILE_NAMES, fileMarker, generateSeedFiles, type SeedFileName } from './files';
import { buildProjects, commitAll, git, writeFiles, type BuiltProject } from './projects';
import { writeTranscript } from './chat';
import { SEED_NOW, daysAgo, ms, plus } from './time';
import type { AgentSlug } from './tasks';

/** Refuse anything inside the production home, however it's reached. */
export async function assertNotProduction(): Promise<void> {
  const { isWithin } = await import('../../src/lib/config/dev-isolation');
  const { getDbPath, getConfigDir, getWorkDir } = await import('../../src/lib/config/paths');
  const production = getProductionAppRoot();
  for (const [label, p] of Object.entries({ root: getAppRoot(), database: getDbPath(), config: getConfigDir(), work: getWorkDir() })) {
    if (isWithin(p, production)) {
      throw new Error(`Refusing to seed: the ${label} (${p}) is inside the production home ${production}.`);
    }
  }
}

const MARKER = /\{\{(task|note|file):([^}]+)\}\}/g;

interface Resolver {
  taskIds: Map<string, string>;
  noteIds: Map<string, string>;
  files: Record<SeedFileName, Attachment>;
}

/** Replace `{{task:Title}}`, `{{note:Title}}`, `{{file:name}}` with the app's markers. */
function resolveMarkers(text: string | null | undefined, r: Resolver, where: string): string | null | undefined {
  if (!text) return text;
  return text.replace(MARKER, (_all, kind: string, ref: string) => {
    const key = ref.trim();
    if (kind === 'file') {
      const file = r.files[key as SeedFileName];
      if (!file) throw new Error(`${where}: unknown seed file ${key}`);
      return fileMarker(file);
    }
    const id = (kind === 'task' ? r.taskIds : r.noteIds).get(key);
    if (!id) throw new Error(`${where}: no ${kind} titled "${key}"`);
    return `[[${kind}:${id}]]`;
  });
}

/** The seed files a body mentions, as attachment uploads for the creator. */
function filesIn(text: string | null | undefined, files: Record<SeedFileName, Attachment>): Attachment[] {
  if (!text) return [];
  const names = [...text.matchAll(/\{\{file:([^}]+)\}\}/g)].map((m) => m[1]!.trim() as SeedFileName);
  return [...new Set(names)].filter((n) => files[n]).map((n) => files[n]);
}

const latest = (...isos: Array<string | null | undefined>) =>
  isos.filter((v): v is string => Boolean(v)).sort().at(-1)!;

export async function runSeed() {
  await assertNotProduction();
  const root = getAppRoot();
  console.log(pc.bold(`Seeding ${root}…`));

  const q = await import('../../src/lib/db/queries');
  const schema = await import('../../src/lib/db/schema');
  const { getDb } = await import('../../src/lib/db');
  const { eq } = await import('drizzle-orm');
  const db = getDb();
  const { areas: seedAreas } = await import('./areas');
  const { tasks: seedTasks } = await import('./tasks');
  const { notes: seedNotes } = await import('./notes');
  const { stream: seedStream } = await import('./stream');
  const { getWorkDir } = await import('../../src/lib/config/paths');
  if (q.listAreas().length > 0 || q.listTasks({}).length > 0) {
    throw new Error(`${root} already has data. The seed doesn't dedupe: use \`pnpm dev:reseed\` to rebuild the dev home.`);
  }

  // ── Who this is ─────────────────────────────────────────────
  q.updateUserState({
    name: 'Maya Okafor',
    description:
      'Co-owner of Tidewater Coffee, a small-batch roastery, with Luis Arroyo. Building Fieldnote, an iOS birding app, ' +
      'on the side with coding agents. Training for the Twin Rivers Marathon. Partner Theo, daughter Ruby (7), dog Pepper. ' +
      'Prefers short answers and hates busywork.',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    workdayStart: '07:30',
    workdayEnd: '17:30',
    onboardedAt: daysAgo(58, 21, 0),
    orchestratorIntroducedAt: daysAgo(58, 21, 5),
  });
  console.log(pc.green('  ✓ user state (Maya Okafor, onboarded)'));

  // ── Areas ───────────────────────────────────────────────────
  const areaIds = new Map<string, string>();
  for (const a of seedAreas) areaIds.set(a.name, q.createArea(a).id);
  const areaId = (name: string | undefined, where: string) => {
    if (!name) return null;
    const id = areaIds.get(name);
    if (!id) throw new Error(`${where}: no area named "${name}"`);
    return id;
  };
  console.log(pc.green(`  ✓ ${seedAreas.length} areas`));

  // ── Files ───────────────────────────────────────────────────
  const files = await generateSeedFiles();
  console.log(pc.green(`  ✓ ${SEED_FILE_NAMES.length} attachment files`));

  // ── Agents and their projects ───────────────────────────────
  const seedRoot = path.join(getWorkDir(), 'seed-projects');
  const projects = buildProjects(seedRoot);
  const workspaceIds = new Map<AgentSlug, string>();
  for (const [slug, p] of projects) {
    const ws = q.createWorkspace({
      name: p.def.name,
      slug,
      emoji: p.def.emoji,
      cwd: p.dir,
      isGit: p.def.isGit,
      baseBranch: p.def.isGit ? 'main' : null,
      remoteName: p.def.isGit ? 'origin' : null,
      filesToCopy: p.def.isGit ? ['.env*'] : [],
      areaId: areaId(p.def.areaName, `agent ${slug}`),
      purpose: p.def.purpose,
      instructions: p.def.instructions,
      setupCommand: p.def.setupCommand ?? null,
      startCommand: p.def.startCommand ?? null,
      status: 'active',
    });
    workspaceIds.set(slug, ws.id);
    db.update(schema.workspaces).set({ createdAt: daysAgo(45, 20, 0), updatedAt: daysAgo(10, 9, 0) }).where(eq(schema.workspaces.id, ws.id)).run();
  }
  const agentId = (slug: AgentSlug | undefined, where: string) => {
    if (!slug) return null;
    const id = workspaceIds.get(slug);
    if (!id) throw new Error(`${where}: no agent ${slug}`);
    return id;
  };
  console.log(pc.green(`  ✓ ${projects.size} agents with projects in ${seedRoot}`));

  // ── Tasks ───────────────────────────────────────────────────
  // Created with their markers still unresolved: a body may link a task or
  // note that doesn't exist yet. They're resolved in one pass below.
  const taskIds = new Map<string, string>();
  const noteIds = new Map<string, string>();
  for (const t of seedTasks) {
    const { area_name, parent_title, blocked_on_title, agent_slug, rawInput, ...rest } = t;
    const where = `task "${t.title}"`;
    const parentId = parent_title ? taskIds.get(parent_title) : null;
    if (parent_title && !parentId) throw new Error(`${where}: parent "${parent_title}" must come earlier`);
    const blockedOn = blocked_on_title ? taskIds.get(blocked_on_title) : null;
    if (blocked_on_title && !blockedOn) throw new Error(`${where}: blocker "${blocked_on_title}" must come earlier`);
    const attachments = filesIn(`${t.description ?? ''}\n${t.body ?? ''}`, files);
    const created = q.createTask({
      ...rest,
      rawInput: rawInput ?? t.title,
      areaId: areaId(area_name, where),
      parentId: parentId ?? null,
      workspaceId: agentId(agent_slug, where),
      ...(blockedOn ? { blockedOn } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    if (taskIds.has(created.title)) throw new Error(`${where}: duplicate title`);
    taskIds.set(created.title, created.id);
  }
  console.log(pc.green(`  ✓ ${seedTasks.length} tasks`));

  // ── Notes ───────────────────────────────────────────────────
  for (const n of seedNotes) {
    const { area_name, task_title, agent_slug, ...rest } = n;
    const where = `note "${n.title}"`;
    const taskId = task_title ? taskIds.get(task_title) : null;
    if (task_title && !taskId) throw new Error(`${where}: no task "${task_title}"`);
    const attachments = filesIn(n.body, files);
    const created = q.createNote({
      ...rest,
      areaId: areaId(area_name, where),
      taskId: taskId ?? null,
      workspaceId: agentId(agent_slug, where),
      ...(attachments.length ? { attachments } : {}),
    });
    if (n.title) {
      if (noteIds.has(n.title)) throw new Error(`${where}: duplicate title`);
      noteIds.set(n.title, created.id);
    }
  }
  console.log(pc.green(`  ✓ ${seedNotes.length} notes`));

  // ── Resolve markers and backdate ────────────────────────────
  // Bodies get their final link and file markers in place, then the link
  // index is rebuilt once. Bookkeeping columns the creators stamp with "now"
  // are set to the seeded history.
  const resolver: Resolver = { taskIds, noteIds, files };
  for (const t of seedTasks) {
    const id = taskIds.get(t.title)!;
    const created = t.createdAt ?? daysAgo(14);
    const statusChangedAt = t.statusChangedAt ?? (t.status === 'done' ? t.completedAt : undefined) ?? created;
    db.update(schema.tasks).set({
      description: resolveMarkers(t.description, resolver, `task "${t.title}"`) ?? null,
      body: resolveMarkers(t.body, resolver, `task "${t.title}"`) ?? null,
      createdAt: created,
      statusChangedAt,
      timesDeferred: t.timesDeferred ?? 0,
      updatedAt: latest(created, statusChangedAt, t.completedAt, t.lastProgressAt),
    }).where(eq(schema.tasks.id, id)).run();
  }
  for (const n of seedNotes) {
    if (!n.title) continue;
    const id = noteIds.get(n.title)!;
    const created = n.createdAt ?? daysAgo(12);
    db.update(schema.notes).set({
      body: resolveMarkers(n.body, resolver, `note "${n.title}"`) ?? '',
      createdAt: created,
      updatedAt: latest(created, n.updatedAt),
    }).where(eq(schema.notes.id, id)).run();
  }
  const links = q.rebuildAllEntityLinks();
  console.log(pc.green(`  ✓ links resolved (${links.sources} sources), history backdated`));

  // ── Captures and triage ─────────────────────────────────────
  await seedCaptures({ q, db, schema, eq, seedStream, taskIds, noteIds });

  // ── Executions ──────────────────────────────────────────────
  const execIds = await seedExecutions({ q, db, schema, eq, projects, workspaceIds, taskIds, files });

  // ── Chats, decks, automations ───────────────────────────────
  const { seedConversations } = await import('./conversations');
  await seedConversations({ q, db, schema, eq, taskIds, noteIds, workspaceIds, files });
  const { seedDecks } = await import('./decks');
  const decks = seedDecks({ q, db, schema, eq, taskIds });
  console.log(pc.green(`  ✓ ${decks} decks`));
  const { pauseReservedTriggers, seedAutomations } = await import('./automations');
  // The morning deck refresh and heartbeat the server would create on boot,
  // created first and paused, so a dev server never spends a subscription on
  // its own.
  await pauseReservedTriggers();
  const autos = seedAutomations({ q, db, schema, eq, workspaceIds, execIds });
  console.log(pc.green(`  ✓ ${autos.triggers} triggers, ${autos.runs} runs`));

  // The markdown mirror was written as each entity was created. Rewrite it
  // from the final rows.
  const { reconcileAll } = await import('../../src/lib/export/mirror');
  await reconcileAll({ force: true });
  console.log(pc.green('  ✓ markdown mirror'));
}

type Ctx = {
  q: typeof import('../../src/lib/db/queries');
  db: ReturnType<typeof import('../../src/lib/db').getDb>;
  schema: typeof import('../../src/lib/db/schema');
  eq: typeof import('drizzle-orm').eq;
};

async function seedCaptures(ctx: Ctx & {
  seedStream: typeof import('./stream').stream;
  taskIds: Map<string, string>;
  noteIds: Map<string, string>;
}) {
  const { q, db, schema, eq, seedStream, taskIds, noteIds } = ctx;
  let applied = 0;
  // One completed sweep proposes, the earlier ones applied silently.
  const pass = q.createTriagePass('schedule', { itemsSeen: seedStream.length });
  for (const item of seedStream) {
    const { status, createdAt, promotes_to_task_title, promotes_to_note_title, resurfaceAt, dismissedBy, ...rest } = item;
    const where = `capture "${item.rawText.slice(0, 40)}"`;
    const row = q.createStream({ ...rest, status: 'pending' });
    db.update(schema.stream).set({ createdAt, updatedAt: createdAt }).where(eq(schema.stream.id, row.id)).run();
    const decidedAt = plus(createdAt, 40 * ms.minute);
    if (status === 'promoted') {
      const targetType = promotes_to_task_title ? 'task' : 'note';
      const title = promotes_to_task_title ?? promotes_to_note_title;
      const targetId = title ? (targetType === 'task' ? taskIds : noteIds).get(title) : undefined;
      if (!targetId) throw new Error(`${where}: promoted to unknown ${targetType} "${title}"`);
      // What applying a promotion leaves: an executed decision, the
      // provenance link, and the task's capture stamp. The entity itself is
      // the seeded one.
      const decision = db.insert(schema.triageDecisions).values({
        id: (await import('uuidv7')).uuidv7(),
        passId: null,
        streamItemIds: [row.id],
        disposition: targetType === 'task' ? 'promote_task' : 'promote_note',
        targetType,
        targetId,
        draft: { title },
        rationale: 'Clear, actionable capture.',
        state: 'executed',
        actor: 'agent',
        decidedAt,
        createdAt: decidedAt,
        updatedAt: decidedAt,
      }).returning().get();
      q.createStreamLinks([{ streamId: row.id, entityType: targetType, entityId: targetId, relation: 'created', decisionId: decision.id }]);
      if (targetType === 'task') db.update(schema.tasks).set({ streamItemId: row.id }).where(eq(schema.tasks.id, targetId)).run();
      q.recomputeStreamStatus(row.id);
      applied++;
    } else if (status === 'reviewed' || status === 'dismissed' || status === 'incubating') {
      const disposition = status === 'reviewed' ? 'journal' : status === 'dismissed' ? 'dismiss' : 'incubate';
      const result = q.recordTriageDecisionAndApply({
        disposition,
        streamItemIds: [row.id],
        actor: status === 'dismissed' && dismissedBy === 'user' ? 'user' : 'agent',
        rationale: status === 'reviewed' ? 'A passing thought worth keeping, nothing to do.' : status === 'dismissed' ? 'Already covered elsewhere.' : 'Not now. Bring it back later.',
        ...(status === 'incubating' ? { draft: { resurfaceAt: resurfaceAt ?? daysAgo(-10) } } : {}),
      }, dismissedBy === 'user' ? 'accepted' : 'executed');
      db.update(schema.triageDecisions).set({ decidedAt, createdAt: decidedAt, updatedAt: decidedAt }).where(eq(schema.triageDecisions.id, result.decision.id)).run();
      applied++;
    } else if (status === 'proposed') {
      q.proposeTriageDecisions([{
        disposition: 'promote_task',
        streamItemIds: [row.id],
        draft: { title: proposedTitle(item.rawText), status: 'todo' },
        rationale: 'Reads like something to do. Suggesting a task.',
        confidence: 0.72,
        actor: 'agent',
      }], pass.id);
    }
    db.update(schema.stream).set({ createdAt }).where(eq(schema.stream.id, row.id)).run();
  }
  q.completeTriagePass(pass.id, { summary: `Swept ${seedStream.length} captures. ${applied} handled, the rest wait for you.` });
  db.update(schema.triagePasses).set({ createdAt: daysAgo(0, 6, 0), completedAt: daysAgo(0, 6, 2) }).where(eq(schema.triagePasses.id, pass.id)).run();
  console.log(pc.green(`  ✓ ${seedStream.length} captures, ${applied} triaged`));
}

/** A short task title from a capture's first sentence. */
function proposedTitle(raw: string): string {
  const first = raw.replace(/^(um|uh|ok|okay|so|note to self)[,:]?\s+/i, '').split(/[.!?\n]/)[0]!.trim();
  const t = first.length > 70 ? `${first.slice(0, 67).trimEnd()}...` : first;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function seedExecutions(ctx: Ctx & {
  projects: Map<AgentSlug, BuiltProject>;
  workspaceIds: Map<AgentSlug, string>;
  taskIds: Map<string, string>;
  files: Record<SeedFileName, Attachment>;
}): Promise<Map<string, { executionId: string; chatId: string }>> {
  const { q, db, schema, eq, projects, workspaceIds, taskIds, files } = ctx;
  const { executions } = await import('./executions');
  const { createWorktreeForSession, archiveSessionWorktree } = await import('../../src/lib/workspaces');
  const out = new Map<string, { executionId: string; chatId: string }>();

  for (const def of executions) {
    const project = projects.get(def.agent)!;
    const wsId = workspaceIds.get(def.agent)!;
    const { execution, session } = q.createExecutionWithChat({
      workspaceId: wsId,
      harness: def.harness,
      label: def.label,
      model: def.model,
      permissionMode: def.harness === 'codex' ? undefined : 'auto_all',
    });
    let cwd = project.dir;
    let worktreePath: string | null = null;

    if (project.def.isGit) {
      const ws = q.getWorkspace(wsId)!;
      const wt = await createWorktreeForSession({ ws, sessionId: session.id, sessionLabel: def.label });
      worktreePath = wt.path;
      cwd = wt.path;
      q.markExecutionSetupComplete(execution.id, { worktreePath: wt.path, branchName: wt.branch, baseSha: wt.baseSha, warning: wt.warning });
      for (const c of def.commits ?? []) {
        writeFiles(wt.path, c.files);
        commitAll(wt.path, c.message, plus(def.startAt, c.afterMin * ms.minute));
      }
      if (def.uncommitted) writeFiles(wt.path, def.uncommitted);
      if (def.push) git(wt.path, ['push', '-q', '-u', 'origin', wt.branch]);
    } else if (def.folderFiles) {
      writeFiles(project.dir, def.folderFiles);
    }

    const firstAttachments = (def.firstMessageAttachments ?? []).map((n) => files[n]);
    const steps = def.steps.map((s, i) =>
      i === 0 && 'user' in s && firstAttachments.length
        ? { ...s, user: `${s.user}\n\n${firstAttachments.map(fileMarker).join(' ')}`, attachments: firstAttachments }
        : s);
    const transcript = await writeTranscript(session, { harness: def.harness, model: def.harness === 'claude' ? 'claude-opus-5-5' : def.model, cwd, startAt: def.startAt, steps, costPerTurn: 0.21 });

    if (def.taskTitle) {
      const taskId = taskIds.get(def.taskTitle);
      if (!taskId) throw new Error(`execution ${def.key}: no task "${def.taskTitle}"`);
      q.attachExecutionToTask(execution.id, taskId);
    }
    if (def.prNumber) q.updateExecution(execution.id, { prNumber: def.prNumber });
    if (def.previewUrl) q.updateExecution(execution.id, { previewUrls: [{ service: null, url: def.previewUrl, label: 'Netlify preview' }] });
    if (def.setupScriptError) q.updateExecution(execution.id, { setupScriptStatus: 'failed', setupScriptError: def.setupScriptError });
    if (def.review && transcript.lastAgentEventId) {
      q.reviewExecutionOutput({ executionId: execution.id, outputEventId: transcript.lastAgentEventId, disposition: def.review, actorSource: 'human' });
    }

    if (def.archivedDaysAgo !== undefined && worktreePath) {
      // Merged into main, then archived the way the app does it: the
      // worktree goes, the branch stays.
      const exec = q.getExecution(execution.id)!;
      git(project.dir, ['merge', '-q', '--no-ff', exec.branchName!, '-m', `Merge ${exec.branchName}`], daysAgo(def.archivedDaysAgo, 11, 0));
      git(project.dir, ['push', '-q', 'origin', 'main']);
      await archiveSessionWorktree({ session: { worktreePath, branchName: exec.branchName } as never, force: true });
      q.archiveExecution(execution.id);
      const at = daysAgo(def.archivedDaysAgo, 11, 5);
      db.update(schema.executions).set({ archivedAt: at, updatedAt: at }).where(eq(schema.executions.id, execution.id)).run();
      db.update(schema.chatSessions).set({ archivedAt: at }).where(eq(schema.chatSessions.id, session.id)).run();
    }
    if (def.pinned) db.update(schema.executions).set({ pinnedAt: plus(def.startAt, 2 * ms.hour) }).where(eq(schema.executions.id, execution.id)).run();

    // When it started and whether Maya has looked since the agent's last word.
    // Only a worktree has a setup to start: a plain folder with a setup start
    // and no worktree reads as a hung setup to the cold-start sweep.
    db.update(schema.executions).set({ createdAt: def.startAt, setupStartedAt: worktreePath ? def.startAt : null }).where(eq(schema.executions.id, execution.id)).run();
    db.update(schema.chatSessions).set({
      createdAt: def.startAt,
      startedAt: def.startAt,
      lastActivityAt: transcript.lastAt,
      lastViewedAt: def.seen ? plus(transcript.lastAt, 5 * ms.minute) : (transcript.firstUserAt ?? def.startAt),
    }).where(eq(schema.chatSessions.id, session.id)).run();
    out.set(def.key, { executionId: execution.id, chatId: session.id });
  }
  console.log(pc.green(`  ✓ ${executions.length} executions with transcripts and branches`));
  return out;
}

async function main() {
  if (!process.env[APP_ROOT_ENV]) process.env[APP_ROOT_ENV] = getDevAppRoot();
  await runSeed();
  console.log();
  console.log(pc.dim(`Seeded at ${SEED_NOW.toLocaleString()}. Run \`pnpm dev\` to start.`));
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(pc.red(e instanceof Error ? e.stack ?? e.message : String(e)));
    process.exit(1);
  });
}

