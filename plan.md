# FCPS Boundary Explorer: Plan

An interactive map that lets community members see **why** school attendance boundaries sit where they do, and try out changes that reduce overcrowding, cut busing, and use school capacity better. It covers elementary, middle, and high school levels.

> Status: **v1 built.** Decisions are in §0, data sources in §3, the as-built design in §10 and validation in §11.

## 0. Decisions (from the owner, Oct 2026)

| Question | Decision |
|---|---|
| District | Fairfax County Public Schools, VA |
| Audience | Personal site, a modeling tool first. Analytical depth matters more than polish. |
| Scope | **Whole county, all pyramids, ES + MS + HS** |
| Baselines | **Both**: 2025-26 boundaries and adopted 2026-27 boundaries, with a diff between them |
| Demographics | **Included.** Shown for every scenario and available to the optimizer as an optional weight (default 0) |
| Special programs | **Included**: AAP Level IV center assignment, TJHSST draw, program capacity from the CIP |
| Buses | **Route lines and served areas drawn on the map** |
| Road barriers | Derived from public road data (class, speed limit, divided) |
| Data / tech | No limits. Use whatever public data and technology gives the best model. |

---

## 1. Goals and non-goals

**Goals**
1. **Explain the current boundaries.** For any address or neighborhood, show which factors put it in its school: walk zone, barriers, capacity, feeder pattern, program location, history.
2. **Let people simulate.** Users reassign neighborhoods (or let an optimizer do it) and see the effects right away: utilization, walkers vs. bus riders, buses needed, split feeders, and students moved.
3. **Compare scenarios side by side.** Today's boundaries, the board-adopted 2026-27 boundaries, and user scenarios.
4. **Be honest about uncertainty.** Every number is labeled as official, derived, or estimated.

**Non-goals (v1)**
- This is not an official FCPS tool and does not produce binding assignments.
- No student-level or address-level student data, ever. See §9.
- No real bus routing for operations. Bus counts are planning estimates.

---

## 2. Background research (what FCPS actually uses)

| Topic | Finding | Implication for tool |
|---|---|---|
| Governing policy | **Policy 8130** (revised July 2024) requires a comprehensive review of all boundaries every 5 years. *Required* criteria: access to programming, enrollment/capacity, proximity, transportation. *Optional* criteria: pyramids/feeders, minimizing disruption, family involvement, reducing temporary space, stability, cost. | Use these as the tool's core objective terms so the tool speaks the board's language. |
| Latest review | The first comprehensive review in 40+ years was adopted on **Jan 22, 2026**. About 1,700 students at 46 schools move, effective SY 2026-27. Four extended "hot-spot" studies are due **Jan 2027**: Gunston/Halley/Laurel Hill/Lorton Station; Bren Mar Park feeders; Greenway Downs/Jefferson Village/City Park Homes/Kingsley Commons; Rolling Valley feeders (SPA 8922); Glasgow MS (Beech Tree/Belvedere); Keene Mill island (Cardinal Forest/White Oaks). | The hot spots make good **built-in demo scenarios** and show the tool is relevant right now. |
| Building blocks | The consultant (Thru Consulting) built scenarios from about **1,000 Student Planning Areas (SPAs)**, which are neighborhood units meant to stay together. | **Use SPAs as the atomic unit** (see §4). |
| Problems targeted | Overcrowding, **split feeders** (an elementary school whose students go to more than one MS or HS), **attendance islands** (non-contiguous areas), and schools located outside their own boundary. | Each one gets a metric and a map layer. |
| Walk zones | Students are walkers within **1.0 mi (ES)** and **1.5 mi (MS/HS)** unless Transportation finds "no acceptable walking route" (Reg. 8617, form TR-53). The bus-stop walk is at most **0.5 mi**. | These are the default slider values. Distance is measured **along the walking network, not straight-line**. |
| Buses | About **1,625 buses** on day 1 of SY 2025-26. Staggered **bell tiers** let one bus serve several schools. | The bus estimate must model tiers. Otherwise it overcounts by roughly 2–3×. |
| Capacity data | FCPS publishes program capacity, membership, 5-year projections, and temporary-classroom counts in the **CIP** (FY 2027-31 adopted Feb 2026) and the **Facilities & Membership Dashboards**. | Capacity and projections come from these, transcribed per school. |
| Open GIS | Fairfax County GIS open data has ES/MS/HS (and AAP) attendance-area polygons, FCPS facilities, **sidewalk and crosswalk centerlines** (updated 2024), trails, and street centerlines. Formats include GeoJSON, Esri REST, and shapefile. | This is the main geometry source. Sidewalk data makes walk modeling much better than OSM alone. |

