/**
 * Art for the orchestrator's avatar, made in the app: soft color fields from a
 * seed. "Make art" rolls a new seed for each look, and the one the user keeps
 * is uploaded as an SVG attachment and becomes the orchestrator's image, so it
 * is drawn like any uploaded picture.
 *
 * Generated here rather than by a model: instant, free, and nothing to wait on
 * mid-conversation. The same seed always draws the same picture, and the
 * output is shapes and gradients only (no script, text or links), which is
 * what makes it safe to store and serve as an image.
 */

/** Pairs that sit well together as a gradient's two ends. */
const GRADIENTS: readonly [string, string][] = [
  ['#ff9a8b', '#ff6a88'],
  ['#fbc2eb', '#a6c1ee'],
  ['#84fab0', '#8fd3f4'],
  ['#f6d365', '#fda085'],
  ['#a18cd1', '#fbc2eb'],
  ['#30cfd0', '#330867'],
  ['#43e97b', '#38f9d7'],
  ['#fa709a', '#fee140'],
  ['#667eea', '#764ba2'],
  ['#ffecd2', '#fcb69f'],
  ['#4facfe', '#00f2fe'],
  ['#0ba360', '#3cba92'],
];

/** Colors for the soft blobs over the gradient. */
const BLOBS = ['#ffffff', '#ffe29f', '#ffa99f', '#a0e7e5', '#b4f8c8', '#fbe7c6', '#c3b1e1', '#5e60ce', '#ff6f91', '#2ec4b6'];

/** mulberry32: small, fast, and the same sequence for the same seed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** A new seed for "Make art". */
export function newArtSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** The picture for `seed`, as a square SVG document. */
export function avatarArtSvg(seed: number): string {
  const next = random(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const [from, to] = pick(GRADIENTS);
  const angle = Math.floor(next() * 360);
  const blobs = Array.from({ length: 3 + Math.floor(next() * 3) }, () => ({
    cx: round(next() * 128),
    cy: round(next() * 128),
    r: round(18 + next() * 38),
    fill: pick(BLOBS),
    opacity: round(0.35 + next() * 0.5),
  }));
  const ring = next() > 0.5;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">',
    '<defs>',
    `<linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`,
    '<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>',
    '</defs>',
    '<rect width="128" height="128" fill="url(#g)"/>',
    '<g filter="url(#b)">',
    ...blobs.map((b) => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="${b.fill}" fill-opacity="${b.opacity}"/>`),
    '</g>',
    ring
      ? `<circle cx="64" cy="64" r="${round(26 + next() * 18)}" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="${round(3 + next() * 5)}"/>`
      : '',
    '</svg>',
  ].join('');
}

/** The picture as a `src`, for previewing before it's kept. */
export function avatarArtDataUrl(seed: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarArtSvg(seed))}`;
}
