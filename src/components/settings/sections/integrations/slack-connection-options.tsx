'use client';

import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openSettings } from '@/components/settings/settings-store';
import { INTEGRATION_LABELS } from '@/constants/integrations';

/** Both Slack capabilities remain discoverable before and after account authorization. */
export function SlackConnectionOptions({ disabled = false }: { disabled?: boolean }) {
  return <section aria-label="Slack connection options" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
    <div className="space-y-1">
      <h3 className="font-medium">Talk to your agent in Slack</h3>
      <p className="text-muted-foreground">Mention your Ri agent in a channel or message it directly. Replies return to Slack, and the same conversation is saved in Ri.</p>
    </div>
    <Button size="sm" variant="outline" disabled={disabled} onClick={() => openSettings('conversations')}><MessageSquare size={14} /> Add your agent to Slack</Button>
    <p className="text-xs text-muted-foreground">{`The account ${INTEGRATION_LABELS.singular} below lets Ri search, read and send as you. One Slack app can support both, with separate permissions. You can connect either capability on its own.`}</p>
  </section>;
}
