import fs from 'node:fs';

export function redactServiceLine(line: string, secrets: string[]) {
  let value = line.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/([?&](?:code|token|access_token|refresh_token|client_secret|state|code_verifier)=)[^\s&#]*/gi, '$1[redacted]');
  for (const secret of secrets) if (secret.length >= 8) value = value.replaceAll(secret, '[credential redacted]');
  return value;
}

/** Keep the open O_APPEND descriptor valid for both launchd and detached
 * launches. Rotation keeps one previous bounded file and never touches data. */
export function rotateServiceLog(file: string, maximum = 10 * 1024 * 1024) {
  if (!fs.existsSync(file) || fs.statSync(file).size <= maximum) return;
  fs.copyFileSync(file, `${file}.previous`);
  fs.chmodSync(`${file}.previous`, 0o600);
  fs.truncateSync(file, 0);
}
