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
const LEADING_INVOCATION = /^(\s*)(\/([a-z0-9][a-z0-9._:-]*))(?=\s|$)/i;

export interface LeadingSlashCommand {
  leadingSpace: string;
  token: string;
  name: string;
  rest: string;
}

/**
 * Split a leading `/name` token from the rest of the message, preserving any
 * leading whitespace and trailing text for display or badge rendering.
 */
export function splitLeadingSlashCommand(text: string): LeadingSlashCommand | null {
  const match = LEADING_INVOCATION.exec(text);
  if (!match) return null;
  const leadingSpace = match[1] ?? '';
  const token = match[2]!;
  const name = match[3]!;
  return {
    leadingSpace,
    token,
    name,
    rest: text.slice(match[0].length),
  };
}

export function parseSlashInvocation(text: string): string | null {
  const parsed = splitLeadingSlashCommand(text);
  return parsed ? parsed.name.toLowerCase() : null;
}
