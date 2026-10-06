import { loadModel } from './load'
import { Optimizer, type OptRequest } from './optimizer'
import type { Model } from './types'

let model: Model | null = null
let runId = 0

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data
  if (msg.type === 'stop') {
    runId++
    return
  }
  if (msg.type !== 'run') return
  const id = ++runId
  try {
    model ??= await loadModel(undefined, msg.dataUrl)
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ type: 'error', error: String(e) })
    return
  }
  const req = msg.req as OptRequest
  const opt = new Optimizer(model, req)
  // costs are in student-equivalents: a ~4-student uphill move is accepted ~1/3 of the time at the start (tuned in scripts/tune.ts)
  const c0 = opt.cost
  const T0 = 4
  const T1 = 0.05
  const N = req.iterations
  let accepted = 0
  let lastPost = performance.now()
  const post = (iter: number, done: boolean) => {
    ;(self as unknown as Worker).postMessage({
      type: done ? 'done' : 'progress',
      progress: { iter, cost: opt.cost, best: opt.best, start: c0, accepted, assignment: opt.bestA, breakdown: opt.breakdown() },
    })
  }
  let iter = 0
  const chunk = () => {
    if (id !== runId) return post(iter, true)
    const end = Math.min(N, iter + 4000)
    for (; iter < end; iter++) {
      const T = T0 * Math.pow(T1 / T0, iter / N)
      if (opt.step(T)) accepted++
    }
    const now = performance.now()
    if (iter >= N) return post(iter, true)
    if (now - lastPost > 400) {
      lastPost = now
      post(iter, false)
    }
    setTimeout(chunk, 0)
  }
  chunk()
}
