import type { AgentMainChatState } from '@/db/types';
export interface LinkedPr {
  number: number;
  url: string;
}
export interface PrLinkResponse {
  linked: LinkedPr | null;
}
export type RailMainChat = AgentMainChatState & { waitingOn: string | null };
/**
 * Where a row sits in the execution's Notes & tasks view: mentioned or pinned
 * in this chat, in the chat's agent, or anywhere else. A row lives in exactly
 * one section, the first that claims it in that order.
 */
export type ReferenceSection = 'inChat' | 'workspace' | 'all';
export interface ReferenceRow {
  kind: 'task' | 'note';
  id: string;
  title: string;
  status?: string;
  areaId: string | null;
  workspaceId: string | null;
  updatedAt: string;
  section: ReferenceSection;
  /** Truthy when this row appears in chat_refs for the session. */
  referencedAt?: string | null;
  /** Non-archived child tasks. Tasks only, undefined for notes. */
  subtaskCount?: number;
}
/**
 * One page of the Notes & tasks view, rows in section order. `counts` are
 * every row each section holds under the same search, not just this page's.
 * `nextCursor` is null on the last page.
 */
export interface ReferencePage {
  rows: ReferenceRow[];
  counts: Record<ReferenceSection, number>;
  nextCursor: string | null;
}