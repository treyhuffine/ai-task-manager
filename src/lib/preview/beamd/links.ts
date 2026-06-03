/**
 * Canonical Beamd links, surfaced in the in-app onboarding sheet. Beamd is the
 * open-source tunnel that powers remote preview; its GitHub repo is the project
 * home today (a hosted site isn't public yet).
 */
export const BEAMD_LINKS = {
  /** Open-source repo / project home. */
  repo: 'https://github.com/dynamismlabs/beamd',
  /** "Consuming Beamd" doc — how a client app drives it. */
  docs: 'https://github.com/dynamismlabs/beamd/blob/main/docs/consuming-beamd.md',
} as const;
