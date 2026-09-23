/**
 * The heartbeat's ground rules and the quiet-reply check.
 *
 * The user edits plain instructions (the trigger's `prompt`). The rules that
 * make it safe and legible live here, in code, and are wrapped around those
 * instructions at dispatch, so the user can never delete the hard limits by
 * editing their text. See docs/heartbeat-spec.md §5.2 and §5.3.
 */

import { APP_NAME } from '@/constants/app';
import { HEARTBEAT_QUIET_REPLY } from './constants';

export const HEARTBEAT_GROUND_RULES = `This is a scheduled heartbeat check-in, not a conversation. The user is not watching. Work through the instructions below using the ${APP_NAME} tools. Do only what the instructions ask, and don't invent new chores.

Never delete anything. Never send, post, or share anything outside ${APP_NAME}. Never complete a task. Start or message agent executions only when the instructions ask for it.

If nothing needs attention and you changed nothing, reply with exactly ${HEARTBEAT_QUIET_REPLY} and nothing else.

Otherwise reply with a short report. Open with one short line on what you checked and found fine, then the sections:

**Did**
One short line per change, then its reference on the next line.

**Needs you**
One short line per question or offer, then its reference on the next line.

Put each heading on its own line with a blank line after it. Most important first, at most 15 lines of text. Leave out an empty section.

References are [[task:ID]], [[note:ID]], or [[execution:SESSION_ID]] (the sessionId from list_executions). Put each one on its own line, never inside a bullet, a sentence, or backticks, or it won't render as a chip. Copy every id exactly from a tool result.`;

/** The full prompt a heartbeat check-in sends: ground rules, then the user's instructions verbatim. */
export function composeHeartbeatPrompt(instructions: string): string {
  return `${HEARTBEAT_GROUND_RULES}\n\n## Your instructions\n\n${instructions.trim()}`;
}

/**
 * True when an assistant reply is the quiet token and nothing else. Tolerates
 * the wrapping models reach for (whitespace, backticks, bold, quotes, a
 * trailing period) but never extra words: "HEARTBEAT_OK, but also..." is a
 * report, not a quiet check-in.
 */
export function isQuietReply(content: string | null | undefined): boolean {
  if (!content) return false;
  const stripped = content
    .trim()
    .replace(/^[`*_"'\s]+|[`*_"'.\s]+$/g, '')
    .trim();
  return stripped === HEARTBEAT_QUIET_REPLY;
}
