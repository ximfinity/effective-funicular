import { useState } from 'react'
import type { Assignment, Model, Params } from '../model/types'
import { SHORT_DISCLAIMER } from '../lib/disclaimer'
import { apply, deleteLocal, diff, listSaved, saveLocal, toHash, type SavedScenario } from '../lib/scenario'

interface Props {
  model: Model
  assignment: Assignment
  params: Params
  baseKey: '2025' | '2026'
  onLoad: (a: Assignment, p: Params, base: '2025' | '2026') => void
  onReset: (which: '2025' | '2026') => void
  onUndo: () => void
  canUndo: boolean
}

export function ScenarioBar(p: Props) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(listSaved)
  const [msg, setMsg] = useState('')
  const current = (name: string): SavedScenario => ({ name, base: '2026', changes: diff(p.model, p.assignment, '2026'), params: p.params, saved: new Date().toISOString() })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }
  const share = async () => {
    const url = location.origin + location.pathname + toHash(current('shared'))
    history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url); flash('Link copied') } catch { flash('Link is in the address bar') }
  }
  const save = () => {
    const name = prompt('Scenario name?', `Scenario ${saved.length + 1}`)
    if (!name) return
    saveLocal(current(name))
    setSaved(listSaved())
    flash('Saved in this browser')
  }
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ disclaimer: `${SHORT_DISCLAIMER} Hypothetical scenario, not an official FCPS proposal or assignment.`, ...current('export') }, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'fcps-scenario.json'
    a.click()
  }
  const importJson = (f: File) => f.text().then((t) => {
    const s = JSON.parse(t) as SavedScenario
    p.onLoad(apply(p.model, s), { ...p.params, ...s.params }, s.base)
  })
  const nChanges = diff(p.model, p.assignment, '2026').length
  return (
    <div className="scenariobar">
      <span className="muted">{nChanges ? `${nChanges} area-level changes vs. adopted 2026-27` : 'Adopted 2026-27 boundaries'}</span>
      <button onClick={p.onUndo} disabled={!p.canUndo} title="Ctrl+Z">Undo</button>
      <button onClick={() => p.onReset('2026')}>Reset to 2026-27</button>
      <button onClick={() => p.onReset('2025')}>Load 2025-26</button>
      <button onClick={save}>Save</button>
      <div className="dd">
        <button onClick={() => setOpen(!open)}>Scenarios ▾</button>
        {open && (
          <div className="menu" onMouseLeave={() => setOpen(false)}>
            {saved.length === 0 && <div className="muted">No saved scenarios</div>}
            {saved.map((s) => (
              <div key={s.name} className="item">
                <span onClick={() => { p.onLoad(apply(p.model, s), { ...p.params, ...s.params }, s.base); setOpen(false) }}>{s.name} <small className="muted">{s.changes.length} changes</small></span>
                <button className="small" onClick={() => { deleteLocal(s.name); setSaved(listSaved()) }}>×</button>
              </div>
            ))}
            <hr />
            <div className="item"><span onClick={share}>Copy share link</span></div>
            <div className="item"><span onClick={exportJson}>Export JSON</span></div>
            <label className="item"><span>Import JSON</span><input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} /></label>
          </div>
        )}
      </div>
      <button onClick={share}>Share</button>
      {msg && <span className="flash">{msg}</span>}
    </div>
  )
}
