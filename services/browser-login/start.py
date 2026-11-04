import os
from pathlib import Path
import runpy
import subprocess
import time

root = Path(__file__).resolve().parents[2]
engine = subprocess.Popen(["/srv/metis/toolchain/bin/node", "--import", "tsx", str(root / "services/browser-login/server.ts")], cwd=root)
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
