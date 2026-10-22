import { execFile } from 'node:child_process';

/**
 * Whether `codesign -dv` describes an Apple-issued signature: one with a Team ID. macOS presents
 * notifications only from such an app. Ad-hoc and self-signed builds (no Team ID) are refused
 * without a prompt and never appear in System Settings, whatever their bundle identifier.
 */
export function hasAppleSignature(codesignDescription: string): boolean {
  const team = /^TeamIdentifier=(.*)$/m.exec(codesignDescription)?.[1]?.trim();
  return !!team && team !== 'not set';
}

/** Read the running app bundle's signature. Any failure to read it counts as unsigned. */
export function appleSigned(bundle: string, run: typeof execFile = execFile): Promise<boolean> {
  return new Promise(resolve => {
    run('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { timeout: 10_000 }, (error, stdout, stderr) => {
      resolve(!error && hasAppleSignature(`${stdout}\n${stderr}`));
    });
  });
}
