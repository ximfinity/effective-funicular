import { pairKey } from './load'
import type { Assignment, Level, Model, Params } from './types'
import { LEVELS, NG, variantName } from './types'

export const BAND: Record<Level, number> = { ES: 0, MS: 1, HS: 2 }

export interface SchoolStats {
  enroll: number // projected/estimated membership (general + AAP center inflow)
  general: number // general-education residents attending
  aapIn: number
  capacity: number // effective capacity (program capacity [+ trailers])
  util: number // enroll / capacity
  walkers: number
  riders: number
  hazard: number // riders who live within walk distance but are cut off by barriers
  frl: number // estimated count
  race: number[] // estimated counts by race key
  movedIn: number
  movedOut: number
  components: number // contiguous pieces of the attendance area
  siteOutside: boolean // school building lies outside its own attendance area
  riderSpas: Map<number, number> // spa -> riders (incl. AAP riders for centers)
  spas: number[]
}

export interface Result {
  school: SchoolStats[]
  /** per level: per SPA students at that level's general school */
  spaStudents: Record<Level, Float64Array>
  spaWalkShare: Record<Level, Float64Array>
  gradeGaps: number // students whose grade is not served by any assigned school
  feeder: { esSplit: number; msSplit: number; esSplitStudents: number; msSplitStudents: number; flowsEM: Map<number, Map<number, number>>; flowsMH: Map<number, Map<number, number>> }
  totals: Record<Level, { enroll: number; walkers: number; riders: number; hazard: number; moved: number; over: number; under: number; inBand: number; seatsShort: number; seatsEmpty: number; islands: number; outside: number }>
}

export function studentsFor(m: Model, year: number): number[][] {
  return year === 0 ? m.raw.spa.n : m.raw.spa.proj[year - 1]
}

export function serves(m: Model, k: number, g: number) {
  if (k < 0) return false
  const s = m.schools[k]
  return s.gmin !== null && s.gmax !== null && s.gmin <= g && g <= s.gmax
}

/** General-education school for grade g of SPA i (or -1 when no assigned school serves it). */
export function generalSchool(m: Model, a: Assignment, i: number, g: number): number {
  const es = a.ES[i]
  if (serves(m, es, g)) return es
  const up = es >= 0 ? m.upperOf[es] : -1
  if (up >= 0 && serves(m, up, g)) return up
  if (serves(m, a.MS[i], g)) return a.MS[i]
  if (serves(m, a.HS[i], g)) return a.HS[i]
  return -1
}

export function walkShare(m: Model, p: Params, spa: number, school: number, variant?: string): number {
  const j = m.walk.pairIndex.get(pairKey(spa, school))
  if (j === undefined) return 0
  const v = m.walk.variants.indexOf(variant ?? variantName(p))
  const lvl = m.schools[school].level
  const miles = p.walkMiles[lvl]
  const b = Math.max(0, Math.min(m.walk.nbins - 1, Math.round(miles * 10) - 1))
  return m.walk.data[(v * m.walk.npairs + j) * m.walk.nbins + b] / m.walk.scale
}

export function effectiveCapacity(m: Model, p: Params, k: number) {
  const s = m.schools[k]
  if (s.capacity == null) return NaN
  return s.capacity + (p.countTemp ? s.temp * p.seatsPerTemp : 0)
}

