import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appKitToolchain } from '@ri/app-kit/build';
import { AppError } from "@ri/app-kit/contract";
import type { ValidatedArtifact } from "@ri/app-kit/build";
import { runtimeEnvironment } from "@ri/app-kit/runtime";
const exec = promisify(execFile);
export async function validatePackage(
  packageDir: string,
): Promise<ValidatedArtifact> {
  const worker = appKitToolchain().validationWorker;
  try {
    const { stdout } = await exec(process.execPath, [worker, packageDir], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: runtimeEnvironment(process.execPath, packageDir),
    });
    return (JSON.parse(stdout) as { artifact: ValidatedArtifact }).artifact;
  } catch (error) {
    const output = (error as { stdout?: string }).stdout;
    if (output) {
      const parsed = JSON.parse(output) as {
        error: { code: AppError["code"]; message: string };
      };
      throw new AppError(parsed.error.code, parsed.error.message);
    }
    throw new AppError("app_failed", "The package could not be validated");
  }
}
