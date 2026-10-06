# FCPS Boundary Explorer

An interactive, unofficial modeling tool for **Fairfax County Public Schools** attendance boundaries
(elementary, middle and high school, countywide). Use it to see why boundaries fall where they do, and to
test changes that relieve overcrowding, cut busing and use capacity better.

- **Map:** the 1,327 FCPS Student Planning Areas, colored by assigned school, utilization, walk share,
  bus routes, change vs. baseline, density, estimated FRL% or projected growth.
- **Baselines:** the 2025-26 boundaries and the adopted 2026-27 boundaries.
- **Walk zones:** a per-level maximum walking distance, measured on the street and trail network.
  Barrier tiers set which roads students won't be expected to cross, with an option to allow crossing
  at signalized intersections. Barrier roads count as walkable only where a sidewalk exists.
- **Buses:** estimated routes per school (savings heuristic on road travel times), route lines on the map,
  and fleet size from bell-time overlap.
- **Capacity:** program capacity and trailers from the CIP, 5-year projections including the county
  housing pipeline, AAP centers and TJHSST.
- **Editing:** click or paint planning areas onto schools. Undo, save, share links and JSON export are built in.
- **Optimizer:** simulated annealing with weighted goals (overcrowding, empty seats, busing, disruption,
  feeders, compactness, demographics). It keeps every attendance area contiguous, and it never moves a
  locked area or the planning area that contains a school's own building.
- **"Why is my home here?":** address search and a per-area explanation, with alternatives and their
  utilization impact.

See [`plan.md`](plan.md) for the research, design and validation.

## Run the app

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in web/dist (relative paths: host anywhere)
npx tsx scripts/check.ts   # headless model validation against the data bundle
```

The data bundle in `web/public/data/` is committed, so the app runs without the pipeline.

## Rebuild the data

```bash
pip install -r pipeline/requirements.txt
python pipeline/build.py               # downloads ~1 GB of public GIS data into data/raw/ (cached)
python pipeline/tests/test_walk_graph.py
```

All inputs are public: Fairfax County GIS open data, the FCPS FY 2027-31 CIP, the FCPS 2024-25 bell
schedule, and the NCES Common Core of Data. Student counts per planning area, neighborhood demographics
and bus routes are **estimates**. This is not an FCPS product.