export function compute(m: Model, a: Assignment, p: Params, base?: Assignment): Result {
  const K = m.schools.length
  const n = studentsFor(m, p.year)
  const spa = m.raw.spa
  const variant = variantName(p)
  const school: SchoolStats[] = m.schools.map(() => ({
    enroll: 0, general: 0, aapIn: 0, capacity: 0, util: 0, walkers: 0, riders: 0, hazard: 0, frl: 0,
    race: new Array(spa.raceKeys.length).fill(0), movedIn: 0, movedOut: 0, components: 0, siteOutside: false,
    riderSpas: new Map(), spas: [],
  }))
  const spaStudents = { ES: new Float64Array(m.S), MS: new Float64Array(m.S), HS: new Float64Array(m.S) }
  const spaWalkShare = { ES: new Float64Array(m.S), MS: new Float64Array(m.S), HS: new Float64Array(m.S) }
  let gradeGaps = 0
  const tj = m.raw.tj
  const add = (k: number, i: number, x: number, band: number, center = false) => {
    if (k < 0 || x <= 0) return
    const s = school[k]
    s.enroll += x
    if (center) s.aapIn += x
    else s.general += x
    s.frl += x * spa.frl[i][band]
    const r = spa.race[i][band]
    for (let q = 0; q < r.length; q++) s.race[q] += x * r[q]
    if (k === tj) return
    const w = walkShare(m, p, i, k, variant)
    const w0 = p.straightLine ? w : walkShare(m, p, i, k, 'T0')
    s.walkers += x * w
    const riders = x * (1 - w) * p.ridership
    s.riders += riders
    s.hazard += x * Math.max(0, w0 - w)
    if (riders > 0) s.riderSpas.set(i, (s.riderSpas.get(i) ?? 0) + riders)
  }
  for (let i = 0; i < m.S; i++) {
    const row = n[i]
    for (let g = 0; g < NG; g++) {
      const x = row[g]
      if (x <= 0) continue
      const k = generalSchool(m, a, i, g)
      if (k < 0) {
        gradeGaps += x
        continue
      }
      const lvl = m.schools[k].level
      const band = BAND[lvl]
      spaStudents[lvl][i] += x
      let gen = x
      if (lvl === 'ES' && g >= 3 && g <= 6 && spa.a26.ESAAP[i] >= 0) {
        const c = x * p.aapEs
        gen -= c
        add(spa.a26.ESAAP[i], i, c, band, true)
      } else if (lvl === 'MS' && g >= 7 && g <= 8 && spa.a26.MSAAP[i] >= 0) {
        const c = x * p.aapMs
        gen -= c
        add(spa.a26.MSAAP[i], i, c, band, true)
      } else if (g >= 9 && tj >= 0) {
        const c = x * p.tjShare
        gen -= c
        add(tj, i, c, band, true)
      }
      add(k, i, gen, band)
    }
  }
  for (const L of LEVELS) {
    const A = a[L]
    for (let i = 0; i < m.S; i++) if (A[i] >= 0) {
      school[A[i]].spas.push(i)
      spaWalkShare[L][i] = walkShare(m, p, i, A[i], variant)
    }
  }
  // capacity + utilization
  for (let k = 0; k < K; k++) {
    const s = school[k]
    s.capacity = effectiveCapacity(m, p, k)
    s.util = s.enroll / s.capacity
  }
  // contiguity / site checks per level
  for (const L of LEVELS) {
    const A = a[L]
    const seen = new Uint8Array(m.S)
    for (let i = 0; i < m.S; i++) {
      if (seen[i] || A[i] < 0) continue
      school[A[i]].components++
      const stack = [i]
      seen[i] = 1
      while (stack.length) {
        const x = stack.pop()!
        for (const [y] of spa.adj[x]) if (!seen[y] && A[y] === A[x]) { seen[y] = 1; stack.push(y) }
      }
    }
    for (let k = 0; k < K; k++) {
      const s = m.schools[k]
      if (s.level === L && !s.upper && !s.magnet && s.site >= 0 && school[k].spas.length) school[k].siteOutside = A[s.site] !== k
    }
  }
  // moved vs baseline
  if (base) {
    for (const L of LEVELS) {
      for (let i = 0; i < m.S; i++) {
        if (a[L][i] !== base[L][i]) {
          const x = spaStudents[L][i]
          if (a[L][i] >= 0) school[a[L][i]].movedIn += x
          if (base[L][i] >= 0) school[base[L][i]].movedOut += x
        }
      }
    }
  }
  // feeders (ES -> MS by middle-school cohort, MS -> HS by high-school cohort)
  const flowsEM = new Map<number, Map<number, number>>()
  const flowsMH = new Map<number, Map<number, number>>()
  for (let i = 0; i < m.S; i++) {
    const ms7 = n[i][7] + n[i][8]
    const hs = n[i][9] + n[i][10] + n[i][11] + n[i][12]
    const e = a.ES[i], mm = a.MS[i], h = a.HS[i]
    if (e >= 0 && mm >= 0) bump(flowsEM, e, mm, ms7)
    if (mm >= 0 && h >= 0) bump(flowsMH, mm, h, hs)
  }
  const split = (f: Map<number, Map<number, number>>) => {
    let cnt = 0, stud = 0
    for (const row of f.values()) {
      let tot = 0, mx = 0
      for (const v of row.values()) { tot += v; mx = Math.max(mx, v) }
      const minority = tot - mx
      if (minority > Math.max(5, 0.05 * tot)) { cnt++; stud += minority }
    }
    return [cnt, stud]
  }
  const [esSplit, esSplitStudents] = split(flowsEM)
  const [msSplit, msSplitStudents] = split(flowsMH)
  // totals
  const totals = {} as Result['totals']
  for (const L of LEVELS) {
    const t = { enroll: 0, walkers: 0, riders: 0, hazard: 0, moved: 0, over: 0, under: 0, inBand: 0, seatsShort: 0, seatsEmpty: 0, islands: 0, outside: 0 }
    for (let k = 0; k < K; k++) {
      const s = m.schools[k], st = school[k]
      if (s.level !== L || s.magnet) continue
      t.enroll += st.enroll
      t.walkers += st.walkers
      t.riders += st.riders
      t.hazard += st.hazard
      t.moved += st.movedIn
      if (Number.isFinite(st.util)) {
        if (st.util > p.utilHigh) t.over++
        else if (st.util < p.utilLow) t.under++
        else t.inBand++
        t.seatsShort += Math.max(0, st.enroll - st.capacity)
        t.seatsEmpty += Math.max(0, st.capacity - st.enroll)
      }
      if (!s.upper) t.islands += Math.max(0, st.components - 1)
      if (st.siteOutside) t.outside++
    }
    totals[L] = t
  }
  return {
    school, spaStudents, spaWalkShare, gradeGaps,
    feeder: { esSplit, msSplit, esSplitStudents, msSplitStudents, flowsEM, flowsMH },
    totals,
  }
}

function bump(f: Map<number, Map<number, number>>, a: number, b: number, x: number) {
  let row = f.get(a)
  if (!row) f.set(a, (row = new Map()))
  row.set(b, (row.get(b) ?? 0) + x)
}

export function cloneAssignment(a: Assignment): Assignment {
  return { ES: a.ES.slice(), MS: a.MS.slice(), HS: a.HS.slice() }
}

export function baselineAssignment(m: Model, which: '2025' | '2026'): Assignment {
  const src = which === '2025' ? m.raw.spa.a25 : m.raw.spa.a26
  return { ES: Int32Array.from(src.ES), MS: Int32Array.from(src.MS), HS: Int32Array.from(src.HS) }
}
