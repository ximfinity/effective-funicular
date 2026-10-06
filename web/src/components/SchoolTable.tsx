import { useState } from 'react'
import type { Level, Model } from '../model/types'
import type { Result } from '../model/engine'
import { utilColor } from '../lib/colors'
import { fmt, pct, signed } from '../lib/format'

type SortKey = 'name' | 'util' | 'enroll' | 'delta' | 'walk' | 'frl' | 'riders'

export function SchoolTable({ model, level, result, base, colors, onSelect }: { model: Model; level: Level; result: Result; base: Result; colors: Map<number, string>; onSelect: (k: number) => void }) {
  const [sort, setSort] = useState<SortKey>('util')
  const [desc, setDesc] = useState(true)
  const rows = model.schools
    .map((s, k) => ({ s, k, st: result.school[k], b: base.school[k] }))
    .filter(({ s }) => s.level === level)
  const val = (r: (typeof rows)[number]): number | string => {
    switch (sort) {
      case 'name': return r.s.name
      case 'util': return Number.isFinite(r.st.util) ? r.st.util : -1
      case 'enroll': return r.st.enroll
      case 'delta': return r.st.enroll - r.b.enroll
      case 'walk': return r.st.walkers / Math.max(1, r.st.enroll)
      case 'frl': return r.st.frl / Math.max(1, r.st.enroll)
      case 'riders': return r.st.riders
    }
  }
  rows.sort((a, b) => {
    const x = val(a), y = val(b)
    const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
    return desc ? -c : c
  })
  const th = (k: SortKey, label: string) => (
    <th key={k} className={sort === k ? 'sorted' : ''} onClick={() => (sort === k ? setDesc(!desc) : (setSort(k), setDesc(k !== 'name')))}>{label}</th>
  )
  return (
    <table className="schools">
      <thead>
        <tr>
          {th('name', 'School')}{th('util', 'Util.')}{th('enroll', 'Students')}{th('delta', 'Δ')}{th('walk', 'Walk')}{th('riders', 'Riders')}{th('frl', 'FRL')}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ s, k, st, b }) => (
          <tr key={k} onClick={() => onSelect(k)}>
            <td><i className="sw" style={{ background: colors.get(k) }} />{s.name}{s.upper ? ' (upper)' : ''}{s.magnet ? ' (magnet)' : ''}{st.components > 1 && !s.upper ? <span className="flag" title="attendance island">◆</span> : null}</td>
            <td>
              <div className="ubar"><div style={{ width: `${Math.min(100, (st.util || 0) * 70)}%`, background: utilColor(st.util) }} /></div>
              {pct(st.util)}
            </td>
            <td>{fmt(st.enroll)}<span className="muted"> / {fmt(st.capacity)}</span></td>
            <td className={st.enroll - b.enroll > 0.5 ? 'up' : st.enroll - b.enroll < -0.5 ? 'down' : ''}>{Math.abs(st.enroll - b.enroll) < 0.5 ? '' : signed(st.enroll - b.enroll)}</td>
            <td>{pct(st.walkers / Math.max(1, st.enroll))}</td>
            <td>{fmt(st.riders)}</td>
            <td>{pct(st.frl / Math.max(1, st.enroll))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
