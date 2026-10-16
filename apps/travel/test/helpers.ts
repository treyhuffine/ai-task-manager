/**
 * Test harness: the real action definitions over a temporary data directory,
 * called with fake invocations and fake connector capabilities. All data is
 * fictional.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError, ContractValidator, type InvocationAccess } from "@ri/app-kit/contract";
import { generateContract, type AppInvocation } from "@ri/app-kit/sdk";
import { definition, initialize, instance, shutdown } from "../src/actions.js";

export const PACKAGE_DIGEST = "a".repeat(64);
const validator = new ContractValidator();
const contract = generateContract(definition);
const created: string[] = [];

export type Capability = (name: string, input: Record<string, unknown>, target: { binding?: string; account?: string } | undefined) => unknown | Promise<unknown>;
export interface Caller {
  principal: AppInvocation["principal"];
  audience: AppInvocation["audience"];
  access: InvocationAccess | null;
}
export const owner = (accounts: InvocationAccess["accounts"] = []): Caller => ({ principal: { kind: "owner-ui", id: "owner" }, audience: "user", access: { protocol: "ri-access-v1", actorId: "owner-ui:owner", scopeRef: null, accounts } });
export const chat = (id: string, scopeRef: string | null): Caller => ({ principal: { kind: "chat", id }, audience: "agent", access: { protocol: "ri-access-v1", actorId: `chat:${id}`, scopeRef, accounts: [] } });
export const job = (accounts: string[], id = "schedule-1"): Caller => ({ principal: { kind: "job", id }, audience: "schedule", access: { protocol: "ri-access-v1", actorId: `job:${id}`, scopeRef: null, accounts: accounts.flatMap((account) => [{ account, binding: "mail", actions: [], automatic: true }]) } });
export const fixture = (): Caller => ({ principal: { kind: "fixture", id: "preview", fixtureAudience: "user" }, audience: "user", access: { protocol: "ri-access-v1", actorId: "fixture:preview", scopeRef: null, accounts: [] } });
export const mailGrant = (account: string, automatic = false) => ({ account, binding: "mail", actions: ["gmail.search_messages", "gmail.read_message"], automatic });
export const calendarGrant = (account: string, automatic = false) => ({ account, binding: "calendar", actions: ["google_calendar.sync_events"], automatic });

export interface Harness {
  dir: string;
  instanceId: string;
  /** Set the clock for subsequent calls. */
  setNow(iso: string): void;
  call<T = any>(action: string, input: unknown, caller?: Caller, options?: { id?: string; capability?: Capability; signal?: AbortSignal }): Promise<T>;
  capability: Capability;
}

export async function harness(options: { now?: string; capability?: Capability } = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-travel-test-"));
  created.push(dir);
  const instanceId = randomUUID();
  let now = options.now ? new Date(options.now) : new Date("2026-10-15T12:00:00.000Z");
  await initialize({ dataDir: dir, cacheDir: dir, packageDigest: PACKAGE_DIGEST, contractDigest: "", contract, bindings: ["mail", "calendar"], instanceId }, { now: () => now });
  const harnessCapability: Capability = options.capability ?? (() => { throw new AppError("unsupported", "No capability in this test"); });
  const h: Harness = {
    dir, instanceId,
    setNow(iso) { now = new Date(iso); },
    capability: harnessCapability,
    async call(name, input, caller = owner(), callOptions = {}) {
      const action = definition.actions.find((item) => item.name === name);
      if (!action) throw new Error(`Unknown action ${name}`);
      const descriptor = contract.actions.find((item) => item.name === name)!;
      if (!action.audience.includes(caller.audience)) throw new AppError("forbidden", "This action is unavailable to this caller");
      validator.check(descriptor.inputSchema, input, `Invalid input for ${name}`);
      const parsed = action.input.parse(input);
      const capability = callOptions.capability ?? h.capability;
      const invocation: AppInvocation = {
        id: callOptions.id ?? randomUUID(), principal: caller.principal, audience: caller.audience, grantRevision: 0,
        deadline: Date.now() + descriptor.timeoutMs, packageDigest: PACKAGE_DIGEST, signal: callOptions.signal ?? new AbortController().signal,
        access: caller.access,
        capability: async (capabilityName, capabilityInput, target) => capability(capabilityName, capabilityInput as Record<string, unknown>, typeof target === "string" ? { binding: target } : target),
      };
      const result = await action.handler(parsed, invocation);
      validator.check(descriptor.outputSchema, result, `Invalid output for ${name}: ${JSON.stringify(result).slice(0, 400)}`);
      action.output.parse(result);
      return result as never;
    },
  };
  return h;
}

