"""Exercise a frozen helper against an already downloaded model in a test home.

python desktop/speech/benchmark.py --helper release/speech-helper/ri-speech-helper \
  --model <test-home>/.work/speech/<revision> --audio sample.wav sample.webm sample.m4a sample.ogg

Transcripts are printed for this explicit benchmark. Never point it at sensitive recordings.
"""
import argparse
import io
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--helper', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--audio', nargs='+', required=True)
    args = parser.parse_args()
    started = time.monotonic()
    process = subprocess.Popen([args.helper], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    token = secrets.token_hex(32)
    try:
        process.stdin.write(json.dumps({'token': token, 'model': args.model}) + '\n')
        process.stdin.flush()
        ready = json.loads(process.stdout.readline())
        base = 'http://127.0.0.1:' + str(ready['port'])
        print(json.dumps({'ready': ready, 'coldSeconds': time.monotonic() - started, 'pid': process.pid}))
        try:
            urllib.request.urlopen(base + '/health', timeout=10)
            raise RuntimeError('Unauthenticated health endpoint was accepted')
        except urllib.error.HTTPError as error:
            assert error.code == 401
        for name in args.audio:
            with open(name, 'rb') as audio:
                payload = audio.read()
            start = time.monotonic()
            request = urllib.request.Request(base + '/transcribe', payload, {'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(request, timeout=300) as response:
                result = json.load(response)
            result.update({'file': name, 'elapsedSeconds': time.monotonic() - start})
            try:
                result['rssKiB'] = int(subprocess.check_output(['ps', '-o', 'rss=', '-p', str(process.pid)]).strip())
            except (OSError, ValueError, subprocess.CalledProcessError):
                pass
            print(json.dumps(result))
        # Actual decoder refuses duration expansion past the documented limit.
        oversized = io.BytesIO()
        with wave.open(oversized, 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b'\0\0' * 601 * 16000)
        request = urllib.request.Request(base + '/transcribe', oversized.getvalue(), {'Authorization': 'Bearer ' + token})
        try:
            urllib.request.urlopen(request, timeout=30)
            raise RuntimeError('Duration limit was not enforced')
        except urllib.error.HTTPError as error:
            assert error.code == 400
            assert '10 minute' in error.read().decode()
        process.stdin.close()
        assert process.wait(timeout=5) == 0
        print('AUTH_DURATION_PARENT_EXIT_PASSED')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


if __name__ == '__main__':
    main()
