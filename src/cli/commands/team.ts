import { hasTeamCapability } from '@/lib/team/capabilities';
/**
 * `<app> team create | setup-link | status` (docs/homes-spec.md §3.1, §9.1).
 *
 * For hosting a team on a server, or any computer, from a terminal:
 *
 *   ri team create --root ~/acme-team
 *
 * Declares the team, starts its background service and opens owner setup.
 * Retrying resumes the same folder. --no-start only provisions the folder,
 * and --no-open prints the setup link without opening a local browser.
 *
 * The desktop's Create a team does the same through the installed runtime.
 * A team never starts personal work, and its host's key is never a member.
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { Command, Option } from 'commander';
import { randomBytes } from 'node:crypto';
import { confirm, isCancel } from '@clack/prompts';
import { APP_SHORT_ID } from '@/constants/app';
import { getAppRoot, getDbPath } from '@/lib/config/paths';
import { readTeamIntent, writeTeamIntent, TeamIntentError } from '@/lib/home/team-intent';
import { startBackgroundService } from './service';
import { openBrowser } from '../lib/browser';

/** Resolve the explicit target before CLI environment and activity hooks run. */
export function selectTeamRoot(root?: string): void {
  if (!root) return;
  process.env.RI_ROOT = path.resolve(root.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
  for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[key];
}

/** Trust installation is optional. Its failure must not hide the setup link. */
async function offerLocalCertificateTrust(trustLocal: boolean): Promise<void> {
  try {
    const { inspectTrust, installTrust } = await import('@/lib/config/tls-trust');
    const trust = inspectTrust();
    const recorded = trust.caCertPath && trust.detected.length > 0
      && trust.detected.every(({ target }) => trust.recorded.includes(target));
    if (trustLocal || !recorded) {
      const answer = trustLocal || (process.stdin.isTTY && await confirm({
        message: "Trust this team's local HTTPS certificate? Choose No to skip. Your OS may ask for an administrator password.",
        initialValue: true,
      }));
      if (!answer || isCancel(answer)) {
        console.log('Local certificate trust was skipped.');
      } else {
        const result = await installTrust();
        const incomplete = result.results.filter(({ outcome }) => outcome !== 'installed' && outcome !== 'already-present');
        for (const entry of incomplete) console.error(`${entry.label}: ${entry.detail || entry.outcome}`);
        if (result.results.length > 0 && incomplete.length === 0) return;
        console.log('Local certificate trust did not finish for every browser.');
      }
    } else return;
  } catch (err) {
    console.error(`Could not install local certificate trust: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log('Continuing in your browser. It may show a certificate warning for this local address. You can retry certificate trust later with this same command.');
}

async function openTeam(link: string, trustLocal: boolean): Promise<void> {
  const { isLoopbackTeamAddress } = await import('@/lib/team/address');
  if (new URL(link).protocol === 'https:' && isLoopbackTeamAddress(link)) await offerLocalCertificateTrust(trustLocal);
  await openBrowser(link);
}

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

export function registerTeamCommand(program: Command) {
  const team = program.command('team').description('Host a team space: shared tasks and notes, without AI');

  team
    .command('create')
    .description('Create a team, start it in the background and open setup')
    .option('--root <dir>', 'the folder for the team (default: this root)')
    // Keep existing scripts working. People name the team in browser setup.
    .addOption(new Option('--name <name>', 'prefill the team name during setup').hideHelp())
    .addHelpText('after', '\nName your team and become its owner in the browser that opens.')
    .option('--no-start', 'only prepare the team folder, without starting its service')
    .option('--no-open', 'print the setup link without opening a browser or changing certificate trust')
    .option('--trust-local', 'allow installation of this team’s local HTTPS certificate trust')
    .action(async (opts: { root?: string; name?: string; start: boolean; open: boolean; trustLocal?: boolean }) => {
      selectTeamRoot(opts.root);
      try {
        const intent = readTeamIntent() ?? writeTeamIntent({ creationId: randomBytes(12).toString('base64url'), name: opts.name });
        const root = getAppRoot();
        if (!opts.start) {
          console.log(`${pc.bold(intent.name)} is prepared in ${root}. Run this command without --no-start to finish setup.`);
          return;
        }
        console.log(`Starting ${pc.bold(intent.name)} in the background…`);
        const service = await startBackgroundService();
        if (!service.origin) throw new Error("The team's service has no address. Check its service logs and retry this command.");
        // The service owns schema changes. Attaching to an older running
        // service must not let this CLI migrate its database underneath it.
        const { allowMigrations } = await import('@/lib/db/migrate');
        allowMigrations(false);
        const { ensureHomeIdentity } = await import('@/lib/home/identity');
        const identity = ensureHomeIdentity();
        if (identity.home.kind !== 'team') throw new TeamIntentError('This folder holds a personal Ri, not a team.');
        const { teamHasOwner } = await import('@/lib/db/queries');
        const hasOwner = teamHasOwner();
        const link = hasOwner
          ? (await (await import('@/lib/team/address')).teamLinkAddress()).base
          : (await (await import('@/lib/team/admission')).createSetupLink()).link;
        console.log(`${pc.bold(identity.home.name)} is running at ${service.origin}\nData: ${root}`);
        console.log('You can close this terminal. The team keeps running.');
        console.log('');
        console.log(hasOwner ? 'Open your team:' : 'Open this single-use link yourself to become the owner:');
        console.log(`  ${link}`);
        if (opts.open) await openTeam(link, opts.trustLocal === true);
      } catch (err) {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });

  team
    .command('setup-link')
    .description("A single-use link that names this team and makes whoever opens it its owner")
    .action(async () => {
      if (!readTeamIntent() && !fs.existsSync(getDbPath())) fail(`This folder isn't a team. Run \`${APP_SHORT_ID} team create\` first.`);
      const { ensureHomeIdentity } = await import('@/lib/home/identity');
      const identity = ensureHomeIdentity();
      if (identity.home.kind !== 'team') fail('This folder holds a personal Ri, not a team.');
      const { teamHasOwner } = await import('@/lib/db/queries');
      if (teamHasOwner()) fail(`${identity.home.name} already has an owner. They invite people from the team's Settings.`);
      const { createSetupLink } = await import('@/lib/team/admission');
      const { link, expiresAt } = await createSetupLink();
      console.log(`Open this link to name the team and become its owner. It works once, until ${new Date(expiresAt).toLocaleString()}:`);
      console.log('');
      console.log(`  ${link}`);
      console.log('');
      console.log(pc.dim('Anyone with it can claim the team, so open it yourself.'));
    });

  team
    .command('owner-sign-in')
    .description('Recover access to an existing owner from the computer hosting this team')
    .option('--member <id>', 'the owner to recover, required when there is more than one')
    .action(async (opts: { member?: string }) => {
      const { ensureHomeIdentity } = await import('@/lib/home/identity');
      if (ensureHomeIdentity().home.kind !== 'team') fail('This folder holds a personal Ri, not a team.');
      const { listMembers, createTeamGrant } = await import('@/lib/db/queries');
      const owners = listMembers().filter((member) => hasTeamCapability(member, 'administerMembers'));
      const owner = opts.member ? owners.find((member) => member.id === opts.member) : owners.length === 1 ? owners[0] : null;
      if (!owner) fail('Choose an active owner with --member <id>. Run team status to inspect the team.');
      const { grant, secret } = createTeamGrant({ kind: 'sign_in', memberId: owner.id, createdByMemberId: null });
      const { teamLinkAddress } = await import('@/lib/team/address');
      const { teamLink } = await import('@/lib/team/links');
      const { base } = await teamLinkAddress();
      console.log(`Sign in as ${owner.name}. This link works once, until ${new Date(grant.expiresAt).toLocaleString()}:`);
      console.log(teamLink(base, 'sign-in', secret));
    });

  team
    .command('status')
    .description('This team: its name, owner and address')
    .action(async () => {
      const { ensureHomeIdentity } = await import('@/lib/home/identity');
      const identity = ensureHomeIdentity();
      if (identity.home.kind !== 'team') fail('This folder holds a personal Ri, not a team.');
      const { listMembers } = await import('@/lib/db/queries');
      const { baseUrlSnapshot } = await import('@/lib/auth/base-url-snapshot');
      const members = listMembers();
      const owners = members.filter((m) => hasTeamCapability(m, 'administerMembers')).map((m) => `${m.name} (${m.id})`);
      const snapshot = baseUrlSnapshot();
      console.log(`${pc.bold(identity.home.name)} ${pc.dim(identity.home.id)}`);
      console.log(`  hosted on: ${identity.device.name}, ${getAppRoot()}`);
      console.log(`  owner: ${owners.length ? owners.join(', ') : pc.yellow(`none yet (run \`${APP_SHORT_ID} team setup-link\`)`)}`);
      console.log(`  members: ${members.length}`);
      console.log(`  address: ${snapshot.tunnel ?? pc.yellow(`${snapshot.local} (only this computer can reach it)`)}`);
    });
}
