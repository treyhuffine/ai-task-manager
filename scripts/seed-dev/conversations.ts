/**
 * The dev seed's chats outside executions: the main chat (today's planning,
 * yesterday's request that started an agent), an older main chat, focused
 * chats on a note and a task, and the Fieldnote iOS agent's own main chat.
 * Orchestrator actions appear as the `mcp__orchestrator__*` tool calls a real
 * main chat makes.
 */

import pc from 'picocolors';
import type { Attachment } from '../../src/db/types';
import type { SeedFileName } from './files';
import { tools, writeTranscript, type Step } from './chat';
import type { AgentSlug } from './tasks';
import { dateIn, daysAgo, hoursAgo, ms, plus } from './time';

const minutesBetween = (from: string, to: string) => Math.max(30, Math.round((new Date(to).getTime() - new Date(from).getTime()) / ms.minute));

const { ri } = tools;

interface ConversationCtx {
  q: typeof import('../../src/lib/db/queries');
  db: ReturnType<typeof import('../../src/lib/db').getDb>;
  schema: typeof import('../../src/lib/db/schema');
  eq: typeof import('drizzle-orm').eq;
  taskIds: Map<string, string>;
  noteIds: Map<string, string>;
  workspaceIds: Map<AgentSlug, string>;
  files: Record<SeedFileName, Attachment>;
}

interface ConversationDef {
  kind: 'main' | 'agent-main' | 'note' | 'task';
  /** The note or task title a focused chat is on, or the agent's slug. */
  on?: string;
  startAt: string;
  seen: boolean;
  steps: Step[];
}

function defs(task: (title: string) => string): ConversationDef[] {
  return [
    {
      kind: 'main',
      startAt: daysAgo(1, 20, 32),
      seen: true,
      steps: [
        { user: 'Can you get an agent going on the voice notes task? It has to work offline.' },
        ri('get_task', { id: task('Voice notes: transcribe on device') }, { ok: true, result: { id: task('Voice notes: transcribe on device'), title: 'Voice notes: transcribe on device', status: 'in_progress' } }),
        ri('start_execution', { workspace: 'fieldnote-ios', taskId: task('Voice notes: transcribe on device'), prompt: 'Next up for 1.0: when someone records a voice note, turn it into text for the note field. Has to work offline, that is the whole pitch.' }, { ok: true, result: { label: 'Voice notes: transcribe on device', workspace: 'Fieldnote iOS' } }),
        { say: "Started in **Fieldnote iOS**: \"Voice notes: transcribe on device\". I passed along that it has to work offline. I'll flag it when it needs a decision from you." },
        // This morning's planning, a couple of hours ago whenever the seed runs.
        { user: 'What is on my plate today?', gapMin: minutesBetween(daysAgo(1, 20, 34), hoursAgo(2.5)) },
        ri('get_deck', {}, { ok: true, result: { forDate: dateIn(0), items: 7 } }),
        ri('list_tasks', { status: 'in_progress' }, { ok: true, result: { count: 9 } }),
        { say: "Seven things, two of them can't slide:\n\n1. **Long run: 18 miles** is today. Go early, it hits 84°F by 2.\n2. **Book physio for calf strain** was due yesterday. Two minutes, and it matters for the long run.\n3. **Ruby's field trip permission slip** is due tomorrow.\n4. **Call Dana about the panel upgrade** before Thursday, her quote expires.\n5. **Order green coffee for winter** is due in 3 days. Luis wants to settle the Guji amount first.\n6. The offline sync fix is done and waiting for your review.\n7. Phone screens for the production roaster.\n\nThe voice notes agent is waiting on you to pick where its species hints come from (a bundled list or eBird data). That's a two-minute decision when you have a second." },
        { user: "Push the backsplash decision to next week. Theo wants to see the samples in person.", gapMin: 4 },
        ri('update_task', { id: task('Pick the kitchen backsplash tile'), resurfaceAfter: dateIn(7) }, { ok: true, result: { id: task('Pick the kitchen backsplash tile'), resurfaceAfter: dateIn(7) } }),
        { say: "Done. **Pick the kitchen backsplash tile** is snoozed until next week, so it won't show up until then." },
      ],
    },
    {
      kind: 'main',
      startAt: daysAgo(9, 7, 10),
      seen: true,
      steps: [
        { user: 'Help me plan the week. Market Saturday, two wholesale deliveries, and I want two long-ish agent sessions on Fieldnote.' },
        ri('list_tasks', { status: 'todo', hasDeadline: true }, { ok: true, result: { count: 6 } }),
        { say: "Here's a shape that fits:\n\n- **Mon**: wholesale deliveries (Little Owl, Grain & Gather). Start the sync bug agent before you leave.\n- **Tue**: roast day. Light admin only.\n- **Wed**: second Fieldnote session, landing page. Review the sync work.\n- **Thu**: call Dana, order green coffee with Luis.\n- **Fri**: taxes inbox, 30 minutes.\n- **Sat**: market. Nothing else.\n\nThe skylight has been pushed four times. Want me to drop it or book someone?" },
        { user: 'Keep it. Rain is coming.' },
        { say: "Kept. I'll leave it on Thursday's list next to the call with Dana, since she might know a roofer." },
      ],
    },
    {
      kind: 'note',
      on: 'Marathon training plan (16 weeks)',
      startAt: daysAgo(2, 21, 15),
      seen: true,
      steps: [
        { user: 'My calf is tight after Sunday. Rework the last five weeks so I still race but back off the speed work.' },
        { think: '' },
        { say: "Here's a gentler finish that keeps the race:\n\n- **Week 12**: drop the 6 x 800 m, replace with 40 min easy plus 6 strides. Long run 16 instead of 18.\n- **Week 13**: one tempo of 4 miles at marathon pace, no intervals. Long run 18 if the calf is quiet, else 14.\n- **Week 14**: 20 miles only if weeks 12 and 13 were pain free. Otherwise 16 and call it.\n- **Weeks 15 and 16**: taper as written.\n\nAdd calf raises (3 x 15, slow lowering) on rest days, and see the physio before week 13. Want me to write this into the plan?" },
        { user: 'Yes, write it in.' },
        { say: 'Updated weeks 12 to 14 in the plan and added the calf raises to rest days. The original numbers are in the version history if you want them back.' },
      ],
    },
    {
      kind: 'task',
      on: 'Hire a part-time production roaster',
      startAt: daysAgo(4, 12, 40),
      seen: true,
      steps: [
        { user: 'Give me four phone screen questions that tell me fast if someone can run the roaster alone on a Tuesday.' },
        { say: "1. **Walk me through your last roast day, start to finish.** Listen for warm-up, batch logging and cleaning without prompting.\n2. **The bean temp stalls a minute before first crack. What do you do?** You want gas or airflow adjustments, not \"call someone\".\n3. **How do you check a batch is right before it's bagged?** Color, weight loss, cupping. Anyone who says \"it smells done\" is a no.\n4. **What would you need from us to be alone on a Tuesday by week three?** Tells you about self-direction and what training they expect.\n\nI added them to the task as a checklist." },
      ],
    },
    {
      kind: 'agent-main',
      on: 'fieldnote-ios',
      startAt: daysAgo(3, 21, 5),
      seen: true,
      steps: [
        { user: 'What is left before we can submit to the App Store?' },
        ri('list_tasks', { workspace: 'fieldnote-ios', status: ['todo', 'in_progress'] }, { ok: true, result: { count: 5 } }),
        { say: "Four things block submission, in order:\n\n1. **Fix offline sync dropping sightings.** This is the one testers notice. It blocks the submission task.\n2. **Write the privacy policy.** App Store Connect won't take the build without a URL.\n3. **Voice notes: transcribe on device.** Not strictly required, but it's the headline feature in the screenshots.\n4. **Screenshots and the App Store description.** Not started.\n\nThe submission deadline is in about a week. Sync and the privacy policy are the critical path." },
      ],
    },
  ];
}

