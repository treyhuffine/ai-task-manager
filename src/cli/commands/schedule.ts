/**
 * `<cli> schedule …` — ergonomic CLI surface for scheduled work.
 *
 * Wraps the orchestrator's `create_schedule`, `list_schedules`,
 * `update_schedule`, `delete_schedule`, `run_schedule`,
 * `cancel_run`, etc. with friendlier flag shapes, name-based lookups,
 * and pretty terminal output. Everything routes through `runAction`
 * so the behavior matches the MCP transport exactly.
 *
 * Also registers `<cli> runs` and `<cli> spend` since they share the
 * runs surface.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import { Command } from 'commander';
import { runAction } from '@/lib/orchestrator/dispatch';
import type { ScheduleRecord, RunRecord, ScheduleWithLastRun } from '@/db/types';

export function registerScheduleCommands(program: Command) {
  registerScheduleCommand(program);
  registerRunsCommand(program);
  registerSpendCommand(program);
}

// ── schedule ────────────────────────────────────────────────

function registerScheduleCommand(program: Command) {
  const schedule = program
    .command('schedule')
    .description('Manage scheduled agent work (cron, interval, one-shot, webhook).');

  schedule
    .command('create')
    .description(
      'Create a new schedule. Prefer the friendly cadence flags ' +
        '(--manual / --hourly / --daily-at / --weekly-on / --monthly-on / --webhook / --cron) ' +
        'over the low-level --cron/--every/--at trio.',
    )
    .requiredOption('--name <name>', 'Human-facing name. Unique within scope.')
    .option('--prompt <prompt>', 'Prompt text. One of --prompt or --prompt-file is required.')
    .option('--prompt-file <path>', 'Path to a file containing the prompt text.')
    .option('--description <text>', 'Short description (shown alongside the name).')
    // ── Friendly cadence ──
    .option('--manual', 'No automatic firing; only fires via `flow schedule run`.')
    .option('--hourly', 'Fire at the top of every hour.')
    .option('--daily-at <time>', 'Fire daily at HH:MM (e.g. 09:00).')
    .option('--weekly-on <day>', 'Weekday: monday|tuesday|... (use with --at).')
    .option('--monthly-on <day>', 'Day of month 1-28 (use with --at).', Number)
    .option('--at <time>', 'HH:MM time, used with --weekly-on / --monthly-on.')
    // ── Raw cadence (advanced) ──
    .option('--cron <expr>', '5-field cron expression (advanced).')
    .option('--every <seconds>', 'Interval in seconds.', Number)
    .option('--run-at <iso>', 'Absolute ISO timestamp for a one-shot schedule.')
    .option('--webhook', 'Webhook-triggered schedule.')
    .option('--timezone <tz>', 'IANA timezone for cron interpretation.', 'UTC')
    // ── Target / agent ──
    .option('--target <kind>', 'workspace | orchestrator', 'workspace')
    .option('--workspace <id-or-slug>', 'Target workspace (required when target=workspace).')
    .option('--agent <id>', 'Agent id to dispatch as. Defaults to the target type default.')
    // ── Per-run overrides ──
    .option('--model <model>', 'Per-run model override.')
    .option('--effort <level>', 'low | medium | high | xhigh | max')
    .option('--timeout <seconds>', 'Run timeout (seconds).', Number)
    .option(
      '--active-hours <start-end>',
      'Active-hours window, e.g. 09:00-17:00. Only fires inside the window.',
    )
    .option(
      '--concurrency <policy>',
      'skip_if_running | coalesce_if_active | allow_concurrent',
      'coalesce_if_active',
    )
    .action(async (opts) => {
      const promptText = opts.promptFile
        ? fs.readFileSync(opts.promptFile, 'utf8')
        : opts.prompt;
      if (!promptText || !promptText.trim()) {
        process.stderr.write(
          'Provide --prompt "..." or --prompt-file <path>.\n',
        );
        process.exit(1);
      }

      // Compile friendly cadence flags into kind + cronExpression. Raw
      // --cron / --every / --run-at / --webhook still win if set —
      // they're the low-level escape hatch.
      const compiled = await compileCadence(opts);

      const [startHours, endHours] = parseActiveHours(opts.activeHours);
      const input: Record<string, unknown> = {
        name: opts.name,
        description: opts.description ?? null,
        prompt: promptText,
        ...(opts.agent ? { agentId: opts.agent } : {}),
        targetKind: opts.target,
        workspaceId: opts.workspace ?? null,
        kind: compiled.kind,
        cronExpression: compiled.cronExpression,
        intervalSeconds: compiled.intervalSeconds,
        runAt: compiled.runAt,
        timezone: opts.timezone,
        model: opts.model ?? null,
        effort: opts.effort ?? null,
        timeoutSeconds: opts.timeout,
        activeHoursStart: startHours,
        activeHoursEnd: endHours,
        concurrencyPolicy: opts.concurrency,
      };
      const envelope = await runAction('create_schedule', input, { remote: false });
      unwrapAndPrint(envelope);
    });

  schedule
    .command('list')
    .description('List schedules.')
    .option('--enabled', 'Only enabled schedules.')
    .option('--workspace <id>', 'Restrict to a workspace.')
    .action(async (opts) => {
      const envelope = await runAction(
        'list_schedules',
        {
          ...(opts.enabled ? { enabled: true } : {}),
          ...(opts.workspace ? { workspaceId: opts.workspace } : {}),
        },
        { remote: false },
      );
      if (!envelope.ok) return printErrorAndExit(envelope);
      printScheduleTable(envelope.result as ScheduleWithLastRun[]);
    });

  schedule
    .command('show <idOrName>')
    .description('Show a schedule in detail.')
    .action(async (idOrName) => {
      const result = await resolveScheduleByIdOrName(idOrName);
      console.log(JSON.stringify(result, null, 2));
    });

  schedule
    .command('run <idOrName>')
    .description('Fire a schedule immediately (records as a manual run).')
    .option('--wait', 'Block until the run terminates.')
    .action(async (idOrName) => {
      const schedule = await resolveScheduleByIdOrName(idOrName);
      const envelope = await runAction(
        'run_schedule',
        { id: schedule.id },
        { remote: false },
      );
      unwrapAndPrint(envelope);
      // --wait poll loop omitted for V1 — the run row is durable in
      // the DB; `flow run show <id>` covers the status check.
    });

  schedule
    .command('pause <idOrName>')
    .description('Disable a schedule. Existing runs are unaffected.')
    .action(async (idOrName) => {
      const target = await resolveScheduleByIdOrName(idOrName);
      const envelope = await runAction(
        'update_schedule',
        { id: target.id, enabled: false },
        { remote: false },
      );
      unwrapAndPrint(envelope);
    });

  schedule
    .command('resume <idOrName>')
    .description('Re-enable a previously paused schedule.')
    .action(async (idOrName) => {
      const target = await resolveScheduleByIdOrName(idOrName);
      const envelope = await runAction(
        'update_schedule',
        { id: target.id, enabled: true, disabledReason: null },
        { remote: false },
      );
      unwrapAndPrint(envelope);
    });

  schedule
    .command('edit <idOrName>')
    .description('Patch a schedule (prompt, cadence, etc.).')
    .option('--prompt <text>', 'New prompt text')
    .option('--cron <expr>', 'New cron expression')
    .option('--every <seconds>', 'New interval in seconds', Number)
    .option('--timezone <tz>', 'New timezone')
    .option('--enabled <bool>', 'true | false', (v: string) => v === 'true')
    .action(async (idOrName, opts) => {
      const target = await resolveScheduleByIdOrName(idOrName);
      const patch: Record<string, unknown> = { id: target.id };
      if (opts.prompt) patch.prompt = opts.prompt;
      if (opts.cron) patch.cronExpression = opts.cron;
      if (opts.every) patch.intervalSeconds = opts.every;
      if (opts.timezone) patch.timezone = opts.timezone;
      if (opts.enabled !== undefined) patch.enabled = opts.enabled;
      const envelope = await runAction('update_schedule', patch, { remote: false });
      unwrapAndPrint(envelope);
    });

  schedule
    .command('delete <idOrName>')
    .description('Delete a schedule. Runs survive with schedule_id=NULL.')
    .option('--force', 'Skip the confirmation prompt.')
    .action(async (idOrName, opts) => {
      const target = await resolveScheduleByIdOrName(idOrName);
      if (!opts.force) {
        const ans = await readLine(`Delete schedule "${target.name}" (${target.id})? [y/N] `);
        if (ans.toLowerCase() !== 'y' && ans.toLowerCase() !== 'yes') {
          console.log('Aborted.');
          return;
        }
      }
      const envelope = await runAction(
        'delete_schedule',
        { id: target.id },
        { remote: false },
      );
      unwrapAndPrint(envelope);
    });
}

// ── runs ────────────────────────────────────────────────────

function registerRunsCommand(program: Command) {
  program
    .command('runs')
    .description('List recent runs across all schedules + manual chats.')
    .option('--unread', 'Only runs whose chat is still unread.')
    .option('--status <s>', 'Filter by status.')
    .option('--trigger <t>', 'Filter by trigger.')
    .option('--schedule <id>', 'Filter by schedule id.')
    .option('--limit <n>', 'Max rows.', Number)
    .action(async (opts) => {
      // Accept either `--status running` (single) or `--status running,failed`
      // (multi). Splitting before forwarding lets the Zod union match
      // the array branch.
      const splitMulti = (raw: string | undefined): string | string[] | undefined =>
        raw == null
          ? undefined
          : raw.includes(',')
            ? raw.split(',').map((s) => s.trim()).filter(Boolean)
            : raw;
      const envelope = await runAction(
        'list_runs',
        {
          ...(opts.status ? { status: splitMulti(opts.status) } : {}),
          ...(opts.trigger ? { trigger: splitMulti(opts.trigger) } : {}),
          ...(opts.schedule ? { scheduleId: opts.schedule } : {}),
          ...(opts.limit ? { limit: opts.limit } : { limit: 25 }),
        },
        { remote: false },
      );
      if (!envelope.ok) return printErrorAndExit(envelope);
      printRunTable(envelope.result as RunRecord[]);
    });

  const run = program
    .command('run')
    .description('Operate on a single run.');

  run
    .command('show <id>')
    .description('Fetch a single run.')
    .action(async (id) => {
      const envelope = await runAction('get_run', { id }, { remote: false });
      unwrapAndPrint(envelope);
    });

  run
    .command('cancel <id>')
    .description('Cancel an in-flight run (SIGTERM the executor).')
    .action(async (id) => {
      const envelope = await runAction('cancel_run', { id }, { remote: false });
      unwrapAndPrint(envelope);
    });
}

// ── spend ───────────────────────────────────────────────────

function registerSpendCommand(program: Command) {
  program
    .command('spend')
    .description('Spending rollups across runs (today / week / month).')
    .option('--by <group>', 'Group by agent or schedule.')
    .action(async (opts) => {
      // We compute the rollup client-side from list_runs since V1 has
      // no dedicated spend orchestrator action.
      const since = new Date();
      since.setUTCDate(1);
      since.setUTCHours(0, 0, 0, 0);
      const envelope = await runAction(
        'list_runs',
        { since: since.toISOString(), limit: 500 },
        { remote: false },
      );
      if (!envelope.ok) return printErrorAndExit(envelope);
      const runs = envelope.result as RunRecord[];
      const now = new Date();
      const today = sumWhere(runs, (r) =>
        r.startedAt != null && sameUtcDay(r.startedAt, now),
      );
      const weekStart = new Date(now);
      weekStart.setUTCDate(weekStart.getUTCDate() - 6);
      weekStart.setUTCHours(0, 0, 0, 0);
      const week = sumWhere(runs, (r) => r.startedAt != null && r.startedAt >= weekStart.toISOString());
      const monthStart = since.toISOString();
      const month = sumWhere(runs, (r) => r.startedAt != null && r.startedAt >= monthStart);

      console.log(`Today: $${today.toFixed(4)}`);
      console.log(`Week:  $${week.toFixed(4)}`);
      console.log(`Month: $${month.toFixed(4)}`);

      if (opts.by === 'agent' || opts.by === 'schedule') {
        const keyOf = (r: RunRecord) =>
          opts.by === 'agent' ? r.agentId : (r.scheduleId ?? 'manual');
        const byKey = new Map<string, number>();
        for (const r of runs) {
          const k = keyOf(r);
          byKey.set(k, (byKey.get(k) ?? 0) + (r.costUsd ?? 0));
        }
        console.log(`\nBy ${opts.by}:`);
        for (const [k, v] of byKey) {
          console.log(`  ${k.padEnd(40)}  $${v.toFixed(4)}`);
        }
      }
    });
}

// ── helpers ─────────────────────────────────────────────────

interface ActionEnvelope {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; suggestion?: string };
}

function unwrapAndPrint(envelope: ActionEnvelope) {
  if (!envelope.ok) return printErrorAndExit(envelope);
  process.stdout.write(JSON.stringify(envelope.result, null, 2) + '\n');
}

function printErrorAndExit(envelope: ActionEnvelope) {
  process.stderr.write(JSON.stringify(envelope, null, 2) + '\n');
  process.exit(1);
}

async function resolveScheduleByIdOrName(idOrName: string): Promise<ScheduleRecord> {
  // Try id first.
  const byId = await runAction('get_schedule', { id: idOrName }, { remote: false });
  if (byId.ok) return byId.result as ScheduleRecord;
  // Fall back to name (brain-level scope).
  const byName = await runAction(
    'get_schedule',
    { name: idOrName, workspaceId: null },
    { remote: false },
  );
  if (byName.ok) return byName.result as ScheduleRecord;
  printErrorAndExit(byName as ActionEnvelope);
  throw new Error('unreachable');
}

/**
 * Resolve the schedule's cadence from CLI flags. Friendly flags
 * (--manual / --hourly / --daily-at / --weekly-on / --monthly-on /
 * --webhook) take priority; --cron / --every / --run-at are the
 * advanced escape hatch.
 *
 * Returns the four fields the create_schedule action needs:
 * `{ kind, cronExpression, intervalSeconds, runAt }`.
 */
