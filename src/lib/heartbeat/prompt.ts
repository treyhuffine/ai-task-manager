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

const NOTE_DID_HEADING = 'Did';
const NOTE_NOW_HEADING = 'Now';
const NOTE_LATER_HEADING = 'Later';

export const HEARTBEAT_GROUND_RULES = `This is a scheduled background check-in, not a conversation. The user is not watching and won't read this chat. Work through the instructions below using the ${APP_NAME} tools. Do only what the instructions ask, and don't invent new chores. Skip anything you have no tools for.

The instructions may say when to do things, such as once each morning. Use the time and the earlier check-ins listed below to decide what's due now, and do every item that's due, checking with the tools before you conclude there's nothing to do.

Never delete anything. Never send, post, or share anything outside ${APP_NAME}. Never complete a task. Start or message agent executions only when the instructions ask for it. Don't use message_agent to reach the user or their main agent. Your final reply is how anything reaches them. This chat closes when you finish, so don't wait on agent work you start. A later check-in can look at it.

Your final reply is a private note to the user's main agent, who decides whether and how to tell them.

If you changed nothing and nothing needs to reach them, reply with exactly ${HEARTBEAT_QUIET_REPLY} and nothing else. That should be the usual outcome. Restraint matters more than finding things.

Otherwise reply with any of these sections:

**${NOTE_DID_HEADING}**
What you changed, for the record. Later check-ins can see it. Nobody is told now.

**${NOTE_NOW_HEADING}**
What should reach them now: what can't wait until the next check-in because waiting would cost them something, and everything the instructions say to tell them or offer them at this time, in full. Their main agent will message them.

**${NOTE_LATER_HEADING}**
What needs them but isn't due yet: questions and decisions the instructions haven't asked you to bring up at this time. Later check-ins can see it, and can tell them when the instructions say to.

One short line per item, then its reference on the next line. Put each heading on its own line with a blank line after it. Most important first, at most 15 lines of text. Leave out an empty section.

References are [[task:ID]], [[note:ID]], or [[execution:SESSION_ID]] (the sessionId from list_executions). Put each one on its own line, never inside a bullet, a sentence, or backticks, or it won't render as a chip. Copy every id exactly from a tool result.`;

/**
 * The full prompt a heartbeat check-in sends: ground rules, what the app knows
 * right now (a fresh chat has no memory), then the user's instructions verbatim.
 */
export function composeHeartbeatPrompt(instructions: string, context?: string | null): string {
  const known = context?.trim() ? `${context.trim()}\n\n` : '';
  return `${HEARTBEAT_GROUND_RULES}\n\n${known}## Your instructions\n\n${instructions.trim()}`;
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
  did: string | null;
  now: string | null;
  later: string | null;
}

type NoteSection = keyof CheckInNote;

const NOTE_HEADING = new RegExp(`^[\\s#*_]*(${NOTE_DID_HEADING}|${NOTE_NOW_HEADING}|${NOTE_LATER_HEADING})[\\s*_:]*$`, 'i');

/**
 * Split a check-in's final reply into its sections. Anything before the first
 * heading is the agent thinking aloud and goes nowhere. A reply with no
 * headings at all counts as Later, since a note in the wrong shape should never
 * be what buzzes someone's phone.
 */
export function parseCheckInNote(reply: string): CheckInNote {
  const sections: Record<NoteSection, string[]> = { did: [], now: [], later: [] };
  let current: NoteSection | null = null;
  for (const line of reply.split('\n')) {
    const heading = line.match(NOTE_HEADING)?.[1]?.toLowerCase() as NoteSection | undefined;
    if (heading) current = heading;
    else if (current) sections[current].push(line);
  }
  if (!current) return { did: null, now: null, later: reply.trim() || null };
  const text = (section: NoteSection) => sections[section].join('\n').trim() || null;
  return { did: text('did'), now: text('now'), later: text('later') };
}
