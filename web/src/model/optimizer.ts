/**
 * Boundary optimizer: simulated annealing over single-SPA reassignments to an adjacent school.
 *
 * Cost (in "student-equivalents", lower is better):
 *   capacity   w.cap   * (students above the target band + 2 x students above 115%)
 *              w.under * (empty seats below the target band)
 *   transport  w.bus   * rider-minutes / 30
 *   stability  w.move  * students reassigned vs. the baseline (+2 per reassigned area)
 *   feeders    w.feeder* students in minority feeder flows (ES->MS, MS->HS)
 *   compactness w.compact * students x straight-line km to school / 5
 *   equity     w.equity * 10 * sum_s E_s (FRL%_s - county FRL% at that level)^2
 * Hard constraints: same level, never assign to upper-ES or magnet schools, locked SPAs stay put, a school
 * keeps the SPA its building sits in, and a move may not split the losing school's area into more pieces.
 */
import { BAND, generalSchool, walkShare } from './engine'
import type { Assignment, Level, Model, Params } from './types'
import { NG } from './types'

export interface Weights {
  cap: number
  under: number
  bus: number
  move: number
  feeder: number
  compact: number
  equity: number
}

export const PRESETS: Record<string, { label: string; w: Weights }> = {
  balanced: { label: 'Balanced', w: { cap: 1, under: 0.3, bus: 0.5, move: 0.3, feeder: 0.5, compact: 0.2, equity: 0 } },
  crowding: { label: 'Fix overcrowding', w: { cap: 2, under: 0.2, bus: 0.2, move: 0.15, feeder: 0.3, compact: 0.1, equity: 0 } },
  buses: { label: 'Minimize busing', w: { cap: 0.6, under: 0.1, bus: 2, move: 0.2, feeder: 0.3, compact: 0.5, equity: 0 } },
  stable: { label: 'Least disruption', w: { cap: 1, under: 0.2, bus: 0.3, move: 1.5, feeder: 0.5, compact: 0.1, equity: 0 } },
  equity: { label: 'Balance demographics', w: { cap: 1, under: 0.3, bus: 0.3, move: 0.3, feeder: 0.4, compact: 0.1, equity: 1.5 } },
}

export interface OptRequest {
  assignment: Assignment
  base: Assignment
  params: Params
  weights: Weights
  levels: Level[]
  locked: number[] // SPA indices that may not move
  iterations: number
  allowIslands: boolean
  seed: number
}

export interface OptProgress {
  iter: number
  cost: number
  best: number
  accepted: number
  assignment?: Assignment
  breakdown?: Record<string, number>
}

type Contrib = { k: number; x: number; riders: number; rmin: number; frl: number }[]

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

export class Optimizer {
  m: Model
  r: OptRequest
  A: Assignment
  E: Float64Array
  F: Float64Array
  cap: Float64Array
  mu: Record<Level, number>
  cache = new Map<number, Contrib>()
  em = new Map<number, Map<number, number>>()
  mh = new Map<number, Map<number, number>>()
  lockedSet: Set<number>
  siteLock: Map<number, number>[] = []
  cost = 0
  best = Infinity
  bestA: Assignment
  rand: () => number
  cand: Record<Level, number[]> = { ES: [], MS: [], HS: [] }
  n: number[][]
  km: (i: number, k: number) => number

  constructor(m: Model, r: OptRequest) {
    this.m = m
    this.r = r
    this.A = { ES: r.assignment.ES.slice(), MS: r.assignment.MS.slice(), HS: r.assignment.HS.slice() }
    this.bestA = { ES: this.A.ES.slice(), MS: this.A.MS.slice(), HS: this.A.HS.slice() }
    this.rand = rng(r.seed)
    const K = m.schools.length
    this.E = new Float64Array(K)
    this.F = new Float64Array(K)
    this.cap = new Float64Array(K)
    const p = r.params
    for (let k = 0; k < K; k++) {
      const s = m.schools[k]
      this.cap[k] = s.capacity == null || s.magnet ? NaN : s.capacity + (p.countTemp ? s.temp * p.seatsPerTemp : 0)
    }
    this.n = p.year === 0 ? m.raw.spa.n : m.raw.spa.proj[p.year - 1]
    this.lockedSet = new Set(r.locked)
    for (let k = 0; k < K; k++) {
      const s = m.schools[k]
      if (s.site >= 0 && !s.upper && !s.magnet) {
        this.siteLock[s.site] ??= new Map()
        this.siteLock[s.site].set(BAND[s.level], k)
      }
    }
    const kx = 111320 * Math.cos((38.85 * Math.PI) / 180)
    const c = m.raw.spa.centroid
    this.km = (i, k) => Math.hypot((c[i][0] - m.schools[k].lon) * kx, (c[i][1] - m.schools[k].lat) * 110540) / 1000
    // initial state
    for (let i = 0; i < m.S; i++) for (const e of this.contrib(i)) { this.E[e.k] += e.x; this.F[e.k] += e.frl }
    this.mu = { ES: 0, MS: 0, HS: 0 }
    for (const L of ['ES', 'MS', 'HS'] as Level[]) {
      let e = 0, f = 0
      for (let k = 0; k < K; k++) if (m.schools[k].level === L && !m.schools[k].magnet) { e += this.E[k]; f += this.F[k] }
      this.mu[L] = f / Math.max(1, e)
    }
    for (let i = 0; i < m.S; i++) this.addFlows(i, 1)
    this.cost = this.totalCost()
    this.best = this.cost
  }

