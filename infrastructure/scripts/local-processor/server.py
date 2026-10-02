"""Loopback-only bridge. No remote code execution, site cookies, wildcard CORS or cloud uploads."""
import argparse
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from contracts import (JOB_ID, Invalid, MAX_SOURCE, cut_audio, link, request,
                       save_json, settings, signature)


def log(event, **safe):
    print(json.dumps({"event": "LocalProcessor." + event, **safe}), flush=True)


class Denied(PermissionError):
    """Only explicit access checks may produce a public permission error."""


class Processor:
    def __init__(self, root, connection, runner=None):
        self.root = Path(root)
        self.connection = link(connection)
        # Model weights may be shared, lesson drafts may not cross site/account boundaries.
        scope = hashlib.sha256((self.connection['origin'] + '\0' + self.connection['userId']).encode()).hexdigest()[:32]
        self.jobs = self.root / "jobs" / scope
        self.jobs.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.active = None
        self.running = None
        self.uploading = None
        self.runner = runner or self.run
        # Restart never silently resumes a model job or leaves a stale busy slot.
        for state_file in self.jobs.glob('*/state.json'):
            value = json.loads(state_file.read_text(encoding='utf-8'))
            if value.get('state') in ('running', 'awaiting_upload'):
                save_json(state_file, {'jobId': state_file.parent.name, 'state': 'failed',
                                      'error': 'processing_interrupted'})

    def job(self, job_id):
        if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
            raise Invalid("invalid_job")
        root = self.jobs / job_id
        if not (root / "state.json").exists():
            raise FileNotFoundError()
        return root

    def state(self, root):
        value = json.loads((root / "state.json").read_text(encoding="utf-8"))
        if (root / "progress.json").exists():
            progress = json.loads((root / "progress.json").read_text(encoding="utf-8"))
            value.update({key: progress[key] for key in ('phase', 'percent') if key in progress})
        return value

    def create(self, raw):
        value = request(raw)
        with self.lock:
            root = self.jobs / value["requestId"]
            if root.exists():
                if (root / "signature.txt").read_text() != signature(value):
                    raise Invalid("request_conflict")
                return self.state(root)
            if self.active:
                raise Invalid("processor_busy")
            if len(list(self.jobs.iterdir())) >= 30:
                raise Invalid("local_storage_full")
            root.mkdir()
            save_json(root / "request.json", value)
            (root / "signature.txt").write_text(signature(value))
            save_json(root / "state.json", {"jobId": root.name, "state": "awaiting_upload"})
            self.active = root.name
            log("Create.Success", jobId=root.name, lines=len(value["lines"]))
            return self.state(root)

    def start(self, root):
        with self.lock:
            if self.state(root)["state"] != "awaiting_upload":
                raise Invalid("upload_already_received")
            if self.active != root.name:
                raise Invalid("processor_busy")
            save_json(root / "state.json", {"jobId": root.name, "state": "running"})
            threading.Thread(target=self.execute, args=(root,), daemon=True).start()

    def execute(self, root):
        started = time.monotonic()
        log("Process.Start", jobId=root.name)
        try:
            self.runner(root)
            with self.lock:
                if self.state(root)["state"] == "cancelled":
                    return
                if not (root / "manifest.json").exists():
                    failure = root / "failure.json"
                    code = json.loads(failure.read_text()).get("error") if failure.exists() else "engine_failed"
                    raise Invalid(code)
                save_json(root / "state.json", {"jobId": root.name, "state": "complete"})
                log("Process.Success", jobId=root.name, durationMs=round((time.monotonic() - started) * 1000))
        except Exception as error:
            code = error.code if isinstance(error, Invalid) else "engine_failed"
            with self.lock:
                if self.state(root)["state"] != "cancelled":
                    save_json(root / "state.json", {"jobId": root.name, "state": "failed", "error": code})
                    log("Process.Failed", jobId=root.name, error=code,
                        durationMs=round((time.monotonic() - started) * 1000))
        finally:
            with self.lock:
                if self.active == root.name:
                    self.active = None
                    self.running = None

    def run(self, root):
        with self.lock:
            if self.state(root)["state"] == "cancelled":
                return
            self.running = subprocess.Popen([sys.executable, str(Path(__file__).with_name("worker.py")),
                "--root", str(root), "--models", str(self.root / "models")],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,
                start_new_session=os.name != 'nt')
            process = self.running
        try:
            process.wait(timeout=1800)
        except subprocess.TimeoutExpired:
            self.stop_worker(force=True)
            process.wait()
            raise Invalid("processing_timeout")

    def stop_worker(self, force=False):
        process = self.running
        if process is None or process.poll() is not None:
            return
        if os.name == 'nt':
            # Cancelling Python must also stop its FFmpeg decoder child.
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
            except ProcessLookupError:
                pass

    def cancel(self, root):
        with self.lock:
            if self.state(root)["state"] in ("complete", "failed", "cancelled"):
                return self.state(root)
            previous_state = self.state(root)["state"]
            save_json(root / "state.json", {"jobId": root.name, "state": "cancelled"})
            if self.running and self.active == root.name:
                self.stop_worker()
            if self.active == root.name and previous_state == "awaiting_upload" and self.uploading != root.name:
                self.active = None
            log("Cancel.Success", jobId=root.name)
            return self.state(root)


