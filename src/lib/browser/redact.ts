/**
 * Conservative secret redaction for model-facing browser output.
 *
 * The raw value still reaches the page (typing a token into a field is a real
 * action). We only mask recognizable credential formats in what we hand back to
 * the model, the audit log, and the on-disk spill. Patterns are deliberately
 * specific so normal article prose is never corrupted.
 */

const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: 'openai-key' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, label: 'anthropic-key' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/g, label: 'github-token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, label: 'github-pat' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: 'slack-token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'aws-key-id' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, label: 'bearer-token' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'jwt' },
];

/** Mask known credential formats. Returns the redacted text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, label } of PATTERNS) {
    out = out.replace(re, `[redacted:${label}]`);
  }
  return out;
}
