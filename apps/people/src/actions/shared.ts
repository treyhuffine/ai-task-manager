import { z } from 'zod/v4';
import type { ActionDefinition, AppInvocation } from '@ri/app-kit/sdk';
import { coverageSchema } from '../schemas.js';

type Descriptor = Pick<ActionDefinition, 'name' | 'description' | 'audience' | 'effect' | 'retry' | 'timeoutMs' | 'errors' | 'visibility'>;
/**
 * A typed action: input and output types come only from the schemas, so
 * examples are checked against them instead of widening them.
 */
export function action<S extends z.ZodType, R extends z.ZodType>(definition: Descriptor & {
  input: S;
  output: R;
  examples: { input: z.input<S>; output: z.output<R> }[];
  handler(input: z.output<S>, invocation: AppInvocation): z.output<R> | Promise<z.output<R>>;
}): ActionDefinition<z.output<S>, z.output<R>> {
  return definition as unknown as ActionDefinition<z.output<S>, z.output<R>>;
}

export const listInput = {
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
};
export const listOutput = <T extends z.ZodType, E extends z.ZodRawShape = {}>(item: T, extra?: E) =>
  z.object({ items: z.array(item).max(100), nextCursor: z.string().max(2048).nullable(), coverage: coverageSchema, revision: z.string().max(80), ...(extra ?? {}) as E }).strict();

export const READ_ERRORS = ['invalid_input', 'not_found', 'forbidden', 'revoked'] as ('invalid_input' | 'not_found' | 'forbidden' | 'revoked' | 'conflict' | 'unsupported' | 'busy' | 'timeout')[];
export const WRITE_ERRORS = ['invalid_input', 'not_found', 'forbidden', 'revoked', 'conflict'] as typeof READ_ERRORS;
export const SYNC_ERRORS = ['invalid_input', 'forbidden', 'revoked', 'busy', 'timeout', 'unsupported'] as typeof READ_ERRORS;
export const RESOURCE = 'ui://ri-people/main.html' as const;
