/**
 * `<app> connect [link]` and `<app> disconnect`.
 *
 * Connect this computer to your existing Ri (docs/homes-spec.md §3.1). The
 * link is the pairing link from your home's Devices settings, the same one
 * its QR code opens for a phone. Without a link argument it is asked for with
 * hidden input, so the key stays out of your shell history. A connected
 * computer keeps no data of its own: it opens your home, runs `ri` commands
 * against it, and keeps only its own agent folders' setups.
 */

import { confirm, isCancel, log, outro, password } from '@clack/prompts';
import pc from 'picocolors';
import { Command } from 'commander';
import { APP_SHORT_ID } from '@/constants/app';
import { getInstallationRole } from '@/lib/config/role';
import {
  readConnection,
  rememberComputerId,
  rememberedComputerId,
  removeConnection,
  writeConnection,
} from '@/lib/connection/config';
import { ConnectError, parsePairingLink, saveConnection, verifyPairingLink } from '@/lib/connection/connect';
import { thisComputerFacts } from '@/lib/home/computer-name';
import { describeHomeUse, setAsideUnusedHome } from '@/lib/home/set-aside';
import { readLiveServerRuntime } from '@/lib/server-runtime/record';
import { openBrowser } from '../lib/browser';
import { dispatchAction } from '../lib/dispatch';

export interface ConnectOptions {
  insecureHttp?: boolean;
  open?: boolean;
  yes?: boolean;
}

async function askForLink(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const value = await password({
    message: "Paste the pairing link from your Ri's Settings, Devices (hidden)",
    mask: '•',
  });
  return isCancel(value) ? null : String(value);
}

/**
 * Connect, register this computer with the home, and open it. Returns false
 * when it didn't connect. Nothing on this computer changes until the home
 * has accepted the link: a bad link leaves everything as it was.
 */
export async function runConnect(linkArg: string | undefined, opts: ConnectOptions): Promise<boolean> {
  const role = getInstallationRole();
  if (role === 'connected') {
    const current = readConnection();
    log.error(`This computer is already connected to ${current?.homeName} at ${current?.homeUrl}. Run \`${APP_SHORT_ID} disconnect\` first to connect it elsewhere.`);
    return false;
  }
  if (role === 'home') {
    if (readLiveServerRuntime()) {
      log.error('Ri is running from this folder. Stop it first (Ctrl-C where it runs), then connect.');
      return false;
    }
    if (!describeHomeUse().unused) {
      log.error(
        'This folder is a home with data in it, so it stays a home. To use your other Ri here, ' +
          'move what you need into that one, then connect from a new folder, or ask for a guided move.',
      );
      return false;
    }
  }

  const raw = linkArg ?? (await askForLink());
  if (!raw) {
    log.error(`Pass the pairing link: \`${APP_SHORT_ID} connect '<link>'\`, or run it in a terminal to paste it.`);
    return false;
  }
  let link: ReturnType<typeof parsePairingLink>;
  let home: Awaited<ReturnType<typeof verifyPairingLink>>;
  try {
    link = parsePairingLink(raw);
    home = await verifyPairingLink(link, { allowInsecureHttp: opts.insecureHttp });
  } catch (err) {
    if (err instanceof ConnectError) {
      log.error(err.message);
      return false;
    }
    throw err;
  }

  if (role === 'home') {
    let yes = opts.yes === true;
    if (!yes && process.stdin.isTTY) {
      const answer = await confirm({
        message: `This folder has a new, empty Ri home. Set it aside (nothing is deleted) and connect to ${home.name} instead?`,
      });
      yes = answer === true;
    }
    if (!yes) {
      log.info('Nothing changed.');
      return false;
    }
    log.info(pc.dim(`Set aside in ${setAsideUnusedHome()}`));
  }

  const connection = saveConnection(link, home);
  const registered = await dispatchAction('register_computer', {
    ...thisComputerFacts(),
    computerId: rememberedComputerId(home.id),
  });
  if (registered.ok) {
    const computerId = (registered.result as { computer: { id: string } }).computer.id;
    writeConnection({ ...connection, computerId });
    rememberComputerId(home.id, computerId);
  }
  log.success(`Connected to ${pc.bold(home.name)} on ${home.host.name}, at ${connection.homeUrl}`);
  log.info(
    pc.dim(
      `Your data stays in ${home.name}. Its computer, ${home.host.name}, needs to be awake and reachable for this computer and your phone to use it.`,
    ),
  );
  if (opts.open ?? true) await openBrowser(connection.homeUrl);
  return true;
}

export function registerConnectCommands(program: Command) {
  program
    .command('connect [link]')
    .description('Connect this computer to your existing Ri, with a pairing link from its Devices settings')
    .option('--insecure-http', 'allow a plain http:// address on a home network you trust')
    .option('--no-open', "don't open your Ri in the browser")
    .option('-y, --yes', 'set aside an unused new home in this folder without asking')
    .action(async (link: string | undefined, opts: ConnectOptions) => {
      const ok = await runConnect(link, opts);
      if (!ok) process.exitCode = 1;
      else outro('Connected');
    });

  program
    .command('disconnect')
    .description('Disconnect this computer from your Ri. Your data stays there.')
    .action(() => {
      const connection = readConnection();
      if (getInstallationRole() !== 'connected' || !connection) {
        console.error('This computer is not connected to a home.');
        process.exitCode = 1;
        return;
      }
      removeConnection();
      console.log(`Disconnected from ${connection.homeName} (${connection.homeUrl}). Your data stays there.`);
      console.log(pc.dim("This computer's agent folders keep their setup files, ready if it connects again."));
    });
}
