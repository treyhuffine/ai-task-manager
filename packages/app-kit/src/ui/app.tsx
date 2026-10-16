/**
 * The connection between an app view and Ri. `RiAppProvider` connects the
 * MCP Apps bridge once, tracks the opener result and theme, and offers the
 * host intents through `useRiApp()`: stage a chat draft, open Sources or
 * Manage access, remember the view location, open HTTPS links, select and
 * download files. Every intent goes through the host. Nothing here sends a
 * chat message, grants access or reaches the network.
 */
import { createContext, useCallback, useContext, useEffect, useInsertionEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { connectApp } from "../app-client.js";
import { LiveRegion } from "./announce.js";
import { installStyles } from "./styles.js";
import { clampText, errorMessage, stableJson } from "./util.js";

export type Theme = "light" | "dark";
export interface SelectedFile { name: string; mimeType: string; base64: string }

/**
 * What the provider needs from a bridge client. `connectApp()` returns a
 * compatible object. Tests and galleries pass `createMemoryClient()`.
 */
export interface RiAppClient {
  call(action: string, input?: Record<string, unknown>, options?: { invocationId?: string }): Promise<unknown>;
  context(state: unknown): Promise<void>;
  selectFile(): Promise<SelectedFile | null>;
  navigate?(path: string): unknown;
  app: {
    openLink(params: { url: string }): Promise<{ isError?: boolean } & Record<string, unknown>>;
    downloadFile?(params: { contents: DownloadContent[] }): Promise<{ isError?: boolean } & Record<string, unknown>>;
  };
  /** Optional push channel used by memory clients to deliver opener results and theme changes. */
  subscribe?(listener: { result?: (data: unknown) => void; theme?: (theme: Theme) => void }): () => void;
}

export interface DownloadContent {
  type: "resource";
  resource: { uri: string; mimeType: string; text?: string; blob?: string };
}
export interface DownloadRequest {
  /** File name such as `trip-lisbon.ics`. Path separators are removed. */
  name: string;
  mimeType: string;
  /** Text content. Provide exactly one of `text` or `base64`. */
  text?: string;
  /** Base64 content for binary files. */
  base64?: string;
}

export interface RiApp<TData = unknown> {
  /** The latest opener result from the host. */
  data: TData | undefined;
  /** Counts refreshed opener results that changed after the initial one. Queries refetch when it changes. */
  revision: number;
  theme: Theme;
  connected: boolean;
  error: string | null;
  call<T = unknown>(action: string, input?: Record<string, unknown>, options?: { invocationId?: string }): Promise<T>;
  /** Coalesced model-context update. Only the latest state is sent, about 150 ms after changes settle and at most 10 times a second. */
  context(state: unknown): void;
  /** Stage editable text in Ri's native chat composer. Never sends. */
  ask(prompt: string): Promise<void>;
  /** Open this app's Sources in the host. */
  openSources(): Promise<void>;
  /** Open Ri's account access controls for this app. */
  manageAccess(): Promise<void>;
  /** Remember a view path such as `/trips/lisbon?tab=bookings` in the host URL with replace semantics. Debounced 300 ms. */
  setLocation(path: string): void;
  /** Open an HTTPS link through the host, which confirms first. Other schemes throw. */
  openExternal(url: string): Promise<void>;
  /** Open an address in an external map through the host. Nothing loads inside the view. */
  openDirections(address: string): Promise<void>;
  selectFile(): Promise<SelectedFile | null>;
  download(file: DownloadRequest): Promise<void>;
}

const RiAppContext = createContext<RiApp | null>(null);

/** The app connection from the nearest `RiAppProvider`. */
export function useRiApp<TData = unknown>(): RiApp<TData> {
  const value = useContext(RiAppContext);
  if (!value) throw new Error("useRiApp needs a RiAppProvider above this component");
  return value as RiApp<TData>;
}
/** The app connection, or null outside a provider. */
export function useOptionalRiApp<TData = unknown>(): RiApp<TData> | null {
  return useContext(RiAppContext) as RiApp<TData> | null;
}

export const HOST_PATHS = {
  chat: "/__host/chat",
  sources: "/__host/sources",
  manageAccess: "/__host/manage-access",
  location: "/__host/location",
} as const;
export const MAX_PROMPT_LENGTH = 2000;
/** Approximate byte budget for one context state, inside the host's 8 KiB envelope limit. */
export const MAX_CONTEXT_BYTES = 8000;

/** The host chat intent for a prompt, trimmed to 2,000 characters. */
export function chatIntentUrl(prompt: string): string {
  return `${HOST_PATHS.chat}?prompt=${encodeURIComponent(clampText(prompt, MAX_PROMPT_LENGTH))}`;
}
/** The host location intent for a view path. */
export function locationIntentUrl(path: string): string {
  return `${HOST_PATHS.location}?to=${encodeURIComponent(path)}`;
}
/** A validated HTTPS URL, or an error explaining why it cannot open. */
export function assertHttpsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("This link is not a valid web address");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Only secure https links can open from this app");
  return parsed.href;
}
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}
/** The embedded resource for a host-mediated download. */
export function downloadContents(file: DownloadRequest): DownloadContent[] {
  const name = file.name.split(/[\\/]/).pop()?.trim() || "export";
  if ((file.text === undefined) === (file.base64 === undefined)) throw new Error("Provide either text or base64 content to download");
  const resource: DownloadContent["resource"] = { uri: "file:///" + encodeURIComponent(name), mimeType: file.mimeType };
  if (file.text !== undefined) resource.text = file.text;
  else resource.blob = file.base64;
  return [{ type: "resource", resource }];
}