---

## 3. Data inventory

### 3a. Confirmed sources (checked Oct 2026, downloaded by `pipeline/fetch.py`)

| Layer | Endpoint (Fairfax County AGOL org `ioennV6PpG5Xodq0` unless noted) | Notes |
|---|---|---|
| **Student Planning Areas** (1,327 polygons) | `Student_Planning_Areas/0` | Each SPA carries its 2026-27 **ES, MS, HS, ES-AAP and MS-AAP assignments**. This removes the biggest risk. |
| Attendance areas 2026-27 | `Elementary/Middle/High_School_Attendance_Areas/0` | `SCH_YR = 2026_27` |
| Attendance areas 2025-26 | `OpenData_S1` layers 13/11/12 | `SCH_YR = 2025_26`. Gives the pre-review baseline. |
| AAP center areas | `Elementary/Middle_School_AAP_Attendance_Areas` | |
| School points | `School_Facilities/0`, `FCPS_Title_1/0` | |
| Capacity, membership, temporary classrooms, 5-yr projections | FCPS **Adopted CIP FY 2027-31** PDF, parsed | 201 schools |
| Demographics (FRL, race) | NCES CCD 2024-25 school files (lunch 033, membership 052) | VDOE is blocked from the build environment; CCD has the same data one year behind |
| Housing units by type (SFD/SFA/MF/MH), parcel points | `OpenData_S7/1` | About 340k parcels. Drives the student estimates. |
| Population, parcel points | `OpenData_S7/0` | |
| Housing forecast, years 1–6, parcel points | `OpenData_S6/0` | Drives the projections |
| Roads (148k segments, class, speed, divided, bridge) | `Roadways/0` | Basis for the walk and drive networks |
| Sidewalks + crosswalk connectors (500k) | `Sidewalks_Centerline/0` | Marks arterial segments that have a sidewalk |
| Trails | `OpenData_A1` layers 3, 4 | |
| Rail, streams | `Railroad_Lines/0`, `OpenData_S14/0` | |

**Gaps & how they're handled**
- **Students per SPA aren't published.** They're estimated: parcel housing units by type × student yield per level, with yields fitted by non-negative least squares so that the **2025-26 attendance areas reproduce each school's actual Sept-2025 membership**. The estimates are then rescaled per school to remove what's left over. Labeled "Estimated".
- **SPA demographics** come from the school-level FRL% applied to each SPA, adjusted by a housing-mix factor (multifamily share) and raked so that every school's total matches. Labeled "Estimated".
- **Traffic signals** aren't available (OSM/Overpass is blocked from the build environment). Signalized crossings are inferred where two arterials meet, or an arterial meets a collector, and labeled as an estimate. Bridges/overpasses never create an at-grade crossing.

### 3b. Original inventory

