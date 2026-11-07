"""Credential sink and incremental output regressions; synthetic PTYs only."""
import base64
import importlib.util
import os
from pathlib import Path
import re
import shlex
import tempfile
import threading
import time
import unittest
import urllib.parse
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("console", Path(__file__).parents[1] / "services/secure-console/server.py")
console = importlib.util.module_from_spec(spec)
spec.loader.exec_module(console)
SECRET = "SYNTHETIC-PASSWORD-7319"


class ConsoleBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="metis-console-boundary-")
        self.previous_state = console.STATE
        console.STATE = Path(self.temp.name)

    def tearDown(self):
        for session in list(console.SESSIONS.values()):
            session.close()
        console.SESSIONS.clear()
        console.STATE = self.previous_state
        self.temp.cleanup()

    def output_session(self):
        session = console.Session.__new__(console.Session)
        session.buffer, session.pending_output, session.secrets = "", "", [SECRET]
        session.pending_ansi = ""
        session.marker, session.id = "fixture-marker", "fixture-session"
        session.ready, session.closed, session.used = True, False, time.time()
        session.lock = threading.RLock()
        console.SESSIONS[("alice", "chat")] = session
        # No OS process belongs to this output-only fixture.
        session.disposed = True
        return session

    def read(self):
        return console.dispatch({"owner": "alice", "chat": "chat", "operation": "read"})["output"]

    def test_read_between_every_split_hides_secret_and_encoded_variants(self):
        variants = [SECRET, urllib.parse.quote(SECRET, safe=""), base64.b64encode(SECRET.encode()).decode(), SECRET.encode().hex()]
        for value in variants:
            for split in range(1, len(value)):
                with self.subTest(value=value, split=split):
                    session = self.output_session()
                    session.append_output("before " + value[:split])
                    self.assertEqual(self.read(), "before ")
                    session.append_output(value[split:] + " after!")
                    self.assertEqual(self.read(), "before [REDACTED] after!")

    def test_split_terminal_escapes_cannot_reveal_a_secret_prefix(self):
        session = self.output_session()
        session.append_output(SECRET[:6] + "\x1b[")
        self.assertEqual(self.read(), "")
        session.append_output("31m" + SECRET[6:] + "!")
        self.assertEqual(self.read(), "[REDACTED]!")

    def test_eof_and_retention_never_flush_a_partial_secret(self):
        session = self.output_session()
        session.append_output("x" * 210000 + SECRET[:-1])
        self.assertNotIn(SECRET[:-1], self.read())
        session.closed = True
        self.assertNotIn(SECRET[:-1], self.read())
        self.assertEqual(session.pending_output, SECRET[:-1])
        session.append_output(SECRET[-1] + "!")
        self.assertTrue(self.read().endswith("[REDACTED]!"))

    def wait_for(self, condition):
        for _ in range(200):
            if condition():
                return
            time.sleep(.01)
        self.fail("Synthetic PTY did not reach the expected state")

    def fixture_exec(self, original):
        def execute(file, args, environment):
            self.assertIn(file, ["/usr/bin/su", "/usr/bin/sudo"])
            marker = re.search(r"METIS_AUTH_[a-f0-9]+", args[-1]).group()
            program = (
                "import os,sys,termios;"
                "a=termios.tcgetattr(0);a[3]&=~termios.ECHO;termios.tcsetattr(0,termios.TCSANOW,a);"
                "os.write(1,b'Password: ');"
                "value=sys.stdin.readline().strip();"
                "assert value==" + repr(SECRET) + ";"
                "os.write(1,bytes([30])+sys.argv[1].encode()+bytes([31]));"
                "os.execve('/bin/bash',['bash','--noprofile','--norc'],dict(os.environ))"
            )
            original("/usr/bin/python3", ["python3", "-c", program, marker], environment)
        return execute

    def test_foreground_interceptor_cannot_receive_new_local_authentication(self):
        capture = Path(self.temp.name) / "captured"
        interceptor = Path(self.temp.name) / "interceptor.py"
        interceptor.write_text(
            "import os,sys,termios\n"
            "a=termios.tcgetattr(0);a[3]&=~termios.ECHO;termios.tcsetattr(0,termios.TCSANOW,a)\n"
            "os.write(1,b'INTERCEPTOR_READY!')\n"
            "line=sys.stdin.readline()\n"
            "os.write(1,b'Password: ')\n"
            "value=sys.stdin.readline()\n"
            "open(sys.argv[1],'w').write(value)\n"
        )
        with patch.object(os, "execve", self.fixture_exec(os.execve)):
            session = console.Session("alice", "chat", "su", "original")
            console.SESSIONS[("alice", "chat")] = session
            request = session.prepare()
            session.fill(request["secureInput"]["requestId"], SECRET)
            self.wait_for(lambda: session.ready)
            console.dispatch({"owner": "alice", "chat": "chat", "operation": "input", "input": {"command": shlex.join(["/usr/bin/python3", str(interceptor), str(capture)])}})
            self.wait_for(lambda: "INTERCEPTOR_READY!" in session.clean())
            request = console.dispatch({"owner": "alice", "chat": "chat", "operation": "elevate", "input": {"method": "su", "user": "target"}})
            replacement = console.SESSIONS[("alice", "chat")]
            self.assertNotEqual(replacement.pid, session.pid)
            self.assertTrue(session.closed)
            self.assertEqual(request["status"], "input_required")
            self.assertIn('"target"', request["target"])
            console.dispatch({"owner": "alice", "chat": "chat", "operation": "fill", "input": {"requestId": request["secureInput"]["requestId"], "password": SECRET}})
            self.wait_for(lambda: replacement.ready)
            self.assertFalse(capture.exists(), "The old foreground program must receive no new authentication input")

    def test_remote_elevation_is_rejected_before_any_write_or_password_request(self):
        session = self.output_session()
        session.remote_user = "remote-user"
        with patch.object(os, "write", side_effect=AssertionError("Old PTY must not receive authentication")), patch.object(console, "Session", side_effect=AssertionError("Must not authenticate locally for a remote target")):
            with self.assertRaisesRegex(ValueError, "existing SSH terminal"):
                session.elevate("sudo", "root")


if __name__ == "__main__":
    unittest.main(verbosity=2)
