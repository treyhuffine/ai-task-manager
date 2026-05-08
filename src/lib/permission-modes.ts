/**
 * Display metadata + cycling logic for the four permission modes. Pure
 * client-friendly module — no agentex/SDK imports — so it's safe to use
 * in any component.
 */

import type { ComponentType } from 'react';
import { ChevronsRight, Hand, Pause, type LucideProps } from 'lucide-react';
import type { PermissionMode } from '@/db/types';

export type ModeIcon = ComponentType<LucideProps>;

export interface PermissionModeMeta {
  mode: PermissionMode;
  title: string;
  shortTitle: string;
  Icon: ModeIcon;
  description: string;
  /** Tailwind classes for the mode's accent color, in order text/border/bg. */
  classes: { text: string; border: string; bg: string };
}

// Underlying mode keys (`bypass`, `default`, etc.) stay stable — they're
// persisted in chat_sessions and recognized by Claude's --permission-mode
// flag. Display labels + colors are tuned for clarity:
//
//   - "Auto mode" makes the bypass behavior sound like a feature, not a
//     workaround. Yellow signals "no friction, but be aware."
//   - "Ask permission" plain-language replacement for the confusing
//     "Default" — blue ties it to the permission-card accent the user
//     already associates with prompts.
//   - "Accept edits" purple distinguishes it from the read-only-ish modes
//     and from emerald (which we use for tool_result success).
//   - "Plan mode" teal because amber clashes with the existing rate_limit
//     pill, and teal reads as "thoughtful / paused" without alarming.
export const PERMISSION_MODE_META: Record<PermissionMode, PermissionModeMeta> = {
  bypass: {
    mode: 'bypass',
    title: 'Auto mode',
    shortTitle: 'Auto',
    Icon: ChevronsRight,
    description: 'Auto-allow every tool. No prompts.',
    classes: {
      text: 'text-yellow-500',
      border: 'border-yellow-500/40',
      bg: 'bg-yellow-500/5',
    },
  },
  default: {
    mode: 'default',
    title: 'Ask permission',
    shortTitle: 'Ask',
    Icon: Hand,
    description: 'Prompt before every mutating tool.',
    classes: {
      text: 'text-blue-500',
      border: 'border-blue-500/40',
      bg: 'bg-blue-500/5',
    },
  },
  accept_edits: {
    mode: 'accept_edits',
    title: 'Accept edits',
    shortTitle: 'Edits',
    Icon: ChevronsRight,
    description: 'Auto-allow file edits in cwd; ask for shell + others.',
    classes: {
      text: 'text-purple-500',
      border: 'border-purple-500/40',
      bg: 'bg-purple-500/5',
    },
  },
  plan: {
    mode: 'plan',
    title: 'Plan mode',
    shortTitle: 'Plan',
    Icon: Pause,
    description: 'Agent proposes a plan; no edits or commands.',
    classes: {
      text: 'text-teal-500',
      border: 'border-teal-500/40',
      bg: 'bg-teal-500/5',
    },
  },
};

const CYCLE: PermissionMode[] = ['bypass', 'default', 'accept_edits', 'plan'];

/** Next mode for Shift+Tab cycle. Wraps. */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  const idx = CYCLE.indexOf(current);
  if (idx === -1) return CYCLE[0]!;
  return CYCLE[(idx + 1) % CYCLE.length]!;
}
