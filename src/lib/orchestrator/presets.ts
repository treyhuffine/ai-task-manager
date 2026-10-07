/**
 * Names to start from, offered while the user names the orchestrator (the
 * main chat's first run and the edit dialog). Picking one fills the name and
 * the look, and everything stays editable after. The first is the default,
 * drawn with the Ri mark. The rest mix plain titles, names that aren't a
 * person, and homages from fiction and computing.
 *
 * Copy rule: notes have no long dashes or semicolons, and each fits one line
 * of its card (`PRESET_NOTE_MAX` characters), since nothing shows the rest.
 */

import { APP_NAME } from '@/constants/app';

export interface OrchestratorPreset {
  name: string;
  /** Null draws the Ri mark (the default name) or the initial. */
  emoji: string | null;
  /** A palette hex from `ORCHESTRATOR_COLORS`, or null for the theme's own. */
  color: string | null;
  /** A few words under the name, so a homage explains itself. */
  note: string;
}

/**
 * The longest note that stays on one line of a preset card (9rem wide, so
 * about 90px of 10px Inter). A character count stands in for the width: the
 * widest note here, Dwight's, measures 82px.
 */
export const PRESET_NOTE_MAX = 17;

export const ORCHESTRATOR_PRESETS: readonly OrchestratorPreset[] = [
  { name: APP_NAME, emoji: null, color: null, note: 'The original' },
  { name: 'Rye', emoji: '🍞', color: '#f2a93b', note: `${APP_NAME}, with a crust` },
  { name: 'Chief of Staff', emoji: '💼', color: '#4f7cf0', note: 'Runs the show' },
  { name: 'Dwight', emoji: '🐻', color: '#f2a93b', note: 'Assistant to the…' },
  { name: 'Jarvis', emoji: '🤖', color: '#22b5c9', note: 'Runs every suit' },
  { name: 'GSD', emoji: '🏁', color: '#8cc63f', note: 'Gets stuff done' },
  { name: 'Atlas', emoji: '🌍', color: '#e2609a', note: 'Carries the load' },
  { name: 'Clippy', emoji: '📎', color: '#f3ead8', note: 'It looks like…' },
  { name: 'Alfred', emoji: '🎩', color: '#7c736a', note: 'Why do we fall?' },
  { name: 'Navi', emoji: '🧚', color: '#4f7cf0', note: 'Hey! Listen!' },
  { name: 'Yoda', emoji: '🐸', color: '#e8664f', note: 'Do. Or do not.' },
  { name: 'Ada', emoji: '🧮', color: '#8b6cf0', note: 'Coded in 1843' },
  { name: 'Alan', emoji: '🔐', color: '#2fb67c', note: 'Passes the test' },
];
