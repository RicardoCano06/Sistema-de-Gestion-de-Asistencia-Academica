import type { AppView } from '../utils/rbac';

const APP_SEGMENTS: readonly AppView[] = [
  'panel',
  'importaciones',
  'usuarios',
  'academico',
  'alumnos',
  'asistencias',
  'reportes',
  'auditoria'
];

export function isAppViewSegment(value: string): value is AppView {
  return (APP_SEGMENTS as readonly string[]).includes(value);
}

export function appPath(view: AppView, opts?: { usersAction?: 'list' | 'create' }): string {
  if (view === 'usuarios' && opts?.usersAction === 'create') {
    return '/app/usuarios/nuevo';
  }
  return `/app/${view}`;
}

/** Vista RBAC asociada al path (p. ej. /app/usuarios/nuevo → usuarios). */
export function activeViewFromPathname(pathname: string): AppView | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'app' || !parts[1]) return null;
  if (parts[1] === 'usuarios' && parts[2] === 'nuevo') return 'usuarios';
  if (isAppViewSegment(parts[1])) return parts[1];
  return null;
}