async function compileCadence(opts: Record<string, unknown>): Promise<{
  kind: string;
  cronExpression: string | null;
  intervalSeconds: number | null;
  runAt: string | null;
}> {
  const { frequencyToSchedule } = await import('@/lib/scheduler/frequency');

  // Friendly cadence first.
  if (opts.manual) {
    return { kind: 'manual', cronExpression: null, intervalSeconds: null, runAt: null };
  }
  if (opts.webhook) {
    return { kind: 'webhook', cronExpression: null, intervalSeconds: null, runAt: null };
  }
  if (opts.hourly) {
    const c = frequencyToSchedule({ kind: 'hourly' });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }
  if (opts.dailyAt) {
    const c = frequencyToSchedule({ kind: 'daily', time: opts.dailyAt as string });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }
  if (opts.weeklyOn) {
    const weekday = parseWeekday(opts.weeklyOn as string);
    if (!opts.at) throw new Error('--weekly-on requires --at HH:MM');
    const c = frequencyToSchedule({ kind: 'weekly', weekday, time: opts.at as string });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }
  if (opts.monthlyOn) {
    if (!opts.at) throw new Error('--monthly-on requires --at HH:MM');
    const c = frequencyToSchedule({
      kind: 'monthly',
      dayOfMonth: opts.monthlyOn as number,
      time: opts.at as string,
    });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }

  // Advanced raw cadence.
  if (opts.cron) {
    return { kind: 'cron', cronExpression: opts.cron as string, intervalSeconds: null, runAt: null };
  }
  if (opts.every) {
    return { kind: 'every', cronExpression: null, intervalSeconds: opts.every as number, runAt: null };
  }
  if (opts.runAt) {
    return { kind: 'at', cronExpression: null, intervalSeconds: null, runAt: opts.runAt as string };
  }

  throw new Error(
    'Pick a cadence: --manual, --hourly, --daily-at, --weekly-on, --monthly-on, --webhook, ' +
      '--cron, --every, or --run-at.',
  );
}

