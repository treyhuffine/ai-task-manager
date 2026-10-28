/**
 * Where a file added to a skill by hand goes, by the Agent Skills folders
 * (agentskills.io/specification): code an agent runs in `scripts/`, docs it
 * reads in `references/`, and everything else (templates, images, data) in
 * `assets/`. The same folders the builder AI writes to, so a skill reads the
 * same however its files arrived.
 */

const SCRIPT = new Set([
  'py', 'sh', 'bash', 'zsh', 'fish', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'rb', 'pl', 'php',
  'go', 'rs', 'swift', 'ps1', 'lua', 'r', 'jl', 'applescript', 'sql',
]);
const REFERENCE = new Set(['md', 'mdx', 'markdown', 'txt', 'rst', 'adoc', 'pdf']);

/** The largest supporting file a skill takes. Shared by the server's check and the editor's. */
export const SUPPORTING_FILE_MAX_BYTES = 1024 * 1024;

export function supportingPathFor(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const folder = SCRIPT.has(ext) ? 'scripts' : REFERENCE.has(ext) ? 'references' : 'assets';
  return `${folder}/${name}`;
}