| Layer | Source | Status / risk |
|---|---|---|
| ES/MS/HS attendance areas (current) | Fairfax County GIS open data | ✅ Public. Need to confirm whether it already shows the 2026-27 boundaries. |
| 2026-27 adopted boundaries | FCPS Boundary Explorer / board docs | ⚠️ May be public only as a viewer. Might need to rebuild it from SPA assignment lists. |
| SPA polygons | FCPS (shown in scoping-map PDFs) | ⚠️ **Key risk.** Unclear whether published as GIS data. Fallback: rebuild from boundary overlays, or use census blocks. |
| Students per SPA by grade | FCPS | ❌ Probably not public at this level. Fallback: estimate from Census/ACS ages 5–17, scaled to each school's actual membership (dasymetric). A FOIA request is also possible. |
| School points, program capacity, membership, projections, temporary classrooms | FCPS GIS + CIP + dashboards | ✅ Public (some manual transcription). |
| Program sites: AAP Level IV centers, immersion, special ed centers, IB/AP, TJHSST, Title I | FCPS site pages | ✅ Public. Manual. |
| Pedestrian network | County sidewalks/crosswalks + trails + OSM footways | ✅ Public. |
| Road network with class, speed, lanes, volume (AADT) | VDOT functional classification + AADT; OSM | ✅ Public. |
| Signalized intersections / crossing guards | VDOT / county police | ⚠️ Signals partly in OSM. Crossing guards likely not public. |
| Natural barriers: streams, rail, large parks | County hydro, OSM | ✅ Public. |
| Development pipeline (future housing units) | Fairfax County Dept. of Planning & Development pipeline data | ✅ Public. Used for projections. |
| Demographics (FRM %, EL %) | VDOE school-level data | ✅ School-level only. SPA-level would need estimation. |
| Bell schedule / tiers | FCPS Transportation bell schedule PDF | ✅ Public. |

---

## 4. Core model

Everything runs on one data structure:

```
assignment[level][spa_id] -> school_id      // level ∈ {ES, MS, HS}
```

- **SPA** = the smallest unit that can move. Each SPA stores: polygon, centroid, estimated students by grade band, housing units, pipeline units, and a precomputed **walk distance** and **drive time** to each nearby school at every level.
- **Feeders** are derived. ES→MS and MS→HS follow from assignment overlap. A split feeder is any ES (or MS) whose students go to more than one next-level school above a configurable threshold (e.g., >10% of the cohort).
- Each metric (§6) is a pure function of `assignment` plus parameters. The UI recomputes the affected schools incrementally on every edit, and should feel instant (<50 ms).

---

## 5. User-adjustable variables (the "knobs")

### 5.1 Requested by you
| Variable | Default | Notes |
|---|---|---|
| **Max walking distance**, separately for ES / MS / HS | 1.0 / 1.5 / 1.5 mi | Network distance. Draws a **walkshed isochrone** around each school, so users see the true walk area instead of a circle. |
| **Major roads students won't be expected to cross** | Limited-access highways always block (I-495, I-95, I-66, Dulles Toll Rd, Fairfax County Pkwy, Rt 28). Arterials block if any of: speed ≥ 45 mph, ≥ 4 lanes, AADT above a threshold, unless there is a signalized crosswalk. | Toggles for each road class and each named road. A rule builder for speed, lanes, and AADT thresholds. A "signalized crosswalks count as safe" toggle. |
| **Bus estimator** | See §7 | Shows buses needed per school, per pyramid, and countywide. |

### 5.2 Recommended additions
**Capacity & enrollment**
- **Target utilization band** (default 85–105%), with separate thresholds for "overcrowded" and "underused".
- **Count temporary classrooms (trailers) as capacity?** Default: no. Reducing trailers is one of the Policy 8130 factors.
- **Enrollment year**: current, or projected +1…+5. Includes the development pipeline, so users see which boundaries stop working as housing gets built.
- **Program capacity reservations**: seats taken by AAP centers, special ed, immersion, and pre-K, which reduce general-ed capacity.
- **Transfer/choice inflow**: pupil placements and program students who don't live in the boundary (school-level estimate).

**Geography & community**
- **Natural barriers**: streams, rail lines, parks without through-trails (toggle).
- **Contiguity rule**: allow or forbid attendance islands.
- **Compactness weight**: penalize long, snake-shaped zones.
- **Keep-together units**: don't split a subdivision/HOA, census tract, or the City of Fairfax / Fort Belvoir areas.

