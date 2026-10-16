/**
 * A conservative, deterministic email signature reader. It only proposes:
 * an address seen in a signature becomes an alias suggestion, and a
 * "Role, Company" line becomes a suggested affiliation with its exact
 * passage. Nothing here changes an identity on its own.
 */
export interface SignatureFinding {
  emails: string[];
  role: string | null;
  company: string | null;
  passage: string;
}

const SIGN_OFF = /^(best|best regards|kind regards|warm regards|regards|thanks|thank you|many thanks|cheers|warmly|sincerely|all the best|talk soon|take care)[,.!]?\s*$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(\+?\d[\d\s().-]{6,}\d)/;
const ROLE_SPLIT = /^(.{2,60}?)\s*(?:,|\s\|\s|\s·\s|\sat\s|\s@\s)\s*(.{2,60})$/;

export function parseSignature(text: string, sender: { name: string | null; address: string }): SignatureFinding | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim());
  let start = -1;
  for (let index = lines.length - 1; index >= 0 && index >= lines.length - 25; index--) {
    if (/^--\s*$/.test(lines[index]) || SIGN_OFF.test(lines[index])) { start = index + 1; break; }
  }
  if (start < 0) return null;
  const block = lines.slice(start).filter(Boolean).slice(0, 6);
  if (!block.length) return null;
  const first = sender.name?.split(/\s+/)[0]?.toLowerCase();
  const namedBlock = !!first && first.length > 1 && block[0].toLowerCase().includes(first);
  const emails = [...new Set(block.join('\n').match(EMAIL) ?? [])].filter((email) => email.toLowerCase() !== sender.address.toLowerCase()).slice(0, 3);
  let role: string | null = null, company: string | null = null, roleLine: string | null = null;
  if (namedBlock) {
    for (const line of block.slice(1, 4)) {
      if (EMAIL.test(line) || PHONE.test(line) || /https?:\/\//i.test(line)) { EMAIL.lastIndex = 0; continue; }
      EMAIL.lastIndex = 0;
      const match = ROLE_SPLIT.exec(line);
      if (!match) continue;
      const [left, right] = [match[1].trim(), match[2].trim()];
      if (left.split(/\s+/).length > 6 || right.split(/\s+/).length > 6 || /\d{3,}/.test(line)) continue;
      role = left; company = right; roleLine = line;
      break;
    }
  }
  if (!emails.length && !role) return null;
  const passageLines = block.filter((line) => line === block[0] || line === roleLine || emails.some((email) => line.includes(email)));
  return { emails, role, company, passage: passageLines.join('\n').slice(0, 600) };
}
