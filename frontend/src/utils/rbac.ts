export type AppView = 'panel' | 'importaciones' | 'usuarios' | 'academico' | 'alumnos' | 'asistencias' | 'reportes' | 'auditoria';

export interface SessionUser {
  id?: string;
  nombres?: string;
  apellidos?: string;
  email?: string;
  usuario?: string;
  roles?: string[];
  /** Si viene del login/refresh API, tiene prioridad sobre el cálculo local por roles. */
  vistasPermitidas?: AppView[];
  vistaInicio?: AppView;
}

/** Normaliza `roles` tal como puede llegar del login (array, string único u objeto tipo fila). */
export function coerceRolesToStringArray(roles: unknown): string[] {
  if (roles == null) return [];
  if (Array.isArray(roles)) {
    const out: string[] = [];
    for (const r of roles) {
      if (r == null) continue;
      if (typeof r === 'string') {
        const s = r.trim();
        if (s) out.push(s);
        continue;
      }
      const s = String(r).trim();
      if (s) out.push(s);
    }
    return out;
  }
  if (typeof roles === 'string') {
    const s = roles.trim();
    return s ? [s] : [];
  }
  if (typeof roles === 'object') {
    return Object.values(roles as Record<string, unknown>)
      .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
      .filter((s) => s.length > 0);
  }
  return [];
}

/** Alineado con el backend (`auth.middleware`): evita que variantes con espacios/ZWJ fallen la comparación. */
export function normalizeRol(value: string): string {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u2044|\u2215/g, '/')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const ALL_VIEWS: AppView[] = ['panel', 'importaciones', 'usuarios', 'academico', 'alumnos', 'asistencias', 'reportes', 'auditoria'];

/** Administrador General: sin módulo Asistencias (solo docentes). */
const ADMIN_VIEWS: AppView[] = ['panel', 'importaciones', 'usuarios', 'academico', 'alumnos', 'reportes', 'auditoria'];

const SECRETARIA_VIEWS: AppView[] = ['panel', 'academico', 'alumnos', 'importaciones', 'reportes', 'usuarios'];

const KNOWN_VIEWS = new Set<string>(ALL_VIEWS);

function viewsFromServer(raw: unknown): AppView[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out = raw.filter((v): v is AppView => typeof v === 'string' && KNOWN_VIEWS.has(v));
  return out.length > 0 ? out : undefined;
}

function allowedViewsFromRolesOnly(rolesRaw: unknown): AppView[] {
  const roles = coerceRolesToStringArray(rolesRaw);
  const roleSet = new Set(roles.map(normalizeRol));

  if (roleSet.has('administrador general')) {
    return [...ADMIN_VIEWS];
  }

  if (roleSet.has('secretaria academica')) {
    return [...SECRETARIA_VIEWS];
  }

  if (roleSet.has('jefe de carrera')) {
    return ['panel', 'academico', 'alumnos', 'reportes'];
  }

  if (roleSet.has('coordinador de facultad') || roleSet.has('coordinador/a de facultad') || roleSet.has('coordinadora de facultad')) {
    return ['panel', 'academico', 'alumnos', 'reportes'];
  }

  if (roleSet.has('docente')) {
    return ['asistencias'];
  }

  return ['importaciones'];
}

export function getAllowedViewsForUser(user?: SessionUser | null): AppView[] {
  const fromServer = viewsFromServer(user?.vistasPermitidas);
  if (fromServer) {
    return fromServer;
  }
  return allowedViewsFromRolesOnly(user?.roles);
}

export function canAccessView(user: SessionUser | null | undefined, view: AppView): boolean {
  return getAllowedViewsForUser(user).includes(view);
}

export function getHomeViewForUser(user?: SessionUser | null): AppView {
  const allowed = getAllowedViewsForUser(user);
  if (user?.vistaInicio && allowed.includes(user.vistaInicio)) {
    return user.vistaInicio;
  }
  const preferredOrder: AppView[] = ['panel', 'asistencias', 'academico', 'importaciones', 'alumnos', 'reportes', 'auditoria', 'usuarios'];
  const preferred = preferredOrder.find((view) => allowed.includes(view));
  return preferred ?? allowed[0] ?? 'importaciones';
}

/** Alinear con `ROLES_APROBADORES_JUSTIFICACIONES` en el backend (sin Administrador General). */
/** CU-33: cierre mensual del módulo (no incluye Coordinador de Facultad). */
export function puedeEjecutarCierreMensual(roles: unknown): boolean {
  const set = new Set(coerceRolesToStringArray(roles).map(normalizeRol));
  return (
    set.has('administrador general') ||
    set.has('secretaria academica') ||
    set.has('jefe de carrera')
  );
}

export function puedeAprobarJustificaciones(roles: unknown): boolean {
  const set = new Set(coerceRolesToStringArray(roles).map(normalizeRol));
  return (
    set.has('jefe de carrera') ||
    set.has('secretaria academica') ||
    set.has('coordinador de facultad') ||
    set.has('coordinador/a de facultad') ||
    set.has('coordinadora de facultad')
  );
}

/** Edición de datos de alumno: solo Administrador General y Secretaría Académica. */
export function puedeEditarAlumno(roles: unknown): boolean {
  const set = new Set(coerceRolesToStringArray(roles).map(normalizeRol));
  return set.has('administrador general') || set.has('secretaria academica');
}

/**
 * Jefe de carrera sin rol de secretaría, administración global ni coordinación de facultad:
 * el buscador de alumnos ya se acota por alcance en servidor; no se muestran filtros de facultad/carrera.
 */
export function esGestionUnicaCarreraAlumnosListado(roles: unknown): boolean {
  const set = new Set(coerceRolesToStringArray(roles).map(normalizeRol));
  if (!set.has('jefe de carrera')) return false;
  if (set.has('administrador general') || set.has('secretaria academica')) return false;
  if (
    set.has('coordinador de facultad') ||
    set.has('coordinador/a de facultad') ||
    set.has('coordinadora de facultad')
  ) {
    return false;
  }
  return true;
}
