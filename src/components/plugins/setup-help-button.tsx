'use client';

import { Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { usePluginSetupHelp } from '@/hooks/use-plugin-setup-help';
import type { PluginSetupHelpTarget } from '@/lib/plugins/setup-help';

/** Available before connecting, after a failure, and for already-installed plugins. */
export function PluginSetupHelpButton({ target, disabled = false }: { target: PluginSetupHelpTarget; disabled?: boolean }) {
  const help = usePluginSetupHelp();
  return <div className="space-y-2">
    <Tip label="Sends setup details to your main chat so your agent can investigate.">
      <Button type="button" size="sm" variant="outline" className="text-xs" disabled={disabled || help.isPending || !help.available} onClick={() => void help.ask(target)}>
        {help.isPending ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
        {help.isPending ? 'Asking your main agent…' : 'Get setup help'}
      </Button>
    </Tip>
    {help.error && <p role="alert" className="text-xs text-destructive">{help.error}</p>}
  </div>;
}
