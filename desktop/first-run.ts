import type { Page } from 'playwright-core';

/**
 * Where a new installation lands: there's no setup wizard any more, so a
 * fresh Home opens straight on the dashboard, and first-run setup is a
 * conversation in its main chat (docs/main-chat-onboarding.md). Waiting for
 * the rail rather than the chat's greeting keeps this independent of
 * whether a harness is installed on the machine running the smoke.
 */
export async function waitForHome(page: Page, timeout = 240_000): Promise<void> {
  await page.waitForURL((url) => url.protocol === 'https:' && url.pathname === '/', { timeout });
  await page.locator('aside:visible').first().waitFor({ timeout: 60_000 });
}
