import { useState } from 'react'
import type { Model } from '../model/types'

interface Hit { label: string; lon: number; lat: number }

/** Geocode with Photon (OpenStreetMap data, CORS-enabled, no key) restricted to the Fairfax area. */
export function AddressSearch({ model }: { model: Model }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  void model
  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setErr('')
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q + ', Virginia')}&limit=6&bbox=-77.55,38.6,-77.03,39.07&lang=en`
      const r = await fetch(url)
      const j = await r.json()
      const h: Hit[] = (j.features ?? []).map((f: GeoJSON.Feature<GeoJSON.Point>) => {
        const pr = f.properties as Record<string, string>
        return { label: [pr.housenumber, pr.street ?? pr.name, pr.city ?? pr.district].filter(Boolean).join(' '), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }
      })
      setHits(h)
      if (!h.length) setErr('No match in Fairfax County')
      if (h.length === 1) go(h[0])
    } catch {
      setErr('Address search unavailable')
    } finally {
      setBusy(false)
    }
  }
  const go = (h: Hit) => {
    window.dispatchEvent(new CustomEvent('locate', { detail: { lon: h.lon, lat: h.lat } }))
    setHits([])
  }
  return (
    <form className="search" onSubmit={search}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an address — why is it zoned there?" />
      <button disabled={busy}>{busy ? '…' : 'Go'}</button>
      {err && <div className="hint">{err}</div>}
      {hits.length > 1 && (
        <ul className="hits">
          {hits.map((h, i) => <li key={i} onClick={() => go(h)}>{h.label}</li>)}
        </ul>
      )}
    </form>
  )
}
