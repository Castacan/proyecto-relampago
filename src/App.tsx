import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/staff/LoginPage'
import StaffLayout from './pages/staff/StaffLayout'
import WallPage from './pages/staff/WallPage'
import QrInventoryPage from './pages/staff/QrInventoryPage'
import AdminPage from './pages/staff/AdminPage'
import StatsPage from './pages/staff/StatsPage'
import InsightsPage from './pages/staff/InsightsPage'
import CalibrationPage from './pages/staff/CalibrationPage'
import VolumeCatalogPage from './pages/staff/VolumeCatalogPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import PublicWallPage from './pages/public/PublicWallPage'
import PublicRoutePage from './pages/public/PublicRoutePage'
import LeaderboardDisplay from './pages/public/LeaderboardDisplay'
import LeaderboardPage from './pages/public/LeaderboardPage'
import HubPage from './pages/public/HubPage'
import MyAccountPage from './pages/public/MyAccountPage'
import SpraywallListPage from './pages/public/SpraywallListPage'
import SpraywallRoutePage from './pages/public/SpraywallRoutePage'
import SpraywallProposePage from './pages/public/SpraywallProposePage'
import SpraywallPage from './pages/staff/SpraywallPage'
import NotFoundPage from './pages/public/NotFoundPage'
import { useAuth } from './lib/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center text-texto-principal bg-fondo">Cargando...</div>
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
        <Route path="/leaderboard/display" element={<LeaderboardDisplay />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/mi-cuenta" element={<MyAccountPage />} />
        <Route path="/spraywall" element={<SpraywallListPage />} />
        <Route path="/spraywall/proponer" element={<SpraywallProposePage />} />
        <Route path="/spraywall/:routeId" element={<SpraywallRoutePage />} />
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
          <Route path="stats" element={<StatsPage />} />
          <Route path="insights" element={<ErrorBoundary label="Insights"><InsightsPage /></ErrorBoundary>} />
          <Route path="calibration" element={<ErrorBoundary label="Calibración"><CalibrationPage /></ErrorBoundary>} />
          <Route path="admin" element={<ErrorBoundary label="Admin"><AdminPage /></ErrorBoundary>} />
          <Route path="volume-catalog" element={<ErrorBoundary label="Catálogo de Volúmenes"><VolumeCatalogPage /></ErrorBoundary>} />
          <Route path="spraywall" element={<ErrorBoundary label="Spraywall"><SpraywallPage /></ErrorBoundary>} />
        </Route>
        <Route path="/" element={<HubPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
