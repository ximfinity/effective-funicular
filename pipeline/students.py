"""Estimate students per Student Planning Area (SPA), by grade, for the base year and 5 projection years.

Method (all inputs public):
 1. Parcel housing units by type (single-family, townhouse/duplex, low-rise MF, mid/high-rise MF, mobile home) are joined to SPAs and to 2025-26 attendance areas.
 2. Per-grade student yields by housing type are fitted with non-negative least squares on HS pyramids
    (24 areas, which nets out most AAP/transfer noise).
 3. Raw SPA estimates (units x yield) are calibrated by iterative proportional fitting so that, routed
    through the 2025-26 assignments (incl. upper-ES pairs, grade-6 middle schools, AAP centers and TJHSST),
    every school reproduces its actual Sept-2025 membership from the CIP.
 4. Projections: each school's CIP projection is split into a pipeline component (new units x yield,
    placed in the SPA where they are built) and a cohort component (applied proportionally).
 5. Demographics: school FRL% (NCES CCD 2024-25) is spread to SPAs with a logit model on multifamily share,
    fitted across schools; race shares are inherited from the base school.
"""
import json

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.optimize import nnls

from common import GRADES, RAW, WORK, norm_name, read

TYPES = ["SF", "TH", "LR", "HR", "MH"]
# county housing codes -> model groups
TYPE_MAP = {"SF": "SF", "DX": "TH", "TH": "TH", "MP": "LR", "LR": "LR", "MR": "HR", "HR": "HR", "MH": "MH"}
# forecast layer codes; new multifamily is split evenly between low-rise and mid/high-rise
FC_TYPE = {"SFD": "SF", "SFA": "TH", "MF": "MF", "MH": "MH"}


def add_units(du, y, i, t, v):
    if t == "MF":
        du[y, i, TYPES.index("LR")] += v / 2
        du[y, i, TYPES.index("HR")] += v / 2
    else:
        du[y, i, TYPES.index(t)] += v
NG = len(GRADES)  # K..12 = 13
# Program participation defaults (exposed as model parameters in the app)
AAP_ES_SHARE = 0.12   # share of grades 3-6 attending an AAP Level IV center
AAP_MS_SHARE = 0.15   # share of grades 7-8 attending an MS AAP center
TJ_FCPS_SHARE = 0.70  # share of TJHSST seats held by FCPS residents


def load_parcels():
    hu = read("housing_units")
    hu = hu[hu["CURRE_UNIT"].fillna(0) > 0].copy()
    hu["type"] = hu["HOUSI_UNIT_TYPE"].map(TYPE_MAP).fillna("SF")
    fc = read("housing_forecast", crs=None).drop(columns="geometry")
    fc = fc.groupby("PIN").agg({c: "sum" for c in fc.columns if c.startswith("CURRE_YEAR")} | {"HOUSI_UNIT_TYPE": "first"})
    return hu, fc


# The City of Fairfax is served by FCPS but its parcels are not in the county housing layers. Its housing stock
# (~9,500 units; ACS mix roughly 58% single-family, 14% attached, 28% apartments) is spread on a 100 m grid over the
# city's SPAs; calibration then scales it to actual school membership.
CITY_UNITS = 9500
CITY_MIX = {"SF": 0.58, "TH": 0.14, "LR": 0.28}


# Prior student yields per housing unit (all grades in the band), approximating FCPS countywide ratios by
# housing type. The pyramid fit is regularized toward these so a weakly identified type cannot collapse to 0.
PRIOR = {
    "ES": {"SF": 0.26, "TH": 0.22, "LR": 0.16, "HR": 0.045, "MH": 0.26},
    "MS": {"SF": 0.075, "TH": 0.06, "LR": 0.04, "HR": 0.011, "MH": 0.075},
    "HS": {"SF": 0.165, "TH": 0.115, "LR": 0.075, "HR": 0.022, "MH": 0.165},
}
PRIOR_WEIGHT = 30.0  # strong prior: per-school calibration fixes totals; yields only set within-area shares


