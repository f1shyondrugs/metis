"""Private PTY authentication broker. No password in commands, env or logs.

Only the isolated credential service UID may call this socket. Commands cannot
run before an independently constructed ssh/su/sudo authentication completes.
Existing arbitrary terminals are deliberately not accepted as password sinks.
"""
import base64
import codecs
import hashlib
import http.server
import json
import os
import pty
import pwd
import re
import select
import shlex
import signal
import socket
import socketserver
import struct
import subprocess
import termios
import threading
import time
import urllib.parse
import uuid
from pathlib import Path

STATE = Path(os.environ.get("STATE_DIRECTORY", "/var/lib/metis-secure-console"))
RUNTIME = Path(os.environ.get("RUNTIME_DIRECTORY", "/run/metis-secure-console"))
SESSIONS = {}
LOCK = threading.RLock()
USER = re.compile(r"^[a-z_][a-z0-9_.-]{0,63}$")
HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$")
ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(r"[\w-]{1,200}", value):
        raise ValueError("Invalid identity")
    return value


def host_key(host, port):
    result = subprocess.run(["/usr/bin/ssh-keyscan", "-T", "3", "-p", str(port), "-t", "ed25519,rsa,ecdsa", host], capture_output=True, text=True, timeout=12)
    keys = [line.split() for line in result.stdout.splitlines() if line and not line.startswith("#")]
    keys = [parts for parts in keys if len(parts) == 3 and parts[1] in {"ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"}]
    if not keys:
        raise ValueError("SSH host key unavailable")
    public = sorted(keys, key=lambda parts: parts[1] != "ssh-ed25519")[0]
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(base64.b64decode(public[2])).digest()).decode().rstrip("=")
    address = host if port == 22 else f"[{host}]:{port}"
    return f"{address} {public[1]} {public[2]}\n", fingerprint


