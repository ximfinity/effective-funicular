import { readFileSync } from 'node:fs'
import { baselineAssignment, compute } from '../src/model/engine'
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
const m: Model = { raw, schools: raw.schools, S: raw.spa.id.length, walk: { variants: meta.variants, nbins: meta.nbins, pairIndex, data: new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), npairs: meta.pairs.length, scale: meta.scale }, drive: { spaSchool: drive.spa_school.map((l: [number, number][]) => new Map(l)), spaSpa: drive.spa_spa.map((l: [number, number][]) => new Map(l)) }, upperOf, bySchoolId: new Map(raw.schools.map((s, i) => [s.id, i])) }
const a26 = baselineAssignment(m, '2026')
const p = { ...DEFAULT_PARAMS }
for (const preset of ['balanced', 'crowding', 'buses']) for (const T0 of [25, 8, 3]) {
  const N = 300000, T1 = 0.1
  const o = new Optimizer(m, { assignment: a26, base: a26, params: p, weights: PRESETS[preset].w, levels: ['ES', 'MS', 'HS'], locked: [], iterations: N, allowIslands: false, seed: 3 })
  const c0 = o.cost; const t = performance.now()
  for (let i = 0; i < N; i++) o.step(T0 * Math.pow(T1 / T0, i / N))
  const r = compute(m, o.bestA, p, a26)
  const tt = (L: 'ES'|'MS'|'HS') => `${L} over ${r.totals[L].over} short ${Math.round(r.totals[L].seatsShort)} riders ${Math.round(r.totals[L].riders)} moved ${Math.round(r.totals[L].moved)}`
  console.log(preset, 'T0', T0, 'cost', Math.round(c0), '->', Math.round(o.best), `${Math.round(performance.now() - t)}ms |`, tt('ES'), '|', tt('MS'), '|', tt('HS'))
}
const r0 = compute(m, a26, p, a26)
console.log('baseline', ['ES','MS','HS'].map((L) => `${L} over ${r0.totals[L as 'ES'].over} short ${Math.round(r0.totals[L as 'ES'].seatsShort)} riders ${Math.round(r0.totals[L as 'ES'].riders)}`).join(' | '))

// focused run: Glasgow / Falls Church hot spot
import { HOTSPOTS, focusFor } from '../src/lib/hotspots'
const f = focusFor(m, HOTSPOTS.find((h) => h.id === 'glasgow')!)
const of = new Optimizer(m, { assignment: a26, base: a26, params: p, weights: PRESETS.crowding.w, levels: f.levels, locked: [], iterations: 100000, allowIslands: false, seed: 5, allowedSchools: [...f.schools] })
for (let i = 0; i < 100000; i++) of.step(4 * Math.pow(0.05 / 4, i / 100000))
const rf = compute(m, of.bestA, p, a26), r0f = compute(m, a26, p, a26)
console.log('glasgow focus:', [...f.schools].map((k) => `${m.schools[k].name} ${m.schools[k].level} ${(100 * r0f.school[k].util).toFixed(0)}→${(100 * rf.school[k].util).toFixed(0)}%`).join(', '))
