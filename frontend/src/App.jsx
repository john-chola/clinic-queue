import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import JoinPage from './pages/JoinPage'
import TicketPage from './pages/TicketPage'
import StaffLoginPage from './pages/StaffLoginPage'
import StaffPage from './pages/StaffPage'
import DisplayPage from './pages/DisplayPage'

// Admin only, and the chart library is large: load it only when someone opens the report
const ReportPage = lazy(() => import('./pages/ReportPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/t/:publicId" element={<TicketPage />} />
        <Route path="/display" element={<DisplayPage />} />
        <Route path="/staff/login" element={<StaffLoginPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/staff/report" element={<Suspense fallback={<p className="page muted">Loading…</p>}><ReportPage /></Suspense>} />
        <Route path="/staff/admin" element={<Suspense fallback={<p className="page muted">Loading…</p>}><AdminPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
