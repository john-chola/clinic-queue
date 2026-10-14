import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useQueueEvents } from '../lib/live'
import { myTickets, rememberTicket } from '../lib/myTickets'

// Where a patient lands after scanning the QR code at the entrance
export default function JoinPage() {
  const navigate = useNavigate()
  const [services, setServices] = useState(null)
  const [chosen, setChosen] = useState(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mine = myTickets()

  const load = useCallback(() => {
    api('/services').then((d) => setServices(d.services)).catch((e) => setError(e.message))
  }, [])
  useEffect(() => { load() }, [load])
  useQueueEvents('display', load)

  const join = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const d = await api(`/services/${chosen.service._id}/tickets`, { method: 'POST', body: { name, phone } })
      rememberTicket(d.ticket.publicId, d.ticket.code, chosen.service.name)
      navigate(`/t/${d.ticket.publicId}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <main className="page narrow">
      <header className="brand">
        <span className="brand__dot" /> Clinic Queue
      </header>

      {mine.length > 0 && (
        <section className="card card--accent">
          <h2 className="h3">Your tickets today</h2>
          {mine.map((t) => (
            <Link key={t.publicId} className="ticket-link" to={`/t/${t.publicId}`}>
              <strong>{t.code}</strong> <span>{t.serviceName}</span> <span className="muted">View →</span>
            </Link>
          ))}
        </section>
      )}

      <h1 className="h2">Join a queue</h1>
      <p className="muted">Take a number from your phone. You can wait outside and watch your place in the line.</p>
      {error && <p className="alert alert--error">{error}</p>}
      {!services && !error && <p className="muted">Loading…</p>}

      <div className="service-list">
        {services?.map((q) => (
          <button
            key={q.service._id}
            type="button"
            className={`service-card${chosen?.service._id === q.service._id ? ' service-card--chosen' : ''}`}
            disabled={!q.service.isOpen}
            onClick={() => setChosen(q)}
          >
            <span className="service-card__name">{q.service.name}</span>
            <span className="service-card__meta">
              {q.service.isOpen
                ? <>{q.waitingCount} waiting · about {q.newPatientWait} min</>
                : 'Closed'}
            </span>
          </button>
        ))}
      </div>

      {chosen && (
        <form className="card" onSubmit={join}>
          <h2 className="h3">Join {chosen.service.name}</h2>
          <label className="field">
            <span>Your name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
          </label>
          <label className="field">
            <span>Phone number (optional)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="e.g. 0977 123 456" />
          </label>
          <p className="hint">With a phone number, a second tap gives you the same ticket, not a new one.</p>
          <button className="btn btn--primary btn--big" disabled={busy}>{busy ? 'Taking a number…' : 'Get my number'}</button>
        </form>
      )}

      <footer className="footer"><Link to="/display">Waiting-room screen</Link> · <Link to="/staff">Staff</Link></footer>
    </main>
  )
}
