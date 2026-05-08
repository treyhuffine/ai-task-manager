import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import { chatEvents } from '@/lib/db/schema';
import {
  getAgent, getChatSession, insertPastedAttachments,
  type InsertPastedAttachmentInput,
} from '@/lib/db/queries';
import { deriveAndSetSessionLabel } from '@/lib/sessions/derive-label';
import * as executor from '@/lib/executor/adapter';

interface AttachmentInput {
  id: string;
  filename: string;
  content: string;
}

interface PostBody {
  content?: string;
  /** Pasted-text attachments matching `[[paste:id]]` markers in `content`. */
  attachments?: AttachmentInput[];
}

/**
 * Replace `[[paste:id]]` markers in the content string with an
 * XML-wrapped paste block carrying the attachment's full text. Used
 * to build the prompt the agent sees while keeping the persisted
 * user-event content compact.
 *
 * Why XML rather than naked inline expansion:
 *   - Claude is trained on XML structure (per Anthropic prompt-eng
 *     docs) so the wrapping reads as "the user attached a file" with
 *     stronger signal than ambiguous prose.
 *   - Eventual transcript sync (replaying Claude's JSONL into our
 *     chat_events) can deterministically reconstruct markers from the
 *     `<paste id="...">` blocks in the JSONL and dedupe against our
 *     chat_attachments rows.
 *   - Position is preserved natively — the agent reads content at the
 *     exact spot the user pasted, rather than dereferencing a
 *     separately-attached file.
 *
 * Collision is bounded three ways: the `<paste>` tag is unusual, the
 * id format is uuidv7, and the sync reconstruction will only match
 * when the id resolves to a real chat_attachments row.
 *
 * Markers without a matching attachment are left intact (safer than
 * dropping — the agent at least sees the placeholder and can ask).
 */
function expandMarkers(content: string, attachments: AttachmentInput[]): string {
  if (attachments.length === 0) return content;
  const map = new Map<string, AttachmentInput>(attachments.map((a) => [a.id, a]));
  return content.replace(/\[\[paste:([0-9a-zA-Z_-]+)\]\]/g, (full, id: string) => {
    const a = map.get(id);
    if (a == null) return full;
    return formatPasteBlock(a);
  });
}

function formatPasteBlock(a: AttachmentInput): string {
  // If the pasted content itself contains a literal `</paste` close
  // sequence, escape it with a backslash so neither our sync parser
  // nor Claude treats it as the end of our wrapper. The original
  // intent is preserved (Claude reads the escaped form fine) and our
  // wrapper integrity stays intact.
  const safe = a.content.replace(/<\/paste(\s|>)/gi, '<\\/paste$1');
  return `<paste id="${a.id}" filename="${escapeXmlAttr(a.filename)}">\n${safe}\n</paste>`;
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * Send a user message into an execution session.
 *
 * Two writes happen:
 *   1. The user's message lands in `chat_events` synchronously — per
 *      `docs/chat-sessions.md`, the app owns the user write because
 *      agentex skips userMessage events from its stream.
 *   2. The executor adapter dispatches the message into the live
 *      AgentSession (or creates one on first turn). That's
 *      fire-and-forget from this handler — we return 201 immediately;
 *      assistant text, tool calls, and the run-completion event flow
 *      into `chat_events` from the adapter's onEvent callback over the
 *      next seconds-to-minutes. The client polls
 *      `/api/sessions/:id/events` to render them.
 *
 * Pre-flight `executor.isRunning` rejects double-sends with 409. The UI
 * disables the composer based on runtime-status to make this rare; the
 * server check is defense-in-depth.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PostBody = await request.json();
    const content = body.content?.trim();
    const attachments = body.attachments ?? [];
    if (!content) {
      return Response.json({ error: 'content is required' }, { status: 400 });
    }

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return Response.json({ error: 'Cannot send to an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return Response.json(
        { error: 'already_running', message: 'A turn is already in flight for this session.' },
        { status: 409 },
      );
    }

    // Persist the user event with the *marker* version of content. The
    // expanded version (with paste content inlined) goes only to the
    // agent — keeping the row compact prevents giant pastes from
    // bloating /events polls. The transcript renderer parses markers
    // out and substitutes paste chips on render.
    //
    // No external_event_id for in-app rows; no source_part_index split.
    // Created_at is explicit ISO so chronological sort works against
    // agentex's StreamEvent timestamps.
    const db = getDb();
    const row = db
      .insert(chatEvents)
      .values({
        id: uuidv7(),
        session_id: id,
        role: 'user',
        source: 'user',
        content,
        created_at: new Date().toISOString(),
      })
      .returning()
      .get();

    if (attachments.length > 0) {
      const inputs: InsertPastedAttachmentInput[] = attachments.map((a) => ({
        marker_id: a.id,
        filename: a.filename,
        content: a.content,
      }));
      try {
        insertPastedAttachments(id, row.id, inputs);
      } catch (err) {
        console.error(`[POST /api/sessions/:id/messages] failed to persist attachments:`, err);
        // Soft-fail: the user event is already in. Agent will receive
        // the unexpanded marker (rendered to it as `[[paste:...]]`)
        // which is poor UX but better than blocking the turn.
      }
    }

    // First-message label derivation. Use the *expanded* content so
    // the AI summarizer sees real text rather than `[[paste:...]]`
    // tokens. Truncation fallback is fine either way.
    const expanded = expandMarkers(content, attachments);
    if (!session.label) {
      const agent = getAgent(session.agent_id);
      void deriveAndSetSessionLabel(id, expanded, agent?.harness ?? 'claude_code');
    }

    // Dispatch the *expanded* content to the agent so paste chips
    // become inline text from Claude's perspective. Fire-and-forget;
    // failures surface via logs and the runtime-status indicator.
    executor.dispatch(id, expanded).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[POST /api/sessions/:id/messages] dispatch failed for ${id}:`, msg);
    });

    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/sessions/:id/messages]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
