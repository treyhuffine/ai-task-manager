/**
 * Next.js instrumentation hook. Runs once per server start.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Run before any db / config access so the first read finds data in the
  // new location. No-op on fresh installs or when path overrides are set.
  const { migrateLegacyLayoutToBrain } = await import('@/lib/config/paths');
  const migration = migrateLegacyLayoutToBrain();
  if (migration.migrated) {
    console.log(`[paths] migrated legacy layout → brain/ (${migration.moved.join(', ')})`);
  }

  const { ensureLocalToken, buildPairingUrl, getLocalBaseUrl } = await import('@/lib/auth/bootstrap');

  try {
    const info = ensureLocalToken();
    const baseUrl = getLocalBaseUrl();

    if (info.created) {
      console.log('\n[auth] First-time pairing');
      console.log(`[auth] Pairing URL: ${info.pairingUrl}`);
      console.log('[auth] Run `pnpm auth:pair` to reprint this URL.\n');
    } else {
      console.log(`[auth] ready at ${baseUrl} — run \`pnpm auth:pair\` for the pairing URL`);
      // Also print once on startup for convenience.
      console.log(`[auth] pairing URL: ${buildPairingUrl(info.plaintext, baseUrl)}`);
    }
  } catch (err) {
    console.error('[auth] failed to initialize local token:', err);
  }

  // Start the DB-to-markdown mirror: live export on every write + periodic
  // reconcile. Non-blocking; failures here don't stop the app.
  try {
    const { initMirror } = await import('@/lib/export/mirror');
    await initMirror();
  } catch (err) {
    console.warn('[mirror] init failed', err);
  }
}
