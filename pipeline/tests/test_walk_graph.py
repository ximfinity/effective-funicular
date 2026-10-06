"""Synthetic checks for barrier side-splitting in the walk graph."""
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from scipy.sparse.csgraph import dijkstra

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from network import bearing, build_walk_graph, node_ids  # noqa: E402


def make(lines, tiers, names):
    g = gpd.GeoDataFrame({"tier": tiers, "FULLNAME": names}, geometry=[shapely.LineString(c) for c in lines], crs=32618)
    coords, u, v = node_ids(list(g.geometry.values))
    g["bu"] = [bearing(x, True) for x in g.geometry.values]
    g["bv"] = [bearing(x, False) for x in g.geometry.values]
    return g, coords, u, v


def node_at(coords, xy):
    return int(np.where((np.round(coords) == xy).all(axis=1))[0][0])


# A 4-way intersection at (0,0): arterial runs W-E (tier 1), local street runs N-S (tier 9).
lines = [[(-200, 0), (0, 0)], [(0, 0), (200, 0)], [(0, 0), (0, 200)], [(0, -200), (0, 0)]]
g, coords, u, v = make(lines, [1, 1, 9, 9], ["ART", "ART", "LOC", "LOC"])
N0 = len(coords)
north, south, east = node_at(coords, (0, 200)), node_at(coords, (0, -200)), node_at(coords, (200, 0))


def dist(cut, allow, sidewalk, sig_center):
    sig = np.zeros(N0, bool)
    sig[node_at(coords, (0, 0))] = sig_center
    G, sub, *_ = build_walk_graph(g, u, v, N0, np.array(sidewalk), sig, cut, allow)
    return dijkstra(G, directed=False, indices=[north])[0]


def test_no_barrier_crosses_freely():
    d = dist(0, False, [False] * 4, False)
    assert np.isclose(d[south], 400)


def test_barrier_blocks_unsignalized_crossing():
    # no sidewalks: otherwise the walker could go around the arterial's dead end in this toy network
    d = dist(1, True, [False, False, False, False], False)
    assert np.isinf(d[south])


def test_signal_allows_crossing():
    d = dist(1, True, [False, False, False, False], True)
    assert np.isclose(d[south], 415)  # 400 m + crossing cost


def test_no_crossings_variant_ignores_signal():
    d = dist(1, False, [False, False, False, False], True)
    assert np.isinf(d[south])


def test_walk_along_arterial_needs_sidewalk():
    d_sw = dist(1, False, [True, True, False, False], False)
    d_nosw = dist(1, False, [False, False, False, False], False)
    assert np.isclose(d_sw[east], 400)  # north side sidewalk reaches east end node
    assert np.isinf(d_nosw[east])


def test_sides_are_consistent_between_intersections():
    # arterial W-E with intersections at x=0 (north spur) and x=200 (north + south spurs); ends at +-400
    lines = [[(-400, 0), (0, 0)], [(0, 0), (200, 0)], [(200, 0), (400, 0)],
             [(0, 0), (0, 200)], [(200, 0), (200, 200)], [(200, -200), (200, 0)]]
    g2, c2, u2, v2 = make(lines, [1, 1, 1, 9, 9, 9], ["A", "A", "A", "L1", "L2", "L2"])
    n2 = len(c2)
    G, *_ = build_walk_graph(g2, u2, v2, n2, np.array([True, True, True, False, False, False]), np.zeros(n2, bool), 1, False)
    d = dijkstra(G, directed=False, indices=[node_at(c2, (0, 200))])[0]
    assert np.isclose(d[node_at(c2, (200, 200))], 600)   # stays on the north side
    assert np.isclose(d[node_at(c2, (200, -200))], 1000)  # must go around the arterial's east end


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
