/**
 * The heartbeat's ground rules and the quiet-reply check.
 *
 * The user edits plain instructions (the trigger's `prompt`). The rules that
 * make it safe and legible live here, in code, and are wrapped around those
 * instructions at dispatch, so the user can never delete the hard limits by
 * editing their text. See docs/heartbeat-spec.md §5.2 and §5.3.
 *
 * Pure, so the transcript can recognize the main agent's silent reply.
 */

import { APP_NAME } from '@/constants/app';
import { HEARTBEAT_QUIET_REPLY, NO_MESSAGE_REPLY } from './constants';

const NOTE_NOW_HEADING = 'Now';
const NOTE_LATER_HEADING = 'Later';

export const HEARTBEAT_GROUND_RULES = `This is a scheduled background check-in, not a conversation. The user is not watching and won't read this chat. Work through the instructions below using the ${APP_NAME} tools. Do only what the instructions ask, and don't invent new chores.

Never delete anything. Never send, post, or share anything outside ${APP_NAME}. Never complete a task. Start or message agent executions only when the instructions ask for it. Don't use message_agent to reach the user or their main agent. Your final reply is how anything reaches them. This chat closes when you finish, so don't wait on agent work you start. A later check-in can look at it.

Your final reply is a private note to the user's main agent, who decides whether and how to tell them. ${APP_NAME} records everything you change, so leave changes out unless the user has to act on one.

If nothing needs to reach them, reply with exactly ${HEARTBEAT_QUIET_REPLY} and nothing else. That should be the usual outcome. Restraint matters more than finding things.

Otherwise reply with one or both of these sections:

**${NOTE_NOW_HEADING}**
Only what can't wait until the next check-in because waiting would cost them something. Their main agent will interrupt them for this.

**${NOTE_LATER_HEADING}**
What needs them but can wait: questions, offers, and decisions. These go into one message a day.

One short line per item, then its reference on the next line. Put each heading on its own line with a blank line after it. Most important first, at most 15 lines of text. Leave out an empty section.

References are [[task:ID]], [[note:ID]], or [[execution:SESSION_ID]] (the sessionId from list_executions). Put each one on its own line, never inside a bullet, a sentence, or backticks, or it won't render as a chip. Copy every id exactly from a tool result.`;

/**
 * The full prompt a heartbeat check-in sends: ground rules, what earlier
 * check-ins already raised, then the user's instructions verbatim.
 */
export function composeHeartbeatPrompt(instructions: string, alreadyRaised?: string | null): string {
  const raised = alreadyRaised?.trim()
    ? `## Already raised\n\nEarlier check-ins passed these along. Don't raise them again unless something changed.\n\n${alreadyRaised.trim()}\n\n`
    : '';
  return `${HEARTBEAT_GROUND_RULES}\n\n${raised}## Your instructions\n\n${instructions.trim()}`;
}

function isExactly(content: string | null | undefined, token: string): boolean {
  if (!content) return false;
  const stripped = content
    .trim()
    .replace(/^[`*_"'\s]+|[`*_"'.\s]+$/g, '')
    .trim();
  return stripped === token;
}

/**
 * True when an assistant reply is the quiet token and nothing else. Tolerates
 * the wrapping models reach for (whitespace, backticks, bold, quotes, a
 * trailing period) but never extra words: "HEARTBEAT_OK, but also..." is a
 * report, not a quiet check-in.
 */
export function isQuietReply(content: string | null | undefined): boolean {
  return isExactly(content, HEARTBEAT_QUIET_REPLY);
}

/** True when the main agent chose not to send a check-in's note on. */
export function isNoMessageReply(content: string | null | undefined): boolean {
  return isExactly(content, NO_MESSAGE_REPLY);
}

export interface CheckInNote {
  now: string | null;
  later: string | null;
}

const NOTE_HEADING = new RegExp(`^[\\s#*_]*(${NOTE_NOW_HEADING}|${NOTE_LATER_HEADING})[\\s*_:]*$`, 'i');

/**
 * Split a check-in's final reply into what can't wait and what can. Anything
 * before the first heading is the agent thinking aloud and goes nowhere. A
 * reply with no headings at all counts as Later, since a note in the wrong
 * shape should never be what buzzes someone's phone.
 */
export function parseCheckInNote(reply: string): CheckInNote {
  const sections: Record<'now' | 'later', string[]> = { now: [], later: [] };
  let current: 'now' | 'later' | null = null;
  for (const line of reply.split('\n')) {
    const heading = line.match(NOTE_HEADING)?.[1]?.toLowerCase();
    if (heading === 'now' || heading === 'later') current = heading;
    else if (current) sections[current].push(line);
  }
  if (!current) return { now: null, later: reply.trim() || null };
  return { now: sections.now.join('\n').trim() || null, later: sections.later.join('\n').trim() || null };
}
