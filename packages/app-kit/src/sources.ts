/**
 * Read-only Google mail and calendar sources for app backends, built on the
 * host's connector capabilities (`invocation.capability`). One call to a step
 * reads at most one provider page and a bounded number of message bodies,
 * returns a new checkpoint for the app to commit, and never loops. Gmail
 * follows the documented full plus incremental sync with history-expiry
 * recovery, and Calendar follows page plus sync-token handling.
 *
 * https://developers.google.com/workspace/gmail/api/guides/sync
 * https://developers.google.com/workspace/calendar/api/guides/sync
 */
import { z } from "zod/v4";
import { AppError } from "./contract.js";
import type { AppInvocation } from "./sdk.js";
import { nowIso, sha256, transaction, type SqlDatabase } from "./data.js";

type Capable = Pick<AppInvocation, "capability" | "signal">;

// ─── Addresses ───────────────────────────────────────────────────────────────

export interface MailAddress {
  name: string | null;
  /** As written, trimmed. */
  address: string;
  /** Trimmed with a lower-case domain. Local parts keep dots, plus suffixes and case. */
  normalized: string;
}
/** Trim and lower-case only the domain. Never strips dots or plus suffixes. */
export function normalizeEmail(address: string): string {
  const value = address.trim();
  const at = value.lastIndexOf("@");
  return at < 1 ? value : `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}
export function emailDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  return at < 1 ? null : address.slice(at + 1).trim().toLowerCase() || null;
}
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "fastmail.com", "hey.com", "zoho.com", "yandex.com", "mail.com", "qq.com", "163.com"]);
/** A shared mail provider never identifies an employer. */
export function isPersonalMailDomain(domain: string | null): boolean {
  return !!domain && FREE_MAIL.has(domain.toLowerCase());
}
const ROLE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|mailer-daemon|postmaster|bounce[s]?|news(letter)?|marketing|updates?|info|support|help|hello|team|contact|billing|accounts?|admin|sales|jobs|careers|recruiting|hr|press|service|customerservice|reservations?|bookings?|confirmations?|receipts?|orders?)$/i;
/** A no-reply or automated sender address. */
export function isNoReply(address: string): boolean {
  const local = address.slice(0, address.lastIndexOf("@")).toLowerCase();
  return /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|bounces?)([._+-]|$)/.test(local);
}
/** A shared role mailbox such as support@ or team@, not one person. */
export function isRoleAddress(address: string): boolean {
  const local = address.slice(0, address.lastIndexOf("@"));
  return ROLE_LOCAL.test(local.split("+")[0]);
}

/** Decode RFC 2047 encoded words (=?UTF-8?B?...?= and =?charset?Q?...?=). */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, encoding: string, text: string) => {
      try {
        const bytes = encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
        return decodeBytes(bytes, charset);
      } catch {
        return whole;
      }
    });
}
function decodeBytes(bytes: Uint8Array, charset = "utf-8"): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase() || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
/** Parse an RFC 5322 address list, including quoted names, comments and groups. */
export function parseAddressList(value: string | null | undefined): MailAddress[] {
  if (!value) return [];
  const text = decodeMimeWords(value).slice(0, 20000);
  const items: string[] = [];
  let current = "", quoted = false, angle = 0, comment = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && quoted) { current += char + (text[++index] ?? ""); continue; }
    if (char === '"' && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment++;
    else if (!quoted && char === ")" && comment) comment--;
    else if (!quoted && !comment && char === "<") angle++;
    else if (!quoted && !comment && char === ">" && angle) angle--;
    if (!quoted && !comment && !angle && (char === "," || char === ";")) { items.push(current); current = ""; continue; }
    if (!quoted && !comment && !angle && char === ":" ) { current = ""; continue; } // group display name
    current += char;
  }
  items.push(current);
  const result: MailAddress[] = [];
  for (const raw of items) {
    const item = raw.replace(/\((?:[^()\\]|\\.)*\)/g, " ").trim();
    if (!item) continue;
    const angled = /^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(item);
    const address = (angled ? angled[2] : item).trim().replace(/^mailto:/i, "");
    if (!/^[^\s@]+@[^\s@]+$/.test(address) || address.length > 320) continue;
    const name = angled ? angled[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim() || null : null;
    result.push({ name: name && name !== address ? name.slice(0, 300) : null, address, normalized: normalizeEmail(address) });
    if (result.length >= 500) break;
  }
  return result;
}

// ─── Messages ────────────────────────────────────────────────────────────────

type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[]; partId?: string };
const rawMessage = z.object({
  id: z.string(), threadId: z.string().optional(), historyId: z.string().optional(), internalDate: z.string().optional(),
  snippet: z.string().optional(), labelIds: z.array(z.string()).optional(), payload: z.unknown().optional(), sizeEstimate: z.number().optional(),
}).passthrough();
export interface MailAttachment { attachmentId: string | null; filename: string; mimeType: string; size: number; partId: string | null }
export interface CalendarInvite { method: string | null; uid: string | null; summary: string | null; start: string | null; end: string | null; status: string | null; sequence: number | null; organizer: string | null; attendees: string[] }
export interface MailMessage {
  id: string;
  threadId: string;
  historyId: string | null;
  /** When Gmail received it, from internalDate. */
  receivedAt: string;
  labelIds: string[];
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  dateHeader: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  listId: string | null;
  /** Mail the owner sent from this account. */
  sent: boolean;
  draft: boolean;
  /** In Trash or Spam: treat as unavailable evidence. */
  discarded: boolean;
  /** Why this looks like bulk or automated mail, from headers and labels before any AI. Empty for ordinary mail. */
  bulkReasons: string[];
  text: string;
  textTruncated: boolean;
  /** The plain text came from an HTML part. */
  fromHtml: boolean;
  attachments: MailAttachment[];
  invite: CalendarInvite | null;
  snippet: string;
  /** Digest of the identity, headers and text. Unchanged content keeps the same digest. */
  digest: string;
}
function header(part: Part | undefined, name: string): string | null {
  const found = part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : null;
}
function charsetOf(part: Part): string {
  return /charset="?([^";]+)"?/i.exec(header(part, "Content-Type") ?? "")?.[1] ?? "utf-8";
}
function bodyText(part: Part): string {
  if (!part.body?.data) return "";
  return decodeBytes(Buffer.from(part.body.data, "base64url"), charsetOf(part));
}
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "(c)", reg: "(R)", trade: "TM", euro: "EUR", pound: "GBP" };
/** Readable text from an HTML email body. Drops scripts, styles and markup. */
export function htmlToText(html: string): string {
  return html
    .slice(0, 2_000_000)
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|blockquote)\s*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " \t")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** Remove quoted earlier messages so evidence shows what this message said. */
export function withoutQuotedReply(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .{4,200} wrote:\s*$/.test(line.trim()) || /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(line.trim()) || /^From: .+$/.test(line.trim()) && out.length > 3) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
/** A minimal text/calendar reader for the first event of an invitation part. */
export function parseCalendarInvite(ics: string): CalendarInvite | null {
  const unfolded = ics.slice(0, 200_000).replace(/\r?\n[ \t]/g, "");
  const event = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/.exec(unfolded)?.[1];
  if (!event) return null;
  const field = (source: string, name: string) => new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, "mi").exec(source)?.[1]?.trim() ?? null;
  const time = (name: string) => {
    const line = new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, "mi").exec(event);
    if (!line) return null;
    const zone = /TZID=([^;:]+)/i.exec(line[1])?.[1];
    const value = line[2].trim();
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
    if (!match) return value;
    const [, y, mo, d, h, mi, s, z] = match;
    if (!h) return `${y}-${mo}-${d}`;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : zone ? `[${zone}]` : ""}`;
  };
  const attendees = [...event.matchAll(/^ATTENDEE[^:\n]*:mailto:(.*)$/gim)].map((match) => normalizeEmail(match[1])).slice(0, 200);
  const sequence = field(event, "SEQUENCE");
  return {
    method: field(unfolded, "METHOD"),
    uid: field(event, "UID"),
    summary: field(event, "SUMMARY")?.replace(/\\,/g, ",").replace(/\\n/gi, " ") ?? null,
    start: time("DTSTART"),
    end: time("DTEND"),
    status: field(event, "STATUS"),
    sequence: sequence && /^\d+$/.test(sequence) ? Number(sequence) : null,
    organizer: (/^ORGANIZER[^:\n]*:mailto:(.*)$/im.exec(event)?.[1] ?? null)?.trim() ?? null,
    attendees,
  };
}
const BULK_LABELS: Record<string, string> = { CATEGORY_PROMOTIONS: "promotions", CATEGORY_SOCIAL: "social", CATEGORY_FORUMS: "forums" };
/** Parse a `gmail.read_message` result into a bounded, typed message. */
export function parseGmailMessage(raw: unknown, options: { maxText?: number } = {}): MailMessage {
  const message = rawMessage.parse(raw);
  const payload = (message.payload ?? {}) as Part;
  const maxText = options.maxText ?? 64_000;
  let plain = "", html = "", invite: CalendarInvite | null = null;
  const attachments: MailAttachment[] = [];
  let visited = 0;
  const walk = (part: Part, depth: number) => {
    if (depth > 30 || ++visited > 2000) return;
    const type = (part.mimeType ?? "").toLowerCase();
    const disposition = (header(part, "Content-Disposition") ?? "").toLowerCase();
    if (part.filename || disposition.startsWith("attachment") || part.body?.attachmentId) {
      if (part.filename || part.body?.attachmentId)
        attachments.push({ attachmentId: part.body?.attachmentId ?? null, filename: (part.filename || "attachment").slice(0, 300), mimeType: type || "application/octet-stream", size: part.body?.size ?? 0, partId: part.partId ?? null });
      if (type === "text/calendar" && part.body?.data && !invite) invite = parseCalendarInvite(bodyText(part));
      return;
    }
    if (type === "text/plain" && !plain) plain = bodyText(part);
    else if (type === "text/html" && !html) html = bodyText(part);
    else if (type === "text/calendar" && !invite) invite = parseCalendarInvite(bodyText(part));
    for (const child of part.parts ?? []) walk(child, depth + 1);
  };
  walk(payload, 0);
  const fromHtml = !plain.trim() && !!html;
  const full = (fromHtml ? htmlToText(html) : plain).replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  const text = full.length > maxText ? full.slice(0, maxText) : full;
  const labelIds = message.labelIds ?? [];
  const from = parseAddressList(header(payload, "From"))[0] ?? null;
  const listId = header(payload, "List-Id");
  const precedence = header(payload, "Precedence")?.toLowerCase() ?? null;
  const autoSubmitted = header(payload, "Auto-Submitted")?.toLowerCase() ?? null;
  const bulkReasons: string[] = [];
  if (listId) bulkReasons.push("mailing list");
  if (header(payload, "List-Unsubscribe")) bulkReasons.push("unsubscribe link");
  if (precedence && ["bulk", "list", "junk"].includes(precedence)) bulkReasons.push(`precedence ${precedence}`);
  if (autoSubmitted && autoSubmitted !== "no") bulkReasons.push("automated");
  if (from && isNoReply(from.address)) bulkReasons.push("no-reply sender");
  for (const label of labelIds) if (BULK_LABELS[label]) bulkReasons.push(BULK_LABELS[label]);
  const subject = decodeMimeWords(header(payload, "Subject") ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const internal = Number(message.internalDate);
  const receivedAt = Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : (() => {
    const parsed = Date.parse(header(payload, "Date") ?? "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso();
  })();
  const references = (header(payload, "References") ?? "").match(/<[^<>\s]+>/g)?.slice(-50) ?? [];
  const parsed: Omit<MailMessage, "digest"> = {
    id: message.id,
    threadId: message.threadId ?? message.id,
    historyId: message.historyId ?? null,
    receivedAt,
    labelIds,
    subject,
    from,
    to: parseAddressList(header(payload, "To")),
    cc: parseAddressList(header(payload, "Cc")),
    bcc: parseAddressList(header(payload, "Bcc")),
    replyTo: parseAddressList(header(payload, "Reply-To")),
    dateHeader: header(payload, "Date"),
    messageId: header(payload, "Message-ID") ?? header(payload, "Message-Id"),
    inReplyTo: header(payload, "In-Reply-To"),
    references,
    listId,
    sent: labelIds.includes("SENT"),
    draft: labelIds.includes("DRAFT"),
    discarded: labelIds.includes("TRASH") || labelIds.includes("SPAM"),
    bulkReasons,
    text,
    textTruncated: full.length > maxText,
    fromHtml,
    attachments: attachments.slice(0, 50),
    invite,
    snippet: decodeMimeWords(message.snippet ?? "").slice(0, 500),
  };
  return { ...parsed, digest: sha256(JSON.stringify([parsed.id, parsed.subject, parsed.from?.normalized, parsed.to.map((a) => a.normalized), parsed.text, parsed.attachments.map((a) => [a.filename, a.size])])) };
}
/** Headers from `gmail.get_message` metadata, for a cheap relevance check before reading a body. */
export interface MailHeaders { id: string; threadId: string; labelIds: string[]; subject: string; from: MailAddress | null; to: MailAddress[]; cc: MailAddress[]; snippet: string; listId: string | null }
function parseMetadata(raw: unknown): MailHeaders {
  const value = z.object({ id: z.string(), threadId: z.string().optional(), labelIds: z.array(z.string()).optional(), snippet: z.string().optional(), headers: z.record(z.string(), z.string()).optional() }).passthrough().parse(raw);
  const headers = value.headers ?? {};
  return {
    id: value.id, threadId: value.threadId ?? value.id, labelIds: value.labelIds ?? [], subject: decodeMimeWords(headers.Subject ?? ""),
    from: parseAddressList(headers.From)[0] ?? null, to: parseAddressList(headers.To), cc: parseAddressList(headers.Cc), snippet: value.snippet ?? "",
    listId: null,
  };
}

// ─── Gmail sync ──────────────────────────────────────────────────────────────

export const mailCheckpointSchema = z.object({
  version: z.literal(1),
  emailAddress: z.string().max(320).nullable(),
  windowDays: z.number().int().min(1).max(3650),
  windowStart: z.string(),
  backfill: z.object({ pageToken: z.string().max(4000).nullable(), pages: z.number().int().min(0), complete: z.boolean(), completedAt: z.string().nullable(), oldestAt: z.string().nullable() }).strict(),
  history: z.object({ historyId: z.string().max(128).nullable(), pageToken: z.string().max(4000).nullable(), checkedAt: z.string().nullable() }).strict(),
  lane: z.enum(["history", "backfill"]),
  rescans: z.number().int().min(0),
  lastSuccessAt: z.string().nullable(),
}).strict();
export type MailCheckpoint = z.infer<typeof mailCheckpointSchema>;
export interface MailStepResult {
  checkpoint: MailCheckpoint;
  /** More work is ready now: an unfinished page, backfill or history page. */
  more: boolean;
  lane: "profile" | "history" | "backfill";
  read: number;
  skipped: number;
  removed: number;
  /** The step stopped at a record boundary because of the body or time budget. */
  yielded: boolean;
}
export interface MailSyncOptions {
  invocation: Capable;
  account: string;
  binding: string;
  checkpoint: MailCheckpoint | null;
  /** History window for the initial and recovery scans. */
  windowDays: number;
  /** A Gmail search selecting relevant mail for backfill, such as `in:sent OR from:me`. Combined with the window. */
  query: string;
  /** Absolute deadline (epoch ms). Stops at a record boundary before it. */
  deadline: number;
  now?: () => Date;
  maxBodies?: number;
  maxMetadata?: number;
  pageSize?: number;
  /** True when this message already has an outcome. Seen messages are never read again. */
  seen(messageId: string): boolean;
  /** Optional cheap header check for incremental mail before reading a body. */
  relevant?(headers: MailHeaders): boolean;
  /** Persist one message. Called once per new message, in order. */
  ingest(message: MailMessage): void | Promise<void>;
  /** Remember an irrelevant message so it is never read again. */
  skip(messageId: string, threadId: string): void;
  /** The message was deleted upstream: mark its evidence unavailable, never invent other changes. */
  removed(messageId: string): void;
  /** Labels changed, such as moving to Trash. */
  relabeled?(messageId: string, labelIds: string[], added: boolean): void;
}
function windowStartFor(days: number, now: Date) {
  return new Date(now.getTime() - days * 864e5).toISOString();
}
export function newMailCheckpoint(windowDays: number, now = new Date()): MailCheckpoint {
  return { version: 1, emailAddress: null, windowDays, windowStart: windowStartFor(windowDays, now), backfill: { pageToken: null, pages: 0, complete: false, completedAt: null, oldestAt: null }, history: { historyId: null, pageToken: null, checkedAt: null }, lane: "backfill", rescans: 0, lastSuccessAt: null };
}
/** Widen or narrow the window. A wider window resumes backfill for the older range only. */
export function changeMailWindow(checkpoint: MailCheckpoint, windowDays: number, now = new Date()): MailCheckpoint {
  const windowStart = windowStartFor(windowDays, now);
  if (windowDays <= checkpoint.windowDays) return { ...checkpoint, windowDays, windowStart };
  return { ...checkpoint, windowDays, windowStart, backfill: { ...checkpoint.backfill, pageToken: null, pages: 0, complete: false, completedAt: null } };
}
/** Coverage for the Sources screen: what range was checked and whether it is partial. */
export function mailCoverage(checkpoint: MailCheckpoint | null) {
  if (!checkpoint) return { from: null, to: null, partial: true, lastSuccessAt: null, rescans: 0 };
  return {
    from: checkpoint.backfill.complete ? checkpoint.windowStart : checkpoint.backfill.oldestAt ?? null,
    to: checkpoint.lastSuccessAt,
    partial: !checkpoint.backfill.complete,
    lastSuccessAt: checkpoint.lastSuccessAt,
    rescans: checkpoint.rescans,
  };
}
const searchResult = z.object({ messages: z.array(z.object({ id: z.string(), threadId: z.string().optional() })).max(500), nextPageToken: z.string().optional() }).passthrough();
const historyResult = z.object({
  historyId: z.string(), nextPageToken: z.string().optional(),
  history: z.array(z.object({
    messagesAdded: z.array(z.object({ message: z.object({ id: z.string(), threadId: z.string().optional(), labelIds: z.array(z.string()).optional() }).passthrough() })).optional(),
    messagesDeleted: z.array(z.object({ message: z.object({ id: z.string() }).passthrough() })).optional(),
    labelsAdded: z.array(z.object({ message: z.object({ id: z.string() }).passthrough(), labelIds: z.array(z.string()).optional() })).optional(),
    labelsRemoved: z.array(z.object({ message: z.object({ id: z.string() }).passthrough(), labelIds: z.array(z.string()).optional() })).optional(),
  }).passthrough()).optional(),
}).passthrough();
const unixSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);
/**
 * One bounded Gmail step. While the initial backfill runs, steps alternate
 * between current changes and older pages, so new mail is never stuck behind
 * history. An expired history checkpoint restarts a bounded rescan of the
 * configured window, never the whole mailbox.
 */
export async function gmailSyncStep(options: MailSyncOptions): Promise<MailStepResult> {
  const now = options.now ?? (() => new Date());
  const maxBodies = options.maxBodies ?? 10, maxMetadata = options.maxMetadata ?? 50, pageSize = options.pageSize ?? 50;
  const target = { binding: options.binding, account: options.account };
  const call = <T>(name: string, input: unknown, schema: z.ZodType<T>) => options.invocation.capability(name, input, target).then((value) => schema.parse(value));
  let checkpoint = options.checkpoint ? mailCheckpointSchema.parse(options.checkpoint) : newMailCheckpoint(options.windowDays, now());
  const result = { read: 0, skipped: 0, removed: 0, yielded: false };
  const budgetLeft = () => !options.invocation.signal.aborted && Date.now() < options.deadline;

  // Capture the mailbox position before scanning, so mail that arrives during the scan is caught by history.
  if (!checkpoint.history.historyId) {
    const profile = await call("gmail.get_profile", {}, z.object({ emailAddress: z.string(), historyId: z.string() }).passthrough());
    checkpoint = { ...checkpoint, emailAddress: profile.emailAddress, history: { historyId: profile.historyId, pageToken: null, checkedAt: null } };
    return { checkpoint, more: true, lane: "profile", ...result };
  }
  const lane: "history" | "backfill" = checkpoint.backfill.complete ? "history" : checkpoint.lane === "history" ? "backfill" : "history";
  let bodies = 0, metadata = 0;

  const process = async (id: string, threadId: string, mode: "full" | "headers") => {
    if (options.seen(id)) return true;
    if (mode === "headers" && options.relevant) {
      if (metadata >= maxMetadata) return false;
      metadata++;
      const headers = parseMetadata(await options.invocation.capability("gmail.get_message", { messageId: id, format: "metadata" }, target));
      if (!options.relevant(headers)) { options.skip(id, threadId); result.skipped++; return true; }
    }
    if (bodies >= maxBodies || !budgetLeft()) return false;
    bodies++;
    const message = parseGmailMessage(await options.invocation.capability("gmail.read_message", { messageId: id }, target));
    await options.ingest(message);
    result.read++;
    if (!checkpoint.backfill.oldestAt || message.receivedAt < checkpoint.backfill.oldestAt)
      checkpoint = { ...checkpoint, backfill: { ...checkpoint.backfill, oldestAt: message.receivedAt } };
    return true;
  };

  if (lane === "history") {
    let page: z.infer<typeof historyResult>;
    try {
      page = await call("gmail.list_history", {
        startHistoryId: checkpoint.history.historyId,
        historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
        maxResults: 100,
        ...(checkpoint.history.pageToken ? { pageToken: checkpoint.history.pageToken } : {}),
      }, historyResult);
    } catch (error) {
      if ((error as AppError)?.code === "not_found") {
        // History expired: rescan the configured window from a fresh checkpoint.
        const fresh = newMailCheckpoint(checkpoint.windowDays, now());
        return { checkpoint: { ...fresh, emailAddress: checkpoint.emailAddress, rescans: checkpoint.rescans + 1, lastSuccessAt: checkpoint.lastSuccessAt }, more: true, lane, ...result };
      }
      throw error;
    }
    let finished = true;
    for (const record of page.history ?? []) {
      for (const deleted of record.messagesDeleted ?? []) { options.removed(deleted.message.id); result.removed++; }
      for (const change of record.labelsAdded ?? []) {
        options.relabeled?.(change.message.id, change.labelIds ?? [], true);
        if ((change.labelIds ?? []).some((label) => label === "TRASH" || label === "SPAM")) { options.removed(change.message.id); result.removed++; }
      }
      for (const change of record.labelsRemoved ?? []) options.relabeled?.(change.message.id, change.labelIds ?? [], false);
      for (const added of record.messagesAdded ?? []) {
        if ((added.message.labelIds ?? []).some((label) => label === "DRAFT" || label === "SPAM" || label === "TRASH")) continue;
        if (!(await process(added.message.id, added.message.threadId ?? added.message.id, "headers"))) { finished = false; break; }
      }
      if (!finished) break;
    }
    if (!finished) {
      result.yielded = true;
      return { checkpoint: { ...checkpoint, lane }, more: true, lane, ...result };
    }
    const last = !page.nextPageToken;
    const at = now().toISOString();
    checkpoint = {
      ...checkpoint,
      lane,
      history: last ? { historyId: page.historyId, pageToken: null, checkedAt: at } : { ...checkpoint.history, pageToken: page.nextPageToken!, checkedAt: at },
      lastSuccessAt: at,
    };
    return { checkpoint, more: !last || !checkpoint.backfill.complete, lane, ...result };
  }

  const query = `(${options.query}) after:${unixSeconds(checkpoint.windowStart)}`;
  const page = await call("gmail.search_messages", { query, maxResults: pageSize, ...(checkpoint.backfill.pageToken ? { pageToken: checkpoint.backfill.pageToken } : {}) }, searchResult);
  for (const message of page.messages) {
    if (!(await process(message.id, message.threadId ?? message.id, "full"))) {
      result.yielded = true;
      return { checkpoint: { ...checkpoint, lane }, more: true, lane, ...result };
    }
  }
  const at = now().toISOString();
  const complete = !page.nextPageToken;
  checkpoint = {
    ...checkpoint,
    lane,
    backfill: { ...checkpoint.backfill, pageToken: page.nextPageToken ?? null, pages: checkpoint.backfill.pages + 1, complete, completedAt: complete ? at : null },
    lastSuccessAt: at,
  };
  return { checkpoint, more: true, lane, ...result };
}

// ─── Calendar sync ───────────────────────────────────────────────────────────

export const calendarCheckpointSchema = z.object({
  version: z.literal(1),
  calendarId: z.string().min(1).max(1024),
  pastDays: z.number().int().min(0).max(3650),
  futureDays: z.number().int().min(1).max(3650),
  window: z.object({ from: z.string(), to: z.string() }).strict(),
  phase: z.enum(["full", "incremental"]),
  pageToken: z.string().max(4000).nullable(),
  syncToken: z.string().max(4000).nullable(),
  completedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  resets: z.number().int().min(0),
  timeZone: z.string().max(100).nullable(),
}).strict();
export type CalendarCheckpoint = z.infer<typeof calendarCheckpointSchema>;
export const calendarEventSchema = z.object({
  id: z.string(),
  iCalUID: z.string().optional(),
  summary: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
  location: z.string().optional(),
  joinUrl: z.string().optional(),
  responseStatus: z.string().optional(),
  allDay: z.boolean(),
  startTimeZone: z.string().optional(),
  endTimeZone: z.string().optional(),
  recurringEventId: z.string().optional(),
  originalStartTime: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).passthrough().optional(),
  organizer: z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean() }).passthrough().optional(),
  attendees: z.array(z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean(), organizer: z.boolean(), resource: z.boolean(), optional: z.boolean(), responseStatus: z.string().optional() }).passthrough()),
  attendeesOmitted: z.boolean(),
  description: z.string().optional(),
  eventType: z.string().optional(),
  updated: z.string().optional(),
  created: z.string().optional(),
  cancelled: z.boolean(),
}).passthrough();
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
const syncPage = z.object({ events: z.array(calendarEventSchema), nextPageToken: z.string().optional(), nextSyncToken: z.string().optional(), calendarTimeZone: z.string().optional() }).passthrough();
/** A stable key for one occurrence: recurring instances differ by their original start. */
export function occurrenceKey(event: Pick<CalendarEvent, "id" | "recurringEventId" | "originalStartTime">): string {
  if (!event.recurringEventId) return event.id;
  return `${event.recurringEventId}@${event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? event.id}`;
}
export function newCalendarCheckpoint(calendarId: string, pastDays: number, futureDays: number, now = new Date()): CalendarCheckpoint {
  return {
    version: 1, calendarId, pastDays, futureDays,
    window: { from: new Date(now.getTime() - pastDays * 864e5).toISOString(), to: new Date(now.getTime() + futureDays * 864e5).toISOString() },
    phase: "full", pageToken: null, syncToken: null, completedAt: null, lastSuccessAt: null, resets: 0, timeZone: null,
  };
}
export function calendarCoverage(checkpoint: CalendarCheckpoint | null) {
  if (!checkpoint) return { from: null, to: null, partial: true, lastSuccessAt: null, resets: 0 };
  return { from: checkpoint.window.from, to: checkpoint.window.to, partial: !checkpoint.completedAt, lastSuccessAt: checkpoint.lastSuccessAt, resets: checkpoint.resets };
}
export interface CalendarStepResult { checkpoint: CalendarCheckpoint; more: boolean; events: number; cancelled: number }
/**
 * One bounded Calendar page. The full scan covers the window, then the sync
 * token returns only changes. A cancelled event is reported, not dropped, so
 * the app can keep its history. An expired token (410) restarts the window.
 * When half the future window has passed, a fresh full scan moves it forward.
 */
