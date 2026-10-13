// Exhaustive search over boundary moves among the Study 5 schools: which combination gives the most long-term
// benefit with the fewest students negatively affected?   npx tsx scripts/study5-search.ts
//
// Students "negatively affected" = elementary students reassigned + middle/high students whose secondary school
// changes. Students who also lose a walkable route are reported separately (and used as a tie-breaker).
import { writeFileSync } from 'node:fs'
import { baselineAssignment, compute, walkShare } from '../src/model/engine'
import { DEFAULT_PARAMS, type Assignment, type Level, type Model } from '../src/model/types'
import { buildModel, fcpsScale, sid } from './study5'

const ES = ['Cardinal Forest', 'Keene Mill', 'White Oaks', 'Rolling Valley', 'Saratoga']
const YEARS = [1, 2, 3, 4, 5] // SY26-27 .. SY30-31
const P = DEFAULT_PARAMS

const { m } = buildModel({}, fcpsScale())
const base = baselineAssignment(m, '2026')
const esIdx = ES.map((n) => sid(m, n))
const inSet = new Set(esIdx)
const spaIds = m.raw.spa.id
const results = YEARS.map((y) => compute(m, base, { ...P, year: y }, base))
const yearOf = (y: number) => YEARS.indexOf(y)

// majority MS / HS of each ES school (its "own" feeder pyramid)
function majority(level: Level, school: number) {
  const c = new Map<number, number>()
  for (let i = 0; i < m.S; i++) if (base.ES[i] === school) c.set(base[level][i], (c.get(base[level][i]) ?? 0) + m.raw.spa.n[i].reduce((a, b) => a + b, 0))
  return [...c].sort((a, b) => b[1] - a[1])[0][0]
}
const feedMS = new Map(esIdx.map((k) => [k, majority('MS', k)]))
const feedHS = new Map(esIdx.map((k) => [k, majority('HS', k)]))

// ---------- candidate options: move SPA i (in a set school) to an adjacent set school; optionally realign MS/HS
type Opt = { key: string; i: number; to: number; realign: boolean; delta: Map<number, number>[]; esMoved: number; secMoved: number; walkLost: number; driveUp: number; label: string }
const opts: Opt[] = []
const n1 = results[0]
for (let i = 0; i < m.S; i++) {
  const a = base.ES[i]
  if (!inSet.has(a)) continue
  const targets = new Set(m.raw.spa.adj[i].map(([j]) => base.ES[j]).filter((b) => inSet.has(b) && b !== a))
  // also allow fixing a split feeder in place (realign MS/HS to the ES school's pyramid without changing ES)
  const inPlace = base.MS[i] !== feedMS.get(a)
  for (const to of [...targets, ...(inPlace ? [a] : [])]) {
    for (const realign of to === a ? [true] : [false, true]) {
      const A: Assignment = { ES: base.ES.slice(), MS: base.MS.slice(), HS: base.HS.slice() }
      A.ES[i] = to
      if (realign) { A.MS[i] = feedMS.get(to)!; A.HS[i] = feedHS.get(to)! }
      if (realign && A.MS[i] === base.MS[i] && A.HS[i] === base.HS[i] && to !== a) continue // realign is a no-op
      const delta = YEARS.map((y, t) => {
        const r = compute(m, A, { ...P, year: y })
        const d = new Map<number, number>()
        r.school.forEach((s, k) => { const x = s.enroll - results[t].school[k].enroll; if (Math.abs(x) > 1e-6) d.set(k, x) })
        return d
      })
      const esN = n1.spaStudents.ES[i]
      const msN = n1.spaStudents.MS[i], hsN = n1.spaStudents.HS[i]
      const secMoved = (A.MS[i] !== base.MS[i] ? msN : 0) + (A.HS[i] !== base.HS[i] ? hsN : 0)
      const wOld = walkShare(m, P, i, a), wNew = walkShare(m, P, i, to)
      const dOld = m.drive.spaSchool[i].get(a) ?? NaN, dNew = m.drive.spaSchool[i].get(to) ?? NaN
      opts.push({
        key: `${spaIds[i]}->${m.schools[to].name}${realign ? '+sec' : ''}`, i, to, realign, delta,
        esMoved: to === a ? 0 : esN, secMoved, walkLost: to === a ? 0 : esN * Math.max(0, wOld - wNew),
        driveUp: (dNew - dOld) / 60,
        label: to === a
          ? `SPA ${spaIds[i]}: keep ${m.schools[a].name}, move MS/HS to ${m.schools[A.MS[i]].name}/${m.schools[A.HS[i]].name}`
          : `SPA ${spaIds[i]}: ${m.schools[a].name} → ${m.schools[to].name}${realign ? ` (MS/HS → ${m.schools[A.MS[i]].name}/${m.schools[A.HS[i]].name})` : ''}`,
      })
    }
  }
}
console.log(`candidate options: ${opts.length} (from ${new Set(opts.map((o) => o.i)).size} planning areas)`)

