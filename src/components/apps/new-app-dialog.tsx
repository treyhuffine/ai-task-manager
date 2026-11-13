'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { uuidv7 } from 'uuidv7';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { APP_NAME } from '@/constants/app';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';

/** The builder chat for an app being built or changed: the same focused content chat as a skill's builder. */
export async function ensureAppBuilderChat(sourceId: string) {
  const { session } = await trpcClient.documentChat.list.query({ query: rpcQuery({ entityType: 'app-builder', entityId: sourceId }) });
  return session;
}

/**
 * New app (docs/personal-apps.md "Building and changing apps"): the app kit's `create` makes the app
 * in its own git repository in the apps folder, then the builder chat starts on what the person
 * asked for. Ri installs it only when they choose to.
 */
export function NewAppDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (sourceId: string) => void }) {
  const settings = useQuery({ ...trpc.appBuilds.settings.queryOptions(), enabled: open });
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [ask, setAsk] = useState('');
  const [appsDir, setAppsDir] = useState('');
  const [kit, setKit] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!settings.data) return;
    setAppsDir(settings.data.appsDir);
    setKit(settings.data.appKitCommand ?? '');
    // Only a copy of Ri that carries no kit needs the person to point at one.
    if (!settings.data.appKitCommand && !settings.data.tools.kit) setShowSettings(true);
  }, [settings.data]);
  const tools = settings.data?.tools;
  const kitReady = !!kit.trim() || !!tools?.kit;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (settings.data && (appsDir !== settings.data.appsDir || kit !== (settings.data.appKitCommand ?? ''))) {
        await trpcClient.appBuilds.setSettings.mutate({ appsDir: appsDir === settings.data.defaultAppsDir ? null : appsDir, appKitCommand: kit || null });
      }
      const source = await trpcClient.appBuilds.create.mutate({ name });
      const chat = await ensureAppBuilderChat(source.id);
      const request = ask.trim();
      if (request) await trpcClient.sessions.messagesPost.mutate({ params: { id: chat.id }, body: { id: uuidv7(), content: request } });
      await queryClient.invalidateQueries({ queryKey: trpc.appBuilds.pathKey() });
      setName(''); setAsk('');
      onOpenChange(false);
      onCreated(source.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New app</DialogTitle>
            <DialogDescription>
              A small app of your own, with its own data, that works in {APP_NAME} and with any assistant. An agent builds it in its own folder. You install it when it&apos;s ready.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-xs font-medium">
            <span>Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Baby tracker" required maxLength={60} autoFocus />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            <span>What should it do?</span>
            <Textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={4} placeholder="Track feeds, sleep and diapers, with a daily summary." />
          </label>
          {showSettings ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <label className="block space-y-1 text-xs font-medium">
                <span>Apps folder</span>
                <Input value={appsDir} onChange={(e) => setAppsDir(e.target.value)} />
                <span className="block font-normal text-muted-foreground">Each app gets its own folder and git repository here.</span>
              </label>
              <label className="block space-y-1 text-xs font-medium">
                <span>{tools?.kit ? 'Kit checkout (for developers)' : 'App kit command'}</span>
                <Input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="pnpm --dir /path/to/app-kit create:app" className="font-mono text-xs" />
                <span className="block font-normal text-muted-foreground">
                  {tools?.kit
                    ? <>{APP_NAME} makes apps with the app kit {tools.kit.version} it carries. To use a kit checkout instead, give the command that runs its create. {APP_NAME} adds the new app&apos;s folder at the end.</>
                    : <>The command that runs the app kit&apos;s create. {APP_NAME} adds the new app&apos;s folder at the end.</>}
                </span>
              </label>
            </div>
          ) : (
            <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2" onClick={() => setShowSettings(true)}>
              Made in {settings.data?.appsDir ?? 'your apps folder'}. Change
            </button>
          )}
          {tools && !tools.git && tools.gitHelp && <p role="status" className="flex items-start gap-2 text-xs text-muted-foreground"><AlertCircle size={13} className="mt-0.5 shrink-0" />{tools.gitHelp}</p>}
          {error && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim() || !kitReady || tools?.git === false}>{busy && <Loader2 size={14} className="animate-spin" />}Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
