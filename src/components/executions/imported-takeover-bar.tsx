'use client';

import { Loader2, Terminal } from 'lucide-react';
import { useTakeOverImport } from '@/hooks/use-execution';

/**
 * Sits directly above the composer on an imported chat that hasn't been taken
 * over yet, and explains the one thing the transcript above it cannot: those
 * turns belong to a session another process owns, and this app is mirroring
 * them rather than driving them.
 *
 * It exists because the silent version of this was genuinely misleading. An
 * imported chat carries no provider session id, so a send used to spawn a
 * fresh agent with an empty context while the pane kept showing hundreds of
 * imported turns. The chat looked continuous and was not, and neither the user
 * nor the agent had any way to tell.
 *
 * Continuing is deliberately a button rather than something the first send
 * does for you: resuming a session that may still be open in a terminal means
 * two writers on one transcript, so the warning has to land before the choice,
 * not after.
 */
export function ImportedTakeoverBar({
  sessionId,
  providerLabel,
  cwd,
}: {
  sessionId: string;
  providerLabel: string;
  cwd: string | null;
}) {
  const takeOver = useTakeOverImport(sessionId);
  const error = takeOver.error;

  return (
    <div className="border-t border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Terminal size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[12px] leading-relaxed text-foreground/90">
            This chat mirrors a {providerLabel} session running outside the app.
            You can read it here, but replies come from wherever you started it.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Continuing here resumes that same session
            {cwd ? <> in <span className="font-mono text-foreground/70">{cwd}</span></> : null}
            . Close it in your terminal first, or both will write to one transcript.
          </p>
          {error && (
            <p className="text-[11px] text-destructive">
              {error instanceof Error ? error.message : String(error)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => takeOver.mutate()}
          disabled={takeOver.isPending}
          className="shrink-0 flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {takeOver.isPending && <Loader2 size={11} className="animate-spin" />}
          {takeOver.isPending ? 'Continuing…' : 'Continue here'}
        </button>
      </div>
    </div>
  );
}
