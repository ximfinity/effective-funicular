import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Assignment, Level, Model, Params } from '../model/types'
import { variantName } from '../model/types'
import type { Result } from '../model/engine'
import { walkShare } from '../model/engine'
import { DATA_URL } from '../model/load'
import type { BusResult } from '../model/buses'
import { ramp, ROUTE_COLORS, utilColor, mix } from '../lib/colors'
import { fmt, pct } from '../lib/format'
import type { Selection } from '../App'
import type { Focus } from './HotSpots'

export type ColorMode = 'school' | 'util' | 'walk' | 'density' | 'frl' | 'change' | 'growth' | 'routes'
export interface Layers {
  boundaries: boolean
  schools: boolean
  barriers: boolean
  highways: boolean
  signals: boolean
  routes: boolean
  walkshed: boolean
  feeders: boolean
  official: boolean
}

interface Props {
  model: Model
  assignment: Assignment
  base: Assignment
  params: Params
  level: Level
  colorMode: ColorMode
  result: Result
  buses: BusResult
  colors: Map<number, string>
  layers: Layers
  selection: Selection
  paintSchool: number | null
  locked: Set<number>
  onSpaClick: (i: number) => void
  onSchoolClick: (k: number) => void
  onPaintDrag: (i: number) => void
  baseKey: '2025' | '2026'
  focus: Focus | null
}

const DATA = DATA_URL
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
type FC = GeoJSON.FeatureCollection
const empty: FC = { type: 'FeatureCollection', features: [] }