const WEEKDAY_NAMES: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function parseWeekday(spec: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const key = spec.trim().toLowerCase();
  const v = WEEKDAY_NAMES[key];
  if (v == null) {
    throw new Error(
      `--weekly-on "${spec}": expected monday|tuesday|wednesday|thursday|friday|saturday|sunday`,
    );
  }
  return v;
}

function parseActiveHours(spec?: string): [string | null, string | null] {
  if (!spec) return [null, null];
  const m = spec.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) throw new Error(`--active-hours must look like 09:00-17:00, got "${spec}"`);
  return [m[1], m[2]];
}

function sumWhere(runs: RunRecord[], pred: (r: RunRecord) => boolean): number {
  let sum = 0;
  for (const r of runs) if (pred(r)) sum += r.costUsd ?? 0;
  return sum;
}

function sameUtcDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return (
    d.getUTCFullYear() === ref.getUTCFullYear() &&
    d.getUTCMonth() === ref.getUTCMonth() &&
    d.getUTCDate() === ref.getUTCDate()
  );
}

function printScheduleTable(rows: ScheduleWithLastRun[]) {
  if (rows.length === 0) {
    console.log('No schedules.');
    return;
  }
  const header = ['NAME', 'KIND', 'TARGET', 'ENABLED', 'NEXT FIRE', 'LAST'];
  const data = rows.map((s) => [
    s.name,
    s.kind,
    s.targetKind,
    s.enabled ? 'yes' : 'no',
    s.nextRunAt ? humanize(s.nextRunAt) : '—',
    s.lastRunStatus ?? '—',
  ]);
  printTable(header, data);
}

function printRunTable(rows: RunRecord[]) {
  if (rows.length === 0) {
    console.log('No runs.');
    return;
  }
  const header = ['ID', 'TRIGGER', 'STATUS', 'STARTED', 'COST', 'SUMMARY'];
  const data = rows.map((r) => [
    r.id.slice(0, 8),
    r.trigger,
    r.status,
    r.startedAt ? humanize(r.startedAt) : '—',
    r.costUsd != null ? `$${(r.costUsd ?? 0).toFixed(4)}` : '—',
    (r.summary ?? '').slice(0, 50),
  ]);
  printTable(header, data);
}

function printTable(header: string[], rows: string[][]) {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const pad = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ');
  console.log(pad(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(pad(row));
}

function humanize(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

/**
 * Single-line interactive prompt. Uses `readline.question` so a normal
 * Enter terminates the line; the previous implementation waited for
 * stdin `end`, which only fires on EOF (Ctrl-D) and made `flow schedule
 * delete <name>` hang forever.
 */
function readLine(prompt = ''): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