class Session:
    def __init__(self, owner, chat, method, account, host=None, port=22, transport=None):
        if method not in {"ssh", "sudo", "su"} or not USER.fullmatch(account):
            raise ValueError("Invalid authentication")
        self.owner, self.chat, self.method, self.account = owner, chat, method, account
        self.id, self.nonce = str(uuid.uuid4()), uuid.uuid4().hex
        self.buffer, self.secrets, self.pending_output = "", [], ""
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.pending_ansi = ""
        self.ready, self.closed, self.used = False, False, time.time()
        self.request, self.filled = None, False
        self.host = host.lower() if host else socket.gethostname()
        self.port, self.fingerprint = port, "local"
        self.remote_user = account if method == "ssh" else None
        marker = f"METIS_AUTH_{self.nonce}"
        self.marker = marker
        shell = f"printf '\\036{marker}\\037'; exec /bin/bash --noprofile --norc"
        if method == "ssh":
            if not host or not HOST.fullmatch(host) or not 1 <= port <= 65535:
                raise ValueError("Invalid SSH target")
            known, self.fingerprint = host_key(host, port)
            known_path = STATE / (self.id + ".known_hosts")
            known_path.write_text(known); os.chmod(known_path, 0o600)
            self.known_path = known_path
            command = ["/usr/bin/ssh", "-F", "/dev/null", "-tt", "-p", str(port), "-o", "BatchMode=no", "-o", "PubkeyAuthentication=no", "-o", "IdentityAgent=none", "-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "NumberOfPasswordPrompts=1", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={known_path}", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10", "-o", "ClearAllForwardings=yes", "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "PermitLocalCommand=no", "-o", "ControlMaster=no", f"{account}@{host}", "/bin/sh -c " + shlex.quote(shell)]
            auth_user = account
        elif method == "su":
            command = ["/usr/bin/su", "-", account, "-s", "/bin/bash", "-c", shell]
            auth_user = account
        else:
            command = ["/usr/bin/sudo", "-k", "-p", f"METIS_PASSWORD_{self.nonce}: ", "-u", account, "--", "/bin/bash", "--noprofile", "--norc", "-c", shell]
            auth_user = pwd.getpwuid(os.getuid()).pw_name
        self.auth_user = auth_user
        self.target = json.dumps([method, self.host, port if method == "ssh" else 0, auth_user, account, self.fingerprint], separators=(",", ":"))
        self.label = f"{method}: {auth_user}@{self.host}" + (f":{port}" if method == "ssh" else f" → {account}")
        if method == "ssh": self.label += " · " + self.fingerprint
        pid, master = pty.fork()
        if pid == 0:
            os.chdir(str(STATE))
            environment = {"PATH": "/usr/bin:/bin", "TERM": "xterm-256color", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "HISTFILE": "/dev/null", "HOME": str(STATE)}
            os.execve(command[0], command, environment)
        self.pid, self.master = pid, master
        self.lock = threading.RLock()
        self.reader = threading.Thread(target=self.collect, daemon=True)
        self.reader.start()

    def collect(self):
        try:
            while not self.closed:
                if not select.select([self.master], [], [], 1)[0]: continue
                if self.closed: break
                data = os.read(self.master, 8192)
                if not data: break
                with self.lock:
                    self.append_output(self.decoder.decode(data))
        except OSError:
            pass
        finally:
            self.closed = True

    def redact(self, text):
        """Hold suffixes that can still become a known secret, including at EOF."""
        variants = set()
        for secret in self.secrets:
            variants.update([secret, urllib.parse.quote(secret, safe=""), base64.b64encode(secret.encode()).decode(), secret.encode().hex()])
        variants.discard("")
        output, position = [], 0
        maximum = max(map(len, variants), default=0)
        while position < len(text):
            # Only the final max-length suffix can be an incomplete match.
            tail = text[position:] if len(text) - position < maximum else ""
            if tail and any(len(tail) < len(value) and value.startswith(tail) for value in variants):
                return "".join(output), tail
            matched = max((value for value in variants if text.startswith(value, position)), key=len, default=None)
            if matched:
                output.append("[REDACTED]")
                position += len(matched)
            else:
                output.append(text[position])
                position += 1
        return "".join(output), ""

    def append_output(self, text):
        # Normalize terminal escapes before matching, including split sequences.
        text = self.pending_ansi + text
        self.pending_ansi = ""
        escape = text.rfind("\x1b")
        if escape >= 0 and not ANSI.match(text, escape):
            suffix, text = text[escape:], text[:escape]
            if len(suffix) <= 4096: self.pending_ansi = suffix
        text = ANSI.sub("", text)
        # Redact before retention limits so trimming never exposes a secret tail.
        emitted, self.pending_output = self.redact(self.pending_output + text)
        self.buffer += emitted
        marker = "\x1e" + self.marker + "\x1f"
        if marker in self.buffer:
            self.ready = True
            self.buffer = self.buffer.replace(marker, "")
        self.buffer = self.buffer[-200000:]

    def clean(self):
        # Defense in depth for output retained before credential entry.
        normalized = ANSI.sub("", self.buffer).replace("\x1e", "").replace("\x1f", "")
        output, _pending = self.redact(normalized)
        return output[-60000:]

    def waiting(self):
        if self.ready or self.closed: return False
        try: echo = bool(termios.tcgetattr(self.master)[3] & termios.ECHO)
        except termios.error: return False
        prompt = re.search(r"(?:password|passwort|METIS_PASSWORD_[a-f0-9]+)[^\r\n]*[:：]\s*$", ANSI.sub("", self.buffer), re.I)
        return not echo and bool(prompt)

    def prepare(self):
        until = time.monotonic() + 12
        while not self.ready and not self.closed and not self.waiting() and time.monotonic() < until: time.sleep(0.05)
        if self.ready and not self.closed: return {"status": "console_ready", "sessionId": self.id, "target": self.target, "label": self.label}
        if not self.waiting(): return {"status": "console_unavailable", "output": self.clean(), "sessionId": self.id}
        self.request = str(uuid.uuid4()); self.filled = False; self.expires = time.time() + 300
        return {"status": "input_required", "target": self.target, "label": self.label, "sessionId": self.id, "secureInput": {"requestId": self.request, "origin": self.label, "kind": "console", "sessionId": self.id, "expiresAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.expires))}}

    def elevate(self, method, account):
        if not self.ready or self.closed or method not in {"sudo", "su"} or not USER.fullmatch(account):
            raise ValueError("Authenticated console required")
        if self.remote_user:
            raise ValueError("Protected elevation over an existing SSH terminal is unavailable; connect directly to the target account")
        # A prior command may own the old PTY. Never send it an authentication
        # command or a password. Start a fixed binary in a fresh broker-owned PTY.
        # sudo authenticates the service account; su authenticates the target.
        replacement = Session(self.owner, self.chat, method, account)
        self.close()
        return replacement

    def fill(self, request, password):
        with self.lock:
            if request != self.request or self.filled or time.time() >= self.expires or not self.waiting(): raise ValueError("No verified password prompt")
            if not isinstance(password, str) or not password or len(password) > 4096 or any(ord(char)<32 or ord(char)==127 for char in password): raise ValueError("Invalid password")
            self.secrets.append(password); self.filled = True
            os.write(self.master, password.encode() + b"\n")
        return {"status": "password_entered"}

    def close(self):
        if getattr(self, "disposed", False): return
        self.disposed = True
        self.closed = True
        try: os.killpg(self.pid, signal.SIGHUP)
        except OSError: pass
        try: os.close(self.master)
        except OSError: pass
        try: os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError: pass
        self.reader.join(timeout=1.2)
        if hasattr(self, "known_path"): self.known_path.unlink(missing_ok=True)


def dispatch(body):
    owner, chat = identity(body.get("owner")), identity(body.get("chat"))
    operation, value = body.get("operation"), body.get("input") or {}
    key = (owner, chat)
    with LOCK:
        for old_key, old in list(SESSIONS.items()):
            if time.time() - old.used > 1800: old.close(); del SESSIONS[old_key]
        session = SESSIONS.get(key)
        if operation == "prepare":
            if not session or value.get("replaceSession"):
                if session: session.close()
                if len(SESSIONS) >= 16: raise ValueError("Console limit")
                session = Session(owner, chat, value.get("method"), value.get("user"), value.get("host"), int(value.get("port", 22)))
                SESSIONS[key] = session
            return session.prepare()
        if not session: raise ValueError("Console unavailable")
        session.used = time.time()
        if operation == "elevate":
            if session.remote_user:
                return {"status": "console_unavailable", "reason": "Protected elevation inside an existing SSH session is unavailable. Connect directly to the target SSH account."}
            replacement = session.elevate(value.get("method"), value.get("user"))
            SESSIONS[key] = replacement
            return replacement.prepare()
        if operation == "fill": return session.fill(value.get("requestId"), value.get("password"))
        if operation == "status": return {"filled": session.filled and value.get("requestId") == session.request and time.time()<getattr(session,"expires",0)}
        if operation == "read":
            time.sleep(max(0, min(2, float(value.get("waitMs", 0)) / 1000)))
            with session.lock: return {"sessionId": session.id, "authenticated": session.ready and not session.closed, "closed": session.closed, "passwordRequired": session.waiting(), "output": session.clean()}
        if operation == "input":
            command = value.get("command")
            if not session.ready or session.closed or not isinstance(command, str) or len(command) > 16000: raise ValueError("Authenticated console required")
            os.write(session.master, command.encode() + b"\n"); return {"status": "sent"}
        if operation == "close": session.close(); del SESSIONS[key]; return {"status": "closed"}
        raise ValueError("Unsupported operation")


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args): pass
    def do_POST(self):
        try:
            _pid, uid, _gid = struct.unpack("3i", self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
            if uid != pwd.getpwnam("metis-browser-login").pw_uid: raise ValueError("Denied peer")
            length = int(self.headers.get("Content-Length", "0"))
            if self.path != "/" or not 0 < length <= 32768: raise ValueError("Invalid request")
            result = dispatch(json.loads(self.rfile.read(length)))
            self.send_response(200)
        except Exception:
            result = {"error": "Secure console operation denied"}; self.send_response(403)
        encoded = json.dumps(result).encode()
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(encoded))); self.send_header("Connection", "close"); self.end_headers(); self.wfile.write(encoded)


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


if __name__ == "__main__":
    if os.getuid() == 0: raise SystemExit("Dedicated unprivileged console UID required")
    target = RUNTIME / "engine.sock"
    if target.exists(): target.unlink()
    with Server(str(target), Handler) as server:
        os.chmod(target, 0o660)
        server.serve_forever()
