#!/usr/bin/python3
"""Fail-closed, positive-list filesystem/PID boundary for native providers.

The trusted parent supplies only owner-bound mount paths. Credentials must be
passed separately in a scrubbed child environment or stdio, never in policy.
No policy, command, environment or provider output is logged here.
"""
import json
import ctypes
import os
from pathlib import Path
import pwd
import re
import platform
import struct
import stat
import sys


DENIED_ROOTS = {"/", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc",
                "/proc", "/dev", "/run", "/tmp", "/var", "/var/tmp",
                "/home", "/root", "/srv", "/srv/metis", "/opt"}
APPLICATION_ENV = {"MCP_BEARER_TOKEN", "AI_CHAT_INTERNAL_TOKEN", "CHAT_PASSWORD",
                   "CHAT_DB_PATH", "CHAT_DATA_DIR", "AI_CHAT_MCP_STATE_DIR",
                   "DATABASE_URL", "NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH",
                   "PYTHONPATH", "PYTHONHOME"}


def inside(child, parent):
    return child == parent or child.startswith(parent + os.sep)


def canonical(value):
    if not isinstance(value, str) or not value.startswith("/") or "\0" in value:
        raise ValueError()
    resolved = str(Path(value).resolve(strict=True))
    if resolved != value:
        raise ValueError()
    return resolved


def paths(value):
    if not isinstance(value, list) or len(value) > 64:
        raise ValueError()
    result = list(dict.fromkeys(canonical(item) for item in value))
    if any(item in DENIED_ROOTS or not Path(item).is_dir() for item in result):
        raise ValueError()
    return result


def build(policy, command):
    if os.getuid() == 0 or not isinstance(policy, dict) or not command:
        raise ValueError()
    if set(policy) != {"owner", "cwd", "home", "rw", "ro", "protected"}:
        raise ValueError()
    if not isinstance(policy["owner"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", policy["owner"]):
        raise ValueError()
    rw, ro = paths(policy["rw"]), paths(policy["ro"])
    # Bind mounts cannot hide a sensitive inode already hardlinked into an
    # allowed directory by an older, unsandboxed process. Fail closed rather
    # than silently copying that inode (which would preserve the disclosure).
    remaining = 500000
    for root in rw:
        for directory, dirs, files in os.walk(root, followlinks=False):
            remaining -= len(dirs) + len(files) + 1
            if remaining < 0:
                raise ValueError()
            for name in files:
                try:
                    info = os.stat(os.path.join(directory, name), follow_symlinks=False)
                except (FileNotFoundError, PermissionError):
                    continue
                if stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink > 1:
                    raise ValueError()
    if not rw or not isinstance(policy["protected"], list) or not policy["protected"]:
        raise ValueError()
    protected = [canonical(item) for item in policy["protected"]]
    # A user's session/home may be BELOW a protected data root, but exposing
    # that protected root or an ancestor would expose other tenants as well.
    if any(inside(secret, mount) for mount in rw + ro for secret in protected):
        raise ValueError()
    if any(inside(a, b) or inside(b, a) for a in rw for b in ro):
        raise ValueError()
    home, cwd = canonical(policy["home"]), canonical(policy["cwd"])
    if not Path(home).is_dir() or not any(inside(home, mount) for mount in rw):
        raise ValueError()
    if not Path(cwd).is_dir() or not any(inside(cwd, mount) for mount in rw + ro):
        raise ValueError()
    executable = str(Path(command[0]).resolve(strict=True))
    if not Path(executable).is_file() or not os.access(executable, os.X_OK):
        raise ValueError()
    if not inside(executable, "/usr") and not any(inside(executable, mount) for mount in rw + ro):
        raise ValueError()
    args = ["/usr/bin/bwrap", "--unshare-user", "--unshare-pid", "--unshare-ipc",
            "--unshare-uts", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
            "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
            "--symlink", "usr/sbin", "/sbin", "--symlink", "usr/lib", "/lib",
            "--symlink", "usr/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev",
            "--tmpfs", "/tmp", "--tmpfs", "/run", "--dir", "/etc"]
    for name in ["resolv.conf", "hosts", "nsswitch.conf", "passwd", "group", "ssl",
                 "alternatives", "ld.so.cache", "localtime"]:
        source = "/etc/" + name
        if os.path.exists(source):
            args += ["--ro-bind", source, source]
    # Parent directories are private empty directories created by bwrap; no
    # host parent is bound merely to reach a nested allowlisted mount.
    for item in ro:
        args += ["--ro-bind", item, item]
    for item in rw:
        args += ["--bind", item, item]
    username = pwd.getpwuid(os.getuid()).pw_name
    args += ["--chdir", cwd, "--setenv", "HOME", home, "--setenv", "USER", username,
             "--setenv", "LOGNAME", username, "--", executable, *command[1:]]
    return args


def client_network_filter():
    """Allow outbound API/MCP clients, never expose an SDK control listener."""
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        arch, denied = 0xC000003E, [50, 43, 288, 425, 426, 427]
    elif machine in {"aarch64", "arm64"}:
        arch, denied = 0xC00000B7, [201, 202, 242, 425, 426, 427]
    else:
        raise ValueError()
    # Deny io_uring as well: async socket operations must not bypass the
    # listen/accept filter. Standard API clients use ordinary socket syscalls.
    instructions = [(0x20, 0, 0, 4), (0x15, 1, 0, arch),
                    (0x06, 0, 0, 0x80000000), (0x20, 0, 0, 0)]
    if arch == 0xC000003E:
        # x32 uses the same audit arch with different syscall numbers.
        instructions += [(0x45, 0, 1, 0x40000000), (0x06, 0, 0, 0x00050001)]
    for syscall in denied:
        instructions += [(0x15, 0, 1, syscall), (0x06, 0, 0, 0x00050001)]
    instructions += [(0x06, 0, 0, 0x7FFF0000)]
    fd = os.memfd_create("metis-native-client-filter", 0)
    os.write(fd, b"".join(struct.pack("HBBI", *item) for item in instructions))
    os.lseek(fd, 0, os.SEEK_SET); os.set_inheritable(fd, True)
    return fd


def main():
    try:
        if len(sys.argv) < 3 or len(sys.argv[1]) > 32768:
            raise ValueError()
        args = build(json.loads(sys.argv[1]), sys.argv[2:])
        if ctypes.CDLL(None).prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
            raise ValueError()
        for key in list(os.environ):
            if key in APPLICATION_ENV or key.startswith("METIS_VAULT_"):
                os.environ.pop(key, None)
        # SDKs must not accidentally pass a host file/directory descriptor into
        # the namespace. Standard streams are the sole parent IPC channels.
        for item in os.listdir("/proc/self/fd"):
            fd = int(item)
            if fd > 2:
                try:
                    os.close(fd)
                except OSError:
                    pass
        args[1:1] = ["--seccomp", str(client_network_filter())]
        os.execv(args[0], args)
    except Exception:
        sys.stderr.write("Native runtime isolation policy denied.\n")
        raise SystemExit(126)


if __name__ == "__main__":
    main()
