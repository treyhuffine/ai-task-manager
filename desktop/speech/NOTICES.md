# Optional local speech

The runtime preserves the existing Parakeet v3 INT8 ONNX model family. CPU inference uses at most four threads. The package contains Python, ONNX ASR, ONNX Runtime, NumPy, and PyAV with FFmpeg libraries. The frozen build copies distribution-provided Python metadata and license files. PyInstaller's copied `COPYING.txt` contains its bootloader exception. The native-library inventory below is separate from the Python package metadata.

Model data is optional and downloaded only after explicit installation. It is not bundled in the application. Ri pins revision `8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce` from [istupakov/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx). The original [NVIDIA Parakeet TDT 0.6B v3 model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) describes the model and its CC BY 4.0 license. Conversion: Ilya Stupakov. The optional download totals 670,619,803 bytes and each file is verified against an application-controlled SHA-256 manifest.

Upstream projects and notices:

- [ONNX ASR](https://github.com/istupakov/onnx-asr), MIT
- [ONNX Runtime](https://github.com/microsoft/onnxruntime), MIT
- [NumPy](https://numpy.org/doc/stable/license.html), BSD
- [PyAV](https://github.com/PyAV-Org/PyAV), BSD
- [FFmpeg](https://ffmpeg.org/legal.html), see the wheel's bundled licenses for its LGPL/GPL configuration
- [Python](https://docs.python.org/3/license.html), PSF
- [PyInstaller](https://pyinstaller.org/en/stable/license.html), GPL with bootloader exception

Release qualification must verify the exact PyAV/FFmpeg wheel notices and redistribution obligations on every target. macOS helper binaries must be signed with the application and included in its notarization submission. Ad-hoc local builds are development artifacts.

## Inspected macOS arm64 artifact

The 2026-09-26 development helper was inspected directly under `release/speech-helper`. This snapshot describes that artifact, not future wheels or untested Linux builds. Its metadata records Python 3.12.12, ONNX ASR 0.12.0, ONNX Runtime 1.30.0, PyAV 18.1.0 and NumPy 2.4.3. The PyAV wheel tag is `cp311-abi3-macosx_14_0_arm64`.

Calling each frozen FFmpeg library's exported `*_version()`, `*_license()` and `*_configuration()` functions with `ctypes` produced:

| Library | Version |
| --- | --- |
| FFmpeg, from `av_version_info()` | 8.1.2 |
| avcodec | 62.28.102 |
| avformat | 62.12.102 |
| avutil | 60.26.102 |
| avfilter | 11.14.102 |
| avdevice | 62.3.102 |
| swresample | 6.3.102 |
| swscale | 9.5.102 |

All seven return the license string `LGPL version 3 or later`. Their configuration includes `--enable-version3`, `--enable-libx264` and `--enable-libx265`. Neither `--enable-gpl` nor `--enable-nonfree` is present. `otool -L` confirms that the frozen avcodec library links to the included x264 and x265 libraries. These are observations of the binaries, not a determination of the combined distribution's license.

Other included native libraries report libopus 1.6.1, libvpx 1.16.0, LAME 3.100, dav1d 1.5.3, SVT-AV1 4.1.0, x265 `4.2+1-e444744`, and libwebp 1.6.0 through their exported version functions. x264's installed library has ABI 165. OpenCORE AMR narrowband/wideband, WebP mux and SharpYUV libraries are also present. The OpenCORE source version and x264 source commit below come from the matching build recipe, not an exported runtime version function.

## Wheel source provenance

[PyAV v18.1.0's release workflow](https://github.com/PyAV-Org/PyAV/blob/v18.1.0/.github/workflows/tests.yml) fetches the vendor archive selected by [its checked-in FFmpeg configuration](https://github.com/PyAV-Org/PyAV/blob/v18.1.0/scripts/ffmpeg-latest.json): [pyav-ffmpeg 8.1.2-1](https://github.com/PyAV-Org/pyav-ffmpeg/releases/tag/8.1.2-1). That release's [package recipe](https://github.com/PyAV-Org/pyav-ffmpeg/blob/8.1.2-1/scripts/pkg.py) records upstream source URLs and SHA-256 hashes, including FFmpeg 8.1.2, OpenCORE AMR 0.1.6, x264 commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`, and x265 4.2. Its [build script](https://github.com/PyAV-Org/pyav-ffmpeg/blob/8.1.2-1/scripts/build-ffmpeg.py) and [patch directory](https://github.com/PyAV-Org/pyav-ffmpeg/tree/8.1.2-1/patches) accompany those recipes.

The matching [FFmpeg patch](https://github.com/PyAV-Org/pyav-ffmpeg/blob/8.1.2-1/patches/ffmpeg.patch) moves libx264 and libx265 from FFmpeg's GPL dependency list to its version-3 dependency list. Consequently the runtime license string and absence of `--enable-gpl` do not establish the license terms of those included libraries. [FFmpeg's own distribution guidance](https://ffmpeg.org/legal.html) identifies external-library/source requirements separately, and [x265's project documentation](https://x265.readthedocs.io/en/master/introduction.html) describes its GPL and commercial licensing options. No commercial license provenance was found in the inspected helper.

## Preserved native notices and source materials

The inspected package contains Python's license, PyAV's BSD license and author files, ONNX ASR's license, NumPy's bundled license collection, Protobuf's license, Packaging's license files, and PyInstaller's copying text. ONNX Runtime's `LICENSE` and `ThirdPartyNotices.txt` are present under `_internal/onnxruntime`.

The checked-in `licenses/` tree preserves 154 exact upstream license, copyright, notice, patent, author and license-header texts. The helper build copies them to `licenses/native/`. `licenses/sources.json` records each copied file's SHA-256, upstream URL and version. Archive-derived records additionally identify the exact archive digest, member path, original member digest and any verbatim-header extraction. Headers supply the AMF and NVIDIA codec-header notices where those upstream archives do not provide standalone license files. These texts cover the vendor inputs below, as well as the previously preserved FlatBuffers notice. Source-only build inputs are kept even on platforms that do not compile them.

`source-catalog.json` pins 22 archives totaling 81,901,939 bytes. Twenty are the source inputs listed by the matching vendor recipe. The other two preserve the complete vendor and PyAV repositories at immutable commits, including build workflows, dependency recipes and applied patches:

| Input | Pinned version |
| --- | --- |
| FFmpeg | 8.1.2 |
| x264 | `b35605ace3ddf7c1a5d67a2eb553f034aef41d55` |
| x265 | 4.2 |
| Opus / VPX / LAME | 1.6.1 / 1.16.0 / 3.100 |
| dav1d / SVT-AV1 / OpenCORE AMR | 1.5.3 / 4.1.0 / 0.1.6 |
| WebP including SharpYUV / PNG | 1.6.0 / 1.6.58 |
| GMP / Nettle / GnuTLS / libunistring | 6.3.0 / 3.10.2 / 3.8.13 / 1.4.2 |
| ALSA / oneVPL / NASM | 1.2.14 / 2.16.0 / 2.16.03 |
| NVIDIA codec headers / AMF headers | 13.0.19.0 / 1.5.0 |
| pyav-ffmpeg vendor recipe | 8.1.2-1, commit `a71bf9279f7a4659154b68ba6783e89be460bcd5` |
| PyAV sources and wheel recipe | 18.1.0, commit `7e3d950a8b72062502c1a60d672f8ca565313af5` |

`release_materials.py` fetches these archives with pinned size/SHA-256 verification and assembles a deterministic source-material bundle with all checked-in notices and the exact Ri helper/build recipes. It never executes downloaded source or extracts archive paths. The vendor repository archive retains all its patches, including its FFmpeg license-classification patch. The bundle is a codec/PyAV source and recipe inventory. It does **not** contain the complete corresponding source for Python, ONNX Runtime, NumPy, PyInstaller or every other dependency in the frozen helper. Reproducible material bundling is also not proof of a bit-for-bit reproducible native build.

`native_inventory.py` scans actual Mach-O/ELF headers and records every native file, its hash, component and linked dependencies. macOS uses `otool`, Linux uses `readelf`, and neither uses `ldd`. It records exported version, configuration and license evidence separately for all seven FFmpeg libraries, checks the source version, verifies packaged notices, and refuses unknown native components, unresolved dependencies and altered or omitted files. The locally inspected macOS arm64 helper has 85 native files with no inventory problems. Linux collection is implemented and parser-tested, but no Linux helper was inspected in this local session. Extra Linux dependencies such as OpenBLAS, OpenSSL, libffi or zlib must receive exact provenance and notices before an actual build can pass. The gate must not be weakened to accept an unknown dependency.

See [RELEASE.md](RELEASE.md) for preparation, final-signature inventory and publisher-review commands. A Boolean CI variable cannot approve a helper. Distribution verification requires an explicit publisher decision bound to the exact helper inventory and source-bundle hashes. Missing or pending review, missing sources/notices, changed recipes and changed binaries fail closed.

## Remaining published-release decisions

The following gaps remain explicit release work:

- Resolve the combined x264/x265 distribution terms, license compatibility, any commercial licensing and relevant patent terms. The preserved sources and runtime strings do not resolve those decisions. An audio-only rebuild is an alternative product decision, and would require new pinned sources, notices, native inventories and decoding tests.
- Review source, relinking and notice obligations across the **whole helper**, including Python's statically embedded dependencies and each wheel's vendored code. Wheel metadata and a top-level license are not complete evidence for embedded dependencies. Supply any additional source or materials that review requires.
- Inspect and qualify every intended native OS/CPU artifact. Linux/Intel build declarations and parser fixtures do not constitute successful native qualification.
- Sign and notarize the final macOS helper with the app, then regenerate its native inventory before generating the outer runtime manifest and the publisher's artifact-bound review. Signing changes file bytes.
- Publish the exact verified source bundle, notices, any additional required sources/relinking materials and review evidence at the reviewed source location with the binary release. The verifier checks the HTTPS location's syntax and artifact hashes, not that a remote publisher has actually uploaded or retained those materials.

This file records evidence and missing release materials. It does not certify license compliance or change any upstream license.