// ---------- evaluation of a combination
const cap = new Map(esIdx.map((k) => [k, m.schools[k].capacity!]))
function evaluate(combo: Opt[]) {
  const util = YEARS.map((_, t) => {
    const u = new Map<number, number>()
    for (const k of esIdx) {
      let e = results[t].school[k].enroll
      for (const o of combo) e += o.delta[t].get(k) ?? 0
      u.set(k, e / cap.get(k)!)
    }
    return u
  })
  const A = { ES: base.ES.slice(), MS: base.MS.slice() }
  for (const o of combo) { A.ES[o.i] = o.to; if (o.realign) A.MS[o.i] = feedMS.get(o.to)! }
  // islands among set schools
  let islands = 0
  for (const k of esIdx) {
    const nodes = [...Array(m.S).keys()].filter((i) => A.ES[i] === k)
    const seen = new Set<number>(); let comps = 0
    for (const s of nodes) {
      if (seen.has(s)) continue
      comps++; const st = [s]; seen.add(s)
      while (st.length) { const x = st.pop()!; for (const [y] of m.raw.spa.adj[x]) if (!seen.has(y) && A.ES[y] === k) { seen.add(y); st.push(y) } }
    }
    islands += Math.max(0, comps - 1)
  }
  // split feeders (ES -> MS minority share > 5%) among set schools, by middle-school cohort
  let splits = 0
  const splitList: string[] = []
  for (const k of esIdx) {
    const c = new Map<number, number>()
    for (let i = 0; i < m.S; i++) if (A.ES[i] === k) c.set(A.MS[i], (c.get(A.MS[i]) ?? 0) + n1.spaStudents.MS[i] + m.raw.spa.n[i].slice(0, 7).reduce((a, b) => a + b, 0) / 3.5)
    const tot = [...c.values()].reduce((a, b) => a + b, 0), mx = Math.max(...c.values())
    if (tot - mx > 0.05 * tot) { splits++; splitList.push(m.schools[k].name) }
  }
  const harmed = combo.reduce((a, o) => a + o.esMoved + o.secMoved, 0)
  const walkLost = combo.reduce((a, o) => a + o.walkLost, 0)
  const maxNow = Math.max(...util[0].values()), maxLong = Math.max(...util[4].values())
  const minLong = Math.min(...util[4].values())
  return { util, islands, splits, splitList, harmed, walkLost, maxNow, maxLong, minLong }
}

