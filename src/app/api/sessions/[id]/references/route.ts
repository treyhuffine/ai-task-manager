/**
 * GET — three-section dataset for the references slide-over:
 *
 *   - inChat:    tasks/notes the session has mentioned (chat_refs rows)
 *   - workspace: tasks/notes for the session's workspace, minus inChat
 *   - all:       everything else (only populated when ?scope=all)
 *
 * POST — pin a task/note/area to the session (writes chat_refs row).
 * DELETE — unpin via ?entity_type=&entity_id= query.
 *
 * The slide-over uses one request per scope rather than three separate
 * endpoints because section precedence is a server concern — keeping
 * the rules in one place prevents drift.
 */
import { NextRequest } from 'next/server';
import {
  getChatSession,
  listSessionRefs,
  listTasks,
  listNotes,
  getTask,
  getNote,
  pinSessionRef,
  unpinSessionRef,
} from '@/lib/db/queries';
import type { ChatRefRecord, TaskRecord, TaskListRecord, NoteRecord } from '@/db/types';
import type { ReferenceRow } from '@/lib/api/sessions';

const SECTION_CAP = 50;

function taskToRow(
  t: TaskRecord | TaskListRecord,
  referencedAt?: string | null,
): ReferenceRow {
  return {
    kind: 'task',
    id: t.id,
    title: t.title,
    status: t.status,
    area_id: t.area_id,
    workspace_id: t.workspace_id,
    updated_at: t.updated_at,
    referenced_at: referencedAt ?? null,
    // `subtask_count` is computed by `listTasks` via a correlated subquery;
    // `getTask` (single-row fetch) doesn't carry it. Falls through to
    // undefined for inChat tasks resolved off the workspace map.
    subtask_count: 'subtask_count' in t ? t.subtask_count : undefined,
  };
}

function noteToRow(n: NoteRecord, referencedAt?: string | null): ReferenceRow {
  return {
    kind: 'note',
    id: n.id,
    title: n.title ?? 'Untitled',
    area_id: n.area_id,
    workspace_id: n.workspace_id,
    updated_at: n.updated_at,
    referenced_at: referencedAt ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    const url = new URL(request.url);
    const scope = (url.searchParams.get('scope') ?? 'session') as
      | 'session'
      | 'workspace'
      | 'all';

    const refs: ChatRefRecord[] = listSessionRefs(id);
    const inChatTaskIds = new Set<string>();
    const inChatNoteIds = new Set<string>();
    const refTimestamps = new Map<string, string>(); // key: `${type}:${id}` → most recent created_at
    for (const r of refs) {
      const key = `${r.entity_type}:${r.entity_id}`;
      const prior = refTimestamps.get(key);
      if (!prior || prior < r.created_at) refTimestamps.set(key, r.created_at);
      if (r.entity_type === 'task') inChatTaskIds.add(r.entity_id);
      else if (r.entity_type === 'note') inChatNoteIds.add(r.entity_id);
    }

    // Workspace task/note lists fetched up front so inChat tasks can
    // pull subtask_count from the same payload (listTasks includes it
    // as a correlated subquery — getTask doesn't). Tasks in chat but
    // outside the workspace fall back to getTask without subtask_count.
    const workspaceTasks = session.workspace_id
      ? listTasks({ workspace_id: session.workspace_id, status: ['active', 'done'], limit: 200 })
      : [];
    const workspaceNotes = session.workspace_id
      ? listNotes({ workspace_id: session.workspace_id, status: 'active', limit: 200 })
      : [];
    const workspaceTasksById = new Map(workspaceTasks.map((t) => [t.id, t]));

    // inChat — most-recent mention/pin first.
    const inChat: ReferenceRow[] = [];
    for (const tid of inChatTaskIds) {
      const t = workspaceTasksById.get(tid) ?? getTask(tid);
      if (t) inChat.push(taskToRow(t, refTimestamps.get(`task:${tid}`)));
    }
    for (const nid of inChatNoteIds) {
      const n = getNote(nid);
      if (n) inChat.push(noteToRow(n, refTimestamps.get(`note:${nid}`)));
    }
    inChat.sort((a, b) => (b.referenced_at ?? '').localeCompare(a.referenced_at ?? ''));

    // workspace — workspace-scoped, not already in chat.
    const workspace: ReferenceRow[] = [];
    for (const t of workspaceTasks) {
      if (inChatTaskIds.has(t.id)) continue;
      workspace.push(taskToRow(t));
    }
    for (const n of workspaceNotes) {
      if (inChatNoteIds.has(n.id)) continue;
      workspace.push(noteToRow(n));
    }
    // Active first within each kind, then by recency.
    workspace.sort((a, b) => {
      const aActive = a.kind === 'task' && a.status === 'active' ? 0 : 1;
      const bActive = b.kind === 'task' && b.status === 'active' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.updated_at.localeCompare(a.updated_at);
    });

    // all — cross-workspace, not already in inChat/workspace.
    let all: ReferenceRow[] = [];
    if (scope === 'all') {
      const everyTask = listTasks({ status: ['active', 'done'], limit: 500 });
      const everyNote = listNotes({ status: 'active', limit: 500 });
      const inChatOrWorkspace = new Set<string>();
      for (const r of [...inChat, ...workspace]) {
        inChatOrWorkspace.add(`${r.kind}:${r.id}`);
      }
      for (const t of everyTask) {
        if (inChatOrWorkspace.has(`task:${t.id}`)) continue;
        all.push(taskToRow(t));
      }
      for (const n of everyNote) {
        if (inChatOrWorkspace.has(`note:${n.id}`)) continue;
        all.push(noteToRow(n));
      }
      all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      all = all.slice(0, SECTION_CAP * 2);
    }

    return Response.json({
      inChat: inChat.slice(0, SECTION_CAP),
      workspace: workspace.slice(0, SECTION_CAP),
      all,
      scope,
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/references]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface PinBody {
  entity_type?: 'task' | 'note' | 'area';
  entity_id?: string;
  hydrate?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PinBody = await request.json();
    const entity_type = body.entity_type;
    const entity_id = body.entity_id;
    if (!entity_type || !entity_id) {
      return Response.json({ error: 'entity_type and entity_id required' }, { status: 400 });
    }
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    pinSessionRef({
      sessionId: id,
      entityType: entity_type,
      entityId: entity_id,
      hydrate: body.hydrate ?? true,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/sessions/:id/references]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const entity_type = url.searchParams.get('entity_type') as
      | 'task' | 'note' | 'area' | null;
    const entity_id = url.searchParams.get('entity_id');
    if (!entity_type || !entity_id) {
      return Response.json({ error: 'entity_type and entity_id required' }, { status: 400 });
    }
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    unpinSessionRef({
      sessionId: id,
      entityType: entity_type,
      entityId: entity_id,
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/sessions/:id/references]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
