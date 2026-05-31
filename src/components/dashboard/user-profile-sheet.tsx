'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { SlidersHorizontal, Mic, Globe, Server, Cloud, CheckCircle2, AlertCircle, ChevronDown, Sun, Moon, DollarSign } from 'lucide-react'
import { useDashboard } from '@/contexts/dashboard-context'
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state'
import { VOICE_MODELS, VOICE_MODEL_MAP, DEFAULT_VOICE_MODEL, type VoiceModel } from '@/constants/voice-models'
import type { ProviderStatus } from '@/hooks/use-voice-input'
import { api } from '@/lib/api/client'
import { useRunsStats } from '@/hooks/use-runs-stats'
import { OPEN_USER_PROFILE_EVENT } from './budget-warning-pill'

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

const PROVIDER_LABELS: Record<string, { label: string; icon: typeof Server }> = {
  local: { label: 'Local', icon: Server },
  groq: { label: 'Cloud (Groq)', icon: Cloud },
  openai: { label: 'Cloud (OpenAI)', icon: Cloud },
  web: { label: 'Browser', icon: Globe },
}

const PROVIDER_TABS = ['all', 'local', 'cloud', 'web'] as const
type ProviderTab = typeof PROVIDER_TABS[number]

function SpeedDots({ value }: { value: number }) {
  const filled = Math.round(value / 2) // 1-10 → 1-5 dots
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            i < filled ? 'bg-emerald-500' : 'bg-muted-foreground/20'
          }`}
        />
      ))}
    </span>
  )
}

function AccuracyDots({ value }: { value: number }) {
  const filled = Math.round(value / 2)
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            i < filled ? 'bg-blue-500' : 'bg-muted-foreground/20'
          }`}
        />
      ))}
    </span>
  )
}

function ModelCard({
  model,
  isSelected,
  providerStatus,
  onSelect,
}: {
  model: VoiceModel
  isSelected: boolean
  providerStatus: ProviderStatus | null
  onSelect: () => void
}) {
  const status = providerStatus?.[model.provider]
  const isAvailable = model.provider === 'web' ? true : status?.available ?? false
  const isConfigured = model.provider === 'web' ? true : status?.configured ?? false

  const needsSetup = !isConfigured && model.provider !== 'local'
  const needsServer = model.provider === 'local' && !isAvailable

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
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
              <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">Active</span>
            )}
            {needsSetup && (
              <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">Setup Required</span>
            )}
            {needsServer && (
              <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">Server Offline</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground/70">
            <span className="flex items-center gap-1">
              <Globe size={10} />
              {model.language === 'multilingual' ? 'Multilingual' : 'English-only'}
            </span>
            <span className="flex items-center gap-1">
              Speed <SpeedDots value={model.speed} />
            </span>
            <span className="flex items-center gap-1">
              Accuracy <AccuracyDots value={model.accuracy} />
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-1">{model.description}</p>
        </div>
        {isAvailable && isConfigured && !isSelected && (
          <CheckCircle2 size={14} className="text-muted-foreground/30 mt-0.5 shrink-0" />
        )}
        {isSelected && (
          <CheckCircle2 size={14} className="text-primary mt-0.5 shrink-0" />
        )}
        {(needsSetup || needsServer) && (
          <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
        )}
      </div>

      {/* Setup instructions */}
      {needsSetup && (
        <div className="mt-2 text-[11px] text-muted-foreground/60 bg-muted/50 rounded px-2 py-1.5">
          Add <code className="text-foreground/70 font-mono">{model.envKey}</code> to your <code className="text-foreground/70 font-mono">.env.local</code> file
        </div>
      )}
      {needsServer && (
        <div className="mt-2 text-[11px] text-muted-foreground/60 bg-muted/50 rounded px-2 py-1.5">
          Start the local server: <code className="text-foreground/70 font-mono">pnpm dev:stt</code>
        </div>
      )}
    </button>
  )
}

