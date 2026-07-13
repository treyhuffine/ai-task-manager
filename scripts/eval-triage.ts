/**
 * pnpm eval:triage — run the triage planner (constitution + a live model)
 * against the fixture corpus and report per-disposition quality. Manual,
 * never CI: it costs tokens and exercises a real model.
 *
 *   pnpm eval:triage                 # all fixtures
 *   pnpm eval:triage split           # fixtures whose name includes "split"
 *   EVAL_MODEL=openai/gpt-5.4-mini pnpm eval:triage
 *
 * The report tracks the metrics the spec cares about most (§3.14):
 * expected-outcome match rate, FALSE MERGES (the trust killer), invented
 * dates (deadline claims without quoted evidence), and journal share on
 * restraint fixtures.
 */

import { z } from 'zod';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { TRIAGE_FIXTURES, type TriageFixture } from '../src/lib/stream-triage/fixtures/corpus';
import { SWEEP_CONSTITUTION } from '../src/lib/stream-triage/prompt';

const dispositionSchema = z.enum([
  'promote_task', 'promote_note', 'merge_task', 'merge_note',
  'combine_task', 'combine_note', 'journal', 'dismiss', 'incubate',
]);

const planSchema = z.object({
  proposals: z.array(
    z.object({
      disposition: dispositionSchema,
      itemIds: z.array(z.string()).min(1),
      targetId: z.string().optional(),
      title: z.string().optional(),
      hardDeadline: z.string().optional(),
      reminderAt: z.string().optional(),
      evidence: z.string().optional(),
      rationale: z.string(),
    }),
  ),
});

type Plan = z.infer<typeof planSchema>;

function pickModel() {
  const spec = process.env.EVAL_MODEL;
  if (spec) {
    const [provider, ...rest] = spec.split('/');
    const id = rest.join('/');
    if (provider === 'anthropic') return anthropic(id);
    if (provider === 'openai') return openai(id);
    throw new Error(`Unknown EVAL_MODEL provider: ${provider}`);
  }
  if (process.env.ANTHROPIC_API_KEY) return anthropic('claude-sonnet-5');
  if (process.env.OPENAI_API_KEY) return openai(process.env.MODEL_STANDARD || 'gpt-5.4-mini');
  throw new Error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY (e.g. in .env.local) to run the eval.');
}

function fixturePrompt(f: TriageFixture): string {
  const parts: string[] = [];
  parts.push('## Pending captures (triage every one of them)');
  for (const item of f.items) {
    parts.push(`- id=${item.id} media=${item.media ?? 'text'} captured just now:\n"""\n${item.rawText}\n"""`);
  }
  if (f.world?.tasks?.length || f.world?.notes?.length) {
    parts.push('\n## Merge candidates (existing entities — the ONLY valid merge targets)');
    for (const t of f.world?.tasks ?? []) parts.push(`- task id=${t.id}: "${t.title}"${t.body ? ` — ${t.body}` : ''}`);
    for (const n of f.world?.notes ?? []) parts.push(`- note id=${n.id}: "${n.title}" — ${n.body}`);
  }
  parts.push(
    '\nReturn your full decision plan as proposals. Reference captures by their ids. ' +
    'A capture may appear in several proposals when it genuinely contains several things.',
  );
  return parts.join('\n');
}

interface FixtureResult {
  name: string;
  passed: boolean;
  problems: string[];
  falseMerges: number;
  inventedDates: number;
}

function scoreFixture(f: TriageFixture, plan: Plan): FixtureResult {
  const problems: string[] = [];
  let falseMerges = 0;
  let inventedDates = 0;

  // Every expected outcome should be matched by some proposal.
  for (const exp of f.expected) {
    const allowed = Array.isArray(exp.disposition) ? exp.disposition : [exp.disposition];
    const match = plan.proposals.find((p) => {
      const coversItems = exp.itemIds.every((id) => p.itemIds.includes(id));
      const dispositionOk = allowed.includes(p.disposition);
      const targetOk = !exp.targetId || p.targetId === exp.targetId || !p.disposition.startsWith('merge');
      return coversItems && dispositionOk && targetOk;
    });
    if (!match) {
      problems.push(`expected ${allowed.join('|')} for [${exp.itemIds.join(',')}] — not found`);
    }
  }

  // Restraint: forbidden combines.
  if (f.forbidCombine) {
    const combined = plan.proposals.find(
      (p) => p.disposition.startsWith('combine') && p.itemIds.length > 1,
    );
    if (combined) {
      problems.push(`combined [${combined.itemIds.join(',')}] — fixture forbids combining`);
      falseMerges++;
    }
  }

  // False merges: merge/combine proposals nobody asked for.
  const expectedMergeItemIds = new Set(
    f.expected
      .filter((e) => {
        const list = Array.isArray(e.disposition) ? e.disposition : [e.disposition];
        return list.some((d) => d.startsWith('merge') || d.startsWith('combine'));
      })
      .flatMap((e) => e.itemIds),
  );
  for (const p of plan.proposals) {
    if ((p.disposition.startsWith('merge') || p.disposition.startsWith('combine')) &&
        !p.itemIds.some((id) => expectedMergeItemIds.has(id))) {
      problems.push(`unexpected ${p.disposition} for [${p.itemIds.join(',')}]`);
      falseMerges++;
    }
  }

  // Invented dates: any date claim must quote source words that actually
  // appear in the capture.
  for (const p of plan.proposals) {
    if (p.hardDeadline || p.reminderAt) {
      const sourceText = f.items
        .filter((i) => p.itemIds.includes(i.id))
        .map((i) => i.rawText.toLowerCase().replace(/\s+/g, ' '))
        .join(' ');
      const cited = p.evidence?.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!cited || !sourceText.includes(cited)) {
        problems.push(`date claim without cited evidence on [${p.itemIds.join(',')}]`);
        inventedDates++;
      }
    }
  }

  return { name: f.name, passed: problems.length === 0, problems, falseMerges, inventedDates };
}

async function main() {
  const nameFilter = process.argv[2];
  const fixtures = nameFilter
    ? TRIAGE_FIXTURES.filter((f) => f.name.includes(nameFilter))
    : TRIAGE_FIXTURES;
  if (fixtures.length === 0) {
    console.error(`No fixtures match "${nameFilter}".`);
    process.exit(1);
  }

  const model = pickModel();
  console.log(`eval:triage — ${fixtures.length} fixtures\n`);

  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    try {
      const { object } = await generateObject({
        model,
        schema: planSchema,
        system: SWEEP_CONSTITUTION,
        prompt: fixturePrompt(fixture),
        temperature: 0,
      });
      const result = scoreFixture(fixture, object);
      results.push(result);
      const mark = result.passed ? 'PASS' : 'FAIL';
      console.log(`${mark}  ${fixture.name}`);
      if (!result.passed) {
        console.log(`      guards: ${fixture.guards}`);
        for (const p of result.problems) console.log(`      - ${p}`);
      }
    } catch (err) {
      results.push({ name: fixture.name, passed: false, problems: [String(err)], falseMerges: 0, inventedDates: 0 });
      console.log(`ERR   ${fixture.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const falseMerges = results.reduce((n, r) => n + r.falseMerges, 0);
  const inventedDates = results.reduce((n, r) => n + r.inventedDates, 0);
  console.log('\n──────── summary ────────');
  console.log(`fixtures:       ${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%)`);
  console.log(`false merges:   ${falseMerges}  (the trust killer — should be 0)`);
  console.log(`invented dates: ${inventedDates}  (must be 0)`);
  process.exit(passed === results.length && falseMerges === 0 && inventedDates === 0 ? 0 : 1);
}

void main();