export async function calendarSyncStep(options: {
  invocation: Capable;
  account: string;
  binding: string;
  checkpoint: CalendarCheckpoint;
  now?: () => Date;
  pageSize?: number;
  ingest(event: CalendarEvent): void | Promise<void>;
}): Promise<CalendarStepResult> {
  const now = options.now ?? (() => new Date());
  let checkpoint = calendarCheckpointSchema.parse(options.checkpoint);
  const halfway = Date.parse(checkpoint.window.to) - (checkpoint.futureDays * 864e5) / 2;
  if (checkpoint.phase === "incremental" && now().getTime() > halfway)
    checkpoint = { ...newCalendarCheckpoint(checkpoint.calendarId, checkpoint.pastDays, checkpoint.futureDays, now()), resets: checkpoint.resets, lastSuccessAt: checkpoint.lastSuccessAt, timeZone: checkpoint.timeZone };
  const input = checkpoint.phase === "full"
    ? { calendarId: checkpoint.calendarId, timeMin: checkpoint.window.from, timeMax: checkpoint.window.to, maxResults: options.pageSize ?? 250, ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}) }
    : { calendarId: checkpoint.calendarId, syncToken: checkpoint.syncToken!, maxResults: options.pageSize ?? 250, ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}) };
  let page: z.infer<typeof syncPage>;
  try {
    page = syncPage.parse(await options.invocation.capability("google_calendar.sync_events", input, { binding: options.binding, account: options.account }));
  } catch (error) {
    if ((error as AppError)?.code === "not_found" && checkpoint.phase === "incremental") {
      const fresh = newCalendarCheckpoint(checkpoint.calendarId, checkpoint.pastDays, checkpoint.futureDays, now());
      return { checkpoint: { ...fresh, resets: checkpoint.resets + 1, lastSuccessAt: checkpoint.lastSuccessAt, timeZone: checkpoint.timeZone }, more: true, events: 0, cancelled: 0 };
    }
    throw error;
  }
  let cancelled = 0;
  for (const event of page.events) {
    if (event.cancelled) cancelled++;
    await options.ingest(event);
  }
  const at = now().toISOString();
  const last = !page.nextPageToken;
  checkpoint = {
    ...checkpoint,
    timeZone: page.calendarTimeZone ?? checkpoint.timeZone,
    pageToken: last ? null : page.nextPageToken!,
    syncToken: last ? page.nextSyncToken ?? checkpoint.syncToken : checkpoint.syncToken,
    phase: last && (page.nextSyncToken || checkpoint.syncToken) ? "incremental" : checkpoint.phase,
    completedAt: last ? (checkpoint.completedAt ?? at) : checkpoint.completedAt,
    lastSuccessAt: at,
  };
  return { checkpoint, more: !last, events: page.events.length, cancelled };
}
export async function listCalendars(invocation: Capable, account: string, binding: string) {
  const result = z.object({ calendars: z.array(z.object({ id: z.string(), summary: z.string().optional(), primary: z.boolean().optional(), accessRole: z.string().optional(), hidden: z.boolean().optional() }).passthrough()) }).passthrough()
    .parse(await invocation.capability("google_calendar.list_calendars", {}, { binding, account }));
  return result.calendars.filter((calendar) => !calendar.hidden).map((calendar) => ({ id: calendar.id, summary: calendar.summary ?? calendar.id, primary: !!calendar.primary, accessRole: calendar.accessRole ?? null }));
}

