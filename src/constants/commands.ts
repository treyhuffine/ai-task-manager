// ── Global hotkeys ───────────────────────────────────────────
// Each hotkey defines the modifier + key combo and a human-readable label.
// Components reference these instead of hardcoding key checks.

export interface Hotkey {
  key: string;
  meta?: boolean;    // Cmd (Mac) / Ctrl (Win/Linux)
  shift?: boolean;
  label: string;     // Display string, e.g. "⌘K"
}

export const HOTKEYS = {
  search: { key: 'k', meta: true, label: '\u2318K' },
  voiceChat: { key: 'j', meta: true, label: '\u2318J' },
  quickCapture: { key: 'k', meta: true, shift: true, label: '\u2318\u21E7K' },
  slideoutBack: { key: 'Escape', label: 'Esc' },
  slideoutCloseAll: { key: 'Escape', shift: true, label: '\u21E7Esc' },
  openFullPage: { key: 'Enter', meta: true, label: '\u2318\u21A9' },
  toggleRail: { key: '\\', meta: true, label: '\u2318\\' },
  focusChatInput: { key: 'i', meta: true, label: '\u2318I' },
} as const satisfies Record<string, Hotkey>;

/** Check if a KeyboardEvent matches a Hotkey (strict modifier match) */
export function matchesHotkey(e: KeyboardEvent, hotkey: Hotkey): boolean {
  const metaRequired = !!hotkey.meta;
  const shiftRequired = !!hotkey.shift;
  const metaHeld = e.metaKey || e.ctrlKey;
  if (metaHeld !== metaRequired) return false;
  if (e.shiftKey !== shiftRequired) return false;
  return e.key.toLowerCase() === hotkey.key.toLowerCase();
}

// ── Command palette actions ──────────────────────────────────
// Centralized command definitions for the > command mode.
// The `id` is stable (used for keying), `keywords` aids fuzzy matching.

export interface PaletteCommand {
  id: string;
  label: string;
  keywords: string;
  icon: string;       // Lucide icon name
  shortcut?: string;  // Hint shown in the palette
  group: 'create' | 'navigate' | 'settings';
}

export const PALETTE_COMMANDS: PaletteCommand[] = [
  // Create
  { id: 'create-task', label: 'Create task', keywords: 'new add task', icon: 'Plus', shortcut: 'T', group: 'create' },
  { id: 'create-note', label: 'Create note', keywords: 'new add note', icon: 'StickyNote', shortcut: 'N', group: 'create' },

  // Voice
  { id: 'voice-chat', label: 'Voice chat', keywords: 'voice mic record dictate speak', icon: 'Mic', shortcut: '\u2318J', group: 'navigate' },

  // Navigate
  { id: 'go-deck', label: 'Go to Deck', keywords: 'navigate deck dashboard', icon: 'LayoutDashboard', group: 'navigate' },
  { id: 'go-tasks', label: 'Go to Tasks', keywords: 'navigate tasks list', icon: 'ListTodo', group: 'navigate' },
  { id: 'go-notes', label: 'Go to Notes', keywords: 'navigate notes', icon: 'FileText', group: 'navigate' },
  { id: 'go-stream', label: 'Go to Stream', keywords: 'navigate stream capture', icon: 'Radio', group: 'navigate' },
  { id: 'go-chat', label: 'Go to Chat', keywords: 'navigate chat ai', icon: 'MessagesSquare', group: 'navigate' },

  // Settings
  { id: 'toggle-theme', label: 'Toggle theme', keywords: 'theme dark light mode switch', icon: 'Sun', group: 'settings' },
];

// ── Type filter prefixes ─────────────────────────────────────

export type EntityTypeFilter = 'task' | 'note' | 'stream';

export const TYPE_PREFIXES: Record<string, EntityTypeFilter> = {
  'task:': 'task',
  'tasks:': 'task',
  'note:': 'note',
  'notes:': 'note',
  'stream:': 'stream',
};