  /** Per-school contributions of SPA i under the current assignment (all grades). */
  contrib(i: number): Contrib {
    const hit = this.cache.get(i)
    if (hit) return hit
    const { m } = this
    const p = this.r.params
    const out = new Map<number, { k: number; x: number; riders: number; rmin: number; frl: number }>()
    const spa = m.raw.spa
    const push = (k: number, x: number, band: number) => {
      if (k < 0 || x <= 0) return
      let e = out.get(k)
      if (!e) out.set(k, (e = { k, x: 0, riders: 0, rmin: 0, frl: 0 }))
      e.x += x
      e.frl += x * spa.frl[i][band]
      if (k === m.raw.tj) return
      const rid = x * (1 - walkShare(m, p, i, k)) * p.ridership
      e.riders += rid
      const sec = m.drive.spaSchool[i].get(k) ?? this.km(i, k) * 1000 * 1.4 / 8.5
      e.rmin += rid * sec / 60
    }
    for (let g = 0; g < NG; g++) {
      const x = this.n[i][g]
      if (x <= 0) continue
      const k = generalSchool(m, this.A, i, g)
      if (k < 0) continue
      const lvl = m.schools[k].level
      const band = BAND[lvl]
      let gen = x
      if (lvl === 'ES' && g >= 3 && g <= 6 && spa.a26.ESAAP[i] >= 0) { gen -= x * p.aapEs; push(spa.a26.ESAAP[i], x * p.aapEs, band) }
      else if (lvl === 'MS' && g >= 7 && spa.a26.MSAAP[i] >= 0) { gen -= x * p.aapMs; push(spa.a26.MSAAP[i], x * p.aapMs, band) }
      else if (g >= 9 && m.raw.tj >= 0) { gen -= x * p.tjShare; push(m.raw.tj, x * p.tjShare, band) }
      push(k, gen, band)
    }
    const arr = [...out.values()]
    this.cache.set(i, arr)
    return arr
  }

  cohort(i: number, which: 'ms' | 'hs') {
    const r = this.n[i]
    return which === 'ms' ? r[7] + r[8] : r[9] + r[10] + r[11] + r[12]
  }

  addFlows(i: number, sign: number) {
    const a = this.A
    if (a.ES[i] >= 0 && a.MS[i] >= 0) bump(this.em, a.ES[i], a.MS[i], sign * this.cohort(i, 'ms'))
    if (a.MS[i] >= 0 && a.HS[i] >= 0) bump(this.mh, a.MS[i], a.HS[i], sign * this.cohort(i, 'hs'))
  }

  schoolCost(k: number) {
    const C = this.cap[k]
    if (!Number.isFinite(C)) return 0
    const w = this.r.weights, p = this.r.params
    const E = this.E[k]
    const over = Math.max(0, E - p.utilHigh * C)
    const severe = Math.max(0, E - 1.15 * C)
    const under = Math.max(0, p.utilLow * C - E)
    let c = w.cap * (over + 2 * severe) + w.under * under
    if (w.equity > 0 && E > 0) {
      const d = this.F[k] / E - this.mu[this.m.schools[k].level]
      c += w.equity * 10 * E * d * d
    }
    return c
  }

  rowSplit(f: Map<number, Map<number, number>>, r: number) {
    const row = f.get(r)
    if (!row) return 0
    let t = 0, mx = 0
    for (const v of row.values()) { t += v; mx = Math.max(mx, v) }
    return t - mx
  }

  spaCost(i: number) {
    const w = this.r.weights
    let c = 0
    for (const e of this.contrib(i)) c += w.bus * e.rmin / 30
    for (const L of this.r.levels) {
      const k = this.A[L][i]
      if (k < 0) continue
      const st = this.levelStudents(i, L)
      // every reassigned area costs a little even when empty, so neutral moves (parks, industrial land) don't drift
      if (k !== this.r.base[L][i]) c += w.move * st + 2
      c += w.compact * st * this.km(i, k) / 5
    }
    return c
  }

  levelStudents(i: number, L: Level) {
    const r = this.n[i]
    let s = 0
    if (L === 'ES') for (let g = 0; g <= 6; g++) s += r[g]
    else if (L === 'MS') s = r[7] + r[8]
    else s = r[9] + r[10] + r[11] + r[12]
    return s
  }

  totalCost() {
    let c = 0
    for (let k = 0; k < this.m.schools.length; k++) c += this.schoolCost(k)
    for (let i = 0; i < this.m.S; i++) c += this.spaCost(i)
    for (const r of this.em.keys()) c += this.r.weights.feeder * this.rowSplit(this.em, r)
    for (const r of this.mh.keys()) c += this.r.weights.feeder * this.rowSplit(this.mh, r)
    return c
  }

