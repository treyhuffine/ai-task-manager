export const DESKTOP_NODE_VERSION = '26.5.0';

/** Check before loading packaging tools, creating output, or building native
 * dependencies. The build Node ABI must match the portable runtime we ship.
 * @param {{ platform?: NodeJS.Platform, arch?: string, nodeVersion?: string }} runtime
 */
export function assertDesktopPackagingRuntime({ platform = process.platform, arch = process.arch, nodeVersion = process.versions.node } = {}) {
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    throw new Error('Build on the matching macOS/Linux arm64/x64 host.');
  }
  if (nodeVersion !== DESKTOP_NODE_VERSION) {
    throw new Error(`Build with pinned Node ${DESKTOP_NODE_VERSION} so native modules match the shipped runtime. Current Node: ${nodeVersion}. Run nvm install and nvm use, then pnpm install --frozen-lockfile before packaging.`);
  }
}
