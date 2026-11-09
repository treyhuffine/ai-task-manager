'use client';

import { useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { integrationMeta } from '@/components/integrations/integration-meta';
import { SLACK_ACCOUNT_USER_SCOPES, slackAccountCreateUrl } from '@/lib/integrations/slack-account-setup';

export function SlackAccountSetup({ redirectUri, callbackFields, credentials, saveAction, savedApps }: {
  redirectUri: string;
  callbackFields: ReactNode;
  credentials: ReactNode;
  saveAction: ReactNode;
  savedApps: ReactNode;
}) {
  const meta = integrationMeta('slack');
  const createUrl = slackAccountCreateUrl(meta.appUrl!, redirectUri);
  const [copyStatus, setCopyStatus] = useState('');
  const scopesJson = JSON.stringify(SLACK_ACCOUNT_USER_SCOPES, null, 2);

  return <section aria-label="Slack account setup" className="space-y-4 text-sm">
    <p>Give Ri access to search, read and send messages as your Slack account. Follow these three steps, then approve access in Slack.</p>
    <ol className="space-y-5">
      <li className="space-y-3">
        <h4 className="font-medium">1. Create or open your Slack app</h4>
        <p className="text-muted-foreground">The button opens Slack with Ri’s callback address and permissions already filled in. Choose your Slack workspace, review the app and click <strong>Create</strong>. The app can stay internal to that workspace.</p>
        <div className="flex flex-wrap items-center gap-3">
          {createUrl ? <Button asChild size="sm"><a href={createUrl} target="_blank" rel="noopener noreferrer">Create Slack app <ExternalLink size={13} /></a></Button>
            : <Button size="sm" disabled>Create Slack app</Button>}
          <a className="text-xs font-medium text-primary underline-offset-4 hover:underline" href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">Open existing Slack apps</a>
          <a className="text-xs text-muted-foreground underline-offset-4 hover:underline" href={meta.docsUrl} target="_blank" rel="noopener noreferrer">Slack reference docs</a>
        </div>
        {!redirectUri && <p role="status" className="text-muted-foreground">Ri’s callback address is unavailable. Reload these settings before creating the app.</p>}
        <p className="text-xs text-muted-foreground">Slack requests account permissions for reading conversations, sending messages and editing content. You will review access when signing in.</p>
        <details className="space-y-3 rounded-lg border border-border/60 p-3">
          <summary className="cursor-pointer font-medium">Use an app I already created</summary>
          <p className="text-muted-foreground">Open your app using <strong>Open existing Slack apps</strong> above. You can reuse the internal app you use to talk to Ri in Slack.</p>
          <p className="text-muted-foreground">In <strong>OAuth &amp; Permissions → Redirect URLs</strong>, add this callback address and save it.</p>
          {callbackFields}
          <p className="text-muted-foreground">Open <strong>App Manifest</strong>. Under <code>oauth_config.scopes.user</code>, add any missing permissions from the list below and save the manifest. Keep your existing user scopes, <code>bot</code> scopes and other app settings.</p>
          <pre className="max-h-44 overflow-auto rounded-md bg-muted p-3 text-xs" aria-label="Slack user scopes">{scopesJson}</pre>
          <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(scopesJson).then(() => setCopyStatus('User scopes copied')).catch(() => setCopyStatus('Copy failed. Select and copy the list above.'))}>Copy user scopes</Button>
          {copyStatus && <p role="status" className="text-xs text-muted-foreground">{copyStatus}</p>}
          <p className="text-xs text-muted-foreground">This uses Ri’s web callback. Leave Slack’s public-client PKCE setting unchanged.</p>
          <p className="text-muted-foreground">In <strong>App Manifest</strong>, set <code>settings.is_mcp_enabled</code> to <code>true</code>. Keep the other settings. This enables Slack account tools for the app.</p>
        </details>
      </li>
      <li className="space-y-3 border-t border-border/60 pt-4">
        <h4 className="font-medium">2. Copy your app credentials into Ri</h4>
        <p className="text-muted-foreground">After creating the app, Slack opens <strong>Basic Information</strong>. Under <strong>App Credentials</strong>, copy <strong>Client ID</strong>. Click <strong>Show</strong> beside <strong>Client Secret</strong> and copy that too. Paste both below, give the app a label and click <strong>Save app and continue</strong>.</p>
        {credentials}
        <p className="text-xs text-muted-foreground">Credentials are stored encrypted in your Ri. Bot tokens and app-level tokens belong to the separate Slack conversation setup.</p>
        {saveAction}
      </li>
      <li className="space-y-3 border-t border-border/60 pt-4">
        <h4 className="font-medium">3. Sign in to Slack</h4>
        <p className="text-muted-foreground">Saving the app prepares sign-in. Next, choose that app and click <strong>Connect Slack</strong>. Choose the workspace and Slack account you want Ri to use, then approve access. Slack brings you back to Ri and checks its tools.</p>
        {savedApps}
        <p className="text-muted-foreground">The account should show <strong>Connected</strong>. Click <strong>Test connection</strong> to check it, then try asking Ri: <strong>Find recent Slack messages that mention me.</strong></p>
      </li>
    </ol>
  </section>;
}

/** Once the app is saved, the next action is account authorization. */
export function SlackAccountSignInHelp() {
  const meta = integrationMeta('slack');
  return <div className="space-y-2 text-sm">
    <h4 className="font-medium">3. Sign in to Slack</h4>
    <p className="text-muted-foreground">Your Slack app is saved in Ri. Choose the app and name this account, then click <strong>Connect Slack</strong>. Approve access in Slack. The account is ready when Ri has checked its tools and shows <strong>Connected</strong>.</p>
    <p className="text-muted-foreground">When the account shows <strong>Connected</strong>, click <strong>Test connection</strong>. Then ask Ri: <strong>Find recent Slack messages that mention me.</strong></p>
    <div className="flex flex-wrap gap-3 text-xs">
      <a className="font-medium text-primary hover:underline" href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">Open Slack app settings</a>
      <a className="text-muted-foreground hover:underline" href={meta.docsUrl} target="_blank" rel="noopener noreferrer">Slack reference docs</a>
    </div>
  </div>;
}
