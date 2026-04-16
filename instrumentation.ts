/**
 * Next.js instrumentation hook. Runs once per server start.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

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
}