// ─── Source accounts and the message index ───────────────────────────────────

export type SourceKind = "mail" | "calendar";
export type SourceStatus = "not_started" | "importing" | "ready" | "paused" | "reconnect" | "error";
export interface SourceAccount {
  account: string;
  kind: SourceKind;
  createdAt: string;
  updatedAt: string;
  label: string | null;
  historyDays: number;
  /** Mail: Gmail checkpoint. Calendar: map of calendar ID to checkpoint. */
  checkpoint: unknown;
  /** Calendars the owner chose for this account. */
  calendars: string[];
  paused: boolean;
  status: SourceStatus;
  lastError: string | null;
  lastSuccessAt: string | null;
}
const accountRow = (row: Record<string, unknown>): SourceAccount => ({
  account: String(row.account),
  kind: String(row.kind) as SourceKind,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  label: row.label === null ? null : String(row.label),
  historyDays: Number(row.history_days),
  checkpoint: row.checkpoint === null ? null : JSON.parse(String(row.checkpoint)),
  calendars: JSON.parse(String(row.calendars)),
  paused: Number(row.paused) === 1,
  status: String(row.status) as SourceStatus,
  lastError: row.last_error === null ? null : String(row.last_error),
  lastSuccessAt: row.last_success_at === null ? null : String(row.last_success_at),
});
/**
 * Per-account setup remembered by the installed instance: chosen history range,
 * calendars, pause state and the committed checkpoint. Saved with the records
 * it describes, so a restart resumes from the last committed page.
 */
