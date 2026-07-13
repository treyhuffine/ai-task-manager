'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, LogOut, PlugZap, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { ProviderAuthFlow, ProviderAuthMethod, UpstreamProvider } from '@agentex/agent';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function OpenCodeProviderPanel() {
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ['opencode-providers'],
    queryFn: () => api.get<{ providers: UpstreamProvider[] }>('/agent/opencode/providers'),
    staleTime: 30_000,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewAll, setViewAll] = useState(false);

  const allProviders = providers.data?.providers ?? [];
  const curatedTerms = ['zen', 'opencode', 'openai', 'anthropic', 'xai', 'google', 'github', 'vercel', 'openrouter'];
  const ordered = [...allProviders].sort((a, b) => {
    const rank = (provider: UpstreamProvider) => {
      const value = `${provider.id} ${provider.name}`.toLowerCase();
      const index = curatedTerms.findIndex((term) => value.includes(term));
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return Number(b.connected) - Number(a.connected) || rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  const needle = search.trim().toLowerCase();
  const visibleProviders = needle
    ? ordered.filter((provider) => `${provider.name} ${provider.id}`.toLowerCase().includes(needle))
    : viewAll
      ? ordered
      : ordered.filter((provider) => provider.connected || curatedTerms.some((term) => `${provider.id} ${provider.name}`.toLowerCase().includes(term)));

  const refresh = () => {
    void providers.refetch();
    void queryClient.invalidateQueries({ queryKey: ['agent-connection', 'opencode'] });
    void queryClient.invalidateQueries({ queryKey: ['agent-models', 'opencode'] });
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 font-medium text-foreground"><PlugZap size={13} /> OpenCode providers</div>
          <p className="mt-0.5 text-[10.5px] text-muted-foreground">Add API keys or complete provider OAuth through OpenCode.</p>
        </div>
        {providers.isFetching && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
      </div>
      {providers.error && (
        <p className="rounded border border-destructive/30 bg-destructive/5 p-2 text-[10.5px] text-destructive">
          OpenCode provider management is unavailable. Check the installed OpenCode version.
        </p>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search providers" className="h-8 rounded-md pl-8 text-[11px]" />
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto [scrollbar-width:thin]">
        {visibleProviders.map((provider) => (
          <div key={provider.id} className="rounded-md border border-border/70">
            <button
              type="button"
              onClick={() => setExpanded(expanded === provider.id ? null : provider.id)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40"
            >
              <span className={cn('h-2 w-2 rounded-full', provider.connected ? 'bg-emerald-500' : 'bg-muted-foreground/35')} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-foreground">{provider.name}</span>
              <span className="text-[10px] text-muted-foreground">{provider.connected ? 'Connected' : 'Set up'}</span>
            </button>
            {expanded === provider.id && (
              <ProviderSetup provider={provider} onChanged={refresh} />
            )}
          </div>
        ))}
      </div>
      {!needle && visibleProviders.length < ordered.length && (
        <Button size="xs" variant="ghost" onClick={() => setViewAll(true)}>View all providers</Button>
      )}
    </div>
  );
}

function ProviderSetup({ provider, onChanged }: { provider: UpstreamProvider; onChanged: () => void }) {
  const methods = useQuery({
    queryKey: ['opencode-provider-methods', provider.id],
    queryFn: () => api.get<{ methods: ProviderAuthMethod[]; canDisconnect: boolean }>(
      `/agent/opencode/providers/${encodeURIComponent(provider.id)}`,
    ),
  });
  const [methodId, setMethodId] = useState<string | null>(null);
  const method = methods.data?.methods.find((entry) => entry.id === methodId) ?? methods.data?.methods[0] ?? null;
  const [apiKey, setApiKey] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [flow, setFlow] = useState<ProviderAuthFlow | null>(null);
  const [code, setCode] = useState('');

  const setKey = useMutation({
    mutationFn: () => api.put(`/agent/opencode/providers/${encodeURIComponent(provider.id)}`, { apiKey }),
    onSuccess: () => {
      setApiKey('');
      toast.success(`${provider.name} connected`);
      onChanged();
    },
  });
  const beginOAuth = useMutation({
    mutationFn: () => api.post<ProviderAuthFlow>('/agent/opencode/oauth', {
      action: 'begin',
      providerId: provider.id,
      methodId: method?.id,
      inputs,
    }),
    onSuccess: (nextFlow) => {
      setFlow(nextFlow);
      if (nextFlow.url) window.open(nextFlow.url, '_blank', 'noopener,noreferrer');
    },
  });
  const completeOAuth = useMutation({
    mutationFn: () => api.post('/agent/opencode/oauth', {
      action: 'complete',
      flowId: flow?.id,
      ...(code.trim() ? { code: code.trim() } : {}),
    }),
    onSuccess: () => {
      setFlow(null);
      setCode('');
      toast.success(`${provider.name} connected`);
      onChanged();
    },
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      const response = await api.raw(`/agent/opencode/providers/${encodeURIComponent(provider.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(response.status, body, response.url);
      return body;
    },
    onSuccess: () => {
      toast.success(`${provider.name} disconnected`);
      onChanged();
    },
    onError: (error) => {
      const needsReplacement = error instanceof ApiError && error.status === 409;
      toast.error('Could not disconnect provider', {
        description: needsReplacement
          ? 'Choose a different default model first, then try again.'
          : error instanceof Error ? error.message : String(error),
      });
    },
  });

  if (methods.isLoading) return <div className="flex justify-center p-3"><Loader2 size={13} className="animate-spin" /></div>;

  if (provider.connected) {
    return (
      <div className="flex items-center justify-between border-t border-border/70 px-2.5 py-2">
        <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={11} /> Ready</span>
        {methods.data?.canDisconnect && (
          <Button size="xs" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
            <LogOut /> Disconnect
          </Button>
        )}
      </div>
    );
  }

  if (!method) return <p className="border-t border-border/70 p-2.5 text-[10.5px] text-muted-foreground">No setup methods are available.</p>;

  return (
    <div className="space-y-2 border-t border-border/70 p-2.5">
      {(methods.data?.methods.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-1">
          {methods.data!.methods.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => { setMethodId(entry.id); setFlow(null); }}
              className={cn('rounded px-2 py-1 text-[10.5px]', entry.id === method.id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
      {method.type === 'api_key' ? (
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`${provider.name} API key`} className="h-8 rounded-md text-[11px]" />
          <Button size="sm" disabled={!apiKey.trim() || setKey.isPending} onClick={() => setKey.mutate()}>
            <KeyRound /> Save
          </Button>
        </div>
      ) : flow ? (
        <div className="space-y-2">
          {flow.instructions && <p className="text-[10.5px] text-muted-foreground">{flow.instructions}</p>}
          {flow.url && (
            <a href={flow.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10.5px] font-medium text-primary hover:underline">
              Open authorization page <ExternalLink size={10} />
            </a>
          )}
          {flow.completion === 'code' && <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Authorization code" className="h-8 rounded-md text-[11px]" />}
          <Button size="sm" disabled={(flow.completion === 'code' && !code.trim()) || completeOAuth.isPending} onClick={() => completeOAuth.mutate()}>
            {completeOAuth.isPending && <Loader2 className="animate-spin" />} Finish setup
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {method.prompts?.map((prompt) => prompt.type === 'select' ? (
            <label key={prompt.id} className="block text-[10.5px] text-muted-foreground">
              {prompt.label}
              <select
                value={inputs[prompt.id] ?? ''}
                onChange={(event) => setInputs((current) => ({ ...current, [prompt.id]: event.target.value }))}
                className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-[11px] text-foreground"
              >
                <option value="">Select</option>
                {prompt.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : (
            <label key={prompt.id} className="block text-[10.5px] text-muted-foreground">
              {prompt.label}
              <Input value={inputs[prompt.id] ?? ''} onChange={(event) => setInputs((current) => ({ ...current, [prompt.id]: event.target.value }))} className="mt-1 h-8 rounded-md text-[11px]" />
            </label>
          ))}
          <Button size="sm" disabled={beginOAuth.isPending} onClick={() => beginOAuth.mutate()}>
            {beginOAuth.isPending && <Loader2 className="animate-spin" />} Connect with {method.name}
          </Button>
        </div>
      )}
    </div>
  );
}
