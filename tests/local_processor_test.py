"""Contract/real HTTP tests; fixture runner tests transport, not WhisperX accuracy."""
import hashlib
import http.client
import io
import json
import shutil
import sys
import tempfile
import threading
import time
import unittest
import uuid
import wave
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / 'infrastructure/scripts/local-processor'
sys.path.insert(0, str(SCRIPTS))
from contracts import DEFAULT_SETTINGS, Invalid, cut_audio, link, request, save_json
from server import Processor, create_server
from prepare import prepare


ORIGIN = 'https://v2.example.test'
TOKEN = 'a' * 64
CONNECTION = {'schemaVersion': 1, 'protocolVersion': 1, 'origin': ORIGIN,
              'userId': 'admin-test', 'token': TOKEN, 'settings': DEFAULT_SETTINGS}


def wav_bytes(seconds=4, rate=16000):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as target:
        target.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        target.writeframes(b'\x01\x00' * round(seconds * rate))
    return stream.getvalue()


def fixture_runner(root):
    shutil.copyfile(root / 'input.wav', root / 'source.wav')
    value = json.loads((root / 'request.json').read_text(encoding='utf-8'))
    count = len(value['lines'])
    segments = [{'text': line, 'start': index * 4 / count, 'end': (index + 1) * 4 / count}
                for index, line in enumerate(value['lines'])]
    clips, duration = cut_audio(root, segments)
    save_json(root / 'manifest.json', {'schemaVersion': 1, 'profile': 'shadowing-v2-1',
              'jobId': root.name, 'title': value['title'], 'description': value['description'],
              'duration': duration, 'reviewRequired': True, 'segments': clips})


