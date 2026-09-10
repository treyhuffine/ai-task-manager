/**
 * `<app> tls trust|untrust|status`
 *
 * Explicit browser-certificate trust management for the optional HTTP/2 mode
 * (see docs/optional-http2.md §4). Trust is only ever changed here, never as a
 * side effect of `flow start`. The heavy TLS modules are dynamically imported
 * inside each action so the default CLI boot never initializes them.
 */

import type { Command } from 'commander';
import { intro, outro, log } from '@clack/prompts';
import pc from 'picocolors';
import { APP_NAME } from '@/constants/app';
import { APP_ROOT_ENV, getDevAppRoot } from '@/lib/config/paths';

interface TlsCommandOptions {
  dev?: boolean;
}

function routeDevRoot(opts: TlsCommandOptions): void {
  if (opts.dev && !process.env[APP_ROOT_ENV]) {
    process.env[APP_ROOT_ENV] = getDevAppRoot();
  }
}

/** Symbol + color for a per-target outcome. */
function renderOutcome(outcome: string): string {
  switch (outcome) {
    case 'installed':
    case 'removed':
      return pc.green(outcome);
    case 'already-present':
    case 'not-present':
      return pc.dim(outcome);
    case 'permission-denied':
    case 'missing-tool':
    case 'profile-unavailable':
      return pc.yellow(outcome);
    default:
      return pc.red(outcome);
  }
}

export function registerTlsCommand(program: Command): void {
  const tls = program.command('tls').description('Manage the local HTTPS certificate trust');

  tls
    .command('trust')
    .description('Generate the local CA if needed and install browser/OS trust')
    .option('--dev', 'target the dev data root')
    .action(async (opts: TlsCommandOptions) => {
      routeDevRoot(opts);
      intro(pc.bgCyan(pc.black(` ${APP_NAME} tls trust `)));
      log.info(
        'Installing trust for the local HTTPS certificate. Your OS may prompt for authorization so the browser trusts this local app.',
      );
      const { installTrust } = await import('@/lib/config/tls-trust');
      const summary = await installTrust();

      for (const r of summary.results) {
        const line = `${r.label}: ${renderOutcome(r.outcome)}${r.detail ? pc.dim(` (${r.detail})`) : ''}`;
        if (r.outcome === 'error') log.error(line);
        else log.message(line);
      }

      const incomplete = summary.results.filter((r) =>
        ['permission-denied', 'missing-tool', 'profile-unavailable', 'error', 'unsupported'].includes(
          r.outcome,
        ),
      );
      if (summary.caCertPath) {
        log.info(`CA certificate: ${summary.caCertPath}`);
      }
      if (incomplete.length > 0) {
        log.warn(
          `Some targets need attention. Re-run \`${APP_NAME.toLowerCase()} tls trust\` after resolving them, ` +
            `or import the CA above manually. You can also supply your own cert with --tls-cert/--tls-key.`,
        );
        outro('Trust partially applied');
      } else {
        outro('Trust installed');
      }
    });

  tls
    .command('untrust')
    .description("Remove only this app's own trust entries (keeps supplied certs untouched)")
    .option('--dev', 'target the dev data root')
    .action(async (opts: TlsCommandOptions) => {
      routeDevRoot(opts);
      intro(pc.bgCyan(pc.black(` ${APP_NAME} tls untrust `)));
      const { removeTrust } = await import('@/lib/config/tls-trust');
      const summary = await removeTrust();
      if (summary.results.length === 0) {
        log.info('No owned trust entries recorded. Nothing to remove.');
        outro('Done');
        return;
      }
      for (const r of summary.results) {
        const line = `${r.label}: ${renderOutcome(r.outcome)}${r.detail ? pc.dim(` (${r.detail})`) : ''}`;
        if (r.outcome === 'error') log.error(line);
        else log.message(line);
      }
      log.info('Certificate files were left in place. Delete the tls/ directory to remove them.');
      outro('Trust removed');
    });

  tls
    .command('status')
    .description('Show which trust stores apply here and which are recorded')
    .option('--dev', 'target the dev data root')
    .action(async (opts: TlsCommandOptions) => {
      routeDevRoot(opts);
      intro(pc.bgCyan(pc.black(` ${APP_NAME} tls status `)));
      const { inspectTrust } = await import('@/lib/config/tls-trust');
      const status = inspectTrust();
      log.message(`CA present: ${status.caCertPath ? pc.green('yes') : pc.dim('no')}`);
      if (status.caFingerprintSha256) {
        log.message(pc.dim(`CA SHA-256: ${status.caFingerprintSha256}`));
      }
      log.message(
        `Detected stores: ${status.detected.length ? status.detected.map((d) => d.label).join(', ') : pc.dim('none')}`,
      );
      log.message(
        `Recorded trust: ${status.recorded.length ? status.recorded.join(', ') : pc.dim('none')}`,
      );
      outro('Done');
    });
}
