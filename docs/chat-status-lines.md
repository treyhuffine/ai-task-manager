# Status lines

**Status:** trial, added 2026-11-03, on by default. Settings → General → Agents → Status lines turns it off.

Coming back to Ri, the question is which chats need you and what for. "Unread" only says new text arrived since you looked. On a real home, of 23 unread chats about 5 asked for a decision, 3 waited on a deploy only the person could do, 1 had stalled, and about 14 were reports that asked nothing. The asks were the oldest, so newest-first buried them.

A status line answers that. At the end of each turn, a chat's agent writes one line saying where the chat stands: what it did, or what it needs from you, how long your part takes and what it unblocks. Ri shows the line under the chat's title.

## Who writes it

The agent itself, as part of its turn. It knows what it did and what it needs, so no second model reads the turn and nothing is classified after the fact. The rule rides each message Ri sends an execution's chats, with the handoff rule (`turnStatusInstructions` in `src/lib/sessions/turn-status-instructions.ts`, joined in `withWorkResultSessionInstructions`). The agent calls `set_chat_status`, a coordination tool on the chat's MCP and `ri agent set_chat_status` on the signed CLI (`src/lib/coordination/actions.ts`). It acts only on the calling chat.

| Field | Meaning |
|---|---|
| `line` | One line, under 100 characters is best. When it needs you, what to do, verb first ("Pick A or B for the pricing table"). Otherwise what it did or where things stand ("Merged the login fix, nothing needed"). |
| `needs_you` | The agent waits on the person. The line reads stronger and can carry its size. It doesn't change whether the chat is read. |
| `effort` | Their part, when it needs them: `quick` (a click or a short reply), `minutes` (a few minutes to read or try something), `block` (a real decision or a long test). Shown as Quick for you, Few min for you, Needs your time. |
| `unblocks` | What answering unblocks, briefly. |

The rule also asks the agent to make the person's part small before it stops: recommend an option, and prepare any test (a link, a short checklist, the one command).

Only execution chats get the rule. Agents' main chats already show their last message on their rail row, and reviewers and team chats are left out.

## Where it shows

- **Recent:** the line takes the second line's place (the agent's name and branch), since the avatar already names the agent.
- **Unread (the agents-only rail's row and its flyout), Pinned, an agent's chats and its Chats tab:** under the title, above the time and agent.
- An ask reads stronger than a report. Its size is a small gray chip at the end of the metadata line in Unread, an agent's chats and its Chats tab ("5m · Website, [Few min for you]"), apart from the ask so the ask keeps the whole line. It names the person because "Few min" alone, beside a row's "5m", read as how long ago, and it's a chip because as plain text it read as one more piece of metadata. It's gray because amber marks what wants you, once per row, and the row's dot already says that: the size is only how big the ask is. Recent leaves the size out: it's the list of what happened, and Unread is where you choose what to do. It's the agent's own estimate: nothing measures or checks it.

Recency stays the order. The size of your part and what it unblocks are on the row, so you weigh value yourself: agents can't know what matters most to you, and a score would guess.

## How long it lasts

Stored on the chat as `chat_sessions.turn_status` (JSON, null until set, migration 0029).

- **A new message to the chat clears it** (`insertChatEvent`, a `user` or `cron` event): a new turn starts, so the last line no longer says where things stand.
- **Reading a chat leaves its line.** A chat goes read the same way with or without a status ([chat-sessions.md](chat-sessions.md#ux-rules)), and the line stays on the row until a new message clears it.
- **Turning status lines off** clears every status and drops the rule, so the app is as it was. Agents that call the tool anyway are refused.

## Tried and removed

From 2026-11-03 to 2026-11-05, a status that waited on you kept the chat in Unread after you looked at it, until you answered or marked it read, so a glance couldn't drop a question out of Unread. In use it read as marking read being broken: a chat you had just opened still said Unread, nothing in the chat said why, and an ask you finish outside the chat (restarting prod) cleared only through Mark as read. So a status no longer has any say in read or unread.

## Reverting

Turn it off in Settings, or remove the code: the rule, the action, the column's readers and the rows' line. The `turn_status` and `chat_status_lines` columns stay, empty, since migrations can't be taken back once they've run.

## Not done yet

- The header pills' lists and Board don't show the line yet.
- A "Quick ones" filter, and turning a block-sized ask into a Deck task in one click, wait on seeing real lines.
- Chats on other harnesses follow the rule as well as they follow instructions. A chat that skips it shows what it showed before.
