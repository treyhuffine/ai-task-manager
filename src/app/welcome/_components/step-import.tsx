import { Upload } from 'lucide-react';
import { ExternalAgentImportPanel } from '@/components/settings/sections/imports-section';

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
            Bring in projects and chats from local agent tools.
          </p>
        </div>
      </header>

      <div className="rounded-lg border border-border bg-card/50 p-4">
        <ExternalAgentImportPanel />
      </div>

      <p className="text-sm text-muted-foreground">You can skip this and import later from Settings.</p>
    </div>
  );
}
