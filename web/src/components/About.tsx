import type { Model } from '../model/types'
import { pct } from '../lib/format'
import { DisclaimerText } from './Disclaimer'

export function About({ model }: { model: Model }) {
  const pr = model.raw.params
  return (
    <div className="about">
      <h3>What this is</h3>
      <p>An unofficial, independent model of Fairfax County Public Schools attendance boundaries, built only from public data. Use it to see why boundaries fall where they do, and to test changes. It is <b>not</b> an FCPS or Fairfax County tool, and it never tells anyone which school they are assigned to. Use the <a href="https://www.fcps.edu/facilities-planning-future/school-boundary-adjustments" target="_blank" rel="noreferrer">FCPS Boundary Explorer</a> for official assignments.</p>
      <div className="legal">
        <h3>Disclaimer</h3>
        <DisclaimerText />
      </div>
      <h3>Building blocks</h3>
      <p>Boundaries are drawn from FCPS's {model.S.toLocaleString()} <b>Student Planning Areas</b> (SPAs), the same neighborhood units FCPS and its consultant used in the 2024-26 comprehensive review. Each SPA carries its adopted 2026-27 ES/MS/HS and AAP assignments. 2025-26 assignments come from overlaying the county's prior-year attendance areas.</p>
      <h3>Students <span className="tag">estimated</span></h3>
      <ul>
        <li>Parcel housing units (Fairfax County, by type) × per-grade student yields fitted on each high-school pyramid.</li>
        <li>Calibrated so that, under the 2025-26 boundaries, every school reproduces its Sept-2025 membership from the adopted FY 2027-31 CIP. This accounts for upper-ES pairs, 6-8 middle schools, AAP Level IV centers ({pct(pr.aap_es)} of grades 3-6, {pct(pr.aap_ms)} of 7-8 by default) and TJHSST (~{pct(pr.tj_share, 1)} of grades 9-12).</li>
        <li>Projections: each school's CIP projection is split into new-housing students (placed in the SPA where the county forecasts new units) and a cohort trend applied proportionally.</li>
        <li>Demographics: school FRL% (NCES CCD 2024-25) is spread to SPAs with a model fitted across schools, in which apartment share predicts FRL (logit slope {pr.frl_beta.toFixed(2)}). Race shares come from the base school. These are rough neighborhood estimates, not counts.</li>
      </ul>
      <h3>Walking <span className="tag">derived</span></h3>
      <ul>
        <li>Distances are measured along county road centerlines and trails, from every home parcel to every school within 2 miles. Limited-access highways can only be crossed on bridges and underpasses.</li>
        <li><b>Barrier roads</b> (by tier) can't be crossed except at signalized intersections (or not at all, if that option is off), and can be walked along only where county sidewalk data shows a sidewalk. Signals are not in public county data, so they are <i>inferred</i> where two arterials meet, or an arterial meets a collector.</li>
        <li>FCPS's actual hazard designations and crossing-guard posts aren't public, so walk zones here are approximations.</li>
      </ul>
      <h3>Buses <span className="tag">estimated</span></h3>
      <ul>
        <li>Riders = students beyond walk distance or cut off by barriers, × a ridership rate.</li>
        <li>Routes per school use a Clarke-Wright savings heuristic on road travel times between SPA centroids, limited by bus capacity and maximum ride time. Lines on the map connect SPA centroids, not actual streets.</li>
        <li>Fleet = peak number of routes running at the same time, using the 2024-25 bell schedule, plus spares. General-education routes only.</li>
      </ul>
      <h3>Sources</h3>
      <ul className="src">
        <li>Fairfax County GIS open data: Student Planning Areas, ES/MS/HS/AAP attendance areas (2025-26 and 2026-27), school facilities, roadways, sidewalks, trails, current and forecast housing units</li>
        <li>FCPS Adopted Capital Improvement Program FY 2027-31: program capacity, membership, temporary classrooms, projections</li>
        <li>FCPS Transportation bell schedule 2024-25</li>
        <li>NCES Common Core of Data 2024-25: free/reduced-price lunch eligibility, enrollment by race</li>
        <li>Basemap © OpenStreetMap contributors, OpenFreeMap</li>
      </ul>
      <p className="muted">Data built {model.raw.generated}.</p>
    </div>
  )
}
