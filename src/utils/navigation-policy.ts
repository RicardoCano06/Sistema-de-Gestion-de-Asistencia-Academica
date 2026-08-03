/**
 * Vistas de la SPA alineadas con frontend/src/utils/rbac.ts (AppView).
 * Fuente de verdad para login/refresh: el cliente puede usar estas listas sin recalcular.
 */

export type AppViewId = 'panel' | 'importaciones' | 'usuarios' | 'academico' | 'alumnos' | 'asistencias' | 'reportes' | 'auditoria';

/** Administración: gestión global; asistencias solo para docentes. */
const ADMIN_VIEWS: AppViewId[] = [
    'panel',
    'importaciones',
    'usuarios',
    'academico',
    'alumnos',
    'reportes',
    'auditoria'
];

/** Sin asistencias ni auditoría; usuarios con edición (borrado: admin y secretaría académica). */
const SECRETARIA_VIEWS: AppViewId[] = [
    'panel',
    'academico',
    'alumnos',
    'importaciones',
    'reportes',
    'usuarios'
];

function normalizeRol(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

export function computeAllowedAppViews(roles: string[]): AppViewId[] {
    const set = new Set((roles ?? []).map(normalizeRol));

    if (set.has('administrador general')) {
        return [...ADMIN_VIEWS];
    }

    if (set.has('secretaria academica')) {
        return [...SECRETARIA_VIEWS];
    }

    if (set.has('jefe de carrera')) {
        return ['panel', 'academico', 'alumnos', 'reportes'];
    }

    if (set.has('coordinador de facultad') || set.has('coordinador/a de facultad') || set.has('coordinadora de facultad')) {
        return ['panel', 'academico', 'alumnos', 'reportes'];
    }

    if (set.has('docente')) {
        return ['asistencias'];
    }

    return ['importaciones'];
}

const HOME_PREFERRED_ORDER: AppViewId[] = [
    'panel',
    'asistencias',
    'academico',
    'importaciones',
    'alumnos',
    'reportes',
    'auditoria',
    'usuarios'
];

export function computeHomeAppView(roles: string[]): AppViewId {
    const allowed = computeAllowedAppViews(roles);
    const preferred = HOME_PREFERRED_ORDER.find((view) => allowed.includes(view));
    return preferred ?? allowed[0] ?? 'importaciones';
}
