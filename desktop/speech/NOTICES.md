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

## Material still needed for a published helper

The inspected package contains Python's license, PyAV's BSD license and author files, ONNX ASR's license, NumPy's bundled license collection, Protobuf's license, Packaging's license files, and PyInstaller's copying text. ONNX Runtime's `LICENSE` and `ThirdPartyNotices.txt` are present under `_internal/onnxruntime`.

Following that inspection, Ri added exact upstream FFmpeg license texts and its license overview, x264/x265 copying texts and source copyright headers, and the FlatBuffers license under this directory's sibling `licenses/` directory. The helper build copies them to `licenses/native/`. Its `sources.json` records exact release URLs, source hashes, copied-file hashes and any verbatim-header extraction. These additions supply those texts but do not fill the corresponding-source archive or remaining-codec inventory gaps. A helper staged before this change needs its notice files regenerated before publication.

The following gaps remain explicit release work:

- Complete the remaining included codec-library license, copyright and notice inventory, including Opus, VPX, LAME, dav1d, SVT-AV1, OpenCORE AMR and WebP/SharpYUV. They were not found in the frozen PyAV license directory. PyAV's BSD license is not a notice inventory for its bundled codecs.
- Preserve exact corresponding source archives, build recipes and applied patches alongside the published binaries. The source locations above identify the recipe but this artifact does not contain those archives or a publisher-hosted source location.
- Record native versions, configuration and notices separately on Linux. The current build's `licenses/ffmpeg-build.json` collector only scans macOS `.dylibs` and only avcodec, so an empty Linux result is not evidence of an absent dependency.
- Resolve the x264/x265 provenance and distribution requirements before labeling this package LGPL-only. If the release chooses an audio-only FFmpeg build, exclude unnecessary video libraries deliberately, then repeat the format and native-package tests against those new bytes.
- Confirm that the added native and FlatBuffers license texts reach each final signed artifact, and verify the complete notices/source inventory against its actual bytes.

This file records evidence and missing release materials. It does not certify license compliance or change any upstream license.
