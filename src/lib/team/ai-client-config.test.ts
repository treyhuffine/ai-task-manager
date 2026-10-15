import { describe, expect, it } from 'vitest';
import { aiClientSetup, teamMcpNames } from './ai-client-config';

const input = { teamName: 'Acme Labs', mcpUrl: 'https://acme.example/api/team/mcp', token: 'ri_live_abc123' };

describe('teamMcpNames', () => {
  it('names the server and the key variable after the team, in what shells and clients accept', () => {
    expect(teamMcpNames('Acme Labs')).toEqual({ server: 'ri-acme-labs', tokenVar: 'RI_ACME_LABS_TOKEN' });
    expect(teamMcpNames('Café & Co.')).toEqual({ server: 'ri-cafe-co', tokenVar: 'RI_CAFE_CO_TOKEN' });
    expect(teamMcpNames('  --  ')).toEqual({ server: 'ri-team', tokenVar: 'RI_TEAM_TOKEN' });
    expect(teamMcpNames('x'.repeat(80)).tokenVar).toMatch(/^RI_X{32}_TOKEN$/);
    // Never a credential name Claude Code blanks out, never starting with a digit.
    for (const name of ['Anthropic Api', '42 Crew']) expect(teamMcpNames(name).tokenVar).toMatch(/^RI_[A-Z0-9_]+_TOKEN$/);
  });
});

describe('aiClientSetup', () => {
  it('keeps the key in the profile and out of Claude Code\'s stored command', () => {
    const setup = aiClientSetup('claude_code', input);
    expect(setup.steps.map((s) => s.text)).toEqual([
      "export RI_ACME_LABS_TOKEN='ri_live_abc123'",
      "claude mcp add --transport http --scope user ri-acme-labs 'https://acme.example/api/team/mcp' --header 'Authorization: Bearer ${RI_ACME_LABS_TOKEN}'",
    ]);
    expect(setup.steps[1].text).not.toContain('ri_live_abc123');
  });

  it('points Codex at the variable', () => {
    const setup = aiClientSetup('codex', input);
    expect(setup.steps[1].text).toBe("codex mcp add ri-acme-labs --url 'https://acme.example/api/team/mcp' --bearer-token-env-var RI_ACME_LABS_TOKEN");
    expect(setup.steps[1].text).not.toContain('ri_live_abc123');
  });

  it('gives any other client the server and its header', () => {
    const json = JSON.parse(aiClientSetup('other', input).steps[1].text);
    expect(json).toEqual({ mcpServers: { 'ri-acme-labs': { type: 'http', url: input.mcpUrl, headers: { Authorization: 'Bearer ${RI_ACME_LABS_TOKEN}' } } } });
  });

  it('quotes a key safely for the shell', () => {
    expect(aiClientSetup('codex', { ...input, token: "a'b" }).steps[0].text).toBe("export RI_ACME_LABS_TOKEN='a'\\''b'");
  });
});

it('gives a personal Home its own instructions and names', () => {
  const setup = aiClientSetup('codex', { homeName: 'Home', mcpUrl: 'https://home.example/api/orchestrator/mcp', token: 'fictional' });
  expect(setup.steps[0].text).toBe("export RI_HOME_TOKEN='fictional'");
  expect(setup.steps[1].text).toBe("codex mcp add ri-home --url 'https://home.example/api/orchestrator/mcp' --bearer-token-env-var RI_HOME_TOKEN");
  expect(setup.steps[1].label).toContain('your Home');
  expect(setup.steps[1].text).not.toContain('fictional');
});
