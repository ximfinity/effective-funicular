export type Level = 'ES' | 'MS' | 'HS'
export const LEVELS: Level[] = ['ES', 'MS', 'HS']
export const GRADE_LABELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
export const NG = 13

export interface School {
  id: number
  name: string
  level: Level
  grades: string
  gmin: number | null
  gmax: number | null
  upper: boolean
  magnet: boolean
  region: number | null
  lon: number
  lat: number
  address: string
  url: string
  capacity: number | null
  design: string | null
  membership: number | null
  temp: number
  modular: number
  proj: number[] | null
  bell: number | null
  title1: boolean
  frl: number | null
  ccdTotal: number | null
  site: number // SPA index containing the school building, -1 if none
}

export interface RawModel {
  generated: string
  schools: School[]
  spa: {
    id: number[]
    centroid: [number, number][]
    area: number[]
    units: number[][]
    n: number[][]
    proj: number[][][] // [year][spa][grade]
    frl: number[][] // [spa][band]
    race: number[][][] // [spa][band][raceKey]
    raceKeys: string[]
    adj: [number, number][][]
    a26: Record<'ES' | 'MS' | 'HS' | 'ESAAP' | 'MSAAP', number[]>
    a25: Record<Level, number[]>
    region: number[]
  }
  upperOf: Record<string, number>
  tj: number
  params: { aap_es: number; aap_ms: number; tj_share: number; frl_beta: number }
}

export interface WalkData {
  variants: string[]
  nbins: number
  pairIndex: Map<number, number> // key spa*1024+school -> pair index
  data: Uint16Array // [variant][pair][bin]
  npairs: number
  scale: number
}

export interface DriveData {
  spaSchool: Map<number, number>[] // per spa: school -> seconds
  spaSpa: Map<number, number>[] // per spa: spa -> seconds
}

export interface Model {
  raw: RawModel
  schools: School[]
  S: number // number of SPAs
  walk: WalkData
  drive: DriveData
  upperOf: Int32Array // per school index: upper partner index or -1
  bySchoolId: Map<number, number>
}

/** A scenario = assignment of every SPA to a general-education school at each level. */
export interface Assignment {
  ES: Int32Array
  MS: Int32Array
  HS: Int32Array
}

export type BarrierTier = 0 | 1 | 2 | 3

export interface Params {
  year: number // 0 = SY2025-26 estimate base, 1..5 = SY26-27..SY30-31
  walkMiles: Record<Level, number>
  barrierTier: BarrierTier
  signalsCross: boolean
  straightLine: boolean
  ridership: number // share of bus-eligible students who ride
  busCapacity: Record<Level, number>
  maxRideMin: Record<Level, number>
  stopDwellSec: number
  aapEs: number
  aapMs: number
  tjShare: number
  utilLow: number
  utilHigh: number
  countTemp: boolean // count temporary classrooms (trailers) as capacity
  seatsPerTemp: number
  spareRatio: number
}

export const DEFAULT_PARAMS: Params = {
  year: 1,
  walkMiles: { ES: 1.0, MS: 1.5, HS: 1.5 },
  barrierTier: 2,
  signalsCross: true,
  straightLine: false,
  ridership: 0.8,
  busCapacity: { ES: 66, MS: 48, HS: 48 },
  maxRideMin: { ES: 45, MS: 50, HS: 55 },
  stopDwellSec: 30,
  aapEs: 0.12,
  aapMs: 0.15,
  tjShare: 0.03,
  utilLow: 0.85,
  utilHigh: 1.05,
  countTemp: false,
  seatsPerTemp: 25,
  spareRatio: 0.1,
}

export function variantName(p: Params): string {
  if (p.straightLine) return 'crow'
  if (p.barrierTier === 0) return 'T0'
  return `T${p.barrierTier}${p.signalsCross ? 's' : 'n'}`
}
