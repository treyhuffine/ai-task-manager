import type { StreamEvent } from '@agentex/agent';
import OpenAI from 'openai';
import { z } from 'zod';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const CLASSIFY_BATCH_SIZE = 100;
const SORT_BATCH_SIZE = 60;
const TIMEOUT_SECONDS = 600;

const PROVIDER_MODELS: Record<string, string> = {
  claude: 'claude-sonnet-4-20250514',
  codex: 'gpt-5.4',
};

export type Tier = 'high' | 'medium' | 'low';
export type Energy = 'deep' | 'light';

export interface TriageEntry {
  tier: Tier;
  energy: Energy;
  position: number;
}

export type TriageOutput = Record<string, TriageEntry>;

export interface TriageOptions<T> {
  items: T[];
  idOf: (t: T) => string;
  compress: (t: T) => string;
  /** Sort tiebreaker for the low tier (sorted by date or whatever the caller wants). */
  sortLowTier?: (ids: string[]) => string[];
  userContext?: string;
  providerType?: string;
  verbose?: boolean;
  onLog?: (msg: string) => void;
}

let providerInitialized = false;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function callOpenAI(prompt: string): Promise<{ content: string; meta: string }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  const content = response.choices[0]?.message?.content || '';
  const tokens =
    (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);
  return { content, meta: `${tokens} tokens` };
}

async function callProvider(
  type: string,
  prompt: string,
  verbose: boolean,
): Promise<{ content: string; meta: string }> {
  const { getProvider } = await import('@agentex/agent');
  const provider = getProvider(type);

  if (!providerInitialized && provider.listModels) {
    try {
      const models = await provider.listModels();
      console.log(`  Available models: ${models.map((m: { id: string }) => m.id).join(', ')}`);
    } catch {
      // Non-fatal
    }
    providerInitialized = true;
  }

  const model = PROVIDER_MODELS[type] || undefined;
  let assistantText = '';
  let resultText = '';

  const result = await provider.execute({
    prompt,
    model,
    cwd: process.cwd(),
    config: {
      skipPermissions: true,
      maxTurns: 1,
      timeoutSec: TIMEOUT_SECONDS,
    },
    onOutput: (stream: string, chunk: string) => {
      if (verbose) process.stderr.write(`[${stream}] ${chunk}`);
    },
    onEvent: (event: StreamEvent) => {
      if (event.type === 'assistant') assistantText += event.text || '';
      else if (event.type === 'result') resultText = event.text || '';
      if (verbose) {
        if (event.type === 'system') console.error(`  [event:system] ${event.subtype} model=${event.model}`);
        else if (event.type === 'tool_call') console.error(`  [event:tool] ${event.name}`);
        else if (event.type === 'result') console.error(`  [event:result] isError=${event.isError} cost=${event.cost}`);
      }
    },
  });

  if (result.errorMessage) throw new Error(result.errorMessage);

  const content = result.summary || resultText || assistantText;
  const cost = result.costUsd ? `$${result.costUsd.toFixed(4)}` : '';
  return { content, meta: cost };
}

async function callLLM(
  prompt: string,
  providerType: string | undefined,
  verbose: boolean,
): Promise<{ content: string; meta: string }> {
  if (providerType) return callProvider(providerType, prompt, verbose);
  return callOpenAI(prompt);
}

const ClassifySchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      tier: z.enum(['high', 'medium', 'low']),
      energy: z.enum(['deep', 'light']),
    }),
  ),
});

const SortSchema = z.object({
  sorted: z.array(z.string()),
});

