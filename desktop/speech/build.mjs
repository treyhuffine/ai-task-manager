/** Build on the target OS/architecture. Output joins the signed runtime inventory. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(source, '../..');
const build = path.join(root, '.electron-demo/speech-build');
const output = path.join(root, 'release/speech-helper');
fs.mkdirSync(build, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, env: { ...process.env, PYINSTALLER_CONFIG_DIR: path.join(build, 'pyinstaller-cache') } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const python = process.env.RI_SPEECH_BUILD_PYTHON || path.join(build, 'venv/bin/python');
if (!process.env.RI_SPEECH_BUILD_PYTHON) {
  run('uv', ['venv', '--python', '3.12.12', path.join(build, 'venv')]);
  run('uv', ['pip', 'install', '--python', python, '--require-hashes', '--only-binary=:all:', '-r', path.join(source, 'requirements.txt')]);
}
run(python, ['-c', "import sys,importlib.metadata; assert sys.version_info[:3] == (3,12,12), 'Build requires Python 3.12.12'; expected={'onnx-asr':'0.12.0','onnxruntime':'1.30.0','av':'18.1.0','numpy':'2.4.3','pyinstaller':'6.22.3'}; assert all(importlib.metadata.version(name)==version for name,version in expected.items()), 'Build dependencies do not match pinned versions'"]);
run(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'ri-speech-helper',
  '--distpath', path.join(build, 'dist'), '--workpath', path.join(build, 'work'), '--specpath', build,
  '--collect-all', 'onnx_asr', '--collect-all', 'onnxruntime', '--collect-all', 'av', path.join(source, 'helper.py')]);
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(build, 'dist/ri-speech-helper'), output, { recursive: true, dereference: false, verbatimSymlinks: true });
run(python, ['-c', `import importlib.metadata, pathlib, shutil, builtins, ctypes, json, av
out=pathlib.Path(${JSON.stringify(path.join(output,'licenses'))})
for name in ['onnx-asr','onnxruntime','av','numpy','flatbuffers','protobuf','packaging','pyinstaller']:
 d=importlib.metadata.distribution(name)
 for file in d.files or []:
  if '.dist-info/' in str(file) and any(part.lower() in ['licenses','license','license.txt','copying','metadata'] for part in file.parts):
   target=out/name/str(file)
   target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copyfile(d.locate_file(file),target)
for candidate in builtins.license._Printer__filenames:
 if pathlib.Path(candidate).is_absolute() and pathlib.Path(candidate).is_file():
  shutil.copyfile(candidate,out/'PYTHON-LICENSE.txt')
  break
ffmpeg=[]
for candidate in (pathlib.Path(av.__file__).parent/'.dylibs').glob('*avcodec*'):
 lib=ctypes.CDLL(str(candidate))
 lib.avcodec_license.restype=ctypes.c_char_p
 lib.avcodec_configuration.restype=ctypes.c_char_p
 ffmpeg.append({'library':candidate.name,'license':lib.avcodec_license().decode(),'configuration':lib.avcodec_configuration().decode()})
(out/'ffmpeg-build.json').write_text(json.dumps(ffmpeg,indent=2))
`]);
fs.copyFileSync(path.join(source, 'requirements.txt'), path.join(output, 'requirements.txt'));
fs.copyFileSync(path.join(source, 'NOTICES.md'), path.join(output, 'NOTICES.md'));
// These checked-in native notices are separate from PyAV's Python BSD license.
// Keep their source URLs/hashes with the exact copied texts in every helper.
fs.cpSync(path.join(source, 'licenses'), path.join(output, 'licenses/native'), { recursive: true });
fs.writeFileSync(path.join(output, 'build.json'), JSON.stringify({ protocol: 1, platform: process.platform, arch: process.arch, python: '3.12.12', engine: 'onnx-asr', version: '0.12.0' }, null, 2));
run(path.join(output, 'ri-speech-helper'), ['--version']);
console.log(`Speech helper: ${output}. Copy this directory to server/speech-helper before signing and manifest generation.`);
