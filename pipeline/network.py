"""Walk and drive networks.

Walk model
----------
The county road centerlines (topologically noded at intersections; bridges are not noded) plus trails form the
pedestrian graph. Limited-access roads (interstates, freeways, expressways, ramps) are removed, so they can only
be crossed where another road or trail passes over/under them.

"Barrier" roads are walkable *along* (only where a sidewalk exists) but cannot be *crossed* except at a
signalized intersection. To model that on a centerline graph each node is split into angular sectors bounded
by the barrier edges that meet there, and each barrier edge becomes two one-sided edges (left/right). A walker
can only move between sectors at a node judged signalized.

Barrier tiers (cumulative):
  T0  none (only limited-access roads block)
  T1  + high-speed principal arterials (primary routes, >=45 mph, or divided >=40 mph)
  T2  + all arterials (>=35 mph on primary/secondary/tertiary routes, Fairfax MAA/MIA/MEA)
  T3  + collectors (>=30 mph non-local roads, Fairfax COL)
Each tier is solved with signalized crossings allowed ('s') and with no at-grade crossings ('n'), plus a
straight-line variant: 8 variants total.

Outputs per (SPA, school) pair: cumulative share of the SPA's students (of that school's grade band) living
within d miles walking, for d = 0.1 .. 2.0 mi.

Drive model
-----------
All built roads, bus-speed travel times. Outputs SPA->school and SPA<->SPA travel times (sparse).
"""
import json
import math
import time

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.strtree import STRtree

from common import MILE, OUT, WORK, read, write_json

VARIANTS = ["T0", "T1s", "T1n", "T2s", "T2n", "T3s", "T3n", "crow"]
NBINS = 20
BIN = 0.1 * MILE
WALK_LIMIT = 2.05 * MILE
SIGNAL_CROSS_COST = 15.0  # meters-equivalent for crossing at a signal
LIMITED_ROAD = {"INT", "RMP", "MRG", "HWY"}
LIMITED_FFX = {"FRE", "EXP", "RMH", "RML", "MRG"}


def classify(r):
    """Return (walkable, tier) where tier in 1..3 marks barrier roads, 9 = never a barrier."""
    rc, fx = r["ROAD_CLASS"], r["FFX_CLASS"] or ""
    spd = r["SPEED_LIMIT_CAR"] if pd.notna(r["SPEED_LIMIT_CAR"]) else 25
    if rc in LIMITED_ROAD or fx in LIMITED_FFX or rc == "CRS" or fx == "CRO":
        return False, 0
    divided = r["DIVIDED"] == "Y"
    if rc == "PRI" or fx in ("MEA", "PKY") or spd >= 45 or (divided and spd >= 40):
        return True, 1
    if fx in ("MAA", "MIA") or (rc in ("SEC", "TER") and spd >= 35):
        return True, 2
    if fx == "COL" or (rc not in ("LOC", "DRV", "PRK", "TRL") and spd >= 30):
        return True, 3
    return True, 9


def bearing(line, at_start):
    c = np.asarray(line.coords)
    if at_start:
        p0 = c[0]
        d = c[1:] - p0
    else:
        p0 = c[-1]
        d = c[-2::-1] - p0
    dist = np.hypot(d[:, 0], d[:, 1])
    k = np.argmax(dist > 5) if (dist > 5).any() else len(d) - 1
    return math.atan2(d[k, 1], d[k, 0])


def load_edges():
    t = time.time()
    county = read("county")
    area = shapely.Polygon(county.geometry.union_all().convex_hull.exterior).buffer(3000)
    roads = read("roads")
    roads = roads[roads["STATUS"].fillna("B") == "B"]
    roads = roads[roads.intersects(area)].copy()
    cls = roads.apply(classify, axis=1, result_type="expand")
    roads["walk"], roads["tier"] = cls[0], cls[1]
    roads["kind"] = "road"
    trails = pd.concat([read("trails_county"), read("trails_other")])
    trails = trails[trails.intersects(area)].explode(index_parts=False)
    trails = trails[trails.geom_type == "LineString"]
    trails = gpd.GeoDataFrame({"FULLNAME": trails.get("TRAIL_NAME"), "walk": True, "tier": 9, "kind": "trail",
                               "SPEED_LIMIT_CAR": np.nan, "ROAD_CLASS": "TRL", "BRIDGE": "N"}, geometry=trails.geometry.values, crs=roads.crs)
    print(f"roads {len(roads)}, trails {len(trails)} ({time.time() - t:.0f}s)")
    return roads, trails, area


