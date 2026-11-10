"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { trpcClient } from "@/lib/trpc/client";
import { AppViewController } from "@ri/app-kit/view-host";
import { registerAppContext } from "@/lib/client/app-context";
import {useNativeFiles,downloadAppFile} from './native-files';
import {openSettings} from '@/components/settings/settings-store';
import { appChatIntent, requestAppChatDraft } from '@/lib/client/app-chat-intent';
export function AppView({
  id,
  draft = false,
  path = "/",
  query = {},
  chatId,
  waiting = false,
  digest,
  authorityRevision = 0,
  changeRevision = 0,
  onNavigate,
  onAccessCreated,
  onAsk,
  onSources,
  onLocation,
}: {
  id: string;
  draft?: boolean;
  path?: string;
  query?: Record<string, string>;
  chatId?: string;
  waiting?: boolean;
  digest: string;
  authorityRevision?: number;
  changeRevision?: number;
  onNavigate: (path: string) => void;
  onAccessCreated?: (scopeRef:string) => void;
  onAsk?: (prompt: string) => void;
  /** The app asked for Ri's Sources dialog. */
  onSources?: () => void;
  /**
   * The app reports its own location (tab, selection, filters) for the URL, without reopening.
   * `push` makes it a place Back returns from, `replace` updates the place the person is in.
   */
  onLocation?: (path: string, entry: 'push' | 'replace') => void;
}) {
  const mount = useRef<HTMLDivElement>(null),
    [error, setError] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [reopen, setReopen] = useState(0);
  const files=useNativeFiles();
  const fileSelect=useRef(files.select);fileSelect.current=files.select;
  const accessAction = useRef<string|null>(null), accessCreated = useRef(onAccessCreated);
  accessCreated.current = onAccessCreated;
  const navigation = useRef(onNavigate);
  const ask = useRef(onAsk);
  ask.current = onAsk;
  const sources = useRef(onSources);
  sources.current = onSources;
  const locate = useRef(onLocation);
  locate.current = onLocation;
  // The location the view is showing. One the app reported itself is already
  // showing. Any other change (Back, Forward, a link) moves a view that follows
  // its moves, and reopens any other view there.
  const locationKey = JSON.stringify([path, query]);
  const shown = useRef(locationKey);
  const [openKey, setOpenKey] = useState(locationKey);
  const follows = useRef(false), viewIdRef = useRef(''), controllerRef = useRef<AppViewController | null>(null), lastRef = useRef('');
  // The places this view pushed from, newest last, so a close button can go Back the way the person came.
  const backStack = useRef<string[]>([]);
  const moveSeq = useRef(0);
  if (locationKey !== shown.current && !(follows.current && viewIdRef.current)) {
    shown.current = locationKey;
    // Back to where the view first opened is a reopen too, since the app has moved on from there.
    if (locationKey !== openKey) setOpenKey(locationKey);
    else setReopen((value) => value + 1);
  }
  const [openPath, openQuery] = JSON.parse(openKey) as [string, Record<string, string>];
  navigation.current = onNavigate;
  const paused = useRef(waiting);
  paused.current = waiting;
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const queryKey = JSON.stringify(openQuery);
  const retryView = async () => {
    try {
      await trpcClient.localApps.retry.mutate({ id, draft });
      setReopen((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The app could not retry');
    }
  };
  useEffect(() => {
    if (!waiting) void refreshRef.current?.();
  }, [changeRevision, waiting]);
  useEffect(() => {
    let cancelled = false,
      viewId = "",
      unregister: (() => void) | undefined;
    let ack: { viewId: string; revision: number } | null = null;
    const controller = new AppViewController(mount.current!, {
      call: async (action, input, _signal, meta) => {
        // A guest that retries a write sends the same invocation ID, so the app deduplicates it.
        const result = await trpcClient.localApps.viewCall.mutate({
          viewId,
          action,
          input,
          invocationId: meta?.invocationId ?? crypto.randomUUID(),
        });
        if(action === accessAction.current && result && typeof result === 'object' && 'scopeRef' in result && typeof result.scopeRef === 'string') accessCreated.current?.(result.scopeRef);
        return result;
      },
      context: async (state) => {
        ack = null;
        const result = await trpcClient.localApps.context.mutate({
          viewId,
          state,
        });
        ack = { viewId: result.viewId, revision: result.revision };
        if (!cancelled) setError(null);
      },
      navigate: (value) => {
        const intent = appChatIntent(value);
        if (intent) {
          if (ask.current) ask.current(intent.prompt);
          else if (chatId) requestAppChatDraft(chatId, intent.prompt);
          else throw new Error('Open the app from Apps to start a conversation.');
        } else if (value === '/__host/manage-access' || value === '/__host/sources') {
          // The app's own Sources dialog is the per-app access surface. It links on to Ri's account settings.
          if (sources.current) sources.current();
          else openSettings('plugins');
        } else if (value.startsWith('/__host/location?')) {
          const params = new URL(value, 'https://app.invalid').searchParams;
          if (params.get('follows') === '1') { follows.current = true; return; }
          const to = params.get('to') ?? '';
          if (!to.startsWith('/') || to.startsWith('//') || to.length > 1024 || !locate.current) return;
          const entry = params.get('entry');
          // A close button: Back when this view brought the person here, else the fallback in place.
          if (entry === 'back' && backStack.current.length) { window.history.back(); return; }
          const target = new URL(to, 'https://app.invalid');
          const key = JSON.stringify([target.pathname, Object.fromEntries(target.searchParams)]);
          if (key === shown.current) return;
          // A new path is a new place, which Back returns from. A new query, such as a filter, updates this one.
          const push = entry === 'push' || (!entry && target.pathname !== (JSON.parse(shown.current) as [string])[0]);
          if (push) backStack.current.push(shown.current);
          shown.current = key;
          locate.current(target.pathname + target.search, push ? 'push' : 'replace');
        } else navigation.current(value);
      },
      externalLink: (url) => {
        if (
          window.confirm(
            `Open this external website?\n${new URL(url).hostname}`,
          )
        )
          window.open(url, "_blank", "noopener,noreferrer");
      },
      error: (error) => { if (!cancelled) setError(error.message); },
      ready: () => { if (!cancelled) setReady(true); },
      selectFile: async signal=>{
        const policy=await trpcClient.localApps.fileAccess.mutate({viewId,mode:'select'});
        const file=await fileSelect.current(policy,signal);
        await trpcClient.localApps.fileAccess.mutate({viewId,mode:'select'});
        return file;
      },
      downloadFile: async (contents,signal)=>{
        const policy=await trpcClient.localApps.fileAccess.mutate({viewId,mode:'download'});
        await downloadAppFile(contents,policy,signal,()=>trpcClient.localApps.fileAccess.mutate({viewId,mode:'download'}));
      },
    });
    setError(null);
    setReady(false);
    controllerRef.current = controller;
    // A reopened view starts over: it announces again if it follows moves, and has no places behind it.
    follows.current = false;
    backStack.current = [];
    const locationQuery = JSON.parse(queryKey) as Record<string, string>;
    let visible = true,
      refreshing = false;
    const refresh = async () => {
      if (
        cancelled ||
        !viewId ||
        refreshing ||
        paused.current ||
        !visible ||
        document.visibilityState !== "visible"
      )
        return;
      refreshing = true;
      try {
        const result = await trpcClient.localApps.refreshView.mutate({
          viewId,
        });
        const serialized = JSON.stringify(result.result);
        if (result.result !== null && serialized !== lastRef.current) {
          lastRef.current = serialized;
          ack = null;
          await controller.refresh(result.result);
        }
      } catch (error) {
        if (!cancelled)
          setError(
            error instanceof Error ? error.message : "App refresh failed",
          );
      } finally {
        refreshing = false;
      }
    };
    refreshRef.current = refresh;
    void trpcClient.localApps.openView
      .mutate({ id, draft, path: openPath, query: locationQuery, chatId })
      .then(async (result) => {
        viewId = result.viewId;
        viewIdRef.current = result.viewId;
        accessAction.current = result.accessAction;
        if (cancelled) {
          await trpcClient.localApps.closeView.mutate({ viewId });
          return;
        }
        lastRef.current = JSON.stringify(result.result);
        if (chatId && !draft && result.hasContext)
          unregister = registerAppContext(chatId, async () => {
            await controller.flushContext();
            if (!ack)
              throw new Error(
                "Select or refresh the app context before sending",
              );
            return ack;
          });
        await controller.open(result.prepared, {
          id: viewId,
          packageDigest: result.packageDigest,
          initialData: result.result,
          path: openPath,
          query: locationQuery,
          theme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "light",
          files: result.files,
        });
        if (cancelled) await controller.dispose();
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    const observer = new MutationObserver(() =>
      controller.theme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      ),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const viewport = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) void refresh();
    });
    viewport.observe(mount.current!);
    const timer = setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      cancelled = true;
      refreshRef.current = null;
      viewIdRef.current = '';
      if (controllerRef.current === controller) controllerRef.current = null;
      clearInterval(timer);
      viewport.disconnect();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      unregister?.();
      observer.disconnect();
      void controller.dispose();
      if (viewId)
        void trpcClient.localApps.closeView.mutate({ viewId }).catch(() => {});
    };
  }, [id, draft, openPath, queryKey, chatId, digest, authorityRevision, reopen]);
  // Back, Forward or a link changed the location of a view that follows its moves: move it there in place.
  useEffect(() => {
    if (locationKey === shown.current || !follows.current || !viewIdRef.current) return;
    shown.current = locationKey;
    if (backStack.current.at(-1) === locationKey) backStack.current.pop();
    const seq = ++moveSeq.current;
    const [movePath, moveQuery] = JSON.parse(locationKey) as [string, Record<string, string>];
    void trpcClient.localApps.moveView.mutate({ viewId: viewIdRef.current, path: movePath, query: moveQuery }).then(async (result) => {
      // A later move has started. It owns the view now.
      if (seq !== moveSeq.current || !controllerRef.current) return;
      const search = new URLSearchParams(moveQuery).toString();
      controllerRef.current.hostContextChanged({ 'openai/deepLink': { url: movePath + (search ? `?${search}` : '') } });
      lastRef.current = JSON.stringify(result.result);
      await controllerRef.current.refresh(result.result);
    }, () => {
      // It couldn't move in place, so open it there.
      if (seq === moveSeq.current) setOpenKey(locationKey);
    });
  }, [locationKey]);
  return (
    <>
      {files.picker}
      <div ref={mount} className="h-full w-full" />
      {!ready && !error && (
        <p className="absolute left-4 top-4 text-[11px] text-muted-foreground">
          {waiting ? 'Waiting for your decision above.' : 'Opening the app'}
        </p>
      )}
      {error && (
        <div role="alert" className="absolute inset-x-4 top-4 space-y-2 rounded-xl border border-border bg-background p-3 text-[12px] shadow-sm">
          <p className="text-foreground">{error}</p>
          <Button size="xs" variant="outline" onClick={() => void retryView()}>
            {error.includes('failed to start repeatedly') ? 'Retry' : 'Reopen view'}
          </Button>
        </div>
      )}
    </>
  );
}
