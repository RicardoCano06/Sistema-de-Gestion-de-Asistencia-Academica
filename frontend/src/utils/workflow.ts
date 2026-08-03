import type { AppView, SessionUser } from './rbac';

type UsersAction = 'list' | 'create';

export interface WorkflowAction {
  id: string;
  label: string;
  view: AppView;
  usersAction?: UsersAction;
}

function normalizeRol(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function hasRole(user: SessionUser | null, role: string): boolean {
  const roles = (user?.roles ?? []).map(normalizeRol);
  return roles.includes(normalizeRol(role));
}

const ROLES_COORDINACION_FACULTAD_NORM = new Set([
  'coordinador de facultad',
  'coordinador/a de facultad',
  'coordinadora de facultad',
]);

function esCoordinacionFacultad(user: SessionUser | null): boolean {
  return (user?.roles ?? []).some((r) => ROLES_COORDINACION_FACULTAD_NORM.has(normalizeRol(r)));
}

export function getWorkflowActions(user: SessionUser | null): WorkflowAction[] {
  if (
    hasRole(user, 'Administrador General') ||
    hasRole(user, 'Jefe de Carrera') ||
    hasRole(user, 'Secretaría Académica')
  ) {
    return [
      { id: 'a1', label: 'Configurar académico', view: 'academico' },
      { id: 'a2', label: 'Importar datos', view: 'importaciones' },
      { id: 'a3', label: 'Cerrar con reportes', view: 'reportes' },
    ];
  }

  if (esCoordinacionFacultad(user)) {
    return [
      { id: 'd1', label: 'Revisar panel', view: 'panel' },
      { id: 'd2', label: 'Gestionar académico', view: 'academico' },
      { id: 'd4', label: 'Consultar alumnos', view: 'alumnos' },
      { id: 'd3', label: 'Emitir actas', view: 'reportes' },
    ];
  }

  if (hasRole(user, 'Docente')) {
    return [
      { id: 't1', label: 'Abrir planilla', view: 'asistencias' },
      { id: 't2', label: 'Registrar jornada', view: 'asistencias' },
      { id: 't3', label: 'Revisar justificaciones', view: 'asistencias' },
    ];
  }

  return [
    { id: 'f1', label: 'Ir a importaciones', view: 'importaciones' },
    { id: 'f2', label: 'Revisar panel', view: 'panel' },
    { id: 'f3', label: 'Gestionar usuarios', view: 'usuarios', usersAction: 'list' },
  ];
}

export function getWorkflowChecklist(user: SessionUser | null): string[] {
  if (
    hasRole(user, 'Administrador General') ||
    hasRole(user, 'Jefe de Carrera') ||
    hasRole(user, 'Secretaría Académica')
  ) {
    return [
      'Abrir cursos del mes',
      'Validar matrículas cargadas',
      'Publicar cierre mensual',
    ];
  }

  if (esCoordinacionFacultad(user)) {
    return [
      'Revisar ausentismo por carrera',
      'Priorizar alertas rojas',
      'Consultar trayectoria de alumnos de la facultad',
      'Confirmar actas de cierre',
    ];
  }

  if (hasRole(user, 'Docente')) {
    return [
      'Tomar asistencia del día',
      'Registrar ausentes/justificados',
      'Cerrar jornada para bloquear edición',
    ];
  }

  return ['Ingresar al módulo principal', 'Completar la tarea del día', 'Validar estado final'];
}
