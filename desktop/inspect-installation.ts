/** Read-only ordinary Node entry. Never import the application's DB opener. */
import { inspectExistingInstallation } from './installation-inspection';
void inspectExistingInstallation().then(result => process.stdout.write(JSON.stringify(result)), error => {
  process.stderr.write(error instanceof Error ? error.message : 'Could not inspect this installation.'); process.exitCode = 1;
});
