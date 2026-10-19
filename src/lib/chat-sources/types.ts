import type { SourceReference } from './reference';
export type SourceStatus = 'ready' | 'needs_access' | 'reconnect' | 'unavailable';
/** The glyph a chip or picker row draws: a provider's logo, an MCP server you added, or an installed app's mark. */
export type SourceMark =
  | { kind: 'provider'; providerId: string; toolkitId: string }
  | { kind: 'server' }
  | { kind: 'app'; icon?: string };
export interface SourceDescriptor {
  sourceRef: string;
  /** The exact target, account included. What the model and the chip's details read. */
  label: string;
  /** What a chip reads: the service alone while it is the only account of it, with the account once there are several. */
  chipLabel: string;
  service: string;
  accountLabel?: string;
  mark?: SourceMark;
  groupId: string;
  keywords: string[];
  status: SourceStatus;
  reason?: string;
  chat: boolean;
  view: 'available' | 'advertised' | 'none';
  openPath?: string;
  managePath?: string;
}
export interface SourceContext { chatId: string; workspaceId: string | null; harnessReady: boolean; messageId?: string }
export interface SourceAction { id: string; description: string; inputSchema: unknown; outputSchema?: unknown; mutating?: boolean }
export interface SourceAdapter {
  kind: SourceReference['kind'];
  list(context: SourceContext): Promise<SourceDescriptor[]>;
  actions(reference: SourceReference, context: SourceContext): Promise<SourceAction[]>;
  call(reference: SourceReference, context: SourceContext, action: string, input: Record<string, unknown>, invocationId: string, signal?: AbortSignal): Promise<unknown>;
  /** Explicit human request to open a native summary or view beside this chat. */
  open?(reference: SourceReference, context: SourceContext): Promise<void | {captureId?: string; href?: string}>;
}
export type SourceSearchItem = { kind: 'source'; source: SourceDescriptor } | { kind: 'sourceGroup'; groupId: string; label: string; count: number; mark?: SourceMark };
export interface SourceSearchResult { items: SourceSearchItem[]; total: number }
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  ready: 'Ready', needs_access: 'Allow access', reconnect: 'Reconnect', unavailable: 'Unavailable in this chat',
};
