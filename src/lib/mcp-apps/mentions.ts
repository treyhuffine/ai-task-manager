import { integrationSourceMetadata } from '@/lib/integrations/source-metadata';
import { getIntegrationOwnerId, readWouldAsk } from '@/lib/integrations/runtime';
import { hostedMcpConnectionId } from '@/lib/integrations/hosted-mcp';
import { pinMatchesConnection } from '@/lib/integrations/scope-pins';
import { sessionCaller } from '@/lib/integrations/approval';
import { safeMcpIcons, type McpIcon } from '@/lib/integrations/mcp-icons';
import type { McpCapabilityTool } from '@/lib/integrations/mcp-capabilities';
import { accountSource, decodeSource, encodeSource, mentionedResourceSchema, type SourceReference } from '@/lib/chat-sources/reference';
import type { MentionedResourceContext } from '@/lib/chat-sources/types';
import { MENTION_CONTENT_BYTES } from '@/lib/chat-sources/service';
import { appToolVisible, mentionsSearchTool } from './metadata';
import { authority, mcpAppsEnabled } from './service';

/**
 * Server-provided @ search, OpenAI's "Composer At-Mentions"
 * (docs/connected-mcp-apps.md, "@ search"). A server that advertises
 * `openai/mentions` (or the deprecated per-tool marker) names a read-only,
 * app-visible tool that takes `{query}` and returns `{items}`. Ri asks every
 * such server the chat may use, in parallel, and gives each a short deadline
 * so one slow server never holds the menu.
 *
 * Choosing an item makes a source reference for that account carrying the
 * item (`chat-sources/reference.ts`). When the message is sent, and on every
 * dispatch, the account is checked again for that chat and the item is read
 * through the server's `resources/read`, so the agent receives what it is
 * and its content as untrusted data.
 */

/** OpenAI's examples return a handful. The menu shows at most this many per app. */
export const MENTIONS_PER_APP = 20;
/** How long one server's search may take before the menu goes on without it. */
export const MENTION_SEARCH_TIMEOUT_MS = 3_000;
/** How long reading a mentioned item may take when the message is sent. */
export const MENTION_READ_TIMEOUT_MS = 10_000;

