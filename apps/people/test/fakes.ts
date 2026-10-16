import { AppError } from '@ri/app-kit/contract';
import { calendarEvent, gmailMetadata, gmailRaw, type FakeEvent, type FakeMail } from '../src/fixtures/mail.js';

/**
 * Fictional connector and Ri capabilities with the shapes the host returns.
 * Mailboxes page their search results, report history changes, can expire a
 * history checkpoint and fail a call once to simulate an interrupted page.
 */
export interface FakeAccount {
  email: string;
  mail: FakeMail[];
  history?: { added?: string[]; deleted?: string[]; trashed?: string[] }[];
  events?: FakeEvent[];
  eventChanges?: FakeEvent[][];
}
export interface FakeOptions {
  pageSize?: number;
  expireHistoryOnce?: boolean;
  failReadOnce?: string;
  revoked?: Set<string>;
  ai?: 'unsupported' | 'forbidden' | ((prompt: string) => string);
  tasks?: Map<string, { id: string; title: string; status: string; deleted?: boolean }>;
  failCreateTaskOnce?: boolean;
}
export function fakeHost(accounts: Record<string, FakeAccount>, options: FakeOptions = {}) {
  const calls: { name: string; input: Record<string, unknown>; account?: string }[] = [];
  const tasks = options.tasks ?? new Map();
  let expired = false, readFailed = false, createFailed = false;
  const historyCursor = new Map<string, number>();
  const capability = async (name: string, input: unknown, target?: unknown) => {
    const account = (target as { account?: string } | undefined)?.account;
    const args = (input ?? {}) as Record<string, unknown>;
    calls.push({ name, input: args, account });
    if (account && options.revoked?.has(account)) throw new AppError('revoked', 'Reconnect this account');
    const box = account ? accounts[account] : undefined;
    switch (name) {
      case 'gmail.get_profile': return { emailAddress: box!.email, historyId: '100' };
      case 'gmail.search_messages': {
        const size = options.pageSize ?? 20;
        const start = args.pageToken ? Number(String(args.pageToken).slice(1)) : 0;
        const slice = box!.mail.slice(start, start + size);
        return { messages: slice.map((mail) => ({ id: mail.id, threadId: mail.threadId ?? mail.id })), ...(start + size < box!.mail.length ? { nextPageToken: `p${start + size}` } : {}) };
      }
      case 'gmail.list_history': {
        if (options.expireHistoryOnce && !expired) { expired = true; throw new AppError('not_found', 'History expired'); }
        // Like Gmail, the same start position always returns the same changes.
        const start = Number(args.startHistoryId ?? 100);
        const index = Math.max(0, Math.round((start - 100) / 20));
        const page = box!.history?.[index];
        void historyCursor;
        const record = page ? [{
          messagesAdded: (page.added ?? []).map((id) => ({ message: { id, threadId: box!.mail.find((mail) => mail.id === id)?.threadId ?? id, labelIds: ['INBOX'] } })),
          messagesDeleted: (page.deleted ?? []).map((id) => ({ message: { id } })),
          labelsAdded: (page.trashed ?? []).map((id) => ({ message: { id }, labelIds: ['TRASH'] })),
        }] : [];
        return { historyId: String(page ? start + 20 : start), history: record };
      }
      case 'gmail.get_message': {
        const mail = box!.mail.find((item) => item.id === args.messageId);
        if (!mail) throw new AppError('not_found', 'gone');
        return gmailMetadata(mail);
      }
      case 'gmail.read_message': {
        if (options.failReadOnce === args.messageId && !readFailed) { readFailed = true; throw new AppError('timeout', 'The provider timed out'); }
        const mail = box!.mail.find((item) => item.id === args.messageId);
        if (!mail) throw new AppError('not_found', 'gone');
        return gmailRaw(mail);
      }
      case 'google_calendar.list_calendars': return { calendars: [{ id: 'primary', summary: box!.email, primary: true }] };
      case 'google_calendar.sync_events': {
        if (args.syncToken) {
          const step = Number(String(args.syncToken).replace('sync-', ''));
          const changes = box!.eventChanges?.[step] ?? [];
          return { events: changes.map(calendarEvent), nextSyncToken: `sync-${step + (changes.length ? 1 : 0)}`, calendarTimeZone: 'America/Denver' };
        }
        return { events: (box!.events ?? []).map(calendarEvent), nextSyncToken: 'sync-0', calendarTimeZone: 'America/Denver' };
      }
      case 'create_task': {
        if (options.failCreateTaskOnce && !createFailed) { createFailed = true; throw new AppError('busy', 'Ri is busy'); }
        const key = String(args.operationId);
        if (!tasks.has(key)) tasks.set(key, { id: `task-${tasks.size + 1}`, title: String(args.title), status: 'open' });
        const task = tasks.get(key)!;
        return { id: task.id, title: task.title, status: task.status };
      }
      case 'get_task': {
        const task = [...tasks.values()].find((item) => item.id === args.id);
        if (!task || task.deleted) throw new AppError('not_found', 'That Ri record is no longer available');
        return { id: task.id, title: task.title, status: task.status, completedAt: task.status === 'done' ? '2026-10-16T00:00:00Z' : null };
      }
      case 'ai_text': {
        if (!options.ai) throw new AppError('forbidden', 'Not allowed');
        if (options.ai === 'unsupported' || options.ai === 'forbidden') throw new AppError(options.ai, 'Bounded app AI unavailable');
        return { text: options.ai(String(args.prompt)) };
      }
    }
    throw new AppError('unsupported', `Unexpected capability ${name}`);
  };
  return { capability, calls, tasks, count: (name: string) => calls.filter((call) => call.name === name).length };
}

/** A small correspondence world for two accounts. Dates sit inside the 90-day window of 2026-10-15. */
export const OWNER = 'owner@personal.example', OWNER_WORK = 'owner@studio.example';
export function mail(id: string, partial: Partial<FakeMail> & Pick<FakeMail, 'from' | 'to' | 'body'>): FakeMail {
  return { id, subject: partial.subject ?? `Subject ${id}`, date: partial.date ?? '2026-10-10T15:00:00.000Z', ...partial } as FakeMail;
}
