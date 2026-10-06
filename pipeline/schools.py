"""Build the school master table.

One row per *program school* (the IDs used by attendance areas and SPAs), joined to:
  - facility point (School_Facilities layer, matched by name + level)
  - CIP FY2027-31 capacity / membership / projections
  - 2024-25 bell schedule start time
  - NCES CCD 2024-25 FRL and race counts
  - Title I flag
"""
import json
import re

import pandas as pd

from common import RAW, WORK, grade_range, norm_name, read

# NCES spellings -> GIS spellings
CCD_ALIAS = {"sherman": "franklin sherman", "archer": "louise archer", "johnson": "katherine johnson",
             "fort belvoir": "fort belvoir primary"}
# bell-schedule spellings -> GIS spellings
BELL_ALIAS = {"colin powell": "powell", "olde creeke": "olde creek", "pine springs": "pine spring",
              "jefferson": "thomas jefferson", "fort belvoir": "fort belvoir upper"}


def attendance_schools():
    """Program schools from the 2026-27 attendance layers (2025-26 names are identical)."""
    rows = {}
    for lvl in ("es", "ms", "hs"):
        for _, r in read(f"{lvl}_2026", crs=None).iterrows():
            sid = int(r["SCHID_3"])
            rows[sid] = {"id": sid, "name": str(r["SCHOOL_NAME"]).strip(), "level": lvl.upper(),
                         "grades": r.get("GRADES"), "region": r.get("REGION"), "years": [2025, 2026]}
    return rows


def parse_bell():
    """School -> general-ed start time in minutes after midnight (2024-25)."""
    out = {}
    pat = re.compile(r"^\s*(\d)\s+(.+?(?:ES|MS|HS|SS|Center|School))\s+(\d)\s+([A-Za-z/][A-Za-z/ ]*?)?\s*(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})")
    for line in (RAW / "bell.txt").read_text().splitlines():
        m = pat.match(line)
        if not m:
            continue
        name, prog = m.group(2).strip(), (m.group(4) or "").strip()
        if prog.startswith("PS") or prog == "PAC":
            continue
        h, mi = int(m.group(5)), int(m.group(6))
        n = norm_name(name)
        n = BELL_ALIAS.get(n, n)
        key = (n, name.split()[-1])
        if key not in out or prog == "":
            out[key] = h * 60 + mi
    return out


def parse_ccd():
    """NCES CCD 2024-25: school name -> FRL count, membership by race."""
    lunch = pd.read_csv(RAW / "ccd_lunch_2425.csv", dtype=str)
    memb = pd.read_csv(RAW / "ccd_membership_2425.csv", dtype=str)
    out = {}
    lunch["STUDENT_COUNT"] = pd.to_numeric(lunch["STUDENT_COUNT"], errors="coerce")
    frl = lunch[lunch["LUNCH_PROGRAM"].str.contains("Free and Reduced-price Lunch Table", na=False)]
    if frl.empty:
        frl = lunch[lunch["LUNCH_PROGRAM"].isin(["Free lunch qualified", "Reduced-price lunch qualified"])]
    for name, n in frl.groupby("SCH_NAME")["STUDENT_COUNT"].sum().items():
        out.setdefault(name, {})["frl"] = float(n)
    memb["STUDENT_COUNT"] = pd.to_numeric(memb["STUDENT_COUNT"], errors="coerce")
    m = memb[(memb["TOTAL_INDICATOR"].str.startswith("Category Set A", na=False))]
    race_map = {
        "Asian": "asian", "Black or African American": "black", "Hispanic/Latino": "hispanic",
        "White": "white", "Two or more races": "multi",
        "American Indian or Alaska Native": "other", "Native Hawaiian or Other Pacific Islander": "other",
        "Not Specified": "other",
    }
    for (name, race), n in m.groupby(["SCH_NAME", "RACE_ETHNICITY"])["STUDENT_COUNT"].sum().items():
        k = race_map.get(race)
        if k:
            d = out.setdefault(name, {})
            d[k] = d.get(k, 0) + float(n)
    tot = memb[memb["TOTAL_INDICATOR"].str.startswith("Education Unit Total", na=False)]
    for name, n in tot.groupby("SCH_NAME")["STUDENT_COUNT"].sum().items():
        out.setdefault(name, {})["total"] = float(n)
    return out


