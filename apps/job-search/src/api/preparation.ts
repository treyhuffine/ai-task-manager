import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import { defineAction, type AppInvocation } from '@ri/app-kit/sdk';
import { writeResultSchema } from '@ri/app-kit/data';
import { id, prepItemSchema, prepRequirementSchema, preparationSchema } from '../domain/model.js';
import { app, nowAt } from '../server/state.js';
import { preparationRecord, preparationRow, readPreparation, savePreparation, storeSuggestions, suggestionPrompt, validatePreparationReply } from '../server/preparation.js';
import { authorOf, COMMON_ERRORS, EX, examplePreparation, readScope, WRITE_ERRORS, writeScope } from './common.js';
import { str } from '../server/util.js';

export const getPreparationAction = defineAction({
  name: 'get_preparation',
  description: 'Read interview preparation: role requirements quoted from the saved posting snapshot, the person\'s own examples, questions to ask and notes, and any AI suggestions listed separately with their evidence. When nothing is saved yet, returns a fresh preparation sourced from the latest posting.',
  input: z.object({ opportunityId: id.optional(), interviewId: id.nullable().optional() }).strict(),
  output: preparationSchema,
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{ input: { opportunityId: EX.opportunity, interviewId: EX.interview }, output: examplePreparation }],
  handler: (input, invocation) => {
    let opportunityId = input.opportunityId;
    if (!opportunityId && input.interviewId) opportunityId = str(app().db.prepare('SELECT opportunity_id FROM interviews WHERE id = ?').get(input.interviewId)?.opportunity_id ?? '');
    if (!opportunityId) throw new AppError('invalid_input', 'Name the opportunity or the interview to prepare for');
    return readPreparation(readScope(invocation), { opportunityId, interviewId: input.interviewId ?? null });
  },
});

export const savePreparationAction = defineAction({
  name: 'save_preparation',
  description: 'Save interview preparation with the revision you read. Every save keeps a revision. Requirements cite their posting snapshot, examples and questions are the person\'s own words, and AI suggestions are only marked accepted or dismissed here, never merged into the person\'s facts.',
  input: z.object({
    preparationId: id.nullable().optional(),
    opportunityId: id,
    interviewId: id.nullable().optional(),
    expectedRevision: z.number().int().min(0),
    postingSnapshotId: id.nullable().optional(),
    requirements: z.array(prepRequirementSchema).max(60),
    examples: z.array(prepItemSchema).max(40),
    questions: z.array(prepItemSchema).max(40),
    notes: z.string().max(20000),
    suggestionDecisions: z.array(z.object({ id: z.string().max(64), status: z.enum(['accepted', 'dismissed', 'proposed']) }).strict()).max(30).optional(),
  }).strict(),
  output: writeResultSchema(preparationSchema),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS],
  examples: [{
    input: { opportunityId: EX.opportunity, interviewId: EX.interview, preparationId: EX.preparation, expectedRevision: 2, postingSnapshotId: EX.snapshot, requirements: examplePreparation.requirements, examples: examplePreparation.examples, questions: examplePreparation.questions, notes: examplePreparation.notes },
    output: { status: 'saved', record: examplePreparation },
  }],
  handler: (input, invocation) => {
    const scope = writeScope(invocation);
    return app().store.mutate(invocation, 'save_preparation', input, () => {
      const result = savePreparation(input, authorOf(invocation));
      if (result.status === 'conflict') {
        const current = result.row ? preparationRecord(result.row, scope) : readPreparation(scope, { opportunityId: input.opportunityId, interviewId: input.interviewId ?? null });
        return { status: 'conflict' as const, current, message: 'This preparation was saved from somewhere else while you edited. Your text is kept here. Compare and save again' };
      }
      return { status: 'saved' as const, record: preparationRecord(result.row, scope) };
    });
  },
});

