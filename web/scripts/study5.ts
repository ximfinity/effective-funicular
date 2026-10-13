// FCPS Phase 2 Study 5 (Keene Mill island / Cardinal Forest / White Oaks; Rolling Valley SPA 8922):
// run the draft scenarios from the Oct-14-2026 community meeting through the model.
//   npx tsx scripts/study5.ts            -> prints tables, writes ../docs/study5-results.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { baselineAssignment, compute, type Result } from '../src/model/engine'
import { estimateBuses } from '../src/model/buses'
import { Optimizer, PRESETS } from '../src/model/optimizer'
import { pairKey } from '../src/model/load'
import { DEFAULT_PARAMS, type Assignment, type Model, type Params, type RawModel } from '../src/model/types'

const D = new URL('../public/data/', import.meta.url)
const raw0 = JSON.parse(readFileSync(new URL('model.json', D), 'utf8')) as RawModel
const meta = JSON.parse(readFileSync(new URL('walk_meta.json', D), 'utf8'))
const buf = readFileSync(new URL('walk.bin', D))
const drive = JSON.parse(readFileSync(new URL('drive.json', D), 'utf8'))

/** Build a model where some SPAs are split into a moving part (fraction f) and a staying part. */
export function buildModel(splits: Record<number, number>, scale: Record<number, number> = {}): { m: Model; part: Map<number, number> } {
  const raw: RawModel = JSON.parse(JSON.stringify(raw0))
  const sp = raw.spa
  const pos = new Map(sp.id.map((id, i) => [id, i]))
  const pairIndex = new Map<number, number>()
  meta.pairs.forEach(([s, k]: [number, number], j: number) => pairIndex.set(pairKey(s, k), j))
  const spaSchool: Map<number, number>[] = drive.spa_school.map((l: [number, number][]) => new Map(l))
  const spaSpa: Map<number, number>[] = drive.spa_spa.map((l: [number, number][]) => new Map(l))
  // optional local recalibration: scale an SPA's K-6 students, and give the difference back to the other SPAs of
  // the same elementary school (pro rata) so the school still matches its actual membership
  const k6 = (row: number[]) => row.slice(0, 7).reduce((a, b) => a + b, 0)
  for (const tbl of [sp.n, ...sp.proj]) {
    const delta = new Map<number, number>()
    for (const [id, f] of Object.entries(scale)) {
      const i = pos.get(Number(id))!
      delta.set(sp.a26.ES[i], (delta.get(sp.a26.ES[i]) ?? 0) + k6(tbl[i]) * (1 - f))
      tbl[i] = tbl[i].map((x, g) => (g <= 6 ? x * f : x))
    }
    for (const [es, d] of delta) {
      const others = [...tbl.keys()].filter((i) => sp.a26.ES[i] === es && !(sp.id[i] in scale))
      const tot = others.reduce((a, i) => a + k6(tbl[i]), 0)
      for (const i of others) tbl[i] = tbl[i].map((x, g) => (g <= 6 ? x * (1 + d / tot) : x))
    }
  }
  const part = new Map<number, number>() // spa id -> index of its moving part
  for (const [id, f] of Object.entries(splits)) {
    const i = pos.get(Number(id))!
    const j = sp.id.length
    part.set(Number(id), j)
    const cp = <T>(arr: T[], a: T, b: T) => { arr[i] = a; arr.push(b) }
    cp(sp.n, sp.n[i].map((x) => x * (1 - f)), sp.n[i].map((x) => x * f))
    for (const y of sp.proj) cp(y, y[i].map((x) => x * (1 - f)), y[i].map((x) => x * f))
    sp.id.push(Number(id) * 10 + 9) // pseudo id
    sp.centroid.push(sp.centroid[i]); sp.area.push(sp.area[i] * f); sp.area[i] *= 1 - f
    sp.units.push(sp.units[i].map((x) => x * f)); sp.units[i] = sp.units[i].map((x) => x * (1 - f))
    sp.frl.push(sp.frl[i]); sp.race.push(sp.race[i]); sp.region.push(sp.region[i])
    for (const k of ['ES', 'MS', 'HS', 'ESAAP', 'MSAAP'] as const) sp.a26[k].push(sp.a26[k][i])
    for (const k of ['ES', 'MS', 'HS'] as const) sp.a25[k].push(sp.a25[k][i])
    sp.adj.push([...sp.adj[i], [i, 100]]); sp.adj[i].push([j, 100])
    for (const [nb] of sp.adj[i]) if (nb !== j) sp.adj[nb].push([j, 50])
    for (let k = 0; k < raw.schools.length; k++) {
      const pj = pairIndex.get(pairKey(i, k))
      if (pj !== undefined) pairIndex.set(pairKey(j, k), pj)
    }
    spaSchool.push(new Map(spaSchool[i]))
    const ss = new Map(spaSpa[i]); ss.set(i, 60); spaSpa.push(ss); spaSpa[i].set(j, 60)
    for (const [o, t] of spaSpa[i]) if (o !== j) spaSpa[o].set(j, t)
  }
  const upperOf = new Int32Array(raw.schools.length).fill(-1)
  for (const [k, v] of Object.entries(raw.upperOf)) upperOf[Number(k)] = v
  const m: Model = {
    raw, schools: raw.schools, S: sp.id.length,
    walk: { variants: meta.variants, nbins: meta.nbins, pairIndex, data: new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), npairs: meta.pairs.length, scale: meta.scale },
    drive: { spaSchool, spaSpa }, upperOf, bySchoolId: new Map(raw.schools.map((s, i) => [s.id, i])),
  }
  return { m, part }
}

