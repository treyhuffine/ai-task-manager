# Speech release materials

The helper is an optional part of the immutable Ri runtime. The model remains a separate opt-in download. This process prepares reviewable development artifacts and source materials. It does not grant permission to redistribute third-party code. [NOTICES.md](NOTICES.md) records the observed native stack and the remaining publisher decisions.

## Build and inspect on the target machine

Run from the repository root with `uv` available. The build pins Python 3.12.12 and installs hashed binary Python dependencies from `requirements.txt`. `RI_SPEECH_BUILD_PYTHON` may identify an already prepared matching interpreter. The override is version checked but is not a substitute for a release publisher's provenance review.

```sh
pnpm speech:build
.electron-demo/speech-build/venv/bin/python desktop/speech/native_inventory.py release/speech-helper --verify
```

`release/speech-helper/build.json` records Python's build receipt/compiler, dependency versions and wheel tags. `native-inventory.json` records hashes for every regular file and internal symlink, plus all native files, their components, linked dependencies and FFmpeg runtime evidence. `source-catalog.json`, `NOTICES.md`, the pinned requirements and `licenses/` accompany the helper. Source archives are kept outside the executable package.

The collector runs only on the matching macOS/Linux CPU and requires `otool` or `readelf`. It loads the locally built FFmpeg libraries to read exported version/configuration/license values. Use it only for trusted build outputs. Verification of an existing inventory does not run native code. Unknown native files, external non-system references, missing notices and changed files stop verification. In particular, new Linux wheel dependencies require an explicit catalog/notice review rather than a broad allowlist.

## Fetch and assemble exact codec materials

```sh
.electron-demo/speech-build/venv/bin/python desktop/speech/release_materials.py fetch
.electron-demo/speech-build/venv/bin/python desktop/speech/release_materials.py bundle --output release/ri-speech-sources.tar.gz
.electron-demo/speech-build/venv/bin/python desktop/speech/release_materials.py verify-bundle release/ri-speech-sources.tar.gz
```

Use the same override interpreter directly when `RI_SPEECH_BUILD_PYTHON` was supplied for the build. These tools require Python 3.11 or newer. `fetch` caches 22 pinned archives under ignored `.electron-demo/speech-sources/`. Downloads require credential-free HTTPS, exact sizes and SHA-256 hashes. A modified cached archive is rejected, not silently replaced. `--cache` selects an alternative artifact cache. Never place that cache in an application data home.

The source bundle includes:

- The 20 exact vendor source inputs with original archive bytes. `source-catalog.json` records their upstream URLs, versions, sizes and hashes from the pinned vendor recipe.
- The complete PyAV and pyav-ffmpeg source repositories at immutable commits. The vendor tree contains its build scripts, GitHub workflow and all applied patches. PyAV's tree contains the wheel build recipe and selected vendor version.
- All 154 preserved upstream notices, their provenance index, Ri's helper/build/verification scripts, pinned dependency lock and these instructions.
- A machine-readable `materials-manifest.json` binding every bundled path to its size and SHA-256, and a sibling `.sha256` for the archive itself.

Archive members use deterministic order, modes, ownership and timestamps. Identical checked inputs produce identical source-bundle bytes. Archive preparation does not execute upstream source. Verification streams members without extracting them, rejects unsafe/duplicate/non-regular entries and compares the manifest against the locally reviewed catalog, recipes and notices. Replacing a recipe and recomputing the embedded manifest cannot pass against that checkout. Publish from the same reviewed revision and freeze source inputs before constructing the bundle. The output must not already exist. Failed construction never activates a partial final archive.

To examine or rebuild an upstream dependency, start with the complete `vendor-recipe` archive and its `scripts/pkg.py`, `scripts/build-ffmpeg.py`, `.github/workflows/build-ffmpeg.yml` and `patches/`. The original archives are available under `archives/` in the material bundle. PyAV's matching wheel workflow and `scripts/ffmpeg-latest.json` are in the `pyav-recipe` archive. These preserve the upstream build instructions. Ri does not claim to have reproduced every vendor binary bit for bit. Source bundles deliberately contain no installed model, user home or credentials.

This is a **codec/PyAV materials bundle**, not the entire frozen helper's corresponding-source distribution. Python, ONNX Runtime, NumPy, PyInstaller and their static or vendored dependencies require separate review and any additional source/relinking materials that review identifies.

## Final artifact and publisher review

Desktop packaging may prepare an unsigned or signed candidate without approving publication. Signing changes native bytes. After final inner-helper signing, re-collect and verify the helper before generating the outer immutable runtime manifest:

```sh
.electron-demo/speech-build/venv/bin/python desktop/speech/native_inventory.py /path/to/final/server/speech-helper
.electron-demo/speech-build/venv/bin/python desktop/speech/native_inventory.py /path/to/final/server/speech-helper --verify
```

Preserve that inventory with the final helper. Any later modification requires a new inventory, outer manifest and publisher review. The review must address the complete helper, not only the codecs. Copy `publisher-review.example.json` into the publisher's protected release process and complete it with an actual decision, reviewer, date, review evidence reference and HTTPS source publication location. Record the SHA-256 of the exact final `native-inventory.json` and source tarball. Set each requirement to true only after resolving it. The checked-in example intentionally remains pending and cannot pass.

```sh
.electron-demo/speech-build/venv/bin/python desktop/speech/release_materials.py verify-release --helper /path/to/final/server/speech-helper --bundle release/ri-speech-sources.tar.gz --approval /path/to/publisher-review.json
```

This gate checks the actual helper bytes and complete notice inventory, source-material integrity and explicit review binding. It rejects missing/pending review, stale hashes and unresolved requirements. It does not authenticate who authored an arbitrary JSON file. The publisher must protect the review's origin through its release approval/access controls. A Boolean environment variable is insufficient. Passing verification means the supplied artifacts match the supplied reviewed decision, not an automated legal certification.

The publishing transaction must include the verified source tarball and checksum, notices, any additional whole-helper sources/relinking materials required by review, and review evidence beside the binary. The recorded source URL is syntax checked, not fetched or published by this tool. Public source availability and retention are publisher responsibilities. No command here uploads anything.

Unsigned qualification CI may upload source materials, notices and inventory/build reports for review. It must not upload speech-bearing binaries through a broad `release/**` glob or a Boolean distribution flag. Any binary upload or release-envelope publication must first pass the artifact-bound gate for the helper actually included in that artifact.
