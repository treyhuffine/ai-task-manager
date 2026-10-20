import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/core";
import type { CallToolResult, JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { viewPolicy, type ViewCsp } from "@ri/mcp-apps-host/csp";

export { cspSource, declaredCsp, declaresNetwork, NO_NETWORK, viewPolicy, type ViewCsp } from "@ri/mcp-apps-host/csp";

export interface ViewHtml {
  html: string;
  /** The network domains the view declared. None means no network (`viewPolicy`). */
  csp?: ViewCsp;
}
export interface ViewBinding {
  id: string;
  packageDigest: string;
  initialData: unknown;
  path: string;
  query: Record<string, string>;
  theme: "light" | "dark";
  files?: { select?: {mimeTypes: readonly string[]; maxBytes: number}; download?: {mimeTypes: readonly string[]; maxBytes: number} };
  /** Remote tools use the ordinary MCP envelope, including private UI metadata. */
  mcp?: { input: Record<string, unknown>; result: CallToolResult; widgetState?: unknown };
  displayMode?: 'inline' | 'fullscreen';
  /**
   * The modes this view can switch between, when the page handles
   * `ui/request-display-mode`. Defaults to both. A view whose page cannot
   * switch it is offered only the mode it is in.
   */
  displayModes?: readonly ('inline' | 'fullscreen')[];
  /** `platform` in the host context. Ri is a web host, including in its desktop shell. */
  platform?: 'web' | 'desktop' | 'mobile';
  /**
   * Further host context the view receives at initialization, such as OpenAI's
   * `openai/deepLink` and `openai/modelContext`. Later changes go through
   * `AppViewController.hostContextChanged`.
   */
  hostContext?: Record<string, unknown>;
  /**
   * The view was opened for a file (OpenAI's file entrypoint), so it is told
   * it may read, watch and write that file through the host (`openai/resource`).
   */
  fileResource?: boolean;
}
/** A content block from `ui/message` or `ui/update-model-context`: text, image, resource link or embedded resource. */
export type ViewContentBlock = { type: string; [key: string]: unknown };
/**
 * `ui/message` with OpenAI's `_meta["openai/message"].target` resolved
 * (`active` by default). Its `send` is not read: everything an app writes
 * becomes a draft the person sends (docs/connected-mcp-apps.md, "Messages").
 */
export interface ViewMessage {
  content: ViewContentBlock[]; target: 'active' | 'new';
}
/** OpenAI's `openai/resources/write` request and result. */
export type ResourceWrite = { uri: string; ifMatch?: string } & ({ text: string; blob?: never } | { blob: string; text?: never });
export type ResourceWriteResult = { outcome: 'saved' | 'conflict'; etag: string } | { outcome: 'too-large'; maxBytes: number };
export interface ResourceRead { contents: { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown> }[]; _meta?: Record<string, unknown> }
/** Guest-chosen invocation ID for a retryable write, carried in the MCP tools/call `_meta`. */
export const INVOCATION_META = "ri/invocationId";
export interface ViewCallbacks {
  call(action: string, input: unknown, signal: AbortSignal, meta?: { invocationId?: string }): Promise<unknown>;
  /** Returns OpenAI's `updateId` for the accepted context when the page keeps one (`modelContext`). */
  context(envelope: unknown, signal: AbortSignal): Promise<void | { updateId?: string }>;
  navigate(path: string): Promise<void> | void;
  externalLink(url: string): Promise<void> | void;
  error(error: Error): void;
  ready?(): void;
  resize?(height: number): void;
  message?(text: string): void;
  /**
   * OpenAI's `ui/message` extension: any supported content, put in a draft
   * in this chat or a new one, for the person to send. Takes precedence over
   * `message`.
   */
  sendMessage?(message: ViewMessage, signal: AbortSignal): Promise<void>;
  /**
   * OpenAI's `ui/update-model-context` extension: titled, thumbnailed and
   * assistant-only content beyond text, with an `updateId` per change.
   */
  modelContext?: boolean;
  /** Byte cap for one context update. Defaults to 8 KiB. */
  contextLimit?: number;
  /** `resources/read` from the view: its own server's resources, or the opened file. */
  readResource?(params: { uri: string; _meta?: Record<string, unknown> }, signal: AbortSignal): Promise<ResourceRead>;
  subscribeResource?(uri: string, signal: AbortSignal): Promise<void>;
  unsubscribeResource?(uri: string, signal: AbortSignal): Promise<void>;
  /** OpenAI's `openai/resources/write` for the file a file entrypoint opened. */
  writeResource?(params: ResourceWrite, signal: AbortSignal): Promise<ResourceWriteResult>;
  /** OpenAI's `openai/files/open`: show a file at an absolute path in Ri's viewer. */
  openFile?(path: string, signal: AbortSignal): Promise<void>;
  displayMode?(mode: 'inline' | 'fullscreen' | 'pip'): void;
  selectFile?(signal: AbortSignal): Promise<{name: string; mimeType: string; base64: string} | null>;
  downloadFile?(contents: unknown[], signal: AbortSignal): Promise<void>;
}
/**
 * Runs first in every view. A form's submit handlers run (the frame allows
 * forms, as apps written for ChatGPT expect), but no form ever navigates the
 * frame: a submission its handlers left alone is cancelled once they have run,
 * and a programmatic `form.submit()` does nothing. CSP's `form-action 'none'`
 * would block the request anyway. Cancelling first keeps the view alive
 * instead of leaving it on an error page.
 */
export const FORM_GUARD = `(()=>{addEventListener('submit',e=>{if(!e.defaultPrevented)e.preventDefault()});HTMLFormElement.prototype.submit=function(){}})()`;
/**
 * What a view may send Ri, checked by the relay frame before anything reaches
 * Ri's page, so an app can't freeze Ri's tab with one huge message or a flood
 * of them. In characters of serialized JSON: up to 16 MiB plus room for the
 * envelope, which carries an `openai/resources/write` of 12 MiB of binary
 * (16 MiB as base64), and 100 messages or 24 MiB a second. A view receives up
 * to 64 MiB (a model file it reads, which Bits & Bolts sends at about 6 MB).
 * A request too large or too fast is answered with an error, never dropped.
 */
export const GUEST_MESSAGE_LIMIT = 16 * 1024 * 1024 + 64 * 1024;
export const HOST_MESSAGE_LIMIT = 64 * 1024 * 1024;
/** What a view may send in one second, all messages together: one largest message and a little more. */
export const GUEST_BYTES_PER_SECOND = 24 * 1024 * 1024;
/** Requests a view may send in one second. */
export const GUEST_MESSAGES_PER_SECOND = 100;
// The relay contains no app authority. The same fixed script serves all views.
// It passes messages between Ri and the guest, refusing (with a JSON-RPC error)
// one that is too large or part of a flood. For the focus guard it answers Ri's
// question about what only it can see, whether it has transient user
// activation (only the person's input inside the view gives it), and returns
// focus to the guest when Ri asks (`focusGuard`).
export const RELAY_SCRIPT = `(()=>{let inner=null,id=null,digest=null;let attempts=0;const ready=()=>{if(!inner&&++attempts<=200)parent.postMessage({type:'ri-relay-ready'},'*');else clearInterval(timer)};const timer=setInterval(ready,100);let count=0,bytes=0,windowStart=Date.now();const active=()=>navigator.userActivation?.isActive===true;const say=m=>parent.postMessage({...m,id,packageDigest:digest},'*');const refuse=(m,message)=>{if('id' in m&&typeof m.method==='string')inner.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32600,message}},'*')};addEventListener('message',e=>{const d=e.data;if(e.source===parent){if(!id&&d?.type==='ri-view-init'&&typeof d.id==='string'&&typeof d.html==='string'){id=d.id;digest=d.packageDigest;clearInterval(timer);inner=document.createElement('iframe');inner.sandbox='allow-scripts allow-forms';inner.style='width:100%;height:100%;border:0';inner.srcdoc=d.html;document.body.append(inner)}else if(inner&&d?.id===id&&d.packageDigest===digest){if(d.type==='ri-view-message'&&d.message&&typeof d.message==='object'&&d.message.jsonrpc==='2.0'&&JSON.stringify(d.message).length<=${HOST_MESSAGE_LIMIT})inner.contentWindow.postMessage(d.message,'*');else if(d.type==='ri-view-focus-check')say({type:'ri-view-focus',active:active()});else if(d.type==='ri-view-refocus')inner.focus()}}else if(inner&&e.source===inner.contentWindow&&d&&typeof d==='object'&&d.jsonrpc==='2.0'){let size;try{size=JSON.stringify(d).length}catch{return}if(Date.now()-windowStart>1000){windowStart=Date.now();count=0;bytes=0}if(size>${GUEST_MESSAGE_LIMIT}){refuse(d,'This message is larger than Ri accepts from an app (16 MiB).');return}if(++count>${GUEST_MESSAGES_PER_SECOND}||(bytes+=size)>${GUEST_BYTES_PER_SECOND}){refuse(d,'This app is sending too much too quickly. Try again in a moment.');return}say({type:'ri-view-message',message:d})}});ready()})()`;
const ALLOWED = new Set([
  "ping",
  "ui/initialize",
  "ui/notifications/initialized",
  "tools/call",
  "ui/update-model-context",
  "ui/open-link",
  "ui/download-file",
  "ui/message",
  "ui/request-display-mode",
  "ui/notifications/size-changed",
  "notifications/cancelled",
  // Answered only when the page supplies the matching callback. Otherwise the
  // bridge has no handler and refuses the method.
  "resources/read",
  "resources/subscribe",
  "resources/unsubscribe",
  "openai/resources/write",
  "openai/files/open",
]);
/** A schema that accepts any value, for OpenAI's methods the SDK does not know. */
function passthrough() {
  return { "~standard": { version: 1 as const, vendor: "ri", validate: (value: unknown) => ({ value }) } };
}
function injectPolicy(html: string, policy: string) {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}
/** Focus that arrives within this long of a Tab key in Ri's page came by keyboard. */
const TAB_MS = 1_000;
/**
 * Focus moving into a view (docs/connected-mcp-apps.md, "Security"). Chromium
 * and Firefox let a cross-origin frame call `focus()` on its own elements and
 * take focus from Ri's page, so typing meant for Ri's composer would land in
 * the app (WebKit refuses that itself). Ri keeps focus entering a view only as
 * the person moves it there: right after a Tab key in Ri's page, or by a click
 * in the view. Ri's page can't see that click, so it puts focus back where it
 * was at once, asks the view's relay frame whether a click gave it activation,
 * and only then returns focus to the view. With the pointer off the view it
 * doesn't ask: no click there moved focus. Ri's page sees focus enter a view
 * as its own window losing focus. Focus moving from one view straight to
 * another happens out of its sight and isn't guarded, and within the
 * browser's activation window after a click in a view, with the pointer
 * still on it, the view can take focus back.
 */
const focusGuard = {
  views: new Set<{ frame: HTMLIFrameElement; entered(): void }>(),
  installed: false,
  /** The element in Ri's page that had focus before it entered a view. */
  last: null as HTMLElement | null,
  tabAt: -Infinity,
  install() {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;
    document.addEventListener("keydown", (event) => { if (event.key === "Tab") this.tabAt = Date.now(); }, true);
    document.addEventListener("focusin", (event) => { if (event.target instanceof HTMLElement && event.target.tagName !== "IFRAME") this.last = event.target; }, true);
    // A focus change made inside the blur that reports one is ignored, so decide just after it.
    window.addEventListener("blur", () => queueMicrotask(() => {
      for (const view of this.views) if (view.frame === document.activeElement) view.entered();
    }));
  },
};
class OpaqueTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onerror?: Transport["onerror"];
  onclose?: Transport["onclose"];
  /** The relay's answer to `ri-view-focus-check`: whether it has activation (`focusGuard`). */
  onfocus?: (active: boolean) => void;
  private listening = false;
  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly binding: ViewBinding,
    private readonly guest: ViewHtml,
  ) {}
  private receive = (event: MessageEvent) => {
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data;
    if (data?.type === "ri-relay-ready") {
      this.iframe.contentWindow!.postMessage(
        {
          type: "ri-view-init",
          id: this.binding.id,
          packageDigest: this.binding.packageDigest,
          html: this.guest.html,
        },
        "*",
      );
      return;
    }
    if (data?.id !== this.binding.id || data.packageDigest !== this.binding.packageDigest) return;
    if (data.type === "ri-view-focus") {
      this.onfocus?.(data.active === true);
      return;
    }
    if (data.type !== "ri-view-message") return;
    const parsed = JSONRPCMessageSchema.safeParse(data.message);
    if (!parsed.success) {
      this.onerror?.(new Error("Invalid app message"));
      return;
    }
    const message = parsed.data;
    if ("method" in message && !ALLOWED.has(message.method)) {
      if ("id" in message)
        void this.send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: "This view capability is unavailable",
          },
        });
      return;
    }
    this.onmessage?.(message);
  };
  async start() {
    if (!this.listening) {
      window.addEventListener("message", this.receive);
      this.listening = true;
    }
  }
  /** Ask the relay for its activation, or have it give the guest back the focus Ri held while asking. */
  signal(type: "ri-view-focus-check" | "ri-view-refocus") {
    if (this.listening) this.iframe.contentWindow?.postMessage({ type, id: this.binding.id, packageDigest: this.binding.packageDigest }, "*");
  }
  async send(message: JSONRPCMessage) {
    if (this.listening)
      this.iframe.contentWindow?.postMessage(
        {
          type: "ri-view-message",
          id: this.binding.id,
          packageDigest: this.binding.packageDigest,
          message,
        },
        "*",
      );
  }
  async close() {
    if (this.listening) {
      window.removeEventListener("message", this.receive);
      this.listening = false;
      this.onclose?.();
    }
  }
}
export class AppViewController {
  private frame?: HTMLIFrameElement;
  private bridge?: AppBridge;
  private transport?: OpaqueTransport;
  private guarded?: { frame: HTMLIFrameElement; entered(): void };
  private contextTail: Promise<void> = Promise.resolve();
  private contextError: Error | null = null;
  private disposed = false;
  private lifecycle = 0;
  constructor(
    private readonly mount: HTMLElement,
    private readonly callbacks: ViewCallbacks,
  ) {}
  async open(resource: ViewHtml, binding: ViewBinding) {
    const lifecycle = ++this.lifecycle;
    await this.disposeBridge();
    if (lifecycle !== this.lifecycle) return;
    this.disposed = false;
    // One policy for both frames: the view's own document inherits the relay's, and gets its own copy too.
    const policy = viewPolicy(resource.csp);
    const iframe = document.createElement("iframe");
    // Forms may run their submit handlers, as apps written for ChatGPT expect. The view's CSP
    // (`form-action 'none'`) still stops any form from actually submitting or navigating.
    iframe.sandbox.add("allow-scripts", "allow-forms");
    iframe.setAttribute("aria-label", "App view");
    iframe.style.cssText = "width:100%;height:100%;border:0;min-height:240px";
    this.mount.append(iframe);
    this.frame = iframe;
    const transport = new OpaqueTransport(iframe, binding, {
      ...resource,
      html: injectPolicy(`<script>${FORM_GUARD}</script>${resource.html}`, policy),
    });
    this.transport = transport;
    this.guardFocus(iframe, transport);
    const callbacks = this.callbacks;
    // Each OpenAI extension is advertised only when this page can honor it
    // (OpenAI's MCP extensions spec reads them from `experimental`).
    const experimental: Record<string, object> = {
      ...(callbacks.modelContext ? { "openai/modelContext": {} } : {}),
      ...(callbacks.sendMessage ? { "openai/message": {} } : {}),
      ...(binding.fileResource && callbacks.readResource ? { "openai/resource": {} } : {}),
      ...(callbacks.openFile ? { "openai/files": {} } : {}),
    };
    const richContent = { text: {}, image: {}, resourceLink: {}, resource: {} };
    const bridge = new AppBridge(
      null,
      { name: "Ri", version: "1.0.0" },
      {
        serverTools: {},
        updateModelContext: callbacks.modelContext ? { ...richContent, structuredContent: {} } : { text: {} },
        openLinks: {},
        ...(callbacks.sendMessage ? { message: richContent } : callbacks.message ? { message: { text: {} } } : {}),
        ...(callbacks.readResource ? { serverResources: {} } : {}),
        ...(binding.files?.download && callbacks.downloadFile ? { downloadFile: {} } : {}),
        ...(Object.keys(experimental).length ? { experimental } : {}),
      },
      {
        hostContext: {
          ...binding.hostContext,
          theme: binding.theme,
          platform: binding.platform ?? "web",
          displayMode: binding.displayMode ?? "inline",
          // Only the modes this view's place can switch it to. Without a page to switch it, the one it is in.
          availableDisplayModes: callbacks.displayMode ? [...(binding.displayModes ?? ["inline", "fullscreen"])] : [binding.displayMode ?? "inline"],
        },
      },
    );
    this.bridge = bridge;
    bridge.oncalltool = async (params, extra) => {
      if (!binding.mcp && params.name === 'ri_select_file') {
        if (!binding.files?.select || !this.callbacks.selectFile || Object.keys(params.arguments ?? {}).length) throw new Error('File selection is unavailable');
        const file = await this.callbacks.selectFile(extra.mcpReq.signal);
        return {content: [{type:'text', text:file ? 'File selected' : 'Selection cancelled'}], structuredContent:{file}};
      }
      const requested = (params as { _meta?: Record<string, unknown> })._meta?.[INVOCATION_META];
      if (requested !== undefined && (typeof requested !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested)))
        throw new Error('The app supplied an invalid invocation ID');
      const result = await this.callbacks.call(
        params.name,
        params.arguments ?? {},
        extra.mcpReq.signal,
        requested ? { invocationId: requested } : undefined,
      );
      if (binding.mcp) return result as CallToolResult;
      return {
        content: [{ type: "text", text: "App operation completed" }],
        structuredContent: result as Record<string, unknown>,
      };
    };
    bridge.onupdatemodelcontext = async (params, extra) => {
      if (new TextEncoder().encode(JSON.stringify(params)).byteLength > (callbacks.contextLimit ?? 8192))
        throw new Error('The app context is too large');
      const text = params.content?.find(
        (item: { type: string; text?: string }) => item.type === "text",
      ) as { type: string; text: string } | undefined;
      if (
        !binding.mcp && (!text ||
        text.type !== "text" ||
        new TextEncoder().encode(text.text).byteLength > 8192)
      )
        throw new Error("The app context is invalid or too large");
      const envelope = binding.mcp ? params : JSON.parse(text!.text);
      const request = this.contextTail.then(() =>
        this.callbacks.context(envelope, extra.mcpReq.signal),
      );
      this.contextTail = request.then(
        () => {
          this.contextError = null;
        },
        (error) => {
          this.contextError = error as Error;
          this.callbacks.error(error as Error);
        },
      );
      const accepted = await request;
      // OpenAI's model context extension names each accepted update.
      return accepted?.updateId ? { _meta: { "openai/modelContext": { updateId: accepted.updateId } } } : {};
    };
    bridge.onopenlink = async (params) => {
      if (params.url.startsWith("/") && !params.url.startsWith("//"))
        await this.callbacks.navigate(params.url);
      else {
        const url = new URL(params.url);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("Only HTTPS links can be opened");
        await this.callbacks.externalLink(url.href);
      }
      return {};
    };
    bridge.ondownloadfile = async (params, extra) => {
      if (!binding.files?.download || !this.callbacks.downloadFile) throw new Error('File downloads are unavailable');
      await this.callbacks.downloadFile(params.contents, extra.mcpReq.signal);
      return {};
    };
    bridge.onsizechange = (params) => {
      if (typeof params.height === 'number' && Number.isFinite(params.height)) this.callbacks.resize?.(Math.max(160, Math.min(900, params.height)));
    };
    bridge.onmessage = async (params, extra) => {
      if (callbacks.sendMessage) {
        // ext-apps' `ui/message` schema strips `params._meta`. The request's own `_meta` survives on the context.
        const meta = (params as { _meta?: Record<string, unknown> })._meta ?? (extra.mcpReq as { _meta?: Record<string, unknown> })._meta;
        const options = meta?.["openai/message"] as { target?: unknown } | undefined;
        if (options !== undefined && (typeof options !== 'object' || options === null || (options.target !== undefined && options.target !== 'active' && options.target !== 'new')))
          throw new Error('The message options are invalid');
        if (!params.content.length || params.content.some((item: {type: string}) => !['text', 'image', 'resource_link', 'resource'].includes(item.type)))
          throw new Error('This message type is unavailable');
        await callbacks.sendMessage({ content: params.content as ViewContentBlock[], target: options?.target === 'new' ? 'new' : 'active' }, extra.mcpReq.signal);
        return {};
      }
      if (!this.callbacks.message || params.content.some((item: {type: string}) => item.type !== 'text')) throw new Error('This message type is unavailable');
      const text = params.content.map((item: {type: string; text?: string}) => item.type === 'text' ? item.text : '').join('\n');
      if (new TextEncoder().encode(text).byteLength > 8192) throw new Error('The app message is too large');
      this.callbacks.message(text);
      return {};
    };
    bridge.onrequestdisplaymode = async ({mode}) => {
      // A mode the UI resource did not declare is refused, as is picture-in-picture, which Ri does not offer.
      if (!this.callbacks.displayMode || mode === 'pip' || (binding.displayModes && !binding.displayModes.includes(mode))) throw new Error('This display mode is unavailable');
      await this.flushContext();
      this.callbacks.displayMode(mode);
      return {mode};
    };
    if (callbacks.readResource) {
      const read = callbacks.readResource;
      bridge.onreadresource = async (params, extra) => {
        if (typeof params.uri !== 'string' || !params.uri || params.uri.length > 4096) throw new Error('Invalid resource URI');
        return await read({ uri: params.uri, ...(params._meta ? { _meta: params._meta as Record<string, unknown> } : {}) }, extra.mcpReq.signal) as never;
      };
    }
    const uriParams = (params: unknown) => {
      const uri = (params as { uri?: unknown } | undefined)?.uri;
      if (typeof uri !== 'string' || !uri || uri.length > 4096) throw new Error('Invalid resource URI');
      return uri;
    };
    if (callbacks.subscribeResource) {
      const subscribe = callbacks.subscribeResource;
      bridge.setRequestHandler('resources/subscribe', async (request, ctx) => { await subscribe(uriParams(request.params), ctx.mcpReq.signal); return {}; });
    }
    if (callbacks.unsubscribeResource) {
      const unsubscribe = callbacks.unsubscribeResource;
      bridge.setRequestHandler('resources/unsubscribe', async (request, ctx) => { await unsubscribe(uriParams(request.params), ctx.mcpReq.signal); return {}; });
    }
    if (callbacks.writeResource) {
      const write = callbacks.writeResource;
      bridge.setRequestHandler('openai/resources/write', { params: passthrough(), result: passthrough() }, async (params: unknown, ctx: { mcpReq: { signal: AbortSignal } }) => {
        const request = (params ?? {}) as Record<string, unknown>;
        const uri = uriParams(request);
        if (request.ifMatch !== undefined && (typeof request.ifMatch !== 'string' || !request.ifMatch)) throw new Error('Invalid ifMatch');
        const text = typeof request.text === 'string' ? request.text : undefined, blob = typeof request.blob === 'string' ? request.blob : undefined;
        if ((text === undefined) === (blob === undefined)) throw new Error('Write exactly one of text or blob');
        return await write({ uri, ...(request.ifMatch ? { ifMatch: request.ifMatch as string } : {}), ...(text !== undefined ? { text } : { blob: blob! }) } as ResourceWrite, ctx.mcpReq.signal);
      });
    }
    if (callbacks.openFile) {
      const open = callbacks.openFile;
      bridge.setRequestHandler('openai/files/open', { params: passthrough(), result: passthrough() }, async (params: unknown, ctx: { mcpReq: { signal: AbortSignal } }) => {
        const path = (params as { path?: unknown } | undefined)?.path;
        if (typeof path !== 'string' || !path || path.length > 4096) throw new Error('Invalid file path');
        await open(path, ctx.mcpReq.signal);
        return {};
      });
    }
    bridge.oninitialized = () => {
      if (binding.mcp?.widgetState !== undefined) void transport.send({jsonrpc: '2.0', method: 'ri/view-state', params: {widgetState: binding.mcp.widgetState}});
      void bridge
        .sendToolInput({
          arguments: binding.mcp?.input ?? { path: binding.path, query: binding.query },
        })
        .then(() =>
          bridge.sendToolResult(binding.mcp?.result ?? {
            content: [{ type: "text", text: "Opened app view" }],
            structuredContent: binding.initialData as Record<string, unknown>,
          }),
        )
        .then(() => this.callbacks.ready?.())
        .catch((error) => this.callbacks.error(error));
    };
    bridge.onerror = (error) => this.callbacks.error(error);
    await bridge.connect(transport);
    if (lifecycle !== this.lifecycle || this.disposed) return;
    iframe.srcdoc = injectPolicy(
      `<style>html,body{margin:0;width:100%;height:100%}</style><body><script>${RELAY_SCRIPT}</script></body>`,
      policy,
    );
  }
  async refresh(data: unknown) {
    await this.bridge?.sendToolResult({
      content: [{ type: "text", text: "App records refreshed" }],
      structuredContent: data as Record<string, unknown>,
    });
  }
  theme(theme: "light" | "dark") {
    this.bridge?.sendHostContextChange({ theme });
  }
  /** `ui/notifications/host-context-changed` with only the changed fields, such as `openai/deepLink`. */
  hostContextChanged(changes: Record<string, unknown>) {
    this.bridge?.sendHostContextChange(changes);
  }
  /** `notifications/resources/updated` for a resource the view subscribed to. */
  async resourceUpdated(uri: string) {
    await this.bridge?.notification({ method: "notifications/resources/updated", params: { uri } });
  }
  displayMode(displayMode: 'inline' | 'fullscreen') {
    this.bridge?.sendHostContextChange({displayMode});
  }
  async flushContext() {
    await this.contextTail;
    if (this.contextError) throw this.contextError;
  }
  /** Accept focus entering this view only as the person moves it (`focusGuard`). */
  private guardFocus(iframe: HTMLIFrameElement, transport: OpaqueTransport) {
    focusGuard.install();
    let over = false, ownMoveAt = -Infinity, checking = false;
    // The last mouse or touch position: a click or tap into the view is over it.
    iframe.addEventListener("mouseover", () => { over = true; });
    iframe.addEventListener("mouseout", () => { over = false; });
    const restore = () => {
      if (document.activeElement !== iframe) return;
      const back = focusGuard.last;
      if (back && back.isConnected) back.focus({ preventScroll: true });
      if (document.activeElement === iframe) iframe.blur();
    };
    transport.onfocus = (active) => {
      if (!checking) return;
      checking = false;
      if (!active) return;
      // A click in the view gave its relay activation: return the focus Ri held while it asked.
      ownMoveAt = Date.now();
      iframe.focus({ preventScroll: true });
      transport.signal("ri-view-refocus");
    };
    const guarded = {
      frame: iframe,
      entered: () => {
        const now = Date.now();
        // Ri's own move, returning focus after the relay confirmed a click.
        if (now - ownMoveAt < 300) return;
        if (now - focusGuard.tabAt < TAB_MS) return;
        // Keep the person's keys in Ri until a click in the view is confirmed.
        restore();
        if (!over) return;
        checking = true;
        setTimeout(() => { checking = false; }, 1_000);
        transport.signal("ri-view-focus-check");
      },
    };
    focusGuard.views.add(guarded);
    this.guarded = guarded;
  }
  private async disposeBridge() {
    this.disposed = true;
    if (this.guarded) focusGuard.views.delete(this.guarded);
    this.guarded = undefined;
    // Capture this generation before yielding. A later open owns different
    // resources and must not be removed by an earlier asynchronous teardown.
    const bridge = this.bridge, transport = this.transport, frame = this.frame;
    this.bridge = undefined;
    this.transport = undefined;
    this.frame = undefined;
    try { await bridge?.close(); }
    finally {
      try { await transport?.close(); }
      finally { frame?.remove(); }
    }
  }
  async dispose() {
    ++this.lifecycle;
    await this.disposeBridge();
  }
}