export interface AppMention {
  /** The source reference the chip carries: the account plus this item. */
  sourceRef: string;
  uri: string;
  title: string;
  name?: string;
  subtitle?: string;
  mimeType?: string;
  icons: McpIcon[];
}
export interface AppMentionGroup {
  serverId: string;
  /** The service, as the Apps library names it. */
  app: string;
  /** The account, when this app has more than one. */
  account?: string;
  icons: McpIcon[];
  items: AppMention[];
}
export interface MentionSearchResult {
  groups: AppMentionGroup[];
  /** Servers that advertise @ search but were not asked, and why. */
  skipped: { serverId: string; app: string; reason: string }[];
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? (value.length > max ? `${value.slice(0, max - 1)}…` : value) : undefined;

/**
 * One returned item, normalized: a `resource_link`, or OpenAI's
 * `{type: "resource", resourceUri, title}` form. An item that fails either
 * shape, or whose URI could not be referenced, is dropped on its own.
 */
export function mentionItem(raw: unknown, account: SourceReference): AppMention | null {
  const item = record(raw);
  let uri: unknown, title: string | undefined, name: string | undefined, subtitle: string | undefined, mimeType: string | undefined;
  if (item.type === 'resource_link') {
    if (typeof item.name !== 'string' || !item.name) return null;
    uri = item.uri; name = text(item.name, 120); title = text(item.title, 120) ?? name;
    subtitle = text(item.description, 200); mimeType = text(item.mimeType, 100);
  } else if (item.type === 'resource') {
    if (typeof item.title !== 'string' || !item.title.trim()) return null;
    uri = item.resourceUri; title = text(item.title, 120); subtitle = text(item.subtitle, 200);
  } else return null;
  const resource = mentionedResourceSchema.safeParse({ uri, ...(title ? { title } : {}), ...(name ? { name } : {}) });
  if (!resource.success || account.kind !== 'integration') return null;
  let sourceRef: string;
  try { sourceRef = encodeSource({ ...account, resource: resource.data }); } catch { return null; }
  return { sourceRef, uri: resource.data.uri, title: title ?? resource.data.uri, ...(name ? { name } : {}), ...(subtitle ? { subtitle } : {}),
    ...(mimeType ? { mimeType } : {}), icons: safeMcpIcons(item.icons) };
}

/**
 * Why a server's search tool may not run, or null. A search runs on every
 * keystroke, so it must never stop for approval: one the person set to Ask
 * first is skipped, and so is one not marked read-only, which approvals treat
 * as a write and would ask about, one card per letter. It must also be
 * visible to apps and not turned off.
 */
export function searchRefusal(tool: McpCapabilityTool | undefined, enabled: boolean, wouldAsk: boolean): string | null {
  if (!tool) return 'It names a search tool it does not list.';
  if (!enabled) return 'Its search tool is turned off.';
  if (record(tool.annotations).readOnlyHint !== true) return 'Its search tool is not marked read-only.';
  if (!appToolVisible(tool)) return 'Its search tool is not available to apps.';
  if (wouldAsk) return 'Its search tool asks before it runs. Turn off Ask first for it to search it with @.';
  return null;
}

/** Run `work` with an abort signal that fires after `ms` or with `outer`, and stop waiting when it does. */
async function deadline<T>(ms: number, outer: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(outer?.reason);
  outer?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(new Error('timeout')); reject(new Error('It did not answer in time.')); }, ms);
  });
  try {
    if (outer?.aborted) throw new Error('The search was cancelled.');
    return await Promise.race([work(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

/** Search every app the chat may use that answers @ search. */
export async function searchAppMentions(chatId: string, query: string, signal?: AbortSignal): Promise<MentionSearchResult> {
  if (!mcpAppsEnabled()) return { groups: [], skipped: [] };
  const metadata = await integrationSourceMetadata();
  const candidates = metadata.servers.flatMap(({ entry, capabilities }) => {
    const tools = capabilities?.tools ?? [];
    const searchTool = mentionsSearchTool(entry.protocol?.extensions, tools);
    if (!searchTool || !entry.enabled) return [];
    const toolkitId = entry.providerId ?? `mcp_${entry.slug}`;
    const app = metadata.toolkits.find(t => t.id === toolkitId)?.displayName ?? entry.displayName;
    return [{ entry, tools, searchTool, toolkitId, app }];
  });
  const results = await Promise.all(candidates.map(async ({ entry, tools, searchTool, toolkitId, app }) => {
    const skip = (reason: string) => ({ skipped: { serverId: entry.id, app, reason } });
    const actionId = `${entry.providerId ?? `mcp.${entry.slug}`}.${searchTool}`;
    const refusal = searchRefusal(tools.find(t => t.name === searchTool), entry.toolOverrides?.[searchTool]?.enabled !== false,
      readWouldAsk(actionId, { id: hostedMcpConnectionId(entry), providerId: entry.providerId ?? toolkitId }));
    if (refusal) return skip(refusal);
    try {
      return await deadline(MENTION_SEARCH_TIMEOUT_MS, signal, async abort => {
        const current = await authority(entry.id, chatId);
        if (!current.transport.tools.some(t => t.name === searchTool)) throw new Error('Its search tool is not available right now.');
        let original: unknown;
        const outcome = await current.runtime.runAction(actionId, { query }, {
          ownerId: getIntegrationOwnerId(), connectionId: current.connection.id, allowedConnectionIds: [current.connection.id],
          toolAudience: 'app', caller: sessionCaller(chatId), signal: abort, captureOriginalResult: value => { original = value; },
        });
        if (!outcome.ok) throw new Error(outcome.reason === 'error' ? outcome.message : `Its search needs attention (${outcome.reason}).`);
        const items = record(record(original).structuredContent).items;
        if (!Array.isArray(items)) throw new Error('Its search returned no items list.');
        const account = decodeSource(current.sourceRef);
        const mentions: AppMention[] = [];
        const seen = new Set<string>();
        for (const raw of items) {
          if (mentions.length >= MENTIONS_PER_APP) break;
          const mention = mentionItem(raw, account);
          if (mention && !seen.has(mention.sourceRef)) { seen.add(mention.sourceRef); mentions.push(mention); }
        }
        const several = metadata.servers.filter(s => (s.entry.providerId ?? `mcp_${s.entry.slug}`) === toolkitId).length > 1;
        const connection = metadata.connections.find(c => c.id === current.connection.id);
        const accountLabel = connection?.label || connection?.email || connection?.accountId;
        return { group: { serverId: entry.id, app, ...(several && accountLabel ? { account: accountLabel } : {}), icons: entry.protocol?.info?.icons ?? [], items: mentions } };
      });
    } catch (error) {
      return skip(error instanceof Error ? error.message : 'Its search failed.');
    }
  }));
  return {
    groups: results.flatMap(result => 'group' in result && result.group.items.length ? [result.group] : []),
    skipped: results.flatMap(result => 'skipped' in result ? [result.skipped] : []),
  };
}

/** The server whose account a reference names, from the cached catalog. */
async function serverFor(reference: SourceReference) {
  if (reference.kind !== 'integration') return null;
  const metadata = await integrationSourceMetadata();
  const pin = { accountId: reference.account.accountId, authConfigId: reference.account.authConfigId ?? undefined };
  const found = metadata.servers.find(({ entry }) => (entry.providerId ?? `mcp_${entry.slug}`) === reference.toolkitId
    && metadata.connections.some(c => c.id === hostedMcpConnectionId(entry) && pinMatchesConnection(pin, c)));
  if (!found) return null;
  const app = metadata.toolkits.find(t => t.id === reference.toolkitId)?.displayName ?? found.entry.displayName;
  return { entry: found.entry, app };
}

/**
 * A mentioned item, read for one turn. The chat's access to the account is
 * checked again first, so an item from an account the chat lost never
 * reaches the agent. Text content is capped at 32 KiB. Binary content is
 * named but not included.
 */
export async function readMentionedResource(reference: SourceReference, chatId: string, signal?: AbortSignal): Promise<MentionedResourceContext> {
  if (reference.kind !== 'integration' || !reference.resource) throw new Error('This reference does not mention an item.');
  const { uri, name } = reference.resource;
  const title = reference.resource.title ?? name ?? uri;
  const server = await serverFor(reference);
  const base = { app: server?.app ?? 'App', title, uri, ...(name ? { name } : {}) };
  if (!server) return { ...base, error: 'The app this item came from is no longer connected.' };
  try {
    return await deadline(MENTION_READ_TIMEOUT_MS, signal, async () => {
      const current = await authority(server.entry.id, chatId);
      if (current.sourceRef !== encodeSource(accountSource(reference))) throw new Error('This account changed since the item was mentioned.');
      const result = await current.transport.readResource({ uri });
      const contents = Array.isArray(result?.contents) ? result.contents.map(record) : [];
      const textual = contents.find(content => typeof content.text === 'string');
      const mimeType = text((textual ?? contents[0])?.mimeType, 100);
      if (!textual) return { ...base, ...(mimeType ? { mimeType } : {}), error: contents.length ? 'This item is binary, so only its name and URI are shared.' : 'The app returned nothing for this item.' };
      const bytes = new TextEncoder().encode(textual.text as string);
      const truncated = bytes.length > MENTION_CONTENT_BYTES;
      const content = truncated ? new TextDecoder().decode(bytes.slice(0, MENTION_CONTENT_BYTES)).replace(/�+$/, '') : textual.text as string;
      return { ...base, ...(mimeType ? { mimeType } : {}), content, ...(truncated ? { truncated: true } : {}) };
    });
  } catch (error) {
    return { ...base, error: `Ri could not read this item: ${error instanceof Error ? error.message : 'the app did not answer'}` };
  }
}
