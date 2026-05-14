import type { NextRequest } from 'next/server';
import { getAgent, getChatSession, insertChatEvent } from '@/lib/db/queries';
import { deriveAndSetSessionLabel } from '@/lib/sessions/derive-label';
import { attachmentPath } from '@/lib/attachments/save';
import {
  extractTextFromAttachment, formatExtractedAttachment,
} from '@/lib/attachments/extract-text';
import * as executor from '@/lib/executor/adapter';
import type { Attachment } from '@/db/types';

interface PostBody {
  content?: string;
  /**
   * Files attached to this message — same `Attachment` shape as
   * tasks/notes/areas use. Marker tokens in `content`
   * (`[[file:<file_name>]]`) point at entries here. The shape (no
   * `content` field) reflects that the bytes already live on disk —
   * the upload happened via `POST /api/attachments` before submit.
   */
  attachments?: Attachment[];
  /**
   * Optional client-minted UUIDv7 for the resulting `chat_events` row.
   * When provided, the persisted row and any optimistic UI placeholder
   * the client already inserted share the same id, so the React
   * reconciler keeps the same DOM node when the POST resolves (no
   * unmount/remount flash). When omitted, the server mints a UUIDv7.
   */
  id?: string;
}

const MARKER_RE = /\[\[file:([A-Za-z0-9_.-]+)\]\]/g;

/**
 * Mimes Claude Code's Read tool handles natively. For these we hand
 * Claude an absolute path — same surface as `cat`-ing a file into
 * the CLI. Read takes care of multimodal images and PDFs in modern
 * Claude Code; the abs path is enough.
 *
 * Anything not in this set goes through `extractTextFromAttachment`
 * (mammoth/xlsx/STT) and gets inlined as `<attachment>` text at the
 * marker position so Claude sees readable content even for formats
 * Read can't handle.
 */
function claudeCodeReadsNatively(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  if (mime === 'application/json' || mime === 'application/xml') return true;
  return false;
}

/**
 * Build the prompt content the agent sees. Each `[[file:<file_name>]]`
 * marker is replaced in-place with either:
 *
 *   - For natively-readable mimes (text/code/image/PDF): the absolute
 *     disk path Claude Code's Read tool can pick up.
 *   - For non-readable mimes (docx/xlsx/audio): the extracted text
 *     wrapped in `<attachment>` tags so Claude sees the content
 *     directly.
 *
 * Markers without a matching attachment, or whose extraction returns
 * null, are left intact (safer than dropping — agent at least sees
 * the placeholder and can ask).
 */
async function expandMarkers(content: string, attachments: Attachment[]): Promise<string> {
  if (attachments.length === 0) return content;
  const map = new Map<string, Attachment>(attachments.map((a) => [a.file_name, a]));

  // Two-pass: collect every match, resolve replacements concurrently
  // (mammoth/xlsx/STT can be slow), then splice. Pure regex.replace
  // doesn't support async — this is the standard workaround.
  const matches: Array<{ start: number; end: number; replacement: string }> = [];
  const tasks: Promise<void>[] = [];
  for (const m of content.matchAll(MARKER_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const fileName = m[1]!;
    const a = map.get(fileName);
    if (!a) {
      // Unmatched — leave the marker alone (slot it back as itself).
      matches.push({ start, end, replacement: m[0] });
      continue;
    }
    if (claudeCodeReadsNatively(a.mime_type)) {
      matches.push({ start, end, replacement: attachmentPath(a.file_name) });
      continue;
    }
    // Async extraction — push a placeholder we'll fill in after.
    const slot = matches.length;
    matches.push({ start, end, replacement: m[0] });
    tasks.push(
      (async () => {
        try {
          const result = await extractTextFromAttachment(a);
          matches[slot]!.replacement = result
            ? formatExtractedAttachment(a, result)
            : `<attachment filename="${a.original_name || a.file_name}" status="unreadable" />`;
        } catch (err) {
          console.warn(`[expandMarkers] extract failed for ${a.file_name}:`, err);
          matches[slot]!.replacement = `<attachment filename="${a.original_name || a.file_name}" status="extract-error" />`;
        }
      })(),
    );
  }
  await Promise.all(tasks);

  // Splice from the end so earlier indexes stay valid.
  let out = content;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    out = out.slice(0, m.start) + m.replacement + out.slice(m.end);
  }
  return out;
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
    if (session.takeover_started_at) {
      return Response.json(
        {
          error: 'session_in_takeover',
          message:
            'Session is being worked on locally. Run `flow resume` or click Done in the takeover banner before sending more messages.',
        },
        { status: 409 },
      );
    }

    // Persist the user event with the *marker* version of content. The
    // expanded version (with paste content inlined) goes only to the
    // agent — keeping the row compact prevents giant pastes from
    // bloating the events cache. The transcript renderer parses markers
    // out and substitutes file chips on render.
    //
    // No external_event_id for in-app rows — the partial unique index
    // doesn't apply, so insertChatEvent always returns the row here.
    // Created_at is explicit ISO so chronological sort works against
    // agentex's StreamEvent timestamps.
    const row = insertChatEvent({
      id: body.id,
      session_id: id,
      role: 'user',
      source: 'user',
      content,
      attachments,
      created_at: new Date().toISOString(),
    });
    if (!row) {
      // User-message inserts have no unique-constraint, so this is
      // structurally unreachable. Guard anyway so the response is
      // type-safe and a future schema change can't silently 500.
      return Response.json({ error: 'failed to persist user message' }, { status: 500 });
    }

    // Expand markers once, off the response path. Both label
    // derivation and the agent dispatch use the same expanded prompt.
    const expanded = await expandMarkers(content, attachments);
    if (!session.label) {
      const agent = getAgent(session.agent_id);
      void deriveAndSetSessionLabel(id, expanded, agent?.harness ?? 'claude_code');
    }

    // Dispatch the *expanded* content to the agent. Fire-and-forget;
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
