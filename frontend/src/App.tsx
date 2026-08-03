import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import './index.css';
import { canAccessView, getHomeViewForUser } from './utils/rbac';
import type { AppView, SessionUser } from './utils/rbac';
import { ThemeProvider } from './contexts/ThemeContext';
import { useVisualViewportBottomInset } from './hooks/useVisualViewportBottomInset';
import { readStoredUser, safeGetStorageItem } from './utils/session-user';
import { appPath } from './navigation/app-paths';
import { RequireAuth } from './navigation/RequireAuth';
import { ErrorBoundary } from './components/ui/error-boundary';
import {
  clearAsistenciasCursoIdPersistido,
  clearLocalSession,
  logoutOnServer,
  resetSessionExpiredState,
  UNAUTHORIZED_EVENT,
} from './utils/api';

const INSTITUTION_LOGO_URL = '/ung-logo.png';

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const PanelPage = lazy(() => import('./pages/PanelPage').then((m) => ({ default: m.PanelPage })));
const ImportacionesPage = lazy(() =>
  import('./pages/ImportacionesPage').then((m) => ({ default: m.ImportacionesPage }))
);
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const AcademicoAdminPage = lazy(() =>
  import('./pages/AcademicoAdminPage').then((m) => ({ default: m.AcademicoAdminPage }))
);
const PromocionSemestrePage = lazy(() =>
  import('./pages/PromocionSemestrePage').then((m) => ({ default: m.PromocionSemestrePage }))
);
const AlumnosAdminPage = lazy(() =>
  import('./pages/AlumnosAdminPage').then((m) => ({ default: m.AlumnosAdminPage }))
);
const AsistenciasDocentePage = lazy(() =>
  import('./pages/AsistenciasDocentePage').then((m) => ({ default: m.AsistenciasDocentePage }))
);
const ReportesPage = lazy(() =>
  import('./pages/ReportesPage').then((m) => ({ default: m.ReportesPage }))
);
const AuditoriaPage = lazy(() =>
  import('./pages/AuditoriaPage').then((m) => ({ default: m.AuditoriaPage }))
);
const LegalInfoPage = lazy(() =>
  import('./pages/LegalInfoPage').then((m) => ({ default: m.LegalInfoPage }))
);

function LoadingScreen() {
  return (
    <div className="system-bg min-h-screen grid place-items-center px-4">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#2d466d]/70 bg-[#10264a]/60 px-8 py-7">
        <img
          src={INSTITUTION_LOGO_URL}
          alt="Logo institucional"
          className="h-auto w-36 rounded-xl"
          loading="eager"
          decoding="async"
        />
        <p className="text-[#e7eef9] text-lg font-semibold">Cargando vista...</p>
      </div>
    </div>
  );
}

function LegacyHashRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const hash = window.location.hash.replace('#', '').trim();
    if (hash === 'terminos' || hash === 'privacidad' || hash === 'soporte') {
      navigate(`/${hash}`, { replace: true });
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, [navigate]);
  return null;
}

function RootRedirect() {
  let token: string | null = null;
  try {
    token = safeGetStorageItem('accessToken') ?? safeGetStorageItem('token');
  } catch {
    token = null;
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  let user: ReturnType<typeof readStoredUser> = null;
  try {
    user = readStoredUser();
  } catch {
    user = null;
  }
  return <Navigate to={appPath(getHomeViewForUser(user))} replace />;
}

function LoginRoute({ setUser }: { setUser: (u: SessionUser | null) => void }) {
  const navigate = useNavigate();
  return (
    <LoginPage
      onOpenLegalPage={(page) => navigate(`/${page}`)}
      onLoginSuccess={(usuario) => {
        clearAsistenciasCursoIdPersistido();
        setUser(usuario ?? null);
        navigate(appPath(getHomeViewForUser(usuario ?? null)), { replace: true });
      }}
    />
  );
}

function LegalRoute({ page }: { page: 'terminos' | 'privacidad' | 'soporte' }) {
  const navigate = useNavigate();
  return <LegalInfoPage page={page} onBack={() => navigate('/login')} />;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(() => readStoredUser());
  const navigate = useNavigate();
  useVisualViewportBottomInset();

  const userIdRaw = currentUser?.id ?? currentUser?.usuario ?? currentUser?.email;
  const userId =
    userIdRaw != null && String(userIdRaw).trim() !== '' ? String(userIdRaw) : undefined;

  const handleLogout = useCallback(
    async (options?: { skipServer?: boolean }) => {
      if (!options?.skipServer) {
        await logoutOnServer();
      }
      clearLocalSession();
      resetSessionExpiredState();
      setCurrentUser(null);
      navigate('/login', { replace: true });
    },
    [navigate]
  );

  useEffect(() => {
    const onUnauthorized = () => {
      void handleLogout({ skipServer: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [handleLogout]);

  const handleNavigate = useCallback(
    (view: AppView, options?: { usersAction?: 'list' | 'create' }) => {
      const user = readStoredUser();
      if (!canAccessView(user, view)) {
        navigate(appPath(getHomeViewForUser(user)), { replace: true });
        return;
      }
      navigate(appPath(view, options));
    },
    [navigate]
  );

  return (
    <ErrorBoundary>
      <ThemeProvider userId={userId}>
        <Suspense fallback={<LoadingScreen />}>
          <LegacyHashRedirect />
          <Routes>
            <Route path="/login" element={<LoginRoute setUser={setCurrentUser} />} />
            <Route path="/terminos" element={<LegalRoute page="terminos" />} />
            <Route path="/privacidad" element={<LegalRoute page="privacidad" />} />
            <Route path="/soporte" element={<LegalRoute page="soporte" />} />

            <Route element={<RequireAuth />}>
              <Route
                path="/app/panel"
                element={<PanelPage onNavigate={handleNavigate} onLogout={handleLogout} />}
              />
              <Route
                path="/app/importaciones"
                element={<ImportacionesPage onLogout={handleLogout} />}
              />
              <Route
                path="/app/usuarios"
                element={<UsersPage onLogout={handleLogout} requestedAction="list" />}
              />
              <Route
                path="/app/usuarios/nuevo"
                element={<UsersPage onLogout={handleLogout} requestedAction="create" />}
              />
              <Route
                path="/app/academico/promocion"
                element={<PromocionSemestrePage onLogout={handleLogout} />}
              />
              <Route
                path="/app/academico"
                element={<AcademicoAdminPage onLogout={handleLogout} />}
              />
              <Route
                path="/app/alumnos"
                element={<AlumnosAdminPage onLogout={handleLogout} />}
              />
              <Route
                path="/app/asistencias"
                element={
                  <AsistenciasDocentePage
                    onLogout={handleLogout}
                    roles={readStoredUser()?.roles ?? []}
                  />
                }
              />
              <Route
                path="/app/reportes"
                element={<ReportesPage onLogout={handleLogout} />}
              />
              <Route
                path="/app/auditoria"
                element={<AuditoriaPage onLogout={handleLogout} />}
              />
            </Route>

            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