/** The stored result of an earlier attempt with this invocation ID, so a retry never repeats the AI call. */
function priorResult<T>(invocation: AppInvocation, action: string): T | null {
  const row = app().db.prepare('SELECT action, result FROM app_invocations WHERE id = ?').get(invocation.id);
  return row && row.action === action ? (JSON.parse(String(row.result)) as T) : null;
}

const suggestOutput = z.object({ preparation: preparationSchema, outcome: z.enum(['ready', 'unavailable', 'invalid', 'no_evidence']), message: z.string() }).strict();

export const suggestPreparationAction = defineAction({
  name: 'suggest_preparation',
  description: 'Ask Ri\'s bounded AI for preparation suggestions drawn only from the saved posting, the person\'s submitted materials and examples, and permitted correspondence. Each suggestion quotes its sources. Suggestions that cite nothing or introduce employers, numbers or credentials not in the sources are dropped. When AI is unavailable the preparation stays fully usable by hand.',
  input: z.object({ preparationId: id }).strict(),
  output: suggestOutput,
  audience: ['user'], effect: 'app_write', retry: 'idempotent', timeoutMs: 60_000, visibility: 'app', errors: [...WRITE_ERRORS, 'unsupported'],
  examples: [{ input: { preparationId: EX.preparation }, output: { preparation: examplePreparation, outcome: 'unavailable', message: 'Extraction unavailable. Your preparation still works by hand, and Prepare with Ri uses your chat instead.' } }],
  handler: async (input, invocation) => {
    const scope = writeScope(invocation);
    const prior = priorResult<z.infer<typeof suggestOutput>>(invocation, 'suggest_preparation');
    if (prior) return prior;
    const row = preparationRow({ id: input.preparationId });
    if (!row) throw new AppError('not_found', 'Save the preparation first, then ask for suggestions');
    const { sources, prompt, company, role } = suggestionPrompt(row, scope);
    let outcome: z.infer<typeof suggestOutput>['outcome'];
    let message: string;
    let stored: Parameters<typeof storeSuggestions>[1];
    const at = nowAt();
    if (!sources.some((source) => source.source !== 'correspondence')) {
      outcome = 'no_evidence';
      message = 'Add the role description, your own examples or a submitted résumé first. Suggestions only use what you have saved.';
      stored = { state: { status: 'invalid', at, message, rejected: 0 } };
    } else {
      try {
        const reply = z.object({ text: z.string() }).passthrough().parse(await invocation.capability('ai_text', { prompt }));
        const validated = validatePreparationReply(reply.text, sources, { company, role });
        outcome = 'ready';
        message = validated.suggestions.length
          ? `${validated.suggestions.length} suggestion${validated.suggestions.length === 1 ? '' : 's'} from your saved evidence${validated.rejected ? `. ${validated.rejected} more were left out because their sources did not check out` : ''}.`
          : 'No suggestion could be tied to your saved evidence, so none were added.';
        stored = { suggestions: validated.suggestions, state: { status: 'ready', at, message, rejected: validated.rejected } };
      } catch (error) {
        const code = (error as AppError)?.code;
        if (code === 'unsupported' || code === 'forbidden') {
          outcome = 'unavailable';
          message = 'Extraction unavailable. Your preparation still works by hand, and Prepare with Ri uses your chat instead.';
          stored = { state: { status: 'unavailable', at, message, rejected: 0 } };
        } else if (!code) {
          outcome = 'invalid';
          message = 'The AI reply could not be checked against your sources, so nothing was added.';
          stored = { state: { status: 'invalid', at, message, rejected: 0 } };
        } else throw error;
      }
    }
    return app().store.mutate(invocation, 'suggest_preparation', input, () => {
      const updated = storeSuggestions(str(row.id), stored);
      return { preparation: preparationRecord(updated, scope), outcome, message };
    });
  },
});

export const preparationActions = [getPreparationAction, savePreparationAction, suggestPreparationAction];
export { readScope };
