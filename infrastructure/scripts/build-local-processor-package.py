"""Small downloadable source package; models, venv, secrets and job results never enter hosting."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = root / 'infrastructure/scripts/local-processor'
names = ['contracts.py', 'worker.py', 'server.py', 'prepare.py', 'requirements.txt', 'Install.cmd',
         'Install.ps1', 'Start.cmd', 'Start.ps1', 'StartHidden.ps1', 'PrepareLesson.cmd', 'PrepareLesson.ps1', 'README_AR.md']
files = [{"name": name, "text": (source / name).read_text(encoding='utf-8')} for name in names]
package = {"protocolVersion": 1, "files": files}
output = root / 'frontend/public/downloads/local-processor-package.json'
output.parent.mkdir(parents=True, exist_ok=True)
encoded = (json.dumps(package, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
output.write_bytes(encoded)
print(json.dumps({"bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()}))
