/**
 * `flow browser` commands: the operational surface for the agent browser.
 *
 *   open <url>   open a headed window so you can sign into a site (alias: login)
 *   profiles     list the logged-in profiles the agent can use
 *   import       macOS: import a site's cookies from Chrome/Brave
 *   status       what is running, the configured browser, profiles, activity
 *   doctor       readiness checks
 *   stop         the kill switch: close the agent browser
 *
 * The agent-facing verbs (browser_read, browser_act) are orchestrator actions,
 * reachable as `flow agent browser_read ...`. These commands are for the human.
 *
 * A profile is a separate logged-in identity (its own cookie jar). Omit
 * --profile to use the configured default (initially "agent").
 */

import type { Command } from 'commander';
import pc from 'picocolors';
import { runAction } from '@/lib/orchestrator/dispatch';
import { runBrowserDoctor } from '@/lib/browser/doctor';

function printEnvelope(label: string, env: { ok: boolean; result?: unknown; error?: { message: string; suggestion?: string } }) {
  if (env.ok) {
    console.log(pc.green('✓') + ` ${label}`);
    if (env.result !== undefined) console.log(pc.dim(JSON.stringify(env.result, null, 2)));
    return;
  }
  console.log(pc.red('✗') + ` ${label}: ${env.error?.message ?? 'failed'}`);
  if (env.error?.suggestion) console.log(pc.dim(env.error.suggestion));
  process.exitCode = 1;
}

export function registerBrowserCommands(program: Command): void {
  const browser = program.command('browser').description('Control the agent browser');

  browser
    .command('open [url]')
    .alias('login')
    .description('Open a headed window so you can sign into a site (persists to the profile)')
    .option('--profile <name>', 'profile to open (default: the configured default)')
    .action(async (url: string | undefined, opts: { profile?: string }) => {
      const env = await runAction('browser_open', { url, headless: false, profile: opts.profile }, { remote: false });
      const profile = (env.result as { profile?: string })?.profile ?? opts.profile ?? 'default';
      printEnvelope(`Opened agent browser (profile: ${profile})`, env);
      if (env.ok) {
        console.log(
          pc.dim(
            url
              ? `Sign in at ${url} in the window that opened. The session is saved to the "${profile}" profile.`
              : `Navigate and sign in. The session is saved to the "${profile}" profile.`,
          ),
        );
      }
    });

  browser
    .command('profiles')
    .description('List the profiles (logged-in identities) the agent can use')
    .action(async () => {
      const env = await runAction('browser_profiles', {}, { remote: false });
      printEnvelope('Browser profiles', env);
    });

  browser
    .command('import <domain>')
    .description('macOS: import cookies for a site from your Chrome/Brave so the agent is signed in')
    .option('--source <source>', 'source browser: chrome or brave', 'chrome')
    .option('--chrome-profile <name>', 'source browser profile to read from', 'Default')
    .option('--profile <name>', 'target agent profile to import into (default: the configured default)')
    .action(async (domain: string, opts: { source: string; chromeProfile: string; profile?: string }) => {
      const env = await runAction(
        'browser_import_cookies',
        { domain, source: opts.source, chrome_profile: opts.chromeProfile, profile: opts.profile },
        { remote: false },
      );
      printEnvelope(`Imported cookies for ${domain}`, env);
    });

  browser
    .command('status')
    .description('Show whether the agent browser is running, the configured browser, profiles, and activity')
    .option('--profile <name>', 'profile to check (default: the configured default)')
    .action(async (opts: { profile?: string }) => {
      const env = await runAction('browser_status', { profile: opts.profile }, { remote: false });
      printEnvelope('Browser status', env);
    });

  browser
    .command('doctor')
    .description('Run agent browser readiness checks')
    .action(async () => {
      const checks = await runBrowserDoctor();
      for (const c of checks) {
        const icon = c.ok ? pc.green('✓') : pc.red('✗');
        console.log(`${icon} ${c.name}${c.detail ? pc.dim(`: ${c.detail}`) : ''}`);
      }
      process.exit(checks.every((c) => c.ok) ? 0 : 1);
    });

  browser
    .command('stop')
    .description('Close the agent browser (the kill switch)')
    .option('--profile <name>', 'profile to close (default: the configured default)')
    .action(async (opts: { profile?: string }) => {
      const env = await runAction('browser_close', { profile: opts.profile }, { remote: false });
      printEnvelope('Stopped agent browser', env);
    });
}
