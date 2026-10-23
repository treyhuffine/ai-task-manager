import { Command } from 'commander';
import { vi } from 'vitest';

/** Real registration, parsing and dispatch. Only process output/exit is captured. */
export async function callAgentCli(args: string[]) {
  const { registerAgentCommand } = await import('@/cli/commands/agent');
  const out: string[] = [], err: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(value => { out.push(String(value)); return true; });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(value => { err.push(String(value)); return true; });
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('CLI exit'); }) as never);
  try {
    const command = registerAgentCommand(new Command().exitOverride());
    await command.parent!.parseAsync(['agent', ...args], { from: 'user' }).catch(error => {
      if (!(error instanceof Error) || error.message !== 'CLI exit') throw error;
    });
  } finally { stdout.mockRestore(); stderr.mockRestore(); exit.mockRestore(); }
  return { out: out.join(''), err: err.join('') };
}