type Timer = ReturnType<typeof setTimeout>;
export interface CoalescerOptions {
  /** Quiet period after the last update before sending. */
  delay?: number;
  /** Longest an update may wait while changes keep arriving. */
  maxWait?: number;
  /** Minimum time between two sends. */
  minInterval?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => Timer;
  cancel?: (timer: Timer) => void;
}
/**
 * Trailing coalescer: keeps only the latest value, sends it after `delay` of
 * quiet (or `maxWait` under constant change), never faster than
 * `minInterval`, and skips a value equal to the one last sent.
 */
export function createCoalescer<T>(send: (value: T) => void, options: CoalescerOptions = {}) {
  const delay = options.delay ?? 150, maxWait = options.maxWait ?? 1000, minInterval = options.minInterval ?? 100;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  let timer: Timer | null = null, pending: { value: T; key: string } | null = null;
  let firstPendingAt = 0, lastSentAt = -Infinity, lastSentKey: string | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const { value, key } = pending;
    pending = null;
    if (key === lastSentKey) return;
    lastSentKey = key;
    lastSentAt = now();
    send(value);
  };
  const arm = () => {
    if (timer) cancel(timer);
    const at = now();
    const wait = Math.max(Math.min(delay, firstPendingAt + maxWait - at), lastSentAt + minInterval - at, 0);
    timer = schedule(flush, wait);
  };
  return {
    push(value: T, key: string = stableJson(value)) {
      if (!pending) firstPendingAt = now();
      pending = { value, key };
      arm();
    },
    flush() {
      if (timer) cancel(timer);
      flush();
    },
    dispose() {
      if (timer) cancel(timer);
      timer = null;
      pending = null;
    },
  };
}

export interface RiAppProviderProps {
  children?: ReactNode;
  /** A bridge client. When omitted the provider calls `connectApp()` once on mount. */
  client?: RiAppClient;
  /** Opener data to show before the host delivers its first result. */
  initialData?: unknown;
  /** Theme before the host reports one. */
  initialTheme?: Theme;
  /** Replace `connectApp`, for tests of the connection flow. */
  connect?: typeof connectApp;
}

