import type { Level, Model, Params } from '../model/types'
import type { Result } from '../model/engine'
import type { BusResult } from '../model/buses'
import { fmt, pct, signed, YEAR_LABELS } from '../lib/format'

interface Props {
  model: Model
  level: Level
  result: Result
  base: Result
  buses: BusResult
  baseBuses: BusResult
  baseKey: '2025' | '2026'
  params: Params
}

type Row = [string, number, number, (x: number) => string, 'lower' | 'higher' | 'none', string?]

export function Scorecard({ model, level, result, base, buses, baseBuses, baseKey, params }: Props) {
  const t = result.totals[level], b = base.totals[level]
  const nSchools = model.schools.filter((s) => s.level === level && !s.magnet).length
  const frl = (r: Result) => {
    // spread of FRL% across schools (std dev, enrollment weighted)
    const xs = model.schools.map((s, k) => ({ s, st: r.school[k] })).filter(({ s, st }) => s.level === level && !s.magnet && st.enroll > 0)
    const tot = xs.reduce((a, x) => a + x.st.enroll, 0)
    const mu = xs.reduce((a, x) => a + x.st.frl, 0) / tot
    return Math.sqrt(xs.reduce((a, x) => a + x.st.enroll * (x.st.frl / x.st.enroll - mu) ** 2, 0) / tot)
  }
  const utilSpread = (r: Result) => {
    const us = model.schools.map((s, k) => (s.level === level && !s.magnet ? r.school[k].util : NaN)).filter(Number.isFinite)
    const mu = us.reduce((a, x) => a + x, 0) / us.length
    return Math.sqrt(us.reduce((a, x) => a + (x - mu) ** 2, 0) / us.length)
  }
  const bl = buses.byLevel[level], bbl = baseBuses.byLevel[level]
  const rows: Row[] = [
    ['Students (enrolled at level)', t.enroll, b.enroll, (x) => fmt(x), 'none'],
    [`Schools over ${pct(params.utilHigh)}`, t.over, b.over, (x) => fmt(x), 'lower'],
    [`Schools under ${pct(params.utilLow)}`, t.under, b.under, (x) => fmt(x), 'lower'],
    ['Schools in target band', t.inBand, b.inBand, (x) => `${fmt(x)} / ${nSchools}`, 'higher'],
    ['Seats short (over capacity)', t.seatsShort, b.seatsShort, (x) => fmt(x), 'lower'],
    ['Empty seats', t.seatsEmpty, b.seatsEmpty, (x) => fmt(x), 'none'],
    ['Utilization spread (std dev)', utilSpread(result), utilSpread(base), (x) => pct(x, 1), 'lower'],
    ['Walkers', t.walkers, b.walkers, (x) => fmt(x), 'higher'],
    ['Walk share', t.walkers / t.enroll, b.walkers / b.enroll, (x) => pct(x, 1), 'higher'],
    ['Bus riders', t.riders, b.riders, (x) => fmt(x), 'lower'],
    ['Riders cut off by barriers', t.hazard, b.hazard, (x) => fmt(x), 'lower', 'Live within walk distance but the walk would cross a barrier road'],
    ['Bus routes', bl.routes, bbl.routes, (x) => fmt(x), 'lower'],
    ['Avg ride (min)', bl.avgRide, bbl.avgRide, (x) => fmt(x, 1), 'lower'],
    ['Longest ride (min)', bl.maxRide, bbl.maxRide, (x) => fmt(x), 'lower'],
    ['Students reassigned', t.moved, 0, (x) => fmt(x), 'lower', `vs. ${baseKey === '2026' ? 'adopted 2026-27' : '2025-26'} boundaries`],
    ['Attendance islands', t.islands, b.islands, (x) => fmt(x), 'lower', 'Extra detached pieces of attendance areas'],
    ['Schools outside own boundary', t.outside, b.outside, (x) => fmt(x), 'lower'],
    ['FRL% spread across schools', frl(result), frl(base), (x) => pct(x, 1), 'none', 'Std. dev. of estimated free/reduced-price meal share'],
  ]
  if (level !== 'HS') rows.push([level === 'ES' ? 'Split feeders (ES → MS)' : 'Split feeders (MS → HS)', level === 'ES' ? result.feeder.esSplit : result.feeder.msSplit, level === 'ES' ? base.feeder.esSplit : base.feeder.msSplit, (x) => fmt(x), 'lower', 'Schools sending >5% of their students to a second next-level school'])
  else rows.push(['Split feeders (MS → HS)', result.feeder.msSplit, base.feeder.msSplit, (x) => fmt(x), 'lower'])

  return (
    <div className="scorecard">
      <div className="kpis">
        <Kpi label="Est. bus fleet (all levels)" v={buses.fleet} b={baseBuses.fleet} good="lower" note={`${fmt(buses.routes.length)} routes, peak overlap across bell times + ${pct(params.spareRatio)} spares`} />
        <Kpi label={`${level} over target`} v={t.over} b={b.over} good="lower" />
        <Kpi label={`${level} walk share`} v={t.walkers / t.enroll} b={b.walkers / b.enroll} good="higher" f={(x) => pct(x, 0)} />
        <Kpi label={`${level} reassigned`} v={t.moved} b={0} good="lower" />
      </div>
      <table className="cmp">
        <thead><tr><th>{level} · {YEAR_LABELS[params.year]}</th><th>Scenario</th><th>Baseline</th><th>Δ</th></tr></thead>
        <tbody>
          {rows.map(([label, v, bv, f, good, help]) => {
            const d = v - bv
            const cls = good === 'none' || Math.abs(d) < 1e-6 ? '' : (good === 'lower' ? d < 0 : d > 0) ? 'good' : 'bad'
            return (
              <tr key={label} title={help}>
                <td>{label}</td>
                <td>{f(v)}</td>
                <td className="muted">{f(bv)}</td>
                <td className={cls}>{Math.abs(d) < 1e-6 ? '' : label.startsWith('Schools in target') ? signed(d) : (d > 0 ? '+' : '') + f(d)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {result.gradeGaps > 1 && <p className="warn">⚠ {fmt(result.gradeGaps)} students are in grades no assigned school serves (e.g. an SPA sent to a K-5 ES and a 7-8 MS leaves 6th grade unserved).</p>}
      <p className="hint">Baseline = {baseKey === '2026' ? 'adopted 2026-27' : '2025-26'} boundaries under the same assumptions. Fleet counts general-education routes only; FCPS runs about 1,625 buses including special-education and program routes.</p>
    </div>
  )
}

function Kpi({ label, v, b, good, f = (x: number) => fmt(x), note }: { label: string; v: number; b: number; good: 'lower' | 'higher'; f?: (x: number) => string; note?: string }) {
  const d = v - b
  const cls = Math.abs(d) < 1e-9 ? '' : (good === 'lower' ? d < 0 : d > 0) ? 'good' : 'bad'
  return (
    <div className="kpi" title={note}>
      <div className="kl">{label}</div>
      <div className="kv">{f(v)}</div>
      <div className={`kd ${cls}`}>{Math.abs(d) < 1e-9 ? 'no change' : `${d > 0 ? '+' : ''}${f(d)} vs baseline`}</div>
    </div>
  )
}
