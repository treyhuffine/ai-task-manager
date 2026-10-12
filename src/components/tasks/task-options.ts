import { Flame, Zap } from 'lucide-react';
import type { Effort, Energy } from '@/db/types';

/** The energy a task asks for, as the task panels offer it. */
export const ENERGY_OPTIONS: { value: Energy; label: string; icon: typeof Flame; color: string }[] = [
  { value: 'deep', label: 'Deep', icon: Flame, color: 'text-orange-500' },
  { value: 'light', label: 'Light', icon: Zap, color: 'text-sky-400' },
];

/** How big a task is, as the task panels offer it. */
export const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: 'trivial', label: 'XS: Trivial' },
  { value: 'small', label: 'S: Small' },
  { value: 'medium', label: 'M: Medium' },
  { value: 'large', label: 'L: Large' },
  { value: 'epic', label: 'XL: Epic' },
];
