/** Read-only report. Never applies a repair or opens the app's write connection. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, asc, eq, gt, isNotNull, like, or } from 'drizzle-orm';
import { agentCoordinationDeliveries, agentCoordinationRequests, chatEvents, chatSessions } from '../src/lib/db/schema';
import { getDevAppRoot, getProductionAppRoot } from '../src/lib/config/paths';
import { CHAT_MESSAGE_SENT } from '../src/lib/sessions/chat-message';

export function auditCoordinationTimestamps(root: string) {
  const file = path.join(/* turbopackIgnore: true */ root, 'data.db');
  const raw = new Database(file, { readonly: true, fileMustExist: true });
  raw.pragma('query_only = ON');
  const db = drizzle(raw, { casing: 'snake_case' });
  const rows = new Map<string, { id: string; sessionId: string; before: string; after: string; kind: string }>();
  function collect(row: { id: string; sessionId: string; createdAt: string }, kind: string) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(row.createdAt)) return;
    const after = new Date(`${row.createdAt.replace(' ', 'T')}Z`).toISOString();
    rows.set(row.id, { id: row.id, sessionId: row.sessionId, before: row.createdAt, after, kind });
  }
  try {
    // Direct pointers use the event PK, without parsing transcript JSON.
    const inputIds = db.select({ id: agentCoordinationDeliveries.eventId }).from(agentCoordinationDeliveries).all();
    const outcomeIds = db.select({ id: agentCoordinationRequests.responseEventId }).from(agentCoordinationRequests).where(isNotNull(agentCoordinationRequests.responseEventId)).all();
    for (const [ids, kind] of [[inputIds, 'delivered messages and context'], [outcomeIds, 'tracked answers']] as const) {
      for (const { id } of ids) {
        if (!id) continue;
        const event = db.select({ id: chatEvents.id, sessionId: chatEvents.sessionId, createdAt: chatEvents.createdAt }).from(chatEvents).where(eq(chatEvents.id, id)).get();
        if (event) collect(event, kind);
      }
    }
    // Audits and older authenticated cross-chat messages may have no delivery
    // pointer. Read early columns, one session at a time, in bounded pages.
    const sessions = db.select({ id: chatSessions.id }).from(chatSessions).all();
    for (const session of sessions) {
      let cursor: { createdAt: string; id: string } | undefined;
      for (;;) {
        const page = db.select({ id: chatEvents.id, sessionId: chatEvents.sessionId, createdAt: chatEvents.createdAt, source: chatEvents.source, content: chatEvents.content })
          .from(chatEvents).where(and(
            eq(chatEvents.sessionId, session.id), like(chatEvents.createdAt, '____-__-__ __:__:__%'),
            or(and(eq(chatEvents.source, 'system'), or(like(chatEvents.content, 'coordination_%'), eq(chatEvents.content, CHAT_MESSAGE_SENT))), and(eq(chatEvents.source, 'user'), isNotNull(chatEvents.senderSessionId))),
            cursor ? or(gt(chatEvents.createdAt, cursor.createdAt), and(eq(chatEvents.createdAt, cursor.createdAt), gt(chatEvents.id, cursor.id))) : undefined,
          )).orderBy(asc(chatEvents.createdAt), asc(chatEvents.id)).limit(500).all();
        for (const event of page) {
          if (event.source === 'system' && event.content !== CHAT_MESSAGE_SENT && !event.content?.startsWith('coordination_')) continue;
          collect(event, event.source === 'system' ? event.content === CHAT_MESSAGE_SENT ? 'sent receipts' : 'coordination audits' : 'delivered messages and context');
        }
        if (page.length < 500) break;
        cursor = page.at(-1)!;
      }
    }
    const events = [...rows.values()];
    const counts: Record<string, number> = {};
    for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    return { root, total: events.length, chats: new Set(events.map(event => event.sessionId)).size, counts, events };
  } finally { raw.close(); }
}

if (process.argv[1]?.endsWith('audit-coordination-timestamps.ts')) {
  const reports = [getProductionAppRoot(), getDevAppRoot()].map(auditCoordinationTimestamps);
  const output = process.argv[2];
  if (output) fs.writeFileSync(/* turbopackIgnore: true */ output, JSON.stringify({ auditedAt: new Date().toISOString(), reports }, null, 2));
  for (const report of reports) console.log(JSON.stringify({root:report.root,total:report.total,chats:report.chats,counts:report.counts}));
}