def city_of_fairfax_parcels(spa, crs):
    j = read("jurisdictions")
    city = j[j["NAME"] == "CITY OF FAIRFAX"].geometry.union_all()
    reps = spa.geometry.representative_point()
    sel = spa[reps.within(city)]
    pts = []
    for _, r in sel.iterrows():
        g = r.geometry.intersection(city)
        x0, y0, x1, y1 = g.bounds
        xs, ys = np.meshgrid(np.arange(x0 + 50, x1, 100), np.arange(y0 + 50, y1, 100))
        cand = gpd.points_from_xy(xs.ravel(), ys.ravel())
        pts += [p for p in cand if g.contains(p)]
    if not pts:
        return None
    n = len(pts)
    rows = []
    for k, p in enumerate(pts):
        for t, share in CITY_MIX.items():
            rows.append({"PIN": f"CITY-{k}-{t}", "CURRE_UNIT": CITY_UNITS * share / n, "HOUSI_UNIT_TYPE": t, "type": t, "geometry": p})
    print(f"City of Fairfax: {len(sel)} SPAs, {n} synthetic parcel points")
    return gpd.GeoDataFrame(rows, crs=crs)


def assign_points(points, polys, key):
    j = gpd.sjoin(points[["geometry"]], polys[[key, "geometry"]], how="left", predicate="within")
    j = j[~j.index.duplicated()]
    return j[key]


def school_tables():
    sch = pd.read_json(WORK / "schools.json")
    sch = sch.set_index("id")
    return sch


