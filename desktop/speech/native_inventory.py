"""Inspect a locally built speech helper on its matching OS/architecture.

Uses otool/readelf to inspect dependencies, never ldd or a shell. FFmpeg's
version/license/configuration exports are evidence, not license conclusions.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

from release_materials import SOURCE, catalog, digest, json_bytes, notice_inventory

FFMPEG = ['avcodec', 'avdevice', 'avfilter', 'avformat', 'avutil', 'swresample', 'swscale']
CODECS = {
    'SvtAv1Enc': 'libsvtav1', 'dav1d': 'dav1d', 'mp3lame': 'lame',
    'opencore-amrnb': 'opencore-amr', 'opencore-amrwb': 'opencore-amr',
    'opus': 'opus', 'sharpyuv': 'webp', 'webpmux': 'webp', 'webp': 'webp',
    'vpx': 'vpx', 'x264': 'x264', 'x265': 'x265', 'png16': 'png',
    'gnutls': 'gnutls', 'gmp': 'gmp', 'nettle': 'nettle', 'hogweed': 'nettle',
    'unistring': 'unistring', 'asound': 'alsa-lib', 'vpl': 'libvpl',
}
# These are OS interfaces rather than libraries copied into the distribution.
# Anything actually bundled is still inventoried and must have known provenance.
LINUX_SYSTEM = re.compile(r'^(?:ld-linux[^/]*|lib(?:c|m|dl|pthread|rt|util|resolv|gcc_s|stdc\+\+)\.so(?:\.[0-9]+)*)$')
NATIVE_MAGIC = {b'\x7fELF', b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}


def file_inventory(root):
    root = Path(root).resolve(); files = {}
    for file in sorted(root.rglob('*')):
        name = file.relative_to(root).as_posix()
        if name == 'native-inventory.json': continue
        if file.is_symlink():
            target = os.readlink(file)
            resolved = file.resolve(strict=True)
            if os.path.isabs(target) or not resolved.is_relative_to(root):
                raise ValueError('Native helper link escapes its root: ' + name)
            files[name] = {'link': target}
        elif file.is_file():
            files[name] = {'sha256': digest(file), 'size': file.stat().st_size}
        elif not file.is_dir():
            raise ValueError('Unsupported native helper filesystem entry: ' + name)
    return files


def component_for(name):
    basename = Path(name).name
    for library in FFMPEG:
        if re.match(r'^lib' + library + r'(?:[.\-])', basename): return 'ffmpeg'
    for library, component in CODECS.items():
        if re.match(r'^lib' + re.escape(library) + r'(?:[.\-])', basename): return component
    if name == 'ri-speech-helper': return 'pyinstaller'
    if re.fullmatch(r'libpython3\.[0-9]+(?:[a-z]*)\.(?:dylib|so(?:\.[0-9]+)*)', basename) or basename == 'Python': return 'python'
    extension = bool(re.fullmatch(r'[a-zA-Z0-9_]+\.(?:abi3|cpython-3[0-9]+-[a-zA-Z0-9_-]+)\.so', basename))
    if '/av/' in name and extension: return 'pyav-recipe'
    if '/numpy/' in name and extension: return 'numpy'
    if '/onnxruntime/' in name and (basename.startswith(('libonnxruntime.', 'onnxruntime_pybind11_state')) or basename == 'libonnxruntime_providers_shared.so'): return 'onnxruntime'
    # Dynamic CPython standard-library extension modules, where present.
    if extension and (Path(name).parent.as_posix() == '_internal' or '/lib-dynload/' in name): return 'python'
    return None


def dependencies(file, target_platform):
    if target_platform == 'darwin':
        result = subprocess.run(['otool', '-L', str(file)], check=True, capture_output=True, text=True, timeout=30)
        references = [line.strip().split(' (compatibility version')[0] for line in result.stdout.splitlines()[1:] if line.strip()]
        # otool -L includes a dylib's LC_ID_DYLIB as its first line. Its install
        # name can differ from the bundled filename and is not a dependency.
        own_id = subprocess.run(['otool', '-D', str(file)], check=True, capture_output=True, text=True, timeout=30).stdout.splitlines()[1:]
        if own_id and references and references[0] == own_id[0].strip(): references.pop(0)
        return references
    if target_platform == 'linux':
        result = subprocess.run(['readelf', '--wide', '--dynamic', str(file)], check=True, capture_output=True, text=True, timeout=30)
        return re.findall(r'\(NEEDED\).*?\[([^\]]+)\]', result.stdout)
    raise ValueError('Native inventory supports macOS and Linux')


def is_system_dependency(name, target_platform):
    if os.path.normpath(name) != name or '\\' in name or '\0' in name: return False
    return name.startswith(('/usr/lib/', '/System/Library/')) if target_platform == 'darwin' else bool(LINUX_SYSTEM.fullmatch(name))


def accounted_dependency(name, owner, files, target_platform):
    if is_system_dependency(name, target_platform): return True
    # A same-named bundled library does not satisfy an absolute external path.
    if os.path.isabs(name) or '\\' in name or '\0' in name: return False
    if target_platform == 'linux':
        return '/' not in name and name in {Path(file).name for file in files}
    if name.startswith(('@loader_path/', '@executable_path/')):
        parts = name.split('/', 1)[1].split('/')
        named = False
        for part in parts:
            if part == '..' and named: return False
            if part not in ('.', '..'): named = True
    if name.startswith('@loader_path/'):
        target = os.path.normpath(os.path.join(os.path.dirname(owner), name[len('@loader_path/'):]))
        return not target.startswith('../') and target in files
    if name.startswith('@executable_path/'):
        target = os.path.normpath(name[len('@executable_path/'):])
        return not target.startswith('../') and target in files
    # dyld resolves @rpath against the binary's search paths. Preserve that
    # reference as evidence, but require a simple packaged library name.
    if name.startswith('@rpath/'):
        target = name[len('@rpath/'):]
        return '/' not in target and target not in ('.', '..') and target in {Path(file).name for file in files}
    return False


def ffmpeg_probe(file, family):
    library = ctypes.CDLL(str(file))
    result = {}
    for field in ['version', 'license', 'configuration']:
        function = getattr(library, family + '_' + field)
        function.restype = ctypes.c_uint if field == 'version' else ctypes.c_char_p
        value = function()
        result[field] = f'{value >> 16}.{(value >> 8) & 255}.{value & 255}' if field == 'version' else value.decode()
    if family == 'avutil':
        library.av_version_info.restype = ctypes.c_char_p
        result['ffmpegVersion'] = library.av_version_info().decode()
    return result


def collect(root, catalog_path=SOURCE / 'source-catalog.json'):
    root = Path(root).resolve()
    value = catalog(catalog_path)
    metadata = json.loads((root / 'build.json').read_text())
    target_platform = sys.platform
    target_arch = {'aarch64': 'arm64', 'x86_64': 'x64', 'AMD64': 'x64'}.get(platform.machine(), platform.machine())
    if metadata.get('platform') != target_platform or metadata.get('arch') != target_arch:
        raise ValueError('Inspect the helper on its matching native target')
    files = file_inventory(root); native = []; problems = []
    for name, entry in files.items():
        if 'link' in entry: continue
        file = root / name
        with file.open('rb') as stream: magic = stream.read(4)
        if magic not in NATIVE_MAGIC: continue
        component = component_for(name)
        item = {'file': name, 'component': component, 'sha256': entry['sha256'], 'dependencies': dependencies(file, target_platform)}
        if component is None: problems.append('Unknown bundled native dependency: ' + name)
        if component == 'ffmpeg':
            family = next(family for family in FFMPEG if Path(name).name.startswith('lib' + family))
            item['family'] = family; item['runtimeEvidence'] = ffmpeg_probe(file, family)
        native.append(item)
    if not native: problems.append('Native helper inventory is empty')
    for item in native:
        for needed in item['dependencies']:
            if not accounted_dependency(needed, item['file'], files, target_platform):
                problems.append('Unaccounted native dependency: ' + item['file'] + ' -> ' + needed)
    families = {item.get('family') for item in native}
    for missing in set(FFMPEG) - families: problems.append('Missing FFmpeg library evidence: ' + missing)
    versions = [item['runtimeEvidence']['ffmpegVersion'] for item in native if item.get('family') == 'avutil']
    pinned = next(item['version'] for item in value['artifacts'] if item['id'] == 'ffmpeg')
    if versions != [pinned]: problems.append('FFmpeg runtime version differs from source catalog')
    ffmpeg_licenses = sorted({item['runtimeEvidence']['license'] for item in native if item.get('family')})
    result = {'format': 1, 'platform': target_platform, 'arch': target_arch, 'files': files, 'native': native,
              'sourceCatalogSha256': digest(catalog_path), 'problems': sorted(set(problems)),
              'licenseInterpretation': 'Runtime strings are observations only. External GPL/commercial components require publisher review.',
              'ffmpegReportedLicenses': ffmpeg_licenses}
    (root / 'native-inventory.json').write_bytes(json_bytes(result))
    return result


def verify_inventory(root, catalog_path=SOURCE / 'source-catalog.json'):
    root = Path(root)
    value = catalog(catalog_path)
    inventory = json.loads((root / 'native-inventory.json').read_text())
    if inventory.get('format') != 1 or inventory.get('platform') not in ['darwin', 'linux'] or inventory.get('arch') not in ['arm64', 'x64']:
        raise ValueError('Unsupported native inventory')
    metadata = json.loads((root / 'build.json').read_text())
    if metadata.get('protocol') != 1 or any(metadata.get(key) != inventory[key] for key in ['platform', 'arch']):
        raise ValueError('Native inventory target differs from helper build metadata')
    if inventory.get('sourceCatalogSha256') != digest(catalog_path): raise ValueError('Native source catalog mismatch')
    if inventory.get('files') != file_inventory(root): raise ValueError('Native helper changed after inspection')
    if inventory.get('problems') or not inventory.get('native'): raise ValueError('Native inventory has unresolved dependencies: ' + '; '.join(inventory.get('problems', [])))
    # The complete reviewed notice index is required, even for source-only
    # Linux recipe inputs not needed by this particular native target.
    for relative, file in notice_inventory(Path(catalog_path).parent).items():
        copied = root / 'licenses/native' / Path(relative).relative_to('licenses')
        if copied.is_symlink() or not copied.is_file() or digest(copied) != digest(file):
            raise ValueError('Missing or altered packaged notice: ' + relative)
    source_ids = {item['id'] for item in value['artifacts']}
    existing_notices = {'python': ['licenses/PYTHON-LICENSE.txt'], 'onnxruntime': ['_internal/onnxruntime/LICENSE', '_internal/onnxruntime/ThirdPartyNotices.txt']}
    for component in {'numpy', 'pyinstaller'}:
        existing_notices[component] = [str(file.relative_to(root)) for file in (root / 'licenses' / component).rglob('*') if file.is_file() and ('licens' in file.name.lower() or file.name.lower().startswith('copying'))]
    actual_native = set()
    for name, entry in inventory['files'].items():
        if 'link' in entry: continue
        with (root / name).open('rb') as file:
            if file.read(4) in NATIVE_MAGIC: actual_native.add(name)
    if {item['file'] for item in inventory['native']} != actual_native or len(inventory['native']) != len(actual_native):
        raise ValueError('Native inventory omits or duplicates an executable/library')
    observed_families = {item.get('family') for item in inventory['native'] if item.get('component') == 'ffmpeg'}
    if observed_families != set(FFMPEG): raise ValueError('Incomplete FFmpeg runtime evidence')
    pinned_ffmpeg = next(item['version'] for item in value['artifacts'] if item['id'] == 'ffmpeg')
    for item in inventory['native']:
        component = item.get('component')
        if not component or component != component_for(item['file']) or item.get('sha256') != inventory['files'][item['file']]['sha256']:
            raise ValueError('Native component provenance mismatch')
        if any(not accounted_dependency(needed, item['file'], inventory['files'], inventory['platform']) for needed in item.get('dependencies', [])):
            raise ValueError('Unaccounted native library dependency')
        if component == 'ffmpeg':
            evidence = item.get('runtimeEvidence', {})
            if not all(evidence.get(key) for key in ['version', 'license', 'configuration']): raise ValueError('Missing FFmpeg runtime evidence')
            if item.get('family') == 'avutil' and evidence.get('ffmpegVersion') != pinned_ffmpeg: raise ValueError('FFmpeg runtime/source version mismatch')
        if component in source_ids:
            source = next(source for source in value['artifacts'] if source['id'] == component)
            if not source.get('notices'): raise ValueError('Missing component notice inventory: ' + str(component))
        elif component in existing_notices:
            notices = existing_notices[component]
            if not notices or any(not (root / name).is_file() or not (root / name).stat().st_size for name in notices):
                raise ValueError('Missing bundled dependency notice: ' + str(component))
        else: raise ValueError('Unreviewed native component: ' + str(component))
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('helper', type=Path)
    parser.add_argument('--catalog', type=Path, default=SOURCE / 'source-catalog.json')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    result = verify_inventory(args.helper, args.catalog) if args.verify else collect(args.helper, args.catalog)
    print(json.dumps({'nativeFiles': len(result['native']), 'platform': result['platform'], 'arch': result['arch'], 'problems': result['problems']}, indent=2))
    if result['problems']: raise SystemExit(1)


if __name__ == '__main__': main()
