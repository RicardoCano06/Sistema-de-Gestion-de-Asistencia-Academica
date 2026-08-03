import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { getAllowedViewsForUser } from '../utils/rbac';
import type { AppView } from '../utils/rbac';
import { appPath } from '../navigation/app-paths';
import { readStoredUser } from '../utils/session-user';
import { etiquetasRoles } from '../utils/role-labels';
import { UserAvatar } from './ui/user-avatar';
import { useTheme } from '../contexts/ThemeContext';

interface AppSidebarProps {
  sidebarOpen: boolean;
  onLogout?: () => void;
  onClose?: () => void;
}

const SIDEBAR_ITEMS: { id: string; label: string; icon: string; view: AppView }[] = [
  { id: 'panel', label: 'Inicio', icon: 'dashboard', view: 'panel' },
  { id: 'asistencias', label: 'Asistencias', icon: 'checklist', view: 'asistencias' },
  { id: 'academico', label: 'Académico', icon: 'school', view: 'academico' },
  { id: 'alumnos', label: 'Alumnos', icon: 'badge', view: 'alumnos' },
  { id: 'importaciones', label: 'Importaciones', icon: 'upload_file', view: 'importaciones' },
  { id: 'reportes', label: 'Reportes', icon: 'description', view: 'reportes' },
  { id: 'auditoria', label: 'Auditoría', icon: 'policy', view: 'auditoria' },
  { id: 'usuarios', label: 'Usuarios', icon: 'group', view: 'usuarios' },
];

function sidebarItemActive(pathname: string, view: AppView): boolean {
  if (view === 'usuarios') {
    return pathname === '/app/usuarios' || pathname.startsWith('/app/usuarios/');
  }
  if (view === 'academico') {
    return pathname === '/app/academico' || pathname.startsWith('/app/academico/');
  }
  return pathname === appPath(view);
}

function getDisplayName(user: ReturnType<typeof readStoredUser>): string {
  if (!user) return 'Usuario';
  const fullName = `${user.nombres ?? ''} ${user.apellidos ?? ''}`.trim();
  return fullName || user.usuario || user.email || 'Usuario';
}

function getPrimaryRole(user: ReturnType<typeof readStoredUser>): string {
  const roles = etiquetasRoles(user?.roles ?? []);
  if (!roles.length) return 'Sin rol';

  const priority = [
    'Administrador General',
    'Jefe de Carrera',
    'Secretaría Académica',
    'Coordinador de Facultad',
    'Docente',
  ];

  const preferred = priority.find((target) => roles.includes(target));
  return preferred ?? roles[0];
}

