'use client';

/**
 * Preview section of the workspace settings sheet.
 *
 * Just the **default dev command** for this workspace. Flow runs it in each
 * execution's worktree, auto-assigns a stable port (injected as `PORT`), and
 * confirms it's listening. How a preview is *reached* (localhost vs a remote
 * provider like Beam/Portless/manual) is a global choice in Devices →
 * Remote preview, not a per-workspace mode. See docs/preview-system-spec.md.
 */

interface PreviewSettingsSectionProps {
  previewCommand: string;
  onPreviewCommandChange: (v: string) => void;
}

export function PreviewSettingsSection({
  previewCommand,
  onPreviewCommandChange,
}: PreviewSettingsSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Dev command
        </label>
        <input
          value={previewCommand}
          onChange={(e) => onPreviewCommandChange(e.target.value)}
          placeholder="pnpm dev"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
          Run in each execution&apos;s worktree to start its preview. Flow assigns a stable port
          {' '}(injected as <code className="font-mono">PORT</code>) and waits for it to listen — anything
          {' '}that honors <code className="font-mono">$PORT</code> (or prints a <code className="font-mono">localhost:PORT</code> line) works.
        </p>
      </div>
    </div>
  );
}
