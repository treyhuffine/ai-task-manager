'use client';

import { BriefcaseBusiness, Contact, Plane, Wallet, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'size-4 rounded text-[9px]',
  sm: 'size-5 rounded-md text-[10px]',
  md: 'size-7 rounded-md text-[12px]',
  lg: 'size-9 rounded-lg text-[14px]',
} as const;
const ICON_SIZES = { xs: 10, sm: 12, md: 15, lg: 18 } as const;

/**
 * Purpose icons an app manifest may name. A package cannot supply artwork, so
 * it picks from this vocabulary, and anything unknown falls back to its initial.
 */
const ICONS: Record<string, LucideIcon> = {
  plane: Plane,
  briefcase: BriefcaseBusiness,
  contact: Contact,
  wallet: Wallet,
};

/**
 * Icons for included catalog entries, shown before a package is installed.
 * Catalog metadata keeps its original strict shape for Homes on older code,
 * so the library maps Ri's own included packages here. Installed apps use the
 * icon their manifest names.
 */
export const INCLUDED_APP_ICONS: Readonly<Record<string, string>> = {
  'ri-travel': 'plane',
  'ri-job-search': 'briefcase',
  'ri-people': 'contact',
};

/**
 * An app's mark: its purpose icon, or its initial, on a tinted tile. A letter
 * tells Finances from a tracker at a glance, in the rail's strip and in a list
 * of tiles alike. The same tint as the skill tile, since both are things you
 * add to Ri.
 */
export function AppMark({
  name,
  icon,
  size = 'sm',
  className,
}: {
  name: string;
  icon?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const Icon = icon ? ICONS[icon] : undefined;
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center bg-primary/10 font-semibold leading-none text-primary',
        SIZES[size],
        className,
      )}
    >
      {Icon ? <Icon size={ICON_SIZES[size]} strokeWidth={2} /> : letter}
    </span>
  );
}