**Feeder system**
- **Allow split feeders?** With a threshold slider (e.g., ≤ 10% of cohort may split).
- **Pyramid integrity**: require MS/HS boundaries to nest on ES boundaries.

**Transportation**
- **Max bus ride time** (e.g., 45 min ES, 60 min HS).
- **Max walk to bus stop** (0.5 mi).
- **Bus capacity** per level (riders/seat), **ridership rate** (share of eligible students who actually ride), **bell tiers** on/off.
- **Annual cost per bus** (to show $).

**Stability & disruption**
- **Students reassigned**, and a "max students moved" cap.
- **Grandfathering/phasing** (rising 5th/8th/11th/12th stay put): affects year-one numbers.
- **Recently moved penalty**: avoid moving an SPA that moved in the 2026 review.

**Equity (show only, or optimize: needs your decision, see §11)**
- FRM % and EL % per school before and after.
- Travel-time fairness: distribution of bus ride times by area.

---

## 6. Metrics & visualizations

**Scorecard (always visible, current vs. scenario)**
- Schools over / under / within the target band, at each level
- Countywide utilization spread (std. dev.); seats short vs. seats empty
- Walkers %, bus-eligible students, **estimated buses**, est. annual transport cost
- Split feeders, attendance islands, schools outside their own boundary
- Students reassigned (total and by school)
- Average and max walk distance; average and max bus ride time

**Map layers (toggle)**
1. Attendance zones by level (fill), with utilization color: blue = under, green = in band, red = over
2. Walksheds (network isochrones) from each school at the current slider value
3. Barrier network: highways and arterials, colored by why they block (speed, lanes, volume)
4. SPAs colored by mode (walk / bus / "hazard-bus", meaning inside walk distance but cut off by a barrier)
5. Feeder flows (ES → MS → HS lines, with width = students); split feeders highlighted
6. Estimated bus stops and route sketches
7. Development pipeline (future units)
8. Program locations (AAP, immersion, special ed, IB)
9. Diff layer: SPAs whose assignment differs between two scenarios

**"Why is my home here?" card.** Click any SPA or search an address to see: assigned schools at each level, walk distance and route, barriers crossed, the alternative schools it could go to and their utilization, and the feeder path. This is the main way the tool explains boundaries.

---

## 7. Bus-count estimator (approach)

Real FCPS routing is far more detailed. The goal is a **defensible estimate** that responds to boundary changes.

1. **Riders per SPA** = students outside the walkshed, or inside it but cut off by a barrier ("hazard riders"), × ridership rate.
2. **Stops**: cluster riders within each SPA so that every rider is ≤ 0.5 mi from a stop (greedy coverage on the street network).
3. **Routes per school**: capacitated vehicle routing with a Clarke-Wright savings heuristic, limited by bus capacity and max ride time. It runs on a precomputed SPA-to-SPA drive-time matrix, in a Web Worker.
4. **Tiering**: each school belongs to a bell tier. The fleet needed is roughly the largest number of routes running at once (or summed across tiers, minus routes one bus can chain within the gap between bell times). The UI shows both "no tiering" and "with tiering" numbers.
5. **Calibration**: tune ridership rate and capacity so that current boundaries reproduce the known ~1,625-bus total (and per-school numbers if FCPS will share them). The tool shows calibration error.

---

## 8. Optimizer ("suggest improvements")

- **Objective** = weighted sum of: utilization deviation from the band, bus count or bus-miles, students moved, split-feeder penalty, island/compactness penalty, and (optionally) equity terms. Users set weights with sliders or presets ("Fix overcrowding", "Minimize buses", "Least disruption", "Balanced").
- **Hard constraints**: contiguity, max walk/ride time, locked SPAs/schools (users can pin any SPA).
- **Method**: start from the current or a chosen scenario, then local search with simulated annealing over boundary-SPA swaps, running in a Web Worker. It streams improvements to the map live so users watch boundaries move.
- **Output**: a scenario plus a plain-language explanation of each change ("SPA 1234 moved from X ES to Y ES: X goes from 118% → 103%, adds 0 buses").
- Optional later: an exact solve with a MIP (e.g., HiGHS compiled to WASM) for a single pyramid.

