'use client';

import { useStackDetection } from '@/hooks/use-workspaces';

/**
 * Worktree lifecycle scripts for a workspace — all optional. Flow runs each as
 * `sh -lc` in the execution's worktree, exporting $FLOW_SOURCE_CHECKOUT_PATH /
 * $FLOW_WORKTREE_PATH / $FLOW_BRANCH_NAME. Flow stays strategy-agnostic: the
 * project's command decides what happens.
 *
 *   Setup    — once, after the worktree is created (install deps, copy caches…).
 *   Start    — the dev server Flow supervises for previews (auto-assigned PORT).
 *   Teardown — on archive, before the worktree is removed.
 *
 * `cwd` (when given) drives lockfile-based suggestions for the Setup/Start
 * placeholders — never prefilled values, just hints. Falls back to a neutral
 * default when the stack can't be detected confidently.
 */

interface WorktreeScriptsSectionProps {
  setupCommand: string;
  startCommand: string;
  teardownCommand: string;
  onSetupChange: (v: string) => void;
  onStartChange: (v: string) => void;
  onTeardownChange: (v: string) => void;
  /** Checkout path used to detect the project's package manager / stack. */
  cwd?: string | null;
}

export function WorktreeScriptsSection({
  setupCommand,
  startCommand,
  teardownCommand,
  onSetupChange,
  onStartChange,
  onTeardownChange,
  cwd,
}: WorktreeScriptsSectionProps) {
  const { data: detected } = useStackDetection(cwd ?? null);
  const setupPlaceholder = detected?.setup || 'install dependencies, e.g. pnpm install';
  const startPlaceholder = detected?.start || 'dev server, e.g. pnpm dev';

  return (
    <div className="space-y-4">
      <ScriptField
        label="Setup"
        value={setupCommand}
        onChange={onSetupChange}
        placeholder={setupPlaceholder}
        multiline
        hint={
          <>
            Runs once after the worktree is created. A fresh worktree has no installed dependencies. Install or copy what
            it needs here. <code className="font-mono">$FLOW_SOURCE_CHECKOUT_PATH</code> points at the original checkout.
          </>
        }
      />
      <ScriptField
        label="Start"
        value={startCommand}
        onChange={onStartChange}
        placeholder={startPlaceholder}
        hint={
          <>
            The dev command Flow runs in each worktree to start its preview. Flow assigns a stable port (injected as{' '}
            <code className="font-mono">PORT</code>) and waits for it to listen.
          </>
        }
      />
      <ScriptField
        label="Teardown"
        value={teardownCommand}
        onChange={onTeardownChange}
        placeholder="(none)"
        multiline
        hint={<>Runs on archive, before the worktree is removed. Best-effort; a failure won&apos;t block archiving.</>}
      />
    </div>
  );
}

function ScriptField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: React.ReactNode;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          rows={2}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )}
      <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">{hint}</p>
    </div>
  );
}
