"""Prepare and verify pinned speech source materials. No source code is executed.

The automated checks establish artifact integrity and inventory coverage, not
license compatibility or a right to distribute. Publication requires a separate
publisher review bound to the exact helper inventory and source archive.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile
import urllib.parse
import urllib.request

SOURCE = Path(__file__).resolve().parent
DEFAULT_CACHE = SOURCE.parents[1] / '.electron-demo' / 'speech-sources'
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_BUNDLE = 2 * 1024 * 1024 * 1024


def digest(path):
    with open(path, 'rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def safe_name(name):
    if not isinstance(name, str) or not name or '\\' in name or '\0' in name:
        raise ValueError('Invalid material path')
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError('Unsafe material path: ' + name)
    return path


def catalog(path=SOURCE / 'source-catalog.json'):
    value = json.loads(Path(path).read_text())
    if value.get('format') != 1 or not value.get('artifacts'):
        raise ValueError('Unsupported or empty source catalog')
    seen = set()
    ids = set()
    for item in value['artifacts']:
        safe_name(item['file'])
        url = urllib.parse.urlsplit(item['url'])
        if '/' in item['file'] or item['file'] in seen or item['id'] in ids:
            raise ValueError('Duplicate or nested archive path')
        if url.scheme != 'https' or not url.hostname or url.username or url.password:
            raise ValueError('Source archives require credential-free HTTPS')
        if not re.fullmatch('[0-9a-f]{64}', item['sha256']):
            raise ValueError('Invalid source digest')
        if not isinstance(item['size'], int) or not 0 < item['size'] <= MAX_ARCHIVE:
            raise ValueError('Invalid source size')
        ids.add(item['id']); seen.add(item['file'])
    return value


class SecureRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        if url.scheme != 'https' or url.username or url.password:
            raise ValueError('Source redirect must use credential-free HTTPS')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def verify_archive(path, item):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size != item['size'] or digest(path) != item['sha256']:
        raise ValueError('Missing or altered source archive: ' + item['file'])


def fetch_archive(item, cache, opener=None):
    cache = Path(cache); cache.mkdir(parents=True, exist_ok=True)
    target = cache / item['file']
    if target.exists() or target.is_symlink():
        verify_archive(target, item)
        return target
    opener = opener or urllib.request.build_opener(SecureRedirect)
    # A unique, exclusive partial file prevents symlink overwrite and leaves an
    # interrupted download outside the trusted final archive namespace.
    temporary = tempfile.NamedTemporaryFile(prefix=item['file'] + '.', suffix='.partial', dir=cache, delete=False)
    partial = Path(temporary.name)
    try:
        with temporary as output, opener.open(urllib.request.Request(item['url'], headers={'User-Agent': 'Ri-source-materials/1'}), timeout=90) as response:
            if response.status != 200:
                raise ValueError('Unexpected archive response status')
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > item['size']:
                    raise ValueError('Source archive exceeds pinned size')
                output.write(chunk)
            output.flush(); os.fsync(output.fileno())
        verify_archive(partial, {**item, 'file': item['file']})
        # No overwrite of concurrently supplied material, including symlinks.
        try:
            os.link(partial, target)
        except FileExistsError:
            verify_archive(target, item)
        return target
    finally:
        partial.unlink(missing_ok=True)


def notice_inventory(source=SOURCE):
    record = json.loads((source / 'licenses/sources.json').read_text())
    result = {}
    for item in record['files']:
        name = 'licenses/' + item['file']; safe_name(name)
        file = source / name
        if file.is_symlink() or not file.is_file() or digest(file) != item['sha256']:
            raise ValueError('Missing or altered notice: ' + item['file'])
        result[name] = file
    return result


def recipe_inputs(catalog_path, source):
    files = {'source-catalog.json': Path(catalog_path)}
    files.update(notice_inventory(source))
    files['licenses/sources.json'] = source / 'licenses/sources.json'
    # Ship our exact helper/build/verification recipes and pinned package lock.
    # Vendor source archives retain their complete recipes and patch trees.
    for file in sorted(source.iterdir()):
        if file.is_file() and file.suffix in ('.py', '.mjs', '.md', '.txt', '.in', '.json'):
            files['ri-speech/' + file.name] = file
    return files


def build_bundle(cache, destination, catalog_path=SOURCE / 'source-catalog.json', source=None):
    source = Path(source or Path(catalog_path).parent)
    value = catalog(catalog_path)
    files = recipe_inputs(catalog_path, source)
    for item in value['artifacts']:
        file = Path(cache) / item['file']; verify_archive(file, item)
        files['archives/' + item['file']] = file
    manifest = {'format': 1, 'scope': 'speech-source-materials', 'files': {
        name: {'sha256': digest(file), 'size': file.stat().st_size} for name, file in sorted(files.items())
    }}
    destination = Path(destination); destination.parent.mkdir(parents=True, exist_ok=True)
    checksum = destination.with_name(destination.name + '.sha256')
    if destination.exists() or destination.is_symlink() or checksum.exists() or checksum.is_symlink():
        raise ValueError('Source bundle destination already exists')
    # Deterministic gzip and tar metadata. Same checked inputs produce exactly
    # the same archive; no directory mtimes, user names or absolute paths leak.
    temporary = tempfile.NamedTemporaryFile(prefix=destination.name + '.', suffix='.partial', dir=destination.parent, delete=False)
    partial = Path(temporary.name)
    try:
        with temporary as raw:
            with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as zipped, tarfile.open(fileobj=zipped, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
                for name in sorted([*files, 'materials-manifest.json']):
                    content = json_bytes(manifest) if name == 'materials-manifest.json' else None
                    info = tarfile.TarInfo(name); info.size = len(content) if content is not None else files[name].stat().st_size
                    info.mode = 0o644; info.mtime = 0; info.uid = info.gid = 0
                    if content is not None:
                        tar.addfile(info, io.BytesIO(content))
                    else:
                        with files[name].open('rb') as file: tar.addfile(info, file)
            raw.flush(); os.fsync(raw.fileno())
        verify_bundle(partial, catalog_path)
        hashed = digest(partial)
        # A partial/failed build never appears in the final artifact namespace.
        # Exclusive creation also refuses concurrently supplied symlinks/files.
        with checksum.open('x') as output:
            output.write(hashed + '  ' + destination.name + '\n')
            output.flush(); os.fsync(output.fileno())
        try:
            os.link(partial, destination)
        except BaseException:
            checksum.unlink()
            raise
        return {'bundle': str(destination), 'sha256': hashed, 'files': len(files), 'size': destination.stat().st_size}
    finally:
        partial.unlink(missing_ok=True)


def verify_bundle(bundle, catalog_path=SOURCE / 'source-catalog.json'):
    expected = catalog(catalog_path)
    entries = {}; payloads = {}; total = 0
    with tarfile.open(bundle, 'r:*') as archive:
        for member in archive:
            safe_name(member.name)
            if member.name in entries or not member.isfile() or member.size > MAX_ARCHIVE:
                raise ValueError('Invalid or duplicate source bundle member: ' + member.name)
            total += member.size
            if total > MAX_BUNDLE: raise ValueError('Source bundle exceeds size limit')
            file = archive.extractfile(member)
            if member.name in ('source-catalog.json', 'materials-manifest.json'):
                if member.size > 2 * 1024 * 1024: raise ValueError('Oversized source metadata')
                content = file.read(); payloads[member.name] = json.loads(content)
                hashed = hashlib.sha256(content).hexdigest()
            else: hashed = hashlib.file_digest(file, 'sha256').hexdigest()
            entries[member.name] = {'sha256': hashed, 'size': member.size}
    manifest = payloads.get('materials-manifest.json', {})
    entries.pop('materials-manifest.json', None)
    if manifest.get('format') != 1 or manifest.get('files') != entries:
        raise ValueError('Source material inventory mismatch')
    if payloads.get('source-catalog.json') != expected:
        raise ValueError('Source catalog differs from the reviewed catalog')
    for item in expected['artifacts']:
        if entries.get('archives/' + item['file']) != {'sha256': item['sha256'], 'size': item['size']}:
            raise ValueError('Missing pinned source: ' + item['id'])
    reviewed = {'archives/' + item['file']: {'sha256': item['sha256'], 'size': item['size']} for item in expected['artifacts']}
    for name, file in recipe_inputs(catalog_path, Path(catalog_path).parent).items():
        reviewed[name] = {'sha256': digest(file), 'size': file.stat().st_size}
    if entries != reviewed:
        raise ValueError('Bundled recipes/notices differ from reviewed source materials')
    return {'sha256': digest(bundle), 'files': len(entries)}


def verify_distribution(helper, bundle, approval, catalog_path=SOURCE / 'source-catalog.json'):
    from native_inventory import verify_inventory
    helper = Path(helper)
    inventory = verify_inventory(helper, catalog_path=catalog_path)
    materials = verify_bundle(bundle, catalog_path)
    approval = json.loads(Path(approval).read_text())
    if approval.get('format') != 1 or approval.get('decision') != 'approved':
        raise ValueError('Publisher distribution review is required')
    if approval.get('helperInventorySha256') != digest(helper / 'native-inventory.json') or approval.get('sourceBundleSha256') != materials['sha256']:
        raise ValueError('Publisher review does not match these exact artifacts')
    if not all(isinstance(approval.get(field), str) and approval[field].strip() for field in ['reviewer', 'reviewedAt', 'reviewReference', 'sourcePublicationUrl']):
        raise ValueError('Publisher review must identify its reviewer, evidence and source location')
    url = urllib.parse.urlsplit(approval['sourcePublicationUrl'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password:
        raise ValueError('The planned source publication location must be HTTPS')
    required = ['nativeLicenseCompatibility', 'correspondingSourceAndRelinking', 'noticesAndAttributions', 'patentAndCommercialTerms', 'pythonAndOtherBundledDependencies']
    if approval.get('reviewedRequirements') != {key: True for key in required}:
        raise ValueError('Publisher review has unresolved distribution requirements')
    return {'verified': True, 'platform': inventory['platform'], 'arch': inventory['arch'], 'sourceBundleSha256': materials['sha256'], 'publisherReview': approval['reviewReference'], 'legalCertification': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=SOURCE / 'source-catalog.json')
    commands = parser.add_subparsers(dest='command', required=True)
    fetch = commands.add_parser('fetch'); fetch.add_argument('--cache', type=Path, default=DEFAULT_CACHE)
    bundle = commands.add_parser('bundle'); bundle.add_argument('--cache', type=Path, default=DEFAULT_CACHE); bundle.add_argument('--output', type=Path, required=True)
    verify = commands.add_parser('verify-bundle'); verify.add_argument('bundle', type=Path)
    release = commands.add_parser('verify-release'); release.add_argument('--helper', type=Path, required=True); release.add_argument('--bundle', type=Path, required=True); release.add_argument('--approval', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'fetch':
        for item in catalog(args.catalog)['artifacts']:
            fetch_archive(item, args.cache); print('Verified ' + item['file'], flush=True)
    elif args.command == 'bundle': print(json.dumps(build_bundle(args.cache, args.output, args.catalog), indent=2))
    elif args.command == 'verify-bundle': print(json.dumps(verify_bundle(args.bundle, args.catalog), indent=2))
    else: print(json.dumps(verify_distribution(args.helper, args.bundle, args.approval, args.catalog), indent=2))


if __name__ == '__main__': main()
