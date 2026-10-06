"""Download raw public data for the FCPS Boundary Explorer.

All layers come from Fairfax County's public ArcGIS Online org and NCES.
Outputs land in data/raw/ (git-ignored). Re-run safely: existing files are skipped
unless --force is given.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
AGOL = "https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services"
NCES = "https://nces.ed.gov/ccd/Data/zip"
FAIRFAX_LEAID = "5101260"

# name -> (service path, out fields)
LAYERS = {
    "spa_2026": ("Student_Planning_Areas/FeatureServer/0", "*"),
    "es_2026": ("Elementary_School_Attendance_Areas/FeatureServer/0", "SCHOOL_NAME,SCHID_3,GRADES,REGION,SCH_YR"),
    "ms_2026": ("Middle_School_Attendance_Areas/FeatureServer/0", "SCHOOL_NAME,SCHID_3,GRADES,REGION,SCH_YR"),
    "hs_2026": ("High_School_Attendance_Areas/FeatureServer/0", "SCHOOL_NAME,SCHID_3,GRADES,REGION,SCH_YR"),
    "es_2025": ("OpenData_S1/FeatureServer/13", "*"),
    "ms_2025": ("OpenData_S1/FeatureServer/11", "*"),
    "hs_2025": ("OpenData_S1/FeatureServer/12", "*"),
    "es_aap": ("Elementary_School_AAP_Attendance_Areas_/FeatureServer/0", "SCHOOL_NAME,SCHID_3,SCH_YR"),
    "ms_aap": ("Middle_School_AAP_Attendance_Areas/FeatureServer/0", "SCHOOL_NAME,SCHID_3,SCH_YR"),
    "schools": ("School_Facilities/FeatureServer/0", "SCHOOL_NAME,SCHID_3,GRADES,SCHOOL_TYPE,TYPE_DESC,ADDRESS,CITY,REGION,SCH_YR,HOME_URL"),
    "title1": ("FCPS_Title_1/FeatureServer/0", "SCHOOL_NAME,SCHID_3,TitleI"),
    "county": ("Fairfax_County_Boundary/FeatureServer/0", "NAME"),
    "jurisdictions": ("OpenData_S1/FeatureServer/16", "TYPE,NAME,INFAIRFAX"),
    "roads": ("Roadways/FeatureServer/0",
              "SEGID,FULLNAME,ROAD_CLASS,FFX_CLASS,SPEED_LIMIT_CAR,ONEWAY,DIVIDED,BRIDGE,STATUS,AUTHORIZE_USE,ROUTE_ALIAS,L_JURISDICTION,R_JURISDICTION"),
    "sidewalks": ("Sidewalks_Centerline/FeatureServer/0", "TYPE"),
    "trails_county": ("OpenData_A1/FeatureServer/3", "TRAIL_NAME,SURFACE_MATERIAL,STEPS"),
    "trails_other": ("OpenData_A1/FeatureServer/4", "TRAIL_NAME,SURFACE_MATERIAL"),
    "rail": ("Railroad_Lines/FeatureServer/0", "NAME,TYPE"),
    "streams": ("OpenData_S14/FeatureServer/0", "NAME,FTYPE"),
    "housing_units": ("OpenData_S7/FeatureServer/1", "PIN,CURRE_UNIT,HOUSI_UNIT_TYPE,YEAR_BUILT"),
    "population": ("OpenData_S7/FeatureServer/0", "PIN,CURRE_POPUL"),
    "housing_forecast": ("OpenData_S6/FeatureServer/0",
                         "PIN,HOUSI_UNIT_TYPE,CURRE_YEAR_1_UNIT,CURRE_YEAR_2_UNIT,CURRE_YEAR_3_UNIT,CURRE_YEAR_4_UNIT,CURRE_YEAR_5_UNIT,CURRE_YEAR_6_UNIT"),
}

NCES_FILES = {
    "ccd_lunch_2425": "ccd_sch_033_2425_l_1a_073025.zip",
    "ccd_membership_2425": "ccd_sch_052_2425_l_1a_073025.zip",
    "ccd_directory_2425": "ccd_sch_029_2425_w_1a_073025.zip",
}


def get(url, data=None, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "fcps-boundary-explorer/0.1"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # network hiccup: back off and retry
            if i == tries - 1:
                raise
            print(f"  retry {i + 1} after {e}", file=sys.stderr)
            time.sleep(2 ** (i + 1))


def fetch_layer(name, path, fields, force=False):
    out = RAW / f"{name}.geojson"
    if out.exists() and not force:
        print(f"skip {name}")
        return
    base = f"{AGOL}/{path}"
    meta = json.loads(get(f"{base}?f=json"))
    page = min(meta.get("maxRecordCount", 1000), 2000)
    count = json.loads(get(f"{base}/query?where=1%3D1&returnCountOnly=true&f=json"))["count"]
    feats = []
    for offset in range(0, count, page):
        q = urllib.parse.urlencode({
            "where": "1=1", "outFields": fields, "outSR": 4326, "f": "geojson",
            "resultOffset": offset, "resultRecordCount": page, "orderByFields": meta.get("objectIdField", "OBJECTID"),
        })
        chunk = json.loads(get(f"{base}/query?{q}"))
        if "error" in chunk:
            raise RuntimeError(f"{name}: {chunk['error']}")
        feats.extend(chunk.get("features", []))
        print(f"\r{name}: {len(feats)}/{count}", end="", flush=True)
    print()
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))


def fetch_nces(name, fname, force=False):
    out = RAW / f"{name}.csv"
    if out.exists() and not force:
        print(f"skip {name}")
        return
    print(f"downloading {fname}")
    zpath = RAW / fname
    if not zpath.exists():
        zpath.write_bytes(get(f"{NCES}/{fname}"))
    # NCES zips can use Deflate64, which Python's zipfile cannot read: stream through `unzip -p`
    member = next(m for m in zipfile.ZipFile(zpath).namelist() if m.lower().endswith(".csv"))
    proc = subprocess.Popen(["unzip", "-p", str(zpath), member], stdout=subprocess.PIPE)
    with out.open("w") as w:
        header = proc.stdout.readline().decode("latin-1")
        w.write(header)
        idx = header.strip().split(",").index("LEAID")
        for raw in proc.stdout:
            line = raw.decode("latin-1")
            if line.split(",")[idx].strip('"') == FAIRFAX_LEAID:
                w.write(line)
    proc.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("only", nargs="*", help="subset of layer names")
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    for name, (path, fields) in LAYERS.items():
        if not a.only or name in a.only:
            fetch_layer(name, path, fields, a.force)
    for name, fname in NCES_FILES.items():
        if not a.only or name in a.only:
            fetch_nces(name, fname, a.force)


if __name__ == "__main__":
    main()
