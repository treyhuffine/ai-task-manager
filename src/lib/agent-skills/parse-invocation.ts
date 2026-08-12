/**
 * Pull the skill name out of a message that invokes a slash command.
 *
 * Matches the composer's trigger semantics (`startOfLine: true` in the slash
 * menu extension) and Claude Code's own `parseSlashCommand`: the command must
 * open the message. A slash later in the text is ordinary prose.
 *
 * Used by the send route to feed `skill_usage`, which is what lets the `/`
 * menu learn. It runs on every send, so it stays a single regex — no
 * filesystem discovery on the hot path. Names are validated lazily at read
 * time against the live command list, so a non-command like `/tmp` writes an
 * inert row rather than needing a lookup here.
 */

/**
 * A leading `/name` followed by whitespace or end-of-string. The name charset
 * excludes `/`, which is what keeps an absolute path like `/Users/me/notes`
 * from reading as an invocation of `Users`.
 */
const INVOCATION = /^\/([a-z0-9][a-z0-9._:-]*)(?=\s|$)/i;

export function parseSlashInvocation(text: string): string | null {
  const match = INVOCATION.exec(text.trimStart());
  return match ? match[1]!.toLowerCase() : null;
}
