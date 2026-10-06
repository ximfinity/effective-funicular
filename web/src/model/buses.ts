/**
 * Bus estimator.
 *
 * For each school: riders per SPA (from the engine) are grouped into routes with the Clarke-Wright savings
 * heuristic on SPA-to-SPA and SPA-to-school drive times, subject to bus capacity and a maximum ride time.
 * SPAs with more riders than a bus holds get dedicated full buses first.
 *
 * Fleet size: every route occupies a bus from its first pickup until it has unloaded and repositioned.
 * Schools start at different bell times, so one bus can run several routes each morning; the fleet needed
 * is the peak number of routes running at the same time (an interval-overlap sweep), plus spares.
 */
import type { Result } from './engine'
import type { Level, Model, Params } from './types'

export interface Route {
  school: number
  spas: number[] // pickup order, last one closest to school
  load: number
  minutes: number
  start: number // minutes after midnight
  end: number
}

export interface BusResult {
  routes: Route[]
  bySchool: Map<number, Route[]>
  fleet: number
  fleetNoTiers: number
  byLevel: Record<Level, { routes: number; riders: number; avgRide: number; maxRide: number }>
}

const DEFAULT_BELL: Record<Level, number> = { ES: 9 * 60, MS: 7 * 60 + 30, HS: 8 * 60 + 10 }
const UNLOAD_AND_REPOSITION = 20 // minutes between finishing one route and starting the next

function crowSec(a: [number, number], b: [number, number]) {
  const kx = 111320 * Math.cos((38.85 * Math.PI) / 180)
  const dx = (a[0] - b[0]) * kx, dy = (a[1] - b[1]) * 110540
  return (Math.hypot(dx, dy) * 1.4) / 8.5
}

export function estimateBuses(m: Model, res: Result, p: Params): BusResult {
  const routes: Route[] = []
  const bySchool = new Map<number, Route[]>()
  const cent = m.raw.spa.centroid
  const area = m.raw.spa.area
  const byLevel = {} as BusResult['byLevel']
  for (const L of ['ES', 'MS', 'HS'] as Level[]) byLevel[L] = { routes: 0, riders: 0, avgRide: 0, maxRide: 0 }

  for (let k = 0; k < m.schools.length; k++) {
    const sch = m.schools[k]
    if (sch.magnet) continue
    const st = res.school[k]
    if (st.riders < 1) continue
    const L = sch.level
    const C = p.busCapacity[L]
    const Tmax = p.maxRideMin[L] * 60
    const sxy: [number, number] = [sch.lon, sch.lat]
    const toSchool = (i: number) => m.drive.spaSchool[i].get(k) ?? crowSec(cent[i], sxy)
    const between = (i: number, j: number) => m.drive.spaSpa[i].get(j) ?? crowSec(cent[i], cent[j])
    const dwell = (i: number, q: number) => {
      const stops = Math.max(1, Math.min(Math.ceil(q / 12), Math.ceil(area[i] / 0.6) + 1))
      return stops * p.stopDwellSec + q * 4 + (stops - 1) * 45
    }
    const bell = sch.bell ?? DEFAULT_BELL[L]
    const mk = (spas: number[], load: number, sec: number): Route => {
      const minutes = sec / 60
      const arrive = bell - 10
      return { school: k, spas, load, minutes, start: arrive - minutes, end: bell + UNLOAD_AND_REPOSITION - 10 }
    }
    const list: Route[] = []
    // demand per SPA; dedicated buses for very large SPAs
    const nodes: { i: number; q: number }[] = []
    for (const [i, r] of st.riderSpas) {
      let q = r
      while (q > C * 0.95) {
        list.push(mk([i], C, dwell(i, C) + toSchool(i)))
        q -= C
      }
      if (q >= 0.5) nodes.push({ i, q })
    }
    // Clarke-Wright savings
    type R = { seq: number[]; load: number }
    const rs: R[] = nodes.map((n) => ({ seq: [n.i], load: n.q }))
    const q = new Map(nodes.map((n) => [n.i, n.q]))
    const routeOf = new Map<number, R>()
    rs.forEach((r) => routeOf.set(r.seq[0], r))
    const duration = (seq: number[]) => {
      // pickups in order, then school; choose better orientation
      const f = (s: number[]) => {
        let t = 0
        for (let x = 0; x < s.length; x++) {
          t += dwell(s[x], q.get(s[x])!)
          t += x + 1 < s.length ? between(s[x], s[x + 1]) : toSchool(s[x])
        }
        return t
      }
      const a = f(seq), b = f([...seq].reverse())
      return a <= b ? { t: a, seq } : { t: b, seq: [...seq].reverse() }
    }
    const savings: [number, number, number][] = []
    for (let x = 0; x < nodes.length; x++) {
      for (let y = x + 1; y < nodes.length; y++) {
        const i = nodes[x].i, j = nodes[y].i
        const d = m.drive.spaSpa[i].get(j)
        if (d === undefined) continue
        const s = toSchool(i) + toSchool(j) - d
        if (s > 0) savings.push([s, i, j])
      }
    }
    savings.sort((u, v) => v[0] - u[0])
    for (const [, i, j] of savings) {
      const ri = routeOf.get(i)!, rj = routeOf.get(j)!
      if (ri === rj) continue
      if (ri.load + rj.load > C) continue
      const iEnd = ri.seq[0] === i || ri.seq[ri.seq.length - 1] === i
      const jEnd = rj.seq[0] === j || rj.seq[rj.seq.length - 1] === j
      if (!iEnd || !jEnd) continue
      const a = ri.seq[ri.seq.length - 1] === i ? ri.seq : [...ri.seq].reverse()
      const b = rj.seq[0] === j ? rj.seq : [...rj.seq].reverse()
      const merged = [...a, ...b]
      const d = duration(merged)
      if (d.t > Tmax) continue
      const nr: R = { seq: d.seq, load: ri.load + rj.load }
      for (const s of nr.seq) routeOf.set(s, nr)
    }
    const uniq = new Set(routeOf.values())
    for (const r of uniq) {
      const d = duration(r.seq)
      list.push(mk(d.seq, r.load, d.t))
    }
    bySchool.set(k, list)
    routes.push(...list)
    const bl = byLevel[L]
    bl.routes += list.length
    bl.riders += st.riders
    for (const r of list) {
      bl.avgRide += r.minutes * r.load
      bl.maxRide = Math.max(bl.maxRide, r.minutes)
    }
  }
  for (const L of ['ES', 'MS', 'HS'] as Level[]) byLevel[L].avgRide /= Math.max(1, byLevel[L].riders)
  // fleet: peak overlap of route intervals
  const ev: [number, number][] = []
  for (const r of routes) {
    ev.push([r.start, 1], [r.end, -1])
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cur = 0, peak = 0
  for (const [, d] of ev) { cur += d; peak = Math.max(peak, cur) }
  return {
    routes, bySchool,
    fleet: Math.ceil(peak * (1 + p.spareRatio)),
    fleetNoTiers: Math.ceil(routes.length * (1 + p.spareRatio)),
    byLevel,
  }
}
