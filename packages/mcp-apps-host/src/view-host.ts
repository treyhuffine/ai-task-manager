import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/core";
import type { CallToolResult, JSONRPCMessage, Transport } from "@modelcontextprotocol/client";

export interface ViewHtml {
  html: string;
  scriptHashes: string[];
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
/** `ui/message` with OpenAI's `_meta["openai/message"]` resolved to its defaults (`active`, sent). */
export interface ViewMessage {
  content: ViewContentBlock[]; target: 'active' | 'new'; send: boolean;
  /**
   * The person's own input inside this view led to the request: Ri's relay
   * frame, the guest's parent, had transient user activation when it passed
   * the request on. Browsers give an ancestor frame activation only for real
   * input in its subtree, never for script calling `focus()`, and never for
   * input elsewhere in Ri. Activation the person gave before focus left the
   * view, or that followed focus the app took for itself, does not count for
   * the rest of its window (`focusGuard`). False where
   * `navigator.userActivation` is missing.
   */
  activated: boolean;
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
   * OpenAI's `ui/message` extension: any supported content, sent or left as a
   * draft, in this chat or a new one. Takes precedence over `message`.
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
 * instead of leaving it on an error page. WebRTC's constructors are removed,
 * since CSP's `connect-src` does not cover peer connections and Chromium
 * ignores `webrtc 'block'`. This is a best effort: see `restrictivePolicy`.
 */
export const FORM_GUARD = `(()=>{addEventListener('submit',e=>{if(!e.defaultPrevented)e.preventDefault()});HTMLFormElement.prototype.submit=function(){};for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel'])try{delete window[name]}catch{}})()`;
/**
 * Message size caps, in characters of serialized JSON. A view may send up to
 * 16 MiB plus room for the envelope, which carries an `openai/resources/write`
 * of 12 MiB of binary (16 MiB as base64). It receives up to 64 MiB (a model
 * file it reads, which Bits & Bolts sends at about 6 MB). A larger request is
 * answered with an error, never dropped silently.
 */
export const GUEST_MESSAGE_LIMIT = 16 * 1024 * 1024 + 64 * 1024;
export const HOST_MESSAGE_LIMIT = 64 * 1024 * 1024;
/** What a view may send in one second, all messages together: one largest message and a little more. */
export const GUEST_BYTES_PER_SECOND = 24 * 1024 * 1024;
/** Requests a view may send in one second. */
export const GUEST_MESSAGES_PER_SECOND = 100;
/** How long activation the person gave a view stops counting once focus leaves it: the browser's activation window. */
export const ACTIVATION_WINDOW_MS = 5_000;
// The relay contains no app authority. The same fixed script serves all views.
// It passes messages between Ri and the guest, refusing (with a JSON-RPC error)
// one that is too large or part of a flood. It stamps each with what only it can
// see: its activation, whether focus is in the view, and when focus last left
// it. Ri's page decides from those whether the person's input led to the request
// (`focusGuard`). It reports focus entering and leaving the view, which only it
// sees when focus moves between views, and returns focus to the guest when Ri
// held it while asking (`ri-view-refocus`).
export const RELAY_SCRIPT = `(()=>{let inner=null,id=null,digest=null;let attempts=0;const ready=()=>{if(!inner&&++attempts<=200)parent.postMessage({type:'ri-relay-ready'},'*');else clearInterval(timer)};const timer=setInterval(ready,100);let count=0,bytes=0,windowStart=Date.now(),leftAt=0,graceUntil=0,had=false;const active=()=>navigator.userActivation?.isActive===true;const say=m=>parent.postMessage({...m,id,packageDigest:digest},'*');const refuse=(m,message)=>{if('id' in m&&typeof m.method==='string')inner.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32600,message}},'*')};setInterval(()=>{if(!inner)return;const has=document.hasFocus();if(has===had)return;had=has;if(!has&&Date.now()>graceUntil)leftAt=Date.now();say({type:'ri-view-focus',has,active:active()})},100);addEventListener('message',e=>{const d=e.data;if(e.source===parent){if(!id&&d?.type==='ri-view-init'&&typeof d.id==='string'&&typeof d.html==='string'){id=d.id;digest=d.packageDigest;clearInterval(timer);inner=document.createElement('iframe');inner.sandbox='allow-scripts allow-forms';inner.style='width:100%;height:100%;border:0';inner.srcdoc=d.html;document.body.append(inner)}else if(inner&&d?.id===id&&d.packageDigest===digest){if(d.type==='ri-view-message'&&d.message&&typeof d.message==='object'&&d.message.jsonrpc==='2.0'&&JSON.stringify(d.message).length<=${HOST_MESSAGE_LIMIT})inner.contentWindow.postMessage(d.message,'*');else if(d.type==='ri-view-focus-check')say({type:'ri-view-focus',has:document.hasFocus(),active:active(),check:true});else if(d.type==='ri-view-refocus'){graceUntil=Date.now()+300;inner.focus()}}}else if(inner&&e.source===inner.contentWindow&&d&&typeof d==='object'&&d.jsonrpc==='2.0'){let size;try{size=JSON.stringify(d).length}catch{return}if(Date.now()-windowStart>1000){windowStart=Date.now();count=0;bytes=0}if(size>${GUEST_MESSAGE_LIMIT}){refuse(d,'This message is larger than Ri accepts from an app (16 MiB).');return}if(++count>${GUEST_MESSAGES_PER_SECOND}||(bytes+=size)>${GUEST_BYTES_PER_SECOND}){refuse(d,'This app is sending too much too quickly. Try again in a moment.');return}say({type:'ri-view-message',message:d,active:active(),focused:document.hasFocus(),leftAt})}});ready()})()`;
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
/**
 * The view's CSP: no fetch or other connections, no navigation, no form
 * submission, images from `data:` and `blob:`, fonts only from `data:`.
 * Scripts are the view's own inline scripts, by hash. Within that, a view may
 * compile WebAssembly and start workers from `blob:` URLs it builds itself, as
 * a CAD viewer does to parse STEP files (Bits & Bolts). A worker inherits this
 * policy. CSP does not govern WebRTC, so `FORM_GUARD` removes its constructors
 * and Ri's desktop app limits WebRTC to proxied connections, but a browser may
 * still let a determined view reach the network that way.
 */
export function restrictivePolicy(hashes: string[]): string {
  return `default-src 'none'; script-src ${hashes.join(" ")} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src blob:; object-src 'none'; form-action 'none'; base-uri 'none'`;
}
async function scriptHash(script: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(script),
  );
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}
/** A schema that accepts any value, for OpenAI's methods the SDK does not know. */
function passthrough() {
  return { "~standard": { version: 1 as const, vendor: "ri", validate: (value: unknown) => ({ value }) } };
}
function injectPolicy(html: string, policy: string) {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}
/** The relay's report of focus entering (`has`) or leaving the view, with its activation. `check` answers Ri's question. */
interface FocusReport { has: boolean; active: boolean; check?: boolean }
/** Focus that arrives within this long of a Tab key in Ri's page came by keyboard. */
const TAB_MS = 1_000;
/** Keys pressed in Ri's page this recently mean the person is typing there, so focus the app takes is given back at once. */
const TYPING_MS = 1_500;
/**
 * Focus moving into a view (docs/connected-mcp-apps.md, "Messages"). An app
 * can call `focus()` on its own elements, which takes focus from Ri, so that
 * the person's typing meant for Ri lands in the app and gives the app the
 * activation that authorizes a send. Ri accepts focus entering a view only as
 * the person moves it: right after a Tab key in Ri's page, or with the
 * pointer on the view (the last mouse or touch position) and the relay
 * holding activation from that click or tap. Anything else is the app taking
 * focus: Ri puts focus back where it was, and the relay stops counting
 * activation for its window. Ri's page sees focus enter a view as its own
 * window losing focus. Moving between two views, only the relay sees it, and
 * reports within a tenth of a second.
 */
const focusGuard = {
  views: new Set<{ frame: HTMLIFrameElement; entered(report?: FocusReport): void }>(),
  installed: false,
  /** Where focus was before it entered a view: an element in Ri's page, or a view the person was in. */
  last: null as HTMLElement | null,
  tabAt: -Infinity,
  keyAt: -Infinity,
  install() {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;
    document.addEventListener("keydown", (event) => { if (event.key === "Tab") this.tabAt = Date.now(); else this.keyAt = Date.now(); }, true);
    document.addEventListener("focusin", (event) => { if (event.target instanceof HTMLElement) this.last = event.target; }, true);
    // A focus change made inside the blur that reports one is ignored, so decide just after it.
    window.addEventListener("blur", () => queueMicrotask(() => {
      const active = document.activeElement;
      for (const view of this.views) if (view.frame === active) view.entered();
    }));
  },
};
class OpaqueTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onerror?: Transport["onerror"];
  onclose?: Transport["onclose"];
  /** The relay's focus reports (`focusGuard`). */
  onfocus?: (report: FocusReport) => void;
  /** Whether the person's input led to a request, from the relay's stamp (`focusGuard`). */
  activation?: (stamp: { active: boolean; focused: boolean; leftAt: number }) => boolean;
  private listening = false;
  private count = 0;
  private bytes = 0;
  private startAt = 0;
  private warned = false;
  /** Requests the relay passed on while it had user activation, by JSON-RPC id. Bounded. */
  private readonly activated = new Set<string>();
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
      if (typeof data.has === "boolean") this.onfocus?.({ has: data.has, active: data.active === true, check: data.check === true });
      return;
    }
    if (data.type !== "ri-view-message") return;
    // The relay enforces these limits first. This is the page's own guard, should the relay be bypassed.
    if (Date.now() - this.startAt > 1000) {
      this.startAt = Date.now();
      this.count = 0;
      this.bytes = 0;
      this.warned = false;
    }
    const size = JSON.stringify(data.message ?? null).length;
    if (size > GUEST_MESSAGE_LIMIT || ++this.count > GUEST_MESSAGES_PER_SECOND || (this.bytes += size) > GUEST_BYTES_PER_SECOND) {
      const request = data.message as { id?: unknown; method?: unknown } | undefined;
      if (request && typeof request.method === "string" && (typeof request.id === "string" || typeof request.id === "number"))
        void this.send({ jsonrpc: "2.0", id: request.id, error: { code: -32600, message: size > GUEST_MESSAGE_LIMIT ? "This message is larger than Ri accepts from an app (16 MiB)." : "This app is sending too much too quickly. Try again in a moment." } });
      if (!this.warned) { this.warned = true; this.onerror?.(new Error("The app exceeded its message limit")); }
      return;
    }
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
    if ("method" in message && "id" in message) {
      const key = String(message.id);
      this.activated.delete(key);
      // Only the relay's own stamp counts: this message came from the relay frame itself (checked above).
      const stamp = { active: data.active === true, focused: data.focused === true, leftAt: typeof data.leftAt === "number" ? data.leftAt : 0 };
      if (stamp.active && (this.activation ? this.activation(stamp) : true)) {
        if (this.activated.size >= 64) this.activated.delete(this.activated.values().next().value!);
        this.activated.add(key);
      }
    }
    this.onmessage?.(message);
  };
  /** Whether the request with this id arrived while the person was acting in the view. Read once. */
  takeActivation(id: string | number | undefined) {
    if (id === undefined) return false;
    const key = String(id);
    const active = this.activated.has(key);
    this.activated.delete(key);
    return active;
  }
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
  private guarded?: { frame: HTMLIFrameElement; entered(report?: FocusReport): void };
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
    const [relayHash, guardHash] = await Promise.all([scriptHash(RELAY_SCRIPT), scriptHash(FORM_GUARD)]);
    if (lifecycle !== this.lifecycle) return;
    const policy = restrictivePolicy([...resource.scriptHashes, relayHash, guardHash]);
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
        const options = meta?.["openai/message"] as { target?: unknown; send?: unknown } | undefined;
        if (options !== undefined && (typeof options !== 'object' || options === null || (options.target !== undefined && options.target !== 'active' && options.target !== 'new') || (options.send !== undefined && typeof options.send !== 'boolean')))
          throw new Error('The message options are invalid');
        if (!params.content.length || params.content.some((item: {type: string}) => !['text', 'image', 'resource_link', 'resource'].includes(item.type)))
          throw new Error('This message type is unavailable');
        await callbacks.sendMessage({ content: params.content as ViewContentBlock[], target: options?.target === 'new' ? 'new' : 'active', send: options?.send !== false,
          activated: transport.takeActivation(extra.mcpReq.id) }, extra.mcpReq.signal);
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
    let over = false, overAt = -Infinity, decidedAt = -Infinity, ownMoveAt = -Infinity, acceptedAt = -Infinity, refusedAt = 0;
    let checking: ((report: FocusReport) => void) | null = null;
    // The last mouse or touch position: a click or tap into the view is over it.
    iframe.addEventListener("mouseover", () => { over = true; overAt = Date.now(); });
    iframe.addEventListener("mouseout", () => { over = false; });
    const restore = () => {
      if (document.activeElement !== iframe) return;
      const back = focusGuard.last;
      if (back && back !== iframe && back.isConnected) back.focus({ preventScroll: true });
      if (document.activeElement === iframe) iframe.blur();
    };
    const accept = (refocus: boolean) => {
      acceptedAt = Date.now();
      // Giving the person's focus back is Ri's own move, not one to judge again.
      if (refocus) { ownMoveAt = Date.now(); iframe.focus({ preventScroll: true }); transport.signal("ri-view-refocus"); }
      focusGuard.last = iframe;
    };
    const refuse = () => { refusedAt = Date.now(); restore(); };
    // A request counts as the person's when the relay had activation and focus, and that activation is not left
    // over from before focus last left the view, or from focus the app took: unless the person came back since,
    // it stops counting for the rest of its window.
    transport.activation = ({ focused, leftAt }) => {
      const since = Math.max(leftAt, refusedAt);
      return focused && (!since || acceptedAt >= since || Date.now() - since >= ACTIVATION_WINDOW_MS);
    };
    const guarded = {
      frame: iframe,
      entered: (report?: FocusReport) => {
        const now = Date.now();
        // Ri's page saw this entry first and decided, or Ri moved focus here itself. The relay's report comes after.
        if ((report && now - decidedAt < 300) || now - ownMoveAt < 300) return;
        decidedAt = now;
        if (now - focusGuard.tabAt < TAB_MS) { accept(false); return; }
        if (!over) { refuse(); return; }
        if (report) { if (report.active) accept(false); else refuse(); return; }
        // The pointer was already resting on the view while the person typed in Ri, so this may be the app.
        // Give focus back before asking, so no keystroke reaches the app meanwhile. A pointer that arrived
        // after the last key is the person moving to the view.
        const typing = now - focusGuard.keyAt < TYPING_MS && overAt < focusGuard.keyAt;
        if (typing) restore();
        checking = (answer) => { checking = null; if (answer.active) accept(typing); else refuse(); };
        transport.signal("ri-view-focus-check");
      },
    };
    transport.onfocus = (report) => {
      if (report.check) checking?.(report);
      else if (report.has) guarded.entered(report);
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
