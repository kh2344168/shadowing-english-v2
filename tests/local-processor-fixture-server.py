"""E2E-only server: deterministic WAV transport fixture, not AI/DB/production evidence."""
import tempfile
from pathlib import Path
from local_processor_test import CONNECTION, create_server, fixture_runner

with tempfile.TemporaryDirectory(prefix='shadowing-v2-test-') as folder:
    server = create_server(Path(folder), {**CONNECTION, 'origin': 'http://127.0.0.1:4206',
                           'userId': 'test-admin'}, runner=fixture_runner)
    print('TEST FIXTURE: loopback transport only; no WhisperX or live database.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
