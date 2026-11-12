'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import { trpc, trpcClient } from '@/lib/trpc/client';

/**
 * Add a personal app that is already running, by the MCP address it prints (docs/personal-apps.md).
 * Ri connects its own chats first. The app's consent screen opens next, and asks what Ri may see
 * and whether it may make changes. Agents get their own connection from their settings.
 */
export function AddAppDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const result = await trpcClient.personalApps.add.mutate({ name, url, returnTo });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.personalApps.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.integrations.pathKey() }),
      ]);
      if (result.requiresAuth) await openIntegrationAuthorization(result.authUrl);
      setName('');
      setUrl('');
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add an app</DialogTitle>
            <DialogDescription>
              An app that runs on its own, on this computer or online. Paste the MCP address it shows, like http://127.0.0.1:4310/mcp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reading Log" autoFocus required maxLength={60} />
            </label>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>MCP address</span>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:4310/mcp" required inputMode="url" />
            </label>
            <p className="text-[11px] text-muted-foreground">The app asks next what Ri may see and whether it may make changes. Each agent you allow later gets its own connection and its own choice.</p>
          </div>
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim() || !url.trim()}>{busy && <Loader2 size={14} className="animate-spin" />}Continue</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
