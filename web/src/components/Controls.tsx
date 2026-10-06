import { useState } from 'react'
import type { Level, Model, Params, BarrierTier } from '../model/types'
import type { Result } from '../model/engine'
import type { ColorMode, Layers } from './MapView'
import { UTIL_LEGEND } from '../lib/colors'
import { YEAR_LABELS, pct } from '../lib/format'
import { AddressSearch } from './AddressSearch'

interface Props {
  model: Model
  level: Level
  setLevel: (l: Level) => void
  params: Params
  setParams: (f: (p: Params) => Params) => void
  colorMode: ColorMode
  setColorMode: (c: ColorMode) => void
  layers: Layers
  setLayers: (f: (l: Layers) => Layers) => void
  baseKey: '2025' | '2026'
  setBaseKey: (b: '2025' | '2026') => void
  paintSchool: number | null
  setPaintSchool: (k: number | null) => void
  colors: Map<number, string>
  result: Result
}

const COLOR_MODES: [ColorMode, string][] = [
  ['school', 'Assigned school'],
  ['util', 'Utilization of assigned school'],
  ['walk', 'Share of students within walk distance'],
  ['routes', 'Bus routes (select a school)'],
  ['change', 'Changed vs. baseline'],
  ['density', 'Student density'],
  ['frl', 'Free/reduced-price meals (est.)'],
  ['growth', 'Projected growth vs. 2025-26'],
]

const TIERS: [BarrierTier, string, string][] = [
  [0, 'Highways only', 'Interstates, freeways and ramps can only be crossed on a bridge or underpass'],
  [1, '+ High-speed arterials', 'Adds primary routes, roads ≥45 mph and divided roads ≥40 mph (Rt 1, 7, 29, 50, 123, 236, Fairfax County Pkwy…)'],
  [2, '+ All arterials', 'Adds major/minor arterials and secondary routes ≥35 mph (Braddock, Gallows, Franconia, Reston Pkwy…)'],
  [3, '+ Collectors', 'Adds every non-local road ≥30 mph'],
]