def node_ids(geoms, snap_trails=None):
    """Assign node ids to line endpoints (1 m snapping)."""
    starts = np.array([g.coords[0][:2] for g in geoms])
    ends = np.array([g.coords[-1][:2] for g in geoms])
    keys = np.round(np.vstack([starts, ends])).astype(np.int64)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    n = len(geoms)
    return uniq.astype(float), inv[:n], inv[n:]


def snap_trails(roads, trails):
    """Move trail endpoints within 20 m of a road node onto that node so trails join the street grid."""
    rn = np.unique(np.round(np.vstack([[g.coords[0][:2] for g in roads.geometry], [g.coords[-1][:2] for g in roads.geometry]])), axis=0)
    tree = STRtree(shapely.points(rn))
    geoms = []
    for g in trails.geometry:
        c = np.asarray(g.coords)[:, :2].copy()
        for k in (0, -1):
            idx = tree.query_nearest(shapely.Point(c[k]), max_distance=20)
            if len(idx):
                c[k] = rn[idx[0]]
        geoms.append(shapely.LineString(c))
    trails = trails.copy()
    trails["geometry"] = geoms
    return trails


def sidewalk_flags(edges):
    """Barrier-candidate edge has a sidewalk if >=50% of sample points lie within 30 m of a sidewalk line."""
    t = time.time()
    sw = read("sidewalks")
    sw = sw[sw["TYPE"] == "SIDEWALK"]
    tree = STRtree(sw.geometry.values)
    flags = np.zeros(len(edges), dtype=bool)
    cand = np.where(edges["tier"].values <= 3)[0]
    for i in cand:
        g = edges.geometry.values[i]
        n = max(2, int(g.length // 20))
        pts = shapely.line_interpolate_point(g, np.linspace(0, 1, n), normalized=True)
        hit = tree.query(pts, predicate="dwithin", distance=30)
        flags[i] = len(np.unique(hit[0])) / n >= 0.5
    print(f"sidewalk flags: {flags[cand].mean():.0%} of barrier-candidate edges ({time.time() - t:.0f}s)")
    return flags


def signal_nodes(edges, u, v, n_nodes):
    """Nodes judged signalized: two different arterials (tier<=2) meet, or an arterial meets a tier-3 road."""
    names = edges["FULLNAME"].fillna("").values
    tier = edges["tier"].values
    inc = {}
    for i in range(len(edges)):
        if tier[i] <= 3:
            for nd in (u[i], v[i]):
                inc.setdefault(nd, []).append((tier[i], names[i]))
    sig = np.zeros(n_nodes, dtype=bool)
    for nd, lst in inc.items():
        art = {nm for t, nm in lst if t <= 2}
        col = {nm for t, nm in lst if t == 3}
        if len(art) >= 2 or (art and col - art):
            sig[nd] = True
    return sig


def build_walk_graph(edges, u, v, n_nodes, sidewalk, sig, tier_cut, allow_signals):
    """Return (csr graph, sub(node, sector) mapper data) for one variant."""
    tier = edges["tier"].values
    length = edges.geometry.length.values
    barrier = tier <= tier_cut
    # bearings at both ends
    bu = np.array([bearing(g, True) for g in edges.geometry.values]) if "bu" not in edges else edges["bu"].values
    bv = np.array([bearing(g, False) for g in edges.geometry.values]) if "bv" not in edges else edges["bv"].values
    # barrier bearings per node
    bnode = {}
    for i in np.where(barrier)[0]:
        bnode.setdefault(u[i], []).append(bu[i])
        bnode.setdefault(v[i], []).append(bv[i])
    sectors = {nd: np.sort(np.array(b)) for nd, b in bnode.items() if len(b) >= 2}
    # subnode ids: sector 0 -> node id; others appended
    extra_base = n_nodes
    sub_index = {}
    nxt = extra_base
    for nd, B in sectors.items():
        for s in range(1, len(B)):
            sub_index[(nd, s)] = nxt
            nxt += 1

    def sub(nd, s):
        return nd if s == 0 else sub_index[(nd, s)]

    def sector_of(nd, theta):
        B = sectors.get(nd)
        if B is None:
            return 0
        return int(np.searchsorted(B, theta, side="left")) % len(B)

    def barrier_sides(nd, theta):
        B = sectors.get(nd)
        if B is None:
            return 0, 0
        j = int(np.searchsorted(B, theta, side="left"))  # position of this barrier bearing
        k = len(B)
        before = j % k
        after = (j + 1) % k
        return before, after

    rows, cols, w = [], [], []
    for i in range(len(edges)):
        if not barrier[i]:
            a = sub(u[i], sector_of(u[i], bu[i]))
            b = sub(v[i], sector_of(v[i], bv[i]))
            rows.append(a); cols.append(b); w.append(length[i])
        elif sidewalk[i]:
            bu_b, bu_a = barrier_sides(u[i], bu[i])
            bv_b, bv_a = barrier_sides(v[i], bv[i])
            rows += [sub(u[i], bu_a), sub(u[i], bu_b)]
            cols += [sub(v[i], bv_b), sub(v[i], bv_a)]
            w += [length[i], length[i]]
    if allow_signals:
        for nd, B in sectors.items():
            if sig[nd]:
                for s in range(len(B)):
                    rows.append(sub(nd, s)); cols.append(sub(nd, (s + 1) % len(B))); w.append(SIGNAL_CROSS_COST)
    N = nxt
    g = coo_matrix((w, (rows, cols)), shape=(N, N)).tocsr()
    g = g.maximum(g.T)

    def nsec(nd):
        B = sectors.get(nd)
        return 1 if B is None else len(B)
    return g, sub, sector_of, barrier_sides, barrier, nsec


def attach_points(points, edges, walkable_mask, prefer_mask, max_dist):
    """Snap points to the nearest walkable edge (preferring local streets). Returns edge idx, offset to u, offset to v."""
    geoms = edges.geometry.values
    idx_all = np.where(walkable_mask)[0]
    idx_pref = np.where(walkable_mask & prefer_mask)[0]
    tree_pref = STRtree(geoms[idx_pref])
    tree_all = STRtree(geoms[idx_all])
    e = np.full(len(points), -1)
    p_idx, t_idx = tree_pref.query_nearest(points, max_distance=max_dist, return_distance=False, all_matches=False)
    e[p_idx] = idx_pref[t_idx]
    miss = np.where(e < 0)[0]
    if len(miss):
        p2, t2 = tree_all.query_nearest(points[miss], max_distance=5 * max_dist, return_distance=False, all_matches=False)
        e[miss[p2]] = idx_all[t2]
    ok = e >= 0
    du = np.full(len(points), np.inf)
    dv = np.full(len(points), np.inf)
    lines = geoms[e[ok]]
    along = shapely.line_locate_point(lines, points[ok])
    perp = shapely.distance(lines, points[ok])
    L = shapely.length(lines)
    du[ok] = perp + along
    dv[ok] = perp + (L - along)
    return e, du, dv


def walk(students, schools):
    roads, trails, area = load_edges()
    trails = snap_trails(roads, trails)
    edges = pd.concat([roads[["FULLNAME", "walk", "tier", "kind", "SPEED_LIMIT_CAR", "ROAD_CLASS", "geometry"]],
                       trails[["FULLNAME", "walk", "tier", "kind", "SPEED_LIMIT_CAR", "ROAD_CLASS", "geometry"]]], ignore_index=True)
    edges = gpd.GeoDataFrame(edges, geometry="geometry", crs=roads.crs)
    edges = edges[edges.geometry.length > 0.5].reset_index(drop=True)
    walk_e = edges[edges["walk"]].reset_index(drop=True)
    coords, u, v = node_ids(list(walk_e.geometry.values))
    n_nodes = len(coords)
    walk_e["bu"] = [bearing(g, True) for g in walk_e.geometry.values]
    walk_e["bv"] = [bearing(g, False) for g in walk_e.geometry.values]
    sidewalk = sidewalk_flags(walk_e)
    sig = signal_nodes(walk_e, u, v, n_nodes)
    print(f"walk nodes {n_nodes}, edges {len(walk_e)}, signalized nodes {sig.sum()}")

    parcels = gpd.read_parquet(WORK / "parcels.parquet")
    ppts = parcels.geometry.values
    local = walk_e["tier"].values == 9
    pe, pdu, pdv = attach_points(ppts, walk_e, np.ones(len(walk_e), bool), local, 250)
    print(f"parcels snapped: {(pe >= 0).mean():.1%}")

    sch = schools
    spts = gpd.GeoSeries(gpd.points_from_xy(sch["lon"], sch["lat"]), crs=4326).to_crs(walk_e.crs).values
    # school attachments: every walkable edge within 120 m (all sides), else nearest edge
    tree = STRtree(walk_e.geometry.values)
    sch_att = []
    for k, p in enumerate(spts):
        near = tree.query(p, predicate="dwithin", distance=120)
        if len(near) == 0:
            near = tree.query_nearest(p, max_distance=1000)
        lines = walk_e.geometry.values[near]
        along = shapely.line_locate_point(lines, p)
        perp = shapely.distance(lines, p)
        sch_att.append([(int(near[j]), perp[j] + along[j], perp[j] + lines[j].length - along[j]) for j in range(len(near))])

    spa_ids = students["spa"]
    spa_pos = {s: i for i, s in enumerate(spa_ids)}
    p_spa = np.array([spa_pos[s] for s in parcels["spa"]])
    W = {b: parcels[f"w_{b}"].values for b in ("ES", "MS", "HS")}
    spa_tot = {b: np.bincount(p_spa, weights=W[b], minlength=len(spa_ids)) for b in W}
    band = sch["level"].values

    # candidate pairs: school within 2.6 mi straight-line of any parcel in the SPA (use SPA bbox center + radius)
    pxy = np.c_[shapely.get_x(ppts), shapely.get_y(ppts)]
    sxy = np.c_[shapely.get_x(spts), shapely.get_y(spts)]
    results = {}  # (spa, school) -> [variant][bins]

    def accumulate(variant_idx, school_k, dist):
        b = band[school_k]
        w = W[b]
        ok = np.isfinite(dist) & (dist <= NBINS * BIN)
        if not ok.any():
            return
        bins = np.minimum((dist[ok] // BIN).astype(int), NBINS - 1)
        sp = p_spa[ok]
        hist = np.zeros((len(spa_ids), NBINS))
        np.add.at(hist, (sp, bins), w[ok])
        touched = np.where(hist.sum(axis=1) > 0)[0]
        cum = np.cumsum(hist[touched], axis=1) / np.maximum(spa_tot[b][touched][:, None], 1e-9)
        for j, s in enumerate(touched):
            results.setdefault((int(s), int(school_k)), np.zeros((len(VARIANTS), NBINS), dtype=np.float32))[variant_idx] = cum[j]

    # straight-line variant
    for k in range(len(sch)):
        d = np.hypot(pxy[:, 0] - sxy[k, 0], pxy[:, 1] - sxy[k, 1])
        accumulate(VARIANTS.index("crow"), k, d)

    tiers = {"T0": (0, False), "T1s": (1, True), "T1n": (1, False), "T2s": (2, True), "T2n": (2, False), "T3s": (3, True), "T3n": (3, False)}
    walksheds = {}
    for vname, (cut, allow) in tiers.items():
        t = time.time()
        g, sub, sector_of, barrier_sides, barrier, nsec = build_walk_graph(walk_e, u, v, n_nodes, sidewalk, sig, cut, allow)
        N = g.shape[0]
        # parcel endpoints for this variant
        e_ok = pe >= 0
        pu = np.full(len(pe), -1); pv = np.full(len(pe), -1)
        for i in np.where(e_ok)[0]:
            ei = pe[i]
            if barrier[ei]:
                _, a = barrier_sides(u[ei], walk_e["bu"].values[ei]); b_, _ = barrier_sides(v[ei], walk_e["bv"].values[ei])
                pu[i], pv[i] = sub(u[ei], a), sub(v[ei], b_)
            else:
                pu[i] = sub(u[ei], sector_of(u[ei], walk_e["bu"].values[ei]))
                pv[i] = sub(v[ei], sector_of(v[ei], walk_e["bv"].values[ei]))
        # augment graph with one virtual source node per school
        S = len(sch)
        rows, cols, w = [], [], []
        for k, att in enumerate(sch_att):
            for ei, du_, dv_ in att:
                for nd, off in ((u[ei], du_), (v[ei], dv_)):
                    # connect to all sectors at the node: the school frontage acts as a crossing
                    for sct in range(nsec(nd)):
                        rows.append(N + k); cols.append(sub(nd, sct)); w.append(off)
        aug = coo_matrix((w, (rows, cols)), shape=(N + S, N + S)).tocsr()
        G = (_pad(g, N + S) + aug)
        G = G.maximum(G.T)
        for k0 in range(0, S, 24):
            ks = list(range(k0, min(S, k0 + 24)))
            D = dijkstra(G, directed=False, indices=[N + k for k in ks], limit=WALK_LIMIT)
            for j, k in enumerate(ks):
                dk = D[j]
                pd_ = np.full(len(pe), np.inf)
                okp = pu >= 0
                pd_[okp] = np.minimum(dk[pu[okp]] + pdu[okp], dk[pv[okp]] + pdv[okp])
                accumulate(VARIANTS.index(vname), k, pd_)
                if vname in ("T0", "T2s"):
                    walksheds.setdefault(int(sch["id"].values[k]), {})[vname] = _walkshed(walk_e, u, v, sub, sector_of, barrier_sides, barrier, dk, n_nodes)
        print(f"variant {vname}: graph {N} nodes, {time.time() - t:.0f}s")

    # pack
    pairs = sorted(results)
    arr = np.zeros((len(VARIANTS), len(pairs), NBINS), dtype=np.uint16)
    for j, key in enumerate(pairs):
        arr[:, j, :] = np.round(np.clip(results[key], 0, 1) * 10000)
    (OUT / "walk.bin").write_bytes(arr.tobytes())
    write_json(OUT / "walk_meta.json", {"variants": VARIANTS, "nbins": NBINS, "bin_miles": 0.1,
                                         "pairs": [[s, k] for s, k in pairs], "scale": 10000})
    # barrier roads for display
    disp = walk_e[walk_e["tier"] <= 3][["FULLNAME", "tier", "geometry"]].copy()
    disp["sidewalk"] = sidewalk[walk_e["tier"].values <= 3]
    disp = disp.to_crs(4326)
    disp["geometry"] = disp.geometry.simplify(0.00003)
    disp.to_file(OUT / "barriers.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    sigpts = gpd.GeoDataFrame(geometry=gpd.points_from_xy(coords[sig, 0], coords[sig, 1]), crs=walk_e.crs).to_crs(4326)
    sigpts.to_file(OUT / "signals.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    lim = edges[~edges["walk"]].to_crs(4326)
    lim = lim[lim["ROAD_CLASS"].isin(["INT", "HWY"]) | (lim["SPEED_LIMIT_CAR"] >= 50)]
    lim = gpd.GeoDataFrame({"name": lim["FULLNAME"].values}, geometry=lim.geometry.simplify(0.00005).values, crs=4326)
    lim.to_file(OUT / "highways.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    (WORK / "walksheds.json").write_text(json.dumps(walksheds))
    return walk_e, coords


def _pad(m, n):
    m = m.tocoo()
    return coo_matrix((m.data, (m.row, m.col)), shape=(n, n)).tocsr()


def _walkshed(walk_e, u, v, sub, sector_of, barrier_sides, barrier, dk, n_nodes):
    """Reachable-edge distances (base node level) for drawing: list of (edge, max end distance) within 2 mi."""
    du = dk[:n_nodes][u]
    dv = dk[:n_nodes][v]
    d = np.maximum(du, dv)
    ok = np.where(np.isfinite(d) & (d <= 2.0 * MILE))[0]
    return [ok.tolist(), np.round(d[ok]).astype(int).tolist()]


def walkshed_polygons(walk_e, schools):
    """Buffer reachable edges into polygons at 0.5-mi steps for each school and two variants."""
    t = time.time()
    ws = json.loads((WORK / "walksheds.json").read_text())
    level = dict(zip(schools["id"], schools["level"]))
    geoms = walk_e.geometry.values
    out_dir = OUT / "walksheds"
    out_dir.mkdir(exist_ok=True)
    for sid, vv in ws.items():
        feats = []
        for vname, (eidx, dist) in vv.items():
            eidx = np.array(eidx); dist = np.array(dist)
            for thr in ((0.5, 1.0, 1.5) if level.get(int(sid)) == "ES" else (1.0, 1.5, 2.0)):
                sel = eidx[dist <= thr * MILE]
                if not len(sel):
                    continue
                poly = shapely.union_all(shapely.buffer(geoms[sel], 60, quad_segs=2)).simplify(25)
                feats.append({"variant": vname, "miles": thr, "geometry": poly})
        if feats:
            g = gpd.GeoDataFrame(feats, crs=walk_e.crs).to_crs(4326)
            g["geometry"] = g.geometry.simplify(0.0001)
            g.to_file(out_dir / f"{sid}.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    print(f"walkshed polygons ({time.time() - t:.0f}s)")


# ---------------------------------------------------------------- drive
BUS_SPEED = {  # mph by class when speed limit missing; effective bus speed is 75% of limit, capped at 45
    "INT": 55, "HWY": 50, "RMP": 30, "MRG": 30, "PRI": 40, "SEC": 35, "TER": 30, "LOC": 25,
    "PRK": 10, "DRV": 10, "CRS": 15, "TRL": 0,
}


def drive(students, schools):
    t = time.time()
    roads = read("roads")
    roads = roads[(roads["STATUS"].fillna("B") == "B") & (roads["ROAD_CLASS"] != "TRL")].reset_index(drop=True)
    spd = roads["SPEED_LIMIT_CAR"].where(roads["SPEED_LIMIT_CAR"] >= 10, roads["ROAD_CLASS"].map(BUS_SPEED).fillna(25))
    eff = np.minimum(spd, 45) * 0.75 * 0.44704  # m/s
    sec = roads.geometry.length.values / eff.values + 2.0  # + small intersection delay
    coords, u, v = node_ids(list(roads.geometry.values))
    N = len(coords)
    g = coo_matrix((sec, (u, v)), shape=(N, N)).tocsr()
    g = g.maximum(g.T)
    tree = STRtree(shapely.points(coords))

    parcels = gpd.read_parquet(WORK / "parcels.parquet")
    spa_ids = students["spa"]
    # student-weighted SPA centroid (all bands)
    wt = parcels[["w_ES", "w_MS", "w_HS"]].sum(axis=1).values
    px, py = parcels.geometry.x.values, parcels.geometry.y.values
    df = pd.DataFrame({"spa": parcels["spa"].values, "wx": px * wt, "wy": py * wt, "w": wt})
    agg = df.groupby("spa").sum()
    spa_poly = read("spa_2026").set_index("STUDENT_PLANNING_AREAS")
    cx, cy = [], []
    for s in spa_ids:
        if s in agg.index and agg.loc[s, "w"] > 0:
            cx.append(agg.loc[s, "wx"] / agg.loc[s, "w"]); cy.append(agg.loc[s, "wy"] / agg.loc[s, "w"])
        else:
            p = spa_poly.loc[s].geometry.representative_point()
            cx.append(p.x); cy.append(p.y)
    cpts = shapely.points(np.c_[cx, cy])
    spa_node = tree.query_nearest(cpts)[1]
    spts = gpd.GeoSeries(gpd.points_from_xy(schools["lon"], schools["lat"]), crs=4326).to_crs(roads.crs).values
    sch_node = tree.query_nearest(spts)[1]
    D = dijkstra(g, directed=False, indices=spa_node, limit=1800)
    to_school = D[:, sch_node]
    to_spa = D[:, spa_node]
    print(f"drive matrix ({time.time() - t:.0f}s)")
    # sparse encode: SPA->school within 30 min; SPA<->SPA within 15 min
    ss = [[[int(k), int(round(to_school[i, k]))] for k in np.where(np.isfinite(to_school[i]))[0]] for i in range(len(spa_ids))]
    pp = [[[int(j), int(round(to_spa[i, j]))] for j in np.where(np.isfinite(to_spa[i]) & (to_spa[i] <= 900))[0] if j != i] for i in range(len(spa_ids))]
    cent = gpd.GeoSeries(cpts, crs=roads.crs).to_crs(4326)
    write_json(OUT / "drive.json", {"spa_school": ss, "spa_spa": pp})
    return [[round(p.x, 5), round(p.y, 5)] for p in cent]


if __name__ == "__main__":
    students = json.loads((WORK / "students.json").read_text())
    schools = pd.read_json(WORK / "schools.json")
    walk_e, _ = walk(students, schools)
    walkshed_polygons(walk_e, schools)
    cents = drive(students, schools)
    (WORK / "spa_centroids.json").write_text(json.dumps(cents))
