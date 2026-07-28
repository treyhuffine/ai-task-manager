import { describe, expect, it } from 'vitest';
import { classifyError } from './cli';

/** Shape a failed `beamd` run the way `run()` reports it. */
function failed(stderr: string) {
  return { stdout: '', stderr, exitCode: 1 };
}

describe('classifyError', () => {
  it('maps a name collision to beamd_name_taken and names the host', () => {
    // Verbatim wording from a second machine opening the default name.
    const err = classifyError(
      failed('open failed: 502 Bad Gateway: name_taken: flow-trey.beamd.run is taken'),
    );
    expect(err.code).toBe('beamd_name_taken');
    expect(err.message).toContain('flow-trey.beamd.run');
  });

  it('still classifies a collision when no hostname is in the message', () => {
    const err = classifyError(failed('open failed: name_taken'));
    expect(err.code).toBe('beamd_name_taken');
    expect(err.message).toMatch(/already in use/i);
  });

  it('keeps the existing mappings intact', () => {
    expect(classifyError(failed('not logged in')).code).toBe('beamd_not_connected');
    expect(classifyError(failed('401 unauthorized')).code).toBe('beamd_unauthorized');
    expect(classifyError(failed('max_tunnels reached')).code).toBe('beamd_tunnel_cap');
    expect(classifyError(failed('unsupported config version')).code).toBe('beamd_cli_outdated');
    expect(classifyError(failed('something else went wrong')).code).toBe('beamd_error');
  });
});
