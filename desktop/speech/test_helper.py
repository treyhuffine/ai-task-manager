import importlib.util
import io
import struct
import unittest
import wave
from pathlib import Path

spec = importlib.util.spec_from_file_location("speech_helper", Path(__file__).with_name("helper.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class AudioIsolationTests(unittest.TestCase):
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

    def test_segmenting_preserves_all_samples_without_duplication(self):
        import numpy as np
        waveform = np.ones(130 * 16000, dtype=np.float32)
        pieces = list(helper.segments(waveform))
        self.assertEqual(sum(len(piece) for piece in pieces), len(waveform))
        self.assertTrue(all(len(piece) <= 60 * 16000 for piece in pieces))


if __name__ == "__main__":
    unittest.main()
