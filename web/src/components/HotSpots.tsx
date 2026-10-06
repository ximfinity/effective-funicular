import type { Level, Model } from '../model/types'
export type { Focus }
import type { Result } from '../model/engine'
import { HOTSPOTS, focusFor, type Focus } from '../lib/hotspots'
import { utilColor } from '../lib/colors'
import { fmt, pct } from '../lib/format'

interface Props {
  model: Model
  result: Result
  base: Result
  focus: Focus | null
  onFocus: (f: Focus | null, level?: Level) => void
  onOptimize: (f: Focus) => void
}

export function HotSpots({ model, result, base, focus, onFocus, onOptimize }: Props) {
  return (
    <div className="hotspots">
      <p className="hint">FCPS left these areas for extended study after adopting the 2026-27 boundaries. Recommendations are due in January 2027. Focus one to zoom the map, dim everything else, and optimize only among its schools.</p>
      {HOTSPOTS.map((h) => {
        const f = focusFor(model, h)
        const on = focus?.id === h.id
        return (
          <div key={h.id} className={`hot ${on ? 'on' : ''}`}>
            <h4>{h.title}</h4>
            <p>{h.summary}</p>
            <table className="facts">
              <tbody>
                {[...f.schools].sort((a, b) => model.schools[a].level.localeCompare(model.schools[b].level) || model.schools[a].name.localeCompare(model.schools[b].name)).map((k) => {
                  const s = model.schools[k], st = result.school[k], b = base.school[k]
                  return (
                    <tr key={k}>
                      <td>{s.name} {s.level}</td>
                      <td style={{ color: utilColor(st.util) }}>{pct(st.util)}</td>
                      <td className="muted">{Math.abs(st.enroll - b.enroll) >= 1 ? `${st.enroll > b.enroll ? '+' : ''}${fmt(st.enroll - b.enroll)}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {f.spas.length > 0 && <p className="muted">Planning area{f.spas.length > 1 ? 's' : ''} {h.spas!.join(', ')} highlighted.</p>}
            <div className="btnrow">
              {on ? <button onClick={() => onFocus(null)}>Clear focus</button> : <button onClick={() => onFocus(f, h.levels[0])}>Focus map</button>}
              <button className="primary" onClick={() => onOptimize(f)}>Optimize this area</button>
              <a href={h.source} target="_blank" rel="noreferrer">FCPS page</a>
            </div>
          </div>
        )
      })}
    </div>
  )
}
