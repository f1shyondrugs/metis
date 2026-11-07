"""Real Linux namespaces, with same-UID tenant files and no account changes."""
import ctypes
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

LAUNCHER = Path(__file__).resolve().parents[1] / "services/native-runtime/launch.py"
LINUX = sys.platform == "linux" and Path("/usr/bin/bwrap").exists()


@unittest.skipUnless(LINUX, "Linux bubblewrap required")
class NativeRuntimeLauncher(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="metis-native-boundary-", dir="/var/tmp")
        self.base = Path(self.temp.name); self.base.chmod(0o711)
        if os.getuid() == 0:
            try: user = pwd.getpwnam("metis-runtime")
            except KeyError: user = pwd.getpwnam("nobody")
            self.uid, self.gid = user.pw_uid, user.pw_gid
        else: self.uid, self.gid = os.getuid(), os.getgid()
        self.a, self.b, self.data, self.code = [self.base / name for name in ["alice", "bob", "app-data", "runtime-code"]]
        for directory in [self.a, self.b, self.data, self.code]:
            directory.mkdir(mode=0o700)
            if os.getuid() == 0: os.chown(directory, self.uid, self.gid)
        (self.a / "own.txt").write_text("OWN-ALICE")
        (self.b / "foreign.txt").write_text("FOREIGN-BOB")
        (self.data / "chat.sqlite").write_text("TEST-APP-DB")
        (self.data / ".env").write_text("TEST-APP-ENV")
        for file in [self.a / "own.txt", self.b / "foreign.txt", self.data / "chat.sqlite", self.data / ".env"]:
            if os.getuid() == 0: os.chown(file, self.uid, self.gid)
        self.socket = socket.socket(socket.AF_UNIX); self.socket.bind(str(self.data / "private.sock")); self.socket.listen()
        self.policy = {"owner":"alice", "cwd":str(self.a), "home":str(self.a), "rw":[str(self.a)], "ro":[str(self.code)], "protected":[str(self.data)]}

    def tearDown(self):
        self.socket.close(); self.temp.cleanup()

    def before_exec(self):
        if os.getuid() == 0:
            os.setgroups([]); os.setgid(self.gid); os.setuid(self.uid)
        if ctypes.CDLL(None).prctl(38, 1, 0, 0, 0) != 0:
            raise RuntimeError("NoNewPrivileges unavailable")

    def run_sandbox(self, code, policy=None):
        return subprocess.run(["/usr/bin/python3", "-I", "-S", str(LAUNCHER), json.dumps(policy or self.policy), "/usr/bin/python3", "-c", code],
                              cwd="/", env={"PATH":"/usr/bin:/bin", "LANG":"C.UTF-8", "MCP_BEARER_TOKEN":"TEST-ROOT-BEARER-MUST-NOT-LEAK"},
                              preexec_fn=self.before_exec, text=True, capture_output=True, timeout=20)

    def test_real_namespace_blocks_foreign_same_uid_files_and_parent_process(self):
        global LAUNCHER
        # These paths are readable by the SAME uid outside the namespace. This
        # proves confinement beyond chmod or an application-level owner check.
        outside = subprocess.run(["/usr/bin/python3", "-c", "from pathlib import Path;import sys;assert all(Path(p).read_text() for p in sys.argv[1:])", str(self.b / "foreign.txt"), str(self.data / "chat.sqlite")],
                                 preexec_fn=self.before_exec, capture_output=True, timeout=10)
        self.assertEqual(outside.returncode, 0, outside.stderr)
        helper = self.code / "helper.py"; helper.write_text("print('READONLY-HELPER')\n"); helper.chmod(0o444)
        # Existing source location may be /home/operator (untraversable to the
        # service uid); copy only this launcher into readable test code first.
        copied = self.code / "launch.py"; shutil.copy2(LAUNCHER, copied); copied.chmod(0o555)
        original = LAUNCHER; LAUNCHER = copied
        listener = socket.socket(); listener.bind(("127.0.0.1", 0)); listener.listen()
        port = listener.getsockname()[1]
        def respond():
            try:
                client, _ = listener.accept()
                with client: client.sendall(b"ALLOWED-CLIENT")
            except OSError: pass
        threading.Thread(target=respond, daemon=True).start()
        try:
            code = f"""
import os,sys,pathlib,socket,subprocess
assert pathlib.Path('own.txt').read_text()=='OWN-ALICE'
assert os.environ['HOME']=={str(self.a)!r}
assert 'MCP_BEARER_TOKEN' not in os.environ
client=socket.create_connection(('127.0.0.1',{port}));assert client.recv(128)==b'ALLOWED-CLIENT';client.close()
server=socket.socket();server.bind(('127.0.0.1',0))
try: server.listen();raise AssertionError('native server listener allowed')
except PermissionError: pass
server.close()
for item in {[str(self.b/'foreign.txt'),str(self.data/'chat.sqlite'),str(self.data/'.env'),str(self.data/'private.sock')]!r}:
    assert not os.path.exists(item),item
for suffix in ['environ','mem','root','fd','cwd']:
    assert not os.path.exists('/proc/{os.getpid()}/'+suffix),suffix
assert not os.path.exists('/proc/1/root'+{str(self.data/'chat.sqlite')!r})
assert not os.path.exists('/proc/self/root'+{str(self.b/'foreign.txt')!r})
try: os.kill({os.getpid()},0);raise AssertionError('parent PID reachable')
except ProcessLookupError: pass
status=pathlib.Path('/proc/self/status').read_text()
assert 'NoNewPrivs:\\t1' in status
assert int(next(line.split(':')[1] for line in status.splitlines() if line.startswith('CapEff:')).strip(),16)==0
assert subprocess.check_output(['/usr/bin/python3',{str(helper)!r}],text=True).strip()=='READONLY-HELPER'
try: pathlib.Path({str(helper)!r}).write_text('tampered');raise AssertionError('readonly code writable')
except OSError: pass
pathlib.Path('created.txt').write_text('OWN-WRITE')
print('PASS same-uid namespace, filesystem, proc, capability, env and readonly-code boundaries')
"""
            result = self.run_sandbox(code)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("PASS same-uid namespace", result.stdout)
            self.assertEqual((self.a / "created.txt").read_text(), "OWN-WRITE")
        finally: LAUNCHER = original; listener.close()

    def test_broad_symlink_and_protected_mounts_fail_closed(self):
        global LAUNCHER
        copied = self.code / "launch.py"; shutil.copy2(LAUNCHER, copied); copied.chmod(0o555)
        original = LAUNCHER; LAUNCHER = copied
        try:
            alias = self.base / "alias"; alias.symlink_to(self.a, target_is_directory=True)
            for root in ["/", "/srv", str(self.base), str(self.data), str(alias)]:
                policy = {**self.policy, "ro":[root]}
                result = self.run_sandbox("raise AssertionError('must not execute')", policy)
                self.assertEqual(result.returncode, 126)
                self.assertEqual(result.stderr, "Native runtime isolation policy denied.\n")
        finally: LAUNCHER = original


if __name__ == "__main__": unittest.main(verbosity=2)
