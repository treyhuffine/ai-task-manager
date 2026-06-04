/**
 * Registry of apps the open-worktree split-button knows about.
 *
 * Each entry pairs the user-facing label with detection hints:
 *  - macBundlePath: hardcoded path for apps that live outside
 *    `/Applications` (Finder, Terminal — both shipped under
 *    `/System/...`). When set, we skip the normal /Applications scan.
 *  - macAppName: bundle basename to look for in `/Applications` and
 *    `~/Applications`.
 *  - cliCommand: PATH binary, used as the cross-platform fallback (and
 *    the only signal on Linux/Windows since we don't probe app stores).
 *  - alwaysShow: include even when nothing was detected. Used for
 *    Finder/Terminal on non-mac platforms — there's always *some* file
 *    manager and terminal, even if we can't render a real icon for it.
 *  - platforms: limit to a subset (e.g. iTerm: macOS only).
 *
 * Order here is the menu order. File manager + terminals stay at the
 * top; editors below.
 */

import type { OpenTarget } from './open-target';

export interface KnownApp {
  target: OpenTarget;
  label: string;
  macBundlePath?: string;
  macAppName?: string;
  cliCommand?: string;
  alwaysShow?: boolean;
  platforms?: ('darwin' | 'linux' | 'win32')[];
}

export const KNOWN_APPS: KnownApp[] = [
  // File manager + terminals. macOS gets real icons via the system
  // bundle paths; other platforms render with the lucide fallback.
  {
    target: 'finder',
    label: 'Reveal in Finder',
    macBundlePath: '/System/Library/CoreServices/Finder.app',
    alwaysShow: true,
  },
  {
    target: 'terminal',
    label: 'Open in Terminal',
    macBundlePath: '/System/Applications/Utilities/Terminal.app',
    alwaysShow: true,
  },
  {
    target: 'iterm',
    label: 'Open in iTerm',
    macAppName: 'iTerm',
    platforms: ['darwin'],
  },

  // Editors
  { target: 'vscode',      label: 'Open in VS Code',          macAppName: 'Visual Studio Code', cliCommand: 'code' },
  { target: 'cursor',      label: 'Open in Cursor',           macAppName: 'Cursor',             cliCommand: 'cursor' },
  { target: 'antigravity', label: 'Open in Antigravity',      macAppName: 'Antigravity',        cliCommand: 'antigravity' },
  { target: 'zed',         label: 'Open in Zed',              macAppName: 'Zed',                cliCommand: 'zed' },
  { target: 'sublime',     label: 'Open in Sublime Text',     macAppName: 'Sublime Text',       cliCommand: 'subl' },
  { target: 'webstorm',    label: 'Open in WebStorm',         macAppName: 'WebStorm',           cliCommand: 'webstorm' },
];

/**
 * Editor targets only — excludes the file-manager / terminal pseudo-targets
 * (finder, terminal, iterm). This is the single source of truth for any UI
 * that lets the user pick an editor (settings picker, CLI, file-viewer
 * "Open in editor"), so the list never drifts across surfaces.
 */
export const EDITOR_TARGETS = [
  'vscode',
  'cursor',
  'antigravity',
  'zed',
  'sublime',
  'webstorm',
] as const satisfies readonly OpenTarget[];

export type EditorTarget = (typeof EDITOR_TARGETS)[number];

export function isEditorTarget(target: OpenTarget): target is EditorTarget {
  return (EDITOR_TARGETS as readonly OpenTarget[]).includes(target);
}

/** The KnownApp entries for editors, in menu order. */
export const EDITOR_APPS: KnownApp[] = KNOWN_APPS.filter((a) => isEditorTarget(a.target));
