"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { trpcClient } from "@/lib/trpc/client";
import { AppViewController } from "@ri/app-kit/view-host";
import { registerAppContext } from "@/lib/client/app-context";
import {useNativeFiles,downloadAppFile} from './native-files';
import {openSettings} from '@/components/settings/settings-store';
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
  navigation.current = onNavigate;
  const paused = useRef(waiting);
  paused.current = waiting;
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (!waiting) void refreshRef.current?.();
  }, [changeRevision, waiting]);
  useEffect(() => {
    let cancelled = false,
      viewId = "",
      unregister: (() => void) | undefined;
    let ack: { viewId: string; revision: number } | null = null;
    const controller = new AppViewController(mount.current!, {
      call: async (action, input) => {
        const result = await trpcClient.localApps.viewCall.mutate({
          viewId,
          action,
          input,
          invocationId: crypto.randomUUID(),
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
      navigate: (value) => {if(value==='/__host/manage-access')openSettings('plugins');else navigation.current(value);},
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
      .mutate({ id, draft, path, query: locationQuery, chatId })
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
          path,
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
  }, [id, draft, path, queryKey, chatId, digest, authorityRevision, reopen]);
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
          <Button size="xs" variant="outline" onClick={() => setReopen((value) => value + 1)}>
            Reopen view
          </Button>
        </div>
      )}
    </>
  );
}
