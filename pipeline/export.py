"""Assemble the browser data bundle in web/public/data/."""
import json

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from common import OUT, WORK, read, write_json


def spa_geometry(spa):
    g = spa[["STUDENT_PLANNING_AREAS", "geometry"]].copy()
    g["i"] = np.arange(len(g))
    g = g.rename(columns={"STUDENT_PLANNING_AREAS": "spa"})
    # topology-preserving simplify on the metric layer, then to lon/lat
    g["geometry"] = shapely.coverage_simplify(g.geometry.values, 12)
    out = g.to_crs(4326)
    out.to_file(OUT / "spa.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    return g


def adjacency_and_edges(g):
    """Shared boundary lines between SPAs (for drawing school boundaries) and adjacency with shared length."""
    geoms = g.geometry.values
    tree = shapely.STRtree(geoms)
    pairs = tree.query(geoms, predicate="intersects")
    adj = [[] for _ in range(len(g))]
    feats = []
    bnd = shapely.boundary(geoms)
    shared_all = [[] for _ in range(len(g))]
    for a, b in zip(*pairs):
        if a >= b:
            continue
        line = shapely.intersection(bnd[a], bnd[b])
        line = shapely.line_merge(shapely.union_all([x for x in shapely.get_parts(line) if x.geom_type in ("LineString", "MultiLineString")])) if not line.is_empty else line
        L = line.length if not line.is_empty else 0
        if L < 5:
            continue
        adj[a].append([int(b), round(L)])
        adj[b].append([int(a), round(L)])
        feats.append({"a": int(a), "b": int(b), "geometry": line})
        shared_all[a].append(line)
        shared_all[b].append(line)
    # outer edges (county edge / gaps): SPA boundary minus shared parts
    for a in range(len(g)):
        rest = bnd[a]
        if shared_all[a]:
            rest = shapely.difference(rest, shapely.buffer(shapely.union_all(shared_all[a]), 1.0))
        if not rest.is_empty and rest.length > 20:
            feats.append({"a": int(a), "b": -1, "geometry": rest})
    e = gpd.GeoDataFrame(feats, crs=g.crs).to_crs(4326)
    e["geometry"] = e.geometry.simplify(0.00002)
    e.to_file(OUT / "spa_edges.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    return adj


def official_outlines():
    """Official attendance-area outlines for both years (for checking the SPA reconstruction)."""
    feats = []
    for year in ("2025", "2026"):
        for lvl in ("es", "ms", "hs"):
            a = read(f"{lvl}_{year}")
            if lvl == "es" and year == "2025":
                a = a[~a["SCHOOL_NAME"].str.contains("Upper|Kings Glen", case=False)]
            for _, r in a.iterrows():
                feats.append({"year": int(year), "level": lvl.upper(), "name": str(r["SCHOOL_NAME"]).strip(),
                              "geometry": r.geometry.boundary})
    g = gpd.GeoDataFrame(feats, crs=a.crs)
    g["geometry"] = g.geometry.simplify(15)
    g.to_crs(4326).to_file(OUT / "official.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)


def build():
    spa = read("spa_2026")
    st = json.loads((WORK / "students.json").read_text())
    sch = pd.read_json(WORK / "schools.json")
    cents = json.loads((WORK / "spa_centroids.json").read_text())
    assert [int(x) for x in spa["STUDENT_PLANNING_AREAS"]] == st["spa"], "SPA order mismatch"

    g = spa_geometry(spa)
    adj = adjacency_and_edges(g)
    official_outlines()

    sid_index = {int(s): k for k, s in enumerate(sch["id"])}
    # school site SPA (school point inside SPA) for "school outside its own boundary" checks
    spts = gpd.GeoDataFrame(sch[["id"]], geometry=gpd.points_from_xy(sch["lon"], sch["lat"]), crs=4326).to_crs(spa.crs)
    j = gpd.sjoin(spts, g[["i", "geometry"]], how="left", predicate="within")
    site = j.groupby(level=0)["i"].first().reindex(range(len(sch))).fillna(-1).astype(int).tolist()

    def idx(col):
        return [sid_index.get(int(x), -1) for x in col]

    schools = []
    for k, r in sch.iterrows():
        ccd = r["ccd"] if isinstance(r["ccd"], dict) else {}
        tot = ccd.get("total")
        schools.append({
            "id": int(r["id"]), "name": r["name"], "level": r["level"], "grades": r["grades"],
            "gmin": None if pd.isna(r["gmin"]) else int(r["gmin"]), "gmax": None if pd.isna(r["gmax"]) else int(r["gmax"]),
            "upper": bool(r["upper"]), "magnet": bool(r["magnet"]),
            "region": None if pd.isna(r["region"]) else int(r["region"]),
            "lon": r["lon"], "lat": r["lat"], "address": r["address"], "url": r["url"],
            "capacity": None if pd.isna(r["capacity"]) else int(r["capacity"]),
            "design": r["design"], "membership": None if pd.isna(r["membership"]) else int(r["membership"]),
            "temp": int(r["temp"] or 0), "modular": int(r["modular"] or 0),
            "proj": r["proj"] if isinstance(r["proj"], list) else None,
            "bell": None if pd.isna(r["bell"]) else int(r["bell"]), "title1": bool(r["title1"]),
            "frl": round(ccd["frl"] / tot, 3) if tot and ccd.get("frl") is not None else None,
            "ccdTotal": tot, "site": site[k],
        })
    model = {
        "generated": pd.Timestamp.now().isoformat(timespec="minutes"),
        "schools": schools,
        "spa": {
            "id": st["spa"], "centroid": cents,
            "area": (g.geometry.area / 1e6).round(3).tolist(),
            "units": st["units"], "n": st["n"], "proj": st["proj"],
            "frl": st["frl"], "race": st["race"], "raceKeys": st["race_keys"],
            "adj": adj,
            "a26": {"ES": idx(spa["ES_ID"]), "MS": idx(spa["MS_ID"]), "HS": idx(spa["HS_ID"]),
                    "ESAAP": idx(spa["ES_AAP_ID"]), "MSAAP": idx(spa["MS_AAP_ID"])},
            "a25": {"ES": idx(st["base25"]["ES"]), "MS": idx(st["base25"]["MS"]), "HS": idx(st["base25"]["HS"])},
            "region": [int(x) for x in spa["REGION"]],
        },
        "upperOf": {str(sid_index[int(k)]): sid_index[int(v)] for k, v in st["upper_of"].items() if int(k) in sid_index and int(v) in sid_index},
        "tj": sid_index.get(300, -1),
        "params": st["params"], "yields": st["yields"],
    }
    write_json(OUT / "model.json", model)


if __name__ == "__main__":
    build()
