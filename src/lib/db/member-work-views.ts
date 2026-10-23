import { processState } from '@/lib/process-state';
import { and, eq, inArray, getTableColumns, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import { memberChatViews, memberExecutionViews, memberPreferences } from './schema';
import { getChatSessionWithExecution, getHome, getMember, TeamError } from './queries';
import type { ChatSessionWithExecution, MemberChatViewRecord, MemberExecutionViewRecord, UpdateMemberPreferencesInput } from '@/db/types';

function member(id: string) {
  if (getHome()?.kind !== 'team' || getMember(id)?.status !== 'active') throw new TeamError('not_allowed', 'This viewer is no longer an active team member.');
}

/** Bounded preference lookups, with no transcript reads or global preference scan. */
export function projectMemberWorkViews<T extends { id: string; executionId?: string | null; execution?: object | null }>(rows: readonly T[], memberId: string): T[] {
  member(memberId);
  const chats = new Map<string, MemberChatViewRecord>();
  const executions = new Map<string, MemberExecutionViewRecord>();
  for (let at = 0; at < rows.length; at += 300) {
    const batch = rows.slice(at, at + 300);
    for (const row of getDb().select().from(memberChatViews).where(and(eq(memberChatViews.memberId, memberId), inArray(memberChatViews.chatSessionId, batch.map(row => row.id)))).all()) chats.set(row.chatSessionId, row);
    const executionIds = [...new Set(batch.flatMap(row => row.executionId ? [row.executionId] : []))];
    if (executionIds.length) for (const row of getDb().select().from(memberExecutionViews).where(and(eq(memberExecutionViews.memberId, memberId), inArray(memberExecutionViews.executionId, executionIds))).all()) executions.set(row.executionId, row);
  }
  return rows.map(row => {
    const view = chats.get(row.id);
    const pin = row.executionId ? executions.get(row.executionId)?.pinnedAt ?? null : null;
    return { ...row, lastViewedAt: view?.lastViewedAt ?? null, unreadMarkerAt: view?.unreadMarkerAt ?? null,
      ...('pinnedAt' in row ? { pinnedAt: pin } : {}),
      ...(row.execution ? { execution: { ...row.execution, pinnedAt: pin } } : {}) };
  });
}

export function setMemberChatRead(chatId: string, memberId: string, read: boolean): ChatSessionWithExecution | null {
  member(memberId);
  const chat = getChatSessionWithExecution(chatId);
  if (!chat) return null;
  const previous = projectMemberWorkViews([chat], memberId)[0].lastViewedAt;
  const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
  const patch = read ? { lastViewedAt: now, unreadMarkerAt: null } : { unreadMarkerAt: now };
  getDb().insert(memberChatViews).values({ id: uuidv7(), memberId, chatSessionId: chatId, ...patch })
    .onConflictDoUpdate({ target: [memberChatViews.memberId, memberChatViews.chatSessionId], set: patch }).run();
  return projectMemberWorkViews([chat], memberId)[0];
}

export function setMemberSessionPinned(chatId: string, memberId: string, pinned: boolean): ChatSessionWithExecution | null {
  member(memberId);
  const chat = getChatSessionWithExecution(chatId);
  if (!chat?.executionId || chat.execution?.status === 'archived') return null;
  const patch = { pinnedAt: pinned ? new Date().toISOString() : null };
  getDb().insert(memberExecutionViews).values({ id: uuidv7(), memberId, executionId: chat.executionId, ...patch })
    .onConflictDoUpdate({ target: [memberExecutionViews.memberId, memberExecutionViews.executionId], set: patch }).run();
  return projectMemberWorkViews([chat], memberId)[0];
}

export function clearMemberExecutionPins(executionId: string) {
  getDb().update(memberExecutionViews).set({ pinnedAt: null }).where(eq(memberExecutionViews.executionId, executionId)).run();
}

// Read the navigation JSON as text so a malformed preference cannot break every
// query that includes member preferences. No schema or migration change is needed.
const preferenceColumns = { ...getTableColumns(memberPreferences), currentMainChats: sql<string>`${memberPreferences.currentMainChats}` };
const invalidPreferenceWarnings = processState('member-preferences:invalid-current-chats', () => new Set<string>());
function preferences(row: (Omit<import('@/db/types').MemberPreferencesRecord, 'currentMainChats'> & { currentMainChats: string }) | undefined) {
  if (!row) return null;
  let currentMainChats: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.currentMainChats);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a map of agent IDs to chat IDs.');
    const entries = Object.entries(parsed);
    currentMainChats = Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    if (entries.length !== Object.keys(currentMainChats).length) throw new Error('Invalid chat pointers were ignored.');
  } catch {
    if (!invalidPreferenceWarnings.has(row.memberId)) {
      invalidPreferenceWarnings.add(row.memberId);
      console.warn(`[member-preferences] Ignoring malformed current chat navigation for member ${row.memberId}`);
    }
  }
  return { ...row, currentMainChats };
}

/** Voice choices belong to the signed-in person, and never change another member's composer. */
export function getMemberPreferences(memberId: string) {
  member(memberId);
  return preferences(getDb().select(preferenceColumns).from(memberPreferences).where(eq(memberPreferences.memberId, memberId)).get());
}
export function updateMemberPreferences(memberId: string, patch: UpdateMemberPreferencesInput) {
  member(memberId);
  return preferences(getDb().insert(memberPreferences).values({ id: uuidv7(), memberId, ...patch })
    .onConflictDoUpdate({ target: memberPreferences.memberId, set: patch }).returning(preferenceColumns).get());
}

/** Selected main chat is private navigation state, not ownership of shared work. */
export function setMemberCurrentMainChat(memberId: string, workspaceId: string, chatId: string) {
  member(memberId);
  const chat = getChatSessionWithExecution(chatId);
  if (!chat || chat.workspaceId !== workspaceId || chat.executionId || chat.type !== 'orchestration') throw new TeamError('not_allowed', 'Choose a main chat of this agent.');
  const patch = { currentMainChats: { ...getMemberPreferences(memberId)?.currentMainChats, [workspaceId]: chatId } };
  return preferences(getDb().insert(memberPreferences).values({ id: uuidv7(), memberId, ...patch })
    .onConflictDoUpdate({ target: memberPreferences.memberId, set: patch }).returning(preferenceColumns).get());
}