export function cleanup() {
  shutdown();
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}
export { instance };

// ─── Fake Gmail ─────────────────────────────────────────────────────────────

export interface FakeMail { id: string; threadId?: string; subject: string; from: string; to?: string; receivedAt: string; text?: string; html?: string; labelIds?: string[]; attachments?: { attachmentId: string; filename: string; mimeType: string; data: string }[]; ics?: string }
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
export function gmailMessage(mail: FakeMail) {
  const headers = [{ name: "From", value: mail.from }, { name: "To", value: mail.to ?? "alex.rivera@example.test" }, { name: "Subject", value: mail.subject }, { name: "Message-ID", value: `<${mail.id}@mail.example>` }];
  const parts: unknown[] = [];
  if (mail.text !== undefined) parts.push({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }], body: { data: b64(mail.text) } });
  if (mail.html !== undefined) parts.push({ mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: { data: b64(mail.html) } });
  if (mail.ics) parts.push({ mimeType: "text/calendar", body: { data: b64(mail.ics) } });
  for (const attachment of mail.attachments ?? []) parts.push({ mimeType: attachment.mimeType, filename: attachment.filename, body: { attachmentId: attachment.attachmentId, size: attachment.data.length } });
  return { id: mail.id, threadId: mail.threadId ?? `t-${mail.id}`, historyId: "1", internalDate: String(Date.parse(mail.receivedAt)), labelIds: mail.labelIds ?? ["INBOX"], snippet: (mail.text ?? "").slice(0, 120), payload: { mimeType: "multipart/mixed", headers, parts } };
}

