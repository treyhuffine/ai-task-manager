# Scratchpad

**Status:** Trial, built 2026-10-29.

One page of working memory per person, beside every screen and the same on
every device. You jot on it, keep it in view, cross things off, and move a
line somewhere else when you choose. Nothing reads it, sorts it or acts on
it on its own.

## Why it exists

`docs/braindump-ux.md` decided "No scratchpad. The stream IS the working
memory." Use said otherwise:

- **The Stream went quiet.** 39 captures in total. 28 came from the voice
  webhook, which stopped in September, and only about 10 were typed into
  Quick capture in six months.
- **Chat scratchpads are used.** 23 chats held scratchpad text on
  2026-10-29, 20 of them from the previous two weeks, even though the
  scratchpad sits in the panel's More menu. Most of it is the next message
  drafted while an agent works, plus the odd thought that has nothing to do
  with that chat and is buried once the chat is archived.
- **Working memory went outside Ri**: handwritten notes, Apple Reminders,
  the calendar.

The reading: working memory and the Stream are opposite jobs, and asking one
tool to do both made it a poor fit for working memory.

- **Working memory** is what you hold for the stretch of work you're in.
  You keep it in view, glance at it, reorder it, cross things off and throw
  it away. Being visible is the point.
- **The Stream** is a hand-off. You give a thought to the system so you can
  stop holding it, and the system decides where it goes, with patience and
  context. Leaving your sight is the point. Its shape (submit, toast, triage)
  is right for that.
- **Notes and tasks** are what you keep: knowledge and commitments.

So the scratchpad doesn't replace the Stream, and it isn't a second inbox.
It's upstream of everything: lines leave it for a task, a note, the Stream
or a chat when you decide.

## How it works

**Where it is.** On a wide window, a column at the right of every screen:
Home, an agent, a chat, Apps, a skill. It stays open across navigation and
reloads, the way a notepad stays on the desk (`ri.client.scratchpadOpen` in
localStorage). On a phone or tablet it's a sheet over the page. It opens
from the notebook button in the top bar (beside search on a phone), the
command palette ("Scratchpad"), or ⌘⇧J.

**⌘⇧J gets you to the caret and back** (`nextScratchpadAction`). Closed, it
opens the pad with the caret in it. Open while you work elsewhere, it puts
the caret in it. Pressed from inside the column, it takes you back to where
you were (the message you were writing, say) and leaves the pad in view.
Escape or ✕ closes the column. On a sheet, pressing it from inside closes
the sheet. ⌘⇧K stays the Stream's Quick capture: the two are separate front
doors because they're separate jobs.

**Writing.** The same editor as a note's body: checklists to cross off,
headings, links, and chips to tasks and notes. It saves as you type.

**Moving a line out.** The bar along the bottom acts on the selection, or
with nothing selected on the line the caret is on, so a single line never
needs selecting (`pad-target.ts`).

- **Task** or **Note** makes one (the first line is its title, the rest
  its body) and leaves a chip to it in the line's place.
- **Stream** hands the text to the Stream (a `capture` item, triaged like
  any other) and clears it from the pad, since handing it off is the point.
- **Chat** adds the text to the message box of the chat on screen (the one
  ⌘I goes to), and leaves it on the pad.

**Agents read it only when asked.** `get_scratchpad` returns its Markdown
and when it last changed, so "look at my scratchpad and make tasks of the
open items" works from the main chat or an agent's main chat. Nothing
writes it but the person. It lives in its own table, not on `user_state`,
because `get_user_state` and the deck read that row. Execution chats keep
their own per-chat scratchpad and `@scratchpad`, unchanged.

**Private planning.** Only a personal Home has one. A team's Home shows no
pad, and its procedures and action refuse there.

## Every device

The pad is one Markdown text (`scratchpad` table, one row). The client
(`ScratchpadSaver`) keeps unsent typing in localStorage the moment it
happens, sends it after a short pause one save at a time, and retries a
save the network lost. Leaving the page waits on it like a note's body
(`documentSaves`).

Each save says which text it started from. When another device saved in
between, the server merges the two in the same transaction
(`mergeScratchpad`), a three-way merge by line. Lines both sides kept line
the versions up, and between them each stretch takes whichever side changed
it, so an edit on the phone and an edit on the desk both land where they
were made, and a line one side removed stays removed. Where both changed
the same stretch, the stored version comes first, then what this device
wrote that it doesn't already have. Nothing typed is lost. Blank lines
count, since the editor writes an empty paragraph as one, so a new empty
line you're about to type on survives the merge.

The editor then shows the merged text by replacing only the part that
differs (`replaceChanged`), so the caret stays in the line you're typing,
and the change stays out of this editor's undo history. The open pad
refetches every 30 seconds and whenever the window comes back into focus,
and takes the stored text whenever nothing is unsent, so a phone's lines
are usually already on the desk before you type.

Checked end to end on 2026-10-29 in a browser against an isolated home:
the column and shortcut, Task, Stream and Chat, reload, Escape, the phone
sheet, two pages editing at once, and another device's save arriving on
window focus.

## What the trial should tell us

- Do you reach for it instead of paper? Count what lands on it in a week.
- Does it get pruned, or does it pile up into a junk drawer? Nothing tends
  it, by design.
- Which way do lines leave: tasks, notes, Stream, chat, or deletion?
- Do chat scratchpads go quiet now that this one is beside every chat? If
  so, they may fold into this.
- What do you still use Apple Reminders and the calendar for? That's
  memory with a time attached ("nudge me at 3"), which a pad doesn't do.

Turning it off: close the column. Removing it is this file's code and one
table.

## Not built yet

Named so they're decided on evidence from the trial, not now:

- **The desktop app's system-wide shortcut opening the pad**, for jotting
  while Ri isn't in front.
- **`@scratchpad` for this pad** in any chat composer. Today `@scratchpad`
  means the chat's own.
- **Agents writing to it** ("Rye, put this on my pad").
- **Time-based nudges** for the Reminders use.
- **The Stream reading lines left alone for a while** and offering to sort
  them, if the pad turns out to be where capture really happens.
