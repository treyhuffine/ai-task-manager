/**
 * The view's side of MCP Apps (spec 2026-01-26): JSON-RPC 2.0 over
 * postMessage with the host that drew it, ChatGPT, Claude or Ri. Small on
 * purpose, so the view needs no SDK and its whole page stays a few kilobytes.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */

export const MCP_APPS_PROTOCOL = '2026-01-26';

export interface HostContext {
  theme?: 'light' | 'dark';
  displayMode?: string;
  styles?: { variables?: Record<string, string | undefined>; css?: { fonts?: string } };
  locale?: string;
  timeZone?: string;
  deviceCapabilities?: { touch?: boolean; hover?: boolean };
  [key: string]: unknown;
}

export interface HostCapabilities {
  openLinks?: object;
  serverTools?: object;
  updateModelContext?: object;
  message?: object;
  experimental?: Record<string, object>;
  [key: string]: unknown;
}

export interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface BridgeHandlers {
  toolInput?(args: Record<string, unknown>): void;
  toolResult?(result: ToolResult): void;
  hostContext?(context: HostContext): void;
  cancelled?(): void;
  /** The host is about to remove the view: finish anything unsaved. The host waits for the answer. */
  teardown?(): Promise<void> | void;
}

export interface Bridge {
  readonly context: HostContext;
  readonly capabilities: HostCapabilities;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  openLink(url: string): Promise<void>;
  /** Tells the model what the person did here, for its next turn. Replaces what this view said before. */
  updateModelContext(text: string): Promise<void>;
  /**
   * Whether the host can put something in the person's message without
   * sending it (OpenAI's `ui/message` extension). A plain `ui/message` sends
   * as the person, so without this the view never offers it.
   */
  readonly canDraft: boolean;
  /** Adds a labeled item to the message the person is writing, and doesn't send it. */
  addToMessage(title: string, text: string): Promise<void>;
  sizeChanged(height: number): void;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}

const REQUEST_TIMEOUT_MS = 60_000;
const TEARDOWN_WAIT_MS = 2_000;

export function connect(handlers: BridgeHandlers, host: Window = window.parent): Promise<Bridge> {
  let sequence = 0;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const post = (message: RpcMessage) => host.postMessage({ jsonrpc: '2.0', ...message }, '*');
  const request = (method: string, params: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out`)); }, REQUEST_TIMEOUT_MS);
    waiting.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    post({ id, method, params });
  });
  const notify = (method: string, params: Record<string, unknown> = {}) => post({ method, params });

  let context: HostContext = {};
  let capabilities: HostCapabilities = {};

  window.addEventListener('message', event => {
    if (event.source !== host) return;
    const message = event.data as RpcMessage;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.method === undefined && typeof message.id === 'number' && waiting.has(message.id)) {
      const pending = waiting.get(message.id)!;
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'The host refused'));
      else pending.resolve(message.result);
      return;
    }
    const params = message.params ?? {};
    switch (message.method) {
      case 'ui/notifications/tool-input': handlers.toolInput?.((params.arguments as Record<string, unknown>) ?? {}); break;
      case 'ui/notifications/tool-result': handlers.toolResult?.(params as ToolResult); break;
      case 'ui/notifications/tool-cancelled': handlers.cancelled?.(); break;
      case 'ui/notifications/host-context-changed':
        context = { ...context, ...(params as HostContext) };
        handlers.hostContext?.(context);
        break;
      default:
        // A request the view doesn't serve still gets an answer, so the host never waits on it.
        if (message.id !== undefined && message.method) {
          const id = message.id;
          if (message.method === 'ui/resource-teardown') {
            // A save on its way gets a moment to land, never long enough to hold the host up.
            const done = Promise.resolve(handlers.teardown?.()).catch(() => {});
            void Promise.race([done, new Promise(resolve => setTimeout(resolve, TEARDOWN_WAIT_MS))]).then(() => post({ id, result: {} }));
          } else if (message.method === 'ping') post({ id, result: {} });
          else post({ id, error: { message: `The view doesn't handle ${message.method}` } } as RpcMessage);
        }
    }
  });

  return request('ui/initialize', {
    protocolVersion: MCP_APPS_PROTOCOL,
    appInfo: { name: 'Ri', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  }).then(result => {
    const init = (result ?? {}) as { hostContext?: HostContext; hostCapabilities?: HostCapabilities };
    context = init.hostContext ?? {};
    capabilities = init.hostCapabilities ?? {};
    notify('ui/notifications/initialized');
    return {
      get context() { return context; },
      get capabilities() { return capabilities; },
      callTool: (name, args) => request('tools/call', { name, arguments: args }) as Promise<ToolResult>,
      openLink: async url => { await request('ui/open-link', { url }); },
      updateModelContext: async text => {
        if (!capabilities.updateModelContext) return;
        await request('ui/update-model-context', { content: [{ type: 'text', text }] });
      },
      sizeChanged: height => notify('ui/notifications/size-changed', { height }),
      get canDraft() { return Boolean(capabilities.message && (capabilities.experimental?.['openai/message'] || capabilities['openai/message'])); },
      addToMessage: async (title, text) => {
        await request('ui/message', {
          role: 'user',
          content: [{ type: 'text', text, _meta: { 'openai/title': title } }],
          _meta: { 'openai/message': { target: 'active', send: false } },
        });
      },
    } satisfies Bridge;
  });
}
