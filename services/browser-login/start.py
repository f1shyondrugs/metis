import os
from pathlib import Path
import runpy
import shutil
import subprocess
import time

if os.environ.get("METIS_NATIVE_ISOLATION") != "1" and os.environ.get("METIS_PROTECTED_LOGIN_MODE") != "trusted-root":
    raise SystemExit("Protected logins require an explicitly enabled Linux credential deployment")

root = Path(__file__).resolve().parents[2]
node = os.environ.get("METIS_BROWSER_LOGIN_NODE") or shutil.which("node")
if not node:
    raise SystemExit("Set METIS_BROWSER_LOGIN_NODE to a Node.js 22 or newer executable")
engine = subprocess.Popen([node, "--disable-sigusr1", "--import", "tsx", str(root / "services/browser-login/server.ts")], cwd=root)
try:
    socket = Path(os.environ.get("STATE_DIRECTORY", "/var/lib/metis-browser-login")) / "engine.sock"
    for _ in range(100):
        if engine.poll() is not None:
            raise RuntimeError("Protected browser engine did not start")
        if socket.exists():
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("Protected browser engine timeout")
    runpy.run_path(str(root / "services/browser-login/peer-broker.py"), run_name="__main__")
finally:
    engine.terminate()
    engine.wait(timeout=10)
