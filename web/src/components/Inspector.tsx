import type { Assignment, Level, Model, Params } from '../model/types'
import { GRADE_LABELS, variantName } from '../model/types'
import type { Result } from '../model/engine'
import { effectiveCapacity, walkShare } from '../model/engine'
import { pairKey } from '../model/load'
import type { BusResult } from '../model/buses'
import { fmt, pct, clock } from '../lib/format'
import { utilColor } from '../lib/colors'
import type { Selection } from '../App'

interface Props {
  model: Model
  selection: NonNullable<Selection>
  assignment: Assignment
  base: Assignment
  params: Params
  level: Level
  result: Result
  buses: BusResult
  colors: Map<number, string>
  locked: Set<number>
  onReassign: (i: number, k: number, L: Level) => void
  onToggleLock: (i: number) => void
  onSelect: (s: Selection) => void
  onClose: () => void
  onPaint: (k: number) => void
}

export function Inspector(p: Props) {
  return (
    <div className="inspector">
      <button className="close" onClick={p.onClose}>×</button>
      {p.selection.kind === 'spa' ? <SpaCard {...p} i={p.selection.i} /> : <SchoolCard {...p} k={p.selection.k} />}
    </div>
  )
}

/** Distance (miles) at which a given share of the SPA's students is reached, from cumulative bins. */
function distAt(m: Model, spa: number, school: number, variant: string, share: number) {
  const j = m.walk.pairIndex.get(pairKey(spa, school))
  if (j === undefined) return Infinity
  const v = m.walk.variants.indexOf(variant)
  for (let b = 0; b < m.walk.nbins; b++) {
    if (m.walk.data[(v * m.walk.npairs + j) * m.walk.nbins + b] / m.walk.scale >= share) return (b + 1) / 10
  }
  return Infinity
}

const LEVEL_NAME: Record<Level, string> = { ES: 'Elementary', MS: 'Middle', HS: 'High' }

