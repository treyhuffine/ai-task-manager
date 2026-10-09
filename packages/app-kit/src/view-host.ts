import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FileCapabilities } from './contract.js';

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
  files?: FileCapabilities;
}
export interface ViewCallbacks {
  call(action: string, input: unknown, signal: AbortSignal): Promise<unknown>;
  context(envelope: unknown, signal: AbortSignal): Promise<void>;
  navigate(path: string): Promise<void> | void;
  externalLink(url: string): Promise<void> | void;
  error(error: Error): void;
  ready?(): void;
  selectFile?(signal: AbortSignal): Promise<{name: string; mimeType: string; base64: string} | null>;
  downloadFile?(contents: unknown[], signal: AbortSignal): Promise<void>;
}
// The relay contains no app authority. The same fixed script serves all views.
export const RELAY_SCRIPT = `(()=>{let inner=null,id=null,digest=null;let count=0,windowStart=Date.now();const valid=m=>m&&typeof m==='object'&&m.jsonrpc==='2.0'&&JSON.stringify(m).length<=1048576;addEventListener('message',e=>{if(e.source===parent){const d=e.data;if(!id&&d?.type==='ri-view-init'&&typeof d.id==='string'&&typeof d.html==='string'){id=d.id;digest=d.packageDigest;inner=document.createElement('iframe');inner.sandbox='allow-scripts';inner.style='width:100%;height:100%;border:0';inner.srcdoc=d.html;document.body.append(inner)}else if(d?.type==='ri-view-message'&&d.id===id&&d.packageDigest===digest&&inner&&valid(d.message)){inner.contentWindow.postMessage(d.message,'*')}}else if(inner&&e.source===inner.contentWindow&&valid(e.data)){if(Date.now()-windowStart>1000){windowStart=Date.now();count=0}if(++count<=100)parent.postMessage({type:'ri-view-message',id,packageDigest:digest,message:e.data},'*')}});parent.postMessage({type:'ri-relay-ready'},'*')})()`;
const ALLOWED = new Set([
  "ping",
  "ui/initialize",
  "ui/notifications/initialized",
  "tools/call",
  "ui/update-model-context",
  "ui/open-link",
  "ui/download-file",
  "ui/notifications/size-changed",
  "notifications/cancelled",
]);
export function restrictivePolicy(hashes: string[]): string {
  return `default-src 'none'; script-src ${hashes.join(" ")}; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
}
async function scriptHash(script: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(script),
  );
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}
function injectPolicy(html: string, policy: string) {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}
class OpaqueTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onerror?: Transport["onerror"];
  onclose?: Transport["onclose"];
  private listening = false;
  private initialized = false;
  private count = 0;
  private startAt = 0;
  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly binding: ViewBinding,
    private readonly guest: ViewHtml,
  ) {}
  private receive = (event: MessageEvent) => {
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data;
    if (data?.type === "ri-relay-ready" && !this.initialized) {
      this.initialized = true;
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
    if (
      data?.type !== "ri-view-message" ||
      data.id !== this.binding.id ||
      data.packageDigest !== this.binding.packageDigest
    )
      return;
    if (Date.now() - this.startAt > 1000) {
      this.startAt = Date.now();
      this.count = 0;
    }
    if (++this.count > 100 || JSON.stringify(data).length > 1048576) {
      this.onerror?.(new Error("The app exceeded its message limit"));
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
    this.onmessage?.(message);
  };
  async start() {
    if (!this.listening) {
      window.addEventListener("message", this.receive);
      this.listening = true;
    }
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
    const relayHash = await scriptHash(RELAY_SCRIPT);
    if (lifecycle !== this.lifecycle) return;
    const policy = restrictivePolicy([...resource.scriptHashes, relayHash]);
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.setAttribute("aria-label", "App view");
    iframe.style.cssText = "width:100%;height:100%;border:0;min-height:240px";
    this.mount.append(iframe);
    this.frame = iframe;
    const transport = new OpaqueTransport(iframe, binding, {
      ...resource,
      html: injectPolicy(resource.html, policy),
    });
    this.transport = transport;
    const bridge = new AppBridge(
      null,
      { name: "Ri", version: "1.0.0" },
      { serverTools: {}, updateModelContext: {}, openLinks: {}, ...(binding.files?.download && this.callbacks.downloadFile ? {downloadFile: {}} : {}) },
      {
        hostContext: {
          theme: binding.theme,
          displayMode: "inline",
          availableDisplayModes: ["inline"],
        },
      },
    );
    this.bridge = bridge;
    bridge.oncalltool = async (params, extra) => {
      if (params.name === 'ri_select_file') {
        if (!binding.files?.select || !this.callbacks.selectFile || Object.keys(params.arguments ?? {}).length) throw new Error('File selection is unavailable');
        const file = await this.callbacks.selectFile(extra.signal);
        return {content: [{type:'text', text:file ? 'File selected' : 'Selection cancelled'}], structuredContent:{file}};
      }
      const result = await this.callbacks.call(
        params.name,
        params.arguments ?? {},
        extra.signal,
      );
      return {
        content: [{ type: "text", text: "App operation completed" }],
        structuredContent: result as Record<string, unknown>,
      };
    };
    bridge.onupdatemodelcontext = async (params, extra) => {
      const text = params.content?.find(
        (item: { type: string; text?: string }) => item.type === "text",
      ) as { type: string; text: string } | undefined;
      if (
        !text ||
        text.type !== "text" ||
        new TextEncoder().encode(text.text).byteLength > 8192
      )
        throw new Error("The app context is invalid or too large");
      const envelope = JSON.parse(text.text);
      const request = this.contextTail.then(() =>
        this.callbacks.context(envelope, extra.signal),
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
      await request;
      return {};
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
      await this.callbacks.downloadFile(params.contents, extra.signal);
      return {};
    };
    bridge.onsizechange = () => {};
    bridge.oninitialized = () => {
      void bridge
        .sendToolInput({
          arguments: { path: binding.path, query: binding.query },
        })
        .then(() =>
          bridge.sendToolResult({
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
  async flushContext() {
    await this.contextTail;
    if (this.contextError) throw this.contextError;
  }
  private async disposeBridge() {
    this.disposed = true;
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
