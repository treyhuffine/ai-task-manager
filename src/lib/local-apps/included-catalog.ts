/** Build-time selection only. Catalog reads never build or run app code. */
import { catalogArtifact } from './catalog';

const financeTarget = { platform: 'darwin', arch: 'arm64', nodeVersion: '26.5.0', nodeAbi: '147' };

export function includedAppIds(compatibleOnly: boolean, runtime = {
  platform: String(process.platform), arch: String(process.arch),
  nodeVersion: process.versions.node, nodeAbi: process.versions.modules,
}) {
  const finance = !compatibleOnly || Object.entries(financeTarget).every(
    ([key, value]) => runtime[key as keyof typeof runtime] === value,
  );
  return finance ? ['ri-finance', 'ri-tracker'] : ['ri-tracker'];
}

/** A metadata file alone is insufficient: verify the reviewed archive too. */
export async function hasIncludedArtifact(packageId: string, root: string) {
  try {
    await catalogArtifact(packageId, root);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') throw error;
    return false;
  }
}
