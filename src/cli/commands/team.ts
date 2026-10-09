/**
 * `<app> team create | setup-link | status` (docs/homes-spec.md §3.1, §9.1).
 *
 * For hosting a team on a server, or any computer, from a terminal:
 *
 *   ri team create --root ~/acme-team --name Acme   marks a new, empty folder as a team
 *   RI_ROOT=~/acme-team ri start --port 4300        starts its server, a team from the first start
 *   RI_ROOT=~/acme-team ri team setup-link          a single-use link that names the team and makes its owner
 *
 * The desktop's Create a team does the same through the installed runtime.
 * A team never starts personal work, and its host's key is never a member.
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { APP_SHORT_ID } from '@/constants/app';
import { getAppRoot, getDbPath } from '@/lib/config/paths';
import { readTeamIntent, writeTeamIntent, TeamIntentError } from '@/lib/home/team-intent';

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

export function registerTeamCommand(program: Command) {
  const team = program.command('team').description('Host a team space: shared tasks and notes, without AI');

  team
    .command('create')
    .description('Mark a new, empty folder as a team space')
    .option('--root <dir>', 'the folder for the team (default: this root)')
    .option('--name <name>', "the team's name, editable later")
    .action((opts: { root?: string; name?: string }) => {
      if (opts.root) {
        const root = path.resolve(opts.root.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
        process.env.RI_ROOT = root;
        for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[key];
      }
      try {
        const intent = writeTeamIntent({ creationId: randomBytes(12).toString('base64url'), name: opts.name });
        const root = getAppRoot();
        console.log(`${pc.bold(intent.name)} is set up as a team in ${root}.`);
        console.log('');
        console.log('Next:');
        console.log(`  ${pc.cyan(`RI_ROOT=${root} ${APP_SHORT_ID} start --port <free port>`)}   start the team's server`);
        console.log(`  ${pc.cyan(`RI_ROOT=${root} ${APP_SHORT_ID} team setup-link`)}           open the link it prints to become the owner`);
      } catch (err) {
        fail(err instanceof TeamIntentError ? err.message : String(err));
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
      const owners = listMembers().filter((member) => member.role === 'owner');
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
      const owners = members.filter((m) => m.role === 'owner').map((m) => `${m.name} (${m.id})`);
      const snapshot = baseUrlSnapshot();
      console.log(`${pc.bold(identity.home.name)} ${pc.dim(identity.home.id)}`);
      console.log(`  hosted on: ${identity.device.name}, ${getAppRoot()}`);
      console.log(`  owner: ${owners.length ? owners.join(', ') : pc.yellow(`none yet (run \`${APP_SHORT_ID} team setup-link\`)`)}`);
      console.log(`  members: ${members.length}`);
      console.log(`  address: ${snapshot.tunnel ?? pc.yellow(`${snapshot.local} (only this computer can reach it)`)}`);
    });
}
