"""Run the whole data pipeline: fetch -> schools -> students -> network -> export.

    python pipeline/build.py            # everything (downloads are cached in data/raw/)
    python pipeline/build.py --from students
"""
import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGES = ["fetch", "schools", "students", "network", "export"]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", choices=STAGES, default="fetch")
    a = ap.parse_args()
    for stage in STAGES[STAGES.index(a.start):]:
        print(f"== {stage}", flush=True)
        r = subprocess.run([sys.executable, str(HERE / f"{stage}.py")], cwd=HERE)
        if r.returncode:
            sys.exit(r.returncode)