function SpaCard(p: Props & { i: number }) {
  const { model: m, i, assignment: a, base, params, level, result } = p
  const spa = m.raw.spa
  const variant = variantName(params)
  const n = (L: Level) => result.spaStudents[L][i]
  const units = spa.units[i]
  const k = a[level][i]
  const sch = k >= 0 ? m.schools[k] : null
  const drive = (kk: number) => m.drive.spaSchool[i].get(kk)
  // candidate schools at this level
  const cand = new Set<number>([k])
  for (const [j] of spa.adj[i]) if (a[level][j] >= 0) cand.add(a[level][j])
  m.schools.forEach((s, kk) => {
    if (s.level !== level || s.upper || s.magnet) return
    const d = drive(kk)
    if ((d !== undefined && d < 600) || m.walk.pairIndex.has(pairKey(i, kk))) cand.add(kk)
  })
  const studentsHere = n(level)
  const rows = [...cand].filter((kk) => kk >= 0).map((kk) => {
    const st = result.school[kk]
    const cap = effectiveCapacity(m, params, kk)
    const after = kk === k ? st.enroll : st.enroll + studentsHere * 0.9
    return { kk, s: m.schools[kk], drive: drive(kk), walk: walkShare(m, params, i, kk), util: st.util, utilAfter: after / cap, adjacent: kk === k || spa.adj[i].some(([j]) => a[level][j] === kk) }
  }).sort((x, y) => (x.drive ?? 1e9) - (y.drive ?? 1e9))

  // narrative
  const why: string[] = []
  if (sch) {
    const w = walkShare(m, params, i, k)
    const w0 = walkShare(m, params, i, k, 'T0')
    const med = distAt(m, i, k, variant, 0.5)
    if (w >= 0.5) why.push(`${pct(w)} of ${level} students here live within the ${params.walkMiles[level]} mi walk zone of ${sch.name} (median walk ${med === Infinity ? '>2' : med.toFixed(1)} mi).`)
    else if (w0 - w > 0.2) why.push(`Walking distance alone would let ${pct(w0)} walk to ${sch.name}, but the route crosses a barrier road, so only ${pct(w)} can — the rest are bus riders.`)
    else why.push(`Beyond walking distance of ${sch.name}: about ${fmt((drive(k) ?? NaN) / 60)} min by bus.`)
    const nearest = rows[0]
    if (nearest && nearest.kk !== k && nearest.drive !== undefined) {
      why.push(`${nearest.s.name} is closer by road (${fmt(nearest.drive / 60)} vs ${fmt((drive(k) ?? NaN) / 60)} min) but is at ${pct(nearest.util)} of capacity${nearest.util > params.utilHigh ? ' — moving this area there would add to its crowding' : ''}.`)
    } else if (nearest?.kk === k) why.push(`${sch.name} is the closest ${LEVEL_NAME[level].toLowerCase()} school by road.`)
    if (level === 'ES' && a.MS[i] >= 0) {
      const row = result.feeder.flowsEM.get(k)
      const tot = row ? [...row.values()].reduce((x, y) => x + y, 0) : 0
      const share = row?.get(a.MS[i]) ?? 0
      why.push(`Feeds ${m.schools[a.MS[i]].name} MS → ${m.schools[a.HS[i]]?.name ?? '?'} HS; ${pct(share / Math.max(tot, 1))} of ${sch.name}'s middle schoolers go there.`)
    }
    if (a[level][i] !== base[level][i]) why.push(`Changed in this scenario (baseline: ${m.schools[base[level][i]]?.name ?? '—'}).`)
  }
  const es = spa.a26.ESAAP[i], ms = spa.a26.MSAAP[i]
  return (
    <div>
      <h2>Planning area {spa.id[i]}</h2>
      <p className="muted">Region {spa.region[i]} · {fmt(units.reduce((x, y) => x + y, 0))} homes ({fmt(units[0])} single-family, {fmt(units[1])} townhouse, {fmt(units[2] + units[3])} apartments)</p>
      <div className="mini3">
        {(['ES', 'MS', 'HS'] as Level[]).map((L) => {
          const kk = a[L][i]
          const moved = kk !== base[L][i]
          return (
            <div key={L} className={L === level ? 'cur' : ''}>
              <div className="kl">{LEVEL_NAME[L]}</div>
              <div className="kv" style={{ borderColor: p.colors.get(kk) }}>{kk >= 0 ? m.schools[kk].name : '—'}{moved && <span className="chg">changed</span>}</div>
              <div className="muted">{fmt(n(L))} students · {pct(walkShare(m, params, i, kk))} walk</div>
            </div>
          )
        })}
      </div>
      <h4>Why {sch?.name ?? 'here'}?</h4>
      <ul className="why">{why.map((w, j) => <li key={j}>{w}</li>)}</ul>
      <h4>Alternatives ({LEVEL_NAME[level]})</h4>
      <table className="alts">
        <thead><tr><th>School</th><th>Drive</th><th>Walk</th><th>Util now → if moved</th><th /></tr></thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.kk} className={r.kk === k ? 'cur' : ''}>
              <td><i className="sw" style={{ background: p.colors.get(r.kk) }} />{r.s.name}{!r.adjacent && <span className="muted" title="not adjacent: would create an island"> ◇</span>}</td>
              <td>{r.drive === undefined ? '>30' : fmt(r.drive / 60)}m</td>
              <td>{pct(r.walk)}</td>
              <td><span style={{ color: utilColor(r.util) }}>{pct(r.util)}</span>{r.kk !== k && <> → <span style={{ color: utilColor(r.utilAfter) }}>{pct(r.utilAfter)}</span></>}</td>
              <td>{r.kk !== k && <button className="small" onClick={() => p.onReassign(i, r.kk, level)}>Assign</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Students by grade (est., {params.year === 0 ? '2025-26' : `SY ${2025 + params.year}-${String(26 + params.year).slice(-2)}`})</h4>
      <div className="grades">
        {(params.year === 0 ? spa.n[i] : spa.proj[params.year - 1][i]).map((x, g) => (
          <div key={g}><div className="gb" style={{ height: `${Math.min(40, x * 2)}px` }} /><span>{GRADE_LABELS[g]}</span><small>{fmt(x)}</small></div>
        ))}
      </div>
      <p className="muted">AAP centers: {es >= 0 ? m.schools[es].name : '—'} (ES), {ms >= 0 ? m.schools[ms].name : '—'} (MS). Est. FRL {pct(spa.frl[i][0])}.</p>
      <div className="btnrow">
        <button onClick={() => p.onToggleLock(i)}>{p.locked.has(i) ? 'Unlock' : 'Lock'} for optimizer</button>
        {k >= 0 && <button onClick={() => p.onSelect({ kind: 'school', k })}>Open {sch?.name}</button>}
      </div>
    </div>
  )
}

