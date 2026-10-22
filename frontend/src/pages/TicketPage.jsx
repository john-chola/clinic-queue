import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useQueueEvents } from '../lib/live'
import { forgetTicket, rememberTicket } from '../lib/myTickets'

// The patient's own ticket: place in line, estimate, and an alert when called
export default function TicketPage() {
  const { publicId } = useParams()
  const navigate = useNavigate()
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')
  const lastStatus = useRef(null)

  const load = useCallback(() => {
    api(`/tickets/${publicId}`).then((d) => { setTicket(d.ticket); setError('') }).catch((e) => setError(e.message))
  }, [publicId])
  useEffect(() => { load() }, [load])
  useQueueEvents(ticket?.service._id, load, { pollMs: 20000 })

  // Buzz and change the tab title when the patient is called
  useEffect(() => {
    if (!ticket) return
    if (ticket.status === 'called' && lastStatus.current && lastStatus.current !== 'called') {
      navigator.vibrate?.([400, 200, 400, 200, 400])
    }
    lastStatus.current = ticket.status
    document.title = ticket.status === 'called' ? `🔔 Your turn: ${ticket.room}` : `${ticket.code} · Clinic Queue`
  }, [ticket])

  // Sent on to another service: follow the link to the new ticket, and remember that one instead
  const next = ticket?.next
  useEffect(() => {
    if (!next) return
    forgetTicket(publicId)
    rememberTicket(next.publicId, next.code, next.service)
    navigate(`/t/${next.publicId}`, { replace: true })
  }, [next, publicId, navigate])

  const cancel = async () => {
    if (!window.confirm('Leave the queue? You will lose your place.')) return
    try {
      await api(`/tickets/${publicId}/cancel`, { method: 'POST' })
      forgetTicket(publicId)
      load()
    } catch (e) { setError(e.message) }
  }

  if (error && !ticket) return <main className="page narrow"><p className="alert alert--error">{error}</p><Link to="/">Back</Link></main>
  if (!ticket) return <main className="page narrow"><p className="muted">Loading your ticket…</p></main>

  const s = ticket.status
  return (
    <main className={`page narrow ticket ticket--${s}`}>
      <p className="ticket__service">{ticket.service.name}</p>
      <p className="ticket__code" aria-label={`Ticket ${ticket.code}`}>{ticket.code}</p>
      {ticket.name && <p className="muted center">{ticket.name}</p>}
      {ticket.from && <p className="hint center">Sent on from {ticket.from.service} ({ticket.from.code}). You kept your place from when you arrived.</p>}

      {next && (
        <section className="card card--accent center">
          <p className="h3">Please go to {next.service}</p>
          <p>Your new number is <strong>{next.code}</strong></p>
          <Link className="btn btn--primary" to={`/t/${next.publicId}`} replace>Open my {next.service} ticket</Link>
        </section>
      )}

      {s === 'waiting' && (
        <section className="card center">
          <p className="ticket__position">
            {ticket.ahead === 0 ? 'You are next' : <>You are <strong>number {ticket.position}</strong> in line</>}
          </p>
          <p className="ticket__wait">Wait: <strong>{ticket.estimateText}</strong></p>
          <p className="muted">
            {ticket.nowServing.length
              ? <>Now serving: {ticket.nowServing.map((t) => `${t.code} (${t.room})`).join(', ')}</>
              : 'Nobody has been called yet.'}
          </p>
          {ticket.priority && <p className="badge badge--priority">Priority</p>}
          <p className="hint">Keep this page open. Your phone will buzz when it is your turn.</p>
        </section>
      )}

      {s === 'called' && (
        <section className="card card--call center" role="alert">
          <p className="ticket__callout">It's your turn</p>
          <p className="ticket__room">Please go to <strong>{ticket.room}</strong></p>
        </section>
      )}

      {s === 'done' && !next && <section className="card center"><p className="h3">Thank you. You have been seen.</p></section>}
      {s === 'no_show' && (
        <section className="card center">
          <p className="h3">You missed your call</p>
          <p>Please go to reception: they can put you back at the front.</p>
        </section>
      )}
      {s === 'cancelled' && <section className="card center"><p className="h3">This ticket was cancelled.</p></section>}

      {error && <p className="alert alert--error">{error}</p>}
      {(s === 'waiting' || s === 'called') && <button className="btn btn--ghost" onClick={cancel}>Leave the queue</button>}
      <footer className="footer"><Link to="/">Back to queues</Link></footer>
    </main>
  )
}
