#!/usr/bin/python3 -I
"""SDK executable seam; no credential is placed in argv or policy."""
import os
from pathlib import Path
import sys
try:
    policy=os.environ.pop("METIS_NATIVE_POLICY")
    executable=os.environ.pop("METIS_NATIVE_EXECUTABLE")
except KeyError:
    raise SystemExit("Native account scope required")
os.execv("/usr/bin/python3",["/usr/bin/python3","-I","-S",str(Path(__file__).resolve().with_name("launch.py")),policy,executable,*sys.argv[1:]])
