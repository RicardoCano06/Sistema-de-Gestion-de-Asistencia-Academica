const unique = (...grupos: ReadonlyArray<ReadonlyArray<string>>): string[] => {
  const resultado = new Set<string>();
  for (const grupo of grupos) {
    for (const rol of grupo) {
      resultado.add(rol);
    }
  }
  return Array.from(resultado);
};

export const RBAC = {
  /** Único rol de administración global (el rol legado «Administrador» se migra en BD). */
  admin: ['Administrador General'] as const,
  academic: ['Jefe de Carrera', 'Secretaría Académica'] as const,
/** Coordinación de facultad (nombre vigente en BD). */
  director: ['Coordinador de Facultad'] as const,
  docente: ['Docente'] as const,
};

export const ROLES_ADMIN_O_ACADEMICOS = unique(RBAC.admin, RBAC.academic);
/** Gestión de usuarios: administración global y secretaría académica (Jefe de Carrera no tiene acceso a usuarios). */
export const ROLES_GESTION_USUARIOS = unique(RBAC.admin, ['Secretaría Académica'] as const);
/** Edición de datos de alumno (nombre, apellido, CI): solo administración global y secretaría académica. */
export const ROLES_EDITAR_ALUMNOS = unique(RBAC.admin, ['Secretaría Académica'] as const);
/** Eliminar usuarios: administración global y secretaría académica. */
export const ROLES_ELIMINAR_USUARIOS = unique(RBAC.admin, ['Secretaría Académica'] as const);
/** Búsqueda 360 / ficha / informe PDF de alumnos: académicos + coordinación de facultad (con filtro por scopes). */
export const ROLES_ALUMNOS = unique(RBAC.admin, RBAC.academic, RBAC.director);
export const ROLES_LECTURA_DIRECCION = unique(ROLES_ADMIN_O_ACADEMICOS, RBAC.director);
/** Recalcular estadísticas, generar actas/PDF de reportes dentro del alcance (incluye Coordinador de Facultad). */
export const ROLES_REPORTES_OPERATIVOS = ROLES_LECTURA_DIRECCION;
/** Cerrar módulo mensual: sin coordinación de facultad (CU-33). */
export const ROLES_CIERRE_MENSUAL_EJECUTAR = ROLES_ADMIN_O_ACADEMICOS;
/** Gestión operativa (planes, materias, módulos, cursos, matrículas): académicos + coordinación de facultad (alcance en API). */
/** Gestión operativa (planes, materias, módulos, cursos, matrículas): mismos roles que lectura + dirección. */
export const ROLES_GESTION_ACADEMICA_OPERATIVA = ROLES_LECTURA_DIRECCION;
export const ROLES_OPERADORES_ASISTENCIAS = unique(ROLES_ADMIN_O_ACADEMICOS, RBAC.docente);
/** Alta de justificaciones y PDF: operadores de asistencias excepto Administrador General. */
export const ROLES_REGISTRO_JUSTIFICACIONES = unique(
  ROLES_OPERADORES_ASISTENCIAS.filter((r) => r !== 'Administrador General'),
);
/** Aprobar/rechazar: jefatura/coordinación de carrera, secretaría y coordinación de facultad (alcance en servicio). */
export const ROLES_APROBADORES_JUSTIFICACIONES = unique(RBAC.academic, RBAC.director);
export const ROLES_CONSULTA_ASISTENCIAS = unique(ROLES_LECTURA_DIRECCION, RBAC.docente);
/** Listado GET /justificaciones: consulta asistencias excepto Administrador General. */
export const ROLES_CONSULTA_JUSTIFICACIONES = ROLES_CONSULTA_ASISTENCIAS.filter((r) => r !== 'Administrador General');
