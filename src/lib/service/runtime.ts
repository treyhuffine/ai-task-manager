import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getRuntimeBaseDir, getRuntimeInstallDir } from './paths';
import { releaseDirectory, stageRelease, storeDirectory, writeHomeRecord } from './store';

export { getRuntimeInstallDir } from './paths';
export { createRuntimeManifest, verifyRuntime, validateRuntimeLink, type RuntimeManifest, type RuntimeFile } from './runtime-manifest';

const LAUNCHER_HEADER = '#!/bin/sh\n# Ri stable runtime launcher\n';
const COMMAND_HEADER = '#!/bin/sh\n# Ri command launcher\n';

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export function installedRuntime(install = getRuntimeInstallDir()) {
  const active = path.join(/* turbopackIgnore: true */ install, 'active-release');
  if (!fs.existsSync(/* turbopackIgnore: true */ active)) return null;
  const id = fs.readFileSync(/* turbopackIgnore: true */ active, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid active runtime selection');
  const directory = releaseDirectory(id, install);
  return { id, directory, repo: path.join(/* turbopackIgnore: true */ directory, 'server'), node: path.join(/* turbopackIgnore: true */ directory, 'node/bin/node'), launcher: path.join(/* turbopackIgnore: true */ install, 'launch') };
}

/** The Home's launcher, the one program its OS job runs. It never changes
 * between releases (docs/always-on-spec.md section 7.4): it starts the
 * controller of the release the Home points at, starts the next one at once
 * when a controller hands over with exit code 75, and puts the previous
 * release back when a new one exits or hangs twice before it starts work.
 * The controller removes `activation/candidate` just before it starts work. */
export function runtimeLauncherScript(install: string, base: string) {
  return `${LAUNCHER_HEADER}# Format 2. Written by src/lib/service/runtime.ts.
home=${shellQuote(install)}
store=${shellQuote(storeDirectory(base))}
export RI_INSTALL_ROOT=${shellQuote(base)}
launcher_path=$PATH
resolve() {
  release=
  IFS= read -r release < "$home/active-release" || return 1
  case "$release" in ''|*[!a-f0-9]*) return 1;; esac
  [ "\${#release}" -eq 64 ] || return 1
  runtime="$store/$release"
  [ -d "$runtime" ] || runtime="$home/releases/$release"
  [ -x "$runtime/node/bin/node" ]
}
enter() {
  export RI_RUNTIME_REPO="$runtime/server"
  export RI_DESKTOP_REPO="$runtime/server"
  export NEXT_DIST_DIR=.next-desktop
  unset NODE_OPTIONS ELECTRON_RUN_AS_NODE
  PATH="$runtime/node/bin:$launcher_path"; export PATH
  cd "$runtime/server"
}
if [ "\${1:-}" = cli ]; then
  shift
  resolve && enter || exit 1
  exec "$runtime/node/bin/node" dist/cli/index.mjs "$@"
fi
child=
stopping=
stop_child() { stopping=1; if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null; fi; }
trap stop_child TERM INT HUP
tries=0
while :; do
  resolve || exit 1
  candidate=
  if [ -f "$home/activation/candidate" ]; then IFS= read -r candidate < "$home/activation/candidate" || candidate=; fi
  ( enter && RI_SERVICE_LAUNCHER=2 && export RI_SERVICE_LAUNCHER && exec "$runtime/node/bin/node" dist/service/main.cjs ) &
  child=$!
  if [ -n "$candidate" ] && [ "$candidate" = "$release" ]; then
    deadline=$(( $(date +%s) + \${RI_ACTIVATION_DEADLINE_SECONDS:-300} ))
    while kill -0 "$child" 2>/dev/null && [ -f "$home/activation/candidate" ] && [ "$(date +%s)" -lt "$deadline" ]; do sleep 1; done
    if [ -f "$home/activation/candidate" ]; then
      kill -TERM "$child" 2>/dev/null
      # A frozen controller can't run its handler, and waiting on it would leave
      # the Home down for good, so it gets a bounded time to stop.
      waited=0
      while kill -0 "$child" 2>/dev/null && [ "$waited" -lt "\${RI_ACTIVATION_KILL_SECONDS:-30}" ]; do sleep 1; waited=$((waited + 1)); done
      kill -KILL "$child" 2>/dev/null
    fi
  fi
  code=0
  wait "$child" || code=$?
  while kill -0 "$child" 2>/dev/null; do code=0; wait "$child" || code=$?; done
  child=
  [ -n "$stopping" ] && exit "$code"
  if [ -n "$candidate" ] && [ "$candidate" = "$release" ] && [ -f "$home/activation/candidate" ]; then
    tries=$((tries + 1))
    if [ "$tries" -ge 2 ]; then
      previous=
      IFS= read -r previous < "$home/activation/previous" || previous=
      case "$previous" in ''|*[!a-f0-9]*) exit 1;; esac
      [ "\${#previous}" -eq 64 ] || exit 1
      printf '%s\n' "$previous" > "$home/active-release.launcher" || exit 1
      mv -f "$home/active-release.launcher" "$home/active-release" || exit 1
      : > "$home/activation/restore" || exit 1
      rm -f "$home/activation/candidate"
      tries=0
    fi
    continue
  fi
  tries=0
  [ "$code" -eq 75 ] && continue
  exit "$code"
done
`;
}

export function writeRuntimeLauncher(install = getRuntimeInstallDir(), base = getRuntimeBaseDir()) {
  const launcher = path.join(/* turbopackIgnore: true */ install, 'launch');
  if (fs.existsSync(/* turbopackIgnore: true */ launcher) && !fs.readFileSync(/* turbopackIgnore: true */ launcher, 'utf8').startsWith(LAUNCHER_HEADER)) throw new Error('The launcher path belongs to another program');
  const script = runtimeLauncherScript(install, base);
  if (!fs.existsSync(/* turbopackIgnore: true */ launcher) || fs.readFileSync(/* turbopackIgnore: true */ launcher, 'utf8') !== script) atomicWriteFile(launcher, script);
  fs.chmodSync(/* turbopackIgnore: true */ launcher, 0o700);
  return launcher;
}

/** A bundled runtime is trusted through the signed application distribution.
 * Downloaded runtimes additionally require publisher verification before this
 * step. Staging never replaces an already selected running runtime. */
export function stageRuntime(resources: string) {
  const manifest = stageRelease(resources);
  return adoptRelease(manifest.id, resources);
}

/**
 * Give this Home a release from the store to run, if it has none, and its
 * launcher and record. A Home that already runs a release keeps it: moving to
 * another is an update (docs/always-on-spec.md section 7.4).
 */
export function adoptRelease(id: string, resources = releaseDirectory(id)) {
  const install = getRuntimeInstallDir();
  fs.mkdirSync(/* turbopackIgnore: true */ install, { recursive: true, mode: 0o700 });
  return withFileLock(path.join(/* turbopackIgnore: true */ install, 'stage'), () => {
    const policy = path.join(/* turbopackIgnore: true */ resources, 'release-policy.json');
    const installedPolicy = path.join(/* turbopackIgnore: true */ install, 'release-policy.json');
    if (fs.existsSync(/* turbopackIgnore: true */ policy) && !fs.existsSync(/* turbopackIgnore: true */ installedPolicy)) atomicWriteFile(installedPolicy, fs.readFileSync(/* turbopackIgnore: true */ policy));
    if (!installedRuntime()) atomicWriteFile(path.join(/* turbopackIgnore: true */ install, 'active-release'), `${id}\n`);
    writeRuntimeLauncher(install);
    writeHomeRecord(install);
    return installedRuntime()!;
  });
}

/** Where `ri` goes: a fixed path by convention, as Claude Code's
 * `~/.local/bin/claude` is, so what Ri writes for agents can name it. */
export function commandLauncherPath() {
  return path.join(/* turbopackIgnore: true */ process.env.RI_COMMAND_DIR || path.join(/* turbopackIgnore: true */ os.homedir(), '.local/bin'), 'ri');
}

/** The `ri` command runs the newest release. That CLI hands a command about a
 * Home to the release that Home runs (src/cli/lib/release-delegation.ts). */
export function commandLauncherScript(base = getRuntimeBaseDir()) {
  return `${COMMAND_HEADER}# Written by src/lib/service/runtime.ts. Runs the newest release staged on this computer.
store=${shellQuote(storeDirectory(base))}
release=
IFS= read -r release < "$store/latest" 2>/dev/null || release=
case "$release" in ''|*[!a-f0-9]*) echo "Ri isn't installed on this computer yet." >&2; exit 1;; esac
runtime="$store/$release"
if [ ! -x "$runtime/node/bin/node" ]; then echo "Ri's newest release is missing from $store. Install Ri again." >&2; exit 1; fi
export RI_INSTALL_ROOT=${shellQuote(base)}
export RI_RUNTIME_REPO="$runtime/server"
export RI_DESKTOP_REPO="$runtime/server"
export NEXT_DIST_DIR=.next-desktop
unset NODE_OPTIONS ELECTRON_RUN_AS_NODE
exec "$runtime/node/bin/node" "$runtime/server/dist/cli/index.mjs" "$@"
`;
}

/** Install `ri`, never over a program that isn't Ri's own launcher. */
export function installCommandLauncher(base = getRuntimeBaseDir()) {
  const file = commandLauncherPath();
  if (fs.existsSync(/* turbopackIgnore: true */ file) || isSymbolicLink(file)) {
    const own = !isSymbolicLink(file) && fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8').startsWith(COMMAND_HEADER);
    if (!own) return { file, installed: false as const, reason: `${file} already exists and isn't Ri's launcher. It was left unchanged.` };
  }
  fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true, mode: 0o755 });
  atomicWriteFile(file, commandLauncherScript(base));
  fs.chmodSync(/* turbopackIgnore: true */ file, 0o755);
  return { file, installed: true as const };
}

function isSymbolicLink(file: string) {
  try { return fs.lstatSync(/* turbopackIgnore: true */ file).isSymbolicLink(); } catch { return false; }
}
