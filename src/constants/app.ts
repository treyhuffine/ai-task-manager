export const APP_NAME = 'Flow';
export const APP_DESCRIPTION = 'Productivity framework for humans <> agents';
export const APP_SHORT_ID = 'flow';

/**
 * Installed name of the shipped agent skill that teaches any agent to drive
 * the tasks + notes + deck + execution surface. Composed from APP_SHORT_ID so
 * a rebrand propagates from one place: change APP_SHORT_ID and the skill
 * re-materializes under the new name on the next install. The literal short id
 * only ever lands in the generated on-disk skill, never in a committed source
 * file, so nothing here is hardcoded.
 */
export const AGENT_SKILL_NAME = `agent-work-tasks-notes_${APP_SHORT_ID}`;

export const PAIRING_TOKEN_FRAGMENT_KEY = 'token';