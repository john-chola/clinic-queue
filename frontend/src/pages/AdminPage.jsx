import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { getStaff } from '../lib/staffAuth'

const ROLES = [
  { value: 'receptionist', label: 'Receptionist', hint: 'adds walk-in patients' },
  { value: 'clinician', label: 'Clinician', hint: 'calls patients to a room' },
  { value: 'admin', label: 'Admin', hint: 'everything, including this page' },
]
const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label || role

// Services, their rooms, and staff accounts. Admins only (the server checks too).
export default function AdminPage() {
  const navigate = useNavigate()
  const me = getStaff()
  const [services, setServices] = useState(null)
  const [staff, setStaff] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isAdmin = me?.role === 'admin'

  const load = useCallback(() => {
    Promise.all([api('/admin/services', { auth: true }), api('/admin/staff', { auth: true })])
      .then(([s, st]) => { setServices(s.services); setStaff(st.staff) })
      .catch((e) => (getStaff() ? setError(e.message) : navigate('/staff/login')))
  }, [navigate])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  if (!me) return <Navigate to="/staff/login" replace />
  if (!isAdmin) return <Navigate to="/staff" replace />

  // Every change goes through here: run it, show the server's message, reload the lists.
  // Returns the error message, or null when it worked. A form shows its own error
  // next to its fields (inForm); a one-click action shows it at the top.
  const save = async (fn, { inForm = false } = {}) => {
    setError('')
    setNotice('')
    try {
      const d = await fn()
      setNotice(d.message || 'Saved')
      load()
      return null
    } catch (e) {
      if (!inForm) setError(e.message)
      return e.message
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand"><span className="brand__dot" /> Clinic Queue</span>
        <span className="muted">{me.name} · {me.role}</span>
        <Link className="btn btn--ghost btn--small" to="/staff">Back to the queue</Link>
      </header>
      <h1 className="h2">Admin</h1>

      {/* Messages sit in a live region so screen readers hear the result of a save */}
      <div aria-live="polite">
        {error && <p className="alert alert--error">{error}</p>}
        {notice && !error && <p className="alert alert--ok">{notice}</p>}
      </div>

      {!services && !error && <p className="muted">Loading…</p>}
      {services && <ServicesSection services={services} save={save} />}
      {staff && <StaffSection staff={staff} me={me} save={save} />}
    </main>
  )
}

// ── Services ────────────────────────────────────────────────

function ServicesSection({ services, save }) {
  const [editing, setEditing] = useState(null)   // a service id, 'new', or null

  const toggleOpen = (s) => save(() => api(`/admin/services/${s._id}`, { method: 'PATCH', auth: true, body: { isOpen: !s.isOpen } }))

  return (
    <section className="card">
      <div className="admin__head">
        <h2 className="h3">Services and rooms</h2>
        {editing !== 'new' && <button className="btn btn--small" onClick={() => setEditing('new')}>Add a service</button>}
      </div>
      <p className="hint">Closing a queue stops new patients joining. Anyone already waiting is still served.</p>

      {editing === 'new' && <ServiceForm save={save} onDone={() => setEditing(null)} />}
      {services.length === 0 && editing !== 'new' && <p className="muted">No services yet. Add the first one.</p>}

      <ul className="admin-list">
        {services.map((s) => (
          <li key={s._id}>
            {editing === s._id ? (
              <ServiceForm service={s} save={save} onDone={() => setEditing(null)} />
            ) : (
              <div className="admin-row">
                <span className="admin-row__letter" aria-hidden="true">{s.prefix}</span>
                <div className="admin-row__main">
                  <strong>{s.name}</strong>
                  <span className="muted">{s.rooms.join(' · ')} · ~{s.defaultMinutes} min per patient</span>
                </div>
                <span className={`status ${s.isOpen ? 'status--open' : 'status--closed'}`}>{s.isOpen ? 'Open' : 'Closed'}</span>
                <div className="admin-row__actions">
                  <button className="btn btn--small" onClick={() => toggleOpen(s)}>{s.isOpen ? 'Close queue' : 'Open queue'}</button>
                  <button className="btn btn--small btn--ghost" onClick={() => setEditing(s._id)}>Edit</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ServiceForm({ service, save, onDone }) {
  const [name, setName] = useState(service?.name || '')
  const [prefix, setPrefix] = useState(service?.prefix || '')
  const [rooms, setRooms] = useState(service?.rooms || ['Room 1'])
  const [minutes, setMinutes] = useState(service?.defaultMinutes ?? 5)
  const [order, setOrder] = useState(service?.order ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const setRoom = (i, value) => setRooms(rooms.map((r, j) => (j === i ? value : r)))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const body = { name, prefix, rooms, defaultMinutes: Number(minutes), order: Number(order) }
    const err = await save(() => (service
      ? api(`/admin/services/${service._id}`, { method: 'PATCH', auth: true, body })
      : api('/admin/services', { method: 'POST', auth: true, body })), { inForm: true })
    setBusy(false)
    if (err) setError(err)
    else onDone()
  }

  const remove = async () => {
    if (!window.confirm(`Delete ${service.name}? This cannot be undone.`)) return
    setBusy(true)
    const err = await save(() => api(`/admin/services/${service._id}`, { method: 'DELETE', auth: true }), { inForm: true })
    setBusy(false)
    if (err) setError(err)
    else onDone()
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <h3 className="h4">{service ? `Edit ${service.name}` : 'New service'}</h3>
      <div className="admin-form__grid">
        <label className="field"><span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Dental" />
        </label>
        <label className="field"><span>Ticket letter</span>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(-1))} required
            pattern="[A-Za-z]" maxLength={1} placeholder="D" aria-describedby="letter-hint" />
          <small id="letter-hint" className="hint">Tickets read {prefix || 'D'}-001, {prefix || 'D'}-002…</small>
        </label>
        <label className="field"><span>Minutes per patient (until there is real data)</span>
          <input type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(e.target.value)} required />
        </label>
        <label className="field"><span>Position in lists</span>
          <input type="number" value={order} onChange={(e) => setOrder(e.target.value)} />
        </label>
      </div>

      <fieldset className="rooms">
        <legend>Rooms and counters</legend>
        {rooms.map((r, i) => (
          <div className="rooms__row" key={i}>
            <input value={r} onChange={(e) => setRoom(i, e.target.value)} maxLength={30} aria-label={`Room ${i + 1}`} />
            <button type="button" className="link" disabled={rooms.length === 1}
              onClick={() => setRooms(rooms.filter((_, j) => j !== i))} aria-label={`Remove ${r || 'this room'}`}>Remove</button>
          </div>
        ))}
        <button type="button" className="link link--ok" onClick={() => setRooms([...rooms, ''])}>+ Add a room</button>
      </fieldset>

      {error && <p className="alert alert--error" role="alert">{error}</p>}
      <div className="btn-row">
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : service ? 'Save' : 'Add service'}</button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
        {service && <button type="button" className="btn btn--danger" disabled={busy} onClick={remove}>Delete</button>}
      </div>
    </form>
  )
}

// ── Staff accounts ──────────────────────────────────────────

function StaffSection({ staff, me, save }) {
  const [editing, setEditing] = useState(null)   // a staff id, 'new', or null

  return (
    <section className="card">
      <div className="admin__head">
        <h2 className="h3">Staff accounts</h2>
        {editing !== 'new' && <button className="btn btn--small" onClick={() => setEditing('new')}>Add a staff member</button>}
      </div>
      <p className="hint">Staff log in with their phone number. Disabling an account logs that person out straight away.</p>

      {editing === 'new' && <StaffForm save={save} onDone={() => setEditing(null)} />}

      <ul className="admin-list">
        {staff.map((s) => (
          <li key={s._id}>
            {editing === s._id ? (
              <StaffForm member={s} isSelf={s._id === me._id} save={save} onDone={() => setEditing(null)} />
            ) : (
              <div className={`admin-row ${s.isActive ? '' : 'admin-row--off'}`}>
                <div className="admin-row__main">
                  <strong>{s.name}{s._id === me._id && <span className="muted"> (you)</span>}</strong>
                  <span className="muted">{s.phone}</span>
                </div>
                <span className="badge badge--role">{roleLabel(s.role)}</span>
                {!s.isActive && <span className="status status--closed">Disabled</span>}
                <div className="admin-row__actions">
                  <button className="btn btn--small btn--ghost" onClick={() => setEditing(s._id)}>Edit</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function StaffForm({ member, isSelf = false, save, onDone }) {
  const [name, setName] = useState(member?.name || '')
  const [phone, setPhone] = useState(member?.phone || '')
  const [role, setRole] = useState(member?.role || 'receptionist')
  const [isActive, setIsActive] = useState(member?.isActive ?? true)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const body = member ? { name, phone, role, isActive, password } : { name, phone, role, password }
    const err = await save(() => (member
      ? api(`/admin/staff/${member._id}`, { method: 'PATCH', auth: true, body })
      : api('/admin/staff', { method: 'POST', auth: true, body })), { inForm: true })
    setBusy(false)
    if (err) setError(err)
    else onDone()
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <h3 className="h4">{member ? `Edit ${member.name}` : 'New staff member'}</h3>
      <div className="admin-form__grid">
        <label className="field"><span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </label>
        <label className="field"><span>Phone (used to log in)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="0971234567" />
        </label>
        <label className="field"><span>Role</span>
          {/* You cannot demote yourself: the server refuses it too */}
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}: {r.hint}</option>)}
          </select>
        </label>
        <label className="field"><span>{member ? 'New password (leave empty to keep it)' : 'Password'}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required={!member} minLength={6} autoComplete="new-password" />
        </label>
      </div>
      {member && (
        <label className="check">
          <input type="checkbox" checked={isActive} disabled={isSelf} onChange={(e) => setIsActive(e.target.checked)} />
          Account active{isSelf && <span className="muted"> (you cannot disable yourself)</span>}
        </label>
      )}
      {error && <p className="alert alert--error" role="alert">{error}</p>}
      <div className="btn-row">
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : member ? 'Save' : 'Add staff member'}</button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