---

## 9. Privacy & trust

_Full legal disclaimer: [DISCLAIMER.md](DISCLAIMER.md). The app shows it on first visit, keeps an "Unofficial · Disclaimer" link in the header, adds a line to the map attribution, and stamps exported scenarios._

- Only aggregate SPA-level counts. Estimated counts are rounded, and counts < 10 are hidden from tooltips.
- Every number is tagged as Official, Derived, or Estimated, with a "Data & methods" panel that names sources and dates.
- Clear disclaimer: unofficial, for community understanding, and not a source of truth for assignments.
- No user accounts. Scenarios are saved in the URL or a downloadable JSON file, so they can be shared without a backend.

---

## 10. Architecture (as built)

```
pipeline/ (Python, run once a year)                         web/ (React + TypeScript + MapLibre, static)
  fetch.py     public layers -> data/raw/                     model/engine.ts     grade-level routing, utilization,
  schools.py   193 program schools + CIP + bell + CCD                            walk/ride split, feeders, islands,
  students.py  parcels -> SPA students by grade, 6 yrs, FRL                       demographics  (~8 ms per recompute)
  network.py   walk graph (8 barrier variants), walk          model/buses.ts      Clarke-Wright routes + fleet (~100 ms)
               histograms, walksheds, drive times             model/optimizer.ts  simulated annealing (Web Worker)
  export.py    web/public/data/ bundle (~24 MB, walk-        components/         map, controls, scorecard, inspector,
               shed files lazy-loaded)                                            school table, optimizer, scenarios
```

