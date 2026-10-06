import type { Level, Model } from '../model/types'

/**
 * FCPS extended boundary studies ("hot spots") left open by the January 2026 comprehensive review.
 * Recommendations are due to the School Board in January 2027.
 * Source: fcps.edu/facilities-planning-future/school-boundary-adjustments and the study pages.
 */
export interface HotSpot {
  id: string
  title: string
  summary: string
  levels: Level[] // levels the study is about (optimizer default)
  schools: Partial<Record<Level, string[]>> // schools in scope, by level
  spas?: number[] // specific SPAs called out by FCPS
  source: string
}

export const HOTSPOTS: HotSpot[] = [
  {
    id: 'lorton',
    title: 'Gunston · Halley · Laurel Hill · Lorton Station',
    summary: 'Neighborhoods split among four southern elementary schools near Lorton, where growth is uneven.',
    levels: ['ES'],
    schools: { ES: ['Gunston', 'Halley', 'Laurel Hill', 'Lorton Station'] },
    source: 'https://www.fcps.edu/facilities-planning-future/school-boundary-adjustments',
  },
  {
    id: 'brenmar',
    title: 'Bren Mar Park feeders',
    summary: 'Which middle and high school Bren Mar Park Elementary students continue to: a feeder-pattern question.',
    levels: ['MS', 'HS'],
    schools: { ES: ['Bren Mar Park'], MS: ['Holmes', 'Glasgow', 'Poe'], HS: ['Edison', 'Justice', 'Annandale'] },
    source: 'https://www.fcps.edu/about-fcps/maps/boundary-adjustments-information/bren-mar-park-feedback',
  },
  {
    id: 'glasgow',
    title: 'Glasgow MS · Greenway Downs · Jefferson Village · City Park Homes · Kingsley Commons',
    summary: 'Overcrowding at Glasgow MS and Timber Lane ES; Beech Tree and Belvedere middle-school assignment; Kingsley Commons (Graham Road → Timber Lane?); keeping Timber Lane in one pyramid.',
    levels: ['ES', 'MS'],
    schools: {
      ES: ['Beech Tree', 'Belvedere', 'Graham Road', 'Parklawn', 'Pine Spring', 'Timber Lane'],
      MS: ['Glasgow', 'Holmes'],
      HS: ['Falls Church', 'Justice'],
    },
    source: 'https://www.fcps.edu/about-fcps/maps/boundary-adjustments-information/greenway-downs-jefferson-village-city-park-homes-0',
  },
  {
    id: 'springfield',
    title: 'Keene Mill island · Rolling Valley feeders (SPA 8922)',
    summary: 'An attendance island of Keene Mill ES among Cardinal Forest and White Oaks; and the middle/high feeders of Rolling Valley ES planning area 8922.',
    levels: ['ES', 'MS', 'HS'],
    schools: {
      ES: ['Keene Mill', 'Cardinal Forest', 'White Oaks', 'Rolling Valley'],
      MS: ['Key', 'Irving', 'Lake Braddock'],
      HS: ['Lewis', 'West Springfield', 'Lake Braddock'],
    },
    spas: [8922],
    source: 'https://www.fcps.edu/facilities-planning-future/school-boundary-adjustments',
  },
]

export interface Focus {
  id: string
  title: string
  schools: Set<number>
  levels: Level[]
  spas: number[] // SPA indices called out explicitly
}

export function focusFor(m: Model, h: HotSpot): Focus {
  const schools = new Set<number>()
  for (const [L, names] of Object.entries(h.schools) as [Level, string[]][]) {
    for (const n of names) {
      const k = m.schools.findIndex((s) => s.name === n && s.level === L)
      if (k >= 0) schools.add(k)
    }
  }
  const pos = new Map(m.raw.spa.id.map((id, i) => [id, i]))
  return { id: h.id, title: h.title, schools, levels: h.levels, spas: (h.spas ?? []).map((id) => pos.get(id)!).filter((i) => i !== undefined) }
}

