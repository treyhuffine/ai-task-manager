'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, Circle, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentSkillAccess } from '@/components/settings/agent-skill-access';
import { setSettingsSection } from '@/components/settings/settings-store';
import { AGENT_SKILL_ITEM, type ChecklistItem, type SetupChecklist } from '@/components/settings/use-setup-checklist';
import { APP_NAME } from '@/constants/app';

/**
 * The "Get started" checklist. Each item is derived-done, actionable (jump to
 * its tab, or one click right here for the agent skills), or dismissed
 * (button → inline "do it later" guidance, with undo).
 * The whole tab auto-hides once every item is done-or-dismissed (handled by the
 * modal), so this pane only renders while there's still something to nudge.
 */
export function GetStartedSection({ checklist }: { checklist: SetupChecklist }) {
  const { items, doneCount, total, dismiss, restore } = checklist;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-[12.5px] leading-relaxed text-foreground/90">
          A few quick steps to get the most out of {APP_NAME}. Do what&apos;s useful, skip what isn&apos;t. This
          disappears once you&apos;re set.
        </p>
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {doneCount}/{total} done
          </span>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const Item = item.id === AGENT_SKILL_ITEM ? AgentSkillItem : JumpItem;
          return <Item key={item.id} item={item} dismiss={() => dismiss(item.id)} restore={() => restore(item.id)} />;
        })}
      </ul>
    </div>
  );
}

interface ItemProps {
  item: ChecklistItem;
  dismiss: () => void;
  restore: () => void;
}

const primaryClass =
  'inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50';
const quietClass =
  'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50';

function Row({ item, note, children }: { item: ChecklistItem; note?: ReactNode; children?: ReactNode }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3',
        item.done ? 'border-border/60 bg-card/30' : 'border-border bg-background',
      )}
    >
      {item.done ? (
        <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
      ) : (
        <Circle size={16} className={cn('shrink-0', item.dismissed ? 'text-muted-foreground/40' : 'text-muted-foreground')} />
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium',
            item.done ? 'text-muted-foreground line-through' : item.dismissed ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {item.label}
        </p>
        {note && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{note}</p>}
      </div>

      {children}
    </li>
  );
}

function SetUpButton({ item }: { item: ChecklistItem }) {
  return (
    <button type="button" onClick={() => setSettingsSection(item.section)} className={primaryClass}>
      Set up
      <ArrowRight size={12} />
    </button>
  );
}

/** Most items: Set up jumps to the item's tab, and Skip turns the buttons into a hint with Undo. */
function JumpItem({ item, dismiss, restore }: ItemProps) {
  return (
    <Row item={item} note={item.dismissed && !item.done ? item.hint : null}>
      {item.done ? null : item.dismissed ? (
        <button type="button" onClick={restore} className={quietClass}>
          Undo
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <SetUpButton item={item} />
          <button type="button" onClick={dismiss} className={quietClass}>
            Skip
          </button>
        </div>
      )}
    </Row>
  );
}

/**
 * Ri's user-level skills, one click either way right here. First-run setup
 * installs them, so this is usually where someone learns they're on and how
 * to take them off. An uninstall reads as skipped (`useSetupChecklist`),
 * with Install to bring them back. Only a name taken by another skill needs
 * External AI, which says where.
 */
function AgentSkillItem({ item, dismiss, restore }: ItemProps) {
  const skill = useAgentSkillAccess();
  const spinner = skill.busy && <Loader2 size={11} className="animate-spin" aria-hidden />;

  if (item.done) {
    return (
      <Row item={item} note="On for every coding tool you can use here, in every project. Uninstall in one click any time.">
        <button type="button" onClick={skill.uninstall} disabled={skill.busy} className={quietClass}>
          {spinner}
          Uninstall
        </button>
      </Row>
    );
  }
  if (skill.state === 'declined') {
    return (
      <Row item={item} note="Install it here or in External AI any time.">
        <button type="button" onClick={skill.install} disabled={skill.busy} className={quietClass}>
          {spinner}
          Install
        </button>
      </Row>
    );
  }
  if (item.dismissed) {
    return (
      <Row item={item} note={item.hint}>
        <button type="button" onClick={restore} className={quietClass}>
          Undo
        </button>
      </Row>
    );
  }
  const skip = (
    <button type="button" onClick={dismiss} className={quietClass}>
      Skip
    </button>
  );
  if (skill.state === 'blocked') {
    return (
      <Row item={item} note="Another skill already uses the same name. External AI shows where.">
        <div className="flex shrink-0 items-center gap-1">
          <SetUpButton item={item} />
          {skip}
        </div>
      </Row>
    );
  }
  return (
    <Row
      item={item}
      note="Claude Code, Codex and every other coding tool you can use here get your tasks and notes in every project. Uninstall in one click any time."
    >
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={skill.install} disabled={skill.busy} className={primaryClass}>
          {spinner}
          Install
        </button>
        {skip}
      </div>
    </Row>
  );
}
