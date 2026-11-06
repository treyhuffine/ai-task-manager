import { describe, expect, it } from 'vitest';
import { usesBrowserProfile } from './profile-processes';

const executable = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const profile = '/Users/example/Ri home/.config/browser/profiles/agent';

describe('browser profile process ownership', () => {
  it.each([
    `${executable} --user-data-dir=${profile} https://example.com`,
    `${executable} --user-data-dir="${profile}" --no-first-run`,
    `"${executable}" "--user-data-dir=${profile}"`,
    `${executable} --user-data-dir '${profile}'`,
  ])('recognizes the exact profile even without debugging enabled: %s', command => {
    expect(usesBrowserProfile(command, executable, profile)).toBe(true);
  });

  it.each([
    `${executable} --user-data-dir=${profile}-other`,
    `${executable} --user-data-dir=${profile}/child`,
    `${executable} --user-data-dir=/another/home/agent`,
    `${executable} --type=renderer --user-data-dir=${profile}`,
    `${executable} Helper --user-data-dir=${profile}`,
    `node script.js ${executable} --user-data-dir=${profile}`,
    `${executable} https://example.com/?profile=--user-data-dir=${profile}`,
  ])('excludes other processes and profiles: %s', command => {
    expect(usesBrowserProfile(command, executable, profile)).toBe(false);
  });
});
