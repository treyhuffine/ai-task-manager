'use client';

/**
 * Set an agent up on one of your computers, from the app
 * (docs/homes-model.md). The standard case asks nothing: its project is
 * copied down from Git into Ri's projects folder there, and the folders it
 * uses come along. Choosing another place, or a folder that's already there,
 * is the escape hatch. A folder it uses that couldn't be found is asked about
 * once, with Go without it beside.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSetUpAgent, useSetupPlan } from '@/hooks/use-workspaces';
import { FolderField } from './folder-field';
import { apiErrorText } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Missing = { alias: string; description: string | null };

interface SetupAgentDialogProps {
  workspaceId: string;
  agentName: string;
  computer: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once it's ready there: to go on with whatever it was set up for. */
  onReady?: () => void;
}

export function SetupAgentDialog(props: SetupAgentDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onOpenChange={(next) => !busy && props.onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted each time it opens: every open starts from the standard case. */}
        {props.open && <SetupAgentBody {...props} onBusy={setBusy} />}
      </DialogContent>
    </Dialog>
  );
}

function SetupAgentBody({
  workspaceId,
  agentName,
  computer,
  onOpenChange,
  onReady,
  onBusy,
}: SetupAgentDialogProps & { onBusy: (busy: boolean) => void }) {
  const plan = useSetupPlan(workspaceId, computer.id, true);
  const setUp = useSetUpAgent(workspaceId);
  const [chosen, setHow] = useState<'copy' | 'existing'>('copy');
  const [changing, setChanging] = useState(false);
  const [copyTo, setCopyTo] = useState('');
  const [existing, setExisting] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // After a first pass that couldn't find everything: the folder it's in, and what's left to answer.
  const [followUp, setFollowUp] = useState<{ folder: string; missing: Missing[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // No remote to copy from: only a folder that's already there will do.
  const how = plan.data && !plan.data.remote ? 'existing' : chosen;

  const done = (outcome: { status: string; problem: string | null; missing: Missing[]; folder: string }) => {
    if (outcome.status === 'ready') {
      toast.success(`${agentName} is ready on ${computer.name}`);
      onOpenChange(false);
      onReady?.();
      return;
    }
    if (outcome.missing.length > 0) {
      setFollowUp({ folder: outcome.folder, missing: outcome.missing });
      setProblem(null);
      return;
    }
    setProblem(outcome.problem ?? `${agentName} isn't ready on ${computer.name} yet.`);
  };
  const fail = (err: unknown) => setProblem(apiErrorText(err));

  const submit = () => {
    setProblem(null);
    if (followUp) {
      const given = Object.fromEntries(
        followUp.missing.map((m) => [m.alias, answers[m.alias] === undefined ? '' : answers[m.alias]!]),
      ) as Record<string, string>;
      if (Object.values(given).some((v) => v === '')) {
        setProblem('Give a folder for each one, or go without it.');
        return;
      }
      const sent = Object.fromEntries(Object.entries(given).map(([alias, v]) => [alias, v === SKIP ? null : v]));
      onBusy(true);
      setUp.mutate(
        { computerId: computer.id, how: 'existing', folder: followUp.folder, answers: sent },
        { onSuccess: done, onError: fail, onSettled: () => onBusy(false) },
      );
      return;
    }
    if (how === 'existing' && !existing.trim()) {
      setProblem(`Type where it is on ${computer.name}.`);
      return;
    }
    onBusy(true);
    setUp.mutate(
      {
        computerId: computer.id,
        how,
        folder: how === 'existing' ? existing.trim() : changing && copyTo.trim() ? copyTo.trim() : null,
      },
      { onSuccess: done, onError: fail, onSettled: () => onBusy(false) },
    );
  };

  const data = plan.data;
  const along = data?.references.filter((r) => r.comesAlong) ?? [];
  const pending = setUp.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Set up {agentName} on {computer.name}
        </DialogTitle>
        <DialogDescription>
          {followUp
            ? `${agentName} is on ${computer.name}. It also uses these, which weren't found there.`
            : `${agentName} needs its project on ${computer.name} to run there. You do this once.`}
        </DialogDescription>
      </DialogHeader>

      {plan.isLoading && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Checking {computer.name}…
        </p>
      )}
      {plan.error && !followUp && <p className="text-[13px] text-destructive">{apiErrorText(plan.error)}</p>}

      {data && !followUp && (
        <div className="space-y-2">
          {data.remote && (
            <Choice selected={how === 'copy'} onSelect={() => setHow('copy')} title="Copy it from Git">
              <span className="block break-all">From {shortRemote(data.remote)}</span>
              {!changing && <span className="block break-all">Into {data.defaultFolder}</span>}
              {how === 'copy' &&
                (changing ? (
                  <Input
                    autoFocus
                    value={copyTo}
                    onChange={(e) => setCopyTo(e.target.value)}
                    placeholder={data.defaultFolder}
                    className="mt-1.5 h-8 text-[12.5px]"
                  />
                ) : (
                  <button type="button" onClick={() => setChanging(true)} className="mt-0.5 text-[12px] text-primary hover:underline">
                    Put it somewhere else
                  </button>
                ))}
              {along.length > 0 && (
                <span className="mt-1 block">
                  {along.map((r) => r.alias).join(', ')} {along.length === 1 ? 'comes' : 'come'} along too.
                </span>
              )}
            </Choice>
          )}
          <Choice selected={how === 'existing'} onSelect={() => setHow('existing')} title={`Use a folder that's already on ${computer.name}`}>
            {how === 'existing' && (
              <div className="mt-1.5">
                <FolderField
                  autoFocus={!data.remote}
                  value={existing}
                  onChange={setExisting}
                  computer={computer}
                  browsable
                  placeholder={`~/code/${agentName.toLowerCase()}`}
                />
              </div>
            )}
          </Choice>
        </div>
      )}

      {followUp && (
        <div className="space-y-3">
          {followUp.missing.map((m) => (
            <div key={m.alias} className="space-y-1">
              <p className="text-[13px] font-medium">
                {m.alias}
                {m.description && <span className="font-normal text-muted-foreground">: {m.description}</span>}
              </p>
              {answers[m.alias] === SKIP ? (
                <p className="text-[12.5px] text-muted-foreground">
                  Going without it.{' '}
                  <button type="button" className="text-primary hover:underline" onClick={() => setAnswers((a) => ({ ...a, [m.alias]: '' }))}>
                    Give a folder instead
                  </button>
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <FolderField
                      value={answers[m.alias] ?? ''}
                      onChange={(v) => setAnswers((a) => ({ ...a, [m.alias]: v }))}
                      computer={computer}
                      browsable
                      placeholder={`Where ${m.alias} is on ${computer.name}`}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAnswers((a) => ({ ...a, [m.alias]: SKIP }))}>
                    Go without it
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pending && (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          {how === 'copy' && !followUp ? `Copying to ${computer.name}. This can take a minute.` : `Setting it up on ${computer.name}…`}
        </p>
      )}
      {problem && <p className="text-[12.5px] text-destructive">{problem}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || (!data && !followUp)}>
          {followUp ? 'Save' : 'Set up'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A reference the person chose to go without. */
const SKIP = '\u0000skip';

function Choice({
  selected,
  onSelect,
  title,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={cn(
        'w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/40',
      )}
    >
      <p className="text-[13px] font-medium">{title}</p>
      <div className="text-[12px] text-muted-foreground">{children}</div>
    </div>
  );
}

/** `git@github.com:owner/repo.git` as `owner/repo`, the way people say it. */
export function shortRemote(remote: string): string {
  const scp = /^[^@/\s]+@[^:/\s]+:(.+)$/.exec(remote);
  const rest = scp ? scp[1]! : remote.replace(/^[a-z+]+:\/\/(?:[^@/]+@)?[^/]+\//i, '');
  return rest.replace(/\.git$/, '');
}
