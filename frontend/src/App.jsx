import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import JoinPage from './pages/JoinPage'
import TicketPage from './pages/TicketPage'
import StaffLoginPage from './pages/StaffLoginPage'
import StaffPage from './pages/StaffPage'
import DisplayPage from './pages/DisplayPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/t/:publicId" element={<TicketPage />} />
        <Route path="/display" element={<DisplayPage />} />
        <Route path="/staff/login" element={<StaffLoginPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
