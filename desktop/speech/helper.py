"""Ri-owned CPU speech helper. Frozen with Python/PyAV/ONNX, never downloads models.

The parent sends a private token/model directory over stdin, keeps that pipe open,
and kills the process to cancel inference. Closing stdin also exits immediately.
"""
import hmac
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

# ORT's POSIX uploader initializes while its native module imports. Suppress it
# before importing onnx_asr/onnxruntime, including the standalone version probe.
# This is separate from Hugging Face's telemetry preference.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"

MAX_BYTES = 50 * 1024 * 1024
MAX_SECONDS = 600
PROTOCOL = 1


def decode_audio(data):
    import av
    import numpy as np
    chunks = []
    size = 0
    def append(converted):
        nonlocal size
        samples = converted.to_ndarray().reshape(-1)
        size += samples.size
        if size > MAX_SECONDS * 16000:
            raise ValueError("Recording exceeds the 10 minute local transcription limit")
        chunks.append(samples)
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        container_format = "wav"
    elif data[:4] == b"OggS":
        container_format = "ogg"
    elif data[:4] == b"\x1a\x45\xdf\xa3":
        container_format = "matroska"
    elif data[4:8] == b"ftyp":
        container_format = "mov"
    elif data[:4] == b"fLaC":
        container_format = "flac"
    elif data[:3] == b"ID3" or (len(data) > 1 and data[0] == 255 and data[1] & 224 == 224):
        container_format = "mp3"
    else:
        raise ValueError("Unsupported audio container. Use WAV, WebM, MP4, Ogg, FLAC or MP3")
    # Only known self-contained media demuxers. Playlists and external URL/file
    # references must never read the host filesystem or network.
    with av.open(io.BytesIO(data), format=container_format, options={"protocol_whitelist": ""}) as container:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                append(converted)
        for converted in resampler.resample(None):
            append(converted)
    if not chunks:
        raise ValueError("No audio samples found")
    return np.concatenate(chunks).astype(np.float32)


def segments(waveform):
    # Bound attention memory and choose a quiet boundary in the last 5 seconds
    # of each 60 second segment. No overlapping words or duplicate transcripts.
    import numpy as np
    start = 0
    while start < len(waveform):
        end = min(start + 60 * 16000, len(waveform))
        if end < len(waveform):
            search_start = end - 5 * 16000
            energies = [np.mean(np.square(waveform[i:i + 1600])) for i in range(search_start, end, 1600)]
            end = search_start + int(np.argmin(energies)) * 1600 + 800
        yield waveform[start:end]
        start = end


def main():
    if "--version" in sys.argv:
        import av
        import onnx_asr
        import onnxruntime
        print(json.dumps({"protocol": PROTOCOL, "engine": "onnx-asr", "onnxruntime": onnxruntime.__version__, "av": av.__version__}))
        return
    config = json.loads(sys.stdin.readline())
    token = config["token"]
    if len(token) < 32:
        raise ValueError("Invalid parent capability")
    def parent_watch():
        sys.stdin.read()
        os._exit(0)
    threading.Thread(target=parent_watch, daemon=True).start()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    import onnx_asr
    import onnxruntime as ort
    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    options.inter_op_num_threads = 1
    started = time.monotonic()
    model = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", config["model"], quantization="int8", providers=["CPUExecutionProvider"], sess_options=options)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never persist recordings, transcripts, or the capability.

        def reply(self, code, value):
            body = json.dumps(value).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.reply(401, {"error": "Unauthorized"})
                return False
            return True

        def do_GET(self):
            if self.authorized():
                self.reply(200 if self.path == "/health" else 404, {"ready": self.path == "/health", "protocol": PROTOCOL})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != "/transcribe":
                self.reply(404, {"error": "Not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > MAX_BYTES:
                    self.reply(413, {"error": "Audio must be between 1 byte and 50 MiB"})
                    return
                self.connection.settimeout(30)
                data = self.rfile.read(length)
                if len(data) != length:
                    raise ValueError("Incomplete recording")
                waveform = decode_audio(data)
                start = time.monotonic()
                text = " ".join(model.recognize(segment, sample_rate=16000).strip() for segment in segments(waveform)).strip()
                self.reply(200, {"text": text, "seconds": len(waveform) / 16000, "inferenceSeconds": time.monotonic() - start})
            except Exception as error:
                self.reply(400, {"error": str(error)[:400]})

    class PrivateServer(HTTPServer):
        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(10)
            return connection, address

    server = PrivateServer(("127.0.0.1", 0), Handler)
    print(json.dumps({"protocol": PROTOCOL, "port": server.server_port, "ready": True, "loadSeconds": time.monotonic() - started}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
