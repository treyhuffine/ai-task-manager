/** One checkout and command for building the included apps and running a trial. */
import path from "node:path";
import { getDevAppRoot } from "../src/lib/config/paths";
import { stageLocalApps, runCommand } from "./local-apps-stage";

async function main() {
  let home = `${getDevAppRoot()}-apps`, port = "42251";
  for (let index = 2; index < process.argv.length; index++) {
    const option = process.argv[index], value = process.argv[++index];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === "--home") home = path.resolve(value);
    else if (option === "--port" && /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536) port = value;
    else throw new Error(`Unsupported option ${option}`);
  }
  // Fail on an occupied or unsafe Home before spending time building packages.
  await runCommand("pnpm", ["iso", home, "--port", port, "--check"]);
  await stageLocalApps();
  await runCommand("pnpm", ["iso", home, "--init", "--port", port, "--",
    "env", "RI_LOCAL_APPS=1", `NEXT_DIST_DIR=.next-apps-${port}`, "pnpm", "dev", "--port", port]);
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
