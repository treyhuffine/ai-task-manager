/**
 * Wire shape for a session in a *list*.
 *
 * `listRailSessions` selects every column of `chat_sessions` and every column
 * of `executions`, and feeds two surfaces: the left rail (polled every 15s)
 * and the agent-facing `list_workspace_sessions` action. Both were shipping
 * fields neither one needs.
 *
 * One of them is a credential. `executions.takeoverToken` is the bearer for
 * "take over locally" — the `/api/takeover/<token>/...` routes accept it *in
 * place of* the account token, precisely because the CLI has no other way to
 * authenticate. Serializing it into a list meant a live credential crossed
 * the wire every 15 seconds and sat in the browser's query cache, and went to
 * any agent that called `list_workspace_sessions`.
 *
 * It is not needed in either place. The browser's takeover banner reads the
 * token off the single-session `GET /api/sessions/:id`, which still carries
 * it, and the CLI is handed the token directly when takeover starts.
 *
 * The rest is weight: `externalTranscriptPath` is a filesystem path nothing
 * renders and was 22.8% of rail bytes, and `scratchPad` is per-session prose
 * the list never shows.
 *
 * This is a denylist rather than an allowlist on purpose. The rail reads a
 * wide spread of fields across several views, so enumerating what to keep
 * would be a long list that silently breaks a view the day someone adds one.
 * Naming what must not leave is both the smaller claim and the safer one.
 */

const REDACTED_EXECUTION_FIELDS = [
  'takeoverToken',
  'takeoverTokenExpiresAt',
  'externalTranscriptPath',
] as const;

const REDACTED_SESSION_FIELDS = ['scratchPad', 'externalTranscriptPath'] as const;

type Redacted<T> = Omit<
  T,
  (typeof REDACTED_SESSION_FIELDS)[number] | (typeof REDACTED_EXECUTION_FIELDS)[number]
>;

/** Strip list-unsafe fields from one row and its nested execution. */
export function toRailSessionDTO<T extends object>(row: T): Redacted<T> {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of REDACTED_SESSION_FIELDS) delete out[field];

  const execution = out.execution;
  if (execution && typeof execution === 'object' && !Array.isArray(execution)) {
    const exec: Record<string, unknown> = { ...(execution as Record<string, unknown>) };
    for (const field of REDACTED_EXECUTION_FIELDS) delete exec[field];
    out.execution = exec;
  }

  return out as Redacted<T>;
}

export function toRailSessionDTOs<T extends object>(rows: readonly T[]): Redacted<T>[] {
  return rows.map(toRailSessionDTO);
}
