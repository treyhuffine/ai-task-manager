import type { HarnessId } from '@/lib/harness/registry';

/** Visible wherever a user chooses a harness that cannot ask for approval. */
export function HarnessPermissionNotice({ harness }: { harness: HarnessId | null }) {
  if (harness !== 'antigravity') return null;
  return (
    <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-muted-foreground">
      Antigravity runs without approval prompts. Auto-approve allows edits and commands without asking. Plan mode asks the CLI to plan before making changes.
    </p>
  );
}
