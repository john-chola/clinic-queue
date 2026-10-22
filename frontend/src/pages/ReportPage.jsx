import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { getStaff } from '../lib/staffAuth'

// "2026-10-21" for today on the clinic's clock, the same day the server files tickets under
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`
const minutes = (m) => (m === null ? '—' : `${m} min`)

export default function ReportPage() {
  const navigate = useNavigate()
  const staff = getStaff()
  const [date, setDate] = useState(today)
  const [result, setResult] = useState({ date: null })   // { date, report } or { date, error }
  const [chartService, setChartService] = useState('all')

  const isAdmin = staff?.role === 'admin'

  useEffect(() => {
    if (!isAdmin || !date) return
    let stale = false
    api(`/staff/reports/daily?date=${date}`, { auth: true })
      .then((d) => !stale && setResult({ date, report: d.report }))
      .catch((e) => {
        if (stale) return
        if (!getStaff()) navigate('/staff/login')
        else setResult({ date, error: e.message })
      })
    return () => { stale = true }
  }, [date, isAdmin, navigate])

  // The last answer stays on screen while the next day loads
  const loading = Boolean(date) && result.date !== date
  const { report, error } = result

  if (!staff) return <Navigate to="/staff/login" replace />
  if (!isAdmin) return <Navigate to="/staff" replace />

  const totals = report?.totals
  const chosen = report?.services.find((s) => s.service._id === chartService)
  const hours = (chosen || totals)?.byHour ?? []

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand"><span className="brand__dot" /> Clinic Queue</span>
        <span className="muted">{staff.name} · {staff.role}</span>
        <Link className="btn btn--ghost btn--small" to="/staff">Back to the queue</Link>
      </header>

      <section className="desk">
        <h1 className="h2 report__title">Daily report</h1>
        <label className="field field--inline report__date"><span>Day</span>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
        {loading && <span className="desk__stats">Loading…</span>}
      </section>

      {error && <p className="alert alert--error">{error}</p>}

      {totals && (
        <>
          {totals.joined === 0 && <p className="alert alert--info">Nobody joined a queue on this day.</p>}

          <section className="stat-row" aria-label="The day at a glance">
            <Stat label="Patients joined" value={totals.joined} note={totals.priority ? `${totals.priority} priority` : null} />
            <Stat label="Served" value={totals.served} note={totals.cancelled ? `${totals.cancelled} cancelled` : null} />
            <Stat label="No-shows" value={totals.noShows} note={totals.called ? `${totals.noShowRate}% of those called` : null} />
            <Stat label="Average wait" value={minutes(totals.avgWaitMinutes)} note={totals.avgServiceMinutes === null ? null : `${totals.avgServiceMinutes} min with clinician`} />
          </section>

          <section className="card">
            <h2 className="h3">By service</h2>
            <div className="table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Service</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Served</th>
                    <th scope="col">No-shows</th>
                    <th scope="col">Cancelled</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Avg wait</th>
                    <th scope="col">Avg with clinician</th>
                  </tr>
                </thead>
                <tbody>
                  {report.services.map((s) => <ServiceRow key={s.service._id} name={s.service.name} row={s} />)}
                </tbody>
                {report.services.length > 1 && (
                  <tfoot><ServiceRow name="All services" row={totals} /></tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="card">
            <div className="report__chart-head">
              <h2 className="h3">Busiest hours</h2>
              <label className="field field--inline"><span>Service</span>
                <select value={chartService} onChange={(e) => setChartService(e.target.value)}>
                  <option value="all">All services</option>
                  {report.services.map((s) => <option key={s.service._id} value={s.service._id}>{s.service.name}</option>)}
                </select>
              </label>
            </div>
            <p className="hint">Patients joining the queue in each hour, Lusaka time.</p>
            <div className="report__chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hours} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="hour" tickFormatter={hourLabel} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--teal-light)' }}
                    labelFormatter={(h) => `${hourLabel(h)}–${hourLabel(h + 1)}`}
                    formatter={(v) => [v, 'Joined']}
                  />
                  <Bar dataKey="joined" name="Joined" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {note && <span className="stat__note">{note}</span>}
    </div>
  )
}

function ServiceRow({ name, row }) {
  return (
    <tr>
      <th scope="row">{name}</th>
      <td>{row.joined}</td>
      <td>{row.served}</td>
      <td>{row.noShows}{row.called > 0 && <span className="muted"> ({row.noShowRate}%)</span>}</td>
      <td>{row.cancelled}</td>
      <td>{row.priority}</td>
      <td>{minutes(row.avgWaitMinutes)}</td>
      <td>{minutes(row.avgServiceMinutes)}</td>
    </tr>
  )
}
