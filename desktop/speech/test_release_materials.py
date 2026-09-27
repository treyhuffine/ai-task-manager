import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

import native_inventory as native
import release_materials as materials


class MaterialTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ri-speech-materials-')
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'; self.source.mkdir()
        self.cache = self.root / 'cache'; self.cache.mkdir()
        notice = self.source / 'licenses/ffmpeg/LICENSE'; notice.parent.mkdir(parents=True); notice.write_bytes(b'notice')
        (self.source / 'licenses/sources.json').write_text(json.dumps({'files': [{'file': 'ffmpeg/LICENSE', 'sha256': materials.digest(notice)}]}))
        (self.source / 'helper.py').write_text('# exact helper recipe\n')
        archive = self.cache / 'ffmpeg.tar.gz'; archive.write_bytes(b'pinned source archive')
        self.item = {'id': 'ffmpeg', 'version': '8.1.2', 'file': archive.name, 'url': 'https://source.example/ffmpeg.tar.gz', 'sha256': materials.digest(archive), 'size': archive.stat().st_size, 'notices': ['ffmpeg/LICENSE']}
        self.catalog = self.source / 'source-catalog.json'; self.catalog.write_text(json.dumps({'format': 1, 'artifacts': [self.item]}))

    def tearDown(self): self.temporary.cleanup()

    def bundle(self, name='materials.tar.gz'):
        result = self.root / name
        materials.build_bundle(self.cache, result, self.catalog)
        return result

    def helper(self):
        root = self.root / 'helper'; root.mkdir()
        (root / 'build.json').write_text(json.dumps({'protocol': 1, 'platform': 'linux', 'arch': 'x64'}))
        notice = root / 'licenses/native/ffmpeg/LICENSE'; notice.parent.mkdir(parents=True); notice.write_bytes(b'notice')
        rows = []
        for family in native.FFMPEG:
            file = root / ('lib' + family + '.so.1'); file.write_bytes(b'\x7fELF' + family.encode())
            evidence = {'version': '1.0.0', 'configuration': '--enable-version3 --enable-libx264', 'license': 'LGPL version 3 or later'}
            if family == 'avutil': evidence['ffmpegVersion'] = '8.1.2'
            rows.append({'file': file.name, 'component': 'ffmpeg', 'family': family, 'sha256': materials.digest(file), 'dependencies': ['libc.so.6'], 'runtimeEvidence': evidence})
        record = {'format': 1, 'platform': 'linux', 'arch': 'x64', 'sourceCatalogSha256': materials.digest(self.catalog), 'files': native.file_inventory(root), 'native': rows, 'problems': []}
        (root / 'native-inventory.json').write_bytes(materials.json_bytes(record))
        return root

    def test_bundle_is_deterministic_and_verifies_without_extracting_sources(self):
        first = self.bundle(); second = self.bundle('second.tar.gz')
        self.assertEqual(materials.digest(first), materials.digest(second))
        self.assertGreater(materials.verify_bundle(first, self.catalog)['files'], 3)
        self.assertFalse((self.root / 'archives').exists())

    def test_rejects_missing_and_altered_sources(self):
        archive = self.cache / self.item['file']; archive.write_bytes(b'altered')
        with self.assertRaisesRegex(ValueError, 'altered source'): self.bundle()
        archive.unlink()
        with self.assertRaisesRegex(ValueError, 'Missing'): self.bundle()

    def test_rejects_missing_notices(self):
        (self.source / 'licenses/ffmpeg/LICENSE').unlink()
        with self.assertRaisesRegex(ValueError, 'notice'): self.bundle()

    def test_failed_bundle_verification_never_activates_an_artifact(self):
        with patch('release_materials.verify_bundle', side_effect=ValueError('Interrupted verification')):
            with self.assertRaisesRegex(ValueError, 'Interrupted'): self.bundle()
        self.assertFalse((self.root / 'materials.tar.gz').exists())
        self.assertFalse((self.root / 'materials.tar.gz.sha256').exists())
        self.assertEqual(list(self.root.glob('*.partial')), [])

    def test_bundle_checksum_refuses_symlink_overwrite(self):
        outside = self.root / 'unrelated'; outside.write_bytes(b'keep')
        (self.root / 'materials.tar.gz.sha256').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'already exists'): self.bundle()
        self.assertEqual(outside.read_bytes(), b'keep')
        self.assertFalse((self.root / 'materials.tar.gz').exists())

    def test_rejects_changed_build_recipes(self):
        bundle = self.bundle()
        (self.source / 'helper.py').write_text('# changed after source preparation\n')
        with self.assertRaisesRegex(ValueError, 'recipes/notices differ'): materials.verify_bundle(bundle, self.catalog)

    def test_rejects_repacked_tamper_even_with_a_rewritten_manifest(self):
        bundle = self.bundle(); files = {}
        with tarfile.open(bundle) as archive:
            for member in archive: files[member.name] = archive.extractfile(member).read()
        files['ri-speech/helper.py'] = b'# malicious replacement'
        manifest = json.loads(files['materials-manifest.json'])
        manifest['files']['ri-speech/helper.py'] = {'sha256': hashlib.sha256(files['ri-speech/helper.py']).hexdigest(), 'size': len(files['ri-speech/helper.py'])}
        files['materials-manifest.json'] = materials.json_bytes(manifest)
        tampered = self.root / 'tampered.tar'
        with tarfile.open(tampered, 'w') as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name); member.size = len(data); archive.addfile(member, io.BytesIO(data))
        with self.assertRaisesRegex(ValueError, 'recipes/notices differ'): materials.verify_bundle(tampered, self.catalog)

    def test_rejects_unsafe_and_duplicate_bundle_members(self):
        for kind in ['traversal', 'symlink', 'duplicate']:
            file = self.root / (kind + '.tar')
            with tarfile.open(file, 'w') as archive:
                member = tarfile.TarInfo('../outside' if kind == 'traversal' else 'member')
                if kind == 'symlink': member.type = tarfile.SYMTYPE; member.linkname = '/etc/passwd'
                archive.addfile(member)
                if kind == 'duplicate': archive.addfile(member)
            with self.assertRaises(ValueError): materials.verify_bundle(file, self.catalog)

    def test_download_verifies_bounded_bytes_before_activation(self):
        target = self.cache / self.item['file']; data = target.read_bytes(); target.unlink()
        class Response(io.BytesIO): status = 200
        class Opener:
            def open(self, *args, **kwargs): return Response(data + b'poison')
        with self.assertRaisesRegex(ValueError, 'exceeds pinned size'): materials.fetch_archive(self.item, self.cache, Opener())
        self.assertEqual(list(self.cache.iterdir()), [])
        class GoodOpener:
            def open(self, *args, **kwargs): return Response(data)
        materials.fetch_archive(self.item, self.cache, GoodOpener())
        self.assertEqual(target.read_bytes(), data)

    def test_download_refuses_symlink_cache_entries(self):
        target = self.cache / self.item['file']; target.unlink()
        outside = self.root / 'unrelated'; outside.write_bytes(b'keep'); target.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'altered source'): materials.fetch_archive(self.item, self.cache)
        self.assertEqual(outside.read_bytes(), b'keep')

    def test_rejects_plaintext_and_credentialed_redirects(self):
        handler = materials.SecureRedirect()
        for url in ['http://source.example/file', 'https://user:secret@source.example/file']:
            with self.assertRaisesRegex(ValueError, 'HTTPS'):
                handler.redirect_request(urllib.request.Request(self.item['url']), None, 302, 'redirect', {}, url)

    def test_native_inventory_rejects_omitted_or_altered_library(self):
        helper = self.helper()
        self.assertEqual(len(native.verify_inventory(helper, self.catalog)['native']), 7)
        file = helper / 'native-inventory.json'; record = json.loads(file.read_text()); record['native'].pop(); file.write_bytes(materials.json_bytes(record))
        with self.assertRaisesRegex(ValueError, 'omits'): native.verify_inventory(helper, self.catalog)
        (helper / 'libavcodec.so.1').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'changed after inspection'): native.verify_inventory(helper, self.catalog)

    def test_native_inventory_refuses_missing_ffmpeg_evidence(self):
        helper = self.helper(); file = helper / 'native-inventory.json'; record = json.loads(file.read_text()); record['native'][0]['runtimeEvidence'] = {}; file.write_bytes(materials.json_bytes(record))
        with self.assertRaisesRegex(ValueError, 'runtime evidence'): native.verify_inventory(helper, self.catalog)

    def test_native_inventory_refuses_wrong_target(self):
        helper = self.helper(); file = helper / 'native-inventory.json'; record = json.loads(file.read_text()); record['arch'] = 'arm64'; file.write_bytes(materials.json_bytes(record))
        with self.assertRaisesRegex(ValueError, 'target differs'): native.verify_inventory(helper, self.catalog)

    def test_publisher_review_is_required_and_bound_to_exact_artifacts(self):
        helper = self.helper(); bundle = self.bundle(); approval = self.root / 'approval.json'
        record = {'format': 1, 'decision': 'pending'}; approval.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'review is required'): materials.verify_distribution(helper, bundle, approval, self.catalog)
        record.update({'decision': 'approved', 'helperInventorySha256': materials.digest(helper / 'native-inventory.json'), 'sourceBundleSha256': materials.digest(bundle), 'reviewer': 'Fixture reviewer', 'reviewedAt': '2026-09-26', 'reviewReference': 'Fixture-only review', 'sourcePublicationUrl': 'https://source.example/release.tar.gz', 'reviewedRequirements': {key: True for key in ['nativeLicenseCompatibility', 'correspondingSourceAndRelinking', 'noticesAndAttributions', 'patentAndCommercialTerms', 'pythonAndOtherBundledDependencies']}})
        approval.write_text(json.dumps(record))
        self.assertFalse(materials.verify_distribution(helper, bundle, approval, self.catalog)['legalCertification'])
        record['helperInventorySha256'] = '0' * 64; approval.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'exact artifacts'): materials.verify_distribution(helper, bundle, approval, self.catalog)


