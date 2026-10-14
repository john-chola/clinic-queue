import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { useQueueEvents } from '../lib/live'
import { chime, enableSound, speakCall } from '../lib/announce'

// Full-screen board for a TV or old laptop in the waiting room
export default function DisplayPage() {
  const [queues, setQueues] = useState([])
  const [flash, setFlash] = useState(null)
  const [sound, setSound] = useState(false)
  const [qr, setQr] = useState('')
  const [clock, setClock] = useState(() => new Date())
  const [offline, setOffline] = useState(false)

  const load = useCallback(() => {
    api('/services').then((d) => { setQueues(d.services); setOffline(false) }).catch(() => setOffline(true))
  }, [])
  useEffect(() => { load() }, [load])

  useQueueEvents('display', (e) => {
    load()
    if (e.called) {
      setFlash(e.called)
      if (sound) { chime(); setTimeout(() => speakCall(e.called.code, e.called.room), 900) }
    }
  }, { pollMs: 20000 })

  useEffect(() => {
    if (!flash) return undefined
    const t = setTimeout(() => setFlash(null), 8000)
    return () => clearTimeout(t)
  }, [flash])

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 15000)
    QRCode.toDataURL(`${window.location.origin}/`, { margin: 1, width: 220 }).then(setQr).catch(() => {})
    return () => clearInterval(t)
  }, [])

  return (
    <main className="display">
      <header className="display__head">
        <span className="brand brand--light"><span className="brand__dot" /> Clinic Queue</span>
        <span className="display__clock">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        {!sound && <button className="btn btn--small" onClick={() => setSound(enableSound())}>🔊 Tap to turn on sound</button>}
      </header>

      {offline && <p className="display__offline">Reconnecting…</p>}

      {flash && (
        <div className="display__flash" role="alert">
          <span className="display__flash-code">{flash.code}</span>
          <span className="display__flash-room">→ {flash.room}</span>
        </div>
      )}

      <div className="display__grid">
        {queues.map((q) => (
          <section key={q.service._id} className="board">
            <h2 className="board__title">{q.service.name}</h2>
            <p className="board__label">Now serving</p>
            {q.nowServing.length === 0 && <p className="board__empty">—</p>}
            {q.nowServing.map((t) => (
              <p key={t.code} className="board__now"><strong>{t.code}</strong><span>{t.room}</span></p>
            ))}
            <p className="board__label">Next</p>
            <p className="board__next">{q.waiting.map((t) => t.code).join('   ') || '—'}</p>
            <p className="board__foot">{q.waitingCount} waiting · about {q.newPatientWait} min</p>
          </section>
        ))}
      </div>

      {qr && (
        <aside className="display__qr">
          <img src={qr} alt="QR code to join the queue" />
          <span>Scan to take a number<br />and wait outside</span>
        </aside>
      )}
    </main>
  )
}
