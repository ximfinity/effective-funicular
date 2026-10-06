import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type ColorMode, type Layers } from './components/MapView'
import { Controls } from './components/Controls'
import { Scorecard } from './components/Scorecard'
import { SchoolTable } from './components/SchoolTable'
import { Inspector } from './components/Inspector'
import { OptimizerPanel } from './components/OptimizerPanel'
import { ScenarioBar } from './components/ScenarioBar'
import { About } from './components/About'
import { DisclaimerGate } from './components/Disclaimer'
import { HotSpots, type Focus } from './components/HotSpots'
import { loadModel } from './model/load'
import { baselineAssignment, cloneAssignment, compute } from './model/engine'
import { estimateBuses } from './model/buses'
import type { Assignment, Level, Model, Params } from './model/types'
import { DEFAULT_PARAMS } from './model/types'
import { schoolColors } from './lib/colors'
import { apply, fromHash } from './lib/scenario'

export type Selection = { kind: 'spa'; i: number } | { kind: 'school'; k: number } | null

export default function App() {
  const [model, setModel] = useState<Model | null>(null)
  const [status, setStatus] = useState('Loading…')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadModel(setStatus).then(setModel).catch((e) => setError(String(e)))
  }, [])
  if (error) return <div className="splash error">Could not load data: {error}</div>
  if (!model) return <div className="splash">{status}</div>
  return <Explorer model={model} />
}

