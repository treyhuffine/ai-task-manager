import { validateArtifact } from "./build.js";
import { publicError } from "./contract.js";
try {
  process.stdout.write(
    JSON.stringify({ artifact: validateArtifact(process.argv[2]) }),
  );
} catch (error) {
  process.stdout.write(JSON.stringify({ error: publicError(error) }));
  process.exitCode = 1;
}