function SchoolCard(p: Props & { k: number }) {
  const { model: m, k, result, params, buses } = p
  const s = m.schools[k]
  const st = result.school[k]
  const routes = buses.bySchool.get(k) ?? []
  const keys = m.raw.spa.raceKeys
  const raceLabels: Record<string, string> = { asian: 'Asian', black: 'Black', hispanic: 'Hispanic', white: 'White', multi: 'Multiracial', other: 'Other' }
  const raceColors = ['#4e79a7', '#59a14f', '#f28e2b', '#bab0ac', '#b07aa1', '#9c755f']
  const feedsFrom = [...(s.level === 'MS' ? result.feeder.flowsEM : s.level === 'HS' ? result.feeder.flowsMH : new Map())]
    .map(([src, row]) => [src, (row as Map<number, number>).get(k) ?? 0] as [number, number]).filter(([, v]) => v > 1).sort((x, y) => y[1] - x[1])
  const feedsTo = [...((s.level === 'ES' ? result.feeder.flowsEM : result.feeder.flowsMH).get(k) ?? new Map<number, number>())].sort((x, y) => y[1] - x[1])
  const feedTot = feedsTo.reduce((x, [, v]) => x + v, 0)
  return (
    <div>
      <h2>{s.name} {s.upper ? 'Upper ES' : s.level}{s.title1 && <span className="tag">Title I</span>}</h2>
      <p className="muted">Grades {s.grades} · Region {s.region ?? '–'} · {s.address} · bell {s.bell ? clock(s.bell) : '–'} · <a href={s.url} target="_blank" rel="noreferrer">website</a></p>
      <div className="kpis">
        <div className="kpi"><div className="kl">Utilization</div><div className="kv" style={{ color: utilColor(st.util) }}>{pct(st.util)}</div><div className="kd">{fmt(st.enroll)} / {fmt(st.capacity)} seats</div></div>
        <div className="kpi"><div className="kl">Walk / bus</div><div className="kv">{pct(st.walkers / Math.max(1, st.enroll))}</div><div className="kd">{fmt(st.riders)} riders · {routes.length} routes</div></div>
        <div className="kpi"><div className="kl">Est. FRL</div><div className="kv">{pct(st.frl / Math.max(1, st.enroll))}</div><div className="kd">2024-25 actual {pct(s.frl ?? NaN)}</div></div>
      </div>
      <table className="facts">
        <tbody>
          <tr><td>Program / design capacity</td><td>{fmt(s.capacity ?? NaN)} / {s.design}</td></tr>
          <tr><td>Temporary classrooms (trailers)</td><td>{s.temp}{s.modular ? ` · ${s.modular} modular` : ''}</td></tr>
          <tr><td>Sept-2025 membership (CIP)</td><td>{fmt(s.membership ?? NaN)}</td></tr>
          <tr><td>CIP projection SY26-27 → SY30-31</td><td>{s.proj ? s.proj.map((x) => fmt(x)).join(' → ') : '–'}</td></tr>
          <tr><td>AAP center students (in)</td><td>{fmt(st.aapIn)}</td></tr>
          <tr><td>Riders cut off by barriers</td><td>{fmt(st.hazard)}</td></tr>
          <tr><td>Planning areas / pieces</td><td>{st.spas.length} / {st.components}{st.components > 1 && !s.upper ? ' (has islands)' : ''}{st.siteOutside ? ' · building outside own area' : ''}</td></tr>
          <tr><td>Moved in / out vs baseline</td><td>{fmt(st.movedIn)} / {fmt(st.movedOut)}</td></tr>
        </tbody>
      </table>
      <h4>Demographics (estimated)</h4>
      <div className="stack">
        {keys.map((key, q) => {
          const v = st.race[q] / Math.max(1, st.enroll)
          return v > 0.005 ? <div key={key} style={{ width: `${v * 100}%`, background: raceColors[q] }} title={`${raceLabels[key]} ${pct(v)}`}>{v > 0.08 ? raceLabels[key] : ''}</div> : null
        })}
      </div>
      {feedsTo.length > 0 && s.level !== 'HS' && (
        <>
          <h4>Feeds into</h4>
          <ul className="feeds">{feedsTo.map(([to, v]) => <li key={to} className={feedsTo.length > 1 && v < feedTot / 2 ? 'split' : ''} onClick={() => p.onSelect({ kind: 'school', k: to })}>{m.schools[to].name} — {pct(v / feedTot)}</li>)}</ul>
        </>
      )}
      {feedsFrom.length > 0 && (
        <>
          <h4>Fed by</h4>
          <ul className="feeds">{feedsFrom.slice(0, 12).map(([src, v]) => <li key={src} onClick={() => p.onSelect({ kind: 'school', k: src })}>{m.schools[src].name} — {fmt(v)} students</li>)}</ul>
        </>
      )}
      {routes.length > 0 && (
        <>
          <h4>Estimated bus routes ({routes.length})</h4>
          <table className="facts">
            <tbody>
              {routes.slice(0, 20).map((r, j) => (
                <tr key={j}><td>Route {j + 1}: {r.spas.length} area{r.spas.length > 1 ? 's' : ''}</td><td>{fmt(r.load)} riders · {fmt(r.minutes)} min · leaves {clock(r.start)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="btnrow">
        {!s.upper && !s.magnet && <button onClick={() => p.onPaint(k)}>Paint areas to {s.name}</button>}
      </div>
      <p className="hint">Set the map color to "Bus routes" or "Walk share" with this school selected to see its routes or walk area. Walk area outline uses {variantName(params) === 'T0' || params.straightLine ? 'no barriers' : 'arterial barriers with signal crossings'}.</p>
    </div>
  )
}
