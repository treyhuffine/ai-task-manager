/** Shell syntax in instructions must match the native Windows harness shell. */
export function signedCliCommand(): string {
  return process.platform === 'win32' ? '& $env:RI_SESSION_CLI' : '"${RI_SESSION_CLI:-ri}"';
}
