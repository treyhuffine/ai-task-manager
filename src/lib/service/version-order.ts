function parts(version: string) {
  const [core, pre] = version.split('-', 2);
  return { numbers: core.split('.').map(Number), pre };
}

/** Negative when `a` is older. A prerelease comes before its release. */
export function compareVersions(a: string, b: string) {
  const left = parts(a); const right = parts(b);
  for (let i = 0; i < 3; i++) {
    const delta = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (delta) return delta;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}
