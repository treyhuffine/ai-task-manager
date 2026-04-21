import { Upload, Construction } from 'lucide-react';

// TODO: Wire up data import. Likely sources to support:
//   - Things / Apple Reminders
//   - Notion / Todoist
//   - Markdown dump (paste or file)
// For now this tab is a visible placeholder so the wizard shape stays stable.

export function StepImport() {
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex shrink-0 size-10 items-center justify-center rounded-md bg-muted">
          <Upload className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Import your stuff</h2>
          <p className="text-sm text-muted-foreground">
            Bring in tasks and notes from tools you already use.
          </p>
        </div>
      </header>

      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
        <div className="flex items-start gap-3">
          <Construction className="mt-0.5 size-5 text-amber-400" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Coming soon</span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
                TODO
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Data import is on the roadmap. Candidates: Things, Notion, Todoist, Apple Notes,
              plain markdown dump.
            </p>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">Skip for now and pick up later in Settings.</p>
    </div>
  );
}
