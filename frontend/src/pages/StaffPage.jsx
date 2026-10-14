import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useQueueEvents } from '../lib/live'
import { clearStaff, getStaff } from '../lib/staffAuth'

const PRIORITY_REASONS = ['Pregnant', 'Elderly', 'Child under 5', 'Emergency', 'Disability', 'Other']
const prefKey = 'cq_staff_desk'

const readDesk = () => {
  try { return JSON.parse(localStorage.getItem(prefKey)) || {} } catch { return {} }
}
const minutesSince = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 60000))

export default function StaffPage() {
  const navigate = useNavigate()
  const staff = getStaff()
  const [services, setServices] = useState([])
  const [desk, setDesk] = useState(readDesk)          // { serviceId, room }
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const canAdd = staff && ['admin', 'receptionist'].includes(staff.role)

  useEffect(() => {
    api('/services').then((d) => setServices(d.services.map((q) => q.service))).catch((e) => setError(e.message))
  }, [])

  const serviceId = desk.serviceId && services.some((s) => s._id === desk.serviceId) ? desk.serviceId : services[0]?._id
  const service = services.find((s) => s._id === serviceId)
  const room = service?.rooms.includes(desk.room) ? desk.room : service?.rooms[0]

  const load = useCallback(() => {
    if (!serviceId) return
    api(`/services/${serviceId}/queue`, { auth: true })
      .then((d) => setQueue(d.queue))
      .catch((e) => (getStaff() ? setError(e.message) : navigate('/staff/login')))
  }, [serviceId, navigate])
  useEffect(() => { load() }, [load])
  useQueueEvents(serviceId, load, { pollMs: 15000 })

  if (!staff) return <Navigate to="/staff/login" replace />

  const chooseDesk = (next) => {
    const d = { ...desk, ...next }
    setDesk(d)
    try { localStorage.setItem(prefKey, JSON.stringify(d)) } catch { /* private mode */ }
  }

  const run = async (fn, okMessage) => {
    setBusy(true)
    setError('')
    try {
      const msg = await fn()
      setNotice(msg || okMessage || '')
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const current = queue?.nowServing.find((t) => t.room === room)
  const next = () => run(async () => (await api(`/staff/services/${serviceId}/next`, { method: 'POST', auth: true, body: { room } })).message)
  const act = (ticket, action, label) => run(async () => {
    await api(`/staff/tickets/${ticket._id}/${action}`, { method: 'POST', auth: true })
    return `${ticket.code}: ${label}`
  })

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand"><span className="brand__dot" /> Clinic Queue</span>
        <span className="muted">{staff.name} · {staff.role}</span>
        <button className="btn btn--ghost btn--small" onClick={() => { clearStaff(); navigate('/staff/login') }}>Log out</button>
      </header>

      <section className="desk">
        <label className="field field--inline"><span>Service</span>
          <select value={serviceId || ''} onChange={(e) => chooseDesk({ serviceId: e.target.value })}>
            {services.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </label>
        <label className="field field--inline"><span>Room / counter</span>
          <select value={room || ''} onChange={(e) => chooseDesk({ room: e.target.value })}>
            {service?.rooms.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        {queue && <span className="desk__stats">{queue.waitingCount} waiting · ~{queue.avgMinutes} min per patient</span>}
      </section>

      {error && <p className="alert alert--error">{error}</p>}
      {notice && !error && <p className="alert alert--ok">{notice}</p>}

      <div className="staff-grid">
        <section className="card">
          <h2 className="h3">{room}</h2>
          {current ? (
            <div className="current">
              <p className="current__code">{current.code}</p>
              <p>{current.name || 'No name given'}{current.priority && <span className="badge badge--priority">Priority</span>}</p>
              <p className="muted">Called {current.calls}× · {minutesSince(current.calledAt)} min ago</p>
              <div className="btn-row">
                <button className="btn btn--primary btn--big" disabled={busy} onClick={next}>Done · Next patient</button>
                <button className="btn" disabled={busy} onClick={() => act(current, 'recall', 'called again')}>Call again</button>
                <button className="btn btn--danger" disabled={busy} onClick={() => act(current, 'no_show', 'marked as missed')}>Not here</button>
              </div>
            </div>
          ) : (
            <div className="current">
              <p className="muted">Nobody in {room} right now.</p>
              <button className="btn btn--primary btn--big" disabled={busy || !queue?.waitingCount} onClick={next}>
                {queue?.waitingCount ? 'Call next patient' : 'Nobody waiting'}
              </button>
            </div>
          )}
        </section>

        {canAdd && <WalkInForm serviceId={serviceId} serviceName={service?.name} onAdded={load} />}

        <section className="card">
          <h2 className="h3">Waiting ({queue?.waitingCount ?? 0})</h2>
          {queue?.waiting.length === 0 && <p className="muted">The queue is empty.</p>}
          <ol className="queue-list">
            {queue?.waiting.map((t) => (
              <li key={t._id}>
                <strong>{t.code}</strong>
                <span className="queue-list__name">{t.name || '—'}{t.priority && <span className="badge badge--priority" title={t.priorityReason}>{t.priorityReason || 'Priority'}</span>}</span>
                <span className="muted">{minutesSince(t.createdAt)} min</span>
                <button className="link" disabled={busy} onClick={() => window.confirm(`Cancel ${t.code}?`) && act(t, 'cancel', 'cancelled')}>Cancel</button>
              </li>
            ))}
          </ol>
          {queue?.missed?.length > 0 && (
            <>
              <h3 className="h4">Missed their call</h3>
              <ul className="queue-list">
                {queue.missed.map((t) => (
                  <li key={t._id}>
                    <strong>{t.code}</strong><span className="queue-list__name">{t.name || '—'}</span>
                    <button className="link link--ok" disabled={busy} onClick={() => act(t, 'return', 'back at the front of the queue')}>Return</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function WalkInForm({ serviceId, serviceName, onAdded }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [priority, setPriority] = useState(false)
  const [reason, setReason] = useState(PRIORITY_REASONS[0])
  const [issued, setIssued] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const d = await api(`/staff/services/${serviceId}/tickets`, {
        method: 'POST', auth: true, body: { name, phone, priority, priorityReason: priority ? reason : '' },
      })
      setIssued({ code: d.ticket.code, existing: d.existing })
      setName(''); setPhone(''); setPriority(false)
      onAdded()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h2 className="h3">Add a walk-in patient</h2>
      {issued && (
        <div className="issued">
          <span className="muted">{issued.existing ? 'Already in the queue:' : `Write on the patient's card (${serviceName}):`}</span>
          <strong className="issued__code">{issued.code}</strong>
        </div>
      )}
      {error && <p className="alert alert--error">{error}</p>}
      <form onSubmit={submit}>
        <label className="field"><span>Name (optional)</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
        <label className="field"><span>Phone (optional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
        <label className="check"><input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> Priority patient</label>
        {priority && (
          <label className="field"><span>Reason</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>{PRIORITY_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
        )}
        <button className="btn btn--primary" disabled={busy || !serviceId}>{busy ? 'Adding…' : 'Give a number'}</button>
      </form>
    </section>
  )
}