// ---------- exhaustive search up to K options (one option per SPA)
const K = Number(process.env.K ?? 5)
type Sol = ReturnType<typeof evaluate> & { combo: Opt[] }
const goals = {
  capacity: (e: ReturnType<typeof evaluate>, hi: number) => e.maxNow <= hi && e.maxLong <= hi && e.minLong >= 0.70,
}
const best: Record<string, Sol | null> = {}
const tiers: { key: string; hi: number; islands: boolean; feeders: boolean }[] = [
  { key: 'A: ≤100% thru SY30-31, no islands, no split feeders', hi: 1.0, islands: true, feeders: true },
  { key: 'B: ≤100% thru SY30-31, no islands', hi: 1.0, islands: true, feeders: false },
  { key: 'C: ≤100% thru SY30-31 only', hi: 1.0, islands: false, feeders: false },
  { key: 'D: ≤105% thru SY30-31, no islands, no split feeders', hi: 1.05, islands: true, feeders: true },
  { key: 'E: ≤100% thru SY30-31, no split feeders (island may remain)', hi: 1.0, islands: false, feeders: true },
]
for (const t of tiers) best[t.key] = null
let evaluated = 0
const score = (s: { harmed: number; walkLost: number; maxLong: number }) => s.harmed + 0.5 * s.walkLost + 10 * s.maxLong
function rec(start: number, combo: Opt[], used: Set<number>) {
  if (combo.length) {
    const e = evaluate(combo); evaluated++
    for (const t of tiers) {
      if (!goals.capacity(e, t.hi)) continue
      if (t.islands && e.islands > 0) continue
      if (t.feeders && e.splits > 0) continue
      const cur = best[t.key]
      if (!cur || score(e) < score(cur)) best[t.key] = { ...e, combo: [...combo] }
    }
  }
  if (combo.length >= K) return
  for (let x = start; x < opts.length; x++) {
    if (used.has(opts[x].i)) continue
    used.add(opts[x].i); combo.push(opts[x])
    rec(x + 1, combo, used)
    combo.pop(); used.delete(opts[x].i)
  }
}
// baseline reference
const b0 = evaluate([])
console.log(`baseline: max util SY26-27 ${(100 * b0.maxNow).toFixed(0)}%, SY30-31 ${(100 * b0.maxLong).toFixed(0)}%, islands ${b0.islands}, split feeders ${b0.splits} (${b0.splitList.join(', ')})`)
const t0 = Date.now()
if (process.env.COMBOS) {
  // evaluate named combinations instead of searching: COMBOS="8816->White Oaks,7919->Keene Mill|..."
  for (const c of process.env.COMBOS.split('|')) {
    const combo = c.split(',').map((k) => opts.find((o) => o.key === k.trim())!)
    const e = evaluate(combo)
    console.log(`\n## ${c}\n  reassigned ES ${Math.round(combo.reduce((a, o) => a + o.esMoved, 0))}, secondary ${Math.round(combo.reduce((a, o) => a + o.secMoved, 0))}, lose walk ${Math.round(e.walkLost)}, islands ${e.islands}, splits [${e.splitList}]`)
    console.log('  ' + esIdx.map((k) => `${m.schools[k].name} ${Math.round(100 * e.util[0].get(k)!)}%→${Math.round(100 * e.util[4].get(k)!)}%`).join(' | '))
  }
  process.exit(0)
}
rec(0, [], new Set())
console.log(`evaluated ${evaluated.toLocaleString()} combinations in ${((Date.now() - t0) / 1000).toFixed(0)}s`)

const fmt = (s: Sol) => ({
  moves: s.combo.map((o) => ({ move: o.label, esStudents: Math.round(o.esMoved), secStudents: Math.round(o.secMoved), loseWalk: Math.round(o.walkLost), driveChangeMin: +o.driveUp.toFixed(1) })),
  harmed: Math.round(s.harmed), walkLost: Math.round(s.walkLost), islands: s.islands, splitFeeders: s.splitList,
  util: Object.fromEntries(esIdx.map((k) => [m.schools[k].name, [0, 4].map((t) => Math.round(100 * s.util[t].get(k)!) + '%').join(' → ')])),
})
const out: Record<string, unknown> = { baseline: { util: Object.fromEntries(esIdx.map((k) => [m.schools[k].name, [0, 4].map((t) => Math.round(100 * b0.util[t].get(k)!) + '%').join(' → ')])), splitFeeders: b0.splitList, islands: b0.islands } }
for (const t of tiers) {
  const s = best[t.key]
  out[t.key] = s ? fmt(s) : 'no combination of ≤5 whole-SPA moves meets this'
  console.log(`\n== ${t.key}`)
  console.log(JSON.stringify(out[t.key], null, 1))
}
writeFileSync(new URL('../../docs/study5-search.json', import.meta.url), JSON.stringify(out, null, 1))
void yearOf
