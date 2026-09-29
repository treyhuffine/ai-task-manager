/**
 * Plain-language views of a connector approval: what the approval card shows the human (which
 * account, which action, and what this particular call touches), and the note the asking agent
 * receives once the human decides. Pure, no DB or runtime, so approval-events.ts can feed it the
 * toolkit metadata and an optional looked-up subject, and the shapes stay unit-testable.
 *
 * The views are persisted on the transcript rows (`chat_events.tool_input`), so the card still
 * reads correctly after the in-memory pending is gone (resolved, or lost to a restart).
 */
import type { ApprovalDecision } from './approval';

/** How an approval left the queue: the human's decision, or `settled` when the call ran anyway. */
export type ApprovalOutcome = ApprovalDecision | 'settled';

export interface ApprovalDetail {
  label: string;
  value: string;
}

/** `tool_input` of an `approval_request` chat event: one paused call. */
export interface ApprovalRequestView {
  approvalId: string;
  actionId: string;
  /** The tool name the agent called, e.g. `google_calendar__delete_event`. */
  toolName: string;
  /** "Delete event" */
  actionLabel: string;
  /** "Google Calendar" */
  toolkitName: string;
  providerId: string;
  connectionId: string;
  /** The account the call acts as (email, else label). */
  account: string | null;
  risk: string;
  /** Pushes content out to other people (send, post, share), see write-policy.ts. */
  outward: boolean;
  /** One line naming what this call touches, e.g. "Team standup · Tue, Sep 30, 9:00 AM". */
  summary: string;
  /** Salient arguments, for the expanded card. */
  details: ApprovalDetail[];
}

/** `tool_input` of an `approval_response` chat event: one decision over a group of calls. */
export interface ApprovalResponseView {
  outcome: ApprovalOutcome;
  approvalIds: string[];
  actionId: string;
  toolName: string;
  actionLabel: string;
  toolkitName: string;
  account: string | null;
}

/** The MCP tool name the engine projects an action as (mirrors `toToolName` in the engine). */
export function toolNameFor(actionId: string): string {
  return actionId.replace(/[^a-zA-Z0-9_-]/g, '__');
}

