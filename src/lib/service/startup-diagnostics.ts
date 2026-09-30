import { stripVTControlCharacters } from 'node:util';
import type { Http2ProbeResult } from '@/cli/http2-gateway/probe';
import { redactServiceLine } from './logging';

const MAX_ERRORS = 3;
const MAX_LINE = 400;

/** Small, redacted startup summaries for the private recovery window. Never
 * collect response bodies, source excerpts, stack frames or the whole log. */
export class StartupDiagnostics {
  private errors: string[] = [];

  constructor(private readonly secrets: string[] = []) {}

  private clean(line: string): string {
    // Normalize controls before redacting so invisible characters cannot split
    // a known credential and then disappear after the replacement pass.
    const plain = stripVTControlCharacters(line).replace(/[\p{Cc}\p{Cf}]/gu, '');
    const value = redactServiceLine(plain, this.secrets)
      .replace(/([?#&](?:code|token|access_token|refresh_token|client_secret|state|code_verifier|associate)=)[^\s&#]*/gi, '$1[redacted]')
      .replace(/(\b[a-z][a-z\d+.-]{0,31}:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
      .replace(/\b((?:authorization|cookie|set-cookie)["']?\s*[:=]\s*).*/gi, '$1[redacted]')
      .replace(/\b([a-z\d_]*(?:token|secret|password|api_?key)|code_verifier)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[redacted]')
      .trim();
    return value.length > MAX_LINE ? `${value.slice(0, MAX_LINE - 1)}…` : value;
  }

  capture(line: string): void {
    const value = this.clean(line).replace(/^[⨯×✖]\s*/, '');
    if (!value || /^(?:at\s|(?:>|\d+)\s*\|)/.test(value) || /<\/?[a-z!][^>]*>/i.test(value)) return;
    if (!/^(?:(?:\[[^\]]+\]\s*)?(?:[\w.]*Error\b|error\b|Module not found\b|Cannot find module\b|Failed to\b|Unable to\b|Could not\b)|.*\b(?:NODE_MODULE_VERSION|SQLITE_[A-Z_]+)\b)/.test(value)) return;
    this.errors = [...this.errors.filter(error => error !== value), value].slice(-MAX_ERRORS);
  }

  failure(summary: string): Error {
    return new Error([
      this.clean(summary),
      ...this.errors.map(error => `Next.js: ${error}`),
      'Open the service log folder for the full startup log.',
    ].join('\n'));
  }

  readinessFailure(probe: Http2ProbeResult): Error {
    if (probe.negotiatedProtocol === 'h2' && probe.status !== undefined) {
      const source = probe.status === 500 ? 'The local Next.js app' : 'The local endpoint';
      return this.failure(`${source} returned HTTP ${probe.status} from /api/health. HTTPS and HTTP/2 connected successfully.`);
    }
    return this.failure(`HTTP/2 readiness failed: ${probe.detail ?? `negotiated ${probe.negotiatedProtocol ?? 'no protocol'}`}.`);
  }
}