export interface GmailAccount {
  messages: Map<string, FakeMail>;
  /** Backfill pages of message IDs. */
  pages: string[][];
  /** History records returned in order, one page each. */
  history: Record<string, unknown>[][];
  historyId: number;
  expireHistory?: boolean;
  failNextRead?: string;
  revoked?: boolean;
}
export function gmailAccount(mails: FakeMail[], pageSize = 50): GmailAccount {
  const messages = new Map(mails.map((mail) => [mail.id, mail]));
  const ids = mails.map((mail) => mail.id);
  const pages: string[][] = [];
  for (let index = 0; index < ids.length; index += pageSize) pages.push(ids.slice(index, index + pageSize));
  return { messages, pages: pages.length ? pages : [[]], history: [], historyId: 100 };
}
export interface FakeCalls { calls: { name: string; input: Record<string, unknown>; account?: string }[] }
/** Capability router for Gmail, Calendar and Ri capabilities across several accounts. */
export function fakeConnectors(options: {
  gmail?: Record<string, GmailAccount>;
  calendars?: Record<string, { calendars: { id: string; summary: string; primary?: boolean }[]; events: Record<string, unknown>[]; expireSync?: boolean }>;
  tasks?: Map<string, { id: string; title: string }>;
  allowTasks?: boolean;
  ai?: (prompt: string) => string | Error;
  extract?: (input: { fileName: string; mimeType: string; base64: string }) => { text: string; truncated: boolean; characters: number } | Error;
}): Capability & FakeCalls {
  const calls: FakeCalls["calls"] = [];
  const tasks = options.tasks ?? new Map();
  const capability = (async (name: string, input: Record<string, unknown>, target?: { binding?: string; account?: string }) => {
    calls.push({ name, input, account: target?.account });
    if (name.startsWith("gmail.")) {
      const account = options.gmail?.[target?.account ?? ""];
      if (!account) throw new AppError("forbidden", "Not granted");
      if (account.revoked) throw new AppError("revoked", "Reconnect needed");
      if (name === "gmail.get_profile") return { emailAddress: `${target?.account}@example.test`, historyId: String(account.historyId) };
      if (name === "gmail.search_messages") {
        const index = input.pageToken ? Number(String(input.pageToken).slice(1)) : 0;
        const page = account.pages[index] ?? [];
        return { messages: page.map((id) => ({ id, threadId: account.messages.get(id)?.threadId ?? `t-${id}` })), ...(index + 1 < account.pages.length ? { nextPageToken: `p${index + 1}` } : {}) };
      }
      if (name === "gmail.list_history") {
        if (account.expireHistory) { account.expireHistory = false; throw new AppError("not_found", "History expired"); }
        const index = input.pageToken ? Number(String(input.pageToken).slice(1)) : 0;
        const records = account.history.shift() ?? [];
        return { historyId: String(++account.historyId), history: records, ...(account.history.length && index < 0 ? { nextPageToken: "h1" } : {}) };
      }
      if (name === "gmail.get_message") {
        const mail = account.messages.get(String(input.messageId));
        if (!mail) throw new AppError("not_found", "Gone");
        return { id: mail.id, threadId: mail.threadId ?? `t-${mail.id}`, labelIds: mail.labelIds ?? ["INBOX"], snippet: (mail.text ?? "").slice(0, 160), headers: { Subject: mail.subject, From: mail.from } };
      }
      if (name === "gmail.read_message") {
        if (account.failNextRead === input.messageId) { account.failNextRead = undefined; throw new AppError("timeout", "Slow provider"); }
        const mail = account.messages.get(String(input.messageId));
        if (!mail) throw new AppError("not_found", "Gone");
        return gmailMessage(mail);
      }
      if (name === "gmail.get_attachment") {
        const mail = account.messages.get(String(input.messageId));
        const attachment = mail?.attachments?.find((item) => item.attachmentId === input.attachmentId);
        if (!attachment) throw new AppError("not_found", "Gone");
        return { data: Buffer.from(attachment.data, "utf8").toString("base64url"), size: attachment.data.length };
      }
    }
    if (name.startsWith("google_calendar.")) {
      const account = options.calendars?.[target?.account ?? ""];
      if (!account) throw new AppError("forbidden", "Not granted");
      if (name === "google_calendar.list_calendars") return { calendars: account.calendars };
      if (name === "google_calendar.sync_events") {
        if (input.syncToken && account.expireSync) { account.expireSync = false; throw new AppError("not_found", "Sync token expired"); }
        if (input.syncToken) return { events: [], nextSyncToken: "sync-2" };
        return { events: account.events, nextSyncToken: "sync-1", calendarTimeZone: "America/Denver" };
      }
    }
    if (name === "create_task") {
      if (options.allowTasks === false) throw new AppError("forbidden", "Not allowed");
      const key = String(input.operationId);
      if (!tasks.has(key)) tasks.set(key, { id: `task-${tasks.size + 1}`, title: String(input.title) });
      return { ...tasks.get(key)!, status: "todo" };
    }
    if (name === "get_task") {
      const found = [...tasks.values()].find((task) => task.id === input.id);
      if (!found) throw new AppError("not_found", "Gone");
      return found;
    }
    if (name === "ai_text") {
      if (!options.ai) throw new AppError("unsupported", "No qualified harness");
      const reply = options.ai(String(input.prompt));
      if (reply instanceof Error) throw reply;
      return { text: reply };
    }
    if (name === "extract_text") {
      if (!options.extract) throw new AppError("forbidden", "Not allowed");
      const reply = options.extract(input as never);
      if (reply instanceof Error) throw reply;
      return reply;
    }
    throw new AppError("unsupported", `Unexpected capability ${name}`);
  }) as Capability & FakeCalls;
  capability.calls = calls;
  return capability;
}
