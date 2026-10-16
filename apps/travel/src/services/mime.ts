/**
 * A small reader for saved email files (message/rfc822): headers, the first
 * text or HTML body and inline calendar invitations. It handles multipart
 * bodies, base64 and quoted-printable. Attachments are listed, never decoded.
 */
import { htmlToText, parseAddressList, parseCalendarInvite, decodeMimeWords, type CalendarInvite } from "@ri/app-kit/sources";

export interface EmailFile { subject: string; from: { name: string | null; address: string } | null; date: string | null; text: string; invite: CalendarInvite | null; attachments: string[] }

function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n\n");
  const head = end >= 0 ? normalized.slice(0, end) : normalized;
  const body = end >= 0 ? normalized.slice(end + 2) : "";
  const headers = new Map<string, string>();
  for (const line of head.replace(/\n[ \t]+/g, " ").split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const name = line.slice(0, colon).trim().toLowerCase();
      if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
    }
  }
  return { headers, body };
}
function decodeBody(body: string, encoding: string | undefined, charset: string): string {
  const kind = (encoding ?? "").toLowerCase();
  let bytes: Buffer;
  if (kind === "base64") bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
  else if (kind === "quoted-printable") bytes = Buffer.from(body.replace(/=\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
  else return body;
  try { return new TextDecoder(charset || "utf-8").decode(bytes); } catch { return bytes.toString("utf8"); }
}
const param = (value: string | undefined, name: string) => new RegExp(`${name}="?([^";]+)"?`, "i").exec(value ?? "")?.[1] ?? null;

export function readEmailFile(raw: string): EmailFile {
  const { headers, body } = splitHeaders(raw.slice(0, 2_000_000));
  let plain = "", html = "", invite: CalendarInvite | null = null;
  const attachments: string[] = [];
  let parts = 0;
  const walk = (partHeaders: Map<string, string>, partBody: string, depth: number) => {
    if (depth > 10 || ++parts > 200) return;
    const type = partHeaders.get("content-type") ?? "text/plain";
    const disposition = partHeaders.get("content-disposition") ?? "";
    const boundary = param(type, "boundary");
    if (/^multipart\//i.test(type) && boundary) {
      const chunks = partBody.split(`--${boundary}`).slice(1);
      for (const chunk of chunks) {
        if (chunk.startsWith("--")) break;
        const nested = splitHeaders(chunk.replace(/^\n/, ""));
        walk(nested.headers, nested.body, depth + 1);
      }
      return;
    }
    const filename = param(disposition, "filename") ?? param(type, "name");
    const charset = param(type, "charset") ?? "utf-8";
    const text = () => decodeBody(partBody, partHeaders.get("content-transfer-encoding"), charset);
    if (/^text\/calendar/i.test(type) && !invite) invite = parseCalendarInvite(text());
    else if (/attachment/i.test(disposition) || filename) attachments.push(filename ?? "attachment");
    else if (/^text\/plain/i.test(type) && !plain) plain = text();
    else if (/^text\/html/i.test(type) && !html) html = text();
  };
  walk(headers, body, 0);
  const from = parseAddressList(headers.get("from"))[0] ?? null;
  return {
    subject: decodeMimeWords(headers.get("subject") ?? "").replace(/\s+/g, " ").trim(),
    from: from ? { name: from.name, address: from.address } : null,
    date: headers.get("date") ?? null,
    text: (plain.trim() ? plain : html ? htmlToText(html) : "").replace(/\r\n/g, "\n").slice(0, 200_000),
    invite,
    attachments: attachments.slice(0, 50),
  };
}
