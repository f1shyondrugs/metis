#!/usr/bin/env python3
"""Stage-only, fail-closed patch for icloud-calendar-mcp 0.1.3. Dry-run default."""
import argparse
from pathlib import Path
import sys

OLD = '''        if (response.status === 401 || response.status === 403) {
            throw new CalendarError("AUTH_FAILED", `iCloud authentication or authorization failed (HTTP ${response.status})`);
        }'''
NEW = '''        if (response.status === 401) {
            throw new CalendarError("AUTH_FAILED", "iCloud authentication failed (HTTP 401)");
        }
        if (response.status === 403) {
            throw new CalendarError("PERMISSION_DENIED", "iCloud denied access (HTTP 403); check calendar permissions or account policy");
        }'''

def transform(client, types):
    if client.count(OLD) != 1 or types.count('"AUTH_FAILED"') != 1 or '"PERMISSION_DENIED"' in types:
        raise ValueError("Unsupported or already patched connector")
    return client.replace(OLD, NEW), types.replace('"AUTH_FAILED"', '"AUTH_FAILED" | "PERMISSION_DENIED"', 1)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="Disposable staged package directory, not the live installation")
    parser.add_argument("--apply-staged", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = args.package.resolve()
        live = Path("/root/.local/share/metis-integrations").resolve()
        if root == live or live in root.parents:
            raise ValueError("Live integration paths are forbidden")
        paths = [root / "dist/caldav/client.js", root / "dist/domain/errors.d.ts"]
        if any(p.is_symlink() or not p.resolve().is_relative_to(root) for p in paths):
            raise ValueError("Symlink escape is forbidden")
        updated = transform(*(p.read_text() for p in paths))
        if args.apply_staged:
            for p, value in zip(paths, updated):
                p.write_text(value)
        print("STAGED_PATCH_APPLIED" if args.apply_staged else "DRY_RUN_VALID")
        return 0
    except (OSError, ValueError):
        # Never echo source, exception messages, response payloads or paths.
        print("PATCH_REFUSED: unsupported source or unsafe staging path", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
