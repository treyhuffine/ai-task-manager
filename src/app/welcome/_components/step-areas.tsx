import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Layers, Plus, X } from 'lucide-react';
import type { WizardState } from './types';

const PRESETS = [
  { name: 'Work', emoji: '💼' },
  { name: 'Personal', emoji: '🏡' },
  { name: 'Side Project', emoji: '🚀' },
];

export function StepAreas({
  state,
  update,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
}) {
  const [customName, setCustomName] = useState('');
  const [customEmoji, setCustomEmoji] = useState('📁');

  const toggle = (preset: { name: string; emoji: string }) => {
    const exists = state.areas.some((a) => a.name === preset.name);
    update({
      areas: exists
        ? state.areas.filter((a) => a.name !== preset.name)
        : [...state.areas, preset],
    });
  };

  const addCustom = () => {
    const trimmed = customName.trim();
    if (!trimmed) return;
    if (state.areas.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) return;
    update({ areas: [...state.areas, { name: trimmed, emoji: customEmoji || '📁' }] });
    setCustomName('');
    setCustomEmoji('📁');
  };

  const removeCustom = (name: string) => {
    update({ areas: state.areas.filter((a) => a.name !== name) });
  };

  const isCustom = (name: string) => !PRESETS.some((p) => p.name === name);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Layers className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Pick your areas</h2>
          <p className="text-sm text-muted-foreground">
            Areas are high-level contexts for tasks — like workspaces. You can add more later.
          </p>
        </div>
      </header>

      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Suggested</div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => {
            const selected = state.areas.some((a) => a.name === p.name);
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => toggle(p)}
                className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <span className="text-2xl">{p.emoji}</span>
                <span className="text-sm font-medium">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Custom</div>
        <div className="flex gap-2">
          <Input
            className="w-14 text-center"
            value={customEmoji}
            onChange={(e) => setCustomEmoji(e.target.value.slice(0, 2))}
            placeholder="📁"
          />
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="Reading, Fitness, Research…"
          />
          <Button type="button" variant="outline" onClick={addCustom} disabled={!customName.trim()}>
            <Plus className="size-4" /> Add
          </Button>
        </div>

        {state.areas.filter((a) => isCustom(a.name)).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {state.areas
              .filter((a) => isCustom(a.name))
              .map((a) => (
                <span
                  key={a.name}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm"
                >
                  <span>{a.emoji}</span>
                  {a.name}
                  <button
                    type="button"
                    onClick={() => removeCustom(a.name)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
          </div>
        )}
      </div>

      {state.areas.length === 0 && (
        <p className="text-sm text-muted-foreground">Select at least one to continue.</p>
      )}
    </div>
  );
}
