export const fmt = (x: number, d = 0) =>
  Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '–'
export const pct = (x: number, d = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '–')
export const signed = (x: number, d = 0) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${fmt(x, d)}` : '–')
export const clock = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`
}
export const YEAR_LABELS = ['SY 2025-26 (est.)', 'SY 2026-27', 'SY 2027-28', 'SY 2028-29', 'SY 2029-30', 'SY 2030-31']