class NativePlatformTests(unittest.TestCase):
    def test_same_basename_cannot_hide_external_or_escaping_dependency(self):
        files = {'_internal/av/.dylibs/libcodec.dylib': {}, '_internal/libcodec.so': {}}
        owner = '_internal/av/.dylibs/libconsumer.dylib'
        self.assertTrue(native.accounted_dependency('@loader_path/libcodec.dylib', owner, files, 'darwin'))
        self.assertFalse(native.accounted_dependency('/tmp/libcodec.dylib', owner, files, 'darwin'))
        self.assertFalse(native.accounted_dependency('/usr/lib/../../tmp/libcodec.dylib', owner, files, 'darwin'))
        self.assertFalse(native.accounted_dependency('@loader_path/subdirectory/../libcodec.dylib', owner, files, 'darwin'))
        self.assertFalse(native.accounted_dependency('@executable_path/subdirectory/../_internal/av/.dylibs/libcodec.dylib', owner, files, 'darwin'))
        self.assertFalse(native.accounted_dependency('@loader_path/../../../../libcodec.dylib', owner, files, 'darwin'))
        self.assertTrue(native.accounted_dependency('libcodec.so', '_internal/module.so', files, 'linux'))
        self.assertFalse(native.accounted_dependency('/tmp/libcodec.so', '_internal/module.so', files, 'linux'))
        self.assertFalse(native.accounted_dependency('../libcodec.so', '_internal/module.so', files, 'linux'))

    def test_linux_and_macos_codec_filenames_map_to_the_same_source(self):
        for name in ['_internal/av.libs/libopus-abc123.so.0.11.0', '_internal/av/.dylibs/libopus.0.dylib']:
            self.assertEqual(native.component_for(name), 'opus')
        self.assertIsNone(native.component_for('_internal/av/.dylibs/libunexpected.so'))
        self.assertIsNone(native.component_for('_internal/numpy/.dylibs/libunknown.so'))
        self.assertIsNone(native.component_for('_internal/python3.12/libunknown.so'))

    @patch('native_inventory.subprocess.run')
    def test_macos_excludes_library_identity_from_dependencies(self, run):
        run.side_effect = [subprocess.CompletedProcess([], 0, 'library:\n @rpath/libonnxruntime.1.dylib (compatibility version 0.0.0)\n /usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n'), subprocess.CompletedProcess([], 0, 'library:\n@rpath/libonnxruntime.1.dylib\n')]
        self.assertEqual(native.dependencies(Path('/fixture/library'), 'darwin'), ['/usr/lib/libSystem.B.dylib'])

    @patch('native_inventory.subprocess.run')
    def test_linux_inspects_elf_without_running_ldd_or_the_library(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '0x01 (NEEDED) Shared library: [libavcodec-abc.so.62]\n0x01 (NEEDED) Shared library: [libc.so.6]\n')
        self.assertEqual(native.dependencies(Path('/fixture/library'), 'linux'), ['libavcodec-abc.so.62', 'libc.so.6'])
        self.assertEqual(run.call_args.args[0][:3], ['readelf', '--wide', '--dynamic'])


if __name__ == '__main__': unittest.main()
