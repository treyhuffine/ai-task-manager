import { describe, expect, it } from 'vitest';
import { createRedactor } from '@connectors/engine';
import { registerMcpSecrets } from './mcp-secrets';

describe('MCP credential redaction', () => {
  it('scrubs reflected Basic authorization as well as raw OAuth secrets', () => {
    const redactor = createRedactor();
    const clientId = 'registered-client';
    const clientSecret = 'confidential-sécret';
    const basic = btoa(`${clientId}:${clientSecret}`);
    registerMcpSecrets(redactor, {
      clientInformation: { client_id: clientId, client_secret: clientSecret },
      tokens: { access_token: 'account-access', refresh_token: 'account-refresh', token_type: 'bearer' },
      codeVerifier: 'private-pkce-verifier',
    });
    expect(redactor.redact({ error: `Basic ${basic} ${clientSecret}`, tokens: ['account-access', 'account-refresh', 'private-pkce-verifier'] })).toEqual({
      error: 'Basic [redacted:client_credentials] [redacted:client_secret]',
      tokens: ['[redacted:access_token]', '[redacted:refresh_token]', '[redacted:pkce_verifier]'],
    });
  });

  it('accepts public-client and empty discovery state without hiding public IDs', () => {
    const redactor = createRedactor();
    registerMcpSecrets(redactor, {});
    registerMcpSecrets(redactor, { clientInformation: { client_id: 'public-client' } });
    expect(redactor.redact('public-client')).toBe('public-client');
  });
});