class Handler(BaseHTTPRequestHandler):
    server_version = "ShadowingLocal/1"

    def setup(self):
        super().setup()
        self.connection.settimeout(120)

    def log_message(self, *args):
        pass

    def handle_error(self, request, client_address):
        log("Request.TransportFailed", error="transport_failed")

    def gate(self, auth=True):
        expected = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != expected:
            raise Denied("invalid_host")
        if self.headers.get("Origin") != self.server.processor.connection["origin"]:
            raise Denied("origin_denied")
        if auth and not hmac.compare_digest(self.headers.get("Authorization", ""),
                    "Bearer " + self.server.processor.connection["token"]):
            raise Denied("link_required")

    def respond(self, value, status=200, kind="application/json", raw=False):
        body = value if raw else json.dumps(value).encode()
        self.send_response(status)
        if self.headers.get("Origin") == self.server.processor.connection["origin"]:
            self.send_header("Access-Control-Allow-Origin", self.server.processor.connection["origin"])
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        try:
            self.gate(auth=False)
            if self.headers.get("Access-Control-Request-Method") not in ("GET", "POST", "PUT", "DELETE"):
                raise Denied("method_denied")
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.server.processor.connection["origin"])
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.end_headers()
        except Denied:
            self.respond({"error": "origin_denied"}, 403)

    def json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 1 <= length <= 50000 or self.headers.get_content_type() != "application/json":
            raise Invalid("invalid_body")
        return json.loads(self.rfile.read(length))

    def dispatch(self):
        processor = self.server.processor
        self.gate(auth=self.path != "/v1/health")
        parts = self.path.split("/")
        if self.command == "GET" and self.path == "/v1/health":
            connected = hmac.compare_digest(self.headers.get("Authorization", ""),
                                            "Bearer " + processor.connection["token"])
            value = {"protocolVersion": 1, "installed": True, "linked": connected,
                     "profile": "shadowing-v2-1"}
            if connected:
                value['settings'] = processor.connection['settings']
                value['activeJobId'] = processor.active
            return self.respond(value)
        if self.command == "POST" and self.path == "/v1/settings":
            value = settings(self.json_body())
            with processor.lock:
                processor.connection["settings"] = value
                save_json(processor.root / "shadowing-link.json", processor.connection)
            log("Settings.Success", profile=value["profile"])
            return self.respond(value)
        if self.command == "POST" and self.path == "/v1/jobs":
            return self.respond(processor.create(self.json_body()), 201)
        if len(parts) < 4 or parts[1:3] != ["v1", "jobs"]:
            raise FileNotFoundError()
        root = processor.job(parts[3])
        state = processor.state(root)
        if self.command == "GET" and len(parts) == 4:
            return self.respond(state)
        if self.command == "DELETE" and len(parts) == 4:
            with processor.lock:
                if processor.state(root)["state"] not in ("complete", "failed", "cancelled") or processor.active == root.name:
                    raise Invalid("processor_busy")
                shutil.rmtree(root)
            log("Delete.Success", jobId=root.name)
            return self.respond({"deleted": True})
        if self.command == "POST" and parts[4:] == ["cancel"]:
            return self.respond(processor.cancel(root))
        if self.command == "PUT" and parts[4:] == ["source"]:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= MAX_SOURCE or state["state"] != "awaiting_upload":
                raise Invalid("invalid_upload")
            with processor.lock:
                if processor.uploading or processor.active != root.name or processor.state(root)["state"] != 'awaiting_upload':
                    raise Invalid("processor_busy")
                processor.uploading = root.name
            try:
                extension = json.loads((root / "request.json").read_text(encoding='utf-8'))["extension"]
                with (root / ("input" + extension)).open("wb") as destination:
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(65536, remaining))
                        if not chunk:
                            raise Invalid("incomplete_upload")
                        destination.write(chunk)
                        remaining -= len(chunk)
                processor.start(root)
                log("Upload.Success", jobId=root.name, bytes=length)
                return self.respond(processor.state(root), 202)
            finally:
                with processor.lock:
                    processor.uploading = None
                    if processor.state(root)['state'] == 'cancelled' and processor.active == root.name:
                        processor.active = None
        if state["state"] != "complete":
            raise Invalid("result_not_ready")
        if self.command == "GET" and parts[4:] == ["result"]:
            with processor.lock:
                manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
            return self.respond(manifest)
        if self.command == "GET" and len(parts) == 6 and parts[4] == "audio" and re.fullmatch(r"segment-\d{2}\.wav", parts[5]):
            with processor.lock:
                audio = (root / parts[5]).read_bytes()
            return self.respond(audio, kind="audio/wav", raw=True)
        if self.command == "GET" and parts[4:] == ["export"]:
            stream = io.BytesIO()
            with processor.lock:
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as archive:
                    archive.write(root / "manifest.json", "manifest.json")
                    for name in json.loads((root / "manifest.json").read_text(encoding="utf-8"))["segments"]:
                        archive.write(root / name["audioFile"], name["audioFile"])
            return self.respond(stream.getvalue(), kind="application/zip", raw=True)
        if self.command == "POST" and parts[4:] == ["recut"]:
            value = self.json_body()
            manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
            segments = value.get("segments") if isinstance(value, dict) else None
            if not isinstance(segments, list) or len(segments) != len(manifest["segments"]):
                raise Invalid("invalid_lines")
            # Validate every range before overwriting any clip.
            duration = manifest["duration"]
            previous = -1
            for segment in segments:
                if not isinstance(segment, dict):
                    raise Invalid('invalid_bounds')
                start, end = segment.get("start"), segment.get("end")
                if (type(start) not in (int, float) or type(end) not in (int, float)
                        or not 0 <= start < end <= duration or start < previous
                        or (end - start) * 32000 + 44 > 2_000_000):
                    raise Invalid("invalid_bounds")
                previous = start
                from contracts import text
                text(segment.get("text"), 1000, 1)
            with processor.lock:
                clips, _ = cut_audio(root, segments)
                manifest["segments"] = clips
                save_json(root / "manifest.json", manifest)
            log("Recut.Success", jobId=root.name, segments=len(clips))
            return self.respond(manifest)
        raise FileNotFoundError()

    def guarded(self):
        started = time.monotonic()
        try:
            self.dispatch()
        except Denied as error:
            log("Request.Denied", error=str(error))
            self.respond({"error": str(error)}, 403)
        except FileNotFoundError:
            self.respond({"error": "not_found"}, 404)
        except (Invalid, ValueError, json.JSONDecodeError) as error:
            code = error.code if isinstance(error, Invalid) else "invalid_body"
            status = 409 if code in ("request_conflict", "processor_busy", "result_not_ready") else 400
            log("Request.Failed", error=code, durationMs=round((time.monotonic() - started) * 1000))
            self.respond({"error": code}, status)
        except (BrokenPipeError, ConnectionResetError):
            log("Request.Disconnected")
        except Exception:
            log("Request.Failed", error="local_io_failed")
            self.respond({"error": "local_io_failed"}, 500)

    do_GET = guarded
    do_POST = guarded
    do_PUT = guarded
    do_DELETE = guarded


def create_server(root, connection, port=43127, runner=None):
    processor = Processor(root, connection, runner)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.processor = processor
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    http = None
    try:
        config = json.loads((args.root / "shadowing-link.json").read_text(encoding="utf-8-sig"))
        http = create_server(args.root, config)
        log("Start.Success", protocolVersion=1, port=43127)
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        log("Start.Failed", error=type(error).__name__)
        sys.exit(1)
    finally:
        if http and http.processor.running:
            http.processor.stop_worker()
        if http:
            http.server_close()
