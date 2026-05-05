import fs from 'fs';
import path from 'path';

const envPath = path.resolve(__dirname, '../../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

import { eq } from 'drizzle-orm';
import { ensureTmpDir, getAppRoot } from '../../src/lib/config/paths';
import { getDb } from '../../src/lib/db';
import { areas, tasks } from '../../src/lib/db/schema';
import { triage, type TriageOutput } from '../../src/lib/triage/llm';

const OUTPUT_PATH = path.join(ensureTmpDir(), 'retriage.json');
const CONTEXT_PATH = path.join(getAppRoot(), 'triage-context.md');

const args = process.argv.slice(2);
const providerFlag = args.includes('--provider');
const providerType = providerFlag ? args[args.indexOf('--provider') + 1] || 'claude' : null;
const verbose = args.includes('--verbose');

interface DbTask {
  id: string;
  title: string;
  description: string | null;
  energy: 'deep' | 'light' | null;
  hard_deadline: string | null;
  created_at: string;
  updated_at: string;
  area_id: string | null;
  area_name: string | null;
  current_sort_key: string | null;
}

function loadUserContext(): string {
  if (!fs.existsSync(CONTEXT_PATH)) return '';
  return fs.readFileSync(CONTEXT_PATH, 'utf-8').trim();
}

function compressDbTask(t: DbTask): string {
  const parts = [`id:${t.id}`, `"${t.title}"`];
  if (t.area_name) parts.push(`area:${t.area_name}`);
  if (t.hard_deadline) parts.push(`due:${t.hard_deadline}`);
  if (t.description) parts.push(`desc:"${t.description.slice(0, 80)}"`);
  parts.push(`created:${t.created_at}`);
  parts.push(`updated:${t.updated_at}`);
  if (t.energy) parts.push(`energy:${t.energy}`);
  return parts.join(' | ');
}

async function main() {
  if (!providerType && !process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set. Add it to .env.local');
    process.exit(1);
  }

  const db = getDb();

  const rows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      energy: tasks.energy,
      hard_deadline: tasks.hard_deadline,
      created_at: tasks.created_at,
      updated_at: tasks.updated_at,
      area_id: tasks.area_id,
      area_name: areas.name,
      current_sort_key: tasks.sort_key,
      status: tasks.status,
    })
    .from(tasks)
    .leftJoin(areas, eq(tasks.area_id, areas.id))
    .all();

  const activeTasks: DbTask[] = rows.filter((r) => r.status === 'active');
  const taskMap = new Map(activeTasks.map((t) => [t.id, t]));

  if (activeTasks.length === 0) {
    console.log('No active tasks to triage.');
    process.exit(0);
  }

  const userContext = loadUserContext();
  if (userContext) console.log(`Loaded user context from ${path.relative(process.cwd(), CONTEXT_PATH)}`);

  console.log(`\nRe-triaging ${activeTasks.length} active tasks with ${providerType || 'gpt-5.4-mini'}\n`);

  const output: TriageOutput = await triage<DbTask>({
    items: activeTasks,
    idOf: (t) => t.id,
    compress: compressDbTask,
    sortLowTier: (ids) =>
      ids.sort((a, b) => {
        const ta = taskMap.get(a);
        const tb = taskMap.get(b);
        const dueA = ta?.hard_deadline ? new Date(ta.hard_deadline).getTime() : Infinity;
        const dueB = tb?.hard_deadline ? new Date(tb.hard_deadline).getTime() : Infinity;
        if (dueA !== dueB) return dueA - dueB;
        const createdA = ta?.created_at ? new Date(ta.created_at).getTime() : Infinity;
        const createdB = tb?.created_at ? new Date(tb.created_at).getTime() : Infinity;
        return createdA - createdB;
      }),
    userContext,
    providerType: providerType || undefined,
    verbose,
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  const finalOrder = Object.entries(output)
    .sort((a, b) => a[1].position - b[1].position)
    .map(([id]) => id);
  console.log(`\nWrote ${finalOrder.length} results to ${OUTPUT_PATH}`);

  console.log('\nTop 20:');
  for (let i = 0; i < Math.min(20, finalOrder.length); i++) {
    const id = finalOrder[i];
    const task = taskMap.get(id);
    const title = task ? task.title.slice(0, 70) : id;
    const entry = output[id];
    console.log(`  ${String(i + 1).padStart(3)}. [${entry.tier}/${entry.energy}] ${title}`);
  }

  const tierCounts = { high: 0, medium: 0, low: 0 };
  const energyCounts = { deep: 0, light: 0 };
  for (const entry of Object.values(output)) {
    tierCounts[entry.tier]++;
    energyCounts[entry.energy]++;
  }
  console.log(`\nTiers: high:${tierCounts.high}  medium:${tierCounts.medium}  low:${tierCounts.low}`);
  console.log(`Energy: deep:${energyCounts.deep}  light:${energyCounts.light}`);
  console.log(`\nReview ${path.relative(process.cwd(), OUTPUT_PATH)}, then run \`pnpm db:retriage:apply\` to write sort_keys.`);
}

main().catch((err) => {
  console.error('Re-triage failed:', err);
  process.exit(1);
});