  breakdown() {
    const p = this.r.params
    let over = 0, under = 0, rmin = 0, moved = 0, feeder = 0
    for (let k = 0; k < this.m.schools.length; k++) {
      const C = this.cap[k]
      if (!Number.isFinite(C)) continue
      over += Math.max(0, this.E[k] - p.utilHigh * C)
      under += Math.max(0, p.utilLow * C - this.E[k])
    }
    for (let i = 0; i < this.m.S; i++) {
      for (const e of this.contrib(i)) rmin += e.rmin
      for (const L of this.r.levels) if (this.A[L][i] !== this.r.base[L][i]) moved += this.levelStudents(i, L)
    }
    for (const r of this.em.keys()) feeder += this.rowSplit(this.em, r)
    for (const r of this.mh.keys()) feeder += this.rowSplit(this.mh, r)
    return { overBand: over, underBand: under, riderHours: rmin / 60, moved, feederMinority: feeder }
  }

  /** Can SPA i leave school a without splitting a's remaining area? */
  contiguousWithout(L: Level, i: number, a: number) {
    const adj = this.m.raw.spa.adj
    const A = this.A[L]
    const nbrs = adj[i].map(([j]) => j).filter((j) => A[j] === a)
    if (nbrs.length <= 1) return true
    const seen = new Set<number>([i, nbrs[0]])
    const stack = [nbrs[0]]
    let found = 1
    const need = new Set(nbrs)
    while (stack.length && found < nbrs.length) {
      const x = stack.pop()!
      for (const [y] of adj[x]) {
        if (seen.has(y) || A[y] !== a) continue
        seen.add(y)
        if (need.has(y)) found++
        stack.push(y)
      }
    }
    return found >= nbrs.length
  }

  /** Try one random move; returns true if accepted. */
  step(T: number) {
    const { m } = this
    const L = this.r.levels[Math.floor(this.rand() * this.r.levels.length)]
    const i = Math.floor(this.rand() * m.S)
    if (this.lockedSet.has(i)) return false
    const A = this.A[L]
    const a = A[i]
    if (a < 0) return false
    const site = this.siteLock[i]?.get(BAND[L])
    if (site !== undefined && site === a) return false
    const adj = m.raw.spa.adj[i]
    if (!adj.length) return false
    const j = adj[Math.floor(this.rand() * adj.length)][0]
    const b = A[j]
    if (b < 0 || b === a) return false
    const sb = m.schools[b]
    if (sb.upper || sb.magnet || sb.level !== L) return false
    if (!this.r.allowIslands && !this.contiguousWithout(L, i, a)) return false

    // delta
    const before = this.contrib(i)
    const spaBefore = this.spaCost(i)
    const touched = new Set<number>(before.map((e) => e.k))
    const emRows = new Set<number>(), mhRows = new Set<number>()
    const markRows = () => {
      if (this.A.ES[i] >= 0) emRows.add(this.A.ES[i])
      if (this.A.MS[i] >= 0) mhRows.add(this.A.MS[i])
    }
    markRows()
    A[i] = b
    this.cache.delete(i)
    const after = this.contrib(i)
    for (const e of after) touched.add(e.k)
    markRows()
    A[i] = a
    let old = 0
    for (const k of touched) old += this.schoolCost(k)
    for (const r of emRows) old += this.r.weights.feeder * this.rowSplit(this.em, r)
    for (const r of mhRows) old += this.r.weights.feeder * this.rowSplit(this.mh, r)
    // apply
    for (const e of before) { this.E[e.k] -= e.x; this.F[e.k] -= e.frl }
    this.addFlows(i, -1)
    A[i] = b
    for (const e of after) { this.E[e.k] += e.x; this.F[e.k] += e.frl }
    this.addFlows(i, 1)
    let nw = 0
    for (const k of touched) nw += this.schoolCost(k)
    for (const r of emRows) nw += this.r.weights.feeder * this.rowSplit(this.em, r)
    for (const r of mhRows) nw += this.r.weights.feeder * this.rowSplit(this.mh, r)
    const spaAfter = this.spaCost(i)
    const delta = nw - old + spaAfter - spaBefore
    if (delta <= 0 || this.rand() < Math.exp(-delta / T)) {
      this.cost += delta
      if (this.cost < this.best - 1e-9) {
        this.best = this.cost
        for (const LL of ['ES', 'MS', 'HS'] as Level[]) this.bestA[LL].set(this.A[LL])
      }
      return true
    }
    // revert
    for (const e of after) { this.E[e.k] -= e.x; this.F[e.k] -= e.frl }
    this.addFlows(i, -1)
    A[i] = a
    this.cache.set(i, before)
    for (const e of before) { this.E[e.k] += e.x; this.F[e.k] += e.frl }
    this.addFlows(i, 1)
    return false
  }
}

function bump(f: Map<number, Map<number, number>>, a: number, b: number, x: number) {
  let row = f.get(a)
  if (!row) f.set(a, (row = new Map()))
  const v = (row.get(b) ?? 0) + x
  if (Math.abs(v) < 1e-9) row.delete(b)
  else row.set(b, v)
}