def build():
    sch = school_tables()
    spa = read("spa_2026")
    spa = spa.rename(columns={"STUDENT_PLANNING_AREAS": "spa"})
    spa["spa"] = spa["spa"].astype(int)
    hu, fc = load_parcels()
    city = city_of_fairfax_parcels(spa, hu.crs)
    if city is not None:
        hu = pd.concat([hu, city], ignore_index=True)
    print(f"parcels with units: {len(hu)}  units: {hu.CURRE_UNIT.sum():,.0f}")

    # --- parcels -> SPA and -> 2025-26 attendance areas
    hu["spa"] = assign_points(hu, spa, "spa")
    miss = hu["spa"].isna()
    if miss.any():  # parcels on SPA edges: nearest SPA
        near = gpd.sjoin_nearest(hu.loc[miss, ["geometry"]], spa[["spa", "geometry"]], max_distance=500)
        near = near[~near.index.duplicated()]
        hu.loc[near.index, "spa"] = near["spa"]
    hu = hu[hu["spa"].notna()].copy()
    hu["spa"] = hu["spa"].astype(int)
    name_to_id = {(norm_name(r["name"]), r["level"]): i for i, r in sch.iterrows()}
    for lvl in ("es", "ms", "hs"):
        a = read(f"{lvl}_2025")
        if lvl == "es":
            a = a[~a["SCHOOL_NAME"].str.contains("Upper|Kings Glen", case=False)]
        a["sid"] = [name_to_id[(norm_name(n), lvl.upper())] for n in a["SCHOOL_NAME"]]
        hu[f"{lvl}25"] = assign_points(hu, a, "sid")
    units = hu.pivot_table(index="spa", columns="type", values="CURRE_UNIT", aggfunc="sum", fill_value=0).reindex(columns=TYPES, fill_value=0)
    units = units.reindex(spa["spa"], fill_value=0)

    # --- 2025-26 SPA assignment: majority of housing units; SPAs without housing use area overlay
    base25 = {}
    for lvl in ("es", "ms", "hs"):
        maj = hu.groupby(["spa", f"{lvl}25"])["CURRE_UNIT"].sum().reset_index().sort_values("CURRE_UNIT").drop_duplicates("spa", keep="last")
        m = dict(zip(maj["spa"], maj[f"{lvl}25"].astype(int)))
        a = read(f"{lvl}_2025")
        if lvl == "es":
            a = a[~a["SCHOOL_NAME"].str.contains("Upper|Kings Glen", case=False)]
        a["sid"] = [name_to_id[(norm_name(n), lvl.upper())] for n in a["SCHOOL_NAME"]]
        reps = spa.copy()
        reps["geometry"] = spa.geometry.representative_point()
        over = assign_points(reps, a, "sid")
        base25[lvl] = [int(m.get(s, over.iloc[i] if pd.notna(over.iloc[i]) else -1)) for i, s in enumerate(spa["spa"])]
    spa["ES25"], spa["MS25"], spa["HS25"] = base25["es"], base25["ms"], base25["hs"]
    split_spas = (hu.groupby("spa")["es25"].nunique() > 1).sum()
    print(f"SPAs whose housing straddles a 2025-26 ES boundary: {split_spas}")

    # Upper-ES partner of each primary ES (stable across years)
    upper_of = {}
    for _, r in spa.iterrows():
        if int(r["UP_ES_ID"]):
            upper_of[int(r["ES_ID"])] = int(r["UP_ES_ID"])

    # --- 1. yields per grade band by housing type: NNLS on HS pyramids (2025-26)
    hs_area = spa.set_index("spa")["HS25"]
    pyr_units = units.groupby(hs_area.reindex(units.index).values).sum()
    pyr_units = pyr_units[pyr_units.index > 0]
    hs25_poly = read("hs_2025")
    hs25_poly["sid"] = [name_to_id[(norm_name(n), "HS")] for n in hs25_poly["SCHOOL_NAME"]]
    spts = gpd.GeoDataFrame(sch, geometry=gpd.points_from_xy(sch["lon"], sch["lat"]), crs=4326).to_crs(hu.crs)
    spts["pyr"] = assign_points(spts, hs25_poly, "sid")
    band_of_level = {"ES": (0, 6), "MS": (7, 8), "HS": (9, 12)}
    yields = {}
    for band, (g0, g1) in band_of_level.items():
        # ES band: all ES + upper ES + grade-6 middle schools (their 6th graders) roll up; use whole membership
        if band == "ES":
            members = spts[(spts["level"] == "ES")]
            extra = spts[spts["gmin"] == 6]  # 6-8 middle schools: ~1/3 of membership is grade 6
            tgt = members.groupby("pyr")["membership"].sum().add(extra.groupby("pyr")["membership"].sum() / 3, fill_value=0)
        elif band == "MS":
            members = spts[(spts["level"] == "MS")]
            tgt = members.groupby("pyr")["membership"].sum() - members[members["gmin"] == 6].groupby("pyr")["membership"].sum().reindex(members["pyr"].unique(), fill_value=0) / 3
        else:
            members = spts[(spts["level"] == "HS") & (~spts["magnet"])]
            tgt = members.groupby("pyr")["membership"].sum()
        tgt = tgt.reindex(pyr_units.index).fillna(0)
        A = pyr_units[TYPES].values
        y0 = np.array([PRIOR[band][t] for t in TYPES])
        lam = np.sqrt(PRIOR_WEIGHT) * np.maximum(A.mean(axis=0), 2000)  # per-type scale: a typical pyramid's units
        Aa = np.vstack([A, np.diag(lam)])
        ta = np.concatenate([tgt.values, lam * y0])
        y, _ = nnls(Aa, ta)
        ng = g1 - g0 + 1
        yields[band] = {t: float(v) / ng for t, v in zip(TYPES, y)}  # per grade per unit
        fit = A @ y
        r2 = 1 - ((tgt.values - fit) ** 2).sum() / ((tgt.values - tgt.values.mean()) ** 2).sum()
        print(f"yield {band} per unit (all grades): " + ", ".join(f"{t}={v:.3f}" for t, v in zip(TYPES, y)) + f"  R2={r2:.2f}")

    print("per-grade yields:", {b: {t: round(v, 4) for t, v in y.items()} for b, y in yields.items()})

    # per-grade yield matrix [type, grade]
    Y = np.zeros((len(TYPES), NG))
    for band, (g0, g1) in band_of_level.items():
        for g in range(g0, g1 + 1):
            Y[:, g] = [yields[band][t] for t in TYPES]

    # grade shape from CCD county totals (optional)
    gshape = np.ones(NG)
    try:
        memb = pd.read_csv(RAW / "ccd_membership_2425.csv", dtype=str)
        memb["STUDENT_COUNT"] = pd.to_numeric(memb["STUDENT_COUNT"], errors="coerce")
        gm = memb[memb["TOTAL_INDICATOR"].str.startswith("Subtotal 4", na=False)].groupby("GRADE")["STUDENT_COUNT"].sum()
        gmap = {"Kindergarten": 0, **{f"Grade {i}": i for i in range(1, 13)}}
        gc = np.array([gm.get(k, np.nan) for k in sorted(gmap, key=gmap.get)], dtype=float)
        if np.isfinite(gc).all():
            for band, (g0, g1) in band_of_level.items():
                seg = gc[g0:g1 + 1]
                gshape[g0:g1 + 1] = seg / seg.mean()
            print("grade shape (CCD):", np.round(gshape, 2))
    except FileNotFoundError:
        pass
    Y = Y * gshape

    n0 = units[TYPES].values @ Y  # [spa, grade] raw resident estimate
    S = len(spa)
    spa_ids = spa["spa"].tolist()

    # --- 2. routing: grade g of SPA i -> list of (school, share)
    tj_mem = float(sch.loc[300, "membership"] or 0)
    hs_res = sum(n0[:, 9:13].sum(axis=0))
    tj_share = TJ_FCPS_SHARE * tj_mem / (hs_res + 1e-9)
    print(f"TJHSST share of HS residents (initial): {tj_share:.3f}")

    def route(es, up, ms, hs, esaap, msaap, g):
        """Return [(school, fraction, band)] for a grade, given an SPA's assignments."""
        def serves(sid):
            if sid not in sch.index:
                return False
            r = sch.loc[sid]
            return r["gmin"] <= g <= r["gmax"]
        if serves(es):
            gen = es
        elif up and serves(up):
            gen = up
        elif serves(ms):
            gen = ms
        elif serves(hs):
            gen = hs
        else:
            return []
        out = []
        if 3 <= g <= 6 and sch.loc[gen, "level"] == "ES" and esaap in sch.index:
            out = [(gen, 1 - AAP_ES_SHARE), (esaap, AAP_ES_SHARE)]
        elif 6 <= g <= 8 and sch.loc[gen, "level"] == "MS" and msaap in sch.index and g >= 7:
            out = [(gen, 1 - AAP_MS_SHARE), (msaap, AAP_MS_SHARE)]
        elif g >= 9:
            out = [(gen, 1 - tj_share), (300, tj_share)]
        else:
            out = [(gen, 1.0)]
        return out

    def routing(es_col, ms_col, hs_col):
        R = []  # per SPA: per grade list of (school, frac)
        for i in range(S):
            r = spa.iloc[i]
            es = int(r[es_col])
            up = upper_of.get(es, 0)
            R.append([route(es, up, int(r[ms_col]), int(r[hs_col]), int(r["ES_AAP_ID"]), int(r["MS_AAP_ID"]), g) for g in range(NG)])
        return R

    R25 = routing("ES25", "MS25", "HS25")

    # --- 3. IPF calibration: multiplier per (SPA, general school)
    target = sch["membership"].astype(float)
    mult = np.ones((S, NG))
    for it in range(60):
        modeled = {}
        for i in range(S):
            for g in range(NG):
                v = n0[i, g] * mult[i, g]
                for sid, f in R25[i][g]:
                    modeled[sid] = modeled.get(sid, 0) + v * f
        ratio = {sid: (target.get(sid, np.nan) / m) if m > 0 and np.isfinite(target.get(sid, np.nan)) and target.get(sid) > 0 else 1.0
                 for sid, m in modeled.items()}
        err = np.nanmean([abs(1 - r) for r in ratio.values()])
        for i in range(S):
            for g in range(NG):
                if R25[i][g]:
                    gen = R25[i][g][0][0]
                    mult[i, g] *= ratio.get(gen, 1.0) ** 0.7
        np.clip(mult, 0.15, 6, out=mult)
        if err < 0.002:
            break
    print(f"IPF iterations {it + 1}, mean abs school error {err:.4f}")
    n = n0 * mult

    # --- 4. projections (5 years) under the 2025-26 routing
    proj_years = 5
    du = np.zeros((proj_years, S, len(TYPES)))
    pin_spa = hu.set_index("PIN")["spa"]
    cur_units = hu.groupby("PIN")["CURRE_UNIT"].sum()
    fcx = fc.join(pin_spa.rename("spa"), how="inner")
    fcx["type"] = fcx["HOUSI_UNIT_TYPE"].map(FC_TYPE).fillna("SF")
    fcx["cur"] = cur_units.reindex(fcx.index).fillna(0)
    spa_pos = {s: i for i, s in enumerate(spa_ids)}
    for y in range(proj_years):
        col = f"CURRE_YEAR_{y + 2}_UNIT"  # year 1 ~ current year; years 2..6 -> SY26-27..SY30-31
        d = (fcx[col] - fcx["cur"]).clip(lower=0)
        g = d.groupby([fcx["spa"], fcx["type"]]).sum()
        for (s, t), v in g.items():
            if s in spa_pos:
                add_units(du, y, spa_pos[s], t, v)
    # also new parcels with no current units (greenfield) are in fc but not hu: place by forecast point
    fc_pts = read("housing_forecast")
    fc_pts = fc_pts[~fc_pts["PIN"].isin(cur_units.index)]
    if len(fc_pts):
        fc_pts["spa"] = assign_points(fc_pts, spa, "spa")
        fc_pts = fc_pts[fc_pts["spa"].notna()]
        fc_pts["type"] = fc_pts["HOUSI_UNIT_TYPE"].map(FC_TYPE).fillna("MF")
        for y in range(proj_years):
            col = f"CURRE_YEAR_{y + 2}_UNIT"
            g = fc_pts.groupby(["spa", "type"])[col].sum()
            for (s, t), v in g.items():
                if int(s) in spa_pos and v > 0:
                    add_units(du, y, spa_pos[int(s)], t, v)
    print("new housing units by year:", du.sum(axis=(1, 2)).round().astype(int).tolist())
    pipe = np.einsum("ysT,Tg->ysg", du, Y)  # new students from pipeline, by SPA & grade
    print("pipeline students by year:", np.round(pipe.sum(axis=(1, 2))).astype(int))

    proj = np.zeros((proj_years, S, NG))
    for y in range(proj_years):
        # modeled school totals of base + pipeline
        base_m, pipe_m = {}, {}
        for i in range(S):
            for g in range(NG):
                for sid, f in R25[i][g]:
                    base_m[sid] = base_m.get(sid, 0) + n[i, g] * f
                    pipe_m[sid] = pipe_m.get(sid, 0) + pipe[y, i, g] * f
        factor = {}
        for sid, b in base_m.items():
            p = sch.loc[sid, "proj"] if sid in sch.index else None
            if isinstance(p, list) and p[y] and b > 0:
                factor[sid] = max(0.5, min(1.6, (p[y] - pipe_m.get(sid, 0)) / b))
            else:
                factor[sid] = 1.0
        for i in range(S):
            for g in range(NG):
                if R25[i][g]:
                    gen = R25[i][g][0][0]
                    proj[y, i, g] = n[i, g] * factor.get(gen, 1.0) + pipe[y, i, g]
    print("county students base / proj:", round(n.sum()), [round(proj[y].sum()) for y in range(proj_years)])

    # --- 5. demographics
    ccd = {sid: (r["ccd"] if isinstance(r["ccd"], dict) else None) for sid, r in sch.iterrows()}
    mf_share = ((units["LR"] + units["HR"]) / units.sum(axis=1).replace(0, np.nan)).fillna(0).values
    # school-level MF share of resident students (2025-26 general routing)
    school_x, school_y, school_w = [], [], []
    res = {}
    for i in range(S):
        for g in range(NG):
            if R25[i][g]:
                gen = R25[i][g][0][0]
                a = res.setdefault(gen, [0.0, 0.0])
                a[0] += n[i, g]
                a[1] += n[i, g] * mf_share[i]
    for sid, (tot, mfw) in res.items():
        d = ccd.get(sid)
        if d and d.get("frl") is not None and d.get("total") and tot > 0:
            p = np.clip(d["frl"] / d["total"], 0.01, 0.99)
            school_x.append(mfw / tot)
            school_y.append(np.log(p / (1 - p)))
            school_w.append(tot)
    beta = 0.0
    if len(school_x) > 10:
        X = np.vstack([np.ones(len(school_x)), school_x]).T
        W = np.diag(school_w)
        coef = np.linalg.solve(X.T @ W @ X, X.T @ W @ np.array(school_y))
        beta = float(coef[1])
    print(f"FRL logit slope on MF share: {beta:.2f}")

    # Calibrate one intercept per school so that the school's whole modeled enrollment (its general residents plus
    # AAP-center / TJ inflows, each at their home SPA's rate) matches its actual FRL count. Inflows depend on other
    # schools' intercepts, so iterate to a fixed point.
    band_cols = ("ES25", "MS25", "HS25")
    lvl_band = {"ES": 0, "MS": 1, "HS": 2}
    base_of = np.array([[int(spa.iloc[i][c]) for c in band_cols] for i in range(S)])
    flows = {}  # school -> list of (spa, students)
    for i in range(S):
        for g in range(NG):
            for sid, f in R25[i][g]:
                flows.setdefault(sid, []).append((i, n[i, g] * f))
    sig = lambda z: 1 / (1 + np.exp(-z))
    alpha = {sid: 0.0 for sid in flows}

    def rate(i, sid):
        b = lvl_band[sch.loc[sid, "level"]] if sid in sch.index else 0
        home = base_of[i, b]
        return sig(alpha.get(home, 0.0) + beta * mf_share[i])

    for it in range(25):
        moved = 0.0
        for sid, fl in flows.items():
            d = ccd.get(sid)
            if not d or not d.get("total") or d.get("frl") is None or sch.loc[sid, "magnet"]:
                continue
            b = lvl_band[sch.loc[sid, "level"]]
            own = [(i, w) for i, w in fl if base_of[i, b] == sid]
            other = [(i, w) for i, w in fl if base_of[i, b] != sid]
            tot = sum(w for _, w in fl)
            own_w = np.array([w for _, w in own])
            if own_w.sum() <= 0:
                continue
            target = d["frl"] / d["total"] * tot - sum(w * rate(i, sid) for i, w in other)
            target = np.clip(target / own_w.sum(), 0.02, 0.98)
            x = mf_share[[i for i, _ in own]]
            lo, hi = -12.0, 12.0
            for _ in range(50):
                mid = (lo + hi) / 2
                val = (own_w * sig(mid + beta * x)).sum() / own_w.sum()
                lo, hi = (mid, hi) if val < target else (lo, mid)
            moved = max(moved, abs(alpha[sid] - (lo + hi) / 2))
            alpha[sid] = (lo + hi) / 2
        if moved < 1e-3:
            break
    print(f"FRL calibration: {it + 1} rounds")

    race_keys = ["asian", "black", "hispanic", "white", "multi", "other"]
    frl = np.zeros((S, 3))
    race = np.zeros((S, 3, len(race_keys)))
    for i in range(S):
        r = spa.iloc[i]
        for b, col in enumerate(("ES25", "MS25", "HS25")):
            sid = int(r[col])
            a = alpha.get(sid)
            frl[i, b] = sig(a + beta * mf_share[i]) if a is not None and ccd.get(sid) else np.nan
            d = ccd.get(sid) or {}
            tot = sum(d.get(k, 0) for k in race_keys)
            race[i, b] = [d.get(k, 0) / tot if tot else np.nan for k in race_keys]
    # fill gaps with county means
    for b in range(3):
        m = np.nanmean(frl[:, b])
        frl[np.isnan(frl[:, b]), b] = m
        for k in range(len(race_keys)):
            col = race[:, b, k]
            col[np.isnan(col)] = np.nanmean(col)

    # --- save
    out = {
        "spa": spa_ids,
        "units": units[TYPES].values.round(1).tolist(),
        "n": n.round(2).tolist(),
        "proj": proj.round(2).tolist(),
        "frl": frl.round(3).tolist(),
        "race": race.round(3).tolist(),
        "race_keys": race_keys,
        "yields": yields,
        "params": {"aap_es": AAP_ES_SHARE, "aap_ms": AAP_MS_SHARE, "tj_share": tj_share, "frl_beta": beta},
        "base25": {"ES": base25["es"], "MS": base25["ms"], "HS": base25["hs"]},
        "upper_of": upper_of,
    }
    (WORK / "students.json").write_text(json.dumps(out))
    # parcel weights for the network stage (relative students per band)
    band_cols = {"ES": slice(0, 7), "MS": slice(7, 9), "HS": slice(9, 13)}
    pw = hu[["PIN", "spa", "type", "CURRE_UNIT", "geometry"]].copy()
    ti = pw["type"].map({t: k for k, t in enumerate(TYPES)}).values
    for band, sl in band_cols.items():
        pw[f"w_{band}"] = pw["CURRE_UNIT"].values * Y[ti, sl].sum(axis=1)
    pw.to_parquet(WORK / "parcels.parquet")
    print(f"saved students for {S} SPAs; parcels {len(pw)}")


if __name__ == "__main__":
    build()
