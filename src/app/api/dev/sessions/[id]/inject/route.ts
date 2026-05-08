/**
 * Dev-page inject endpoint. Programmatically drives the execution-chat
 * surface into specific states without going through Claude — useful
 * for visual QA and to test scenarios that are non-deterministic when
 * triggered via real prompts (notably AskUserQuestion).
 *
 * Auth: inherits the same Bearer/cookie check as every /api/* route via
 * `src/proxy.ts`. Single-user app, so all routes share one principal.
 *
 * Why this lives under `/api/dev/`: clear blast-radius signal in logs +
 * grep, and a future "disable dev tools in prod" flip can be a single
 * PUBLIC_PATHS-style allowlist change rather than threading flags
 * through each handler.
 *
 * Inject IDs use the `inject:` prefix on `toolUseId`. The pending-input
 * map keys on this string, so dev requests don't collide with real ones
 * (which are agentex-issued UUIDs).
 */

import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { getChatSession, insertChatEvent, deleteAllChatEvents } from '@/lib/db/queries';
import { register, rejectAllForSession, type PendingPermission, type PendingQuestion } from '@/lib/executor/pending-input';
import type { ChatEventSource, CreateChatEventInput } from '@/db/types';
import type { AskUserQuestion } from '@agentex/agent';

interface PendingQuestionBody {
  kind: 'pending_question';
  questions: AskUserQuestion[];
}

interface PendingPermissionBody {
  kind: 'pending_permission';
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
}

interface FakeEventBody {
  kind: 'fake_event';
  source: ChatEventSource;
  content?: string | null;
  tool_name?: string | null;
  tool_input?: Record<string, unknown> | null;
  tool_is_error?: boolean;
}

interface BatchBody {
  kind: 'batch';
  events: Array<Omit<FakeEventBody, 'kind'>>;
}

interface ClearPendingBody {
  kind: 'clear_pending';
}

interface ResetSessionBody {
  kind: 'reset_session';
}

