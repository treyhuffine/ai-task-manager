import { describe, expect, it } from 'vitest';
import { parseConnectorScopes } from './scopes';

describe('parseConnectorScopes', () => {
  it('rejects non-array payloads', () => {
    expect(parseConnectorScopes(null)).toBeNull();
    expect(parseConnectorScopes(undefined)).toBeNull();
    expect(parseConnectorScopes({})).toBeNull();
    expect(parseConnectorScopes('gmail')).toBeNull();
  });

  it('rejects entries without a string toolkitId', () => {
    expect(parseConnectorScopes([{ account: { accountId: 'a' } }])).toBeNull();
    expect(parseConnectorScopes([{ toolkitId: 42 }])).toBeNull();
    expect(parseConnectorScopes([{ toolkitId: '' }])).toBeNull();
    expect(parseConnectorScopes([null])).toBeNull();
  });

  it('keeps a bare toolkit scope (all accounts)', () => {
    expect(parseConnectorScopes([{ toolkitId: 'gmail' }])).toEqual([{ toolkitId: 'gmail' }]);
  });

  it('keeps an account pin with accountId only', () => {
    expect(parseConnectorScopes([{ toolkitId: 'gmail', account: { accountId: 'me@x.com' } }])).toEqual([
      { toolkitId: 'gmail', account: { accountId: 'me@x.com' } },
    ]);
  });

  it('keeps an account pin with accountId + authConfigId', () => {
    expect(
      parseConnectorScopes([{ toolkitId: 'gmail', account: { accountId: 'me@x.com', authConfigId: 'cfg_1' } }]),
    ).toEqual([{ toolkitId: 'gmail', account: { accountId: 'me@x.com', authConfigId: 'cfg_1' } }]);
  });

  it('drops a malformed account (treats as all accounts) rather than failing', () => {
    expect(parseConnectorScopes([{ toolkitId: 'gmail', account: { authConfigId: 'cfg_1' } }])).toEqual([
      { toolkitId: 'gmail' },
    ]);
    expect(parseConnectorScopes([{ toolkitId: 'gmail', account: 'me@x.com' }])).toEqual([{ toolkitId: 'gmail' }]);
    expect(parseConnectorScopes([{ toolkitId: 'gmail', account: { accountId: '' } }])).toEqual([{ toolkitId: 'gmail' }]);
  });

  it('strips unknown fields and a non-string authConfigId', () => {
    expect(
      parseConnectorScopes([{ toolkitId: 'gmail', account: { accountId: 'a', authConfigId: 99 }, extra: 'x' }]),
    ).toEqual([{ toolkitId: 'gmail', account: { accountId: 'a' } }]);
  });
});
