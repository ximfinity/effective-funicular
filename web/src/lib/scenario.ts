import type { Assignment, Level, Model, Params } from '../model/types'
import { DEFAULT_PARAMS } from '../model/types'
import { baselineAssignment } from '../model/engine'

export interface SavedScenario {
  name: string
  base: '2025' | '2026'
  changes: [Level, number, number][] // level, SPA id, school id
  params: Partial<Params>
  saved: string
  disclaimer?: string
}

export function diff(m: Model, a: Assignment, base: '2025' | '2026'): [Level, number, number][] {
  const b = baselineAssignment(m, base)
  const out: [Level, number, number][] = []
  for (const L of ['ES', 'MS', 'HS'] as Level[]) {
    for (let i = 0; i < m.S; i++) if (a[L][i] !== b[L][i]) out.push([L, m.raw.spa.id[i], m.schools[a[L][i]].id])
  }
  return out
}

export function apply(m: Model, s: SavedScenario): Assignment {
  const a = baselineAssignment(m, s.base)
  const pos = new Map(m.raw.spa.id.map((id, i) => [id, i]))
  for (const [L, spa, sid] of s.changes) {
    const i = pos.get(spa), k = m.bySchoolId.get(sid)
    if (i !== undefined && k !== undefined) a[L][i] = k
  }
  return a
}

export function toHash(s: SavedScenario): string {
  return '#s=' + btoa(unescape(encodeURIComponent(JSON.stringify(s))))
}

export function fromHash(h: string): SavedScenario | null {
  const m = h.match(/#s=(.+)$/)
  if (!m) return null
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(m[1])))) as SavedScenario
    s.params = { ...DEFAULT_PARAMS, ...s.params }
    return s
  } catch {
    return null
  }
}

const KEY = 'fcps-boundary-scenarios'
export function listSaved(): SavedScenario[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}
export function saveLocal(s: SavedScenario) {
  try {
    const all = listSaved().filter((x) => x.name !== s.name)
    all.unshift(s)
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 30)))
  } catch {
    /* storage unavailable */
  }
}
export function deleteLocal(name: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(listSaved().filter((x) => x.name !== name)))
  } catch {
    /* storage unavailable */
  }
}
