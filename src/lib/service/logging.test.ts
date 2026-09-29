import { expect, it } from 'vitest';
import { redactServiceLine } from './logging';
it('redacts known credentials, authorization headers and OAuth query values', () => {
  const line = redactServiceLine('Bearer abc.def https://x/?code=private&state=opaque private-secret', ['private-secret']);
  expect(line).not.toContain('abc.def'); expect(line).not.toContain('private'); expect(line).not.toContain('opaque');
});
