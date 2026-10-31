import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/staff/LoginPage'
import StaffLayout from './pages/staff/StaffLayout'
import WallPage from './pages/staff/WallPage'
import QrInventoryPage from './pages/staff/QrInventoryPage'
import AdminPage from './pages/staff/AdminPage'
import StatsPage from './pages/staff/StatsPage'
import InsightsPage from './pages/staff/InsightsPage'
import SendsPage from './pages/staff/SendsPage'
import CalibrationPage from './pages/staff/CalibrationPage'
import VolumeCatalogPage from './pages/staff/VolumeCatalogPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import PublicWallPage from './pages/public/PublicWallPage'
import PublicRoutePage from './pages/public/PublicRoutePage'
import LeaderboardDisplay from './pages/public/LeaderboardDisplay'
import LeaderboardPage from './pages/public/LeaderboardPage'
import HubPage from './pages/public/HubPage'
import MyAccountPage from './pages/public/MyAccountPage'
import SendsHistoryPage from './pages/public/SendsHistoryPage'
import SpraywallListPage from './pages/public/SpraywallListPage'
import SpraywallRoutePage from './pages/public/SpraywallRoutePage'
import SpraywallProposePage from './pages/public/SpraywallProposePage'
import SpraywallPage from './pages/staff/SpraywallPage'
import DisplayAdminPage from './pages/staff/DisplayAdminPage'
import CompetitionPage from './pages/public/CompetitionPage'
import CompetitionLookupPage from './pages/public/CompetitionLookupPage'
import CompetitionAdminPage from './pages/staff/CompetitionAdminPage'
import CompetitionScoringPage from './pages/staff/CompetitionScoringPage'
import JudgePage from './pages/public/JudgePage'
import ClassesPage from './pages/public/ClassesPage'
import ClassesAdminPage from './pages/staff/ClassesAdminPage'
import HomePage from './pages/staff/erp/HomePage'
import PeoplePage from './pages/staff/erp/PeoplePage'
import PersonProfilePage from './pages/staff/erp/PersonProfilePage'
import PosPage from './pages/staff/erp/PosPage'
import CashPage from './pages/staff/erp/CashPage'
import { SalesHistoryPage, ReportPage } from './pages/staff/erp/SalesPage'
import SubscriptionsPage from './pages/staff/erp/SubscriptionsPage'
import ExpensesPage from './pages/staff/erp/ExpensesPage'
import InventoryPage from './pages/staff/erp/InventoryPage'
import AccessPage from './pages/staff/erp/AccessPage'
import AuditPage from './pages/staff/erp/AuditPage'
import EmployeesPage from './pages/staff/erp/EmployeesPage'
import StatementsPage from './pages/staff/erp/StatementsPage'
import ChecklistPage from './pages/staff/erp/ChecklistPage'
import MyAttendancePage from './pages/staff/erp/MyAttendancePage'
import AttendanceAdminPage from './pages/staff/erp/AttendanceAdminPage'
import ChecklistAdminPage from './pages/staff/erp/ChecklistAdminPage'
import ChecklistTemplatePage from './pages/staff/erp/ChecklistTemplatePage'
import SignaturePage from './pages/staff/erp/SignaturePage'
import { EmailsConfigPage, LegalDocsConfigPage } from './pages/staff/erp/CrmConfigPages'
import MyDocumentsPage from './pages/public/MyDocumentsPage'
import RegistroPage from './pages/public/RegistroPage'
import { ProductsConfigPage, IntegrationsPage, GeneralSettingsPage } from './pages/staff/erp/ConfigPages'
import SubscriptionSetupPage from './pages/public/SubscriptionSetupPage'
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
        <Route path="/mi-cuenta/historial" element={<SendsHistoryPage />} />
        <Route path="/spraywall" element={<SpraywallListPage />} />
        <Route path="/spraywall/proponer" element={<SpraywallProposePage />} />
        <Route path="/spraywall/:routeId" element={<SpraywallRoutePage />} />
        <Route path="/competencia" element={<CompetitionPage />} />
        <Route path="/competencia/consulta" element={<CompetitionLookupPage />} />
        <Route path="/juez" element={<JudgePage />} />
        <Route path="/clases" element={<ClassesPage />} />
        <Route path="/domiciliacion/:token" element={<SubscriptionSetupPage />} />
        <Route path="/firmar" element={<MyDocumentsPage />} />
        <Route path="/registro" element={<RegistroPage />} />
        <Route path="/staff/firma/:id" element={<ProtectedRoute><SignaturePage /></ProtectedRoute>} />
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
          <Route path="sends" element={<ErrorBoundary label="Envíos"><SendsPage /></ErrorBoundary>} />
          <Route path="calibration" element={<ErrorBoundary label="Calibración"><CalibrationPage /></ErrorBoundary>} />
          <Route path="admin" element={<ErrorBoundary label="Admin"><AdminPage /></ErrorBoundary>} />
          <Route path="volume-catalog" element={<ErrorBoundary label="Catálogo de Volúmenes"><VolumeCatalogPage /></ErrorBoundary>} />
          <Route path="spraywall" element={<ErrorBoundary label="Spraywall"><SpraywallPage /></ErrorBoundary>} />
          <Route path="display" element={<ErrorBoundary label="Display"><DisplayAdminPage /></ErrorBoundary>} />
          <Route path="competencia" element={<ErrorBoundary label="Competencia"><CompetitionAdminPage /></ErrorBoundary>} />
          <Route path="competencia/puntos" element={<ErrorBoundary label="Puntos"><CompetitionScoringPage /></ErrorBoundary>} />
          <Route path="clases" element={<ErrorBoundary label="Clases"><ClassesAdminPage /></ErrorBoundary>} />
          <Route path="inicio" element={<ErrorBoundary label="Inicio"><HomePage /></ErrorBoundary>} />
          <Route path="personas" element={<ErrorBoundary label="Personas"><PeoplePage /></ErrorBoundary>} />
          <Route path="personas/:id" element={<ErrorBoundary label="Ficha"><PersonProfilePage /></ErrorBoundary>} />
          <Route path="vender" element={<ErrorBoundary label="Vender"><PosPage /></ErrorBoundary>} />
          <Route path="caja" element={<ErrorBoundary label="Caja"><CashPage /></ErrorBoundary>} />
          <Route path="ventas" element={<ErrorBoundary label="Ventas"><SalesHistoryPage /></ErrorBoundary>} />
          <Route path="reportes" element={<ErrorBoundary label="Reportes"><ReportPage /></ErrorBoundary>} />
          <Route path="egresos" element={<ErrorBoundary label="Egresos"><ExpensesPage /></ErrorBoundary>} />
          <Route path="inventario" element={<ErrorBoundary label="Inventario"><InventoryPage /></ErrorBoundary>} />
          <Route path="acceso" element={<ErrorBoundary label="Acceso"><AccessPage /></ErrorBoundary>} />
          <Route path="bitacora" element={<ErrorBoundary label="Bitácora"><AuditPage /></ErrorBoundary>} />
          <Route path="empleados" element={<ErrorBoundary label="Empleados"><EmployeesPage /></ErrorBoundary>} />
          <Route path="estados" element={<ErrorBoundary label="Estados financieros"><StatementsPage /></ErrorBoundary>} />
          <Route path="turno" element={<ErrorBoundary label="Turno"><ChecklistPage /></ErrorBoundary>} />
          <Route path="turno/:date" element={<ErrorBoundary label="Turno"><ChecklistPage /></ErrorBoundary>} />
          <Route path="turnos" element={<ErrorBoundary label="Turnos"><ChecklistAdminPage /></ErrorBoundary>} />
          <Route path="asistencia" element={<ErrorBoundary label="Mi asistencia"><MyAttendancePage /></ErrorBoundary>} />
          <Route path="asistencia/reporte" element={<ErrorBoundary label="Asistencia"><AttendanceAdminPage /></ErrorBoundary>} />
          <Route path="config/checklist" element={<ErrorBoundary label="Plantilla del checklist"><ChecklistTemplatePage /></ErrorBoundary>} />
          <Route path="config/correos" element={<ErrorBoundary label="Correos"><EmailsConfigPage /></ErrorBoundary>} />
          <Route path="config/documentos" element={<ErrorBoundary label="Documentos"><LegalDocsConfigPage /></ErrorBoundary>} />
          <Route path="domiciliaciones" element={<ErrorBoundary label="Domiciliaciones"><SubscriptionsPage /></ErrorBoundary>} />
          <Route path="config/productos" element={<ErrorBoundary label="Productos"><ProductsConfigPage /></ErrorBoundary>} />
          <Route path="config/integraciones" element={<ErrorBoundary label="Integraciones"><IntegrationsPage /></ErrorBoundary>} />
          <Route path="config/general" element={<ErrorBoundary label="Ajustes"><GeneralSettingsPage /></ErrorBoundary>} />
        </Route>
        <Route path="/" element={<HubPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
