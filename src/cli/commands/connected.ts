/**
 * `ri` on a connected computer (docs/homes-spec.md §3.1, §3.5).
 *
 * The data lives in the home, so nothing starts here and no database opens.
 * `ri` checks that the saved address still answers for this computer's home
 * with this computer's credential, says so plainly either way, and opens the
 * home in the browser. From P2 on it also makes sure the worker is running.
 */

import { log, outro } from '@clack/prompts';
import { APP_SHORT_ID } from '@/constants/app';
import pc from 'picocolors';
import { readConnection, writeConnection } from '@/lib/connection/config';
import { checkHome, HomeRequestError } from '@/lib/connection/home-client';
import { openBrowser } from '../lib/browser';

export async function runConnected(opts: { open: boolean }): Promise<void> {
  const connection = readConnection();
  if (!connection) throw new Error('This computer has no connection to a home.');

  try {
    const home = await checkHome(connection);
    // Keep the names current, so offline messages say where the home runs.
    if (home.name !== connection.homeName || home.host.name !== connection.homeHostName) {
      writeConnection({ ...connection, homeName: home.name, homeHostName: home.host.name });
    }
    log.success(`Connected to ${pc.bold(home.name)} on ${home.host.name}, at ${connection.homeUrl}`);
    if (opts.open) await openBrowser(connection.homeUrl);
    outro(opts.open ? 'Opened your Ri in the browser' : `Open: ${connection.homeUrl}`);
  } catch (err) {
    if (!(err instanceof HomeRequestError)) throw err;
    log.error(err.message);
    log.info(pc.dim(`Saved address: ${connection.homeUrl}. Details: \`${APP_SHORT_ID} status\`.`));
    process.exitCode = 1;
  }
}