export async function seedConversations(ctx: ConversationCtx): Promise<void> {
  const { q, db, schema, eq, taskIds, noteIds, workspaceIds } = ctx;
  const { getAppRoot } = await import('../../src/lib/config/paths');
  const task = (title: string) => {
    const id = taskIds.get(title);
    if (!id) throw new Error(`conversation: no task "${title}"`);
    return id;
  };
  const note = (title: string) => {
    const id = noteIds.get(title);
    if (!id) throw new Error(`conversation: no note "${title}"`);
    return id;
  };
  const all = defs(task);
  for (const def of all) {
    let session;
    let cwd = getAppRoot();
    if (def.kind === 'main') {
      session = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', model: 'opus' });
    } else if (def.kind === 'agent-main') {
      const workspaceId = workspaceIds.get(def.on as AgentSlug)!;
      session = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', workspaceId, model: 'opus' });
      cwd = q.getWorkspace(workspaceId)!.cwd;
    } else {
      const surfaceRef = def.kind === 'note' ? note(def.on!) : task(def.on!);
      session = q.createChatSession({ type: 'content', harness: 'claude', status: 'active', surfaceKind: def.kind, surfaceRef, model: 'sonnet' });
    }
    const transcript = await writeTranscript(session, { harness: 'claude', model: 'claude-opus-5-5', cwd, startAt: def.startAt, steps: def.steps, costPerTurn: 0.09, pace: 2 });
    db.update(schema.chatSessions).set({
      createdAt: def.startAt,
      startedAt: def.startAt,
      lastActivityAt: transcript.lastAt,
      lastViewedAt: def.seen ? plus(transcript.lastAt, 3 * ms.minute) : (transcript.firstUserAt ?? def.startAt),
    }).where(eq(schema.chatSessions.id, session.id)).run();
  }
  // The main chat snoozed the backsplash decision. Make it so.
  db.update(schema.tasks).set({ resurfaceAfter: dateIn(7) }).where(eq(schema.tasks.id, task('Pick the kitchen backsplash tile'))).run();
  console.log(pc.green(`  ✓ ${all.length} chats (main, focused, agent)`));
}
