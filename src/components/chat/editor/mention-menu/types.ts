import type { SourceSearchItem, SourceSearchResult } from '@/lib/chat-sources/types';
import type { McpIcon } from '@/lib/integrations/mcp-icons';
import type { AgentPictureSource } from '@/components/agents/agent-icon';
/**
 * Items in the `@`-mention picker. One picker covers seven kinds, with a
 * discriminator so the popup can section-render and the extension can
 * dispatch to the right chip on select.
 *
 *   - file / dir — worktree paths. Insertion → MentionChipNode (`@<path>`).
 *   - task / note — entity references. Insertion → EntityChipNode
 *     (`[[task:id]]` / `[[note:id]]`).
 *   - agent — another agent (a workspace). Insertion → EntityChipNode
 *     (`[[agent:id]]`), which reaches the chat as the agent's name, purpose
 *     and coordination address, so it can consult or delegate to it.
 *   - scratchpad — the session's own scratchpad. Always one option,
 *     surfaced near the top so the user doesn't have to search for it.
 *     Insertion → EntityChipNode (`[[scratchpad]]`).
 *   - reference — a reference folder (docs/reference-folders-spec.md).
 *     Selecting a result inserts a folder chip and closes the picker.
 *     `/` optionally searches its files.
 *   - pr — a GitHub pull request, reached by typing `@#` (see
 *     `pr-trigger.ts`). Insertion → PrChipNode, which serializes to a
 *     full context line via `formatPrRef`.
 *   - more — the end of a short task, note or agent list: how many
 *     matched in all. Picking it narrows the picker to that kind
 *     (`@task:<query>`). In a narrowed picker it's only a caption.
 *   - filter — narrows the picker to one kind by rewriting the query
 *     (`@ta` becomes `@task:`). Offered as a row while a kind's name is
 *     typed, and what the kind chips above the list apply.
 *
 * Tasks and notes come from a server search over the whole home
 * (`SearchMentionEntities`), so a mention can reach any of them.
 */

import type { PrMentionItem } from '../pr-menu/types';

export interface FileMentionItem {
  kind: 'file' | 'dir';
  path: string;
  name: string;
  /**
   * Display label, used when the bare basename would lose useful context.
   * Set for files that came from a reference folder, where it reads
   * `alias/relative/path` so the chip says which folder the file is from.
   */
  label?: string;
  /**
   * Alias of the reference folder this path came from, when it came from one.
   * Also the signal that `path` is absolute rather than worktree-relative,
   * which is why these chips don't offer click-to-open — the file viewer only
   * resolves paths inside the worktree.
   */
  referenceAlias?: string;
}

export interface TaskMentionItem {
  kind: 'task';
  id: string;
  title: string;
  /** Lifecycle status. Drives the chip icon and the row's tag. */
  status: string;
}

export interface NoteMentionItem {
  kind: 'note';
  id: string;
  title: string;
}

/**
 * An agent, as the rail shows it, plus what it's for. Its picture arrives
 * resolved (`resolveAgentPicture`): the popup renders in its own React root,
 * outside the providers the area lookup needs.
 */
export interface AgentMentionItem {
  kind: 'agent';
  id: string;
  name: string;
  slug: string;
  picture: AgentPictureSource;
  purpose: string | null;
}

export interface ScratchpadMentionItem {
  kind: 'scratchpad';
}

export interface ReferenceFolderMentionItem {
  kind: 'reference';
  id: string;
  alias: string;
  absolutePath: string;
  /** False when the folder is missing on disk: listed, but not browsable. */
  exists: boolean;
  /**
   * False when its files are on another device (a chat that runs there):
   * picking it mentions the folder instead of listing files from here.
   */
  browsable?: boolean;
}

/**
 * A pull request surfaced under `@#`. Extends the wire shape the PR chip
 * consumes (`PrMentionItem`) with the picker discriminator, so selecting
 * one can drop the `kind` and hand the rest straight to `insertPrChip`.
 */
export interface PrMentionMenuItem extends PrMentionItem {
  kind: 'pr';
}

export interface MoreMentionItem {
  kind: 'more';
  of: 'task' | 'note' | 'agent' | 'app';
  /** Every match, shown or not. */
  total: number;
  shown: number;
  /** The search, carried into `@task:<query>` when picked. */
  query: string;
  /** Already narrowed to this kind: a caption, not a row to pick. */
  narrowed: boolean;
}

/** What a query narrows the picker to, read from how it opens (`task:`, `#`). */
export type MentionFilter = 'task' | 'note' | 'agent' | 'file' | 'pr' | 'app' | 'connector';

/**
 * Narrows the picker to one kind, or back to every kind (`filter: null`),
 * by rewriting the query. The editor text stays the only record of the
 * filter, so the chips, the text and the results can't disagree.
 */
export interface FilterMentionItem {
  kind: 'filter';
  filter: MentionFilter | null;
  /** The search carried into the new query. */
  query: string;
}

export type SearchMentionSources =(query: string, filter?: 'app' | 'connector', groupId?: string, signal?: AbortSignal) => Promise<SourceSearchResult>;

/**
 * One item a connected app's @ search returned (OpenAI's "Composer
 * At-Mentions"), grouped under its app. Picking it inserts a source chip
 * for the account carrying this item (`sourceRef`).
 */
export interface AppMentionMenuItem {
  kind: 'appMention';
  serverId: string;
  /** The group's header: the app, with the account when it has several. */
  group: string;
  sourceRef: string;
  title: string;
  subtitle?: string;
  icons: McpIcon[];
  /** The app's own icon, shown when the item has none. */
  appIcons: McpIcon[];
}

export interface AppMentionResults {
  groups: { serverId: string; app: string; account?: string; icons: McpIcon[]; items: { sourceRef: string; title: string; subtitle?: string; icons: McpIcon[] }[] }[];
}
/** Searches connected apps that answer @ search. Null when there is nothing to ask. */
export type SearchAppMentions = (query: string, signal?: AbortSignal) => Promise<AppMentionResults | null>;

export type MentionItem =
  | SourceSearchItem
  | AppMentionMenuItem
  | FileMentionItem
  | TaskMentionItem
  | NoteMentionItem
  | AgentMentionItem
  | ScratchpadMentionItem
  | ReferenceFolderMentionItem
  | PrMentionMenuItem
  | MoreMentionItem
  | FilterMentionItem;

/** One server search for the picker's tasks and notes. `kind` asks for one. */
export interface MentionEntitySearch {
  q: string;
  kind?: 'task' | 'note';
  limit: number;
}

export interface MentionEntityResults {
  tasks: TaskMentionItem[];
  notes: NoteMentionItem[];
  /** Every match per kind, beyond the `limit` returned. */
  totals: { tasks: number; notes: number };
}

export type SearchMentionEntities = (search: MentionEntitySearch) => Promise<MentionEntityResults>;