export function createAccountStore(db: SqlDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_source_accounts (
    account TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('mail','calendar')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, label TEXT, history_days INTEGER NOT NULL,
    checkpoint TEXT, calendars TEXT NOT NULL, paused INTEGER NOT NULL, status TEXT NOT NULL,
    last_error TEXT, last_success_at TEXT, PRIMARY KEY (account, kind));`);
  const get = (account: string, kind: SourceKind) => {
    const row = db.prepare("SELECT * FROM app_source_accounts WHERE account = ? AND kind = ?").get(account, kind);
    return row ? accountRow(row) : null;
  };
  return {
    get,
    list(): SourceAccount[] {
      return db.prepare("SELECT * FROM app_source_accounts ORDER BY kind, created_at LIMIT 100").all().map(accountRow);
    },
    /** Remember setup for an account. Policy values are supplied by the app. */
    setup(input: { account: string; kind: SourceKind; historyDays: number; label?: string | null; calendars?: string[] }): SourceAccount {
      const time = nowIso(), existing = get(input.account, input.kind);
      if (existing) {
        db.prepare("UPDATE app_source_accounts SET history_days = ?, label = COALESCE(?, label), calendars = ?, updated_at = ? WHERE account = ? AND kind = ?")
          .run(input.historyDays, input.label ?? null, JSON.stringify(input.calendars ?? existing.calendars), time, input.account, input.kind);
      } else {
        db.prepare("INSERT INTO app_source_accounts (account, kind, created_at, updated_at, label, history_days, checkpoint, calendars, paused, status, last_error, last_success_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 'not_started', NULL, NULL)")
          .run(input.account, input.kind, time, time, input.label ?? null, input.historyDays, JSON.stringify(input.calendars ?? []));
      }
      return get(input.account, input.kind)!;
    },
    /** Commit a checkpoint with its status. Call inside the same transaction as the records it covers. */
    commit(account: string, kind: SourceKind, checkpoint: unknown, status: SourceStatus, label?: string | null) {
      const time = nowIso();
      db.prepare("UPDATE app_source_accounts SET checkpoint = ?, status = CASE WHEN paused = 1 THEN 'paused' ELSE ? END, last_error = NULL, last_success_at = ?, label = COALESCE(?, label), updated_at = ? WHERE account = ? AND kind = ?")
        .run(JSON.stringify(checkpoint), status, time, label ?? null, time, account, kind);
    },
    failed(account: string, kind: SourceKind, status: "error" | "reconnect", reason: string) {
      db.prepare("UPDATE app_source_accounts SET status = CASE WHEN paused = 1 THEN 'paused' ELSE ? END, last_error = ?, updated_at = ? WHERE account = ? AND kind = ?").run(status, reason.slice(0, 300), nowIso(), account, kind);
    },
    pause(account: string, paused: boolean) {
      db.prepare("UPDATE app_source_accounts SET paused = ?, status = CASE WHEN ? = 1 THEN 'paused' WHEN checkpoint IS NULL THEN 'not_started' ELSE 'ready' END, updated_at = ? WHERE account = ?").run(paused ? 1 : 0, paused ? 1 : 0, nowIso(), account);
    },
    remove(account: string) {
      db.prepare("DELETE FROM app_source_accounts WHERE account = ?").run(account);
    },
  };
}
export type AccountStore = ReturnType<typeof createAccountStore>;

/**
 * The provider identity of every message an account has delivered, with its
 * outcome. It makes repeated delivery idempotent and lets a page be re-read
 * after an interruption without reading bodies again.
 */
export function createMailIndex(db: SqlDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_mail_messages (
    account TEXT NOT NULL, message_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    thread_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('kept','skipped','removed')),
    received_at TEXT, digest TEXT, PRIMARY KEY (account, message_id));
  CREATE INDEX IF NOT EXISTS app_mail_messages_thread ON app_mail_messages (account, thread_id);`);
  return {
    seen(account: string, messageId: string): boolean {
      return !!db.prepare("SELECT 1 FROM app_mail_messages WHERE account = ? AND message_id = ?").get(account, messageId);
    },
    outcome(account: string, messageId: string): "kept" | "skipped" | "removed" | null {
      const row = db.prepare("SELECT outcome FROM app_mail_messages WHERE account = ? AND message_id = ?").get(account, messageId);
      return row ? (String(row.outcome) as "kept" | "skipped" | "removed") : null;
    },
    record(account: string, messageId: string, threadId: string, outcome: "kept" | "skipped" | "removed", details: { receivedAt?: string | null; digest?: string | null } = {}) {
      const time = nowIso();
      db.prepare(
        "INSERT INTO app_mail_messages (account, message_id, created_at, updated_at, thread_id, outcome, received_at, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account, message_id) DO UPDATE SET outcome = excluded.outcome, updated_at = excluded.updated_at, received_at = COALESCE(excluded.received_at, received_at), digest = COALESCE(excluded.digest, digest)",
      ).run(account, messageId, time, time, threadId, outcome, details.receivedAt ?? null, details.digest ?? null);
    },
    counts(account: string) {
      const result = { kept: 0, skipped: 0, removed: 0 };
      for (const row of db.prepare("SELECT outcome, COUNT(*) AS count FROM app_mail_messages WHERE account = ? GROUP BY outcome").all(account)) result[String(row.outcome) as keyof typeof result] = Number(row.count);
      return result;
    },
    forget(account: string) {
      transaction(db, () => db.prepare("DELETE FROM app_mail_messages WHERE account = ?").run(account));
    },
  };
}
export type MailIndex = ReturnType<typeof createMailIndex>;
