"""Unix peer-PID boundary: only the actual trusted Metis app may forward requests.

Native model children share a Unix UID with the app today. UID/group permission
alone is therefore insufficient. This broker checks kernel SO_PEERCRED against
systemd's current MainPID, never a PID/identity supplied in the request body.
No request, password or response body is logged.
"""
import os
import select
import socket
import socketserver
import struct
import subprocess

PUBLIC = os.path.join(os.environ.get("RUNTIME_DIRECTORY", "/run/metis-browser-login"), "client.sock")
PRIVATE = os.path.join(os.environ.get("STATE_DIRECTORY", "/var/lib/metis-browser-login"), "engine.sock")
APP_UNIT = os.environ.get("METIS_BROWSER_LOGIN_APP_UNIT", "metis-native-production-app.service")


def trusted_app(pid):
    try:
        result = subprocess.run(
            ["/usr/bin/systemctl", "show", APP_UNIT, "--property=MainPID", "--value"],
            capture_output=True, text=True, check=True, timeout=2,
        )
        return pid > 1 and pid == int(result.stdout.strip())
    except Exception:
        return False


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        client = self.request
        pid, _uid, _gid = struct.unpack("3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
        if not trusted_app(pid):
            client.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            return
        try:
            with socket.socket(socket.AF_UNIX) as upstream:
                upstream.settimeout(60)
                upstream.connect(PRIVATE)
                peers = [client, upstream]
                while True:
                    ready, _, _ = select.select(peers, [], [], 60)
                    if not ready:
                        return
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        (upstream if source is client else client).sendall(data)
        except (OSError, TimeoutError):
            return


if __name__ == "__main__":
    if os.getuid() == 0:
        raise SystemExit("Dedicated non-root identity required")
    if os.path.exists(PUBLIC):
        os.unlink(PUBLIC)
    with socketserver.ThreadingUnixStreamServer(PUBLIC, Handler) as server:
        os.chmod(PUBLIC, 0o660)
        server.daemon_threads = True
        server.serve_forever()
