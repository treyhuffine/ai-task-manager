import { useState } from 'react';
import { ModelMenuProvider } from '@/components/chat-ui/model-menu/model-menu-provider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ModelMenuContent,
  ModelMenuLabel,
  type SpeedMode,
} from '@/components/chat-ui/model-menu/model-menu';
import {
  effortOptionsForModel,
  explicitEffortForModel,
  type ModelOption,
  type ProviderId,
} from '@/lib/harness/options';
import type { EffortLevel } from '@/db/types';

// Fictional capability sets for exercising the UI, not a provider support table.
const MODELS: { harness: ProviderId; model: ModelOption }[] = [
  {
    harness: 'claude',
    model: {
      id: 'opus',
      label: 'Opus',
      supportedEfforts: ['low', 'medium', 'high', 'max'],
    },
  },
  {
    harness: 'codex',
    model: {
      id: 'gpt-6.1-sol',
      label: '6.1 Sol',
      supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
  },
  {
    harness: 'codex',
    model: {
      id: 'gpt-6-astra',
      label: '6 Astra',
      supportedEfforts: ['medium', 'high', 'xhigh', 'max'],
    },
  },
  { harness: 'cursor', model: { id: 'auto', label: 'Auto' } },
];

export function ModelMenuPreview({ state }: { state: string }) {
  const [selection, setSelection] = useState(
    MODELS[state === 'unsupported' ? 3 : state === 'fast-only' ? 0 : 1],
  );
  const [effort, setEffort] = useState<EffortLevel>('high');
  const [speed, setSpeed] = useState<SpeedMode>('default');
  const [visible, setVisible] = useState(['opus', 'gpt-6.1-sol', 'auto']);
  const [manage, setManage] = useState(false);
  const efforts = effortOptionsForModel(selection.harness, selection.model);
  const modes: readonly SpeedMode[] =
    state === 'unsupported' || selection.harness === 'cursor'
      ? []
      : state === 'fast-only' || selection.harness === 'claude'
        ? ['default', 'fast']
        : ['default', 'fast', 'ultrafast'];
  return (
    <div className="mx-auto w-80 max-w-full">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
        <ModelMenuContent
          effort={effort}
          efforts={efforts}
          onEffortChange={setEffort}
          speed={{
            value: speed,
            modes,
            onChange: setSpeed,
            pending: state === 'pending',
          }}
          onManageModels={() => setManage(true)}
        >
          {[...new Set(MODELS.map((row) => row.harness))].map((harness) => (
            <ModelMenuProvider
              key={harness}
              harness={harness}
              models={MODELS.filter(
                (row) =>
                  row.harness === harness && visible.includes(row.model.id),
              ).map((row) => row.model)}
              additionalModels={MODELS.filter(
                (row) =>
                  row.harness === harness && !visible.includes(row.model.id),
              ).map((row) => row.model)}
              selectedModel={
                selection.harness === harness ? selection.model.id : null
              }
              startsNewChat={selection.harness !== harness}
              onSelect={(model) => {
                setVisible((current) => [...new Set([...current, model.id])]);
                setSelection({ harness, model });
                setEffort(explicitEffortForModel(harness, model, effort));
                setSpeed('default');
              }}
            />
          ))}
        </ModelMenuContent>
      </div>
      <div
        aria-label="Current model"
        className="mt-4 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px]"
      >
        <ModelMenuLabel
          model={selection.model.label}
          effort={efforts.find((option) => option.id === effort)?.label}
          speed={modes.includes(speed) ? speed : 'default'}
        />
      </div>
      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Visible models</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Keep the models you use in the menu.
          </p>
          <div className="space-y-3">
            {MODELS.map((row) => (
              <label
                key={row.model.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={visible.includes(row.model.id)}
                  onChange={(event) =>
                    setVisible((current) =>
                      event.target.checked
                        ? [...current, row.model.id]
                        : current.filter((id) => id !== row.model.id),
                    )
                  }
                />
                {row.model.label}
              </label>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
