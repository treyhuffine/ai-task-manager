import { expect, it } from 'vitest';
import { z } from 'zod';
import { zodStandardSchema } from './http-server';

it('distinguishes bare parameterless registry shapes from strict Team objects', () => {
  expect(zodStandardSchema(z.object({}).strict(), true)['~standard'].jsonSchema.input({ target: 'draft-07' })).toMatchObject({ additionalProperties: false });
  expect(zodStandardSchema({})['~standard'].jsonSchema.input({ target: 'draft-07' })).not.toHaveProperty('additionalProperties');
});
