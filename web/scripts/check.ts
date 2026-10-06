// Headless sanity check of the model against the data bundle: npx tsx scripts/check.ts
import { readFileSync } from 'node:fs'
import { baselineAssignment, compute } from '../src/model/engine'
import { estimateBuses } from '../src/model/buses'
import { Optimizer, PRESETS } from '../src/model/optimizer'
import { pairKey } from '../src/model/load'
import { DEFAULT_PARAMS, type Model, type RawModel } from '../src/model/types'

const D = new URL('../public/data/', import.meta.url)
const raw = JSON.parse(readFileSync(new URL('model.json', D), 'utf8')) as RawModel
const meta = JSON.parse(readFileSync(new URL('walk_meta.json', D), 'utf8'))
const buf = readFileSync(new URL('walk.bin', D))
const drive = JSON.parse(readFileSync(new URL('drive.json', D), 'utf8'))
const pairIndex = new Map<number, number>()
meta.pairs.forEach(([s, k]: [number, number], j: number) => pairIndex.set(pairKey(s, k), j))
const upperOf = new Int32Array(raw.schools.length).fill(-1)
for (const [k, v] of Object.entries(raw.upperOf)) upperOf[Number(k)] = v
const m: Model = {
  raw, schools: raw.schools, S: raw.spa.id.length,
  walk: { variants: meta.variants, nbins: meta.nbins, pairIndex, data: new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), npairs: meta.pairs.length, scale: meta.scale },
  drive: { spaSchool: drive.spa_school.map((l: [number, number][]) => new Map(l)), spaSpa: drive.spa_spa.map((l: [number, number][]) => new Map(l)) },
  upperOf, bySchoolId: new Map(raw.schools.map((s, i) => [s.id, i])),
}

// 1. baseline 2025-26 at year 0 should reproduce CIP membership
const a25 = baselineAssignment(m, '2025')
const p0 = { ...DEFAULT_PARAMS, year: 0 }
const r25 = compute(m, a25, p0)
let err = 0, cnt = 0
const worst: [string, number, number][] = []
m.schools.forEach((s, k) => {
  if (!s.membership || s.magnet) return
  const e = r25.school[k].enroll
  err += Math.abs(e - s.membership) / s.membership
  cnt++
  worst.push([`${s.name} ${s.level}`, Math.round(e), s.membership])
})
worst.sort((a, b) => Math.abs(b[1] - b[2]) / b[2] - Math.abs(a[1] - a[2]) / a[2])
console.log(`2025-26 calibration: mean abs error ${(100 * err / cnt).toFixed(1)}% over ${cnt} schools; worst:`, worst.slice(0, 6))
console.log('grade gaps (25-26):', Math.round(r25.gradeGaps))

// 2. adopted 2026-27, SY26-27
const a26 = baselineAssignment(m, '2026')
const p1 = { ...DEFAULT_PARAMS }
const r26 = compute(m, a26, p1, a25)
for (const L of ['ES', 'MS', 'HS'] as const) {
  const t = r26.totals[L]
  console.log(L, { enroll: Math.round(t.enroll), over: t.over, under: t.under, inBand: t.inBand, walkShare: (t.walkers / t.enroll).toFixed(3), riders: Math.round(t.riders), hazard: Math.round(t.hazard), movedVs2025: Math.round(t.moved), islands: t.islands, outside: t.outside })
}
console.log('grade gaps (26-27):', Math.round(r26.gradeGaps), 'split feeders ES->MS', r26.feeder.esSplit, 'MS->HS', r26.feeder.msSplit)

// 3. walk share sensitivity to barrier tier
for (const v of ['crow', 'T0', 'T1s', 'T2s', 'T2n', 'T3n'] as const) {
  const pv = { ...p1, straightLine: v === 'crow', barrierTier: (v === 'crow' ? 0 : Number(v[1])) as 0 | 1 | 2 | 3, signalsCross: v.endsWith('s') }
  const r = compute(m, a26, pv)
  console.log(`variant ${v}: ES walk ${(r.totals.ES.walkers / r.totals.ES.enroll * 100).toFixed(1)}%, HS walk ${(r.totals.HS.walkers / r.totals.HS.enroll * 100).toFixed(1)}%`)
}

// 4. buses
let t0 = performance.now()
const b = estimateBuses(m, r26, p1)
console.log(`buses: ${b.routes.length} routes, fleet ${b.fleet} (no tiers ${b.fleetNoTiers}) in ${(performance.now() - t0).toFixed(0)}ms`, b.byLevel)

// 5. compute speed
t0 = performance.now()
for (let i = 0; i < 20; i++) compute(m, a26, p1, a25)
console.log(`compute: ${((performance.now() - t0) / 20).toFixed(1)} ms`)

// 6. optimizer
t0 = performance.now()
const opt = new Optimizer(m, { assignment: a26, base: a26, params: p1, weights: PRESETS.crowding.w, levels: ['ES'], locked: [], iterations: 100000, allowIslands: false, seed: 7 })
const c0 = opt.cost
const check0 = opt.totalCost()
for (let i = 0; i < 100000; i++) opt.step(25 * Math.pow(0.1 / 25, i / 100000))
console.log(`optimizer ES: cost ${c0.toFixed(0)} -> ${opt.cost.toFixed(0)} (best ${opt.best.toFixed(0)}), recomputed ${opt.totalCost().toFixed(0)} (initial check ${check0.toFixed(0)}) in ${(performance.now() - t0).toFixed(0)}ms`)
const rb = compute(m, opt.bestA, p1, a26)
console.log('after ES opt:', { over: rb.totals.ES.over, under: rb.totals.ES.under, seatsShort: Math.round(rb.totals.ES.seatsShort), moved: Math.round(rb.totals.ES.moved), islands: rb.totals.ES.islands }, 'before:', { over: r26.totals.ES.over, under: r26.totals.ES.under, seatsShort: Math.round(r26.totals.ES.seatsShort), islands: r26.totals.ES.islands })

// 7. FRL calibration: modeled 2025-26 FRL% vs NCES 2024-25 actual
let fe = 0, fc = 0
const fw: [string, string, string][] = []
m.schools.forEach((s, k) => {
  if (s.frl == null || s.magnet) return
  const est = r25.school[k].frl / r25.school[k].enroll
  fe += Math.abs(est - s.frl); fc++
  fw.push([s.name, (100 * est).toFixed(0), (100 * s.frl).toFixed(0)])
})
fw.sort((a, b) => Math.abs(+b[1] - +b[2]) - Math.abs(+a[1] - +a[2]))
console.log(`FRL: mean abs error ${(100 * fe / fc).toFixed(1)} pts; worst`, fw.slice(0, 5))
