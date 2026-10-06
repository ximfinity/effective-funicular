import { useState } from 'react'
import { DISCLAIMER_SECTIONS, DISCLAIMER_VERSION, SHORT_DISCLAIMER } from '../lib/disclaimer'

const KEY = 'fcps-disclaimer-ack'

function acknowledged() {
  try {
    return localStorage.getItem(KEY) === DISCLAIMER_VERSION
  } catch {
    return false
  }
}

export function DisclaimerText() {
  return (
    <div className="disclaimer-text">
      {DISCLAIMER_SECTIONS.map((s) => (
        <section key={s.title}>
          <h4>{s.title}</h4>
          <p>{s.body}</p>
        </section>
      ))}
    </div>
  )
}

/** First-visit notice (must be acknowledged) plus a link to reopen it from anywhere. */
export function DisclaimerGate() {
  const [open, setOpen] = useState(() => !acknowledged())
  const accept = () => {
    try {
      localStorage.setItem(KEY, DISCLAIMER_VERSION)
    } catch {
      /* storage unavailable: show again next visit */
    }
    setOpen(false)
  }
  return (
    <>
      <button className="disclaimer-link" onClick={() => setOpen(true)} title={SHORT_DISCLAIMER}>
        Unofficial · Disclaimer
      </button>
      {open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="disc-title">
          <div className="modal">
            <h2 id="disc-title">Unofficial tool — please read</h2>
            <p className="lead">{SHORT_DISCLAIMER}</p>
            <DisclaimerText />
            <div className="btnrow">
              <button className="primary" onClick={accept}>I understand</button>
              <a href="https://www.fcps.edu/facilities-planning-future/school-boundary-adjustments" target="_blank" rel="noreferrer">
                Official FCPS boundary information
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
