import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { saveStaff } from '../lib/staffAuth'

export default function StaffLoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const d = await api('/auth/login', { method: 'POST', body: { phone, password } })
      saveStaff(d.token, d.staff)
      navigate('/staff')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <main className="page narrow">
      <header className="brand"><span className="brand__dot" /> Clinic Queue · Staff</header>
      <form className="card" onSubmit={submit}>
        <h1 className="h2">Staff login</h1>
        {error && <p className="alert alert--error">{error}</p>}
        <label className="field"><span>Phone number</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required autoComplete="username" />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        <button className="btn btn--primary btn--big" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </main>
  )
}