export function UserProfileSheet({ open: controlledOpen, onOpenChange, children }: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
} = {}) {
  const { theme, toggleTheme } = useDashboard()
  const isDark = theme === 'dark'
  const { data: userState } = useUserState()
  const updateUserState = useUpdateUserState()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const [description, setDescription] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [, setTick] = useState(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [activeTab, setActiveTab] = useState<ProviderTab>('all')
  const [modelPickerOpen, setModelPickerOpen] = useState(true)

  const selectedModelId = userState?.voiceModel ?? DEFAULT_VOICE_MODEL
  const selectedModel = VOICE_MODEL_MAP.get(selectedModelId)

  // Probe provider availability when sheet opens
  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function probe() {
      try {
        const data = await api.get<{ providers: ProviderStatus }>('/transcribe')
        if (!cancelled) setProviderStatus(data.providers)
      } catch {
        // ignore
      }
    }

    probe()
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (userState) {
      setDescription(userState.description)
    }
  }, [userState?.description]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (value: string) => {
      setDescription(value)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        updateUserState.mutate(
          { description: value },
          { onSuccess: () => setLastSavedAt(new Date()) }
        )
      }, 500)
    },
    [updateUserState]
  )

  const handleSelectModel = useCallback(
    (modelId: string) => {
      updateUserState.mutate(
        { voiceModel: modelId },
        { onSuccess: () => setLastSavedAt(new Date()) }
      )
      setModelPickerOpen(false)
    },
    [updateUserState]
  )

  // Tick every 30s to keep "Last saved" text fresh
  useEffect(() => {
    if (!lastSavedAt) return
    const interval = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [lastSavedAt])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // Listen for the budget-warning pill (TopHud) — clicking it should
  // open this sheet so the user lands on the budget control + spending
  // breakdown in one shot. Avoids hoisting open state through the
  // dashboard tree.
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener(OPEN_USER_PROFILE_EVENT, handler)
    return () => window.removeEventListener(OPEN_USER_PROFILE_EVENT, handler)
  }, [setOpen])

  const filteredModels = VOICE_MODELS.filter((m) => {
    if (activeTab === 'all') return true
    if (activeTab === 'cloud') return m.provider === 'groq' || m.provider === 'openai'
    return m.provider === activeTab
  })

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {children ? (
        <SheetTrigger asChild>{children}</SheetTrigger>
      ) : (
        <SheetTrigger asChild>
          <button
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
            aria-label="Settings"
          >
            <SlidersHorizontal size={14} />
          </button>
        </SheetTrigger>
      )}
      <SheetContent side="right" className="w-full sm:!max-w-2xl">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Describe yourself, tune voice input, and theme. The AI uses your profile to personalize your experience.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 px-6 pb-6 overflow-y-auto pt-0.5">
          <textarea
            value={description}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="e.g. I'm a founder building a B2B SaaS product. I do my best deep work before noon. I tend to procrastinate on financial tasks..."
            className="w-full h-96 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          />
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            {updateUserState.isPending
              ? 'Saving...'
              : lastSavedAt
                ? `Last saved ${timeAgo(lastSavedAt)}`
                : 'Auto-saved'}
          </p>

          {/* Voice settings */}
          <div className="mt-8 space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Mic size={14} />
              Voice Input
            </h3>

            {/* Auto-send toggle */}
            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-background cursor-pointer group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Mic size={16} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Auto-send voice messages</p>
                  <p className="text-[11px] text-muted-foreground/60">
                    When enabled, voice input sends immediately. When disabled, voice transcription goes to the text box for editing.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={userState?.voiceAutoSend ?? true}
                onClick={() => {
                  const next = !(userState?.voiceAutoSend ?? true)
                  updateUserState.mutate(
                    { voiceAutoSend: next },
                    { onSuccess: () => setLastSavedAt(new Date()) }
                  )
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  (userState?.voiceAutoSend ?? true)
                    ? 'bg-primary'
                    : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    (userState?.voiceAutoSend ?? true) ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>

            {/* Current model summary */}
            <button
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
              className="w-full p-3 rounded-lg border border-border bg-background hover:border-muted-foreground/30 transition-all text-left"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Default Model</p>
                  <p className="text-sm font-medium text-foreground mt-0.5">{selectedModel?.label ?? selectedModelId}</p>
                </div>
                <ChevronDown size={14} className={`text-muted-foreground transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`} />
              </div>
              {selectedModel && (
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/60">
                  <span>{selectedModel.language === 'multilingual' ? 'Multilingual' : 'English-only'}</span>
                  <span>·</span>
                  <span>{PROVIDER_LABELS[selectedModel.provider]?.label}</span>
                </div>
              )}
            </button>

            {/* Model picker */}
            {modelPickerOpen && (
              <div className="space-y-3">
                {/* Tab filter */}
                <div className="flex gap-1">
                  {PROVIDER_TABS.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 text-[11px] font-medium rounded-full border transition-all ${
                        activeTab === tab
                          ? 'border-primary text-primary bg-primary/5'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tab === 'all' ? 'All' : tab === 'cloud' ? 'Cloud' : tab === 'local' ? 'Local' : 'Browser'}
                    </button>
                  ))}
                </div>

                {/* Model list */}
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

          {/* Spending */}
          <div className="mt-8 space-y-3">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <DollarSign size={14} />
              Spending
            </h3>
            <SpendingSummary />
            <BudgetField
              value={userState?.monthlyBudgetUsd ?? null}
              onSave={(v) =>
                updateUserState.mutate(
                  { monthlyBudgetUsd: v },
                  { onSuccess: () => setLastSavedAt(new Date()) }
                )
              }
            />
          </div>

          <div className="mt-8 space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              {isDark ? <Moon size={14} /> : <Sun size={14} />}
              Appearance
            </h3>
            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-background cursor-pointer group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  {isDark ? (
                    <Moon size={16} className="text-primary" />
                  ) : (
                    <Sun size={16} className="text-primary" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Dark mode</p>
                  <p className="text-[11px] text-muted-foreground/60">
                    Switch between light and dark themes for the whole app.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isDark}
                onClick={toggleTheme}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isDark ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    isDark ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Inline editor for the monthly USD ceiling. Default = null
 * (unlimited). Empty input clears any cap. Persists on blur to keep
 * the mutation count low.
 */
function BudgetField({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');
  useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);
  const unlimited = value == null;
  return (
    <div className="p-3 rounded-lg border border-border bg-background space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Monthly budget</p>
        {unlimited && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
            Unlimited
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/60">
        Set a USD cap and the TopHud warns at 75%, auto-pauses scheduled
        runs at 100% (manual sends ask first). Default is unlimited.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={draft}
          placeholder="Unlimited"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            if (!trimmed) {
              if (value != null) onSave(null);
              return;
            }
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed) || parsed < 0) {
              setDraft(value != null ? String(value) : '');
              return;
            }
            if (parsed !== value) onSave(parsed);
          }}
          className="w-32 rounded-md border border-border bg-card px-2 py-1 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-[11px] text-muted-foreground/60">/ month</span>
      </div>
    </div>
  )
}