export function Controls(p: Props) {
  const { params, setParams } = p
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((x) => ({ ...x, [k]: v }))
  const [open, setOpen] = useState<Record<string, boolean>>({ view: true, walk: true, bus: false, cap: false, prog: false, layers: false })
  const tog = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const schoolsAtLevel = p.model.schools.map((s, k) => ({ s, k })).filter(({ s }) => s.level === p.level && !s.upper && !s.magnet).sort((a, b) => a.s.name.localeCompare(b.s.name))

  return (
    <div className="controls">
      <AddressSearch model={p.model} />
      <div className="seg big">
        {(['ES', 'MS', 'HS'] as Level[]).map((l) => (
          <button key={l} className={p.level === l ? 'on' : ''} onClick={() => p.setLevel(l)}>
            {{ ES: 'Elementary', MS: 'Middle', HS: 'High' }[l]}
          </button>
        ))}
      </div>

      <Section title="View" open={open.view} onToggle={() => tog('view')}>
        <label className="row">
          <span>Color areas by</span>
          <select value={p.colorMode} onChange={(e) => p.setColorMode(e.target.value as ColorMode)}>
            {COLOR_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {p.colorMode === 'util' && (
          <div className="legend">{UTIL_LEGEND.map(([c, l]) => <div key={l}><i style={{ background: c }} />{l}</div>)}</div>
        )}
        <label className="row">
          <span>Enrollment year</span>
          <select value={params.year} onChange={(e) => set('year', Number(e.target.value))}>
            {YEAR_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </label>
        <label className="row">
          <span>Compare against</span>
          <select value={p.baseKey} onChange={(e) => p.setBaseKey(e.target.value as '2025' | '2026')}>
            <option value="2026">Adopted 2026-27 boundaries</option>
            <option value="2025">2025-26 boundaries</option>
          </select>
        </label>
        <div className="paint">
          <label className="row">
            <span>Paint areas to</span>
            <select value={p.paintSchool ?? ''} onChange={(e) => p.setPaintSchool(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">— off (click to inspect) —</option>
              {schoolsAtLevel.map(({ s, k }) => <option key={k} value={k}>{s.name} ({pct(p.result.school[k].util)})</option>)}
            </select>
          </label>
          {p.paintSchool !== null && <p className="hint">Click areas to reassign them to <b style={{ color: p.colors.get(p.paintSchool) }}>{p.model.schools[p.paintSchool].name}</b>. Hold Shift and drag to paint. Esc to stop, Ctrl+Z to undo.</p>}
        </div>
      </Section>

      <Section title="Walking & barriers" open={open.walk} onToggle={() => tog('walk')}>
        {(['ES', 'MS', 'HS'] as Level[]).map((l) => (
          <Slider key={l} label={`Max walk, ${l}`} value={params.walkMiles[l]} min={0.2} max={2} step={0.1} fmt={(v) => `${v.toFixed(1)} mi`}
            onChange={(v) => setParams((x) => ({ ...x, walkMiles: { ...x.walkMiles, [l]: v } }))} />
        ))}
        <p className="hint">FCPS policy: 1.0 mi elementary, 1.5 mi middle/high, measured along the street and trail network.</p>
        <div className="radio">
          <span>Roads students won't be expected to cross</span>
          {TIERS.map(([t, label, help]) => (
            <label key={t} title={help}>
              <input type="radio" checked={params.barrierTier === t && !params.straightLine} onChange={() => setParams((x) => ({ ...x, barrierTier: t, straightLine: false }))} />
              {label}
            </label>
          ))}
          <label title="Ignore the street network and barriers entirely">
            <input type="radio" checked={params.straightLine} onChange={() => set('straightLine', true)} /> Straight-line distance (no network)
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={params.signalsCross} disabled={params.barrierTier === 0 || params.straightLine} onChange={(e) => set('signalsCross', e.target.checked)} />
          Allow crossing at signalized intersections
        </label>
        <p className="hint">Barrier roads can be walked along only where a sidewalk exists. Signals are inferred where arterials meet (see Method).</p>
      </Section>

      <Section title="Buses" open={open.bus} onToggle={() => tog('bus')}>
        <Slider label="Eligible students who ride" value={params.ridership} min={0.4} max={1} step={0.05} fmt={pct} onChange={(v) => set('ridership', v)} />
        <Slider label="Riders per bus, ES" value={params.busCapacity.ES} min={30} max={77} step={1} fmt={String} onChange={(v) => setParams((x) => ({ ...x, busCapacity: { ...x.busCapacity, ES: v } }))} />
        <Slider label="Riders per bus, MS/HS" value={params.busCapacity.HS} min={30} max={64} step={1} fmt={String} onChange={(v) => setParams((x) => ({ ...x, busCapacity: { ...x.busCapacity, MS: v, HS: v } }))} />
        <Slider label="Max ride, ES" value={params.maxRideMin.ES} min={20} max={75} step={5} fmt={(v) => `${v} min`} onChange={(v) => setParams((x) => ({ ...x, maxRideMin: { ...x.maxRideMin, ES: v } }))} />
        <Slider label="Max ride, MS/HS" value={params.maxRideMin.HS} min={20} max={75} step={5} fmt={(v) => `${v} min`} onChange={(v) => setParams((x) => ({ ...x, maxRideMin: { ...x.maxRideMin, MS: v, HS: v } }))} />
        <Slider label="Seconds per stop" value={params.stopDwellSec} min={10} max={90} step={5} fmt={(v) => `${v}s`} onChange={(v) => set('stopDwellSec', v)} />
        <Slider label="Spare buses" value={params.spareRatio} min={0} max={0.3} step={0.01} fmt={pct} onChange={(v) => set('spareRatio', v)} />
      </Section>

      <Section title="Capacity" open={open.cap} onToggle={() => tog('cap')}>
        <Slider label="Target band, low" value={params.utilLow} min={0.6} max={1} step={0.01} fmt={pct} onChange={(v) => set('utilLow', v)} />
        <Slider label="Target band, high" value={params.utilHigh} min={0.9} max={1.3} step={0.01} fmt={pct} onChange={(v) => set('utilHigh', v)} />
        <label className="check">
          <input type="checkbox" checked={params.countTemp} onChange={(e) => set('countTemp', e.target.checked)} />
          Count temporary classrooms (trailers) as capacity
        </label>
        {params.countTemp && <Slider label="Seats per trailer" value={params.seatsPerTemp} min={15} max={30} step={1} fmt={String} onChange={(v) => set('seatsPerTemp', v)} />}
      </Section>

      <Section title="Special programs" open={open.prog} onToggle={() => tog('prog')}>
        <Slider label="AAP Level IV center share, gr 3-6" value={params.aapEs} min={0} max={0.3} step={0.01} fmt={pct} onChange={(v) => set('aapEs', v)} />
        <Slider label="AAP center share, gr 7-8" value={params.aapMs} min={0} max={0.3} step={0.01} fmt={pct} onChange={(v) => set('aapMs', v)} />
        <Slider label="TJHSST share, gr 9-12" value={params.tjShare} min={0} max={0.08} step={0.005} fmt={(v) => pct(v, 1)} onChange={(v) => set('tjShare', v)} />
        <p className="hint">AAP center students are routed to their SPA's AAP center (2026-27 AAP boundaries). TJ students leave their base high school.</p>
      </Section>

      <Section title="Map layers" open={open.layers} onToggle={() => tog('layers')}>
        {([
          ['boundaries', 'Scenario boundaries'],
          ['official', 'Official boundary lines (comparison year)'],
          ['schools', 'Schools'],
          ['highways', 'Limited-access highways'],
          ['barriers', 'Barrier roads (dashed = no sidewalk)'],
          ['signals', 'Inferred signalized crossings'],
          ['walkshed', 'Walk area of selected school'],
          ['routes', 'Bus routes'],
          ['feeders', 'Feeder flows (red = split)'],
        ] as [keyof Layers, string][]).map(([k, l]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={p.layers[k]} onChange={(e) => p.setLayers((x) => ({ ...x, [k]: e.target.checked }))} /> {l}
          </label>
        ))}
      </Section>
    </div>
  )
}

function Section(p: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className={`sect ${p.open ? 'open' : ''}`}>
      <h3 onClick={p.onToggle}>{p.title}<span>{p.open ? '−' : '+'}</span></h3>
      {p.open && <div className="sectbody">{p.children}</div>}
    </section>
  )
}

export function Slider(p: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{p.label}</span>
      <b>{p.fmt(p.value)}</b>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  )
}
