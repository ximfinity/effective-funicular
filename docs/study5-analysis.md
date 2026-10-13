# Study 5: Keene Mill island / Cardinal Forest / White Oaks (and Rolling Valley SPA 8922)

*Independent analysis with the unofficial FCPS Boundary Explorer model. It is not affiliated with FCPS or Fairfax County; see [DISCLAIMER.md](../DISCLAIMER.md). All figures other than those quoted from FCPS are model estimates.*

**Source reviewed:** FCPS, *Phase 2 – Study 5 – Second Community Meeting*, Cardinal Forest ES, October 14, 2026 (23 slides), linked from the [study page](https://www.fcps.edu/form/rolling-valley-elementary-school-middle-and-high-school-feeders-and-keene-mill-elementary-0).
**Reproduce:** `cd web && npx tsx scripts/study5.ts` (writes `docs/study5-results.json`).

## What FCPS proposes

| Scenario | Changes (elementary only; MS/HS unchanged) | FCPS feedback (226 responses) |
|---|---|---|
| **5-A** (Rolling Valley SPA 8922) | No change | 36% negative · 23% positive |
| **5-B** | SPA 8816 (Keene Mill Village, the Keene Mill island) → White Oaks, ~105 students. SPAs 7917 + 7919 Cardinal Forest → Keene Mill, ~115 students | 53% negative · 21% positive |
| **5-C** (recommended) | SPA 8816 → White Oaks, ~105 students. All of 7919, plus parts of 7917 and 7904 (east of Rolling Rd) Cardinal Forest → Keene Mill, ~85 students. SPA lines are edited | 47% negative · 28% positive |

FCPS states three goals: reduce the Keene Mill attendance island, eliminate the Keene Mill split feeder, and relieve Cardinal Forest's capacity deficit.

## Model check against the FCPS slides

The model reproduces FCPS's own numbers, so the extra measures below sit on a consistent base.

| School | FCPS SY25-26 | Model SY25-26 | FCPS 5-C adjusted | Model 5-C* | FCPS SY30-31 (no change) | Model SY30-31 (no change) |
|---|---|---|---|---|---|---|
| Cardinal Forest | 728 · 109% | 728 · 109% | 643 · 97% | 643 · 97% | 113% | 113% |
| Keene Mill | 740 · 97% | 740 · 97% | 720 · 95% | 720 · 95% | 86% | 89% |
| White Oaks | 715 · 85% | 715 · 85% | 820 · 97% | 820 · 97% | 85% | 83% |

\*Recalibrated so the moved areas carry FCPS's student estimates. The model's own yields put ~188 elementary students in 7917 + 7919, where FCPS counts ~115, likely because of the townhouse/condo mix. 5-C's partial SPAs are approximated as all of 7919, the south-east ~25% of 7917 (measured from parcels) and ~8% of 7904, sized to FCPS's 85-student total.

## Results (SY 2026-27 unless noted; recalibrated to FCPS counts)

| Measure | 5-A / no change | 5-B | **5-C** |
|---|---|---|---|
| Cardinal Forest utilization, SY26-27 → SY30-31 | 111% → 113% | 95% → 97% | **98% → 100%** |
| Keene Mill utilization | 95% → 89% | 95% → 91% | **93% → 89%** |
| White Oaks utilization | 85% → 83% | 97% → 94% | **97% → 94%** |
| Students reassigned (ES) | 0 | ~219 | **~201** |
| Keene Mill → middle school feeder | 87% Irving / 13% Lake Braddock (split) | 100% Irving | **100% Irving** |
| Keene Mill attendance area pieces | 2 (island) | 2 | **2 (island reduced; SPA 8821 remains detached)** |
| Walk share: Cardinal Forest / Keene Mill / White Oaks | 56% / 31% / 51% | 59% / 36% / 44% | **60% / 36% / 44%** |
| Bus routes CF / KM / WO (avg ride) | 6 / 8 / 7 (12 / 28 / 32 min) | 5 / 7 / 9 | **5 / 7 / 9 (11 / 31 / 27 min)** |
| Countywide fleet estimate | 1,138 | 1,138 | **1,138** |
| Est. FRL% CF / KM / WO | 31% / 21% / 25% | 32% / 22% / 24% | **33% / 20% / 24%** |

**Moved areas, old school → new school:**

| Area | Est. ES students | Walk share (1.0 mi, arterial barriers) | Drive time | Est. FRL |
|---|---|---|---|---|
| 8816 Keene Mill Village (island) → White Oaks | ~108 | 0% → 0% | 5.1 → 4.1 min | 19% |
| 7919 Carrleigh Pkwy → Keene Mill | ~70 | 10% → **37%** | 5.2 → 4.6 min | 13% |
| 7917 (Prince James Dr condos/townhouses) → Keene Mill | 5-B: ~41; 5-C: ~14 | **89% → 20%** | 2.5 → 3.6 min | **48%** |
| 7904 part (east of Rolling Rd) → Keene Mill | 5-C: ~9 | 83% → 28% | 2.3 → 3.0 min | 13% |

**Independent check.** Restricted to these three schools, with balanced goals and a strong feeder weight, the optimizer chooses only **8816 → White Oaks** and **7919 → Keene Mill**. That is the core of 5-C. It leaves 7917 and 7904 alone and reaches Cardinal Forest 101%, Keene Mill 90%, White Oaks 97%.

## Pros and cons of the recommended scenario (5-C)

**Pros**
- **Meets all three stated goals.** Cardinal Forest drops from 109–111% to ~97–98%. The Keene Mill split feeder disappears (all Keene Mill students go to Irving / West Springfield). The island shrinks.
- **The core moves are efficient.** 8816 gets a shorter drive (5.1 → 4.1 min) and keeps Lake Braddock MS/HS, so families there see no secondary-school change. 7919 gains walkability (10% → 37% within a mile of Keene Mill) and a slightly shorter drive. That matches FCPS's report of strong support from Carrleigh Pkwy residents.
- **Fewer walkers lost than 5-B.** By taking only a slice of 7917, 5-C keeps most of that higher-need, highly walkable area (~89% walk to Cardinal Forest, est. FRL ~48%) at Cardinal Forest. 5-B would turn ~41 of those students into bus riders.
- **Balanced utilization.** All three schools end at 93–98% in SY26-27, inside or near FCPS's 95–104% "approaching" band, with no school above 100%.
- **No busing penalty.** The countywide fleet is unchanged. White Oaks needs ~2 more routes and Cardinal Forest ~1 fewer, and White Oaks' average ride falls (~32 → 27 min).

**Cons / risks**
- **Cardinal Forest's relief is thin and erodes.** On FCPS's own growth projections, Cardinal Forest climbs back to ~100% by SY30-31 under 5-C (97% under 5-B). That's within a few years of a renewed deficit while it still uses 7 trailers.
- **White Oaks fills up.** It goes from 85% to 97% now and stays ~94% in SY30-31, leaving little room for future relief elsewhere.
- **The island is only reduced, not eliminated.** SPA 8821 (~100 elementary students) stays a detached piece of Keene Mill, so a future boundary review will likely revisit it.
- **SPA edits add complexity.** Splitting 7917 and 7904 needs new SPA lines. The model can't confirm exactly which homes move. The 7917 slice sits next to Cardinal Forest, and the model shows that area as highly walkable to it (89%); moving even part of it trades a short walk for a bus ride for ~14 students, from the area with the highest estimated FRL in the study.
- **Keene Mill rides get longer.** The average Keene Mill ride rises from ~28 to ~31 min (max ~44 min) as it picks up 7919 and loses the nearby island.
- **Community sentiment is negative.** 47% of 5-C responses were negative or very negative, versus 28% positive. 8816 families split between keeping Shannon Station together and wanting Lake Braddock feeder alignment (5-C keeps Lake Braddock for MS/HS).

## Rolling Valley SPA 8922 (5-A: no change)

- **Feeder split remains.** About 9% of Rolling Valley's middle-school cohort (8922) goes to Key/Lewis while the rest goes to Irving/West Springfield.
- **Untested alternative** (not an FCPS scenario): moving 8922 (~68 elementary students, est. FRL ~42%) to Saratoga, which already feeds Key/Lewis, ends that split. It would leave Rolling Valley at ~66% (underused) and push Saratoga to ~96%, with no walk or drive benefit. On capacity alone, 5-A is defensible.
- **Data note.** FCPS's 5-A table shows Rolling Valley 534 (97%) and Saratoga 617 (76%). The county's 2026-27 planning-area layer already assigns SPAs 8921 and 8923 (formerly Rolling Valley) to Saratoga, so the model shows Rolling Valley ~80% and Saratoga ~88% under 5-A. It's worth asking FCPS which set of numbers reflects the adopted 2026-27 boundaries.

## What would work best? Exhaustive search (Oct 13, 2026)

`web/scripts/study5-search.ts` tries every combination of up to 6 whole-planning-area moves among Cardinal Forest, Keene Mill, White Oaks, Rolling Valley and Saratoga. That is 30 options from 15 boundary planning areas, plus "fix the feeder in place" moves, about 334k combinations, all recalibrated to FCPS counts. For each set of goals it keeps the combination that affects the fewest students. Results are written to `docs/study5-search.json`.

| Goal set (through SY30-31) | Fewest students moved | Moves | Result |
|---|---|---|---|
| Capacity only (all ≤100%) | 137 ES | 7822 CF→WO, 7911 CF→RV | Keeps the island and Keene Mill's split feeder, and *creates* a White Oaks split feeder. Not recommended. |
| ≤100%, no split feeders (island may stay) | 109 ES + 134 MS/HS | 7904 CF→RV; 8816 and 8922 keep their ES but switch MS/HS to Irving/West Springfield | 90 students lose a walkable route. Not recommended. |
| ≤105%, no islands, no split feeders | 275 ES + 51 MS/HS | 7919→KM, 8816→WO, 8821→RV, 8922 MS/HS → Irving/WSHS | Cardinal Forest stays at 101–103% |
| All goals: ≤100%, no islands, no split feeders | 403 ES | 7822→RV, 7919→KM, 8816→WO, 8821→RV, 8922→Saratoga | Everything is clean, but Keene Mill falls to 75–78% |

**Recommended balance: FCPS's 5-C core plus one more whole planning area**

| Plan | ES moved | Lose walk | CF / KM / WO / RV (SY26-27 → SY30-31) | Island | Split feeders |
|---|---|---|---|---|---|
| FCPS 5-C (with partial SPAs) | ~193 | ~23 | 98→100 / 93→89 / 97→94 / 77→73 | remains (8821) | RV |
| 5-C core only (8816→WO, 7919→KM) | 178 | 0 | 101→103 / 90→86 / 97→94 / 77→73 | remains | RV |
| **5-C core + 7822 CF→RV** | **238** | **0** | **93→94 / 90→86 / 97→94 / 87→83** | remains | RV |
| …+ 8922 MS/HS → Irving/WSHS | 238 + 51 MS/HS | 0 | same | remains | **none** |

Why this beats 5-C over the long term:
- Cardinal Forest stays at about 94% through SY30-31 instead of drifting back to about 100%.
- It uses Rolling Valley's empty seats (73% by SY30-31 otherwise) instead of loading White Oaks alone.
- No planning area has to be split.
- No student loses a walkable route. 7822's students already ride the bus.

**Cost:** about 60 students in 7822 ride about 3 minutes longer (3.5 → 6.5 min). Moving 7911 → Rolling Valley instead (77 students, 2.9 → 5.5 min) is a near-equal alternative.

## Questions worth raising with FCPS

1. Which homes in 7917 and 7904 move under 5-C? How many of them are within Cardinal Forest's walk zone today?
2. Cardinal Forest projects back near 100% by SY30-31 under 5-C. Is a further step, or keeping its 7 trailers, planned?
3. Is SPA 8821 expected to stay a Keene Mill island, and why?
4. How do 534 / 617 for Rolling Valley / Saratoga square with the adopted 2026-27 reassignment of SPAs 8921 and 8923?

## Method notes and limits

- **Projections.** Model run on adopted 2026-27 boundaries, using the CIP projections plus the county housing forecast.
- **Walk share.** Within 1.0 mile on the street and trail network. Arterials (≥35 mph) can be crossed only at inferred signals, and arterials count as walkable only where a sidewalk exists.
- **Buses and FRL.** Bus figures are heuristic route estimates, not FCPS routes. FRL figures are modeled neighborhood estimates.
- **Partial planning areas.** 5-C's parts of 7917 and 7904 are approximations, so results for 5-C's edited areas are the least certain part of this analysis.
- **Phasing.** Policy 8130 lets current grade 5–6 students stay, so first-year shifts will be smaller than shown.