class ContractTests(unittest.TestCase):
    def value(self):
        return {'requestId': str(uuid.uuid4()), 'title': 'Test lesson', 'description': '',
                'lines': ['Hello there.', 'Good morning.'], 'extension': '.wav',
                'settings': DEFAULT_SETTINGS}

    def test_pairing_rejects_remote_http_credentials_and_malformed_types(self):
        for origin in ['http://v2.example.test', 'https://user:secret@example.test',
                       'https://example.test/path', 'https://example.test:99999', 'file:///local']:
            with self.subTest(origin=origin), self.assertRaises(Invalid):
                link({**CONNECTION, 'origin': origin})
        for token in [None, 42, 'short']:
            with self.assertRaises(Invalid):
                link({**CONNECTION, 'token': token})
        self.assertEqual(link({**CONNECTION, 'origin': 'http://localhost:4200'})['origin'], 'http://localhost:4200')

    def test_request_enforces_twenty_lines_integer_padding_and_real_uuid(self):
        value = self.value()
        for changed in [{'lines': ['hi'] * 21}, {'requestId': '-' * 36},
                        {'settings': {**DEFAULT_SETTINGS, 'leadingMs': True}},
                        {'settings': {**DEFAULT_SETTINGS, 'trailingMs': 1001}},
                        {'lines': [None]}, {'extension': '.exe'}]:
            with self.subTest(changed=changed), self.assertRaises(Invalid):
                request({**value, **changed})
        self.assertEqual(request({**value, 'lines': ['Teacher: Hello.']})['lines'], ['Hello.'])

    def test_cut_audio_preserves_frame_boundaries_and_hashes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'source.wav').write_bytes(wav_bytes())
            clips, duration = cut_audio(root, [{'text': 'Hello.', 'start': 0.25, 'end': 1.5}])
            raw = (root / clips[0]['audioFile']).read_bytes()
            self.assertEqual(duration, 4)
            self.assertEqual(clips[0]['bytes'], 40044)
            self.assertEqual(clips[0]['sha256'], hashlib.sha256(raw).hexdigest())
            with wave.open(io.BytesIO(raw)) as audio:
                self.assertEqual(audio.getparams()[:3], (1, 2, 16000))
                self.assertEqual(audio.getnframes(), 20000)

    def test_bad_second_edit_does_not_change_first_clip(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'source.wav').write_bytes(wav_bytes())
            cut_audio(root, [{'text': 'First.', 'start': 0, 'end': 1}, {'text': 'Second.', 'start': 1, 'end': 2}])
            before = (root / 'segment-01.wav').read_bytes()
            with self.assertRaises(Invalid):
                cut_audio(root, [{'text': 'Changed.', 'start': 0, 'end': 2}, {'text': 'Bad.', 'start': 3, 'end': 2}])
            self.assertEqual((root / 'segment-01.wav').read_bytes(), before)

    def test_last_frame_timing_never_rounds_past_the_source_duration(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'source.wav').write_bytes(wav_bytes(1 + 1 / 16000))
            clips, duration = cut_audio(root, [{'text': 'Last frame.', 'start': 0, 'end': 1 + 1 / 16000}])
            self.assertEqual(clips[0]['end'], duration)
            self.assertEqual(clips[0]['bytes'] - 44, round((clips[0]['end'] - clips[0]['start']) * 32000))

    def test_oversized_clip_and_wrong_format_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'source.wav').write_bytes(wav_bytes(70))
            with self.assertRaisesRegex(Invalid, 'segment_too_long'):
                cut_audio(root, [{'text': 'Too long.', 'start': 0, 'end': 70}])
            (root / 'source.wav').write_bytes(wav_bytes(1, 48000))
            with self.assertRaisesRegex(Invalid, 'invalid_normalized_audio'):
                cut_audio(root, [{'text': 'Wrong format.', 'start': 0, 'end': 1}])

    def test_restart_marks_interrupted_jobs_failed_without_running_ai(self):
        with tempfile.TemporaryDirectory() as folder, redirect_stdout(io.StringIO()):
            first = Processor(folder, CONNECTION, fixture_runner)
            created = first.create(self.value())
            second = Processor(folder, CONNECTION, fixture_runner)
            state = second.state(second.job(created['jobId']))
            self.assertEqual(state['state'], 'failed')
            self.assertEqual(state['error'], 'processing_interrupted')
            self.assertIsNone(second.active)

    def test_drafts_are_isolated_when_another_admin_uses_the_same_computer(self):
        with tempfile.TemporaryDirectory() as folder, redirect_stdout(io.StringIO()):
            first = Processor(folder, CONNECTION, fixture_runner)
            created = first.create(self.value())
            second = Processor(folder, {**CONNECTION, 'userId': 'another-admin'}, fixture_runner)
            self.assertNotEqual(first.jobs, second.jobs)
            with self.assertRaises(FileNotFoundError):
                second.job(created['jobId'])
            third = Processor(folder, {**CONNECTION, 'origin': 'https://another-site.test'}, fixture_runner)
            self.assertNotEqual(first.jobs, third.jobs)

    def test_shipped_package_matches_source_and_contains_no_models_or_connection(self):
        package = json.loads((REPO / 'frontend/public/downloads/local-processor-package.json').read_text(encoding='utf-8'))
        self.assertEqual(package['protocolVersion'], 1)
        self.assertEqual(len(package['files']), 13)
        for file in package['files']:
            self.assertEqual(file['text'], (SCRIPTS / file['name']).read_text(encoding='utf-8'))
        self.assertNotIn('shadowing-link.json', [file['name'] for file in package['files']])
        self.assertLess((REPO / 'frontend/public/downloads/local-processor-package.json').stat().st_size, 256000)

    def test_background_runner_keeps_structured_stdout_but_discards_raw_stderr(self):
        runner = (SCRIPTS / 'StartHidden.ps1').read_text(encoding='utf-8')
        self.assertIn('1>> $stdoutLog 2>$null', runner)
        self.assertNotIn('local-processor-stderr.log', runner)
        self.assertNotIn('stderrLog', runner)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.output = io.StringIO()
        self.capture = redirect_stdout(self.output)
        self.capture.__enter__()
        self.release = threading.Event()
        self.server = create_server(self.folder.name, CONNECTION, port=0, runner=fixture_runner)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.release.set()
        deadline = time.monotonic() + 2
        while self.server.processor.active and time.monotonic() < deadline:
            time.sleep(.005)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.capture.__exit__(None, None, None)
        self.folder.cleanup()

    def http(self, method, path, value=None, headers=None, binary=False):
        sent = {'Origin': ORIGIN, 'Authorization': 'Bearer ' + TOKEN}
        if headers:
            sent.update(headers)
        if value is not None:
            body = value if binary else json.dumps(value).encode()
            sent['Content-Type'] = 'audio/wav' if binary else 'application/json'
        else:
            body = None
        client = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            client.request(method, path, body=body, headers=sent)
            response = client.getresponse()
            payload = response.read()
            return response.status, dict(response.getheaders()), payload if binary else json.loads(payload or b'{}')
        finally:
            client.close()

    def value(self):
        return ContractTests().value()

    def completed(self):
        status, _, job = self.http('POST', '/v1/jobs', self.value())
        self.assertEqual(status, 201)
        job_id = job['jobId']
        status, _, _ = self.http('PUT', f'/v1/jobs/{job_id}/source', wav_bytes(), binary=True)
        self.assertEqual(status, 202)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            _, _, state = self.http('GET', '/v1/jobs/' + job_id)
            if state['state'] == 'complete':
                return job_id
            if state['state'] == 'failed':
                self.fail(state)
            time.sleep(.005)
        self.fail('Fixture processing did not complete')

    def test_wrong_origins_hosts_and_missing_keys_cannot_write(self):
        for headers in [{'Origin': 'https://attacker.test'}, {'Origin': 'null'},
                        {'Host': 'attacker.test'}, {'Authorization': ''}]:
            with self.subTest(headers=headers):
                status, _, _ = self.http('POST', '/v1/jobs', self.value(), headers)
                self.assertEqual(status, 403)
        self.assertEqual(list(self.server.processor.jobs.iterdir()), [])

    def test_health_and_preflight_are_read_only_and_cors_is_exact(self):
        before = list(Path(self.folder.name).rglob('*'))
        status, headers, result = self.http('GET', '/v1/health', headers={'Authorization': ''})
        self.assertEqual(status, 200)
        self.assertFalse(result['linked'])
        self.assertNotIn('settings', result)
        self.assertEqual(headers['Access-Control-Allow-Origin'], ORIGIN)
        self.assertNotIn('Access-Control-Allow-Credentials', headers)
        status, _, _ = self.http('OPTIONS', '/v1/jobs', headers={'Access-Control-Request-Method': 'PUT', 'Authorization': ''})
        self.assertEqual(status, 204)
        self.assertEqual(list(Path(self.folder.name).rglob('*')), before)

    def test_idempotent_create_conflict_and_one_active_job(self):
        value = self.value()
        _, _, first = self.http('POST', '/v1/jobs', value)
        _, _, repeated = self.http('POST', '/v1/jobs', value)
        self.assertEqual(first, repeated)
        status, _, _ = self.http('POST', '/v1/jobs', {**value, 'title': 'Changed lesson'})
        self.assertEqual(status, 409)
        status, _, _ = self.http('POST', '/v1/jobs', self.value())
        self.assertEqual(status, 409)
        self.assertEqual(len(list(self.server.processor.jobs.iterdir())), 1)
        self.http('POST', f"/v1/jobs/{first['jobId']}/cancel", {})

    def test_source_result_hash_export_and_reads_do_not_mutate_state(self):
        job_id = self.completed()
        root = self.server.processor.job(job_id)
        before = {file.name: file.stat().st_mtime_ns for file in root.iterdir()}
        _, _, manifest = self.http('GET', f'/v1/jobs/{job_id}/result')
        status, headers, raw = self.http('GET', f'/v1/jobs/{job_id}/audio/segment-01.wav', binary=True)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'audio/wav')
        self.assertEqual(manifest['segments'][0]['sha256'], hashlib.sha256(raw).hexdigest())
        _, _, package = self.http('GET', f'/v1/jobs/{job_id}/export', binary=True)
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            self.assertEqual(archive.testzip(), None)
            self.assertEqual(archive.namelist(), ['manifest.json', 'segment-01.wav', 'segment-02.wav'])
            self.assertTrue(all(file.compress_type == zipfile.ZIP_STORED for file in archive.infolist()))
        self.assertEqual({file.name: file.stat().st_mtime_ns for file in root.iterdir()}, before)

    def test_recut_rejects_invalid_whole_edit_then_updates_valid_clips(self):
        job_id = self.completed()
        root = self.server.processor.job(job_id)
        before = (root / 'segment-01.wav').read_bytes()
        status, _, _ = self.http('POST', f'/v1/jobs/{job_id}/recut', {'segments': [
            {'text': 'Changed.', 'start': 0, 'end': .5}, {'text': 'Bad.', 'start': 3, 'end': 2}]})
        self.assertEqual(status, 400)
        self.assertEqual((root / 'segment-01.wav').read_bytes(), before)
        status, _, manifest = self.http('POST', f'/v1/jobs/{job_id}/recut', {'segments': [
            {'text': 'Changed.', 'start': 0, 'end': .5}, {'text': 'Good morning.', 'start': 2, 'end': 4}]})
        self.assertEqual(status, 200)
        self.assertEqual(manifest['segments'][0]['bytes'], 16044)
        self.assertNotEqual((root / 'segment-01.wav').read_bytes(), before)

    def test_cancelled_running_job_keeps_slot_until_worker_exits(self):
        entered = threading.Event()
        def slow(root):
            entered.set()
            self.release.wait(timeout=3)
            fixture_runner(root)
        self.server.processor.runner = slow
        _, _, created = self.http('POST', '/v1/jobs', self.value())
        job_id = created['jobId']
        self.http('PUT', f'/v1/jobs/{job_id}/source', wav_bytes(), binary=True)
        self.assertTrue(entered.wait(timeout=1))
        _, _, cancelled = self.http('POST', f'/v1/jobs/{job_id}/cancel', {})
        self.assertEqual(cancelled['state'], 'cancelled')
        self.assertEqual(self.http('DELETE', f'/v1/jobs/{job_id}')[0], 409)
        self.assertEqual(self.http('POST', '/v1/jobs', self.value())[0], 409)
        self.release.set()
        deadline = time.monotonic() + 2
        while self.server.processor.active and time.monotonic() < deadline:
            time.sleep(.005)
        self.assertEqual(self.http('DELETE', f'/v1/jobs/{job_id}')[0], 200)
        self.assertFalse((self.server.processor.jobs / job_id).exists())

    def test_oversized_upload_is_rejected_before_body_is_read(self):
        _, _, created = self.http('POST', '/v1/jobs', self.value())
        status, _, _ = self.http('PUT', f"/v1/jobs/{created['jobId']}/source", b'',
            headers={'Content-Length': '100000001'}, binary=True)
        self.assertEqual(status, 400)
        self.http('POST', f"/v1/jobs/{created['jobId']}/cancel", {})

    def test_diagnostics_do_not_contain_token_title_transcript_or_disk_path(self):
        job_id = self.completed()
        self.http('GET', '/v1/health', headers={'Origin': 'https://attacker.test'})
        output = self.output.getvalue()
        for forbidden in [TOKEN, 'Test lesson', 'Hello there.', self.folder.name]:
            self.assertNotIn(forbidden, output)
        self.assertIn(job_id, output)
        self.assertIn('Process.Success', output)

    def test_runner_exception_details_are_not_logged_or_returned(self):
        marker = 'password=synthetic-secret-token=private-cookie=lesson-transcript'
        def fail_with_sensitive_error(root):
            raise RuntimeError(marker)
        self.server.processor.runner = fail_with_sensitive_error
        status, _, job = self.http('POST', '/v1/jobs', self.value())
        self.assertEqual(status, 201)
        job_id = job['jobId']
        self.http('PUT', f'/v1/jobs/{job_id}/source', wav_bytes(), binary=True)
        deadline = time.monotonic() + 2
        state = {}
        while time.monotonic() < deadline:
            _, _, state = self.http('GET', f'/v1/jobs/{job_id}')
            if state['state'] == 'failed':
                break
            time.sleep(.005)
        self.assertEqual(state['error'], 'engine_failed')
        self.assertNotIn(marker, self.output.getvalue())
        self.assertNotIn(marker, json.dumps(state))
        self.assertIn('Process.Failed', self.output.getvalue())
        self.assertIn('durationMs', self.output.getvalue())

    def test_native_zip_fallback_streams_only_to_loopback_and_exports_valid_package(self):
        root = Path(self.folder.name)
        save_json(root / 'shadowing-link.json', CONNECTION)
        source = root / 'teacher.wav'
        source.write_bytes(wav_bytes())
        script = root / 'script.txt'
        script.write_text('Hello there.\nGood morning.\n', encoding='utf-8')
        output = root / 'lesson.zip'
        prepare(root, source, script, 'Test lesson', output, timeout=3, port=self.server.server_port)
        with zipfile.ZipFile(output) as package:
            self.assertIsNone(package.testzip())
            manifest = json.loads(package.read('manifest.json'))
            self.assertEqual(len(manifest['segments']), 2)
            self.assertTrue(manifest['reviewRequired'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