/** Connects the app view to Ri and provides `useRiApp()`, `useQuery()`, `useMutation()` and `useAnnounce()`. */
export function RiAppProvider({ children, client: providedClient, initialData, initialTheme, connect = connectApp }: RiAppProviderProps) {
  useInsertionEffect(() => {
    installStyles();
  }, []);
  const [data, setData] = useState<unknown>(initialData);
  const [revision, setRevision] = useState(0);
  const [theme, setTheme] = useState<Theme>(initialTheme ?? "light");
  const [connected, setConnected] = useState(Boolean(providedClient));
  const [error, setError] = useState<string | null>(null);
  const resultCount = useRef(initialData === undefined ? 0 : 1);
  const lastResultKey = useRef(initialData === undefined ? null : stableJson(initialData));
  const clientRef = useRef<RiAppClient | null>(providedClient ?? null);
  const waiting = useRef<((client: RiAppClient) => void)[]>([]);
  const connecting = useRef<Promise<RiAppClient> | null>(null);

  const receive = useCallback((value: unknown) => {
    const key = stableJson(value);
    if (key === lastResultKey.current) return;
    lastResultKey.current = key;
    setData(value);
    // The first opener result is the initial view, not a refresh.
    if (resultCount.current++ > 0) setRevision((current) => current + 1);
  }, []);
  const receiveTheme = useCallback((value: Theme) => {
    setTheme(value);
    if (typeof document !== "undefined") document.documentElement.dataset.theme = value;
  }, []);

  useEffect(() => {
    if (providedClient) {
      clientRef.current = providedClient;
      setConnected(true);
      for (const resolve of waiting.current.splice(0)) resolve(providedClient);
      return providedClient.subscribe?.({ result: receive, theme: receiveTheme });
    }
    let active = true;
    connecting.current ??= connect({ result: (value) => receive(value), theme: (value) => receiveTheme(value) }) as Promise<RiAppClient>;
    connecting.current.then(
      (client) => {
        clientRef.current = client;
        for (const resolve of waiting.current.splice(0)) resolve(client);
        if (active) {
          setConnected(true);
          setError(null);
        }
      },
      (failure: unknown) => {
        if (active) setError(errorMessage(failure, "The app could not connect to Ri"));
      },
    );
    return () => {
      active = false;
    };
  }, [providedClient, connect, receive, receiveTheme]);

  const ready = useCallback((): Promise<RiAppClient> => {
    if (clientRef.current) return Promise.resolve(clientRef.current);
    return new Promise((resolve) => waiting.current.push(resolve));
  }, []);

  const open = useCallback(async (url: string) => {
    const client = await ready();
    const result = await client.app.openLink({ url });
    if (result?.isError) throw new Error("Ri could not open this");
  }, [ready]);

  const contextCoalescer = useRef<ReturnType<typeof createCoalescer<unknown>> | null>(null);
  const locationCoalescer = useRef<ReturnType<typeof createCoalescer<string>> | null>(null);
  if (!contextCoalescer.current)
    contextCoalescer.current = createCoalescer<unknown>((state) => {
      void ready()
        .then((client) => client.context(state))
        .catch((failure: unknown) => setError(errorMessage(failure, "Ri could not update the chat context")));
    }, { delay: 150, maxWait: 1000, minInterval: 100 });
  if (!locationCoalescer.current)
    locationCoalescer.current = createCoalescer<string>((path) => {
      void open(locationIntentUrl(path)).catch(() => undefined);
    }, { delay: 300, maxWait: 2000, minInterval: 300 });
  useEffect(() => () => {
    contextCoalescer.current?.flush();
    locationCoalescer.current?.flush();
  }, []);

  // Functions are stable for the provider's lifetime, so hooks that depend on
  // them only re-run when their own inputs or the opener revision change.
  const actions = useMemo(() => ({
    call: async <T,>(action: string, input: Record<string, unknown> = {}, options: { invocationId?: string } = {}) => {
      const client = await ready();
      return (await client.call(action, input, options)) as T;
    },
    context(state: unknown) {
      const key = stableJson(state);
      if (new TextEncoder().encode(key).byteLength > MAX_CONTEXT_BYTES) {
        console.warn(`Ri app context skipped: it exceeds the ${MAX_CONTEXT_BYTES} byte budget. Send IDs, filters and revisions only.`);
        return;
      }
      contextCoalescer.current!.push(state, key);
    },
    ask: (prompt: string) => open(chatIntentUrl(prompt)),
    openSources: () => open(HOST_PATHS.sources),
    manageAccess: () => open(HOST_PATHS.manageAccess),
    setLocation(path: string) {
      locationCoalescer.current!.push(path, path);
    },
    openExternal: async (url: string) => open(assertHttpsUrl(url)),
    openDirections: (address: string) => open(directionsUrl(address)),
    selectFile: async () => (await ready()).selectFile(),
    download: async (file: DownloadRequest) => {
      const client = await ready();
      if (!client.app.downloadFile) throw new Error("Downloads are not available in this view");
      const result = await client.app.downloadFile({ contents: downloadContents(file) });
      if (result?.isError) throw new Error("The download was cancelled or blocked");
    },
  }), [ready, open]);
  const value = useMemo<RiApp>(() => ({ data, revision, theme, connected, error, ...actions }), [data, revision, theme, connected, error, actions]);

  return (
    <RiAppContext.Provider value={value}>
      <LiveRegion>{children}</LiveRegion>
    </RiAppContext.Provider>
  );
}

