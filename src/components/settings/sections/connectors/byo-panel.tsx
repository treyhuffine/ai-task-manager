'use client';

import { Check, Copy, ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectorMeta } from '@/components/connectors/connector-meta';
import type { AuthConfigSummary, ByoForm, ProviderStatus } from './types';

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
}) {
  const docsUrl = connectorMeta(provider.id).docsUrl;
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-normal text-muted-foreground">
        Register an app with {provider.displayName}, add this redirect URI, then paste the client below. It is stored
        sealed in your home, never in the repo.
      </p>
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
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{redirectUri}</code>
        <Button variant="ghost" size="icon-xs" onClick={onCopyRedirect} title="Copy redirect URI">
          {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
        </Button>
      </div>

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
                  onClick={() => onConnect(cfg.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-40"
                >
                  <ExternalLink size={11} /> Connect
                </button>
                {!cfg.isDefault && (
                  <button
                    onClick={() => onSetDefault(cfg.id)}
                    disabled={busy}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    Default
                  </button>
                )}
                <button
                  onClick={() => onDelete(cfg.id)}
                  disabled={busy}
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
          placeholder="Client secret (blank for PKCE)"
          className="h-8 rounded-lg font-mono text-xs @lg:col-span-2"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onAdd}
        disabled={busy || !form.label.trim() || !form.clientId.trim()}
        className="text-xs font-semibold"
      >
        <Plus size={14} /> Add app
      </Button>
    </div>
  );
}
