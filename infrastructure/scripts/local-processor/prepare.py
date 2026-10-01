"""Native ZIP fallback uses the same authenticated loopback API and one-job limit."""
import argparse
import http.client
import json
import time
import uuid
from pathlib import Path

from contracts import Invalid, MAX_SOURCE, link, request


def prepare(processor_root, source, script, title, output, timeout=1800, port=43127):
    connection = link(json.loads((processor_root / 'shadowing-link.json').read_text(encoding='utf-8-sig')))
    headers = {'Origin': connection['origin'], 'Authorization': 'Bearer ' + connection['token']}

    def call(method, path, body=None, binary=False):
        client = http.client.HTTPConnection('127.0.0.1', port, timeout=120)
        try:
            supplied = dict(headers)
            if body is not None:
                supplied['Content-Type'] = 'application/octet-stream' if binary else 'application/json'
                supplied['Content-Length'] = str(source.stat().st_size if binary else len(body))
            client.request(method, path, body=body, headers=supplied)
            response = client.getresponse()
            result = response.read()
            if response.status >= 400:
                value = json.loads(result)
                raise Invalid(value.get('error', 'local_request_failed'))
            return result
        finally:
            client.close()

    if not source.is_file() or not 0 < source.stat().st_size <= MAX_SOURCE or script.stat().st_size > 100_000:
        raise Invalid('invalid_source')
    lines = [line.strip() for line in script.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    value = request({'requestId': str(uuid.uuid4()), 'title': title, 'description': '',
                     'extension': source.suffix.lower(), 'lines': lines, 'settings': connection['settings']})
    job = json.loads(call('POST', '/v1/jobs', json.dumps(value).encode()))
    job_id = job['jobId']
    try:
        with source.open('rb') as media:
            call('PUT', f'/v1/jobs/{job_id}/source', media, binary=True)
        deadline = time.monotonic() + timeout
        last_phase = None
        while time.monotonic() < deadline:
            state = json.loads(call('GET', f'/v1/jobs/{job_id}'))
            if state.get('phase') != last_phase:
                last_phase = state.get('phase')
                print('Processing:', last_phase or state['state'], flush=True)
            if state['state'] == 'complete':
                output.write_bytes(call('GET', f'/v1/jobs/{job_id}/export'))
                print('ZIP ready. Import it from the Admin processing page and review every clip.', flush=True)
                return
            if state['state'] in ('failed', 'cancelled'):
                raise Invalid(state.get('error', 'cancelled'))
            time.sleep(1)
        raise Invalid('processing_timeout')
    except BaseException:
        try:
            call('POST', f'/v1/jobs/{job_id}/cancel', b'{}')
        except Exception:
            pass
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--script', type=Path, required=True)
    parser.add_argument('--title', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        prepare(args.root, args.source, args.script, args.title, args.output)
    except KeyboardInterrupt:
        print('Cancelled locally.', flush=True)
        raise SystemExit(1)
    except Exception as error:
        print('Unable to prepare the lesson:', error.code if isinstance(error, Invalid) else 'local_connection_or_file_failed', flush=True)
        raise SystemExit(1)
