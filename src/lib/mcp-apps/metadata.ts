import type { McpCapabilityTool } from '@/lib/integrations/mcp-capabilities';
import { safeMcpIcons, type McpIcon } from '@/lib/integrations/mcp-icons';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 200) => typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;

/**
 * A file extension as OpenAI's file entrypoint names one: the `accept` form,
 * a dot and at least one character, compared without case.
 */
const extension = (value: unknown) => typeof value === 'string' && /^\.[^\s/\\]{1,32}$/.test(value.trim()) ? value.trim().toLowerCase() : null;

/**
 * Where a tool's interface can open, from `_meta["openai/ui"].entrypoints`
 * (OpenAI's MCP extensions spec, "MCP App Entrypoints"). `global` is a screen
 * of its own, `thread` a tab beside one chat, and `file` the viewer for the
 * listed extensions. A tool without a UI resource has no entrypoints, since
 * there is nothing to open.
 */
export interface Entrypoints { global: boolean; thread: boolean; file: string[] }

export function viewMetadata(tool: Pick<McpCapabilityTool, '_meta'>) {
  const meta = record(tool._meta), ui = record(meta.ui);
  const resource = ui.resourceUri ?? meta['ui/resourceUri'] ?? meta['openai/outputTemplate'];
  if (typeof resource !== 'string' || !resource.startsWith('ui://') || resource.length > 2048) return null;
  const visibility = Array.isArray(ui.visibility) ? ui.visibility : ['model', 'app'];
  const entrypoints = Array.isArray(record(meta['openai/ui']).entrypoints) ? record(meta['openai/ui']).entrypoints as unknown[] : [];
  const kinds = entrypoints.map(record);
  const file = [...new Set(kinds.filter(item => item.type === 'file').flatMap(item => Array.isArray(item.extensions) ? item.extensions.map(extension).filter((value): value is string => !!value) : []))].slice(0, 64);
  return { resourceUri: resource, model: visibility.includes('model'), app: visibility.includes('app'),
    global: kinds.some(item => item.type === 'global'), thread: kinds.some(item => item.type === 'thread'), file,
    legacy: typeof meta['openai/outputTemplate'] === 'string' };
}
export function appToolVisible(tool: Pick<McpCapabilityTool, '_meta'>) {
  const meta = record(tool._meta), ui = record(meta.ui);
  if (Array.isArray(ui.visibility)) return ui.visibility.includes('app');
  // The old bridge required an explicit widget-accessible declaration.
  if (meta['openai/widgetAccessible'] === false) return false;
  return true;
}
export function modelToolVisible(tool: Pick<McpCapabilityTool, '_meta'>) {
  const visibility = record(record(tool._meta).ui).visibility;
  return !Array.isArray(visibility) || visibility.includes('model');
}

/** A tool's display title, in the order OpenAI's spec resolves it: `title`, then `annotations.title`, then `name`. */
export function toolTitle(tool: Pick<McpCapabilityTool, 'name' | 'title' | 'annotations'>) {
  return text(tool.title) ?? text(record(tool.annotations).title) ?? tool.name;
}

/**
 * An entrypoint's icon, in the spec's order: the tool's own `icons`, then the
 * server's (`serverInfo.icons` from discovery), then none, which the UI shows
 * as a generic mark.
 */
export function entrypointIcons(tool: Pick<McpCapabilityTool, 'icons'>, serverIcons?: readonly McpIcon[]): McpIcon[] {
  const own = safeMcpIcons(tool.icons);
  return own.length ? own : [...(serverIcons ?? [])];
}

export type DisplayMode = 'inline' | 'fullscreen';
/**
 * The display modes a UI resource declares on its content item, in
 * `_meta["openai/ui"]` (OpenAI's "Display Modes"). Ri shows views inline and
 * full screen, never picture-in-picture, so `pip` drops out. An empty or
 * absent list means every mode Ri has.
 */
export function resourceDisplayModes(meta: unknown): { available: DisplayMode[]; preferred?: DisplayMode } {
  const ui = record(record(meta)['openai/ui']);
  const known = (value: unknown): value is DisplayMode => value === 'inline' || value === 'fullscreen';
  const declared = Array.isArray(ui.availableDisplayModes) ? [...new Set(ui.availableDisplayModes.filter(known))] : [];
  const available: DisplayMode[] = declared.length ? declared : ['inline', 'fullscreen'];
  const preferred = known(ui.preferredDisplayMode) && available.includes(ui.preferredDisplayMode) ? ui.preferredDisplayMode : undefined;
  return { available, ...(preferred ? { preferred } : {}) };
}

/**
 * Whether a UI resource lists the display modes it supports. Only a list
 * naming a mode Ri has counts: OpenAI's spec reads an omitted
 * `availableDisplayModes` as every mode, opening inline on desktop, and any
 * other `openai/ui` field (a preferred mode alone, a quick action) is not a
 * list. A list of only modes Ri lacks (`pip`) is read as omitted.
 */
export function declaresDisplayModes(meta: unknown): boolean {
  const list = record(record(meta)['openai/ui']).availableDisplayModes;
  return Array.isArray(list) && list.some(value => value === 'inline' || value === 'fullscreen');
}

/**
 * How a model-run result first shows in chat. A preferred mode wins. A
 * resource that declares both modes opens full screen, as ChatGPT does, and
 * one that declares nothing stays inline, as ChatGPT desktop does.
 */
export function initialDisplayMode(modes: ReturnType<typeof resourceDisplayModes>, declared: boolean): DisplayMode {
  if (modes.preferred) return modes.preferred;
  if (!declared) return 'inline';
  return modes.available.includes('fullscreen') ? 'fullscreen' : modes.available[0] ?? 'inline';
}

/** `capabilities.extensions["openai/settings"]`: the tools that read and update a server's settings. */
export function settingsCapability(extensions: unknown): { readTool: string; updateTool: string } | null {
  const settings = record(record(extensions)['openai/settings']);
  const readTool = text(settings.readTool), updateTool = text(settings.updateTool);
  return readTool && updateTool ? { readTool, updateTool } : null;
}

/**
 * The tool that answers @ search for a server: `openai/mentions.searchTool`
 * from its capabilities, or the deprecated per-tool marker
 * `_meta["openai/extensions"]["mentions/search"]` when the capability is absent.
 */
export function mentionsSearchTool(extensions: unknown, tools: readonly Pick<McpCapabilityTool, 'name' | '_meta'>[]): string | null {
  const declared = text(record(record(extensions)['openai/mentions']).searchTool);
  if (declared) return declared;
  return tools.find(tool => Object.hasOwn(record(record(tool._meta)['openai/extensions']), 'mentions/search'))?.name ?? null;
}

/**
 * The transcript marker of a model tool result with a view, in `content` and
 * `raw.subtype`. The event carries only its id: the result's data is its row
 * in `mcp_tool_results`, and private UI metadata never reaches the transcript.
 */
export const MCP_TOOL_RESULT_EVENT = 'mcp_tool_result';
/** Every marker a tool result has been written with: rows from before October 20, 2026 say `mcp_app_result`. */
export const MCP_TOOL_RESULT_EVENTS: ReadonlySet<string> = new Set([MCP_TOOL_RESULT_EVENT, 'mcp_app_result']);