function Explorer({ model }: { model: Model }) {
  const initial = useMemo(() => fromHash(location.hash), [])
  const [baseKey, setBaseKey] = useState<'2025' | '2026'>(initial?.base ?? '2026')
  const base = useMemo(() => baselineAssignment(model, baseKey), [model, baseKey])
  const [assignment, setAssignment] = useState<Assignment>(() => (initial ? apply(model, initial) : baselineAssignment(model, '2026')))
  const [params, setParams] = useState<Params>(() => ({ ...DEFAULT_PARAMS, ...(initial?.params ?? {}) }))
  const [level, setLevel] = useState<Level>('ES')
  const [colorMode, setColorMode] = useState<ColorMode>('school')
  const [selection, setSelection] = useState<Selection>(null)
  const [paintSchool, setPaintSchool] = useState<number | null>(null)
  const [locked, setLocked] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<Assignment | null>(null)
  const [tab, setTab] = useState<'scores' | 'schools' | 'hot' | 'optimize' | 'about'>('scores')
  const [focus, setFocus] = useState<Focus | null>(null)
  const [layers, setLayers] = useState<Layers>({ boundaries: true, schools: true, barriers: false, highways: true, signals: false, routes: false, walkshed: true, feeders: false, official: false })
  const undo = useRef<Assignment[]>([])
  const [undoCount, setUndoCount] = useState(0)

  const shown = preview ?? assignment
  const colors = useMemo(() => schoolColors(model, baselineAssignment(model, '2026')), [model])
  const result = useMemo(() => compute(model, shown, params, base), [model, shown, params, base])
  const baseResult = useMemo(() => compute(model, base, params, base), [model, base, params])
  const buses = useMemo(() => estimateBuses(model, result, params), [model, result, params])
  const baseBuses = useMemo(() => estimateBuses(model, baseResult, params), [model, baseResult, params])

  const reassign = useCallback(
    (i: number, k: number, L: Level = level) => {
      setAssignment((a) => {
        if (a[L][i] === k) return a
        undo.current.push(cloneAssignment(a))
        if (undo.current.length > 100) undo.current.shift()
        setUndoCount(undo.current.length)
        const b = cloneAssignment(a)
        b[L][i] = k
        return b
      })
    },
    [level],
  )
  const replace = useCallback((a: Assignment) => {
    setAssignment((cur) => {
      undo.current.push(cloneAssignment(cur))
      setUndoCount(undo.current.length)
      return cloneAssignment(a)
    })
  }, [])
  const doUndo = useCallback(() => {
    const prev = undo.current.pop()
    setUndoCount(undo.current.length)
    if (prev) setAssignment(prev)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo() }
      if (e.key === 'Escape') { setPaintSchool(null); setSelection(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doUndo])

  const onSpaClick = useCallback(
    (i: number) => {
      if (paintSchool !== null) reassign(i, paintSchool)
      else setSelection({ kind: 'spa', i })
    },
    [paintSchool, reassign],
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>FCPS Boundary Explorer</strong>
          <span className="muted">Independent, unofficial modeling tool</span>
          <DisclaimerGate />
        </div>
        <ScenarioBar
          model={model} assignment={assignment} params={params} baseKey={baseKey}
          onLoad={(a, p, b) => { replace(a); setParams(p); setBaseKey(b) }}
          onReset={(which) => { replace(baselineAssignment(model, which)); setBaseKey(which) }}
          onUndo={doUndo} canUndo={undoCount > 0}
        />
      </header>
      <aside className="left">
        <Controls
          model={model} level={level} setLevel={setLevel} params={params} setParams={setParams}
          colorMode={colorMode} setColorMode={setColorMode} layers={layers} setLayers={setLayers}
          baseKey={baseKey} setBaseKey={setBaseKey}
          paintSchool={paintSchool} setPaintSchool={setPaintSchool} colors={colors} result={result}
        />
      </aside>
      <main className="map">
        <MapView
          model={model} assignment={shown} base={base} params={params} level={level} colorMode={colorMode}
          result={result} buses={buses} colors={colors} layers={layers} selection={selection}
          paintSchool={paintSchool} locked={locked} onSpaClick={onSpaClick} baseKey={baseKey} focus={focus}
          onSchoolClick={(k) => setSelection({ kind: 'school', k })}
          onPaintDrag={(i) => paintSchool !== null && reassign(i, paintSchool)}
        />
        {preview && <div className="banner">Previewing optimizer result — accept or discard in the Optimize tab</div>}
      </main>
      <aside className="right">
        <nav className="tabs">
          {(['scores', 'schools', 'hot', 'optimize', 'about'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {{ scores: 'Scorecard', schools: 'Schools', hot: 'Hot spots', optimize: 'Optimize', about: 'Method' }[t]}
            </button>
          ))}
        </nav>
        <div className="tabbody">
          {selection && (
            <Inspector
              model={model} selection={selection} assignment={shown} base={base} params={params} level={level}
              result={result} buses={buses} colors={colors} locked={locked}
              onReassign={(i, k, L) => reassign(i, k, L)}
              onToggleLock={(i) => setLocked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}
              onSelect={setSelection} onClose={() => setSelection(null)}
              onPaint={(k) => setPaintSchool(k)}
            />
          )}
          {tab === 'scores' && <Scorecard model={model} level={level} result={result} base={baseResult} buses={buses} baseBuses={baseBuses} baseKey={baseKey} params={params} />}
          {tab === 'schools' && <SchoolTable model={model} level={level} result={result} base={baseResult} colors={colors} onSelect={(k) => setSelection({ kind: 'school', k })} />}
          {tab === 'optimize' && (
            <OptimizerPanel
              key={focus?.id ?? 'county'}
              model={model} assignment={assignment} base={base} params={params} locked={locked} level={level}
              preview={preview} setPreview={setPreview} onAccept={(a) => { replace(a); setPreview(null) }}
              focus={focus} onClearFocus={() => setFocus(null)}
            />
          )}
          {tab === 'hot' && (
            <HotSpots
              model={model} result={result} base={baseResult} focus={focus}
              onFocus={(f, L) => { setFocus(f); if (L) setLevel(L); setSelection(null) }}
              onOptimize={(f) => { setFocus(f); setLevel(f.levels[0]); setSelection(null); setTab('optimize') }}
            />
          )}
          {tab === 'about' && <About model={model} />}
        </div>
      </aside>
    </div>
  )
}
