"""Run the real API/Identity media suite with a disposable loopback Azurite process. No live SQL/Azure."""
import argparse
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dotnet', default='dotnet')
    parser.add_argument('--azurite', type=Path,
                        default=Path('.local/media-tools/node_modules/azurite/dist/src/blob/main.js'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    emulator = (repo / args.azurite).resolve() if not args.azurite.is_absolute() else args.azurite
    if not emulator.is_file():
        print('Install the isolated emulator first: npm install --prefix .local/media-tools azurite@3.35.0', file=sys.stderr)
        return 1
    with socket.socket() as port_check:
        try:
            port_check.bind(('127.0.0.1', 10027))
        except OSError:
            print('Close the test emulator on port 10027 before running this isolated suite.', file=sys.stderr)
            return 1
    env = dict(os.environ, MSBUILDDISABLENODEREUSE='1', DOTNET_CLI_USE_MSBUILD_SERVER='0',
               DOTNET_CLI_TELEMETRY_OPTOUT='1')
    # This runner always targets its own emulator; never inherit a live storage connection.
    env.pop('V2_MEDIA_TEST_CONNECTION_STRING', None)
    built = subprocess.run([args.dotnet, 'build', 'tests/ShadowingEnglish.MediaChecks/ShadowingEnglish.MediaChecks.csproj',
                            '--artifacts-path', 'backend/.local/media-checks', '-m:1', '-p:UseSharedCompilation=false',
                            '--disable-build-servers', '--nologo', '-v', 'minimal'], cwd=repo, env=env)
    if built.returncode:
        return built.returncode
    scratch = repo / 'backend/.local'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='media-emulator-', dir=scratch) as folder:
        with open(Path(folder) / 'emulator.log', 'w', encoding='utf-8') as output:
            server = subprocess.Popen(['node', str(emulator), '--blobHost', '127.0.0.1', '--blobPort', '10027',
                                       '--location', folder, '--silent', '--skipApiVersionCheck', '--disableTelemetry'],
                                      stdout=output, stderr=subprocess.STDOUT, env=env)
            try:
                for _ in range(100):
                    try:
                        with socket.create_connection(('127.0.0.1', 10027), timeout=.3):
                            break
                    except OSError:
                        if server.poll() is not None:
                            print('The disposable emulator could not start.', file=sys.stderr)
                            return 1
                        time.sleep(.1)
                else:
                    print('The disposable emulator did not become ready.', file=sys.stderr)
                    return 1
                return subprocess.run([args.dotnet, 'backend/.local/media-checks/bin/ShadowingEnglish.MediaChecks/debug/ShadowingEnglish.MediaChecks.dll'],
                                      cwd=repo, env=env).returncode
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == '__main__':
    sys.exit(main())