type InjectBody =
  | PendingQuestionBody
  | PendingPermissionBody
  | FakeEventBody
  | BatchBody
  | ClearPendingBody
  | ResetSessionBody;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: InjectBody = await request.json();

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    switch (body.kind) {
      case 'pending_question':
        return handlePendingQuestion(id, body);
      case 'pending_permission':
        return handlePendingPermission(id, body);
      case 'fake_event':
        return handleFakeEvent(id, body);
      case 'batch':
        return handleBatch(id, body);
      case 'clear_pending':
        rejectAllForSession(id, 'Cleared by dev tools');
        return Response.json({ ok: true });
      case 'reset_session':
        rejectAllForSession(id, 'Session reset by dev tools');
        const removed = deleteAllChatEvents(id);
        return Response.json({ ok: true, removed });
      default: {
        // Exhaustive check — falls through to runtime error if a new
        // kind is added but not handled.
        const exhaustive: never = body;
        return Response.json(
          { error: `Unknown inject kind: ${(exhaustive as { kind?: string }).kind}` },
          { status: 400 },
        );
      }
    }
  } catch (err) {
    console.error('[POST /api/dev/sessions/:id/inject]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// ─── Handlers ─────────────────────────────────────────────────

function handlePendingQuestion(sessionId: string, body: PendingQuestionBody) {
  const requestId = `inject:${uuidv7()}`;
  const now = new Date().toISOString();

  const pending: PendingQuestion = {
    kind: 'question',
    requestId,
    sessionId,
    toolUseId: requestId,
    questions: body.questions,
    originalInput: { questions: body.questions },
    createdAt: now,
  };

  // Fire-and-forget the resolution promise — when the user answers via
  // the existing /pending-input/[requestId] route, the resolved value
  // would normally be returned to agentex. There's no agentex caller
  // here; we write a synthetic response event so the transcript still
  // shows the round-trip.
  void register(pending).then((resp) => {
    insertChatEvent({
      session_id: sessionId,
      external_event_id: uuidv7(),
      external_tool_call_id: requestId,
      role: 'system',
      source: 'question_response' satisfies ChatEventSource,
      content: resp.allow
        ? formatAnswers((resp.updatedInput?.answers as Record<string, string>) ?? null)
        : 'declined',
      tool_input: { answers: resp.updatedInput?.answers ?? null, allow: resp.allow },
      raw: { allow: resp.allow, answers: resp.updatedInput?.answers ?? null, injected: true },
    });
  });

  insertChatEvent({
    session_id: sessionId,
    external_event_id: uuidv7(),
    external_tool_call_id: requestId,
    role: 'system',
    source: 'question_request' satisfies ChatEventSource,
    content: null,
    tool_input: { questions: body.questions } as Record<string, unknown>,
    raw: { kind: 'question', questions: body.questions, injected: true },
    created_at: now,
  });

  return Response.json({ ok: true, requestId });
}

function handlePendingPermission(sessionId: string, body: PendingPermissionBody) {
  const requestId = `inject:${uuidv7()}`;
  const now = new Date().toISOString();

  const pending: PendingPermission = {
    kind: 'permission',
    requestId,
    sessionId,
    toolUseId: requestId,
    toolName: body.toolName,
    input: body.input,
    title: body.title ?? null,
    description: body.description ?? null,
    createdAt: now,
  };

  void register(pending).then((resp) => {
    insertChatEvent({
      session_id: sessionId,
      external_event_id: uuidv7(),
      external_tool_call_id: requestId,
      role: 'system',
      source: 'permission_response' satisfies ChatEventSource,
      content: resp.allow ? 'allowed' : (resp.message ?? 'denied'),
      tool_name: body.toolName,
      tool_is_error: !resp.allow,
      raw: { allow: resp.allow, message: resp.message ?? null, injected: true },
    });
  });

  insertChatEvent({
    session_id: sessionId,
    external_event_id: uuidv7(),
    external_tool_call_id: requestId,
    role: 'system',
    source: 'permission_request' satisfies ChatEventSource,
    content: body.title ?? body.description ?? null,
    tool_name: body.toolName,
    tool_input: body.input,
    raw: { kind: 'permission', title: body.title, description: body.description, injected: true },
    created_at: now,
  });

  return Response.json({ ok: true, requestId });
}

function handleFakeEvent(sessionId: string, body: FakeEventBody) {
  const id = insertSyntheticEvent(sessionId, body);
  return Response.json({ ok: true, eventId: id });
}

function handleBatch(sessionId: string, body: BatchBody) {
  const ids: (string | null)[] = [];
  for (const ev of body.events) {
    ids.push(insertSyntheticEvent(sessionId, { kind: 'fake_event', ...ev }));
  }
  return Response.json({ ok: true, count: ids.length });
}

function insertSyntheticEvent(sessionId: string, body: FakeEventBody): string | null {
  const event: CreateChatEventInput = {
    session_id: sessionId,
    external_event_id: uuidv7(),
    role: roleForSource(body.source),
    source: body.source,
    content: body.content ?? null,
    tool_name: body.tool_name ?? null,
    tool_input: body.tool_input ?? null,
    tool_is_error: body.tool_is_error ?? null,
    raw: { ...body, injected: true } as Record<string, unknown>,
    created_at: new Date().toISOString(),
  };
  return insertChatEvent(event);
}

function roleForSource(source: ChatEventSource): string {
  switch (source) {
    case 'user': return 'user';
    case 'agent': return 'assistant';
    case 'thinking': return 'assistant';
    case 'tool_call': return 'assistant';
    case 'tool_result': return 'tool';
    default: return 'system';
  }
}

function formatAnswers(answers: Record<string, string> | null): string {
  if (!answers) return 'no answers';
  return Object.entries(answers).map(([q, a]) => `${q}: ${a}`).join('\n');
}
