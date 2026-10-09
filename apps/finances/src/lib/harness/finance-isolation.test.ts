import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractionSandbox,
  extractionProxy,
  qualifyExtractionBoundary,
  withFinanceExtractionProfile,
  extractionSupport,
} from './finance-isolation';
describe('finance extraction process boundary', () => {
  it('rejects every unqualified engine without calling the harness', async () => {
    for (const harness of [
      'codex',
      'cursor',
      'opencode',
      'antigravity',
    ] as const) {
      await expect(
        withFinanceExtractionProfile(harness, async () => {
          throw new Error('called');
        }),
      ).rejects.toThrow('not qualified');
      expect(extractionSupport[harness]).toBe('Not qualified');
    }
  });
  it.skipIf(process.platform !== 'darwin')(
    'denies unrelated file data, shell execution and direct network at the actual process boundary',
    async () => {
      const work = await fs.mkdtemp(
          path.join(os.tmpdir(), 'ri-finance-profile-test-'),
        ),
        proxy = await extractionProxy();
      try {
        await qualifyExtractionBoundary(
          extractionSandbox(
            await fs.realpath(process.execPath),
            work,
            proxy.port,
          ),
          work,
          proxy.port,
        );
      } finally {
        await proxy.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
    10000,
  );
});
