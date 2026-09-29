import { NextRequest } from 'next/server';
import { isDesktopRequest } from '@/lib/connectors/desktop-oauth';
import {
  startClaudeLogin,
  waitForClaudeLogin,
  getClaudeAuthStatus,
} from '@/lib/auth/claude';

/**
 * POST /api/claude-auth/login
 *
 * Drives the in-chat "Log in to Claude" button. Three phases collapsed
 * into one request so the client only awaits one promise:
 *
 *   1. Fast-path: if `claude auth status` already reports `loggedIn:
 *      true` (the user re-authed from a terminal in another window),
 *      skip straight to phase 3.
 *   2. Spawn `claude auth login --claudeai` detached; it opens the
 *      user's browser for the Claude.ai OAuth flow.
 *   3. Poll `claude auth status` until `loggedIn: true` or timeout.
 *
 * No session bookkeeping or DB writes here — the `auth_required`
 * chat_event already in the transcript stays as historical record, and
 * the renderer decides whether to show the button by checking the live
 * auth status (via `useClaudeAuthStatus`). Claude Code re-reads
 * credentials per-request, so the user just re-sends their failed
 * message and it goes through.
 */
export async function POST(request: NextRequest) {
  try {
    const initial = await getClaudeAuthStatus();
    if (!initial.loggedIn) {
      if (!isDesktopRequest(request)) return Response.json({ ok: false, error: 'Sign in on the device running Ri: run claude auth login --claudeai in its terminal or SSH session, follow the sign-in link, then retry here.' }, { status: 409 });
      startClaudeLogin();
    }
    const status = initial.loggedIn ? initial : await waitForClaudeLogin();
    return Response.json({ ok: true, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
