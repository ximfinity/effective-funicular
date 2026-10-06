import { useEffect, useRef, useState } from 'react'
import type { Assignment, Level, Model, Params } from '../model/types'
import { PRESETS, type Weights } from '../model/optimizer'
import { compute } from '../model/engine'
import { DATA_URL } from '../model/load'
import { fmt, pct } from '../lib/format'
import { Slider } from './Controls'

interface Props {
  model: Model
  assignment: Assignment
  base: Assignment
  params: Params
  locked: Set<number>
  level: Level
  preview: Assignment | null
  setPreview: (a: Assignment | null) => void
  onAccept: (a: Assignment) => void
}

interface Prog { iter: number; cost: number; best: number; start: number; accepted: number; breakdown: Record<string, number> }

const WEIGHT_LABELS: [keyof Weights, string, string][] = [
  ['cap', 'Relieve overcrowding', 'Students above the target band (double above 115%)'],
  ['under', 'Fill empty seats', 'Empty seats below the target band'],
  ['bus', 'Reduce busing', 'Rider-minutes on buses'],
  ['move', 'Minimize disruption', 'Students reassigned vs. the baseline'],
  ['feeder', 'Keep feeders whole', 'Students split away from their classmates at the next level'],
  ['compact', 'Compact zones', 'Straight-line distance from home to school'],
  ['equity', 'Balance demographics', 'Each school’s FRL% close to the county average'],
]

export function OptimizerPanel(p: Props) {
  const [preset, setPreset] = useState('balanced')
  const [w, setW] = useState<Weights>(PRESETS.balanced.w)
  const [levels, setLevels] = useState<Level[]>([p.level])
  const [iters, setIters] = useState(300000)
  const [islands, setIslands] = useState(false)
  const [running, setRunning] = useState(false)
  const [prog, setProg] = useState<Prog | null>(null)
  const [error, setError] = useState('')
  const worker = useRef<Worker | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])

  const run = () => {
    worker.current ??= new Worker(new URL('../model/opt.worker.ts', import.meta.url), { type: 'module' })
    setRunning(true)
    setProg(null)
    setError('')
    worker.current.onerror = (e) => { setError(e.message || 'Optimizer failed to start'); setRunning(false) }
    worker.current.onmessage = (ev) => {
      if (ev.data.type === 'error') { setError(ev.data.error); setRunning(false); return }
      const { progress } = ev.data
      setProg(progress)
      p.setPreview(progress.assignment)
      if (ev.data.type === 'done') setRunning(false)
    }
    worker.current.postMessage({
      type: 'run', dataUrl: DATA_URL,
      req: { assignment: p.assignment, base: p.base, params: p.params, weights: w, levels, locked: [...p.locked], iterations: iters, allowIslands: islands, seed: Math.floor(Math.random() * 1e9) },
    })
  }
  const stop = () => worker.current?.postMessage({ type: 'stop' })

  // change list for the preview
  const changes: { L: Level; i: number; from: number; to: number; n: number }[] = []
  let summary: { L: Level; before: ReturnType<typeof compute>['totals'][Level]; after: ReturnType<typeof compute>['totals'][Level] }[] = []
  if (p.preview && !running) {
    const before = compute(p.model, p.assignment, p.params, p.base)
    const after = compute(p.model, p.preview, p.params, p.base)
    for (const L of ['ES', 'MS', 'HS'] as Level[]) {
      for (let i = 0; i < p.model.S; i++) if (p.preview[L][i] !== p.assignment[L][i]) changes.push({ L, i, from: p.assignment[L][i], to: p.preview[L][i], n: after.spaStudents[L][i] })
    }
    summary = levels.map((L) => ({ L, before: before.totals[L], after: after.totals[L] }))
  }
  // group changes by school pair
  const groups = new Map<string, { L: Level; from: number; to: number; n: number; spas: number }>()
  for (const c of changes) {
    const key = `${c.L}:${c.from}>${c.to}`
    const g = groups.get(key) ?? { L: c.L, from: c.from, to: c.to, n: 0, spas: 0 }
    g.n += c.n
    g.spas++
    groups.set(key, g)
  }

  return (
    <div className="optimizer">
      <p className="hint">Searches for boundary changes that improve the weighted goals below, moving one planning area at a time to a neighboring school while keeping every attendance area in one piece. Locked areas (dashed outline) and each school's own building site never move.</p>
      <label className="row">
        <span>Goal preset</span>
        <select value={preset} onChange={(e) => { setPreset(e.target.value); setW(PRESETS[e.target.value].w) }}>
          {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </label>
      {WEIGHT_LABELS.map(([k, l, help]) => (
        <div key={k} title={help}>
          <Slider label={l} value={w[k]} min={0} max={3} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => { setW((x) => ({ ...x, [k]: v })); setPreset('custom') }} />
        </div>
      ))}
      <div className="row">
        <span>Levels</span>
        <div className="seg">
          {(['ES', 'MS', 'HS'] as Level[]).map((L) => (
            <button key={L} className={levels.includes(L) ? 'on' : ''} onClick={() => setLevels((ls) => (ls.includes(L) ? (ls.length > 1 ? ls.filter((x) => x !== L) : ls) : [...ls, L]))}>{L}</button>
          ))}
        </div>
      </div>
      <Slider label="Search effort (moves tried)" value={iters} min={20000} max={1000000} step={10000} fmt={(v) => fmt(v)} onChange={setIters} />
      <label className="check"><input type="checkbox" checked={islands} onChange={(e) => setIslands(e.target.checked)} /> Allow attendance islands</label>
      <div className="btnrow">
        {!running ? <button className="primary" onClick={run}>Run optimizer</button> : <button onClick={stop}>Stop</button>}
        {p.preview && !running && <><button className="primary" onClick={() => p.onAccept(p.preview!)}>Accept</button><button onClick={() => p.setPreview(null)}>Discard</button></>}
      </div>
      {error && <p className="warn">{error}</p>}
      {prog && (
        <div className="prog">
          <div className="bar"><div style={{ width: `${(100 * prog.iter) / iters}%` }} /></div>
          <div className="muted">{fmt(prog.iter)} moves tried · cost {fmt(prog.start)} → best {fmt(prog.best)} ({pct(prog.best / prog.start - 1)})</div>
          <div className="muted">Over band {fmt(prog.breakdown.overBand)} students · under band {fmt(prog.breakdown.underBand)} seats · {fmt(prog.breakdown.riderHours)} rider-hours · {fmt(prog.breakdown.moved)} reassigned · {fmt(prog.breakdown.feederMinority)} split from feeder</div>
        </div>
      )}
      {summary.map(({ L, before, after }) => (
        <div key={L} className="optsum">
          <b>{L}</b>: over-target schools {before.over} → {after.over}; under {before.under} → {after.under}; seats short {fmt(before.seatsShort)} → {fmt(after.seatsShort)}; riders {fmt(before.riders)} → {fmt(after.riders)}; islands {before.islands} → {after.islands}
        </div>
      ))}
      {groups.size > 0 && (
        <>
          <h4>Proposed changes ({changes.length} planning areas)</h4>
          <ul className="changes">
            {[...groups.values()].sort((a, b) => b.n - a.n).map((g, j) => (
              <li key={j}><b>{g.L}</b> {fmt(g.n)} students ({g.spas} area{g.spas > 1 ? 's' : ''}): {p.model.schools[g.from]?.name} → {p.model.schools[g.to]?.name}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