export function AppSidebar({ sidebarOpen, onLogout, onClose }: AppSidebarProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const currentUser = readStoredUser();
  const displayName = getDisplayName(currentUser);
  const primaryRole = getPrimaryRole(currentUser);
  const allowedViews = getAllowedViewsForUser(currentUser);
  const visibleItems = SIDEBAR_ITEMS.filter((item) => allowedViews.includes(item.view));

  const { isDark, toggle } = useTheme();

  /** Drawer móvil + tablet vertical (&lt; lg). Escritorio y tablet horizontal (lg+) sin overlay. */
  useEffect(() => {
    const mqDesktop = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (sidebarOpen && !mqDesktop.matches) {
        document.documentElement.classList.add('mobile-sidebar-open');
      } else {
        document.documentElement.classList.remove('mobile-sidebar-open');
      }
    };
    sync();
    mqDesktop.addEventListener('change', sync);
    return () => {
      document.documentElement.classList.remove('mobile-sidebar-open');
      mqDesktop.removeEventListener('change', sync);
    };
  }, [sidebarOpen]);

  const txt = isDark ? 'text-[#f0f4f8]' : 'text-slate-900';
  const txtHover = isDark ? 'hover:bg-[#273664] hover:text-[#e8eeff]' : 'hover:bg-slate-100 hover:text-slate-900';
  const iconTxt = isDark ? 'text-[#9caedc]' : 'text-slate-400';
  const iconHover = isDark ? 'group-hover:text-[#e4ebff]' : 'group-hover:text-slate-800';
  const divider = isDark ? 'border-[#263663]' : 'border-slate-200';
  const nameClr = isDark ? 'text-[#f0f4f8]' : 'text-slate-800';
  const roleClr = isDark ? 'text-[#95a8d9]' : 'text-slate-500';
  const activeChip = isDark
    ? 'sidebar-active-chip bg-[#2a3868] text-[#eef3ff]'
    : 'bg-[#eff3ff] text-[#3b5cc8]';
  const activeBar = isDark ? 'bg-[#f7f9ff]' : 'bg-[#3b5cc8]';
  const activeIcon = isDark
    ? 'fill-1 bg-[rgba(164,181,236,0.28)] text-[#f1f5ff]'
    : 'fill-1 bg-[rgba(59,92,200,0.1)] text-[#3b5cc8]';
  const inactiveIcon = isDark ? 'text-[#9caedc]' : 'text-slate-400';

  return (
    <aside
      className={`app-sidebar-shell shrink-0 fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:max-w-none lg:translate-x-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-end px-3 pt-3 lg:hidden">
          <button
            type="button"
            className={`rounded-lg p-2 ${txt} ${txtHover}`}
            onClick={() => onClose?.()}
            aria-label="Cerrar menú"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>
        <div className="scroll-region flex min-h-0 flex-1 flex-col justify-between p-4 max-lg:pt-0 lg:pt-4">
        <div className="flex flex-col gap-6">
          <div className={`flex gap-3 items-center pb-4 border-b ${divider}`}>
            <UserAvatar nombres={currentUser?.nombres} apellidos={currentUser?.apellidos} size="md" />
            <div className="flex flex-col overflow-hidden min-w-0 flex-1">
              <h1 className={`${nameClr} text-sm font-semibold leading-tight max-lg:whitespace-normal lg:truncate`}>
                {displayName}
              </h1>
              <p className={`${roleClr} text-xs font-normal leading-normal max-lg:whitespace-normal lg:truncate`}>
                {primaryRole}
              </p>
            </div>
          </div>

          <nav className="flex flex-col gap-2">
            {visibleItems.map((item) => {
              const active = sidebarItemActive(pathname, item.view);
              return (
                <NavLink
                  key={item.id}
                  to={appPath(item.view)}
                  end={item.view !== 'usuarios' && item.view !== 'academico'}
                  onClick={() => onClose?.()}
                  className={`group sidebar-nav-item relative flex items-center gap-3 overflow-hidden rounded-[7px] px-3 py-2.5 text-[14px] font-medium tracking-[0.005em] transition-none ${
                    active ? activeChip : `${txt} ${txtHover}`
                  }`}
                >
                  {active ? (
                    <span
                      className={`absolute left-0 top-1/2 h-[24px] w-[3px] -translate-y-1/2 rounded-r-full ${activeBar}`}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={`material-symbols-outlined relative z-10 rounded-[6px] p-1 text-[18px] transition-none ${
                      active ? activeIcon : `${inactiveIcon} ${iconHover}`
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="relative z-10">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            className={`group flex w-full items-center gap-3 rounded-[7px] px-3 py-2.5 text-[14px] ${txt} transition-none ${txtHover}`}
            onClick={toggle}
          >
            <span
              className={`material-symbols-outlined rounded-[6px] p-1 text-[18px] ${iconTxt} transition-none ${iconHover}`}
            >
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
            {isDark ? 'Modo claro' : 'Modo oscuro'}
          </button>
          <button
            type="button"
            className={`group flex w-full items-center gap-3 rounded-[7px] px-3 py-2.5 text-[14px] ${txt} transition-none ${txtHover}`}
            onClick={() => void onLogout?.()}
          >
            <span className={`material-symbols-outlined rounded-[6px] p-1 text-[18px] ${iconTxt} transition-none ${iconHover}`}>
              logout
            </span>
            Cerrar sesión
          </button>
        </div>
        </div>
      </div>
    </aside>
  );
}
