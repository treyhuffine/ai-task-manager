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
  /** The app reports its own location (tab, selection, filters) for the URL, without reopening. */
  onLocation?: (path: string) => void;
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
  // A location the app itself reported is already showing, so it must not
  // reopen the view. Any other location change (Back, a link) reopens it.
  const locationKey = JSON.stringify([path, query]);
  const reported = useRef<string | null>(null);
  const [openKey, setOpenKey] = useState(locationKey);
  if (locationKey !== openKey && locationKey !== reported.current) setOpenKey(locationKey);
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
          const to = new URL(value, 'https://app.invalid').searchParams.get('to') ?? '';
          if (!to.startsWith('/') || to.startsWith('//') || to.length > 1024 || !locate.current) return;
          const target = new URL(to, 'https://app.invalid');
          reported.current = JSON.stringify([target.pathname, Object.fromEntries(target.searchParams)]);
          locate.current(target.pathname + target.search);
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
    const locationQuery = JSON.parse(queryKey) as Record<string, string>;
    let visible = true,
      refreshing = false,
      last = "";
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
        if (result.result !== null && serialized !== last) {
          last = serialized;
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
        accessAction.current = result.accessAction;
        if (cancelled) {
          await trpcClient.localApps.closeView.mutate({ viewId });
          return;
        }
        last = JSON.stringify(result.result);
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
