'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { slackMcpAccessIssue } from '@/lib/integrations/slack-account-setup';

export function SlackMcpAccessHelp({ error }: { error: string }) {
  const issue = slackMcpAccessIssue(error);
  if (!issue) return null;
  return <div role="alert" className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
    <p className="font-medium">Enable Slack access for this app</p>
    <p className="text-muted-foreground">Slack is blocking this app from using its tools. Open its settings and enable access to the Slack MCP server. Then return here and test the connection, or continue signing in if asked.</p>
    <Button asChild size="sm" variant="outline"><a href={issue.settingsUrl} target="_blank" rel="noopener noreferrer">Enable Slack access <ExternalLink size={13} /></a></Button>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Technical details</summary><p className="mt-2 break-words">{error}</p></details>
  </div>;
}
