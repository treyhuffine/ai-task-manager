/**
 * GET — three-section dataset for the references slide-over:
 *
 *   - inChat:    tasks/notes the session has mentioned (chat_refs rows)
 *   - workspace: tasks/notes for the session's workspace, minus inChat
 *   - all:       everything else (only populated when ?scope=all)
 *
 * POST — pin a task/note/area to the session (writes chat_refs row).
 * DELETE — unpin via ?entityType=&entityId= query.
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
import { withCompression } from '@/lib/api/compression';

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
    areaId: t.areaId,
    workspaceId: t.workspaceId,
    updatedAt: t.updatedAt,
    referencedAt: referencedAt ?? null,
    // `subtaskCount` is computed by `listTasks` via a correlated subquery;
    // `getTask` (single-row fetch) doesn't carry it. Falls through to
    // undefined for inChat tasks resolved off the workspace map.
    subtaskCount: 'subtaskCount' in t ? t.subtaskCount : undefined,
  };
}

function noteToRow(n: NoteRecord, referencedAt?: string | null): ReferenceRow {
  return {
    kind: 'note',
    id: n.id,
    title: n.title ?? 'Untitled',
    areaId: n.areaId,
    workspaceId: n.workspaceId,
    updatedAt: n.updatedAt,
    referencedAt: referencedAt ?? null,
  };
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
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
    const refTimestamps = new Map<string, string>(); // key: `${type}:${id}` → most recent createdAt
    for (const r of refs) {
      const key = `${r.entityType}:${r.entityId}`;
      const prior = refTimestamps.get(key);
      if (!prior || prior < r.createdAt) refTimestamps.set(key, r.createdAt);
      if (r.entityType === 'task') inChatTaskIds.add(r.entityId);
      else if (r.entityType === 'note') inChatNoteIds.add(r.entityId);
    }

    // Workspace task/note lists fetched up front so inChat tasks can
    // pull subtaskCount from the same payload (listTasks includes it
    // as a correlated subquery — getTask doesn't). Tasks in chat but
    // outside the workspace fall back to getTask without subtaskCount.
    const workspaceTasks = session.workspaceId
      ? listTasks({ workspaceId: session.workspaceId, status: ['active', 'done'], limit: 200 })
      : [];
    const workspaceNotes = session.workspaceId
      ? listNotes({ workspaceId: session.workspaceId, status: 'active', limit: 200 })
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
    inChat.sort((a, b) => (b.referencedAt ?? '').localeCompare(a.referencedAt ?? ''));

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
      return b.updatedAt.localeCompare(a.updatedAt);
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
      all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  entityType?: 'task' | 'note' | 'area';
  entityId?: string;
  hydrate?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PinBody = await request.json();
    const entityType = body.entityType;
    const entityId = body.entityId;
    if (!entityType || !entityId) {
      return Response.json({ error: 'entityType and entityId required' }, { status: 400 });
    }
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    pinSessionRef({
      sessionId: id,
      entityType: entityType,
      entityId: entityId,
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
    const entityType = url.searchParams.get('entityType') as
      | 'task' | 'note' | 'area' | null;
    const entityId = url.searchParams.get('entityId');
    if (!entityType || !entityId) {
      return Response.json({ error: 'entityType and entityId required' }, { status: 400 });
    }
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    unpinSessionRef({
      sessionId: id,
      entityType: entityType,
      entityId: entityId,
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/sessions/:id/references]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