export function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const edges = useRef<FC | null>(null)
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })
  const tip = useRef<maplibregl.Popup | null>(null)

  // ---- init
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: [-77.29, 38.84],
      zoom: 9.9,
      attributionControl: { compact: true, customAttribution: 'Unofficial model · not affiliated with FCPS or Fairfax County' },
    })
    map.current = m
    // if the basemap style cannot load, fall back to a plain background so the model layers still work
    let styled = false
    m.once('style.load', () => { styled = true })
    m.on('error', (e) => {
      if (styled || !String(e.error?.message ?? '').includes('styles')) return
      styled = true
      m.setStyle({ version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0ec' } }] })
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right')
    m.on('load', async () => {
      const [spa, e] = await Promise.all([fetch(DATA + 'spa.geojson').then((r) => r.json()), fetch(DATA + 'spa_edges.geojson').then((r) => r.json())])
      edges.current = e
      const firstLabel = m.getStyle().layers.find((l) => l.type === 'symbol')?.id
      m.addSource('spa', { type: 'geojson', data: spa, promoteId: 'i' })
      m.addSource('bnd', { type: 'geojson', data: empty })
      m.addSource('official', { type: 'geojson', data: DATA + 'official.geojson' })
      m.addSource('barriers', { type: 'geojson', data: DATA + 'barriers.geojson' })
      m.addSource('highways', { type: 'geojson', data: DATA + 'highways.geojson' })
      m.addSource('signals', { type: 'geojson', data: DATA + 'signals.geojson' })
      m.addSource('walkshed', { type: 'geojson', data: empty })
      m.addSource('routes', { type: 'geojson', data: empty })
      m.addSource('feeders', { type: 'geojson', data: empty })
      m.addSource('schools', { type: 'geojson', data: empty, promoteId: 'k' })
      m.addLayer({ id: 'spa-fill', type: 'fill', source: 'spa', paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], '#cccccc'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.62] } }, firstLabel)
      m.addLayer({ id: 'spa-line', type: 'line', source: 'spa', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.2, 13, 1], 'line-opacity': 0.6 } }, firstLabel)
      m.addLayer({ id: 'spa-sel', type: 'line', source: 'spa', filter: ['==', ['get', 'i'], -1], paint: { 'line-color': '#111', 'line-width': 3 } })
      m.addLayer({ id: 'spa-focus', type: 'line', source: 'spa', filter: ['in', ['get', 'i'], ['literal', []]], paint: { 'line-color': '#d7301f', 'line-width': 3 } })
      m.addLayer({ id: 'spa-lock', type: 'line', source: 'spa', filter: ['in', ['get', 'i'], ['literal', []]], paint: { 'line-color': '#333', 'line-width': 1.5, 'line-dasharray': [1, 1] } })
      m.addLayer({ id: 'walkshed', type: 'fill', source: 'walkshed', paint: { 'fill-color': '#1b9e77', 'fill-opacity': 0.12, 'fill-outline-color': '#1b9e77' } })
      m.addLayer({ id: 'walkshed-line', type: 'line', source: 'walkshed', paint: { 'line-color': '#1b7e5f', 'line-width': 2, 'line-dasharray': [2, 1] } })
      m.addLayer({ id: 'highways', type: 'line', source: 'highways', paint: { 'line-color': '#5a3e2b', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 4], 'line-opacity': 0.75 } })
      m.addLayer({ id: 'barriers', type: 'line', source: 'barriers', paint: {
        'line-color': ['match', ['get', 'tier'], 1, '#b2182b', 2, '#ef8a62', '#fdb863'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'tier'], 1, 1.8, 1.2], 14, 4],
        'line-dasharray': ['case', ['get', 'sidewalk'], ['literal', [1, 0]], ['literal', [2, 1.5]]],
      } })
      m.addLayer({ id: 'signals', type: 'circle', source: 'signals', minzoom: 11, paint: { 'circle-radius': 3, 'circle-color': '#2b8cbe', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } })
      m.addLayer({ id: 'official', type: 'line', source: 'official', paint: { 'line-color': '#000', 'line-width': 1.2, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'bnd', type: 'line', source: 'bnd', paint: { 'line-color': '#1d1d1d', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 14, 3.5] } })
      m.addLayer({ id: 'feeders', type: 'line', source: 'feeders', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': 0.8 } })
      m.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.9 } })
      m.addLayer({ id: 'routes-stops', type: 'circle', source: 'routes', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 3, 'circle-color': ['get', 'color'] } })
      m.addLayer({ id: 'schools', type: 'circle', source: 'schools', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['get', 'cur'], 5, 2.5], 14, ['case', ['get', 'cur'], 10, 5]],
        'circle-color': ['get', 'color'], 'circle-stroke-color': '#111', 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3, 1],
        'circle-opacity': ['case', ['get', 'cur'], 1, 0.5],
      } })
      m.addLayer({ id: 'school-labels', type: 'symbol', source: 'schools', minzoom: 11.5, filter: ['get', 'cur'], layout: {
        'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'],
      }, paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } })

      let hovered: number | null = null
      m.on('mousemove', 'spa-fill', (ev) => {
        const f = ev.features?.[0]
        if (!f) return
        const i = f.properties!.i as number
        if (hovered !== null) m.setFeatureState({ source: 'spa', id: hovered }, { hover: false })
        hovered = i
        m.setFeatureState({ source: 'spa', id: i }, { hover: true })
        m.getCanvas().style.cursor = propsRef.current.paintSchool !== null ? 'crosshair' : 'pointer'
        if (propsRef.current.paintSchool !== null && (ev.originalEvent.buttons & 1) && ev.originalEvent.shiftKey) propsRef.current.onPaintDrag(i)
        tip.current ??= new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tip', offset: 12 })
        tip.current.setLngLat(ev.lngLat).setHTML(tipHtml(propsRef.current, i)).addTo(m)
      })
      m.on('mouseleave', 'spa-fill', () => {
        if (hovered !== null) m.setFeatureState({ source: 'spa', id: hovered }, { hover: false })
        hovered = null
        m.getCanvas().style.cursor = ''
        tip.current?.remove()
      })
      m.on('click', (ev: MapMouseEvent) => {
        const sch = m.queryRenderedFeatures(ev.point, { layers: ['schools'] })
        if (sch.length) return propsRef.current.onSchoolClick(sch[0].properties!.k as number)
        const f = m.queryRenderedFeatures(ev.point, { layers: ['spa-fill'] })
        if (f.length) propsRef.current.onSpaClick(f[0].properties!.i as number)
      })
      // shift-drag paints instead of box-zooming while in paint mode
      m.on('mousedown', (ev) => {
        if (propsRef.current.paintSchool !== null && ev.originalEvent.shiftKey) m.dragPan.disable()
      })
      m.on('mouseup', () => m.dragPan.enable())
      // address search: fly there and select the SPA under the point
      const marker = new maplibregl.Marker({ color: '#d7301f' })
      window.addEventListener('locate', (ev) => {
        const { lon, lat } = (ev as CustomEvent).detail
        marker.setLngLat([lon, lat]).addTo(m)
        m.flyTo({ center: [lon, lat], zoom: 13.5 })
        m.once('idle', () => {
          const f = m.queryRenderedFeatures(m.project([lon, lat]), { layers: ['spa-fill'] })
          if (f.length) propsRef.current.onSpaClick(f[0].properties!.i as number)
        })
      })
      setReady(true)
    })
    return () => m.remove()
  }, [])

  // ---- SPA colors
  const { model, assignment, base, params, level, colorMode, result, buses, colors, layers, selection, locked, focus } = props
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const A = assignment[level]
    const n = result.spaStudents[level]
    const yr = params.year
    const raw = model.raw.spa
    const sel = selection?.kind === 'school' ? selection.k : null
    const routeColor = new Map<number, string>()
    if (colorMode === 'routes') {
      const rs = sel !== null ? buses.bySchool.get(sel) ?? [] : buses.routes.filter((r) => model.schools[r.school].level === level)
      rs.forEach((r, j) => r.spas.forEach((i) => routeColor.set(i, ROUTE_COLORS[j % ROUTE_COLORS.length])))
    }
    for (let i = 0; i < model.S; i++) {
      const k = A[i]
      let c = '#cccccc'
      switch (colorMode) {
        case 'school':
          c = k >= 0 ? colors.get(k)! : '#ccc'
          if (sel !== null && k !== sel) c = mix(c, '#ffffff', 0.6)
          break
        case 'util':
          c = k >= 0 ? utilColor(result.school[k].util) : '#ccc'
          break
        case 'walk': {
          const target = sel !== null && model.schools[sel].level === level ? sel : k
          c = n[i] < 0.5 ? '#eeeeee' : ramp(walkShare(model, params, i, target), ['#f7f7f7', '#d9f0d3', '#7fbf7b', '#1b7837', '#00441b'])
          break
        }
        case 'density':
          c = ramp(Math.sqrt(n[i] / Math.max(raw.area[i], 0.05) / 1500))
          break
        case 'frl':
          c = n[i] < 0.5 ? '#eeeeee' : ramp(raw.frl[i][level === 'ES' ? 0 : level === 'MS' ? 1 : 2] / 0.7, ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'])
          break
        case 'change':
          c = A[i] !== base[level][i] ? (k >= 0 ? colors.get(k)! : '#000') : '#eeeeee'
          break
        case 'growth': {
          const b = raw.n[i].reduce((s, x) => s + x, 0)
          const f = yr === 0 ? b : raw.proj[yr - 1][i].reduce((s, x) => s + x, 0)
          const g = b > 1 ? f / b - 1 : 0
          c = g >= 0 ? ramp(g / 0.4, ['#f7f7f7', '#fdae61', '#d7191c']) : ramp(-g / 0.3, ['#f7f7f7', '#abd9e9', '#2c7bb6'])
          break
        }
        case 'routes':
          c = routeColor.get(i) ?? '#eeeeee'
          break
      }
      if (focus && !(focus.schools.has(k) || focus.spas.includes(i))) c = mix(c, '#ffffff', 0.75)
      m.setFeatureState({ source: 'spa', id: i }, { color: c })
    }
  }, [ready, model, assignment, base, level, colorMode, result, buses, colors, selection, params, focus])

  // ---- zoom to a hot-spot focus and outline its called-out SPAs
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    m.setFilter('spa-focus', ['in', ['get', 'i'], ['literal', focus?.spas ?? []]])
    if (!focus) return
    // read current props via the ref: re-zoom only when the focus or level changes, not on every edit
    const { model, assignment } = propsRef.current
    const A = assignment[level]
    const pts: [number, number][] = []
    for (let i = 0; i < model.S; i++) if (focus.schools.has(A[i]) || focus.spas.includes(i)) pts.push(model.raw.spa.centroid[i])
    for (const k of focus.schools) if (model.schools[k].level === level) pts.push([model.schools[k].lon, model.schools[k].lat])
    fitPoints(m, pts)
  }, [ready, focus, level])

  // ---- dissolved boundaries from shared SPA edges
  useEffect(() => {
    const m = map.current
    if (!ready || !m || !edges.current) return
    const A = assignment[level]
    const feats = layers.boundaries ? edges.current.features.filter((f) => {
      const { a, b } = f.properties as { a: number; b: number }
      return b < 0 || A[a] !== A[b]
    }) : []
    ;(m.getSource('bnd') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
  }, [ready, assignment, level, layers.boundaries])

  // ---- schools
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const feats = model.schools.map((s, k) => ({
      type: 'Feature' as const,
      properties: {
        k, cur: s.level === level, label: `${s.name} ${pct(result.school[k].util)}`,
        color: utilColor(result.school[k].util),
      },
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
    }))
    ;(m.getSource('schools') as GeoJSONSource).setData({ type: 'FeatureCollection', features: layers.schools ? feats : [] })
  }, [ready, model, level, result, layers.schools])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    model.schools.forEach((_, k) => m.setFeatureState({ source: 'schools', id: k }, { sel: selection?.kind === 'school' && selection.k === k }))
    m.setFilter('spa-sel', ['==', ['get', 'i'], selection?.kind === 'spa' ? selection.i : -1])
  }, [ready, selection, model, layers.schools, level, result])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    m.setFilter('spa-lock', ['in', ['get', 'i'], ['literal', [...locked]]])
  }, [ready, locked])

  // ---- layer visibility & barrier filter
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const vis = (id: string, on: boolean) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('barriers', layers.barriers)
    vis('highways', layers.highways)
    vis('signals', layers.signals && params.signalsCross)
    vis('official', layers.official)
    vis('walkshed', layers.walkshed)
    vis('walkshed-line', layers.walkshed)
    vis('feeders', layers.feeders)
    vis('routes', layers.routes || colorMode === 'routes')
    vis('routes-stops', layers.routes || colorMode === 'routes')
    m.setFilter('barriers', ['<=', ['get', 'tier'], params.barrierTier])
  }, [ready, layers, params.barrierTier, params.signalsCross, colorMode])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    m.setFilter('official', ['all', ['==', ['get', 'level'], level], ['==', ['get', 'year'], Number(props.baseKey)]])
  }, [ready, level, props.baseKey])

  // ---- routes
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const sel = selection?.kind === 'school' ? selection.k : null
    const rs = sel !== null ? buses.bySchool.get(sel) ?? [] : buses.routes.filter((r) => model.schools[r.school].level === level)
    const cent = model.raw.spa.centroid
    const feats: GeoJSON.Feature[] = []
    rs.forEach((r, j) => {
      const s = model.schools[r.school]
      const color = ROUTE_COLORS[j % ROUTE_COLORS.length]
      feats.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: [...r.spas.map((i) => cent[i]), [s.lon, s.lat]] } })
      for (const i of r.spas) feats.push({ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: cent[i] } })
    })
    ;(m.getSource('routes') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
  }, [ready, buses, selection, level, model])

  // ---- feeder flows
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const flows = level === 'HS' ? result.feeder.flowsMH : result.feeder.flowsEM
    const feats: GeoJSON.Feature[] = []
    for (const [a, row] of flows) {
      let mx = 0
      for (const v of row.values()) mx = Math.max(mx, v)
      for (const [b, v] of row) {
        if (v < 3) continue
        const sa = model.schools[a], sb = model.schools[b]
        feats.push({
          type: 'Feature',
          properties: { w: Math.max(1, Math.sqrt(v) / 2), color: v < mx ? '#d7301f' : '#525252' },
          geometry: { type: 'LineString', coordinates: [[sa.lon, sa.lat], [sb.lon, sb.lat]] },
        })
      }
    }
    ;(m.getSource('feeders') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
  }, [ready, result, level, model])

  // ---- walkshed of selected school
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const src = m.getSource('walkshed') as GeoJSONSource
    if (selection?.kind !== 'school') {
      src.setData(empty)
      return
    }
    const s = model.schools[selection.k]
    const v = variantName(params)
    const useV = v === 'T0' || v === 'crow' ? 'T0' : 'T2s'
    const miles = params.walkMiles[s.level]
    let cancelled = false
    fetch(`${DATA}walksheds/${s.id}.geojson`).then((r) => (r.ok ? r.json() : empty)).then((fc: FC) => {
      if (cancelled) return
      const opts = fc.features.filter((f) => f.properties!.variant === useV)
      const best = opts.sort((a, b) => Math.abs(a.properties!.miles - miles) - Math.abs(b.properties!.miles - miles))[0]
      src.setData({ type: 'FeatureCollection', features: best ? [best] : [] })
    }).catch(() => src.setData(empty))
    return () => { cancelled = true }
  }, [ready, selection, params, model])

  // ---- fly to selection
  useEffect(() => {
    const m = map.current
    if (!ready || !m || !selection) return
    if (selection.kind === 'school') {
      // zoom to the school's attendance area so its routes and walk area are readable
      const s = model.schools[selection.k]
      fitPoints(m, [[s.lon, s.lat], ...propsRef.current.result.school[selection.k].spas.map((i) => model.raw.spa.centroid[i])])
      return
    }
    const c = model.raw.spa.centroid[selection.i]
    if (!m.getBounds().contains(c)) m.easeTo({ center: c })
  }, [ready, selection, model])

  return <div ref={el} className="mapcanvas" />
}

function fitPoints(m: maplibregl.Map, pts: [number, number][]) {
  const ok = pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (!ok.length) return
  const xs = ok.map((p) => p[0]), ys = ok.map((p) => p[1])
  const pad = 0.004
  m.fitBounds([[Math.min(...xs) - pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.max(...ys) + pad]], { padding: 50, maxZoom: 14, duration: 600 })
}

function tipHtml(p: Props, i: number) {
  const { model, assignment, level, result, params } = p
  const k = assignment[level][i]
  const s = k >= 0 ? model.schools[k] : null
  const n = result.spaStudents[level][i]
  const w = s ? walkShare(model, params, i, k) : 0
  const moved = assignment[level][i] !== p.base[level][i]
  return `<b>SPA ${model.raw.spa.id[i]}</b>${moved ? ' <span class="chg">reassigned</span>' : ''}<br>${s ? s.name : '—'} ${level}<br>${fmt(n)} ${level} students · ${pct(w)} walk`
}