export const sid = (m: Model, name: string, L = 'ES') => m.schools.findIndex((s) => s.name === name && s.level === L)
const SCHOOLS = ['Cardinal Forest', 'Keene Mill', 'White Oaks', 'Rolling Valley', 'Saratoga']

// 5-C detail is "part of 7904 and part of 7917, plus all of 7919". FCPS gives only the total (85 vs 115 in 5-B).
// Assumption: the 5-C parts are sized so the Cardinal Forest -> Keene Mill shift is 85/115 of 5-B's:
//   all of 7919, ~25% of 7917 (south-east of Carrleigh Pkwy & Forrester Blvd, measured from parcels) and a slice of 7904.
type Scn = { key: string; label: string; moves: [number, string, number][] } // [spa id, to school, fraction]
const SCENARIOS: Scn[] = [
  { key: '5A', label: '5-A: no change (adopted 2026-27)', moves: [] },
  { key: '5B', label: '5-B: 8816 → White Oaks; 7917 + 7919 → Keene Mill', moves: [[8816, 'White Oaks', 1], [7917, 'Keene Mill', 1], [7919, 'Keene Mill', 1]] },
  { key: '5C', label: '5-C (recommended): 8816 → White Oaks; 7919 + parts of 7917/7904 → Keene Mill', moves: [[8816, 'White Oaks', 1], [7919, 'Keene Mill', 1], [7917, 'Keene Mill', 0.25], [7904, 'Keene Mill', 0.08]] },
  { key: 'RV', label: 'Alt (not proposed): 5-C + SPA 8922 Rolling Valley → Saratoga', moves: [[8816, 'White Oaks', 1], [7919, 'Keene Mill', 1], [7917, 'Keene Mill', 0.25], [7904, 'Keene Mill', 0.08], [8922, 'Saratoga', 1]] },
]

