import { reply, type OperationContext } from '@/lib/server/operation';
import { z } from 'zod/v4';

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

import type { ChatEventSource, CreateChatEventInput } from '@/db/types';
import { deleteAllChatEvents, getChatSession, insertChatEvent } from '@/lib/db/queries';
import { register, rejectAllForSession, type PendingPermission, type PendingQuestion } from '@/lib/executor/pending-input';
import type { AskUserQuestion } from '@agentex/agent';
import { uuidv7 } from 'uuidv7';

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
  toolName?: string | null;
  toolInput?: Record<string, unknown> | null;
  toolIsError?: boolean;
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

export async function POST(input: z.infer<typeof POSTInput>, _context: OperationContext) {
  if (process.env.NODE_ENV === 'production') return reply({ error: 'Not found' }, { status: 404 });
  try {
    const { id } = input.params;
    const body: InjectBody = input.body;

    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });

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
        return reply({ ok: true });
      case 'reset_session':
        rejectAllForSession(id, 'Session reset by dev tools');
        const removed = deleteAllChatEvents(id);
        return reply({ ok: true, removed });
      default: {
        // Exhaustive check — falls through to runtime error if a new
        // kind is added but not handled.
        const exhaustive: never = body;
        return reply(
          { error: `Unknown inject kind: ${(exhaustive as { kind?: string }).kind}` },
          { status: 400 },
        );
      }
    }
  } catch (err) {
    console.error('[POST /api/dev/sessions/:id/inject]', err);
    return reply({ error: String(err) }, { status: 500 });
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
      sessionId: sessionId,
      externalEventId: uuidv7(),
      externalToolCallId: requestId,
      role: 'system',
      source: 'question_response' satisfies ChatEventSource,
      content: resp.allow
        ? formatAnswers((resp.updatedInput?.answers as Record<string, string>) ?? null)
        : 'declined',
      toolInput: { answers: resp.updatedInput?.answers ?? null, allow: resp.allow },
      raw: { allow: resp.allow, answers: resp.updatedInput?.answers ?? null, injected: true },
    });
  });

  insertChatEvent({
    sessionId: sessionId,
    externalEventId: uuidv7(),
    externalToolCallId: requestId,
    role: 'system',
    source: 'question_request' satisfies ChatEventSource,
    content: null,
    toolInput: { questions: body.questions } as Record<string, unknown>,
    raw: { kind: 'question', questions: body.questions, injected: true },
    createdAt: now,
  });

  return reply({ ok: true, requestId });
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
      sessionId: sessionId,
      externalEventId: uuidv7(),
      externalToolCallId: requestId,
      role: 'system',
      source: 'permission_response' satisfies ChatEventSource,
      content: resp.allow ? 'allowed' : (resp.message ?? 'denied'),
      toolName: body.toolName,
      toolIsError: !resp.allow,
      raw: { allow: resp.allow, message: resp.message ?? null, injected: true },
    });
  });

  insertChatEvent({
    sessionId: sessionId,
    externalEventId: uuidv7(),
    externalToolCallId: requestId,
    role: 'system',
    source: 'permission_request' satisfies ChatEventSource,
    content: body.title ?? body.description ?? null,
    toolName: body.toolName,
    toolInput: body.input,
    raw: { kind: 'permission', title: body.title, description: body.description, injected: true },
    createdAt: now,
  });

  return reply({ ok: true, requestId });
}

function handleFakeEvent(sessionId: string, body: FakeEventBody) {
  const id = insertSyntheticEvent(sessionId, body);
  return reply({ ok: true, eventId: id });
}

function handleBatch(sessionId: string, body: BatchBody) {
  const ids: (string | null)[] = [];
  for (const ev of body.events) {
    ids.push(insertSyntheticEvent(sessionId, { kind: 'fake_event', ...ev }));
  }
  return reply({ ok: true, count: ids.length });
}

function insertSyntheticEvent(sessionId: string, body: FakeEventBody): string | null {
  const event: CreateChatEventInput = {
    sessionId: sessionId,
    externalEventId: uuidv7(),
    role: roleForSource(body.source),
    source: body.source,
    content: body.content ?? null,
    toolName: body.toolName ?? null,
    toolInput: body.toolInput ?? null,
    toolIsError: body.toolIsError ?? null,
    raw: { ...body, injected: true } as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  };
  return insertChatEvent(event)?.id ?? null;
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

const fake = z.object({ source: z.enum(['user', 'agent', 'thinking', 'tool_call', 'tool_result', 'system', 'result', 'rate_limit', 'error', 'recap', 'background_task', 'permission_request', 'permission_response', 'question_request', 'question_response', 'approval_request', 'approval_response', 'connection_request', 'connection_response', 'auth_required', 'cron', 'unknown']), content: z.string().nullable().optional(), toolName: z.string().nullable().optional(), toolInput: z.record(z.string(), z.unknown()).nullable().optional(), toolIsError: z.boolean().optional() }).strict();
const question = z.object({ question: z.string(), header: z.string(), options: z.array(z.object({ label: z.string(), description: z.string(), preview: z.string().optional() }).strict()), multiSelect: z.boolean().optional() }).strict();
export const POSTInput = z.object({
  params: z.object({ id: z.string().min(1) }).strict(), body: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('pending_question'), questions: z.array(question) }).strict(),
    z.object({ kind: z.literal('pending_permission'), toolName: z.string(), input: z.record(z.string(), z.unknown()), title: z.string().optional(), description: z.string().optional() }).strict(),
    fake.extend({ kind: z.literal('fake_event') }),
    z.object({ kind: z.literal('batch'), events: z.array(fake) }).strict(),
    z.object({ kind: z.literal('clear_pending') }).strict(), z.object({ kind: z.literal('reset_session') }).strict(),
  ])
}).strict();