def build():
    schools = attendance_schools()
    fac = read("schools", crs=4326)
    fac_idx = {}
    for _, r in fac.iterrows():
        if r["SCHOOL_TYPE"] in ("ES", "MS", "HS") and r.geometry is not None:
            fac_idx[(norm_name(r["SCHOOL_NAME"]), r["SCHOOL_TYPE"])] = r.to_dict()

    # Upper ES and TJHSST do not have their own attendance polygons; add from facilities.
    spa = read("spa_2026", crs=None)
    for _, r in spa.drop_duplicates("UP_ES_ID").iterrows():
        if int(r["UP_ES_ID"]) and int(r["UP_ES_ID"]) not in schools:
            schools[int(r["UP_ES_ID"])] = {"id": int(r["UP_ES_ID"]), "name": r["UP_ES_NAME"].strip(),
                                          "level": "ES", "grades": None, "region": r["REGION"], "years": [2025, 2026],
                                          "upper": True}
    schools[300] = {"id": 300, "name": "Thomas Jefferson", "level": "HS", "grades": "9-12", "region": None,
                    "years": [2025, 2026], "magnet": True}

    cip = {(norm_name(c["name"]), c["name"].split()[-1]): c for c in json.loads((RAW / "cip_capacity.json").read_text())}
    bell = parse_bell()
    ccd = parse_ccd() if (RAW / "ccd_lunch_2425.csv").exists() else {}
    ccd_idx = {}
    for name, d in ccd.items():
        n = norm_name(re.sub(r" (School )?for the Arts and Sciences| for Science and Technology", "", name))
        n = CCD_ALIAS.get(n, n)
        lvl = "ES" if "elem" in name.lower() else "MS" if "middle" in name.lower() else "HS" if "high" in name.lower() else "SS" if "secondary" in name.lower() else "?"
        ccd_idx[(n, lvl)] = d
    title1 = {norm_name(r["SCHOOL_NAME"]) for _, r in read("title1", crs=None).iterrows() if str(r.get("TitleI", "")).strip().upper() in ("Y", "YES", "1", "TRUE")}

    missing = {"facility": [], "cip": [], "bell": [], "ccd": []}
    out = []
    for sid, s in sorted(schools.items()):
        n, lvl = norm_name(s["name"]), s["level"]
        f = fac_idx.get((n, lvl)) or fac_idx.get((n, "HS" if lvl == "MS" else lvl))
        if f is None and s.get("upper"):
            f = fac_idx.get((norm_name(s["name"].replace("Upper", "")) + " upper", lvl)) or fac_idx.get((n, lvl))
        if f is None:
            missing["facility"].append(s["name"])
            continue
        grades = s["grades"] if s["grades"] and s["grades"] != "N/A" else f["GRADES"]
        c = cip.get((n, lvl)) or cip.get((n, "SS"))
        if c is None:
            missing["cip"].append(f"{s['name']} {lvl}")
        b = bell.get((n, lvl)) or bell.get((n, "SS"))
        if b is None:
            missing["bell"].append(f"{s['name']} {lvl}")
        d = ccd_idx.get((n, lvl)) or ccd_idx.get((n, "SS"))
        if d is None:
            missing["ccd"].append(f"{s['name']} {lvl}")
        gr = grade_range(grades)
        out.append({
            "id": sid, "name": s["name"], "level": lvl, "grades": grades,
            "gmin": gr[0] if gr else None, "gmax": gr[1] if gr else None,
            "region": int(s["region"]) if s.get("region") not in (None, "") and str(s.get("region")).isdigit() else None,
            "lon": round(f["geometry"].x, 6), "lat": round(f["geometry"].y, 6),
            "address": f"{f['ADDRESS']}, {f['CITY']}", "url": f["HOME_URL"],
            "upper": bool(s.get("upper")), "magnet": bool(s.get("magnet")),
            "years": sorted(set(s["years"])),
            "capacity": c["program"] if c else None, "design": c["design"] if c else None,
            "membership": c["membership"] if c else None, "temp": c["temp"] if c else 0,
            "modular": c["modular"] if c else 0, "proj": c["proj"] if c else None,
            "bell": b, "title1": n in title1,
            "ccd": d,
        })
    pd.DataFrame(out).to_json(WORK / "schools.json", orient="records")
    for k, v in missing.items():
        print(f"missing {k}: {len(v)} {v[:30]}")
    print(f"schools: {len(out)}")
    return out


if __name__ == "__main__":
    build()
