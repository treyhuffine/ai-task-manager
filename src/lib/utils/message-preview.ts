/**
 * A chat message as one line of plain text, for list previews (an agent's
 * row in the rail says what it last told you). Like a messaging app, it
 * flattens the message rather than cutting at the first line, so a lead-in
 * ("I'm asking here instead:") keeps the question that follows it. Code
 * blocks, rules and table rows are skipped, and the markdown a reader
 * wouldn't see is stripped: heading and list marks, emphasis, links, inline
 * code. Underscores are left alone so identifiers like `file_name` survive.
 * Lines join with a space after punctuation and a middot otherwise, so a
 * heading doesn't run into the sentence under it.
 */
export function messagePreview(content: string | null | undefined, max = 140): string | null {
  if (!content) return null;
  const withoutCode = content.replace(/```[\s\S]*?(```|$)/g, '\n');
  const lines = withoutCode
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^([-*_])\1{2,}$/.test(l) && !l.startsWith('|'))
    .map(plainLine)
    .filter(Boolean);
  if (lines.length === 0) return null;
  let text = lines[0];
  for (const line of lines.slice(1)) {
    if (text.length >= max) break;
    text += /[.!?:;,…]$/.test(text) ? ` ${line}` : ` · ${line}`;
  }
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function plainLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^([-*+]|\d+\.)\s+/, '')
    .replace(/\[\[file:[^\]]*\]\]/g, 'a file')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
