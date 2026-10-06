"""Shared paths and helpers for the build pipeline."""
import json
import re
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "public" / "data"
METRIC_CRS = "EPSG:32618"  # UTM 18N, meters
MILE = 1609.344

WORK.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

LEVELS = ("ES", "MS", "HS")
GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]


def read(name, crs=METRIC_CRS):
    g = gpd.read_file(RAW / f"{name}.geojson")
    if g.crs is None:
        g = g.set_crs(4326)
    return g.to_crs(crs) if crs else g


def norm_name(s):
    """Normalize a school name so CIP, GIS, bell-schedule and NCES names line up."""
    s = (s or "").lower().replace("’", "'").replace("&", "and")
    s = re.sub(r"\b(elementary|middle|high|secondary|school|es|ms|hs|ss)\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\bmount\b", "mt", s)
    s = re.sub(r"\bsaint\b", "st", s)
    return re.sub(r"\s+", " ", s).strip()


def grade_range(g):
    """'K-6' -> (0, 6); '7-8' -> (7, 8); '9-12' -> (9, 12)."""
    g = (g or "").upper().replace("PK", "K").replace(" ", "")
    m = re.match(r"(K|\d+)-(\d+)", g)
    if not m:
        return None
    lo = 0 if m.group(1) == "K" else int(m.group(1))
    return lo, int(m.group(2))


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.2f} MB)")
