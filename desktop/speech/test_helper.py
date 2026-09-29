import importlib.util
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("speech_helper", Path(__file__).with_name("helper.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class AudioIsolationTests(unittest.TestCase):
    def test_version_probe_does_not_initialize_telemetry_storage(self):
        with tempfile.TemporaryDirectory(prefix="ri-speech-probe-") as directory:
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("helper.py").resolve()), "--version"],
                cwd=directory,
                env={**os.environ, "HOME": str(Path(directory) / "home"), "ORT_DISABLE_TELEMETRY": "0"},
                capture_output=True, text=True, check=True, timeout=30,
            )
            self.assertEqual(json.loads(result.stdout)["protocol"], 1)
            self.assertEqual(list(Path(directory).rglob("*")), [])

    def test_wave_decodes_without_filesystem_protocols(self):
        data = io.BytesIO()
        with wave.open(data, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(16000)
            output.writeframes(struct.pack("<h", 100) * 16000)
        self.assertEqual(len(helper.decode_audio(data.getvalue())), 16000)

    def test_playlists_cannot_read_files_or_network(self):
        for data in [b"#EXTM3U\nfile:///etc/passwd", b"#EXTM3U\nhttps://example.org/audio", b"[playlist]\nFile1=/etc/passwd"]:
            with self.assertRaisesRegex(ValueError, "Unsupported audio container"):
                helper.decode_audio(data)

    def test_resampler_flush_cannot_exceed_the_duration_limit(self):
        # 44.1 kHz conversion buffers its last samples until flush. Those
        # samples count toward the same bound as every decoded audio frame.
        with patch.object(helper, "MAX_SECONDS", 1):
            for count in [44100, 44101]:
                data = io.BytesIO()
                with wave.open(data, "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(44100)
                    output.writeframes(struct.pack("<h", 100) * count)
                if count == 44100:
                    self.assertEqual(len(helper.decode_audio(data.getvalue())), 16000)
                else:
                    with self.assertRaisesRegex(ValueError, "transcription limit"):
                        helper.decode_audio(data.getvalue())

    def test_segmenting_preserves_all_samples_without_duplication(self):
        import numpy as np
        waveform = np.ones(130 * 16000, dtype=np.float32)
        pieces = list(helper.segments(waveform))
        self.assertEqual(sum(len(piece) for piece in pieces), len(waveform))
        self.assertTrue(all(len(piece) <= 60 * 16000 for piece in pieces))


if __name__ == "__main__":
    unittest.main()
