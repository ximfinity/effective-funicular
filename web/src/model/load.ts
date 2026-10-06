import type { DriveData, Model, RawModel, WalkData } from './types'

// Absolute data URL. Workers must be handed this: a relative base would resolve against the worker's own folder.
export const DATA_URL =
  typeof document !== 'undefined' ? new URL(`${import.meta.env?.BASE_URL ?? './'}data/`, document.baseURI).href : ''
let BASE = DATA_URL

async function json<T>(name: string): Promise<T> {
  const r = await fetch(BASE + name)
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  return r.json() as Promise<T>
}

export const pairKey = (spa: number, school: number) => spa * 1024 + school

export async function loadModel(onProgress?: (msg: string) => void, base?: string): Promise<Model> {
  if (base) BASE = base
  onProgress?.('Loading schools and planning areas…')
  const [raw, walkMeta, walkBuf, drive] = await Promise.all([
    json<RawModel>('model.json'),
    json<{ variants: string[]; nbins: number; pairs: [number, number][]; scale: number }>('walk_meta.json'),
    fetch(BASE + 'walk.bin').then((r) => r.arrayBuffer()),
    json<{ spa_school: [number, number][][]; spa_spa: [number, number][][] }>('drive.json'),
  ])
  onProgress?.('Indexing walk and drive networks…')
  const pairIndex = new Map<number, number>()
  walkMeta.pairs.forEach(([s, k], j) => pairIndex.set(pairKey(s, k), j))
  const walk: WalkData = {
    variants: walkMeta.variants,
    nbins: walkMeta.nbins,
    pairIndex,
    data: new Uint16Array(walkBuf),
    npairs: walkMeta.pairs.length,
    scale: walkMeta.scale,
  }
  const dd: DriveData = {
    spaSchool: drive.spa_school.map((l) => new Map(l)),
    spaSpa: drive.spa_spa.map((l) => new Map(l)),
  }
  const upperOf = new Int32Array(raw.schools.length).fill(-1)
  for (const [k, v] of Object.entries(raw.upperOf)) upperOf[Number(k)] = v
  const bySchoolId = new Map(raw.schools.map((s, i) => [s.id, i]))
  return { raw, schools: raw.schools, S: raw.spa.id.length, walk, drive: dd, upperOf, bySchoolId }
}
