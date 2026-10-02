'use client';

import { Check, Copy, ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectorMeta } from '@/components/connectors/connector-meta';
import { APP_NAME } from '@/constants/app';
import { isRegisteredMcp, oauthAppRedirectUri, type AuthConfigSummary, type ByoForm, type ProviderStatus } from './types';

/**
 * Bring-your-own OAuth app for an OAuth provider: the redirect URI to register,
 * the apps already added (connect / make default / remove), and a form to add
 * one. The client is stored sealed in the user's home, never in the repo. The
 * host supplies the heading: it is the whole connect flow for providers with no
 * bundled client, and an Advanced disclosure for the rest.
 */
export function ByoPanel({
  provider,
  redirectUri,
  copied,
  onCopyRedirect,
  configs,
  form,
  busy,
  onField,
  onAdd,
  onConnect,
  onSetDefault,
  onDelete,
  connectDisabled = false,
  usedAuthConfigIds = [],
}: {
  provider: ProviderStatus;
  redirectUri: string;
  copied: boolean;
  onCopyRedirect: () => void;
  configs: AuthConfigSummary[];
  form: ByoForm;
  busy: boolean;
  onField: (field: keyof ByoForm, value: string) => void;
  onAdd: () => void;
  onConnect: (authConfigId: string) => void;
  onSetDefault: (id: string) => void;
  onDelete: (id: string) => void;
  connectDisabled?: boolean;
  usedAuthConfigIds?: string[];
}) {
  const { docsUrl, setup } = connectorMeta(provider.id);
  const registered = isRegisteredMcp(provider);
  const boundClientId = registered ? provider.mcp?.authConfigId : undefined;
  const callback = oauthAppRedirectUri(provider, redirectUri);
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-normal text-muted-foreground">
        {!registered && provider.desktopCallback?.kind === 'loopback'
          ? `Create a desktop or native OAuth app with ${provider.displayName} that accepts loopback redirects on a temporary port. Paste its client ID below.`
          : `Register an app with ${provider.displayName}, add the callback address below, then paste the client below.`}
        {' '}Credentials are stored encrypted in your app home.
      </p>
      {setup && setup.length > 0 && (
        <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-normal text-muted-foreground">
          {setup.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
        >
          Create an app on {provider.displayName}
          <ExternalLink size={11} />
        </a>
      )}

      {/* Redirect URI to register */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 p-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">{registered ? callback || 'Callback address unavailable' : provider.desktopCallback ? provider.desktopCallback.kind === 'loopback' ? 'http://127.0.0.1:<temporary-port>/oauth/callback' : provider.desktopCallback.redirectUri || 'Configure a hosted callback service first' : redirectUri}</code>
        <Button disabled={registered ? !callback : !!provider.desktopCallback && !provider.desktopCallback.redirectUri} variant="ghost" size="icon-xs" onClick={onCopyRedirect} title="Copy redirect URI">
          {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
        </Button>
      </div>
      {/* Web callbacks follow Ri's address (src/lib/connectors/live-callback.ts). */}
      {(registered || !provider.desktopCallback) && (
        <p className="text-[11px] leading-normal text-muted-foreground">
          This follows {APP_NAME}&apos;s address in Devices, and every sign-in uses it. If that address changes, add the new
          one to your app on {provider.displayName} too.
        </p>
      )}

      {boundClientId && <p className="text-[11px] text-muted-foreground">This connection uses {configs.find(config => config.id === boundClientId)?.label ?? boundClientId}. Disconnect before changing or removing its OAuth app.</p>}

      {/* Existing BYO clients */}
      {configs.length > 0 && (
        <div className="space-y-1.5">
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5 text-[11px]"
            >
              <span className="min-w-0 truncate text-foreground">
                {cfg.label ?? cfg.id}
                {cfg.isDefault && <span className="ml-1 text-muted-foreground">· default</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  aria-label={`Connect using ${cfg.label ?? cfg.id}`}
                  onClick={() => onConnect(cfg.id)}
                  disabled={busy || connectDisabled || cfg.status !== 'active' || (!!boundClientId && cfg.id !== boundClientId)}
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-40"
                >
                  <ExternalLink size={11} /> Connect
                </button>
                {!cfg.isDefault && (
                  <button
                    aria-label={`Make ${cfg.label ?? cfg.id} default`}
                    onClick={() => onSetDefault(cfg.id)}
                    disabled={busy}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    Default
                  </button>
                )}
                <button
                  aria-label={`Remove ${cfg.label ?? cfg.id}`}
                  onClick={() => onDelete(cfg.id)}
                  disabled={busy || cfg.id === boundClientId || usedAuthConfigIds.includes(cfg.id)}
                  className="text-destructive hover:underline disabled:opacity-40"
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add a client */}
      <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
        <Input
          value={form.label}
          onChange={(e) => onField('label', e.target.value)}
          placeholder="Label (e.g. Work)"
          className="h-8 rounded-lg text-xs"
        />
        <Input
          value={form.clientId}
          onChange={(e) => onField('clientId', e.target.value)}
          placeholder="Client ID"
          className="h-8 rounded-lg font-mono text-xs"
        />
        <Input
          type="password"
          autoComplete="off"
          value={form.clientSecret}
          onChange={(e) => onField('clientSecret', e.target.value)}
          placeholder={registered ? 'Client secret' : 'Client secret (if required)'}
          required={registered}
          className="h-8 rounded-lg font-mono text-xs @lg:col-span-2"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onAdd}
        disabled={busy || !form.label.trim() || !form.clientId.trim() || (registered && (!callback || !form.clientSecret.trim()))}
        className="text-xs font-semibold"
      >
        <Plus size={14} /> Add app
      </Button>
    </div>
  );
}