export interface MemoryCall { action: string; input: Record<string, unknown>; invocationId?: string }
export interface MemoryClient extends RiAppClient {
  calls: MemoryCall[];
  contexts: unknown[];
  links: string[];
  downloads: DownloadContent[][];
  /** Deliver a new opener result, as the host does after a refresh. */
  emitResult(data: unknown): void;
  setTheme(theme: Theme): void;
}
export interface MemoryClientOptions {
  /** The initial opener result delivered to the provider. */
  data?: unknown;
  /** Action handlers. An action without a handler rejects. */
  handlers?: Record<string, (input: Record<string, unknown>, meta: { invocationId?: string }) => unknown>;
  /** File returned by `selectFile()`. */
  file?: SelectedFile | null;
  /** Artificial latency for calls, in milliseconds. */
  latency?: number;
}
/**
 * An in-memory client for tests and component galleries. It records calls,
 * context states, opened links and downloads, and needs no host.
 */
export function createMemoryClient(options: MemoryClientOptions = {}): MemoryClient {
  const listeners = new Set<{ result?: (data: unknown) => void; theme?: (theme: Theme) => void }>();
  let latest = options.data;
  const wait = () => (options.latency ? new Promise((resolve) => setTimeout(resolve, options.latency)) : Promise.resolve());
  const client: MemoryClient = {
    calls: [],
    contexts: [],
    links: [],
    downloads: [],
    async call(action, input = {}, meta = {}) {
      client.calls.push({ action, input, ...(meta.invocationId ? { invocationId: meta.invocationId } : {}) });
      await wait();
      const handler = options.handlers?.[action];
      if (!handler) throw new Error(`No handler for ${action}`);
      return handler(input, meta);
    },
    async context(state) {
      client.contexts.push(state);
    },
    async selectFile() {
      return options.file ?? null;
    },
    navigate(path) {
      client.links.push(path);
    },
    app: {
      async openLink({ url }) {
        client.links.push(url);
        return {};
      },
      async downloadFile({ contents }) {
        client.downloads.push(contents);
        return {};
      },
    },
    subscribe(listener) {
      listeners.add(listener);
      if (latest !== undefined) listener.result?.(latest);
      return () => listeners.delete(listener);
    },
    emitResult(data) {
      latest = data;
      for (const listener of listeners) listener.result?.(data);
    },
    setTheme(theme) {
      for (const listener of listeners) listener.theme?.(theme);
    },
  };
  return client;
}
