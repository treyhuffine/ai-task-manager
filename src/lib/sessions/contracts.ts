import type { AgentMainChatState } from '@/db/types';
export interface LinkedPr {
  number: number;
  url: string;
}
export interface PrLinkResponse {
  linked: LinkedPr | null;
}
export type RailMainChat = AgentMainChatState & { waitingOn: string | null };
export interface ReferenceRow {
  kind: 'task' | 'note';
  id: string;
  title: string;
  status?: string;
  areaId: string | null;
  workspaceId: string | null;
  updatedAt: string;
  /** Truthy when this row appears in chat_refs for the session. */
  referencedAt?: string | null;
  /** Number of child tasks. Tasks only — undefined for notes or when not computed. */
  subtaskCount?: number;
}