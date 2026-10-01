/**
 * Names to start from, offered while the user names the orchestrator (the
 * main chat's first run and the edit dialog). Picking one fills the name and
 * the look, and everything stays editable after. The first is the default,
 * drawn with the Ri mark. The rest are a mix of plain titles and homages.
 *
 * Copy rule: notes have no long dashes or semicolons.
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

export const ORCHESTRATOR_PRESETS: readonly OrchestratorPreset[] = [
  { name: APP_NAME, emoji: null, color: null, note: 'The original' },
  { name: 'Rye', emoji: '🍞', color: '#f2a93b', note: `${APP_NAME}, with a crust` },
  { name: 'Chief of Staff', emoji: '💼', color: '#4f7cf0', note: 'Runs the show for you' },
  { name: 'Penny', emoji: '🪙', color: '#e8664f', note: 'After Miss Moneypenny' },
  { name: 'Alfred', emoji: '🎩', color: '#7c736a', note: 'Every hero needs one' },
  { name: 'Jarvis', emoji: '🤖', color: '#22b5c9', note: 'Just a rather very intelligent system' },
  { name: 'Ada', emoji: '🧮', color: '#8b6cf0', note: 'After Ada Lovelace' },
  { name: 'Grace', emoji: '🐛', color: '#2fb67c', note: 'After Grace Hopper, who found the first bug' },
  { name: 'Sage', emoji: '🌿', color: '#8cc63f', note: 'Calm, and usually right' },
  { name: 'Atlas', emoji: '🗺️', color: '#e2609a', note: 'Carries the load' },
];