**Key modeling decisions**
- **Unit of assignment.** SPA × level (ES / MS / HS). Students are routed **per grade**, so the model handles K-2/K-3 schools with upper-ES partners, the 6-8 middle schools (Glasgow, Holmes, Poe), secondary schools, AAP Level IV centers (from each SPA's AAP assignment) and TJHSST. A reassignment that leaves a grade unserved (for example, K-5 ES plus 7-8 MS) is flagged.
- **Student estimates.** County parcel housing units by type × per-grade yields. The yields are fitted on HS pyramids and regularized toward typical FCPS yield ratios, then calibrated with IPF so the 2025-26 boundaries reproduce every school's Sept-2025 CIP membership. The City of Fairfax isn't in county parcel data, so its housing is synthesized on a grid and calibrated the same way.
- **Projections.** Each school's CIP projection is split into new students from the county housing forecast (placed in the SPA where the units are built) and a cohort trend.
- **Demographics.** One logit intercept per school plus a shared slope on apartment share, solved by fixed-point iteration so each school's *enrolled* FRL (residents plus AAP/TJ inflows) matches NCES CCD 2024-25.
- **Walking.** County road centerlines plus trails. Limited-access roads are removed, so they can only be crossed on grade-separated roads. Each barrier road is split into left and right sides at every node, and the sides connect only at (inferred) signalized intersections. Barrier roads are walkable along only where county sidewalk data shows a sidewalk. Walk shares are pre-computed per (SPA, school, variant) as cumulative histograms in 0.1-mile bins, so the distance sliders update instantly.
- **Buses.** Riders = non-walkers (including barrier-blocked students) × ridership. Each school gets savings-heuristic routes under a capacity and max-ride limit. Fleet = peak concurrent routes across the 2024-25 bell schedule, plus spares.

## 11. Validation (data built Oct 2026)

| Check | Result |
|---|---|
| Modeled 2025-26 enrollment vs CIP Sept-2025 membership | mean abs error 0.0–0.2% across 192 schools (by construction) |
| Modeled 2025-26 FRL% vs NCES 2024-25 | mean abs error 0.3 points |
| Walk share, adopted 2026-27, ES (straight line / network / network + arterial barriers) | 71% / 42% / 38% |
| General-ed bus fleet estimate | ~1,140 buses, 2,180 routes (FCPS runs ~1,625 incl. special-ed and program routes) |
| Barrier side-splitting | 6 synthetic tests in `pipeline/tests/test_walk_graph.py` |
| Optimizer bookkeeping | incremental cost equals full recompute (`web/scripts/check.ts`) |
| Optimizer, "Fix overcrowding", ES, 300k moves | over-target ES 4 → 1, seat shortfall 457 → ~250, ~16 SPAs moved, ~1 s |

## 12. Known limitations & next steps

- Traffic signals and crossing guards are inferred, not observed. FCPS's own hazard designations aren't public. A per-road override (mark a crossing safe or unsafe) would need in-browser rerouting: the graph is ~90k nodes, which is feasible in a worker later.
- Bus routes connect SPA centroids, not streets. They don't model special-ed, magnet or shuttle runs, or real stop placement.
- The bell schedule is from 2024-25 (newest public PDF). Middle-school start times changed later.
- SPA demographics are model estimates. EL% isn't in CCD school files. Race shares are inherited from the base school.
- AAP center participation and TJ shares are uniform parameters. School-specific language immersion and special-ed program seats are reflected only through CIP program capacity.
- Done in v1.1: **Hot spots** tab for the four Jan-2027 extended studies (focus the map, optimize within the study's schools); GitHub Pages deploy workflow.
- Next: per-road barrier overrides; capital what-ifs (add or remove capacity, a new school site); exporting a proposal as a PDF.

## Answered questions
All of the open questions from the first draft were answered in §0.

---

## Sources
- FCPS, School Boundary Adjustments: https://www.fcps.edu/facilities-planning-future/school-boundary-adjustments
- FCPS, School Board approves comprehensive boundary review (Jan 2026): https://www.fcps.edu/news/school-board-approves-fcps-first-comprehensive-boundary-review-more-40-years-centered
- FFXnow, board approves first new boundary plan in four decades: https://www.ffxnow.com/2026/01/26/fairfax-county-school-board-approves-first-new-boundary-plan-in-four-decades/
- FCPS, Boundary Policy 8130 background: https://www.fcps.edu/facilities-planning-future/school-boundary-adjustments/boundary-policy
- Connection Newspapers, Policy 8130 highlights: https://m.connectionnewspapers.com/news/2024/jun/26/highlights-of-boundary-policy-and-assignment-of-students
- FCPS Boundary Review Scenario Explorer coverage (SPAs, Thru Consulting): https://www.burkeconnection.com/news/2025/may/21/fcps-school-boundary-scenario-explorer/ and https://www.ffxnow.com/2025/05/14/fcps-shares-initial-suggestions-for-school-boundary-changes/
- FCPS walker eligibility form TR-53: https://fcps.edu/sites/default/files/media/forms/tr53.pdf
- FCPS transportation & bell schedule: https://www.fcps.edu/services/families-and-caregivers/transportation and https://fcps.edu/sites/default/files/media/pdf/Transportation-Bell-Schedule-24-25-SY.pdf
- Bus count, first day SY 2025-26: https://www.burkeconnection.com/news/2025/aug/22/new-fcps-school-year/
- FCPS CIP and dashboards: https://www.fcps.edu/capital-improvement-program and https://www.fcps.edu/facilities-planning-future/facilities-and-membership-dashboards
- Fairfax County open data, attendance areas: https://catalog.data.gov/dataset/high-school-attendance-areas-11be3, https://catalog.data.gov/dataset/middle-school-attendance-areas-0899c, https://catalog.data.gov/dataset/elementary-school-attendance-areas-d91a8
- Fairfax County sidewalks layer: https://www.fairfaxcounty.gov/gispub2/rest/services/FCPA/TrailBuddy/MapServer/20
- FCPS Schools & Facilities layer: https://www.fairfaxcounty.gov/gispubsf1/rest/services/FRD/Tier_II_Facilities/MapServer/1
- Glasgow MS boundary study scoping maps (SPA example): https://www.fcps.edu/sites/default/files/GlasgowMSBoundaryStudy_ScopingMaps.pdf
