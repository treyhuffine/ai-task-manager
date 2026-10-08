import { expect, it } from 'vitest';
import { saveWorkResultSchema, workResultBodySchema, requestAiReviewSchema } from './validation';

it('preserves Markdown whitespace while rejecting an empty result', () => {
  const body = '    indented code\n\n';
  expect(saveWorkResultSchema.parse({ requestId: 'save', body }).body).toBe(body);
  expect(workResultBodySchema.parse(body)).toBe(body);
  expect(workResultBodySchema.safeParse(' \n\t ').success).toBe(false);
});

it('accepts explicit provider defaults to clear an unavailable inherited review variant or effort', () => {
  expect(requestAiReviewSchema.parse({ requestId: 'provider-default', variant: null, effort: null }))
    .toEqual({ requestId: 'provider-default', variant: null, effort: null });
  expect(requestAiReviewSchema.safeParse({ requestId: 'invalid', effort: 'arbitrary' }).success).toBe(false);
});