/** Rescale SPAs 8816, 7917, 7919 so their base-school ES students match FCPS's slide estimates (105; 115 combined). */
export function fcpsScale(): Record<number, number> {
  const { m } = buildModel({})
  const r = compute(m, baselineAssignment(m, '2026'), { ...DEFAULT_PARAMS, year: 0 })
  const pos = new Map(m.raw.spa.id.map((id, i) => [id, i]))
  const gen = (id: number) => r.spaStudents.ES[pos.get(id)!] * (1 - DEFAULT_PARAMS.aapEs * 4 / 7)
  return { 8816: 105 / gen(8816), 7917: 115 / (gen(7917) + gen(7919)), 7919: 115 / (gen(7917) + gen(7919)) }
}

function run(calib: 'model' | 'fcps') {
  const splits: Record<number, number> = { 7917: 0.25, 7904: 0.08 }
  // FCPS estimates (students attending base school): 8816 = 105; 7917+7919 = 115. Rescale those SPAs to match.
  const scale = calib === 'fcps' ? fcpsScale() : {}
  const { m, part } = buildModel(splits, scale)
  const base = baselineAssignment(m, '2026')
  const out: Record<string, unknown> = { calib, scale }
  const pos = new Map(m.raw.spa.id.map((id, i) => [id, i]))
  for (const s of SCENARIOS) {
    const a: Assignment = { ES: base.ES.slice(), MS: base.MS.slice(), HS: base.HS.slice() }
    for (const [id, to, f] of s.moves) {
      const i = f < 1 ? part.get(id)! : pos.get(id)!
      a.ES[i] = sid(m, to)
      // SPA 8922 alternative: Saratoga feeds Key/Lewis already, so MS/HS stay as they are
    }
    const years: Record<number, Result> = {}
    for (const y of [0, 1, 5]) years[y] = compute(m, a, { ...DEFAULT_PARAMS, year: y } as Params, base)
    const r1 = years[1]
    const bus = estimateBuses(m, r1, DEFAULT_PARAMS)
    const sch = Object.fromEntries(SCHOOLS.map((n) => {
      const k = sid(m, n)
      const st = (y: number) => years[y].school[k]
      const routes = bus.bySchool.get(k) ?? []
      return [n, {
        enroll25: Math.round(st(0).enroll), util25: st(0).util, util27: st(1).util, util31: st(5).util,
        enroll27: Math.round(st(1).enroll), walkers: Math.round(st(1).walkers), riders: Math.round(st(1).riders), hazard: Math.round(st(1).hazard),
        walkShare: st(1).walkers / st(1).enroll, frl: st(1).frl / st(1).enroll, pieces: st(1).components,
        routes: routes.length, avgRide: routes.reduce((x, r) => x + r.minutes * r.load, 0) / Math.max(1, routes.reduce((x, r) => x + r.load, 0)),
        maxRide: Math.max(0, ...routes.map((r) => r.minutes)),
      }]
    }))
    // feeder split: ES -> MS for Keene Mill and Rolling Valley
    const split = (n: string) => {
      const row = r1.feeder.flowsEM.get(sid(m, n))
      if (!row) return null
      const tot = [...row.values()].reduce((x, y) => x + y, 0)
      return Object.fromEntries([...row].map(([k, v]) => [m.schools[k].name, Math.round((100 * v) / tot)]))
    }
    // moved areas: walk + drive, old vs new school
    const moved = s.moves.map(([id, to, f]) => {
      const i = f < 1 ? part.get(id)! : pos.get(id)!
      const from = base.ES[i], dest = sid(m, to)
      const w = (k: number) => {
        const j = m.walk.pairIndex.get(pairKey(i, k))
        if (j === undefined) return 0
        const v = m.walk.variants.indexOf('T2s')
        return m.walk.data[(v * m.walk.npairs + j) * m.walk.nbins + 9] / m.walk.scale
      }
      return { spa: id, fraction: f, students: Math.round(r1.spaStudents.ES[i]), from: m.schools[from].name, to,
        walkFrom: w(from), walkTo: w(dest), driveFromMin: (m.drive.spaSchool[i].get(from) ?? NaN) / 60, driveToMin: (m.drive.spaSchool[i].get(dest) ?? NaN) / 60,
        frl: m.raw.spa.frl[i][0] }
    })
    const t = r1.totals.ES
    out[s.key] = { label: s.label, schools: sch, feederKM: split('Keene Mill'), feederRV: split('Rolling Valley'), moved,
      esIslands: t.islands, esMoved: Math.round(t.moved), fleet: bus.fleet, routesES: bus.byLevel.ES.routes }
  }
  // model-suggested alternative: optimizer restricted to the three schools
  const ks = ['Cardinal Forest', 'Keene Mill', 'White Oaks'].map((n) => sid(m, n))
  let best: Optimizer | null = null
  for (const seed of [1, 2, 3, 4, 5]) {
    const o = new Optimizer(m, { assignment: base, base, params: DEFAULT_PARAMS, weights: { ...PRESETS.balanced.w, feeder: 1.5 }, levels: ['ES'], locked: [], iterations: 60000, allowIslands: false, seed, allowedSchools: ks })
    for (let i = 0; i < 60000; i++) o.step(4 * Math.pow(0.05 / 4, i / 60000))
    if (!best || o.best < best.best) best = o
  }
  const ro = compute(m, best!.bestA, DEFAULT_PARAMS, base)
  out.optimizer = {
    moves: [...Array(m.S).keys()].filter((i) => best!.bestA.ES[i] !== base.ES[i]).map((i) => ({ spa: m.raw.spa.id[i], from: m.schools[base.ES[i]].name, to: m.schools[best!.bestA.ES[i]].name, students: Math.round(ro.spaStudents.ES[i]) })),
    util: Object.fromEntries(ks.map((k) => [m.schools[k].name, ro.school[k].util])),
  }
  return out
}

