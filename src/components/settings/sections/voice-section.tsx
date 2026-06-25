'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic, Globe, Server, Cloud, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { VOICE_MODELS, VOICE_MODEL_MAP, DEFAULT_VOICE_MODEL, type VoiceModel } from '@/constants/voice-models';
import type { ProviderStatus } from '@/hooks/use-voice-input';
import { api } from '@/lib/api/client';

const PROVIDER_LABELS: Record<string, { label: string; icon: typeof Server }> = {
  local: { label: 'Local', icon: Server },
  groq: { label: 'Cloud (Groq)', icon: Cloud },
  openai: { label: 'Cloud (OpenAI)', icon: Cloud },
  web: { label: 'Browser', icon: Globe },
};

const PROVIDER_TABS = ['all', 'local', 'cloud', 'web'] as const;
type ProviderTab = (typeof PROVIDER_TABS)[number];

function Dots({ value, color }: { value: number; color: string }) {
  const filled = Math.round(value / 2);
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block h-1.5 w-1.5 rounded-full ${i < filled ? color : 'bg-muted-foreground/20'}`}
        />
      ))}
    </span>
  );
}

function ModelCard({
  model,
  isSelected,
  providerStatus,
  onSelect,
}: {
  model: VoiceModel;
  isSelected: boolean;
  providerStatus: ProviderStatus | null;
  onSelect: () => void;
}) {
  const status = providerStatus?.[model.provider];
  const isAvailable = model.provider === 'web' ? true : status?.available ?? false;
  const isConfigured = model.provider === 'web' ? true : status?.configured ?? false;
  const needsSetup = !isConfigured && model.provider !== 'local';
  const needsServer = model.provider === 'local' && !isAvailable;

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition-all ${
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-background hover:border-muted-foreground/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{model.label}</p>
            {isSelected && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Active</span>
            )}
            {needsSetup && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">Setup Required</span>
            )}
            {needsServer && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">Server Offline</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground/70">
            <span className="flex items-center gap-1">
              <Globe size={10} />
              {model.language === 'multilingual' ? 'Multilingual' : 'English-only'}
            </span>
            <span className="flex items-center gap-1">
              Speed <Dots value={model.speed} color="bg-emerald-500" />
            </span>
            <span className="flex items-center gap-1">
              Accuracy <Dots value={model.accuracy} color="bg-blue-500" />
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/60">{model.description}</p>
        </div>
        {isAvailable && isConfigured && !isSelected && (
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-muted-foreground/30" />
        )}
        {isSelected && <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-primary" />}
        {(needsSetup || needsServer) && <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />}
      </div>

      {needsSetup && (
        <div className="mt-2 rounded bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground/60">
          Add <code className="font-mono text-foreground/70">{model.envKey}</code> to your{' '}
          <code className="font-mono text-foreground/70">.env.local</code> file
        </div>
      )}
      {needsServer && (
        <div className="mt-2 rounded bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground/60">
          Start the local server: <code className="font-mono text-foreground/70">pnpm dev:stt</code>
        </div>
      )}
    </button>
  );
}

/**
 * Voice input preferences: auto-send toggle + the speech-to-text model picker
 * (with live provider availability probing). Persists to
 * `user_state.voiceAutoSend` / `voiceModel`.
 */
export function VoiceSection() {
  const { data: userState } = useUserState();
  const update = useUpdateUserState();
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [activeTab, setActiveTab] = useState<ProviderTab>('all');
  const [modelPickerOpen, setModelPickerOpen] = useState(true);

  const selectedModelId = userState?.voiceModel ?? DEFAULT_VOICE_MODEL;
  const selectedModel = VOICE_MODEL_MAP.get(selectedModelId);
  const autoSend = userState?.voiceAutoSend ?? true;

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ providers: ProviderStatus }>('/transcribe')
      .then((data) => {
        if (!cancelled) setProviderStatus(data.providers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectModel = useCallback(
    (modelId: string) => {
      update.mutate({ voiceModel: modelId });
      setModelPickerOpen(false);
    },
    [update],
  );

  const filteredModels = VOICE_MODELS.filter((m) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'cloud') return m.provider === 'groq' || m.provider === 'openai';
    return m.provider === activeTab;
  });

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Mic size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Auto-send voice messages</p>
            <p className="text-[11px] text-muted-foreground/60">
              When enabled, voice input sends immediately. When disabled, transcription goes to the text box for editing.
            </p>
          </div>
        </div>
        <Switch
          checked={autoSend}
          onCheckedChange={(next) => update.mutate({ voiceAutoSend: next })}
          aria-label="Auto-send voice messages"
        />
      </label>

      <button
        onClick={() => setModelPickerOpen((v) => !v)}
        className="w-full rounded-lg border border-border bg-background p-3 text-left transition-all hover:border-muted-foreground/30"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Default model</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{selectedModel?.label ?? selectedModelId}</p>
          </div>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`} />
        </div>
        {selectedModel && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground/60">
            <span>{selectedModel.language === 'multilingual' ? 'Multilingual' : 'English-only'}</span>
            <span>·</span>
            <span>{PROVIDER_LABELS[selectedModel.provider]?.label}</span>
          </div>
        )}
      </button>

      {modelPickerOpen && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {PROVIDER_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
                  activeTab === tab
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'cloud' ? 'Cloud' : tab === 'local' ? 'Local' : 'Browser'}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {filteredModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                isSelected={model.id === selectedModelId}
                providerStatus={providerStatus}
                onSelect={() => handleSelectModel(model.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
