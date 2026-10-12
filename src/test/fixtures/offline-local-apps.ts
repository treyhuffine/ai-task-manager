/**
 * Host lifecycle tests compile and run the actual generated app. Resolve its
 * SDK and UI dependencies from this checkout instead of testing npm's uptime.
 * This mock is opt-in per suite, and leaves artifact validation/export intact.
 */
import {vi} from 'vitest';

vi.mock('@ri/app-kit/build', async (original) => {
  const actual = await original<typeof import('@ri/app-kit/build')>();
  const fixtures = await import('@ri/app-kit/testing');
  return {
    ...actual,
    createAppTemplate: fixtures.createOfflineAppTemplate,
    buildPackage: fixtures.buildOfflineAppFixture,
  };
});