if (process.argv[1]?.endsWith('study5.ts')) {
  const results = { model: run('model'), fcps: run('fcps') }
  mkdirSync(new URL('../../docs/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../../docs/study5-results.json', import.meta.url), JSON.stringify(results, null, 1))
  const p = (x: number) => `${Math.round(100 * x)}%`
  for (const [calib, r] of Object.entries(results) as [string, Record<string, any>][]) {
    console.log(`\n=== ${calib === 'model' ? 'Model estimates' : 'Recalibrated to FCPS moved-student estimates'} ===`)
    for (const k of ['5A', '5B', '5C', 'RV']) {
      const s = r[k]
      console.log(`\n${s.label}  | ES islands ${s.esIslands} · moved ${s.esMoved} · fleet ${s.fleet} · ES routes ${s.routesES}`)
      for (const [n, v] of Object.entries(s.schools) as [string, any][]) {
        console.log(`  ${n.padEnd(16)} SY25-26 ${String(v.enroll25).padStart(4)} ${p(v.util25).padStart(5)} | SY26-27 ${p(v.util27).padStart(5)} | SY30-31 ${p(v.util31).padStart(5)} | walk ${p(v.walkShare)} riders ${v.riders} hazard ${v.hazard} | routes ${v.routes} avg ${v.avgRide.toFixed(1)}m max ${v.maxRide.toFixed(0)}m | FRL ${p(v.frl)} | pieces ${v.pieces}`)
      }
      console.log('  KM feeds', JSON.stringify(s.feederKM), '| RV feeds', JSON.stringify(s.feederRV))
      for (const mv of s.moved) console.log(`  move ${mv.spa}${mv.fraction < 1 ? ` (${p(mv.fraction)})` : ''}: ${mv.students} ES ${mv.from}→${mv.to}; walk ${p(mv.walkFrom)}→${p(mv.walkTo)}; drive ${mv.driveFromMin.toFixed(1)}→${mv.driveToMin.toFixed(1)} min; FRL ${p(mv.frl)}`)
    }
    console.log('\noptimizer (balanced, feeders x1.5, CF/KM/WO only):', JSON.stringify(r.optimizer))
  }
}
