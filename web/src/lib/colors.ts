import type { Assignment, Level, Model } from '../model/types'

// 10 distinguishable, map-friendly hues (adjacent schools never share one)
export const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#86bcb6']

/** Greedy graph coloring so neighbouring attendance areas get different colors. */
export function schoolColors(m: Model, a: Assignment): Map<number, string> {
  const out = new Map<number, string>()
  for (const L of ['ES', 'MS', 'HS'] as Level[]) {
    const A = a[L]
    const nb = new Map<number, Set<number>>()
    for (let i = 0; i < m.S; i++) {
      for (const [j] of m.raw.spa.adj[i]) {
        if (A[i] !== A[j] && A[i] >= 0 && A[j] >= 0) {
          if (!nb.has(A[i])) nb.set(A[i], new Set())
          nb.get(A[i])!.add(A[j])
        }
      }
    }
    const ks = [...new Set(A)].filter((k) => k >= 0).sort((x, y) => (nb.get(y)?.size ?? 0) - (nb.get(x)?.size ?? 0))
    const col = new Map<number, number>()
    for (const k of ks) {
      const used = new Set([...(nb.get(k) ?? [])].map((j) => col.get(j)).filter((c) => c !== undefined))
      let c = 0
      while (used.has(c)) c++
      col.set(k, c % PALETTE.length)
    }
    for (const [k, c] of col) out.set(k, PALETTE[c])
  }
  // schools that only appear in other scenarios
  m.schools.forEach((_, k) => { if (!out.has(k)) out.set(k, PALETTE[k % PALETTE.length]) })
  return out
}

export function utilColor(u: number): string {
  if (!Number.isFinite(u)) return '#bbbbbb'
  if (u >= 1.15) return '#c0392b'
  if (u >= 1.05) return '#e67e22'
  if (u >= 0.95) return '#f1c40f'
  if (u >= 0.85) return '#27ae60'
  if (u >= 0.7) return '#5dade2'
  return '#2e86c1'
}

export const UTIL_LEGEND: [string, string][] = [
  ['#c0392b', '≥115% substantial deficit'],
  ['#e67e22', '105–114% moderate deficit'],
  ['#f1c40f', '95–104% approaching'],
  ['#27ae60', '85–94% sufficient'],
  ['#5dade2', '70–84% surplus'],
  ['#2e86c1', '<70% large surplus'],
]

/** Sequential ramp, t in [0,1]. */
export function ramp(t: number, stops = ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b']): string {
  if (!Number.isFinite(t)) return '#dddddd'
  t = Math.max(0, Math.min(1, t))
  const x = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  return mix(stops[i], stops[i + 1], x - i)
}

export function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255]
  const [r1, g1, b1] = ch(pa), [r2, g2, b2] = ch(pb)
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`
}

export const ROUTE_COLORS = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#a65628', '#f781bf', '#17becf', '#bcbd22', '#666666']
