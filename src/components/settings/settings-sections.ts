import {
  User,
  SlidersHorizontal,
  Bot,
  Mic,
  Plug,
  Bell,
  MonitorSmartphone,
  Globe,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';

/**
 * Single source of truth for the unified settings modal.
 *
 * The nav, the modal header (title + description), and the deep-link
 * `?settings=<id>` param all derive from this one array — so a section's
 * label/description can only be defined in one place. This is what keeps the
 * old "every sheet titled something slightly different" drift from coming back.
 */
export type SectionId =
  | 'get-started'
  | 'profile'
  | 'general'
  | 'models'
  | 'voice'
  | 'connectors'
  | 'notifications'
  | 'devices'
  | 'remote-preview';

export interface SettingsSectionDef {
  /** Stable id — used for nav state, the content router, and the URL param. */
  id: SectionId;
  /** Short nav label. */
  label: string;
  icon: LucideIcon;
  /** Header shown above the pane. */
  title: string;
  /** One-line header subtitle. */
  description: string;
  /** Optional pill rendered next to the nav label (e.g. "Soon"). */
  badge?: string;
}

export const SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: User,
    title: 'Profile',
    description: 'The context the agent uses to personalize how it works with you.',
  },
  {
    id: 'devices',
    label: 'Devices',
    icon: MonitorSmartphone,
    title: 'Devices',
    description: 'Remote access URL, paired devices, and host-machine settings.',
  },
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
    title: 'General',
    description: 'Theme, timezone, working hours, and display preferences.',
  },
  {
    id: 'models',
    label: 'Models',
    icon: Bot,
    title: 'AI & Models',
    description: 'Default provider and model, orchestrator mode, and usage.',
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    title: 'Voice',
    description: 'Speech-to-text model and whether voice transcriptions send automatically.',
  },
  {
    id: 'connectors',
    label: 'Connectors',
    icon: Plug,
    title: 'Connectors',
    description: 'Connect external services so agents can act on your behalf.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    title: 'Notifications',
    description: 'Delivery channels, event routing, and scheduled digests.',
  },
  {
    id: 'remote-preview',
    label: 'Remote Preview',
    icon: Globe,
    title: 'Remote Preview',
    description: 'How execution previews open on your phone and other devices.',
  },
];

export const DEFAULT_SECTION: SectionId = 'profile';

/**
 * The "Get started" section is conditional (only shown while setup is
 * incomplete) and rendered specially in the nav, so it lives outside SECTIONS.
 * It still needs a def for the modal header + deep-link validation.
 */
export const GET_STARTED_SECTION: SettingsSectionDef = {
  id: 'get-started',
  label: 'Get started',
  icon: ListChecks,
  title: 'Get started',
  description: 'A few quick steps to get the most out of your workspace.',
};

const ALL_SECTIONS: readonly SettingsSectionDef[] = [GET_STARTED_SECTION, ...SECTIONS];

export function getSection(id: SectionId): SettingsSectionDef {
  return ALL_SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

export function isSectionId(value: string | null | undefined): value is SectionId {
  return !!value && ALL_SECTIONS.some((s) => s.id === value);
}
