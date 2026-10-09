/**
 * One contender in claim-race.test.ts, in its own process: open the team's
 * database, say it's ready, and make its claim when the test says go.
 *
 *   tsx claim-race.child.ts owner <creationId> <name>
 *   tsx claim-race.child.ts setup <secret> <name>
 *   tsx claim-race.child.ts invite <secret> <name>
 */

import readline from 'node:readline';
import { createTeamOwner, isTeamError, listMembers, redeemTeamInvite, redeemTeamSetup } from '@/lib/db/queries';

const [action, value, name] = process.argv.slice(2);
const device = { name: `${name}'s computer`, kind: 'computer' as const };

function claim() {
  if (action === 'owner') return createTeamOwner({ creationId: value, name, device });
  if (action === 'setup') return redeemTeamSetup({ secret: value, teamName: `${name}'s team`, ownerName: name, device });
  if (action === 'invite') return redeemTeamInvite({ secret: value, name, device });
  throw new Error(`Unknown claim: ${action}`);
}

listMembers();
const lines = readline.createInterface({ input: process.stdin });
process.stdout.write('ready\n');
lines.once('line', () => {
  let result: object;
  try {
    const made = claim();
    result = { ok: true, memberId: made.member.id, role: made.member.role };
  } catch (error) {
    result = { ok: false, code: isTeamError(error) ? error.code : String(error) };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  lines.close();
  process.exit(0);
});