async function classifyBatch<T>(
  batch: T[],
  opts: TriageOptions<T>,
  log: (msg: string) => void,
): Promise<Map<string, { tier: Tier; energy: Energy }>> {
  const taskLines = batch.map((t) => opts.compress(t)).join('\n');
  const userContext = opts.userContext;

  const prompt = `You are classifying tasks for a solo founder/engineer. Today is ${new Date().toISOString().split('T')[0]}.
${userContext ? `\n## About the User\n${userContext}\n` : ''}
Classify each task into a **tier** and **energy level**.

## Tiers
- **high**: Important, time-sensitive, or directly tied to active projects and revenue. Things that would meaningfully move the needle if done soon. Be selective — roughly 10-15% of tasks.
- **medium**: Useful, somewhat important, but not urgent. Would be good to get to. ~30-40%.
- **low**: Vague ideas, stale items, aspirational, low-value, or "maybe someday." Most imported tasks are low. ~50-60%.

## Energy
- **deep**: Requires sustained focus, problem-solving, creative work, writing code, architecture
- **light**: Quick actions, admin, communications, simple lookups, routine tasks

## Guidelines
- Be aggressive about classifying things as low. Most imported tasks are stale brain-dumps.
- Old tasks (created months/years ago) with no deadline are almost always low.
- Tasks mentioning the user's active products lean toward high/medium.
- Vague ideas and research topics → low.

## Tasks
${taskLines}

Return JSON: {"tasks": [{"id": "id", "tier": "high|medium|low", "energy": "deep|light"}, ...]}
You MUST return exactly ${batch.length} entries.`;

  const out = new Map<string, { tier: Tier; energy: Energy }>();
  try {
    const { content, meta } = await callLLM(prompt, opts.providerType, opts.verbose ?? false);
    const raw = JSON.parse(content);
    const parsed = ClassifySchema.safeParse(raw);
    if (parsed.success) {
      for (const entry of parsed.data.tasks) {
        out.set(entry.id, { tier: entry.tier, energy: entry.energy });
      }
      const dist = { high: 0, medium: 0, low: 0 };
      for (const e of parsed.data.tasks) dist[e.tier]++;
      log(`done (${meta}) high:${dist.high} med:${dist.medium} low:${dist.low}`);
    } else {
      log(`PARSE ERROR: ${parsed.error.issues[0]?.message}`);
    }
  } catch (err) {
    log(`FAILED: ${err}`);
  }
  return out;
}

async function sortBatch<T>(
  ids: string[],
  itemMap: Map<string, T>,
  opts: TriageOptions<T>,
  log: (msg: string) => void,
): Promise<string[]> {
  const taskLines = ids
    .map((id) => {
      const t = itemMap.get(id);
      if (!t) return `id:${id} | (unknown)`;
      return opts.compress(t);
    })
    .join('\n');

  const userContext = opts.userContext;
  const prompt = `You are sorting ${ids.length} tasks by priority for a solo founder/engineer. Today is ${new Date().toISOString().split('T')[0]}.
${userContext ? `\n## About the User\n${userContext}\n` : ''}
Sort these tasks from **most important** to **least important**. Consider:
- Deadlines and time sensitivity
- Revenue impact and business value
- Alignment with the user's active projects and stated priorities
- Dependencies — what unblocks other work
- Freshness — recently created/updated tasks signal active relevance
- Quick wins that clear mental overhead

## Tasks
${taskLines}

Return JSON: {"sorted": ["id1", "id2", ...]} in priority order, highest first.
You MUST return exactly ${ids.length} IDs.`;

  try {
    const { content, meta } = await callLLM(prompt, opts.providerType, opts.verbose ?? false);
    const raw = JSON.parse(content);
    const parsed = SortSchema.safeParse(raw);

    if (parsed.success && parsed.data.sorted.length === ids.length) {
      log(`done (${meta})`);
      return parsed.data.sorted;
    }

    if (parsed.success) {
      const returned = new Set(parsed.data.sorted);
      const missing = ids.filter((id) => !returned.has(id));
      log(`partial (${parsed.data.sorted.length}/${ids.length}), appending ${missing.length} missing`);
      return [...parsed.data.sorted, ...missing];
    }

    log(`parse error, keeping input order`);
  } catch (err) {
    log(`failed: ${err}, keeping input order`);
  }

  return ids;
}

async function sortTier<T>(
  ids: string[],
  itemMap: Map<string, T>,
  opts: TriageOptions<T>,
  log: (msg: string) => void,
): Promise<string[]> {
  if (ids.length <= 1) return ids;
  if (ids.length <= SORT_BATCH_SIZE) return sortBatch(ids, itemMap, opts, log);

  const chunks = chunk(ids, SORT_BATCH_SIZE);
  const sorted: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`  Chunk ${i + 1}/${chunks.length}... `);
    const result = await sortBatch(chunks[i], itemMap, opts, log);
    sorted.push(...result);
  }
  return sorted;
}

/**
 * Run the full triage pipeline (classify → sort high → sort medium → sort low)
 * against an arbitrary task shape. Returns position-keyed entries.
 */
export async function triage<T>(opts: TriageOptions<T>): Promise<TriageOutput> {
  const log = opts.onLog ?? ((m: string) => console.log(m));
  const itemMap = new Map(opts.items.map((t) => [opts.idOf(t), t]));
  const allIds = opts.items.map(opts.idOf);

  // Phase 1: Classify
  console.log('--- Phase 1: Classify tiers + energy ---');
  const tiers = new Map<string, { tier: Tier; energy: Energy }>();
  const batches = chunk(opts.items, CLASSIFY_BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`  Batch ${i + 1}/${batches.length} (${batches[i].length} tasks)... `);
    const result = await classifyBatch(batches[i], opts, log);
    for (const [k, v] of result) tiers.set(k, v);
  }

  const high: string[] = [];
  const medium: string[] = [];
  const low: string[] = [];
  for (const id of allIds) {
    const entry = tiers.get(id);
    if (!entry || entry.tier === 'low') low.push(id);
    else if (entry.tier === 'high') high.push(id);
    else medium.push(id);
  }
  console.log(`\nTier totals: high:${high.length}  medium:${medium.length}  low:${low.length}`);

  // Phase 2: Sort high
  console.log(`\n--- Phase 2: Sort high tier (${high.length} tasks) ---`);
  const sortedHigh = await sortTier(high, itemMap, opts, log);

  // Phase 2b: Sort medium
  console.log(`\n--- Phase 2b: Sort medium tier (${medium.length} tasks) ---`);
  const sortedMedium = await sortTier(medium, itemMap, opts, log);

  // Phase 3: Sort low (caller-provided tiebreaker, defaults to input order)
  console.log(`\n--- Phase 3: Sort low tier (${low.length} tasks) ---`);
  const sortedLow = opts.sortLowTier ? opts.sortLowTier(low) : low;

  const finalOrder = [...sortedHigh, ...sortedMedium, ...sortedLow];

  const output: TriageOutput = {};
  for (let i = 0; i < finalOrder.length; i++) {
    const id = finalOrder[i];
    const tierInfo = tiers.get(id);
    output[id] = {
      tier: tierInfo?.tier || 'low',
      energy: tierInfo?.energy || 'light',
      position: i + 1,
    };
  }
  return output;
}
