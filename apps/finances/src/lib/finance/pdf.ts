/** Untrusted invoice parsing receives selected bytes in an isolated area, no Home or credentials. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractionSandbox } from '@/lib/harness/finance-isolation';
const exec = promisify(execFile);
export async function financePdfText(bytes: Buffer) {
  if (process.platform !== 'darwin')
    throw new Error('PDF parser isolation is not qualified for this platform');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Invoice too large');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-pdf-')),
    work = await fs.realpath(root);
  try {
    const command =
        process.env.FINANCE_PDFTOTEXT_COMMAND ??
        '/opt/homebrew/bin/pdftotext',
      installed = await fs.realpath(command),
      binary = path.join(work, 'pdftotext'),
      input = path.join(work, 'invoice.pdf'),
      profilePath = path.join(work, 'parse.sb');
    await fs.writeFile(input, bytes, { mode: 0o600 });
    // Resolve Homebrew's loader-relative reference in a disposable copy. The
    // sandbox keeps a narrow executable allowlist instead of allowing all maps.
    await fs.copyFile(installed, binary);
    await fs.chmod(binary, 0o700);
    const dependencies = (
      await exec('/usr/bin/otool', ['-L', installed], {
        timeout: 5000,
        maxBuffer: 16000,
      })
    ).stdout;
    for (const match of dependencies.matchAll(/\s(@rpath\/[^\s]+)/g)) {
      const library = await fs.realpath(
        path.join(path.dirname(installed), '../lib', path.basename(match[1])),
      );
      await exec(
        '/usr/bin/install_name_tool',
        ['-change', match[1], library, binary],
        { timeout: 5000, maxBuffer: 4000 },
      );
    }
    await exec('/usr/bin/codesign', ['--force', '--sign', '-', binary], {
      timeout: 5000,
      maxBuffer: 4000,
    });
    const profile = extractionSandbox(binary, work, 1)
      .replace(
        '(allow file-map-executable',
        '(allow file-map-executable (subpath "/opt/homebrew/Cellar") (subpath "/opt/homebrew/opt")',
      )
      .replace(/\(allow network-outbound[^\n]+/, '')
      .replace(
        '(allow file-read* file-test-existence',
        '(allow file-read* file-test-existence (subpath "/opt/homebrew/Cellar") (subpath "/opt/homebrew/opt")',
      );
    await fs.writeFile(profilePath, profile, { mode: 0o600 });
    return (
      await exec(
        '/usr/bin/sandbox-exec',
        ['-f', profilePath, binary, '-layout', input, '-'],
        {
          cwd: work,
          env: { PATH: '/usr/bin:/bin', TMPDIR: work, NODE_ENV: 'production' },
          timeout: 10000,
          maxBuffer: 128000,
        },
      )
    ).stdout.slice(0, 24000);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