function words(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

function sentenceCase(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/** "google_calendar.delete_event" → "Delete event"; "mcp.linear.createIssue" → "Create issue". */
export function actionLabel(actionId: string): string {
  const method = actionId.slice(actionId.lastIndexOf('.') + 1);
  return sentenceCase(words(method)) || actionId;
}

/** "eventId" → "Event id", "chat_id" → "Chat id". */
function keyLabel(key: string): string {
  return sentenceCase(words(key)) || key;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "2026-09-30T09:00:00-04:00" → "Wed, Sep 30, 9:00 AM" (host-local, the user's own machine). */
export function formatWhen(value: string): string {
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (!DATE_TIME.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    return DATE_ONLY.test(value) || DATE_TIME.test(value) ? formatWhen(value) : truncate(value, 140);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.every((v) => typeof v !== 'object' || v === null)
      ? truncate(value.map(String).join(', '), 140)
      : `${value.length} items`;
  }
  try {
    return truncate(JSON.stringify(value), 140);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const RECIPIENT_KEYS = ['to', 'recipient', 'recipients', 'email', 'channel', 'channelId', 'channel_id', 'chatId', 'chat_id', 'phone', 'userId', 'user'];
const TITLE_KEYS = ['subject', 'summary', 'title', 'name', 'fileName', 'filename'];
const TEXT_KEYS = ['text', 'body', 'message', 'content', 'description', 'caption'];
const WHEN_KEYS = ['start', 'startTime', 'start_time', 'date', 'due', 'dueDate', 'due_date'];
const SALIENT = [...RECIPIENT_KEYS, ...TITLE_KEYS, ...WHEN_KEYS, ...TEXT_KEYS];
const MAX_DETAILS = 8;

function firstValue(input: Record<string, unknown>, keys: readonly string[]): [string, string] | null {
  for (const key of keys) {
    const value = formatValue(input[key]);
    if (value) return [key, value];
  }
  return null;
}

/**
 * A one-line summary plus the salient arguments of a paused call. `subject` is what a sibling
 * read resolved the call's target to (the event's title and time for a calendar delete, whose
 * input is only an id). When present it leads, because an id alone tells the human nothing.
 */
export function summarizeCall(preview: unknown, subject?: string | null): { summary: string; details: ApprovalDetail[] } {
  const input = asRecord(preview) ?? {};
  const keys = Object.keys(input).filter((k) => k !== 'account');
  const ordered = [...SALIENT.filter((k) => keys.includes(k)), ...keys.filter((k) => !SALIENT.includes(k))];
  const details: ApprovalDetail[] = [];
  for (const key of ordered) {
    const value = formatValue(input[key]);
    if (value) details.push({ label: keyLabel(key), value });
    if (details.length >= MAX_DETAILS) break;
  }

  if (subject?.trim()) return { summary: truncate(subject, 160), details };

  const parts: string[] = [];
  const recipient = firstValue(input, RECIPIENT_KEYS);
  if (recipient) parts.push(`To ${recipient[1]}`);
  const title = firstValue(input, TITLE_KEYS);
  const text = title ? null : firstValue(input, TEXT_KEYS);
  if (title) parts.push(title[1]);
  else if (text) parts.push(`“${truncate(text[1], 60)}”`);
  const when = firstValue(input, WHEN_KEYS);
  if (when) parts.push(when[1]);
  if (parts.length === 0) {
    // The last id names the target: `{ calendarId, eventId }` is about the event, not the calendar.
    const idKey = keys.filter((k) => /(Id|_id|ID)$/.test(k) || k === 'id').at(-1);
    const idValue = idKey ? formatValue(input[idKey]) : null;
    if (idKey && idValue) parts.push(`${keyLabel(idKey)} ${idValue}`);
    else if (details[0]) parts.push(`${details[0].label}: ${details[0].value}`);
    else parts.push('No arguments');
  }
  return { summary: truncate(parts.join(' · '), 160), details };
}

/**
 * The human name for what a read returned, e.g. a calendar event → "Team standup · Wed, Sep 30,
 * 9:00 AM", a message → "Quarterly numbers · from ana@example.com". Null when nothing is nameable.
 */
export function subjectFromRecord(record: unknown): string | null {
  const r = unwrapMcpResult(asRecord(record));
  if (!r) return null;
  const pick = (key: string) => (typeof r[key] === 'string' && (r[key] as string).trim() ? (r[key] as string) : null);
  const title = pick('summary') ?? pick('title') ?? pick('subject') ?? pick('name');
  const start = pick('start');
  const from = pick('from');
  const parts = [title && truncate(title, 100), start && formatWhen(start), from && `from ${truncate(from, 60)}`].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length ? parts.join(' · ') : null;
}

/**
 * An ingested MCP tool returns `{ server, tool, isError, content: [{ type: 'text', text }] }`
 * (see the engine's mcp/ingest.ts). The record worth naming is the JSON inside the first text
 * part, or `structuredContent` when the server sends it. Anything else passes through.
 */
function unwrapMcpResult(r: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!r || !Array.isArray(r.content)) return r;
  if (r.isError === true) return null;
  const structured = asRecord(r.structuredContent);
  if (structured) return structured;
  const text = r.content.find(
    (part): part is { type: 'text'; text: string } =>
      !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string',
  )?.text;
  if (!text) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

const LOOKUP_VERBS = new Set(['delete', 'trash', 'untrash', 'cancel', 'archive', 'remove', 'restore', 'update']);

/**
 * The read action that names a destructive call's target: `google_calendar.delete_event` →
 * `google_calendar.get_event`, when the toolkit has one. `readActionIds` is the toolkit's
 * non-mutating action ids, so a lookup can never itself need approval.
 */
export function subjectLookupActionId(actionId: string, readActionIds: ReadonlySet<string>): string | null {
  const dot = actionId.lastIndexOf('.');
  if (dot <= 0) return null;
  const match = /^([a-z]+)_(.+)$/.exec(actionId.slice(dot + 1));
  if (!match || !LOOKUP_VERBS.has(match[1]!)) return null;
  const candidate = `${actionId.slice(0, dot)}.get_${match[2]}`;
  return readActionIds.has(candidate) ? candidate : null;
}

export interface NoteCall {
  toolName: string;
  account: string | null;
  preview: unknown;
}

const NOTE_MAX_CALLS = 25;

function compactArgs(preview: unknown): string {
  try {
    return truncate(JSON.stringify(preview ?? {}), 240);
  } catch {
    return '{}';
  }
}

/**
 * The message the asking agent receives after the human decides, so a waiting turn moves again:
 * retry on approval, stand down on denial. It lists each call's arguments so a partial decision
 * (3 of 8 approved) tells the agent exactly which calls to retry.
 */
export function approvalNote(decision: ApprovalDecision, calls: readonly NoteCall[], grantMinutes: number): string {
  const groups = new Map<string, NoteCall[]>();
  for (const call of calls) {
    const key = `${call.toolName}|${call.account ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  const blocks: string[] = [];
  for (const group of groups.values()) {
    const { toolName, account } = group[0]!;
    const n = group.length;
    const calls = n === 1 ? `your pending ${toolName} call` : `${n} pending ${toolName} calls`;
    const as = account ? ` (account ${account})` : '';
    const them = n === 1 ? 'it' : 'them';
    const sentence =
      decision === 'deny'
        ? `The user denied ${calls}${as}. Do not retry ${them}. Carry on without ${them}, or ask the user how to proceed.`
        : decision === 'always'
          ? `The user set ${toolName} to run without asking from now on and approved ${calls}${as}. Retry ${them} now with the same arguments.`
          : `The user approved ${calls}${as}. Retry ${n === 1 ? 'that exact call' : 'exactly those calls'} now with the same arguments. Each approval covers one call, once, for the next ${grantMinutes} minutes.`;
    const listed = group.slice(0, NOTE_MAX_CALLS).map((c) => `- ${compactArgs(c.preview)}`);
    if (n > NOTE_MAX_CALLS) listed.push(`- …and ${n - NOTE_MAX_CALLS} more`);
    blocks.push([sentence, ...listed].join('\n'));
  }
  return `[Connector approval, from the app on the user's behalf]\n\n${blocks.join('\n\n')}`;
}
