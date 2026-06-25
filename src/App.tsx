import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/staff/LoginPage'
import StaffLayout from './pages/staff/StaffLayout'
import WallPage from './pages/staff/WallPage'
import QrInventoryPage from './pages/staff/QrInventoryPage'
import PublicWallPage from './pages/public/PublicWallPage'
import PublicRoutePage from './pages/public/PublicRoutePage'
import { useAuth } from './lib/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center text-white bg-zinc-950">Cargando...</div>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/q/:qrId" element={<PublicRoutePage />} />
        <Route path="/muro" element={<PublicWallPage />} />
        <Route
          path="/staff"
          element={
            <ProtectedRoute>
              <StaffLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<WallPage />} />
          <Route path="qr" element={<QrInventoryPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/muro" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