/**
 * Today + this-month spend. Polls the same `/api/runs/stats` endpoint
 * the TopHud's BudgetWarningPill uses, so both surfaces share one
 * number. Graceful when no budget is set — shows just the totals.
 */
function SpendingSummary() {
  const { data } = useRunsStats();
  if (!data) {
    return (
      <div className="p-3 rounded-lg border border-border bg-background">
        <p className="text-[11px] text-muted-foreground/60">Loading…</p>
      </div>
    );
  }
  const hasBudget = data.budget != null && data.budget > 0;
  const pct = data.budgetFraction != null ? Math.round(data.budgetFraction * 100) : null;
  return (
    <div className="p-3 rounded-lg border border-border bg-background space-y-3">
      <SpendRow label="Today" value={data.todaySpend} />
      <SpendRow
        label="This month"
        value={data.monthSpend}
        right={
          hasBudget && pct != null ? (
            <span
              className={`text-[11px] tabular-nums ${
                data.budgetState === 'block'
                  ? 'text-destructive'
                  : data.budgetState === 'warn'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
              }`}
            >
              {pct}% of ${data.budget!.toFixed(0)}
            </span>
          ) : null
        }
      />
    </div>
  );
}

function SpendRow({
  label,
  value,
  right,
}: {
  label: string;
  value: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">${value.toFixed(2)}</span>
        {right}
      </div>
    </div>
  );
}
